<?php

namespace App\Serializers\Screen;

use App\Models\Area;
use App\Models\Decision;
use App\Serializers\ScreenSerializer;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Obrazovka Rozhodnutia — časová os toho, čo sa rozhodlo a prečo.
 *
 * Jeden zdroj pre `GET /api/decisions` (človek, aj externý mirror
 * `GET /api/v1/decisions`) a pre `mind_decisions` (AI).
 *
 * **Prečo táto trieda vznikla:** audit 19. 8. 2026 dokázal rozchod plôch —
 * `rozhodnutia.js:94,175` bralo **názov oblasti z grafového payloadu** (`S.areas`),
 * pretože `/api/decisions` ho nevracal. Človek teda videl rozhodnutie s oblasťou,
 * AI to isté rozhodnutie bez nej, a keby graf nebol načítaný, obrazovka písala
 * `#7`. Meno oblasti je **dátum rozhodnutia, nie kresba** — patrí do odpovede
 * (kľúč `area`, rovnako ako v `mind_recall`).
 *
 * Rovnako sem prešla **celá filtračná os**: roky aj oblasti s počtami sa počítali
 * v prehliadači z načítaných riadkov (`rozhodnutia.js:58,59,74,79,109,150`).
 * Nad limitom 500 by čipy hlásili iné číslo než realita a AI by o osi nevedela nič.
 * Počty sú preto tu, agregované v SQL a nad **celým** korpusom, nie nad stránkou.
 *
 * Kompatibilita: kľúč `decisions` a všetky kľúče v jeho riadkoch sú tie, ktoré
 * vracal kontrolér — `Decision::toApi()` je stále ich zdroj a nové kľúče sa len
 * **pripájajú**. `/api/v1/decisions` je kontrakt a nič sa v ňom nesmie stratiť
 * ani premenovať.
 */
class RozhodnutiaScreen extends ScreenSerializer
{
    /**
     * Strop na jednu stránku. 500 je pôvodná pevná hodnota kontroléra — ostáva
     * default aj maximum, aby sa payload nezmenil ani pri prázdnych filtroch.
     */
    public const MAX_LIMIT = 500;

    /**
     * @param  array<string, mixed>  $filters  year, area (slug|id|name), origin, q, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $limit = $this->limit();
        $names = Area::query()->orderBy('name')->get(['id', 'slug', 'name'])->keyBy('id');
        $perArea = $this->perArea();
        $rows = $this->rows($limit, $names);

        return [
            'decisions' => $rows,
            'counts' => $this->counts() + ['shown' => count($rows)],
            'years' => $this->years(),
            'areas' => $this->areaAxis($names, $perArea),
            'limit' => $limit,
        ];
    }

    /**
     * Čo z toho dostane AI.
     *
     * `source_file` áno: rozhodnutie so zrkadlom v `.md` sa dá prečítať celé a
     * `origin=brain` bez cesty by bola polovičná informácia. `created_at` nie —
     * dátum rozhodnutia je `decided_on` a čas zápisu do indexu nie je to isté
     * rozhodnutie, len jeho ozvena. `area_id` nie: číslo bez menoslovia je pre
     * AI slepé, a meno posiela `area`.
     */
    public function fieldsForAi(): array
    {
        return [
            'counts', 'years', 'areas',
            'decisions[].id', 'decisions[].decided_on', 'decisions[].text',
            'decisions[].reason', 'decisions[].area', 'decisions[].origin',
            'decisions[].node_id', 'decisions[].source_file',
        ];
    }

    /**
     * Riadky časovej osi. Radenie je serverové (`decided_on` zhora, pri rovnakom
     * dni `id` zhora) — presne to, čo obrazovka doteraz dosahovala vlastným
     * `sort()` nad načítaným poľom.
     *
     * @param  Collection<int, Area>  $names
     * @return list<array<string, mixed>>
     */
    private function rows(int $limit, $names): array
    {
        $query = Decision::query()->orderByDesc('decided_on')->orderByDesc('id');

        if (($year = (int) ($this->filters['year'] ?? 0)) !== 0) {
            $query->whereYear('decided_on', $year);
        }

        $area = trim((string) ($this->filters['area'] ?? ''));
        if ($area !== '') {
            // Neexistujúca oblasť → prázdny výsledok, nie všetky. Pôvodné chovanie
            // kontroléra; tichý fallback na „všetko" by na filtri s preklepom
            // vyzeral, akoby filter neexistoval.
            $query->where('area_id', self::resolveAreaId($area) ?? -1);
        }

        $origin = (string) ($this->filters['origin'] ?? '');
        if (in_array($origin, ['session', 'brain'], true)) {
            $query->where('origin', $origin);
        }

        // Hľadanie ide do textu aj do dôvodu: dôvod nesie to, čo si človek pri
        // hľadaní pamätá („kvôli ngrok"), kým text je často len záver.
        $q = trim((string) ($this->filters['q'] ?? ''));
        if ($q !== '') {
            $query->where(function ($w) use ($q): void {
                $w->where('text', 'like', '%'.$q.'%')->orWhere('reason', 'like', '%'.$q.'%');
            });
        }

        return $query->limit($limit)->get()->map(function (Decision $d) use ($names): array {
            $area = $d->area_id !== null ? $names->get($d->area_id) : null;

            return $d->toApi() + [
                'area' => $area?->name,
                // Mesiac je hlavička bloku na časovej osi. Rez `decided_on` na
                // `YYYY-MM` robil prehliadač; názov mesiaca v slovenčine si robí
                // ďalej sám, to je už kresba.
                'month' => $d->decided_on?->format('Y-m'),
            ];
        })->all();
    }

    /**
     * Počty podľa pôvodu nad **celým** korpusom, nie nad stránkou.
     *
     * @return array<string, int>
     */
    private function counts(): array
    {
        $byOrigin = Decision::query()
            ->selectRaw('origin, COUNT(*) as total')
            ->groupBy('origin')
            ->pluck('total', 'origin')
            ->all();

        return [
            'total' => (int) array_sum($byOrigin),
            'session' => (int) ($byOrigin['session'] ?? 0),
            'brain' => (int) ($byOrigin['brain'] ?? 0),
        ];
    }

    /**
     * Os období: rok + počet, od najnovšieho. Poradie je tu zámerne — rok je os,
     * nie množina, a preusporiadať sa nedá bez toho, aby prestala byť čitateľná.
     *
     * @return list<array{year: int, count: int}>
     */
    private function years(): array
    {
        // `SUBSTR(...,1,4)` a nie `YEAR(...)`: testy bežia na SQLite (in-memory),
        // kde `YEAR` neexistuje — „no such function: YEAR". Rez prvých štyroch
        // znakov dátumu rozumejú oba drivery a na `DATE` stĺpci dáva to isté.
        return Decision::query()
            ->whereNotNull('decided_on')
            ->selectRaw('SUBSTR(decided_on, 1, 4) as y, COUNT(*) as total')
            ->groupBy('y')
            ->orderByDesc('y')
            ->get()
            ->map(fn ($r): array => ['year' => (int) $r->y, 'count' => (int) $r->total])
            ->all();
    }

    /**
     * @return array<int, int>
     */
    private function perArea(): array
    {
        return array_map('intval', Decision::query()
            ->whereNotNull('area_id')
            ->selectRaw('area_id, COUNT(*) as total')
            ->groupBy('area_id')
            ->pluck('total', 'area_id')
            ->all());
    }

    /**
     * Os oblastí: len oblasti, ktoré nejaké rozhodnutie naozaj majú, od
     * najpoužívanejšej. Poradie robí server, aby v rade ostali tie, ktoré sa
     * reálne používajú, a nie tie, čo prišli v dátach prvé — a aby to isté
     * poradie videla AI. `slug` je tam preto, že práve on je hodnota parametra
     * `area`.
     *
     * @param  Collection<int, Area>  $names
     * @param  array<int, int>  $perArea
     * @return list<array{id: int, slug: string, name: string, count: int}>
     */
    private function areaAxis($names, array $perArea): array
    {
        $out = [];

        foreach ($perArea as $id => $count) {
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
        $limit = (int) ($this->filters['limit'] ?? self::MAX_LIMIT);

        if ($limit <= 0) {
            $limit = self::MAX_LIMIT;
        }

        return min($limit, self::MAX_LIMIT);
    }

    /**
     * Oblasť podľa id (numerické) alebo slug/mena → `area_id`.
     *
     * Je to `public static` zámerne: `DecisionController::store` potrebuje presne
     * to isté rozlíšenie a dvojica „filter rozumie inému menu než zápis" by bola
     * tichá chyba, ktorú by nikto nevidel.
     */
    public static function resolveAreaId(string $area): ?int
    {
        if (ctype_digit($area)) {
            return Area::whereKey((int) $area)->value('id');
        }

        return Area::where('slug', Str::slug($area))
            ->orWhereRaw('LOWER(name) = ?', [mb_strtolower(trim($area))])
            ->value('id');
    }
}
