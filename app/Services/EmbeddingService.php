<?php

namespace App\Services;

use App\Models\Node;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Vektorová polovica hľadania: text uzla → embedding z lokálneho modelu →
 * kosínusová podobnosť nad celým korpusom.
 *
 * Kľúčové slová (MindService::searchNodes) trafia presné mená — labely, tagy,
 * cesty. Vektory trafia zmysel, teda uzol formulovaný inými slovami než dopyt.
 * Preto sa výsledky FÚZUJÚ nad touto službou a nevyberá sa jeden zdroj; táto
 * služba o fúzii nič nevie a vracia len zoradených kandidátov s podobnosťou.
 *
 * Chyby: JEDNO volanie padne nahlas (výnimka), DÁVKA pokračuje a spočíta
 * neúspechy. Prečo to takto: dávka je záloha CPU inferencie v desiatkach minút a
 * jeden nedostupný model uprostred nesmie zahodiť to, čo je už hotové. Každý
 * uzol sa zapisuje vlastným upsertom, takže prerušený beh nie je nekonzistentný,
 * len nedokončený — `staleNodeIds()` po ňom vráti presne zvyšok.
 */
class EmbeddingService
{
    /**
     * Strop na popis vo vektorizovanom texte. Zámerne tá istá hodnota ako
     * `hades.recall_desc_top_chars` (900): vektor má reprezentovať to, čo z uzla
     * konzument reálne uvidí v odpovedi, nie desaťkilobajtový dump, ktorý recall
     * aj tak zreže.
     */
    public const DESC_CAP = 900;

    /** Koľko riadkov naraz ťahať pri skenovaní korpusu (surové blob-y, nie modely). */
    protected const READ_CHUNK = 500;

    /** Je vektorová vetva zapnutá? Konzument sa má spýtať PRED volaním search(). */
    public function enabled(): bool
    {
        return (bool) config('hades.embeddings.enabled', true);
    }

    /** Meno modelu, ktorým sa vektorizuje a pod ktorým sa čítajú vektory. */
    public function model(): string
    {
        return (string) config('hades.embeddings.model', 'bge-m3');
    }

    /** Koľko uzlov má vektor pre aktuálny model. */
    public function count(): int
    {
        return DB::table('node_embeddings')->where('model', $this->model())->count();
    }

    /**
     * Jeden vektor z modelu. Padá nahlas — volajúci vie, či je to dopyt (kde je
     * chyba viditeľná) alebo dávka (kde ju odchytí {@see embedNodes}).
     *
     * @return array<int, float>
     *
     * @throws RuntimeException keď je model nedostupný alebo odpoveď nie je vektor
     */
    public function embedText(string $text): array
    {
        $text = trim($text);

        if ($text === '') {
            throw new RuntimeException('Prázdny text sa nedá vektorizovať.');
        }

        $model = $this->model();
        $host = rtrim((string) config('hades.console.ollama.host'), '/');

        try {
            $response = Http::acceptJson()
                ->timeout((int) config('hades.console.ollama.timeout', 900))
                ->post($host.'/api/embed', ['model' => $model, 'input' => $text]);
        } catch (ConnectionException $e) {
            throw new RuntimeException("Embedding model „{$model}“ je nedostupný na {$host}.", 0, $e);
        }

        if ($response->failed()) {
            // telo nesie „model not found" — bez neho sa nedá odlíšiť nestiahnutý
            // model od spadnutého Ollamy a to je celý rozdiel v tom, čo robiť ďalej
            $detail = trim((string) $response->json('error', ''));

            throw new RuntimeException(
                "Ollama /api/embed vrátil {$response->status()} pre model „{$model}“"
                .($detail === '' ? '.' : ": {$detail}"),
            );
        }

        // /api/embed vracia `embeddings` (pole vektorov, jeden vstup = jeden prvok);
        // staršie /api/embeddings vracalo `embedding` — držíme oba, lebo verzia
        // Ollamy na tomto stroji sa mení nezávisle od nás
        $raw = $response->json('embeddings.0') ?? $response->json('embedding');

        if (! is_array($raw) || $raw === []) {
            throw new RuntimeException("Model „{$model}“ nevrátil vektor.");
        }

        $vector = [];
        foreach ($raw as $value) {
            if (! is_numeric($value)) {
                throw new RuntimeException("Model „{$model}“ vrátil nečíselnú zložku vektora.");
            }
            $vector[] = (float) $value;
        }

        // Nulový vektor nie je „slabá" odpoveď, je to nedefinovaný kosínus. Nech
        // padne tu, nie delením nulou o tri dopyty neskôr.
        if ($this->norm($vector) <= 0.0) {
            throw new RuntimeException("Model „{$model}“ vrátil nulový vektor.");
        }

        return $vector;
    }

    /**
     * Text uzla, ktorý ide do modelu.
     *
     * Tvar (poradie je zámer, nie zvyk):
     *   1. label — sám na prvom riadku
     *   2. „Oblasť: <oblasť> / <útvar>"
     *   3. „Tagy: a, b, c" (abecedne)
     *   4. popis, zrezaný na {@see DESC_CAP}
     *
     * Label nesie najviac signálu a nesmie sa utopiť: uzol má label ~40 znakov a
     * popis pokojne 4 000, takže bez stropu by identita bola 1 % tokenov. So
     * stropom je to ~10–25 %. Label sa ZÁMERNE neopakuje: TF-IDF váži
     * opakovaním (a {@see SimilarityService} to tak správne robí), ale pri
     * neurónovom encoderi s CLS/mean poolingom je trojité meno neriadená
     * deformácia vety, nie váha.
     *
     * Oblasť a útvar sú v texte preto, že sú to jediné dva atribúty, ktoré nesú
     * TÉMU. `type` (skill/memory/project) je tvar uzla, nie téma — pridal by
     * rovnaké slovo do všetkých 2 700 vektorov a posunul by celý korpus jedným
     * smerom bez akejkoľvek rozlišovacej hodnoty.
     *
     * Pasca: tagy sa MUSIA zoradiť. Poradie z DB nie je garantované a keby sa
     * medzi dvoma behmi otočilo, `source_hash` sa zmení a `mind:embed --stale`
     * prevektorizuje celý korpus, hoci sa nezmenilo nič.
     */
    public function textFor(Node $node): string
    {
        $lines = [trim((string) $node->label)];

        $place = array_values(array_filter([
            $node->area?->name,
            $node->department?->name,
        ]));

        if ($place !== []) {
            $lines[] = 'Oblasť: '.implode(' / ', $place);
        }

        $tags = $node->relationLoaded('tags')
            ? $node->tags->pluck('name')->all()
            : $node->tags()->pluck('name')->all();

        $tags = array_values(array_unique(array_map('strval', $tags)));
        sort($tags, SORT_NATURAL | SORT_FLAG_CASE);

        if ($tags !== []) {
            $lines[] = 'Tagy: '.implode(', ', $tags);
        }

        $description = trim((string) $node->description);

        if ($description !== '') {
            $lines[] = $this->cap($description, self::DESC_CAP);
        }

        return implode("\n", $lines);
    }

    /** Odtlačok vektorizovaného textu — porovnáva sa so stĺpcom `source_hash`. */
    public function sourceHash(Node $node): string
    {
        return hash('sha256', $this->textFor($node));
    }

    /**
     * Vektorizuje jeden uzol a zapíše/prepíše jeho riadok. Nekontroluje
     * `source_hash` — volaj vtedy, keď VIEŠ, že sa uzol zmenil (napr. hneď po
     * `mind_learn`). Dávkový beh, ktorý má preskakovať nezmenené, je
     * {@see embedNodes}.
     *
     * @throws RuntimeException keď model odpoveď nedá
     */
    public function embedNode(Node $node): void
    {
        $text = $this->textFor($node);
        $vector = $this->embedText($text);
        $now = now();

        DB::table('node_embeddings')->upsert([[
            'node_id' => $node->id,
            'model' => $this->model(),
            'dimensions' => count($vector),
            'vector' => $this->packVector($vector),
            'norm' => $this->norm($vector),
            'source_hash' => hash('sha256', $text),
            'created_at' => $now,
            'updated_at' => $now,
        ]], ['node_id', 'model'], ['dimensions', 'vector', 'norm', 'source_hash', 'updated_at']);
    }

    /**
     * Dávka. Nezmenené uzly preskočí (`source_hash`), pri chybe jedného uzla
     * pokračuje a chybu zapíše do výsledku.
     *
     * Prečo bez transakcie okolo dávky: beh trvá desiatky minút a Ctrl-C uprostred
     * transakcie by zahodil všetko hotové. Každý uzol je vlastný upsert, takže
     * prerušenie je „nedokončené", nie „rozbité".
     *
     * `$after` dostane každý spracovaný uzol a jeho výsledok (`embedded` |
     * `skipped` | `failed`) — tak vie príkaz hýbať progress barom bez toho, aby
     * služba vedela o konzole.
     *
     * @param  iterable<int, Node>  $nodes
     * @param  bool  $force  Prevektorizovať aj uzly s nezmeneným `source_hash`.
     * @param  (callable(Node, string): void)|null  $after
     * @return array{embedded: int, skipped: int, failed: int, errors: array<int, string>}
     */
    public function embedNodes(iterable $nodes, bool $force = false, ?callable $after = null): array
    {
        $stats = ['embedded' => 0, 'skipped' => 0, 'failed' => 0, 'errors' => []];

        $stored = $force ? [] : $this->storedHashes();

        foreach ($nodes as $node) {
            $text = $this->textFor($node);
            $hash = hash('sha256', $text);

            if (! $force && isset($stored[$node->id]) && hash_equals($stored[$node->id], $hash)) {
                $stats['skipped']++;
                $after && $after($node, 'skipped');

                continue;
            }

            try {
                $this->embedNode($node);
                $stats['embedded']++;
                $after && $after($node, 'embedded');
            } catch (RuntimeException $e) {
                $stats['failed']++;
                $stats['errors'][$node->id] = $e->getMessage();
                $after && $after($node, 'failed');
            }
        }

        return $stats;
    }

    /**
     * Semantické hľadanie. Konzument (fúzia v MindService) dostane presne toľko,
     * koľko potrebuje na RRF: id uzla a podobnosť, zoradené zostupne.
     *
     * `$limit` a `$minSimilarity` majú default `null` = hodnota z konfigurácie
     * (`embeddings.candidates`, `embeddings.min_similarity`), aby konzument
     * nemusel poznať dve čísla, ktoré patria konfigurácii.
     *
     * @return array<int, array{node_id: int, similarity: float}>
     *
     * @throws RuntimeException keď sa nepodarí vektorizovať dopyt
     */
    public function search(string $query, ?int $limit = null, ?float $minSimilarity = null): array
    {
        // Prázdny korpus vyriešime BEZ volania modelu — inak by každý recall na
        // nevektorizovanej sieti platil sekundy CPU inferencie za istú nulu.
        if ($this->count() === 0) {
            return [];
        }

        return $this->searchByVector($this->embedText($query), $limit, $minSimilarity);
    }

    /**
     * To isté ako {@see search}, len s hotovým vektorom dopytu — pre volajúceho,
     * ktorý ten istý dopyt vektorizuje raz a hľadá viackrát (napr. per oblasť).
     *
     * @param  array<int, float>  $vector
     * @return array<int, array{node_id: int, similarity: float}>
     */
    public function searchByVector(array $vector, ?int $limit = null, ?float $minSimilarity = null): array
    {
        $limit = $limit ?? (int) config('hades.embeddings.candidates', 40);
        $floor = $minSimilarity ?? (float) config('hades.embeddings.min_similarity', 0.35);
        $dimensions = count($vector);
        $queryNorm = $this->norm($vector);

        if ($limit < 1 || $dimensions === 0 || $queryNorm <= 0.0) {
            return [];
        }

        $hits = [];

        // Join na `nodes` nie je kozmetika: uzly majú soft delete, takže vektor
        // zmazaného uzla v tabuľke ostáva (cascade padne až pri forceDelete) a bez
        // filtra by recall vracal id, ktoré konzument nikdy nenačíta.
        DB::table('node_embeddings')
            ->join('nodes', 'nodes.id', '=', 'node_embeddings.node_id')
            ->whereNull('nodes.deleted_at')
            ->where('node_embeddings.model', $this->model())
            ->where('node_embeddings.dimensions', $dimensions)
            ->select([
                'node_embeddings.id as id',
                'node_embeddings.node_id as node_id',
                'node_embeddings.vector as vector',
                'node_embeddings.norm as norm',
            ])
            ->chunkById(self::READ_CHUNK, function ($rows) use ($vector, $queryNorm, $floor, &$hits) {
                foreach ($rows as $row) {
                    $norm = (float) $row->norm;

                    if ($norm <= 0.0) {
                        continue;
                    }

                    $similarity = $this->dot($vector, (string) $row->vector) / ($norm * $queryNorm);

                    if ($similarity >= $floor) {
                        $hits[] = [
                            'node_id' => (int) $row->node_id,
                            'similarity' => round(min(1.0, max(-1.0, $similarity)), 6),
                        ];
                    }
                }
            }, 'node_embeddings.id', 'id');

        // pri rovnakej podobnosti rozhoduje id — poradie musí byť reprodukovateľné,
        // inak sa fúzia hore nedá otestovať
        usort($hits, fn ($a, $b) => $b['similarity'] <=> $a['similarity'] ?: $a['node_id'] <=> $b['node_id']);

        return array_slice($hits, 0, $limit);
    }

    /**
     * Vektor uzla, ktorý už v tabuľke JE — bez volania modelu. Prewiring
     * (`mind:rewire`) porovnáva uzly medzi sebou, nie dopyt s korpusom, takže by
     * inak platil sekundy CPU inferencie za vektor, ktorý leží štyri kilobajty
     * odtiaľ. Čítanie je aditívne: `search`/`searchByVector`/`embedNode` sa
     * nemenia, na nich stojí živý `mind_recall`.
     *
     * Vracia `null`, keď uzol vektor pre AKTUÁLNY model nemá — volajúci to má
     * preskočiť, nie dopočítať (dopĺňanie je práca `mind:embed`). Rovnako `null`
     * pri riadku, ktorého blob nemá zapísanú dĺžku: taký vektor je poškodený a
     * kosínus z neho by bol tiché číslo bez významu.
     *
     * @return array<int, float>|null
     */
    public function vectorFor(Node|int $node): ?array
    {
        $id = $node instanceof Node ? (int) $node->id : $node;

        $row = DB::table('node_embeddings')
            ->where('node_id', $id)
            ->where('model', $this->model())
            ->first(['vector', 'dimensions']);

        if (! $row) {
            return null;
        }

        $vector = unpack('g*', (string) $row->vector);

        if (! is_array($vector) || count($vector) !== (int) $row->dimensions) {
            return null;
        }

        return array_values(array_map('floatval', $vector));
    }

    /**
     * Uzly, ktoré potrebujú (pre)vektorizovať: bez vektora pre aktuálny model,
     * alebo so `source_hash`, ktorý už nesedí s textom uzla.
     *
     * @param  bool  $all  Vráť všetky uzly, aj nezmenené (pre `mind:embed --all`).
     * @return array<int, int>
     */
    public function staleNodeIds(bool $all = false): array
    {
        if ($all) {
            return Node::query()->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
        }

        $stored = $this->storedHashes();
        $stale = [];

        // relácie eager-loadujeme: textFor() číta tagy, oblasť aj útvar a bez toho
        // je to 4 dopyty na uzol, teda ~10 000 dopytov na jedno zistenie „čo je nové"
        Node::query()
            ->with(['tags:id,name', 'area:id,name', 'department:id,name'])
            ->orderBy('id')
            ->chunk(self::READ_CHUNK, function ($nodes) use ($stored, &$stale) {
                foreach ($nodes as $node) {
                    $have = $stored[$node->id] ?? null;

                    if ($have === null || ! hash_equals($have, $this->sourceHash($node))) {
                        $stale[] = (int) $node->id;
                    }
                }
            });

        return $stale;
    }

    /**
     * `node_id => source_hash` pre aktuálny model.
     *
     * @return array<int, string>
     */
    protected function storedHashes(): array
    {
        return DB::table('node_embeddings')
            ->where('model', $this->model())
            ->pluck('source_hash', 'node_id')
            ->all();
    }

    /**
     * Vektor → packed float32 little endian. Formát 'g' (nie 'f') je zámer:
     * 'f' má strojovú endianitu, takže záloha zapísaná na jednom stroji by sa na
     * inom prečítala ako šum.
     *
     * @param  array<int, float>  $vector
     */
    protected function packVector(array $vector): string
    {
        return pack('g*', ...array_values($vector));
    }

    /**
     * Skalárny súčin vektora dopytu so surovým blobom. Blob sa rozbaľuje na
     * mieste a hneď zahadzuje — 2 700 × 1024 floatov naraz v PHP poli je ~200 MB.
     *
     * @param  array<int, float>  $vector
     */
    protected function dot(array $vector, string $packed): float
    {
        $other = unpack('g*', $packed);

        if (! is_array($other) || count($other) !== count($vector)) {
            return 0.0;
        }

        $dot = 0.0;
        $i = 1; // unpack indexuje od 1

        foreach ($vector as $value) {
            $dot += $value * $other[$i++];
        }

        return $dot;
    }

    /**
     * L2 norma.
     *
     * @param  array<int, float>  $vector
     */
    protected function norm(array $vector): float
    {
        $sum = 0.0;

        foreach ($vector as $value) {
            $sum += $value * $value;
        }

        return sqrt($sum);
    }

    /** Zreže text na strop na hranici slova, nie uprostred. */
    protected function cap(string $text, int $limit): string
    {
        if (mb_strlen($text) <= $limit) {
            return $text;
        }

        $cut = mb_substr($text, 0, $limit);
        $space = mb_strrpos($cut, ' ');

        // hranicu slova hľadáme len v poslednej pätine — inak by veta bez medzier
        // (napr. dlhá cesta) zrezala text na tretinu
        if ($space !== false && $space > (int) ($limit * 0.8)) {
            $cut = mb_substr($cut, 0, $space);
        }

        return rtrim($cut).'…';
    }
}
