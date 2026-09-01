<?php

namespace Tests\Feature;

use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\Run;
use App\Serializers\Screen\RunsScreen;
use App\Serializers\ScreenSerializer;
use App\Services\Console\RunRecorder;
use App\Services\Console\ToolRegistry;
use App\Services\Console\ToolResult;
use App\Services\Console\Tools\ConsoleTool;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\LlmToolCall;
use App\Services\Llm\OllamaProvider;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Log behov — `runs`, {@see RunRecorder} a obrazovka Runy.
 *
 * Táto sada stráži tri veci, ktoré sú v kontrakte podmienkou, nie želaním:
 *
 *  1. **Beh sa zaznamená bez toho, aby sa `AgentRunner` dotkol.** Recorder visí na
 *     `$emit`, takže tu sa testuje ten istý povrch, ktorý vidí prehliadač.
 *  2. **Ťah rozdelený dvojfázovou bránou je JEDEN beh**, nie dva polovičné —
 *     `/run` ho zaparkuje, `/decide` ten istý riadok dokončí.
 *  3. **`tokens_per_second` nemeria wall-clock.** Beh, v ktorom sa človek dve
 *     minúty rozhodoval o zápise, nesmie hlásiť, že model generoval 0,1 tok/s.
 *
 * Fake-y sú tu vlastné a nie zdieľané s {@see ConsoleRunTest} zámerne: ten súbor
 * paralelne mení druhá session (§0 kontraktu) a zdieľaná pomôcka by z dvoch
 * nezávislých sád spravila jednu, ktorá padá na cudzie zmeny.
 */
class RunLogTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);
        config(['hades.console.provider' => 'ollama']);
    }

    // ---- záznam behu -------------------------------------------------------

    public function test_a_plain_turn_becomes_one_finished_run(): void
    {
        $thread = ConsoleThread::create([]);
        $this->fakeTools([]);
        $this->fakeProvider([
            new LlmResponse(text: 'Ahoj, tu Hades.', tokensIn: 120, tokensOut: 8, durationMs: 900, model: 'fake:1', evalDurationMs: 800),
        ]);

        $this->frames($this->send($thread, 'Ahoj'));

        $this->assertSame(1, Run::count(), 'Jeden ťah má byť jeden beh.');

        $run = Run::first();
        $this->assertSame('done', $run->status);
        $this->assertSame('console', $run->source);
        $this->assertSame('Ahoj', $run->prompt);
        $this->assertSame($thread->id, $run->thread_id);
        $this->assertSame(120, $run->tokens_in);
        $this->assertSame(8, $run->tokens_out);
        $this->assertSame(1, $run->steps);
        $this->assertSame(0, $run->tool_calls);
        $this->assertNotNull($run->ended_at);
        $this->assertNotNull($run->duration_ms);
    }

    public function test_the_run_covers_exactly_the_messages_of_its_own_turn(): void
    {
        $thread = ConsoleThread::create([]);
        $this->fakeTools([]);
        $this->fakeProvider([new LlmResponse(text: 'prvá'), new LlmResponse(text: 'druhá')]);

        $this->frames($this->send($thread, 'jedna'));
        $firstRun = Run::first();
        $idsAfterFirst = ConsoleMessage::where('thread_id', $thread->id)->pluck('id');

        $this->frames($this->send($thread, 'dva'));
        $secondRun = Run::orderByDesc('id')->first();

        $this->assertSame(2, Run::count());

        // Prvý beh nesmie po druhom ťahu narásť — rozsah je uzavretý pri jeho konci.
        $firstRun->refresh();
        $this->assertSame($idsAfterFirst->max(), $firstRun->to_message_id);

        // A druhý beh nesmie vidieť správy prvého.
        $this->assertGreaterThan($firstRun->to_message_id, $secondRun->from_message_id);

        $roles = $secondRun->messages()->pluck('role')->all();
        $this->assertContains('user', $roles);
        $this->assertNotContains('system', $secondRun->messages()->pluck('role')->unique()->diff(['user', 'assistant', 'tool'])->all());
    }

    // ---- dvojfázová brána v jednom behu ------------------------------------

    public function test_a_parked_write_leaves_the_run_waiting_and_decide_finishes_the_same_run(): void
    {
        [$thread, $callId] = $this->parkedWrite([
            new LlmResponse(text: 'Zapísané.', tokensIn: 50, tokensOut: 4, evalDurationMs: 400),
        ]);

        $run = Run::first();
        $this->assertSame(1, Run::count());
        $this->assertSame('waiting', $run->status, 'Zaparkovaný beh nie je hotový ani spadnutý.');
        $this->assertNull($run->ended_at, 'Zaparkovaný beh sa nesmie uzavrieť — inak trvanie meria rozhodovanie človeka.');

        $this->frames($this->decide($thread, $callId, 'allow'));

        $this->assertSame(1, Run::count(), 'Rozhodnutie nesmie založiť druhý beh.');

        $run->refresh();
        $this->assertSame('done', $run->status);
        $this->assertSame(1, $run->tool_calls);
        $this->assertNotNull($run->ended_at);
    }

    public function test_a_denied_write_still_finishes_the_run(): void
    {
        [$thread, $callId] = $this->parkedWrite([new LlmResponse(text: 'Dobre, nechávam.')]);

        $this->frames($this->decide($thread, $callId, 'deny'));

        $run = Run::first();
        $this->assertSame('done', $run->status);
        $this->assertSame(1, Run::count());

        // Zamietnutie musí byť v detaile vidieť — je to najdôležitejší záznam behu.
        $detail = $this->getJson('/api/runs/'.$run->uuid)->json();
        $denied = collect($detail['timeline'])->firstWhere('status', 'denied');
        $this->assertNotNull($denied, 'Zamietnutý zápis nie je v časovej osi behu.');
    }

    public function test_tokens_are_summed_across_segments_and_speed_ignores_wall_clock(): void
    {
        [$thread, $callId] = $this->parkedWrite([
            new LlmResponse(text: 'Hotovo.', tokensIn: 60, tokensOut: 20, evalDurationMs: 2000),
        ]);

        $run = Run::first();

        // Prvý segment: 100 in / 10 out za 1000 ms → 10 tok/s.
        $this->assertSame(100, $run->tokens_in);
        $this->assertSame(10, $run->tokens_out);

        // Beh medzitým „čaká na človeka" — wall clock rastie, generovanie nie.
        $run->started_at = now()->subMinutes(5);
        $run->save();

        $this->frames($this->decide($thread, $callId, 'allow'));

        $run->refresh();
        $this->assertSame(160, $run->tokens_in);
        $this->assertSame(30, $run->tokens_out);

        // 30 tokenov za 1000 + 2000 ms generovania = 10 tok/s. Wall clock je 5 minút,
        // z ktorých by vyšlo 0,1 tok/s — presne tá lož, ktorej sa vyhýbame.
        $this->assertSame(10.0, (float) $run->tokens_per_second);
        $this->assertGreaterThan(200_000, $run->duration_ms, 'Trvanie behu MÁ byť wall clock.');
    }

    public function test_a_failing_turn_is_recorded_as_failed_with_its_message(): void
    {
        $thread = ConsoleThread::create([]);
        $this->fakeTools([]);
        $this->fakeProvider([]);

        // Prázdny scenár fake poskytovateľa odpovie „Hotovo." — chybu preto vyrobíme
        // rámcom priamo cez recorder, ktorý je jediné miesto, čo stav behu určuje.
        $recorder = app(RunRecorder::class);
        $run = $recorder->open($thread, 'úloha');
        $recorder->observe($run, ['t' => 'error', 'message' => 'Model nedostupný.']);
        $recorder->close($run);

        $run->refresh();
        $this->assertSame('failed', $run->status);
        $this->assertSame('Model nedostupný.', $run->error);
        $this->assertNotNull($run->ended_at);
    }

    public function test_a_client_that_walks_away_is_recorded_as_aborted_not_done(): void
    {
        $thread = ConsoleThread::create([]);
        $recorder = app(RunRecorder::class);

        $run = $recorder->open($thread, 'dlhá úloha');
        $recorder->observe($run, ['t' => 'step', 'n' => 1, 'of' => 12]);
        $recorder->close($run, aborted: true);

        $run->refresh();
        $this->assertSame('aborted', $run->status);
        $this->assertSame(1, $run->steps);
    }

    public function test_a_run_left_hanging_by_a_restart_is_reaped(): void
    {
        $thread = ConsoleThread::create([]);
        $recorder = app(RunRecorder::class);

        $fresh = $recorder->open($thread, 'práve beží');
        $stale = $recorder->open($thread, 'visí od reštartu');

        // Mŕtvy je beh, o ktorom sa dlho NIČ NEOZVALO — nie ten, ktorý dávno začal.
        // Preto sa posúva `updated_at`, nie `started_at`.
        $stale->forceFill(['updated_at' => now()->subHours(2)])->saveQuietly();

        $this->assertSame(1, $recorder->reapStale());

        $this->assertSame('aborted', $stale->fresh()->status);
        $this->assertSame('running', $fresh->fresh()->status, 'Rozbehnutý beh sa nesmie zabiť.');
    }

    public function test_a_second_run_in_the_same_thread_is_refused_so_the_id_range_stays_exact(): void
    {
        $thread = ConsoleThread::create([]);
        $recorder = app(RunRecorder::class);

        // Prvý ťah beží (stav `running`, čerstvá aktivita).
        $first = $recorder->open($thread, 'prvý ťah');

        $this->fakeTools([]);
        $this->fakeProvider([new LlmResponse(text: 'nemá sa spustiť')]);

        $frames = $this->frames($this->send($thread, 'druhý ťah'));

        // `pendingToolCall()` chráni až parkujúci zápis, takže bez tejto brány by
        // druhý ťah prešiel a oba behy by si nastavili ten istý `from_message_id` —
        // každý by potom hlásil cenu oboch a v detaile ukázal cudzí ťah.
        $this->assertSame('error', $frames[0]['t']);
        $this->assertStringContainsString('už jeden beh prebieha', $frames[0]['message']);
        $this->assertSame(1, Run::count(), 'Odmietnutý ťah nesmie založiť druhý beh.');
        $this->assertSame('running', $first->fresh()->status);
    }

    public function test_a_thread_whose_run_died_with_the_process_is_not_locked_forever(): void
    {
        $thread = ConsoleThread::create([]);
        $dead = app(RunRecorder::class)->open($thread, 'zomrel s procesom');
        $dead->forceFill(['updated_at' => now()->subHours(2)])->saveQuietly();

        $this->fakeTools([]);
        $this->fakeProvider([new LlmResponse(text: 'ide to')]);

        $frames = $this->frames($this->send($thread, 'nový ťah'));

        // Beh v `running`, o ktorom sa dlho nič neozvalo, sa za živý nepočíta —
        // inak by smrť PHP workera zamkla vlákno až do behu zametača.
        $this->assertNotSame('error', $frames[0]['t']);
        $this->assertSame(2, Run::count());
    }

    public function test_a_resumed_run_is_not_reaped_even_though_it_started_long_ago(): void
    {
        [$thread, $callId] = $this->parkedWrite([new LlmResponse(text: 'Zapísané.')]);

        // Človek sa rozhodoval hodinu — beh teda ZAČAL dávno, ale práve ožil.
        $run = Run::first();
        $run->forceFill(['started_at' => now()->subHours(1)])->saveQuietly();

        $this->frames($this->decide($thread, $callId, 'allow'));

        $this->assertSame(0, app(RunRecorder::class)->reapStale(), 'Zametač nesmie zabiť práve oživený beh.');
        $this->assertNotSame('aborted', $run->fresh()->status);
    }

    public function test_a_reaped_run_keeps_its_messages_and_its_cost(): void
    {
        $thread = ConsoleThread::create([]);
        $this->fakeTools([]);
        $this->fakeProvider([new LlmResponse(text: 'odpoveď', tokensIn: 90, tokensOut: 12, evalDurationMs: 1000)]);

        $this->frames($this->send($thread, 'úloha'));

        // Beh umelo vrátime do `running` bez rozsahu — tak vyzerá beh, ktorý zomrel
        // s procesom pred tým, než ho `close()` uzavrel.
        $run = Run::first();
        $run->forceFill([
            'status' => 'running',
            'to_message_id' => null,
            'tokens_in' => null,
            'tokens_out' => null,
            'updated_at' => now()->subHours(2),
        ])->saveQuietly();

        app(RunRecorder::class)->reapStale();
        $run->refresh();

        // Hromadný `update()` by nedoplnil rozsah ani cenu, takže detail by hlásil
        // prázdnu časovú os a nulové tokeny, hoci správy v DB sú.
        $this->assertSame('aborted', $run->status);
        $this->assertNotNull($run->to_message_id);
        $this->assertSame(90, $run->tokens_in);
        $this->assertGreaterThan(0, $run->messages()->count());
    }

    public function test_the_log_survives_the_deletion_of_its_thread(): void
    {
        $thread = ConsoleThread::create([]);
        $run = $this->makeRun(['thread_id' => $thread->id, 'prompt' => 'niečo dôležité']);

        $this->deleteJson('/api/console/threads/'.$thread->uuid)->assertOk();

        // S kaskádou stačil jeden klik v paneli vlákien a celá história behov bola
        // preč — teda „každý beh je perzistovaný" padalo na jedno kliknutie.
        $this->assertSame(1, Run::count());
        $this->assertNull($run->fresh()->thread_id);
        $this->assertSame('niečo dôležité', $run->fresh()->prompt);
    }

    public function test_the_reap_command_shows_before_it_touches(): void
    {
        $thread = ConsoleThread::create([]);
        $stale = app(RunRecorder::class)->open($thread, 'visí od reštartu');
        $stale->forceFill(['updated_at' => now()->subHours(2)])->saveQuietly();

        $this->artisan('mind:reap-runs --dry-run')->assertSuccessful();
        $this->assertSame('running', $stale->fresh()->status, 'Dry-run nesmie nič zmeniť.');

        $this->artisan('mind:reap-runs')->assertSuccessful();
        $this->assertSame('aborted', $stale->fresh()->status);
    }

    public function test_a_parked_run_is_never_reaped_because_it_waits_for_a_human(): void
    {
        $thread = ConsoleThread::create([]);
        $parked = app(RunRecorder::class)->open($thread, 'čaká na povolenie');
        $parked->status = 'waiting';
        $parked->save();
        $parked->forceFill(['updated_at' => now()->subDays(2)])->saveQuietly();

        $this->artisan('mind:reap-runs')->assertSuccessful();

        $this->assertSame('waiting', $parked->fresh()->status);
    }

    // ---- obrazovka a jej AI dvojča -----------------------------------------

    public function test_the_list_carries_rows_counts_and_filter_options(): void
    {
        $this->makeRun(['status' => 'done', 'model' => 'qwen3:8b', 'prompt' => 'nájdi Docker']);
        $this->makeRun(['status' => 'failed', 'model' => 'qwen3:8b', 'prompt' => 'oprav label']);
        $this->makeRun(['status' => 'done', 'model' => 'fake:1', 'prompt' => 'iné']);

        $body = $this->getJson('/api/runs')->assertOk()->json();

        $this->assertCount(3, $body['items']);
        $this->assertSame(3, $body['counts']['total']);
        $this->assertSame(2, $body['counts']['done']);
        $this->assertSame(1, $body['counts']['failed']);
        $this->assertSame(['fake:1', 'qwen3:8b'], $body['models']);
    }

    public function test_the_list_filters_by_status_model_and_text(): void
    {
        $this->makeRun(['status' => 'done', 'model' => 'qwen3:8b', 'prompt' => 'nájdi Docker']);
        $this->makeRun(['status' => 'failed', 'model' => 'fake:1', 'prompt' => 'oprav label']);

        $this->assertCount(1, $this->getJson('/api/runs?status=failed')->json('items'));
        $this->assertCount(1, $this->getJson('/api/runs?model=qwen3:8b')->json('items'));
        $this->assertCount(1, $this->getJson('/api/runs?q=Docker')->json('items'));
        $this->assertCount(0, $this->getJson('/api/runs?q=nesmysel')->json('items'));

        $this->getJson('/api/runs?status=vymyslene')->assertStatus(422);
    }

    public function test_the_filtered_count_is_after_the_filter_and_counts_stays_before_it(): void
    {
        $this->makeRun(['model' => 'qwen3:8b', 'prompt' => 'nájdi Docker']);
        $this->makeRun(['model' => 'qwen3:8b', 'prompt' => 'oprav label']);
        $this->makeRun(['model' => 'fake:1', 'prompt' => 'iné']);

        $all = $this->getJson('/api/runs')->assertOk()->json();
        $this->assertSame(3, $all['filtered_total']);
        $this->assertSame(3, $all['counts']['total']);

        // Toto je celý nález: `counts` je zámerne nad CELOU tabuľkou, takže pri
        // filtri by „N z M" z neho bola lož. `filtered_total` je to M.
        $filtered = $this->getJson('/api/runs?model=qwen3:8b')->assertOk()->json();
        $this->assertCount(2, $filtered['items']);
        $this->assertSame(2, $filtered['filtered_total']);
        $this->assertSame(3, $filtered['counts']['total'], '`counts` sa filtrom zúžiť NESMIE.');

        // A počet po filtri nesmie závisieť od okna — inak by „ďalších N" sľuboval
        // presne toľko, koľko už vidím.
        $page = $this->getJson('/api/runs?model=qwen3:8b&limit=1')->assertOk()->json();
        $this->assertCount(1, $page['items']);
        $this->assertSame(2, $page['filtered_total']);
    }

    public function test_the_whole_filtered_set_is_sorted_on_the_server_not_the_loaded_window(): void
    {
        // Tri behy, ktorých poradie podľa ceny je iné než podľa času: keby radil
        // prehliadač nad oknom, „najdrahší beh" by znamenal „najdrahší z okna".
        $slow = $this->makeRun(['duration_ms' => 900_000, 'started_at' => now()->subDays(3)]);
        $mid = $this->makeRun(['duration_ms' => 5_000, 'started_at' => now()->subDay()]);
        $fast = $this->makeRun(['duration_ms' => 1_000, 'started_at' => now()]);

        $default = $this->getJson('/api/runs')->assertOk()->json();
        $this->assertSame('started_at', $default['sort']);
        $this->assertSame('desc', $default['dir']);
        $this->assertSame(
            [$fast->uuid, $mid->uuid, $slow->uuid],
            array_column($default['items'], 'uuid'),
            'Predvolené radenie sa nesmie zmeniť — obrazovka na ňom stojí.',
        );

        // Okno JEDNÉHO riadku a najdrahší beh je najstarší: nájsť sa dá len tak,
        // že sa radí nad celou filtrovanou množinou.
        $top = $this->getJson('/api/runs?sort=duration_ms&dir=desc&limit=1')->assertOk()->json();
        $this->assertSame([$slow->uuid], array_column($top['items'], 'uuid'));
        $this->assertSame('duration_ms', $top['sort']);
        $this->assertSame(3, $top['filtered_total']);

        // Kalibrácia z druhej strany: obrátený smer musí dať iný riadok, inak
        // by test prešiel aj vtedy, keby sa `dir` ignoroval.
        $bottom = $this->getJson('/api/runs?sort=duration_ms&dir=asc&limit=1')->assertOk()->json();
        $this->assertSame([$fast->uuid], array_column($bottom['items'], 'uuid'));
        $this->assertSame('asc', $bottom['dir']);
    }

    public function test_sorting_takes_a_whitelisted_column_and_nothing_else(): void
    {
        $this->makeRun();

        // Každý povolený kľúč musí naozaj prejsť dopytom — whitelist, ktorý menuje
        // stĺpec, čo v tabuľke nie je, by padol až u používateľa.
        foreach (array_keys(RunsScreen::SORTS) as $sort) {
            $this->getJson('/api/runs?sort='.$sort)->assertOk()->assertJsonPath('sort', $sort);
        }

        // `ORDER BY` sa neparametrizuje, takže hodnota od klienta sa doňho nesmie
        // dostať ani okliestená. Endpoint odmieta, nesanitizuje.
        foreach (['id', 'prompt', 'started_at; DROP TABLE runs', 'runs.id', '(SELECT 1)'] as $bad) {
            $this->getJson('/api/runs?sort='.urlencode($bad))->assertStatus(422);
        }

        $this->getJson('/api/runs?dir=sideways')->assertStatus(422);

        // Prázdny parameter je „neposlané", nie neplatná hodnota — `nullable`
        // to prepustí a radí sa predvolene. Odpovedať naň 422 by zhodilo klienta,
        // ktorý skládá query string bez vetvenia.
        $this->getJson('/api/runs?sort=&dir=')->assertOk()->assertJsonPath('sort', 'started_at');
    }

    public function test_the_mcp_plane_falls_back_to_the_default_sort_instead_of_erroring(): void
    {
        $slow = $this->makeRun(['duration_ms' => 900_000, 'started_at' => now()->subDays(3)]);
        $fast = $this->makeRun(['duration_ms' => 1_000, 'started_at' => now()]);

        // MCP tool posiela `$args` surové (žiadny validátor), takže serializér musí
        // sám ustáť čokoľvek. Výnimka by sa premenila na neurčité `isError`, z ktorého
        // sa model nedozvie, čo urobil zle — a whitelist drží aj tak.
        $data = (new RunsScreen(['sort' => 'prompt); DROP TABLE runs; --', 'dir' => 'čokoľvek']))->data();

        $this->assertSame('started_at', $data['sort']);
        $this->assertSame('desc', $data['dir']);
        $this->assertSame([$fast->uuid, $slow->uuid], array_column($data['items'], 'uuid'));

        // A platný kľúč z tej istej cesty funguje, takže fallback nie je „vypnuté radenie".
        $sorted = (new RunsScreen(['sort' => 'duration_ms', 'dir' => 'desc']))->data();
        $this->assertSame([$slow->uuid, $fast->uuid], array_column($sorted['items'], 'uuid'));
    }

    public function test_the_detail_leaves_the_system_directive_out_of_the_timeline(): void
    {
        $thread = ConsoleThread::create([]);
        $this->fakeTools([]);
        $this->fakeProvider([new LlmResponse(text: 'odpoveď')]);

        $this->frames($this->send($thread, 'otázka'));
        $run = Run::first();

        $body = $this->getJson('/api/runs/'.$run->uuid)->assertOk()->json();

        $kinds = array_column($body['timeline'], 'role');
        $this->assertNotContains('system', $kinds, 'Systémová smernica má ~2,6k tokenov a v osi behu prekryje všetko ostatné.');
        $this->assertContains('user', $kinds);
    }

    public function test_an_unknown_run_is_a_404_not_an_empty_detail(): void
    {
        $this->getJson('/api/runs/'.Str::uuid()->toString())->assertStatus(404);
    }

    public function test_rerun_returns_the_prompt_instead_of_starting_a_second_path_to_the_model(): void
    {
        $thread = ConsoleThread::create([]);
        $run = $this->makeRun(['prompt' => 'nájdi Docker', 'thread_id' => $thread->id, 'model' => 'qwen3:8b']);

        $body = $this->postJson('/api/runs/'.$run->uuid.'/rerun')->assertOk()->json();

        $this->assertSame('nájdi Docker', $body['prompt']);
        $this->assertSame($thread->uuid, $body['thread']);
        $this->assertSame(1, Run::count(), 'Rerun nesmie sám spustiť beh — ten ide bránou cez /console/run.');
    }

    public function test_the_ai_surface_is_the_same_source_with_fewer_keys(): void
    {
        $this->makeRun(['status' => 'done', 'model' => 'qwen3:8b', 'prompt' => 'nájdi Docker', 'tokens_out' => 42]);

        $human = (new RunsScreen([]))->data();
        $ai = (new RunsScreen([]))->forAi();

        // Rovnaké hodnoty, menej kľúčov — a ani jeden kľúč navyše.
        $this->assertSame($human['items'][0]['uuid'], $ai['items'][0]['uuid']);
        $this->assertSame($human['items'][0]['tokens_out'], $ai['items'][0]['tokens_out']);
        $this->assertEmpty(array_diff(array_keys($ai['items'][0]), array_keys($human['items'][0])));
        $this->assertArrayNotHasKey('thread_title', $ai['items'][0]);

        // Prázdne polia sa AI neposielajú — kánon z CLAUDE.md.
        $this->assertArrayNotHasKey('error', $ai['items'][0]);
    }

    public function test_the_day_key_groups_the_timeline_for_the_human_and_is_not_sent_to_the_ai(): void
    {
        $this->makeRun(['started_at' => '2026-08-19 23:40:00']);

        $human = (new RunsScreen([]))->data();
        $ai = (new RunsScreen([]))->forAi();

        // Hranicu dňa určuje časová zóna servera. Keby si ju počítal prehliadač
        // z `started_at`, dva behy tesne okolo polnoci by v UI a v odpovedi pre AI
        // spadli do iných dní.
        $this->assertSame('2026-08-19', $human['items'][0]['day']);

        // Zoskupenie je vizuálne — AI má `started_at` a `day` jej netreba.
        $this->assertArrayNotHasKey('day', $ai['items'][0]);
    }

    public function test_zero_survives_the_empty_field_pruning(): void
    {
        // Nula tool callov je informácia („beh nič nevolal"), nie prázdno.
        $pruned = ScreenSerializer::dropEmpty(['tool_calls' => 0, 'error' => null, 'name' => '']);

        $this->assertSame(['tool_calls' => 0], $pruned);
    }

    public function test_the_run_endpoints_sit_behind_the_same_guard_as_the_rest(): void
    {
        $routes = collect(app('router')->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/runs'));

        $this->assertCount(3, $routes, 'Log behov má tri routy.');

        $routes->each(function ($route): void {
            $middleware = $route->gatherMiddleware();
            $this->assertContains('auth.ui', $middleware, "Routa {$route->uri()} nie je za UI guardom.");
            $this->assertContains(ValidateCsrfToken::class, $middleware, "Routa {$route->uri()} nemá CSRF.");
        });
    }

    // ---- pomôcky -----------------------------------------------------------

    /** @param array<string, mixed> $attributes */
    private function makeRun(array $attributes = []): Run
    {
        return Run::create(array_merge([
            'source' => 'console',
            'status' => 'done',
            'prompt' => 'úloha',
            'provider' => 'ollama',
            'model' => 'fake:1',
            'started_at' => now(),
            'ended_at' => now(),
            'duration_ms' => 1000,
        ], $attributes));
    }

    /**
     * Zaparkovaný zápis: vlákno a id `pending` riadku, na ktorý sa rozhoduje.
     *
     * @return array{0: ConsoleThread, 1: int}
     */
    private function parkedWrite(array $afterDecision): array
    {
        $thread = ConsoleThread::create([]);
        $this->fakeTools([$this->fakeTool('edit_file', write: true)]);
        $this->fakeProvider(array_merge([
            new LlmResponse(
                toolCalls: [new LlmToolCall('c1', 'edit_file', ['path' => 'a.txt'])],
                stopReason: LlmResponse::STOP_TOOL_USE,
                tokensIn: 100,
                tokensOut: 10,
                evalDurationMs: 1000,
            ),
        ], $afterDecision));

        $frames = $this->frames($this->send($thread, 'Uprav a.txt'));
        $permission = collect($frames)->firstWhere('t', 'permission');

        $this->assertNotNull($permission, 'Zápisový tool sa nezaparkoval — test nemá čo merať.');

        return [$thread, (int) $permission['id']];
    }

    private function send(ConsoleThread $thread, string $message): TestResponse
    {
        return $this->postJson('/api/console/run', ['thread' => $thread->uuid, 'message' => $message]);
    }

    private function decide(ConsoleThread $thread, int $call, string $decision): TestResponse
    {
        return $this->postJson('/api/console/decide', [
            'thread' => $thread->uuid,
            'call' => $call,
            'decision' => $decision,
        ]);
    }

    /** @return list<array<string, mixed>> */
    private function frames(TestResponse $response): array
    {
        $lines = array_filter(explode("\n", $response->streamedContent()), fn ($l) => trim($l) !== '');

        return array_map(fn ($line) => json_decode($line, true), array_values($lines));
    }

    /** @param list<LlmResponse> $script */
    private function fakeProvider(array $script): LlmProvider
    {
        $fake = new class($script) implements LlmProvider
        {
            public function __construct(private array $script) {}

            public function name(): string
            {
                return OllamaProvider::NAME;
            }

            public function models(): array
            {
                return ['fake:1'];
            }

            public function available(): bool
            {
                return true;
            }

            public function chat(array $messages, array $options = []): LlmResponse
            {
                return $this->next(null);
            }

            public function stream(array $messages, array $options, callable $onDelta): LlmResponse
            {
                return $this->next($onDelta);
            }

            private function next(?callable $onDelta): LlmResponse
            {
                $step = array_shift($this->script) ?? new LlmResponse(text: 'Hotovo.');

                if ($onDelta !== null && $step->text !== '') {
                    $onDelta($step->text);
                }

                return $step;
            }
        };

        $this->app->instance(OllamaProvider::class, $fake);

        return $fake;
    }

    /** @param array<int, ConsoleTool> $tools */
    private function fakeTools(array $tools): void
    {
        $this->app->instance(ToolRegistry::class, new ToolRegistry(array_values($tools)));
    }

    private function fakeTool(string $name, bool $write): ConsoleTool
    {
        return new class($name, $write) implements ConsoleTool
        {
            public function __construct(private string $toolName, private bool $write) {}

            public function name(): string
            {
                return $this->toolName;
            }

            public function description(): string
            {
                return 'Fake tool pre test logu behov.';
            }

            public function schema(): array
            {
                return ['type' => 'object', 'properties' => ['path' => ['type' => 'string']], 'required' => ['path']];
            }

            public function isWrite(): bool
            {
                return $this->write;
            }

            public function preview(array $args): ?string
            {
                return $this->write ? 'diff' : null;
            }

            public function execute(array $args): ToolResult
            {
                return ToolResult::ok('zapísané');
            }
        };
    }
}
