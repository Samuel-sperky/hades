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

        // Presne tie kľúče, ktoré `dennik.js` naozaj čerpá (`id`, `source`, `label`,
        // `project`, `project_label`, `created_at`, `file_count`, `commit_count`)
        // plus `project_key` a počty, ktoré menuje `fieldsForAi()`.
        //
        // Do 1. 9. 2026 tento zoznam pýtal aj `commits`, `files`, `tools`
        // a `prompts` — teda štyri polia, ktoré obrazovka NEČÍTA, hoci sa test
        // menuje „keeps every key the screen reads". Niesli 104 kB zo 151 kB
        // odpovede a pin ich držal pri živote. Telo záznamu patrí do detailu
        // (`openNodeDetail(r.id)`), zoznam nesie počty — viď {@see DennikScreen}.
        $this->getJson('/api/journal')->assertJsonStructure([
            'records' => [[
                'id', 'source', 'label', 'description', 'project', 'project_key',
                'project_label', 'created_at', 'prompt_count', 'file_count',
                'commit_count', 'tool_count',
            ]],
        ]);

        // A druhá strana toho istého tvrdenia: telá sú preč a majú byť preč.
        // Bez tejto polovice by sa dali ticho vrátiť a test by zostal zelený.
        foreach ($body['records'] as $row) {
            foreach (['commits', 'files', 'tools', 'prompts', 'final'] as $heavy) {
                $this->assertArrayNotHasKey(
                    $heavy,
                    $row,
                    "`{$heavy}` je telo záznamu — v zozname ho nečíta žiadna plocha.",
                );
            }
        }

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

    // ---- 1b. cesta k záznamom za oknom -------------------------------------

    public function test_the_journal_walks_past_its_window_without_losing_or_repeating_a_record(): void
    {
        $this->seedJournal();   // 7 záznamov denníka

        $all = [];
        $pages = [];

        foreach ([0, 3, 6] as $offset) {
            $body = $this->getJson("/api/journal?offset={$offset}&limit=3")->assertOk()->json();

            $this->assertSame($offset, $body['offset']);
            $this->assertSame(7, $body['filtered_total'], 'Počet po filtri sa nesmie meniť podľa okna.');

            $ids = array_column($body['records'], 'id');
            $pages[$offset] = $ids;
            $all = [...$all, ...$ids];
        }

        // Do 1. 9. 2026 endpoint vrátil prvé okno a k zvyšku nevedla cesta:
        // `total: 153` proti 50 poslaným záznamom.
        $this->assertSame([3, 3, 1], array_map('count', array_values($pages)));

        // Bez druhého kľúča radenia (`id`) by tá istá sekunda dala riadku v dvoch
        // oknách iné miesto — raz duplikát, raz vynechaný záznam. Toto to meria.
        $this->assertCount(7, $all);
        $this->assertCount(7, array_unique($all), 'Okná sa prekrývajú — chýba rozlíšenie rovnosti.');

        $whole = array_column(
            $this->getJson('/api/journal')->assertOk()->json('records'),
            'id',
        );
        $this->assertSame($whole, $all, 'Rozdelené okná nedávajú to isté poradie ako jedno veľké.');
    }

    public function test_two_records_of_the_same_second_have_a_fixed_order(): void
    {
        // Bez druhého kľúča radenia je poradie riadkov s rovnakým `created_at`
        // vecou plánu dopytu, teda medzi dvoma oknami iné — hraničný záznam by sa
        // raz zdvojil a raz vypadol. Toto meria, že rozlíšenie existuje: bez
        // `orderByDesc('id')` vráti sqlite riadky v poradí rowid, teda opačne.
        $moment = now()->subDay();

        foreach (['prvý', 'druhý', 'tretí'] as $label) {
            $this->record('AI-mind', "AI-mind — {$label}", 'session')
                ->forceFill(['created_at' => $moment])->save();
        }

        $ids = array_column($this->getJson('/api/journal')->assertOk()->json('records'), 'id');
        $sorted = $ids;
        rsort($sorted);

        $this->assertSame($sorted, $ids, 'Rovnaká sekunda musí mať pevné poradie (id zostupne).');
    }

    public function test_an_offset_past_the_end_is_an_empty_page_with_an_honest_total(): void
    {
        $this->seedJournal();

        $body = $this->getJson('/api/journal?offset=500')->assertOk()->json();

        // Prázdna stránka, nie 422 a nie „total: 0". Klient musí vidieť, že
        // záznamy existujú, len ich toto okno nezachytilo.
        $this->assertSame([], $body['records']);
        $this->assertSame(7, $body['filtered_total']);
        $this->assertSame(7, $body['total']);

        // Záporný offset sa zviera, nie odmieta — rovnaká zmluva ako `limit`.
        $this->getJson('/api/journal?offset=-5')->assertOk()->assertJsonPath('offset', 0);
    }

    public function test_the_search_reads_the_whole_journal_and_not_the_loaded_window(): void
    {
        $this->seedJournal();
        // Zámerne NAJSTARŠÍ záznam: v okne `limit=1` (najnovšie prvé) nie je,
        // takže klientske hľadanie nad načítanými riadkami by ho nenašlo.
        $needle = $this->record('AI-mind', 'AI-mind — vlákno o cenotvorbe', 'session');
        $needle->forceFill(['created_at' => now()->subYear()])->save();

        $body = $this->getJson('/api/journal?q=cenotvorbe&limit=1')->assertOk()->json();

        $this->assertSame('cenotvorbe', $body['q']);
        $this->assertSame(1, $body['filtered_total'], 'Počet po filtri musí byť po filtri.');
        $this->assertSame(8, $body['total'], 'Celkový počet sa filtrom nemení.');
        $this->assertSame([$needle->id], array_column($body['records'], 'id'));

        // Kalibrácia z druhej strany: bez `q` v tom istom okne ten záznam NIE JE,
        // takže test naozaj meria serverové hľadanie a nie zhodu náhodou.
        $this->assertNotContains(
            $needle->id,
            array_column($this->getJson('/api/journal?limit=1')->json('records'), 'id'),
        );

        // A hľadanie hľadá aj v popise, nie len v labeli.
        $described = $this->record('AI-mind', 'AI-mind — práca 20.8.2026', 'session', [], 'Zmerané pásmo hrán.');
        $this->assertSame(
            [$described->id],
            array_column($this->getJson('/api/journal?q=pásmo')->json('records'), 'id'),
        );
    }

    public function test_the_project_filter_and_the_search_narrow_the_same_total(): void
    {
        $this->seedJournal();

        // Dva filtre naraz: keby sa `filtered_total` počítal pred jedným z nich,
        // „ďalších N" by sľuboval riadky, ktoré zoznam nikdy nedá.
        $body = $this->getJson('/api/journal?project=AI-mind&q=19.8')->assertOk()->json();

        $this->assertSame(1, $body['filtered_total']);
        $this->assertCount(1, $body['records']);
        $this->assertSame(7, $body['total']);

        // Ten istý projekt bez `q` má dva záznamy — teda `q` naozaj zúžilo počet,
        // nie iba zoznam.
        $this->assertSame(2, $this->getJson('/api/journal?project=AI-mind')->json('filtered_total'));
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

    /**
     * Regresia na spojenie, na ktorom appka BEŽÍ.
     *
     * `meta.project` je explicitné JSON `null`, kedykoľvek session nemá `cwd`
     * (`TranscriptIngestService` ten kľúč plní vždy). Na sqlite z toho `json_extract`
     * vráti SQL NULL, ale na MariaDB `json_unquote(json_extract(…))` vráti
     * štvorznakový STRING `'null'` — a ten prešiel cez `ProjectGroup::key()` ako
     * plnohodnotný názov projektu. Človek teda videl čip `null`, AI kľúč
     * `project_key: "null"`, a v tej istej odpovedi si dve čísla protirečili:
     * skupina „bez projektu" hlásila 3, kým `filtered_total` toho istého filtra 4
     * (filter ide cez `whereNull`, ktorý JSON `null` chytá správne).
     *
     * Test je tu preto, že na sqlite je zelený aj s chybou — chytí ho iba
     * `phpunit.mariadb.xml`.
     */
    public function test_an_explicit_json_null_project_is_not_a_project_named_null(): void
    {
        $this->record(null, 'Session bez cwd', 'session');

        $body = $this->getJson('/api/journal')->assertOk()->json();
        $keys = collect($body['project_groups'])->pluck('key')->all();

        $this->assertNotContains('null', $keys, 'string `null` nie je názov projektu');
        $this->assertContains(ProjectGroup::NONE, $keys);

        // Surová mapa má pre taký uzol `COALESCE(…, 'projekt')` — na MariaDB
        // nevystrelila, pretože hodnota nebola NULL, ale string.
        $this->assertArrayNotHasKey('null', $body['projects']);

        // Agregát (čip) a filter (`whereNull`) musia tvrdiť o tom istom uzle to isté.
        $chip = collect($body['project_groups'])->firstWhere('key', ProjectGroup::NONE)['count'];
        $filtered = $this->getJson('/api/journal?project='.urlencode(ProjectGroup::NONE))
            ->assertOk()->json('filtered_total');

        $this->assertSame($chip, $filtered, 'čip a filter sa nesmú rozísť');
    }

    public function test_the_journal_list_carries_counts_and_admits_the_clipped_description(): void
    {
        $long = str_repeat('a', DennikScreen::DESCRIPTION_MAX + 120);
        $this->record('AI-mind', 'Dlhý popis', 'session', ['c1'], $long);
        $this->record('AI-mind', 'Krátky popis', 'session', ['c1'], 'krátke');

        $records = collect($this->getJson('/api/journal')->assertOk()->json('records'));

        $clipped = $records->firstWhere('label', 'Dlhý popis');
        $this->assertSame(DennikScreen::DESCRIPTION_MAX, mb_strlen($clipped['description']));
        $this->assertTrue($clipped['description_truncated'], 'rez sa musí priznať');
        $this->assertSame(mb_strlen($long), $clipped['description_length']);

        // Kalibrácia zo záporného konca: nerezaný popis rez NEHLÁSI. Bez tejto
        // polovice by test nerozlíšil „priznáva sa" od „hlási vždy".
        $short = $records->firstWhere('label', 'Krátky popis');
        $this->assertSame('krátke', $short['description']);
        $this->assertArrayNotHasKey('description_truncated', $short);
        $this->assertArrayNotHasKey('description_length', $short);

        // Počty nesú to, čo niesli zmazané polia. `record()` seeduje jeden commit,
        // jeden súbor, jeden nástroj a jeden prompt.
        $this->assertSame(1, $short['commit_count']);
        $this->assertSame(1, $short['tool_count']);
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
