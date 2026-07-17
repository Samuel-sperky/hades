<?php

namespace App\Services;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * Čistý TF-IDF + kosínusová podobnosť uzlov — bez modelu, deterministické.
 * IDF a tokenizovaný korpus sa nacache-ujú do inštancie, takže dávkový beh
 * (rewire) tokenizuje každý uzol len raz.
 */
class SimilarityService
{
    /** Diakritika → ASCII (slovenčina + čeština). */
    protected array $diacritics = [
        'á' => 'a', 'ä' => 'a', 'à' => 'a', 'â' => 'a', 'č' => 'c', 'ć' => 'c',
        'ď' => 'd', 'é' => 'e', 'ě' => 'e', 'ë' => 'e', 'í' => 'i', 'î' => 'i',
        'ĺ' => 'l', 'ľ' => 'l', 'ł' => 'l', 'ň' => 'n', 'ó' => 'o', 'ô' => 'o',
        'ö' => 'o', 'ŕ' => 'r', 'ř' => 'r', 'š' => 's', 'ś' => 's', 'ť' => 't',
        'ú' => 'u', 'ů' => 'u', 'ü' => 'u', 'ý' => 'y', 'ž' => 'z', 'ź' => 'z',
        'ż' => 'z',
    ];

    /** Slovenský + anglický stoplist (~40 slov). */
    protected array $stop = [
        'a', 'and', 'the', 'pre', 'pro', 'ako', 'som', 'by', 'na', 'do', 'to',
        'je', 'sa', 'that', 'with', 'cez', 'aby', 'uz', 'len', 'tak', 'ale',
        'alebo', 'or', 'of', 'in', 'for', 'ku', 'ma', 'mi', 'si', 'co', 'ze',
        'this', 'from', 'ktore', 'ktory', 'aj', 'nie', 'ano', 'vsetko', 'este',
        'bude', 'budem', 'mam', 'has', 'are', 'was', 'not', 'you', 'all',
    ];

    /** @var array<int, array<string, int>> node_id => term frequency map */
    protected array $corpus = [];

    /** @var array<string, float> term => IDF */
    protected array $idf = [];

    /** @var array<int, string> node_id → surový text (label+description+meta) */
    protected array $texts = [];

    protected bool $warmed = false;

    /**
     * Tokenizuje reťazec: lowercase, bez diakritiky, rozdelí na písmená,
     * zahodí tokeny kratšie než 3 znaky a stopslová. Vráti mapu frekvencií.
     *
     * @return array<string, int>
     */
    public function tokenize(string $text): array
    {
        $text = strtr(mb_strtolower($text), $this->diacritics);
        $tokens = preg_split('/[^a-z0-9]+/', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $tf = [];
        foreach ($tokens as $tok) {
            if (mb_strlen($tok) < 3 || in_array($tok, $this->stop, true)) {
                continue;
            }
            $tf[$tok] = ($tf[$tok] ?? 0) + 1;
        }

        return $tf;
    }

    /**
     * Predpočíta IDF a tokenizovaný korpus zo zadaných uzlov. Zavolaj pred
     * dávkovým behom score()/topSimilar().
     */
    public function warmCorpus(Collection $nodes): void
    {
        $this->corpus = [];
        $this->texts = [];
        $docFreq = [];

        foreach ($nodes as $node) {
            $text = $this->nodeText($node);
            $tf = $this->tokenize($text);
            $this->corpus[$node->id] = $tf;
            $this->texts[$node->id] = $text;

            foreach (array_keys($tf) as $term) {
                $docFreq[$term] = ($docFreq[$term] ?? 0) + 1;
            }
        }

        $n = max(1, count($this->corpus));
        $this->idf = [];
        foreach ($docFreq as $term => $df) {
            // vyhladené IDF, vždy kladné
            $this->idf[$term] = log(($n + 1) / ($df + 1)) + 1;
        }

        $this->warmed = true;
    }

    /**
     * Kosínusová podobnosť dvoch uzlov nad TF-IDF vektormi (0..1).
     */
    public function score(Node $a, Node $b): float
    {
        $tfA = $this->tfFor($a);
        $tfB = $this->tfFor($b);

        if ($tfA === [] || $tfB === []) {
            return 0.0;
        }

        $vecA = $this->weight($tfA);
        $vecB = $this->weight($tfB);

        $dot = 0.0;
        foreach ($vecA as $term => $wa) {
            if (isset($vecB[$term])) {
                $dot += $wa * $vecB[$term];
            }
        }
        if ($dot <= 0.0) {
            return 0.0;
        }

        $normA = sqrt(array_sum(array_map(fn ($w) => $w * $w, $vecA)));
        $normB = sqrt(array_sum(array_map(fn ($w) => $w * $w, $vecB)));
        if ($normA <= 0.0 || $normB <= 0.0) {
            return 0.0;
        }

        return min(1.0, $dot / ($normA * $normB));
    }

    /**
     * k najpodobnejších INÝCH uzlov nad prahom $min. Voliteľný $filter(Node): bool
     * odfiltruje kandidátov (napr. už prepojených). Vracia [['node_id'=>, 'score'=>], …]
     * zoradené zostupne.
     *
     * @return array<int, array{node_id: int, score: float}>
     */
    public function topSimilar(Node $node, int $k = 3, float $min = 0.18, ?callable $filter = null): array
    {
        if (! $this->warmed) {
            $this->warmCorpus(Node::query()->get());
        }

        $scores = [];
        foreach (array_keys($this->corpus) as $otherId) {
            if ($otherId === $node->id) {
                continue;
            }

            $other = Node::find($otherId);
            if (! $other) {
                continue;
            }
            if ($filter && ! $filter($other)) {
                continue;
            }

            $s = $this->score($node, $other);
            if ($s >= $min) {
                $scores[] = ['node_id' => $otherId, 'score' => round($s, 4)];
            }
        }

        usort($scores, fn ($x, $y) => $y['score'] <=> $x['score']);

        return array_slice($scores, 0, $k);
    }

    /**
     * Text uzla pre podobnosť: label + description (+ meta.project a kľúče
     * meta.tools pri session uzloch).
     */
    protected function nodeText(Node $node): string
    {
        $parts = [(string) $node->label, (string) $node->description];

        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['project'])) {
            $parts[] = (string) $meta['project'];
        }
        if (! empty($meta['tools']) && is_array($meta['tools'])) {
            $parts[] = implode(' ', array_keys($meta['tools']));
        }

        return trim(implode(' ', $parts));
    }

    /**
     * TF mapa uzla z cache, alebo dopočítaná za behu.
     *
     * @return array<string, int>
     */
    protected function tfFor(Node $node): array
    {
        return $this->corpus[$node->id] ?? $this->tokenize($this->nodeText($node));
    }

    /**
     * TF-IDF váhový vektor z TF mapy. Neznáme termy (mimo korpusu) dostanú
     * neutrálnu IDF 1.0.
     *
     * @param  array<string, int>  $tf
     * @return array<string, float>
     */
    protected function weight(array $tf): array
    {
        $vec = [];
        foreach ($tf as $term => $count) {
            $vec[$term] = $count * ($this->idf[$term] ?? 1.0);
        }

        return $vec;
    }
}
