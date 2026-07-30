<?php

/*
 * Vlastník: balík P1 (RecallEngine + embeddingová vrstva).
 *
 * Doménový config recallu. `config/llm.php` (P5) drží providerov a modely pre
 * chat; tento súbor drží len to, čo rozhoduje o vyhľadávaní vo vedomí.
 *
 * ŽELEZNÉ PRAVIDLO: lexikálna (TF-IDF) vetva je POVINNÁ a prvotriedna. Vektorová
 * vetva je druhé skóre navrch a smie sa kedykoľvek vynechať bez chyby — keď
 * Ollama nebeží, recall je bit-identický s dnešným stavom.
 */

return [

    'vector' => [
        /*
         * null  = auto (vetva sa použije, keď provider hlási embed a v DB sú vektory)
         * false = úplne vypnuté (čisté TF-IDF)
         * true  = vynútené (aj tak sa vynechá, keď provider vráti prázdny vektor)
         */
        'enabled' => env('AURAAI_RECALL_VECTOR') === null
            ? null
            : filter_var(env('AURAAI_RECALL_VECTOR'), FILTER_VALIDATE_BOOLEAN),

        /*
         * 'rerank' — vektor je DRUHÉ skóre nad lexikálnymi kandidátmi. Tvrdý prah
         *            zostáva: uzol bez term-hitu sa nikdy nevráti. Toto je default,
         *            lebo nemení množinu výsledkov, len poradie v rámci rovnakého
         *            počtu zhodných konceptov.
         * 'expand' — vektor smie PRIDAŤ kandidátov, ktorých lexikálna vetva nenašla
         *            (to je akceptačné kritérium 28: SK dopyt mimo slovníka `canon`).
         *            Zapína sa až po kalibrácii prahov vo vlne W3 — škála bge-m3 je
         *            iná než TF-IDF (viď docs/BENCHMARK-LLM.md §3, varovanie k prahom).
         */
        'mode' => env('AURAAI_RECALL_VECTOR_MODE', 'rerank'),

        /*
         * Minimálny kosínus, aby vektorový kandidát vôbec vstúpil do hry v režime
         * 'expand'. NIE JE to žiadny zo štyroch zamknutých prahov (0.92 / 0.20 /
         * 0.08 / 0.18) — tie zostávajú na TF-IDF a kalibruje ich W3. Hodnota je
         * odvodená z merania: nezhodné SK↔EN páry na bge-m3 sedia okolo 0,352,
         * zhodné okolo 0,771.
         */
        'min_score' => (float) env('AURAAI_RECALL_VECTOR_MIN', 0.55),

        // Koľko vektorových kandidátov sa najviac pridá v režime 'expand'.
        'candidates' => (int) env('AURAAI_RECALL_VECTOR_CANDIDATES', 12),
    ],

    'embed' => [
        /*
         * bge-m3 / 1024 dim — jediný z troch meraných modelov s NULOVÝM prekryvom
         * na SK↔EN pároch (docs/BENCHMARK-LLM.md §3). `multilingual-e5-small`
         * z rozhodnutia #111 v Ollama registri neexistuje.
         *
         * Zmena modelu alebo dimenzie = prepočet celého korpusu. `aura:embed`
         * to zvládne sám (mení sa embedding_model → uzly sú „stale"), ale je to
         * dávkový beh, nie tichá zmena za behu.
         */
        'model' => env('AURAAI_EMBED_MODEL', 'bge-m3'),
        'dimensions' => (int) env('AURAAI_EMBED_DIMENSIONS', 1024),

        // Koľko textov ide do providera v jednej dávke.
        'batch' => (int) env('AURAAI_EMBED_BATCH', 16),

        // Strop dĺžky textu poslaného do embeddingu (znaky). Chráni prompt budget.
        'max_chars' => (int) env('AURAAI_EMBED_MAX_CHARS', 2_000),

        /*
         * Sekundy, počas ktorých sa drží vektor DOPYTU v cache. NIE JE to prah
         * relevancie — žiadny zo štyroch zamknutých prahov (0.92 / 0.20 / 0.08 /
         * 0.18) sa tým nemení.
         *
         * Meranie (700 uzlov, bge-m3): round-trip do Ollamy za vektor dopytu je
         * p50 129 ms, teda 76 % latencie vektorovej vetvy. Rovnaký text + model
         * dá vždy bit-identický vektor, takže cache nemôže vrátiť zlý výsledok
         * a TTL je len strop pamäte. 0 = vypnuté.
         */
        'query_cache_ttl' => (int) env('AURAAI_EMBED_QUERY_CACHE_TTL', 300),
    ],

];
