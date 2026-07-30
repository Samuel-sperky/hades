<?php

namespace Tests\Feature\Maintenance;

use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\DryRun\DryRunOptions;
use App\Services\Maintenance\DryRun\DryRunRunner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * Dry-run deštruktívnych jobov (rozhodnutie #31/#32).
 *
 * Najdôležitejšie tvrdenie testu: dry-run NIČ NEZMENÍ. Preto každý test kontroluje
 * počty uzlov a hrán pred aj po behu — dry-run, ktorý niečo zmaže, je horší než
 * žiadny dry-run.
 */
class DryRunTest extends TestCase
{
    use RefreshDatabase;

    private string $reportDir;

    protected function setUp(): void
    {
        parent::setUp();
        $this->reportDir = 'dry-run-test-'.uniqid();
        config(['maintenance.dry_run.path' => $this->reportDir]);
    }

    protected function tearDown(): void
    {
        $dir = storage_path('app/'.$this->reportDir);
        if (is_dir($dir)) {
            foreach (glob($dir.'/*') ?: [] as $file) {
                @unlink($file);
            }
            @rmdir($dir);
        }
        parent::tearDown();
    }

    public function test_dry_run_changes_nothing(): void
    {
        $this->seedNetwork();
        $nodesBefore = Node::count();
        $edgesBefore = Edge::count();

        app(DryRunRunner::class)->runAndReport([], ['tfidf']);

        $this->assertSame($nodesBefore, Node::count(), 'Dry-run zmazal alebo zlúčil uzol.');
        $this->assertSame($edgesBefore, Edge::count(), 'Dry-run zmazal hranu.');
    }

    public function test_automerge_dry_run_names_the_pair_and_picks_the_stronger_winner(): void
    {
        $this->seedNetwork();

        $results = app(DryRunRunner::class)->run(['automerge'], ['tfidf']);
        $this->assertCount(1, $results);
        $r = $results[0];

        $this->assertSame('automerge', $r->job);
        $this->assertSame('tfidf', $r->metric);
        $this->assertSame(0.92, $r->threshold);
        $this->assertSame(1, $r->affected, 'Presne jeden pár presahuje prah 0.92.');
        $this->assertCount(1, $r->samples);

        $sample = $r->samples[0];
        $this->assertSame('Docker kontajnery', $sample['winner_label']);
        $this->assertSame('Docker kontajnery', $sample['loser_label']);
        // Pri rovnakých labeloch rozlišuje pár až id — preto ho report musí uvádzať,
        // inak by človek nevedel, ktorý z dvoch uzlov zanikne.
        $this->assertNotSame($sample['winner_id'], $sample['loser_id']);
        $this->assertGreaterThan($sample['loser_strength'], $sample['winner_strength'], 'Zostať musí silnejší uzol.');
        $this->assertGreaterThanOrEqual(0.92, $sample['score']);
    }

    public function test_prune_coactivation_dry_run_lists_edges_below_threshold(): void
    {
        $this->seedNetwork();

        $results = app(DryRunRunner::class)->run(['prune-coactivation'], ['tfidf']);
        $r = $results[0];

        $this->assertSame('prune-coactivation', $r->job);
        $this->assertSame(0.08, $r->threshold);
        $this->assertSame(1, $r->affected, 'Nesúvisiaca co-aktivácia by sa prerezala.');
        $this->assertSame(1, $r->kept, 'Podobná co-aktivácia sa ponechá.');
        $this->assertNotEmpty($r->samples[0]['source_label']);
        $this->assertNotEmpty($r->samples[0]['target_label']);
    }

    public function test_cleanup_edges_dry_run_respects_weight_and_age(): void
    {
        $this->seedNetwork();

        $results = app(DryRunRunner::class)->run(['cleanup-edges'], ['tfidf']);
        $r = $results[0];

        $this->assertSame('cleanup-edges', $r->job);
        $this->assertSame(1, $r->affected, 'Len stará slabá AUTO hrana je na zmazanie (ručná a svieža ostávajú).');
        $this->assertCount(1, $r->samples);
        $this->assertSame('similarity', $r->samples[0]['kind']);
        $this->assertStringContainsString('NEPOUŽÍVA', implode(' ', $r->notes));
    }

    public function test_embedding_metric_is_skipped_with_a_reason_when_column_is_missing(): void
    {
        $this->seedNetwork();

        $results = app(DryRunRunner::class)->run(['automerge'], ['embeddings']);

        $this->assertCount(1, $results);
        $this->assertTrue($results[0]->skipped);
        $this->assertStringContainsString('nodes.embedding', $results[0]->skippedReason);
    }

    public function test_report_is_written_to_storage_app_dry_run(): void
    {
        $this->seedNetwork();

        ['files' => $files] = app(DryRunRunner::class)->runAndReport([], ['tfidf']);

        $md = storage_path('app/'.$files['markdown']);
        $json = storage_path('app/'.$files['json']);

        $this->assertFileExists($md);
        $this->assertFileExists($json);

        $text = (string) file_get_contents($md);
        $this->assertStringContainsString('Docker kontajnery', $text, 'Report musí menovať konkrétne páry.');
        $this->assertMatchesRegularExpression('/#\d+ · \d/u', $text, 'Report musí uvádzať id a silu, aby sa dal pár rozlíšiť.');
        $this->assertStringContainsString('VYPNUTÉ', $text, 'Report musí uviesť, že joby sú vypnuté.');

        $payload = json_decode((string) file_get_contents($json), true);
        $this->assertIsArray($payload);
        $this->assertFalse($payload['destructive_enabled']);
        $this->assertSame(0.92, $payload['thresholds']['automerge']);
    }

    public function test_max_pairs_cap_marks_the_result_as_truncated(): void
    {
        $this->seedNetwork();

        $results = app(DryRunRunner::class)->run(
            ['automerge'],
            ['tfidf'],
            (new DryRunOptions)->withMaxPairs(1),
        );

        $this->assertTrue($results[0]->truncated);
        $this->assertStringContainsString('strop', implode(' ', $results[0]->notes));
    }

    public function test_command_runs_and_never_enables_the_jobs(): void
    {
        $this->seedNetwork();

        $exit = Artisan::call('aura:dry-run', ['job' => 'automerge', '--metric' => ['tfidf']]);
        $output = Artisan::output();

        $this->assertSame(0, $exit);
        $this->assertStringContainsString('nič sa nezmení', $output);
        $this->assertFalse((bool) config('maintenance.destructive_enabled'), 'Dry-run nikdy nesmie zapnúť deštruktívne joby.');
    }

    public function test_command_rejects_unknown_job(): void
    {
        $this->assertSame(1, Artisan::call('aura:dry-run', ['job' => 'nonsense']));
    }

    // ------------------------------------------------------------------

    private function seedNetwork(): void
    {
        $area = Area::create(['slug' => 'vyvoj-kod', 'name' => 'Vývoj & kód', 'color' => '#03797e', 'angle' => 342]);

        $mk = fn (array $attrs) => Node::create(array_merge([
            'type' => 'skill',
            'area_id' => $area->id,
            'strength' => 1,
            'last_activated_at' => now(),
        ], $attrs));

        // automerge: ten istý skill zapísaný dvakrát — rovnaký label, popis sa medzitým
        // rozrástol o vetu. Presne takto duplikáty v sieti reálne vznikajú: `mergeInto()`
        // pripája k popisu nový riadok, keď prinesie novú informáciu.
        //
        // Odmerané na tomto korpuse (nie odhadnuté): rovnaký label + odlišný popis dá
        // kosínus 0.95, kým rozdiel JEDNÉHO slova v labeli („kópia") skóre zhodí na 0.79 —
        // to slovo je v malom korpuse unikátne, má teda vysoké IDF, a label sa vo `nodeTf()`
        // navyše váži a rozkladá na bigramy. Predchádzajúca verzia fixture stavala na tom,
        // že „identický popis ⇒ kosínus 1.0", čo platí len keď je korpus dvojprvkový.
        $winner = $mk(['label' => 'Docker kontajnery', 'description' => 'Docker compose, healthcheck, bind mount, volume.', 'strength' => 4]);
        $mk(['label' => 'Docker kontajnery', 'description' => 'Docker compose, healthcheck, bind mount, volume. Restart policy always.', 'strength' => 1]);

        // nesúvisiaci uzol pod prahom
        $unrelated = $mk(['label' => 'Fotografovanie šperkov', 'description' => 'Svetlo, statív, makro objektív.']);

        // session záznam — z kandidátov automerge musí byť vylúčený
        $mk(['type' => 'memory', 'source' => 'session', 'label' => 'Docker kontajnery', 'description' => 'Docker compose, healthcheck, bind mount, volume.']);

        $similar = $mk(['label' => 'Docker healthcheck', 'description' => 'Docker compose, healthcheck, bind mount, volume.']);

        // prune-coactivation: jednorazová co-aktivácia nesúvisiacich uzlov ⇒ prerezať
        Edge::create([
            'source_id' => min($winner->id, $unrelated->id),
            'target_id' => max($winner->id, $unrelated->id),
            'kind' => 'co_activation',
            'auto' => true,
            'weight' => 1,
            'last_activated_at' => now(),
        ]);
        // jednorazová co-aktivácia podobných uzlov ⇒ ponechať
        Edge::create([
            'source_id' => min($winner->id, $similar->id),
            'target_id' => max($winner->id, $similar->id),
            'kind' => 'co_activation',
            'auto' => true,
            'weight' => 1,
            'last_activated_at' => now(),
        ]);

        $fresh = $mk(['label' => 'Caddy proxy', 'description' => 'Reverse proxy, basic-auth, TLS.']);

        // cleanup-edges: stará slabá auto similarity hrana ⇒ zmazať
        Edge::create([
            'source_id' => min($unrelated->id, $similar->id),
            'target_id' => max($unrelated->id, $similar->id),
            'kind' => 'similarity',
            'auto' => true,
            'weight' => 0.5,
            'last_activated_at' => now()->subDays(200),
        ]);
        // slabá, ale svieža ⇒ ponechať (vek nesplnený)
        Edge::create([
            'source_id' => min($fresh->id, $winner->id),
            'target_id' => max($fresh->id, $winner->id),
            'kind' => 'similarity',
            'auto' => true,
            'weight' => 0.5,
            'last_activated_at' => now(),
        ]);
        // stará, ale ručná ⇒ ponechať (auto = false)
        Edge::create([
            'source_id' => min($fresh->id, $unrelated->id),
            'target_id' => max($fresh->id, $unrelated->id),
            'kind' => 'manual',
            'auto' => false,
            'weight' => 0.5,
            'last_activated_at' => now()->subDays(200),
        ]);
    }
}
