<?php

/*
 * Vlastník: P5.
 *
 * Trojvrstvová architektúra chatu (rozhodnutie #117, všetko FREE, Anthropic sa nepoužíva):
 *   1. deterministický router (kľúčové slová + regex)  — POVINNÝ, funguje offline
 *   2. model ako DOPLNOK                               — len keď vrstva 1 nenájde zhodu
 *   3. šablónové odpovede z reálnych dát               — čísla skladá VŽDY kód
 *
 * `enabled` je odteraz ZAPNUTÉ by default: každá modelová vetva má deterministický
 * fallback, takže zapnutá vrstva 2 nemôže appku zhodiť ani keď Ollama nebeží.
 * Vypnutie (`AURAAI_LLM_ENABLED=false`) vráti appku do plne deterministického režimu.
 *
 * V testoch je vrstva 2 vždy vypnutá, pokiaľ test výslovne nepodstrčí providera do
 * kontejnera — viď ProviderFactory. Testovací balík tak nikdy nechodí na sieť.
 */

return [

    // Hlavný vypínač celej LLM vrstvy. false = NullProvider všade.
    'enabled' => (bool) env('AURAAI_LLM_ENABLED', true),

    'ollama' => [
        // V compose sieti; port je publikovaný len na 127.0.0.1 pre ladenie (#139).
        'url' => env('AURAAI_OLLAMA_URL', 'http://ollama:11434'),
        'keep_alive' => env('AURAAI_OLLAMA_KEEP_ALIVE', '30m'),
        // Ako dlho (sekundy) sa cachuje výsledok health() — /api/chat nesmie pingať
        // Ollamu pri každej požiadavke, ale ani držať mŕtvy stav minúty.
        'health_ttl' => (int) env('AURAAI_OLLAMA_HEALTH_TTL', 15),
    ],

    /*
     * Modely — POTVRDENÉ MERANÍM, viď docs/BENCHMARK-LLM.md.
     *
     * `qwen3:0.6b` z rozhodnutia #104 má 25 % presnosť routera v SK (nepoužiteľný),
     * `qwen3:4b` má 100 % (12/12) → rozhodnutie používateľa 29. 7. 2026.
     * `multilingual-e5-small` z rozhodnutia #111 v Ollama registri neexistuje →
     * nahradený `bge-m3` (jediný s nulovým prekryvom na SK↔EN, MIT).
     * `nemotron-mini` z #117b nie je stiahnutý ani licenčne overený — eskalácia
     * preto beží na tom istom `qwen3:4b`; po doplnení sa mení len táto hodnota.
     */
    'models' => [
        'router' => env('AURAAI_MODEL_ROUTER', 'qwen3:4b'),
        'escalation' => env('AURAAI_MODEL_ESCALATION', 'qwen3:4b'),
        'embed' => env('AURAAI_MODEL_EMBED', 'bge-m3'),
    ],

    'embed' => [
        /*
         * bge-m3 má 1024 dimenzií, nie 384 ako neexistujúci multilingual-e5-small.
         * DTO EmbedOptions je ZAMKNUTÉ (#11) a jeho default 384 sa preto nemení —
         * volajúci MUSÍ dimenziu podať z tohto configu:
         *   new EmbedOptions(model: config('llm.models.embed'), dimensions: config('llm.embed.dimensions'))
         * OllamaProvider vracia natívnu dimenziu modelu a nikdy nekráti.
         */
        'dimensions' => (int) env('AURAAI_EMBED_DIMENSIONS', 1024),
        'batch' => (int) env('AURAAI_EMBED_BATCH', 32),
    ],

    // Milisekundy. Hodnoty sú akceptačné kritérium P5 (rozhodnutie #124).
    'timeouts' => [
        'connect' => 5_000,
        'first_token' => 90_000,
        'total' => 300_000,
        'idle' => 30_000,
    ],

    // Kontextový budget — router dostane málo, eskalačný model viac (rozhodnutie #147).
    'context' => [
        'router' => ['nodes' => 5, 'chars' => 3_000],
        'escalation' => ['nodes' => 20, 'chars' => 12_000],
    ],

    /*
     * Parametre Ollamy per úloha. Kľúč = ChatOptions::$task, takže sa nemusí
     * meniť zamknuté DTO (#11) len preto, aby router dostal `format: json`.
     * `model` je kľúč do 'models' vyššie, nie tag modelu.
     *
     * `think: false` je POVINNÉ pri qwen3 — bez neho model spáli celý budget na
     * `<think>` blok a vráti prázdnu odpoveď. Meranie ukázalo, že `think:false`
     * SÁM NESTAČÍ: bez `format:"json"` sa uvažovanie vyleje do `message.content`
     * v angličtine. Preto má každá modelová vetva vynútený JSON obal.
     */
    'tasks' => [
        'router' => [
            'model' => 'router',
            'think' => false,
            'format' => 'json',
            'temperature' => 0.0,
            'num_predict' => 64,
            'num_ctx' => 4_096,
        ],
        'rephrase' => [
            'model' => 'escalation',
            'think' => false,
            'format' => 'json',
            'temperature' => 0.2,
            'num_predict' => 400,
            'num_ctx' => 8_192,
        ],
        'chat' => [
            'model' => 'escalation',
            'think' => false,
            'format' => 'json',
            'temperature' => 0.3,
            'num_predict' => 700,
            'num_ctx' => 16_384,
        ],
        // Auto-názov vlákna (rozhodnutie #90/#128) — model navrhne, kód rozhodne.
        'title' => [
            'model' => 'router',
            'think' => false,
            'format' => 'json',
            'temperature' => 0.0,
            'num_predict' => 48,
            'num_ctx' => 2_048,
        ],
    ],

    /*
     * Vrstva 2 — model ako doplnok deterministického routera.
     * Zapojí sa LEN keď vrstva 1 vráti 'none'.
     */
    'router' => [
        'model_fallback' => (bool) env('AURAAI_LLM_ROUTER_MODEL', true),
    ],

    /*
     * Preformulovanie šablónovej odpovede modelom je VYPNUTÉ by default.
     *
     * Meranie 30. 7. 2026: qwen3:4b v JSON obale síce prestane uvažovať nahlas,
     * ale komolí slovenskú diakritiku („hrán" → „hrn"). Šablóna je vždy presná,
     * takže default je „nepreformulovávať". Kód aj validátor sú hotové — po
     * doplnení silnejšieho free modelu sa zapína touto jednou hodnotou.
     * Validátor je nevypnuteľný: odpoveď, ktorá zmení hoci jedno číslo, sa zahodí.
     */
    'rephrase' => [
        'enabled' => (bool) env('AURAAI_LLM_REPHRASE', false),
        // Preformulovaná odpoveď nesmie byť dlhšia než násobok šablóny.
        'max_growth' => 2.0,
    ],

    // Jeden stream naraz (rozhodnutie #126). Chráni `artisan serve` pred tým, aby
    // paralelné SSE spojenia obsadili všetkých 8 workerov — viď ChatStreamController.
    'max_concurrent_streams' => (int) env('AURAAI_LLM_MAX_STREAMS', 1),

    // Ako dlho (ms) čaká druhá požiadavka na uvoľnenie streamu, kým sa prepne
    // na nestreamovanú odpoveď. Nikdy nevracia chybu (rozhodnutie #126).
    'stream_queue_wait' => (int) env('AURAAI_LLM_STREAM_WAIT', 8_000),

    /*
     * Anthropic zostáva v kóde, vypnutý a nepovinný (rozhodnutie #25/#117).
     * Prázdny kľúč NIE JE chyba a nesmie generovať warning ani log.
     */
    'anthropic' => [
        'enabled' => (bool) env('AURAAI_ANTHROPIC_ENABLED', false),
        'key' => env('ANTHROPIC_API_KEY'),
        'model' => env('AURAAI_CHAT_MODEL', 'claude-opus-4-8'),
    ],

];
