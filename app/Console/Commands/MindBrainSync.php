<?php

namespace App\Console\Commands;

use App\Services\Brain\BrainSyncService;
use Illuminate\Console\Command;
use Illuminate\Contracts\Cache\LockTimeoutException;

/**
 * Indexuje ľudsky písané `.md` „mozgy" (skills, claude-memory, externé cesty)
 * do neurónovej siete ako origin=brain uzly. „Markdown je master": súbor je
 * zdroj pravdy, DB je index.
 *
 * Idempotentné (adopcia cez zachovaný external_key → 0 duplicít). Zdieľa zámok
 * 'brain-sync' — pri obsadenom zámku končí kódom ≠ 0 (paralelný sync beží).
 */
class MindBrainSync extends Command
{
    protected $signature = 'mind:brain-sync
        {--source= : Synchronizovať len jeden zdroj (kľúč z brain_sources)}
        {--dry-run : Nič nezapíše — spočíta zmeny a rollbackne}';

    protected $description = 'Indexuje .md „mozgy" (skills/memory/externé) do siete ako origin=brain uzly';

    public function handle(BrainSyncService $sync): int
    {
        $source = $this->option('source') ?: null;
        $dryRun = (bool) $this->option('dry-run');

        try {
            $result = $sync->sync($source, $dryRun);
        } catch (LockTimeoutException $e) {
            $this->error('brain-sync zámok je obsadený — iný sync práve beží.');

            return self::FAILURE;
        }

        $s = $result['stats'];

        $this->info(($dryRun ? '[DRY-RUN] ' : '')."Brain-sync {$result['status']}"
            .($result['run_id'] ? " (run #{$result['run_id']})" : ''));

        $this->table(
            ['created', 'updated', 'skipped', 'dup_hash', 'mirror', 'edges', 'flagged_missing', 'sources'],
            [[
                $s['created'], $s['updated'], $s['skipped'], $s['skipped_dup_hash'],
                $s['skipped_mirror'], $s['edges_created'], $s['flagged_missing'], $s['sources'],
            ]],
        );

        return $result['status'] === 'error' ? self::FAILURE : self::SUCCESS;
    }
}
