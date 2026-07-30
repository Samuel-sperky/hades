<?php

namespace Tests\Feature\Maintenance;

use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\Calibration\PairRisk;
use App\Services\Maintenance\Calibration\ThresholdSweep;
use App\Services\Maintenance\Metric\TfidfMetric;
use App\Services\SimilarityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * Kalibrácia prahov (VLNA2, agent KALIBRACIA).
 *
 * Dve tvrdenia, na ktorých stojí použiteľnosť sweepu:
 *   1) NIČ NEZMENÍ — počty uzlov a hrán sú pred aj po behu rovnaké,
 *   2) pri prahu z configu dá sweep ROVNAKÉ číslo ako dnešný dry-run. Keby sa
 *      rozchádzali, kalibračný report by rozhodoval o inom jobe, než aký beží.
 */
class ThresholdSweepTest extends TestCase
{
    use RefreshDatabase;

    private function sweep(): ThresholdSweep
    {
        return app(ThresholdSweep::class);
    }

    private function metric(): TfidfMetric
    {
        return new TfidfMetric(app(SimilarityService::class));
    }

    public function test_sweep_changes_nothing(): void
    {
        $this->seedNetwork();
        $nodesBefore = Node::count();
        $edgesBefore = Edge::count();

        $this->sweep()->automerge($this->metric(), [0.80, 0.92], 0.50);
        $this->sweep()->pruneCoactivation($this->metric(), [0.08, 0.40]);
        $this->sweep()->cleanupEdges([1.0], [90]);

        $this->assertSame($nodesBefore, Node::count(), 'Sweep zlúčil alebo zmazal uzol.');
        $this->assertSame($edgesBefore, Edge::count(), 'Sweep zmazal hranu.');
    }

    public function test_sweep_at_config_threshold_matches_the_dry_run(): void
    {
        $this->seedNetwork();

        $sweepResult = $this->sweep()->automerge($this->metric(), [0.92], 0.50);
        $dryRun = app(\App\Services\Maintenance\DryRun\DryRunRunner::class)->run(['automerge'], ['tfidf'])[0];

        $this->assertSame(
            $dryRun->affected,
            $sweepResult['by_threshold']['0.92']['merges'],
            'Sweep pri prahu z configu musí dať rovnaké číslo ako dry-run.',
        );

        // `compared` sa zámerne NEROVNÁ: dry-run preskočí páry, ktorých koniec už
        // bol pohltený (a teda ich nepočíta), kým sweep musí ohodnotiť VŠETKY páry,
        // inak by rozdelenie skóre malo dieru. Rozhodnutie je rovnaké, pokrytie väčšie.
        $this->assertGreaterThanOrEqual($dryRun->compared, $sweepResult['compared']);
    }

    public function test_lower_threshold_never_merges_less(): void
    {
        $this->seedNetwork();

        $r = $this->sweep()->automerge($this->metric(), [0.70, 0.80, 0.92], 0.50);

        $merges = array_map(fn ($x) => $x['merges'], array_values($r['by_threshold']));
        // monotónnosť: prahy sú zoradené vzostupne, počty musia byť nerastúce
        for ($i = 1; $i < count($merges); $i++) {
            $this->assertLessThanOrEqual($merges[$i - 1], $merges[$i], 'Vyšší prah nesmie zlúčiť viac párov.');
        }
    }

    public function test_prune_sweep_is_monotone_and_exact(): void
    {
        $this->seedNetwork();

        $r = $this->sweep()->pruneCoactivation($this->metric(), [0.02, 0.08, 0.50]);

        // Pozor: TF-IDF skóre 0.0 je legitímne (dva uzly bez spoločného tokenu), takže
        // „prah pod minimom" neexistuje — pri 0.02 už niečo padne. Invariant je
        // monotónnosť a to, že sa žiadna hrana nestratí ani nezdvojí.
        $this->assertGreaterThan(0, $r['by_threshold']['0.50']['pruned'], 'Pri vysokom prahu sa prereže viac.');
        $this->assertLessThanOrEqual(
            $r['by_threshold']['0.08']['pruned'],
            $r['by_threshold']['0.50']['pruned'],
        );
        $this->assertLessThanOrEqual(
            $r['by_threshold']['0.02']['pruned'],
            $r['by_threshold']['0.08']['pruned'],
        );
        // exaktnosť: každá hrana je buď prerezaná, alebo ponechaná — nič sa nestratí
        foreach ($r['by_threshold'] as $b) {
            $this->assertSame($r['candidates'], $b['pruned'] + $b['kept']);
        }
    }

    public function test_distribution_reports_percentiles_and_tails(): void
    {
        $histogram = array_fill(0, 101, 0);
        $histogram[10] = 90;   // 0.10 × 90
        $histogram[80] = 10;   // 0.80 × 10

        $d = $this->sweep()->describe($histogram);

        $this->assertSame(100, $d['total']);
        $this->assertSame(0.10, $d['min']);
        $this->assertSame(0.80, $d['max']);
        $this->assertSame(0.10, $d['p50']);
        $this->assertSame(10, $d['pairs_at_or_above']['0.80']);
        $this->assertSame(0, $d['pairs_at_or_above']['0.85']);
    }

    public function test_empty_histogram_does_not_divide_by_zero(): void
    {
        $this->assertSame(['total' => 0], $this->sweep()->describe(array_fill(0, 101, 0)));
    }

    // ------------------------------------------------------------------
    // PairRisk — poučka o Canve je celý dôvod, prečo tento sweep existuje
    // ------------------------------------------------------------------

    public function test_canva_pattern_is_flagged_high_risk(): void
    {
        $area = Area::create(['slug' => 'dizajn', 'name' => 'Dizajn', 'color' => '#03797e', 'angle' => 10]);

        $canvas = Node::create(['type' => 'skill', 'area_id' => $area->id, 'label' => 'Canvas visualization (d3-force)', 'strength' => 5, 'last_activated_at' => now()]);
        $canva = Node::create(['type' => 'skill', 'area_id' => $area->id, 'label' => 'Canva', 'strength' => 1, 'last_activated_at' => now()]);

        $risk = app(PairRisk::class)->assess($canvas, $canva);

        $this->assertSame('high', $risk['level'], 'Canva/Canvas musí byť označené ako rizikové.');
        $this->assertStringContainsString('Canva', implode(' ', $risk['reasons']));
    }

    public function test_label_guard_matches_mind_service_rule(): void
    {
        $risk = app(PairRisk::class);

        // presne ten test, ktorý má MindService::findByLabel
        $this->assertFalse($risk->passesLabelGuard('canva', 'canvas visualization (d3-force)'));
        $this->assertTrue($risk->passesLabelGuard('docker kontajnery', 'docker kontajnery'));
    }

    public function test_different_dates_in_labels_are_high_risk(): void
    {
        $a = Node::create(['type' => 'memory', 'label' => 'CEO SEO report 27.7.2026 dáta', 'strength' => 1, 'last_activated_at' => now()]);
        $b = Node::create(['type' => 'memory', 'label' => 'CEO SEO report 30.7.2026 dáta', 'strength' => 1, 'last_activated_at' => now()]);

        $risk = app(PairRisk::class)->assess($a, $b);

        $this->assertSame('high', $risk['level'], 'Dva reporty z rôznych dní nie sú duplikát.');
        $this->assertStringContainsString('RÔZNE čísla', implode(' ', $risk['reasons']));
    }

    public function test_two_projects_from_one_naming_template_are_high_risk(): void
    {
        $a = Node::create(['type' => 'project', 'label' => 'Aura Banner Studio (A1 skeleton)', 'strength' => 1, 'last_activated_at' => now()]);
        $b = Node::create(['type' => 'project', 'label' => 'Aura Retouch Studio (A1 skeleton)', 'strength' => 1, 'last_activated_at' => now()]);

        $risk = app(PairRisk::class)->assess($a, $b);

        $this->assertSame('high', $risk['level'], 'Dva rôzne projekty nesmú prejsť ako duplikát.');
        $this->assertStringContainsString('PROJEKTY', implode(' ', $risk['reasons']));
    }

    public function test_pinned_and_verified_losers_are_flagged(): void
    {
        $winner = Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'strength' => 4, 'last_activated_at' => now()]);
        $pinned = Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'strength' => 1, 'pinned' => true, 'last_activated_at' => now()]);

        $risk = app(PairRisk::class)->assess($winner, $pinned);
        $this->assertSame('high', $risk['level']);
        $this->assertStringContainsString('PRIPNUTÝ', implode(' ', $risk['reasons']));

        $verified = Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'strength' => 1, 'verified_at' => now(), 'last_activated_at' => now()]);
        $risk = app(PairRisk::class)->assess($winner, $verified);
        $this->assertSame('high', $risk['level']);
        $this->assertStringContainsString('overený', implode(' ', $risk['reasons']));
    }

    public function test_true_duplicate_is_not_flagged(): void
    {
        $area = Area::create(['slug' => 'vyvoj', 'name' => 'Vývoj', 'color' => '#03797e', 'angle' => 10]);
        $dep = Department::create(['area_id' => $area->id, 'slug' => 'backend', 'name' => 'Backend']);

        $winner = Node::create(['type' => 'skill', 'area_id' => $area->id, 'department_id' => $dep->id, 'label' => 'Docker kontajnery', 'strength' => 4, 'last_activated_at' => now()]);
        $loser = Node::create(['type' => 'skill', 'area_id' => $area->id, 'department_id' => $dep->id, 'label' => 'Docker kontajnery', 'strength' => 1, 'last_activated_at' => now()]);

        $risk = app(PairRisk::class)->assess($winner, $loser);

        $this->assertSame('ok', $risk['level'], 'Skutočný duplikát nesmie byť označený ako rizikový: '.implode(' | ', $risk['reasons']));
    }

    public function test_strong_loser_is_flagged_even_for_identical_labels(): void
    {
        $winner = Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'strength' => 9, 'last_activated_at' => now()]);
        $loser = Node::create(['type' => 'skill', 'label' => 'Docker kontajnery', 'strength' => 6, 'last_activated_at' => now()]);

        $risk = app(PairRisk::class)->assess($winner, $loser);

        $this->assertSame('high', $risk['level'], 'Pohltenie uzla so silou 6 je vždy na rozhodnutie človeka.');
    }

    // ------------------------------------------------------------------

    public function test_command_runs_and_leaves_counts_and_config_untouched(): void
    {
        $this->seedNetwork();
        $nodesBefore = Node::count();
        $edgesBefore = Edge::count();

        $out = 'calib-test-'.uniqid().'.json';
        $exit = Artisan::call('aura:calibrate', [
            '--metric' => 'tfidf',
            '--thresholds' => '0.80,0.92',
            '--prune-thresholds' => '0.08,0.40',
            '--floor' => '0.5',
            '--samples' => '5',
            '--out' => $out,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exit, $output);
        $this->assertStringContainsString('nič sa nezmení', $output);
        $this->assertSame($nodesBefore, Node::count());
        $this->assertSame($edgesBefore, Edge::count());

        // železné pravidlo: prahy v configu sa nemenia a joby zostávajú vypnuté
        $this->assertSame(0.92, (float) config('maintenance.thresholds.automerge'));
        $this->assertSame(0.08, (float) config('maintenance.thresholds.prune_coactivation'));
        $this->assertFalse((bool) config('maintenance.destructive_enabled'));

        $path = storage_path('app/'.$out);
        $this->assertFileExists($path);
        $payload = json_decode((string) file_get_contents($path), true);
        $this->assertFalse($payload['destructive_enabled']);
        $this->assertArrayHasKey('0.92', $payload['automerge']['by_threshold']);
        @unlink($path);
    }

    public function test_command_rejects_unknown_metric(): void
    {
        $this->assertSame(1, Artisan::call('aura:calibrate', ['--metric' => 'nonsense']));
    }

    public function test_command_reports_unavailable_embeddings_instead_of_crashing(): void
    {
        $this->seedNetwork();

        // v testovacej schéme nemá žiadny uzol vektor → metrika je nedostupná
        $exit = Artisan::call('aura:calibrate', ['--metric' => 'embeddings']);

        $this->assertSame(2, $exit);
        $this->assertStringContainsString('nie je dostupná', Artisan::output());
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

        $winner = $mk(['label' => 'Docker kontajnery', 'description' => 'Docker compose, healthcheck, bind mount, volume.', 'strength' => 4]);
        $mk(['label' => 'Docker kontajnery', 'description' => 'Docker compose, healthcheck, bind mount, volume. Restart policy always.', 'strength' => 1]);

        $unrelated = $mk(['label' => 'Fotografovanie šperkov', 'description' => 'Svetlo, statív, makro objektív.']);
        $similar = $mk(['label' => 'Docker healthcheck', 'description' => 'Docker compose, healthcheck, bind mount, volume.']);

        Edge::create([
            'source_id' => min($winner->id, $unrelated->id),
            'target_id' => max($winner->id, $unrelated->id),
            'kind' => 'co_activation', 'auto' => true, 'weight' => 1, 'last_activated_at' => now(),
        ]);
        Edge::create([
            'source_id' => min($winner->id, $similar->id),
            'target_id' => max($winner->id, $similar->id),
            'kind' => 'co_activation', 'auto' => true, 'weight' => 1, 'last_activated_at' => now(),
        ]);
        Edge::create([
            'source_id' => min($unrelated->id, $similar->id),
            'target_id' => max($unrelated->id, $similar->id),
            'kind' => 'similarity', 'auto' => true, 'weight' => 0.5, 'last_activated_at' => now()->subDays(200),
        ]);
    }
}
