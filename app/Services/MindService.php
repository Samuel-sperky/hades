<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\MergeCandidate;
use App\Models\Node;
use App\Models\Tag;
use App\Models\Tombstone;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class MindService
{
    /**
     * A5 — tri pásma zhody labelov.
     *
     * Pôvodne bola jediná podmienka `similar_text >= 85 % ALEBO pomer dĺžok >= 0,6`.
     * To „alebo" znamenalo, že samotný pomer dĺžok stačil na nevratné zlúčenie,
     * a prah 85 % je pri similar_text (najdlhšia spoločná podsekvencia, nie
     * Levenshtein) veľmi voľný.
     *
     *   >= MERGE_THRESHOLD   zlúč automaticky
     *   >= REVIEW_THRESHOLD  navrhni na review (merge_candidates), uzol vznikne
     *   inak                 vytvor nový uzol
     */
    public const MERGE_THRESHOLD = 95.0;

    public const REVIEW_THRESHOLD = 85.0;

    /** Poistka na pomer dĺžok — teraz brána (AND), nie alternatíva (OR). */
    public const LENGTH_RATIO_GATE = 0.6;

    /** Koľko znakov slugu tvorí predvýber kandidátov na review. */
    protected const CANDIDATE_PREFIX = 8;

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

            return array_filter([
                'action' => 'merged',
                'node' => $merged->fresh()->toApi(),
                'duplicate_candidates' => $this->recordCandidatesFor($merged) ?: null,
            ], fn ($v) => $v !== null);
        }

        // Pozor na poradie: zlúčenie vyššie oblasť vôbec nerieši (uzol už niekde
        // je), takže sa sprísnenie dotýka len vetvy, ktorá uzol zakladá — presne
        // tam, kde tichý fallback škodil. Merge s preklepom v oblasti sa teda
        // správa ako doteraz.
        $area = $this->resolveArea($areaName);

        // filled() namiesto truthy testu: ' ' je v PHP truthy, takže samotná
        // medzera doteraz vyrobila oddelenie s prázdnym menom aj slugom
        $department = filled($departmentName)
            ? $this->resolveDepartment($area, $departmentName)
            : null;

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

        return array_filter([
            'action' => 'created',
            'node' => $node->fresh()->toApi(),
            'duplicate_candidates' => $this->recordCandidatesFor($node) ?: null,
            // Oddelenie sa smie vytvoriť, ale volajúci to má vidieť — inak
            // preklep v `department` vyzerá rovnako ako zaradenie do
            // existujúceho. Keď nič nevzniklo, kľúč v payloade nie je (A9).
            'department_created' => $department?->wasRecentlyCreated ? $department->name : null,
        ], fn ($v) => $v !== null);
    }

    /**
     * A5/A6 — zapíše návrhy na zlúčenie pre práve zapísaný uzol a vráti ich
     * počet. Nič nezlučuje; rozhodnutie ostáva na človeku (mind:duplicates).
     */
    protected function recordCandidatesFor(Node $node): int
    {
        $recorded = 0;

        foreach ($this->findMergeCandidates($node->label, $node->type, $node->id) as $row) {
            if ($this->recordMergeCandidate($node, $row['node'], $row['score'], $row['reason'])) {
                $recorded++;
            }
        }

        return $recorded;
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
            if ($tag = Tag::forName($name)) {
                $ids[] = $tag->id;
            }
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
     * @param  array<int, string>|null  $areas  Obmedzenie na oblasti (názvy alebo slugy).
     */
    public function recall(string $query, int $limit = 12, ?string $sessionKey = null, ?array $areas = null): Collection
    {
        return $this->recallWithMeta($query, $limit, $sessionKey, $areas)['nodes'];
    }

    /**
     * Recall + metadáta, ktoré potrebuje AI konzument (MCP `mind_recall`).
     *
     * Prečo samostatná metóda a nie zmena `recall()`: tá vracia `Collection<Node>`
     * a číta ju ChatController aj testy — ten kontrakt sa lámať nesmie.
     *
     * `meta` je mapa `node_id => [...]`:
     *   relevance  0..1 — podiel konceptov dopytu, ktoré uzol trafil. Sused
     *              pritiahnutý hranou dostane polovicu relevancie primára,
     *              ktorý ho pritiahol (to bol vždy zámer graph-walku, len to
     *              doteraz nemal kto vyčísliť).
     *   via        label primára, ktorý suseda pritiahol (len u susedov).
     *   snippet    úryvok okolo zhody (searchNodes ho počítal a zahadzoval).
     *   related    labely najsilnejších spojení uzla — bez nich je recall
     *              plochý zoznam a hodnota grafu sa do odpovede nedostane.
     *   noise      kód odpadovosti uzla ({@see noiseOf}), inak null.
     *   semantic   true LEN u uzla, ktorý netrafil ani jedno slovo dopytu a
     *              prišiel z vektorovej vetvy. Kľúč sa inak VYNECHÁVA (nie
     *              `false`) — omissia nesie význam, rovnako ako pri `origin`.
     *
     * Hľadá sa dvoma vetvami — kľúčové slová ({@see searchNodes}) a vektory
     * ({@see fuseRecall}) — ale len keď je vektorová vetva k dispozícii. Keď je
     * vypnutá, nedostupná alebo je korpus nevektorizovaný, táto metóda vracia
     * PRESNE to, čo vracala pred fúziou: rovnaké uzly, rovnaké poradie, rovnaké
     * relevancie, žiaden kľúč navyše.
     *
     * @param  array<int, string>|null  $areas  Obmedzenie na oblasti (názvy alebo slugy).
     * @return array{nodes: Collection<int, Node>, meta: array<int, array<string, mixed>>, terms: array<int, string>}
     */
    public function recallWithMeta(
        string $query,
        int $limit = 12,
        ?string $sessionKey = null,
        ?array $areas = null,
    ): array {
        // Koncepty potrebujeme na menovateľa relevancie: „trafil 2 z 3 pojmov".
        // searchNodes si ich počíta znova — sú cachované a je to jeden zdroj pravdy.
        $concepts = $this->queryConcepts($query);
        $terms = $concepts
            ->map(fn (Collection $roots) => (string) $roots->first())
            ->filter()->unique()->values()->all();

        // Neznámy rozsah nesmie ticho vrátiť celú sieť — a musí zavrieť OBE vetvy.
        // Vektorová vetva o oblastiach nevie, takže keby sa rozsah vyhodnocoval
        // len v searchNodes, semantika by ho obišla bokom.
        $areaIds = $this->resolveAreaIds($areas);

        if ($areaIds === []) {
            return ['nodes' => collect(), 'meta' => [], 'terms' => $terms];
        }

        // Jeden zdroj pravdy: stemovaný SK-aware engine s tvrdým prahom.
        // recall() pridáva navrch len graph-walk + „spomienkový" pulz.
        $matches = $this->searchNodes($query, $limit, $areas);

        // Druhá vetva: vektory. Keď je vypnutá, nedostupná alebo je korpus
        // nevektorizovaný, `$hits` je prázdne, fúzia sa NEVOLÁ a všetko pod tým
        // beží po starom. Toto je tvrdá podmienka, nie optimalizácia: mind_recall
        // volajú živé sessions a spadnutý model nesmie urobiť z pamäte prázdno.
        $hits = $this->vectorHits($query);

        if ($hits !== []) {
            $matches = $this->fuseRecall($matches, $hits, $concepts, $limit, $areaIds);
        }

        if ($matches->isEmpty()) {
            return ['nodes' => collect(), 'meta' => [], 'terms' => $terms];
        }

        $scored = $matches->pluck('node')->values();
        $conceptCount = max(1, $concepts->count());
        $floor = (float) config('hades.embeddings.min_similarity', 0.35);

        $meta = [];
        foreach ($matches as $row) {
            /** @var Node $node */
            $node = $row['node'];
            $relevance = $this->relevanceOf($row, $conceptCount);

            // Podobnosť relevanciu len ZVYŠUJE, a to zhora ohraničene
            // ({@see vectorRelevance}) — nikdy neprepíše to, čo uzol o sebe
            // dokázal slovami dopytu.
            if (isset($row['similarity'])) {
                $relevance = max($relevance, $this->vectorRelevance((float) $row['similarity'], $floor));
            }

            $meta[$node->id] = [
                'relevance' => $relevance,
                'snippet' => $row['snippet'] ?? null,
                'noise' => $this->noiseOf($node),
                'related' => [],
                'via' => null,
            ];

            // Čisto semantický zásah: nula trafených pojmov. AI tak vie, že v uzle
            // nemá hľadať slová dopytu — a že zhoda je v zmysle, nie v texte.
            if ((int) ($row['score'] ?? 0) === 0) {
                $meta[$node->id]['semantic'] = true;
            }
        }

        // Graph-walk hĺbky 1: k primárnym zásahom pridaj ich priamych susedov
        // (jeden skok po hranách) s polovičnou relevanciou. Primáre si držia
        // poradie, susedia sa pripoja za ne. Celkový strop = limit + 50 %.
        $primaryIds = $scored->pluck('id')->all();
        $overallCap = (int) ceil($limit * 1.5);
        $neighborSlots = max(0, $overallCap - $scored->count());

        // Hrany okolo primárov. Ten istý JEDEN dotaz, čo tu bol vždy, len si
        // konečne berie aj `weight` — bez neho by `related` vyberalo náhodné
        // spojenia namiesto najsilnejších a susedia by nemali `via`.
        $edges = Edge::query()
            ->where(function ($q) use ($primaryIds) {
                $q->whereIn('source_id', $primaryIds)
                    ->orWhereIn('target_id', $primaryIds);
            })
            ->orderByDesc('weight')
            ->get(['source_id', 'target_id', 'weight']);

        $neighbors = collect();
        if ($neighborSlots > 0 && $edges->isNotEmpty()) {
            $neighborIds = $edges
                ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
                ->reject(fn ($id) => in_array($id, $primaryIds, true))
                ->unique()
                ->values();

            if ($neighborIds->isNotEmpty()) {
                $neighbors = Node::query()
                    ->with(['area', 'department', 'tags'])
                    ->whereIn('id', $neighborIds->all())
                    // rozsah musí platiť aj na susedov, inak by hrana vytiahla
                    // uzol mimo projektu a obmedzenie by tichým bočným kanálom padlo
                    ->when($areas !== null && $areas !== [], fn ($q) => $q->whereIn(
                        'area_id',
                        $scored->pluck('area_id')->filter()->unique()->all() ?: [0],
                    ))
                    ->orderByDesc('strength')
                    ->limit($neighborSlots)
                    ->get();
            }
        }

        $result = $scored->concat($neighbors)->values();
        $resultIds = $result->pluck('id')->all();

        // Hrany medzi susedmi navzájom — prvý dotaz videl len okolie primárov,
        // takže sused-sused spojenie by v odpovedi chýbalo. Obe strany sú v `IN`,
        // takže je to malý indexovaný dotaz, nie sken.
        if ($neighbors->isNotEmpty()) {
            $edges = $edges->concat(
                Edge::query()
                    ->whereIn('source_id', $neighbors->pluck('id')->all())
                    ->whereIn('target_id', $resultIds)
                    ->orderByDesc('weight')
                    ->get(['source_id', 'target_id', 'weight'])
            );
        }

        [$meta, $related] = $this->relationMeta($edges, $result, $meta);

        foreach ($resultIds as $id) {
            $meta[$id]['related'] = $related[$id] ?? [];
        }

        // Susedia prišli v poradí podľa sily, nie relevancie. AI ale číta zhora
        // dolu a keď odpoveď kráti, kráti ju zdola — poradie preto musí klesať
        // v relevancii, inak si odreže relevantnejší uzol než ten, čo nechá.
        if ($neighbors->count() > 1) {
            $neighbors = $neighbors->sortByDesc(
                fn (Node $n) => ($meta[$n->id]['relevance'] ?? 0) * 10000
                    + min((float) $n->strength, 999)
            )->values();

            $result = $scored->concat($neighbors)->values();
            $resultIds = $result->pluck('id')->all();
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

        MindPulse::dispatch('recall', ['node_ids' => $resultIds]);

        return ['nodes' => $result, 'meta' => $meta, 'terms' => $terms];
    }

    /**
     * Z hrán poskladá `via` susedov a labely `related` pre každý vrátený uzol.
     *
     * Labely spojení mimo výsledku sa doťahujú JEDNÝM dotazom až po výbere
     * stropu — nie po uzloch. Práve tá N+1 bola dôvod, prečo recall susedov
     * nikdy nevracal, a s jedným `whereIn` cez `id` padá.
     *
     * @param  Collection<int, Edge>  $edges
     * @param  Collection<int, Node>  $result
     * @param  array<int, array<string, mixed>>  $meta
     * @return array{0: array<int, array<string, mixed>>, 1: array<int, array<int, string>>}
     */
    protected function relationMeta(Collection $edges, Collection $result, array $meta): array
    {
        $inResult = array_flip($result->pluck('id')->all());
        $known = [];
        foreach ($result as $node) {
            $known[(int) $node->id] = (string) $node->label;
        }

        /** @var array<int, array<int, float>> $adj */
        $adj = [];
        foreach ($edges as $edge) {
            $pairs = [
                [(int) $edge->source_id, (int) $edge->target_id],
                [(int) $edge->target_id, (int) $edge->source_id],
            ];
            foreach ($pairs as [$a, $b]) {
                if (! isset($inResult[$a])) {
                    continue;
                }
                $adj[$a][$b] = max($adj[$a][$b] ?? 0.0, (float) $edge->weight);
            }
        }

        // Sused: kto ho pritiahol (najrelevantnejší primár na hrane) a teda aj
        // jeho polovičná relevancia. Bez toho AI nevie, prečo uzol v odpovedi je.
        foreach ($result as $node) {
            $id = (int) $node->id;
            if (isset($meta[$id])) {
                continue;
            }

            $bestId = null;
            $bestRel = 0.0;
            foreach ($adj[$id] ?? [] as $other => $weight) {
                if (! isset($meta[$other]['relevance'])) {
                    continue;
                }
                $rel = (float) $meta[$other]['relevance'];
                if ($bestId === null || $rel > $bestRel) {
                    $bestId = (int) $other;
                    $bestRel = $rel;
                }
            }

            $meta[$id] = [
                'relevance' => round($bestRel / 2, 2),
                'snippet' => null,
                'noise' => $this->noiseOf($node),
                'related' => [],
                'via' => $bestId !== null ? ($known[$bestId] ?? null) : null,
            ];
        }

        // Výber spojení: najprv tie, ktoré sú aj tak v odpovedi (ich label je už
        // raz zaplatený), potom najsilnejšie mimo nej — tie dávajú AI meno, ktoré
        // si vie dotiahnuť cez mind_read.
        $cap = max(0, (int) config('hades.recall_related_cap', 3));
        $picked = [];
        $needLabels = [];
        foreach ($result as $node) {
            $id = (int) $node->id;
            $picked[$id] = collect($adj[$id] ?? [])
                ->map(fn (float $weight, int $other) => ['id' => $other, 'weight' => $weight])
                ->sortByDesc(fn (array $c) => (isset($inResult[$c['id']]) ? 1e6 : 0.0) + $c['weight'])
                ->take($cap)
                ->pluck('id')
                ->all();

            foreach ($picked[$id] as $other) {
                if (! isset($known[$other])) {
                    $needLabels[$other] = true;
                }
            }
        }

        if ($needLabels !== []) {
            foreach (Node::whereIn('id', array_keys($needLabels))->pluck('label', 'id') as $id => $label) {
                $known[(int) $id] = (string) $label;
            }
        }

        $related = [];
        foreach ($picked as $id => $others) {
            $via = $meta[$id]['via'] ?? null;
            $related[$id] = collect($others)
                ->map(fn (int $other) => $known[$other] ?? null)
                ->filter()
                // `via` nesie to isté spojenie — dvakrát ten istý label je len token navyše
                ->reject(fn (string $label) => $label === $via)
                ->unique()
                ->values()
                ->all();
        }

        return [$meta, $related];
    }

    /**
     * Kód „odpadovosti" uzla, alebo null keď je uzol v poriadku.
     *
     * Audit siete našiel štyri opakované vzory a pre AI konzumenta je každý
     * z nich čistý šum: uzol vyzerá ako poznatok, ale nič nehovorí. Recall ich
     * preto radí za čisté uzly a označí ich, aby AI vedela, že im nemá veriť
     * ako zdroju — a mohla ich opraviť (`mind_rename`) alebo zahodiť
     * (`mind_delete`). Nemazať automaticky: to rozhodnutie je na človeku.
     *
     *   markdown    label nesie markdown („# Smernica: …", „**tučné**")
     *   raw-prompt  label je surová veta používateľa, nie meno poznatku
     *   slug        strojový slug generátora („charming-chaum-da6141")
     *   stub        uzol bez popisu — nenesie žiadnu znalosť
     */
    public function noiseOf(Node $node): ?string
    {
        $label = trim((string) $node->label);

        if ($label === '') {
            return 'stub';
        }

        if (preg_match('/^#{1,6}\s|^[-*+]\s|^>\s|\*\*|`/u', $label)) {
            return 'markdown';
        }

        // generátor mien typu „charming-chaum-da6141" — dve až štyri slová a hex chvost
        if (preg_match('/^[a-z0-9]+(?:-[a-z0-9]+){1,3}-[0-9a-f]{6}$/', $label) === 1) {
            return 'slug';
        }

        // Dvojbodka na konci je useknutá veta, nie meno — a to platí bez ohľadu
        // na dĺžku („Projekt C:\Aura\ovl-da-zliav, aktuálna vetva:").
        if (str_ends_with($label, ':')) {
            return 'raw-prompt';
        }

        $words = preg_split('/\s+/u', $label) ?: [];
        $first = mb_substr($label, 0, 1);
        $lowercaseStart = preg_match('/\pL/u', $first) === 1 && mb_strtolower($first) === $first;
        $imperative = '/^(použi|urob|sprav|vypracuj|napíš|napis|oprav|pozri|chcem|chcel'
            .'|potrebuj|potreboval|môžeš|mozes|doplň|dopln|pridaj|vytvor|skús|skus'
            .'|analyzuj|zisti|ako )/ui';

        // Posledné slovo, na ktoré sa veta nikdy nekončí. Presne takto vypadá
        // prompt useknutý na N znakov: „…nasadíme do dockeru a", „…tak aby".
        $dangling = ['a', 'aj', 'ale', 'aby', 'tak', 'že', 'ze', 'ktorý', 'ktorá', 'ktoré',
            'ktorú', 'ktorom', 's', 'so', 'v', 'vo', 'na', 'do', 'pre', 'po', 'za', 'od',
            'z', 'zo', 'k', 'ku', 'i', 'či', 'keď', 'lebo', 'mi', 'si', 'sa', 'to', 'aj'];
        $last = mb_strtolower((string) end($words));

        // surová veta: dlhá a začína malým písmenom, rozkazom, končí otázkou
        // alebo visí na spojke — meno poznatku takto nevyzerá nikdy
        if (count($words) >= 5 && in_array($last, $dangling, true)) {
            return 'raw-prompt';
        }

        if (count($words) >= 7 && (
            $lowercaseStart
            || str_ends_with($label, '?')
            || preg_match($imperative, $label) === 1
        )) {
            return 'raw-prompt';
        }

        if (mb_strlen(trim((string) $node->description)) < 15) {
            return 'stub';
        }

        return null;
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
    /**
     * @param  array<int, string>|null  $areas  Obmedzenie na oblasti (názvy alebo slugy).
     *                                          Filtruje sa už v SQL — zúžiť výsledok až
     *                                          po prijatí by ušetrilo šum, nie payload.
     */
    public function searchNodes(string $query, int $limit = 12, ?array $areas = null): Collection
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

        $take = max($limit * 5, 60);

        // Rozsah projektu (memory_scope v sesterskej chat appke): obmedzí hľadanie
        // na vybrané oblasti. Prázdne pole = bez obmedzenia.
        $areaIds = $this->resolveAreaIds($areas);

        // Neznámy rozsah nesmie ticho vrátiť celú sieť — radšej nič.
        if ($areaIds === []) {
            return collect();
        }

        // A10: rýchla cesta cez FULLTEXT index. LIKE '%koreň%' nevie použiť
        // žiadny index (EXPLAIN: type ALL, plný sken), ale MATCH matchuje len od
        // začiatku slova — preto keď rýchla cesta nenaberie dosť kandidátov,
        // pokračujeme starou cestou a o výsledku aj tak rozhoduje PHP skórovanie nižšie.
        $nodes = $this->fulltextCandidates($roots, $take, $orderCases, $orderBindings, $areaIds);

        if ($nodes === null || $nodes->count() < $take) {
            $nodes = Node::query()
                ->with(['area', 'department', 'tags'])
                ->when($areaIds, fn ($q) => $q->whereIn('area_id', $areaIds))
                ->where(function ($q) use ($roots, $col) {
                    foreach ($roots as $root) {
                        $like = '%'.$root.'%';
                        $q->orWhereRaw('label LIKE ?'.$col, [$like])
                            ->orWhereRaw('description LIKE ?'.$col, [$like]);
                    }
                })
                ->orderByRaw(implode(' + ', $orderCases).' DESC', $orderBindings)
                ->orderByDesc('strength')
                ->limit($take)
                ->get();
        }

        // Uzly, ktoré sedia LEN tagom. Kandidátske dopyty vyššie pozerajú na
        // label a description, takže uzol s ručne dopísaným aliasom by sa medzi
        // ne nedostal a skórovanie by nemalo čo hodnotiť. Namerané na živých
        // dátach: 4 310 z 10 246 väzieb na tag nesie text, ktorý v uzle inak
        // nie je — teda 42 % tagov niečo pridáva.
        $nodes = $nodes->concat($this->tagCandidates($roots, $take, $areaIds))
            ->unique(fn (Node $node) => $node->id);

        return $nodes
            ->map(fn (Node $node) => $this->scoreRow($node, $concepts, $roots))
            ->filter(fn ($row) => $row['score'] > 0)   // tvrdý prah — 0 zhodných konceptov = von
            // Štyri nepremiešateľné pásma, od najsilnejšieho:
            //   1. počet zhodných konceptov (to bolo vždy),
            //   2. čistota — odpadový uzol (surový prompt, markdown v labeli,
            //      strojový slug, stub) ide ZA čistý uzol s tou istou zhodou,
            //      takže silný odpad nepredbehne slabý, ale skutočný poznatok,
            //   3. zhoda v LABELI (uzol pomenovaný podľa dopytu je to, čo hľadáš),
            //   4. sila uzla ako posledný tie-break.
            // Prah relevancie sa nemení — nič sa nezahadzuje, len sa odpad
            // prestane tlačiť na začiatok kontextu.
            ->sortByDesc(fn ($row) => $row['score'] * 10000
                + ($row['noise'] === null ? 5000 : 0)
                + $this->labelShare($row) * 2000
                + min((float) $row['node']->strength, 999))
            ->take($limit)
            ->values();
    }

    /**
     * Podiel konceptov dopytu, ktoré uzol trafil priamo v labeli (0..1).
     *
     * @param  array{score:int, label_score?:int}  $row
     */
    protected function labelShare(array $row): float
    {
        $score = max(1, (int) $row['score']);

        return min(1.0, ((int) ($row['label_score'] ?? 0)) / $score);
    }

    /**
     * Relevancia uzla pre AI konzumenta (0..1).
     *
     * Dve tretiny nesie pokrytie dopytu (koľko z pojmov uzol vôbec trafil),
     * jednu tretinu to, či ich trafil v labeli. Samotné pokrytie nestačilo:
     * pri dopyte so štyrmi pojmami padne celé okno dvanástich uzlov do jedného
     * pásma a všetky dostanú tú istú hodnotu.
     *
     * @param  array{score:int, label_score?:int}  $row
     */
    protected function relevanceOf(array $row, int $conceptCount): float
    {
        $conceptCount = max(1, $conceptCount);
        $coverage = min(1.0, ((int) $row['score']) / $conceptCount);
        $label = min(1.0, ((int) ($row['label_score'] ?? 0)) / $conceptCount);

        return round((2 * $coverage + $label) / 3, 2);
    }

    /**
     * Ohodnotí JEDEN uzol proti konceptom dopytu — riadok, s akým pracuje
     * `searchNodes` aj fúzia.
     *
     * Prečo samostatná metóda: vektorová vetva prináša uzly, ktoré kľúčová vetva
     * nikdy nevidela, a tie sa musia merať TÝM ISTÝM pravítkom. Dve kópie tohto
     * skórovania by znamenali dvojaký meter na relevanciu v jednej odpovedi.
     *
     * @param  Collection<int, Collection<int, string>>  $concepts
     * @param  Collection<int, string>  $roots
     * @return array{node: Node, score: int, label_score: int, snippet: ?string, noise: ?string}
     */
    protected function scoreRow(Node $node, Collection $concepts, Collection $roots): array
    {
        // Tagy patria do haystacku: tag je ZÁMERNÝ alias, teda silnejší
        // signál než náhodné slovo v popise. Skóre počíta zhodné
        // koncepty, takže zhoda cez tag váži rovnako ako cez label —
        // presne tak, ako to má byť.
        $tags = $node->relationLoaded('tags') ? $node->tags->pluck('name')->implode(' ') : '';

        // fold haystack — korene sú už foldnuté v queryConcepts, takže
        // tvrdý prah je tiež necitlivý na diakritiku
        $hay = ' '.$this->fold(trim($node->label.' '.(string) $node->description.' '.$tags)).' ';

        // koncept je zhoda, ak ho trafí aspoň jeden jeho koreň
        $score = $concepts->filter(
            fn (Collection $conceptRoots) => $conceptRoots->contains(
                fn ($root) => mb_strpos($hay, $root) !== false
            )
        )->count();

        // To isté, ale LEN v labeli. Uzol pomenovaný podľa dopytu je
        // takmer vždy to, čo hľadáš; uzol, ktorý ten pojem raz zmieni
        // v 3 000-znakovom popise, nie. Bez tohto rozlíšenia dostalo
        // dvanásť uzlov v jednom skórovacom pásme rovnakú relevanciu
        // (namerané: 12× 0,5) a AI nemala ako oddeliť prvý od dvanásteho.
        $hayLabel = ' '.$this->fold(trim((string) $node->label)).' ';
        $labelScore = $concepts->filter(
            fn (Collection $conceptRoots) => $conceptRoots->contains(
                fn ($root) => mb_strpos($hayLabel, $root) !== false
            )
        )->count();

        return [
            'node' => $node,
            'score' => $score,
            'label_score' => $labelScore,
            'snippet' => $this->snippetFor((string) $node->description, $roots),
            // odpadovosť sa počíta tu, nie u konzumenta — rozhoduje o poradí
            'noise' => $this->noiseOf($node),
        ];
    }

    /**
     * Názvy/slugy oblastí → ich `id`.
     *
     * `null` = bez obmedzenia, `[]` = rozsah bol zadaný, ale ani jedna oblasť
     * neexistuje. To druhé MUSÍ volajúci vyhodnotiť ako „nič", nie ako „všetko";
     * ticho zahodený rozsah je bočný kanál z cudzieho projektu.
     *
     * @param  array<int, string>|null  $areas
     * @return array<int, int>|null
     */
    protected function resolveAreaIds(?array $areas): ?array
    {
        if ($areas === null || $areas === []) {
            return null;
        }

        $wanted = collect($areas)->map(fn ($a) => mb_strtolower(trim((string) $a)))->filter();

        return Area::all()
            ->filter(fn (Area $a) => $wanted->contains(mb_strtolower($a->name)) || $wanted->contains($a->slug))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Vektorová vetva recallu. Vracia `[]` VŽDY, keď sa nedá spoľahnúť na
     * výsledok — vypnutá konfigurácia, prázdny korpus, nedostupný model, chýbajúca
     * tabuľka.
     *
     * Prečo `Throwable` a nie `RuntimeException`: nedostupný model je len jedna
     * z ciest, ako sem môže priletieť výnimka (nemigrovaná tabuľka, zmenená
     * odpoveď Ollamy, timeout HTTP klienta). Recall je čítacia cesta živých
     * sessions a žiadna z tých príčin nesmie z pamäte urobiť prázdno — degradácia
     * na kľúčové slová je vždy lepšia odpoveď než 500.
     *
     * @return array<int, array{node_id: int, similarity: float}>
     */
    protected function vectorHits(string $query): array
    {
        if (trim($query) === '') {
            return [];
        }

        $embeddings = app(EmbeddingService::class);

        if (! $embeddings->enabled()) {
            return [];
        }

        try {
            return $embeddings->search($query);
        } catch (\Throwable $e) {
            // Log, nie výnimka — inak by pád modelu vyzeral ako prázdna pamäť
            // a nikto by sa nedozvedel, že bežala len polovica hľadania.
            Log::warning('Recall beží len na kľúčových slovách: '.$e->getMessage());

            return [];
        }
    }

    /**
     * Fúzia kľúčovej a vektorovej vetvy — Reciprocal Rank Fusion.
     *
     * `skóre = Σ 1/(k + poradie)`, k z `hades.embeddings.rrf_k`. RRF fúzuje
     * PORADIA, nie skóre: kosínusová podobnosť (0,35–0,95) a počet trafených
     * pojmov (0–12) nemajú spoločnú stupnicu a každé ich priame miešanie je
     * zamaskovaná voľba váhy.
     *
     * Dve veci, ktoré fúzia drží z pôvodného poradia:
     *
     *  - **Odpad ide za čistý uzol.** Kľúčová vetva to má v poradí zabudované
     *    (pásmo v `searchNodes`), vektorová o tom nevie — tak sa to isté pásmo
     *    aplikuje aj na jej poradie. Bez toho by stub s vysokou podobnosťou
     *    dostal vektorové poradie 1 a semantika by vytiahla odpad na začiatok
     *    kontextu, teda presne to, čo `noiseOf` rieši.
     *  - **Pri rovnakom RRF rozhodujú tie isté pásma ako doteraz** — čistota,
     *    zhoda v labeli, sila. Rovnaké RRF je bežné, nie hypotetické: uzol na
     *    1. mieste kľúčovej vetvy a uzol na 1. mieste vektorovej majú presne
     *    to isté skóre.
     *
     * Pri prázdnej vektorovej vetve sa táto metóda NEVOLÁ (a keby aj: RRF je
     * pri jednom zdroji striktne klesajúce v poradí, takže by poradie nezmenila).
     *
     * @param  Collection<int, array{node: Node, score: int, label_score: int, snippet: ?string, noise: ?string}>  $keyword
     * @param  array<int, array{node_id: int, similarity: float}>  $hits
     * @param  Collection<int, Collection<int, string>>  $concepts
     * @param  array<int, int>|null  $areaIds
     * @return Collection<int, array<string, mixed>>
     */
    protected function fuseRecall(
        Collection $keyword,
        array $hits,
        Collection $concepts,
        int $limit,
        ?array $areaIds,
    ): Collection {
        $k = max(1, (int) config('hades.embeddings.rrf_k', 60));
        $roots = $concepts->flatten()->unique()->values();

        $similarity = [];
        foreach ($hits as $hit) {
            $similarity[(int) $hit['node_id']] = (float) $hit['similarity'];
        }

        /** @var array<int, array<string, mixed>> $rows */
        $rows = [];
        $keywordRank = [];
        $rank = 0;
        foreach ($keyword as $row) {
            $id = (int) $row['node']->id;
            $rows[$id] = $row;
            $keywordRank[$id] = ++$rank;
        }

        // Uzly, ktoré prišli len z vektorov. Rozsah oblastí platí aj na ne —
        // EmbeddingService o oblastiach nevie a filtrovať sa musí tu.
        $unseen = array_values(array_diff(array_keys($similarity), array_keys($rows)));

        if ($unseen !== []) {
            Node::query()
                ->with(['area', 'department', 'tags'])
                ->whereIn('id', $unseen)
                ->when($areaIds, fn ($q) => $q->whereIn('area_id', $areaIds))
                ->get()
                ->each(function (Node $node) use (&$rows, $concepts, $roots) {
                    // Tým istým pravítkom ako kľúčová vetva: uzol môže mať zhodu
                    // v texte a len sa nezmestil do jej okna. Označiť ho ako čisto
                    // semantický by bola lož a relevanciu by počítal iný meter.
                    $rows[(int) $node->id] = $this->scoreRow($node, $concepts, $roots);
                });
        }

        $vectorRank = [];
        $ordered = array_values(array_filter(
            array_keys($similarity),
            fn (int $id) => isset($rows[$id]),
        ));

        usort($ordered, fn (int $a, int $b) => $this->cleanFlag($rows[$b]) <=> $this->cleanFlag($rows[$a])
            ?: $similarity[$b] <=> $similarity[$a]
            ?: $a <=> $b);

        $rank = 0;
        foreach ($ordered as $id) {
            $vectorRank[$id] = ++$rank;
        }

        $fused = [];
        foreach ($rows as $id => $row) {
            $score = 0.0;

            if (isset($keywordRank[$id])) {
                $score += 1 / ($k + $keywordRank[$id]);
            }

            if (isset($vectorRank[$id])) {
                $score += 1 / ($k + $vectorRank[$id]);
            }

            $row['rrf'] = $score;
            $row['similarity'] = $similarity[$id] ?? null;

            // Úryvok má ukázať, KDE sa zhoda našla. Pri nulovej zhode by ukázal
            // len začiatok popisu a v odpovedi by nahradil dlhší (a teda
            // informatívnejší) prefix, ktorý by tam bol býval aj tak.
            if ($row['score'] === 0) {
                $row['snippet'] = null;
            }

            $fused[] = $row;
        }

        usort($fused, fn (array $a, array $b) => $b['rrf'] <=> $a['rrf']
            ?: $this->cleanFlag($b) <=> $this->cleanFlag($a)
            ?: $this->labelShare($b) <=> $this->labelShare($a)
            ?: (float) $b['node']->strength <=> (float) $a['node']->strength);

        return collect(array_slice($fused, 0, max(1, $limit)));
    }

    /** 1 = čistý uzol, 0 = odpad. Pásmo poradia, nie vlastnosť uzla. */
    protected function cleanFlag(array $row): int
    {
        return ($row['noise'] ?? null) === null ? 1 : 0;
    }

    /**
     * Relevancia zásahu, ktorý má len vektor (0..0,66).
     *
     * Podobnosť sa normalizuje NAD PODLAHOU (`min_similarity`), nie od nuly:
     * kandidát tesne nad prahom je „práve pripustený", nie „na tretinu
     * relevantný", a bez normalizácie by celá vektorová vetva žila v pásme
     * 0,35–0,95, kde sa nedá nič odlíšiť.
     *
     * Výsledok vstupuje do toho istého vzorca ako kľúčová relevancia
     * ({@see relevanceOf}), len v role pokrytia: `(2 × podobnosť + 0) / 3`.
     * Tretina za zhodu v LABELI je pre čisto semantický zásah nedosiahnuteľná
     * z definície — netrafil ani jedno slovo dopytu, teda ani v labeli.
     *
     * Pasca: zaokrúhľuje sa DOLU. Nahor by `2/3` dalo 0,67, čo je presne minimum
     * uzla, ktorý trafil VŠETKY pojmy dopytu — a tým by sa stratila vlastnosť,
     * na ktorej relevancia stojí: plné pokrytie dopytu je vždy nad čímkoľvek,
     * čo pokrylo len časť.
     */
    protected function vectorRelevance(float $similarity, float $floor): float
    {
        $span = 1.0 - min(max($floor, 0.0), 0.99);
        $normalised = max(0.0, min(1.0, ($similarity - $floor) / $span));

        return floor(2 * $normalised / 3 * 100) / 100;
    }

    /**
     * Kandidáti nájdení cez TAG.
     *
     * Samostatný dopyt, nie ďalšia podmienka v tých vyššie: rýchla cesta cez
     * FULLTEXT matchuje `MATCH(label, description)` a tag do nej nepatrí, takže
     * uzol s aliasom by sa medzi kandidátov nedostal vždy — len keď by rýchla
     * cesta nenaplnila strop a spustila sa tá pomalá.
     *
     * Slugy sa porovnávajú aj s pomlčkami nahradenými medzerou: tag „10-rokov“
     * má nájsť dopyt „10 rokov“.
     *
     * Zhoda sa hľadá v PHP nad celou tabuľkou tagov, nie `LIKE`-om v SQL. Prvá
     * verzia dávala do poddotazu `OR name LIKE '%koren%'` za každý koreň —
     * pri dopyte s dvanástimi koreňmi to bolo 24 podmienok s úvodným
     * zástupným znakom, teda bez šance na index: **5,34 s** na jeden recall.
     * Tagov je 3 640, čo je v pamäti nič, a uzly sa potom doťahujú cez
     * indexované `id`.
     *
     * @param  Collection<int, string>  $roots
     * @return Collection<int, Node>
     */
    protected function tagCandidates(Collection $roots, int $take, ?array $areaIds = null): Collection
    {
        $terms = $roots->filter(fn (string $root) => mb_strlen($root) >= 3)->values();

        if ($terms->isEmpty()) {
            return collect();
        }

        $tagIds = collect($this->foldedTags())
            ->filter(fn (string $name) => $terms->contains(fn (string $root) => mb_strpos($name, $root) !== false))
            ->keys();

        if ($tagIds->isEmpty()) {
            return collect();
        }

        return Node::query()
            ->with(['area', 'department', 'tags'])
            ->when($areaIds, fn ($q) => $q->whereIn('area_id', $areaIds))
            ->whereHas('tags', fn ($q) => $q->whereIn('tags.id', $tagIds))
            ->orderByDesc('strength')
            ->limit($take)
            ->get();
    }

    /**
     * `id => foldnuté meno` pre všetky tagy.
     *
     * Foldovať 3 640 mien pri každom recalle stálo 0,8 s — a recall beží pri
     * každej správe. Kľúč nesie počet a najvyššie `id`, takže nový tag cache
     * zneplatní sám a nečaká sa na TTL: uzol uložený pred sekundou musí byť
     * dohľadateľný hneď.
     *
     * @return array<int, string>
     */
    protected function foldedTags(): array
    {
        $stamp = Tag::query()->selectRaw('COUNT(*) AS c, IFNULL(MAX(id), 0) AS m')->first();

        return Cache::remember(
            "mind:tags:folded:{$stamp->c}:{$stamp->m}",
            3600,
            fn () => Tag::query()
                ->get(['id', 'name'])
                ->mapWithKeys(fn (Tag $tag) => [
                    $tag->id => ' '.$this->fold(str_replace('-', ' ', (string) $tag->name)).' ',
                ])
                ->all(),
        );
    }

    /**
     * A10 — kandidáti cez FULLTEXT index (rýchla cesta recallu).
     *
     * Vráti null, keď je cesta vypnutá alebo ju databáza nepodporuje; volajúci
     * potom pokračuje pôvodným LIKE dotazom. Korene idú do boolean módu s
     * hviezdičkou (`koren*`), čo sedí na to, čo robí SK stemmer — orezáva
     * koncovky, takže hľadáme slová začínajúce koreňom.
     *
     * @param  Collection<int, string>  $roots
     * @return Collection<int, Node>|null
     */
    protected function fulltextCandidates(Collection $roots, int $take, array $orderCases, array $orderBindings, ?array $areaIds = null): ?Collection
    {
        if (! config('hades.recall_fulltext', false) || DB::getDriverName() !== 'mysql') {
            return null;
        }

        // InnoDB fulltext ignoruje tokeny kratšie než innodb_ft_min_token_size (3)
        $terms = $roots
            ->filter(fn (string $root) => mb_strlen($root) >= 3)
            ->map(fn (string $root) => preg_replace('/[^\p{L}\p{N}_]/u', '', $root))
            ->filter(fn (string $root) => $root !== '')
            ->unique()
            ->map(fn (string $root) => $root.'*');

        if ($terms->isEmpty()) {
            return null;
        }

        return Node::query()
            ->with(['area', 'department'])
            ->when($areaIds, fn ($q) => $q->whereIn('area_id', $areaIds))
            ->whereRaw('MATCH(label, description) AGAINST (? IN BOOLEAN MODE)', [$terms->implode(' ')])
            ->orderByRaw(implode(' + ', $orderCases).' DESC', $orderBindings)
            ->orderByDesc('strength')
            ->limit($take)
            ->get();
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
            // mind_learn berie `certainty`, ale doteraz sa hodnoty dali zistiť len
            // z tools/list — AI, ktorá si štruktúru ťahá z overview, ich nemala odkiaľ vedieť
            'certainty_levels' => ['overene', 'hypoteza', 'pasca'],
            // Slovník najpoužívanejších tagov. Tag je v Hadese zámerný alias a
            // recall ho skóruje ako label; bez tohto zoznamu si ho každá session
            // vymyslí nanovo a z „docker" sa stane „Docker", „dockeru", „containers".
            'top_tags' => Tag::query()
                ->withCount('nodes')
                ->orderByDesc('nodes_count')
                ->orderBy('slug')
                ->limit((int) config('hades.overview_top_tags', 24))
                ->pluck('name')
                ->all(),
            'totals' => [
                'nodes' => Node::count(),
                'edges' => Edge::count(),
            ],
        ];
    }

    /**
     * Cesta k zdrojovému .md, ak uzol nejaký má (skill / session súmar /
     * claude-memory). Jediný zdroj pravdy — tá istá úvaha bola predtým dvakrát
     * skopírovaná (ContextController pre balík, DirectiveController pre skilly)
     * a MCP `mind_read` by bol tretí. Cesta je to najcennejšie, čo vieme AI
     * dať: znamená „toto si prečítaj celé sám".
     */
    public function sourcePathOf(Node $node): ?string
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

        // A5: zhoda cez slug v rámci typu — tá istá vec inak zapísaná (chýbajúca
        // diakritika, pomlčka namiesto medzery, iná veľkosť písmen). Presne toto
        // rozdelilo „Opportunity-Solution Tree" a „Opportunity solution tree".
        $slug = Str::slug($label);
        if ($slug !== '') {
            $bySlug = (clone $query)->where('slug', $slug)->first();
            if ($bySlug) {
                return $bySlug;
            }
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

        // A5: automaticky sa zlúči len naozaj vysoká zhoda. Pôvodný prah bol
        // 85 % ALEBO pomer dĺžok 0,6 — to „alebo" stačilo samo osebe a lepilo
        // nesúvisiace uzly. Teraz je pomer dĺžok len poistka (AND) a hranica
        // zlúčenia je 95 %; pásmo 85–95 % ide na review, nie do merge.
        return $candidates->first(
            fn (Node $candidate) => $this->labelSimilarity($normalized, mb_strtolower($candidate->label))
                >= self::MERGE_THRESHOLD
        );
    }

    /**
     * Podobnosť dvoch už normalizovaných labelov v percentách.
     *
     * Pomer dĺžok je vstupná brána, nie alternatíva: dva reťazce s veľmi
     * rozdielnou dĺžkou nie sú ten istý pojem, aj keby similar_text hlásil veľa
     * (to bol prípad „Canva" vs „Canvas visualization"). Pod bránou vracia 0.
     */
    protected function labelSimilarity(string $a, string $b): float
    {
        $maxLen = max(mb_strlen($a), mb_strlen($b), 1);
        $ratio = min(mb_strlen($a), mb_strlen($b)) / $maxLen;

        if ($ratio < self::LENGTH_RATIO_GATE) {
            return 0.0;
        }

        similar_text($a, $b, $percent);

        return (float) $percent;
    }

    /**
     * A5/A6 — nájde uzly, ktoré vyzerajú ako duplicity, ale na automatické
     * zlúčenie nestačia. Nič nemení, len vracia podklad pre merge_candidates.
     *
     * Dva zdroje návrhov:
     *   1. rovnaký slug pri INOM type — findByLabel() filtruje zhodu typom,
     *      takže ten istý poznatok zapísaný raz ako skill a raz ako memory sa
     *      nikdy nestretol. Deväť z desiatich duplicít nájdených pri backfille
     *      slugov bolo presne toto.
     *   2. podobnosť labelu v pásme review (85–95 %) v rámci toho istého typu.
     *
     * @return Collection<int, array{node: Node, score: float, reason: string}>
     */
    public function findMergeCandidates(string $label, ?string $type = null, ?int $excludeId = null): Collection
    {
        $normalized = mb_strtolower(trim($label));
        $slug = Str::slug($label);
        $out = collect();

        if ($slug !== '') {
            Node::query()
                ->where('slug', $slug)
                ->when($type, fn ($q) => $q->where('type', '!=', $type))
                ->when($excludeId, fn ($q) => $q->whereKeyNot($excludeId))
                ->where(fn ($q) => $q->whereNull('source')->orWhere('source', '!=', 'session'))
                ->get()
                ->each(fn (Node $n) => $out->push([
                    'node' => $n,
                    'score' => 100.0,
                    'reason' => 'cross_type_slug',
                ]));
        }

        // Predvýber ide cez prefix SLUGU, nie surového labelu: slug má oddeľovače
        // už znormalizované, takže „Opportunity-Solution Tree" a „Opportunity
        // solution trees" zdieľajú prefix, hoci ako text sa nezhodujú ani v
        // prvom slove. Prefix len zužuje množinu, o zhode rozhoduje až
        // labelSimilarity() nižšie.
        if ($slug !== '' && mb_strlen($normalized) >= 4) {
            $prefix = mb_substr($slug, 0, self::CANDIDATE_PREFIX);

            Node::query()
                ->when($type, fn ($q) => $q->where('type', $type))
                ->when($excludeId, fn ($q) => $q->whereKeyNot($excludeId))
                // session záznamy sa nezlučujú — majú vlastnú cestu cez
                // mind:archive-old. Bez tejto výnimky by každé dve sessions
                // toho istého projektu v ten istý deň vyrobili návrh na zlúčenie.
                ->where(fn ($q) => $q->whereNull('source')->orWhere('source', '!=', 'session'))
                ->where('slug', 'like', $prefix.'%')
                ->limit(50)
                ->get()
                ->each(function (Node $n) use ($normalized, $out) {
                    $score = $this->labelSimilarity($normalized, mb_strtolower($n->label));

                    if ($score >= self::REVIEW_THRESHOLD && $score < self::MERGE_THRESHOLD) {
                        $out->push(['node' => $n, 'score' => $score, 'reason' => 'similar_label']);
                    }
                });
        }

        return $out->unique(fn (array $row) => $row['node']->id)->values();
    }

    /**
     * Zapíše návrh na zlúčenie. Pár sa normalizuje na (menšie id, väčšie id),
     * takže ten istý návrh z oboch strán vytvorí jeden riadok. Už rozhodnutý
     * návrh (merged/rejected) sa znovu neotvára — inak by odmietnutý pár
     * vyskakoval po každom ingeste nanovo.
     */
    public function recordMergeCandidate(Node $a, Node $b, float $score, string $reason): ?MergeCandidate
    {
        if ($a->id === $b->id) {
            return null;
        }

        [$first, $second] = $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];

        $existing = MergeCandidate::where('node_a_id', $first)->where('node_b_id', $second)->first();

        if ($existing) {
            return $existing;
        }

        return MergeCandidate::create([
            'node_a_id' => $first,
            'node_b_id' => $second,
            'score' => $score,
            'reason' => $reason,
            'status' => MergeCandidate::STATUS_PENDING,
        ]);
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

    /**
     * A4 — presné vyhľadanie uzla podľa labelu (alebo jeho slugu).
     *
     * Zámerne NEpoužíva findByLabel(): to zlučuje cez substring a similar_text
     * na 85 %, čo je v poriadku pri učení, ale pri rename/move/delete by to
     * znamenalo trafiť nesprávny uzol. Tu musí byť zhoda jednoznačná — pri
     * viacerých kandidátoch radšej nevráti nič.
     */
    public function findExact(string $label, ?string $type = null): ?Node
    {
        $normalized = mb_strtolower(trim($label));
        $slug = Str::slug($label);

        $matches = Node::query()
            ->when($type, fn ($q) => $q->where('type', $type))
            ->where(function ($q) use ($normalized, $slug) {
                $q->whereRaw('LOWER(label) = ?', [$normalized])
                    ->orWhere('slug', $slug);
            })
            ->limit(2)
            ->get();

        return $matches->count() === 1 ? $matches->first() : null;
    }

    /**
     * A4 — premenovanie uzla. Mení len label; slug si model dopočíta sám.
     *
     * Rieši anti-vzorec „markdownom zmrzačený label" (napr. uzol s názvom
     * `# Smernica: produkt foto automatizacia cez agentov v chatgpt`), ktorý sa
     * doteraz nedal opraviť — Hades nemal rename, len pridávanie a zlučovanie.
     */
    public function rename(Node $node, string $label): Node
    {
        $label = trim($label);

        if ($label === '') {
            throw new \InvalidArgumentException('Nový názov nesmie byť prázdny.');
        }

        $node->label = $label;
        $node->save();

        $fresh = $node->fresh();
        MindPulse::dispatch('node.updated', ['node' => $fresh->toApi()]);

        return $fresh;
    }

    /**
     * A4 — presun uzla do inej oblasti/oddelenia.
     *
     * Rozlíšenie je tu ZÁMERNE prísne, na rozdiel od resolveArea() pri učení:
     * neznáma oblasť skončí výnimkou, nie tichým spadnutím do prvej oblasti
     * podľa id. Práve ten tichý fallback dostal React, Docker, Backend a
     * Testing do oblasti „Marketing & SEO".
     */
    public function move(Node $node, string $areaName, ?string $departmentName = null): Node
    {
        $area = $this->requireArea($areaName);

        $department = blank($departmentName)
            ? null
            : $this->requireDepartment($area, (string) $departmentName);

        $node->area_id = $area->id;
        $node->department_id = $department?->id;
        $node->save();

        $fresh = $node->fresh();
        MindPulse::dispatch('node.updated', ['node' => $fresh->toApi()]);

        return $fresh;
    }

    /**
     * A4 — vratné zmazanie uzla.
     *
     * Náhrobok je nutný, nie kozmetika: bez neho by najbližší ingest ten istý
     * external_key znovu adoptoval a odpadový uzol by sa vrátil (TranscriptIngest,
     * ClaudeMemoryIngest aj BrainSync sa na tombstones pýtajú). Samotný stĺpec
     * external_key uvoľní model v `deleting` hooku, lebo je unique.
     */
    public function softDelete(Node $node, string $reason = 'deleted'): Node
    {
        DB::transaction(function () use ($node, $reason): void {
            if ($node->external_key) {
                Tombstone::firstOrCreate(
                    ['external_key' => $node->external_key],
                    ['reason' => $reason, 'created_at' => now()],
                );
            }

            $node->delete();
        });

        MindPulse::dispatch('node.deleted', ['node_id' => $node->id]);

        return $node;
    }

    /**
     * A4 — návrat soft-zmazaného uzla vrátane jeho náhrobku a external_key.
     * Hrany zostali nedotknuté, takže uzol sa vráti aj s väzbami.
     */
    public function restoreNode(Node $node): Node
    {
        DB::transaction(function () use ($node): void {
            $key = $node->meta['released_external_key'] ?? null;

            if ($key) {
                Tombstone::where('external_key', $key)->delete();
            }

            $node->restore();
        });

        $fresh = $node->fresh();
        MindPulse::dispatch('node.updated', ['node' => $fresh->toApi()]);

        return $fresh;
    }

    /**
     * Meno oblasti/oddelenia na porovnávací tvar: entity → znaky, diakritika →
     * ASCII (cez {@see fold()}), viacnásobné medzery na jednu. Vďaka tomu sedí
     * „Vyvoj  &amp;  kod" na „Vývoj & kód".
     */
    protected function foldName(string $name): string
    {
        $folded = $this->fold($this->decodeEntities($name));

        return trim((string) preg_replace('/\s+/u', ' ', $folded));
    }

    /**
     * `&amp;` → `&`. Payload z MCP klienta občas príde HTML-escapovaný a v sieti
     * sú po tom dvojice líšiace sa len entitou („Reporting &amp; dataviz").
     */
    protected function decodeEntities(string $value): string
    {
        return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }

    /** Prísne rozlíšenie oblasti podľa mena alebo slugu — bez fallbacku. */
    protected function requireArea(string $name): Area
    {
        $normalized = mb_strtolower(trim($name));

        $area = Area::all()->first(
            fn (Area $a) => mb_strtolower($a->name) === $normalized || $a->slug === $normalized
        );

        if (! $area) {
            throw new \InvalidArgumentException(
                'Neznáma oblasť: '.$name.'. Dostupné: '.Area::orderBy('id')->pluck('name')->implode(', ')
            );
        }

        return $area;
    }

    /**
     * Prísne rozlíšenie oddelenia v rámci oblasti — nové sa tu NEVYTVÁRA.
     *
     * Pozn.: oddelenia pomenované po docker worktree priečinkoch
     * („Záznamy — agitated-galileo-3261ac") nevyrobil resolveDepartment(), ale
     * TranscriptIngestService::classify() vlastným Department::firstOrCreate.
     * Rovnako tvorí oddelenia ďalších sedem miest (BrainSyncService,
     * ClaudeMemoryIngestService, MindDigest, MindReorganize, MindSeedSkills,
     * StructureController) — všetky mimo MindService.
     */
    protected function requireDepartment(Area $area, string $name): Department
    {
        $normalized = mb_strtolower(trim($name));

        $department = $area->departments->first(
            fn (Department $d) => mb_strtolower($d->name) === $normalized || $d->slug === $normalized
        );

        if (! $department) {
            throw new \InvalidArgumentException(
                'Neznáme oddelenie v oblasti '.$area->name.': '.$name
                .'. Dostupné: '.$area->departments->pluck('name')->implode(', ')
            );
        }

        return $department;
    }

    /**
     * Rozlíšenie oblasti pri učení. Oblasti sú pevná, seedovaná pätica — nikdy
     * sa netvoria za behu, takže neznáme meno je vždy chyba volajúceho.
     *
     * Predtým tu bol `?? Area::orderBy('id')->firstOrFail()`: každý preklep
     * ticho spadol do oblasti s id 1 a mind_learn vrátil „created". Presne tak
     * skončili React, Docker, Backend, Testing a Accessibility v „Marketing &
     * SEO" — a s nimi aj oddelenia, ktoré sa v tej nesprávnej oblasti museli
     * dovytvoriť (`Aplikácie`, `Knižnica`). Tichý fallback teda nerobil bordel
     * len v oblastiach, ale vyrábal aj duplicitné oddelenia.
     *
     * Poradie: presné meno/slug → fold (diakritika, entity) → jednoznačná
     * podreťazcová zhoda. Až keď nesedí nič, letí výnimka so zoznamom oblastí;
     * McpController ju zabalí do `isError` odpovede, takže session dostane
     * čitateľnú chybu, nie spadnutý nástroj.
     *
     * @throws \InvalidArgumentException neznáme alebo nejednoznačné meno
     */
    protected function resolveArea(string $name): Area
    {
        $areas = Area::orderBy('id')->get();

        // Prázdna oblasť nie je preklep, ale „volajúci ju neuviedol": POST
        // /api/knowledge má `area` nullable a posiela ''. Doterajšie správanie
        // (prvá oblasť podľa id) tu ostáva zámerne — len už nie ako náhoda
        // str_contains($x, ''), ktorý je vždy true, ale ako popísané pravidlo.
        if (blank(trim($name))) {
            return $areas->firstOrFail();
        }

        $normalized = mb_strtolower(trim($name));

        $exact = $areas->first(
            fn (Area $a) => mb_strtolower($a->name) === $normalized || $a->slug === $normalized
        );

        if ($exact) {
            return $exact;
        }

        // fold zvládne aj „Vyvoj & kod" (bez diakritiky) aj „Vývoj &amp; kód"
        // (entita z JSON payloadu) — oboje sedí na existujúcu oblasť, takže
        // nemá padať. Slug pokryje „vyvoj-kod".
        $folded = $this->foldName($name);
        $slug = Str::slug($this->decodeEntities($name));

        $loose = $areas->first(
            fn (Area $a) => $this->foldName($a->name) === $folded
                || ($slug !== '' && $a->slug === $slug)
        );

        if ($loose) {
            return $loose;
        }

        // Skratky ako „Vývoj" alebo „SEO" mierili doteraz správne a nemá zmysel
        // ich rozbiť — ale len kým je zhoda jediná. Viac kandidátov znamenalo
        // „prvý podľa id", čo je ten istý tichý omyl v malom.
        $candidates = $areas->filter(function (Area $a) use ($folded) {
            $areaFolded = $this->foldName($a->name);

            return str_contains($areaFolded, $folded) || str_contains($folded, $areaFolded);
        })->values();

        if ($candidates->count() === 1) {
            return $candidates->first();
        }

        if ($candidates->count() > 1) {
            throw new \InvalidArgumentException(
                'Nejednoznačná oblasť: '.$name.'. Sedí na: '.$candidates->pluck('name')->implode(', ')
                .'. Použi presný názov.'
            );
        }

        throw new \InvalidArgumentException(
            'Neznáma oblasť: '.$name.'. Dostupné: '.$areas->pluck('name')->implode(', ')
            .'. Oblasti sa učením nevytvárajú — over si ich cez mind_overview.'
        );
    }

    /**
     * Rozlíšenie oddelenia pri učení. Na rozdiel od oblastí sa oddelenie smie
     * vytvoriť: taxonómia oddelení zámerne rastie (33/44/23 na oblasť) a toto
     * je jediná cesta, ktorou ho session vie pridať. Prísna verzia by rast
     * zastavila a proti citovanému odpadu by nepomohla — `Záznamy — <worktree>`
     * netvorí tento kód, ale TranscriptIngestService::classify()
     * (Department::firstOrCreate, mimo MindService).
     *
     * Čo sa tu naopak sprísnilo, je hľadanie existujúceho: predtým iba presné
     * `mb_strtolower(name)`, takže „aplikacie", „Aplikácie " či
     * „Reporting &amp; dataviz" vyrobili dvojča k už existujúcemu oddeleniu.
     * Teraz sa pred vytvorením skúša aj slug a fold.
     *
     * Či oddelenie vzniklo, si volajúci prečíta z `wasRecentlyCreated`.
     */
    protected function resolveDepartment(Area $area, string $name): Department
    {
        $normalized = mb_strtolower(trim($name));
        $decoded = trim($this->decodeEntities($name));
        $folded = $this->foldName($name);
        $slug = Str::slug($decoded);

        $existing = $area->departments->first(
            fn (Department $d) => mb_strtolower($d->name) === $normalized
                || $this->foldName($d->name) === $folded
                || ($slug !== '' && $d->slug === $slug)
        );

        if ($existing) {
            return $existing;
        }

        $department = $area->departments()->create([
            'name' => $decoded !== '' ? $decoded : trim($name),
            'slug' => $slug !== '' ? $slug : Str::slug($name),
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
