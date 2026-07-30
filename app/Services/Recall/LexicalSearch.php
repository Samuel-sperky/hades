<?php

namespace App\Services\Recall;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * PRVOTRIEDNA a POVINNÁ vetva recallu — LIKE nad koreňmi + PHP počítanie zhodných
 * konceptov. Beží vždy, aj bez Ollamy, aj bez jedného uloženého vektora.
 * Prenesené z `MindService::searchNodes()` bez zmeny chovania.
 *
 * TVRDÝ PRAH: uzol bez jediného skutočného term-hitu sa NIKDY nevráti.
 */
class LexicalSearch
{
    public function __construct(private readonly QueryAnalyzer $analyzer = new QueryAnalyzer) {}

    /**
     * Kandidáti na dopyt. Skóre = počet zhodných KONCEPTOV (nie koreňov), takže
     * uzol bohatý na jeden pojem nepredbehne uzol, ktorý trafí dva rôzne pojmy.
     *
     * `$limit` je strop výsledku; z DB sa berie širší koš (limit × 5, min. 60),
     * aby PHP prah mal z čoho vyberať.
     *
     * @return Collection<int, array{node: Node, score: int, snippet: ?string}>
     */
    public function candidates(string $query, int $limit = 12): Collection
    {
        $concepts = $this->analyzer->concepts($query);

        if ($concepts->isEmpty()) {
            return collect();
        }

        $roots = $concepts->flatten()->unique()->values();

        // SQL relevancia (label=2, description=1 za koreň) drží top kandidátov —
        // silné, ale nezhodné uzly už NEvytláčajú slabšie skutočné zhody.
        // COLLATE utf8mb4_unicode_ci = accent-insensitive: ASCII koreň 'sperk'
        // tak v SQL trafí aj diakritický 'Šperky' (a naopak).
        $col = ' COLLATE utf8mb4_unicode_ci';
        $orderCases = [];
        $orderBindings = [];
        foreach ($roots as $root) {
            $orderCases[] = '(CASE WHEN label LIKE ?'.$col.' THEN 2 ELSE 0 END)';
            $orderBindings[] = '%'.$root.'%';
            $orderCases[] = '(CASE WHEN description LIKE ?'.$col.' THEN 1 ELSE 0 END)';
            $orderBindings[] = '%'.$root.'%';
        }

        $nodes = Node::query()
            ->with(['area', 'department'])
            ->where(function ($q) use ($roots, $col) {
                foreach ($roots as $root) {
                    $like = '%'.$root.'%';
                    $q->orWhereRaw('label LIKE ?'.$col, [$like])
                        ->orWhereRaw('description LIKE ?'.$col, [$like]);
                }
            })
            ->orderByRaw(implode(' + ', $orderCases).' DESC', $orderBindings)
            ->orderByDesc('strength')
            ->limit(max($limit * 5, 60))
            ->get();

        return $nodes
            ->map(function (Node $node) use ($concepts, $roots) {
                // fold haystack — korene sú už foldnuté v concepts(), takže
                // tvrdý prah je tiež necitlivý na diakritiku
                $hay = ' '.$this->analyzer->fold(trim($node->label.' '.(string) $node->description)).' ';

                // koncept je zhoda, ak ho trafí aspoň jeden jeho koreň
                $score = $concepts->filter(
                    fn (Collection $conceptRoots) => $conceptRoots->contains(
                        fn ($root) => mb_strpos($hay, $root) !== false
                    )
                )->count();

                return [
                    'node' => $node,
                    'score' => $score,
                    'snippet' => $this->analyzer->snippet((string) $node->description, $roots),
                ];
            })
            ->filter(fn ($row) => $row['score'] > 0)   // tvrdý prah — 0 zhodných konceptov = von
            ->values();
    }

    /** Korene dopytu — pre snippety vektorových kandidátov. */
    public function analyzer(): QueryAnalyzer
    {
        return $this->analyzer;
    }
}
