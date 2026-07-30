<?php

namespace App\Services\Maintenance\Metric;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * Jedna metrika podobnosti dvoch uzlov pre dry-run kalibráciu.
 *
 * Existuje preto, aby dry-run report vedel spočítať to isté rozhodnutie DVOMA
 * metrikami (TF-IDF ako dnes, embeddingy ako kandidát) bez toho, aby sa duplikovala
 * logika jobov. Prepnutie deštruktívnych jobov na inú metriku NIE JE úloha tohto
 * rozhrania — to schvaľuje používateľ po prečítaní reportu (rozhodnutie #114).
 */
interface SimilarityMetric
{
    /** Stabilný kľúč do reportu, napr. 'tfidf' / 'embeddings'. */
    public function name(): string;

    /**
     * Je metrika použiteľná na týchto dátach? Nedostupná metrika sa v reporte
     * označí a preskočí — nikdy nespôsobí chybu behu.
     */
    public function available(): bool;

    /** Ľudský dôvod nedostupnosti (do reportu). Prázdny reťazec keď je dostupná. */
    public function unavailableReason(): string;

    /**
     * Predpočítanie nad korpusom (IDF, načítanie vektorov…). Volá sa raz na beh.
     *
     * @param  Collection<int, Node>  $nodes
     */
    public function warm(Collection $nodes): void;

    /**
     * Skóre podobnosti 0..1, alebo null keď pre tento pár nie je definované
     * (napr. jeden z uzlov nemá embedding). null sa v reporte počíta ako
     * „nerozhodnuté", nikdy ako 0.
     */
    public function score(Node $a, Node $b): ?float;
}
