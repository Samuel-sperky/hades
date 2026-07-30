<?php

namespace App\Services\Maintenance\Metric;

use App\Models\Node;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Kandidátska metrika: kosínus nad vektormi v nodes.embedding.
 *
 * Vlastníkom embeddingov je balík P1 (migrácia + generovanie). Tento balík ich
 * len ČÍTA, a to výhradne pre dry-run kalibráciu — deštruktívne joby na embeddingy
 * neprepína (rozhodnutie #114).
 *
 * Preto je celá trieda defenzívna: kým stĺpec neexistuje alebo je prázdny, metrika
 * hlási available() = false a dry-run ju v reporte označí ako nedostupnú. Nikdy
 * nevyhodí výnimku a nikdy nespôsobí, že report nevznikne.
 */
class EmbeddingMetric implements SimilarityMetric
{
    /** @var array<int, list<float>> id => normalizovaný vektor */
    private array $vectors = [];

    private ?string $reason = null;

    public function name(): string
    {
        return 'embeddings';
    }

    public function available(): bool
    {
        if ($this->reason !== null) {
            return $this->reason === '';
        }

        if (! Schema::hasColumn('nodes', 'embedding')) {
            $this->reason = 'stĺpec nodes.embedding neexistuje (migráciu dodáva balík P1)';

            return false;
        }

        $withVector = (int) DB::table('nodes')->whereNotNull('embedding')->count();
        if ($withVector === 0) {
            // Dôvod menuje stĺpec zámerne: obe nedostupné vetvy (chýbajúci aj prázdny
            // stĺpec) skončia v reporte, kde musí byť vidieť, ČOHO sa problém týka.
            $this->reason = 'nodes.embedding je prázdny — žiadny uzol nemá vektor (spusti aura:embed --all)';

            return false;
        }

        $this->reason = '';

        return true;
    }

    public function unavailableReason(): string
    {
        $this->available();

        return (string) $this->reason;
    }

    public function warm(Collection $nodes): void
    {
        $this->vectors = [];
        if (! $this->available()) {
            return;
        }

        $ids = $nodes->pluck('id')->all();
        if ($ids === []) {
            return;
        }

        // Vektory sa čítajú surovým dotazom — model Node nemá cast na packed blob
        // a tento balík mu ho pridávať nesmie (Node vlastní iný balík).
        foreach (array_chunk($ids, 500) as $chunk) {
            $rows = DB::table('nodes')
                ->whereIn('id', $chunk)
                ->whereNotNull('embedding')
                ->get(['id', 'embedding']);

            foreach ($rows as $row) {
                $vector = $this->decode($row->embedding);
                if ($vector !== null) {
                    $this->vectors[(int) $row->id] = $vector;
                }
            }
        }
    }

    public function score(Node $a, Node $b): ?float
    {
        $va = $this->vectors[$a->id] ?? null;
        $vb = $this->vectors[$b->id] ?? null;
        if ($va === null || $vb === null) {
            return null;
        }
        if (count($va) !== count($vb)) {
            return null;
        }

        // vektory sú uložené už normalizované → kosínus = skalárny súčin
        $dot = 0.0;
        foreach ($va as $i => $x) {
            $dot += $x * $vb[$i];
        }

        return max(0.0, min(1.0, $dot));
    }

    /**
     * Rozbalí packed float32 blob na normalizovaný vektor. Nečakaná dĺžka alebo
     * nulový vektor → null (pár sa v reporte označí ako nerozhodnutý).
     *
     * @return list<float>|null
     */
    private function decode(mixed $raw): ?array
    {
        if (! is_string($raw) || $raw === '' || strlen($raw) % 4 !== 0) {
            return null;
        }

        $floats = unpack('g*', $raw);
        if ($floats === false || $floats === []) {
            return null;
        }

        $vector = array_values(array_map('floatval', $floats));

        $norm = 0.0;
        foreach ($vector as $x) {
            $norm += $x * $x;
        }
        if ($norm <= 0.0) {
            return null;
        }
        $norm = sqrt($norm);

        return array_map(fn (float $x) => $x / $norm, $vector);
    }
}
