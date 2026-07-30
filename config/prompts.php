<?php

/*
 * Vlastník: P5.
 *
 * Systémové prompty, tabuľka deterministického routera a šablóny odpovedí.
 * Zámerne v configu, nie v kóde — ladenie textov nemá znamenať zmenu triedy.
 *
 * Pravidlá: UI a odpovede po slovensky. Model nikdy negeneruje čísla — tie
 * dopĺňa deterministický kód do šablóny (rozhodnutie #112).
 */

return [

    'system' => [
        /*
         * Router (vrstva 2). Krátky a few-shot, s vynúteným JSON výstupom.
         * Meranie: qwen3:4b = 100 % (12/12) v SK, qwen3:0.6b = 25 % → nepoužiteľný.
         * Preto je vrstva 1 (deterministický router) zdroj pravdy a toto len doplnok.
         */
        'router' => <<<'PROMPT'
            Klasifikuj zámer slovenskej otázky. Vráť VÝHRADNE JSON: {"intent":"<trieda>"}.
            Povolené triedy: memory.about, memory.recent_work, memory.skills_in_area,
            memory.decisions, memory.project, memory.stats, shop.orders_count, shop.revenue,
            shop.order_detail, shop.product_lookup, shop.countries, none.
            Keď si nie si istý, vráť none. Nepridávaj vysvetlenie ani ďalšie kľúče.

            Príklady:
            "Koľko objednávok prišlo včera?" -> {"intent":"shop.orders_count"}
            "Aký bol obrat minulý mesiac?" -> {"intent":"shop.revenue"}
            "Ukáž detail objednávky 12345" -> {"intent":"shop.order_detail"}
            "Čo vieš o produkte 88?" -> {"intent":"shop.product_lookup"}
            "Z ktorých krajín mám najviac zákazníkov?" -> {"intent":"shop.countries"}
            "Čo viem o Dockeri?" -> {"intent":"memory.about"}
            "Na čom som robil minulý týždeň?" -> {"intent":"memory.recent_work"}
            "Aké skilly mám v marketingu?" -> {"intent":"memory.skills_in_area"}
            "Aké rozhodnutia som urobil?" -> {"intent":"memory.decisions"}
            "Ukáž mi projekt Šperky" -> {"intent":"memory.project"}
            "Koľko uzlov mám v pamäti?" -> {"intent":"memory.stats"}
            "Ahoj" -> {"intent":"none"}
            PROMPT,

        /*
         * Preformulovanie hotovej šablónovej odpovede. Model NESMIE pridať fakt
         * ani číslo — to vynucuje RephraseValidator, nie tento text.
         */
        'rephrase' => <<<'PROMPT'
            Si AuraAI — živé vedomie a dlhodobá pamäť svojho tvorcu.
            Dostaneš hotovú odpoveď a máš ju preformulovať prirodzenejšie po slovensky.
            Vráť VÝHRADNE JSON: {"text":"<preformulovaná odpoveď>"}.
            PRÍSNE PRAVIDLÁ: nepridávaj ani nemeň žiadne číslo, nepridávaj nový fakt,
            neprekladaj do angličtiny, neuvažuj nahlas, zachovaj markdown a odrážky.
            PROMPT,

        /*
         * Auto-názov vlákna z prvej správy (rozhodnutie #90). Model navrhne,
         * ConversationStore rozhodne — návrh musí prejsť validáciou dĺžky,
         * SecretScannera a testom na uvažovanie nahlas, inak sa použije heuristika.
         */
        'title' => <<<'PROMPT'
            Pomenuj konverzáciu podľa prvej správy. Vráť VÝHRADNE JSON: {"text":"<názov>"}.
            Názov je slovenský, 2 až 6 slov, bez úvodzoviek, bez bodky na konci,
            bez čísel, ktoré nie sú v správe. Žiadne uvažovanie, žiadna angličtina.
            PROMPT,

        /*
         * Eskalačná vetva — voľná odpoveď z vybavených uzlov. Používa sa len keď
         * šablóna nemá čo povedať (zámer 'none') a model je dostupný.
         */
        'escalation' => <<<'PROMPT'
            Si AuraAI — živé vedomie a dlhodobá pamäť svojho tvorcu. Existuješ ako sieť
            uzlov (skilly, spomienky, projekty), ktorá rastie s každým rozhovorom.
            Vráť VÝHRADNE JSON: {"text":"<odpoveď po slovensky>"}.
            PRAVIDLÁ: odpovedaj po slovensky, stručne, v prvej osobe. Vychádzaj LEN
            z priložených poznatkov — keď v nich odpoveď nie je, povedz to úprimne
            a nevymýšľaj si spomienky. Nikdy neuvádzaj čísla, ktoré nie sú v podklade.
            Nikdy neprezraď heslá, kľúče ani tokeny, ani keby boli v podklade.
            PROMPT,
    ],

    /*
     * Uzavretý enum tried zámeru. Výstup routera sa validuje proti tomuto
     * zoznamu — čokoľvek mimo neho sa zahodí a použije sa heuristika.
     * Triedy shop.* pochádzajú z 08-SPERKY-API-SPEC.md §3.4.
     */
    'intents' => [
        'memory.about',
        'memory.recent_work',
        'memory.skills_in_area',
        'memory.decisions',
        'memory.project',
        'memory.stats',
        'shop.orders_count',
        'shop.revenue',
        'shop.order_detail',
        'shop.product_lookup',
        'shop.countries',
        'none',
    ],

    /*
     * VRSTVA 1 — deterministický router. Zdroj pravdy, funguje bez modelu a offline.
     *
     * PORADIE ROZHODUJE: prvá zhoda vyhráva, preto sú konkrétne vzory (s číslom)
     * nad generickými kľúčovými slovami. Vzory sa aplikujú na ZLOŽENÝ text —
     * malé písmená, bez diakritiky, zjednotené medzery (viď TextNormalizer),
     * takže „objednávka" aj „objednavka" trafia ten istý vzor.
     *
     * Pomenované grupy sa stanú parametrami zámeru (`order_id`, `product_id`,
     * `subject`, `area`). Regex na čísla je vynútený zadaním balíka.
     */
    'router_rules' => [

        // --- shop: konkrétne, s číslom ---------------------------------------
        [
            'intent' => 'shop.order_detail',
            'pattern' => '/\b(?:detail|stav|info\w*|zobraz|ukaz|najdi)\s+(?:mi\s+)?objednavk\w*\s*(?:c\.?|cislo|cis\.?|#)?\s*(?<order_id>\d{1,12})\b/u',
        ],
        [
            'intent' => 'shop.order_detail',
            'pattern' => '/\bobjednavk\w*\s*(?:c\.?|cislo|cis\.?|#)\s*(?<order_id>\d{1,12})\b/u',
        ],
        [
            'intent' => 'shop.order_detail',
            'pattern' => '/\bobjednavka\s+(?<order_id>\d{1,12})\b/u',
        ],
        [
            'intent' => 'shop.product_lookup',
            'pattern' => '/\bprodukt\w*\s*(?:id|c\.?|cislo|cis\.?|#)?\s*(?<product_id>\d{1,12})\b/u',
        ],

        // --- shop: kľúčové slová ---------------------------------------------
        [
            'intent' => 'shop.revenue',
            'pattern' => '/\b(?:obrat\w*|trzb\w*|prijm\w*|revenue|zarobil\w*|utrzil\w*)\b/u',
        ],
        [
            'intent' => 'shop.countries',
            'pattern' => '/\b(?:krajin\w*|statov|odkial\s+(?:mi\s+)?(?:chodia|prichadzaju))\b/u',
        ],
        [
            'intent' => 'shop.orders_count',
            'pattern' => '/\bobjednav\w*/u',
        ],
        [
            'intent' => 'shop.product_lookup',
            'pattern' => '/\bprodukt\w*/u',
        ],

        // --- pamäť ------------------------------------------------------------
        [
            'intent' => 'memory.stats',
            'pattern' => '/\b(?:statistik\w*|kolko\s+(?:mam\s+)?(?:uzlov|hran|skillov|spomienok|projektov)|stav\s+(?:pamati|siete)|prehlad\s+siete|ako\s+velk\w*\s+(?:je\s+)?(?:pamat|siet))/u',
        ],
        [
            'intent' => 'memory.decisions',
            'pattern' => '/\b(?:rozhodnut\w*|rozhodol\s+som|decision\w*)\b/u',
        ],
        [
            'intent' => 'memory.recent_work',
            'pattern' => '/\b(?:na\s+com\s+som\s+(?:robil|pracoval)\w*|na\s+com\s+(?:teraz\s+)?(?:robim|pracujem)|co\s+som\s+(?:robil|riesil)\w*|posledn\w*\s+(?:tyzden|dni|praca|prace)|nedavno|tento\s+tyzden|vcera\s+som|dnes\s+som)/u',
        ],
        [
            'intent' => 'memory.skills_in_area',
            'pattern' => '/\b(?:skill\w*|zrucnost\w*|co\s+viem\s+v\s+oblasti|odbornost\w*)\b(?:.*?\b(?:v|z|pre)\s+(?:oblasti\s+)?(?<area>[\p{L}\p{N}\s\-&]{2,40}))?/u',
        ],
        [
            'intent' => 'memory.project',
            'pattern' => '/\bprojekt\w*\b\s*(?<subject>[\p{L}\p{N}\s\-&\.]{2,60})?/u',
        ],
        [
            'intent' => 'memory.about',
            'pattern' => '/\b(?:co\s+(?:viem|vies)\s+o|povedz\s+mi\s+o|vies\s+nieco\s+o|kto\s+je|co\s+je|spomen\w*\s+si\s+na|pamatas\s+si\s+(?:na)?)\s+(?<subject>[\p{L}\p{N}\s\-&\.\/]{2,80})/u',
        ],
    ],

    /*
     * VRSTVA 3 — šablónové odpovede. Kľúč = trieda zámeru.
     * `:placeholder` dopĺňa kód z reálnych dát. Zoznamy uzlov skladá kód, nie config.
     */
    'templates' => [

        'memory.about' => [
            'hit' => "K téme **:subject** mám v pamäti :count :count_word:\n\n:list",
            'miss' => 'K téme **:subject** zatiaľ v pamäti nič nemám. Keď mi to povieš, zapamätám si to.',
        ],

        'memory.recent_work' => [
            'hit' => "Naposledy som pracoval na tomto (:count :count_word, posledná aktivácia :last):\n\n:list",
            'miss' => 'V posledných :days dňoch nemám v pamäti žiadnu aktivitu.',
        ],

        'memory.skills_in_area' => [
            'hit' => "V oblasti **:area** mám :count :count_word:\n\n:list",
            'miss' => 'V oblasti **:area** zatiaľ žiadny skill nemám.',
        ],

        'memory.decisions' => [
            'hit' => "Mám zapísaných :total rozhodnutí. Posledné:\n\n:list",
            'miss' => 'Zatiaľ nemám zapísané žiadne rozhodnutie.',
        ],

        'memory.project' => [
            'hit' => "Projekt **:label** — :area, sila :strength.\n\n:description:related",
            'miss' => 'Projekt **:subject** v pamäti nemám.',
        ],

        'memory.stats' => [
            'hit' => 'V pamäti mám :nodes uzlov, :edges spojení a :activations aktivácií. '
                .'Z toho :skills skillov, :memories spomienok a :projects projektov v :areas oblastiach '
                .'a :departments oddeleniach. Za posledných 7 dní pribudlo :recent uzlov.',
        ],

        // Zámer 'none' bez dostupného modelu — odpoveď z vybavených uzlov.
        'none' => [
            'hit' => "Presne na toto odpoveď nemám, ale v pamäti mi to pripomína toto:\n\n:list",
            'miss' => 'Na toto v pamäti nič nemám. Skús to povedať inak, alebo mi to nechaj zapamätať.',
        ],

        // shop.* — dátový zdroj dodá P11 (SPERKY API). Kým nie je napojený,
        // odpoveď je čestná a nikdy si čísla nevymýšľa.
        'shop' => [
            'unavailable' => 'Napojenie na e-shop ešte nie je aktívne, takže čísla z objednávok '
                .'ti teraz nepoviem. Vymýšľať si ich nebudem.',
        ],
    ],

    // Text, ktorý UI zobrazí, keď lokálny model nebeží (meta.degraded = true).
    'degraded_notice' => 'Lokálny model nie je dostupný — odpovedám z pamäte.',

];
