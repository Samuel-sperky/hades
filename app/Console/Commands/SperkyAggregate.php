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
 * REGISTRÁCIA V SCHEDULERI JE ZÁMERNE VYPNUTÁ. `routes/console.php` vlastní iný
 * balík a nočný beh sa nesmie zapnúť skôr, než sa overí rate limit e-shopu na
 * reálnych dátach (dnes je NEZNÁMY a produkcia sa netestovala do zablokovania).
 * Navrhovaný riadok je v reporte balíka SPERKY-BE — pridá ho integrátor.
 *
 * Bez `--month` sa počíta PREDCHÁDZAJÚCI mesiac: nočný beh 1. augusta má
 * uzavrieť júl, nie rozpočítaný august.
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
        $orders = (int) ($summary['orders'] ?? 0);
        $requests = (int) ($summary['requests'] ?? 0);
        $complete = ($summary['orders_complete'] ?? false) === true;

        $this->info(sprintf(
            'sperky:aggregate %s: %d objednávok%s, %d requestov, %s.',
            (string) ($result['month'] ?? $month),
            $orders,
            $complete ? '' : ' (čiastočný scan: '.(string) data_get($summary, 'scan.stopped_by', '?').')',
            $requests,
            $write ? 'uzol zapísaný' : 'dry-run bez zápisu',
        ));

        // Rozpad podľa krajín vypisujeme po riadkoch — jedno súhrnné číslo
        // obratu neexistuje a vypísať by sa ani nedalo (mieša HUF/CZK/EUR).
        foreach ((array) ($summary['countries'] ?? []) as $row) {
            $this->line(sprintf(
                '  %s: %d obj. · %s %s (mena odhad)',
                (string) ($row['country_iso'] ?? '??'),
                (int) ($row['orders'] ?? 0),
                number_format((float) ($row['total_paid'] ?? 0), 2, ',', ' '),
                (string) ($row['currency_estimate'] ?? 'neznáma mena'),
            ));
        }

        return self::SUCCESS;
    }
}
