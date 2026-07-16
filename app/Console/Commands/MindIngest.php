<?php

namespace App\Console\Commands;

use App\Services\TranscriptIngestService;
use Illuminate\Console\Command;

class MindIngest extends Command
{
    protected $signature = 'mind:ingest {--all : Spracovať aj už zapísané sessions (backfill/refresh)}';

    protected $description = 'Zapíše záznamy z Claude Code transcriptov do mozgu (bez modelu, čisto kódom)';

    public function handle(TranscriptIngestService $ingest): int
    {
        $s = $ingest->ingestAll(onlyNew: ! $this->option('all'));

        $this->info(sprintf(
            'Súbory: %d · nové: %d · aktualizované: %d · preskočené: %d',
            $s['files'], $s['created'], $s['updated'], $s['skipped'],
        ));

        return self::SUCCESS;
    }
}
