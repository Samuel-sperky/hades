<?php

return [

    // Meno vedomia
    'name' => env('APP_NAME', 'AuraAI'),

    // Verzia znalostného modelu / API kontraktu (mirror do /api/v1/health)
    'version' => '1.0.0',

    // Bearer token pre externé /api/v1/* (fail-closed: prázdny = nikto neprejde).
    // Interné /api/* (SPA) token nedrží.
    'api_token' => env('AURAAI_API_TOKEN'),

    // Brain-write guard — zápis do ľudsky písaných .md „mozgov".
    // Default OFF (fail-safe): brain-write endpointy vracajú 403, .md sa nemení.
    'allow_brain_write' => (bool) env('AURAAI_ALLOW_BRAIN_WRITE', false),

    // Guard pre DEŠTRUKTÍVNE nočné joby: mind:cleanup-edges, mind:prune-coactivation,
    // mind:automerge. Nevratne mažú hrany a zlučujú uzly. Ich prahy (weight<1/90d, 0.08,
    // 0.92) sú kalibrované na TF-IDF skóre — pri prechode na embeddingy znamenajú niečo
    // úplne iné. Default OFF (fail-safe): zapnúť až po rekalibrácii a schválenom
    // --dry-run reporte na reálnych dátach. Rozhodnutie #32.
    'destructive_jobs_enabled' => (bool) env('AURAAI_DESTRUCTIVE_JOBS', false),

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
            'path' => env('AURAAI_MEMORY_EXPORT_PATH', '/memory-rw/hades'),
            'label' => 'Claude memory',
            'writable' => false,
        ],
    ],

    // Externé .md cesty (';' oddelené) — indexované ako origin=brain.
    'brain_paths' => array_values(array_filter(array_map(
        'trim',
        explode(';', (string) env('AURAAI_BRAIN_PATHS', '')),
    ))),

    // Anthropic API pre chat s vedomim
    'anthropic_api_key' => env('ANTHROPIC_API_KEY'),
    'chat_model' => env('AURAAI_CHAT_MODEL', 'claude-opus-4-8'),

    // WebSocket adresa tak, ako ju vidi prehliadac (nie docker siet)
    'public_ws_host' => env('AURAAI_PUBLIC_WS_HOST', 'localhost'),
    'public_ws_port' => (int) env('AURAAI_PUBLIC_WS_PORT', 8083),

    // Port, na ktorom je appka dostupna PRIAMO na hostitelovi (mimo Caddy proxy).
    // Frontend podla neho rozlisi priamy pristup od tunelovaneho a vyberie spravny
    // WebSocket ciel. Nesmie byt zadrotovany v JS — presun appky na iny port by
    // tichym sposobom rozbil zive pulzy.
    'public_app_port' => (string) env('AURAAI_PUBLIC_APP_PORT', '8082'),

    // Po kolkych minutach bez aktivity vedomie "zaspi"
    'awake_minutes' => (int) env('AURAAI_AWAKE_MINUTES', 5),

    // Kde su namountovane Claude Code transcripty (read-only) v kontajneri
    'transcripts_path' => env('AURAAI_TRANSCRIPTS_PATH', '/transcripts'),

    // Zapisovatelny mount pre export vedomia spat do Claude memory (rw).
    // Ak nie je pripojeny, mind:export-memory sa bez chyby preskoci.
    'memory_export_path' => env('AURAAI_MEMORY_EXPORT_PATH', '/memory-rw/hades'),
    'memory_index_path' => env('AURAAI_MEMORY_INDEX_PATH', '/memory-rw/MEMORY.md'),

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
