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
 * Po prechode na filtre (rozhodnutie 2) je počet objednávok presný po JEDNOM
 * dopyte a rozpad podľa krajín po jednom dopyte na krajinu. Príznaky o vzorke
 * („basis: sample", „sample_size") zmizli — už nie sú pravdivé.
 *
 * OBRAT (rozhodnutie 1): uzol obsahuje `revenue` = samostatný riadok pre každú
 * menu (`{currency, total, orders}`). Jedno číslo naprieč menami tu NEVZNIKNE:
 * sčítať EUR s HUF nemá zmysel a prepočet na EUR je zakázaný. Meny sa čítajú
 * z API — mapovanie krajina→mena je zmazané (rozhodnutie 7).
 */
class SperkyAggregator
{
    public function __construct(
        private readonly OrderWindowReader $reader,
        private readonly TaxonomyResolver $taxonomy = new TaxonomyResolver,
    ) {}

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
        $from = $start->toDateString();
        $to = $start->copy()->endOfMonth()->toDateString();

        $config = (array) config('sperky.aggregate', []);

        $window = $this->reader->read($from, $to, [
            'per_page' => (int) ($config['per_page'] ?? 100),
            'max_requests' => (int) ($config['revenue_max_requests'] ?? 150),
            'sleep_ms' => (int) ($config['sleep_ms'] ?? 250),
        ]);

        $countries = $this->reader->countries(
            $from,
            $to,
            (array) config('sperky.countries', []),
            $window->orders,
        );

        $summary = $this->summarize($month, $window, $countries);

        if (! $write) {
            return ['ok' => true, 'month' => $month, 'summary' => $summary, 'node' => null, 'written' => false];
        }

        // Bez počtu z API sa uzol nezakladá — „0 objednávok" pri nedostupnom
        // e-shope by bola nepravdivá znalosť.
        if (! $window->available()) {
            return [
                'ok' => false,
                'error' => 'window_failed',
                'reason' => $window->error ?? 'unavailable',
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
     * Súhrn mesiaca. POČTY sú presné z API, OBRAT je po menách.
     *
     * @param  array{countries: list<array{country_iso: string, orders: ?int}>, other: ?int, error: ?string}  $countries
     * @return array<string, mixed>
     */
    public function summarize(string $month, OrderWindow $window, array $countries): array
    {
        return [
            'month' => $month,
            'window' => ['from' => $window->from, 'to' => $window->to],
            // presný počet z `total` filtrovanej odpovede, nie z prejdených strán
            'orders' => $window->orders,
            'countries' => $countries['countries'],
            'countries_other' => $countries['other'],
            // Obrat VÝHRADNE po menách. Súčet naprieč menami je zakázaný a
            // prepočet na jednu menu takisto (rozhodnutie 1).
            'revenue' => $window->revenue,
            'revenue_meta' => $window->revenueMeta(),
            'requests' => $window->requests + count($countries['countries']),
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /**
     * Popis uzla po slovensky. Obrat po menách, každá mena na vlastnom riadku —
     * jedna veta so súčtom EUR a HUF by bola nepravdivá.
     *
     * @param  array<string, mixed>  $summary
     */
    public function describe(array $summary): string
    {
        $lines = [];

        $orders = $summary['orders'] ?? null;
        $lines[] = sprintf(
            '%s — %s objednávok.',
            $this->monthLabel((string) $summary['month']),
            $orders === null ? 'neznámy počet' : number_format((int) $orders, 0, ',', ' '),
        );

        $revenue = (array) ($summary['revenue'] ?? []);
        if ($revenue !== []) {
            $parts = [];
            foreach ($revenue as $row) {
                $parts[] = sprintf(
                    '%s %s (%s obj.)',
                    number_format((float) $row['total'], 2, ',', ' '),
                    (string) $row['currency'],
                    number_format((int) $row['orders'], 0, ',', ' '),
                );
            }
            $lines[] = 'Obrat po menách: '.implode(' · ', $parts);
        }

        if (($summary['revenue_meta']['complete'] ?? true) !== true) {
            $lines[] = 'Obrat pokrýva '.number_format((int) ($summary['revenue_meta']['orders_covered'] ?? 0), 0, ',', ' ')
                .' z '.number_format((int) ($summary['revenue_meta']['orders_in_window'] ?? 0), 0, ',', ' ')
                .' objednávok mesiaca — strop požiadaviek sa vyčerpal.';
        }

        $countries = (array) ($summary['countries'] ?? []);
        if ($countries !== []) {
            $parts = [];
            foreach ($countries as $row) {
                $parts[] = sprintf(
                    '%s %s obj.',
                    (string) $row['country_iso'],
                    number_format((int) ($row['orders'] ?? 0), 0, ',', ' '),
                );
            }
            if (($summary['countries_other'] ?? null) !== null) {
                $parts[] = 'ostatné '.number_format((int) $summary['countries_other'], 0, ',', ' ').' obj.';
            }
            $lines[] = 'Krajiny (presné počty): '.implode(' · ', $parts);
        }

        $lines[] = 'Sumy sa NIKDY nesčítavajú naprieč menami a neprepočítavajú na jednu menu.';

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
                'certainty' => ($summary['revenue_meta']['complete'] ?? true) ? 'confirmed' : 'assumed',
                'meta' => $summary + [
                    'source' => 'sperky-eshop.sk',
                    // Explicitný príznak pre kontrolu aj pre UI: jedno číslo,
                    // ktoré by sčítalo sumy v rôznych menách, tu neexistuje
                    // a existovať nesmie.
                    'cross_currency_sum_forbidden' => true,
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
