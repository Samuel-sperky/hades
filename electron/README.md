# Hades — desktop shell (Electron)

Rám okolo tej istej webovej appky na `127.0.0.1:8080`. Vizualizácia sa tým nemení
a build step nedostáva: shell len otvorí okno, odomkne ho a pridá to, čo prehliadač
nedá — vlastnú lištu, offline stavy, tray, notifikácie o behu, globálnu skratku
a voliteľné spustenie Dockeru.

```
main.js              main proces: okno, dve WebContentsView, injekcia tokenu, IPC
preload.js           preload appky (window.hades) + pozorovateľ .perm-card
chrome/topbar.html   vlastná horná lišta (Electron chróm, nie stránka appky)
chrome/topbar-preload.js
states/manager.js    offline automat: „Hades nebeži“, pás (ws / prerušený beh)
states/offline.html · states/banner.html · states/state-preload.js
tray.js              tray menu + notifikácie (čaká na potvrdenie / dobehol / spadol)
runwatch.js          sledovanie behov Charóna na sieti (POST /api/console/run|decide)
shortcut.js          globálna skratka (registrácia aj ODREGISTROVANIE)
docker.js            voliteľné spustenie Dockeru — len so súhlasom človeka
settings.js          settings.json v userData: skratka, Docker, notifikácie
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

## Lokálny rast (kontrakt `KONTRAKT-CHAT-APPKA-2026-08-25.md` §3)

Štyri veci, ktoré z okna robia desktopovú appku, a nie prehliadač bez adresného
riadka. Všetky sú nastaviteľné v jednom súbore — `settings.json` v
`app.getPath('userData')` (`%APPDATA%\hades-desktop\settings.json`), otvorí ho
tray → **Nastavenia (settings.json)**. Pozor, adresár sa medzi behmi líši:
`app.getName()` je v dev behu `hades-desktop` (koreňový `package.json`), v zabalenej
appke `Hades` (`productName` v `electron-builder.yml`) — teda
`%APPDATA%\hades-desktop\` vs `%APPDATA%\Hades\`. Nastavenia z `npm run app` sa
preto do nainštalovanej appky neprenesú.

```json
{
    "shortcut": { "enabled": true, "accelerator": "Control+Shift+H" },
    "docker": { "enabled": false, "command": ["docker", "compose", "up", "-d"], "cwd": "", "askEveryTime": true },
    "notify": { "runFinished": true, "onlyWhenUnfocused": true }
}
```

Súbor čítá a píše **len main proces**. Renderer naň nemá most — a to je zámer, nie
opomenutie: keby príkaz na spustenie Dockeru žil v `localStorage`, mal by k nemu
cestu obsah stránky, teda aj výstup modelu. Hodnoty sa validujú kľúč po kľúči
a čo nie je v defaultoch, zahodí sa.

### 1. Globálna skratka → rýchly vstup do chatu

`Ctrl+Shift+H` vytiahne okno a postaví kurzor do composeru chatu. Keď appka v chate
už je, **nikam sa nenaviguje** — načítanie by zahodilo rozpísanú správu aj front
správ; inak sa otvorí `/chat` bez uuid, teda nové vlákno s prázdnym composerom.
Vypína sa v tray menu, akcelerátor sa mení v `settings.json`.

Composer sa hľadá **genericky** (posledné viditeľné `textarea` / `contenteditable`),
nie podľa tried `/chat`. Shell si na značky frontendu nestavia kontrakt — z toho
istého dôvodu sa dobehnutie behu meria na sieti, viď nižšie.

`globalShortcut` je systémový prostriedok: kým ho appka drží, nikto iný ho
nedostane. Odregistrovanie preto visí na `will-quit` (príde aj pri ukončení z tray
bez okna), nie na zavretí okna. Obsadená skratka nie je pád — tray to prizná
v texte položky.

### 2. Notifikácia „beh dobehol“

Meria sa **na sieti** (`runwatch.js`), nie v DOM. Ťah je jeden POST na
`/api/console/run`, obnova zaparkovaného ťahu jeden POST na `/api/console/decide`
(kontrakt C-1: tretia cesta k modelu neexistuje, takže tie dve URL sú úplný zoznam)
a prúd NDJSON je telom tej odpovede — **koniec requestu je koniec ťahu**, rovnako
pre všetky tri vstupy (graf/dok, `/console`, `/chat`). Selektor v DOM by uhádol
jednu obrazovku a na ostatných ticho mlčal.

Obsah odpovede v notifikácii **nie je** — hlási sa len fakt a trvanie. Notifikácia
sa nepošle, keď: je vypnutá, okno je zaostrené (`onlyWhenUnfocused`), alebo ťah
**zaparkoval** na potvrdení zápisu. Zaparkovanie sa nedá prečítať z requestu
(`webRequest` nedá telo), takže sa rozlišuje podľa karty povolenia z DOM
(`hades:pending-write` z preloadu) — a preto má aj svoje NEOVERENÉ, viď nižšie.

Zastavenie behu človekom (`net::ERR_ABORTED`) notifikáciu nedostane: zastavil ho
ten, komu by prišla.

### 3. Pád backendu POČAS behu

Doteraz to okno hlásilo len pásom o strate živého spojenia. Čo chýbalo, je odpoveď
na dve otázky:

- **Rozpísaná odpoveď** sa nedokončí. Prúd bol telom toho jedného requestu a obnova
  beží len z `/api/console/decide`, nikdy z prekreslenia okna. Autoritatívna je DB
  (`console_messages`) — po obnovení sa vlákno poskladá presne po miesto, ktoré
  server stihol uložiť.
- **Front správ** (a rozpísaný text) žije v rendereri, v DB nie je. Preto sa appka
  v tomto režime **NEOBNOVÍ sama**: keď backend nabehne, offline obrazovka sa
  zastaví v stave „ready“ a slovo dostane človek — *Pokračovať v okne* (nechať tak)
  alebo *Načítať znovu* (vedomé zahodenie; tlačidlo to hovorí). Automatická obnova
  zostáva tam, kde nie je čo stratiť: keď sa appka nenačítala vôbec.
- Obnova mieri **tam, kde appka bola** (`getUrl`), nie na graf.

Z toho istého dôvodu **klik na obrazovku, na ktorej appka už je, nenačíta nič** —
ani v lište, ani v tray menu. „Prepni ma tam, kde som“ nie je žiadosť o zahodenie
rozpísanej správy; kto chce prekresliť, má v lište Obnoviť.

### 4. Voliteľné spustenie Dockeru

Prepínač je **defaultne vypnutý** a znamená len to, že sa Hades pri starte
**ponúkne**. Dialóg vždy vypíše **presný príkaz aj adresár**, default tlačidla je
„Nespúšťať“, a kto si vypne pýtanie sa (zaškrtávacie pole), dozvie sa o spustení
notifikáciou s tým istým príkazom. Zapnutie prepínača v tray menu prejde vlastným
dialógom — jednoklik v menu nesmie byť jediné miesto, kde človek vidí, čo si pustí
do stroja. „Spustiť Docker teraz…“ sa pýta vždy.

Príkaz je **pole argumentov** a spúšťa sa `spawn(..., { shell: false })`: žiadne
`&&`, žiadne presmerovanie, žiadne rozbaľovanie premenných. Príkaz zadaný ako jeden
string `settings.js` odmietne. **Nie je to shell tool pre model** (kontrakt §4) —
cesta k spusteniu vedie výhradne z tray menu alebo zo štartu appky, oboje cez dialóg
pre človeka, a renderer na to nemá most.

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

## Čo je OVERENÉ z lokálneho rastu (namerané 25. 8. 2026, Electron 43.4.1)

Tri harnessy v scratchpade, každý kalibrovaný prípadom, ktorý MUSÍ padnúť:

- **`w3e-check.js` — 107 kontrol, 0 FAIL** (obyčajný `node`, stubnutý `electron`
  a `child_process`). Inline skripty všetkých troch HTML stránok shellu sa parsujú
  (kalibrácia: pokazený skript padne). `settings.js`: default `docker.enabled` je
  `false`, príkaz zadaný ako **string** sa zahodí, neznámy kľúč sa zahodí,
  akcelerátor s novým riadkom padne na default, zápis je atomický a nezanechá
  `.tmp`. `shortcut.js`: registrácia, odregistrovanie s **presným** akcelerátorom,
  opakované `apply()` neregistruje znovu, obsadená/nečitateľná skratka je stav a nie
  pád. `runwatch.js`: `POST /run` → start, koniec requestu → finish, HTTP 422 →
  `fail(http)`, `ERR_CONNECTION_REFUSED` → `fail(network)`, `ERR_ABORTED` → abort —
  a **nepripája sa na `onBeforeSendHeaders`** (druhý poslúchač by vypnul injekciu
  tokenu). Kalibrácia: GET, iný port, iný host a iná cesta sa ignorujú. `docker.js`:
  vypnutý prepínač nespustí ani nezobrazí NIČ; dialóg nesie presný príkaz aj adresár
  a má default „Nespúšťať“; po súhlase je presne jeden `spawn` bez shellu v koreni
  projektu; zrušené zapnutie prepínač nezapne; „Spustiť teraz“ sa pýta aj pri
  vypnutom pýtaní.
- **`w3e-states.js` — 17 kontrol, 0 FAIL** (stubnuté `http`/`net`, celý offline
  automat odkrokovaný). Prerušený beh pri živom backende ukáže **len pás** v režime
  `run`; pri mŕtvom backende offline obrazovku v režime `run`, a keď backend nabehne,
  **nič sa nenačíta** — stav je `ready` a čaká sa na človeka. „Pokračovať v okne“
  zhasne prekrytie bez načítania (front správ prežije), „Načítať znovu“ načíta
  **vlákno chatu, nie graf**. Kalibrácia: nenačítaná appka (režim `load`) sa naopak
  zotaví sama, takže harness meria rozdiel, nie ticho.
- **`w3e-smoke.js` — 16 kontrol, 0 FAIL v SKUTOČNOM Electrone, bez okna.** Stuby
  nevedia, či Electron API existuje a má taký tvar — toto vie: skratka sa naozaj
  zaregistruje (`globalShortcut.isRegistered` ju vidí) a po `unregister()` ju systém
  už nedrží; tray menu sa postaví aj s akcelerátorom aj bez neho; notifikácie o behu
  sa vydajú; `onSendHeaders`/`onCompleted`/`onErrorOccurred` prijmú poslúchača a
  injekcia tokenu na `onBeforeSendHeaders` môže žiť vedľa nich.

Chyba, ktorú našlo až toto meranie: `globalShortcut.register('Ctrl+Shift+')`
**nehodí výnimku** — vypíše varovanie a vráti `false`, teda to isté ako obsadená
skratka. Tray by o preklepe v `settings.json` tvrdil „drží ju iná appka“. Rieši to
`looksLikeAccelerator()` v `shortcut.js`; smoke odteraz meria oba stavy oddelene.
Druhá: kým spustený príkaz beží, `runDockerNow` predtým **ticho** nič neurobil
(`docker compose up` bez `-d` nedobehne nikdy) — teraz to povie notifikáciou.

## Čo je OVERENÉ zo shellu (namerané 24. 8. 2026, Electron 43.4.1)

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

- **Rozlíšenie „dobehol“ vs „zaparkoval“ na `/chat`.** Že ťah zaparkoval, vie shell
  len z karty povolenia v DOM: `preload.js` sleduje `.perm-card[data-id]` a po
  rozhodnutí `.decided` (tak, ako to kreslí `public/js/console/tools.js`). Ak
  `/chat` kreslí kartu inými značkami, zaparkovaný ťah dostane notifikáciu „beh
  dobehol“ — nie je to pád behu ani brány (tá je na serveri), ale nepravdivá veta.
  **Kontrakt pre frontend:** karta čakajúceho zápisu nesie triedu `perm-card`,
  `data-id`, `data-name` a po rozhodnutí `decided`. Overiť sa to dá až behom proti
  skutočnej appke.
- **Skratka proti skutočnému `/chat`.** Že `Ctrl+Shift+H` naozaj postaví kurzor do
  composeru, sa meralo len ako generický výber `textarea`/`contenteditable` — nie na
  skutočnej stránke chatu (tu sa Docker spúšťať nesmie). Keď composer nebude
  posledné viditeľné textové pole zdola, fokus sadne inam.
- **Spustenie Dockeru sa nikdy neskúšalo naostro** (v tomto prostredí sa Docker
  spúšťať nesmie): `spawn` je stubnutý, takže overený je tvar príkazu, súhlas a
  adresár — nie to, že `docker compose up -d` na tomto stroji naozaj nabehne.
- **Notifikácie na oku.** Že sa vydajú bez výnimky, je namerané; ako vyzerajú
  v centre oznámení Windows, nie.
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
  oku, prepnutie Graf/Chat/Charón, téma) — v tomto prostredí sa screenshot nedá
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

**To číslo je z 24. 8. 2026.** Vlna lokálneho rastu (25. 8.) pridala štyri vlastné
moduly (`runwatch.js`, `shortcut.js`, `docker.js`, `settings.js`), takže ďalší
`--dir` build ich má vypísať ako **16 súborov** — a nič viac. `files`, `asar` ani
`dependencies` sa nemenili a projekt má **stále nulu runtime závislostí**: nové
moduly stoja len na `electron` a na štandardnej knižnici Node.
