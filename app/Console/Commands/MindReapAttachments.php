<?php

namespace App\Console\Commands;

use App\Services\Console\Attachments;
use Illuminate\Console\Command;

/**
 * Zametanie príloh, na ktoré už nikto neukazuje.
 *
 * Vzor je {@see MindReapRuns}: kaskáda v databáze zmaže RIADOK, ale súbor na
 * disku nie, a `finally` v kontroléri nezbehne, keď zomrie proces. Tri druhy
 * odpadu, ktoré tu preto vznikajú:
 *
 *  1. **Rozpracované prílohy** (`message_id IS NULL`) — človek priložil súbor do
 *     vstupu a správu neposlal. Sú to živé dáta, kým je vstup otvorený, takže sa
 *     zametajú až po niekoľkých hodinách.
 *  2. **Priečinky zmazaných vlákien** — priečinok sa menuje uuid vlákna, takže
 *     osirelosť sa pozná bez čítania riadkov.
 *  3. **Súbory bez riadku** — presunuté na disk v ťahu, ktorý spadol pred
 *     `INSERT`om.
 *
 * **Súbor sa nikdy nemaže pri mazaní riadku, len tu, a len keď naň neukazuje
 * žiadny riadok.** Dôvod je vetvenie: editácia správy skopíruje prílohy ako
 * riadky s tou istou cestou, takže mazanie súboru pri mazaní riadku by zmazaním
 * jednej vetvy vytrhlo prílohu druhej.
 *
 * Prečo to nie je v nočnom bloku: rozpracovaná príloha je súbor, ktorý človek do
 * appky nahodil a appka ho už nikomu nedá — priestor bez čitateľa. Beží preto
 * v tom istom rytme ako `mind:reap-runs`.
 */
class MindReapAttachments extends Command
{
    protected $signature = 'mind:reap-attachments
        {--hours= : Po koľkých hodinách je rozpracovaná príloha odpad (default z configu)}
        {--dry-run : Len vypíš, čo by sa zmazalo}';

    protected $description = 'Zmaže rozpracované prílohy a súbory príloh, na ktoré neukazuje žiadny riadok';

    public function handle(Attachments $attachments): int
    {
        $hours = (int) ($this->option('hours') ?: $attachments->draftHours());
        $dryRun = (bool) $this->option('dry-run');

        $result = $attachments->sweep($hours, $dryRun);

        if (array_sum($result) === 0) {
            $this->info('Žiadna osirelá príloha.');

            return self::SUCCESS;
        }

        $line = sprintf(
            'rozpracované: %d · osirelé priečinky vlákien: %d · zmazané súbory: %d',
            $result['drafts'],
            $result['threads'],
            $result['files'],
        );

        if ($dryRun) {
            $this->comment("Dry-run — {$line}.");

            return self::SUCCESS;
        }

        $this->info("Zametené — {$line}.");

        return self::SUCCESS;
    }
}
