<?php

namespace App\Services\Maintenance;

use App\Models\SyncRun;

/**
 * Retention pre tabuľku sync_runs (rozhodnutie #36).
 *
 * Stav pred zásahom: 1 005 riadkov za 13 dní, 100 % z nich no-op (brain-sync beží
 * každých 10 minút a väčšinou nemá čo robiť), prírastok ~144 riadkov/deň. Tabuľka
 * je audit, nie časová os cronu — no-op behy do nej nepatria.
 *
 * Riešenie je dvojité a obe polovice sú potrebné:
 *   1) PREVENCIA — no-op beh sa vôbec nezapíše. Rozhodnutie robí isNoop() nad
 *      štatistikami behu; volá ho BrainSyncService (vlastní balík P3, patch je
 *      v reporte P2). Kým patch nie je aplikovaný, funguje aspoň rotácia.
 *   2) ROTÁCIA — prune() zmaže staré záznamy. Zámerne konzervatívna:
 *      - chybové a čiastočné behy majú dlhšiu retention (diagnostika),
 *      - vždy zostane aspoň keep_last najnovších záznamov, aby
 *        StatsController („posledný beh") nikdy nezostal bez dát.
 *
 * Maže VÝHRADNE riadky sync_runs (audit log údržby). Nedotýka sa uzlov, hrán ani
 * aktivácií — kontrolné počty vedomia zostávajú nezmenené.
 */
class SyncRunRetention
{
    /**
     * Urobil beh vôbec niečo? Kľúče, ktoré rozhodujú, sú tie, čo menia sieť.
     * 'skipped' a 'skipped_dup_hash' sú práve tie no-op prípady, ktoré tabuľku
     * zaplavujú, takže sa do rozhodovania NEpočítajú.
     *
     * Beh so statusom error/partial je vždy „niečo urobil" — je to diagnostika.
     *
     * @param  array<string, mixed>|null  $stats
     */
    public function isNoop(?array $stats, ?string $status = null): bool
    {
        if ($status !== null && $status !== 'ok') {
            return false;
        }

        $stats ??= [];

        foreach (['created', 'updated', 'deleted', 'edges_created', 'flagged_missing'] as $key) {
            if ((int) ($stats[$key] ?? 0) > 0) {
                return false;
            }
        }

        return true;
    }

    /**
     * Zmaže staré záznamy podľa configu.
     *
     * @param  bool  $dryRun  nič nemaž, len spočítaj
     * @param  bool|null  $purgeNoop  prebi config: dobehnúť aj historické no-op behy
     * @return array{deleted_old: int, deleted_noop: int, noop_pending: int, kept: int, cutoff: string, cutoff_failed: string}
     */
    public function prune(bool $dryRun = false, ?bool $purgeNoop = null): array
    {
        $days = max(1, (int) config('maintenance.sync_runs.retention_days', 30));
        $daysFailed = max($days, (int) config('maintenance.sync_runs.retention_days_failed', 90));
        $keepLast = max(0, (int) config('maintenance.sync_runs.keep_last', 20));
        // Historické no-op behy sa mažú len na výslovný pokyn — je to mazanie dát
        // a to sa nikdy nerobí autonómne, ani nad audit logom.
        $purgeNoop ??= (bool) config('maintenance.sync_runs.purge_historical_noop', false);

        $cutoff = now()->subDays($days);
        $cutoffFailed = now()->subDays($daysFailed);

        // Ochranná zóna: keep_last najnovších záznamov sa nikdy nemaže, aby
        // StatsController („posledný beh") nezostal bez dát.
        $protectedIds = SyncRun::query()
            ->orderByDesc('id')
            ->limit($keepLast)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
        $protected = array_flip($protectedIds);

        $oldIds = [];
        $noopIds = [];

        // Jediný prechod tabuľkou — rozhodovanie o no-op ide cez isNoop() v PHP
        // (nie SQL nad JSON), aby existovalo jediné miesto pravdy, to isté, ktoré
        // použije prevencia v BrainSyncService.
        SyncRun::query()
            ->orderBy('id')
            ->chunk(500, function ($runs) use (&$oldIds, &$noopIds, $protected, $cutoff, $cutoffFailed) {
                foreach ($runs as $run) {
                    $id = (int) $run->id;
                    if (isset($protected[$id])) {
                        continue;
                    }
                    // rozbehnutý beh (bez finished_at) sa nikdy nemaže
                    if ($run->finished_at === null) {
                        continue;
                    }

                    $failed = in_array($run->status, ['error', 'partial'], true);
                    $started = $run->started_at;

                    if ($failed) {
                        if ($started !== null && $started->lt($cutoffFailed)) {
                            $oldIds[] = $id;
                        }

                        continue;
                    }

                    if ($started !== null && $started->lt($cutoff)) {
                        $oldIds[] = $id;

                        continue;
                    }

                    // Historické no-op behy (spred prevencie v BrainSyncService).
                    // Práve tie tvoria 100 % dnešných riadkov, takže rotácia podľa
                    // veku by sama nezmazala nič. Zbierame ich vždy (aby --dry-run
                    // vedel počet), mažú sa len keď to používateľ výslovne povolí.
                    if ($this->isNoop($run->stats, $run->status)) {
                        $noopIds[] = $id;
                    }
                }
            });

        $toDelete = $purgeNoop ? array_merge($oldIds, $noopIds) : $oldIds;

        if (! $dryRun) {
            foreach (array_chunk($toDelete, 500) as $chunk) {
                SyncRun::query()->whereIn('id', $chunk)->delete();
            }
        }

        $total = SyncRun::query()->count();

        return [
            'deleted_old' => count($oldIds),
            'deleted_noop' => $purgeNoop ? count($noopIds) : 0,
            // koľko no-op behov čaká na výslovné povolenie
            'noop_pending' => $purgeNoop ? 0 : count($noopIds),
            'kept' => $dryRun ? $total - count($toDelete) : $total,
            'cutoff' => $cutoff->toIso8601String(),
            'cutoff_failed' => $cutoffFailed->toIso8601String(),
        ];
    }
}
