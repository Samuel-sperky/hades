<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guard pre PROGRAMOVÝ vstup do konzoly — CLI, skript, iná AI.
 *
 * Prečo vôbec existuje: interné `/api/console/*` sedia za session + CSRF
 * ({@see AuthenticateUi} + `ValidateCsrfToken`), a klient, ktorý nie je
 * prehliadač, nemá ani jedno — cookie jar ani CSRF token z blade view. Bez
 * vlastného okruhu by sa programový klient musel dostať dovnútra tým, že sa
 * CSRF z toho endpointu odstráni, čo by tú ochranu zrušilo aj prehliadaču.
 *
 * ── Prečo loopback, a nie len token ────────────────────────────────────────
 *
 * Appka je verejne tunelovaná cez ngrok a Caddy (:8095) za basic-auth VKLADÁ
 * hlavičku s UI tokenom do každého requestu (docker/Caddyfile). Keby tento
 * guard veril iba tokenu, tunel by bol automaticky autentizovaným vstupom BEZ
 * CSRF do endpointu, ktorý spúšťa tooly nad pamäťou a nad súbormi — teda presne
 * to, čo `AuthenticateUi` na `/api/*` bráni tým, že za sebou drží CSRF.
 *
 * Preto sú tu DVE kontroly, nie jedna:
 *  1. `request->ip()` musí byť loopback — request musí prísť z tohto stroja,
 *  2. request nesmie niesť `X-Forwarded-For` ani `X-Forwarded-Host` — tie
 *     hlavičky pridáva reverzná proxy, takže ich prítomnosť znamená „prešlo to
 *     cez tunel" aj vtedy, keď `ip()` vidí loopback (Caddy beží na tom istom
 *     stroji, takže sám o sebe loopback JE).
 *
 * Keby ostala len prvá, stačil by Caddy pred appkou a diera je otvorená; keby
 * ostala len druhá, stačí proxy, ktorá hlavičky nepridáva.
 *
 * Fail-closed rovnako ako {@see AuthenticateUi} a {@see AuthenticateMcp}:
 * prázdny `hades.ui_token` znamená 401 pre všetkých. Nenakonfigurovaný server
 * je zamknutý server, nie otvorený.
 *
 * Žiadna session a žiadny CSRF: tajomstvo drží klient v hlavičke, nie cookie,
 * takže niet čoho zneužiť cross-site. Vlastnú hlavičku si stránka v prehliadači
 * cross-origin poslať nevie (vyžiada si preflight).
 */
class AuthenticateConsoleToken
{
    /** Tá istá hlavička ako UI okruh — jeden token, dva vstupy. */
    public const HEADER = 'X-Hades-Ui-Token';

    /** Adresy, z ktorých sa programový beh smie spustiť. */
    protected const LOOPBACK = ['127.0.0.1', '::1'];

    /**
     * Hlavičky, ktoré pridáva reverzná proxy. Ich prítomnosť je diskvalifikácia,
     * nie údaj, z ktorého by sa dala odvodiť skutočná adresa klienta.
     */
    protected const PROXY_HEADERS = ['X-Forwarded-For', 'X-Forwarded-Host'];

    public function handle(Request $request, Closure $next): Response
    {
        $configured = (string) config('hades.ui_token', '');

        // prázdny token v konfigu = fail-closed
        if ($configured === '') {
            abort(401, 'UI token nie je nakonfigurovaný.');
        }

        // Prenos sa overuje PRED tokenom. Request z tunela nemá dostať odpoveď,
        // z ktorej sa dá čítať, či token trafil — 403 hovorí „nesprávnou cestou",
        // nie „nesprávnym kľúčom".
        foreach (self::PROXY_HEADERS as $header) {
            if ($request->headers->has($header)) {
                abort(403, 'Programový beh konzoly nejde cez proxy ani cez tunel.');
            }
        }

        if (! in_array((string) $request->ip(), self::LOOPBACK, true)) {
            abort(403, 'Programový beh konzoly je len pre lokálneho klienta.');
        }

        $provided = trim((string) $request->header(self::HEADER, ''));

        // hash_equals, nie `===`: porovnanie po znakoch prezradí dĺžku spoločného
        // prefixu časom odpovede, a token sa tým dá uhádnuť po bajtoch
        if ($provided === '' || ! hash_equals($configured, $provided)) {
            abort(401, 'Hades je zamknutý.');
        }

        return $next($request);
    }
}
