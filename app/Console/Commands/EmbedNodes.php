<?php

namespace App\Console\Commands;

use App\Models\Node;
use App\Services\EmbeddingService;
use Illuminate\Console\Command;

/**
 * Vektorizuje uzly siete lokálnym embedding modelom — dávkový beh pre semantický
 * recall.
 *
 * Default je `--stale`: vektorizuje len uzly bez vektora alebo s textom, ktorý sa
 * od poslednej vektorizácie zmenil. Plná sada je na CPU (žiadna použiteľná GPU)
 * beh na desiatky minút — namerané na bge-m3 v tomto kontejneri: 4,4 s prvé
 * volanie (načítanie modelu), potom ~260 ms na uzol, teda ~12 minút na 2 667
 * uzlov. Preto „prevektorizuj všetko" musí byť vedomé rozhodnutie (`--all`),
 * nie default.
 *
 * Beh je prerušiteľný. Každý uzol sa zapisuje samostatne, nič nie je v jednej
 * transakcii, takže Ctrl-C zastaví prácu a nezruší ju — ďalší `mind:embed`
 * pokračuje presne tam, kde sa skončilo.
 */
class EmbedNodes extends Command
{
    protected $signature = 'mind:embed
        {--stale : Len uzly bez vektora alebo so zmeneným textom (default)}
        {--all : Prevektorizovať všetky uzly, aj nezmenené}
        {--limit= : Spracovať najviac N uzlov (zvyšok zostane na ďalší beh)}';

    protected $description = 'Vektorizuje uzly siete embedding modelom pre semantický recall';

    public function handle(EmbeddingService $embeddings): int
    {
        $all = (bool) $this->option('all');

        if (! $embeddings->enabled()) {
            // Explicitné zavolanie príkazu je zámer, takže nebrzdíme — ale vektory
            // by bez zapnutej vetvy nikto nečítal a to treba povedať nahlas.
            $this->warn('hades.embeddings.enabled je vypnuté — vektory sa zapíšu, ale recall ich nepoužije.');
        }

        $this->line("Model: {$embeddings->model()}");

        $ids = $embeddings->staleNodeIds($all);
        $total = count($ids);

        if ($total === 0) {
            $this->info('Niet čo vektorizovať — všetky uzly majú aktuálny vektor.');

            return self::SUCCESS;
        }

        $limit = (int) $this->option('limit');

        if ($limit > 0 && $limit < $total) {
            $ids = array_slice($ids, 0, $limit);
            $this->line("Na spracovanie: {$limit} z {$total} uzlov (--limit).");
            $total = $limit;
        } else {
            $this->line("Na spracovanie: {$total} uzlov.");
        }

        $batch = max(1, (int) config('hades.embeddings.batch', 16));
        $stats = ['embedded' => 0, 'skipped' => 0, 'failed' => 0];
        $errors = [];

        $bar = $this->output->createProgressBar($total);
        $bar->start();

        foreach (array_chunk($ids, $batch) as $chunk) {
            $nodes = Node::query()
                ->with(['tags:id,name', 'area:id,name', 'department:id,name'])
                ->whereIn('id', $chunk)
                ->orderBy('id')
                ->get();

            $result = $embeddings->embedNodes($nodes, $all, fn () => $bar->advance());

            $stats['embedded'] += $result['embedded'];
            $stats['skipped'] += $result['skipped'];
            $stats['failed'] += $result['failed'];
            $errors += $result['errors'];

            // uzol medzičasom zmazaný z iného behu sa v `get()` nevráti — bar by
            // inak nikdy nedošiel do konca
            $bar->advance(count($chunk) - $nodes->count());
        }

        $bar->finish();
        $this->newLine(2);

        $this->table(
            ['vektorizované', 'preskočené', 'chybné'],
            [[$stats['embedded'], $stats['skipped'], $stats['failed']]],
        );

        if ($errors !== []) {
            $this->newLine();
            $this->error('Chyby (prvých 5):');

            foreach (array_slice($errors, 0, 5, true) as $nodeId => $message) {
                $this->line("  uzol #{$nodeId}: {$message}");
            }

            $this->newLine();
            $this->warn('Hotové vektory zostali zapísané — opakovaný `mind:embed` dorobí len zvyšok.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
