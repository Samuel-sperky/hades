<?php

namespace App\Http\Controllers;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class MaintenanceController extends Controller
{
    /** Kandidáti na duplicity — podobné labely v rámci rovnakého typu uzla. */
    public function duplicates(): JsonResponse
    {
        $pairs = [];

        $byType = Node::where('type', '!=', 'core')
            ->orderByDesc('id')
            ->limit(500)
            ->get(['id', 'label', 'type', 'strength'])
            ->groupBy('type');

        foreach ($byType as $nodes) {
            $nodes = $nodes->values();
            $n = $nodes->count();

            for ($i = 0; $i < $n - 1; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $a = $nodes[$i];
                    $b = $nodes[$j];

                    $la = mb_strtolower($a->label);
                    $lb = mb_strtolower($b->label);
                    if ($la === '' || $lb === '') {
                        continue;
                    }

                    // prefilter: pri pomere dĺžok < 0.5 nemôže similar_text dosiahnuť 82 %
                    // a ani vetva containment + ratio >= 0.6 nemôže prejsť
                    $ratio = min(mb_strlen($la), mb_strlen($lb)) / max(mb_strlen($la), mb_strlen($lb));
                    if ($ratio < 0.5) {
                        continue;
                    }

                    similar_text($la, $lb, $percent);

                    $contains = str_contains($la, $lb) || str_contains($lb, $la);

                    if ($percent >= 82 || ($contains && $ratio >= 0.6)) {
                        $pairs[] = [
                            'a' => $this->pairNode($a),
                            'b' => $this->pairNode($b),
                            'percent' => round($percent, 1),
                        ];

                        if (count($pairs) >= 20) {
                            break 3;
                        }
                    }
                }
            }
        }

        usort($pairs, fn ($x, $y) => $y['percent'] <=> $x['percent']);

        return response()->json(['pairs' => $pairs]);
    }

    /** Zlúčenie: target pohltí node (popis, silu, hrany aj aktivácie). */
    public function merge(Node $node, Node $target): JsonResponse
    {
        if ($node->id === $target->id) {
            return response()->json(['message' => 'Uzol sa nedá zlúčiť sám so sebou.'], 422);
        }
        if ($node->type === 'core') {
            return response()->json(['message' => 'Jadro vedomia sa nedá pohltiť.'], 422);
        }

        DB::transaction(function () use ($node, $target) {
            // popis — pripoj len ak nesie novú informáciu
            $incoming = trim((string) $node->description);
            if ($incoming !== ''
                && ! str_contains(mb_strtolower((string) $target->description), mb_strtolower($incoming))) {
                $target->description = trim($target->description ? $target->description."\n".$incoming : $incoming);
            }

            $target->strength = (float) $target->strength + (float) $node->strength;
            $target->last_activated_at = now();

            // náhrobok — pohltený external_key sa už nikdy nesmie znovu zapísať
            if ($node->external_key) {
                Tombstone::firstOrCreate(
                    ['external_key' => $node->external_key],
                    ['reason' => 'merge', 'created_at' => now()],
                );

                $meta = $target->meta ?? [];
                $meta['absorbed_keys'] = collect($meta['absorbed_keys'] ?? [])
                    ->push($node->external_key)
                    ->unique()
                    ->values()
                    ->all();
                $target->meta = $meta;
            }

            $target->save();

            // hrany — prepoj na target, preskoč self a duplicity
            $edges = Edge::where('source_id', $node->id)->orWhere('target_id', $node->id)->get();
            foreach ($edges as $edge) {
                $otherId = $edge->source_id === $node->id ? $edge->target_id : $edge->source_id;

                if ($otherId === $target->id) {
                    $edge->delete(); // hrana node↔target by bola self-hrana

                    continue;
                }

                [$s, $t] = $target->id < $otherId ? [$target->id, $otherId] : [$otherId, $target->id];

                $exists = Edge::where('source_id', $s)->where('target_id', $t)->exists();
                if ($exists) {
                    $edge->delete(); // duplicita

                    continue;
                }

                $edge->forceFill(['source_id' => $s, 'target_id' => $t])->save();
            }

            // aktivácie prechádzajú na target
            Activation::where('node_id', $node->id)->update(['node_id' => $target->id]);

            $node->delete();
        });

        MindPulse::dispatch('node.deleted', ['node_id' => $node->id]);
        MindPulse::dispatch('node.updated', ['node' => $target->fresh()->toApi()]);

        return response()->json(['node' => $target->fresh()->toApi()]);
    }

    protected function pairNode(Node $node): array
    {
        return [
            'id' => $node->id,
            'label' => $node->label,
            'type' => $node->type,
            'strength' => (float) $node->strength,
        ];
    }
}
