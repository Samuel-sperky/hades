<?php

namespace App\Services;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * Čistý TF-IDF + kosínusová podobnosť uzlov — bez modelu, deterministické.
 * IDF a tokenizovaný korpus sa nacache-ujú do inštancie, takže dávkový beh
 * (rewire) tokenizuje každý uzol len raz.
 */
class SimilarityService
{
    /** Diakritika → ASCII (slovenčina + čeština). */
    protected array $diacritics = [
        'á' => 'a', 'ä' => 'a', 'à' => 'a', 'â' => 'a', 'č' => 'c', 'ć' => 'c',
        'ď' => 'd', 'é' => 'e', 'ě' => 'e', 'ë' => 'e', 'í' => 'i', 'î' => 'i',
        'ĺ' => 'l', 'ľ' => 'l', 'ł' => 'l', 'ň' => 'n', 'ó' => 'o', 'ô' => 'o',
        'ö' => 'o', 'ŕ' => 'r', 'ř' => 'r', 'š' => 's', 'ś' => 's', 'ť' => 't',
        'ú' => 'u', 'ů' => 'u', 'ü' => 'u', 'ý' => 'y', 'ž' => 'z', 'ź' => 'z',
        'ż' => 'z',
    ];

    /** Slovenský + anglický stoplist (~40 slov). */
    protected array $stop = [
        'a', 'and', 'the', 'pre', 'pro', 'ako', 'som', 'by', 'na', 'do', 'to',
        'je', 'sa', 'that', 'with', 'cez', 'aby', 'uz', 'len', 'tak', 'ale',
        'alebo', 'or', 'of', 'in', 'for', 'ku', 'ma', 'mi', 'si', 'co', 'ze',
        'this', 'from', 'ktore', 'ktory', 'aj', 'nie', 'ano', 'vsetko', 'este',
        'bude', 'budem', 'mam', 'has', 'are', 'was', 'not', 'you', 'all',
    ];

    /**
     * Doménová normalizácia zložených/pomlčkových variantov. Beží ako
     * str-nahradenie nad lowercase textom PRED delením na tokeny, takže
     * zjednotí varianty, ktoré by tokenizér inak roztrhal alebo zahodil
     * (napr. 'e-shop' → 'eshop', 'ui/ux' → 'uiux'). Kľúče sú ASCII.
     *
     * @var array<string, string>
     */
    protected array $compounds = [
        'e-shop' => 'eshop', 'e-shopu' => 'eshop', 'e-shopy' => 'eshop',
        'e-shope' => 'eshop', 'e-shopoch' => 'eshop', 'e-shopom' => 'eshop',
        'e-commerce' => 'ecommerce', 'e-mail' => 'email', 'e-maily' => 'email',
        'ui/ux' => 'uiux', 'ux/ui' => 'uiux', 'ux-ui' => 'uiux', 'ui-ux' => 'uiux',
        'front-end' => 'frontend', 'back-end' => 'backend',
        'co-activation' => 'coactivation', 'co-aktivacia' => 'coactivation',
        'cost-plus' => 'costplus', 'token-based' => 'tokenbased',
        'full-text' => 'fulltext', 'real-time' => 'realtime',
        'ci/cd' => 'cicd', 'a/b' => 'ab', 'multi-tenant' => 'multitenant',
        'multi-tenancy' => 'multitenant', 'drop-shipping' => 'dropshipping',
    ];

    /**
     * Kanonizácia tokenov: SK↔EN synonymá + jednoduchá lematizácia
     * (bežné pádové/číselné tvary → spoločný koreň). Aplikuje sa na
     * ASCII (bezdiakritický) token pred stopword/dĺžkovým filtrom, takže
     * dvojjazyčné a skloňované varianty spadnú na ten istý term.
     *
     * @var array<string, string>
     */
    protected array $canon = [
        // cenotvorba / pricing
        'cenotvorba' => 'pricing', 'cenotvorby' => 'pricing', 'cenotvorbu' => 'pricing',
        'cena' => 'pricing', 'ceny' => 'pricing', 'cenu' => 'pricing', 'cien' => 'pricing',
        'pricing' => 'pricing', 'price' => 'pricing', 'prices' => 'pricing',
        // sklad / stock
        'sklad' => 'stock', 'sklade' => 'stock', 'skladu' => 'stock', 'skladov' => 'stock',
        'skladom' => 'stock', 'stock' => 'stock', 'inventory' => 'stock',
        // objednávka / order
        'objednavka' => 'order', 'objednavky' => 'order', 'objednavku' => 'order',
        'objednavok' => 'order', 'objednavke' => 'order', 'objednavkam' => 'order',
        'order' => 'order', 'orders' => 'order',
        // prepravca / carrier
        'prepravca' => 'carrier', 'prepravcu' => 'carrier', 'prepravcovia' => 'carrier',
        'prepravcov' => 'carrier', 'preprava' => 'carrier', 'prepravy' => 'carrier',
        'carrier' => 'carrier', 'carriers' => 'carrier', 'shipping' => 'carrier',
        // dizajn / design
        'dizajn' => 'design', 'dizajnu' => 'design', 'dizajnove' => 'design',
        'dizajnovy' => 'design', 'dizajnovych' => 'design', 'dizajnovym' => 'design',
        'design' => 'design',
        // šperk / jewelry
        'sperk' => 'jewelry', 'sperky' => 'jewelry', 'sperkov' => 'jewelry',
        'sperku' => 'jewelry', 'sperkarsky' => 'jewelry', 'jewelry' => 'jewelry',
        'jewellery' => 'jewelry',
        // vrstva / layer
        'vrstva' => 'layer', 'vrstvy' => 'layer', 'vrstvu' => 'layer',
        'vrstiev' => 'layer', 'vrstvach' => 'layer', 'vrstvove' => 'layer',
        'layer' => 'layer', 'layers' => 'layer',
        // prepojenie / hrana / edge
        'prepojenie' => 'edge', 'prepojenia' => 'edge', 'prepojenim' => 'edge',
        'hrana' => 'edge', 'hrany' => 'edge', 'hranu' => 'edge', 'hran' => 'edge',
        'edge' => 'edge', 'edges' => 'edge',
        // token
        'token' => 'token', 'tokeny' => 'token', 'tokenov' => 'token',
        'tokenu' => 'token', 'tokens' => 'token', 'tokenbased' => 'token',
        // eshop / ecommerce
        'eshop' => 'eshop', 'eshopu' => 'eshop', 'eshopy' => 'eshop',
        'ecommerce' => 'eshop',
        // mapa / ekosystém
        'mapa' => 'map', 'mapy' => 'map', 'mapu' => 'map', 'map' => 'map',
        'ekosystem' => 'ecosystem', 'ekosystemu' => 'ecosystem', 'ecosystem' => 'ecosystem',
        // záloha / backup
        'zaloha' => 'backup', 'zalohy' => 'backup', 'zalohu' => 'backup',
        'zaloh' => 'backup', 'zalohovanie' => 'backup', 'zalohovania' => 'backup',
        'zalohovat' => 'backup', 'backup' => 'backup', 'backups' => 'backup',
        // reklama / ads
        'reklama' => 'ads', 'reklamy' => 'ads', 'reklamu' => 'ads', 'reklam' => 'ads',
        'reklamne' => 'ads', 'reklamny' => 'ads', 'ads' => 'ads', 'advertising' => 'ads',
        // kampaň / campaign
        'kampan' => 'campaign', 'kampane' => 'campaign', 'kampani' => 'campaign',
        'kampanou' => 'campaign', 'kampaniach' => 'campaign',
        'campaign' => 'campaign', 'campaigns' => 'campaign',
        // hierarchia / hierarchy
        'hierarchia' => 'hierarchy', 'hierarchie' => 'hierarchy', 'hierarchiu' => 'hierarchy',
        'hierarchii' => 'hierarchy', 'hierarchy' => 'hierarchy',
        // nasadenie / deploy
        'nasadenie' => 'deploy', 'nasadenia' => 'deploy', 'nasadit' => 'deploy',
        'nasadime' => 'deploy', 'nasadenom' => 'deploy',
        'deploy' => 'deploy', 'deployment' => 'deploy', 'deploynut' => 'deploy',
        // produkt / product
        'produkt' => 'product', 'produkty' => 'product', 'produktu' => 'product',
        'produktov' => 'product', 'produktova' => 'product', 'produktove' => 'product',
        'product' => 'product', 'products' => 'product',
        // fotografia / photo
        'fotografia' => 'photo', 'fotografie' => 'photo', 'fotografiu' => 'photo',
        'foto' => 'photo', 'photo' => 'photo', 'photography' => 'photo', 'photos' => 'photo',
        // marketing (zjednotenie tvarov)
        'marketing' => 'marketing', 'marketingu' => 'marketing',
        'marketingovy' => 'marketing', 'marketingove' => 'marketing',
        // analytika / analytics
        'analytika' => 'analytics', 'analytiky' => 'analytics', 'analytiku' => 'analytics',
        'analytics' => 'analytics', 'analytic' => 'analytics', 'analyza' => 'analytics',
        'analyzy' => 'analytics', 'analysis' => 'analytics',
        // email
        'email' => 'email', 'emaily' => 'email', 'emailu' => 'email', 'emailov' => 'email',
        'mail' => 'email', 'mails' => 'email',
        // bezpečnosť / security
        'bezpecnost' => 'security', 'bezpecnosti' => 'security', 'bezpecny' => 'security',
        'bezpecne' => 'security', 'security' => 'security', 'secure' => 'security',
        // databáza / database
        'databaza' => 'database', 'databazy' => 'database', 'databaze' => 'database',
        'databazu' => 'database', 'databazach' => 'database',
        'database' => 'database', 'databases' => 'database', 'databazova' => 'database',
        // šperkárske atribúty / jewelry attributes
        'naramok' => 'bracelet', 'naramky' => 'bracelet', 'naramkov' => 'bracelet',
        'bracelet' => 'bracelet', 'bracelets' => 'bracelet',
        'nausnice' => 'earring', 'nausnic' => 'earring', 'nausniciam' => 'earring',
        'earring' => 'earring', 'earrings' => 'earring',
        'prsten' => 'ring', 'prstene' => 'ring', 'prstenov' => 'ring', 'prsteni' => 'ring',
        'ring' => 'ring', 'rings' => 'ring',
        'retiazka' => 'chain', 'retiazky' => 'chain', 'retiazku' => 'chain',
        'chain' => 'chain', 'chains' => 'chain',
        'privesok' => 'pendant', 'privesky' => 'pendant', 'pendant' => 'pendant',
        'striebro' => 'silver', 'striebra' => 'silver', 'strieborny' => 'silver',
        'strieborne' => 'silver', 'silver' => 'silver',
        'zlaty' => 'gold', 'zlate' => 'gold', 'zlateho' => 'gold', 'gold' => 'gold',
        'kamen' => 'stone', 'kamene' => 'stone', 'kamenov' => 'stone', 'stone' => 'stone',
        'material' => 'material', 'materialu' => 'material', 'materialy' => 'material',
        'materialov' => 'material', 'materials' => 'material',
        // platba / payment
        'platba' => 'payment', 'platby' => 'payment', 'platbu' => 'payment',
        'platob' => 'payment', 'platobny' => 'payment', 'platobne' => 'payment',
        'payment' => 'payment', 'payments' => 'payment', 'platit' => 'payment',
        // košík / cart
        'kosik' => 'cart', 'kosiku' => 'cart', 'kosika' => 'cart', 'cart' => 'cart',
        // zákazník / customer
        'zakaznik' => 'customer', 'zakaznika' => 'customer', 'zakaznici' => 'customer',
        'zakaznikov' => 'customer', 'zakaznicky' => 'customer',
        'customer' => 'customer', 'customers' => 'customer',
        // faktúra / invoice
        'faktura' => 'invoice', 'faktury' => 'invoice', 'fakturu' => 'invoice',
        'faktur' => 'invoice', 'fakturacia' => 'invoice',
        'invoice' => 'invoice', 'invoices' => 'invoice',
        // zľava / discount
        'zlava' => 'discount', 'zlavy' => 'discount', 'zlavu' => 'discount',
        'zliav' => 'discount', 'discount' => 'discount', 'discounts' => 'discount',
        // doprava (do carrier klastra) / shipping
        'doprava' => 'carrier', 'dopravy' => 'carrier', 'dopravu' => 'carrier',
        'dorucenie' => 'carrier', 'dorucenia' => 'carrier',
        // variant / SKU
        'variant' => 'variant', 'varianty' => 'variant', 'variantu' => 'variant',
        'variantov' => 'variant', 'variants' => 'variant', 'variovanie' => 'variant',
        // migrácia / migration
        'migracia' => 'migration', 'migracie' => 'migration', 'migraciu' => 'migration',
        'migracii' => 'migration', 'migration' => 'migration', 'migrations' => 'migration',
        // fronta / queue
        'fronta' => 'queue', 'fronty' => 'queue', 'frontu' => 'queue', 'frontou' => 'queue',
        'queue' => 'queue', 'queues' => 'queue',
        // kontajner / docker / container
        'kontajner' => 'container', 'kontajnery' => 'container', 'kontajnera' => 'container',
        'kontajnerov' => 'container', 'docker' => 'container',
        'container' => 'container', 'containers' => 'container',
        // testovanie / test
        'test' => 'test', 'testy' => 'test', 'testu' => 'test', 'testov' => 'test',
        'testovanie' => 'test', 'testovania' => 'test', 'testovat' => 'test',
        'testing' => 'test', 'tests' => 'test',
        // cache / vyrovnávacia pamäť
        'cache' => 'cache', 'cachovanie' => 'cache', 'cachovania' => 'cache',
        'caching' => 'cache', 'redis' => 'cache',
        // server
        'server' => 'server', 'servery' => 'server', 'servera' => 'server',
        'serverov' => 'server', 'serveri' => 'server', 'servers' => 'server',
        // klient / client
        'klient' => 'client', 'klienta' => 'client', 'klienti' => 'client',
        'klientov' => 'client', 'client' => 'client', 'clients' => 'client',
        // notifikácia / notification
        'notifikacia' => 'notification', 'notifikacie' => 'notification',
        'notifikaciu' => 'notification', 'notifikacii' => 'notification',
        'notification' => 'notification', 'notifications' => 'notification',
        // pamäť / memory (doména Hades)
        'pamat' => 'memory', 'pamati' => 'memory', 'pamate' => 'memory',
        'memory' => 'memory', 'memories' => 'memory', 'spomienka' => 'memory',
        'spomienky' => 'memory', 'spomienok' => 'memory',
        // podobnosť / similarity
        'podobnost' => 'similarity', 'podobnosti' => 'similarity', 'podobny' => 'similarity',
        'podobne' => 'similarity', 'similarity' => 'similarity', 'similar' => 'similarity',
    ];

    /** Násobič frekvencie tokenov z labelu oproti description (identita > popis). */
    protected int $labelWeight = 3;

    /** @var array<int, array<string, int>> node_id => term frequency map */
    protected array $corpus = [];

    /** @var array<string, float> term => IDF */
    protected array $idf = [];

    /** @var array<int, string> node_id → surový text (label+description+meta) */
    protected array $texts = [];

    protected bool $warmed = false;

    /**
     * Tokenizuje reťazec: lowercase, doménová normalizácia zložených variantov,
     * bez diakritiky, rozdelí na písmená/číslice, kanonizuje synonymá/tvary,
     * zahodí tokeny kratšie než 3 znaky a stopslová. Vráti mapu frekvencií.
     *
     * Voliteľný $bigrams pridá k unigramom aj susedné bigramy (napr.
     * 'sku_variant'); používaj len pre krátke identity (label), nie pre
     * dlhé popisy, aby sa neroznásobil slovník. Kontrakt (return mapy
     * term→count) ostáva nezmenený, parameter je aditívny s defaultom.
     *
     * @return array<string, int>
     */
    public function tokenize(string $text, bool $bigrams = false): array
    {
        $text = mb_strtolower($text);
        $text = strtr($text, $this->compounds);
        $text = strtr($text, $this->diacritics);
        $raw = preg_split('/[^a-z0-9]+/', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        // Sekvencia prežitých tokenov (po kanonizácii) — poradie drží bigramy.
        $seq = [];
        foreach ($raw as $tok) {
            $tok = $this->canon[$tok] ?? $tok;
            if (mb_strlen($tok) < 3 || in_array($tok, $this->stop, true)) {
                continue;
            }
            $seq[] = $tok;
        }

        $tf = [];
        foreach ($seq as $tok) {
            $tf[$tok] = ($tf[$tok] ?? 0) + 1;
        }

        if ($bigrams) {
            $count = count($seq);
            for ($i = 0; $i + 1 < $count; $i++) {
                $bg = $seq[$i].'_'.$seq[$i + 1];
                $tf[$bg] = ($tf[$bg] ?? 0) + 1;
            }
        }

        return $tf;
    }

    /**
     * Rozšíri dopytové termy o kanonické a synonymné varianty z doménového
     * slovníka (compounds + canon). Napr. 'pricing' pridá aj 'cenotvorba',
     * 'cena', 'price'…; 'objednavka' aj 'order'. Pôvodné termy sa zachovajú,
     * výsledok je unikátny zoznam malými písmenami. Slúži pre recall(), aby
     * LIKE dopyt našiel SK aj EN varianty toho istého pojmu. Aditívne — nemení
     * tokenize()/score() ani ich kontrakt.
     *
     * @param  iterable<int, string>  $terms
     * @return array<int, string>
     */
    public function expandTerms(iterable $terms): array
    {
        // reverzný index koreň → všetky varianty (postavený raz za volanie)
        $byRoot = [];
        foreach ($this->canon as $variant => $root) {
            $byRoot[$root][] = $variant;
        }

        $out = [];
        foreach ($terms as $term) {
            $term = mb_strtolower(trim((string) $term));
            if ($term === '') {
                continue;
            }

            $out[$term] = true;

            // doménová normalizácia: zložené varianty + bez diakritiky
            $ascii = strtr($term, $this->compounds);
            $ascii = strtr($ascii, $this->diacritics);
            if ($ascii !== $term) {
                $out[$ascii] = true;
            }

            // kanonický koreň + všetky jeho synonymá (SK↔EN, pádové tvary)
            $root = $this->canon[$ascii] ?? null;
            if ($root !== null) {
                $out[$root] = true;
                foreach ($byRoot[$root] ?? [] as $variant) {
                    $out[$variant] = true;
                }
            }
        }

        return array_keys($out);
    }

    /**
     * Predpočíta IDF a tokenizovaný korpus zo zadaných uzlov. Zavolaj pred
     * dávkovým behom score()/topSimilar().
     */
    public function warmCorpus(Collection $nodes): void
    {
        $this->corpus = [];
        $this->texts = [];
        $docFreq = [];

        foreach ($nodes as $node) {
            $tf = $this->nodeTf($node);
            $this->corpus[$node->id] = $tf;
            $this->texts[$node->id] = $this->nodeText($node);

            foreach (array_keys($tf) as $term) {
                $docFreq[$term] = ($docFreq[$term] ?? 0) + 1;
            }
        }

        $n = max(1, count($this->corpus));
        $this->idf = [];
        foreach ($docFreq as $term => $df) {
            // vyhladené IDF, vždy kladné
            $this->idf[$term] = log(($n + 1) / ($df + 1)) + 1;
        }

        $this->warmed = true;
    }

    /**
     * Kosínusová podobnosť dvoch uzlov nad TF-IDF vektormi (0..1).
     */
    public function score(Node $a, Node $b): float
    {
        $tfA = $this->tfFor($a);
        $tfB = $this->tfFor($b);

        if ($tfA === [] || $tfB === []) {
            return 0.0;
        }

        $vecA = $this->weight($tfA);
        $vecB = $this->weight($tfB);

        $dot = 0.0;
        foreach ($vecA as $term => $wa) {
            if (isset($vecB[$term])) {
                $dot += $wa * $vecB[$term];
            }
        }
        if ($dot <= 0.0) {
            return 0.0;
        }

        $normA = sqrt(array_sum(array_map(fn ($w) => $w * $w, $vecA)));
        $normB = sqrt(array_sum(array_map(fn ($w) => $w * $w, $vecB)));
        if ($normA <= 0.0 || $normB <= 0.0) {
            return 0.0;
        }

        return min(1.0, $dot / ($normA * $normB));
    }

    /**
     * k najpodobnejších INÝCH uzlov nad prahom $min. Voliteľný $filter(Node): bool
     * odfiltruje kandidátov (napr. už prepojených). Vracia [['node_id'=>, 'score'=>], …]
     * zoradené zostupne.
     *
     * @return array<int, array{node_id: int, score: float}>
     */
    public function topSimilar(Node $node, int $k = 3, float $min = 0.18, ?callable $filter = null): array
    {
        if (! $this->warmed) {
            $this->warmCorpus(Node::query()->get());
        }

        $scores = [];
        foreach (array_keys($this->corpus) as $otherId) {
            if ($otherId === $node->id) {
                continue;
            }

            $other = Node::find($otherId);
            if (! $other) {
                continue;
            }
            if ($filter && ! $filter($other)) {
                continue;
            }

            $s = $this->score($node, $other);
            if ($s >= $min) {
                $scores[] = ['node_id' => $otherId, 'score' => round($s, 4)];
            }
        }

        usort($scores, fn ($x, $y) => $y['score'] <=> $x['score']);

        return array_slice($scores, 0, $k);
    }

    /**
     * Text uzla pre podobnosť: label + description (+ meta.project a kľúče
     * meta.tools pri session uzloch).
     */
    protected function nodeText(Node $node): string
    {
        $parts = [(string) $node->label, (string) $node->description];

        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['project'])) {
            $parts[] = (string) $meta['project'];
        }
        if (! empty($meta['tools']) && is_array($meta['tools'])) {
            $parts[] = implode(' ', array_keys($meta['tools']));
        }

        return trim(implode(' ', $parts));
    }

    /**
     * TF mapa uzla s vážením polí: label (s bigramami) násobený $labelWeight,
     * description a meta váhou 1. Tým identita uzla neutopí v dlhom popise.
     *
     * @return array<string, int>
     */
    protected function nodeTf(Node $node): array
    {
        $tf = [];

        // Label — zvýraznená identita + frázové bigramy.
        foreach ($this->tokenize((string) $node->label, true) as $term => $count) {
            $tf[$term] = ($tf[$term] ?? 0) + $count * $this->labelWeight;
        }

        // Description + meta — bežná váha, bez bigramov (drží slovník malý).
        $body = [(string) $node->description];
        $meta = is_array($node->meta) ? $node->meta : [];
        if (! empty($meta['project'])) {
            $body[] = (string) $meta['project'];
        }
        if (! empty($meta['tools']) && is_array($meta['tools'])) {
            $body[] = implode(' ', array_keys($meta['tools']));
        }

        foreach ($this->tokenize(implode(' ', $body), false) as $term => $count) {
            $tf[$term] = ($tf[$term] ?? 0) + $count;
        }

        return $tf;
    }

    /**
     * TF mapa uzla z cache, alebo dopočítaná za behu.
     *
     * @return array<string, int>
     */
    protected function tfFor(Node $node): array
    {
        return $this->corpus[$node->id] ?? $this->nodeTf($node);
    }

    /**
     * TF-IDF váhový vektor z TF mapy. Neznáme termy (mimo korpusu) dostanú
     * neutrálnu IDF 1.0.
     *
     * @param  array<string, int>  $tf
     * @return array<string, float>
     */
    protected function weight(array $tf): array
    {
        $vec = [];
        foreach ($tf as $term => $count) {
            $vec[$term] = $count * ($this->idf[$term] ?? 1.0);
        }

        return $vec;
    }
}
