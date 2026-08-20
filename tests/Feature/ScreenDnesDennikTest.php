<?php

namespace Tests\Feature;

use App\Models\Node;
use App\Serializers\Screen\DennikScreen;
use App\Serializers\Screen\DnesScreen;
use App\Support\ProjectGroup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Dvojitá plocha pre Dnes a Denník — obrazovka a AI z jedného serializéra.
 *
 * Sesterský {@see ScreenParityTest} stráži paritu obrazoviek, ktoré už MCP tool
 * majú. Tento test stráži to, čo sa dá zlomiť skôr: **kompatibilitu endpointu**
 * a **presunuté agregáty**. Obe veci sú tu preto, že vlna E nič nepridáva — ona
 * berie výpočty z prehliadača a dáva ich serveru, a taký presun má dva tiché
 * spôsoby, ako pokaziť appku:
 *
 *  1. stratí sa kľúč, ktorý frontend číta (obrazovka zostane prázdna, nič nespadne),
 *  2. presunutý výpočet dá iné číslo než ten, ktorý nahradil (obrazovka klame).
 *
 * Prvé chytá zoznam kľúčov, druhé nezávislý prepočet — zámerne napísaný inak než
 * implementácia (nad zoznamom uzlov v PHP, nie SQL agregátom), aby test nebol
 * kópiou toho, čo meria. Na tú pascu tento projekt už raz naletel: merač kreslenia
 * obaľoval `clearRect()`, ktorý render nepoužíva, a vracal vždy 0.
 */
class ScreenDnesDennikTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Kľúče, ktoré `dnes.js` a `dennik.js` čítajú z koreňa odpovede. Zoznam je
     * ručný a to je zámer: keby sa generoval z `data()`, prešlo by aj
     * premenovanie kľúča, ktorý frontend hľadá pod starým menom.
     */
    private const TODAY_KEYS = [
        'recent_sessions', 'week_added', 'top_projects', 'recent_records',
        'counts', 'certainty', 'per_area', 'growth', 'heatmap', 'sync',
        'brain_write_enabled',
    ];

    private const JOURNAL_KEYS = ['records', 'projects', 'project_groups', 'total'];

    // ---- 1. endpoint vracia to isté, čo predtým -----------------------------

    public function test_the_today_endpoint_keeps_every_key_the_screen_reads(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/today')->assertOk()->json();

        foreach (self::TODAY_KEYS as $key) {
            $this->assertArrayHasKey($key, $body, "/api/today stratilo kľúč `{$key}` — obrazovka Dnes ho číta.");
        }

        // Riadky si držia svoj pôvodný tvar; `project` zostáva SUROVÉ, lebo z neho
        // `prettyLabel()` odsekáva prefix v názve záznamu.
        $this->getJson('/api/today')->assertJsonStructure([
            'recent_sessions' => [['id', 'label', 'source', 'project', 'project_label', 'created_at']],
            'recent_records' => [['id', 'label', 'project', 'snippet', 'created_at']],
            'top_projects' => [['project', 'label', 'count']],
            'week_added' => ['nodes', 'sessions'],
        ]);
    }

    public function test_the_journal_endpoint_keeps_every_key_the_screen_reads(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/journal')->assertOk()->json();

        foreach (self::JOURNAL_KEYS as $key) {
            $this->assertArrayHasKey($key, $body, "/api/journal stratilo kľúč `{$key}`.");
        }

        $this->getJson('/api/journal')->assertJsonStructure([
            'records' => [[
                'id', 'source', 'label', 'description', 'project', 'created_at',
                'prompt_count', 'file_count', 'commits', 'files', 'tools', 'prompts',
            ]],
        ]);

        // Surová mapa „projekt → počet" je pôvodný tvar a ostáva mapou, nie zoznamom:
        // starší klient nad ňou robí lookup podľa názvu.
        $this->assertIsArray($body['projects']);
        $this->assertArrayHasKey('AI-mind', $body['projects']);
    }

    public function test_the_journal_endpoint_still_clips_an_oversized_limit_instead_of_refusing_it(): void
    {
        $this->seedJournal();

        // Do vlny E vracal endpoint na `?limit=999` päťdesiat záznamov. Odpovedať
        // naň 422 by bola zmena zmluvy, nie oprava.
        $this->getJson('/api/journal?limit=999')->assertOk()->assertJsonPath('limit', DennikScreen::MAX_LIMIT);
    }

    // ---- 2. presunuté agregáty sedia s nezávislým prepočtom -----------------

    public function test_the_week_counters_match_an_independent_recount(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/today')->assertOk()->json();

        $since = now()->subDays(7);
        $nodes = Node::all();

        $this->assertSame(
            $nodes->filter(fn (Node $n): bool => $n->created_at >= $since)->count(),
            $body['week_added']['nodes'],
        );
        $this->assertSame(
            $nodes->filter(fn (Node $n): bool => $n->created_at >= $since
                && in_array($n->source, ['session', 'digest'], true))->count(),
            $body['week_added']['sessions'],
        );
    }

    public function test_the_project_counts_come_from_the_whole_corpus_not_from_the_loaded_window(): void
    {
        // Viac záznamov než okno: presne tá situácia, v ktorej prehliadač počítal
        // čipy z 50 načítaných záznamov a hlásil iné číslo než server.
        $this->seedJournal();
        $this->seedRecords('Veľký projekt', DennikScreen::MAX_LIMIT + 7);

        $body = $this->getJson('/api/journal')->assertOk()->json();

        $this->assertCount(DennikScreen::MAX_LIMIT, $body['records'], 'okno má ostať okno');

        $groups = collect($body['project_groups'])->keyBy('key');

        $this->assertSame(
            DennikScreen::MAX_LIMIT + 7,
            $groups['Veľký projekt']['count'],
            'počet na čipe sa počíta z celého denníka, nie z okna',
        );

        // Nezávislý prepočet: zoskupenie v PHP nad všetkými uzlami denníka.
        $expected = Node::whereIn('source', ['session', 'digest'])->get()
            ->groupBy(fn (Node $n): string => ProjectGroup::key($n->meta['project'] ?? null))
            ->map->count();

        $this->assertSame($expected->count(), count($body['project_groups']));

        foreach ($body['project_groups'] as $group) {
            $this->assertSame($expected[$group['key']], $group['count'], "skupina {$group['key']}");
        }

        // Súčet skupín = celý denník. Keby sa niektorý záznam do skupiny nedostal,
        // čipy by dohromady tvrdili menej, než hlási `total`.
        $this->assertSame($body['total'], collect($body['project_groups'])->sum('count'));
    }

    public function test_the_group_order_is_the_servers_and_the_screen_only_draws_it(): void
    {
        $this->seedJournal();
        $this->seedRecords('Veľký projekt', 9);

        $groups = collect($this->getJson('/api/journal')->json('project_groups'));

        $this->assertSame(
            $groups->sortByDesc('count')->pluck('count')->values()->all(),
            $groups->pluck('count')->values()->all(),
            'skupiny prichádzajú zoradené podľa počtu — inak by zbalený rad čipov ukázal iných osem',
        );
    }

    public function test_the_session_list_is_capped_where_the_screen_draws_it(): void
    {
        $this->seedRecords('AI-mind', DnesScreen::RECENT_SESSIONS + 4);

        $body = $this->getJson('/api/today')->assertOk()->json();

        // Server posielal osem a obrazovka kreslila šesť, takže AI videla dve
        // session, ktoré na obrazovke neboli.
        $this->assertCount(DnesScreen::RECENT_SESSIONS, $body['recent_sessions']);
        $this->assertCount(DnesScreen::RECENT_RECORDS, $body['recent_records']);
    }

    public function test_an_unknown_sync_state_is_not_quietly_rendered_as_ok(): void
    {
        $body = $this->getJson('/api/today')->assertOk()->json();

        // Bez jedného behu synchronizácie: prehliadač z toho robil „ok", teda
        // „v poriadku" o niečom, čo sa nikdy nestalo.
        $this->assertSame('none', $body['sync']['state']);
        $this->assertNull($body['sync']['status'], 'surový stav zostáva taký, aký je v dátach');

        // A príznak zápisu do playbookov je jedno číslo, nie dve na výber.
        $this->assertSame($body['brain_write_enabled'], $body['sync']['brain_write_enabled']);
    }

    public function test_the_snippet_arrives_without_markdown(): void
    {
        $this->seedRecords('AI-mind', 1, "**Čo:** `mind_recall` vracia [uzly](http://x) a *nič* viac.\n\n# Nadpis");

        $snippet = $this->getJson('/api/today')->assertOk()->json('recent_records.0.snippet');

        $this->assertStringNotContainsString('**', $snippet);
        $this->assertStringNotContainsString('`', $snippet);
        $this->assertStringNotContainsString('#', $snippet);
        $this->assertStringContainsString('Čo: mind_recall vracia uzly', $snippet);
    }

    // ---- 3. skupina „bez projektu" a filter sú serverové -------------------

    public function test_the_no_project_group_is_made_by_the_server(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/journal')->assertOk()->json();
        $keys = collect($body['project_groups'])->pluck('key');

        // Tri strojové názvy adresárov a jeden prázdny projekt = JEDNA skupina.
        $this->assertTrue($keys->contains(ProjectGroup::NONE));
        $this->assertSame(
            4,
            collect($body['project_groups'])->firstWhere('key', ProjectGroup::NONE)['count'],
        );

        foreach ($keys as $key) {
            $this->assertFalse(
                ProjectGroup::isMachineName($key),
                "skupina `{$key}` je strojový názov adresára — človek by videl rad čipov s tým istým popiskom",
            );
        }

        // A záznam nesie kľúč svojej skupiny, takže si ho AI nemusí hádať z labelu.
        $machine = collect($body['records'])->firstWhere('project', 'mystifying-mclaren-23750a');
        $this->assertNotNull($machine);
        $this->assertSame(ProjectGroup::NONE, $machine['project_key']);
        $this->assertSame(ProjectGroup::NONE_LABEL, $machine['project_label']);
    }

    public function test_the_group_key_filters_on_the_server_so_the_chip_count_can_be_kept(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/journal?project='.urlencode(ProjectGroup::NONE))->assertOk()->json();

        $this->assertSame(ProjectGroup::NONE, $body['project']);
        $this->assertSame(4, $body['filtered_total'], 'filter musí dať presne to, čo sľubuje čip');
        $this->assertCount(4, $body['records']);
        $this->assertSame($this->journalTotal(), $body['total'], 'celkový počet sa filtrom nemení');

        foreach ($body['records'] as $record) {
            $this->assertSame(ProjectGroup::NONE, $record['project_key']);
        }

        // Skupiny zostávajú celé aj pri aktívnom filtri — inak by kliknutie na čip
        // zmazalo všetky ostatné čipy a filter by sa nedal prepnúť.
        $this->assertGreaterThan(1, count($body['project_groups']));
    }

    public function test_a_real_project_filter_still_matches_the_raw_value(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/journal?project=AI-mind')->assertOk()->json();

        $this->assertSame(2, $body['filtered_total']);

        foreach ($body['records'] as $record) {
            $this->assertSame('AI-mind', $record['project']);
        }
    }

    // ---- 4. kontrakt výberu pre AI ----------------------------------------

    public function test_the_ai_field_list_never_names_a_key_the_screen_does_not_have(): void
    {
        $this->seedJournal();

        foreach (['dnes' => new DnesScreen, 'dennik' => new DennikScreen] as $screen => $serializer) {
            $data = $serializer->data();

            foreach ($serializer->fieldsForAi() as $field) {
                [$root, $key] = array_pad(explode('[].', $field, 2), 2, null);

                $this->assertArrayHasKey(
                    $root,
                    $data,
                    "Obrazovka {$screen} menuje pre AI kľúč `{$field}`, ktorý `data()` nedáva.",
                );

                if ($key === null || ($data[$root] ?? []) === []) {
                    continue;
                }

                $this->assertArrayHasKey(
                    $key,
                    $data[$root][0],
                    "Obrazovka {$screen} menuje pre AI kľúč `{$field}`, ktorý riadok nemá.",
                );
            }
        }
    }

    public function test_what_the_ai_gets_is_a_subset_of_what_the_screen_gets(): void
    {
        $this->seedJournal();

        foreach ([new DnesScreen, new DennikScreen] as $serializer) {
            $this->assertSubset($serializer->forAi(), $serializer->data(), $serializer::class);
        }
    }

    public function test_the_ai_shape_leaves_out_what_is_only_for_the_eye(): void
    {
        $this->seedJournal();

        $ai = (new DnesScreen)->forAi();

        // 365 buniek heatmapy je najdrahšia časť odpovede a nesie dojem z mriežky,
        // nie fakt — do plochy pre AI nepatrí. Kánon: odpoveď je pre AI, nie pre oko.
        $this->assertArrayNotHasKey('heatmap', $ai);
        $this->assertArrayHasKey('counts', $ai);

        $journal = (new DennikScreen)->forAi();

        // Celý markdownový popis, zoznam súborov, promptov a nástrojov by z jednej
        // odpovede urobil kontextový strop. Chronológiu nesú label, dátum a počty.
        foreach ($journal['records'] as $row) {
            foreach (['description', 'files', 'prompts', 'tools', 'commits'] as $heavy) {
                $this->assertArrayNotHasKey($heavy, $row);
            }
            $this->assertArrayHasKey('label', $row);
            $this->assertArrayHasKey('created_at', $row);
        }
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Každý kľúč, ktorý dostane AI, musí mať v ploche človeka identickú hodnotu.
     * Opačný smer sa nekontroluje: plocha človeka smie mať navyše (heatmapa,
     * `project_label`) — to je celý zmysel `fieldsForAi()`.
     *
     * @param  array<string, mixed>  $ai
     * @param  array<string, mixed>  $human
     */
    private function assertSubset(array $ai, array $human, string $screen, string $path = ''): void
    {
        foreach ($ai as $key => $value) {
            $here = $path === '' ? (string) $key : "{$path}.{$key}";

            $this->assertArrayHasKey($key, $human, "{$screen} dáva AI `{$here}`, ktoré obrazovka nemá.");

            if (is_array($value) && is_array($human[$key])) {
                $this->assertSubset($value, $human[$key], $screen, $here);

                continue;
            }

            $this->assertSame($human[$key], $value, "{$screen} sa rozišlo na `{$here}`.");
        }
    }

    private function journalTotal(): int
    {
        return Node::whereIn('source', ['session', 'digest'])->count();
    }

    /**
     * Denník tak, ako vyzerá naživo: dva reálne projekty, tri strojové názvy
     * dočasných adresárov, jeden záznam bez projektu a jeden týždenný súhrn.
     */
    private function seedJournal(): void
    {
        $this->record('AI-mind', 'AI-mind — práca 18.8.2026', 'session', ['a1b2c3']);
        $this->record('AI-mind', 'AI-mind — práca 19.8.2026', 'session');
        $this->record('sperky-ai', 'sperky-ai — práca 19.8.2026', 'session');
        $this->record('mystifying-mclaren-23750a', 'mystifying-mclaren-23750a — práca 13.8.2026', 'session');
        $this->record('charming-chaum-da6141', 'charming-chaum-da6141 — práca 12.8.2026', 'session');
        $this->record('frosty-gould-9c581a', 'frosty-gould-9c581a — práca 11.8.2026', 'session');
        $this->record(null, 'Týždenný súhrn', 'digest');

        // Uzol, ktorý do denníka nepatrí — stráži, že sa množina zdrojov nerozšírila.
        Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'source' => 'brain', 'strength' => 1]);
    }

    private function seedRecords(string $project, int $count, ?string $description = null): void
    {
        for ($i = 0; $i < $count; $i++) {
            $this->record($project, "{$project} — práca #{$i}", 'session', [], $description);
        }
    }

    /**
     * @param  list<string>  $commits
     */
    private function record(
        ?string $project,
        string $label,
        string $source,
        array $commits = [],
        ?string $description = null,
    ): Node {
        return Node::create([
            'type' => 'memory',
            'source' => $source,
            'label' => $label,
            'description' => $description,
            'strength' => 1,
            'meta' => [
                'project' => $project,
                'prompt_count' => 3,
                'file_count' => 2,
                'commits' => $commits,
                'files' => ['app/Foo.php'],
                'tools' => ['Edit'],
                'prompts' => ['sprav to'],
                'final' => 'Hotovo.',
            ],
        ]);
    }
}
