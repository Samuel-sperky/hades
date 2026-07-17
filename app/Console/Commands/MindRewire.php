<?php

namespace App\Console\Commands;

use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;

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
 */
class MindRewire extends Command
{
    /** Strop nových skill_mention hrán na jeden session záznam (parita s ingestom). */
    protected const MAX_NEW_MENTIONS = 5;

    /** Strop nových cross-domain mostov na jeden uzol (bráni hairballu okolo hubov). */
    protected const MAX_BRIDGES_PER_NODE = 6;

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

    protected $signature = 'mind:rewire';

    protected $description = 'Backfill: doplní chýbajúce similarity, skill_mention a cross-domain mosty medzi príbuznými uzlami';

    public function handle(SimilarityService $similarity, MindService $mind): int
    {
        $nodes = Node::query()->get();
        $similarity->warmCorpus($nodes);

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
            $ownProject = (string) ($node->meta['project'] ?? '');

            $filter = function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject) {
                if ($cand->id === $node->id || $cand->type === 'core') {
                    return false;
                }
                if ($linkedIds->has($cand->id)) {
                    return false;
                }
                // A4: dva session záznamy rôznych projektov sa priamo nespájajú
                if ($isSession && $cand->type === 'memory' && $cand->source === 'session') {
                    if ((string) ($cand->meta['project'] ?? '') !== $ownProject) {
                        return false;
                    }
                }

                return true;
            };

            foreach ($similarity->topSimilar($node, 3, 0.20, $filter) as $hit) {
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

        $this->info("Rewire: {$checked} uzlov · {$simCreated} similarity · {$skillCreated} nových + {$skillPromoted} povýšených skill_mention · {$bridged} cross-domain · {$clustered} klastrových · {$sessioned} projekt · {$depted} oddelenských mostov.");

        return self::SUCCESS;
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
     * @param  \Illuminate\Support\Collection<int, Node>  $members
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
