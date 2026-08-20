<?php

namespace App\Serializers\Screen;

use App\Models\Area;
use App\Models\Node;
use App\Serializers\ScreenSerializer;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Obrazovka Kontrola — fronta poznatkov, ktoré čakajú na overenie človekom.
 *
 * Jeden zdroj pre `GET /api/review/queue` (človek, aj externý mirror
 * `GET /api/v1/review/queue`) a pre `mind_review` (AI).
 *
 * **Prečo táto trieda vznikla:** audit 19. 8. 2026 to pomenoval presne — *„AI
 * frontu na kontrolu plní, nevidí ju"*. Každý `mind_learn` s neistotou pribudne do
 * tejto fronty, ale MCP z celej obrazovky vedelo vrátiť **jedno číslo**
 * (`needs_review` v `mind_overview`). Model teda nemal ako zistiť, čo presne po
 * ňom zostalo nedokončené, a pri ďalšej session to učil znova.
 *
 * **Pre AI je táto obrazovka len na čítanie.** `verify` sa z MCP nedáva vedome
 * (rozhodnutie kontraktu, §4): overenie poznatku je akt človeka a AI, ktorá si
 * vedomie odobrí sama, si tým zmaže jediný externý zdroj pravdy. Fronta preto
 * ukazuje, čo čaká — nie tlačidlo, ktorým to prejde.
 *
 * Kompatibilita: `queue` a `total` sú kľúče, ktoré vracal kontrolér, riadky sú
 * stále `Node::toApi()` a nové kľúče sa len **pripájajú**. `total` je zámerne
 * **nefiltrovaný** — visí na ňom počítadlo v raile (`#dest-kontrola .count`) a
 * keby ho zúžil filter, rail by tvrdil, že práce je menej, než jej je.
 */
class KontrolaScreen extends ScreenSerializer
{
    /** Strop na jednu stránku. Pôvodné hodnoty kontroléra: default 100, max 500. */
    public const DEFAULT_LIMIT = 100;

    public const MAX_LIMIT = 500;

    /**
     * @param  array<string, mixed>  $filters  area (slug|id|name), type, certainty, origin, q, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $limit = $this->limit();
        $names = Area::query()->orderBy('name')->get(['id', 'slug', 'name'])->keyBy('id');
        $rows = $this->rows($limit, $names);
        $total = (int) $this->base()->count();

        return [
            'queue' => $rows,
            'total' => $total,
            'counts' => $this->counts($total) + ['shown' => count($rows)],
            'areas' => $this->areaAxis($names),
            'limit' => $limit,
        ];
    }

    /**
     * Čo z toho dostane AI — **skutočná fronta, nie jej dĺžka.**
     *
     * `needs_review` a `verified_at` sa nedávajú zámerne: v tejto fronte je
     * `needs_review` vždy `true` a `verified_at` vždy prázdne, takže by to boli
     * dva kľúče bez informácie na každom riadku. `heat`, `strength`, `pinned` ani
     * `layer_role` tu nič nerozhodujú — sú to veličiny grafu, nie fronty.
     * `source_file` áno: pri `origin=brain` je to jediná cesta k celému textu.
     */
    public function fieldsForAi(): array
    {
        return [
            'total', 'counts', 'areas',
            'queue[].id', 'queue[].type', 'queue[].label', 'queue[].description',
            'queue[].certainty', 'queue[].origin', 'queue[].area', 'queue[].tags',
            'queue[].source_file', 'queue[].created_at',
        ];
    }

    /**
     * Základ fronty — bez filtrov a bez stropu. Z neho žije `total` aj každý
     * agregát, takže „koľko toho čaká" a „čo vidím" nikdy nepočíta dva rôzne
     * predikáty.
     */
    private function base(): Builder
    {
        return Node::query()->where('needs_review', true);
    }

    /**
     * Riadky fronty, od najnovších. Filtre sú serverové: keby ich robil
     * prehliadač nad stránkou, výber by sa končil na prvej stovke a AI by o osi
     * nevedela nič.
     *
     * @param  Collection<int, Area>  $names
     * @return list<array<string, mixed>>
     */
    private function rows(int $limit, $names): array
    {
        $query = $this->base()->with('tags');

        $area = trim((string) ($this->filters['area'] ?? ''));
        if ($area !== '') {
            $query->where('area_id', RozhodnutiaScreen::resolveAreaId($area) ?? -1);
        }

        // Neznáma hodnota sa **ignoruje, nevracia 422**: `/api/review/queue` tieto
        // parametre doteraz nepoznal a mlčky ich zahadzoval. Zaviesť na nich chybu
        // by bola zmena chovania externého mirroru, teda presne to, čo sa nesmie.
        $type = (string) ($this->filters['type'] ?? '');
        if ($type !== '' && in_array($type, ['memory', 'skill', 'project', 'core'], true)) {
            $query->where('type', $type);
        }

        $certainty = (string) ($this->filters['certainty'] ?? '');
        if ($certainty !== '' && in_array($certainty, ['overene', 'hypoteza', 'pasca'], true)) {
            $query->where('certainty', $certainty);
        }

        $origin = (string) ($this->filters['origin'] ?? '');
        if (in_array($origin, ['session', 'brain'], true)) {
            $query->where('origin', $origin);
        }

        $q = trim((string) ($this->filters['q'] ?? ''));
        if ($q !== '') {
            $query->where(function ($w) use ($q): void {
                $w->where('label', 'like', '%'.$q.'%')->orWhere('description', 'like', '%'.$q.'%');
            });
        }

        return $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (Node $n): array => $n->toApi() + ['area' => $names->get($n->area_id)?->name])
            ->all();
    }

    /**
     * Tvar fronty jedným pohľadom: podľa typu, istoty a pôvodu.
     *
     * Sú to tri agregované dopyty, nie počítanie nad riadkami — počet dopytov
     * preto nerastie s počtom uzlov (stráži to `PayloadPerformanceTest`).
     * Pre AI je to to, čo pre človeka prvý pohľad na obrazovku: či tam čakajú
     * pasce, alebo len nezaradené spomienky.
     *
     * @return array<string, mixed>
     */
    private function counts(int $total): array
    {
        return [
            'total' => $total,
            'by_type' => $this->group('type'),
            'by_certainty' => $this->group('certainty'),
            'by_origin' => $this->group('origin'),
        ];
    }

    /**
     * Jeden agregát podľa stĺpca.
     *
     * Nenastavená hodnota ide do priehradky `bez` — to je slovník, ktorý appka už
     * má (`certainty.bez` v `/api/dashboard`). Bez toho vznikol v odpovedi kľúč
     * s **prázdnym menom** (`{"":4}` na živých dátach 19. 8. 2026), čo je platný
     * JSON a zároveň niečo, o čo sa AI aj UI potknú.
     *
     * @return array<string, int>
     */
    private function group(string $column): array
    {
        $out = [];

        foreach ($this->base()->selectRaw("{$column} as k, COUNT(*) as total")->groupBy('k')->get() as $row) {
            $key = (string) $row->k;
            $out[$key === '' ? 'bez' : $key] = (int) $row->total;
        }

        return $out;
    }

    /**
     * Os oblastí: len tie, ktoré vo fronte niečo majú, od najväčšej. `slug` je
     * hodnota, ktorú berie parameter `area`.
     *
     * @param  Collection<int, Area>  $names
     * @return list<array{id: int, slug: string, name: string, count: int}>
     */
    private function areaAxis($names): array
    {
        $per = array_map('intval', $this->base()
            ->whereNotNull('area_id')
            ->selectRaw('area_id, COUNT(*) as total')
            ->groupBy('area_id')
            ->pluck('total', 'area_id')
            ->all());

        $out = [];

        foreach ($per as $id => $count) {
            $area = $names->get((int) $id);

            if ($area === null) {
                continue;
            }

            $out[] = [
                'id' => (int) $area->id,
                'slug' => (string) $area->slug,
                'name' => (string) $area->name,
                'count' => $count,
            ];
        }

        usort($out, fn (array $a, array $b): int => $b['count'] <=> $a['count'] ?: strcmp($a['name'], $b['name']));

        return $out;
    }

    private function limit(): int
    {
        $limit = (int) ($this->filters['limit'] ?? self::DEFAULT_LIMIT);

        if ($limit <= 0) {
            $limit = self::DEFAULT_LIMIT;
        }

        return min($limit, self::MAX_LIMIT);
    }
}
