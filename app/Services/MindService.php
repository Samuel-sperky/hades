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
        'wiki' => 3,
        'manual' => 4,
    ];

    /**
     * Slovenské + anglické funkčné slová, ktoré v dopyte nič zmysluplné
     * nehľadajú. Odhadzujú sa PRED stemmingom — bránia tomu, aby '%ako%' a
     * spol. našli skoro každý uzol a zhodili relevanciu na strength.
     */
    protected const STOP = [
        'ako', 'aby', 'ale', 'alebo', 'ani', 'and', 'the', 'pre', 'pri', 'pro',
        'cez', 'som', 'byť', 'bez', 'tak', 'len', 'už', 'kto', 'čo', 'že', 'či',
        'aj', 'nie', 'áno', 'ešte', 'for', 'with', 'from', 'you', 'this', 'that',
        'not', 'sme', 'ste', 'sú', 'bol', 'bola', 'boli', 'mať', 'ten', 'tej',
        'táto', 'tento', 'toto', 'sem', 'tam', 'kde', 'keď', 'pod', 'nad', 'ich',
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

        $area = $this->resolveArea($areaName);
        $department = $departmentName ? $this->resolveDepartment($area, $departmentName) : null;

        $node = Node::create([
            'type' => $type,
            'area_id' => $area->id,
            'department_id' => $department?->id,
            'label' => trim($label),
            'description' => $description,
            'certainty' => $certainty,
            'strength' => 1,
            'last_activated_at' => now(),
        ]);

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
     */
    public function recall(string $query, int $limit = 12, ?string $sessionKey = null): Collection
    {
        // Jeden zdroj pravdy: stemovaný SK-aware engine s tvrdým prahom.
        // recall() pridáva navrch len graph-walk + „spomienkový" pulz.
        $matches = $this->searchNodes($query, $limit);

        if ($matches->isEmpty()) {
            return collect();
        }

        $scored = $matches->pluck('node')->values();

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
     * Jediný fulltextový engine nad uzlami — zdroj pravdy pre recall() aj
     * webové /api/search. Dopyt sa rozloží na stemované SK korene + doménovú
     * expanziu (SimilarityService), hľadá sa cez LIKE %koreň% v labeli aj
     * popise. TVRDÝ PRAH: uzol bez jediného skutočného term-hitu sa NIKDY
     * nevráti. Skóre = počet reálnych hitov; strength je len tie-break.
     *
     * @return Collection<int, array{node: Node, score: int, snippet: ?string}>
     */
    public function searchNodes(string $query, int $limit = 12): Collection
    {
        // Koncepty = pôvodné dopytové slová, každé so svojou skupinou koreňov
        // (synonymá + pádové tvary). Skóre počíta ZHODNÉ KONCEPTY, nie korene —
        // uzol bohatý na jeden pojem (napr. 5× „šperk/jewelry") tak nedostane
        // umelo vyššie skóre než uzol, ktorý trafí dva rôzne pojmy.
        $concepts = $this->queryConcepts($query);

        if ($concepts->isEmpty()) {
            return collect();
        }

        $roots = $concepts->flatten()->unique()->values();

        // SQL relevancia (label=2, description=1 za koreň) drží top kandidátov —
        // silné, ale nezhodné uzly už NEvytláčajú slabšie skutočné zhody.
        // COLLATE utf8mb4_unicode_ci = accent-insensitive: ASCII koreň 'sperk'
        // tak v SQL trafí aj diakritický 'Šperky' (a naopak). Ako poistka aj
        // OR bez collate pre prípad odlišnej kolácie stĺpca.
        $col = ' COLLATE utf8mb4_unicode_ci';
        $orderCases = [];
        $orderBindings = [];
        foreach ($roots as $root) {
            $orderCases[] = '(CASE WHEN label LIKE ?'.$col.' THEN 2 ELSE 0 END)';
            $orderBindings[] = '%'.$root.'%';
            $orderCases[] = '(CASE WHEN description LIKE ?'.$col.' THEN 1 ELSE 0 END)';
            $orderBindings[] = '%'.$root.'%';
        }

        $nodes = Node::query()
            ->with(['area', 'department'])
            ->where(function ($q) use ($roots, $col) {
                foreach ($roots as $root) {
                    $like = '%'.$root.'%';
                    $q->orWhereRaw('label LIKE ?'.$col, [$like])
                        ->orWhereRaw('description LIKE ?'.$col, [$like]);
                }
            })
            ->orderByRaw(implode(' + ', $orderCases).' DESC', $orderBindings)
            ->orderByDesc('strength')
            ->limit(max($limit * 5, 60))
            ->get();

        return $nodes
            ->map(function (Node $node) use ($concepts, $roots) {
                // fold haystack — korene sú už foldnuté v queryConcepts, takže
                // tvrdý prah je tiež necitlivý na diakritiku
                $hay = ' '.$this->fold(trim($node->label.' '.(string) $node->description)).' ';

                // koncept je zhoda, ak ho trafí aspoň jeden jeho koreň
                $score = $concepts->filter(
                    fn (Collection $conceptRoots) => $conceptRoots->contains(
                        fn ($root) => mb_strpos($hay, $root) !== false
                    )
                )->count();

                return [
                    'node' => $node,
                    'score' => $score,
                    'snippet' => $this->snippetFor((string) $node->description, $roots),
                ];
            })
            ->filter(fn ($row) => $row['score'] > 0)   // tvrdý prah — 0 zhodných konceptov = von
            ->sortByDesc(fn ($row) => $row['score'] * 1000 + min((float) $row['node']->strength, 999))
            ->take($limit)
            ->values();
    }

    /**
     * Dopyt → koncepty. Každý pôvodný (nestopový, ≥3 znaky) token sa samostatne
     * rozšíri doménovým slovníkom (SK↔EN synonymá, SimilarityService::expandTerms)
     * a stemuje (skStem) do skupiny koreňov. Skupinovanie drží pojmy oddelené,
     * aby skóre v searchNodes vedelo počítať zhodné POJMY, nie surové korene.
     *
     * @return Collection<int, Collection<int, string>>
     */
    public function queryConcepts(string $query): Collection
    {
        $terms = collect(preg_split('/[\s,;.!?:()\/"]+/u', mb_strtolower($query)))
            ->map(fn ($t) => trim($t))
            ->filter(fn ($t) => mb_strlen($t) >= 3 && ! in_array($t, self::STOP, true))
            ->take(12)
            ->values();

        if ($terms->isEmpty()) {
            $bare = mb_strtolower(trim($query));
            if ($bare === '') {
                return collect();
            }
            $terms = collect([$bare]);
        }

        $sim = app(SimilarityService::class);

        return $terms
            ->map(fn ($term) => collect($sim->expandTerms([$term]))
                ->map(fn ($t) => $this->fold($this->skStem((string) $t)))
                ->filter(fn ($root) => mb_strlen($root) >= 3)
                ->unique()
                ->values())
            ->filter(fn (Collection $roots) => $roots->isNotEmpty())
            ->values();
    }

    /**
     * ASCII-fold slovenskej diakritiky (á→a, š→s, ž→z…). Vďaka nemu je hľadanie
     * necitlivé na diakritiku: 'sperky' nájde 'šperky', 'marza' nájde 'maržu'.
     * Fold je 1:1 znak → znak, takže znakové offsety ostávajú platné aj v origináli.
     */
    public function fold(string $s): string
    {
        return strtr(mb_strtolower($s), [
            'á' => 'a', 'ä' => 'a', 'č' => 'c', 'ď' => 'd', 'é' => 'e', 'í' => 'i',
            'ĺ' => 'l', 'ľ' => 'l', 'ň' => 'n', 'ó' => 'o', 'ô' => 'o', 'ŕ' => 'r',
            'š' => 's', 'ť' => 't', 'ú' => 'u', 'ý' => 'y', 'ž' => 'z',
        ]);
    }

    /**
     * Dopyt → plochá množina unikátnych koreňov pre LIKE %koreň% (playbooky,
     * knižnica). Odvodené z queryConcepts, takže engine má jeden zdroj koreňov.
     *
     * @return Collection<int, string>
     */
    public function queryRoots(string $query): Collection
    {
        return $this->queryConcepts($query)->flatten()->unique()->values();
    }

    /**
     * Lacný slovenský stemmer: orezáva bežné pádové/číselné (a pár slovesných)
     * koncoviek na koreň. Orezáva NAJVIAC jednu koncovku a len ak koreň ostane
     * aspoň 3 znaky; slová do 4 znakov nechá tak. Funguje na diakritickom aj
     * bezdiakritickom tvare: 'maržu'→'marž', 'šperky'→'šperk',
     * 'objednávok'→'objednáv'. 'docker'/'banner'/'order' ostávajú nedotknuté
     * (ich koncovky v zozname nie sú), takže engine nezačne matchovať šum.
     */
    public function skStem(string $word): string
    {
        $w = mb_strtolower(trim($word));
        $len = mb_strlen($w);

        if ($len <= 4) {
            return $w;
        }

        // koncovky zoradené od najdlhších — orež prvú, ktorá sedí
        static $suffixes = [
            'ejšieho', 'ejšiemu', 'ejších', 'ejšie', 'ejší',
            'ovanie', 'ovania', 'ovať', 'ávať',
            'ých', 'ého', 'ému', 'ími', 'emi', 'ami', 'ach', 'ách', 'iam', 'iach',
            'ové', 'ová', 'ovi', 'och', 'iu', 'ie', 'ým', 'om', 'em', 'im',
            'ou', 'ám', 'ov', 'mi',
            'ať', 'iť', 'yť',
            'a', 'e', 'i', 'o', 'u', 'y', 'á', 'é', 'í', 'ý', 'ú', 'ô', 'ä',
        ];

        foreach ($suffixes as $sfx) {
            $sl = mb_strlen($sfx);
            if ($len - $sl >= 3 && mb_substr($w, -$sl) === $sfx) {
                return mb_substr($w, 0, $len - $sl);
            }
        }

        return $w;
    }

    /**
     * Úryvok ~140 znakov okolo prvého výskytu ktoréhokoľvek koreňa v popise
     * (zbalený na jeden riadok) — hľadanie tak ukáže, KDE sa zhoda našla.
     *
     * @param  Collection<int, string>  $roots
     */
    protected function snippetFor(string $description, Collection $roots): ?string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $description));
        if ($text === '') {
            return null;
        }

        // fold text aj hľadanie — korene sú foldnuté, fold je 1:1 znak, takže
        // nájdený offset platí aj v origináli (necitlivé na diakritiku)
        $lower = $this->fold($text);
        $pos = null;
        foreach ($roots as $root) {
            $p = mb_strpos($lower, $root);
            if ($p !== false) {
                $pos = $pos === null ? $p : min($pos, $p);
            }
        }

        if ($pos === null) {
            return mb_substr($text, 0, 140);
        }

        $start = max(0, $pos - 50);
        $snippet = mb_substr($text, $start, 160);

        return ($start > 0 ? '…' : '').$snippet.(mb_strlen($text) > $start + 160 ? '…' : '');
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
     *
     * Vráti null, ak medzitým zanikol niektorý z uzlov — volajúci to má preskočiť,
     * nie považovať za chybu. Pozri komentár pri kontrole existencie nižšie.
     */
    public function connect(
        Node $a,
        Node $b,
        string $kind = 'manual',
        bool $auto = false,
        float $weight = 1.0,
    ): ?Edge {
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

        // Nočné joby držia kolekciu uzlov v pamäti desiatky minút (mind:rewire je
        // O(n²)), takže uzol mohol medzitým zaniknúť — typicky ho mind:automerge
        // zlúčil do víťaza a zmazal. Bez tejto kontroly padne FK constraint na
        // edges_target_id_foreign a zhodí CELÝ beh rewire (12.8.2026, exit 1).
        //
        // Kontrola stojí jeden dotaz navyše, ale len pri VZNIKU hrany: vetva
        // posilnenia existujúcej hrany sa vracia vyššie a FK tam z definície platí.
        if (Node::whereIn('id', [$sourceId, $targetId])->count() !== 2) {
            return null;
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
