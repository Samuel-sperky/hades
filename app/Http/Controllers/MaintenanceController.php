<?php

namespace App\Http\Controllers;

use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;

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
    public function merge(Node $node, Node $target, MindService $mind): JsonResponse
    {
        if ($node->id === $target->id) {
            return response()->json(['message' => 'Uzol sa nedá zlúčiť sám so sebou.'], 422);
        }
        if ($node->type === 'core') {
            return response()->json(['message' => 'Jadro vedomia sa nedá pohltiť.'], 422);
        }

        // zdieľaná logika zlúčenia (rovnaká pre automatické mind:automerge)
        $target = $mind->mergeNodes($node, $target);

        return response()->json(['node' => $target->toApi()]);
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
