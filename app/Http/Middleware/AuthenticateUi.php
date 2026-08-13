<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guard pre UI okruh — dashboard (`/`) aj interné `/api/*`, ktoré volá SPA.
 *
 * Do 13. 8. 2026 boli interné `/api/*` úplne bez autentifikácie a chránil ich
 * len binding na 127.0.0.1:8080 — tá istá diera, akú sme 12. 8. 2026 zavreli na
 * `/mcp`. Ktorýkoľvek lokálny proces vrátane cudzích docker kontajnerov si vedel
 * prečítať celú pamäť a zapisovať do nej (`POST /api/nodes`,
 * `DELETE /api/nodes/{id}`, `PUT /api/departments/{id}`, …).
 *
 * Prečo session a nie krátkodobý token vložený do blade view: per-page token
 * pred lokálnym procesom nechráni, ten si spraví `GET /` a token si z HTML
 * vyparsuje. Rovnako nechráni kontrola `Origin`/`Referer` — hlavičku si klient,
 * ktorý nie je prehliadač, nastaví sám. Ochrana preto musí zamknúť aj samotný
 * dashboard, a to znamená tajomstvo, ktoré drží prehliadač (cookie), nie stránka.
 *
 * Dve cesty dovnútra:
 *  1. `?token=<UI_TOKEN>` raz na `/` → do session sa zapíše odtlačok tokenu a
 *     request sa presmeruje na čistú URL, aby token nezostal v histórii.
 *  2. Hlavička `X-Hades-Ui-Token` → verejná cesta cez Caddy (:8095), ktorý ju
 *     za basic-auth injektuje do každého requestu. Vlastnú hlavičku si stránka
 *     v prehliadači cross-origin poslať nevie (vyžiada si preflight), takže táto
 *     cesta nie je CSRF dierou.
 *
 * V session je `sha256` odtlačok tokenu, nie token samotný — rotácia
 * `HADES_UI_TOKEN` tým zneplatní všetky staré session.
 *
 * Fail-closed rovnako ako {@see AuthenticateMcp}: prázdny `hades.ui_token`
 * znamená 401 pre všetkých vrátane dashboardu. Nenakonfigurovaný server je
 * zamknutý server, nie otvorený.
 */
class AuthenticateUi
{
    /** Kľúč v session, pod ktorým žije odtlačok odomknutého tokenu. */
    public const SESSION_KEY = 'hades_ui';

    /** Hlavička pre Caddy (a programatické odomknutie bez tokenu v access logu). */
    public const HEADER = 'X-Hades-Ui-Token';

    public function handle(Request $request, Closure $next): Response
    {
        $configured = (string) config('hades.ui_token', '');

        // prázdny token v konfigu = fail-closed
        if ($configured === '') {
            abort(401, 'UI token nie je nakonfigurovaný.');
        }

        $fingerprint = hash('sha256', $configured);

        if ($this->sessionIsUnlocked($request, $fingerprint)) {
            return $next($request);
        }

        $provided = $this->tokenFromRequest($request);

        if ($provided === '' || ! hash_equals($configured, $provided)) {
            abort(401, 'Hades je zamknutý.');
        }

        if ($request->hasSession()) {
            $request->session()->put(self::SESSION_KEY, $fingerprint);
        }

        // Token v query stringu skončí v histórii prehliadača aj v access logoch,
        // takže po odomknutí HTML stránky ho z URL hneď odstrihneme. Pri /api/*
        // presmerovanie nemá zmysel — fetch by ho ticho nasledoval.
        if ($request->isMethod('GET') && ! $request->is('api/*') && $request->query->has('token')) {
            return redirect()->to($this->urlWithoutToken($request));
        }

        return $next($request);
    }

    /** Už odomknutá session: porovnávame odtlačky, nie tokeny (timing-safe). */
    protected function sessionIsUnlocked(Request $request, string $fingerprint): bool
    {
        if (! $request->hasSession()) {
            return false;
        }

        $stored = (string) $request->session()->get(self::SESSION_KEY, '');

        return $stored !== '' && hash_equals($fingerprint, $stored);
    }

    /** Hlavička má prednosť (Caddy); `?token=` je jednorazové odomknutie v prehliadači. */
    protected function tokenFromRequest(Request $request): string
    {
        $header = trim((string) $request->header(self::HEADER, ''));

        if ($header !== '') {
            return $header;
        }

        return trim((string) $request->query('token', ''));
    }

    /** Tá istá URL bez `token=`; ostatné query parametre SPA zostávajú. */
    protected function urlWithoutToken(Request $request): string
    {
        $query = $request->query();
        unset($query['token']);

        return $request->url().($query === [] ? '' : '?'.http_build_query($query));
    }
}
