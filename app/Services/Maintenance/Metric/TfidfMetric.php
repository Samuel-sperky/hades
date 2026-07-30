<?php

namespace App\Services\Maintenance\Metric;

use App\Models\Node;
use App\Services\SimilarityService;
use Illuminate\Support\Collection;

/**
 * Dnešná metrika: TF-IDF kosínus zo SimilarityService. Prahy 0.92 / 0.20 / 0.08 /
 * 0.18 sú kalibrované práve na ňu, takže v dry-run reporte je to referenčný stĺpec.
 */
class TfidfMetric implements SimilarityMetric
{
    public function __construct(private SimilarityService $similarity) {}

    public function name(): string
    {
        return 'tfidf';
    }

    public function available(): bool
    {
        return true;
    }

    public function unavailableReason(): string
    {
        return '';
    }

    public function warm(Collection $nodes): void
    {
        $this->similarity->warmCorpus($nodes);
    }

    public function score(Node $a, Node $b): ?float
    {
        return $this->similarity->score($a, $b);
    }
}
