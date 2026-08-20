<?php

namespace App\Console\Commands;

use App\Models\Edge;
use App\Models\Node;
use App\Services\EmbeddingService;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

/**
 * A3 — backfill similarity synapsií naprieč celou sieťou (TF-IDF kosínus).
 * Idempotentné: prepája len páry, ktoré ešte hranu nemajú. Prah 0.20.
 *
 * A3b (20. 8. 2026) — `--vector`: ten istý krok z hotových bge-m3 embeddingov
 * namiesto TF-IDF. Vektorová cesta prečíta 2 674 blobov RAZ, rozbalí ich po
 * dlaždiciach a spočíta 3 573 801 kosínov v pamäti: **31,5 s a špička 106 MB**
 * na celú sieť.
 *
 * Dôvod, prečo `--vector` vzniklo, medzitým z TF-IDF cesty vypadol. Tá bola
 * O(n²) NAD DATABÁZOU — `topSimilar()` volal `Node::find()` na každého kandidáta,
 * pri 2 680 uzloch ~7 miliónov dopytov: 22,2 s / 196 uzlov, 90,4 s / 396 uzlov,
 * exponent log(4,07)/log(2,02) = 1,99, extrapolovane ~69 min na celú sieť.
 * Odvtedy si `warmCorpus()` drží načítané modely v mape a `topSimilar()` číta
 * z nej (SimilarityService::$nodes), takže v smyčke nie je ani jeden dopyt.
 * Namerané na tej istej 396-uzlovej podmnožine: 154,6 s → 2,4 s pri nezmenenom
 * počte hrán, a celý živý beh **113,8 s a špička 63,0 MB** na 2 690 uzloch.
 *
 * Kvadratická ostáva — 3,6 milióna kosínov sa nespočíta zadarmo — ale je to už
 * len aritmetika v pamäti. `--vector` je stále ~3,6× rýchlejšie a pre nočný beh
 * preferované; TF-IDF ako záchranná sieť je po tejto oprave únosná aj sama.
 *
 * Prah nesie hustotu, nie rýchlosť: nad 0,70 je v celom korpuse len 2 950 párov
 * (0,08 % všetkých), nad 0,65 už 8 403 — a to je približne toľko, koľko má sieť
 * hrán dnes. Ten druhý prah by ju zdvojnásobil šumom.
 *
 * `--vector` je opt-in a mlčky padá späť: vypnuté `hades.embeddings.enabled`,
 * prázdna tabuľka `node_embeddings` alebo uzol bez vektora znamenajú TF-IDF
 * cestu a beh je znak na znak ten istý ako predtým. `mind:rewire` chodí nočným
 * plánovačom nad živou pamäťou — nevektorizovaný korpus nesmie znamenať, že
 * sieť príde o backfill.
 *
 * Krok NEkonverguje na jeden beh a nikdy nekonvergoval: berie 3 najlepších
 * NEPREPOJENÝCH susedov, takže druhý beh dosype tých, ktorých prvý vytlačil.
 * Namerané na 400-uzlovej podmnožine: 118 → 14 → 0 → 0. Stropom je počet párov
 * nad prahom, nie počet behov.
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
 */
class MindRewire extends Command
{
    /** Strop nových skill_mention hrán na jeden session záznam (parita s ingestom). */
    protected const MAX_NEW_MENTIONS = 5;

    /** Koľko similarity susedov si A3 vezme na uzol. */
    protected const SIM_PER_NODE = 3;

    /** Prah TF-IDF kosínusu pre A3 — pôvodná hodnota, nemeniť bez novej vzorky. */
    protected const TFIDF_FLOOR = 0.20;

    /**
     * Prah kosínusu pre vektorovú cestu. NIE je to prepočítaná 0.20 — je to iné
     * číslo na inej stupnici. TF-IDF nad riedkymi vektormi dáva príbuzným uzlom
     * 0,15–0,30, bge-m3 nad hustými 0,60–0,86 a dvojica bez akéhokoľvek vzťahu
     * tam ešte drží ~0,55. Prepočítať jedno na druhé sa nedá.
     *
     * 0,70 padlo z ručne prejdenej vzorky 19 uzlov naprieč typmi a oblasťami
     * (top-5 TF-IDF vedľa top-5 vektorových susedov, 20. 8. 2026): nad 0,70 bolo
     * 23 z 24 párov také, ktoré človek nazve príbuznými. V pásme 0,65–0,70 to
     * padne na ~dve tretiny a kandidátov je trojnásobok — a práve to pásmo robí
     * z tejto siete chumáč, na ktorý existuje `mind:prune-coactivation`. Bývajú
     * v ňom páry z tej istej tematickej štvrti bez akéhokoľvek vzťahu:
     * „Aura Takt — osobné stránky" ↔ „Report Ovládač zliav" (0,691),
     * „Config a route cache deploy" ↔ „Laravel backend" (0,646).
     */
    protected const VECTOR_FLOOR = 0.70;

    /**
     * Koľko vektorových susedov si na uzol odložiť pred výberom. Berú sa najlepší
     * SIM_PER_NODE NEPREPOJENÍ, takže zoznam musí uniesť aj hub, ktorému už
     * niekoľko najbližších susedov hranu má — inak by dostal menej hrán než mu
     * TF-IDF cesta dá, a porovnanie oboch ciest by nemeralo to isté.
     */
    protected const VECTOR_CANDIDATES = 12;

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

    protected $signature = 'mind:rewire
        {--vector : Similarity krok (A3) počítať z hotových embeddingov namiesto TF-IDF; keď vektory nie sú, mlčky sa použije TF-IDF}
        {--dry-run : Nič nezapisovať — len spočítať, koľko similarity hrán BY vzniklo. Kroky A4–A11 sa preskočia}
        {--floor= : Prah kosínusu pre similarity krok (default 0.20 TF-IDF, 0.70 vektory). Uplatní sa na cestu, ktorá naozaj pobehne — vypísaný riadok „Similarity krok" hovorí ktorá a s akým prahom}';

    protected $description = 'Backfill: doplní chýbajúce similarity, skill_mention a cross-domain mosty medzi príbuznými uzlami';

    public function handle(SimilarityService $similarity, MindService $mind, EmbeddingService $embeddings): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $nodes = Node::query()->get();

        // Vektorová cesta je opt-in a smie zlyhať doticha — plán null znamená
        // „rob to presne ako predtým".
        $floorOption = $this->option('floor');
        $vectorPlan = null;
        $floor = self::TFIDF_FLOOR;

        // Meria sa CELÝ similarity krok, teda aj príprava (warmCorpus / načítanie
        // vektorov a all-pairs kosínus). Prvá verzia tohto merania spúšťala stopky
        // až za prípravou a hlásila 2,1 s na behu, ktorý trval 39 — všetka práca
        // vektorovej cesty je práve v tej príprave.
        $simStarted = microtime(true);

        if ($this->option('vector')) {
            $floor = $floorOption === null ? self::VECTOR_FLOOR : (float) $floorOption;
            $vectorPlan = $this->vectorNeighbourPlan($nodes, $similarity, $embeddings, $floor);
        }

        if ($vectorPlan === null) {
            $floor = $floorOption === null ? self::TFIDF_FLOOR : (float) $floorOption;
            $similarity->warmCorpus($nodes);
        }

        $byId = $nodes->keyBy('id');
        $skills = Node::where('type', 'skill')->get(['id', 'label']);

        $simCreated = 0;
        $skillCreated = 0;
        $skillPromoted = 0;
        $checked = 0;

        // Páry navrhnuté v TOMTO behu — vedie sa LEN v dry-run. V zápisovom režime
        // je autorita databáza: `linkedIds()` sa číta nanovo pri každom uzle, takže
        // hranu vytvorenú o pár uzlov skôr už vidí. V dry-run žiadna taká hrana
        // nevznikne a bez tejto množiny by uzol B navrhol späť ten istý pár, ktorý
        // pred chvíľou navrhol uzol A — dry-run by hlásil dvojnásobok skutočnosti.
        $pending = [];

        // Navrhnuté páry pre `-v`. Číslo „koľko hrán by vzniklo" sa nedá overiť
        // a tisíc nových hrán je rozhodnutie človeka — musí si ich vedieť prečítať.
        $proposals = [];

        foreach ($nodes as $node) {
            if ($node->type === 'core') {
                continue;
            }
            $checked++;

            // aktuálne prepojené uzly (čerstvo z DB — v tomto behu už mohli pribudnúť)
            $linkedIds = $this->linkedIds($node);

            $isSession = $node->type === 'memory' && $node->source === 'session';
            $ownProject = (string) ($node->meta['project'] ?? '');
            $already = $pending[$node->id] ?? [];

            $filter = function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject, $already) {
                if ($cand->id === $node->id || $cand->type === 'core') {
                    return false;
                }
                if ($linkedIds->has($cand->id) || isset($already[$cand->id])) {
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

            $hits = $vectorPlan === null
                ? $similarity->topSimilar($node, self::SIM_PER_NODE, $floor, $filter)
                : $this->pickVectorHits($vectorPlan[$node->id] ?? [], $filter, $byId);

            foreach ($hits as $hit) {
                $other = Node::find($hit['node_id']);
                if (! $other) {
                    continue;
                }
                if ($dryRun) {
                    $pending[$node->id][$other->id] = true;
                    $pending[$other->id][$node->id] = true;
                    $proposals[] = sprintf(
                        '  %.4f  [%d] %s  ↔  [%d] %s',
                        $hit['score'],
                        $node->id,
                        $node->label,
                        $other->id,
                        $other->label,
                    );
                } else {
                    $mind->connect($node, $other, 'similarity', true, 0.5);
                }
                $simCreated++;
            }

            // A4: over/doplň (a povýš) skill_mention synapsie pre session záznamy
            if ($isSession && ! $dryRun) {
                ['new' => $new, 'promoted' => $promoted] = $this->verifySkillMentions($node, $skills, $mind, $similarity);
                $skillCreated += $new;
                $skillPromoted += $promoted;
            }
        }

        $simSeconds = microtime(true) - $simStarted;

        $bridged = 0;
        $clustered = 0;
        $sessioned = 0;
        $depted = 0;
        $relInfo = 'relácie preskočené (dry-run)';

        if (! $dryRun) {
            // A5: cross-domain mosty z tokenov labelu (po similarity/skill_mention fáze)
            $bridged = $this->bridgeByLabelTokens($mind, $similarity);

            // A6: sémantické klastre hviezdicou okolo huba (single-tag rodiny)
            $clustered = $this->bridgeSemanticClusters($mind, $similarity);

            // A7: memory záznam → jeho projektový uzol (meta.project → label)
            $sessioned = $this->bridgeSessionsToProjects($mind);

            // A8: vnútro-oddelenské soft-linky hviezdou (rieši riedke oddelenia)
            $depted = $this->bridgeDepartmentStars($mind, $similarity);

            // A11: sémantika hrán do stĺpca 'relation' (uses / part_of), aditívne
            $relations = $this->backfillRelations($similarity);
            $relInfo = $relations['skipped']
                ? 'relácie preskočené (stĺpec chýba)'
                : "{$relations['uses']} uses + {$relations['part_of']} part_of relácií";
        }

        // Diagnostika sa vypisuje LEN pri nových prepínačoch — bez nich musí byť
        // výstup znak na znak ten istý ako pred vektorovou cestou, aby sa parita
        // dala overiť obyčajným diffom, nie čítaním.
        if ($this->option('vector') || $dryRun) {
            $this->line(sprintf(
                'Similarity krok: %s, prah %.2f, %d uzlov, %.1f s, špička pamäti %.1f MB.',
                $vectorPlan === null ? 'TF-IDF' : 'vektory ('.$embeddings->model().')',
                $floor,
                $checked,
                $simSeconds,
                memory_get_peak_usage(true) / 1048576,
            ));
        }

        if ($dryRun) {
            if ($this->output->isVerbose() && $proposals !== []) {
                $this->line('Navrhnuté páry (skóre · uzol ↔ uzol):');
                $this->line(implode(PHP_EOL, $proposals));
            }

            $this->warn("Dry-run: nič sa nezapísalo, {$simCreated} similarity hrán BY vzniklo; kroky A4–A11 preskočené.");
        }

        $this->info("Rewire: {$checked} uzlov · {$simCreated} similarity · {$skillCreated} nových + {$skillPromoted} povýšených skill_mention · {$bridged} cross-domain · {$clustered} klastrových · {$sessioned} projekt · {$depted} oddelenských mostov · {$relInfo}.");

        return self::SUCCESS;
    }

    /**
     * Vektorová alternatíva A3: pre každý uzol najbližší susedia z hotových
     * embeddingov (`node_embeddings`), alebo NULL, keď vektorová cesta nie je
     * k dispozícii.
     *
     * NULL je tu plnohodnotná odpoveď, nie chyba: vypnuté
     * `hades.embeddings.enabled` alebo prázdna tabuľka znamenajú, že volajúci
     * mlčky pokračuje TF-IDF cestou. Model sa tu NEVOLÁ — čítajú sa len uložené
     * vektory, takže spadnutá Ollama tento krok vôbec netrápi.
     *
     * Filtre sa robia počas enumerácie párov, nie po nej, a sú tie isté ako v
     * TF-IDF ceste (core von, už prepojené páry von, dva session záznamy rôznych
     * projektov von). Musia byť: `topSimilar()` filtruje PRED zrezaním na k,
     * takže keby sa tu filtrovalo až z hotového top-k, uzol s prepojeným okolím
     * by dostal menej hrán než dnes a porovnanie ciest by nemeralo to isté.
     *
     * @param  Collection<int, Node>  $nodes
     * @return array<int, array<int, array{node_id: int, score: float}>>|null
     */
    protected function vectorNeighbourPlan(
        Collection $nodes,
        SimilarityService $similarity,
        EmbeddingService $embeddings,
        float $floor,
    ): ?array {
        if (! $embeddings->enabled() || $embeddings->count() === 0) {
            return null;
        }

        $vectors = $similarity->loadNormalizedVectors($embeddings->model());
        if ($vectors === []) {
            return null;
        }

        $type = [];
        $isSession = [];
        $project = [];
        foreach ($nodes as $node) {
            $type[$node->id] = (string) $node->type;
            $isSession[$node->id] = $node->type === 'memory' && $node->source === 'session';
            $project[$node->id] = (string) ($node->meta['project'] ?? '');
        }

        // core uzly von z KORPUSU, nie z výsledku: A3 ich nikdy nespája a párovať
        // ich by bola práca, ktorú aj tak zahodíme. Uzol bez záznamu v $nodes je
        // vektor po zmazanom uzle (soft delete + iný beh) — tiež von.
        foreach (array_keys($vectors) as $id) {
            if (($type[$id] ?? 'core') === 'core') {
                unset($vectors[$id]);
            }
        }

        $linked = $this->linkedPairs();

        // páry chodia vzostupne podľa id, takže kanonický kľúč je „a:b" bez otáčania
        $allowed = fn (int $a, int $b): bool => ! isset($linked[$a.':'.$b])
            && ! ($isSession[$a] && $isSession[$b] && $project[$a] !== $project[$b]);

        return $similarity->vectorNeighbours($vectors, self::VECTOR_CANDIDATES, $floor, $allowed);
    }

    /**
     * Z predpočítaného zoznamu vektorových susedov vyberie prvých SIM_PER_NODE,
     * ktoré prejdú tým istým filtrom ako TF-IDF cesta. Zoznam je dlhší než k
     * práve preto, aby filter mal z čoho brať.
     *
     * @param  array<int, array{node_id: int, score: float}>  $candidates
     * @param  Collection<int, Node>  $byId
     * @return array<int, array{node_id: int, score: float}>
     */
    protected function pickVectorHits(array $candidates, callable $filter, Collection $byId): array
    {
        $out = [];

        foreach ($candidates as $candidate) {
            $other = $byId->get($candidate['node_id']);
            if (! $other || ! $filter($other)) {
                continue;
            }

            $out[] = $candidate;

            if (count($out) >= self::SIM_PER_NODE) {
                break;
            }
        }

        return $out;
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
