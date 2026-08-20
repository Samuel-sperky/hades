<?php

namespace App\Console\Commands;

use App\Models\Run;
use App\Services\Console\RunRecorder;
use Illuminate\Console\Command;

/**
 * Zametanie behov, ktoré zostali visieť v stave `running`.
 *
 * Beh sa uzatvára v `finally` bloku {@see \App\Http\Controllers\Console\RunController},
 * takže výnimka ani odchod klienta ho visieť nenechajú. Čo ho nechá visieť, je
 * smrť procesu: `docker compose restart app`, spadnutý PHP worker, vypnutý stroj.
 * Vtedy `finally` nikdy nezbehne.
 *
 * Prečo to vôbec riešiť: obrazovka Runy a `mind_runs` ukazujú `running` ako „beží
 * práve teraz". Beh, ktorý tam svieti tri dni, nie je kozmetická chyba — je to
 * log, ktorý lže o tom, čo sa deje, a to je jediná vlastnosť, ktorú log mať nesmie.
 *
 * Strop je 30 minút, nie 5: ťah na CPU pri ~9 tok/s s viacerými krokmi reálne
 * beží aj desiatky minút, a zabiť živý beh by bola horšia chyba než nechať mŕtvy
 * ešte chvíľu svietiť. Zaparkované behy (`waiting`) sa nezametajú vôbec — tie
 * čakajú na človeka a môžu tak čakať legitímne aj dni.
 */
class MindReapRuns extends Command
{
    protected $signature = 'mind:reap-runs
        {--minutes=30 : Po koľkých minútach v stave running sa beh považuje za mŕtvy}
        {--dry-run : Len vypíš, čo by sa zmenilo}';

    protected $description = 'Uzavrie behy, ktoré zostali visieť v stave running po smrti procesu';

    public function handle(RunRecorder $recorder): int
    {
        $minutes = max((int) $this->option('minutes'), 1);
        $cutoff = now()->subMinutes($minutes);

        $stale = Run::query()
            ->where('status', 'running')
            ->where('started_at', '<', $cutoff)
            ->orderBy('id')
            ->get(['id', 'uuid', 'started_at', 'model']);

        if ($stale->isEmpty()) {
            $this->info('Žiadny visiaci beh.');

            return self::SUCCESS;
        }

        foreach ($stale as $run) {
            $this->line(sprintf(
                '  %s  %s  %s',
                $run->uuid,
                $run->started_at?->format('Y-m-d H:i') ?? '?',
                $run->model ?? '?',
            ));
        }

        if ($this->option('dry-run')) {
            $this->comment("Dry-run: {$stale->count()} behov by sa uzavrelo ako aborted.");

            return self::SUCCESS;
        }

        $reaped = $recorder->reapStale($minutes);

        $this->info("Uzavretých ako aborted: {$reaped}.");

        return self::SUCCESS;
    }
}
