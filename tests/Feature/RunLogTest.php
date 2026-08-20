<?php

namespace Tests\Feature;

use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\Run;
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
        $stale->started_at = now()->subHours(2);
        $stale->save();

        $this->assertSame(1, $recorder->reapStale());

        $this->assertSame('aborted', $stale->fresh()->status);
        $this->assertSame('running', $fresh->fresh()->status, 'Rozbehnutý beh sa nesmie zabiť.');
    }

    public function test_the_reap_command_shows_before_it_touches(): void
    {
        $thread = ConsoleThread::create([]);
        $stale = app(RunRecorder::class)->open($thread, 'visí od reštartu');
        $stale->started_at = now()->subHours(2);
        $stale->save();

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
        $parked->started_at = now()->subDays(2);
        $parked->save();

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
        $this->getJson('/api/runs/'.\Illuminate\Support\Str::uuid()->toString())->assertStatus(404);
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

        $human = (new \App\Serializers\Screen\RunsScreen([]))->data();
        $ai = (new \App\Serializers\Screen\RunsScreen([]))->forAi();

        // Rovnaké hodnoty, menej kľúčov — a ani jeden kľúč navyše.
        $this->assertSame($human['items'][0]['uuid'], $ai['items'][0]['uuid']);
        $this->assertSame($human['items'][0]['tokens_out'], $ai['items'][0]['tokens_out']);
        $this->assertEmpty(array_diff(array_keys($ai['items'][0]), array_keys($human['items'][0])));
        $this->assertArrayNotHasKey('thread_title', $ai['items'][0]);

        // Prázdne polia sa AI neposielajú — kánon z CLAUDE.md.
        $this->assertArrayNotHasKey('error', $ai['items'][0]);
    }

    public function test_zero_survives_the_empty_field_pruning(): void
    {
        // Nula tool callov je informácia („beh nič nevolal"), nie prázdno.
        $pruned = \App\Serializers\ScreenSerializer::dropEmpty(['tool_calls' => 0, 'error' => null, 'name' => '']);

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
