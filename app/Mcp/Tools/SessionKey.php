<?php

namespace App\Mcp\Tools;

/**
 * Zdieľaný fragment schémy pre `session_key`. Pôvodne to bola lokálna premenná
 * v `McpController::toolDefinitions()`; po rozdelení na tooly by sa inak
 * duplikovala do troch schém.
 */
final class SessionKey
{
    public static function schema(): array
    {
        return [
            'type' => 'string',
            'description' => 'Current session identifier (any stable string for this conversation). '
                .'Nodes touched in the same session get auto-connected.',
        ];
    }
}
