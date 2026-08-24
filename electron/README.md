# Hades — desktop shell (Electron)

Rám okolo tej istej webovej appky na `127.0.0.1:8080`. Vizualizácia sa tým nemení
a build step nedostáva: shell len otvorí okno, odomkne ho a pridá to, čo prehliadač
nedá — vlastnú lištu, offline stavy, tray a notifikáciu „beh čaká na potvrdenie“.

```
main.js              main proces: okno, dve WebContentsView, injekcia tokenu, IPC
preload.js           preload appky (window.hades) + pozorovateľ .perm-card
chrome/topbar.html   vlastná horná lišta (Electron chróm, nie stránka appky)
chrome/topbar-preload.js
states/manager.js    offline automat: „Hades nebeži“ + pás „stratené spojenie“
states/offline.html · states/banner.html · states/state-preload.js
tray.js              tray menu + notifikácia zaparkovaného zápisu
assets/hades.ico     ikona okna, appky, tray a inštalátora (7 veľkostí, 16–256 px)
package.json         "type": "commonjs" — NEMAZAŤ, viď nižšie
```

## Spustenie

Potrebné dve veci: **appka beží** (Docker, `http://127.0.0.1:8080`) a v `.env`
v koreni projektu je **`HADES_UI_TOKEN`** (appka je za `auth.ui`).

```bash
npm run app          # electron electron/main.js
```

Prepínače prostredia: `HADES_PORT` (8080), `HADES_WS_PORT` (8081, Reverb),
`HADES_SCREEN` (`graf`), `HADES_UI_TOKEN` (prebije `.env`), `HADES_ROOT`
(kde hľadať `.env`).

**Kde sa hľadá `.env`:** `HADES_UI_TOKEN` z prostredia → `HADES_ROOT/.env` →
v dev behu koreň repozitára, v **zabalenej appke adresár `.exe`**. Zabalená appka
totiž `.env` v sebe nemá a mať nesmie (ALLOW-list ho do balíka nepustí), takže
portable `.exe` položený do koreňa projektu funguje sám, a nainštalovanej appke
treba povedať koreň premennou `HADES_ROOT`. Keď token nie je, okno sa neotvorí a
dialóg vypíše, kde všade sa hľadalo (nikdy nie hodnotu).

## Inštalátor

```bash
npm run app:pack     # electron-builder --dir  → dist-electron/win-unpacked/
npm run app:build    # electron-builder        → NSIS inštalátor + portable .exe
```

Konfigurácia je v `electron-builder.yml` v koreni (nie v `package.json` — dôvod je
napísaný v ňom). Do balíka ide **ALLOW-list**: `package.json` + `electron/**`.
Nič iné — žiadny `.env`, `vendor/`, `node_modules`, `public/`, `docs/`, `.git/`.

## Prečo tu NESMIE vzniknúť proxy

Celý dôvod, prečo shell existuje. Appka je za `auth.ui`, takže niekto musí pripojiť
hlavičku `X-Hades-Ui-Token`. Chrome v režime `--app` (staršia cesta,
`bin/hades-app.mjs`) sa o hlavičku požiadať nedá, a preto si musí postaviť **lokálny
HTTP proxy** — čím na loopbacku otvorí odomknutú cestu do celej pamäte pre každý
proces na stroji a musí ju brániť piatimi mechanizmami (jednorazové tajomstvo,
HttpOnly cookie, kontrola `Host`, väzba na 127.0.0.1, zámok na porte).

Electron tú dveru vôbec neotvorí: `session.webRequest.onBeforeSendHeaders` pridá
hlavičku priamo v sieťovej vrstve okna. Žiadny server → nie je čo brániť, nie je
kam zaklopať, token nikdy neopustí main proces. Kto shell „zjednoduší“ späť na
prehliadač s proxy, vráti aj tú útočnú plochu. Podrobne v hlavičke `main.js`;
kontrakt `KONTRAKT-UX-APPKA-CHAT-2026-08-21.md` §2, kritérium 10.

Z toho istého dôvodu tu nesmie zmiznúť `electron/package.json`: koreňový má
`"type": "module"`, ale **sandboxovaný preload nesmie byť ESM**. Tento adresár sa
preto prepína na `commonjs`.

## Čo je OVERENÉ (namerané 24. 8. 2026, Electron 43.4.1)

Harness bol jednorazový (scratchpad), metóda je opakovateľná:

- **Statická previerka** (`node`, bez GUI): oba `package.json` a
  `electron-builder.yml` parsujú, `main` ukazuje na existujúci súbor, všetkých 13
  `require(...)` sa dá rozložiť, každá `path.join(__dirname, …)` cesta existuje,
  ALLOW-list nespomína `node_modules` a projekt nemá žiadne runtime `dependencies`.
  **43 kontrol, 0 FAIL.**
- **Smoke v skutočnom Electrone, bez viditeľného okna:** `app.whenReady()` nabehol,
  z `hades.ico` je neprázdny `nativeImage` (256×256), `states/manager.js` aj
  `tray.js` sa načítajú, `createTray()` postaví Tray aj menu, všetky tri interné
  stránky vystavia svoje `contextBridge` API (`hadesChrome`, `hadesState`, `hades`)
  a v žiadnej nie je `require`/`ipcRenderer` naholo, `.perm-card` v DOM naozaj
  dorazí do main procesu ako `hades:pending-write` (a po `.decided` ako
  `…-cleared`), a keď backend nebeži, správca ukáže `offline.html`.
  **16 kontrol, 0 FAIL.**
- **Boot proti falošnému backendu** (dva HTTP servery na loopbacku, `HADES_PORT`):
  okno si vyžiadalo appku, požiadavka na vlastný origin nesie `X-Hades-Ui-Token` a
  jeho hodnota sa zhoduje s `.env` (teda `readUiToken()` funguje), požiadavka na
  **cudzí** origin hlavičku nedostala, a sandboxovaný preload sa načítal.
  **6 kontrol, 0 FAIL — a to isté aj pre ZABALENÚ `Hades.exe`** (s `HADES_ROOT`),
  takže asar balík je kompletný a spustiteľný. Beh appky nevypísal ani jedno
  varovanie.
- **Balík:** `electron-builder --dir` vyrobil `dist-electron/win-unpacked/`.
  `app.asar` obsahuje **presne 12 súborov** (12 + 4 adresáre = 16 položiek): 6 JS
  shellu, 3 HTML, `hades.ico`, `electron/package.json` a koreňový `package.json`.
  Žiadny `node_modules`, `.env`, `public/`, `vendor/`, `docs/` ani `build-icon.py`.
  `hades.ico` leží podľa `asarUnpack` v `app.asar.unpacked/electron/assets/`.

Tri chyby, ktoré tieto merania našli a ktoré sú opravené:

1. `states/manager.js` — po odmietnutom spojení Chromium načíta ešte vlastnú
   chybovú stránku a vypustí na ňu `did-finish-load`. Tá prešla ako úspech, takže
   offline obrazovka sa objavila a **hneď zmizla**, ostal chybový list Chrome
   s pásom „stratené spojenie“ a so zrušeným backoffom — presne to, čomu má správca
   zabrániť. Rieši príznak `loadFailed`.
2. `main.js` — `.env` sa hľadalo v koreni balíka, ktorý je v zabalenej appke
   **vnútri asaru**, kde `.env` nie je ani byť nesmie. Nainštalovaná appka by
   zhasla na dialógu. Rieši `envDirs()`.
3. `main.js` — `will-navigate`, `will-redirect` a `console-message` čítali pozičné
   argumenty, ktoré Electron 43 hlási ako deprecated. Po ich odstránení by `url`
   bolo `undefined`, strážca by zablokoval **aj vlastnú** navigáciu a zrkadlenie
   témy by ticho zomrelo. Čítajú sa z objektu udalosti a poslúchače majú aritu 1
   (varovanie sa vypúšťa podľa počtu parametrov, nie podľa toho, čo z nich čítaš).

## Čo je NEOVERENÉ

- **Inštalátor a portable `.exe` nevznikli.** `electron-builder` (25.1.8) viazne
  ešte pred podpisovaním: rozbaľuje si cache `winCodeSign`, ktorá obsahuje
  **macOS symlinky** (`darwin/10.12/lib/libcrypto.dylib`), a 7-Zip ich na Windows
  nevytvorí — `ERROR: Cannot create symbolic link : A required privilege is not
  held by the client`, tri opakovania, konec. Je to obmedzenie práv prostredia,
  nie chyba konfigurácie: pomôže Developer Mode alebo elevovaná konzola.
  Breaking bump `electron-builderu` je vyhradený na pokyn.
- **`Hades.exe` z tohto čiastočného behu nie je obrandovaná.** Hash sa od
  `electron.exe` líši (rcedit sa dotkol verzie), ale žiadna zo 7 veľkostí ikony
  ani `Hades`/`Sperky` v UTF-16 v `.exe` nie sú — meranie kalibrované na známom
  klade (rovnaké vzorky sa v `hades.ico` nájdu). Ikona a údaje o produkte sa
  zapisujú v tom kroku, ktorý padol.
- **Podpis kódu** — bez certifikátu ostáva balík nepodpísaný (SmartScreen).
- **Vzhľad a preklik okna** (lišta, tray menu, notifikácia, offline obrazovka na
  oku, prepnutie Graf/Charón, téma) — v tomto prostredí sa screenshot nedá
  (Browser pane nekompozituje rámce). Dôkazy vyššie sú zmerané fakty, nie snímky.
- **Beh proti skutočnej appke na 8080** (Docker sa tu spúšťať nesmie). Falošný
  backend vrátil jednu HTML stránku, nie vizualizáciu, takže WebSocket, kreslenie
  grafu ani Charón v okne overené nie sú.

## `npm audit`: 11 high + 1 critical, a prečo nejde do balíka

Všetkých 12 nálezov je v strome `electron-builder` → `dmg-builder` /
`app-builder-lib` / `electron-publish` / `builder-util(-runtime)` /
`@electron/rebuild` → `node-gyp` → `make-fetch-happen` → `cacache` → `tar`
(kritický `tar`, arbitrary file overwrite). Je to **build-time toolchain**.

Dôkaz, že v balíku nie je — nie argument, ale výpis `app.asar` po `--dir` builde:
12 súborov, všetky vlastné (viď vyššie). Drží to trojica: `files` je ALLOW-list bez
`node_modules`, projekt nemá ani jednu runtime `dependency`, a všetky zraniteľné
balíky sú dosiahnuteľné len cez `electron-builder`, ktorý je `devDependency`.
Po každej zmene `files`, `asar` alebo `dependencies` treba ten výpis zopakovať.
