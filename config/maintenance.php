<?php

/*
 * Vlastník: balík P2 (údržba vedomia).
 *
 * Zbiera na jedno miesto všetko, čo riadi nočnú údržbu: prepínač deštruktívnych
 * jobov, prahy, dry-run report a stropy pre rewire. Predtým boli prahy zadrotované
 * ako konštanty v troch príkazoch a prepínač v zdieľanom config/auraai.php.
 *
 * DÔLEŽITÉ: 'destructive_enabled' je fail-safe FALSE. Zapnutie schvaľuje výhradne
 * používateľ po prečítaní dry-run reportu (rozhodnutie #32). Žiadny balík ho
 * nesmie zapnúť sám ani v .env.example.
 */

return [

    /*
     * Guard pre DEŠTRUKTÍVNE nočné joby: mind:cleanup-edges,
     * mind:prune-coactivation, mind:automerge. Nevratne mažú hrany a zlučujú uzly
     * nad jedinou kópiou pamäte. Ich prahy sú kalibrované na TF-IDF; pri prechode
     * na embeddingy znamenajú niečo úplne iné.
     *
     * Číta rovnakú env premennú ako pôvodný config('auraai.destructive_jobs_enabled'),
     * takže presun prepínača do tohto configu nemení chovanie ani nasadenie.
     */
    'destructive_enabled' => (bool) env('AURAAI_DESTRUCTIVE_JOBS', false),

    /*
     * Prahy deštruktívnych jobov — hodnoty sú 1:1 prevzaté z konštánt v príkazoch,
     * aby ich presun do configu nezmenil výsledok. Rekalibráciu robí W3 na základe
     * dry-run reportu, nie tento balík.
     */
    'thresholds' => [
        // mind:automerge — kosínus >= prah ⇒ slabší uzol sa zlúči do silnejšieho
        'automerge' => (float) env('AURAAI_THRESHOLD_AUTOMERGE', 0.92),
        // mind:prune-coactivation — kosínus < prah ⇒ jednorazová co-aktivácia je koincidencia
        'prune_coactivation' => (float) env('AURAAI_THRESHOLD_PRUNE', 0.08),
        // mind:cleanup-edges — auto similarity/co_activation hrany pod váhou a staršie ako N dní
        'cleanup_edges' => [
            'max_weight' => (float) env('AURAAI_CLEANUP_MAX_WEIGHT', 1.0),
            'older_than_days' => (int) env('AURAAI_CLEANUP_DAYS', 90),
        ],
        // mind:rewire A3 — prah pre backfill similarity synapsií
        'rewire_similarity' => (float) env('AURAAI_THRESHOLD_REWIRE', 0.20),
    ],

    /*
     * Dry-run report — čo BY deštruktívne joby urobili, s labelmi konkrétnych párov.
     * Nikdy nič nemení; beží nad live dátami len na čítanie.
     */
    'dry_run' => [
        // Relatívne k storage/app. Report je JSON + čitateľný Markdown.
        'path' => env('AURAAI_DRY_RUN_PATH', 'dry-run'),

        /*
         * DVOJITÁ METRIKA. Report sa počíta pre každú dostupnú metriku zvlášť, aby
         * W3 mohla porovnať, čo prahy znamenajú na TF-IDF a čo na embeddingoch.
         * 'embeddings' sa automaticky preskočí (a v reporte označí ako nedostupná),
         * kým stĺpec nodes.embedding neexistuje alebo je prázdny — vlastníkom
         * embeddingov je P1, tento balík ich nevyrába.
         */
        'metrics' => ['tfidf', 'embeddings'],

        // Koľko konkrétnych párov s labelmi sa vypíše do reportu na jeden job.
        // 0 = všetky. Zvyšok sa len spočíta.
        'sample_size' => (int) env('AURAAI_DRY_RUN_SAMPLE', 200),

        // Poistka proti O(n²) výbuchu pri raste siete. 0 = bez stropu.
        // Dnes je najväčšia automerge skupina rádovo 10^5 párov.
        'max_pairs' => (int) env('AURAAI_DRY_RUN_MAX_PAIRS', 2_000_000),

        // Koľko reportov na job+metriku sa drží; staršie sa mažú pri novom behu.
        // Mažú sa VÝHRADNE súbory reportov, nikdy dáta.
        'keep_reports' => (int) env('AURAAI_DRY_RUN_KEEP', 10),
    ],

    /*
     * sync_runs retention. Dnes 1 005 riadkov za 13 dní, 100 % no-op behov,
     * prírastok ~144/deň (rozhodnutie #36). Riešenie je dvojité:
     *   1) 'keep_noop' = false ⇒ beh, ktorý nič neurobil, sa vôbec nezapíše
     *      (vyžaduje patch v BrainSyncService — vlastní P3, viď report P2),
     *   2) rotácia starších než 'retention_days' cez aura:sync-runs-prune.
     */
    'sync_runs' => [
        'retention_days' => (int) env('AURAAI_SYNC_RUNS_RETENTION_DAYS', 30),

        // false = no-op beh (0 created/updated/deleted/edges/flagged) sa nezapisuje.
        // PREVENCIA — číta to BrainSyncService pred zápisom (patch, vlastní P3).
        'keep_noop' => (bool) env('AURAAI_SYNC_RUNS_KEEP_NOOP', false),

        /*
         * JEDNORAZOVÉ vyčistenie historických no-op behov (dnes 1 226 riadkov, ktoré
         * vznikli pred prevenciou). Default OFF — je to mazanie 1 226 riadkov a
         * mazanie dát sa nikdy nerobí autonómne, ani nad audit logom.
         *
         * Rotácia podľa veku (retention_days) sa deje tak či tak; toto je len
         * dobehnutie histórie. Zapína používateľ: `aura:sync-runs-prune --purge-noop`
         * (najprv `--dry-run`, aby videl počty).
         */
        'purge_historical_noop' => (bool) env('AURAAI_SYNC_RUNS_PURGE_NOOP', false),

        // Aj pri prázdnom výsledku sa vždy nechá aspoň N najnovších záznamov,
        // aby StatsController::latest() nikdy nezostal bez „posledný beh".
        'keep_last' => (int) env('AURAAI_SYNC_RUNS_KEEP_LAST', 20),

        // Chybové a čiastočné behy sú diagnostika — mažú sa až po dlhšom čase.
        'retention_days_failed' => (int) env('AURAAI_SYNC_RUNS_RETENTION_DAYS_FAILED', 90),
    ],

    /*
     * mind:rewire / aura:rewire — stropy času a veľkosti.
     *
     * Rewire je O(n²): pri 666 uzloch je to ~221 000 párov a beží v 15-minútovom
     * okne pred mind:decay (04:05 → 04:20). Bez stropu by rast siete jedného dňa
     * spôsobil, že rewire pretečie do decay-u a oba joby budú súťažiť o rovnaké
     * hrany.
     *
     * Stropy sú zámerne veľkorysé — sú POISTKA, nie zmena chovania. Pri dnešnej
     * veľkosti siete sa žiadny z nich nedosiahne, takže výsledok je identický
     * s pôvodným monolitom. Keď sa strop dosiahne, orchestrátor dokončí rozbehnutý
     * algoritmus, zostávajúce preskočí a nahlási to (žiadny čiastočný zápis
     * v strede jedného algoritmu).
     */
    'rewire' => [
        // 13 minút z 15-minútového okna; zostávajúce 2 min sú rezerva na dobehnutie.
        'max_seconds' => (int) env('AURAAI_REWIRE_MAX_SECONDS', 780),

        // Strop porovnaných párov naprieč všetkými algoritmami. 0 = bez stropu.
        // Dnes ~221 000 → 4,5× rezerva.
        'max_pairs' => (int) env('AURAAI_REWIRE_MAX_PAIRS', 1_000_000),

        // Strop uzlov v hlavnej A3/A4 slučke. 0 = bez stropu.
        'max_nodes' => (int) env('AURAAI_REWIRE_MAX_NODES', 5_000),

        // Logovať trvanie každého algoritmu zvlášť (rozhodnutie #41).
        'log_timings' => (bool) env('AURAAI_REWIRE_LOG_TIMINGS', true),
    ],

];
