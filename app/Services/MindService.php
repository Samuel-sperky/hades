<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

class MindService
{
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
    public function recall(string $query, int $limit = 12): Collection
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

        if ($scored->isNotEmpty()) {
            foreach ($scored as $node) {
                Activation::record($node, 'recall', null);
            }

            MindPulse::dispatch('recall', ['node_ids' => $scored->pluck('id')->all()]);
        }

        return $scored;
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

        return (clone $query)
            ->whereRaw('LOWER(label) LIKE ?', ['%'.$normalized.'%'])
            ->orWhere(function ($q) use ($normalized, $type) {
                if ($type) {
                    $q->where('type', $type);
                }
                $q->whereRaw('? LIKE CONCAT(\'%\', LOWER(label), \'%\')', [$normalized]);
            })
            ->orderByDesc('strength')
            ->first();
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
            $this->connect($node, $peer);
        }
    }

    public function connect(Node $a, Node $b): Edge
    {
        [$sourceId, $targetId] = $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];

        $edge = Edge::query()
            ->where('source_id', $sourceId)
            ->where('target_id', $targetId)
            ->first();

        if ($edge) {
            $edge->increment('weight');
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
            'weight' => 1,
            'last_activated_at' => now(),
        ]);

        MindPulse::dispatch('edge.created', ['edge' => $edge->toApi()]);

        return $edge;
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
