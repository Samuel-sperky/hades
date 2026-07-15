<?php

return [

    // Meno vedomia
    'name' => 'Hades',

    // Anthropic API pre chat s vedomim
    'anthropic_api_key' => env('ANTHROPIC_API_KEY'),
    'chat_model' => env('HADES_CHAT_MODEL', 'claude-sonnet-5'),

    // WebSocket adresa tak, ako ju vidi prehliadac (nie docker siet)
    'public_ws_host' => env('HADES_PUBLIC_WS_HOST', 'localhost'),
    'public_ws_port' => (int) env('HADES_PUBLIC_WS_PORT', 8081),

    // Po kolkych minutach bez aktivity vedomie "zaspi"
    'awake_minutes' => (int) env('HADES_AWAKE_MINUTES', 5),

];
