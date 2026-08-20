<?php

namespace App\Serializers\Screen;

use App\Models\Area;
use App\Models\Node;
use App\Serializers\ScreenSerializer;
use App\Services\MindService;
use Illuminate\Support\Str;

/**
 * Obrazovka Knižnica — skill uzly (playbooky) zoskupené podľa oblasti.
 *
 * Jeden zdroj pre `GET /api/library` (človek) aj pre `mind_library` (AI).
 *
 * **Čo sa presunulo z prehliadača.** `kniznica.js` si počítal počet skillov
 * v oblasti (`a.skills.length`) a rezal značky na päť (`tags.slice(0, 5)`).
 * Prvé je dopočet dát: keď server pošle podmnožinu, hlavička hlási iné číslo
 * než mozog. Druhé je horšie — bola to **tichá strata dát v pohľade**: uzol so
 * ôsmimi značkami vyzeral na obrazovke ako uzol s piatimi, kým AI z tej istej
 * odpovede dostala všetkých osem. Odteraz reže server (`TAG_CAP`) a povie, koľko
 * toho zrezal (`tags_more`), takže obe plochy čítajú to isté a človek navyše
 * vidí, že tam ešte niečo je. Čo zostalo v prehliadači, je naozaj len vizuálne:
 * farba bodky cez `mutedColor()`, skrátenie popisu na jeden riadok v CSS.
 *
 * **Objem plôch sa líši zámerne, tvar nie.** Obrazovka vykresľuje všetkých
 * ~1660 kariet bez stránkovania (520 kB) — je to rozhodnutie o UI, nie chyba
 * dopytu. Pre AI by to bol celý kontext, preto má trieda `limit` (default
 * {@see self::AI_LIMIT}) a `/api/library` si „bez stropu" musí vyžiadať výslovne.
 * Kľúče sú v oboch plochách tie isté; líši sa počet riadkov a `fieldsForAi()`.
 */
class KniznicaScreen extends ScreenSerializer
{
    /**
     * Koľko značiek nesie jeden skill. Bolo to `slice(0, 5)` v `kniznica.js`;
     * päťka sa nezmenila, len sa presunula tam, kde ju vidia obe plochy.
     */
    public const TAG_CAP = 5;

    /**
     * Strop pre AI. `mind_library` bez zúženia by inak poslal ~1660 skillov,
     * teda celý kontextový budget na jedno volanie.
     */
    public const AI_LIMIT = 200;

    /** Tvrdý strop, aby sa `limit` nedal použiť ako pomalý dopyt. */
    public const MAX_LIMIT = 2000;

    /**
     * @param  array<string, mixed>  $filters  q, area, limit (null = bez stropu)
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $q = trim((string) ($this->filters['q'] ?? ''));
        $area = trim((string) ($this->filters['area'] ?? ''));
        $limit = $this->limit();

        $areas = Area::orderBy('angle')->get();

        if ($area !== '') {
            // Oblasť sa dá pomenovať slugom aj menom — AI pozná z `mind_overview`
            // slug, človek v UI klikne na názov.
            $needle = mb_strtolower($area);
            $areas = $areas->filter(fn (Area $a): bool => mb_strtolower((string) $a->slug) === $needle
                || mb_strtolower((string) $a->name) === $needle);
        }

        $skills = $this->skills($q, $areas->pluck('id')->all(), $area !== '');
        $grouped = $skills->groupBy('area_id');

        $out = [];
        $shown = 0;
        $total = 0;
        $truncated = false;

        foreach ($areas as $areaModel) {
            $group = $grouped->get($areaModel->id);
            if (! $group || $group->isEmpty()) {
                continue;
            }

            $count = $group->count();
            $total += $count;

            $rows = $group;
            if ($limit !== null) {
                $room = max($limit - $shown, 0);
                if ($room === 0) {
                    $truncated = true;

                    continue;
                }
                if ($count > $room) {
                    $rows = $group->take($room);
                    $truncated = true;
                }
            }

            $shown += $rows->count();

            $out[] = [
                'name' => $areaModel->name,
                'slug' => $areaModel->slug,
                'color' => $areaModel->color,
                // Počet skillov v oblasti PO filtrovaní, nie počet poslaných
                // riadkov — inak by strop tichom zmenil číslo v hlavičke.
                'count' => $count,
                'skills' => $rows->map(fn (Node $n): array => $this->skill($n))->values()->all(),
            ];
        }

        return [
            'areas' => $out,
            'counts' => ['areas' => count($out), 'skills' => $total, 'shown' => $shown],
            'q' => $q,
            'area' => $area,
            'truncated' => $truncated,
            'tag_cap' => self::TAG_CAP,
        ];
    }

    /**
     * Pre AI je Knižnica odpoveď na „aké skilly na to máme a kde sú ich .md" —
     * teda label, cesta a istota. `snippet` (120 znakov na uzol), `origin`,
     * `tags` a `color` sú pre oko; pri 200 riadkoch by boli tri štvrtiny
     * odpovede. Celý uzol si AI dotiahne cez `mind_read`, ktorý na to je.
     */
    public function fieldsForAi(): array
    {
        return [
            'counts', 'q', 'area', 'truncated',
            'areas[].name', 'areas[].slug', 'areas[].count',
            'areas[].skills[].id', 'areas[].skills[].label',
            'areas[].skills[].path', 'areas[].skills[].certainty',
        ];
    }

    private function limit(): ?int
    {
        if (! array_key_exists('limit', $this->filters)) {
            return self::AI_LIMIT;
        }

        $limit = $this->filters['limit'];

        // Výslovné null = „všetko". Používa to obrazovka, ktorá vedome kreslí
        // všetky karty bez stránkovania.
        if ($limit === null || $limit === '') {
            return null;
        }

        return max(1, min((int) $limit, self::MAX_LIMIT));
    }

    /**
     * Skilly, prípadne zúžené tým istým SK-aware enginom (stemované korene),
     * aby slovenské skloňovanie fungovalo aj tu.
     *
     * @param  list<int>  $areaIds
     * @return \Illuminate\Support\Collection<int, Node>
     */
    private function skills(string $q, array $areaIds, bool $restrictAreas)
    {
        $mind = app(MindService::class);
        $roots = $q !== '' ? $mind->queryRoots($q) : collect();

        $query = Node::where('type', 'skill')
            // eager-load tags → žiadny N+1 pri mapovaní na chipy v Knižnici (F4)
            ->with('tags:id,name')
            ->orderBy('label');

        if ($restrictAreas) {
            $query->whereIn('area_id', $areaIds ?: [0]);
        }

        $skills = $query->get(['id', 'label', 'area_id', 'description', 'meta', 'external_key', 'origin', 'certainty']);

        if ($roots->isNotEmpty()) {
            $skills = $skills->filter(function (Node $n) use ($roots, $mind) {
                // korene sú foldnuté (bez diakritiky) → fold aj obsah skillu
                $hay = $mind->fold($n->label.' '.(string) $n->description);

                return $roots->contains(fn ($root) => mb_strpos($hay, $root) !== false);
            });
        }

        return $skills;
    }

    /**
     * @return array<string, mixed>
     */
    private function skill(Node $node): array
    {
        $tags = $node->tags->pluck('name')->values()->all();

        return [
            'id' => $node->id,
            'label' => $node->label,
            'path' => $this->pathFor($node),
            'snippet' => $node->description
                ? Str::limit(trim(preg_replace('/\s+/u', ' ', $node->description)), 120)
                : null,
            'origin' => $node->origin,
            'certainty' => $node->certainty,
            'tags' => array_slice($tags, 0, self::TAG_CAP),
            'tags_more' => max(count($tags) - self::TAG_CAP, 0),
        ];
    }

    /**
     * Cesta k .md — z meta.path, inak odvodená z external_key 'skill:<oblast>/<slug>'.
     *
     * Zámerne NIE `MindService::sourcePathOf()`, hoci sa tá úvaha podobá: ono
     * berie aj `meta.summary_path`, čo je súmar sessionu, nie playbook. Knižnica
     * touto cestou otvára md overlay, takže by človek klikol na skill a dostal
     * cudzí dokument. Zjednotenie je samostatná úloha, nie vedľajší efekt tejto.
     */
    private function pathFor(Node $node): ?string
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['path'])) {
            return (string) $meta['path'];
        }

        if (is_string($node->external_key) && str_starts_with($node->external_key, 'skill:')) {
            return 'skills/'.substr($node->external_key, strlen('skill:')).'.md';
        }

        return null;
    }
}
