<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tag;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * MCP JSON-RPC nástroje (B5): mind_learn +certainty/tags, mind_recall vracia
 * certainty/tags/verified/origin, mind_overview +needs_review count, nový
 * mind_decision (DB origin=session, funguje aj pri guard OFF).
 */
class McpToolsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // /mcp je od 12.8.2026 za tokenom (AuthenticateMcp, fail-closed) —
        // bez neho by každý JSON-RPC dotaz nižšie skončil na 401.
        config([
            'hades.allow_brain_write' => false,
            'hades.mcp_token' => 'test-mcp-token',
            'cache.default' => 'array',
        ]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    /** JSON-RPC POST na /mcp. */
    private function rpc(string $method, array $params = [], int $id = 1): TestResponse
    {
        return $this->withHeader('Authorization', 'Bearer test-mcp-token')
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => $id,
                'method' => $method,
                'params' => $params,
            ]);
    }

    /** Zavolá tool a vráti dekódovaný JSON payload z result.content[0].text. */
    private function callTool(string $tool, array $args = []): array
    {
        $res = $this->rpc('tools/call', ['name' => $tool, 'arguments' => $args])->assertOk();

        $text = $res->json('result.content.0.text');
        $this->assertIsString($text, "tool {$tool} musí vrátiť text content");

        return json_decode($text, true);
    }

    // ---- ping: keepalive klientov -------------------------------------------

    /**
     * `ping` vracia prázdny objekt, nie pole — a `isset($result['jsonrpc'])` na
     * stdClass je v PHP 8 fatálna chyba, takže KAŽDÝ ping padal na HTTP 500.
     * Odhalilo sa to až pri stdio moste (bin/hades-mcp-stdio.mjs), lebo keepalive
     * posielajú klienti, nie testy.
     */
    public function test_ping_returns_empty_result_instead_of_500(): void
    {
        $this->rpc('ping', id: 9)
            ->assertOk()
            ->assertExactJson(['jsonrpc' => '2.0', 'id' => 9, 'result' => []]);
    }

    // ---- tools/list: nová schéma + nový tool -------------------------------

    public function test_tools_list_exposes_certainty_tags_and_mind_decision(): void
    {
        $tools = $this->rpc('tools/list')->assertOk()->json('result.tools');

        $names = collect($tools)->pluck('name')->all();
        $this->assertContains('mind_decision', $names);

        $learn = collect($tools)->firstWhere('name', 'mind_learn');
        $props = $learn['inputSchema']['properties'];
        $this->assertArrayHasKey('certainty', $props);
        $this->assertArrayHasKey('tags', $props);
        $this->assertSame(['overene', 'hypoteza', 'pasca'], $props['certainty']['enum']);
    }

    // ---- mind_learn s certainty/tags ---------------------------------------

    public function test_learn_stores_certainty_and_tags(): void
    {
        $data = $this->callTool('mind_learn', [
            'type' => 'skill',
            'label' => 'Kubernetes Ingress',
            'description' => 'Smerovanie HTTP do klastra cez ingress controller.',
            'area' => 'vyvoj-kod',
            'certainty' => 'overene',
            'tags' => ['k8s', 'network'],
        ]);

        $this->assertContains($data['action'], ['created', 'merged']);
        $this->assertSame('overene', $data['node']['certainty']);
        $this->assertEqualsCanonicalizing(['k8s', 'network'], $data['node']['tags']);

        $node = Node::where('label', 'Kubernetes Ingress')->first();
        $this->assertNotNull($node);
        $this->assertSame('overene', $node->certainty);
        $this->assertEqualsCanonicalizing(['k8s', 'network'], $node->tags()->pluck('name')->all());
    }

    public function test_learn_without_new_params_still_works(): void
    {
        // regres — holý mind_learn (bez certainty/tags) beží nezmenene
        $data = $this->callTool('mind_learn', [
            'type' => 'memory',
            'label' => 'Fakt bez značiek',
            'area' => 'vyvoj-kod',
        ]);

        $this->assertContains($data['action'], ['created', 'merged']);
        $this->assertNull($data['node']['certainty']);
        $this->assertSame([], $data['node']['tags']);
    }

    // ---- mind_recall: čo nesie informáciu, ostáva; prázdno sa neposiela ----

    public function test_recall_returns_the_fields_that_carry_information(): void
    {
        // MindService::searchNodes používa MariaDB-only `COLLATE utf8mb4_unicode_ci`
        // (accent-insensitive LIKE), ktoré sqlite nepozná → recall sa reálne overuje
        // proti MariaDB (viď curl smoke v správe). Na sqlite ho preskočíme.
        if (\Illuminate\Support\Facades\DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE (overené smoke proti MariaDB).');
        }

        $this->callTool('mind_learn', [
            'type' => 'skill',
            'label' => 'Redis caching',
            'description' => 'Cache-aside vzor s TTL a jitterom v Redise.',
            'area' => 'vyvoj-kod',
            'certainty' => 'hypoteza',
            'tags' => ['redis'],
        ]);

        $data = $this->callTool('mind_recall', ['query' => 'Redis caching']);

        $this->assertGreaterThanOrEqual(1, $data['found']);
        $hit = collect($data['nodes'])->firstWhere('label', 'Redis caching');
        $this->assertNotNull($hit);
        $this->assertSame('hypoteza', $hit['certainty']);
        $this->assertContains('redis', $hit['tags']);
        // relevancia je nová a je to jediné, čím AI rozlíši prvý uzol od dvanásteho
        $this->assertGreaterThan(0, $hit['relevance']);

        // `verified: false` a `origin: session` sú defaulty — 20 B za nulovú
        // informáciu na každom uzle, tak sa už neposielajú (viď RecallForAiTest)
        $this->assertArrayNotHasKey('verified', $hit);
        $this->assertArrayNotHasKey('origin', $hit);
    }

    // ---- mind_overview +needs_review ---------------------------------------

    public function test_overview_includes_needs_review_count(): void
    {
        $areaId = Area::where('slug', 'vyvoj-kod')->value('id');
        Node::create(['type' => 'memory', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'X', 'strength' => 1, 'needs_review' => true, 'last_activated_at' => now()]);
        Node::create(['type' => 'memory', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'Y', 'strength' => 1, 'needs_review' => false, 'last_activated_at' => now()]);

        $data = $this->callTool('mind_overview');

        $this->assertArrayHasKey('needs_review', $data['totals']);
        $this->assertSame(1, $data['totals']['needs_review']);
    }

    public function test_overview_tells_the_ai_how_to_file_a_node(): void
    {
        // mind_learn berie `certainty` a tagy, ale overview o nich mlčalo —
        // AI, ktorá si štruktúru ťahá odtiaľ, ich nemala odkiaľ vedieť
        $areaId = Area::where('slug', 'vyvoj-kod')->value('id');
        $node = Node::create([
            'type' => 'skill', 'area_id' => $areaId, 'label' => 'Docker Compose',
            'strength' => 1, 'last_activated_at' => now(),
        ]);
        $node->tags()->attach(\App\Models\Tag::forName('docker'));

        $data = $this->callTool('mind_overview');

        $this->assertSame(['overene', 'hypoteza', 'pasca'], $data['certainty_levels']);
        $this->assertContains('docker', $data['top_tags']);
    }

    // ---- mind_read: cesta k celému uzlu ------------------------------------

    public function test_read_returns_the_whole_description_and_the_neighbours(): void
    {
        $areaId = Area::where('slug', 'vyvoj-kod')->value('id');
        $long = str_repeat('Podrobný popis, ktorý recall skracuje. ', 40);

        $node = Node::create([
            'type' => 'skill', 'area_id' => $areaId, 'label' => 'Reverb websockety',
            'description' => $long, 'strength' => 1, 'last_activated_at' => now(),
        ]);
        $neighbour = Node::create([
            'type' => 'skill', 'area_id' => $areaId, 'label' => 'Redis fronta',
            'description' => 'Queue driver.', 'strength' => 1, 'last_activated_at' => now(),
        ]);
        app(\App\Services\MindService::class)->connect($node, $neighbour, 'manual', false, 2.0);

        $data = $this->callTool('mind_read', ['label' => 'Reverb websockety']);

        // `description_truncated: true` doteraz hlásilo, že je viac textu, ale
        // AI ho nemala ako dostať — toto je tá chýbajúca cesta
        $this->assertSame(trim($long), $data['description']);
        $this->assertContains('Redis fronta', $data['related']);
        $this->assertSame(1, $data['related_total']);
    }

    public function test_read_refuses_an_unknown_label_instead_of_guessing(): void
    {
        $res = $this->rpc('tools/call', [
            'name' => 'mind_read',
            'arguments' => ['label' => 'Uzol, ktorý neexistuje'],
        ])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('mind_recall', (string) $res->json('result.content.0.text'));
    }

    public function test_tools_list_exposes_mind_read(): void
    {
        $tools = $this->rpc('tools/list')->assertOk()->json('result.tools');

        $this->assertContains('mind_read', collect($tools)->pluck('name')->all());
    }

    // ---- mind_decision (DB origin=session, guard OFF) ----------------------

    public function test_decision_creates_session_db_row_with_guard_off(): void
    {
        $data = $this->callTool('mind_decision', [
            'text' => 'Zvolili sme Reverb pre WebSockety.',
            'reason' => 'Natívna Laravel integrácia.',
            'area' => 'vyvoj-kod',
            'decided_on' => '2026-07-19',
        ]);

        $this->assertSame('decided', $data['action']);
        $this->assertSame('session', $data['decision']['origin']);
        $this->assertSame('2026-07-19', $data['decision']['decided_on']);

        $this->assertSame(1, Decision::where('origin', 'session')->count());
        $decision = Decision::first();
        $this->assertSame('Zvolili sme Reverb pre WebSockety.', $decision->text);
        $this->assertNotNull($decision->area_id);
    }

    public function test_decision_requires_text(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'mind_decision', 'arguments' => ['reason' => 'x']])
            ->assertOk();

        $this->assertTrue($res->json('result.isError'));
    }

    /**
     * Neznáma oblasť sa nesmie ticho zahodiť. Predtým sa rozhodnutie uložilo
     * s area_id = null a odpoveď vyzerala rovnako úspešne ako správny zápis,
     * takže volajúci nemal ako zistiť, že o zaradenie prišiel — dva rozhodnutia
     * v ostrej sieti tak zostali osirené.
     */
    public function test_decision_rejects_unknown_area_instead_of_dropping_it(): void
    {
        $res = $this->rpc('tools/call', ['name' => 'mind_decision', 'arguments' => [
            'text' => 'Rozhodnutie s pokazeným názvom oblasti.',
            'area' => 'Vývoj &amp; kód',
        ]])->assertOk();

        $this->assertTrue($res->json('result.isError'));
        // Chyba menuje platné oblasti, aby AI vedela dopyt opraviť
        $this->assertStringContainsString('Vývoj / kód', $res->json('result.content.0.text'));
        $this->assertSame(0, Decision::count());
    }

    public function test_decision_without_area_still_works(): void
    {
        $data = $this->callTool('mind_decision', [
            'text' => 'Rozhodnutie bez oblasti je legitímne.',
        ]);

        $this->assertSame('decided', $data['action']);
        $this->assertNull(Decision::first()->area_id);
    }

    // ---- pomôcky pre nové nástroje -----------------------------------------

    /** Zavolá tool a vráti celú MCP odpoveď (na overenie odmietnutí). */
    private function callToolRaw(string $tool, array $args = []): TestResponse
    {
        return $this->rpc('tools/call', ['name' => $tool, 'arguments' => $args])->assertOk();
    }

    private function node(string $label, ?string $description = null, array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'skill',
            'area_id' => Area::where('slug', 'vyvoj-kod')->value('id'),
            'label' => $label,
            'description' => $description,
            'strength' => 1,
            'last_activated_at' => now(),
        ], $attrs));
    }

    /** Prázdno sa v MCP odpovediach neposiela — `null` v nej nemá čo robiť. */
    private function assertNoNullValues(mixed $value, string $path = 'payload'): void
    {
        $this->assertNotNull($value, "{$path} nesmie byť null");

        if (is_array($value)) {
            foreach ($value as $key => $item) {
                $this->assertNoNullValues($item, "{$path}.{$key}");
            }
        }
    }

    // ---- tools/list: tri nové nástroje, staré nedotknuté -------------------

    public function test_tools_list_appends_the_new_tools_without_touching_the_old_ones(): void
    {
        $tools = $this->rpc('tools/list')->assertOk()->json('result.tools');
        $names = collect($tools)->pluck('name')->all();

        // Pôvodných deväť v pôvodnom poradí — nové sa len pridávajú na koniec.
        // Zoznam je zámerne presný, nie „obsahuje": preradenie toolov mení to, čo
        // vidí živá session, a to sa nemá stať nepozorovane.
        $this->assertSame([
            'mind_learn', 'mind_recall', 'mind_read', 'mind_activate', 'mind_overview',
            'mind_decision', 'mind_rename', 'mind_move', 'mind_delete',
            'mind_update', 'mind_link', 'mind_hygiene',
            'mind_runs', 'mind_run', 'mind_today', 'mind_journal',
            'mind_directive', 'mind_library', 'mind_decisions', 'mind_review',
        ], $names);

        $link = collect($tools)->firstWhere('name', 'mind_link');
        // slovník relácií je ten, ktorý v sieti už žije — nič vymyslené
        $this->assertSame(['uses', 'part_of'], $link['inputSchema']['properties']['relation']['enum']);

        $update = collect($tools)->firstWhere('name', 'mind_update');
        $this->assertSame(['replace', 'append'], $update['inputSchema']['properties']['mode']['enum']);
        $this->assertSame(['description'], $update['inputSchema']['required']);
    }

    /**
     * `semantic` pribudlo do payloadu recallu v tomto šprinte, ale klient ho číta
     * z popisu nástroja — bez vysvetlenia by AI hľadala slová dopytu v uzle,
     * v ktorom nie sú.
     */
    public function test_recall_description_documents_the_semantic_marker(): void
    {
        $tools = $this->rpc('tools/list')->assertOk()->json('result.tools');
        $recall = collect($tools)->firstWhere('name', 'mind_recall');

        $this->assertStringContainsString('`semantic`', $recall['description']);
        $this->assertStringContainsString('MEANING', $recall['description']);
    }

    // ---- mind_update: oprava popisu ----------------------------------------

    /**
     * Presne ten prípad, ktorý si 19. 8. 2026 vyžiadal jednorazový PHP skript:
     * mind_learn s tým istým labelom popis PRIPOJÍ, takže uzol otvára nesprávne
     * tvrdenie a opravu nesie pod ním.
     */
    public function test_update_replaces_the_description_instead_of_appending_to_it(): void
    {
        $node = $this->node('N+1 v /api/mind', 'Endpoint robil 2196 dopytov, čo bola chybná hodnota.');

        $data = $this->callTool('mind_update', [
            'id' => $node->id,
            'description' => 'Endpoint robil 1099 dopytov na 1093 uzlov; profiler predtým počítal dvakrát.',
        ]);

        $this->assertSame('updated', $data['action']);
        $this->assertSame('N+1 v /api/mind', $data['label']);

        $fresh = $node->fresh();
        $this->assertStringStartsWith('Endpoint robil 1099', (string) $fresh->description);
        $this->assertStringNotContainsString('2196', (string) $fresh->description);
        $this->assertSame(mb_strlen((string) $fresh->description), $data['chars']);
    }

    public function test_update_appends_only_when_the_caller_asks_for_it(): void
    {
        $node = $this->node('Docker rebuild', 'Kontejnery sa rebuildujú voľne.');

        $this->callTool('mind_update', [
            'id' => $node->id,
            'mode' => 'append',
            'description' => 'Migrácie vždy so zálohou do backups/.',
        ]);

        $description = (string) $node->fresh()->description;
        $this->assertStringStartsWith('Kontejnery sa rebuildujú voľne.', $description);
        $this->assertStringContainsString('Migrácie vždy so zálohou', $description);
    }

    public function test_update_sets_certainty_and_adds_tags_without_removing_any(): void
    {
        $node = $this->node('Reverb websockety', 'WS server pre Laravel.', ['certainty' => 'hypoteza']);
        $node->tags()->attach(Tag::forName('laravel'));

        $this->callTool('mind_update', [
            'label' => 'Reverb websockety',
            'description' => 'WS server pre Laravel, overený v Dockeri.',
            'certainty' => 'overene',
            'tags' => ['reverb'],
        ]);

        $fresh = $node->fresh();
        $this->assertSame('overene', $fresh->certainty);
        // pôvodný tag ostáva — mind_update tagy pridáva, neodoberá
        $this->assertEqualsCanonicalizing(['laravel', 'reverb'], $fresh->tags()->pluck('name')->all());
    }

    public function test_update_refuses_an_unknown_id(): void
    {
        $res = $this->callToolRaw('mind_update', ['id' => 987654, 'description' => 'Text.']);

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('987654', (string) $res->json('result.content.0.text'));
    }

    public function test_update_refuses_an_empty_description(): void
    {
        $node = $this->node('Uzol, ktorý sa nesmie vyprázdniť', 'Popis, ktorý tu má ostať.');

        $res = $this->callToolRaw('mind_update', ['id' => $node->id, 'description' => '   ']);

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('mind_delete', (string) $res->json('result.content.0.text'));
        $this->assertSame('Popis, ktorý tu má ostať.', $node->fresh()->description);
    }

    public function test_update_refuses_an_unknown_mode_instead_of_guessing(): void
    {
        $node = $this->node('Uzol s režimom', 'Popis.');

        $res = $this->callToolRaw('mind_update', [
            'id' => $node->id,
            'description' => 'Nový popis.',
            'mode' => 'prepend',
        ]);

        $this->assertTrue($res->json('result.isError'));
        $this->assertStringContainsString('replace', (string) $res->json('result.content.0.text'));
        $this->assertSame('Popis.', $node->fresh()->description);
    }

    /** Poistka blacklistu platí na každej zápisovej ceste, nielen v mind_learn. */
    public function test_update_refuses_a_secret(): void
    {
        $node = $this->node('Prístup k službe', 'Ako sa pripojiť.');

        $res = $this->callToolRaw('mind_update', [
            'id' => $node->id,
            'description' => 'Prihlasuje sa tokenom ghp_'.str_repeat('a1B2', 8).' z CI.',
        ]);

        $this->assertTrue($res->json('result.isError'));
        $this->assertSame('Ako sa pripojiť.', $node->fresh()->description);
    }

    // ---- mind_link: úmyselné prepojenie ------------------------------------

    public function test_link_creates_a_manual_edge_and_repeating_it_changes_nothing(): void
    {
        $a = $this->node('Vektorové vyhľadávanie', 'bge-m3 embeddingy nad uzlami.');
        $b = $this->node('Hybridný recall', 'RRF fúzia kľúčových slov a vektorov.');

        $first = $this->callTool('mind_link', [
            'from_id' => $a->id,
            'to_id' => $b->id,
            'relation' => 'uses',
        ]);

        $this->assertSame('linked', $first['action']);
        $this->assertEqualsCanonicalizing(['Vektorové vyhľadávanie', 'Hybridný recall'], $first['nodes']);
        $this->assertSame('uses', $first['relation']);

        $edge = Edge::first();
        $this->assertSame('manual', $edge->kind);
        $this->assertFalse((bool) $edge->auto);
        $weight = (float) $edge->weight;

        $second = $this->callTool('mind_link', ['from_id' => $b->id, 'to_id' => $a->id]);

        // idempotencia: druhé volanie hranu NEPOSILNÍ. connect() by váhu
        // inkrementoval a trikrát potvrdené spojenie by bolo ťažšie než skutočná
        // opakovaná co-aktivácia.
        $this->assertSame('already_linked', $second['action']);
        $this->assertSame(1, Edge::count());
        $this->assertSame($weight, (float) $edge->fresh()->weight);
    }

    public function test_link_never_overwrites_a_relation_that_is_already_set(): void
    {
        $a = $this->node('Konzola Hades', 'Nástroje na údržbu siete.');
        $b = $this->node('Hades vedomie', 'Sieť uzlov a hrán.');

        $this->callTool('mind_link', ['from_id' => $a->id, 'to_id' => $b->id, 'relation' => 'part_of']);
        $data = $this->callTool('mind_link', ['from_id' => $a->id, 'to_id' => $b->id, 'relation' => 'uses']);

        // odpoveď hlási VÝSLEDNÚ reláciu, takže volajúci vidí, že jeho neprešla
        $this->assertSame('part_of', $data['relation']);
        $this->assertSame('part_of', Edge::first()->relation);
    }

    public function test_link_refuses_a_self_link(): void
    {
        $node = $this->node('Uzol sám o sebe', 'Popis uzla.');

        $res = $this->callToolRaw('mind_link', ['from_id' => $node->id, 'to_id' => $node->id]);

        $this->assertTrue($res->json('result.isError'));
        $this->assertSame(0, Edge::count());
    }

    public function test_link_refuses_an_unknown_relation_and_names_the_known_ones(): void
    {
        $a = $this->node('Prvý uzol', 'Popis prvého uzla.');
        $b = $this->node('Druhý uzol', 'Popis druhého uzla.');

        $res = $this->callToolRaw('mind_link', [
            'from_id' => $a->id,
            'to_id' => $b->id,
            'relation' => 'depends_on',
        ]);

        $this->assertTrue($res->json('result.isError'));
        $text = (string) $res->json('result.content.0.text');
        $this->assertStringContainsString('uses', $text);
        $this->assertStringContainsString('part_of', $text);
        // odmietnutie je úplné — hrana bez relácie by bola tichá polovica zápisu
        $this->assertSame(0, Edge::count());
    }

    public function test_link_refuses_an_unknown_node(): void
    {
        $node = $this->node('Existujúci uzol', 'Popis existujúceho uzla.');

        $res = $this->callToolRaw('mind_link', ['from_id' => $node->id, 'to_id' => 987654]);

        $this->assertTrue($res->json('result.isError'));
        $this->assertSame(0, Edge::count());
    }

    public function test_link_accepts_exact_labels_when_the_session_has_no_ids(): void
    {
        // recall labely vracia, id nie — bez tejto cesty by nástroj bol nepoužiteľný
        $this->node('Ollama lokálny model', 'Beží v Dockeri na porte 11434.');
        $this->node('bge-m3 embeddingy', '1024 dimenzií, float32 BLOB.');

        $data = $this->callTool('mind_link', [
            'from' => 'Ollama lokálny model',
            'to' => 'bge-m3 embeddingy',
        ]);

        $this->assertSame('linked', $data['action']);
        $this->assertSame(1, Edge::count());
    }

    // ---- mind_hygiene: správa, ktorá nič nemení ----------------------------

    public function test_hygiene_reports_counts_with_example_ids(): void
    {
        $stub = $this->node('Docker Compose', 'krátke');
        $clean = $this->node('Čistý uzol', 'Popis, ktorý je dostatočne dlhý na to, aby uzol nebol stub.');
        app(MindService::class)->connect($clean, $stub);

        $data = $this->callTool('mind_hygiene');

        $this->assertSame(2, $data['nodes']);
        $this->assertGreaterThanOrEqual(1, $data['dirty_nodes']);

        $stubClass = collect($data['classes'])->firstWhere('class', 'stub');
        $this->assertNotNull($stubClass);
        $this->assertSame(1, $stubClass['count']);
        $this->assertContains($stub->id, $stubClass['examples']);

        // trieda s nulou nenesie informáciu (to je zdravý stav) a neposiela sa
        $this->assertNotContains(0, collect($data['classes'])->pluck('count')->all());

        // najdrahšie uzly majú aj label — o nich sa rozhoduje prvé
        $this->assertSame($stub->id, $data['worst'][0]['id']);
        $this->assertSame('Docker Compose', $data['worst'][0]['label']);
    }

    public function test_hygiene_changes_nothing(): void
    {
        $node = $this->node('# Smernica: niečo', 'Popis s markdownom v labeli, dosť dlhý.');

        $this->callTool('mind_hygiene', ['limit' => 5]);

        $this->assertSame(1, Node::count());
        $this->assertSame('# Smernica: niečo', $node->fresh()->label);
        $this->assertSame(0, Edge::count());
    }

    public function test_hygiene_refuses_an_unknown_class_and_names_the_valid_ones(): void
    {
        $res = $this->callToolRaw('mind_hygiene', ['class' => 'rubbish']);

        $this->assertTrue($res->json('result.isError'));
        // platné triedy menuje sám príkaz — druhá kópia zoznamu by sa rozišla
        $this->assertStringContainsString('raw-prompt', (string) $res->json('result.content.0.text'));
    }

    // ---- aditívnosť: staré payloady sa nezmenili ---------------------------

    /**
     * `mind_read` je kontrakt, ktorý čítajú živé sessions. Nové nástroje k nemu
     * nesmú pridať ani odobrať jediný kľúč.
     */
    public function test_read_payload_shape_is_unchanged(): void
    {
        $node = $this->node('Uzol na čítanie', 'Popis dosť dlhý na to, aby nebol stub, a nič viac.');
        $neighbour = $this->node('Sused uzla', 'Popis suseda, tiež dosť dlhý.');
        app(MindService::class)->connect($node, $neighbour);
        $node->tags()->attach(Tag::forName('docker'));

        $data = $this->callTool('mind_read', ['label' => 'Uzol na čítanie']);

        $this->assertSame([
            'label', 'type', 'area', 'strength', 'origin', 'tags', 'created',
            'last_activated', 'description', 'related', 'related_total',
        ], array_keys($data));
    }

    public function test_recall_payload_shape_is_unchanged(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE.');
        }

        $this->node('Redis fronta', 'Queue driver s Redisom, popis dosť dlhý na to, aby nebol stub.');

        $data = $this->callTool('mind_recall', ['query' => 'Redis fronta']);

        $this->assertSame(['found', 'terms', 'nodes'], array_keys($data));
        $this->assertSame([
            'label', 'type', 'area', 'relevance', 'strength', 'description',
        ], array_keys($data['nodes'][0]));
    }

    public function test_new_tools_never_return_null_valued_keys(): void
    {
        $a = $this->node('Uzol A', 'Popis uzla A, dosť dlhý na to, aby nebol stub.');
        $b = $this->node('Uzol B', 'Popis uzla B, dosť dlhý na to, aby nebol stub.');

        $this->assertNoNullValues($this->callTool('mind_update', [
            'id' => $a->id,
            'description' => 'Opravený popis uzla A, dosť dlhý na to, aby nebol stub.',
        ]), 'mind_update');

        $this->assertNoNullValues($this->callTool('mind_link', [
            'from_id' => $a->id,
            'to_id' => $b->id,
        ]), 'mind_link');

        $this->assertNoNullValues($this->callTool('mind_hygiene'), 'mind_hygiene');
    }
}
