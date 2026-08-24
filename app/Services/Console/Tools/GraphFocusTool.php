<?php

namespace App\Services\Console\Tools;

use App\Models\Area;
use App\Models\Department;
use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Zaostrenie grafu — jediný navigačný tool doku Charóna nad plátnom.
 *
 * **Je to ČÍTACÍ tool.** `go({level, area, dept, node})` na klientovi nič
 * nepresúva, nič nevytvára a nič nemaže — je to len FILTER nad jednou scénou:
 * zvolená skupina zostane plná, zvyšok stmavne a `Esc` filter zruší. Tool preto
 * neparkuje na dvojfázovej bráne (`isWrite() === false`) a nemá náhľad.
 *
 * Výsledok nesie DVE veci naraz a je to zámer: `focused`/`label` sú pre model
 * (nech vetu potvrdí), `nav` je PRESNE argument klientskeho `go()`, takže
 * `charon.js` nič neprekladá — zavolá `go(res.nav)`. Zdvojenie stojí ~30 tokenov
 * na volanie a je lacnejšie než druhá cesta k tej istej informácii.
 *
 * Duch riešenia cieľa je ten istý ako v {@see PathGuard}: odmietnuť, nehádať.
 * Neznáma oblasť/oddelenie sa NErieši fuzzy — „najbližšia" by zaostrila niečo
 * iné, než človek žiadal, a on by to na plátne videl ako fakt. Uzol rieši
 * {@see ResolvesNode}, aby nevznikol tretí resolver s iným chovaním.
 *
 * Profil: iba `graph` (a nie `full`). Efekt je klientský a `/console` plátno
 * nemá — tam by tool hlásil úspech nad akciou, ktorá sa nestala.
 */
final class GraphFocusTool extends BaseTool
{
    use ResolvesNode;

    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'graph_focus';
    }

    public function description(): string
    {
        return "Focus the user's graph on one node, one area or one department. Focusing is a FILTER over one "
            .'scene: the chosen group stays lit, the rest dims. Nothing is moved, created or deleted, and the '
            .'user clears it with Esc. Use it whenever the user asks to see, show or point at something in the '
            .'graph — after mind_recall gave you the id. Give `node` (id from mind_recall), or `area` / '
            .'`department` by exact name from mind_overview, or `reset` to show the whole mind again. Returns '
            .'what was focused; say it back in one short sentence.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'node' => [
                    'type' => 'integer',
                    'description' => 'Node id from mind_recall to focus on.',
                ],
                'area' => [
                    'type' => 'string',
                    'description' => 'Exact area name from mind_overview.',
                ],
                'department' => [
                    'type' => 'string',
                    'description' => 'Exact department name from mind_overview.',
                ],
                'reset' => [
                    'type' => 'boolean',
                    'description' => 'true = clear the filter and show the whole graph.',
                ],
            ],
            'required' => [],
        ];
    }

    /**
     * @throws ToolRefusal keď cieľ nie je jednoznačný alebo neexistuje
     */
    public function execute(array $args): ToolResult
    {
        // `reset` má prednosť: keď ho model pošle spolu s cieľom, chce vidieť
        // celok — inak by sme museli hádať, ktoré z dvoch protichodných prianí
        // platí, a hádanie je presne to, čomu sa tu vyhýbame.
        if (($args['reset'] ?? false) === true) {
            return ToolResult::json([
                'focused' => 'all',
                'nav' => ['level' => 'map', 'area' => null, 'dept' => null, 'node' => null],
            ]);
        }

        // Uzol — cez spoločný trait, vrátane jeho chovania pri neznámom id.
        // Kľúč `node` sa mapuje na `id`, ktorý trait pozná; druhý resolver by mal
        // iné hlášky a iné pravidlo nejednoznačnosti.
        if ($this->optionalInt($args, 'node') !== null) {
            $node = $this->resolveNode(['id' => $args['node']], $this->mind, ['area', 'department']);

            return ToolResult::json([
                'focused' => 'node',
                'label' => $node->label,
                'nav' => [
                    'level' => 'node',
                    'area' => $node->area_id,
                    'dept' => $node->department_id,
                    'node' => $node->id,
                ],
            ]);
        }

        // Oddelenie — presné meno. Keď model pošle aj oblasť, hľadá sa v nej;
        // inak globálne. Oblasť si oddelenie doplní samo (pozná svoju), rovnako
        // ako to na klientovi robí clampNav().
        if (($department = $this->optionalString($args, 'department')) !== null) {
            $dept = $this->resolveDepartment($department, $this->optionalString($args, 'area'));

            return ToolResult::json([
                'focused' => 'department',
                'label' => $dept->name,
                'nav' => [
                    'level' => 'dept',
                    'area' => $dept->area_id,
                    'dept' => $dept->id,
                    'node' => null,
                ],
            ]);
        }

        // Oblasť — presné meno.
        if (($area = $this->optionalString($args, 'area')) !== null) {
            $resolved = $this->resolveArea($area);

            return ToolResult::json([
                'focused' => 'area',
                'label' => $resolved->name,
                'nav' => [
                    'level' => 'area',
                    'area' => $resolved->id,
                    'dept' => null,
                    'node' => null,
                ],
            ]);
        }

        throw new ToolRefusal('Give `node`, `area`, `department`, or `reset: true`.');
    }

    /**
     * Presné rozlíšenie oblasti (meno alebo slug, bez ohľadu na veľkosť písmen).
     * Žiadne fuzzy hľadanie — pozri docblock triedy.
     *
     * @throws ToolRefusal
     */
    private function resolveArea(string $name): Area
    {
        $normalized = mb_strtolower(trim($name));

        $area = Area::all()->first(
            fn (Area $a): bool => mb_strtolower((string) $a->name) === $normalized || $a->slug === $normalized
        );

        if (! $area) {
            throw new ToolRefusal("No area named `{$name}`. Call mind_overview for the exact names.");
        }

        return $area;
    }

    /**
     * Presné rozlíšenie oddelenia. Keď je daná oblasť, hľadá sa len v nej —
     * dve oblasti môžu mať oddelenie rovnakého mena a bez zúženia by bol cieľ
     * nejednoznačný.
     *
     * @throws ToolRefusal
     */
    private function resolveDepartment(string $name, ?string $areaName): Department
    {
        $normalized = mb_strtolower(trim($name));

        $query = Department::query();

        if ($areaName !== null) {
            $area = $this->resolveArea($areaName);
            $query->where('area_id', $area->id);
        }

        $matches = $query->get()->filter(
            fn (Department $d): bool => mb_strtolower((string) $d->name) === $normalized || $d->slug === $normalized
        )->values();

        if ($matches->isEmpty()) {
            throw new ToolRefusal("No department named `{$name}`. Call mind_overview for the exact names.");
        }

        // Nejednoznačné meno naprieč oblasťami je chyba volajúceho, nie výzva na
        // hádanie — nech doplní `area`.
        if ($matches->count() > 1) {
            throw new ToolRefusal(
                "Several departments are named `{$name}`. Add `area` to say which one, from mind_overview."
            );
        }

        return $matches->first();
    }
}
