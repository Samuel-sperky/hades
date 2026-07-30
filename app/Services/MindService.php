<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\Recall\RecallEngine;
use App\Services\Recall\RecallResult;
use App\Services\Similarity\TaxonomyResolver;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

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
        'wiki' => 3,
        'manual' => 4,
    ];

    /**
     * Vyhľadávanie vo vedomí žije v `RecallEngine` (rozhranie #13, rozhodnutie #40),
     * zaradenie do taxonómie v `Similarity\TaxonomyResolver`.
     *
     * Defaulty v konštruktore sú zámerné: `MindService` sa na niekoľkých miestach
     * inštancuje cez `new MindService()` (napr. TranscriptIngestService), takže
     * povinná závislosť by rozbila 7 konzumentov.
     */
    public function __construct(
        protected RecallEngine $recall = new RecallEngine,
        protected TaxonomyResolver $taxonomy = new TaxonomyResolver,
    ) {}

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
        ?string $certainty = null,
        array $tags = [],
    ): array {
        $existing = $this->findByLabel($label, $type);

        if ($existing) {
            $merged = $this->mergeInto($existing, $description, $sessionKey);
            $this->connectByLabels($existing, $connections, $sessionKey);
            $this->coActivate($existing, $sessionKey);

            // certainty/tagy sa aplikujú len keď sú zadané — bez zmeny
            // existujúceho správania pri holom mind_learn
            if ($certainty !== null) {
                $merged->forceFill(['certainty' => $certainty])->save();
            }
            $this->syncTags($merged, $tags);

            return ['action' => 'merged', 'node' => $merged->fresh()->toApi()];
        }

        // Zaradenie do taxonómie. Pri nezhode NEPODSTRČÍ prvú oblasť potichu —
        // uzol dostane needs_review a audit poznámku v meta (bug z 29. 7. 2026).
        $placement = $this->resolvePlacement($areaName, $departmentName);

        $attributes = [
            'type' => $type,
            'area_id' => $placement['area']->id,
            'department_id' => $placement['department']?->id,
            'label' => trim($label),
            'description' => $description,
            'certainty' => $certainty,
            'strength' => 1,
            'last_activated_at' => now(),
        ];

        if ($placement['review'] !== null) {
            $attributes['needs_review'] = true;
            $attributes['meta'] = ['taxonomy_review' => $placement['review']];
        }

        $node = Node::create($attributes);

        $this->syncTags($node, $tags);

        Activation::record($node, 'learn', $sessionKey);
        MindPulse::dispatch('node.created', ['node' => $node->toApi()]);

        $this->connectByLabels($node, $connections, $sessionKey);
        $this->coActivate($node, $sessionKey);

        return ['action' => 'created', 'node' => $node->fresh()->toApi()];
    }

    /**
     * Pripojí tagy na uzol (M:N). Neexistujúce tagy vytvorí, existujúce
     * neduplikuje. Prázdny zoznam = no-op (bez zmeny správania).
     */
    protected function syncTags(Node $node, array $tags): void
    {
        $ids = [];
        foreach ($tags as $name) {
            $name = trim((string) $name);
            if ($name === '') {
                continue;
            }
            $ids[] = \App\Models\Tag::firstOrCreate(['name' => $name])->id;
        }

        if ($ids) {
            $node->tags()->syncWithoutDetaching($ids);
        }
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
     *
     * Fasáda nad `RecallEngine` (#13) — 7 konzumentov (MCP recall, chat, ingest…)
     * očakáva plochú `Collection<Node>`, takže sa vracia `primaries + neighbours`.
     * Kto potrebuje rozdelenie, volá `recallResult()`.
     */
    public function recall(string $query, int $limit = 12, ?string $sessionKey = null): Collection
    {
        return $this->recall->recall($query, $limit, $sessionKey)->all();
    }

    /** Ten istý recall, ale s rozdelením na primárne zásahy a susedov (#13). */
    public function recallResult(string $query, int $limit = 12, ?string $sessionKey = null): RecallResult
    {
        return $this->recall->recall($query, $limit, $sessionKey);
    }

    /** Priamy prístup k enginu — pre konzumentov, ktorí chcú len kandidátov. */
    public function recallEngine(): RecallEngine
    {
        return $this->recall;
    }

    /**
     * Jediný fulltextový engine nad uzlami — zdroj pravdy pre recall() aj
     * webové /api/search. Dopyt sa rozloží na stemované SK korene + doménovú
     * expanziu (SimilarityService), hľadá sa cez LIKE %koreň% v labeli aj
     * popise. TVRDÝ PRAH: uzol bez jediného skutočného term-hitu sa NIKDY
     * nevráti. Skóre = počet reálnych hitov; strength je len tie-break.
     *
     * Kľúč `vector` je aditívny (kosínus embeddingu, 0.0 keď vetva nebeží) —
     * existujúci konzumenti čítajú `node`/`score`/`snippet` a nič sa im nemení.
     *
     * @return Collection<int, array{node: Node, score: int, snippet: ?string, vector: float}>
     */
    public function searchNodes(string $query, int $limit = 12): Collection
    {
        return $this->recall->search($query, $limit);
    }

    /**
     * Dopyt → koncepty (delegát na `Recall\QueryAnalyzer`).
     *
     * @return Collection<int, Collection<int, string>>
     */
    public function queryConcepts(string $query): Collection
    {
        return $this->analyzer()->concepts($query);
    }

    /** ASCII-fold slovenskej diakritiky (delegát na `Recall\QueryAnalyzer`). */
    public function fold(string $s): string
    {
        return $this->analyzer()->fold($s);
    }

    /**
     * Dopyt → plochá množina unikátnych koreňov (delegát na `Recall\QueryAnalyzer`).
     *
     * @return Collection<int, string>
     */
    public function queryRoots(string $query): Collection
    {
        return $this->analyzer()->roots($query);
    }

    /** Lacný slovenský stemmer (delegát na `Recall\QueryAnalyzer`). */
    public function skStem(string $word): string
    {
        return $this->analyzer()->stem($word);
    }

    private function analyzer(): \App\Services\Recall\QueryAnalyzer
    {
        return $this->recall->analyzer();
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
            'name' => config('auraai.name'),
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

        // len najsilnejšie uzly aktivované v session — obmedzuje kvadratický
        // rast co-aktivačných synapsií (hairball) na max 6 najrelevantnejších peer-ov
        $peerIds = Activation::query()
            ->where('session_key', $sessionKey)
            ->where('node_id', '!=', $node->id)
            ->where('created_at', '>=', now()->subHours(6))
            ->distinct()
            ->pluck('node_id');

        $peers = Node::whereIn('id', $peerIds)
            ->orderByDesc('strength')
            ->limit(6)
            ->get();

        foreach ($peers as $peer) {
            // spoločná aktivita v session → automatická co-aktivačná synapsia.
            // Počiatočná váha 0.6 (nie 1.0): opakovaná co-aktivácia ju cez
            // increment posilní, jednorazové náhodné spojenia potom decay +
            // cleanup prirodzene prereže (menej „hairballu“).
            $this->connect($node, $peer, 'co_activation', true, 0.6);
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

            $meta = $winner->meta ?? [];

            // audit stopa — pohltený uzol je VŽDY dohľadateľný, aj bez external_key
            // (ručné skilly/fakty majú external_key = null, ale strata musí byť vidno)
            $meta['absorbed'] = collect($meta['absorbed'] ?? [])
                ->push([
                    'id' => $loser->id,
                    'label' => $loser->label,
                    'external_key' => $loser->external_key,
                    'at' => now()->toIso8601String(),
                ])
                ->values()
                ->all();

            // náhrobok — pohltený external_key sa už nikdy nesmie znovu zapísať
            if ($loser->external_key) {
                Tombstone::firstOrCreate(
                    ['external_key' => $loser->external_key],
                    ['reason' => 'merge', 'created_at' => now()],
                );

                $meta['absorbed_keys'] = collect($meta['absorbed_keys'] ?? [])
                    ->push($loser->external_key)
                    ->unique()
                    ->values()
                    ->all();
            }

            $winner->meta = $meta;
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

    /**
     * Zaradenie uzla do taxonómie — deleguje na `Similarity\TaxonomyResolver`.
     * Vracia oblasť, oddelenie a (pri nezhode) audit poznámku pre `needs_review`.
     *
     * @return array{area: Area, department: ?Department, review: ?array<string, mixed>}
     */
    protected function resolvePlacement(string $areaName, ?string $departmentName): array
    {
        return $this->taxonomy->place($areaName, $departmentName);
    }
}
