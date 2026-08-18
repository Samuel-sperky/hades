<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * `mind_recall` čítaný AI, nie človekom.
 *
 * Odpoveď bola plochý zoznam: žiadne prepojenia (hoci celá hodnota Hadesa sú
 * hrany), žiadna relevancia (dvanásty uzol vyzeral ako prvý) a na každom uzle
 * `certainty: null`, `department: null`, `tags: []`, `verified: false` —
 * namerané 2 052 B z 38 362 B zaplatených za prázdno.
 *
 * Tento test drží nový kontrakt: štruktúra v odpovedi je, prázdno v nej nie je.
 */
class RecallForAiTest extends TestCase
{
    use RefreshDatabase;

    private MindService $mind;

    private Area $area;

    protected function setUp(): void
    {
        parent::setUp();

        // searchNodes stojí na MariaDB `COLLATE utf8mb4_unicode_ci` (accent-insensitive
        // LIKE), ktoré sqlite nepozná — na predvolenej sade sa preto preskočí.
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE.');
        }

        config([
            'cache.default' => 'array',
            'hades.mcp_token' => 'test-mcp-token',
        ]);

        $this->mind = app(MindService::class);
        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    private function node(string $label, string $description, array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'skill',
            'label' => $label,
            'description' => $description,
            'area_id' => $this->area->id,
            'strength' => 1,
        ], $attrs));
    }

    /** Zavolá mind_recall cez /mcp a vráti dekódovaný payload. */
    private function recall(array $args): array
    {
        /** @var TestResponse $res */
        $res = $this->withHeader('Authorization', 'Bearer test-mcp-token')
            ->postJson('/mcp', [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => 'tools/call',
                'params' => ['name' => 'mind_recall', 'arguments' => $args],
            ])->assertOk();

        return json_decode((string) $res->json('result.content.0.text'), true);
    }

    // ---- prepojenia: hodnota grafu sa musí dostať do odpovede ---------------

    public function test_recall_names_the_strongest_connections_of_a_hit(): void
    {
        $hit = $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb v Dockeri.');
        $strong = $this->node('Docker Compose', 'Orchestrácia kontajnerov v deve.');
        $weak = $this->node('Nginx proxy', 'Reverzná proxy pred aplikáciou.');

        $this->mind->connect($hit, $strong, 'manual', false, 9.0);
        $this->mind->connect($hit, $weak, 'manual', false, 0.2);

        $data = $this->recall(['query' => 'Reverb websockety', 'limit' => 1]);

        $node = collect($data['nodes'])->firstWhere('label', 'Reverb websockety');
        $this->assertNotNull($node);
        $this->assertContains('Docker Compose', $node['related']);
    }

    public function test_a_neighbour_says_who_pulled_it_in_and_gets_half_relevance(): void
    {
        $hit = $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb v Dockeri.');
        $neighbour = $this->node('Redis fronta', 'Queue driver pre broadcast.');
        $this->mind->connect($hit, $neighbour, 'manual', false, 3.0);

        $data = $this->recall(['query' => 'Reverb websockety', 'limit' => 1]);

        $primary = collect($data['nodes'])->firstWhere('label', 'Reverb websockety');
        $pulled = collect($data['nodes'])->firstWhere('label', 'Redis fronta');

        $this->assertNotNull($pulled, 'graph-walk musí suseda pribrať');
        // sused NIE je priama zhoda — AI to musí vedieť, inak ho číta ako odpoveď
        $this->assertSame('Reverb websockety', $pulled['via']);
        $this->assertSame(
            round($primary['relevance'] / 2, 2),
            $pulled['relevance'],
            'sused má polovičnú relevanciu primára, ktorý ho pritiahol',
        );
    }

    // ---- relevancia --------------------------------------------------------

    public function test_relevance_separates_a_full_match_from_a_partial_one(): void
    {
        $this->node('Reverb websockety v Dockeri', 'Broadcast beží v kontajneri reverb.');
        $this->node('Nginx v Dockeri', 'Reverzná proxy v kontajneri.');

        $data = $this->recall(['query' => 'reverb docker', 'limit' => 5]);

        $full = collect($data['nodes'])->firstWhere('label', 'Reverb websockety v Dockeri');
        $partial = collect($data['nodes'])->firstWhere('label', 'Nginx v Dockeri');

        $this->assertNotNull($full);
        $this->assertNotNull($partial);
        $this->assertGreaterThan($partial['relevance'], $full['relevance']);
        $this->assertLessThanOrEqual(1.0, $full['relevance']);
    }

    public function test_a_node_named_after_the_query_outranks_a_stronger_mention(): void
    {
        // Uzol, ktorý pojem raz zmieni v dlhom popise, nie je to, čo hľadáš —
        // aj keď je desaťkrát silnejší. Bez tohto rozlíšenia padne celé okno
        // dvanástich uzlov do jedného skórovacieho pásma s rovnakou relevanciou.
        $this->node('Nesúvisiaci silný uzol', 'Dlhý popis, ktorý mimochodom spomína reverb.', ['strength' => 40]);
        $this->node('Reverb', 'Broadcast server.');

        $data = $this->recall(['query' => 'reverb', 'limit' => 5]);

        $this->assertSame('Reverb', $data['nodes'][0]['label']);
        $this->assertGreaterThan(
            $data['nodes'][1]['relevance'],
            $data['nodes'][0]['relevance'],
            'zhoda v labeli musí byť v relevancii vidieť',
        );
    }

    public function test_the_answer_says_how_the_query_was_understood(): void
    {
        $this->node('Reverb websockety', 'Broadcast cez Reverb.');

        $data = $this->recall(['query' => 'websockety', 'limit' => 3]);

        // stemované korene dopytu — keď recall vráti nezmysly, AI vidí prečo
        $this->assertNotEmpty($data['terms']);
    }

    public function test_an_empty_result_carries_a_hint_instead_of_silence(): void
    {
        $data = $this->recall(['query' => 'kompletne nesuvisiaci dopyt xyzzy', 'limit' => 5]);

        $this->assertSame(0, $data['found']);
        $this->assertArrayHasKey('hint', $data);
    }

    // ---- popis: úryvok len keď sa celý nezmestí -----------------------------

    public function test_a_short_description_is_sent_whole_not_as_a_snippet(): void
    {
        config(['hades.recall_desc_top_count' => 0]);

        // 135-znakový popis sa do stropu 300 vojde celý; úryvok okolo zhody by
        // mu odrezal začiatok a odpoveď by začínala trojbodkou v polovici vety
        $whole = 'Živé vedomie AI — neurónová sieť skills, spomienok a projektov s MCP učením a glow vizualizáciou. Laravel + MariaDB + Reverb v Dockeri.';
        $this->node('Hades', $whole);

        $data = $this->recall(['query' => 'reverb', 'limit' => 3]);
        $hit = collect($data['nodes'])->firstWhere('label', 'Hades');

        $this->assertSame($whole, $hit['description']);
        $this->assertArrayNotHasKey('description_truncated', $hit);
    }

    public function test_a_long_description_falls_back_to_the_snippet_around_the_match(): void
    {
        config(['hades.recall_desc_top_count' => 0, 'hades.recall_desc_chars' => 300]);

        // zhoda je až na konci — slepý začiatok popisu by o nej nepovedal nič
        $long = str_repeat('Nezaujímavý úvod, ktorý o dopyte nehovorí nič. ', 20).'A tu je reverb.';
        $this->node('Dlhý uzol', $long);

        $data = $this->recall(['query' => 'reverb', 'limit' => 3]);
        $hit = collect($data['nodes'])->firstWhere('label', 'Dlhý uzol');

        $this->assertStringContainsString('reverb', $hit['description']);
        $this->assertTrue($hit['description_truncated']);
    }

    // ---- prázdne polia sa neposielajú --------------------------------------

    public function test_recall_omits_fields_that_carry_no_information(): void
    {
        // uzol bez oddelenia, bez tagov, bez istoty, neoverený, origin=session
        $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb v Dockeri.');

        $data = $this->recall(['query' => 'Reverb websockety', 'limit' => 3]);
        $node = collect($data['nodes'])->firstWhere('label', 'Reverb websockety');

        foreach (['department', 'certainty', 'tags', 'verified', 'noise'] as $key) {
            $this->assertArrayNotHasKey($key, $node, "prázdne `{$key}` sa nemá posielať");
        }
        // `session` je pôvod väčšiny uzlov, teda default — vypisovať ho je 20 B za nič
        $this->assertArrayNotHasKey('origin', $node);

        // to, čo informáciu nesie, tam ostáva
        $this->assertSame('Vývoj & kód', $node['area']);
        $this->assertSame('skill', $node['type']);
        $this->assertArrayHasKey('description', $node);
    }

    public function test_meaningful_fields_are_still_sent(): void
    {
        $department = Department::create([
            'area_id' => $this->area->id, 'name' => 'Backend', 'slug' => 'backend', 'angle' => 0,
        ]);

        $node = $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb v Dockeri.', [
            'department_id' => $department->id,
            'certainty' => 'pasca',
            'origin' => 'brain',
            'verified_at' => now(),
        ]);
        $node->tags()->attach(\App\Models\Tag::forName('reverb'));

        $data = $this->recall(['query' => 'Reverb websockety', 'limit' => 3]);
        $hit = collect($data['nodes'])->firstWhere('label', 'Reverb websockety');

        $this->assertSame('Backend', $hit['department']);
        $this->assertSame('pasca', $hit['certainty']);
        $this->assertSame('brain', $hit['origin']);
        $this->assertTrue($hit['verified']);
        $this->assertContains('reverb', $hit['tags']);
    }

    public function test_the_tag_list_is_capped_and_query_tags_go_first(): void
    {
        config(['hades.recall_tag_cap' => 3]);

        $node = $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb.');
        foreach (['alfa', 'beta', 'gama', 'delta', 'reverb'] as $tag) {
            $node->tags()->attach(\App\Models\Tag::forName($tag));
        }

        $data = $this->recall(['query' => 'reverb', 'limit' => 3]);
        $hit = collect($data['nodes'])->firstWhere('label', 'Reverb websockety');

        $this->assertCount(3, $hit['tags']);
        // uzol so 38 tagmi platil 400 B za abecedu; do stropu ide to, čo trafil dopyt
        $this->assertContains('reverb', $hit['tags']);
    }

    // ---- odpad sa označí a nejde na začiatok kontextu -----------------------

    public function test_a_noisy_node_is_flagged_and_ranked_behind_a_clean_one(): void
    {
        // rovnaká zhoda konceptov, odpad má NAVYŠE vyššiu silu — a aj tak ide za
        $this->node('použi mcp hades a poskladaj mi ten reverb websocket kontext', 'Surový prompt.', ['strength' => 50]);
        $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb v Dockeri.');

        $data = $this->recall(['query' => 'reverb websockety', 'limit' => 5]);

        $labels = collect($data['nodes'])->pluck('label')->all();
        $clean = array_search('Reverb websockety', $labels, true);
        $noisy = array_search('použi mcp hades a poskladaj mi ten reverb websocket kontext', $labels, true);

        $this->assertNotFalse($clean);
        $this->assertNotFalse($noisy);
        $this->assertLessThan($noisy, $clean, 'čistý uzol musí byť pred odpadovým');

        $flagged = collect($data['nodes'])->firstWhere('noise', 'raw-prompt');
        $this->assertNotNull($flagged, 'odpad musí byť označený, nie ticho vrátený');
    }

    // ---- recall() ostáva kompatibilné --------------------------------------

    public function test_the_service_contract_of_recall_is_unchanged(): void
    {
        // ChatController aj staré testy čítajú Collection<Node> — to sa nesmie zlomiť
        $node = $this->node('Reverb websockety', 'Broadcast cez Laravel Reverb.');

        $result = $this->mind->recall('Reverb websockety', 5);

        $this->assertInstanceOf(\Illuminate\Support\Collection::class, $result);
        $this->assertTrue($result->contains('id', $node->id));
    }
}
