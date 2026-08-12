# Hades (AI-mind) — poznámky pre Claude Code

Laravel + MariaDB + Redis + Reverb v Dockeri. MCP server `hades` na
http://localhost:8080/mcp, vizualizácia na http://localhost:8080.

## Frontend

Vizualizácia **nemá build step**. `resources/views/mind.blade.php` je statické HTML
a načítava `public/js/mind/main.js` ako `<script type="module">`. Vite v projekte je,
ale `mind.js` sa cez neho nikdy nepúšťal — needituj `vite.config.js` kvôli grafu.

`public/js/mind/` je **31 natívnych ES modulov** (do 8/2026 to bol jeden IIFE
s 5933 riadkami). Kľúčové:

| Modul | Zodpovednosť |
|---|---|
| `state.js` | zdieľaný objekt `S` — jediný zdroj pravdy, všetci ho importujú |
| `layout.js` | `computeLayout()` — deterministické rozloženie pre aktuálnu úroveň, `viewInsets()` / `camInsets()` |
| `sim.js` | stavový stroj `go({level, area, dept, node})`, `currentPath()`, `goUp()` |
| `render.js` | kreslenie canvasu, `fitCam()`, `graphActive()`, `publishNavApi()` |
| `edges.js` | hrany a agregované stuhy medzi oblasťami |
| `controls.js` | ovládanie + presety nastavení |
| `screens/*.js` | jednotlivé obrazovky (Dnes, Denník, Knižnica, …) |

**Cyklické importy sú v tomto grafe nevyhnutné** (`render` ↔ `panels` ↔ `controls`).
Preto: **exportuj funkcie ako hoistované `export function`, nikdy ako
`export const foo = () => {}`** — arrow v `const` nie je hoistovaná a pri cykle spadne
na `ReferenceError: Cannot access 'foo' before initialization`.

### Graf

Jeden graf, štyri úrovne zanorenia: `map` → `area` → `dept` → `node`, riadené
`go()` v `sim.js`. Pohľady Mapa/Sieť/Vrstvy sú zrušené, `setView()` je len shim.

**d3 `forceSimulation` neexistuje.** `S.sim` je vždy `null`, layout je čisto
deterministický (`hash01()` namiesto `Math.random()`, všetko zoradené). Preto:
nepridávaj fyziku ani ťahanie uzlov — rozbije to determinizmus a s ním garanciu,
že scéna vyplní viewport.

**Ako sa scéna fituje** (a prečo bola predtým úzka): každá úroveň sa rozloží
radiálne (pomer ~1:1) a jej bbox sa jednou afinnou transformáciou namapuje na
cieľovú elipsu, ktorej pomer strán kopíruje využiteľnú plochu viewportu.
`fitCam()` používa tie isté okraje, takže fit vyjde na oboch osiach naraz.
Okraje sa čítajú z CSS tokenov (`--rail-w`, `--header-h`, `--panel-w`, `--edge`) —
nezadrôtuj ich znova do JS.

**Vizuálna sémantika** (existujúci štandard projektu, jeden význam na kanál):
farba = oblasť, tvar = typ (spomienka = plný disk, skill = donut, projekt = disk
s prstencom, jadro = zlaté súosé kruhy). Značka istoty sa kreslí až od úrovne
`dept`. Na `map` sú uzly 2,6 px prach — tvar tam nie je čitateľný a ani nemá byť.

Mimo obrazovky Graf sa `requestAnimationFrame` **zastaví** (`graphActive()`).
Keď pridávaš window listener, ktorý siaha na graf, daj mu `graphActive()` strážcu —
inak beží nad 1000+ uzlami na obrazovkách, kde graf nikoho nezaujíma.

### CSS

`public/css/mind.css`, ~3700 riadkov. Pravidlo: **žiadny raw hex/rgba mimo `:root`**,
všetko cez tokeny. Svetlá paleta je v `:root`, tmavá v `:root[data-theme="dark"]`.
**Tmavá je default** (`initialTheme()` v `theme.js`).

Presvitanie utlčeného grafu pod obsahom je **len na tmavej téme** — na svetlej
ostáva plátno mimo Grafu skryté, pretože pod poloprehľadnými chipmi tam kontrast
textu závisel od obsahu grafu.

Známy dlh: v súbore je ~46 dvojíc „selektor + vlastnosť" deklarovaných dvakrát
s inou hodnotou (raz pri deklarácii, raz v override bloku na konci). Keď meníš
vzhľad karty alebo mriežky, **grepni selektor na oba výskyty**, inak zmena nebude
mať efekt.

## Overenie UI

Docker servuje repo z jeho koreňa, takže **worktree na 8080 neuvidíš**. Postup,
ktorý funguje (prehliadače v tomto prostredí blokujú `file://` aj `localhost`):
headless Chrome cez `puppeteer-core` (`C:\Program Files\Google\Chrome\Application\chrome.exe`,
node na `C:\Program Files\nodejs\node.exe`). Pre worktree si postav malý statický
server, ktorý servuje `public/` a `/api` proxuje na 8080.

Onboarding karta sa vypína `localStorage.setItem('hades.hints2', 'done')` **pred**
loadom (`evaluateOnNewDocument`) — klik na `#hint-skip` po loade ju nespoľahlivo skryje
a prekryje každý screenshot.

**Harness si vždy skalibruj na známom stave.** Merač kreslenia obaľoval `ctx.clearRect()`,
ktorý render nepoužíva, takže vracal vždy 0 a kritérium „rAF stojí mimo Grafu"
vyzeralo splnené bez toho, aby čokoľvek meralo. Obaľuj `window.requestAnimationFrame`.
Pri kontraste neber farbu textu cez `elementFromPoint` — vracia iný element, a tým
cudziu farbu (dávalo to falošné 1,01:1 na bielom texte na tealovej výplni).

## Testy

`docker compose exec app php artisan test` — 95 testov, všetko PHP (backend, MCP,
API). Frontend testy nie sú; UI sa overuje prekliknutím v prehliadači.
