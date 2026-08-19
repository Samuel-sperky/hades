<?php

namespace App\Services\Console\Tools;

use App\Models\Edge;
use App\Models\Node;
use App\Services\Console\ToolResult;
use App\Services\MindService;

/**
 * Jeden uzol celý — protiváha ku skracovaniu v recalle.
 *
 * `description_truncated: true` je sľub, že za uzlom je ešte text; toto je
 * jediná cesta, ako ho dostať. Bez toho by model na presnejší dopyt dostal ten
 * istý skrátený popis a začal si zvyšok domýšľať.
 *
 * Identifikácia je `id` (z recallu) ALEBO presný `label`. Nejednoznačný label je
 * chyba, nie „skoro ten správny uzol" — rovnako ako pri rename/move/delete.
 */
final class MindReadTool extends BaseTool
{
    use ResolvesNode;

    public function __construct(private readonly MindService $mind) {}

    public function name(): string
    {
        return 'mind_read';
    }

    public function description(): string
    {
        return 'Read ONE node of the mind in full: the complete description (mind_recall shortens it), all '
            .'tags, certainty, the path to its source .md file when it has one, and its strongest '
            .'connections. Use it when mind_recall returned `description_truncated`, or when you need the '
            .'whole story behind one node before you act on it. Identify the node by the `id` from '
            .'mind_recall (preferred) or by its exact `label`.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'id' => [
                    'type' => 'integer',
                    'description' => 'Node id as returned by mind_recall. Use this whenever you have it.',
                ],
                'label' => [
                    'type' => 'string',
                    'description' => 'Exact label of the node — only when you have no id.',
                ],
            ],
            'required' => [],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $node = $this->resolveNode($args, $this->mind, ['area', 'department', 'tags']);
        $cap = max(1, (int) config('hades.read_related_cap', 20));

        $edges = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->orderByDesc('weight')
            ->get(['source_id', 'target_id']);

        $relatedIds = $edges
            ->map(fn (Edge $e) => (int) $e->source_id === (int) $node->id ? $e->target_id : $e->source_id)
            ->unique()
            ->values();

        // Labely jedným dotazom, v poradí podľa váhy hrany — nie po uzloch.
        $labels = $relatedIds->isEmpty()
            ? collect()
            : Node::whereIn('id', $relatedIds->take($cap)->all())->pluck('label', 'id');

        $out = array_filter([
            'id' => $node->id,
            'label' => $node->label,
            'type' => $node->type,
            'area' => $node->area?->name,
            'department' => $node->department?->name,
            'strength' => (float) $node->strength,
            'certainty' => $node->certainty,
            'origin' => $node->origin,
            'verified' => $node->verified_at !== null,
            'noise' => $this->mind->noiseOf($node),
            'tags' => $node->tags->pluck('name')->all(),
            // Najcennejšia informácia v odpovedi: „toto si prečítaj celé sám."
            'source' => $this->mind->sourcePathOf($node),
            'created' => $node->created_at?->toDateString(),
            'description' => trim((string) $node->description),
            'related' => $relatedIds->take($cap)->map(fn ($id) => $labels[$id] ?? null)->filter()->values()->all(),
            'related_total' => $relatedIds->count(),
        ], fn ($v) => $v !== null && $v !== false && $v !== '' && $v !== []);

        return ToolResult::json($out);
    }
}
