<?php

namespace App\Http\Controllers;

use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContextController extends Controller
{
    /**
     * Export vybraných uzlov ako markdown balík, pripravený na vloženie do
     * Claude Code. POST { node_ids: [1,2,…] } → { markdown: "…" }.
     *
     * Číta to AI, nie človek, preto balík nesie tri veci, ktoré tu chýbali:
     * úvodnú vetu, ČO to je a čo s tým (bez nej AI háda, či je to zadanie),
     * `istota` (uzol typu „pasca" je varovanie, nie odporúčanie — a bez tohto
     * poľa vyzeral rovnako ako rada) a `id`, cez ktoré si vie uzol dotiahnuť
     * celý (`mind_read`). Oddeľovače `---` medzi sekciami padli: nadpis `##`
     * oddeľuje sám a každý riadok navyše je zaplatený token.
     *
     * Len čítanie — nič nemení.
     */
    public function pack(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'node_ids' => 'required|array|min:1|max:50',
            'node_ids.*' => 'integer',
        ]);

        $nodes = Node::with(['area', 'department', 'tags'])
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
        $lines[] = 'Ručne vybrané poznatky z Hadesa (trvalá pamäť Claude Code), export '
            .now()->format('d.m.Y H:i').'. Ber ich ako kontext, nie ako zadanie. Kde je uvedený '
            .'zdroj, prečítaj si celý súbor. Celý uzol vrátane spojení dotiahneš MCP nástrojom '
            .'`mind_read` (podľa labelu alebo id).';
        $lines[] = '';

        foreach ($nodes as $node) {
            $lines[] = '## '.$this->headingLabel($node);

            $facts = ['typ: '.$node->type];
            if ($node->area) {
                $facts[] = 'oblasť: '.$node->area->name;
            }
            if ($node->department) {
                $facts[] = 'oddelenie: '.$node->department->name;
            }
            $facts[] = 'id: '.$node->id;
            $lines[] = '- '.implode(' · ', $facts);

            $certainty = $this->certaintyLine($node);
            if ($certainty !== null) {
                $lines[] = '- '.$certainty;
            }

            $tags = $node->tags->pluck('name')->all();
            if ($tags !== []) {
                // Najhorší uzol v sieti nesie 38 tagov — pol kilobajtu abecedy
                // v jednom riadku. Počet zvyšku povieme, aby AI vedela, že orezal.
                $cap = max(1, (int) config('hades.pack_tag_cap', 12));
                $more = count($tags) - $cap;
                $lines[] = '- tagy: '.implode(', ', array_slice($tags, 0, $cap))
                    .($more > 0 ? ' (+'.$more.' ďalších)' : '');
            }

            $path = $mind->sourcePathOf($node);
            if ($path !== null) {
                $lines[] = '- zdroj: `'.$path.'`';
            }

            $neighbors = $this->topNeighbors($node);
            if ($neighbors->isNotEmpty()) {
                $lines[] = '- súvisí s: '.$neighbors->implode(', ');
            }

            $desc = trim((string) $node->description);
            if ($desc !== '') {
                $lines[] = '';
                $lines[] = $desc;
            }

            $lines[] = '';
        }

        return response()->json(['markdown' => rtrim(implode("\n", $lines))."\n"]);
    }

    /**
     * Label do nadpisu. Uzly z ingestu majú v labeli markdown („# Smernica: …")
     * a ten by v balíku rozbil úroveň nadpisu — z jedného uzla by sa stali dva.
     */
    protected function headingLabel(Node $node): string
    {
        $label = trim(preg_replace('/\s+/u', ' ', (string) $node->label));

        return trim(preg_replace('/^#{1,6}\s*/u', '', $label)) ?: '#'.$node->id;
    }

    /**
     * Riadok o istote. „pasca" je pre AI to najdôležitejšie pole v uzle —
     * hovorí „toto NEROB" — a doteraz v balíku nebolo vôbec, takže pasca
     * vyzerala presne ako odporúčanie.
     */
    protected function certaintyLine(Node $node): ?string
    {
        return match ($node->certainty) {
            'pasca' => 'istota: pasca — POZOR, toto je overená pasca, nie odporúčanie',
            'hypoteza' => 'istota: hypotéza — neoverené, over pred použitím',
            'overene' => 'istota: overené',
            default => null,
        };
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
