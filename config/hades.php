<?php

return [

    // Meno vedomia
    'name' => 'Hades',

    // Verzia znalostného modelu / API kontraktu (mirror do /api/v1/health)
    'version' => '1.0.0',

    // Bearer token pre externé /api/v1/* (fail-closed: prázdny = nikto neprejde).
    // Interné /api/* (SPA) token nedrží.
    'api_token' => env('HADES_API_TOKEN'),

    // A9 — stropy na dĺžku popisov vo výstupe mind_recall. Popisy rástli bez
    // limitu a jeden recall na širokú tému vracal 77 493 znakov. Prvých
    // `top_count` uzlov (najrelevantnejších) dostane väčší strop.
    'recall_desc_top_count' => (int) env('HADES_RECALL_DESC_TOP_COUNT', 3),
    'recall_desc_top_chars' => (int) env('HADES_RECALL_DESC_TOP_CHARS', 1200),
    'recall_desc_chars' => (int) env('HADES_RECALL_DESC_CHARS', 300),

    // Token pre /mcp (fail-closed). Prijíma sa ako `Authorization: Bearer` aj
    // ako `?token=` — connectory appky Claude nevedia poslať vlastnú hlavičku.
    // Musí sedieť s hodnotou v docker/Caddyfile, kým sa tá neprepne na env.
    'mcp_token' => env('HADES_MCP_TOKEN'),

    // Brain-write guard — zápis do ľudsky písaných .md „mozgov".
    // Default OFF (fail-safe): brain-write endpointy vracajú 403, .md sa nemení.
    'allow_brain_write' => (bool) env('HADES_ALLOW_BRAIN_WRITE', false),

    // Register zdrojov .md „mozgov" indexovaných do siete (origin=brain).
    // BrainSourceRegistry (B2) toto zlúči s DB tabuľkou brain_sources a .env cestami.
    'brain_sources' => [
        'skills' => [
            'type' => 'skills',
            'path' => base_path('skills'),
            'label' => 'Skills',
            'writable' => false,
        ],
        'memory' => [
            'type' => 'claude-memory',
            'path' => env('HADES_MEMORY_EXPORT_PATH', '/memory-rw/hades'),
            'label' => 'Claude memory',
            'writable' => false,
        ],
    ],

    // Externé .md cesty (';' oddelené) — indexované ako origin=brain.
    'brain_paths' => array_values(array_filter(array_map(
        'trim',
        explode(';', (string) env('HADES_BRAIN_PATHS', '')),
    ))),

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

    // Kam sa ukladaju poskladane smernice (prompt builder pre Claude)
    'directives_path' => base_path('directives'),

    // Zname projektove adresare pre 'Suvisiace projekty' v smernici (info-only).
    // Kluc = label projektoveho uzla (case-insensitive), hodnota = cesta.
    'project_dirs' => [
        'AI-mind' => 'C:\\Users\\Ucet\\Desktop\\AI-mind',
        'Šperky Aura app' => 'C:\\Aura\\sperky-ai',
        'Banner Studio' => 'C:\\Aura\\aura-banner-studio',
        'Banner Gennerator' => 'C:\\Aura\\aura-banner-studio',
        'aura-hr-mapa' => 'C:\\Aura\\aura-hr-mapa',
        'aura-logistika' => 'C:\\Aura\\aura-logistika',
    ],

];
