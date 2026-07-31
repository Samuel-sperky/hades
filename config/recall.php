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
         *            DEFAULT od vlny 3: prahy mostu sú skalibrované na 709 uzloch
         *            (viď `bridge_*` nižšie). Regresný test 15 dopytov z
         *            VLNA2-RECALL-BENCH.md: 14 top-5 bit-identických s 'rerank',
         *            jediná zmena je zlepšenie (`complaint claims` konečne vráti
         *            `Reklamácie a zodpovednosť za vady` #500).
         *            Rollback bez deployu: AURAAI_RECALL_VECTOR_MODE=rerank.
         */
        'mode' => env('AURAAI_RECALL_VECTOR_MODE', 'expand'),

        /*
         * Minimálny kosínus, aby vektorový kandidát vôbec vstúpil do POOLU v režime
         * 'expand'. NIE JE to žiadny zo štyroch zamknutých prahov (0.92 / 0.20 /
         * 0.08 / 0.18) — tie zostávajú na TF-IDF a kalibruje ich W3.
         *
         * Musí platiť `min_score <= bridge_min_score` (nižšie), inak pool-prah
         * ticho zruší promóciu mostu. Vlna 3 znížila 0,55 → 0,51, aby sa do poolu
         * dostali skalibrované mosty (`tax` → `DPH pre e-shop` 0,5184).
         */
        'min_score' => (float) env('AURAAI_RECALL_VECTOR_MIN', 0.51),

        // Koľko vektorových kandidátov sa najviac pridá v režime 'expand'.
        'candidates' => (int) env('AURAAI_RECALL_VECTOR_CANDIDATES', 12),

        /*
         * MOST (SK↔EN, rozhodnutie #30) — tri parametre radenia v `HybridScorer`.
         *
         * `min_score` (vyššie) rozhoduje, čo sa vôbec dostane do POOLU. Tieto tri
         * rozhodujú, čo z poolu smie predbehnúť lexikálny zásah. Bez nich most
         * neprešiel nikdy: najlepší možný most dá kľúč 1 000 999, najslabší
         * lexikálny zásah 10 000 000 (VLNA2-RECALL-BENCH §3.4).
         *
         * bridge_min_score — kosínus, nad ktorým sa most PROMUJE do najnižšieho
         *   lexikálneho pásma. Kalibrované empiricky na 709 uzloch skriptom
         *   `storage/app/dry-run/bench-bridge-a01.php` na šiestich termínoch MIMO
         *   `canon` (refund · packaging · fraud · loyalty · tax · parcel tracking).
         *   Okno je ÚZKE a to je samostatný nález:
         *     0,52 → stratíme dva najlepšie mosty (`tax` → `DPH pre e-shop` 0,5184,
         *            `fraud` → `Zakázané praktiky` 0,5133)
         *     0,51 → zvolené: 4 mosty, z toho 3 relevantné
         *     0,50 → navrch pustí dva zjavné nezmysly (`fraud` → `Cenotvorba` 0,5008,
         *            `tax` → `KPI report oddelení` 0,5032)
         *   Nezhodné SK↔EN páry na bge-m3 sedia okolo 0,35, zhodné okolo 0,77;
         *   pásmo 0,50–0,57 je zmiešané, preto naň nestačí prah samotný a je tu
         *   ešte penalizácia a kvóta.
         *
         * bridge_penalty — koľko kosínusu most „stratí" pri vstupe do pásma, aby
         *   neprebil skutočný lexikálny zásah s porovnateľným kosínusom.
         *   Odčítanie, nie násobenie: použiteľné okno bge-m3 je úzke (0,35–0,77),
         *   násobenie by pri nízkych kosínusoch nerobilo takmer nič. 0,08 je ~19 %
         *   toho okna; pri 0,15 už most nepredbehne nič a oprava je zbytočná,
         *   pri 0,05 sa most tlačí do top-2 aj keď lexikálny zásah je lepší.
         *
         * bridge_slots — strop počtu mostov vo výsledku. Pri limite 5 tak most
         *   nikdy nevytlačí viac než 2 lexikálne zásahy.
         */
        'bridge_min_score' => (float) env('AURAAI_RECALL_BRIDGE_MIN', 0.51),
        'bridge_penalty' => (float) env('AURAAI_RECALL_BRIDGE_PENALTY', 0.08),
        'bridge_slots' => (int) env('AURAAI_RECALL_BRIDGE_SLOTS', 2),
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
