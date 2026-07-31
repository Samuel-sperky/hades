<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

/**
 * Denná záloha vedomia + rotácia.
 *
 * PREČO PRÍKAZ A NIE `Schedule::exec`:
 * predchádzajúca verzia skladala `MYSQL_PWD=<heslo> mariadb-dump …` do jedného shell
 * stringu. Komentár tvrdil, že `MYSQL_PWD` chráni heslo pred process listom — chráni
 * ale len argv samotného `mariadb-dump`, nie shellu, ktorý ho spúšťa. Heslo bolo preto
 * čitateľné vo výstupe `php artisan schedule:list` aj v argv obaľujúceho `sh -c`.
 * Tu ide heslo do procesu **premennou prostredia**, ktorá v argv nie je vôbec.
 *
 * Presunutie do `printf … > /tmp/.my.cnf` by problém nevyriešilo — heslo by bolo
 * v argv toho `printf`.
 *
 * ROTÁCIA maže len automatické denné dumpy (`<db>-YYYY-MM-DD.sql`). Ručné poistky
 * ako `auraai-pre-embed-2026-07-30.sql` prežijú: predchádzajúca rotácia mazala
 * `*.sql` bez rozdielu, takže dump, ktorý si niekto vedome vytvoril pred rizikovou
 * operáciou, po 14 dňoch tichým spôsobom zmizol.
 */
class AuraBackup extends Command
{
    protected $signature = 'aura:backup
        {--keep=14 : koľko dní držať automatické denné dumpy}
        {--dry-run : nič nezapíš ani nemaž, len vypíš, čo by sa stalo}';

    protected $description = 'Dump databázy vedomia do backups/ + rotácia automatických dumpov';

    public function handle(): int
    {
        $conn = (string) config('database.default');
        $db = (array) config('database.connections.'.$conn);

        $name = (string) ($db['database'] ?? '');
        if ($name === '') {
            $this->error('Názov databázy je prázdny — neviem, čo zálohovať.');

            return self::FAILURE;
        }

        $dir = base_path('backups');
        $target = $dir.'/'.$name.'-'.now()->format('Y-m-d').'.sql';
        $tmp = sys_get_temp_dir().'/aura-backup-'.bin2hex(random_bytes(6)).'.sql';

        if ($this->option('dry-run')) {
            $this->line("dump  → {$target}");
            $this->line('rotácia: '.implode(', ', array_map('basename', $this->rotatable($dir, $name))) ?: 'rotácia: nič');

            return self::SUCCESS;
        }

        if (! is_dir($dir) && ! mkdir($dir, 0o775, true) && ! is_dir($dir)) {
            $this->error("Priečinok {$dir} sa nedá vytvoriť.");

            return self::FAILURE;
        }

        $out = fopen($tmp, 'wb');
        if ($out === false) {
            $this->error("Dočasný súbor {$tmp} sa nedá otvoriť.");

            return self::FAILURE;
        }

        // Heslo ide výhradne cez env. `--single-transaction` drží konzistentný snapshot
        // bez zamknutia tabuliek, takže ingest môže bežať ďalej.
        $process = new Process([
            'mariadb-dump',
            '-h', (string) ($db['host'] ?? 'mariadb'),
            '-u', (string) ($db['username'] ?? ''),
            '--single-transaction',
            '--routines',
            '--triggers',
            $name,
        ], null, ['MYSQL_PWD' => (string) ($db['password'] ?? '')], null, 900.0);

        $process->run(function (string $type, string $chunk) use ($out): void {
            if ($type === Process::OUT) {
                fwrite($out, $chunk);
            } else {
                // stderr môže obsahovať varovania, ktoré nie sú chybou; heslo v ňom nie je.
                $this->line(rtrim($chunk), 'comment');
            }
        });

        fclose($out);

        if (! $process->isSuccessful()) {
            @unlink($tmp);
            $this->error('mariadb-dump zlyhal (kód '.$process->getExitCode().'). Nič sa nezapísalo.');

            return self::FAILURE;
        }

        // Fail-safe: prázdny dump sa do backups/ nikdy nedostane. Bez tohto by
        // zlyhanie prepísalo poslednú funkčnú zálohu prázdnym súborom.
        $size = (int) @filesize($tmp);
        if ($size <= 0) {
            @unlink($tmp);
            $this->error('Dump je prázdny — do backups/ som nič nepresunul.');

            return self::FAILURE;
        }

        if (! @rename($tmp, $target)) {
            @unlink($tmp);
            $this->error("Presun do {$target} zlyhal.");

            return self::FAILURE;
        }

        $this->info('Záloha: '.basename($target).' ('.number_format($size / 1048576, 2).' MB)');

        $deleted = 0;
        foreach ($this->rotatable($dir, $name) as $old) {
            if (@unlink($old)) {
                $deleted++;
            }
        }
        if ($deleted > 0) {
            $this->line("Rotácia: zmazaných {$deleted} dumpov starších než ".$this->keep().' dní.');
        }

        return self::SUCCESS;
    }

    private function keep(): int
    {
        return max(1, (int) $this->option('keep'));
    }

    /**
     * Automatické denné dumpy starší než `--keep` dní.
     *
     * Vzor je úmyselne úzky (`<db>-YYYY-MM-DD.sql`): ručne vytvorené poistky
     * s iným názvom sa rotácie nedotknú.
     *
     * @return list<string>
     */
    private function rotatable(string $dir, string $db): array
    {
        $cutoff = now()->subDays($this->keep())->getTimestamp();
        $out = [];

        foreach (glob($dir.'/'.$db.'-*.sql') ?: [] as $path) {
            if (preg_match('/-\d{4}-\d{2}-\d{2}\.sql$/', $path) !== 1) {
                continue;   // nie je to automatický denný dump
            }
            if ((int) @filemtime($path) < $cutoff) {
                $out[] = $path;
            }
        }

        return $out;
    }
}
