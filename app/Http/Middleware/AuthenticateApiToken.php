<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Bearer-token guard pre externé /api/v1/*.
 *
 * Fail-closed: keď je `auraai.api_token` prázdny, NIKTO neprejde (401) — radšej
 * odmietnuť všetko než otvoriť API bez tokenu. Porovnanie cez hash_equals
 * (timing-safe). Interné /api/* (SPA, same-origin) tento middleware nepoužíva.
 */
class AuthenticateApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $configured = (string) config('auraai.api_token', '');

        // prázdny token v konfigu = fail-closed
        if ($configured === '') {
            abort(401, 'API token nie je nakonfigurovaný.');
        }

        $provided = $this->tokenFromRequest($request);

        if ($provided === '' || ! hash_equals($configured, $provided)) {
            abort(401, 'Neplatný API token.');
        }

        return $next($request);
    }

    /** Vytiahne token z hlavičky `Authorization: Bearer <token>`. */
    protected function tokenFromRequest(Request $request): string
    {
        $header = (string) $request->header('Authorization', '');

        if (preg_match('/^Bearer\s+(.+)$/i', $header, $m)) {
            return trim($m[1]);
        }

        return '';
    }
}
