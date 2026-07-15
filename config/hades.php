<?php

return [

    // Meno vedomia
    'name' => 'Hades',

    // Hades bezi bez akehokolvek LLM/API. Ucenie prichadza cez MCP z Claude Code;
    // server je cista pamat + vizualizacia. Ziadny externy API kluc netreba.

    // WebSocket adresa tak, ako ju vidi prehliadac (nie docker siet)
    'public_ws_host' => env('HADES_PUBLIC_WS_HOST', 'localhost'),
    'public_ws_port' => (int) env('HADES_PUBLIC_WS_PORT', 8081),

    // Po kolkych minutach bez aktivity vedomie "zaspi"
    'awake_minutes' => (int) env('HADES_AWAKE_MINUTES', 5),

    // Zrkadlenie uzlov do citatelnych .md suborov (Oblast/Oddelenie/uzol.md).
    // DB je zdroj pravdy; subory su odvodene a regenerovatelne cez `mind:export`.
    'mirror_enabled' => (bool) env('HADES_MIRROR_ENABLED', true),
    'mind_path' => env('HADES_MIND_PATH', base_path('mind')),

];
