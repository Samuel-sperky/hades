<?php

namespace App\Http\Controllers;

use App\Models\Edge;
use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContextController extends Controller
{
    /**
     * Export vybraných uzlov ako pekný markdown balík, pripravený na vloženie
     * do Claude Code. POST { node_ids: [1,2,…] } → { markdown: "…" }.
     * Poradie sa zachová podľa vstupu; balík nesie názov, typ, oblasť/oddelenie,
     * popis, cestu k .md (ak je) a kľúčové spojenia. Len čítanie — nič nemení.
     */
    public function pack(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'node_ids' => 'required|array|min:1|max:50',
            'node_ids.*' => 'integer',
        ]);

        $nodes = Node::with(['area', 'department'])
            ->whereIn('id', $validated['node_ids'])
            ->get();

        if ($nodes->isEmpty()) {
            return response()->json(['markdown' => '']);
        }

        // zachovaj poradie zadané používateľom
        $order = array_flip($validated['node_ids']);
        $nodes = $nodes->sortBy(fn (Node $n) => $order[$n->id] ?? PHP_INT_MAX)->values();

        $count = $nodes->count();
        $lines = [];
        $lines[] = '# Balík vedomia — '.$count.' '.$this->plural($count);
        $lines[] = '';
        $lines[] = '_Exportované z '.config('auraai.name', 'AuraAI').' · '.now()->format('d.m.Y H:i').'_';
        $lines[] = '';

        foreach ($nodes as $node) {
            $lines[] = '## '.$node->label;

            $tags = ['typ: '.$node->type];
            if ($node->area) {
                $tags[] = 'oblasť: '.$node->area->name;
            }
            if ($node->department) {
                $tags[] = 'oddelenie: '.$node->department->name;
            }
            $lines[] = '`'.implode(' · ', $tags).'`';
            $lines[] = '';

            $path = $this->sourcePath($node);
            if ($path !== null) {
                $lines[] = 'Zdroj: `'.$path.'`';
                $lines[] = '';
            }

            $desc = trim((string) $node->description);
            if ($desc !== '') {
                $lines[] = $desc;
                $lines[] = '';
            }

            $neighbors = $this->topNeighbors($node);
            if ($neighbors->isNotEmpty()) {
                $lines[] = 'Súvisí s: '.$neighbors->implode(', ');
                $lines[] = '';
            }

            $lines[] = '---';
            $lines[] = '';
        }

        return response()->json(['markdown' => rtrim(implode("\n", $lines))."\n"]);
    }

    /** Cesta k zdrojovému .md, ak uzol nejaký má (skill/session/claude-memory). */
    protected function sourcePath(Node $node): ?string
    {
        $meta = is_array($node->meta) ? $node->meta : [];

        foreach (['path', 'summary_path'] as $key) {
            if (! empty($meta[$key]) && is_string($meta[$key])) {
                return $meta[$key];
            }
        }

        if (is_string($node->external_key) && str_starts_with($node->external_key, 'skill:')) {
            return 'skills/'.substr($node->external_key, strlen('skill:')).'.md';
        }

        return null;
    }

    /**
     * Labely najsilnejších susedov (max 6) — „kľúčové spojenia" uzla.
     *
     * @return \Illuminate\Support\Collection<int, string>
     */
    protected function topNeighbors(Node $node)
    {
        $edges = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->orderByDesc('weight')
            ->limit(6)
            ->get(['source_id', 'target_id']);

        $ids = $edges
            ->map(fn (Edge $e) => $e->source_id === $node->id ? $e->target_id : $e->source_id)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return collect();
        }

        return Node::whereIn('id', $ids->all())->pluck('label');
    }

    /** Slovenské skloňovanie počtu uzlov. */
    protected function plural(int $count): string
    {
        if ($count === 1) {
            return 'uzol';
        }

        if ($count >= 2 && $count <= 4) {
            return 'uzly';
        }

        return 'uzlov';
    }
}
