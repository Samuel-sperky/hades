<?php

namespace App\Services\Maintenance\Calibration;

use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\Metric\SimilarityMetric;
use Illuminate\Support\Collection;

/**
 * Kalibrácia prahov: pre KAŽDÝ zadaný prah spočíta, čo by daný deštruktívny job
 * urobil, a k tomu vráti celé rozdelenie skóre.
 *
 * Prečo nestačí `aura:dry-run` spustený viackrát: dry-run číta jeden prah z configu
 * a prahy sa podľa železného pravidla nesmú v configu meniť. Sweep preto spočíta
 * skóre párov RAZ a potom len prehráva rozhodovanie pri rôznych prahoch — je to
 * aj rádovo lacnejšie (jedna O(n²) slučka namiesto šiestich).
 *
 * Dôvod, prečo sa prahy vôbec musia prekalibrovať, je v docs/BENCHMARK-LLM.md §3:
 * bge-m3 má nezhodné SK↔EN páry na ~0,35 a zhodné na ~0,77. Prah 0.08 z TF-IDF by
 * na tejto škále neprerezal nič a prah 0.20 by prepojil všetko so všetkým.
 *
 * NIČ NEMENÍ. Iba SELECT-y; žiadny zápis, žiadne mazanie, žiadne zlučovanie.
 */
class ThresholdSweep
{
    public function __construct(private PairRisk $risk) {}

    /**
     * Automerge sweep. Kandidáti, zoskupenie podľa typu a poradie dvojitej slučky
     * sú prevzaté 1:1 z MindAutomerge, takže „merges" pri prahu 0.92 na TF-IDF
     * musí vyjsť rovnako ako dnešný dry-run.
     *
     * @param  list<float>  $thresholds
     * @param  float  $floor  pod týmto skóre sa pár neuchováva (musí byť <= min($thresholds))
     * @return array<string, mixed>
     */
    public function automerge(SimilarityMetric $metric, array $thresholds, float $floor = 0.50, int $samplesPerThreshold = 60): array
    {
        sort($thresholds);
        $floor = min($floor, $thresholds === [] ? $floor : (float) $thresholds[0]);

        $nodes = Node::query()
            ->where('type', '!=', 'core')
            ->where(function ($q) {
                $q->whereNull('source')->orWhere('source', '!=', 'session');
            })
            ->get();

        $metric->warm($nodes);

        $histogram = array_fill(0, 101, 0);
        $compared = 0;
        $undecided = 0;
        /** @var list<array{gi:int,i:int,j:int,score:float}> $kept poradie = poradie príkazu */
        $kept = [];

        $groups = $nodes->groupBy('type')->values()->map(fn ($g) => $g->values());

        foreach ($groups as $gi => $group) {
            $n = $group->count();
            for ($i = 0; $i < $n - 1; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $compared++;
                    $score = $metric->score($group[$i], $group[$j]);
                    if ($score === null) {
                        $undecided++;

                        continue;
                    }
                    $histogram[(int) round(max(0.0, min(1.0, $score)) * 100)]++;
                    if ($score >= $floor) {
                        $kept[] = ['gi' => (int) $gi, 'i' => $i, 'j' => $j, 'score' => (float) $score];
                    }
                }
            }
        }

        $byThreshold = [];
        foreach ($thresholds as $t) {
            $byThreshold[$this->key($t)] = $this->replayAutomerge($groups, $kept, (float) $t, $samplesPerThreshold);
        }

        return [
            'metric' => $metric->name(),
            'candidates' => $nodes->count(),
            'compared' => $compared,
            'undecided' => $undecided,
            'floor' => $floor,
            'histogram' => $histogram,
            'distribution' => $this->describe($histogram),
            'by_threshold' => $byThreshold,
        ];
    }

    /**
     * Prehrá greedy zlučovanie pri jednom prahu. Poradie je identické s príkazom,
     * takže aj „ktorý uzol prehrá" vyjde rovnako.
     *
     * @param  Collection<int, Collection<int, Node>>  $groups
     * @param  list<array{gi:int,i:int,j:int,score:float}>  $pairs
     * @return array<string, mixed>
     */
    private function replayAutomerge(Collection $groups, array $pairs, float $threshold, int $sampleLimit): array
    {
        $gone = [];
        $merges = 0;
        $risky = 0;
        $samples = [];
        $riskLevels = ['high' => 0, 'medium' => 0, 'ok' => 0];

        foreach ($pairs as $p) {
            if ($p['score'] < $threshold) {
                continue;
            }

            /** @var Node $a */
            $a = $groups[$p['gi']][$p['i']];
            /** @var Node $b */
            $b = $groups[$p['gi']][$p['j']];

            if (isset($gone[$a->id]) || isset($gone[$b->id])) {
                continue;
            }

            [$winner, $loser] = (float) $a->strength >= (float) $b->strength ? [$a, $b] : [$b, $a];
            $gone[$loser->id] = true;
            $merges++;

            $assessment = $this->risk->assess($winner, $loser);
            $riskLevels[$assessment['level']]++;
            if ($assessment['level'] !== 'ok') {
                $risky++;
            }

            if ($sampleLimit <= 0 || count($samples) < $sampleLimit) {
                $samples[] = [
                    'score' => round($p['score'], 4),
                    'type' => (string) $a->type,
                    'winner_id' => $winner->id,
                    'winner_label' => (string) $winner->label,
                    'winner_strength' => (float) $winner->strength,
                    'loser_id' => $loser->id,
                    'loser_label' => (string) $loser->label,
                    'loser_strength' => (float) $loser->strength,
                    'risk' => $assessment['level'],
                    'risk_reasons' => $assessment['reasons'],
                ];
            }
        }

        // najzaujímavejšie sú rizikové páry a najnižšie skóre nad prahom
        usort($samples, function ($x, $y) {
            $rank = ['high' => 0, 'medium' => 1, 'ok' => 2];

            return [$rank[$x['risk']], $x['score']] <=> [$rank[$y['risk']], $y['score']];
        });

        return [
            'threshold' => $threshold,
            'merges' => $merges,
            'nodes_lost' => count($gone),
            'risky' => $risky,
            'risk_levels' => $riskLevels,
            'samples' => $samples,
        ];
    }

    /**
     * Prune-coactivation sweep. Exaktné — vyhodnocuje sa presne toľko hrán, koľko
     * je jednorazových co-aktivácií, takže tu nie je žiadna extrapolácia.
     *
     * @param  list<float>  $thresholds
     * @return array<string, mixed>
     */
    public function pruneCoactivation(SimilarityMetric $metric, array $thresholds, int $samplesPerThreshold = 40): array
    {
        sort($thresholds);

        $metric->warm(Node::query()->get());

        $edges = Edge::query()
            ->where('kind', 'co_activation')
            ->where('weight', '<=', 1)
            ->orderBy('id')
            ->get();

        $ids = $edges->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])->unique()->all();
        $byId = Node::query()->whereIn('id', $ids)->get()->keyBy('id');

        $histogram = array_fill(0, 101, 0);
        $scored = [];
        $undecided = 0;
        $orphans = 0;

        foreach ($edges as $edge) {
            $source = $byId->get($edge->source_id);
            $target = $byId->get($edge->target_id);
            if (! $source || ! $target) {
                $orphans++;

                continue;
            }

            $score = $metric->score($source, $target);
            if ($score === null) {
                $undecided++;

                continue;
            }

            $histogram[(int) round(max(0.0, min(1.0, $score)) * 100)]++;
            $scored[] = [
                'score' => (float) $score,
                'edge_id' => $edge->id,
                'weight' => (float) $edge->weight,
                'source_id' => $source->id,
                'source_label' => (string) $source->label,
                'target_id' => $target->id,
                'target_label' => (string) $target->label,
                'shared_tokens' => $this->risk->sharedTokens(
                    mb_strtolower((string) $source->label),
                    mb_strtolower((string) $target->label),
                ),
                'last_activated_at' => $edge->last_activated_at?->toIso8601String(),
            ];
        }

        usort($scored, fn ($x, $y) => $x['score'] <=> $y['score']);

        $byThreshold = [];
        foreach ($thresholds as $t) {
            $t = (float) $t;
            $hit = array_values(array_filter($scored, fn ($s) => $s['score'] < $t));
            $byThreshold[$this->key($t)] = [
                'threshold' => $t,
                'pruned' => count($hit),
                'kept' => count($scored) - count($hit) + $undecided + $orphans,
                // najvyššie skóre pod prahom = najbolestivejšia strata, preto od konca
                'samples' => array_slice(array_reverse($hit), 0, max(0, $samplesPerThreshold)),
            ];
        }

        return [
            'metric' => $metric->name(),
            'candidates' => $edges->count(),
            'compared' => count($scored),
            'undecided' => $undecided,
            'orphans' => $orphans,
            'histogram' => $histogram,
            'distribution' => $this->describe($histogram),
            'by_threshold' => $byThreshold,
        ];
    }

    /**
     * Cleanup-edges sweep. Tento job podobnosť NEPOUŽÍVA — rozhoduje váha a vek,
     * takže mriežka je (max_weight × older_than_days) a prechod na embeddingy s ním
     * nemá nič spoločné. Skóre sa dopĺňa len informatívne.
     *
     * @param  list<float>  $weights
     * @param  list<int>  $days
     * @return array<string, mixed>
     */
    public function cleanupEdges(array $weights, array $days, ?SimilarityMetric $metric = null, int $sampleLimit = 40): array
    {
        $grid = [];
        $ages = [];

        foreach ($weights as $w) {
            $w = (float) $w;
            foreach ($days as $d) {
                $d = (int) $d;
                $cutoff = now()->subDays($d);

                $base = Edge::query()
                    ->where('auto', true)
                    ->whereIn('kind', ['similarity', 'co_activation'])
                    ->where('weight', '<', $w);

                $grid[] = [
                    'max_weight' => $w,
                    'older_than_days' => $d,
                    'candidates' => (int) (clone $base)->count(),
                    'deleted' => (int) (clone $base)->where('last_activated_at', '<', $cutoff)->count(),
                    'cutoff' => $cutoff->toDateString(),
                ];
            }
        }

        // Prečo cleanup dnes maže 0: rozhoduje vek. Toto je dôkaz, nie dohad.
        $auto = Edge::query()
            ->where('auto', true)
            ->whereIn('kind', ['similarity', 'co_activation']);

        $ages = [
            'auto_similarity_coactivation' => (int) (clone $auto)->count(),
            'weight_below_1' => (int) (clone $auto)->where('weight', '<', 1.0)->count(),
            'null_last_activated' => (int) (clone $auto)->whereNull('last_activated_at')->count(),
            'oldest_last_activated' => (clone $auto)->min('last_activated_at'),
            'newest_last_activated' => (clone $auto)->max('last_activated_at'),
        ];

        $samples = [];
        $doomed = Edge::query()
            ->where('auto', true)
            ->whereIn('kind', ['similarity', 'co_activation'])
            ->where('weight', '<', 1.0)
            ->orderBy('last_activated_at')
            ->limit(max(0, $sampleLimit))
            ->get();

        $ids = $doomed->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])->unique()->all();
        $byId = Node::query()->whereIn('id', $ids)->get()->keyBy('id');

        foreach ($doomed as $edge) {
            $samples[] = [
                'edge_id' => $edge->id,
                'kind' => (string) $edge->kind,
                'weight' => (float) $edge->weight,
                'last_activated_at' => $edge->last_activated_at?->toIso8601String(),
                'source_label' => (string) ($byId->get($edge->source_id)->label ?? '—'),
                'target_label' => (string) ($byId->get($edge->target_id)->label ?? '—'),
            ];
        }

        return [
            'metric' => 'n/a (rozhoduje váha a vek)',
            'grid' => $grid,
            'edge_ages' => $ages,
            'oldest_samples' => $samples,
        ];
    }

    /**
     * Percentily a chvosty rozdelenia — bez nich sa prah nedá zvoliť, len uhádnuť.
     *
     * @param  array<int, int>  $histogram
     * @return array<string, mixed>
     */
    public function describe(array $histogram): array
    {
        $total = array_sum($histogram);
        if ($total === 0) {
            return ['total' => 0];
        }

        $percentile = function (float $q) use ($histogram, $total): float {
            $target = $q * $total;
            $acc = 0;
            foreach ($histogram as $bucket => $count) {
                $acc += $count;
                if ($acc >= $target) {
                    return $bucket / 100;
                }
            }

            return 1.0;
        };

        $min = 1.0;
        $max = 0.0;
        $sum = 0.0;
        foreach ($histogram as $bucket => $count) {
            if ($count === 0) {
                continue;
            }
            $min = min($min, $bucket / 100);
            $max = max($max, $bucket / 100);
            $sum += ($bucket / 100) * $count;
        }

        $above = [];
        foreach ([0.30, 0.35, 0.40, 0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.88, 0.90, 0.92, 0.95] as $t) {
            $c = 0;
            foreach ($histogram as $bucket => $count) {
                if ($bucket / 100 >= $t) {
                    $c += $count;
                }
            }
            $above[$this->key($t)] = $c;
        }

        return [
            'total' => $total,
            'min' => round($min, 3),
            'max' => round($max, 3),
            'mean' => round($sum / $total, 4),
            'p50' => $percentile(0.50),
            'p90' => $percentile(0.90),
            'p99' => $percentile(0.99),
            'p999' => $percentile(0.999),
            'pairs_at_or_above' => $above,
        ];
    }

    private function key(float $t): string
    {
        return number_format($t, 2, '.', '');
    }
}
