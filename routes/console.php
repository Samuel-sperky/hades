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
//
// Nazov DB, uzivatel a heslo sa BERU Z CONFIGU, nie z literalu. Predtym boli zadrotovane
// tu aj v .env aj v compose — pri premenovani DB (Hades -> AuraAI) by dump tichym
// fail-safe checkom [ -s ] nic nezapisal a jedinou stopou by bol Log::error, ktory
// nikto necita. Rotacia mie na *.sql (nie na prefix), aby premenovanie nezastavilo
// mazanie starych dumpov — v backups/ nie su ine subory nez zalohy.
$db = config('database.connections.'.config('database.default'));
$dumpTmp = '/tmp/db-backup.sql';
$dumpDir = '/var/www/html/backups';

Schedule::exec(
    sprintf(
        'MYSQL_PWD=%s mariadb-dump -h %s -u%s --single-transaction --routines --triggers %s > %s',
        escapeshellarg((string) ($db['password'] ?? '')),
        escapeshellarg((string) ($db['host'] ?? 'mariadb')),
        escapeshellarg((string) ($db['username'] ?? '')),
        escapeshellarg((string) ($db['database'] ?? '')),
        $dumpTmp,
    )
    .' && [ -s '.$dumpTmp.' ]'
    .' && mv '.$dumpTmp.' '.$dumpDir.'/'.($db['database'] ?? 'db').'-$(date +\%F).sql'
    .' && find '.$dumpDir.' -name "*.sql" -mtime +14 -delete'
)->dailyAt('03:00')->onFailure(fn () => \Log::error('AuraAI: denna zaloha DB zlyhala'));

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

$nightly('mind:rewire', '04:05');            // A3 — backfill similarity synapsií (najťažší)
$nightly('mind:decay', '04:20');             // D2 — zabúdanie neaktívnych uzlov/hrán

// DEŠTRUKTÍVNE joby — nevratne MAŽÚ hrany a ZLUČUJÚ uzly nad jedinou kópiou pamäte.
// Ovládané prepínačom, lebo ich prahy (cleanup weight<1/90d, prune 0.08, automerge 0.92)
// sú kalibrované na TF-IDF. Pri prechode na embeddingy znamenajú niečo úplne iné, takže
// do rekalibrácie + schváleného --dry-run reportu musia byť VYPNUTÉ. Rozhodnutie #32.
if (config('auraai.destructive_jobs_enabled')) {
    $nightly('mind:cleanup-edges', '04:30');      // A9 — prerušenie zabudnutých synapsií
    $nightly('mind:prune-coactivation', '04:35'); // prerezanie koincidenčného hairballu (skóre < 0.08)
    $nightly('mind:automerge', '04:45');          // D5/E7 — zlúčenie takmer identických uzlov
}

$nightly('mind:sync-memory', '04:55');       // Claude memory → Hades
$nightly('mind:export-memory', '05:05');     // Hades → Claude memory

// Týždenný projektový roll-up (nedeľa), vlastný mutex.
Schedule::command('mind:rollup')
    ->weeklyOn(0, '05:15')
    ->timezone('Europe/Bratislava')
    ->withoutOverlapping(60);
