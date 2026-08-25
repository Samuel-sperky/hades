<?php

namespace Tests\Feature;

use App\Models\ConsoleBranch;
use App\Models\ConsoleMessage;
use App\Models\ConsoleProject;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Serializers\Screen\ChatScreen;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Hľadanie v histórii chatu a export vlákna — {@see ChatScreen}
 * a {@see \App\Http\Controllers\Console\SearchController}.
 *
 * **Táto sada beží na sqlite AJ na MariaDB a to je jej podmienka, nie vlastnosť.**
 * Keby hľadanie stálo na FULLTEXT alebo na `COLLATE utf8mb4_unicode_ci`, obrazovka
 * by potrebovala `requires_mariadb` a v defaultnej konfigurácii (`phpunit.xml`,
 * sqlite `:memory:`) by sa preskočila — teda vyzerala zelená a nemerala nič.
 * Presne to sa v tomto projekte stalo 45 testom recallu vrátane celého
 * `HybridRecallTest`. Ak niekedy v budúcnosti niektorý z týchto testov na sqlite
 * SKIPNE, nie je to vlastnosť databázy, ale regresia dopytu.
 *
 * Čo sa tu stráži:
 *
 *  1. Hľadanie nájde správu naprieč vláknami a vráti **útržok, nie celú správu**.
 *  2. **Systémová smernica nie je ani v hľadaní, ani v exporte** — je to
 *     konfigurácia behu, nie konverzácia, a v hľadaní by dala zásah v každom vlákne.
 *  3. Počty idú nad **celým** zásahom, nie nad stránkou (nález auditu na Denníku).
 *  4. Zástupné znaky od človeka (`%`, `_`) sú hľadaný text, nie vzor.
 *  5. Export drží **reťaz vetvy** a prílohy uvádza **menom, nikdy obsahom**.
 */
class ChatSearchExportTest extends TestCase
{
    use RefreshDatabase;

    // ---- hľadanie ----------------------------------------------------------

    public function test_it_finds_messages_across_threads_and_returns_a_snippet_not_the_whole_message(): void
    {
        $filler = str_repeat('lorem ipsum ', 60);

        $first = $this->thread('Vetvenie konverzácie');
        $this->msg($first, 'user', 'Ako funguje vetvenie vlákna?');

        $second = $this->thread('Niečo iné');
        $this->msg($second, 'assistant', $filler.'vetvenie je riadok v console_branches. '.$filler);

        $data = (new ChatScreen(['q' => 'vetvenie']))->data();

        $this->assertSame('vetvenie', $data['query']);
        $this->assertSame(2, $data['counts']['total'], 'Zásah je v dvoch vláknach, nie v jednom.');
        $this->assertSame(2, $data['counts']['threads']);
        $this->assertCount(2, $data['items']);

        $long = collect($data['items'])->firstWhere('role', 'assistant');
        $this->assertNotNull($long);
        $this->assertStringContainsString('vetvenie je riadok', $long['snippet']);
        $this->assertStringStartsWith('…', $long['snippet'], 'Útržok má mať kontext pred zásahom.');
        $this->assertStringEndsWith('…', $long['snippet'], 'Útržok má byť skrátený, nie celá správa.');
        $this->assertLessThan(
            mb_strlen($filler),
            mb_strlen($long['snippet']),
            'Útržok nesmie byť celá správa — krátenie je na serveri, nie v prehliadači.',
        );

        // Skupiny sú dáta: bez nich by si ich prehliadač počítal z načítanej stránky.
        $this->assertCount(2, $data['threads']);
        $this->assertSame(1, $data['threads'][0]['matches']);
    }

    public function test_the_system_directive_is_never_searchable(): void
    {
        $thread = $this->thread('S smernicou');
        $this->msg($thread, 'system', 'Si Charón, prievozník. Tvoje nástroje sú tajomstvo.');
        $this->msg($thread, 'user', 'ahoj');

        $data = (new ChatScreen(['q' => 'prievozník']))->data();

        $this->assertSame(0, $data['counts']['total'], 'Systémová smernica nie je krok konverzácie.');
        $this->assertSame([], $data['items']);
    }

    public function test_the_counts_cover_the_whole_hit_not_just_the_page(): void
    {
        $thread = $this->thread('Veľa zásahov');

        for ($i = 0; $i < 5; $i++) {
            $this->msg($thread, 'user', "vetvenie číslo {$i}");
        }

        $data = (new ChatScreen(['q' => 'vetvenie', 'limit' => 2]))->data();

        $this->assertCount(2, $data['items'], 'Stránka je zastropovaná.');
        $this->assertSame(2, $data['counts']['shown']);
        $this->assertSame(5, $data['counts']['total'], 'Počet musí byť nad celým zásahom.');
        $this->assertSame(1, $data['counts']['threads']);
    }

    public function test_it_counts_every_occurrence_inside_one_message(): void
    {
        $thread = $this->thread('Trikrát');
        $this->msg($thread, 'user', 'vetvenie a Vetvenie a znova VETVENIE');

        $data = (new ChatScreen(['q' => 'vetvenie']))->data();

        $this->assertSame(1, $data['counts']['total'], 'Jedna správa je jeden zásah.');
        $this->assertSame(3, $data['items'][0]['matches'], 'Výskyty v správe sú dáta, nie dopočet v UI.');
    }

    public function test_it_filters_by_thread_project_role_and_date_range(): void
    {
        $project = ConsoleProject::create(['name' => 'Hades']);

        $inProject = $this->thread('V projekte');
        $inProject->project_id = $project->id;
        $inProject->save();
        $this->msg($inProject, 'user', 'vetvenie v projekte');

        $loose = $this->thread('Bez projektu');
        $this->msg($loose, 'assistant', 'vetvenie mimo projektu');

        $old = $this->msg($loose, 'user', 'vetvenie z augusta');
        $old->created_at = Carbon::parse('2026-08-01 10:00');
        $old->save();

        $all = (new ChatScreen(['q' => 'vetvenie']))->data();
        $this->assertSame(3, $all['counts']['total']);

        $byThread = (new ChatScreen(['q' => 'vetvenie', 'thread' => $inProject->uuid]))->data();
        $this->assertSame(1, $byThread['counts']['total']);

        $byProject = (new ChatScreen(['q' => 'vetvenie', 'project' => $project->uuid]))->data();
        $this->assertSame(1, $byProject['counts']['total']);
        $this->assertSame('Hades', $byProject['items'][0]['project_name']);
        $this->assertSame([['project' => $project->uuid, 'name' => 'Hades', 'threads' => 1, 'matches' => 1]], $byProject['projects']);

        $byRole = (new ChatScreen(['q' => 'vetvenie', 'role' => 'assistant']))->data();
        $this->assertSame(1, $byRole['counts']['total']);

        // `to` bez času znamená CELÝ deň — inak by dátum vyhodil práve ten deň,
        // ktorý si človek vybral.
        $untilAugustFirst = (new ChatScreen(['q' => 'vetvenie', 'to' => '2026-08-01']))->data();
        $this->assertSame(1, $untilAugustFirst['counts']['total']);
        $this->assertSame('vetvenie z augusta', $untilAugustFirst['items'][0]['snippet']);

        $sinceAugustTenth = (new ChatScreen(['q' => 'vetvenie', 'from' => '2026-08-10']))->data();
        $this->assertSame(2, $sinceAugustTenth['counts']['total']);

        // Nezmyselný dátum je „žiadny filter", nie výnimka: MCP tool posiela
        // argumenty tak, ako ich napísal model.
        $nonsense = (new ChatScreen(['q' => 'vetvenie', 'from' => 'vcera', 'to' => ['pole']]))->data();
        $this->assertSame(3, $nonsense['counts']['total']);
    }

    public function test_wildcards_from_the_human_are_text_not_a_pattern(): void
    {
        $thread = $this->thread('Percentá');
        $this->msg($thread, 'user', 'pokrytie je 100% a to stačí');
        $this->msg($thread, 'assistant', 'bez percenta');

        $this->assertSame(1, (new ChatScreen(['q' => '100%']))->data()['counts']['total']);
        $this->assertSame(0, (new ChatScreen(['q' => '%%%']))->data()['counts']['total'], '`%` je hľadaný znak, nie „všetko".');
        $this->assertSame(0, (new ChatScreen(['q' => 'be_ percenta']))->data()['counts']['total'], '`_` nie je ľubovoľný znak.');
        // Escape znak sám musí byť escapovaný, inak by sa z dopytu zjedol.
        $this->assertSame(0, (new ChatScreen(['q' => '!100']))->data()['counts']['total']);
    }

    public function test_it_is_case_insensitive_for_ascii_on_both_databases(): void
    {
        $thread = $this->thread('Veľké písmená');
        $this->msg($thread, 'user', 'PathGuard cesty ODMIETA');

        $this->assertSame(1, (new ChatScreen(['q' => 'pathguard']))->data()['counts']['total']);
        $this->assertSame(1, (new ChatScreen(['q' => 'ODMIETA']))->data()['counts']['total']);
    }

    public function test_it_finds_messages_in_an_abandoned_branch(): void
    {
        $thread = $this->thread('Vetvené vlákno');
        $root = ConsoleBranch::create(['thread_id' => $thread->id, 'parent_branch_id' => null, 'forked_from_message_id' => null]);
        $thread->active_branch_id = $root->id;
        $thread->save();

        $keep = $this->msg($thread, 'user', 'toto zostáva', $root);
        $abandoned = $this->msg($thread, 'assistant', 'toto sa odsunulo do bočnej vetvy', $root);

        $side = ConsoleBranch::forkBefore($abandoned);
        $thread->active_branch_id = $side->id;
        $thread->save();
        $this->msg($thread, 'assistant', 'nová odpoveď', $side);

        // Hľadanie zámerne prehľadáva aj opustené vetvy: história, ktorá sa
        // editáciou odsunula, sa nestala nenapísanou.
        $data = (new ChatScreen(['q' => 'odsunulo']))->data();

        $this->assertSame(1, $data['counts']['total']);
        $this->assertSame($root->uuid, $data['items'][0]['branch'], 'Riadok musí povedať, v ktorej vetve zásah leží.');
        $this->assertSame($keep->branch_id, $root->id);
    }

    public function test_a_short_query_returns_nothing_instead_of_everything(): void
    {
        $thread = $this->thread('Čokoľvek');
        $this->msg($thread, 'user', 'a b c');

        $data = (new ChatScreen(['q' => 'a']))->data();

        $this->assertSame([], $data['items'], 'Jednoznakový dopyt by vrátil celú históriu appky.');
        $this->assertSame(0, $data['counts']['total']);
    }

    // ---- endpoint hľadania -------------------------------------------------

    public function test_the_endpoint_answers_with_the_serializer_shape(): void
    {
        $thread = $this->thread('Cez endpoint');
        $this->msg($thread, 'user', 'vetvenie cez endpoint');

        $body = $this->getJson('/api/console/search?q=vetvenie')->assertOk()->json();

        $this->assertSame((new ChatScreen(['q' => 'vetvenie']))->data(), $body);
    }

    public function test_the_endpoint_refuses_a_query_that_is_too_short(): void
    {
        $this->getJson('/api/console/search?q=a')->assertStatus(422);
        $this->getJson('/api/console/search')->assertStatus(422);
        $this->getJson('/api/console/search?q=vetvenie&role=vymyslena')->assertStatus(422);
        $this->getJson('/api/console/search?q=vetvenie&limit=9999')->assertStatus(422);
    }

    public function test_the_ai_surface_is_a_subset_of_the_human_one_without_empty_fields(): void
    {
        $thread = $this->thread('Dvojitá plocha');
        $this->msg($thread, 'user', 'vetvenie pre AI');

        $screen = new ChatScreen(['q' => 'vetvenie']);
        $human = $screen->data();
        $ai = $screen->forAi();

        foreach (array_keys($ai) as $key) {
            $this->assertArrayHasKey($key, $human, "Plocha AI má kľúč {$key}, ktorý človek nevidí.");
        }

        $this->assertArrayNotHasKey('limit', $ai, 'Strop stránky je vec UI, nie odpovede pre AI.');
        $this->assertArrayNotHasKey('day', $ai['items'][0], 'Kľúč dňa je na zoskupenie v UI.');
        $this->assertSame('vetvenie pre AI', $ai['items'][0]['snippet']);
        $this->assertNoEmptyValues($ai);
    }

    // ---- export ------------------------------------------------------------

    public function test_the_export_carries_both_speakers_and_omits_the_system_directive(): void
    {
        $thread = $this->thread('Export vlákna');
        $thread->provider = 'ollama';
        $thread->model = 'qwen3:8b';
        $thread->save();

        $this->msg($thread, 'system', 'Si Charón, prievozník. Toto je smernica.');
        $this->msg($thread, 'user', 'Ako sa exportuje vlákno?');
        $this->msg($thread, 'assistant', 'Serverom, aby obe plochy dostali to isté.');

        $md = ChatScreen::markdown($thread);

        $this->assertStringContainsString('# Export vlákna', $md);
        $this->assertStringContainsString('- Vlákno: `'.$thread->uuid.'`', $md);
        $this->assertStringContainsString('- Model: ollama / qwen3:8b', $md);
        $this->assertStringContainsString('- Správ: 2', $md);
        $this->assertStringContainsString('## Ty · ', $md);
        $this->assertStringContainsString('## Charón · ', $md);
        $this->assertStringContainsString('Ako sa exportuje vlákno?', $md);
        $this->assertStringNotContainsString('smernica', $md, 'Systémová smernica do exportu nepatrí.');
        $this->assertStringEndsWith("\n", $md);

        // Poradie je konverzačné, nie abecedné ani podľa role.
        $this->assertLessThan(mb_strpos($md, '## Charón'), mb_strpos($md, '## Ty'));
    }

    public function test_the_export_names_attachments_and_never_their_content(): void
    {
        $thread = $this->thread('S prílohou');
        $message = $this->msg($thread, 'user', 'Tu je zápis z porady.');

        $this->attachment($thread, $message, 'zapis-porady.pdf', 'application/pdf', 2_150_400, 'TAJNÝ OBSAH PDF');
        // Rozpracovaná príloha (`message_id` je null) — súbor vo vstupe, správa
        // neodoslaná. Do exportu konverzácie nepatrí.
        $this->attachment($thread, null, 'rozpracovane.png', 'image/png', 512, null);

        $md = ChatScreen::markdown($thread);

        $this->assertStringContainsString('**Prílohy:**', $md);
        $this->assertStringContainsString('`zapis-porady.pdf` — application/pdf, 2,1 MB', $md);
        $this->assertStringNotContainsString('TAJNÝ OBSAH PDF', $md, 'Príloha sa uvádza menom, nie obsahom.');
        $this->assertStringNotContainsString('rozpracovane.png', $md);
    }

    public function test_the_export_records_tool_calls_by_name_and_verdict_not_by_result(): void
    {
        $thread = $this->thread('S nástrojom');
        $message = $this->msg($thread, 'assistant', 'Zapíšem si to.');

        ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'message_id' => $message->id,
            'name' => 'mind_learn',
            'arguments' => ['label' => 'Vetvenie'],
            'status' => 'denied',
            'result' => 'CELÝ VÝSLEDOK NÁSTROJA',
        ]);

        $md = ChatScreen::markdown($thread);

        $this->assertStringContainsString('**Nástroj** `mind_learn` — zamietnuté', $md);
        $this->assertStringContainsString('"label"', $md);
        $this->assertStringNotContainsString('CELÝ VÝSLEDOK NÁSTROJA', $md, 'Export konverzácie nie je log behu.');
    }

    public function test_the_export_follows_the_chain_of_the_branch(): void
    {
        $thread = $this->thread('Vetvený export');
        $root = ConsoleBranch::create(['thread_id' => $thread->id, 'parent_branch_id' => null, 'forked_from_message_id' => null]);
        $thread->active_branch_id = $root->id;
        $thread->save();

        $this->msg($thread, 'user', 'dedený prefix');
        $abandoned = $this->msg($thread, 'assistant', 'opustená odpoveď', $root);

        $side = ConsoleBranch::forkBefore($abandoned);
        $thread->active_branch_id = $side->id;
        $thread->save();
        $this->msg($thread, 'assistant', 'nová odpoveď', $side);

        $active = ChatScreen::markdown($thread->fresh());

        $this->assertStringContainsString('dedený prefix', $active, 'Dedený prefix je časť aktívnej vetvy.');
        $this->assertStringContainsString('nová odpoveď', $active);
        $this->assertStringNotContainsString('opustená odpoveď', $active, 'Opustená vetva do exportu aktívnej nepatrí.');
        $this->assertStringContainsString('- Vetva: `'.$side->uuid.'`', $active);

        // Pôvodná vetva zostáva exportovateľná — „pôvodná zostáva" je požiadavka
        // kontraktu, nie vedľajší efekt.
        $original = ChatScreen::markdown($thread->fresh(), $root);
        $this->assertStringContainsString('opustená odpoveď', $original);
        $this->assertStringNotContainsString('nová odpoveď', $original);
    }

    public function test_the_export_endpoint_serves_markdown_as_a_file(): void
    {
        $thread = $this->thread('Vlákno na stiahnutie');
        $this->msg($thread, 'user', 'stiahni ma');

        $response = $this->get('/api/console/threads/'.$thread->uuid.'/export')->assertOk();

        $this->assertSame('text/markdown; charset=utf-8', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('.md"', (string) $response->headers->get('Content-Disposition'));
        // Slug v mene súboru: bez diakritiky a bez znakov, ktoré by hlavičku zlomili.
        $this->assertStringContainsString('vlakno-na-stiahnutie-', (string) $response->headers->get('Content-Disposition'));
        $this->assertSame(ChatScreen::markdown($thread->fresh()), $response->getContent());
    }

    public function test_the_export_of_a_branch_from_another_thread_is_a_404(): void
    {
        $mine = $this->thread('Moje vlákno');
        $this->msg($mine, 'user', 'moja správa');

        $foreign = $this->thread('Cudzie vlákno');
        $foreignBranch = ConsoleBranch::create(['thread_id' => $foreign->id, 'parent_branch_id' => null, 'forked_from_message_id' => null]);

        $this->get('/api/console/threads/'.$mine->uuid.'/export?branch='.$foreignBranch->uuid)->assertStatus(404);
        $this->get('/api/console/threads/'.$mine->uuid.'/export?branch=nie-uuid')->assertStatus(422);
    }

    // ---- pomôcky -----------------------------------------------------------

    private function thread(string $title): ConsoleThread
    {
        return ConsoleThread::create(['title' => $title]);
    }

    private function msg(ConsoleThread $thread, string $role, string $content, ?ConsoleBranch $branch = null): ConsoleMessage
    {
        return ConsoleMessage::create([
            'thread_id' => $thread->id,
            'branch_id' => $branch?->id ?? $thread->active_branch_id,
            'role' => $role,
            'content' => $content,
        ]);
    }

    /** Riadok prílohy. Cez `DB::table`, rovnako ako ho čítá export. */
    private function attachment(
        ConsoleThread $thread,
        ?ConsoleMessage $message,
        string $name,
        string $mime,
        int $size,
        ?string $text,
    ): void {
        DB::table('console_attachments')->insert([
            'uuid' => (string) Str::uuid(),
            'thread_id' => $thread->id,
            'message_id' => $message?->id,
            'original_name' => $name,
            'path' => $thread->uuid.'/'.Str::uuid().'.bin',
            'mime' => $mime,
            'size_bytes' => $size,
            'text_content' => $text,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Plocha AI nesmie obsahovať `null`, prázdny string ani prázdne pole — `null`
     * je 20 B za nulovú informáciu na každom riadku a význam vynechania patrí do
     * popisu nástroja. `false` a `0` sú naopak informácia a ostávajú.
     *
     * @param  array<array-key, mixed>  $data
     */
    private function assertNoEmptyValues(array $data, string $path = ''): void
    {
        foreach ($data as $key => $value) {
            $here = $path === '' ? (string) $key : $path.'.'.$key;

            if (is_array($value)) {
                $this->assertNotSame([], $value, "Plocha AI posiela prázdne pole na {$here}.");
                $this->assertNoEmptyValues($value, $here);

                continue;
            }

            $this->assertNotNull($value, "Plocha AI posiela null na {$here}.");
            $this->assertNotSame('', $value, "Plocha AI posiela prázdny string na {$here}.");
        }
    }
}
