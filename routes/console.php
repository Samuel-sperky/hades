<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Denna zaloha vedomia + rotacia (drzi poslednych 14 dni)
Schedule::exec(
    'mariadb-dump -h mariadb -uhades -phades hades > /var/www/html/backups/hades-$(date +\%F).sql'
    .' && find /var/www/html/backups -name "hades-*.sql" -mtime +14 -delete'
)->dailyAt('03:00');

// Nocna regeneracia .md zrkadla (mind/) — poistka proti driftu suborov voci DB
Schedule::command('mind:export')->dailyAt('03:30');
