<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Decision;
use App\Models\Edge;
use App\Models\Node;
use App\Models\SyncRun;
use Illuminate\Http\JsonResponse;

/**
 * Jednotný dashboard payload (§4.4) — jeden zdroj pre interné GET /api/dashboard
 * (SPA „Dnes", bez tokenu) aj externé GET /api/v1/stats (Bearer token). Ťažké
 * agregáty (365-dňová heatmapa aktivity, kumulatívny rast, donut istoty +
 * per-area bary) žijú TU, aby /api/today ostal ľahký.
 *
 * Všetky dátumové agregáty používajú len DATE() (cross-DB: MariaDB aj sqlite),
 * mesačné buckety sa skladajú v PHP — žiadny DATE_FORMAT / strftime rozkol.
 */
class StatsController extends Controller
{
    /** Skratky mesiacov (index 0 = január) pre heatmap.months. */
    private const MONTHS = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec'];

    public function index(): JsonResponse
    {
        return response()->json($this->dashboard());
    }

    /**
     * @return array<string, mixed>
     */
    public function dashboard(): array
    {
        $totalNodes = Node::count();
        $brain = Node::where('origin', 'brain')->count();

        return [
            'heatmap' => $this->heatmap(),
            'growth' => $this->growth(),
            'certainty' => $this->certainty($totalNodes),
            'per_area' => $this->perArea(),
            'counts' => [
                'nodes' => $totalNodes,
                'edges' => Edge::count(),
                'decisions' => Decision::count(),
                'brain' => $brain,
                'session' => max(0, $totalNodes - $brain),
            ],
            'sync' => $this->sync(),
            'brain_write_enabled' => (bool) config('hades.allow_brain_write'),
        ];
    }

    /**
     * 365-dňová GitHub-style heatmapa aktivity (aktivácie / deň). Mriežka je
     * zarovnaná na nedeľné stĺpce; bunky mimo rozsahu = null (charts.js → .out).
     *
     * @return array{weeks: list<list<array{date: string, count: int, level: int}|null>>, months: array<string, string>, total: int}
     */
    private function heatmap(): array
    {
        $today = today();
        $rangeStart = $today->copy()->subDays(364);
        // späť na nedeľu (dayOfWeek: 0 = nedeľa) → celé týždňové stĺpce
        $gridStart = $rangeStart->copy()->subDays($rangeStart->dayOfWeek);

        $counts = Activation::query()
            ->where('created_at', '>=', $rangeStart)
            ->selectRaw('DATE(created_at) as d, COUNT(*) as c')
            ->groupBy('d')
            ->pluck('c', 'd');

        $weeks = [];
        $months = [];
        $total = 0;
        $lastMonth = null;
        $col = 0;
        $cursor = $gridStart->copy();

        while ($cursor <= $today) {
            $colFirst = $cursor->copy();
            $week = [];

            for ($row = 0; $row < 7; $row++) {
                if ($cursor < $rangeStart || $cursor > $today) {
                    $week[] = null;
                } else {
                    $ds = $cursor->format('Y-m-d');
                    $cnt = (int) ($counts[$ds] ?? 0);
                    $total += $cnt;
                    $week[] = ['date' => $ds, 'count' => $cnt, 'level' => $this->heatLevel($cnt)];
                }
                $cursor->addDay();
            }

            // mesiac stĺpca podľa jeho prvého dňa; label len keď sa mesiac zmení
            $month = (int) $colFirst->format('n');
            if ($month !== $lastMonth) {
                $months[(string) $col] = self::MONTHS[$month - 1];
                $lastMonth = $month;
            }

            $weeks[] = $week;
            $col++;
        }

        return ['weeks' => $weeks, 'months' => $months, 'total' => $total];
    }

    /** Úroveň 0–4 z denného počtu aktivít (počíta backend, nie frontend). */
    private function heatLevel(int $count): int
    {
        return match (true) {
            $count <= 0 => 0,
            $count <= 2 => 1,
            $count <= 5 => 2,
            $count <= 10 => 3,
            default => 4,
        };
    }

    /**
     * Kumulatívny rast počtu uzlov za posledných 12 mesiacov.
     *
     * @return array{labels: list<string>, values: list<int>}
     */
    private function growth(): array
    {
        $monthsBack = 11;
        $firstMonth = today()->startOfMonth()->subMonths($monthsBack);

        $baseline = Node::where('created_at', '<', $firstMonth)->count();

        $perDay = Node::query()
            ->where('created_at', '>=', $firstMonth)
            ->selectRaw('DATE(created_at) as d, COUNT(*) as c')
            ->groupBy('d')
            ->pluck('c', 'd');

        $byMonth = [];
        foreach ($perDay as $d => $c) {
            $ym = substr((string) $d, 0, 7);
            $byMonth[$ym] = ($byMonth[$ym] ?? 0) + (int) $c;
        }

        $labels = [];
        $values = [];
        $cum = $baseline;
        $month = $firstMonth->copy();

        for ($i = 0; $i <= $monthsBack; $i++) {
            $ym = $month->format('Y-m');
            $cum += $byMonth[$ym] ?? 0;
            $labels[] = $ym;
            $values[] = $cum;
            $month->addMonth();
        }

        return ['labels' => $labels, 'values' => $values];
    }

    /**
     * Rozdelenie istoty naprieč VŠETKÝMI uzlami (donut). `bez` = zvyšok do total
     * (uzly bez certainty), takže segmenty vždy súčtom sedia s total.
     *
     * @return array{overene: int, hypoteza: int, pasca: int, bez: int, total: int, needs_review: int}
     */
    private function certainty(int $totalNodes): array
    {
        $counts = Node::query()
            ->selectRaw('certainty, COUNT(*) as c')
            ->groupBy('certainty')
            ->pluck('c', 'certainty');

        $overene = (int) ($counts['overene'] ?? 0);
        $hypoteza = (int) ($counts['hypoteza'] ?? 0);
        $pasca = (int) ($counts['pasca'] ?? 0);

        return [
            'overene' => $overene,
            'hypoteza' => $hypoteza,
            'pasca' => $pasca,
            'bez' => max(0, $totalNodes - $overene - $hypoteza - $pasca),
            'total' => $totalNodes,
            'needs_review' => Node::where('needs_review', true)->count(),
        ];
    }

    /**
     * Per-oblasť: počet uzlov + rozklad istoty (bary Dnes). Prázdne oblasti sa
     * vynechajú. Kľúč `per_area` (NIE by_area) je autoritatívny (§4.2).
     *
     * @return list<array{slug: string, name: string, color: ?string, count: int, overene: int, hypoteza: int, pasca: int, bez: int}>
     */
    private function perArea(): array
    {
        $rows = Node::query()
            ->selectRaw('area_id, certainty, COUNT(*) as c')
            ->whereNotNull('area_id')
            ->groupBy('area_id', 'certainty')
            ->get();

        $byArea = [];
        foreach ($rows as $r) {
            $aid = $r->area_id;
            $byArea[$aid] ??= ['overene' => 0, 'hypoteza' => 0, 'pasca' => 0, 'total' => 0];
            $c = (int) $r->c;
            $byArea[$aid]['total'] += $c;
            if (in_array($r->certainty, ['overene', 'hypoteza', 'pasca'], true)) {
                $byArea[$aid][$r->certainty] += $c;
            }
        }

        return Area::orderBy('angle')->get()
            ->map(function (Area $a) use ($byArea) {
                $d = $byArea[$a->id] ?? ['overene' => 0, 'hypoteza' => 0, 'pasca' => 0, 'total' => 0];

                return [
                    'slug' => $a->slug,
                    'name' => $a->name,
                    'color' => $a->color,
                    'count' => $d['total'],
                    'overene' => $d['overene'],
                    'hypoteza' => $d['hypoteza'],
                    'pasca' => $d['pasca'],
                    'bez' => max(0, $d['total'] - $d['overene'] - $d['hypoteza'] - $d['pasca']),
                ];
            })
            ->filter(fn (array $x) => $x['count'] > 0)
            ->values()
            ->all();
    }

    /**
     * Posledný beh brain-sync (stav karty Sync na Dnes).
     *
     * @return array<string, mixed>
     */
    private function sync(): array
    {
        $run = SyncRun::latest('id')->first();
        $stats = is_array($run?->stats) ? $run->stats : [];

        return [
            'status' => $run?->status,
            'finished_at' => $run?->finished_at?->toIso8601String(),
            'created' => (int) ($stats['created'] ?? 0),
            'updated' => (int) ($stats['updated'] ?? 0),
            'deleted' => (int) ($stats['deleted'] ?? 0),
            'skipped' => (int) ($stats['skipped'] ?? 0),
            'message' => $run?->message,
            'brain_write_enabled' => (bool) config('hades.allow_brain_write'),
        ];
    }
}
