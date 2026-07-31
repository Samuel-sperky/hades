<?php

namespace App\Console\Commands;

use App\Services\Sperky\SperkyAggregator;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * Mesačný súhrn e-shopu do vedomia (`memory` uzol `sperky:month:YYYY-MM`).
 *
 * Idempotentné: druhý beh ten istý uzol prepíše, nikdy nevytvorí duplikát.
 *
 * V SCHEDULERI JE ZAPNUTÝ (rozhodnutie 6): `routes/console.php`, `monthlyOn(2, '02:30')`,
 * `withoutOverlapping`, timezone Europe/Bratislava. Druhý deň mesiaca preto, aby
 * bol predchádzajúci mesiac uzavretý aj pri objednávkach dobehnutých po polnoci.
 *
 * Historické mesiace sa NEDOPOČÍTAVAJÚ (rozhodnutie 6): objednávky existujú od
 * roku 2020, takže by pribudlo ~80 uzlov — to je samostatná úloha.
 *
 * Bez `--month` sa počíta PREDCHÁDZAJÚCI mesiac: beh 2. augusta má uzavrieť júl,
 * nie rozpočítaný august.
 */
class SperkyAggregate extends Command
{
    protected $signature = 'sperky:aggregate
        {--month= : Mesiac vo formáte YYYY-MM (default: predchádzajúci mesiac)}
        {--dry-run : Len spočítať a vypísať, do vedomia nič nezapisovať}';

    protected $description = 'Spočíta mesačný súhrn objednávok z e-shopu a zapíše ho do vedomia (idempotentne)';

    public function handle(SperkyAggregator $aggregator): int
    {
        $month = trim((string) ($this->option('month') ?: Carbon::now()->subMonthNoOverflow()->format('Y-m')));
        $write = ! (bool) $this->option('dry-run');

        $result = $aggregator->forMonth($month, write: $write);

        if (($result['ok'] ?? false) !== true) {
            $this->error(sprintf(
                'sperky:aggregate %s: zlyhalo (%s%s).',
                $month,
                (string) ($result['error'] ?? 'unknown'),
                isset($result['reason']) ? ', dôvod: '.$result['reason'] : '',
            ));

            return self::FAILURE;
        }

        $summary = (array) ($result['summary'] ?? []);
        $orders = $summary['orders'] ?? null;
        $requests = (int) ($summary['requests'] ?? 0);
        $complete = (bool) data_get($summary, 'revenue_meta.complete', true);

        $this->info(sprintf(
            'sperky:aggregate %s: %s objednávok, %d requestov, %s.',
            (string) ($result['month'] ?? $month),
            $orders === null ? '?' : number_format((int) $orders, 0, ',', ' '),
            $requests,
            $write ? 'uzol zapísaný' : 'dry-run bez zápisu',
        ));

        // Obrat sa vypisuje PO MENÁCH, každá mena na vlastnom riadku. Jedno
        // súhrnné číslo naprieč menami neexistuje a vypísať by sa ani nedalo.
        foreach ((array) ($summary['revenue'] ?? []) as $row) {
            $this->line(sprintf(
                '  obrat %s: %s (%d obj.)',
                (string) ($row['currency'] ?? '???'),
                number_format((float) ($row['total'] ?? 0), 2, ',', ' '),
                (int) ($row['orders'] ?? 0),
            ));
        }

        if (! $complete) {
            $this->warn(sprintf(
                '  obrat pokrýva len %d z %s objednávok — strop požiadaviek sa vyčerpal.',
                (int) data_get($summary, 'revenue_meta.orders_covered', 0),
                (string) (data_get($summary, 'revenue_meta.orders_in_window') ?? '?'),
            ));
        }

        foreach ((array) ($summary['countries'] ?? []) as $row) {
            $this->line(sprintf(
                '  %s: %s obj.',
                (string) ($row['country_iso'] ?? '??'),
                number_format((int) ($row['orders'] ?? 0), 0, ',', ' '),
            ));
        }

        return self::SUCCESS;
    }
}
