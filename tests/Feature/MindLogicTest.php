<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MindLogicTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['hades.mirror_enabled' => false]); // logiku testujeme bez zápisu na disk
        $this->seed(\Database\Seeders\DatabaseSeeder::class);
    }

    private function mind(): MindService
    {
        return app(MindService::class);
    }

    public function test_unknown_area_is_created_emergently(): void
    {
        $before = Area::count();
        $r = $this->mind()->learn('skill', 'Kubernetes', 'Orchestrácia kontajnerov.', 'DevOps a infra');

        $this->assertSame($before + 1, Area::count());
        $this->assertDatabaseHas('areas', ['name' => 'DevOps a infra']);
        $this->assertNotNull(Node::find($r['node']['id'])->area_id);
    }

    public function test_source_is_stored(): void
    {
        $r = $this->mind()->learn('skill', 'Vite', 'Build tool.', 'Vývoj & kód', null, [], null, 'repo/frontend');
        $this->assertSame('repo/frontend', Node::find($r['node']['id'])->source);
    }

    public function test_nodes_sharing_keywords_get_linked(): void
    {
        $a = $this->mind()->learn('skill', 'Kubernetes', 'Kontajnery a orchestrácia v klastri.', 'Vývoj & kód');
        $b = $this->mind()->learn('skill', 'Docker', 'Kontajnery a orchestrácia aplikácií.', 'Vývoj & kód');

        $id1 = $a['node']['id'];
        $id2 = $b['node']['id'];

        $this->assertDatabaseHas('edges', [
            'source_id' => min($id1, $id2),
            'target_id' => max($id1, $id2),
        ]);
    }

    public function test_learn_rejects_sensitive_content(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->mind()->learn('memory', 'Token', 'kľúč ghp_ABCdefGHIjklMNOpqrSTUvwx0123', 'Osobné & preferencie');
    }
}
