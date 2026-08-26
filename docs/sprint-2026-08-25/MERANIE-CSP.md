# Meranie — CSP pre tri HTML plochy (W4-D, kontrakt §7 „Zostáva")

Dátum: 25. 8. 2026 · vetva `feat/hades-ux` @ `b021e69`
Oprava §1.6 (príkaz sa nereprodukoval): 26. 8. 2026 @ `c81fa63`

Kontrakt §7 to napísal presne: *„Nedopĺňal som ich naslepo: zavedenie CSP nad živou
plochou s inline `<script type="application/json">` a `style` atribútmi treba
**odmerať**, inak sa appka rozpadne a príčina nebude vidieť."* Toto je to meranie.

**Zoznamy nižšie sú namerané grepom nad `feat/hades-ux` @ `b021e69`, nie odhadnuté.**
Kde som niečo nezmeral, je to napísané ako nezmerané — a je to práve jedna vec (§4).
Prehliadač som nepoužil: Browser pane patrí orchestrátorovi, a preto sa politika
zavádza ako **report-only** a `howToVerify` nesie presné asercie (§6).

---

## 0. Výsledok na jednu obrazovku

| | Zistenie | Dôsledok pre politiku |
|---|---|---|
| Inline `<script>` so **spustiteľným** typom | **0** vo všetkých blade súboroch | `script-src` **nepotrebuje** `'unsafe-inline'` |
| `<script type="application/json">` | **2** (`/chat`, `/console`) | dátový blok, nie skript → **bez nonce** (§5.1) |
| Inline `on*=` handler, `eval(`, `new Function` | **0** v `public/js` aj v blade | to isté |
| CDN skripty | **2**, oba v `mind.blade.php` (d3, pusher-js z jsdelivr) | `script-src` s CDN **len na `/`**; `/chat` a `/console` majú `'self'` |
| `style="…"` v HTML z `innerHTML` | **10**, všetkých 10 v `public/js/mind` | `style-src` potrebuje `'unsafe-inline'` |
| Inline `<style>` blok | **1** relevantný: `errors/401.blade.php` | to isté, a **preto sa `style-src` nevetví** (§3.3) |
| `data:` URI | **4** (favicon na `/`, `/chat`, `/console`, `401`) | `img-src data:` |
| `blob:` | **2** (`chat/attach.js` náhľad, `chat/artifact.js` stiahnutie) | `img-src blob:` |
| WebSocket | Reverb, adresa sa rozhoduje **v prehliadači** | `connect-src` s obidvomi vetvami (§3.5) |
| `<iframe>` | **1**, `srcdoc` + `sandbox=""` (náhľad artefaktu) | `frame-src 'none'` — **jediná neoverená direktíva** (§4) |
| `<object>`, `<embed>`, `<base>`, `<form action>` | **0** | `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
| `url()` v `public/css/*.css` | **7**, všetkých 7 na `/fonts/*.woff2` (§1.6) | fonty sú self-hosted |
| Z toho `url()` mimo cesty od korene | **0**; `@import` tiež 0 (§1.6) | pokryje `default-src 'self'` |
| Obrázky | `/brand/*`, `/favicon.ico`, `/api/console/attachments/*` (§1.6) | to isté, plus `data:` a `blob:` vyššie |

Politika teda **nepotrebuje `'unsafe-inline'` pre skripty**, čo je pri ploche, ktorá
kreslí výstup lokálneho modelu, celá pointa. Pre štýly ho potrebuje a §5.2 hovorí
presne, čo by ho odstránilo.

---

## 1. Namerané zoznamy

Metóda: grep nad `resources/views/`, `public/js/`, `public/css/` a `vendor/` v repe.

**Merané nad pracovným stromom** na `b021e69`, teda vrátane nezacommitovaných zmien
paralelných sessions. Počty som po dopísaní vlastných zmien **prekontroloval** a držia
(10 inline štýlov, 0 v `chat`/`console`/`shared`, 0 `eval`/`new Function`), ale čísla
riadkov v `public/js/chat/artifact.js` a `public/js/console/render.js` sa počas tejto
úlohy posunuli o desiatky riadkov — sú tam uvedené ako orientácia, kotvou je názov
funkcie. Čísla riadkov v blade súboroch sú platné **pred** komentármi, ktoré som
dopísal.

### 1.1 Skripty

```
resources/views/chat.blade.php:235    <script type="application/json" id="console-tools">@json(...)</script>
resources/views/chat.blade.php:237    <script type="module" src="/js/chat/main.js">
resources/views/console.blade.php:170 <script type="application/json" id="console-tools">@json(...)</script>
resources/views/console.blade.php:172 <script type="module" src="/js/console/main.js">
resources/views/mind.blade.php:551    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js">
resources/views/mind.blade.php:552    <script src="https://cdn.jsdelivr.net/npm/pusher-js@8/dist/web/pusher.min.js">
resources/views/mind.blade.php:553    <script src="/js/charts.js">
resources/views/mind.blade.php:554    <script type="module" src="/js/mind/main.js">
```

To je **všetko**. Ani jeden inline `<script>` s JS obsahom, ani jeden `on*=` atribút
(`grep -rn ' on[a-z]*="' resources/views/*.blade.php` → 0 zásahov; v `public/js` sú
`onerror=`/`onload=` **len v komentároch** troch súborov, ktoré vysvetľujú, prečo
markdown escapuje), ani jeden `eval(` a ani jeden `new Function`.

**Nález, ktorý CLAUDE.md neuvádza:** „CDN je zámerne preč" platí **len pre Google
Fonts**. Plocha grafu ťahá **d3@7 a pusher-js@8 z `cdn.jsdelivr.net`** a ani jeden
nie je vo `public/` (`find public -iname "*d3*" -o -iname "*pusher*"` → 0).
Kde sa používajú:

- `d3.` — **len** `public/js/mind/sim.js`
- `Pusher` — **len** `public/js/mind/ws.js`
- `public/js/chat/*`, `public/js/console/*`, `public/js/shared/*` — **ani jedno**

Preto CDN v politike dostane len route `/`. Plochy, ktoré kreslia výstup modelu, majú
`script-src 'self'`.

### 1.2 Inline štýly

`grep -rn 'style="' public/js/` → **10 zásahov, všetkých 10 v `public/js/mind`**:

```
public/js/mind/panels.js:134            swatch oblasti (esc(color))
public/js/mind/panels.js:285            swatch oblasti (esc(mutedColor(...)))
public/js/mind/screens/dnes.js:26       shimmer skeleton (šírka/výška)
public/js/mind/screens/dnes.js:27       flex kontejner skeletonu
public/js/mind/screens/dnes.js:261      --lobe: farba oblasti
public/js/mind/screens/dnes.js:265      width: % baru
public/js/mind/screens/kniznica.js:214  lib-dot (esc(mutedColor(...)))
public/js/mind/screens/kontrola.js:182  margin-top: var(--gutter)
public/js/mind/screens/kontrola.js:735  width: % baru
public/js/mind/structure.js:20          dot (esc(mutedColor(...)))
```

`grep -rn "style='" public/js/`, `style=\`` v template literáloch,
`setAttribute('style'` → **0 zásahov**. V `public/js/chat`, `public/js/console`
a `public/js/shared` **nie je ani jeden `style=`** v žiadnom tvare.

`cssText` je na dvoch miestach (`public/js/charts.js:483`,
`public/js/mind/certainty.js:39`), ale to je **CSSOM**, nie atribút v parsovanom
HTML — `style-src` naň nedosiahne a v politike nič nepotrebuje.

Inline `<style>` bloky v blade: `resources/views/errors/401.blade.php:13`
a `resources/views/welcome.blade.php:15` (welcome sa nikde neroutuje). V žiadnom
z troch cieľových blade súborov `style="` **nie je** (0 zásahov).

Cudzia položka, ktorú treba poznať: `vendor/symfony/error-handler/Resources/views/
exception_full.html.php` má **dva inline `<style>` a dva inline `<script>`** — to je
debug stránka výnimky (`APP_DEBUG=true`). §7 hovorí, čo z toho vyplýva.

### 1.3 `data:` a `blob:`

- `data:image/svg+xml,…` favicon: `chat.blade.php`, `console.blade.php`,
  `mind.blade.php`, `errors/401.blade.php` (1 na súbor). Favicon prehliadač načítava
  pod `img-src`.
- `blob:`: `public/js/chat/attach.js:340` (`URL.createObjectURL(file)` — náhľad práve
  priloženého obrázka, aby sa tie isté bajty nemuseli stahovať späť) a
  `public/js/chat/artifact.js`, `downloadButton()` (`Blob` + `<a download>` na
  stiahnutie artefaktu).
- `data:` v `public/js` → **0 zásahov**. `data:` teda potrebuje **len** `img-src`.

### 1.4 WebSocket

`public/js/mind/ws.js` sa rozhoduje **v prehliadači**:

```js
const tls = location.protocol === 'https:';
const proxied = tls || (location.port && location.port !== '8080');
const host = proxied ? location.hostname : ws.host;   // ws.* z GraphService::graph()
const port = proxied ? (location.port ? Number(location.port) : (tls ? 443 : 80)) : ws.port;
```

`ws.host` / `ws.port` sú `config('hades.public_ws_host')` /
`public_ws_port` (`app/Services/GraphService.php:74`), default **`localhost:8081`**.
Tri reálne nasadenia:

| Ako je appka otvorená | Kam ide WS |
|---|---|
| `http://127.0.0.1:8080` (priamo appka) | `ws://localhost:8081` (z configu) |
| `http://127.0.0.1:8095` (lokálne cez `docker/Caddyfile`) | `ws://127.0.0.1:8095/app/*` |
| `https://…ngrok…` (verejne, Caddy routuje `/app/*` na Reverb) | `wss://<host>/app/*` (443) |

`disableStats: true` a `enabledTransports: ['ws']`/`['wss','ws']` sú v tom istom
volaní, takže pusher-js **nesiaha na `stats.pusher.com`** ani na sockjs fallback.

Absolútny `fetch` na cudzí origin: `grep -rn "fetch(['\"]http" public/js/` → **0**.
Všetky okruhy idú na `/api/*`, teda same-origin.

### 1.5 iframe

`public/js/chat/artifact.js`, `htmlFrame()` — jediný iframe v appke:

```js
frame.setAttribute('sandbox', '');            // všetky obmedzenia
frame.setAttribute('referrerpolicy', 'no-referrer');
frame.srcdoc = String(text ?? '');
```

Žiadny `<iframe src="…">` v appke nie je. Ani jeden `<object>`, `<embed>`, `<base>`,
`new Worker`, `serviceWorker`, `<audio>`, `<video>` ani `manifest` link
(vo `welcome.blade.php` je `build/manifest.json`, ale to je Vite `@if` a tá plocha
sa neroutuje).

### 1.6 Fonty a obrázky

V `public/css/*.css` je **7** `url()` a všetkých 7 vedie na absolútnu cestu od
korene — sú to práve tie súbory zo siedmich `@font-face` blokov v `mind.css`:

```
grep -rhon "url([^)]*)" public/css/*.css | wc -l                  # → 7
grep -rhon "url([^)]*)" public/css/*.css | grep -vE "url\(['\"]?/" # → 0 zásahov
```

**Prvá verzia tohto merania (25. 8. 2026) tu mala filter `grep -v "url(/"`
a tvrdila 0 zásahov. Spustený presne tak vráti 7** — všetky sú tvaru
`url('/fonts/geist-latin.woff2')`, teda s apostrofom medzi `url(` a `/`, ktorý
ten vzor nepustí. Číslo bolo správne, príkaz pod ním nie, a meranie, ktoré sa
nereprodukuje, je horšie než žiadne. Filter preto povoľuje voliteľnú úvodzovku
(`['\"]?`), a keďže `?` je ERE, príkaz musí byť `grep -vE`. Prekontrolované
26. 8. 2026 na `feat/hades-ux` @ `c81fa63`: 7 celkovo, 0 mimo korene, všetkých 7
v `mind.css` (`charon.css`, `chat.css`, `console.css` majú 0).

`@import` v CSS nie je ani raz (`grep -rn "@import" public/css/*.css` → 0).
Obrázky: `/brand/*`
(`apple-touch-icon`, `og:image`), `/favicon.ico`, prílohy z
`/api/console/attachments/{uuid}`. Všetko `'self'`.

### 1.7 Odpoveď, ktorá si politiku nesie sama

`app/Http/Controllers/Console/AttachmentController.php:128` posiela pri stiahnutí
prílohy `Content-Security-Policy: default-src 'none'; sandbox`. To je tvrdšie než
čokoľvek odtiaľto a **nesmie sa prepísať** — middleware preto existujúcu hlavičku
nechá byť. (Prílohy visia v `routes/api.php`, teda mimo `web` skupiny, takže by sa
k tomu ani nedostal; podmienka je pre prípad, že sa route presunie.)

---

## 2. Navrhnutá politika

Middleware: `app/Http/Middleware/ContentSecurityPolicy.php`, registrovaný
v `bootstrap/app.php` cez `$middleware->web(append: […])`. Posiela hlavičku len
odpovedi s `Content-Type: text/html` a nikdy neprepíše existujúcu.

**`/chat`, `/chat/<uuid>`, `/console`, `/console/<uuid>`** (a každá ďalšia HTML
odpoveď `web` skupiny vrátane `401`):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self' <ws vetvy, §3.5>;
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'self'
```

**`/`** (plocha grafu) — jediný rozdiel:

```
script-src 'self' https://cdn.jsdelivr.net;
```

Príklad celej hodnoty tak, ako vyjde na lokálnom `http://127.0.0.1:8080/`:

```
default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'
'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1
wss://127.0.0.1 ws://127.0.0.1:8080 wss://127.0.0.1:8080 ws://localhost:8081
wss://localhost:8081; frame-src 'none'; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'self'
```

(Zalomené pre čitateľnosť; v hlavičke je to jeden riadok.)

---

## 3. Odôvodnenie každej direktívy

### 3.1 `default-src 'self'`
Základ, z ktorého dedia direktívy, ktoré v politike nie sú: `font-src`, `media-src`,
`worker-src`, `manifest-src`, `prefetch-src`. Zmerané (§1.5, §1.6), že všetky by aj
tak boli `'self'`, takže vypisovať ich znamená dlhšiu hlavičku a nič viac.

### 3.2 `script-src 'self'` (+ CDN len na `/`)
**Toto je dôvod, prečo sa CSP zavádza.** `/chat` a `/console` kreslia výstup modelu,
ktorý si predtým čítal súbory projektu aj pamäť; `public/js/shared/markdown.js`
escapuje a `chat/highlight.js` beží nad už escapovaným textom, ale to je jedna obrana.
Politika bez `'unsafe-inline'` je druhá: keby sa raz cez markdown prepašoval
`<script>` alebo `onerror=`, nespustí sa.

CDN je oddelené podľa route (§1.1) zámerne — plocha, ktorá kreslí výstup modelu, nemá
dôvod povoliť tretí skriptový host. Je to spojenie s `mind.blade.php`, ktoré nič
nevynucuje; §7 hovorí, čím sa to vynútiť má.

### 3.3 `style-src 'self' 'unsafe-inline'`
Zmeraná nutnosť: 10 miest v `public/js/mind` (§1.2). Riziko je tu podstatne menšie než
pri skriptoch — všetky vkladané hodnoty idú cez `esc()` a `mutedColor()`, a externé
`url()` v štýle by aj tak zastavil `default-src 'self'`.

**Prečo sa `style-src` nevetví ako `script-src`,** hoci `/chat` a `/console` nemajú ani
jeden inline štýl: inline `<style>` blok má `resources/views/errors/401.blade.php`,
teda stránka, ktorú `auth.ui` vracia **práve na `/chat` a `/console`**. Tvrdšia politika
tam by po vynútení znamenala nenaštýlovanú chybovú stránku — teda viditeľné rozbitie za
polovičný úžitok. Cesta k `style-src 'self'` na celej appke je v §5.2 a je jedna.

### 3.4 `img-src 'self' data: blob:`
`data:` = favicon (§1.3). `blob:` = náhľad práve priloženej fotky. Bez `blob:` by čip
prílohy stratil miniatúru, čo je presne ten druh poruchy, ktorý sa hľadá dlho.
`img-src *` nie: obrázok z cudzieho origin je v tejto appke sledovací pixel, nie funkcia.

### 3.5 `connect-src`
Obsahuje `'self'` (všetky `/api/*` okruhy vrátane NDJSON streamu behu) a **obe vetvy**
WebSocketu zo §1.4:

- `ws://<host>` a `wss://<host>` — host bez portu, teda 80/443. Pokryje ngrok.
- `ws://<host>:<port>` a `wss://<host>:<port>` — pokryje lokálny beh cez Caddy (:8095).
- `ws://<config host>:<config port>` a `wss://…` — pokryje priamy beh na :8080, kde
  klient ide na `localhost:8081`.

Duplikáty sa vyhadzujú (`array_unique`).

Dve veci, ktoré to vysvetľujú a sú obe merateľné:

1. **Server nevie, ktorú vetvu klient vyberie.** Rozhoduje sa podľa
   `location.protocol` a `location.port` v prehliadači.
2. **Appka nemá `TrustProxies`** (`grep -rn "TrustProxies" bootstrap/app.php app/` →
   0 zásahov), takže `X-Forwarded-Proto` a `-Port` od Caddy a ngroku sa neberú:
   za tunelom `$request->getPort()` vráti vnútorných **8080**, nie 443. Preto sa
   host vypisuje **aj bez portu** — inak by verejná cesta dostala do politiky
   nefunkčnú hodnotu a pulzy by zhasli bez zjavnej príčiny.

WebSocket sa vypisuje explicitne, aj keď ho `'self'` podľa CSP3 pri rovnakom hoste
a porte pokryť má. Na to sa nespolieham: to pravidlo je do CSP3 dopísané neskôr,
`ws:` a `wss:` sa v ňom nechovajú rovnako, a cena za explicitnosť je pár bajtov
hlavičky.

### 3.6 `frame-src 'none'`
Zmerané: jediný iframe je `srcdoc` (§1.5). `srcdoc` sa nenačítava fetchom, takže
`frame-src` sa naň podľa špecifikácie nevzťahuje — dokument namiesto toho **zdedí
politiku rodiča**. Žiadny `<iframe src="…">` v appke nie je, takže `'none'`.
**Toto je jediná direktíva, ktorú som neoveril v prehliadači — §4.**

### 3.7 `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`
Všetky tri sú zmerané nuly (§1.5, §1.2). `base-uri` je z nich najcennejšia: vložený
`<base href="…">` by prepísal cieľ **každej** relatívnej URL vrátane
`/api/console/run` a `/api/console/decide`, teda by presmeroval dvojfázovú bránu.

### 3.8 `frame-ancestors 'self'`
Desktop shell appku **nerámuje**: `electron/main.js` ju hostí vo `WebContentsView`
(riadky 516, 608) s `webviewTag: false`, čo je vlastný top-level obsah, nie iframe.
Rámovať appku teda nemá dôvod nikto zvonku a `frame-ancestors 'self'` je zadarmo.

### 3.9 Čo v politike zámerne NIE JE

- **`'unsafe-inline'` v `script-src`** — nepotrebné (§1.1). Toto je celý zmysel merania.
- **`nonce`** — §5.1.
- **`upgrade-insecure-requests`** — lokálny prístup je `http://127.0.0.1:8080` a
  direktíva by z neho spravila nedostupnú appku.
- **`report-uri` / `report-to`** — bol by to nový POST endpoint na appke, ktorá je
  verejne tunelovaná cez ngrok, teda nová nechránená plocha za údaj, ktorý report-only
  aj tak vypíše do konzoly prehliadača. Meracím kanálom je konzola (§6).
- **`require-trusted-types-for`** — appka skladá HTML stringami na desiatkach miest;
  bola by to samostatná úloha, nie riadok v hlavičke.

---

## 4. Jediná vec, ktorú som NEZMERAL

**Či `frame-src` platí na `<iframe srcdoc>`.** Podľa HTML špecifikácie sa srcdoc
dokument vytvára algoritmom, ktorý nejde cez fetch, takže CSP kontrola navigačného
requestu sa naň nespustí a dokument namiesto toho **dedí** politiku rodiča. Overiť to
bez prehliadača nemám čím a Browser pane patrí orchestrátorovi.

Je to riziko práve jedného prvku (`#chat-artifact` → náhľad HTML artefaktu) a
report-only ho neurobí nefunkčným — len ohlási. **Presná asercia je v `howToVerify`.**

Dva dôsledky dedenia politiky, ktoré treba poznať, ak sa potvrdí:

- **Zavrie sa diera, ktorú komentár v `htmlFrame()` sám pomenúva** („`<img src="https://…>`
  sa načíta, takže dokument môže poslať jeden request von — sledovací pixel").
  Zdedené `img-src 'self' data: blob:` ho zastaví. Komentár v tom súbore o tom nevie
  a nechal som ho tak — nie je to môj súbor a je to zmena, ktorú má potvrdiť meranie,
  nie táto úloha (viď `notes`).
- **Sandbox dáva dokumentu nepriehľadný origin**, takže zdedené `'self'` v ňom
  nezodpovedá ničomu: obrázok z `/brand/…` v náhľade od modelu sa nenačíta.
  `data:` a `blob:` sú schémové zdroje a fungujú ďalej. Je to strata na náhľade
  výstupu modelu, nie na ploche appky.

Ostatné položky, ktoré report-only overí a ja som ich len prečítal z kódu:

- `<a download>` na `blob:` URL v `downloadButton()` — stiahnutie nie je fetch
  subresource, takže by ho `default-src` nemal riešiť.
- pusher-js s `disableStats: true` a obmedzenými transportmi — nemá siahať nikam
  okrem WS adresy.

---

## 5. Čo by bolo treba pre CSP bez `unsafe-inline`

### 5.1 Skripty: `'unsafe-inline'` **nie je potrebné už dnes**

`<script type="application/json">` na `/chat` a `/console` **nie je skript**.
HTML pri príprave `<script>` elementu určí typ; `application/json` nie je ani
klasický skript, ani modul, ani `importmap`, takže element je dátový blok, nespustí
sa a `script-src` sa naň nemá kde uplatniť. Nonce by tam tvrdil opak — že je to
skript, ktorému veríme.

**Ak report-only na tých dvoch riadkoch violáciu ohlási**, znamená to, že prehliadač
sa chová inak, než tu stojí, a postup je v tomto poradí:

1. **Neprilepovať `'unsafe-inline'`.** Bola by to výmena celej obrany za jeden riadok
   dát.
2. Prvá voľba: **presunúť zoznam nástrojov z `<script>` do `data-` atribútu**
   (napr. `<div id="console-tools" data-tools="@json(...)" hidden>`), čítač je jeden
   (`public/js/chat/*` a `public/js/console/*` čítajú `#console-tools`). Atribút nie
   je skript ani štýl, takže sa CSP netýka vôbec, a `@json` v atribúte Blade
   escapuje.
3. Druhá voľba: **nonce**. `$request->attributes` alebo Blade direktíva, hodnota
   z `random_bytes(16)` na request, `script-src 'self' 'nonce-…' …`. Je to viac
   pohyblivých častí (nonce sa nesmie cacheovať) za ten istý výsledok, preto druhá.

### 5.2 Štýly: dva kroky, potom `style-src 'self'`

1. **10 miest v `public/js/mind`** (§1.2) prepísať na CSS premennú nastavenú cez
   CSSOM (`el.style.setProperty('--lobe', color)`) alebo na triedu. Nie je to
   kozmetika: `public/js/mind/panels.js` je paralelne držaný inou session a
   `dnes.js` / `kniznica.js` / `kontrola.js` / `structure.js` nie sú v rozsahu tejto
   úlohy — patrí to do vlastnej úlohy, ktorá tie súbory vlastní.
2. **`resources/views/errors/401.blade.php:13`** — inline `<style>` presunúť do
   samostatného stylesheetu v `public/css/`. Chybová stránka nemá dôvod byť jediný
   súbor s vlastnou kresbou v HTML.

Až keď je hotové oboje, dá sa v middleware zmazať `'unsafe-inline'` zo `style-src`.
Skôr nie — polovičný krok znamená nenaštýlovanú 401 alebo rozbitý graf.

---

## 6. Zavedenie: report-only najprv

Middleware posiela **`Content-Security-Policy-Report-Only`**. Prehliadač politiku
vyhodnotí, violácie vypíše do konzoly a **nič nezablokuje** — appka sa teda nemôže
rozpadnúť skôr, než sa niekto pozrie.

Prepnutie na vynucovanú je **jedna zmena**:

> `app/Http/Middleware/ContentSecurityPolicy.php`, konštanta
> `private const REPORT_ONLY = true;` → `false`.

Nič iné. Je to konštanta v kóde, nie env premenná, zámerne: je to rozhodnutie a má
byť vidieť v gite — a env by si pri zapnutom config cache vyžadovala `config:clear`,
teda krok, na ktorý sa dá zabudnúť.

**Prepnúť sa má až vtedy, keď report-only nehlási violácie na všetkých troch
plochách** vrátane náhľadu artefaktu (§4). To rozhodnutie nechávam na orchestrátora;
presné asercie sú v `howToVerify`.

---

## 7. Čo CSP v tejto appke **nerieši** (a nemá sa tak tvrdiť)

- **Nepripnuté CDN skripty.** `d3` a `pusher-js` idú z jsdelivr **bez `integrity`**.
  CSP povolí host, nie obsah — kompromitovaný jsdelivr by prešiel. Skutočná oprava je
  self-hosting do `public/js/` (a potom zmazať CDN z middleware), medzikrok je `SRI`.
- **Spojenie middleware ↔ `mind.blade.php`.** Že CDN skript je len na `/`, nič
  nevynucuje. V report-only režime by sa CDN skript pridaný na `/chat` prejavil
  violáciou v konzole; po vynútení už len rozbitou plochou. Patrí k tomu test — presná
  asercia je v `notes`.
- **Debug stránka výnimky.** `vendor/symfony/error-handler/…/exception_full.html.php`
  má inline `<script>`; po vynútení politiky prestanú fungovať rozbaľovacie tlačidlá
  trace-u. Stránka zostane čitateľná (`style-src` má `'unsafe-inline'`) a je to len
  `APP_DEBUG=true`. Nie je to dôvod povoliť inline skripty.
- **Electron chróm.** `electron/chrome/topbar.html`, `states/banner.html`
  a `states/offline.html` sú `file://` stránky shellu s vlastnou `<meta>` politikou —
  hlavička z Laravelu sa ich netýka a nemá ich prepisovať.
- **Web Speech API.** Diktovanie nie je subresource, takže `connect-src` naň
  nedosiahne. Kontrakt §3 sľubuje „nič do cloudu"; či to `SpeechRecognition`
  v danom prehliadači naozaj drží, je otázka mimo CSP a mimo tejto úlohy.
- **Prienik cez server.** CSP je obrana v prehliadači. `PathGuard`, dvojfázová brána
  a `auth.ui` ostávajú tým, čím sú — táto hlavička im nič neuberá ani nepridáva.
