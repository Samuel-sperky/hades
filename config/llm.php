<?php

/*
 * Vlastník: A3 (balík P5). SKELETON — kľúče sú tu preto, aby A3 nemusela
 * zasahovať do zdieľaného config/auraai.php ani do .env.example.
 *
 * Default je VYPNUTÝ (enabled = false): appka beží plne deterministicky, ProviderFactory
 * vracia NullProvider a nič sa nepokúša volať Ollamu. Zapína sa až keď P5 dobehne
 * a benchmark (docs/BENCHMARK-LLM.md) potvrdí modely a licencie.
 */

return [

    // Hlavný vypínač celej LLM vrstvy. false = NullProvider všade.
    'enabled' => (bool) env('AURAAI_LLM_ENABLED', false),

    'ollama' => [
        // V compose sieti; port sa zámerne NEpublikuje na hostiteľa.
        'url' => env('AURAAI_OLLAMA_URL', 'http://ollama:11434'),
        'keep_alive' => env('AURAAI_OLLAMA_KEEP_ALIVE', '30m'),
    ],

    /*
     * Modely podľa rozhodnutí #104 / #106 / #111 / #117b.
     * Presné tagy POVINNE overí benchmark v P5 — kým nie sú overené, sú to návrhy.
     */
    'models' => [
        'router' => env('AURAAI_MODEL_ROUTER', 'qwen3:0.6b-q8_0'),
        'escalation' => env('AURAAI_MODEL_ESCALATION', 'nemotron-mini'),
        'embed' => env('AURAAI_MODEL_EMBED', 'multilingual-e5-small'),
    ],

    'embed' => [
        // Zmena dimenzie = prepočet všetkých embeddingov. Nemeniť bez migrácie.
        'dimensions' => (int) env('AURAAI_EMBED_DIMENSIONS', 384),
        'batch' => (int) env('AURAAI_EMBED_BATCH', 32),
    ],

    // Milisekundy. Hodnoty sú akceptačné kritérium P5.
    'timeouts' => [
        'connect' => 5_000,
        'first_token' => 90_000,
        'total' => 300_000,
        'idle' => 30_000,
    ],

    // Kontextový budget — router dostane málo, eskalačný model viac.
    'context' => [
        'router' => ['nodes' => 5, 'chars' => 3_000],
        'escalation' => ['nodes' => 20, 'chars' => 12_000],
    ],

    // Jeden stream naraz; druhá požiadavka dostane stav 'queued', nie chybu.
    'max_concurrent_streams' => 1,

    /*
     * Anthropic zostáva v kóde, vypnutý a nepovinný. Prázdny kľúč NIE JE chyba
     * a nesmie generovať warning ani log.
     */
    'anthropic' => [
        'enabled' => (bool) env('AURAAI_ANTHROPIC_ENABLED', false),
        'key' => env('ANTHROPIC_API_KEY'),
        'model' => env('AURAAI_CHAT_MODEL', 'claude-opus-4-8'),
    ],

];
