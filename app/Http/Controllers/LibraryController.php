<?php

namespace App\Http\Controllers;

use App\Models\Area;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class LibraryController extends Controller
{
    /**
     * Zdroj pre obrazovku Knižnica: skill uzly zoskupené podľa oblasti.
     * Voliteľný ?q= filtruje cez ten istý SK-aware engine (stemované korene),
     * aby slovenské skloňovanie fungovalo aj tu.
     *
     * Tvar: { areas: [ { name, color, skills: [ { id, label, path, snippet,
     *         origin, certainty, tags[] } ] } ] }
     * Oblasti sú zoradené podľa uhla (angle), prázdne sa vynechajú.
     */
    public function index(Request $request, MindService $mind): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        $roots = $q !== '' ? $mind->queryRoots($q) : collect();

        $areas = Area::orderBy('angle')->get()->keyBy('id');

        // eager-load tags → žiadny N+1 pri mapovaní na chipy v Knižnici (F4)
        $skills = Node::where('type', 'skill')
            ->with('tags:id,name')
            ->orderBy('label')
            ->get(['id', 'label', 'area_id', 'description', 'meta', 'external_key', 'origin', 'certainty']);

        if ($roots->isNotEmpty()) {
            $skills = $skills->filter(function (Node $n) use ($roots, $mind) {
                // korene sú foldnuté (bez diakritiky) → fold aj obsah skillu
                $hay = $mind->fold($n->label.' '.(string) $n->description);

                return $roots->contains(fn ($root) => mb_strpos($hay, $root) !== false);
            });
        }

        $grouped = $skills->groupBy('area_id');

        $out = $areas
            ->map(function (Area $area) use ($grouped) {
                $group = $grouped->get($area->id);
                if (! $group || $group->isEmpty()) {
                    return null;
                }

                return [
                    'name' => $area->name,
                    'color' => $area->color,
                    'skills' => $group->map(fn (Node $n) => [
                        'id' => $n->id,
                        'label' => $n->label,
                        'path' => $this->pathFor($n),
                        'snippet' => $n->description
                            ? Str::limit(trim(preg_replace('/\s+/u', ' ', $n->description)), 120)
                            : null,
                        'origin' => $n->origin,
                        'certainty' => $n->certainty,
                        'tags' => $n->tags->pluck('name')->all(),
                    ])->values()->all(),
                ];
            })
            ->filter()
            ->values();

        return response()->json(['areas' => $out->all()]);
    }

    /** Cesta k .md — z meta.path, inak odvodená z external_key 'skill:<oblast>/<slug>'. */
    protected function pathFor(Node $node): ?string
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
