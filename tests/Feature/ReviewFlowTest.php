<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Kontrola — verify/review fronta (B5). Overuje frontu needs_review, DB-only
 * verify pri guard OFF (+ warning pri brain uzle) a resolve-review (len flag).
 */
class ReviewFlowTest extends TestCase
{
    use RefreshDatabase;

    private int $areaId;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.allow_brain_write' => false,
            'cache.default' => 'array',
        ]);

        $this->areaId = Area::create([
            'name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ])->id;
    }

    private function node(array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'memory',
            'origin' => 'brain',
            'area_id' => $this->areaId,
            'label' => 'Uzol '.uniqid(),
            'strength' => 1,
            'needs_review' => true,
            'last_activated_at' => now(),
        ], $attrs));
    }

    // ---- fronta ------------------------------------------------------------

    public function test_queue_returns_needs_review_newest_first(): void
    {
        $old = $this->node(['label' => 'Starší', 'created_at' => now()->subDays(2)]);
        $new = $this->node(['label' => 'Novší', 'created_at' => now()]);
        // uzol mimo fronty sa nesmie objaviť
        $this->node(['label' => 'Overený', 'needs_review' => false]);

        $res = $this->getJson('/api/review/queue')->assertOk()
            ->assertJsonStructure(['queue', 'total']);

        $this->assertSame(2, $res->json('total'));
        $ids = collect($res->json('queue'))->pluck('id')->all();
        $this->assertSame([$new->id, $old->id], $ids, 'najnovší uzol musí byť prvý');
    }

    // ---- verify: DB-only pri guard OFF + warning ---------------------------

    public function test_verify_db_only_when_guard_off_sets_fields_and_warns(): void
    {
        $node = $this->node(['certainty' => null, 'origin' => 'brain']);

        $res = $this->postJson("/api/nodes/{$node->id}/verify")->assertOk();

        $res->assertJsonPath('node.certainty', 'overene')
            ->assertJsonPath('node.needs_review', false);
        $this->assertNotNull($res->json('node.verified_at'));

        // brain uzol pri guard OFF → warning že .md sa nedotklo
        $this->assertNotEmpty($res->json('warnings'));

        $fresh = $node->fresh();
        $this->assertSame('overene', $fresh->certainty);
        $this->assertFalse($fresh->needs_review);
        $this->assertNotNull($fresh->verified_at);
    }

    public function test_verify_session_node_has_no_warning(): void
    {
        $node = $this->node(['origin' => 'session', 'certainty' => 'hypoteza']);

        $res = $this->postJson("/api/nodes/{$node->id}/verify")->assertOk();

        $res->assertJsonPath('node.certainty', 'overene')
            ->assertJsonPath('node.needs_review', false);
        $this->assertSame([], $res->json('warnings'));
    }

    // ---- resolve-review: len zhodí flag ------------------------------------

    public function test_resolve_review_only_clears_flag(): void
    {
        $node = $this->node(['certainty' => 'hypoteza']);

        $this->postJson("/api/nodes/{$node->id}/resolve-review")->assertOk()
            ->assertJsonPath('node.needs_review', false);

        $fresh = $node->fresh();
        $this->assertFalse($fresh->needs_review);
        // certainty a verified_at ostávajú nedotknuté (nie je to overenie)
        $this->assertSame('hypoteza', $fresh->certainty);
        $this->assertNull($fresh->verified_at);
    }

    // ---- v1 mirror pod tokenom --------------------------------------------

    public function test_v1_review_queue_requires_token(): void
    {
        config(['hades.api_token' => 'tok']);

        $this->getJson('/api/v1/review/queue')->assertStatus(401);
        $this->withToken('tok')->getJson('/api/v1/review/queue')->assertOk()
            ->assertJsonStructure(['queue', 'total']);
    }
}
