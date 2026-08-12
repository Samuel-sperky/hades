<?php

namespace App\Console\Commands;

use App\Models\Activation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * A12 — retencia prevádzkovej telemetrie.
 *
 * Dve tabuľky rástli bez akéhokoľvek stropu:
 *
 *   sync_runs   — brain-sync beží 144×/deň a nikdy sa nič nemazalo.
 *                 1 450 riadkov, z toho 1 169 starších ako týždeň. Je to čisto
 *                 prevádzkový log; detail starší než pár dní nikto nečíta.
 *
 *   activations — 16 494 riadkov, z toho 13 831 (84 %) sú `recall` a
 *                 `recall-neighbor`, teda stopy po ČÍTANÍ. Jeden recall zapíše
 *                 až 45 riadkov.
 *
 * Zapisovacie aktivácie (`learn`, `activate`, `merge`, `skill-used`) sa
 * NEMAŽÚ — GraphService podľa nich rozhoduje, ktoré skilly sa reálne použili,
 * a coActivate z nich stavia synapsie.
 *
 * Pozn.: sila uzla sa z aktivácií neodvodzuje. `strength` mení len mergeInto(),
 * activate() a mergeNodes(); Activation::record() sa jej nedotýka. Čítanie teda
 * uzly neposilňuje a mazanie starých recallov silu nijako neskresľuje.
 */
class MindPruneTelemetry extends Command
{
    protected $signature = 'mind:prune-telemetry
        {--sync-days=7 : Retencia sync_runs v dňoch}
        {--recall-days=30 : Retencia čítacích aktivácií v dňoch}
        {--dry-run : Len vypíš, čo by sa zmazalo}';

    protected $description = 'Prereže prevádzkovú telemetriu: staré sync_runs a stopy po čítaní v activations';

    /** Druhy aktivácií, ktoré vznikajú čítaním a po čase nemajú hodnotu. */
    protected const READ_KINDS = ['recall', 'recall-neighbor'];

    public function handle(): int
    {
        $syncCutoff = now()->subDays((int) $this->option('sync-days'));
        $recallCutoff = now()->subDays((int) $this->option('recall-days'));

        $syncCount = DB::table('sync_runs')->where('started_at', '<', $syncCutoff)->count();
        $recallCount = Activation::whereIn('kind', self::READ_KINDS)
            ->where('created_at', '<', $recallCutoff)
            ->count();

        if ($this->option('dry-run')) {
            $this->info("Prune telemetry (dry-run): {$syncCount} sync_runs, {$recallCount} čítacích aktivácií.");

            return self::SUCCESS;
        }

        DB::table('sync_runs')->where('started_at', '<', $syncCutoff)->delete();

        // po dávkach — jeden veľký DELETE by pri desaťtisícoch riadkov držal
        // zámky dlhšie, než je pri bežiacom ingeste zdravé
        do {
            $deleted = Activation::whereIn('kind', self::READ_KINDS)
                ->where('created_at', '<', $recallCutoff)
                ->limit(2000)
                ->delete();
        } while ($deleted > 0);

        $this->info("Prune telemetry: zmazaných {$syncCount} sync_runs a {$recallCount} čítacích aktivácií. "
            .'Zostáva '.DB::table('sync_runs')->count().' sync_runs a '.Activation::count().' aktivácií.');

        return self::SUCCESS;
    }
}
