<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Decision;
use App\Models\Node;
use App\Models\Tag;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BrainSchemaTest extends TestCase
{
    use RefreshDatabase;

    private function seedArea(): Area
    {
        return Area::create([
            'name' => 'Vývoj / kód',
            'slug' => 'vyvoj-kod',
            'color' => '#03797e',
            'angle' => 0,
        ]);
    }

    public function test_node_belongs_to_many_tags(): void
    {
        $this->seedArea();
        $node = Node::create(['type' => 'skill', 'label' => 'Docker', 'strength' => 1]);
        $tag = Tag::firstOrCreate(['name' => 'devops']);

        $node->tags()->attach($tag->id);

        $this->assertCount(1, $node->fresh()->tags);
        $this->assertSame('devops', $node->fresh()->tags->first()->name);
        $this->assertTrue($tag->nodes()->where('nodes.id', $node->id)->exists());
    }

    public function test_node_has_many_decisions(): void
    {
        $area = $this->seedArea();
        $node = Node::create(['type' => 'skill', 'label' => 'HAProxy', 'strength' => 1]);

        $decision = Decision::create([
            'node_id' => $node->id,
            'area_id' => $area->id,
            'decided_on' => '2026-07-21',
            'text' => 'Použiť HAProxy ako reverse proxy.',
            'origin' => 'session',
        ]);

        $this->assertCount(1, $node->fresh()->decisions);
        $this->assertSame($node->id, $decision->node->id);
        $this->assertSame($area->id, $decision->area->id);
    }

    public function test_node_casts(): void
    {
        $this->seedArea();
        $node = Node::create([
            'type' => 'memory',
            'label' => 'Certainty cast test',
            'strength' => 1,
            'needs_review' => 1,
            'verified_at' => '2026-07-20 10:00:00',
            'certainty' => 'overene',
        ]);

        $fresh = $node->fresh();
        $this->assertIsBool($fresh->needs_review);
        $this->assertTrue($fresh->needs_review);
        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $fresh->verified_at);
    }

    public function test_decision_date_cast(): void
    {
        $decision = Decision::create([
            'decided_on' => '2026-07-21',
            'text' => 'dátum cast',
            'origin' => 'session',
        ]);

        $this->assertInstanceOf(\Illuminate\Support\Carbon::class, $decision->fresh()->decided_on);
    }

    public function test_to_api_returns_brain_contract_keys(): void
    {
        $this->seedArea();
        $node = Node::create([
            'type' => 'skill',
            'label' => 'API contract',
            'strength' => 1,
            'certainty' => 'hypoteza',
            'source_file' => 'skills/foo.md',
        ]);
        $node->tags()->attach(Tag::firstOrCreate(['name' => 'x'])->id);

        $api = $node->fresh()->toApi();

        foreach (['origin', 'certainty', 'needs_review', 'verified_at', 'tags', 'source_file'] as $key) {
            $this->assertArrayHasKey($key, $api, "toApi() musí obsahovať '{$key}'");
        }
        $this->assertSame('session', $api['origin']);      // DB default
        $this->assertSame('hypoteza', $api['certainty']);
        $this->assertFalse($api['needs_review']);
        $this->assertNull($api['verified_at']);
        $this->assertSame(['x'], $api['tags']);
        $this->assertSame('skills/foo.md', $api['source_file']);
    }

    public function test_learn_without_new_params_unchanged(): void
    {
        $this->seedArea();
        $mind = app(MindService::class);

        $result = $mind->learn(
            type: 'skill',
            label: 'Redis caching',
            description: 'cache-aside pattern',
            areaName: 'Vývoj / kód',
        );

        $this->assertSame('created', $result['action']);
        $this->assertNull($result['node']['certainty']);
        $this->assertSame([], $result['node']['tags']);
        $this->assertSame('session', $result['node']['origin']);
    }

    public function test_learn_with_certainty_and_tags(): void
    {
        $this->seedArea();
        $mind = app(MindService::class);

        $result = $mind->learn(
            type: 'skill',
            label: 'MariaDB tuning',
            description: 'buffer pool sizing',
            areaName: 'Vývoj / kód',
            certainty: 'overene',
            tags: ['db', 'perf', 'db'],
        );

        $node = Node::where('label', 'MariaDB tuning')->first();
        $this->assertSame('overene', $node->certainty);
        $this->assertEqualsCanonicalizing(['db', 'perf'], $node->tags->pluck('name')->all());
    }

    public function test_content_hash_is_unique(): void
    {
        $this->seedArea();
        Node::create(['type' => 'skill', 'label' => 'A', 'strength' => 1, 'content_hash' => str_repeat('a', 64)]);

        $this->expectException(\Illuminate\Database\QueryException::class);
        Node::create(['type' => 'skill', 'label' => 'B', 'strength' => 1, 'content_hash' => str_repeat('a', 64)]);
    }
}
