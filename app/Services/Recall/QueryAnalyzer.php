<?php

namespace App\Services\Recall;

use App\Services\SimilarityService;
use Illuminate\Support\Collection;

/**
 * Rozbor dopytu: dopyt → koncepty → korene, plus SK-aware pomôcky (fold, stem,
 * snippet). Vyčlenené z `MindService` (rozhodnutie #40) BEZ zmeny chovania —
 * telá metód sú prenesené 1:1, mení sa len ich domov.
 *
 * `MindService` a `SearchService`/`LibraryController` na tieto metódy siahajú
 * cez `MindService` (fold/skStem/queryRoots/queryConcepts zostávajú verejné
 * delegáty), takže konzumentom sa nemenia signatúry.
 */
class QueryAnalyzer
{
    /**
     * Slovenské + anglické funkčné slová, ktoré v dopyte nič zmysluplné
     * nehľadajú. Odhadzujú sa PRED stemmingom — bránia tomu, aby '%ako%' a
     * spol. našli skoro každý uzol a zhodili relevanciu na strength.
     */
    public const STOP = [
        'ako', 'aby', 'ale', 'alebo', 'ani', 'and', 'the', 'pre', 'pri', 'pro',
        'cez', 'som', 'byť', 'bez', 'tak', 'len', 'už', 'kto', 'čo', 'že', 'či',
        'aj', 'nie', 'áno', 'ešte', 'for', 'with', 'from', 'you', 'this', 'that',
        'not', 'sme', 'ste', 'sú', 'bol', 'bola', 'boli', 'mať', 'ten', 'tej',
        'táto', 'tento', 'toto', 'sem', 'tam', 'kde', 'keď', 'pod', 'nad', 'ich',
    ];

    public function __construct(private readonly SimilarityService $similarity = new SimilarityService) {}

    /**
     * Dopyt → koncepty. Každý pôvodný (nestopový, ≥3 znaky) token sa samostatne
     * rozšíri doménovým slovníkom (SK↔EN synonymá, SimilarityService::expandTerms)
     * a stemuje (skStem) do skupiny koreňov. Skupinovanie drží pojmy oddelené,
     * aby skóre v LexicalSearch vedelo počítať zhodné POJMY, nie surové korene.
     *
     * @return Collection<int, Collection<int, string>>
     */
    public function concepts(string $query): Collection
    {
        $terms = collect(preg_split('/[\s,;.!?:()\/"]+/u', mb_strtolower($query)))
            ->map(fn ($t) => trim($t))
            ->filter(fn ($t) => mb_strlen($t) >= 3 && ! in_array($t, self::STOP, true))
            ->take(12)
            ->values();

        if ($terms->isEmpty()) {
            $bare = mb_strtolower(trim($query));
            if ($bare === '') {
                return collect();
            }
            $terms = collect([$bare]);
        }

        return $terms
            ->map(fn ($term) => collect($this->similarity->expandTerms([$term]))
                ->map(fn ($t) => $this->fold($this->stem((string) $t)))
                ->filter(fn ($root) => mb_strlen($root) >= 3)
                ->unique()
                ->values())
            ->filter(fn (Collection $roots) => $roots->isNotEmpty())
            ->values();
    }

    /**
     * Dopyt → plochá množina unikátnych koreňov pre LIKE %koreň% (playbooky,
     * knižnica). Odvodené z concepts(), takže engine má jeden zdroj koreňov.
     *
     * @return Collection<int, string>
     */
    public function roots(string $query): Collection
    {
        return $this->concepts($query)->flatten()->unique()->values();
    }

    /**
     * ASCII-fold slovenskej diakritiky (á→a, š→s, ž→z…). Vďaka nemu je hľadanie
     * necitlivé na diakritiku: 'sperky' nájde 'šperky', 'marza' nájde 'maržu'.
     * Fold je 1:1 znak → znak, takže znakové offsety ostávajú platné aj v origináli.
     */
    public function fold(string $s): string
    {
        return strtr(mb_strtolower($s), [
            'á' => 'a', 'ä' => 'a', 'č' => 'c', 'ď' => 'd', 'é' => 'e', 'í' => 'i',
            'ĺ' => 'l', 'ľ' => 'l', 'ň' => 'n', 'ó' => 'o', 'ô' => 'o', 'ŕ' => 'r',
            'š' => 's', 'ť' => 't', 'ú' => 'u', 'ý' => 'y', 'ž' => 'z',
        ]);
    }

    /**
     * Lacný slovenský stemmer: orezáva bežné pádové/číselné (a pár slovesných)
     * koncoviek na koreň. Orezáva NAJVIAC jednu koncovku a len ak koreň ostane
     * aspoň 3 znaky; slová do 4 znakov nechá tak. Funguje na diakritickom aj
     * bezdiakritickom tvare: 'maržu'→'marž', 'šperky'→'šperk',
     * 'objednávok'→'objednáv'. 'docker'/'banner'/'order' ostávajú nedotknuté
     * (ich koncovky v zozname nie sú), takže engine nezačne matchovať šum.
     */
    public function stem(string $word): string
    {
        $w = mb_strtolower(trim($word));
        $len = mb_strlen($w);

        if ($len <= 4) {
            return $w;
        }

        // koncovky zoradené od najdlhších — orež prvú, ktorá sedí
        static $suffixes = [
            'ejšieho', 'ejšiemu', 'ejších', 'ejšie', 'ejší',
            'ovanie', 'ovania', 'ovať', 'ávať',
            'ých', 'ého', 'ému', 'ími', 'emi', 'ami', 'ach', 'ách', 'iam', 'iach',
            'ové', 'ová', 'ovi', 'och', 'iu', 'ie', 'ým', 'om', 'em', 'im',
            'ou', 'ám', 'ov', 'mi',
            'ať', 'iť', 'yť',
            'a', 'e', 'i', 'o', 'u', 'y', 'á', 'é', 'í', 'ý', 'ú', 'ô', 'ä',
        ];

        foreach ($suffixes as $sfx) {
            $sl = mb_strlen($sfx);
            if ($len - $sl >= 3 && mb_substr($w, -$sl) === $sfx) {
                return mb_substr($w, 0, $len - $sl);
            }
        }

        return $w;
    }

    /**
     * Úryvok ~140 znakov okolo prvého výskytu ktoréhokoľvek koreňa v popise
     * (zbalený na jeden riadok) — hľadanie tak ukáže, KDE sa zhoda našla.
     *
     * @param  Collection<int, string>  $roots
     */
    public function snippet(string $description, Collection $roots): ?string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $description));
        if ($text === '') {
            return null;
        }

        // fold text aj hľadanie — korene sú foldnuté, fold je 1:1 znak, takže
        // nájdený offset platí aj v origináli (necitlivé na diakritiku)
        $lower = $this->fold($text);
        $pos = null;
        foreach ($roots as $root) {
            $p = mb_strpos($lower, $root);
            if ($p !== false) {
                $pos = $pos === null ? $p : min($pos, $p);
            }
        }

        if ($pos === null) {
            return mb_substr($text, 0, 140);
        }

        $start = max(0, $pos - 50);
        $snippet = mb_substr($text, $start, 160);

        return ($start > 0 ? '…' : '').$snippet.(mb_strlen($text) > $start + 160 ? '…' : '');
    }
}
