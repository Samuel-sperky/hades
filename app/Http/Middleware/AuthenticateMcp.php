<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Token guard pre `/mcp`.
 *
 * Do W2 bol `/mcp` úplne otvorený: žiadna autentifikácia, žiadny throttle — a
 * pritom je to ZÁPISOVÝ vstup do dlhodobej pamäte (`aura_learn`,
 * `aura_decision`). Pri zapnutom tuneli to znamenalo verejný zápis do pamäte
 * používateľa. Rozhodnutie #21.
 *
 * Token sa prijíma dvoma cestami:
 *   1. `Authorization: Bearer <token>` — preferované (Claude Code, skripty),
 *   2. `?token=<token>` — konektory v appke Claude vedia poslať len URL, žiadnu
 *      hlavičku. Dá sa vypnúť (`AURAAI_MCP_ALLOW_QUERY_TOKEN=false`).
 *
 * Fail-closed: prázdny token v configu = neprejde nikto (401). Porovnanie je
 * timing-safe cez `hash_equals`. Hodnota tokenu sa nikdy nedostane do odpovede
 * ani do logu.
 *
 * `WWW-Authenticate` sa ZÁMERNE neposiela — appka Claude by ju vyhodnotila ako
 * ponuku OAuth prihlásenia a namiesto tokenu by spustila discovery (to isté
 * ošetruje Caddyfile 404-kou na `/.well-known/oauth-*`).
 */
class AuthenticateMcp
{
    public function handle(Request $request, Closure $next): Response
    {
        // DELETE je ukončenie session podľa Streamable HTTP — nič nečíta ani
        // nezapisuje, ale token vyžadujeme aj tu (jednotné pravidlo).
        $configured = (string) config('mcp.token', '');

        if ($configured === '') {
            return $this->deny('MCP token nie je nakonfigurovaný.');
        }

        $provided = $this->tokenFromRequest($request);

        if ($provided === '' || ! hash_equals($configured, $provided)) {
            return $this->deny('Neplatný MCP token.');
        }

        return $next($request);
    }

    /** Bearer hlavička; ak je povolené, potom query `?token=`. */
    protected function tokenFromRequest(Request $request): string
    {
        $header = (string) $request->header('Authorization', '');

        if (preg_match('/^Bearer\s+(.+)$/i', $header, $m) === 1) {
            return trim($m[1]);
        }

        if (config('mcp.allow_query_token', true)) {
            return trim((string) $request->query('token', ''));
        }

        return '';
    }

    /** JSON-RPC chyba, aby MCP klient dostal zrozumiteľnú odpoveď, nie HTML. */
    protected function deny(string $message): Response
    {
        return response()->json([
            'jsonrpc' => '2.0',
            'id' => null,
            'error' => ['code' => -32001, 'message' => $message],
        ], 401);
    }
}
