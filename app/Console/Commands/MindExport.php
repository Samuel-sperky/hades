<?php

namespace App\Console\Commands;

use App\Services\MindMirror;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class MindExport extends Command
{
    protected $signature = 'mind:export {--force : Spustí export aj keď je zrkadlenie vypnuté}';

    protected $description = 'Regeneruje priehľadný .md strom vedomia (mind/) z databázy';

    public function handle(MindMirror $mirror): int
    {
        if (! config('hades.mirror_enabled', true) && ! $this->option('force')) {
            $this->warn('Zrkadlenie je vypnuté (hades.mirror_enabled=false). Použi --force.');

            return self::SUCCESS;
        }

        // Ak je vypnuté a použil sa --force, dočasne zapni pre tento beh.
        config(['hades.mirror_enabled' => true]);

        $this->info('Generujem mind/ z databázy…');
        $mirror->rebuild();

        $files = count(Storage::disk('mind')->allFiles());
        $this->info("Hotovo — zapísaných {$files} súborov do mind/.");

        return self::SUCCESS;
    }
}
