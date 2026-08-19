<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Denna zaloha vedomia + rotacia (drzi poslednych 14 dni).
// Fail-safe: dump ide najprv do temp suboru a do backups/ sa presunie len ak nie je
// prazdny; heslo cez MYSQL_PWD namiesto argv (-p), aby nesvietilo v process liste.
Schedule::exec(
    'MYSQL_PWD=hades mariadb-dump -h mariadb -uhades hades > /tmp/hades-backup.sql'
    .' && [ -s /tmp/hades-backup.sql ]'
    .' && mv /tmp/hades-backup.sql /var/www/html/backups/hades-$(date +\%F).sql'
    .' && find /var/www/html/backups -name "hades-*.sql" -mtime +14 -delete'
)->dailyAt('03:00')->onFailure(fn () => \Log::error('Hades backup zlyhal'));

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

// Nočná údržba vedomia — beží AŽ PO ingeste (03:35 --all). Každý job má VLASTNÝ
// mutex (withoutOverlapping bráni len prekrytiu SEBA SAMÉHO cez dni ak by zamrzol)
// — zámerne NEzdieľame mutex, lebo ten by pri dlhom rewire spôsobil PRESKOČENIE
// decay/cleanup v tú noc, nie ich zaradenie.
//
// PORADIE JE ZÁVÄZNÉ: mind:rewire je POSLEDNÝ, lebo je jediný dlhobežiaci
// (~O(n²), pri 2 587 uzloch cez 55 minút) a drží si kolekciu uzlov v pamäti od
// svojho štartu. Keď bežal PRVÝ (04:05), mind:automerge mu o 04:45 spod rúk
// zmazal zlúčené uzly a rewire o 05:01 padol na FK constraint — similarity hrany
// sa nedogenerovali, kým cleanup/prune ich ďalej mazali, takže sieť sa rozpadala
// (17 207 → 7 877 hrán). Všetko, čo maže alebo pridáva uzly, teda ide PRED rewire.
// Druhá poistka je kontrola existencie uzla v MindService::connect().
$nightly = fn (string $command, string $at) => Schedule::command($command)
    ->dailyAt($at)
    ->timezone('Europe/Bratislava')
    ->withoutOverlapping(60);

$nightly('mind:automerge', '04:05');          // D5/E7 — zlúčenie takmer identických uzlov (MAŽE uzly)
$nightly('mind:decay', '04:15');              // D2 — zabúdanie neaktívnych uzlov/hrán
$nightly('mind:cleanup-edges', '04:25');      // A9 — prerušenie zabudnutých synapsií
$nightly('mind:prune-coactivation', '04:35'); // prerezanie koincidenčného hairballu (skóre < 0.08)
$nightly('mind:prune-tags', '04:40');         // A11 — tagy bez väzby na uzol
$nightly('mind:prune-telemetry', '04:42');    // A12 — staré sync_runs a stopy po čítaní
$nightly('mind:sync-memory', '04:45');        // Claude memory → Hades (PRIDÁVA uzly)
$nightly('mind:export-memory', '04:55');      // Hades → Claude memory
$nightly('mind:rewire', '05:10');             // A3 — backfill similarity synapsií (najťažší, POSLEDNÝ)

// Týždenný projektový roll-up (nedeľa), vlastný mutex.
Schedule::command('mind:rollup')
    ->weeklyOn(0, '05:15')
    ->timezone('Europe/Bratislava')
    ->withoutOverlapping(60);

// Plánované behy konzoly (tabuľka console_schedules). Príkaz sa pýta každú minútu,
// pretože cron výraz rozvrhu môže byť ľubovoľne hustý — granularitu určuje rozvrh,
// nie táto registrácia; príkaz sám vyhodnotí, čo na túto minútu vychádza.
//
// withoutOverlapping je podmienka, nie opatrnosť: rozvrh beží cez HeadlessRunner na
// lokálnom modeli, ktorý na CPU generuje aj niekoľko minút. Bez zámku by minútový
// tik naskladal ďalší proces na ešte bežiaci a stroj by sa zadusil na inferencii,
// ktorú nikto nečaká.
Schedule::command('mind:console-schedules')
    ->everyMinute()
    ->name('console-schedules')
    ->withoutOverlapping(30)
    ->createMutexNameUsing(fn () => 'console-schedules');
