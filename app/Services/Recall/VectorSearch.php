<?php

namespace App\Services\Recall;

use App\Services\Embeddings\EmbeddingService;
use App\Services\Embeddings\EmbeddingStore;
use App\Services\Embeddings\EmbeddingVector;

/**
 * DRUHÉ skóre navrch lexikálnej vetvy — kosínus dopytu proti `nodes.embedding`.
 *
 * Celá trieda je NEPOVINNÁ. Keď Ollama nebeží, keď je LLM vypnutý alebo keď v DB
 * nie je ani jeden vektor, `scores()` vráti prázdne pole a recall je bit-identický
 * s čistým TF-IDF. Žiadna výnimka, žiadny log, žiadne varovanie v UI.
 */
class VectorSearch
{
    public function __construct(
        private readonly EmbeddingService $embeddings = new EmbeddingService,
        private readonly EmbeddingStore $store = new EmbeddingStore,
    ) {}

    /** Je vektorová vetva zapnutá? `recall.vector.enabled` = null znamená auto. */
    public function enabled(): bool
    {
        $flag = config('recall.vector.enabled');

        if ($flag === false) {
            return false;
        }

        // auto (null) aj vynútené (true) stále vyžadujú dostupné embeddingy —
        // vynútenie nesmie appku rozbiť, keď Ollama nebeží.
        return $this->embeddings->available();
    }

    /** 'rerank' (default) = len preradenie lexikálnych zásahov, 'expand' = smie pridať kandidátov. */
    public function mode(): string
    {
        return config('recall.vector.mode') === 'expand' ? 'expand' : 'rerank';
    }

    /**
     * Kosínus dopytu ku každému uzlu, ktorý má vektor z aktuálneho modelu.
     * Prázdne pole = vetva sa vynecháva.
     *
     * @return array<int, float>  node_id => 0..1
     */
    public function scores(string $query): array
    {
        if (trim($query) === '' || ! $this->enabled()) {
            return [];
        }

        $model = $this->embeddings->model();
        $dimensions = $this->embeddings->dimensions();

        // Najprv korpus: keď v DB nie je ani jeden vektor, dopyt sa ani neposiela.
        $corpus = $this->store->all($model, $dimensions);
        if ($corpus === []) {
            return [];
        }

        $queryVector = $this->embeddings->embedOne($query);
        if ($queryVector === [] || count($queryVector) !== $dimensions) {
            return [];
        }

        $out = [];
        foreach ($corpus as $nodeId => $vector) {
            $out[$nodeId] = EmbeddingVector::cosine($queryVector, $vector);
        }

        return $out;
    }
}
