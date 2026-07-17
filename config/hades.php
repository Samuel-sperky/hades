<?php

return [

    // Meno vedomia
    'name' => 'Hades',

    // Anthropic API pre chat s vedomim
    'anthropic_api_key' => env('ANTHROPIC_API_KEY'),
    'chat_model' => env('HADES_CHAT_MODEL', 'claude-opus-4-8'),

    // WebSocket adresa tak, ako ju vidi prehliadac (nie docker siet)
    'public_ws_host' => env('HADES_PUBLIC_WS_HOST', 'localhost'),
    'public_ws_port' => (int) env('HADES_PUBLIC_WS_PORT', 8081),

    // Po kolkych minutach bez aktivity vedomie "zaspi"
    'awake_minutes' => (int) env('HADES_AWAKE_MINUTES', 5),

    // Kde su namountovane Claude Code transcripty (read-only) v kontajneri
    'transcripts_path' => env('HADES_TRANSCRIPTS_PATH', '/transcripts'),

    // Zapisovatelny mount pre export vedomia spat do Claude memory (rw).
    // Ak nie je pripojeny, mind:export-memory sa bez chyby preskoci.
    'memory_export_path' => env('HADES_MEMORY_EXPORT_PATH', '/memory-rw/hades'),
    'memory_index_path' => env('HADES_MEMORY_INDEX_PATH', '/memory-rw/MEMORY.md'),

    // Mapovanie projektov (podla nazvu priecinka / cwd) na oblasti mozgu
    'project_area_map' => [
        'Šperky Aura app' => 'biznis-projekty',
        'Banner Gennerator' => 'biznis-projekty',
        'AI-mind' => 'vyvoj-kod',
    ],

    // Oblast pre projekty, ktore nie su v mape
    'project_area_fallback' => 'vyvoj-kod',

];
