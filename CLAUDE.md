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

**Jedna veľká scéna, dva pohľady, zanorenie je len filter.**

- `S.gview` = `'net'` (organický oblak) alebo `'layers'` (vodorovné pásy podľa
  `layer_role`: vstup → skryté → jadro → výstup). Prepínače `#btn-view-net` /
  `#btn-view-layers` v hlavičke, kláves `V`. **Pohľady NIE SÚ zrušené** —
  `setView()` je živý kód, nie shim.
- `go({level, area, dept, node})` v `sim.js` **nemení pozície ani nevymieňa scénu**.
  Je to filter: fokusová skupina zostane plná, zvyšok stmavne na `DIM_CTX` (0,34).
  `L.pos` preto obsahuje **vždy všetkých ~1065 uzlov**, na každej úrovni.
  `Esc` zruší filter, `#btn-up` ide o úroveň von.

**d3 `forceSimulation` JE späť** (od `a4497ff`) a pozície sú organické, nie
deterministické. Determinizmus bola moja vlastná podmienka z augusta 2026, ktorú
používateľ nikdy nežiadal a ktorá zabila živý dojem siete — nezavádzaj ju znova.
Ťahanie uzlov funguje (`fx/fy` + `holdSim`).

**Simuláciu tiká vlastná rAF pumpa** (`pump()` v `sim.js`), nie d3 timer — ten beží
na `requestAnimationFrame` a rozbil by pravidlo „mimo Grafu sa nekreslí". Mimo Grafu
pumpa **netiká na rAF, ale dosadá ticho** cez `setTimeout` (10 ms dávka / 50 ms):
bez toho by alpha nikdy neklesla, timer sa preplanoval navždy a každý WS zrod uzla
by zaplatil studený burst ~150 ms na zablokovanom vlákne.

**Ako scéna vyplní viewport bez determinizmu:** gravitácia je **anizotropná** — v Y
je `ar^squashPow`-krát silnejšia (`PHYS.squashPow = 2`). V rovnováhe má oblak pomer
strán ≈ pomer viewportu, takže fit sadne na obe osi naraz. Bez toho by sa force
layout usadil do kruhu a na 16:9 pokryl ~55 % šírky. `normalizeAspect()` to po
usadení dotiahne. Okraje sa čítajú z CSS tokenov (`--rail-w`, `--header-h`,
`--panel-w`, `--edge`) — nezadrôtuj ich znova do JS.

**Vizuálna sémantika** (jeden význam na kanál): farba = oblasť, tvar = typ.
Uzly sú **priehľadné prstence**, nie plné disky — priehľadnosť nesie *diera*, nie
nízka alfa, takže sa prekrývajúce uzly dajú čítať a každý drží kontrast (obrys má
podlahu `RING_LW = 1,5` px v obraznovkových px; pri 1,1 px zoberie antialiasing
viac než polovicu kontrastu). Spomienka = jeden prstenec, skill = dva súosé,
projekt = prstenec s plným stredom, **jadro = jediný sýty plný prvok** (zlato).
Legenda v `panels.js` musí hovoriť ten istý jazyk — plné disky tam učili zle.

**Farby oblastí sa utlmujú v OKLCh** (`mutedColor()` v `theme.js`): zrezaná chroma
a **jednotná cieľová svetlosť** pre všetky oblasti, takže oko ich číta ako jednu
tichú vrstvu a rozlišuje len tónom. Podlaha kontrastu (3,15:1 voči papieru) je
súčasťou funkcie, nie kozmetika. Každý swatch oblasti v DOM (legenda, štatistiky,
strom, Knižnica, Dnes) musí ísť cez `mutedColor()`, inak UI hovorí inou farbou než
plátno. V HSL to nerob — z gold by bola špinavo hnedá.

**Hrany sú hlavný nosič dojmu, nie dekorácia.** Kreslia sa všetky (~2882) ako
vlásková textúra; hustota nesie štruktúru. `S.minWeight` default je **0** (bolo 1,0
a skrývalo 791 hrán). Jednotlivá hrana zámerne nedosahuje 3:1 — pri 2000 vláskach
to je nezlučiteľné s „jemnou sieťou"; význam nesie hustota a pri hoveri ide hrana
na akcent, kde prah **spĺňa**.

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

Ďalšie tri pasce toho istého druhu, na každú z nich sa dá naletieť:

- **Nečakaj fixný čas, čakaj na obsah.** `/api/journal` a `/api/dashboard` bežia 3–4 s.
  Pri kratšom spánku sa nasnímkuje loading skeleton a *všetky* obrazovky vyzerajú
  prázdne. Čakaj na `waitForFunction`, kým v `.screen.active` nie sú položky.
- **Nepíš merací skript ako kópiu formuly z kódu.** Po zmene kódu bude merať svoju
  starú kópiu a hlásiť nezmenené čísla. Nechaj render vystaviť výsledok na `S`
  (napr. `S._labelBoxes`) a čítaj ten.
- **Hades je živý.** Medzi dvoma načítaniami sa naučí nové uzly a Denníku narastie
  celý nový deň, takže „pred a po" screenshoty sa líšia aj bez tvojej zmeny. Pri
  porovnávaní CSS prepni stylesheet nad tým istým DOM v tom istom okamihu.

## Testy

`docker compose exec app php artisan test` — 95 testov, všetko PHP (backend, MCP,
API). Frontend testy nie sú; UI sa overuje prekliknutím v prehliadači.

## Pasca: overuj IDENTITU preview servera

Harness beží na `127.0.0.1:8091` (predtým 8099 — ten zabral kontejner
`zapis_porady_app`). Keď preview server zhasne, port prevezme **cudzia appka** a
harness potom meria ju: `verify.js` vráti „VERDICT: OK", `rvsweep.js` nahlási
neexistujúcu kontrastnú regresiu a `a3-check.js` sa nedočká `window.HADES`.
Naletel som na to.

**Pred každým meraním over, že server je náš:**

```
curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'
```

Musí vypísať `/js/mind/main.js`. Ak vypíše niečo iné (alebo hlavička odpovede
obsahuje `X-Powered-By: PHP`), meriaš cudziu appku a všetky čísla sú bezcenné.
