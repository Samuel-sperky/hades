<?php

return [

    // Meno vedomia
    'name' => 'Hades',

    // Verzia znalostného modelu / API kontraktu (mirror do /api/v1/health)
    'version' => '1.0.0',

    // Bearer token pre externé /api/v1/* (fail-closed: prázdny = nikto neprejde).
    // Interné /api/* (SPA) token nedrží.
    'api_token' => env('HADES_API_TOKEN'),

    // A10 — rýchla cesta recallu cez FULLTEXT index namiesto LIKE '%koreň%'.
    // Default OFF: MATCH ... AGAINST matchuje od začiatku slova, LIKE aj
    // uprostred, takže zapnutie mení pokrytie, nie len rýchlosť. Keď rýchla
    // cesta vráti málo kandidátov, searchNodes aj tak padne späť na LIKE.
    'recall_fulltext' => (bool) env('HADES_RECALL_FULLTEXT', false),

    // A9 — stropy na dĺžku popisov vo výstupe mind_recall. Popisy rástli bez
    // limitu a jeden recall na širokú tému vracal 77 493 znakov. Prvých
    // `top_count` uzlov (najrelevantnejších) dostane väčší strop.
    'recall_desc_top_count' => (int) env('HADES_RECALL_DESC_TOP_COUNT', 3),
    // 1200 znakov bolo z čias, keď skrátený popis znamenal, že text je nedostupný.
    // Odkedy existuje mind_read, je to len súhrn a AI si zvyšok vie dotiahnuť —
    // namerané: 1200 → 900 ubralo 2 515 B (6,6 %) z troch dopytov bez straty zmyslu.
    'recall_desc_top_chars' => (int) env('HADES_RECALL_DESC_TOP_CHARS', 900),
    'recall_desc_chars' => (int) env('HADES_RECALL_DESC_CHARS', 300),

    // Sused pritiahnutý hranou má polovičnú relevanciu, nech má aj polovičný
    // strop — je to kontext, nie odpoveď.
    'recall_desc_neighbor_chars' => (int) env('HADES_RECALL_DESC_NEIGHBOR_CHARS', 200),

    // Strop na počet tagov v jednom uzle recallu. Najhorší uzol na živých dátach
    // nesie 38 tagov — to je 400 B abecedy na jeden riadok odpovede. Do stropu
    // idú najprv tagy, ktoré trafil dopyt.
    'recall_tag_cap' => (int) env('HADES_RECALL_TAG_CAP', 8),

    // Koľko labelov spojení pripojiť k uzlu v recalle. Toto je celá hodnota
    // grafu v odpovedi — 0 vypne štruktúru a recall bude opäť plochý zoznam.
    // Pokrytie štruktúrou je nasýtené už pri 2 (`via` pokrýva susedov), takže 3
    // je kompromis: lokálna mapa okolo uzla za 4 977 B namiesto 6 384 B pri 4.
    'recall_related_cap' => (int) env('HADES_RECALL_RELATED_CAP', 3),

    // Koľko spojení vypísať v mind_read (tam si o uzol AI vyslovene povedala).
    'read_related_cap' => (int) env('HADES_READ_RELATED_CAP', 20),

    // Strop na tagy v markdownovom balíku pre Claude Code (uzol s 38 tagmi je
    // pol kilobajtu abecedy). Zvyšok sa spočíta, nezmizne mlčky.
    'pack_tag_cap' => (int) env('HADES_PACK_TAG_CAP', 12),

    // Koľko najpoužívanejších tagov ponúknuť v mind_overview ako slovník.
    'overview_top_tags' => (int) env('HADES_OVERVIEW_TOP_TAGS', 24),

    // Token pre /mcp (fail-closed). Prijíma sa ako `Authorization: Bearer` aj
    // ako `?token=` — connectory appky Claude nevedia poslať vlastnú hlavičku.
    // Musí sedieť s hodnotou v docker/Caddyfile, kým sa tá neprepne na env.
    'mcp_token' => env('HADES_MCP_TOKEN'),

    // Token pre UI okruh — dashboard `/` aj interné `/api/*` (AuthenticateUi).
    // Fail-closed: prázdny = 401 pre všetkých, vrátane dashboardu. Prijíma sa ako
    // `?token=` (jednorazové odomknutie v prehliadači, ďalej drží session cookie)
    // aj ako hlavička `X-Hades-Ui-Token`, ktorú na verejnej ceste vkladá Caddy.
    // Zámerne NIE je totožný s api_token ani mcp_token — únik UI tokenu nesmie
    // dať prístup k programatickému /api/v1 ani k /mcp.
    'ui_token' => env('HADES_UI_TOKEN'),

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
