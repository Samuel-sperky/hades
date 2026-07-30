<?php

namespace App\Console\Commands;

use App\Services\Embeddings\EmbedRunner;
use App\Services\Embeddings\EmbeddingStore;
use Illuminate\Console\Command;

/**
 * Dávkový prepočet embeddingov uzlov (balík P1). Logika žije v `EmbedRunner`,
 * tento príkaz je len obal nad Artisanom + progress bar.
 *
 * IDEMPOTENTNÝ: druhý beh nezapíše nič a neposiela do Ollamy ani jeden request.
 * `--force` prepočíta všetko.
 *
 * Bez dostupnej Ollamy skončí stavom „nedostupné" a **návratovým kódom 0** —
 * appka nie je rozbitá, recall pokračuje na čistom TF-IDF (rozhodnutie #104).
 */
class AuraEmbed extends Command
{
    protected $signature = 'aura:embed
        {--force : prepočíta všetky uzly aj keď sa im text nezmenil}
        {--all : kompatibilita — prechádza sa celé vedomie aj bez tohto prepínača}
        {--limit= : spracuj najviac N uzlov (ladenie)}';

    protected $description = 'Prepočíta embeddingy uzlov (bge-m3) do nodes.embedding — idempotentne';

    /** `mind:*` alias do konca sprintu, rovnako ako u ostatných príkazov. */
    protected $aliases = ['mind:embed'];

    public function handle(EmbedRunner $runner, EmbeddingStore $store): int
    {
        $force = (bool) $this->option('force');
        $limit = $this->option('limit') !== null ? max(1, (int) $this->option('limit')) : null;

        $bar = null;
        $result = $runner->run($force, $limit, function (int $done, int $total) use (&$bar) {
            if ($bar === null) {
                $bar = $this->output->createProgressBar($total);
                $bar->start();
            }
            $bar->setProgress($done);
        });

        $bar?->finish();
        $this->newLine();

        if ($result['status'] === 'unavailable') {
            $this->warn('Embeddingy sa preskočili: '.$result['reason']);
            $this->line('Recall beží ďalej na lexikálnej (TF-IDF) vetve — appka je v poriadku.');

            return self::SUCCESS;
        }

        $this->table(
            ['model', 'dim', 'na spracovanie', 'zapísané', 'preskočené', 'zlyhané', 'v DB celkom'],
            [[
                $result['model'],
                $result['dimensions'],
                $result['total'],
                $result['embedded'],
                $result['skipped'],
                $result['failed'],
                $store->count($result['model']),
            ]],
        );

        if ($result['failed'] > 0) {
            $this->warn($result['reason'] ?? 'časť dávky sa nepodarilo prepočítať');
            $this->line('Nič sa nezmazalo — ďalší beh dopočíta zvyšok.');
        }

        return self::SUCCESS;
    }
}
