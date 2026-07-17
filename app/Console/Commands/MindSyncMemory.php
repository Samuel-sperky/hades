<?php

namespace App\Console\Commands;

use App\Services\ClaudeMemoryIngestService;
use Illuminate\Console\Command;

/**
 * Načíta Claude memory .md súbory (aktuálny aj súrodenecké projekty) ako
 * memory uzly do vedomia. Idempotentné cez external_key.
 */
class MindSyncMemory extends Command
{
    protected $signature = 'mind:sync-memory';

    protected $description = 'Načíta Claude memory .md súbory naprieč projektmi ako memory uzly';

    public function handle(ClaudeMemoryIngestService $ingest): int
    {
        $s = $ingest->sync();

        $this->info(
            "Memory sync: {$s['scanned']} súborov · nových {$s['created']} · "
            ."aktualizovaných {$s['updated']} · preskočených {$s['skipped']}."
        );

        return self::SUCCESS;
    }
}
