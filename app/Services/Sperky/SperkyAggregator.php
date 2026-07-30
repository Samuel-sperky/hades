<?php

namespace App\Services\Sperky;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\Similarity\TaxonomyResolver;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Mesačné súhrny e-shopu ako `memory` uzly vo vedomí.
 *
 * Rozhodnutie používateľa: „live volania + krátka cache, žiadna lokálna kópia".
 * Neukladá sa ani jedna objednávka — ukladá sa len ODVODENÁ ZNALOSŤ o mesiaci.
 *
 * Idempotencia: `external_key = sperky:month:YYYY-MM`. Druhý beh ten istý uzol
 * PREPÍŠE, nikdy nevytvorí duplikát a nikdy nenaskladá popis do seba.
 *
 * NÁLEZ N1 — čo tu ZÁMERNE nie je: jeden súhrnný obrat. `total_paid` je v mene
 * objednávky, ale API menu nevracia (HU=HUF, CZ=CZK, SK/SI=EUR; na 100
 * objednávkach 37 hodnôt nad 1000). Súčet naprieč krajinami by bol nepravdivé
 * číslo, prepočet na EUR je zakázaný (appka nemá kurzy). Do uzla ide POČET
 * objednávok (bezpečný) a obrat výhradne rozpadnutý podľa `country_iso`
 * s príznakom, že mena je ODHAD.
 *
 * Krajina je len v detaile objednávky, nie v zozname — rozpad podľa krajín je
 * preto zo VZORKY (`sperky.aggregate.sample_details`) a je tak aj označený.
 * Inak by mesiac s 5 000 objednávkami znamenal 5 000 requestov na produkciu.
 */
class SperkyAggregator
{
    /** Odhad meny z krajiny — mapovanie žije v configu, nie v kóde (nález N1). */
    private readonly SperkyCurrency $currency;

    public function __construct(
        private readonly OrderScanner $scanner,
        private readonly TaxonomyResolver $taxonomy = new TaxonomyResolver,
    ) {
        $this->currency = SperkyCurrency::fromConfig();
    }

    /**
     * Spočíta mesiac a zapíše/aktualizuje uzol.
     *
     * @param  string  $month  `YYYY-MM`
     * @return array<string, mixed> správa o behu pre príkaz aj pre report
     */
    public function forMonth(string $month, bool $write = true): array
    {
        $start = $this->monthStart($month);
        if ($start === null) {
            return ['ok' => false, 'error' => 'invalid_month', 'month' => $month];
        }

        $month = $start->format('Y-m');
        $until = $start->copy()->addMonth();

        $config = (array) config('sperky.aggregate', []);

        $scan = $this->scanner->scan($start, $until, [
            'per_page' => (int) ($config['per_page'] ?? 100),
            'max_requests' => (int) ($config['max_requests'] ?? 80),
            'sleep_ms' => (int) ($config['sleep_ms'] ?? 250),
        ]);

        $sample = $this->scanner->details(
            $scan->ids(),
            (int) ($config['sample_details'] ?? 60),
            (int) ($config['sleep_ms'] ?? 250),
        );

        $summary = $this->summarize($month, $start, $until, $scan, $sample);

        if (! $write) {
            return ['ok' => true, 'month' => $month, 'summary' => $summary, 'node' => null, 'written' => false];
        }

        // Bez jedinej objednávky sa uzol nezakladá — prázdny „0 objednávok" uzol
        // pri nedostupnom API by bola nepravdivá znalosť.
        if ($scan->count() === 0 && ! $scan->isComplete()) {
            return [
                'ok' => false,
                'error' => 'scan_failed',
                'reason' => $scan->stoppedBy,
                'month' => $month,
                'summary' => $summary,
                'written' => false,
            ];
        }

        $node = $this->writeNode($month, $summary);

        return [
            'ok' => $node !== null,
            'month' => $month,
            'summary' => $summary,
            'node' => $node?->toApi(),
            'written' => $node !== null,
            'error' => $node === null ? 'tombstoned_or_no_area' : null,
        ];
    }

    /**
     * Súhrn mesiaca. POČTY sú z celého okna, OBRAT výhradne zo vzorky detailov
     * a výhradne po krajinách.
     *
     * @param  array{details: list<array<string, mixed>>, requests: int, stopped_by: ?string}  $sample
     * @return array<string, mixed>
     */
    public function summarize(string $month, Carbon $from, Carbon $until, OrderScan $scan, array $sample): array
    {
        $countries = $this->countries($sample['details']);

        return [
            'month' => $month,
            'window' => ['from' => $from->toDateString(), 'until' => $until->toDateString()],
            // POČET je jediné bezpečné súhrnné číslo (nález N1)
            'orders' => $scan->count(),
            'orders_complete' => $scan->isComplete(),
            'total_orders_in_shop' => $scan->totalOrders,
            'countries' => $countries,
            'countries_meta' => [
                // rozpad je zo VZORKY, nie z celého mesiaca — krajina je len v detaile
                'basis' => 'sample',
                'sample_size' => count($sample['details']),
                'sample_of' => $scan->count(),
                'sample_stopped_by' => $sample['stopped_by'],
                'currency_is_estimate' => true,
                'note' => 'Mena je odhad z krajiny — API ju nevracia. Sumy sa nesčítavajú '
                    .'naprieč krajinami ani neprepočítavajú na jednu menu.',
            ],
            'top_products' => $this->topProducts($sample['details']),
            'scan' => $scan->meta(),
            'requests' => $scan->requests + (int) $sample['requests'],
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Rozpad podľa `country_iso`: počet objednávok a súčet `total_paid`
     * V RÁMCI JEDNEJ KRAJINY (a teda jednej odhadnutej meny). Nikdy naprieč.
     *
     * @param  list<array<string, mixed>>  $details
     * @return list<array<string, mixed>>
     */
    public function countries(array $details): array
    {
        $buckets = [];

        foreach ($details as $detail) {
            $iso = strtoupper(trim((string) ($detail['country_iso'] ?? '')));
            $key = $iso !== '' ? $iso : 'UNKNOWN';

            $buckets[$key] ??= [
                'country_iso' => $iso !== '' ? $iso : null,
                'country' => $detail['country'] ?? null,
                'orders' => 0,
                'total_paid' => 0.0,
                'currency_estimate' => $this->currency->guess($iso),
                'currency_is_estimate' => true,
            ];

            $buckets[$key]['orders']++;
            $buckets[$key]['total_paid'] += (float) ($detail['total_paid'] ?? 0);
        }

        $rows = array_values($buckets);
        usort($rows, fn (array $a, array $b) => $b['orders'] <=> $a['orders']);

        return array_map(function (array $row) {
            $row['total_paid'] = round((float) $row['total_paid'], 2);

            return $row;
        }, $rows);
    }

    /**
     * Najčastejšie produkty vo vzorke (podľa výskytu v `product_ids`).
     *
     * @param  list<array<string, mixed>>  $details
     * @return list<array{id: int, orders: int}>
     */
    public function topProducts(array $details, int $limit = 10): array
    {
        $counts = [];

        foreach ($details as $detail) {
            foreach ((array) ($detail['product_ids'] ?? []) as $id) {
                $id = (int) $id;
                if ($id > 0) {
                    $counts[$id] = ($counts[$id] ?? 0) + 1;
                }
            }
        }

        arsort($counts);

        $top = [];
        foreach (array_slice($counts, 0, max(1, $limit), true) as $id => $orders) {
            $top[] = ['id' => (int) $id, 'orders' => (int) $orders];
        }

        return $top;
    }

    /**
     * Popis uzla po slovensky. Obrat LEN po krajinách a vždy s priznaním, že
     * mena je odhad — bez toho by bol text nepravdivý.
     *
     * @param  array<string, mixed>  $summary
     */
    public function describe(array $summary): string
    {
        $lines = [];

        $orders = (int) ($summary['orders'] ?? 0);
        $lines[] = sprintf(
            '%s — %s objednávok%s.',
            $this->monthLabel((string) $summary['month']),
            number_format($orders, 0, ',', ' '),
            ($summary['orders_complete'] ?? true) ? '' : ' (čiastočný scan)',
        );

        $countries = (array) ($summary['countries'] ?? []);
        if ($countries !== []) {
            $parts = [];
            foreach ($countries as $row) {
                $iso = (string) ($row['country_iso'] ?? '??');
                $money = $row['currency_estimate'] !== null
                    ? sprintf(
                        ' · %s %s',
                        number_format((float) $row['total_paid'], 2, ',', ' '),
                        (string) $row['currency_estimate'],
                    )
                    : ' · mena neznáma';
                $parts[] = sprintf('%s %d obj.%s', $iso, (int) $row['orders'], $money);
            }

            $sampleSize = (int) data_get($summary, 'countries_meta.sample_size', 0);
            $lines[] = 'Rozpad podľa krajín zo vzorky '.$sampleSize.' objednávok: '.implode(' · ', $parts);
        }

        $lines[] = 'Mena je ODHADNUTÁ z country_iso — API ju nevracia. Súhrnný obrat sa '
            .'zámerne nepočíta a prepočet na jednu menu je zakázaný.';

        $top = (array) ($summary['top_products'] ?? []);
        if ($top !== []) {
            $lines[] = 'Najčastejšie produkty vo vzorke: '.implode(', ', array_map(
                fn (array $p) => '#'.$p['id'].' ('.$p['orders'].'×)',
                array_slice($top, 0, 5),
            ));
        }

        return implode("\n", $lines);
    }

    /**
     * Zápis/aktualizácia uzla. `null` = uzol sa zámerne nezapísal (náhrobok
     * alebo chýbajúca taxonómia).
     *
     * @param  array<string, mixed>  $summary
     */
    private function writeNode(string $month, array $summary): ?Node
    {
        $key = $this->externalKey($month);

        // Pohltený/archivovaný kľúč sa už nikdy nesmie znovu adoptovať.
        if (Tombstone::where('external_key', $key)->exists()) {
            return null;
        }

        $placement = $this->placement();
        if ($placement === null) {
            return null;
        }

        $node = Node::updateOrCreate(
            ['external_key' => $key],
            [
                'type' => 'memory',
                'source' => 'sperky',
                'origin' => 'sperky',
                'area_id' => $placement['area_id'],
                'department_id' => $placement['department_id'],
                'label' => 'E-shop '.$this->monthLabel($month),
                'description' => $this->describe($summary),
                'certainty' => ($summary['orders_complete'] ?? true) ? 'confirmed' : 'assumed',
                'meta' => $summary + [
                    'source' => 'sperky-eshop.sk',
                    // Explicitný príznak pre kontrolu aj pre UI: jedno súhrnné
                    // číslo obratu v tomto uzle NEEXISTUJE a existovať nesmie.
                    'revenue_total_forbidden' => true,
                ],
                'strength' => 2,
                'last_activated_at' => now(),
            ],
        );

        MindPulse::dispatch('node.updated', ['node' => $node->toApi()]);

        return $node;
    }

    /**
     * Oblasť „Biznis & projekty" + oddelenie „E-shop". Keď taxonómia nesedí,
     * uzol sa nezapíše (radšej nič než uzol v Marketingu).
     *
     * @return array{area_id: int, department_id: ?int}|null
     */
    private function placement(): ?array
    {
        $config = (array) config('sperky.aggregate', []);
        $areaName = (string) ($config['area'] ?? 'Biznis & projekty');
        $departmentName = (string) ($config['department'] ?? 'E-shop');

        try {
            if (Area::count() === 0) {
                return null;
            }

            $match = $this->taxonomy->matchArea($areaName);
            if (! $match['matched']) {
                return null;
            }

            $area = $match['area'];
            $department = $this->taxonomy->findDepartment($area, $departmentName);

            if ($department === null && $this->taxonomy->departmentsElsewhere($area, $departmentName) === []) {
                $department = Department::firstOrCreate(
                    ['area_id' => $area->id, 'slug' => 'e-shop'],
                    ['name' => $departmentName],
                );
            }

            return ['area_id' => (int) $area->id, 'department_id' => $department?->id];
        } catch (Throwable) {
            return null;
        }
    }

    public function externalKey(string $month): string
    {
        return 'sperky:month:'.$month;
    }

    /** `YYYY-MM` → prvý deň mesiaca, alebo null pri neplatnom vstupe. */
    public function monthStart(string $month): ?Carbon
    {
        if (preg_match('/^\d{4}-\d{2}$/', trim($month)) !== 1) {
            return null;
        }

        try {
            $date = Carbon::createFromFormat('Y-m-d', trim($month).'-01');
        } catch (Throwable) {
            return null;
        }

        if ($date === false) {
            return null;
        }

        return $date->startOfMonth();
    }

    /** `2026-07` → „Júl 2026" (slovenské názvy mesiacov v labeli uzla). */
    public function monthLabel(string $month): string
    {
        $names = [
            1 => 'Január', 2 => 'Február', 3 => 'Marec', 4 => 'Apríl', 5 => 'Máj', 6 => 'Jún',
            7 => 'Júl', 8 => 'August', 9 => 'September', 10 => 'Október', 11 => 'November', 12 => 'December',
        ];

        $start = $this->monthStart($month);
        if ($start === null) {
            return $month;
        }

        return $names[(int) $start->month].' '.$start->year;
    }
}
