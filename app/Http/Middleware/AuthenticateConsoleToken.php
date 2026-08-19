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

    /** Adresy, z ktorých sa programový beh smie spustiť bez ďalšej otázky. */
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

        if (! $this->fromThisMachine((string) $request->ip())) {
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

    /**
     * Prišiel request z TOHTO stroja?
     *
     * Loopback sám nestačí a je to zmerané, nie odhad: appka beží v kontejneri a
     * request z hosta na publikovaný port dorazí SNAT-nutý z **brány docker mostu**
     * (19. 8. 2026: `/proc/net/tcp` v `hades-app-1` ukázal pre spojenia na :8080
     * `rem_address 010013AC`, teda 172.19.0.1). S kontrolou len na 127.0.0.1 by
     * terminálový klient aj desktopové okno dostali 403 a celý okruh by bol
     * z hosta nepoužiteľný — pritom práve na hoste beží.
     *
     * Testy to nezachytili, lebo Symfony testovací klient chodí z 127.0.0.1.
     *
     * Preto sa k loopbacku pridáva **výhradne adresa default gateway** kontejnera,
     * nie celá podsieť mostu. Ten rozdiel je dôležitý: na tomto stroji je na
     * zdieľanom moste desiatky cudzích kontejnerov (iné appky používateľa) a
     * povoliť podsieť by znamenalo dať dosah každému z nich. Brána je adresa hosta.
     *
     * Čím to NIE JE oslabené: tunel odmieta kontrola proxy hlavičiek vyššie (Caddy
     * `X-Forwarded-*` pridáva), token je stále povinný, a `hades.console.allow_from`
     * dovolí zoznam v prípade neštandardnej siete zúžiť alebo prepísať.
     *
     * Čo zostáva ako známe riziko: kontejner na tom istom moste vie zdrojovú adresu
     * podvrhnúť (bridge zdroj nefiltruje). Bez tokenu mu to nedá nič, a s tokenom už
     * má aj UI okruh — takže to nie je nová plocha, len nie nulová.
     */
    protected function fromThisMachine(string $ip): bool
    {
        $allowed = config('hades.console.allow_from');

        if (is_array($allowed) && $allowed !== []) {
            return in_array($ip, array_map('strval', $allowed), true);
        }

        if (in_array($ip, self::LOOPBACK, true)) {
            return true;
        }

        $gateway = $this->defaultGateway();

        return $gateway !== null && $ip === $gateway;
    }

    /**
     * Adresa default gateway z `/proc/net/route` — teda hosta, keď beh je v kontejneri.
     *
     * Číta sa zo systému a nie z configu, aby to fungovalo po `docker compose down`
     * (podsieť mostu sa pri znovuvytvorení mení) bez toho, aby to niekto musel
     * prepísať. Mimo Linuxu súbor nie je a metóda vráti `null` — vtedy platí len
     * loopback, čo je správne: bez kontejnera je host loopback.
     */
    protected function defaultGateway(): ?string
    {
        static $cached = false;
        static $gateway = null;

        if ($cached) {
            return $gateway;
        }

        $cached = true;

        $route = @file_get_contents('/proc/net/route');

        if (! is_string($route)) {
            return $gateway = null;
        }

        foreach (array_slice(preg_split('/\R/', $route) ?: [], 1) as $line) {
            $columns = preg_split('/\s+/', trim($line)) ?: [];

            // Destination 00000000 = default route; Gateway je tretí stĺpec,
            // little-endian hex.
            if (count($columns) < 3 || $columns[1] !== '00000000' || $columns[2] === '00000000') {
                continue;
            }

            $hex = $columns[2];

            if (strlen($hex) !== 8) {
                continue;
            }

            return $gateway = implode('.', array_map(
                static fn (string $byte): int => (int) hexdec($byte),
                array_reverse(str_split($hex, 2)),
            ));
        }

        return $gateway = null;
    }
}
