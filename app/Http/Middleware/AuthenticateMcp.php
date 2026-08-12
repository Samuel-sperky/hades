<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Token guard pre /mcp.
 *
 * Do 12.8.2026 bol /mcp úplne bez autentifikácie — chránil ho len binding na
 * 127.0.0.1:8080. To nechráni pred ničím, čo beží na tom istom stroji, vrátane
 * 47 docker kontajnerov: ktorýkoľvek lokálny proces mohol volať mind_learn
 * alebo mind_decision. Verejná cesta cez Caddy (:8095) mala token natvrdo
 * zapísaný v docker/Caddyfile.
 *
 * Prijíma `Authorization: Bearer <token>` aj `?token=<token>`. Query varianta
 * je nutnosť, nie pohodlie: connectory appky Claude (mobil/desktop) nevedia
 * poslať vlastnú hlavičku, len URL — preto vznikla aj tá výnimka v Caddyfile.
 *
 * Fail-closed rovnako ako AuthenticateApiToken: prázdny token v konfigu znamená,
 * že neprejde nikto. Porovnanie cez hash_equals (timing-safe).
 */
class AuthenticateMcp
{
    public function handle(Request $request, Closure $next): Response
    {
        $configured = (string) config('hades.mcp_token', '');

        // prázdny token v konfigu = fail-closed
        if ($configured === '') {
            abort(401, 'MCP token nie je nakonfigurovaný.');
        }

        $provided = $this->tokenFromRequest($request);

        if ($provided === '' || ! hash_equals($configured, $provided)) {
            abort(401, 'Neplatný MCP token.');
        }

        return $next($request);
    }

    /** Bearer hlavička má prednosť; query `?token=` je fallback pre Claude connectory. */
    protected function tokenFromRequest(Request $request): string
    {
        $header = (string) $request->header('Authorization', '');

        if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
            return trim($m[1]);
        }

        return trim((string) $request->query('token', ''));
    }
}
