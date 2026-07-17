<?php

namespace App\Http\Controllers;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MindController extends Controller
{
    public function graph(): JsonResponse
    {
        $nodes = Node::all();
        $edges = Edge::all();

        // Spresnenie vrstvy pre skills: hidden → hidden_in / hidden_out podľa
        // váženého náklonu väzieb. Počíta sa tu, lebo len controller má naraz
        // uzly aj hrany; Node::layerRole() ostáva coarse fallback.
        $hiddenSplit = $this->deriveHiddenSplit($nodes, $edges);

        return response()->json([
            'name' => config('hades.name'),
            'state' => $this->state(),
            'ws' => [
                'key' => config('broadcasting.connections.reverb.key'),
                'host' => config('hades.public_ws_host'),
                'port' => config('hades.public_ws_port'),
            ],
            'areas' => Area::orderBy('angle')->get(),
            'departments' => Department::all(),
            // listing nesie skrátený popis — plný text vracia detail /api/nodes/{id}
            'nodes' => $nodes->map(function (Node $node) use ($hiddenSplit) {
                $api = $node->toApi();
                if (isset($hiddenSplit[$node->id])) {
                    $api['layer_role'] = $hiddenSplit[$node->id];
                }
                $api['description'] = $api['description'] === null
                    ? null
                    : Str::limit($api['description'], 200);

                return $api;
            }),
            'edges' => $edges->map->toApi(),
        ]);
    }

    /**
     * Spresní vrstvovú rolu skill-uzlov z coarse 'hidden' na 'hidden_in' /
     * 'hidden_out' podľa VÁŽENÉHO náklonu ich väzieb: prevaha spojení na spomienky
     * (memory) = ľavá skrytá vrstva (hidden_in), prevaha na jadro/projekty = pravá
     * (hidden_out). Semantika zhodná s JS fallbackom v mind.js, no váhovo citlivá.
     *
     * Zahŕňa len uzly, ktorých Node::layerRole() je práve 'hidden' (t.j. skills bez
     * explicitného override cez stĺpec/meta). Náklon sa rozhoduje trojstupňovo:
     *   1. vážený súčet väzieb (memory vs core/project),
     *   2. pri váhovej remíze počet susedov daného druhu (neváž.),
     *   3. pri úplnej remíze (vrátane izolovaných 0/0) deterministické vyvážené
     *      striedanie podľa zoradeného id.
     * Tým dostane KAŽDÝ skrytý skill autoritatívnu rolu už z backendu a dva skryté
     * stĺpce ostanú vyvážené — frontend nemusí siahať po náhodnom parity delení.
     * Čisto aditívne a spätne kompatibilné: keď pole chýba, mind.js číta type.
     *
     * @param  \Illuminate\Support\Collection<int, Node>  $nodes
     * @param  \Illuminate\Support\Collection<int, Edge>  $edges
     * @return array<int, string>  node_id → 'hidden_in' | 'hidden_out'
     */
    private function deriveHiddenSplit($nodes, $edges): array
    {
        $typeOf = [];
        foreach ($nodes as $node) {
            $typeOf[$node->id] = $node->type;
        }

        // kandidáti = skills bez explicitného override (coarse 'hidden')
        $inW = [];   // vážený náklon k spomienkam
        $outW = [];  // vážený náklon k jadru/projektom
        $inC = [];   // počet susedov typu memory (neváž.)
        $outC = [];  // počet susedov typu core/project (neváž.)
        foreach ($nodes as $node) {
            if ($node->layerRole() === 'hidden') {
                $inW[$node->id] = 0.0;
                $outW[$node->id] = 0.0;
                $inC[$node->id] = 0;
                $outC[$node->id] = 0;
            }
        }

        if ($inW === []) {
            return [];
        }

        foreach ($edges as $edge) {
            $weight = (float) $edge->weight;
            // pripočítaj náklon z pohľadu oboch koncov (ak je kandidátom)
            foreach ([[$edge->source_id, $edge->target_id], [$edge->target_id, $edge->source_id]] as [$self, $other]) {
                if (! array_key_exists($self, $inW)) {
                    continue;
                }
                $otherType = $typeOf[$other] ?? null;
                if ($otherType === 'memory') {
                    $inW[$self] += $weight;
                    $inC[$self]++;
                } elseif ($otherType === 'core' || $otherType === 'project') {
                    $outW[$self] += $weight;
                    $outC[$self]++;
                }
            }
        }

        $roles = [];
        $unresolved = [];  // úplné remízy (vrátane izolovaných 0/0)
        foreach ($inW as $id => $in) {
            $out = $outW[$id];
            if ($in > $out) {
                $roles[$id] = 'hidden_in';
            } elseif ($out > $in) {
                $roles[$id] = 'hidden_out';
            } elseif ($inC[$id] > $outC[$id]) {
                // váhová remíza → rozhodne počet susedov
                $roles[$id] = 'hidden_in';
            } elseif ($outC[$id] > $inC[$id]) {
                $roles[$id] = 'hidden_out';
            } else {
                $unresolved[] = $id;
            }
        }

        // Zvyšné čisté remízy rozdeľ deterministicky a vyvážene: zoraď podľa id
        // a striedaj. Reprodukovateľné a stabilné naprieč načítaniami; nahrádza
        // inak náhodné parity delenie na frontende jediným zdrojom pravdy.
        sort($unresolved);
        foreach ($unresolved as $i => $id) {
            $roles[$id] = ($i % 2 === 0) ? 'hidden_in' : 'hidden_out';
        }

        return $roles;
    }

    public function stats(): JsonResponse
    {
        $byType = Node::select('type', DB::raw('COUNT(*) as count'))
            ->groupBy('type')->pluck('count', 'type');

        $byArea = Node::select('area_id', DB::raw('COUNT(*) as count'))
            ->whereNotNull('area_id')
            ->groupBy('area_id')->pluck('count', 'area_id');

        $topNodes = Node::where('type', '!=', 'core')
            ->orderByDesc('strength')
            ->limit(8)
            ->get()
            ->map(fn (Node $node) => [
                'id' => $node->id,
                'label' => $node->label,
                'type' => $node->type,
                'strength' => (float) $node->strength,
            ]);

        $growth = Activation::select(
            DB::raw('DATE(created_at) as day'),
            DB::raw('COUNT(*) as count'),
        )
            ->where('created_at', '>=', now()->subDays(30))
            ->groupBy('day')
            ->orderBy('day')
            ->get();

        $weekAgo = now()->subDays(7);

        return response()->json([
            'state' => $this->state(),
            'totals' => [
                'nodes' => Node::count(),
                'edges' => Edge::count(),
                'activations' => Activation::count(),
                'skills' => Node::where('type', 'skill')->count(),
                'sessions' => Node::where('source', 'session')->count(),
            ],
            'week' => [
                'new_nodes' => Node::where('created_at', '>=', $weekAgo)->whereNull('source')->count(),
                'new_sessions' => Node::where('created_at', '>=', $weekAgo)->where('source', 'session')->count(),
                'activations' => Activation::where('created_at', '>=', $weekAgo)->count(),
            ],
            'by_type' => $byType,
            'by_area' => $byArea,
            'top_nodes' => $topNodes,
            'growth' => $growth,
            'recent_records' => Node::where('source', 'session')
                ->orderByDesc('created_at')->limit(4)
                ->get()
                ->map(fn (Node $n) => [
                    'id' => $n->id,
                    'label' => $n->label,
                    'project' => $n->meta['project'] ?? null,
                    'created_at' => $n->created_at?->toIso8601String(),
                ]),
        ]);
    }

    protected function state(): array
    {
        $lastActivation = Activation::latest('created_at')->first();
        $awake = $lastActivation
            && $lastActivation->created_at->gt(now()->subMinutes(config('hades.awake_minutes')));

        return [
            'awake' => (bool) $awake,
            'last_activity_at' => $lastActivation?->created_at->toIso8601String(),
        ];
    }
}
