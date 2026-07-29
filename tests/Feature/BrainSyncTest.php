<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use App\Services\Brain\BrainSyncService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BrainSyncTest extends TestCase
{
    use RefreshDatabase;

    private string $tmp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tmp = sys_get_temp_dir().'/brain-sync-test-'.uniqid();
        @mkdir($this->tmp, 0775, true);

        // transcripts mimo dosahu (claude-memory adaptér nič nenačíta v testoch)
        config(['auraai.transcripts_path' => $this->tmp.'/no-transcripts']);
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->tmp);
        parent::tearDown();
    }

    private function useExternal(): void
    {
        config([
            'auraai.brain_sources' => [
                'test' => ['type' => 'external', 'path' => $this->tmp, 'label' => 'Test', 'writable' => false],
            ],
            'auraai.brain_paths' => [],
        ]);
    }

    private function write(string $rel, string $content): void
    {
        $path = $this->tmp.'/'.$rel;
        @mkdir(dirname($path), 0775, true);
        file_put_contents($path, $content);
    }

    private function sync(bool $dryRun = false): array
    {
        return app(BrainSyncService::class)->sync(null, $dryRun);
    }

    // ------------------------------------------------------------------

    public function test_first_run_creates_second_run_is_idempotent(): void
    {
        $this->useExternal();
        $this->write('a.md', "---\nname: Docker\n---\n# Docker\n\nKontajnery.");
        $this->write('b.md', "---\nname: Redis\n---\n# Redis\n\nCache.");

        $first = $this->sync();
        $this->assertSame(2, $first['stats']['created']);
        $this->assertSame(2, Node::where('origin', 'brain')->count());

        $second = $this->sync();
        $this->assertSame(0, $second['stats']['created'], 'Druhý beh nesmie nič vytvoriť');
        $this->assertSame(0, $second['stats']['updated'], 'Nezmenený obsah = žiadny update');
        $this->assertSame(2, Node::where('origin', 'brain')->count());
    }

    public function test_dedupe_identical_content_hash(): void
    {
        $this->useExternal();
        $same = "---\nname: Rovnaké\n---\n# Rovnaké\n\nRovnaký text.";
        $this->write('one.md', $same);
        $this->write('two.md', $same);

        $r = $this->sync();

        $this->assertSame(1, $r['stats']['created']);
        $this->assertSame(1, $r['stats']['skipped_dup_hash']);
        $this->assertSame(1, Node::where('origin', 'brain')->count());
    }

    public function test_adopts_existing_skill_external_key_without_duplicating(): void
    {
        // pred-seed „starý" skill uzol (ako z MindSeedSkills) — origin session, silný
        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $old = Node::create([
            'type' => 'skill',
            'source' => 'skill',
            'origin' => 'session',
            'external_key' => 'skill:it/docker',
            'label' => 'Docker (staré)',
            'strength' => 5,
        ]);

        // skills zdroj mieri na temp skills priečinok s tým istým slugom
        $skillsDir = $this->tmp.'/skills';
        config([
            'auraai.brain_sources' => [
                'skills' => ['type' => 'skills', 'path' => $skillsDir, 'label' => 'Skills', 'writable' => false],
            ],
            'auraai.brain_paths' => [],
        ]);
        @mkdir($skillsDir.'/it', 0775, true);
        file_put_contents($skillsDir.'/it/docker.md', "# Docker\n\nKontajnerizácia.");

        $r = $this->sync();

        // žiadny duplikát — stále JEDEN uzol s tým external_key
        $this->assertSame(1, Node::where('external_key', 'skill:it/docker')->count());
        $this->assertSame(0, $r['stats']['created']);

        $fresh = $old->fresh();
        $this->assertSame('brain', $fresh->origin, 'adopcia preklopí origin na brain');
        $this->assertSame(5.0, (float) $fresh->strength, 'strength sa NIKDY neresetuje');
        $this->assertSame('Docker', $fresh->label, 'label sa prevezme zo súboru');
    }

    public function test_missing_file_flags_needs_review(): void
    {
        $this->useExternal();
        $this->write('gone.md', "---\nname: Zmizne\n---\n# Zmizne\n\nText.");

        $this->sync();
        $node = Node::where('origin', 'brain')->firstOrFail();
        $this->assertFalse($node->fresh()->needs_review);

        // súbor zmizne → ďalší beh ho flagne (nemaže)
        @unlink($this->tmp.'/gone.md');
        $r = $this->sync();

        $this->assertSame(1, $r['stats']['flagged_missing']);
        $this->assertTrue($node->fresh()->needs_review);
        $this->assertNotNull($node->fresh(), 'uzol sa NEMAŽE, len flagne');
    }

    public function test_wiki_edges_from_links(): void
    {
        $this->useExternal();
        $this->write('docker.md', "---\nname: Docker\n---\n# Docker\n\nPozri [[Compose]].");
        $this->write('compose.md', "---\nname: Compose\n---\n# Compose\n\nOrchestrácia.");

        $r = $this->sync();

        $this->assertGreaterThanOrEqual(1, $r['stats']['edges_created']);

        $docker = Node::where('label', 'Docker')->firstOrFail();
        $compose = Node::where('label', 'Compose')->firstOrFail();
        [$s, $t] = $docker->id < $compose->id ? [$docker->id, $compose->id] : [$compose->id, $docker->id];

        $edge = Edge::where('source_id', $s)->where('target_id', $t)->first();
        $this->assertNotNull($edge);
        $this->assertSame('wiki', $edge->kind);

        // druhý beh wiki hranu neduplikuje ani nenafúkne váhu
        $before = (float) $edge->weight;
        $r2 = $this->sync();
        $this->assertSame(0, $r2['stats']['edges_created']);
        $this->assertSame($before, (float) $edge->fresh()->weight);
    }

    public function test_dry_run_writes_nothing(): void
    {
        $this->useExternal();
        $this->write('x.md', "---\nname: X\n---\n# X\n\nText.");

        $r = $this->sync(dryRun: true);

        $this->assertTrue($r['dry_run']);
        $this->assertSame(1, $r['stats']['created']);
        $this->assertSame(0, Node::where('origin', 'brain')->count(), 'dry-run nič nezapíše');
    }

    public function test_mirror_file_with_node_id_is_skipped(): void
    {
        // R3 — Hadesov vlastný export (source: hades + node_id) sa NEindexuje späť
        $this->useExternal();
        $this->write('mirror.md', "---\nname: Mirror\nsource: hades\nnode_id: 99\n---\n# Mirror\n\nExport.");

        $r = $this->sync();

        $this->assertSame(0, $r['stats']['created']);
        $this->assertSame(1, $r['stats']['skipped_mirror']);
        $this->assertSame(0, Node::where('origin', 'brain')->count());
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $f) {
            if ($f === '.' || $f === '..') {
                continue;
            }
            $p = $dir.'/'.$f;
            is_dir($p) ? $this->rrmdir($p) : @unlink($p);
        }
        @rmdir($dir);
    }
}
