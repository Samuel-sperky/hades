<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Content Security Policy pre HTML plochy appky (`/`, `/console`, `/chat`).
 * Registrovaná je na celú `web` skupinu, takže hlavičku dostane KAŽDÁ jej
 * odpoveď s `Content-Type: text/html` — teda aj 401 z `auth.ui`.
 *
 * Appka je verejne tunelovaná cez ngrok a dve z troch plôch kreslia výstup
 * modelu, ktorý si predtým čítal súbory projektu aj pamäť. CSP je tu preto
 * druhá obrana za escapovaním v `public/js/shared/markdown.js`: keby sa cez
 * markdown alebo cez zvýrazňovač raz prepašoval `<script>`, politika bez
 * `'unsafe-inline'` v `script-src` ho nespustí.
 *
 * ZAVÁDZA SA V REPORT-ONLY REŽIME (viď {@see self::REPORT_ONLY}). Politika je
 * postavená na zmeranom zozname toho, čo appka na tých troch plochách naozaj
 * načítava — meranie aj odôvodnenie každej direktívy je
 * v `docs/sprint-2026-08-25/MERANIE-CSP.md`. Kým je režim report-only,
 * prehliadač nič nezablokuje, len violácie vypíše do konzoly; to je jediný
 * kanál hlásení, aký táto trieda zavádza (`report-uri`/`report-to` zámerne
 * nie — bol by to nový nechránený POST endpoint na tunelovanej appke).
 *
 * Čo tu NIE JE a prečo:
 *
 *  - **`nonce` na `<script type="application/json">`.** Dátové bloky
 *    `#console-tools` na `/chat` a `/console` nemajú spustiteľný typ, takže
 *    HTML ich nespracuje ako skript a `script-src` sa na ne nemá kde spustiť.
 *    Nonce by tam tvrdil opak. Ak report-only ukáže violáciu na tých riadkoch,
 *    je to presne tá vec, ktorú malo meranie zistiť — postup je v MERANIE-CSP.md §5.
 *  - **`upgrade-insecure-requests`.** Lokálny prístup je `http://127.0.0.1:8080`
 *    a direktíva by z neho spravila nedostupnú appku.
 *  - **`font-src`, `media-src`, `worker-src`, `manifest-src`.** Zmerané: fonty
 *    idú z `/fonts/*` (`@font-face` na začiatku `public/css/mind.css`), a
 *    audio, video, Worker ani manifest v `public/js` nie sú vôbec.
 *    `default-src 'self'` ich pokrýva a kratšia hlavička sa lepšie číta.
 */
final class ContentSecurityPolicy
{
    /**
     * Fáza zavedenia.
     *
     * `true` → posiela sa `Content-Security-Policy-Report-Only`: prehliadač
     * politiku vyhodnotí, violácie vypíše do konzoly, ale NIČ nezablokuje.
     * `false` → posiela sa vynucovaná `Content-Security-Policy`.
     *
     * PREPNUTIE NA VYNUCOVANÚ JE ZMENA TEJTO JEDNEJ HODNOTY na `false` a nič
     * iné. Zámerne je to konštanta v kóde, nie env premenná: je to rozhodnutie
     * (a má byť vidieť v gite), nie nastavenie prostredia — a env by si navyše
     * pri zapnutom config cache vyžadovalo `config:clear`, teda krok, na ktorý
     * sa dá zabudnúť.
     *
     * Prepnúť sa má až vtedy, keď report-only nehlási violácie na všetkých
     * troch plochách (postup v MERANIE-CSP.md §6).
     */
    private const REPORT_ONLY = true;

    /**
     * Hostiteľ skriptov, ktorý appka reálne používa.
     *
     * ZMERANÉ 25. 8. 2026: jediné dva `<script src="https://…">` v celom
     * `resources/views/` sú `d3@7` a `pusher-js@8` z jsdelivr a sú v
     * `mind.blade.php`. `d3.` sa v `public/js` vyskytuje len v
     * `public/js/mind/sim.js`, `Pusher` len v `public/js/mind/ws.js` —
     * `public/js/chat/*`, `public/js/console/*` ani `public/js/shared/*`
     * nesiahajú ani na jedno. Preto CDN dostane v politike len plocha grafu
     * (viď {@see self::scriptSources()}) a plochy, ktoré kreslia výstup modelu,
     * majú `script-src 'self'`.
     */
    private const CDN_SCRIPT = 'https://cdn.jsdelivr.net';

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Odpoveď, ktorá si politiku nesie sama, sa neprepisuje.
        // `Console\AttachmentController::show()` posiela pri stiahnutí prílohy
        // `default-src 'none'; sandbox` a to je tvrdšie než čokoľvek odtiaľto.
        // Prílohy síce visia v `routes/api.php`, teda mimo `web` skupiny, ale
        // podmienka tu je preto, aby to platilo aj keby sa route presunula.
        if ($response->headers->has('Content-Security-Policy')
            || $response->headers->has('Content-Security-Policy-Report-Only')) {
            return $response;
        }

        if (! $this->carriesHtml($response)) {
            return $response;
        }

        $header = self::REPORT_ONLY
            ? 'Content-Security-Policy-Report-Only'
            : 'Content-Security-Policy';

        $response->headers->set($header, $this->policy($request));

        return $response;
    }

    /** Politika má význam len pre dokument, ktorý prehliadač parsuje ako HTML. */
    private function carriesHtml(Response $response): bool
    {
        return str_contains((string) $response->headers->get('Content-Type'), 'text/html');
    }

    private function policy(Request $request): string
    {
        return implode('; ', [
            "default-src 'self'",

            // Bez `'unsafe-inline'`: zmerané, že v `resources/views/*.blade.php`
            // nie je ani jeden inline `<script>` so spustiteľným typom a v
            // `public/js` ani jeden `onclick=`/`onerror=` v generovanom HTML,
            // `eval(` ani `new Function`.
            'script-src '.$this->scriptSources($request),

            // `'unsafe-inline'` je tu ZMERANÁ nutnosť, nie pohodlie: 10 miest
            // v `public/js/mind` vkladá cez `innerHTML` HTML s atribútom
            // `style="…"` (swatche oblastí, šírky barov, `--lobe`).
            //
            // A NEBRÁNI SA to ako pri `script-src`, hoci `public/js/chat`,
            // `public/js/console` ani `public/js/shared` nemajú ani jeden
            // `style="…"`: inline `<style>` blok má aj
            // `resources/views/errors/401.blade.php`, teda stránka, ktorú
            // `auth.ui` vracia práve na `/chat` a `/console`. Tvrdšia politika
            // tam by po vynútení znamenala nenaštýlovanú chybovú stránku.
            // Cesta k `style-src 'self'` je preto jedna a je v MERANIE-CSP.md §5.
            // Riziko je tu podstatne menšie než pri skriptoch: všetky tie
            // hodnoty idú cez `esc()`.
            "style-src 'self' 'unsafe-inline'",

            // `data:` — favicon je data-URI SVG na všetkých troch plochách.
            // `blob:` — náhľad práve priloženého obrázka v `chat/attach.js`
            // (`URL.createObjectURL(file)`), aby sa tie isté bajty nemuseli
            // stahovať späť zo servera.
            "img-src 'self' data: blob:",

            'connect-src '.implode(' ', $this->connectSources($request)),

            // Zmerané: jediný `<iframe>` v celom `public/js` je `srcdoc` náhľad
            // artefaktu (`chat/artifact.js`, `sandbox=""`). Ten sa nenačítava
            // fetchom, takže `frame-src` sa naň nevzťahuje — dokument namiesto
            // toho ZDEDÍ túto politiku. Žiadny `<iframe src="…">` v appke nie je,
            // preto `'none'`.
            //
            // OVERENÉ V PREHLIADAČI 25. 8. 2026 (bola to posledná neodmeraná
            // direktíva): `srcdoc` iframe so `sandbox=""` vložený na `/chat` pod
            // touto politikou vytvoril browsing context (`contentWindow` existuje),
            // vykreslil sa (268×357 px) a nespôsobil **ani jednu** violáciu.
            // `contentDocument` je `null` — to je tá žiadaná vlastnosť
            // (nepriehľadný origin), nie porucha.
            "frame-src 'none'",

            // Zmerané: `<object>`, `<embed>` ani `<applet>` v žiadnom blade ani
            // v `public/js` nie sú.
            "object-src 'none'",

            // Zmerané: `<base>` v žiadnom blade nie je. Bez tejto direktívy by
            // vložený `<base href="…">` prepísal cieľ všetkých relatívnych URL
            // vrátane `/api/console/run`.
            "base-uri 'self'",

            // Zmerané: formuláre (`#chat-composer`, `#composer`) nemajú `action`,
            // odosielanie ruší JS a beh ide fetchom.
            "form-action 'self'",

            // Desktop shell appku nerámuje — `electron/main.js` ju hostí vo
            // `WebContentsView`, čo je vlastný top-level obsah, nie iframe
            // (`webviewTag: false`). Rámovať ju teda nemá dôvod nikto zvonku.
            "frame-ancestors 'self'",
        ]);
    }

    /**
     * `script-src`. CDN dostane len plocha grafu — dôvod a meranie
     * v {@see self::CDN_SCRIPT}.
     *
     * Rozlišuje sa podľa URI route, nie podľa obsahu odpovede. Je to spojenie
     * s `resources/views/mind.blade.php`, ktoré nič nevynucuje: keď sa d3
     * a pusher-js self-hostnú, `'self'` tu má zostať samo, a naopak keby CDN
     * skript pribudol na `/chat` alebo `/console`, táto metóda ho nepovolí.
     * V report-only režime sa to prejaví violáciou v konzole; po prepnutí na
     * vynucovanú politiku už len rozbitou plochou — preto k tomu patrí test,
     * ktorý pinuje, že CDN `<script src>` je len v `mind.blade.php`.
     */
    private function scriptSources(Request $request): string
    {
        return $request->route()?->uri() === '/'
            ? "'self' ".self::CDN_SCRIPT
            : "'self'";
    }

    /**
     * `connect-src` — `fetch` na `/api/*` a WebSocket Reverbu.
     *
     * WebSocket sa vypisuje explicitne, aj keď by ho `'self'` podľa CSP3 mal
     * pokryť pri rovnakom hoste a porte. Spoliehať sa na to nechcem: to
     * pravidlo je v CSP3 dopísané neskôr, líši sa medzi `ws:` a `wss:` a
     * pri jednej zle uhádnutej hodnote by živé pulzy zhasli bez zjavnej príčiny.
     *
     * Obe schémy a host s portom aj bez neho sú tu preto, že
     * `connectWs()` v `public/js/mind/ws.js` sa medzi dvoma adresami rozhoduje
     * v PREHLIADAČI (`location.protocol`, `location.port`), zatiaľ čo hlavičku
     * skládá server — a ten za proxy schému ani port prehliadača nevie:
     * appka nemá `TrustProxies`, takže `X-Forwarded-Proto`/`-Port` od Caddy
     * a ngroku sa neberú a `getPort()` vráti vnútorných 8080. Politika preto
     * obsahuje obe vetvy, nie odhad jednej.
     */
    private function connectSources(Request $request): array
    {
        $sources = ["'self'"];

        // Vetva „proxied": Caddy routuje `/app/*` na Reverb, takže WS ide na
        // ten istý host ako HTML. Host bez portu pokryje 80/443 (ngrok), host
        // s portom lokálny beh cez Caddy (`docker/Caddyfile`, :8095).
        $host = $request->getHost();
        $port = (int) $request->getPort();

        if ($host !== '') {
            $sources[] = 'ws://'.$host;
            $sources[] = 'wss://'.$host;

            // Port sa dopisuje len keď je známy. Zdroj s prázdnym portom
            // (`ws://host:`) je neplatný a prehliadač ho zahodí — čo by z tejto
            // vetvy urobilo ticho nefunkčnú politiku.
            if ($port > 0) {
                $sources[] = 'ws://'.$host.':'.$port;
                $sources[] = 'wss://'.$host.':'.$port;
            }
        }

        // Vetva „priamo na appku": prehliadač na `:8080` ide na Reverb podľa
        // `ws` bloku z `GraphService::graph()`, teda na
        // `hades.public_ws_host:public_ws_port` (default `localhost:8081`).
        $wsHost = (string) config('hades.public_ws_host');
        $wsPort = (int) config('hades.public_ws_port');

        if ($wsHost !== '' && $wsPort > 0) {
            $sources[] = 'ws://'.$wsHost.':'.$wsPort;
            $sources[] = 'wss://'.$wsHost.':'.$wsPort;
        }

        return array_values(array_unique($sources));
    }
}
