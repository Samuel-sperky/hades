<?php

namespace App\Services\Embeddings;

use App\Llm\ChatProvider;
use App\Llm\EmbedOptions;
use App\Llm\ProviderFactory;
use App\Models\Node;
use Illuminate\Container\Container;
use Illuminate\Support\Facades\Cache;

/**
 * Jediné miesto, ktoré premieňa text na vektor. Nad `ChatProvider::embed()`
 * (zamknuté rozhranie #11) pridáva: výber modelu/dimenzie z configu, dávkovanie,
 * skrátenie textu, tvorbu textu z uzla a hash pre idempotenciu.
 *
 * ŽELEZNÉ PRAVIDLO: keď provider nie je dostupný (Ollama nebeží, LLM je vypnutý),
 * `embed()` vráti prázdny list. Nikdy nevyhodí výnimku a nikdy nič nezaloguje ako
 * chybu — nedostupnosť je normálny stav a volajúci sa vráti k čistému TF-IDF.
 */
class EmbeddingService
{
    private ?ChatProvider $provider = null;

    /** Cache odpovede health() v rámci inštancie — recall nepinguje Ollamu per dopyt. */
    private ?bool $available = null;

    /**
     * Provider sa dá vstreknúť (testy: FakeProvider / NullProvider). Bez neho sa
     * berie z kontejnera, aby bola trieda `new`-ovateľná bez argumentov (MindService
     * a RecallEngine ju držia ako default parameter).
     */
    public function __construct(?ChatProvider $provider = null)
    {
        $this->provider = $provider;
    }

    /** Model, ktorým sa embeduje. Ide do `nodes.embedding_model`. */
    public function model(): string
    {
        return (string) (config('recall.embed.model') ?: config('llm.models.embed') ?: 'bge-m3');
    }

    /** Očakávaná dimenzia vektora. */
    public function dimensions(): int
    {
        return max(1, (int) config('recall.embed.dimensions', 1024));
    }

    /**
     * Hlási provider funkčné embeddingy? Cachované v rámci inštancie, aby recall
     * nepingoval Ollamu pri každom dopyte.
     */
    public function available(): bool
    {
        if ($this->available === null) {
            $health = $this->provider()->health();
            $this->available = $health->ok && $health->embed;
        }

        return $this->available;
    }

    /**
     * Texty → vektory v rovnakom poradí. Prázdny list = embeddingy nie sú dostupné.
     * Dávkuje po `recall.embed.batch`, aby jeden request neposielal celý korpus.
     *
     * @param  list<string>  $texts
     * @return list<list<float>>
     */
    public function embed(array $texts): array
    {
        if ($texts === []) {
            return [];
        }

        $opts = new EmbedOptions(model: $this->model(), dimensions: $this->dimensions());
        $batch = max(1, (int) config('recall.embed.batch', 16));
        $prepared = array_map(fn ($t) => $this->prepare((string) $t), array_values($texts));

        $out = [];
        foreach (array_chunk($prepared, $batch) as $chunk) {
            $vectors = $this->provider()->embed($chunk, $opts);

            // Provider nedostupný (alebo neúplná odpoveď) → celá dávka je neplatná.
            // Vraciame prázdno, nie čiastočný výsledok — volajúci sa vráti k TF-IDF.
            if (! is_array($vectors) || count($vectors) !== count($chunk)) {
                return [];
            }

            foreach ($vectors as $vector) {
                if (! is_array($vector) || $vector === []) {
                    return [];
                }
                $out[] = EmbeddingVector::normalize(array_values($vector));
            }
        }

        return $out;
    }

    /**
     * Jeden text → jeden vektor, alebo prázdny list keď embeddingy nie sú dostupné.
     *
     * @return list<float>
     */
    public function embedOne(string $text): array
    {
        $vectors = $this->embed([$text]);

        return $vectors[0] ?? [];
    }

    /**
     * Ako `embedOne()`, ale s krátkodobou cache. Používa to recall na vektor
     * DOPYTU — na tomto stroji je round-trip do Ollamy ~130 ms a je to 76 %
     * celej latencie vektorovej vetvy, pričom používateľ ten istý dopyt píše
     * opakovane (hľadanie počas písania, MCP recall tej istej témy).
     *
     * Cache nemôže zastarať: rovnaký text + rovnaký model + rovnaká dimenzia
     * dá bit-identický vektor (overené, kosínus uložený vs. nový = 1,0000000000).
     * TTL je preto len strop pamäte, nie ochrana pred nesprávnym výsledkom.
     *
     * PRÁZDNY VEKTOR SA NIKDY NECACHUJE — inak by sekundový výpadok Ollamy vypol
     * vektorovú vetvu na celý TTL. Nedostupná cache recall nezhodí.
     *
     * @return list<float>
     */
    public function embedOneCached(string $text): array
    {
        $ttl = (int) config('recall.embed.query_cache_ttl', 300);

        if ($ttl <= 0) {
            return $this->embedOne($text);
        }

        $dimensions = $this->dimensions();
        $key = 'recall.qvec.'.hash('sha256', $this->model().'|'.$dimensions.'|'.$this->prepare($text));

        try {
            $cached = Cache::get($key);
            if (is_array($cached) && count($cached) === $dimensions) {
                return array_values($cached);
            }
        } catch (\Throwable) {
            // nedostupná cache je normálny stav — pokračujeme na provider
        }

        $vector = $this->embedOne($text);

        if ($vector !== []) {
            try {
                Cache::put($key, $vector, $ttl);
            } catch (\Throwable) {
                // zápis do cache nie je kritický
            }
        }

        return $vector;
    }

    /**
     * Text uzla pre embedding: label + popis + doménové meta. Rovnaká skladba ako
     * v SimilarityService::nodeText(), aby obe vetvy „videli" ten istý uzol; label
     * je uvedený prvý, lebo je identita uzla.
     */
    public function textForNode(Node $node): string
    {
        $parts = [trim((string) $node->label), trim((string) $node->description)];

        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['project'])) {
            $parts[] = (string) $meta['project'];
        }
        if (! empty($meta['tools']) && is_array($meta['tools'])) {
            $parts[] = implode(' ', array_keys($meta['tools']));
        }

        return trim(preg_replace('/\s+/u', ' ', implode('. ', array_filter($parts, fn ($p) => $p !== ''))) ?? '');
    }

    /**
     * Odtlačok textu, z ktorého vektor vznikol. `aura:embed` ho porovnáva so
     * uloženým `embedding_hash` — to je celá idempotencia príkazu.
     */
    public function hash(string $text): string
    {
        return hash('sha256', $this->prepare($text));
    }

    /** Skrátenie na `recall.embed.max_chars` + zbalenie whitespace. */
    private function prepare(string $text): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
        $max = max(1, (int) config('recall.embed.max_chars', 2000));

        return mb_substr($text, 0, $max);
    }

    /**
     * Provider: vstreknutý → z kontejnera (keď je ChatProvider nabindovaný, čo
     * robia testy aj P5) → ProviderFactory podľa config('llm'). Posledná vetva
     * vracia pri vypnutom LLM NullProvider, teda „embeddingy nie sú dostupné".
     */
    private function provider(): ChatProvider
    {
        if ($this->provider instanceof ChatProvider) {
            return $this->provider;
        }

        $container = Container::getInstance();

        if ($container->bound(ChatProvider::class)) {
            return $this->provider = $container->make(ChatProvider::class);
        }

        return $this->provider = (new ProviderFactory((array) config('llm', [])))->forEmbed();
    }
}
