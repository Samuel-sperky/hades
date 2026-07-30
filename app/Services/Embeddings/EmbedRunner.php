<?php

namespace App\Services\Embeddings;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * Dávkový prepočet embeddingov nad celým vedomím. Logika príkazu `aura:embed`
 * žije tu, aby bola testovateľná bez Artisanu.
 *
 * Vlastnosti, ktoré sú akceptačné kritérium (28):
 *   - IDEMPOTENCIA: druhý beh nezapíše nič. „Treba prepočítať?" sa rozhoduje
 *     porovnaním modelu, dimenzie a sha256 textu — nie časom.
 *   - `--force` prepočíta všetko bez ohľadu na hash.
 *   - Bez dostupného providera (Ollama nebeží) skončí `skipped` s dôvodom,
 *     NIE chybou. Návratový kód príkazu je 0 — appka nie je rozbitá.
 *   - Nikdy nemaže. Neúspešná dávka nechá starý vektor na mieste.
 */
class EmbedRunner
{
    public function __construct(
        private readonly EmbeddingService $embeddings = new EmbeddingService,
        private readonly EmbeddingStore $store = new EmbeddingStore,
    ) {}

    /**
     * @param  callable(int, int, string): void|null  $onProgress  (hotových, celkom, label)
     * @return array{
     *     status: 'ok'|'unavailable',
     *     model: string,
     *     dimensions: int,
     *     total: int,
     *     embedded: int,
     *     skipped: int,
     *     failed: int,
     *     reason: ?string
     * }
     */
    public function run(bool $force = false, ?int $limit = null, ?callable $onProgress = null): array
    {
        $model = $this->embeddings->model();
        $dimensions = $this->embeddings->dimensions();

        $base = [
            'status' => 'ok',
            'model' => $model,
            'dimensions' => $dimensions,
            'total' => 0,
            'embedded' => 0,
            'skipped' => 0,
            'failed' => 0,
            'reason' => null,
        ];

        if (! $this->embeddings->available()) {
            return [...$base, 'status' => 'unavailable', 'reason' => 'embedding provider nie je dostupný'];
        }

        /** @var Collection<int, Node> $nodes */
        $nodes = Node::query()->orderBy('id')->get();
        $state = $this->store->state();

        // Rozdelenie na „treba" a „netreba" prebehne PRED odoslaním čohokoľvek,
        // takže idempotentný beh nevytvorí ani jeden HTTP request na Ollamu.
        $pending = [];
        foreach ($nodes as $node) {
            $text = $this->embeddings->textForNode($node);
            if ($text === '') {
                $base['skipped']++;

                continue;
            }

            $hash = $this->embeddings->hash($text);

            if (! $force && ! $this->store->isStale($state[$node->id] ?? null, $model, $hash, $dimensions)) {
                $base['skipped']++;

                continue;
            }

            $pending[] = ['node' => $node, 'text' => $text, 'hash' => $hash];
        }

        if ($limit !== null && $limit > 0) {
            $pending = array_slice($pending, 0, $limit);
        }

        $base['total'] = count($pending);
        $batchSize = max(1, (int) config('recall.embed.batch', 16));
        $done = 0;

        foreach (array_chunk($pending, $batchSize) as $chunk) {
            $vectors = $this->embeddings->embed(array_column($chunk, 'text'));

            if (count($vectors) !== count($chunk)) {
                // Provider spadol počas behu — zvyšok necháme na ďalší beh.
                // Nič sa nemaže, doteraz zapísané vektory zostávajú platné.
                $base['failed'] += count($chunk);
                $base['reason'] ??= 'embedding provider prestal odpovedať počas behu';

                continue;
            }

            foreach ($chunk as $i => $row) {
                /** @var Node $node */
                $node = $row['node'];
                $this->store->put($node->id, $vectors[$i], $model, $row['hash']);
                $base['embedded']++;
                $done++;

                if ($onProgress !== null) {
                    $onProgress($done, $base['total'], (string) $node->label);
                }
            }
        }

        return $base;
    }
}
