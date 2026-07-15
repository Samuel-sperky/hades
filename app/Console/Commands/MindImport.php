<?php

namespace App\Console\Commands;

use App\Services\MindImporter;
use Illuminate\Console\Command;

class MindImport extends Command
{
    protected $signature = 'mind:import';

    protected $description = 'Načíta ručné úpravy .md súborov (mind/) späť do databázy';

    public function handle(MindImporter $importer): int
    {
        if (! config('hades.mirror_enabled', true)) {
            $this->warn('Zrkadlenie je vypnuté (hades.mirror_enabled=false).');

            return self::SUCCESS;
        }

        $this->info('Importujem zmeny z mind/ do databázy…');
        $r = $importer->import();

        $this->info("Hotovo — upravených {$r['updated']}, preskočených {$r['skipped']}, odmietnutých {$r['rejected']}.");

        return self::SUCCESS;
    }
}
