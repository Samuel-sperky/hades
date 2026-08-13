<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Obmedzenie recallu na oblasti — podklad pre „projekty“ v sesterskej chat appke.
 *
 * Filtruje sa už v SQL. Zúžiť výsledok až po prijatí by ušetrilo šum, ale nie
 * payload, a práve payload je pri lokálnom modeli na CPU cena každej odpovede.
 */
class RecallScopeTest extends TestCase
{
    use RefreshDatabase;

    private MindService $mind;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            $this->markTestSkipped('searchNodes vyžaduje MariaDB (COLLATE utf8mb4_unicode_ci)');
        }

        config(['cache.default' => 'array']);
        $this->mind = app(MindService::class);
    }

    public function test_scope_limits_the_search_to_the_given_areas(): void
    {
        $vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $biznis = Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#d8b878', 'angle' => 90]);

        Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'area_id' => $vyvoj->id, 'strength' => 1]);
        Node::create(['type' => 'project', 'label' => 'Docker v eshope', 'area_id' => $biznis->id, 'strength' => 1]);

        $all = $this->mind->recall('docker', 10);
        $scoped = $this->mind->recall('docker', 10, null, ['Vývoj & kód']);

        $this->assertCount(2, $all);
        $this->assertCount(1, $scoped);
        $this->assertSame('Docker kontajnery', $scoped->first()->label);
    }

    public function test_scope_accepts_a_slug_as_well_as_a_name(): void
    {
        $vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'area_id' => $vyvoj->id, 'strength' => 1]);

        $this->assertCount(1, $this->mind->recall('docker', 10, null, ['vyvoj-kod']));
    }

    public function test_an_unknown_scope_returns_nothing_rather_than_everything(): void
    {
        $vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'area_id' => $vyvoj->id, 'strength' => 1]);

        // preklep v rozsahu nesmie ticho otvoriť celú sieť
        $this->assertCount(0, $this->mind->recall('docker', 10, null, ['Neexistujúca oblasť']));
    }

    public function test_an_empty_scope_means_no_restriction(): void
    {
        $vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'area_id' => $vyvoj->id, 'strength' => 1]);

        $this->assertCount(1, $this->mind->recall('docker', 10, null, []));
    }

    public function test_mcp_recall_accepts_the_scope(): void
    {
        config(['hades.mcp_token' => 'test-mcp-token']);

        $vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $biznis = Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#d8b878', 'angle' => 90]);

        Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'area_id' => $vyvoj->id, 'strength' => 1]);
        Node::create(['type' => 'project', 'label' => 'Docker v eshope', 'area_id' => $biznis->id, 'strength' => 1]);

        $response = $this->withHeader('Authorization', 'Bearer test-mcp-token')->postJson('/mcp', [
            'jsonrpc' => '2.0',
            'id' => 1,
            'method' => 'tools/call',
            'params' => ['name' => 'mind_recall', 'arguments' => ['query' => 'docker', 'areas' => ['Vývoj & kód']]],
        ])->assertOk();

        $payload = json_decode($response->json('result.content.0.text'), true);

        $this->assertSame(1, $payload['found']);
        $this->assertSame('Docker kontajnery', $payload['nodes'][0]['label']);
    }
}
