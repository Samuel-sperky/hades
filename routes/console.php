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

// Nocna reorganizacia štruktúry, tyzdenny suhrn v nedelu.
Schedule::command('mind:reorganize')->dailyAt('03:50');
Schedule::command('mind:digest')->weeklyOn(0, '04:00');

// Mesačná archivácia starých session záznamov (starších ako 90 dní)
Schedule::command('mind:archive-old')->monthlyOn(1, '04:30');
