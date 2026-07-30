<?php

/*
 * Vlastník: A3 (balík P5). SKELETON.
 *
 * Systémové prompty a šablóny odpovedí. Zámerne v configu, nie v kóde —
 * ladenie textov nemá znamenať zmenu triedy.
 *
 * Pravidlá: UI a odpovede po slovensky. Model nikdy negeneruje čísla — tie
 * dopĺňa deterministický kód do šablóny (rozhodnutie #112).
 */

return [

    'system' => [
        // Krátky systémový prompt pre router (Qwen3-0.6B). Musí byť krátky —
        // 0,6B model sa dlhými instrukciami rozpadá.
        'router' => '',
        // Systémový prompt pre eskalačný model.
        'escalation' => '',
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

    // Šablónové odpovede vrstvy 1 (TemplateAnswerer). Kľúč = trieda zámeru.
    'templates' => [],

    // Text, ktorý UI zobrazí, keď lokálny model nebeží (meta.degraded = true).
    'degraded_notice' => 'Lokálny model nie je dostupný — odpovedám z pamäte.',

];
