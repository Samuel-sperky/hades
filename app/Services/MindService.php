<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MindService
{
    /**
     * Poradie významu synapsií — silnejší význam nikdy nesmie oslabnúť.
     * manual (ručne/z chatu) > skill_mention > co_activation > similarity.
     */
    protected const KIND_RANK = [
        'similarity' => 0,
        'co_activation' => 1,
        'skill_mention' => 2,
        'manual' => 3,
    ];

    /**
     * Ulozi novy poznatok. Ak uz podobny uzol existuje, zluci ho (auto-merge)
     * namiesto vytvorenia duplicity.
     */
    public function learn(
        string $type,
        string $label,
        ?string $description,
        string $areaName,
        ?string $departmentName = null,
        array $connections = [],
        ?string $sessionKey = null,
    ): array {
        $existing = $this->findByLabel($label, $type);

        if ($existing) {
            $merged = $this->mergeInto($existing, $description, $sessionKey);
            $this->connectByLabels($existing, $connections, $sessionKey);
            $this->coActivate($existing, $sessionKey);

            return ['action' => 'merged', 'node' => $merged->fresh()->toApi()];
        }

        $area = $this->resolveArea($areaName);
        $department = $departmentName ? $this->resolveDepartment($area, $departmentName) : null;

        $node = Node::create([
            'type' => $type,
            'area_id' => $area->id,
            'department_id' => $department?->id,
            'label' => trim($label),
            'description' => $description,
            'strength' => 1,
            'last_activated_at' => now(),
        ]);

        Activation::record($node, 'learn', $sessionKey);
        MindPulse::dispatch('node.created', ['node' => $node->toApi()]);

        $this->connectByLabels($node, $connections, $sessionKey);
        $this->coActivate($node, $sessionKey);

        return ['action' => 'created', 'node' => $node->fresh()->toApi()];
    }

    /**
     * Posilni existujuci uzol (skill sa realne pouzil).
     */
    public function activate(string $label, ?string $type = null, ?string $sessionKey = null): ?array
    {
        $node = $this->findByLabel($label, $type);

        if (! $node) {
            return null;
        }

        $node->increment('strength');
        $node->forceFill(['last_activated_at' => now()])->save();

        Activation::record($node, 'activate', $sessionKey);
        MindPulse::dispatch('node.activated', [
            'node_id' => $node->id,
            'strength' => (float) $node->strength,
        ]);

        $this->coActivate($node, $sessionKey);

        return $node->fresh()->toApi();
    }

    /**
     * Najde poznatky relevantne k dopytu. Nezvysuje silu, ale vysle
     * "spomienkovy" pulz do vizualizacie.
     */
    public function recall(string $query, int $limit = 12, ?string $sessionKey = null): Collection
    {
        $terms = collect(preg_split('/[\s,;]+/u', mb_strtolower($query)))
            ->map(fn ($t) => trim($t))
            ->filter(fn ($t) => mb_strlen($t) >= 3)
            ->take(8);

        if ($terms->isEmpty()) {
            $terms = collect([mb_strtolower(trim($query))])->filter();
        }

        $nodes = Node::query()
            ->with(['area', 'department'])
            ->where(function ($q) use ($terms) {
                foreach ($terms as $term) {
                    $like = '%'.$term.'%';
                    $q->orWhere('label', 'like', $like)
                        ->orWhere('description', 'like', $like);
                }
            })
            ->orderByDesc('strength')
            ->limit($limit * 3)
            ->get();

        $scored = $nodes->map(function (Node $node) use ($terms) {
            $haystack = mb_strtolower($node->label.' '.$node->description);
            $hits = $terms->filter(fn ($t) => str_contains($haystack, $t))->count();

            return ['node' => $node, 'score' => $hits * 10 + min((float) $node->strength, 20)];
        })
            ->sortByDesc('score')
            ->take($limit)
            ->pluck('node')
            ->values();

        if ($scored->isEmpty()) {
            return $scored;
        }

        // Graph-walk hĺbky 1: k primárnym zásahom pridaj ich priamych susedov
        // (jeden skok po hranách) s polovičnou relevanciou. Primáre si držia
        // poradie, susedia sa pripoja za ne. Celkový strop = limit + 50 %.
        $primaryIds = $scored->pluck('id')->all();
        $overallCap = (int) ceil($limit * 1.5);
        $neighborSlots = max(0, $overallCap - $scored->count());

        $neighbors = collect();
        if ($neighborSlots > 0) {
            $neighborIds = Edge::query()
                ->where(function ($q) use ($primaryIds) {
                    $q->whereIn('source_id', $primaryIds)
                        ->orWhereIn('target_id', $primaryIds);
                })
                ->get(['source_id', 'target_id'])
                ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
                ->reject(fn ($id) => in_array($id, $primaryIds, true))
                ->unique()
                ->values();

            if ($neighborIds->isNotEmpty()) {
                $neighbors = Node::query()
                    ->with(['area', 'department'])
                    ->whereIn('id', $neighborIds->all())
                    ->orderByDesc('strength')
                    ->limit($neighborSlots)
                    ->get();
            }
        }

        // session_key sa uloží k aktiváciám — neskoršie learn/activate v tej istej
        // session sa cez coActivate prepoja aj s vybavenými uzlami
        foreach ($scored as $node) {
            Activation::record($node, 'recall', $sessionKey);
        }
        foreach ($neighbors as $node) {
            // ľahšia aktivácia — sused vybavený cez hranu, nie priamou zhodou
            Activation::record($node, 'recall-neighbor', $sessionKey);
        }

        $result = $scored->concat($neighbors)->values();

        MindPulse::dispatch('recall', ['node_ids' => $result->pluck('id')->all()]);

        return $result;
    }

    /**
     * Struktura vedomia pre spravne zaradovanie novych poznatkov.
     */
    public function overview(): array
    {
        $areas = Area::with('departments')
            ->withCount('nodes')
            ->orderBy('angle')
            ->get()
            ->map(fn (Area $area) => [
                'name' => $area->name,
                'nodes' => $area->nodes_count,
                'departments' => $area->departments->pluck('name')->all(),
            ]);

        return [
            'name' => config('hades.name'),
            'areas' => $areas->all(),
            'node_types' => ['skill', 'memory', 'project'],
            'totals' => [
                'nodes' => Node::count(),
                'edges' => Edge::count(),
            ],
        ];
    }

    public function findByLabel(string $label, ?string $type = null): ?Node
    {
        $normalized = mb_strtolower(trim($label));

        $query = Node::query();
        if ($type) {
            $query->where('type', $type);
        }

        $exact = (clone $query)->whereRaw('LOWER(label) = ?', [$normalized])->first();
        if ($exact) {
            return $exact;
        }

        if (mb_strlen($normalized) < 4) {
            return null;
        }

        $candidates = (clone $query)
            ->whereRaw('LOWER(label) LIKE ?', ['%'.$normalized.'%'])
            ->orWhere(function ($q) use ($normalized, $type) {
                if ($type) {
                    $q->where('type', $type);
                }
                $q->whereRaw('? LIKE CONCAT(\'%\', LOWER(label), \'%\')', [$normalized]);
            })
            ->orderByDesc('strength')
            ->get();

        // Zluc len skutocne podobne labely — samotny substring nestaci
        // ("Canva" nesmie splynut s "Canvas visualization").
        return $candidates->first(function (Node $candidate) use ($normalized) {
            $other = mb_strtolower($candidate->label);
            $lengthRatio = min(mb_strlen($normalized), mb_strlen($other))
                / max(mb_strlen($normalized), mb_strlen($other));

            similar_text($normalized, $other, $percent);

            return $lengthRatio >= 0.6 || $percent >= 85;
        });
    }

    /**
     * Zluci novy poznatok do existujuceho uzla: posilni ho a rozsiri popis.
     */
    protected function mergeInto(Node $node, ?string $description, ?string $sessionKey): Node
    {
        $node->increment('strength');

        $incoming = trim((string) $description);
        if ($incoming !== '' && ! str_contains(mb_strtolower((string) $node->description), mb_strtolower($incoming))) {
            $node->description = trim($node->description ? $node->description."\n".$incoming : $incoming);
        }

        $node->last_activated_at = now();
        $node->save();

        Activation::record($node, 'merge', $sessionKey);
        MindPulse::dispatch('node.activated', [
            'node_id' => $node->id,
            'strength' => (float) $node->strength,
        ]);

        return $node;
    }

    /**
     * Explicitne prepojenia na uzly podla labelov.
     */
    protected function connectByLabels(Node $node, array $labels, ?string $sessionKey): void
    {
        foreach ($labels as $label) {
            $other = $this->findByLabel((string) $label);
            if ($other && $other->id !== $node->id) {
                $this->connect($node, $other);
            }
        }
    }

    /**
     * Auto-prepojenie uzlov aktivovanych v rovnakej session (hybrid synapsie).
     */
    protected function coActivate(Node $node, ?string $sessionKey): void
    {
        if (! $sessionKey) {
            return;
        }

        $peerIds = Activation::query()
            ->where('session_key', $sessionKey)
            ->where('node_id', '!=', $node->id)
            ->where('created_at', '>=', now()->subHours(6))
            ->distinct()
            ->limit(10)
            ->pluck('node_id');

        foreach (Node::whereIn('id', $peerIds)->get() as $peer) {
            // spoločná aktivita v session → automatická co-aktivačná synapsia
            $this->connect($node, $peer, 'co_activation', true);
        }
    }

    /**
     * Vytvorí alebo posilní synapsiu medzi dvoma uzlami.
     *
     * $kind + $auto určujú typ synapsie; pri posilnení existujúcej hrany sa kind
     * smie posunúť len k silnejšiemu významu (nikdy sa neoslabí manual → similarity).
     * $weight je počiatočná váha novej hrany (napr. 0.5 pre similarity).
     */
    public function connect(
        Node $a,
        Node $b,
        string $kind = 'manual',
        bool $auto = false,
        float $weight = 1.0,
    ): Edge {
        [$sourceId, $targetId] = $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];

        $edge = Edge::query()
            ->where('source_id', $sourceId)
            ->where('target_id', $targetId)
            ->first();

        if ($edge) {
            $edge->increment('weight');

            // kind sa smie posilniť len k silnejšiemu významu, nikdy oslabiť
            $newRank = self::KIND_RANK[$kind] ?? 0;
            $curRank = self::KIND_RANK[$edge->kind] ?? 0;
            if ($newRank > $curRank) {
                $edge->kind = $kind;
                $edge->auto = $auto;
            }

            $edge->forceFill(['last_activated_at' => now()])->save();

            MindPulse::dispatch('edge.strengthened', [
                'edge_id' => $edge->id,
                'weight' => (float) $edge->weight,
            ]);

            return $edge;
        }

        $edge = Edge::create([
            'source_id' => $sourceId,
            'target_id' => $targetId,
            'weight' => $weight,
            'kind' => $kind,
            'auto' => $auto,
            'last_activated_at' => now(),
        ]);

        MindPulse::dispatch('edge.created', ['edge' => $edge->toApi()]);

        return $edge;
    }

    /**
     * Zlúči $loser uzol do $winner uzla: winner pohltí popis, silu, hrany aj
     * aktivácie; loser dostane náhrobok a zmaže sa. Vráti čerstvý winner.
     *
     * Zdieľaná logika pre MaintenanceController::merge (ručné zlúčenie) a
     * príkaz mind:automerge (automatické zlúčenie takmer identických uzlov).
     */
    public function mergeNodes(Node $loser, Node $winner): Node
    {
        DB::transaction(function () use ($loser, $winner) {
            // popis — pripoj len ak nesie novú informáciu
            $incoming = trim((string) $loser->description);
            if ($incoming !== ''
                && ! str_contains(mb_strtolower((string) $winner->description), mb_strtolower($incoming))) {
                $winner->description = trim($winner->description ? $winner->description."\n".$incoming : $incoming);
            }

            $winner->strength = (float) $winner->strength + (float) $loser->strength;
            $winner->last_activated_at = now();

            // náhrobok — pohltený external_key sa už nikdy nesmie znovu zapísať
            if ($loser->external_key) {
                Tombstone::firstOrCreate(
                    ['external_key' => $loser->external_key],
                    ['reason' => 'merge', 'created_at' => now()],
                );

                $meta = $winner->meta ?? [];
                $meta['absorbed_keys'] = collect($meta['absorbed_keys'] ?? [])
                    ->push($loser->external_key)
                    ->unique()
                    ->values()
                    ->all();
                $winner->meta = $meta;
            }

            $winner->save();

            // hrany — prepoj na winner, preskoč self a duplicity
            $edges = Edge::where('source_id', $loser->id)->orWhere('target_id', $loser->id)->get();
            foreach ($edges as $edge) {
                $otherId = $edge->source_id === $loser->id ? $edge->target_id : $edge->source_id;

                if ($otherId === $winner->id) {
                    $edge->delete(); // hrana loser↔winner by bola self-hrana

                    continue;
                }

                [$s, $t] = $winner->id < $otherId ? [$winner->id, $otherId] : [$otherId, $winner->id];

                $exists = Edge::where('source_id', $s)->where('target_id', $t)->exists();
                if ($exists) {
                    $edge->delete(); // duplicita

                    continue;
                }

                $edge->forceFill(['source_id' => $s, 'target_id' => $t])->save();
            }

            // aktivácie prechádzajú na winner
            Activation::where('node_id', $loser->id)->update(['node_id' => $winner->id]);

            $loser->delete();
        });

        MindPulse::dispatch('node.deleted', ['node_id' => $loser->id]);
        MindPulse::dispatch('node.updated', ['node' => $winner->fresh()->toApi()]);

        return $winner->fresh();
    }

    protected function resolveArea(string $name): Area
    {
        $normalized = mb_strtolower(trim($name));

        $area = Area::all()->first(function (Area $area) use ($normalized) {
            return mb_strtolower($area->name) === $normalized
                || str_contains(mb_strtolower($area->name), $normalized)
                || str_contains($normalized, mb_strtolower($area->name));
        });

        return $area ?? Area::orderBy('id')->firstOrFail();
    }

    protected function resolveDepartment(Area $area, string $name): Department
    {
        $normalized = mb_strtolower(trim($name));

        $existing = $area->departments->first(
            fn (Department $d) => mb_strtolower($d->name) === $normalized
        );

        if ($existing) {
            return $existing;
        }

        $department = $area->departments()->create([
            'name' => trim($name),
            'slug' => Str::slug($name),
        ]);

        MindPulse::dispatch('department.created', [
            'department' => [
                'id' => $department->id,
                'area_id' => $area->id,
                'name' => $department->name,
            ],
        ]);

        return $department;
    }
}
