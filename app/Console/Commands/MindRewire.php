<?php

namespace App\Console\Commands;

use App\Models\Edge;
use App\Models\Node;
use App\Services\EmbeddingSimilarity;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

/**
 * A3 — backfill similarity synapsií naprieč celou sieťou (TF-IDF kosínus).
 * Idempotentné: prepája len páry, ktoré ešte hranu nemajú. Prah 0.20.
 *
 * A4 — cross-project cez skill: pre session záznamy doplní chýbajúce
 * skill_mention synapsie (ich zdieľané skilly sú nepriamym mostom medzi
 * projektmi). Text sa berie z uloženého meta (prompts + final). Zhoda skillu
 * sa hľadá tokenizovane (prienik distinktívnych tokenov labelu s tokenmi textu),
 * nie doslovným výskytom celej frázy — inak sa viacslovný label v texte nikdy
 * netrafí. Už existujúce slabšie hrany (co_activation/similarity) sa pri zmienke
 * povýšia na skill_mention (connect() posunie kind na vyšší rank bez straty váhy).
 *
 * A5 — cross-domain mosty z tokenov labelu: dvojice skill/project/claude-memory
 * uzlov mimo rovnakého oddelenia, ktoré zdieľajú >=2 distinktívne tokeny labelu,
 * sa prepoja slabou similarity synapsiou (label-only → vysoká presnosť). Spája
 * napr. cenotvorbu so 'Cost-plus jewelry pricing', claude-memory záznamy k ich
 * projektom a Banner Studio varianty naprieč oddeleniami.
 *
 * A6 — sémantické klastre hviezdicou: doménové rodiny, ktoré zdieľajú len JEDEN
 * silný tag token (celá e-shop rodina má spoločné iba 'eshop', preto ich A5 s
 * prahom 2 tokenov aj seed v rámci oddelenia minie), sa zviažu do čitateľnej
 * hviezdy okolo huba (napr. 'Eshop ekosystém — mapa'). Plus explicitný most
 * medzi hubmi príbuzných klastrov (pricing ↔ eshop). Lineárny počet hrán
 * (n-1 na klaster), nie hairball.
 *
 * A7 — session/pamäť → jej projekt: memory uzol s meta.project sa priamo zviaže
 * s projektovým uzlom rovnakého názvu (nepriamu co-aktiváciu tým doplní o
 * explicitnú štrukturálnu väzbu záznam→projekt).
 *
 * A8 — vnútro-oddelenské soft-linky hviezdou: oddelenie s DEPT_STAR_MIN..
 * DEPT_STAR_MAX skill/project uzlami dostane hub (agregačný/„mapa/systém" uzol,
 * inak najsilnejší) a každý ostatný člen sa naň naviaže. Rieši riedke oddelenia
 * (napr. dept s 0/6 vnútornými hranami) čitateľnou hviezdou namiesto náhodných
 * nití. A5 zámerne preskakuje rovnaké oddelenie — túto medzeru dopĺňa práve A8.
 * Lineárny počet hrán (n-1 na oddelenie), idempotentné, kind 'similarity'.
 *
 * A11 — sémantika hrán do stĺpca 'relation' (aditívne, popri kind/weight).
 * Doplní hranám vzťahové označenie tam, kde ešte nie je nastavené: session
 * záznam ↔ skill = 'uses' (záznam ten skill použil), člen (skill/project) ↔ jeho
 * agregačný „mapa/ekosystém/systém" hub = 'part_of'. Mení výhradne stĺpec
 * relation (nikdy nie kind/weight/auto) a len keď je null (idempotentné). Celý
 * krok je strážený Schema::hasColumn('edges','relation') — kým stĺpec v schéme
 * nie je, backfill sa ticho preskočí, takže rewire ostáva spätne kompatibilný.
 *
 * A12 — vektorové prewiring z `node_embeddings`. A3 páruje TF-IDF kosínusom,
 * takže trafí uzly, ktoré používajú TIE ISTÉ slová; vektor trafí uzly o tej istej
 * veci pomenované INAK — presne tá medzera, pre ktorú v Hadesovi vôbec existuje
 * semantický recall. Kosínus tento príkaz nepočíta: robí ho EmbeddingService
 * cez EmbeddingSimilarity (model+dimenzia, soft-delete, deterministické poradie).
 * Vetva je za konfiguračným prepínačom `hades.embeddings.prewire` a keď nie sú
 * vektory (vypnuté embeddingy / prázdna tabuľka), preskočí sa ticho.
 *
 * `--dry-run` je MERANIE, nie rewire: nič nezapíše a vypíše, koľko párov navrhne
 * vektorová vetva nad tým, čo nájde TF-IDF, a naopak — plus vzorku s labelmi a
 * podobnosťou na ručné posúdenie. Preto v tomto režime nebeží ani jeden zo
 * zapisujúcich krokov: rewire, ktorý „len aby zmeral" prepojí pol grafu, by
 * meranie znehodnotil hneď prvým behom (druhý by už nemal čo pridať).
 */
class MindRewire extends Command
{
    /** Strop nových skill_mention hrán na jeden session záznam (parita s ingestom). */
    protected const MAX_NEW_MENTIONS = 5;

    /** Strop nových cross-domain mostov na jeden uzol (bráni hairballu okolo hubov). */
    protected const MAX_BRIDGES_PER_NODE = 6;

    /**
     * A3 — koľko TF-IDF susedov na uzol a od akej podobnosti. Konštanty preto,
     * že tie isté hodnoty používa aj porovnanie v `--dry-run`; keby si ich
     * meranie skopírovalo, po ďalšej zmene prahu by hlásilo staré čísla.
     */
    protected const SIM_TOP_K = 3;

    protected const SIM_MIN = 0.20;

    /**
     * A12 — strop nových vektorových synapsií na jeden uzol. Nižší než pri A5,
     * lebo vektorový sused je tesnejší a hub (napr. „Eshop ekosystém — mapa") má
     * vysokú podobnosť s celou svojou rodinou naraz: bez stropu by okolo neho
     * vznikla hviezda, ktorú tam už A6 nakreslila raz.
     */
    protected const MAX_VECTOR_LINKS_PER_NODE = 3;

    /**
     * A6 sémantické klastre. 'tag' = kanonizovaný token labelu, ktorý definuje
     * doménovú rodinu; 'hub' = zoznam hint tokenov na výber stredu hviezdy
     * (agregačný/„mapa/ekosystém/systém" uzol). Hviezda vznikne len od 3 členov
     * (dvojicu už zvládne A5). Tag tokeny musia byť v kanonickej podobe (pozri
     * SimilarityService::$canon — napr. e-commerce/eshop → 'eshop').
     */
    protected const CLUSTERS = [
        ['tag' => 'eshop', 'hub' => ['ecosystem', 'map']],
        ['tag' => 'pricing', 'hub' => ['stock', 'model']],
        ['tag' => 'backup', 'hub' => ['rotation', 'mariadb']],
        ['tag' => 'banner', 'hub' => ['studio', 'render']],
        // reklamná rodina naprieč oddeleniami: ADS-HIERARCHY sprinty/adaptéry
        // (dept null/31) + platformové skilly Google/Meta/LinkedIn (dept 40) —
        // spoločný kanonický tag 'ads', hub = agregačný ADS-HIERARCHY uzol.
        ['tag' => 'ads', 'hub' => ['hierarchy']],
        // SEO/analytics rodina: audit + kanál-mix skill + sprint (dept 4/40/31).
        ['tag' => 'seo', 'hub' => ['analytics', 'email']],
    ];

    /** Explicitné mosty medzi hubmi príbuzných klastrov (tag ↔ tag). */
    protected const CLUSTER_LINKS = [
        ['pricing', 'eshop'],
        // reklama a jej výkonnostné meranie patria k sebe (hub ↔ hub)
        ['ads', 'seo'],
    ];

    /** A8 — rozsah veľkosti oddelenia (skill+project) vhodného na hviezdu. */
    protected const DEPT_STAR_MIN = 3;

    protected const DEPT_STAR_MAX = 12;

    /**
     * A8 — hint tokeny na výber stredu vnútro-oddelenskej hviezdy: agregačné /
     * „mapa/ekosystém/systém/architektúra" uzly, ktoré prirodzene zastupujú
     * celé oddelenie. Kanonizované (folding) tvary, pozri SimilarityService.
     */
    protected const DEPT_HUB_HINTS = [
        'map', 'ecosystem', 'system', 'hierarchy', 'architecture', 'overview', 'dashboard', 'kit',
    ];

    protected $signature = 'mind:rewire
        {--dry-run : Nič nezapíše — len porovná TF-IDF a vektorovú vetvu a vypíše rozdiel}
        {--min= : Prah podobnosti vektorovej vetvy pri porovnaní (default = konfigurácia)}
        {--sample=20 : Koľko nových vektorových párov vypísať pri porovnaní (label ↔ label + podobnosť)}';

    protected $description = 'Backfill: doplní chýbajúce similarity, skill_mention a cross-domain mosty medzi príbuznými uzlami';

    public function handle(SimilarityService $similarity, MindService $mind, EmbeddingSimilarity $vectors): int
    {
        $nodes = Node::query()->get();
        $similarity->warmCorpus($nodes);

        if ($this->option('dry-run')) {
            return $this->compare($similarity, $vectors, $nodes);
        }

        $skills = Node::where('type', 'skill')->get(['id', 'label']);

        $simCreated = 0;
        $skillCreated = 0;
        $skillPromoted = 0;
        $checked = 0;

        foreach ($nodes as $node) {
            if ($node->type === 'core') {
                continue;
            }
            $checked++;

            // aktuálne prepojené uzly (čerstvo z DB — v tomto behu už mohli pribudnúť)
            $linkedIds = $this->linkedIds($node);

            $isSession = $node->type === 'memory' && $node->source === 'session';

            $filter = $this->similarityFilter($node, $linkedIds);

            foreach ($similarity->topSimilar($node, self::SIM_TOP_K, self::SIM_MIN, $filter) as $hit) {
                $other = Node::find($hit['node_id']);
                if (! $other) {
                    continue;
                }
                $mind->connect($node, $other, 'similarity', true, 0.5);
                $simCreated++;
            }

            // A4: over/doplň (a povýš) skill_mention synapsie pre session záznamy
            if ($isSession) {
                ['new' => $new, 'promoted' => $promoted] = $this->verifySkillMentions($node, $skills, $mind, $similarity);
                $skillCreated += $new;
                $skillPromoted += $promoted;
            }
        }

        // A5: cross-domain mosty z tokenov labelu (po similarity/skill_mention fáze)
        $bridged = $this->bridgeByLabelTokens($mind, $similarity);

        // A6: sémantické klastre hviezdicou okolo huba (single-tag rodiny)
        $clustered = $this->bridgeSemanticClusters($mind, $similarity);

        // A7: memory záznam → jeho projektový uzol (meta.project → label)
        $sessioned = $this->bridgeSessionsToProjects($mind);

        // A8: vnútro-oddelenské soft-linky hviezdou (rieši riedke oddelenia)
        $depted = $this->bridgeDepartmentStars($mind, $similarity);

        // A12: vektorové prewiring z node_embeddings (za prepínačom, ticho skip
        // keď vektory nie sú)
        $vectored = $this->bridgeByEmbeddings($mind, $vectors);

        // A11: sémantika hrán do stĺpca 'relation' (uses / part_of), aditívne.
        // Zámerne AŽ ZA A12: relácie sa dopĺňajú len hranám s relation = null,
        // takže musia bežať nad úplnou množinou hrán — inak by vektorové hrany
        // ostali bez relácie až do ďalšej noci.
        $relations = $this->backfillRelations($similarity);
        $relInfo = $relations['skipped']
            ? 'relácie preskočené (stĺpec chýba)'
            : "{$relations['uses']} uses + {$relations['part_of']} part_of relácií";

        $this->info("Rewire: {$checked} uzlov · {$simCreated} similarity · {$skillCreated} nových + {$skillPromoted} povýšených skill_mention · {$bridged} cross-domain · {$clustered} klastrových · {$sessioned} projekt · {$depted} oddelenských mostov · {$vectored} vektorových · {$relInfo}.");

        return self::SUCCESS;
    }

    /**
     * Filter kandidátov pre A3 (a pre jeho polovicu v `--dry-run`): vynechá seba,
     * jadro, už prepojené uzly a dvojicu session záznamov z RÔZNYCH projektov —
     * tie sa priamo nespájajú, mostom medzi nimi je zdieľaný skill (A4).
     *
     * @param  Collection<int, mixed>  $linkedIds  výstup {@see linkedIds()} (id => pozícia)
     * @return callable(Node): bool
     */
    protected function similarityFilter(Node $node, Collection $linkedIds): callable
    {
        $isSession = $node->type === 'memory' && $node->source === 'session';
        $ownProject = (string) ($node->meta['project'] ?? '');

        return function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject) {
            if ($cand->id === $node->id || $cand->type === 'core') {
                return false;
            }
            if ($linkedIds->has($cand->id)) {
                return false;
            }
            if ($isSession && $cand->type === 'memory' && $cand->source === 'session') {
                if ((string) ($cand->meta['project'] ?? '') !== $ownProject) {
                    return false;
                }
            }

            return true;
        };
    }

    /** Množina id uzlov, s ktorými má $node hranu (bez seba). */
    protected function linkedIds(Node $node): Collection
    {
        return Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->flip();
    }

    /**
     * Doplní/povýši skill_mention hrany pre session záznam. Skill sa považuje za
     * zmienený, ak sa distinktívne tokeny jeho labelu (>=4 znaky) prekrývajú s
     * tokenmi textu (prompts + final): >=2 zhody, alebo jednoslovný proper-noun
     * skill (napr. MariaDB, Figma) plne prítomný. Zhoda je tokenizovaná rovnako
     * ako labely — doslovný výskyt viacslovnej frázy sa v texte nikdy netrafí.
     *
     * Nová hrana: kind skill_mention, strop MAX_NEW_MENTIONS na záznam (density
     * guard, parita s ingestom). Už existujúca slabšia hrana (co_activation/
     * similarity) sa POVÝŠI na skill_mention cez connect() (rank 2 > 1) — bez
     * stropu, lebo nezvyšuje hustotu grafu, len opravuje sémantiku. Hrana, ktorá
     * už je skill_mention/manual, sa nechá tak (idempotencia — žiadny ďalší beh
     * jej znova nezvýši váhu).
     *
     * @param  Collection<int, Node>  $skills
     * @return array{new: int, promoted: int}
     */
    protected function verifySkillMentions(Node $node, Collection $skills, MindService $mind, SimilarityService $similarity): array
    {
        $meta = is_array($node->meta) ? $node->meta : [];
        $prompts = array_filter((array) ($meta['prompts'] ?? []), 'is_string');
        $raw = implode(' ', $prompts).' '.(string) ($meta['final'] ?? '');
        if (trim($raw) === '') {
            return ['new' => 0, 'promoted' => 0];
        }

        // tokeny textu — rovnaká tokenizácia (folding + stopslová) ako pri labeloch
        $textSet = array_flip(array_keys($similarity->tokenize($raw)));
        if ($textSet === []) {
            return ['new' => 0, 'promoted' => 0];
        }

        // aktuálne hrany uzla aj s ich kind — rozlišujeme nový link vs. povýšenie
        $edgeKinds = $this->edgeKinds($node);

        // strop je TOTAL, nie per-beh: rátaj už existujúce skill_mention hrany,
        // aby opakovaný beh nedopĺňal ďalších 5 donekonečna (idempotencia)
        $existingMentions = count(array_filter($edgeKinds, fn ($k) => $k === 'skill_mention'));
        $budget = max(0, self::MAX_NEW_MENTIONS - $existingMentions);

        $new = 0;
        $promoted = 0;

        foreach ($skills as $skill) {
            if ($skill->id === $node->id) {
                continue;
            }

            $labelTokens = array_values(array_filter(
                array_keys($similarity->tokenize((string) $skill->label)),
                fn ($t) => mb_strlen($t) >= 4,
            ));
            if ($labelTokens === []) {
                continue;
            }

            $matched = array_values(array_filter($labelTokens, fn ($t) => isset($textSet[$t])));
            $mention = count($matched) >= 2
                || (count($labelTokens) <= 1 && count($matched) >= 1 && mb_strlen($matched[0]) >= 5);
            if (! $mention) {
                continue;
            }

            $existingKind = $edgeKinds[$skill->id] ?? null;

            if ($existingKind === null) {
                if ($new >= $budget) {
                    continue;
                }
                $mind->connect($node, $skill, 'skill_mention', true);
                $edgeKinds[$skill->id] = 'skill_mention';
                $new++;

                continue;
            }

            // povýš len slabšie väzby; skill_mention/manual (rovnaký/vyšší rank)
            // sa nechajú tak, aby opakovaný beh neinkrementoval váhu
            if (in_array($existingKind, ['similarity', 'co_activation'], true)) {
                $mind->connect($node, $skill, 'skill_mention', true);
                $edgeKinds[$skill->id] = 'skill_mention';
                $promoted++;
            }
        }

        return ['new' => $new, 'promoted' => $promoted];
    }

    /**
     * Cross-domain mosty z tokenov labelu. Dvojice skill/project/claude-memory
     * uzlov, ktoré NIE sú v rovnakom oddelení (to už spája seed/klaster) a
     * zdieľajú aspoň 2 distinktívne tokeny labelu (>=4 znaky), sa prepoja slabou
     * similarity synapsiou. Match je label-only (bez description) → vysoká
     * presnosť bez šumu z dlhých popisov.
     *
     * Idempotentné: preskakuje už prepojené páry (žiadna zmena kind/váhy na
     * existujúcich hranách); nové hrany sa pri opätovnom behu preskočia. Per-uzol
     * strop MAX_BRIDGES_PER_NODE bráni hairballu okolo hubov. Poradie je
     * deterministické (podľa id).
     */
    protected function bridgeByLabelTokens(MindService $mind, SimilarityService $similarity): int
    {
        $nodes = Node::query()
            ->where(function ($q) {
                $q->whereIn('type', ['skill', 'project'])
                    ->orWhere(function ($q2) {
                        $q2->where('type', 'memory')->where('source', 'claude-memory');
                    });
            })
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'department_id']);

        // distinktívne tokeny labelu (>=4 znaky) pre každý uzol
        $tokens = [];
        foreach ($nodes as $n) {
            $tokens[$n->id] = array_values(array_filter(
                array_keys($similarity->tokenize((string) $n->label)),
                fn ($t) => mb_strlen($t) >= 4,
            ));
        }

        // množina už existujúcich hrán (kanonické source<target páry)
        $linked = [];
        foreach (Edge::query()->get(['source_id', 'target_id']) as $e) {
            $linked[$e->source_id.':'.$e->target_id] = true;
        }

        $newDegree = [];
        $created = 0;
        $list = $nodes->values();
        $count = $list->count();

        for ($i = 0; $i < $count; $i++) {
            $a = $list[$i];
            for ($j = $i + 1; $j < $count; $j++) {
                $b = $list[$j];

                // most je cross-domain — rovnaké oddelenie už spája seed/klaster
                if ($a->department_id && $b->department_id && $a->department_id === $b->department_id) {
                    continue;
                }
                if (count(array_intersect($tokens[$a->id], $tokens[$b->id])) < 2) {
                    continue;
                }

                [$s, $t] = $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];
                if (isset($linked[$s.':'.$t])) {
                    continue;
                }
                if (($newDegree[$a->id] ?? 0) >= self::MAX_BRIDGES_PER_NODE
                    || ($newDegree[$b->id] ?? 0) >= self::MAX_BRIDGES_PER_NODE) {
                    continue;
                }

                $mind->connect($a, $b, 'similarity', true, 0.5);
                $linked[$s.':'.$t] = true;
                $newDegree[$a->id] = ($newDegree[$a->id] ?? 0) + 1;
                $newDegree[$b->id] = ($newDegree[$b->id] ?? 0) + 1;
                $created++;
            }
        }

        return $created;
    }

    /**
     * A6 — sémantické klastre hviezdicou. Pre každý tag z self::CLUSTERS
     * pozbiera členov (uzol, ktorého kanonizované tokeny labelu obsahujú tag),
     * vyberie hub a spojí každého člena s hubom (hviezda = n-1 hrán, žiadny
     * kvadratický hairball). Nakoniec doplní mosty medzi hubmi príbuzných
     * klastrov (self::CLUSTER_LINKS, napr. pricing ↔ eshop).
     *
     * Idempotentné: pracuje nad množinou už existujúcich hrán a vytvára len
     * chýbajúce páry (existujúce sa nedotknú — žiadny drift kind/váhy). Kind
     * 'similarity', počiatočná váha 0.5.
     */
    protected function bridgeSemanticClusters(MindService $mind, SimilarityService $similarity): int
    {
        $nodes = Node::query()
            ->whereIn('type', ['skill', 'project', 'memory'])
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'strength']);

        // kanonizované tokeny labelu (bez dĺžkového filtra — tag je kanonický term)
        $tokens = [];
        foreach ($nodes as $n) {
            $tokens[$n->id] = array_keys($similarity->tokenize((string) $n->label));
        }

        $linked = $this->linkedPairs();

        $created = 0;
        $hubs = []; // tag => hub Node (pre cross-cluster mosty)

        foreach (self::CLUSTERS as $cluster) {
            $tag = $cluster['tag'];
            $members = $nodes->filter(fn (Node $n) => in_array($tag, $tokens[$n->id], true))->values();

            // dvojicu spoľahlivo pokryje A5 (2 zdieľané tokeny) — hviezda má
            // zmysel až od 3 členov, inak by hub bol umelý
            if ($members->count() < 3) {
                continue;
            }

            $hub = $this->pickHub($members, $tokens, $cluster['hub']);
            $hubs[$tag] = $hub;

            foreach ($members as $member) {
                if ($member->id === $hub->id) {
                    continue;
                }
                $created += $this->linkIfNew($mind, $hub, $member, $linked);
            }
        }

        // mosty medzi hubmi príbuzných klastrov (pricing ↔ eshop atď.)
        foreach (self::CLUSTER_LINKS as [$tagA, $tagB]) {
            if (isset($hubs[$tagA], $hubs[$tagB])) {
                $created += $this->linkIfNew($mind, $hubs[$tagA], $hubs[$tagB], $linked);
            }
        }

        return $created;
    }

    /**
     * Stred hviezdy: 1) prvý člen (v poradí id), ktorého tokeny labelu pretnú
     * hub-hinty (agregačný uzol typu mapa/ekosystém/systém); 2) inak najsilnejší
     * člen, tie-break najnižšie id (determinizmus).
     *
     * @param  Collection<int, Node>  $members
     * @param  array<int, array<int, string>>  $tokens
     * @param  array<int, string>  $hubHints
     */
    protected function pickHub(Collection $members, array $tokens, array $hubHints): Node
    {
        foreach ($members as $member) {
            if (array_intersect($hubHints, $tokens[$member->id])) {
                return $member;
            }
        }

        $best = null;
        foreach ($members as $member) {
            if ($best === null
                || (float) $member->strength > (float) $best->strength
                || ((float) $member->strength === (float) $best->strength && $member->id < $best->id)) {
                $best = $member;
            }
        }

        return $best;
    }

    /**
     * A7 — memory záznam (session/claude-memory) → jeho projektový uzol. Ak má
     * memory uzol meta.project a existuje projektový uzol rovnakého (normalizov.)
     * názvu, doplní chýbajúci most záznam→projekt. Idempotentné, kind 'similarity'.
     */
    protected function bridgeSessionsToProjects(MindService $mind): int
    {
        $projects = Node::where('type', 'project')->get(['id', 'label']);
        if ($projects->isEmpty()) {
            return 0;
        }

        $byLabel = [];
        foreach ($projects as $project) {
            $byLabel[$this->normalizeKey((string) $project->label)] = $project;
        }

        $linked = $this->linkedPairs();
        $created = 0;

        $memories = Node::where('type', 'memory')->get(['id', 'label', 'meta']);
        foreach ($memories as $memory) {
            $meta = is_array($memory->meta) ? $memory->meta : [];
            $proj = trim((string) ($meta['project'] ?? ''));
            if ($proj === '') {
                continue;
            }

            $target = $byLabel[$this->normalizeKey($proj)] ?? null;
            if (! $target || $target->id === $memory->id) {
                continue;
            }

            $created += $this->linkIfNew($mind, $memory, $target, $linked);
        }

        return $created;
    }

    /**
     * A8 — vnútro-oddelenské soft-linky hviezdou. Pre každé oddelenie s
     * DEPT_STAR_MIN..DEPT_STAR_MAX skill/project uzlami vyberie hub (agregačný
     * uzol podľa DEPT_HUB_HINTS, inak najsilnejší člen, tie-break najnižšie id)
     * a naviaže naň ostatných členov. Rieši riedke oddelenia bez zmyslupnej
     * vnútornej štruktúry (napr. 0/6 vnútorných hrán) čitateľnou hviezdou.
     *
     * Idempotentné: linkIfNew vytvára len chýbajúce páry nad snapshotom
     * existujúcich hrán; opakovaný beh nič nepridá. Kind 'similarity', váha 0.5.
     * Príliš veľké oddelenia (>DEPT_STAR_MAX) sa vynechajú — tam by hviezda
     * z jedného huba bola neúnosne hustá a významovo slabá.
     */
    protected function bridgeDepartmentStars(MindService $mind, SimilarityService $similarity): int
    {
        $nodes = Node::query()
            ->whereIn('type', ['skill', 'project'])
            ->whereNotNull('department_id')
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'department_id', 'strength']);

        // kanonizované tokeny labelu (bez dĺžkového filtra — hint je kanonický term)
        $tokens = [];
        foreach ($nodes as $n) {
            $tokens[$n->id] = array_keys($similarity->tokenize((string) $n->label));
        }

        $linked = $this->linkedPairs();
        $created = 0;

        foreach ($nodes->groupBy('department_id') as $group) {
            $members = $group->values();
            $count = $members->count();
            if ($count < self::DEPT_STAR_MIN || $count > self::DEPT_STAR_MAX) {
                continue;
            }

            $hub = $this->pickHub($members, $tokens, self::DEPT_HUB_HINTS);

            foreach ($members as $member) {
                if ($member->id === $hub->id) {
                    continue;
                }
                $created += $this->linkIfNew($mind, $hub, $member, $linked);
            }
        }

        return $created;
    }

    /**
     * A11 — doplní stĺpec 'relation' (uses / part_of) hranám, kde ešte nie je
     * nastavený. Vzťahy:
     *   - session záznam (memory, source=session) ↔ skill  → 'uses'
     *   - člen (skill/project) ↔ jeho agregačný hub (mapa/ekosystém/systém…
     *     podľa DEPT_HUB_HINTS) → 'part_of'
     *
     * Aditívne a idempotentné: mení VÝHRADNE stĺpec relation cez forceFill (kind,
     * weight ani auto sa nikdy nedotknú) a len na hranách s relation = null, takže
     * opakovaný beh nič neprepisuje a nezvyšuje váhy. Celé je strážené existenciou
     * stĺpca — kým 'relation' v schéme nie je, krok sa ticho preskočí a rewire
     * ostáva spätne kompatibilný (žiadny zápis na neexistujúci stĺpec).
     *
     * @return array{uses: int, part_of: int, skipped: bool}
     */
    protected function backfillRelations(SimilarityService $similarity): array
    {
        if (! Schema::hasColumn('edges', 'relation')) {
            return ['uses' => 0, 'part_of' => 0, 'skipped' => true];
        }

        $nodes = Node::query()->get(['id', 'type', 'source', 'label']);

        $type = [];       // id => type
        $isSession = [];  // id => bool (memory záznam zo session)
        $isHub = [];      // id => bool (agregačný „mapa/ekosystém/systém" uzol)
        foreach ($nodes as $n) {
            $type[$n->id] = $n->type;
            $isSession[$n->id] = $n->type === 'memory' && $n->source === 'session';
            $tokens = array_keys($similarity->tokenize((string) $n->label));
            $isHub[$n->id] = (bool) array_intersect(self::DEPT_HUB_HINTS, $tokens);
        }

        $uses = 0;
        $partOf = 0;

        // len hrany bez relácie — existujúce relácie sa nikdy neprepisujú
        foreach (Edge::query()->whereNull('relation')->get() as $edge) {
            $s = $edge->source_id;
            $t = $edge->target_id;
            if (! isset($type[$s], $type[$t])) {
                continue;
            }

            // session záznam ↔ skill = 'uses'
            $sessionSkill = ($isSession[$s] && $type[$t] === 'skill')
                || ($isSession[$t] && $type[$s] === 'skill');
            if ($sessionSkill) {
                $edge->forceFill(['relation' => 'uses'])->save();
                $uses++;

                continue;
            }

            // člen (skill/project) ↔ agregačný hub = 'part_of'
            // práve jeden koniec je hub, druhý je (ne-hub) skill/project
            if ($isHub[$s] !== $isHub[$t]) {
                $memberId = $isHub[$s] ? $t : $s;
                if (in_array($type[$memberId], ['skill', 'project'], true)) {
                    $edge->forceFill(['relation' => 'part_of'])->save();
                    $partOf++;
                }
            }
        }

        return ['uses' => $uses, 'part_of' => $partOf, 'skipped' => false];
    }

    /**
     * A12 — vektorové prewiring. Pre každý uzol, ktorý má vektor, doplní chýbajúce
     * synapsie k jeho najbližším vektorovým susedom. Kind 'similarity' a váha 0.5
     * ako pri ostatných automatických mostoch: je to slabá, decay-om odbúrateľná
     * väzba, nie tvrdenie o štruktúre.
     *
     * Prah je `hades.embeddings.prewire_min_similarity` (viď
     * {@see EmbeddingSimilarity::threshold()}) a je vyšší než prah recallu — hrana
     * v grafe ostáva napísaná, kandidát recallu sa v RRF prepadne.
     *
     * Vetva je za prepínačom `hades.embeddings.prewire`: default z konfigurácie
     * rozhoduje meranie (`mind:rewire --dry-run`), nie dojem. Keď sú embeddingy
     * vypnuté alebo je tabuľka prázdna, preskočí sa ticho — inak by rewire na
     * nevektorizovanej sieti prešiel celý korpus za istú nulu.
     *
     * Idempotentné: {@see linkIfNew} pracuje nad snapshotom existujúcich hrán,
     * takže druhý beh nepridá nič.
     */
    protected function bridgeByEmbeddings(MindService $mind, EmbeddingSimilarity $vectors): int
    {
        if (! config('hades.embeddings.prewire', false) || ! $vectors->available()) {
            return 0;
        }

        $linked = $this->linkedPairs();
        $created = 0;

        foreach ($this->vectorPairs($vectors, $linked) as $pair) {
            $created += $this->linkIfNew($mind, $pair['a'], $pair['b'], $linked);
        }

        return $created;
    }

    /**
     * Páry, ktoré navrhuje vektorová vetva. Zdieľa ju ŽIVÝ krok A12 aj porovnanie
     * v `--dry-run`, a to je zámer: merací kód, ktorý si formulu skopíruje, po
     * ďalšej zmene prahu meria svoju starú kópiu a hlási nezmenené čísla (tú
     * lekciu tento repozitár už zaplatil pri harnesse na kreslenie).
     *
     * Poradie je deterministické (uzly podľa id), takže sa dvojica dá reprodukovať
     * a strop na uzol je zaplatený tým istým smerom v každom behu.
     *
     * @param  array<string, true>  $linked  snapshot existujúcich hrán ('source:target')
     * @return array<int, array{a: Node, b: Node, similarity: float}>
     */
    protected function vectorPairs(EmbeddingSimilarity $vectors, array $linked, ?float $min = null): array
    {
        $nodes = Node::query()->orderBy('id')->get();
        $byId = $nodes->keyBy('id');

        $degree = [];   // id => koľko NOVÝCH vektorových hrán už uzol dostal
        $seen = [];     // kanonický pár => true (v jednom behu nikdy dvakrát)
        $pairs = [];

        foreach ($nodes as $node) {
            if ($node->type === 'core') {
                continue;
            }

            $budget = self::MAX_VECTOR_LINKS_PER_NODE - ($degree[$node->id] ?? 0);

            if ($budget < 1) {
                continue;
            }

            $filter = function (Node $cand) use ($node, $linked, &$seen, &$degree) {
                if ($cand->id === $node->id || $cand->type === 'core') {
                    return false;
                }
                if (($degree[$cand->id] ?? 0) >= self::MAX_VECTOR_LINKS_PER_NODE) {
                    return false;
                }

                $key = $this->pairKey($node->id, $cand->id);

                return ! isset($linked[$key]) && ! isset($seen[$key]);
            };

            foreach ($vectors->topSimilar($node, $budget, $min, $filter) as $hit) {
                $other = $byId[$hit['node_id']] ?? null;

                if (! $other) {
                    continue;
                }

                $seen[$this->pairKey($node->id, $other->id)] = true;
                $degree[$node->id] = ($degree[$node->id] ?? 0) + 1;
                $degree[$other->id] = ($degree[$other->id] ?? 0) + 1;

                $pairs[] = ['a' => $node, 'b' => $other, 'similarity' => (float) $hit['similarity']];
            }
        }

        return $pairs;
    }

    /**
     * Páry, ktoré navrhuje TF-IDF vetva (A3) — pre porovnanie, bez zápisu.
     *
     * Jeden rozdiel proti živému A3 treba priznať: tu sa počíta nad JEDNÝM
     * snapshotom hrán, kým živý beh vidí aj hrany, ktoré si sám o uzol vyššie
     * vytvoril. Množina je preto o vlások väčšia než to, čo A3 reálne zapíše —
     * pre porovnanie dvoch vetiev je to konzervatívne správnym smerom (TF-IDF
     * dostane výhodu, nie handicap).
     *
     * @param  Collection<int, Node>  $nodes
     * @return array<int, array{a: Node, b: Node, similarity: float}>
     */
    protected function tfidfPairs(SimilarityService $similarity, Collection $nodes, array $linked): array
    {
        $byId = $nodes->keyBy('id');
        $seen = [];
        $pairs = [];

        foreach ($nodes as $node) {
            if ($node->type === 'core') {
                continue;
            }

            $linkedIds = $this->linkedIds($node);
            $filter = $this->similarityFilter($node, $linkedIds);

            foreach ($similarity->topSimilar($node, self::SIM_TOP_K, self::SIM_MIN, $filter) as $hit) {
                $other = $byId[$hit['node_id']] ?? null;

                if (! $other) {
                    continue;
                }

                $key = $this->pairKey($node->id, $other->id);

                if (isset($linked[$key]) || isset($seen[$key])) {
                    continue;
                }

                $seen[$key] = true;
                $pairs[] = ['a' => $node, 'b' => $other, 'similarity' => (float) $hit['score']];
            }
        }

        return $pairs;
    }

    /**
     * `--dry-run` — meranie. Vypíše, koľko párov navrhne vektorová vetva a TF-IDF
     * vetva, ich prienik a oba rozdiely, plus vzorku nových vektorových párov
     * (label ↔ label + podobnosť) na ručné posúdenie „zmysel alebo šum".
     *
     * Nezapíše nič: nespúšťa ani jeden zo zapisujúcich krokov. Bez toho by prvé
     * meranie prepojilo graf a druhé by nemalo čo nájsť.
     *
     * @param  Collection<int, Node>  $nodes
     */
    protected function compare(SimilarityService $similarity, EmbeddingSimilarity $vectors, Collection $nodes): int
    {
        $linked = $this->linkedPairs();
        $min = $this->option('min') !== null ? (float) $this->option('min') : $vectors->threshold();

        $this->line('Porovnanie prewiring vetiev — nič sa nezapisuje.');
        $this->line(sprintf(
            'Uzly: %d · existujúce hrany: %d · TF-IDF prah %.2f (top %d/uzol) · vektorový prah %.2f (max %d/uzol)',
            $nodes->count(),
            count($linked),
            self::SIM_MIN,
            self::SIM_TOP_K,
            $min,
            self::MAX_VECTOR_LINKS_PER_NODE,
        ));

        if (! $vectors->available()) {
            $this->warn('Vektorová vetva nie je k dispozícii (vypnuté embeddingy alebo prázdna tabuľka) — porovnávať sa nedá.');

            return self::SUCCESS;
        }

        $vectorPairs = $this->vectorPairs($vectors, $linked, $min);
        $tfidfPairs = $this->tfidfPairs($similarity, $nodes, $linked);

        $vectorKeys = [];
        foreach ($vectorPairs as $pair) {
            $vectorKeys[$this->pairKey($pair['a']->id, $pair['b']->id)] = $pair;
        }

        $tfidfKeys = [];
        foreach ($tfidfPairs as $pair) {
            $tfidfKeys[$this->pairKey($pair['a']->id, $pair['b']->id)] = $pair;
        }

        $onlyVector = array_diff_key($vectorKeys, $tfidfKeys);
        $onlyTfidf = array_diff_key($tfidfKeys, $vectorKeys);
        $both = array_intersect_key($vectorKeys, $tfidfKeys);

        $this->newLine();
        $this->line('vektor celkom:      '.count($vectorKeys));
        $this->line('TF-IDF celkom:      '.count($tfidfKeys));
        $this->line('prienik:            '.count($both));
        $this->line('|vektor \\ TF-IDF|:  '.count($onlyVector));
        $this->line('|TF-IDF \\ vektor|:  '.count($onlyTfidf));

        // vzorka sa radí podľa podobnosti zostupne — posudzuje sa to, čo by vetva
        // zapísala najsuverénnejšie; keby bol šum tam, nižšie už nemá čo zachraňovať
        $sample = array_values($onlyVector);
        usort($sample, fn ($x, $y) => $y['similarity'] <=> $x['similarity'] ?: $x['a']->id <=> $y['a']->id);
        $sample = array_slice($sample, 0, max(0, (int) $this->option('sample')));

        if ($sample !== []) {
            $this->newLine();
            $this->line('Vzorka párov, ktoré nájde LEN vektorová vetva:');

            foreach ($sample as $pair) {
                $this->line(sprintf(
                    '  %.4f  [%d %s] %s  ↔  [%d %s] %s',
                    $pair['similarity'],
                    $pair['a']->id,
                    $pair['a']->type,
                    (string) $pair['a']->label,
                    $pair['b']->id,
                    $pair['b']->type,
                    (string) $pair['b']->label,
                ));
            }
        }

        return self::SUCCESS;
    }

    /** Kanonický kľúč páru (menšie id vľavo) — hrana je neorientovaná. */
    protected function pairKey(int $a, int $b): string
    {
        return $a < $b ? $a.':'.$b : $b.':'.$a;
    }

    /** Množina existujúcich hrán ako kanonické 'source:target' kľúče. */
    protected function linkedPairs(): array
    {
        $linked = [];
        foreach (Edge::query()->get(['source_id', 'target_id']) as $e) {
            $linked[$e->source_id.':'.$e->target_id] = true;
        }

        return $linked;
    }

    /**
     * Spojí dvojicu slabou similarity synapsiou len ak ešte hranu nemá (a zapíše
     * ju do $linked, aby ju ďalší člen hviezdy nezaložil dvakrát). Vráti 1/0.
     */
    protected function linkIfNew(MindService $mind, Node $a, Node $b, array &$linked): int
    {
        if ($a->id === $b->id) {
            return 0;
        }

        [$s, $t] = $a->id < $b->id ? [$a->id, $b->id] : [$b->id, $a->id];
        if (isset($linked[$s.':'.$t])) {
            return 0;
        }

        $mind->connect($a, $b, 'similarity', true, 0.5);
        $linked[$s.':'.$t] = true;

        return 1;
    }

    /** Normalizácia názvu na porovnávací kľúč: lowercase, len [a-z0-9]. */
    protected function normalizeKey(string $s): string
    {
        return (string) preg_replace('/[^a-z0-9]+/', '', mb_strtolower(trim($s)));
    }

    /**
     * Mapa id-suseda => kind hrany pre daný uzol (obojsmerne).
     *
     * @return array<int, string>
     */
    protected function edgeKinds(Node $node): array
    {
        $map = [];
        $edges = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id', 'kind']);

        foreach ($edges as $e) {
            $other = $e->source_id === $node->id ? $e->target_id : $e->source_id;
            $map[$other] = $e->kind;
        }

        return $map;
    }
}
