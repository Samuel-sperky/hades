<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * REST API v1 (Bearer) + interné /api/* + stats kontrakt §4.4.
 */
class ApiV1Test extends TestCase
{
    use RefreshDatabase;

    private string $token = 'test-secret-token';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.api_token' => $this->token,
            'hades.allow_brain_write' => false,
            'cache.default' => 'array',
        ]);

        // aspoň jedna oblasť — MindService::learn() ju potrebuje na fallback
        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    // ---- auth: fail-closed -------------------------------------------------

    public function test_v1_without_token_is_401(): void
    {
        $this->getJson('/api/v1/stats')->assertStatus(401);
    }

    public function test_v1_with_wrong_token_is_401(): void
    {
        $this->withToken('nope')->getJson('/api/v1/stats')->assertStatus(401);
    }

    public function test_v1_with_empty_configured_token_is_fail_closed_401(): void
    {
        // prázdny token v konfigu = NIKTO neprejde (aj so „správnou" hlavičkou)
        config(['hades.api_token' => '']);

        $this->withToken('')->getJson('/api/v1/stats')->assertStatus(401);
        $this->withToken('whatever')->getJson('/api/v1/stats')->assertStatus(401);
    }

    public function test_health_is_public_without_token(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertJsonStructure(['status', 'name', 'version', 'time', 'brain_write_enabled']);
    }

    // ---- CRUD (knowledge, origin=session) ----------------------------------

    public function test_knowledge_crud_roundtrip(): void
    {
        // CREATE
        $create = $this->withToken($this->token)->postJson('/api/v1/knowledge', [
            'label' => 'Docker Compose',
            'type' => 'skill',
            'description' => 'Orchestrácia kontajnerov.',
            'area' => 'vyvoj-kod',
            'certainty' => 'overene',
            'tags' => ['docker', 'devops'],
        ])->assertStatus(201)->json('node');

        $this->assertNotNull($create['id']);
        $this->assertSame('session', $create['origin']);
        $this->assertEqualsCanonicalizing(['docker', 'devops'], $create['tags']);
        $id = $create['id'];

        // LIST + filter type
        $this->withToken($this->token)->getJson('/api/v1/knowledge?type=skill')
            ->assertOk()
            ->assertJsonStructure(['data', 'page', 'per_page', 'total', 'last_page'])
            ->assertJsonPath('total', 1);

        // filter tag
        $this->withToken($this->token)->getJson('/api/v1/knowledge?tag=docker')
            ->assertOk()->assertJsonPath('total', 1);

        // SHOW
        $this->withToken($this->token)->getJson("/api/v1/knowledge/{$id}")
            ->assertOk()->assertJsonPath('node.id', $id);

        // UPDATE
        $this->withToken($this->token)->putJson("/api/v1/knowledge/{$id}", [
            'label' => 'Docker Compose v2',
        ])->assertOk()->assertJsonPath('node.label', 'Docker Compose v2');

        // DELETE
        $this->withToken($this->token)->deleteJson("/api/v1/knowledge/{$id}")
            ->assertOk()->assertJsonPath('deleted', $id);

        $this->assertNull(Node::find($id));
    }

    // ---- sync lock → 423 ---------------------------------------------------

    public function test_sync_returns_423_when_locked(): void
    {
        $lock = Cache::lock('brain-sync', 60);
        $this->assertTrue($lock->get(), 'test drží zámok');

        try {
            $this->withToken($this->token)->postJson('/api/v1/sync', [])
                ->assertStatus(423)
                ->assertJsonPath('error', 'sync_locked');
        } finally {
            $lock->release();
        }
    }

    // ---- stats shape §4.4 --------------------------------------------------

    public function test_stats_matches_dashboard_contract(): void
    {
        // trocha dát na agregáty (per_area potrebuje area_id)
        $areaId = Area::where('slug', 'vyvoj-kod')->value('id');
        Node::create(['type' => 'skill', 'origin' => 'brain', 'area_id' => $areaId, 'label' => 'A', 'certainty' => 'overene', 'strength' => 1, 'last_activated_at' => now()]);
        Node::create(['type' => 'memory', 'origin' => 'session', 'area_id' => $areaId, 'label' => 'B', 'strength' => 1, 'last_activated_at' => now()]);

        $res = $this->withToken($this->token)->getJson('/api/v1/stats')->assertOk();

        $res->assertJsonStructure([
            'heatmap' => ['weeks', 'months', 'total'],
            'growth' => ['labels', 'values'],
            'certainty' => ['overene', 'hypoteza', 'pasca', 'bez', 'total', 'needs_review'],
            'per_area' => [['slug', 'name', 'color', 'count', 'overene', 'hypoteza', 'pasca', 'bez']],
            'counts' => ['nodes', 'edges', 'decisions', 'brain', 'session'],
            'sync' => ['status', 'finished_at', 'created', 'updated', 'deleted', 'skipped', 'message', 'brain_write_enabled'],
            'brain_write_enabled',
        ]);

        // interné /api/dashboard = ten istý payload (bez tokenu)
        $this->getJson('/api/dashboard')->assertOk()
            ->assertJsonPath('counts.nodes', $res->json('counts.nodes'));

        // heatmap.weeks je mriežka; každý stĺpec má 7 buniek (bunka alebo null)
        $weeks = $res->json('heatmap.weeks');
        $this->assertNotEmpty($weeks);
        $this->assertCount(7, $weeks[0]);

        // growth kumulatívne — neklesajúca postupnosť
        $values = $res->json('growth.values');
        for ($i = 1; $i < count($values); $i++) {
            $this->assertGreaterThanOrEqual($values[$i - 1], $values[$i], 'growth musí byť kumulatívny');
        }
    }

    // ---- decisions (§4.7 — funguje aj pri guard OFF) -----------------------

    public function test_decision_create_works_with_guard_off(): void
    {
        $res = $this->withToken($this->token)->postJson('/api/v1/decisions', [
            'text' => 'Zvolili sme MariaDB namiesto Postgres.',
            'reason' => 'Tímová znalosť.',
            'area' => 'vyvoj-kod',
            'decided_on' => '2026-07-20',
        ])->assertStatus(201)->json('decision');

        $this->assertSame('session', $res['origin']);
        $this->assertSame('2026-07-20', $res['decided_on']);

        // GET s filtrom roka
        $this->withToken($this->token)->getJson('/api/v1/decisions?year=2026')
            ->assertOk()->assertJsonCount(1, 'decisions');

        $this->withToken($this->token)->getJson('/api/v1/decisions?year=2020')
            ->assertOk()->assertJsonCount(0, 'decisions');
    }

    // ---- interné /api/* bez tokenu -----------------------------------------

    public function test_internal_endpoints_need_no_token(): void
    {
        $this->getJson('/api/dashboard')->assertOk();
        $this->getJson('/api/tags')->assertOk()->assertJsonStructure(['tags']);
        $this->getJson('/api/decisions')->assertOk()->assertJsonStructure(['decisions']);
    }
}
