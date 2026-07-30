<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Token pre /mcp
    |--------------------------------------------------------------------------
    |
    | `/mcp` je ZÁPISOVÝ endpoint do dlhodobej pamäte (aura_learn, aura_decision)
    | a appka sa tuneluje verejne. Do W2 bežal bez akejkoľvek autentifikácie.
    |
    | Fail-closed: prázdny token = nikto neprejde (401), rovnaký vzor ako
    | `auraai.api_token` pre /api/v1/*. Radšej odmietnuť všetko než nechať
    | verejne otvorený zápis do pamäte.
    |
    | Fallback na `MCP_QUERY_TOKEN` je zámer: tú istú hodnotu už dostáva Caddy
    | pre `/mcp?token=` maticher, takže jedna premenná v .env chráni obe vrstvy
    | a rotácia je jeden riadok. Ak chceš dva nezávislé secrety, nastav
    | `AURAAI_MCP_TOKEN` a Caddy si nechaj na `MCP_QUERY_TOKEN`.
    |
    | POZOR: pôvodná hodnota `MCP_QUERY_TOKEN` žila plaintextom v git-trackovanom
    | Caddyfile, takže je KOMPROMITOVANÁ a musí sa rotovať.
    */
    'token' => trim((string) env('AURAAI_MCP_TOKEN', '')) !== ''
        ? trim((string) env('AURAAI_MCP_TOKEN', ''))
        : trim((string) env('MCP_QUERY_TOKEN', '')),

    /*
    | Povoliť token aj v query stringu (`/mcp?token=…`)?
    |
    | Konektory v appke Claude vedia poslať len URL, žiadnu hlavičku — bez tohto
    | by sa k pamäti nedostali. Bearer hlavička je vždy preferovaná cesta.
    */
    'allow_query_token' => (bool) env('AURAAI_MCP_ALLOW_QUERY_TOKEN', true),

    /*
    | Throttle pre /mcp v tvare "<pokusov>,<minút>". Recall na začiatku session
    | + priebežné learn/activate sa do 120/min pohodlne zmestia.
    */
    'throttle' => (string) env('AURAAI_MCP_THROTTLE', '120,1'),

    /*
    | Legacy aliasy `mind_*` (rozhodnutie #6).
    |
    | Kanonické názvy sú `aura_*`. `mind_*` zostávajú funkčné, aby Claude Code
    | nestratil prístup k pamäti medzi commitmi — ich definícia je v tools/list
    | označená ako legacy. Vypnutie = jeden riadok v .env, žiadna zmena kódu,
    | až keď je `~/.claude.json` prepnutý na `aura_*`.
    */
    'legacy_aliases' => (bool) env('AURAAI_MCP_LEGACY_ALIASES', true),

    /*
    | E-shop tooly (aura_shop_orders / aura_shop_products).
    |
    | Service vrstvu (App\Services\Sperky\SperkyClient) dodáva samostatný balík.
    | Registrácia je preto za flagom AJ za `class_exists` — kým trieda
    | neexistuje, tooly sa v tools/list neobjavia a nič nespadne.
    |
    | Sprístupňujú obchodné dáta na verejne tunelovanom endpointe, takže
    | default je OFF.
    */
    'shop_tools' => (bool) env('AURAAI_MCP_SHOP_TOOLS', false),

];
