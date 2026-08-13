<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\HandlesBrainErrors;
use App\Http\Controllers\Controller;
use App\Models\Area;
use App\Models\Node;
use App\Models\Tag;
use App\Services\Brain\BrainWriter;
use App\Services\Brain\NodeDraft;
use App\Services\MindService;
use Illuminate\Contracts\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * REST nad uzlami (knowledge). Číta interné aj v1 (zdieľaný controller). Zápis
 * routuje podľa `origin`:
 *   - origin=brain    → BrainWriter (markdown je master; guard OFF → 403),
 *   - origin=session  → MindService/DB (DB-first).
 * Chyby brain-write vrstvy mapuje HandlesBrainErrors (403/409/422/423).
 */
class KnowledgeController extends Controller
{
    use HandlesBrainErrors;

    /**
     * GET — filtre: type, area(slug|id), origin, certainty(overene|hypoteza|pasca|bez),
     * tag(meno), needs_review(bool), q(fulltext), limit, page. `q` beží cez ten
     * istý SK-aware engine (MindService::searchNodes) ako recall/vyhľadávanie.
     */
    public function index(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'type' => 'nullable|string',
            'area' => 'nullable|string',
            'origin' => 'nullable|in:brain,session',
            'certainty' => 'nullable|string',
            'tag' => 'nullable|string',
            'needs_review' => 'nullable|boolean',
            'q' => 'nullable|string',
            'limit' => 'nullable|integer|min:1|max:100',
            'page' => 'nullable|integer|min:1',
        ]);

        $perPage = (int) ($validated['limit'] ?? 30);
        $page = (int) ($validated['page'] ?? 1);
        $q = isset($validated['q']) ? trim((string) $validated['q']) : '';

        if ($q !== '') {
            // relevancia z enginu; filtre + stránkovanie sa aplikujú nad zásahmi
            $ids = $mind->searchNodes($q, 300)->pluck('node.id')->all();
            if ($ids === []) {
                return response()->json($this->page([], $page, $perPage, 0));
            }

            $query = Node::query()->with(['tags'])->whereIn('id', $ids);
            $this->applyFilters($query, $validated);
            $found = $query->get()->keyBy('id');

            // zachovaj poradie podľa relevancie
            $ordered = collect($ids)
                ->map(fn ($id) => $found->get($id))
                ->filter()
                ->values();

            $total = $ordered->count();
            $slice = $ordered->forPage($page, $perPage)->values();

            return response()->json($this->page(
                $slice->map->toApi()->all(), $page, $perPage, $total,
            ));
        }

        $query = Node::query()->with(['tags']);
        $this->applyFilters($query, $validated);

        $total = (clone $query)->count();
        $items = $query->orderByDesc('strength')->orderByDesc('id')
            ->forPage($page, $perPage)->get();

        return response()->json($this->page(
            $items->map->toApi()->all(), $page, $perPage, $total,
        ));
    }

    public function show(Node $node): JsonResponse
    {
        $node->load('tags');

        return response()->json(['node' => $node->toApi()]);
    }

    /**
     * POST — nový uzol. origin=brain → BrainWriter::create (guard); inak
     * MindService::learn (dedup/merge, DB-first).
     */
    public function store(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'label' => 'required|string|max:255',
            'type' => 'nullable|in:memory,skill,project,core',
            'description' => 'nullable|string|max:20000',
            'area' => 'nullable|string',
            'certainty' => 'nullable|in:overene,hypoteza,pasca',
            'tags' => 'nullable',
            'origin' => 'nullable|in:brain,session',
            'force' => 'nullable|boolean',
            'source_key' => 'nullable|string',
            'rel_path' => 'nullable|string',
            'body' => 'nullable|string',
        ]);

        $origin = $validated['origin'] ?? 'session';
        $tags = $this->normalizeTags($validated['tags'] ?? null);

        if ($origin === 'brain') {
            return $this->guardBrain(function () use ($validated, $tags) {
                $draft = new NodeDraft(
                    label: trim($validated['label']),
                    description: $validated['description'] ?? null,
                    certainty: $validated['certainty'] ?? null,
                    tags: $tags,
                    type: $validated['type'] ?? 'memory',
                    area: $validated['area'] ?? null,
                    sourceKey: $validated['source_key'] ?? null,
                    relPath: $validated['rel_path'] ?? null,
                    body: $validated['body'] ?? null,
                );

                $result = app(BrainWriter::class)->create($draft, (bool) ($validated['force'] ?? false));

                $node = Node::where('source_file', $result['source_file'])
                    ->where('origin', 'brain')->latest('id')->first();

                return response()->json([
                    'node' => $node?->load('tags')->toApi(),
                    'source_file' => $result['source_file'],
                    'warnings' => $result['warnings'],
                    'sync' => $result['sync'],
                ], 201);
            });
        }

        $result = $mind->learn(
            type: $validated['type'] ?? 'memory',
            label: trim($validated['label']),
            description: $validated['description'] ?? null,
            areaName: (string) ($validated['area'] ?? ''),
            certainty: $validated['certainty'] ?? null,
            tags: $tags,
        );

        return response()->json(['node' => $result['node'], 'action' => $result['action']], 201);
    }

    /**
     * PUT — úprava. origin=brain → BrainWriter::update (in-place / move); inak DB.
     */
    public function update(Request $request, Node $node): JsonResponse
    {
        $validated = $request->validate([
            'label' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string|max:20000',
            'area' => 'nullable|string',
            'certainty' => 'nullable|in:overene,hypoteza,pasca',
            'tags' => 'nullable',
            'force' => 'nullable|boolean',
            'source_key' => 'nullable|string',
            'rel_path' => 'nullable|string',
            'body' => 'nullable|string',
        ]);

        if ($node->origin === 'brain') {
            return $this->guardBrain(function () use ($validated, $node) {
                $draft = new NodeDraft(
                    label: trim($validated['label'] ?? $node->label),
                    description: $validated['description'] ?? $node->description,
                    certainty: $validated['certainty'] ?? $node->certainty,
                    tags: $this->normalizeTags($validated['tags'] ?? null),
                    type: $node->type,
                    area: $validated['area'] ?? null,
                    sourceKey: $validated['source_key'] ?? null,
                    relPath: $validated['rel_path'] ?? null,
                    body: $validated['body'] ?? null,
                );

                $result = app(BrainWriter::class)->update($node, $draft, (bool) ($validated['force'] ?? false));

                return response()->json([
                    'node' => $node->fresh()?->load('tags')->toApi(),
                    'source_file' => $result['source_file'],
                    'warnings' => $result['warnings'],
                    'sync' => $result['sync'],
                ]);
            });
        }

        // origin=session → DB-first úprava
        if (array_key_exists('label', $validated)) {
            $node->label = trim($validated['label']);
        }
        if (array_key_exists('description', $validated)) {
            $node->description = $validated['description'];
        }
        if (array_key_exists('certainty', $validated)) {
            $node->certainty = $validated['certainty'];
        }
        if (! empty($validated['area'])) {
            $areaId = $this->resolveAreaId($validated['area']);
            if ($areaId !== null) {
                $node->area_id = $areaId;
            }
        }
        $node->save();

        if (array_key_exists('tags', $validated)) {
            $this->syncTags($node, $this->normalizeTags($validated['tags']));
        }

        return response()->json(['node' => $node->fresh()->load('tags')->toApi()]);
    }

    /**
     * DELETE — origin=brain → BrainWriter::delete (súbor + tombstone + hrany);
     * inak DB delete.
     */
    public function destroy(Node $node): JsonResponse
    {
        if ($node->origin === 'brain') {
            return $this->guardBrain(function () use ($node) {
                $result = app(BrainWriter::class)->delete($node);

                return response()->json($result);
            });
        }

        $id = $node->id;
        $node->delete();

        return response()->json(['deleted' => $id]);
    }

    /**
     * GET /api/tags — zoznam tagov s počtom uzlov (pre tag filter vo Graf/Knižnica).
     */
    public function tags(): JsonResponse
    {
        $tags = Tag::query()
            ->withCount('nodes')
            ->orderByDesc('nodes_count')
            ->orderBy('name')
            ->get()
            ->map(fn (Tag $t) => ['id' => $t->id, 'name' => $t->name, 'count' => (int) $t->nodes_count])
            ->all();

        return response()->json(['tags' => $tags]);
    }

    // ------------------------------------------------------------------

    /**
     * @param  array<string, mixed>  $f
     */
    private function applyFilters(Builder $query, array $f): void
    {
        if (! empty($f['type'])) {
            $query->where('type', $f['type']);
        }
        if (! empty($f['area'])) {
            $query->where('area_id', $this->resolveAreaId($f['area']) ?? -1);
        }
        if (! empty($f['origin'])) {
            $query->where('origin', $f['origin']);
        }
        if (! empty($f['certainty'])) {
            $c = $f['certainty'];
            if (in_array($c, ['bez', 'none', 'null'], true)) {
                $query->whereNull('certainty');
            } else {
                $query->where('certainty', $c);
            }
        }
        if (! empty($f['tag'])) {
            $tag = $f['tag'];
            $query->whereHas('tags', fn (Builder $q) => $q->where('name', $tag));
        }
        if (array_key_exists('needs_review', $f) && $f['needs_review'] !== null) {
            $query->where('needs_review', (bool) $f['needs_review']);
        }
    }

    /**
     * @return array{data: list<array<string, mixed>>, page: int, per_page: int, total: int, last_page: int}
     */
    private function page(array $data, int $page, int $perPage, int $total): array
    {
        return [
            'data' => $data,
            'page' => $page,
            'per_page' => $perPage,
            'total' => $total,
            'last_page' => (int) max(1, (int) ceil($total / max(1, $perPage))),
        ];
    }

    /**
     * Tagy z požiadavky: pole alebo CSV → list<string>.
     *
     * @return list<string>
     */
    private function normalizeTags(mixed $tags): array
    {
        if (is_array($tags)) {
            return array_values(array_unique(array_filter(array_map(
                fn ($t) => trim((string) $t),
                $tags,
            ))));
        }

        return NodeDraft::parseTags(is_string($tags) ? $tags : null);
    }

    /**
     * @param  list<string>  $tags
     */
    private function syncTags(Node $node, array $tags): void
    {
        $ids = [];
        foreach ($tags as $name) {
            if ($name === '') {
                continue;
            }
            if ($tag = Tag::forName((string) $name)) {
                $ids[] = $tag->id;
            }
        }
        $node->tags()->sync($ids);
    }

    private function resolveAreaId(string $area): ?int
    {
        if (ctype_digit($area)) {
            return Area::whereKey((int) $area)->value('id');
        }

        return Area::where('slug', \Illuminate\Support\Str::slug($area))
            ->orWhereRaw('LOWER(name) = ?', [mb_strtolower(trim($area))])
            ->value('id');
    }
}
