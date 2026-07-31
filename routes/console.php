<?php

use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\Calibration\ThresholdSweep;
use App\Services\Maintenance\DryRun\DryRunOptions;
use App\Services\Maintenance\DryRun\DryRunRunner;
use App\Services\Maintenance\Metric\EmbeddingMetric;
use App\Services\Maintenance\Metric\TfidfMetric;
use App\Services\Maintenance\Rewire\RewireOrchestrator;
use App\Services\Maintenance\SyncRunRetention;
use App\Services\SimilarityService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| Údržba vedomia — balík P2
|--------------------------------------------------------------------------
|
| Príkazy sú zámerne closure-based TU a nie v app/Console/Commands: ten priečinok
| patrí príkazom prevzatým z Hadesa a P2 do cudzích súborov nezasahuje. Logika žije
| v app/Services/Maintenance/** — tieto obaly sú len CLI vstup.
*/

// ---------------------------------------------------------------------------
// aura:dry-run — čo BY deštruktívne joby urobili. NIČ NEMENÍ.
//
// Report do storage/app/dry-run/ (JSON + Markdown) s labelmi konkrétnych párov,
// spočítaný DVOJITOU metrikou (TF-IDF aj embeddingy), aby W3 videla na jednom
// papieri, že prah 0.92 na TF-IDF a 0.92 na embeddingoch sú dve iné rozhodnutia.
// Metrika 'embeddings' sa preskočí a v reporte označí, kým stĺpec nodes.embedding
// neexistuje alebo je prázdny (vlastníkom embeddingov je balík P1).
//
// Zapnutie samotných jobov (maintenance.destructive_enabled) schvaľuje VÝHRADNE
// používateľ po prečítaní tohto reportu — rozhodnutie #32.
// ---------------------------------------------------------------------------
Artisan::command(
    'aura:dry-run {job=all : automerge|prune-coactivation|cleanup-edges|all}'
    .' {--metric=* : tfidf|embeddings (default z configu)}'
    .' {--sample= : koľko konkrétnych položiek do reportu (0 = všetky)}'
    .' {--max-pairs= : strop porovnaných párov (0 = bez stropu)}'
    .' {--no-write : nezapisuj report, len vypíš súhrn}',
    function (DryRunRunner $runner) {
        $job = (string) $this->argument('job');
        $jobs = $job === 'all' ? [] : [$job];

        if ($jobs !== [] && ! array_key_exists($job, $runner->jobs())) {
            $this->error("Neznámy job '{$job}'. Dostupné: ".implode(', ', array_keys($runner->jobs())).', all');

            return 1;
        }

        $options = DryRunOptions::fromConfig();
        if ($this->option('sample') !== null) {
            $options = $options->withSampleSize((int) $this->option('sample'));
        }
        if ($this->option('max-pairs') !== null) {
            $options = $options->withMaxPairs((int) $this->option('max-pairs'));
        }

        $metrics = array_values(array_filter((array) $this->option('metric')));

        $this->info('Dry-run beží len na čítanie — nič sa nezmení.');

        $files = null;
        if ($this->option('no-write')) {
            $results = $runner->run($jobs, $metrics, $options);
        } else {
            ['results' => $results, 'files' => $files] = $runner->runAndReport($jobs, $metrics, $options);
        }

        $rows = [];
        foreach ($results as $r) {
            $rows[] = $r->skipped
                ? [$r->job, $r->metric, '—', '—', 'preskočené: '.$r->skippedReason]
                : [$r->job, $r->metric, $r->threshold, $r->compared, $r->affected.($r->truncated ? ' (strop!)' : '')];
        }
        $this->table(['Job', 'Metrika', 'Prah', 'Vyhodnotené', 'Dopad'], $rows);

        if ($files !== null) {
            $this->info('Report: storage/app/'.$files['markdown']);
            $this->line('        storage/app/'.$files['json']);
        }

        $state = config('maintenance.destructive_enabled') ? 'ZAPNUTÉ' : 'vypnuté';
        $this->line("Deštruktívne joby sú {$state}. Zapnutie schvaľuje používateľ po prečítaní reportu.");

        return 0;
    },
)->purpose('Dry-run deštruktívnych jobov: čo by sa zlúčilo/zmazalo, dvojitou metrikou. Nič nemení.');

// ---------------------------------------------------------------------------
// aura:calibrate — sweep PRAHOV. NIČ NEMENÍ a NIČ V CONFIGU NEPREPISUJE.
//
// Rozdiel oproti aura:dry-run: dry-run odpovedá „čo by sa stalo pri prahu z configu",
// kalibrácia odpovedá „čo by sa stalo pri KTOROMKOĽVEK prahu" a k tomu vypíše celé
// rozdelenie skóre. Prah sa podľa železného pravidla v configu nemení — tento príkaz
// dodá čísla, na základe ktorých o ňom rozhodne používateľ.
//
// Výstup ide do JSON súboru, aby sa dal priložiť k reportu.
// ---------------------------------------------------------------------------
Artisan::command(
    'aura:calibrate {--metric=tfidf : tfidf|embeddings}'
    .' {--thresholds= : čiarkou oddelené prahy pre automerge (default 0.80,0.85,0.88,0.90,0.92,0.95)}'
    .' {--prune-thresholds= : čiarkou oddelené prahy pre prune (default 0.08,0.20,0.30,0.35,0.40,0.50)}'
    .' {--floor=0.5 : pod týmto skóre sa páry neuchovávajú (musí byť <= najmenší prah)}'
    .' {--samples=60 : koľko konkrétnych párov na jeden prah}'
    .' {--out= : kam zapísať JSON (default storage/app/dry-run/calibration-<metric>-<čas>.json)}',
    function (ThresholdSweep $sweep, SimilarityService $similarity) {
        $metricKey = (string) $this->option('metric');
        $metric = match ($metricKey) {
            'tfidf' => new TfidfMetric($similarity),
            'embeddings' => new EmbeddingMetric,
            default => null,
        };

        if ($metric === null) {
            $this->error("Neznáma metrika '{$metricKey}'. Dostupné: tfidf, embeddings.");

            return 1;
        }
        if (! $metric->available()) {
            $this->warn("Metrika '{$metricKey}' nie je dostupná: ".$metric->unavailableReason());

            return 2;
        }

        $parse = function (?string $raw, array $fallback): array {
            if ($raw === null || trim($raw) === '') {
                return $fallback;
            }

            return array_values(array_map('floatval', array_filter(explode(',', $raw), fn ($v) => trim($v) !== '')));
        };

        $mergeThresholds = $parse($this->option('thresholds'), [0.80, 0.85, 0.88, 0.90, 0.92, 0.95]);
        $pruneThresholds = $parse($this->option('prune-thresholds'), [0.08, 0.20, 0.30, 0.35, 0.40, 0.50]);
        $samples = (int) $this->option('samples');

        $this->info("Kalibrácia beží len na čítanie — nič sa nezmení. Metrika: {$metricKey}");

        $nodesBefore = Node::count();
        $edgesBefore = Edge::count();

        $automerge = $sweep->automerge($metric, $mergeThresholds, (float) $this->option('floor'), $samples);
        $this->line('');
        $this->line('AUTOMERGE — '.$automerge['compared'].' párov, rozdelenie: '
            .'p50='.$automerge['distribution']['p50']
            .' p99='.$automerge['distribution']['p99']
            .' max='.$automerge['distribution']['max']);
        $rows = [];
        foreach ($automerge['by_threshold'] as $k => $r) {
            $rows[] = [$k, $r['merges'], $r['risky'], $r['risk_levels']['high'], $r['risk_levels']['medium']];
        }
        $this->table(['Prah', 'Zlúčení', 'Rizikových', 'high', 'medium'], $rows);

        $prune = $sweep->pruneCoactivation($metric, $pruneThresholds, $samples);
        $this->line('PRUNE-COACTIVATION — '.$prune['compared'].' hrán, rozdelenie: '
            .'min='.$prune['distribution']['min']
            .' p50='.$prune['distribution']['p50']
            .' max='.$prune['distribution']['max']);
        $rows = [];
        foreach ($prune['by_threshold'] as $k => $r) {
            $rows[] = [$k, $r['pruned'], $r['kept']];
        }
        $this->table(['Prah', 'Prerezaných', 'Ponechaných'], $rows);

        $cleanup = $sweep->cleanupEdges([0.5, 1.0, 1.5], [30, 60, 90, 180], null, $samples);
        $rows = [];
        foreach ($cleanup['grid'] as $g) {
            $rows[] = [$g['max_weight'], $g['older_than_days'], $g['candidates'], $g['deleted']];
        }
        $this->line('CLEANUP-EDGES — mriežka (podobnosť sa nepoužíva):');
        $this->table(['max_weight', 'dni', 'Kandidátov', 'Zmazaných'], $rows);

        $payload = [
            'generated_at' => now()->toIso8601String(),
            'metric' => $metricKey,
            'destructive_enabled' => (bool) config('maintenance.destructive_enabled'),
            'current_thresholds' => config('maintenance.thresholds'),
            'network' => ['nodes' => $nodesBefore, 'edges' => $edgesBefore],
            'automerge' => $automerge,
            'prune_coactivation' => $prune,
            'cleanup_edges' => $cleanup,
        ];

        $out = (string) ($this->option('out')
            ?: 'dry-run/calibration-'.$metricKey.'-'.now()->format('Y-m-d_His').'.json');
        $path = storage_path('app/'.$out);
        @mkdir(dirname($path), 0775, true);
        file_put_contents($path, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        // Poistka: kalibrácia je čítanie. Keby čokoľvek zmenilo dáta, musí to byť vidieť.
        $nodesAfter = Node::count();
        $edgesAfter = Edge::count();
        if ($nodesAfter !== $nodesBefore || $edgesAfter !== $edgesBefore) {
            $this->error("POZOR: počty sa zmenili! uzly {$nodesBefore}→{$nodesAfter}, hrany {$edgesBefore}→{$edgesAfter}");

            return 1;
        }

        $this->info("Uzly {$nodesAfter} a hrany {$edgesAfter} nezmenené. JSON: storage/app/{$out}");
        $state = config('maintenance.destructive_enabled') ? 'ZAPNUTÉ' : 'vypnuté';
        $this->line("Deštruktívne joby sú {$state}. Prahy v configu tento príkaz NEMENÍ.");

        return 0;
    },
)->purpose('Sweep prahov deštruktívnych jobov s rozdelením skóre a značkovaním rizikových párov. Nič nemení.');

// ---------------------------------------------------------------------------
// aura:sync-runs-prune — rotácia tabuľky sync_runs (rozhodnutie #36).
// Maže VÝHRADNE riadky auditu údržby; uzlov, hrán ani aktivácií sa nedotýka.
//
// Nočný beh robí len rotáciu podľa veku. Dobehnutie historických no-op behov
// (dnes >1 200 riadkov) je mazanie dát, takže vyžaduje výslovné `--purge-noop`
// alebo AURAAI_SYNC_RUNS_PURGE_NOOP=true — nikdy sa nestane samo.
// ---------------------------------------------------------------------------
Artisan::command(
    'aura:sync-runs-prune {--dry-run : len vypíš, čo by sa zmazalo}'
    .' {--purge-noop : dobehni aj historické no-op behy (mazanie dát — vyžaduje rozhodnutie používateľa)}',
    function (SyncRunRetention $retention) {
        $dry = (bool) $this->option('dry-run');
        $purge = $this->option('purge-noop') ? true : null;
        $stats = $retention->prune($dry, $purge);

        $this->info(sprintf(
            'sync_runs%s — staré: %d · no-op zmazané: %d · zostáva: %d (cutoff %s, chybové %s)',
            $dry ? ' (dry-run)' : '',
            $stats['deleted_old'],
            $stats['deleted_noop'],
            $stats['kept'],
            substr($stats['cutoff'], 0, 10),
            substr($stats['cutoff_failed'], 0, 10),
        ));

        if ($stats['noop_pending'] > 0) {
            $this->warn(
                "{$stats['noop_pending']} historických no-op behov čaká na rozhodnutie — "
                .'spusti `aura:sync-runs-prune --purge-noop`, ak ich chceš zmazať.'
            );
        }

        return 0;
    },
)->purpose('Rotácia sync_runs: staré behy podľa veku; historické no-op behy len s --purge-noop');

// ---------------------------------------------------------------------------
// aura:rewire — rovnaký algoritmus ako mind:rewire, ale rozdelený na triedy podľa
// algoritmu (app/Services/Maintenance/Rewire/**) so stropom času/veľkosti a
// s meraním trvania každého algoritmu zvlášť. Výsledok je identický.
// ---------------------------------------------------------------------------
Artisan::command('aura:rewire {--timings : vypíš trvanie každého algoritmu}', function (RewireOrchestrator $rewire) {
    $result = $rewire->run();
    $this->info($result->summary());

    if ($this->option('timings')) {
        $rows = [];
        foreach ($result->timings as $step => $seconds) {
            $rows[] = [$step, number_format($seconds, 2).' s'];
        }
        $this->table(['Algoritmus', 'Trvanie'], $rows);
    }

    return 0;
})->purpose('Backfill similarity/skill_mention/mostov — rozdelené na triedy, so stropom času a veľkosti');

// Denna zaloha vedomia + rotacia (drzi poslednych 14 dni) — v prikaze aura:backup.
//
// PREDTYM to bol Schedule::exec s celym shell stringom, a malo to dve chyby:
//
// 1) HESLO SVIETILO. Komentar tvrdil, ze MYSQL_PWD ho pred process listom skryje —
//    skryje ale len argv samotneho mariadb-dump, nie shellu, ktory ho spusta. Heslo
//    k jedinej kopii dlhodobej pamate bolo preto citatelne vo vystupe
//    `php artisan schedule:list` aj v argv obalujuceho `sh -c`. V prikaze ide heslo
//    do procesu premennou prostredia, ktora v argv nie je vobec.
//
// 2) ROTACIA MAZALA AJ RUCNE POISTKY. `find -name "*.sql" -mtime +14 -delete` nerozlisoval
//    automaticky denny dump od dumpu, ktory si niekto vedome vytvoril pred rizikovou
//    operaciou — napr. backups/auraai-pre-embed-2026-07-30.sql by po 14 dnoch tichym
//    sposobom zmizol. aura:backup rotuje len subory tvaru `<db>-YYYY-MM-DD.sql`.
//
// Nazov DB, uzivatel a heslo sa naďalej beru Z CONFIGU, nie z literalu: pri premenovani
// DB (Hades -> AuraAI) by zadrotovany nazov znamenal, ze dump nic nezapise a jedinou
// stopou bude Log::error, ktory nikto necita.
Schedule::command('aura:backup')
    ->dailyAt('03:00')
    ->timezone('Europe/Bratislava')
    ->withoutOverlapping(60)
    ->onFailure(fn () => \Log::error('AuraAI: denna zaloha DB zlyhala'));

// Automaticke zapisovanie zaznamov zo sessions (bez modelu) — priebezne kazdych 10 minut,
// plny prechod v noci. Oba ingesty zdielaju rovnaky mutex, aby nikdy nebezali naraz.
Schedule::command('mind:ingest')
    ->everyTenMinutes()
    ->name('mind-ingest')
    ->withoutOverlapping(30)
    ->createMutexNameUsing(fn () => 'mind-ingest');
Schedule::command('mind:ingest --all')
    ->dailyAt('03:35')
    ->name('mind-ingest')
    ->withoutOverlapping(30)
    ->createMutexNameUsing(fn () => 'mind-ingest');

// Brain-indexer: indexuje ľudsky písané .md „mozgy" (skills/memory/externé) do
// siete ako origin=brain uzly. Priebežne kazdych 10 minut (withoutOverlapping
// bráni prekrytiu SEBA SAMÉHO), plný nocný prechod o 03:25 (PRED mind:ingest --all
// o 03:35). Zdieľa zámok 'brain-sync' cez BrainSyncService (UI/API/writer sa serializujú).
Schedule::command('mind:brain-sync')
    ->everyTenMinutes()
    ->name('mind-brain-sync')
    ->withoutOverlapping(30)
    ->createMutexNameUsing(fn () => 'mind-brain-sync');
Schedule::command('mind:brain-sync')
    ->dailyAt('03:25')
    ->name('mind-brain-sync')
    ->withoutOverlapping(30)
    ->createMutexNameUsing(fn () => 'mind-brain-sync');

// Nocna reorganizacia štruktúry, tyzdenny suhrn v nedelu.
Schedule::command('mind:reorganize')->dailyAt('03:50');
Schedule::command('mind:digest')->weeklyOn(0, '04:00');

// Mesačná archivácia starých session záznamov (starších ako 90 dní)
Schedule::command('mind:archive-old')->monthlyOn(1, '04:30');

// Nočná údržba vedomia — beží AŽ PO ingeste (03:35 --all). Rozostupy sú široké
// (15 min), aby ťažký mind:rewire (~O(n²) pri raste siete) stihol dobehnúť pred
// ďalším jobom. Každý job má VLASTNÝ mutex (withoutOverlapping bráni len prekrytiu
// SEBA SAMÉHO cez dni ak by zamrzol) — zámerne NEzdieľame mutex, lebo ten by pri
// dlhom rewire spôsobil PRESKOČENIE decay/cleanup v tú noc, nie ich zaradenie.
$nightly = fn (string $command, string $at) => Schedule::command($command)
    ->dailyAt($at)
    ->timezone('Europe/Bratislava')
    ->withoutOverlapping(60);

// aura:rewire je ten istý algoritmus ako mind:rewire, len rozdelený na triedy podľa
// algoritmu a so stropom času/veľkosti (config maintenance.rewire) — bez stropu by
// rast siete jedného dňa spôsobil, že O(n²) rewire pretečie do 15-minútového okna
// pred decay-om a oba joby budú súťažiť o rovnaké hrany. Výsledok je identický,
// stráži to RewireEquivalenceTest.
$nightly('aura:rewire', '04:05');            // A3–A11 — backfill synapsií (najťažší)
$nightly('mind:decay', '04:20');             // D2 — zabúdanie neaktívnych uzlov/hrán

// DEŠTRUKTÍVNE joby — nevratne MAŽÚ hrany a ZLUČUJÚ uzly nad jedinou kópiou pamäte.
// Ovládané prepínačom, lebo ich prahy (cleanup weight<1/90d, prune 0.08, automerge 0.92)
// sú kalibrované na TF-IDF. Pri prechode na embeddingy znamenajú niečo úplne iné, takže
// do rekalibrácie + schváleného dry-run reportu (aura:dry-run) musia byť VYPNUTÉ.
// Rozhodnutie #32. Prepínač sa presunul do config/maintenance.php (vlastní P2);
// pôvodný auraai.destructive_jobs_enabled zostáva ako fallback, kým ho integrátor
// nezmaže — obe čítajú tú istú env premennú, takže sa chovanie nemení.
if (config('maintenance.destructive_enabled', config('auraai.destructive_jobs_enabled'))) {
    $nightly('mind:cleanup-edges', '04:30');      // A9 — prerušenie zabudnutých synapsií
    $nightly('mind:prune-coactivation', '04:35'); // prerezanie koincidenčného hairballu (skóre < 0.08)
    $nightly('mind:automerge', '04:45');          // D5/E7 — zlúčenie takmer identických uzlov
}

// Embeddingy pre uzly, ktoré vznikli počas dňa. Bez tohto jobu nový uzol vektor nikdy
// nedostane a vektorová vetva recallu ho nevidí — počas jednej ~30-minútovej session
// pribudlo 6 uzlov bez vektora. Beh je bezpečný: idempotentný (preskočí všetko s
// aktuálnym hashom), nič nemaže, a keď Ollama nebeží, skončí s kódom 0 a hláškou
// namiesto výnimky. Čas 04:35 je za rewire aj decay, takže vektory sa počítajú nad
// už usporiadanou sieťou. Priepustnosť ~586 uzlov/min (bge-m3, 1024 dim).
$nightly('aura:embed', '04:35');

$nightly('mind:sync-memory', '04:55');       // Claude memory → Hades
$nightly('mind:export-memory', '05:05');     // Hades → Claude memory

// Týždenný projektový roll-up (nedeľa), vlastný mutex.
Schedule::command('mind:rollup')
    ->weeklyOn(0, '05:15')
    ->timezone('Europe/Bratislava')
    ->withoutOverlapping(60);

// Rotácia auditu údržby (sync_runs) — mimo okna ostatných jobov, aby nesúťažila
// o zámky. Maže len riadky auditu, nikdy dáta vedomia. Rozhodnutie #36.
$nightly('aura:sync-runs-prune', '05:30');
