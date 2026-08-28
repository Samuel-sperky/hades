# Plán vlny 2 + 3 — zadanie pre 12 implementátorov

Dátum: 27. 8. 2026 · vetva `feat/hades-redesign` · kontrakt
`KONTRAKT-REDIZAJN-2026-08-27.md` · zdroj pravdy `docs/BRAND-HADES.md`
(prepísaný pred týmto plánom, rozhodnutie 1).

Vstup: štyri sondy z 27. 8. 2026 (A: URL a `localStorage`, B: ikony a subset,
C: pohyb a tiché verzie, D: rail, zlomy, typografia a chyba).

## 0. Ako sa tento plán číta

**Delenie je podľa SÚBOROV, nie podľa témy.** Dva agenti v jednom súbore sa ticho
prepíšu — to je jediná chyba tohto behu, ktorá sa nedá opraviť inak než opakovaním.
Preto:

1. **§1 je zákon.** Píš len do svojich súborov. Zmenu v cudzom súbore **nahlás
   v `deviations` a NEROB ju**.
2. **Rozhrania medzi agentmi sú v tomto pláne zamrznuté** (§2). Preto nikto na
   nikoho nečaká, okrem reťazca nad `mind.css`.
3. **Každý agent má číselné kritérium** (§4). Bez zmeraného čísla nie je hotovo.
   Dôkaz je **zmeraný DOM a computed style, nie screenshot** — Browser pane
   v tomto prostredí nekompozituje rámce a screenshot padne na timeout.
4. **Pred každým meraním over identitu servera:**
   `curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'` musí vypísať
   `/js/mind/main.js`. Ak vypíše niečo iné, meriaš cudziu appku.
5. **Merací harness kalibruj z OBOCH strán** a nikdy ho nepíš ako kópiu formuly
   z kódu — po zmene kódu by meral svoju starú kópiu.

**Nedotknuteľné** (aj keby to dizajn navrhoval): dvojfázová brána zápisov · živý
force layout grafu a zastavenie `rAF` mimo obrazovky Graf · dvojitá plocha
UI = MCP. Detail v kontrakte §2.

**Ďalšie invarianty:** žiadny bundler nad `public/js`, žiadna CDN · žiadny raw
hex/rgba mimo `:root` · hoistovaná `export function`, nikdy
`export const foo = () => {}` · `:where()` keď chceš oslabiť, nie `:is()` · jeden
globálny `:focus-visible` (0-1-0), `border-radius` v ňom nie je · komentáre po
slovensky a vysvetľujú PREČO · identifikátory anglicky, UI texty slovensky · každá
nová animácia má tichú verziu, a nie „vypnuté".

---

## 1. Vlastníctvo súborov

Každý súbor patrí **presne jednému** agentovi. Kde stojí „len región", je hranica
uvedená doslovne a **edituj výhradne cez `Edit`, nikdy cez `Write`** — celý zápis
súboru by prepísal cudzí región.

| Súbor | Vlastník | Poznámka |
|---|---|---|
| `public/css/mind.css` | **A1 → A2 → A3 → G** | **SEKVENČNÝ REŤAZEC**, nikdy paralelne |
| `public/js/shared/icons.js` *(nový)* | **B** | |
| `public/js/mind/urlstate.js` *(nový)* | **C1** | |
| `public/js/mind/state.js` | **C1** | |
| `public/js/mind/sim.js` | **C1** | |
| `public/js/mind/screens.js` | **C1** | router obrazoviek = jadro URL |
| `public/js/mind/screens/*.js` (**7** súborov: `dnes`, `dennik`, `rozhodnutia`, `runy`, `kniznica`, `kontrola`, `smernica`) | **C2** | URL **aj** výmena ikon |
| `public/js/mind/filters.js` | **C2** | |
| `public/js/mind/tagfilter.js` | **C2** | |
| `public/js/mind/search.js` | **C2** | |
| `public/js/chat/threads.js` | **C3** | URL **aj** výmena ikon |
| `public/js/chat/branches.js` | **C3** | |
| `public/js/chat/artifact.js` | **C3** | |
| `public/js/chat/main.js` | **C3** | |
| `public/brand/*` | **D** | |
| `public/favicon.ico` | **D** | |
| `electron/**` (vrátane `assets/build-icon.py`, `chrome/topbar.html`, `states/offline.html`) | **D** | |
| `<head>` troch blade súborov — **len riadok `<link rel="icon">`** | **D** | |
| `public/css/charon.css` | **E** | |
| `public/css/console.css` | **E** | |
| `public/css/chat.css` | **E** | |
| `public/js/mind/*.js` — **všetko okrem siedmich súborov C1 a C2** | **F1** | teda okrem `state.js`, `sim.js`, `screens.js`, `urlstate.js` (C1) a `filters.js`, `tagfilter.js`, `search.js` (C2), a okrem podadresára `screens/` (C2). F1 vlastní **23 súborov**: `anim.js`, `api.js`, `certainty.js`, `charon.js`, `cmdk.js`, `controls.js`, `dock.js`, `edges.js`, `http.js`, `interaction.js`, `layout.js`, `main.js`, `md.js`, `pack.js`, `panels.js`, **`rail.js`**, `render.js`, `shortcuts.js`, `structure.js`, `theme.js`, `timeline.js`, `toasts.js`, `util.js`, `ws.js` |
| `resources/views/mind.blade.php` — **všetko pod `</head>`** | **F1** | |
| `public/js/chat/*.js` — **všetko okrem** `threads.js`, `branches.js`, `artifact.js`, `main.js` | **F2** | teda `agents.js`, `attach.js`, `highlight.js`, `render.js`, `run.js`, `voice.js` |
| `public/js/console/*.js` (10 súborov) | **F2** | `composer`, `dom`, `http`, `main`, `models`, `render`, `run`, `slash`, `state`, `tools` |
| `public/js/shared/*.js` — **všetko okrem** `icons.js` | **F2** | `agents.js`, `copy.js`, `gate.js`, `markdown.js`, `ndjson.js`, `runclient.js`, `runstate.js` |
| `resources/views/chat.blade.php` — **všetko pod `</head>`** | **F2** | |
| `resources/views/console.blade.php` — **všetko pod `</head>`** | **F2** | |
| `public/fonts/**` | **G** | mazanie subsetu |
| `<head>` troch blade súborov — **len riadky `<link rel="preload">` fontov** | **G** | beží **po** D |
| `public/js/charts.js` | **F1** | jediný súbor mimo `mind/`, ktorý F1 vlastní |

**Nikto nevlastní:** `app/**`, `tests/**`, `config/**`, `CLAUDE.md`, kontrakt,
`docs/BRAND-HADES.md`, `docs/PLAN-VLNA2-3.md`. Zmena v nich → `deviations`.

**Reťazec nad `mind.css`:** A1 skončí → A2 začne → A3 začne → G začne. Každý ďalší
si pred prvou zmenou súbor **prečíta znova** (riadkové čísla v tomto pláne sú
z predvlnového stavu a po predchodcovi sa posunú).

**Blade `<head>`:** región nad `</head>` majú D a G, v tomto poradí. Región pod
`</head>` má F1 (`mind`) a F2 (`chat`, `console`). Nikto iný sa blade nedotýka.

---

## 2. Zamrznuté rozhrania

Tieto podpisy sú **záväzné**. Kto ich zmení, zlomí agenta, ktorý na ne písal
naslepo. Zmena podpisu = `deviations`, nie tichá úprava.

### 2.1 Ikony (B → A1, F1, F2, C2, C3)

```js
// public/js/shared/icons.js
export function iconSvg(name, opts)      // -> SVGElement
export function iconMarkup(name, opts)   // -> string '<svg class="ic" …>…</svg>'
export function iconSwap(el, name)       // vymení kresbu na existujúcom prvku
export const ICON_NAMES = [...]          // 60 mien
```

- `opts` = `{ cls, size, title }`; `cls` sa pridá **k** `ic`, `size` je názov
  tokenu (`'xs'|'sm'|'md'|'lg'|'2xs'`), nie px.
- **Trieda je `ic`, nikdy `ms`.** Kreslí ju A1.
- **Neznámy názov** → kresba `ring` + zápis do `window.HADES._iconMiss` (pole
  mien). Ticho prázdny prvok je zakázaný.
- Markup: `<svg class="ic" viewBox="0 0 24 24" width="1em" height="1em"
  aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75"
  stroke-linecap="round" stroke-linejoin="round">`.
  `width/height` v `em`, aby veľkosť nesol `font-size` z CSS — presne ako dnes
  `.ms`, takže 26 per-komponentných prepisov veľkosti prežije bez zmeny.

### 2.2 URL (C1 → C2, C3)

```js
// public/js/mind/urlstate.js
export function readUrl()                 // -> plain object { s, a, d, ... }
export function writeUrl(patch, mode)     // mode: 'push' | 'replace'
export function urlValue(key)             // jedna hodnota, uz orezana
export function urlList(key)              // -> string[] (getAll + strop 24)
export function clearScreenKeys()         // zmaze kluce filtrov pri zmene obrazovky
export function bootValue(key, stored, fallback)  // URL > localStorage > default
```

- **`urlstate.js` NESMIE importovať nič z `mind/`** — inak `/chat` pri jednom
  importe stiahne celý graf. Je to čistý modul nad `URLSearchParams`.
- `writeUrl` **debouncuje** filtre 220 ms a `mw` 200 ms sám; volajúci nedebouncuje.
- Vystavuje `window.HADES._urlKeys` = aktuálne serializované kľúče (pre meranie).
- `readUrl()` **normalizuje legacy `screen=` na `s`** a pri prvom zápise `screen`
  odstráni.

### 2.3 Pohyb: zanorenie (C1 → F1)

C1 v `go()` nastaví `S._dimTween = { t0: S._clock, dur: 0.18 }` (`--dur-base`).
F1 v `render.js` interpoluje `ent.dim` k cieľu z `computeLayout()` podľa tohto
tweenu; keď `S._dimTween` je `null` alebo reduced motion, `dim` sadne v jednom
rámci. **Nikto iný `S._dimTween` nečíta ani nepíše.**

### 2.4 Rail (A2 → F1)

- A2 kreslí `body[data-rail="wide"]` (default) a `body[data-rail="slim"]`,
  a tlačidlo `#rail-collapse`.
- F1 pridá markup `#rail-collapse` do `mind.blade.php` a mechaniku do
  **`mind/rail.js`**, kde už žijú odznaky railu. Číta a zapisuje
  `localStorage['hades.rail']` (`wide` / `slim`), atribút nastaví **pred prvým
  rámcom** (rovnaký vzor ako `initialTheme()`), aby rail neblikol.

### 2.5 Tokeny pohybu (A3 → E, F1)

A3 zavedie do `:root`: `--ease-pulse`, `--dur-chart-draw`, `--dur-chart-curve`,
`--dur-chart-reveal`; zmaže `--transition-base`, `--transition-slow`. E a F1 na ne
píšu podľa mena, bez čakania.

### 2.6 Znak (D → A3, F1, F2)

D vydá generátorom šesť výstupov (§4-D) a v reporte uvedie **presné hodnoty**:
`stroke-dasharray` prstenca (dnes `54.29`), tri čísla `.load-mark` a jeden inline
`<svg>` blok pre Blade. A3 tú `dasharray` hodnotu zapíše do `mind.css`, F1 a F2
vložia blok do svojich blade regiónov.

---

## 3. Poradie behu

| Vlna | Agenti |
|---|---|
| 1 | **A1**, B, C1, C2, C3, D, E, F1, F2 — paralelne |
| 2 | **A2** (po A1) |
| 3 | **A3** (po A2) |
| 4 | **G** (po A3 a po D) |

Rozhrania sú zamrznuté, takže mimo reťazca nad `mind.css` nikto na nikoho nečaká.

---

## 4. Zadania

### A1 — `public/css/mind.css`: kresba ikon a nových stavov

**Rob:**

1. Zaveď triedu **`.ic`** ako náhradu `.ms`: `display: inline-block`,
   `width: 1em; height: 1em`, `flex: none`, `vertical-align: -0.125em`,
   `font-size: var(--icon-md)` ako základ. `.ms` **NEMAŽ** — maže ju G na konci
   reťazca, dovtedy musia obe existovať, inak je appka medzi vlnami rozbitá.
2. Prenes všetkých **26 per-komponentných prepisov `font-size` na `.ms`
   selektoroch** tak, aby platili aj pre `.ic` (`:is(.ms, .ic)`). Použi `:is()`
   zámerne — obe triedy sú rovnako silné, nič sa neoslabuje.
3. Zaruš tri **nemenované výnimky bez tokenu**: `.empty.empty-network` 48 px
   (`mind.css:2782`) → nový token `--icon-hero: 48px` v `:root`.
4. **Chybový komponent v toku** — kresba bubliny chyby, ktorú dnes `/chat` nemá
   vôbec. Kánon je verzia konzoly: telo `--text`, `--danger-ink` len na menovke,
   pozadie `--danger-soft`, rám `--danger-border`. Trieda je jedna a bude ju
   používať `console.css`, `chat.css` aj `charon.css` (E ich na ňu prepojí);
   `mind.css` sa načítava prvý na všetkých troch plochách, takže **kresba patrí
   sem**. Pomenuj ju `.msg-error` a zdokumentuj, že je to plocha-agnostický
   komponent.
5. **Prstenec nájdeného uzla a fokusový obrys** nekresli — sú na plátne (canvas),
   patria F1.

**NESMIEŠ:** `--rail-w`, `.dest`, `#rail*`, `@media (max-*)` bloky (A2) ·
`:root` tokeny trvaní a `@media prefers-reduced-motion` (A3) · `@font-face`
a `.ms` mazanie (G) · žiadny iný súbor.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| `.ic` s `font-size` na 26 pôvodných call-site | 26 z 26 sa zhoduje s hodnotou pre `.ms` na tom istom selektore |
| raw px `font-size` na ikonových selektoroch v `mind.css` | **0** |
| `.msg-error` vs `.msg` (`/console`) | pozadie, rám aj farba menovky **sa líšia**; kalibruj negatívne na `.msg.system`, kde sa líšiť nesmú |
| dvojité deklarácie (`w4dup.js`, kalibrovaný z oboch strán) | A=0, B a C nesmú narásť oproti predvlnovému stavu |

---

### A2 — `public/css/mind.css`: rail a zjednotenie zlomov

**Rob:**

1. **Rail dva stavy.** `--rail-w: 208px` pre `body[data-rail="wide"]` (default),
   `80px` pre `slim`. Otvor a preprav **tri zadrôtované 68 px**:
   `mind.css:1186` (`#brand-core`), `:1279` (`.rail-eyebrow`), `:1373` (`.dest`).
   V `wide` je `.dest` **riadok** (`flex-direction: row`, `min-height: 40px`,
   ikona + `.lbl` vedľa seba, `text-align: left`); v `slim` zostáva dnešný stĺpec
   52 px. `.lbl` v `slim` je 10 px pod ikonou, v `wide` `--fs-caption` vedľa nej.
   Labely zostávajú **chróm** — nezdvíhajú sa s dátovým textom.
2. Nakresli `#rail-collapse` (tlačidlo dole v raile, ikona `ellipsis` v `slim`,
   `arrow-up` otočená… **nie** — použi `arrow-down` / `arrow-up` zo sady B,
   `.ms.flip` už neexistuje). Markup pridá F1, ty kreslíš selektor.
3. **Oprav komentár `mind.css:267`**: `--content-left` je `--edge` 16 +
   `--rail-w` + `--edge`, teda **112 px** v `slim` a **240 px** v `wide`, nie
   `/* 104px */`.
4. **Zjednoť zlomy na 1280 a 900.** Zlúč dva bloky `@media (max-width: 1280px)`
   (`:3831` a `:3884`) do jedného. Presuň `@media (max-width: 860px)` (`:4035`,
   `.dir-cols`) na **900 px**. **Zmaž `@media (max-height: 860px)`** (`:1312`) —
   po rozbalení railu stratí volajúceho. `@media (min-width: 901px)` (`:3507`)
   **nechaj**, je to korektný komplement.

**NESMIEŠ:** `.ic` / `.ms` kresbu (A1) · tokeny trvaní a reduced-motion (A3) ·
`console.css` (tam presúva 860 → 900 agent E) · blade markup (F1) · JS.

**Zmeraj** (vždy po `resize_window`, inak je `innerHeight` **0**):

| Kritérium | Číslo |
|---|---|
| `wide` rail: `scrollHeight` vs `clientHeight` pri 1280 × 614 | `scrollHeight ≤ clientHeight`; kalibruj **z oboch strán**: pri 613 padne, pri 614 sadne |
| `slim` rail pri 1280 × 746 | sadne; pri 745 padne (dnešná hodnota, nesmie sa zhoršiť) |
| šírka `#screens` pri `wide` | 1920 → 1664 · 1280 → 1024 · 900 → 644 · 768 → 512 |
| `.dest` šírka a odsadenie v `wide` | šírka ≈ `--rail-w` − 2 × padding; odsadenie od ľavej hrany **≤ 12 px** (dnešná pasca dá 70 px) |
| orez obsahu na 1920 / 1280 / 900 / 768 | `scrollWidth > clientWidth` pri `overflow-x: visible|hidden`, bez `ellipsis` a `.sr-only` → **0 nad základňou**; kalibruj pozitívne pri `--rail-w: 900px` (musí vyhodiť 6 orezaných `.today-item`) |
| prekrytie `#rail × #node-panel × #header` pri 768 px | **0 px**; panely testuj **po jednom** — `dock.js:36` a `panels.js:30` držia výlučnosť pod 900 px a odobranie `.hidden` obom naraz dá falošný nález 324 × 816 px |
| šírkové `@media` hodnoty v `mind.css` | množina = `{1280, 901, 900}`; `860` = 0 zásahov, `max-height` = 0 zásahov |

---

### A3 — `public/css/mind.css`: tokeny pohybu, podlaha, keyframes znaku

**Rob:**

1. **Nový token `--ease-pulse: cubic-bezier(.4,0,.6,1)`** v `:root` s komentárom,
   PREČO (príchodová krivka na nekonečnej slučke kulhá — spomalí a skočí).
   Nasaď ho na slučkové animácie v `mind.css`: `hades-shimmer`, `load-breathe`,
   `sync-pulse`, `core-pulse`.
2. **Zmaž `--transition-base` a `--transition-slow`** (0 volajúcich, zmerané).
   `--transition-fast` prepíš na párový zápis na jeho jedinom mieste
   v `mind.css` (`:5209`); ostatné tri sú v `console.css` a `chat.css` (E).
3. **Grafové tokeny:** `--dur-chart-draw: 760ms`, `--dur-chart-curve: 900ms`,
   `--dur-chart-reveal: 720ms`. Nasaď na `mind.css:1238` (`bc-draw`), `:2669`
   (`.seg-draw`), `:2672` (`.line-draw`), `:2687` (`.heat-reveal`). Komentár
   `:2660–2664` **nechaj** — je pravdivý.
4. **Zapíš `stroke-dasharray`** hodnotu, ktorú vydal generátor D
   (`mind.css:1233–1234`, `:1246`), a pri nej komentár, že je to **derivát
   polomeru z generátora**, nie ručná konštanta.
5. **`.load-mark`** dostane tri čísla z generátora D. Komentár o kontraste
   (`:2637` a nad ním) **nechaj** — je pravdivý a je dôvodom, prečo tie čísla nie
   sú 1 : 1 s mini znakom.
6. **Pomenované tiché verzie pre nové pohyby** (v tom istom
   `@media (prefers-reduced-motion: reduce)` bloku, trieda + `!important`):
   - fokusový obrys zanorenia — trvalý, nezhasne,
   - prstenec nájdeného uzla — konštantná alfa, drží 2 s,
   - `#rail-collapse` prechod šírky railu → okamžitý.
7. **Škrt dekorácie** (rozhodnutie 6): `fade-in` scrimu pod `#help-overlay`
   (`:2146`) a `#md-overlay` (`:2194`) — karta nad ním už robí `rise-fade`.
   A `.screen.active { animation: rise-fade }` (`:3415`) — zmenu už hlási rail
   aj nový `<h1>`. Obe s komentárom PREČO.

**NESMIEŠ ZA ŽIADNU CENU** dotknúť sa plošnej podlahy `mind.css:2852–2861`
(`*, *::before, *::after` s `!important`). Je to jediný nositeľ tichej verzie pre
**64 pohybov**; jej „upratanie" ich vypne naraz a nikto si to nevšimne.

**NESMIEŠ:** `.ic` kresbu (A1) · rail a `@media (max-*)` (A2) · `@font-face`
a `.ms` (G) · iné súbory.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| plošná podlaha v CSSOM | selektor `'*, ::before, ::after'` (prehliadač normalizuje — regex na `*, *::before` ju **nenájde** a je to falošný nález), 5 deklarácií, všetky `important` |
| `var(--ease-in-out` a raw `ease-in-out` v `mind.css` | **0** |
| `--transition-base` / `--transition-slow` | 0 definícií, 0 volajúcich |
| `--dur-chart-*` | 3 definície, 4 volajúci (760 ms na dvoch miestach je ten istý token) |
| slučkové animácie s `--ease-pulse` | 4 z 4 |
| animácie so škrtnutou dekoráciou | `#help-overlay`, `#md-overlay`, `.screen.active` = 0 `animation` deklarácií |
| tiché verzie nových pohybov | 3 pravidlá v reduced-motion bloku, každé so `!important` a špecificitou ≥ 0-1-0 |

---

### B — `public/js/shared/icons.js` (nový)

**Rob:** nakresli **60 SVG symbolov** podľa `docs/BRAND-HADES.md` §7 a §5 tohto
plánu a vydaj štyri funkcie z §2.1.

- Mriežka **24 × 24**, kresba v poli **20 × 20** (2 px vzduch), hrúbka **1,75**,
  `round` konce a spoje, `fill: none`, `currentColor`.
- **Jediný plný prvok v celej sade je jadro** symbolu `core`.
- **Kompozícia namiesto novej geometrie** je záväzná: prečiarknutie nad bázou
  (`magnifier-off`, `eye-off`, `filter-off`), check nad kontejnerom
  (`check-circle`, `check-double`, `shield-check`), výkričník nad kontejnerom
  (`alert-circle`, `alert-triangle`), plus badge nad bázou (`link-plus`,
  `library-plus`), dvojstav jedno telo + modifikátor (`lock` / `lock-open`).
- Sada je jeden modul s **hoistovanými `export function`**. Symboly drž ako
  statické stringy `<path>`/`<circle>` v jednom objekte — žiadny build step.
- **`iconSwap(el, name)`** je funkcia, ktorá existuje preto, aby nikto nepísal
  `el.textContent = '…'`. Musí fungovať aj na prvku, ktorý ikonu ešte nemá.

**NESMIEŠ:** meniť žiadny call-site (to robia F1, F2, C2, C3) · dotknúť sa
`shared/gate.js` (F2) · pridať 61. symbol bez `deviations`.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| `ICON_NAMES.length` | **60** |
| každý symbol má `viewBox="0 0 24 24"` a `stroke-width="1.75"` | 60 z 60 |
| prvky s `fill` iným než `none` | **1** (jadro symbolu `core`) |
| kresba mimo poľa 20 × 20 | 0 symbolov (parsuj súradnice, ber min/max) |
| `iconSvg('nieco-neexistujuce')` | vráti kresbu `ring` **a** `window.HADES._iconMiss` obsahuje `'nieco-neexistujuce'` — kalibruj aj kladne: po 60 platných menách je `_iconMiss` prázdne |
| `iconSwap()` na prvku s ikonou aj bez nej | v oboch prípadoch je po volaní v prvku presne jeden `<svg class="ic">` |
| `export const … = () =>` v súbore | **0** (cyklické importy padnú na `ReferenceError`) |

---

### C1 — `urlstate.js` (nový) + `state.js` + `sim.js` + `screens.js`

**Rob:**

1. **Napíš `public/js/mind/urlstate.js`** podľa §2.2 a slovníka §6. Je to
   **jediné miesto v repe**, ktoré query string číta aj píše. Pravidlá:
   - defaulty sa **vynechávajú**; kľúč s default hodnotou sa pri najbližšom zápise
     zahodí,
   - množiny = **opakovaný kľúč**, čítanie `getAll()`, strop **24** opakovaní
     (nad ním kľúč z URL vynechaj a stav nechaj lokálny),
   - stavaj **výhradne cez `URLSearchParams`**, nikdy konkatenáciou — kľúč skupiny
     Denníka je `#bez-projektu` a odsekol by zvyšok URL do fragmentu,
   - `token` a `k` **neemituj a nezahadzuj** (middleware a proxy si ich mažú samy
     a zvyšok query zachovávajú); každý iný neznámy kľúč **prenes nedotknutý**,
   - poradie kľúčov je **poradie riadkov v §6**, nie poradie zmien,
   - hodnoty množín sa **radia**,
   - každé čítanie a zápis `localStorage` v `try/catch`.
2. **`state.js`**: predvolené hodnoty musia byť **v kóde**, nie čítané z úložiska
   (na čerstvom profile appka zapíše len 2 z 15 kľúčov). Boot poradie
   `URL > localStorage > default` cez `bootValue()`. Legacy `?screen=` čítaj ako
   alias `s`, **normalizuj a prepíš adresu** — dnes `?screen=bogus` v adrese
   zostane a appka ukáže Dnes, teda URL lže.
3. **`sim.js`**: `go()` po `clampNav()` zapíše `a` / `d` / `n` **jedným**
   `writeUrl(..., 'replace')`; `goUp()` a `clearFilter()` to isté.
   `level` do URL **nepatrí** — implikuje ho najhlbší prítomný kľúč, `clampNav()`
   dopĺňa kontext nahor sám (namerané: `go({level:'dept',dept:1})` uložilo
   `area:2`). Kamera do URL **neide**. Nastav `S._dimTween` podľa §2.3
   a **podlahu zoomu vlož do CIEĽA tweenu `aimCamera()`**, nie pred neho.
4. **`screens.js`**: `setScreen()` robí **`pushState`** a **atomicky maže kľúče
   filtrov** cudzích obrazoviek (inak `?s=runy&roy=2026` prenesie rok
   z Rozhodnutí). `focusFound()` (`:233`) prestane priraďovať `S.cam.k` pred
   tweenom a nechá `sel` + `n` zapísať **jedným** záznamom.
5. **Jedno gesto = jeden záznam.** Skok na uzol z palety mení obrazovku, zanorenie,
   vybraný uzol aj možno rozsah — musí to byť **jeden** `pushState`.
6. **Zmenu, ktorú nevyvolal človek, robí `replace`** — automatické rozšírenie
   rozsahu na `all` aj `go()` vyvolané modelom cez `graph_focus`.

**NESMIEŠ:** obrazovky (`screens/*.js`, C2) · `render.js`, `anim.js`, `layout.js`,
`ws.js` (F1) · `chat/*` (C3, F2) · písať `b=` tak, aby aktivovalo vetvu (C3 to má
čítacie) · vymieňať ikony vo svojich súboroch, ak tam nejaké sú — **výnimka:** ak
`screens.js` alebo `sim.js` obsahuje ligatúru, vymeň ju ty (je to tvoj súbor)
a nahlás to v reporte, aby F1 nehľadal.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| test kruhu pre všetkých 37 kľúčov | `serializuj → deserializuj → serializuj` je **znakovo totožný** |
| záporná kalibrácia defaultov | URL s kľúčom na default sa po prvom zápise **skráti**; URL bez kľúča sa **nepredĺži** |
| `?screen=graf` | `s=graf` v adrese, `screen` **zmizne**, obrazovka `graf` |
| `?screen=bogus` | adresa sa opraví na **bez query**, obrazovka `dnes`, **žiadny toast** |
| `?fg=0,5 g&fg=pasca` | `S.filter.tags` má **2** položky, prvá je `'0,5 g'` (kalibruj negatívne: verzia s čiarkovým separátorom dá 3 položky) |
| `?dep=%23bez-projektu` | `journalProject === '#bez-projektu'`, `location.hash` je **prázdny** |
| `?token=…&s=graf` | po odomknutí je `s=graf` v adrese a `token` **preč** (odstrihol ho middleware, nie ty) |
| `?neznamy=1&s=graf` | `neznamy=1` v adrese **prežije** |
| skok na uzol z palety | prírastok `history.length` = **1** (obal nad `history`, kalibrovaný: vlastný `pushState` = 1) |
| `mw` slider ťahaný 30× | prírastok `history.length` = **0**, počet `replaceState` volaní ≤ 3 (debounce 200 ms) |
| `window.HADES._urlKeys` | existuje a merací skript ho čítal — **nie kópiu formuly z modulu** |
| `export const … = () =>` | **0** |

---

### C2 — `screens/*.js` + `filters.js` + `tagfilter.js` + `search.js`

**Rob:**

1. **Napoj šesť obrazoviek dát na URL** cez `urlstate.js` (§2.2) podľa slovníka
   §6: `dep` · `kna` · `kot` `koc` `koa` `kol` · `roy` `roa` · `rus` `rum` `ruo` ·
   spoločné `q`. Filtre a hľadanie = **`replaceState`**.
2. **Poradie je záväzné: URL → stav → dopyt → prune → `replaceState` orezanej
   pravdy.** Tri obrazovky už majú `prune`, ktorý zapnutý filter bez čipu zhodí
   (`pruneKontrolaFilters()` `kontrola.js:322`, `pruneRunFilters()` `runy.js:64`,
   `pruneDecisionFilters`, `pruneLibraryArea()` `kniznica.js:108`,
   `renderJournal()` `dennik.js:57`). **URL nesmie vynucovať filter nad prune
   logikou** — obrazovka by zostala trvalo prázdna bez čipu, ktorým sa filter ruší.
3. **Nepíš šiesty preklad filtra na serverový dopyt.** `decisionsQuery()`
   (`rozhodnutia.js:40`), `kontrolaQuery()` (`kontrola.js:66`), `query()`
   (`runy.js:58`), `renderLibrary()` (`kniznica.js:99`), `renderJournal()`
   (`dennik.js:45`) zostávajú **jediným** miestom prekladu. Komentár
   v `rozhodnutia.js:38` to hovorí priamo a je pravdivý.
4. **Knižnica má zámernú asymetriu:** `q` filtruje server, oblasť filtruje
   prehliadač (server posiela `limit=null`). **`kna` sa nesmie premietnuť do
   dopytu na server.**
5. **Krížový skok Dnes → Denník** (`dnes.js:140–144`) musí byť **jeden**
   `pushState` s `s=dennik&dep=<projekt>`.
6. **Vymeň ikony** vo svojich súboroch na `iconMarkup()` / `iconSvg()` (§2.1).
   Tvoje súbory obsahujú cesty 2, 3, 4, 6 a 7 zo §7 manuálu — konkrétne:
   `emptyHtml()` / `renderEmpty()` prvý argument (10 call-site: `cmdk.js` a `md.js`
   sú F1, tvoje sú `dennik.js:151`, `kniznica.js:154`, `kontrola.js:174`,
   `rozhodnutia.js:216`, `runy.js:89`, `smernica.js:105`, `:193`,
   `structure.js` je F1), ternáre (`dnes.js:310`, `dennik.js:201`,
   `rozhodnutia.js:140`, `:148`, `smernica.js:349`, `dnes.js:104`), mapovací stôl
   `DIR_SECTIONS` (`smernica.js:33–39`) a **`.textContent = 'lig'`**
   (`kontrola.js:559`, `rozhodnutia.js:367`) → **`iconSwap()`**, nikdy
   `textContent`.
7. **Tri toggle tlačidlá** vymieňajú dve kresby na jednom prvku
   (`rozhodnutia.js:140` `plus` ↔ `x`, `:148` a `smernica.js:349` `pencil` ↔
   `check`) → `iconSwap()`.
8. **`classList.add('ms')` / `remove('ms')`** pri armed-confirm
   (`rozhodnutia.js:354`, `kontrola.js:572`) prestane rozhodovať o fonte. Prepni
   režim ikona ↔ text tak, že sa prvok naozaj vymení, nie triedou.

**NESMIEŠ:** `urlstate.js`, `state.js`, `sim.js`, `screens.js` (C1) · `util.js`
(tam žijú `emptyHtml`/`renderEmpty`/`errorMarkup`/`filterMarkup` a vlastní ich
**F1** — ak treba zmeniť ich podpis, **nahlás to v `deviations`** a používaj
súčasný) · `cmdk.js`, `md.js`, `structure.js`, `panels.js` (F1) · CSS.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| obnoviteľných osí filtra zo šiestich obrazoviek | **11 z 11** (dnes 0): nastav, `F5`, porovnaj stav |
| Kontrola: filter typ + istota + oblasť + text + `kol=300` | po `F5` sedí **všetkých 5** a v zozname je 300 položiek |
| prune vs URL | `?kot=<neexistujuci-typ>` → filter sa zruší **a adresa sa skráti**; kalibruj kladne: platný typ v adrese zostane |
| počet miest, kde sa filter prekladá na serverový dopyt | **5** (nezmenené) |
| `?kna=vyvoj-kod` | v `Network` na `/api/library` **nie je** `area=` |
| Dnes → Denník klik na čip | prírastok `history.length` = **1**, adresa `?s=dennik&dep=…` |
| ligatúry v `screens/*.js`, `filters.js`, `tagfilter.js`, `search.js` | **0** (grep na `ICON_NAMES` staré ligatúrové mená) |
| `.textContent = '<ligatúra>'` a `classList.*('ms')` v tvojich súboroch | **0** |

---

### C3 — `chat/{threads,branches,artifact,main}.js`

**Rob:**

1. **Panely do URL:** `pt` (panel vlákien, default otvorený) a `pa` (panel
   artefaktu, default zatvorený), oba **`replaceState`**. Default je
   **dvojvrstvový**: kľúč chýba → preferencia z `localStorage['hades.chat.*']`;
   kľúč je → **explicitný príkaz z odkazu prebije preferenciu**; prepnutie panela
   zapíše **oboje**.
2. **Pod 900 px sa stav prekryvu nezapisuje** ani do `localStorage`, ani do URL.
   Dnešné chovanie je správne a je zmerané — **nerozbi ho**.
3. **Hľadanie v histórii do URL:** `q` (spoločné), `hr` `ha` `hb` `hn` `hp` `hl`,
   všetko `replaceState`. Dnes je `T` (`threads.js:51`) celé len v pamäti.
4. **`b` (vetva) je ČÍTACIE.** Aktívna vetva je stav **servera**
   (`console_threads.active_branch_id`); jediná klientská cesta je dnes
   `POST /api/console/branches/{uuid}/activate` (`branches.js:257`), teda
   **mutácia**. `b=` v URL sa preto **len číta do UI a NEAKTIVUJE**. Prepnutie
   vetvy človekom robí `pushState`. Rozšíriť to na čítaciu serverovú cestu je
   rozhodnutie používateľa — ak si myslíš, že to treba, `deviations`.
5. **`ar` NEZAVÁDZAJ.** Kľúč je v slovníku vyhradený, ale panel artefaktu sa plní
   z argumentov živého volania nástroja a **nič nenesie id**. Kľúč, ktorý po
   obnove stránky ukáže prázdny panel, je horší než žiadny. Zdôvodni v reporte.
6. **Šírky panelov (`threadsW`, `artifactW`) do URL neidú** — šírka je vlastnosť
   monitora, nie obsahu.
7. **Chybové triedy, ktoré emituješ, dnes nemajú kresbu.** Ty markup zjednotíš na
   komponenty, ktoré kreslí A1 a napája E: `.ct-err` + `.ct-retry`
   (`threads.js:1121`) → komponent „plocha sa nenačítala + jedna akcia"
   (`.empty--error`), `.is-err` (`branches.js:430`, `:436`, `:444`) → to isté.
   Bublinu chyby (`.cm-error`) rieši F2 v `chat/render.js`.
8. **Vymeň ikony** vo svojich súboroch — cesta 5 (`el(tag,'ms',name)`):
   `threads.js:720` `box`, `:1133` `iconButton()` volaný s `plus` (`:633`),
   `x` (`:955`, `:1260`), `dots-menu` (`:1152`), `check` (`:1256`), `:1309`
   `file-text`; `branches.js:351` `pencil`. `main.js` podľa nálezu.

**NESMIEŠ:** `chat/render.js`, `run.js`, `agents.js`, `attach.js`, `console/*`,
`shared/*` (F2) · `chat.css` (E) · `mind/*` (C1, F1) · pridať tretiu cestu
k modelu · aktivovať vetvu z URL.

**Zmeraj** (vždy po `resize_window` na ≥ 901 px — pri úzkom okne sa panely
**zámerne** neukladajú a bez viewportu namerá človek falošnú regresiu; namerané:
0 kľúčov pri šírke pane, 2 pri 1440 px):

| Kritérium | Číslo |
|---|---|
| `?pt=0&pa=1` na čerstvom profile | `body[data-threads]="off"`, `[data-artifact]="on"` — teda odkaz prebil preferenciu |
| adresa bez `pt`/`pa` po nastavení preferencie | rozloženie je **preferencia**, nie default (kalibruj: nastav `off`, zavri tab, otvor čistú URL → `off`) |
| pri 900 px šírky | `?pt=0` sa **nezapíše** do `localStorage`; prekryv sa nepripichne |
| hľadanie: 5 filtrov + `q` + `hl` | po `F5` sedí **7 z 7** |
| prepnutie vetvy | prírastok `history.length` = **1**; `POST /activate` sa volá **len** pri klike, nie pri načítaní URL s `b=` |
| `?b=<uuid>` pri načítaní | `POST /api/console/branches/*/activate` = **0 requestov** (kalibruj kladne: klik na vetvu = 1 request) |
| `ar` v `_urlKeys` | **0** |
| ligatúry v štyroch súboroch | **0** |

---

### D — znak: `public/brand/*`, favicon, `electron/**`, `<head>` blade

**Rob:** **jeden generátor, šesť výstupov.** Geometria znaku je dnes zapísaná
**16× v repe** (§7 tohto plánu je úplná tabuľka) a dvakrát ako binárka bez zdroja.

1. Napíš generátor (Python, po vzore `electron/assets/build-icon.py`, ale
   povýšený: číta SVG, nie hardcoded tuply). Zdroj je
   `public/brand/hades-sigil-mini.svg` (mini) a `hades-sigil.svg` (master).
   Umiestni ho tam, kde ho vlastníš — `electron/assets/build-icon.py` prepíš alebo
   pridaj `public/brand/build-mark.py`.
2. Výstupy:
   1. SVG assety v `public/brand/`,
   2. **data-URI faviconu** pre všetky tri `<head>` (bit-identický, ako dnes),
   3. **inline `<svg>` znaku pre Blade** (viewBox 24, triedy `bc-ring` /
      `bc-core`, `fill="var(--brand-gold)"` — **`currentColor` sa opúšťa**, sú to
      dva mechanizmy a jeden zanikne pri prvej zmene farby),
   4. **`public/favicon.ico` A `electron/assets/hades.ico`** (dnes existuje
      generátor len pre druhý; `public/favicon.ico` je 40 717 B **bez zdroja**),
   5. hodnota CSS `stroke-dasharray` (dnes `54.29` = 2π × 8,64) a **tri čísla
      `.load-mark`**,
   6. znak pre `electron/chrome/topbar.html` a `electron/states/offline.html`.
3. **Doplň znak tam, kde chýba, a animáciu tam, kde chýba** (§2 manuálu,
   deväť výskytov): `chat.blade.php:86` a `:182` nemajú triedy `bc-ring`/`bc-core`
   → **markup pod `</head>` vlastní F2**, takže mu vydaj presný blok a nahlás to
   v reporte. Prázdny dok nad grafom (`charon.js:678`) znak nemá vôbec →
   **vlastní F1**, to isté.
4. **`electron/states/offline.html` má vlastnú kópiu `core-pulse 4s ease-in-out`
   a nenačítava `mind.css`**, takže **plošná podlaha `prefers-reduced-motion` ho
   nekryje**. Napíš mu vlastnú tichú verziu: jadro v plnej farbe, statické. To isté
   preveď na `topbar.html`.
5. **`public/fonts/cinzel-wordmark.woff2` nie je webový asset** — nič ho
   nenačítava a je to build-time vstup pre `docs/build-brand.py`. `public/fonts/`
   vlastní **G**; nahlás mu to v reporte, **nemaž to sám**.
6. V `<head>` troch blade súborov meň **len riadok `<link rel="icon">`**.

**NESMIEŠ:** `public/css/*` (A1–A3, E, G) · `public/js/**` · blade pod `</head>`
(F1, F2) · `<link rel="preload">` fontov (G) · mazať `public/fonts/*`.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| miest v repe, kde je geometria znaku zapísaná ručne | **0** — každé je výstup generátora alebo číta jeho výstup; kalibruj grepom na `8.64`, `2.16`, `54.29`, `r="36"`, `stroke-width="9"`, `r="15"` |
| md5 troch data-URI faviconov | **identický** (dnes `c0ebff62…` × 3) — regresia by bola aj rozchod |
| `public/favicon.ico` a `electron/assets/hades.ico` | oba vydané generátorom, obsahujú veľkosti 16/24/32/48/64/128/256 |
| dva behy generátora nad nezmeneným zdrojom | **bajt na bajt totožné** výstupy (bez toho sa nedá poznať, či generátor beží, alebo sa len prepísal súbor) |
| znak v `offline.html` a `topbar.html` | pod `prefers-reduced-motion` **0 animácií**, jadro v plnej farbe (nie zamrznuté v spodnej fáze) |
| kontrast prstenca voči papieru v oboch témach | ≥ **3:1** (prstenec je jediný nositeľ „pracujem"); kalibruj na `body` ~16:1 |

---

### E — `public/css/{charon,console,chat}.css`

**Rob:**

1. **`charon.css` na typografickú škálu.** 22 deklarácií `font-size`, **0 cez
   token**. Dvadsať je čistá výmena: 11 → `--fs-caption`, 12 → `--fs-small`
   resp. `--fs-data-chip`, 13 → `--fs-body` resp. `--fs-data`, 14 → `--fs-base`
   resp. `--icon-2xs`, 16 → `--icon-xs`, 20 → `--icon-md`.
   **Dve hodnoty 15 px v škále neexistujú a manuál (§9) o nich rozhodol:**
   `charon.css:112` `.charon-empty-title` → **`--fs-title` (16 px)**,
   `charon.css:565` `#charon-pack .ms` → **`--icon-xs` (16 px)**. Nerozhoduj inak.
2. **`console.css:1336`** `#composer-hint` 10 px → `var(--fs-micro)`
   (`chat.css:796` tú istú rolu už píše tokenom).
3. **Presuň `@media (max-width: 860px)`** (`console.css:1290`) na **900 px**.
   **Pasca:** vnútri toho bloku leží `.auto-accept .lbl { display: none }`
   s komentárom o tom, že brána zápisov tam raz spadla na cieľ 13 × 13 px.
   **Nepresúvaj to mechanicky** — po zmene hranice **prepočítaj šírku toho
   tlačidla**, tak ako to komentár žiada, a číslo napíš do reportu.
4. **Chyba na `/chat`.** Napoj `.cm-error`, `.ct-err`, `.ct-retry` a `.is-err` na
   komponenty. Dnes **nemajú ani jedno pravidlo** v žiadnom stylesheete — sú to
   **štyri nové pravidlá, nie štyri úpravy**. Bublina chyby berie kresbu
   `.msg-error` z `mind.css` (A1).
5. **Zjednoť bublinu chyby.** Platí verzia konzoly: telo `--text`,
   `--danger-ink` **len na menovke**. `charon.css:156–159` dnes dáva
   `color: var(--danger-ink)` celej bubline, čo ide proti pravidlu
   v `mind.css:2607–2612`.
6. **Zmaž duplicitu bajt na bajt:** `charon.css:353` `.charon-agent.is-failed`
   je znak po znaku to isté ako `console.css:887` `.agent-run.is-failed` →
   jedno pravidlo so zoznamom selektorov. A `charon.css:387–392`
   `font-size: 12px` → `var(--fs-small)` (`console.css:945` to už má).
7. **Tokeny pohybu od A3:** `--ease-pulse` na `sk-pulse` (`console.css:349`),
   `think-blink` (`:574`), `tool-pulse` (`:798`), `charon-blink`
   (`charon.css:208`). Periódy zjednoť na **`--dur-pulse`** (dnes 1,4 s ručne,
   1,2 s × 2 a 1,1 s). `charon.css:257` `transform .15s ease` →
   `var(--dur-fast) var(--ease)`. Tri zvyšné `--transition-fast`
   (`console.css:1089`, `chat.css:170`, `:403`) → párový zápis.
8. **`charon.css:220` je zakázaný vzor.** `.charon-dot { animation: none }` nechá
   bodky na `opacity: .4`, teda indikátor „model píše" stratí rozdiel medzi
   pokojom a behom. Tichá verzia = bodky v **plnej** farbe + text stavu.
9. **Zmaž `.ms.flip`** (`chat.css:107`, `console.css:1208`). Existovalo výhradne
   preto, že `arrow_downward` nie je v subsete; sada B má `arrow-down`. Blade
   použitia mažú F2.
10. `chat.css` nemá vlastný reduced-motion blok a **nepotrebuje ho** — jeho dve
    `transition` kryje plošná podlaha z `mind.css`. Nepridávaj ho.
11. **`.ms` → `.ic` v tvojich troch súboroch, priamo a bez únie.** Základné
    pravidlá sú `console.css:1278–1283` a `chat.css:99–104`, plus prepisy veľkosti
    (`console.css:180`, `:535`, `charon.css:134`, `:265`, `:419`, `:565`).
    Prepíš selektor na `.ic` a `.ms` **zmaž**. Dôvod, prečo tu — a nie u G:
    G tie súbory nevlastní, a F2 vymieňa call-site na `/chat` a `/console` v tej
    istej vlne ako ty, takže obe strany sa prepnú naraz. `mind.css` to má inak
    (A1 tam nechá `:is(.ms, .ic)` a `.ms` polovicu maže G na konci reťazca) —
    je to štvoragentový reťazec a odklad je tam bezpečnejší.

**NESMIEŠ:** `mind.css` (A1–A3, G) · JS · blade · rozhodnúť inak o dvoch 15 px
hodnotách.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| raw px `font-size` v `charon.css` | **0** z 22 |
| raw hex / rgba v `charon.css` | **0** (dnes už 0 — nesmie narásť) |
| `.cm.cm-error` vs `.cm.cm-system` na `/chat` | pozadie, rám a farba menovky **sa líšia**; kalibruj negatívne na dvoch bežných správach (nesmú sa líšiť) a kladne na `/console` `.msg.error` |
| `.ct-retry` | má kresbu komponentu, nie bare `button` (dnes bg `rgb(255,255,255)`, border `rgb(230,222,227)`) |
| šírkové `@media` v `console.css` | `860` = **0** zásahov |
| šírka `.auto-accept` tlačidla po presune hranice | ≥ **24 × 24 px** cieľ (číslo do reportu, aj keď vyšlo dobre) |
| cudzie krivky (`ease-in-out`, samotné `ease`) v troch súboroch | **0** |
| periódy slučiek | všetky = `var(--dur-pulse)` |
| `.ms.flip` | 0 pravidiel |
| `.ms` v `charon.css`, `console.css`, `chat.css` | **0** zásahov; `.ic` má základné pravidlo v `console.css` aj `chat.css` |
| kontrast na **oboch** témach | žiadny meraný pár sa nezhoršil; skladaj pozadie (zbieraj vrstvy po prvú nepriehľadnú a zlož zdola) a po prepnutí témy meraj **v ďalšom volaní** — inak čítaš rozbehnutý prechod |

---

### F1 — `public/js/mind/*` (mimo C1 a C2) + `mind.blade.php` pod `</head>` + `charts.js`

Najväčší rozsah, tri témy — ale **jedno vlastníctvo**, takže bez rizika kolízie.

**Rob:**

1. **Výmena ikon.** Tvoje súbory obsahujú cesty 1–7 zo §7 manuálu. Menovite:
   - `mind.blade.php` pod `</head>`: **26 statických ligatúr** (rail, hlavička,
     breadcrumb, panely, dok),
   - template stringy: `panels.js:231` `commit`, `:137` `link-plus`,
     `:288` `eye`/`eye-off`; `pack.js:35` `library-plus`;
     `structure.js:29` `ellipsis`, `:41` `tree`, `:174` a `:205` `check-double`;
     `md.js:118` `cloud-off`; `toasts.js:60` `check-circle`;
     `util.js:559` `cloud-off` (`errorMarkup`), `:587` `filter-off`
     (`filterMarkup`); `main.js:28` `cloud-off`,
   - **mapovacie stoly:** `cmdk.js:14` `CMDK_NAV` (8 destinácií), `cmdk.js:190`
     `CMDK_TYPE_ICO`, `certainty.js:14` `CERT_META`, `toasts.js:16` varianty,
   - **`.textContent = 'lig'`** → `iconSwap()`: `timeline.js:23`, `:36`, `:47`,
     `controls.js:460`,
   - **`classList.add/remove('ms')`** pri armed-confirm: `controls.js:467`,
   - `el(tag,'ms',name)` v `charon.js:678`, `:809`, `:1003`, `:1189`.
2. **Dve ligatúry nekresli — zmeň volajúceho:** `cmdk.js:244` fallback `circle`
   → **`hub`** (štyri typy uzlov stôl pokrýva). `code` je v `shared/gate.js`
   a vlastní ho **F2**.
3. **`brightness_7` → symbol `core`** (prstenec s plným stredom), nie druhé slnko.
   Rozhodnuté v manuáli §7.
4. **`layout.js:129`**: fallback `cssPx('--rail-w', 72)` → **80**. Je inertný, ale
   klame.
5. **Rail toggle.** Pridaj markup `#rail-collapse` do `mind.blade.php`
   a mechaniku do **`mind/rail.js`** — ten modul už existuje a vlastní odznaky
   railu (`setRailBadge`, `checkJournalUnread`), takže je to jeho miesto; nedávaj
   to do `theme.js` len preto, že tam žije `initialTheme()`.
   Čítaj/zapisuj `localStorage['hades.rail']` (`wide` / `slim`, default `wide`)
   v `try/catch`, atribút `body[data-rail]` nastav **pred prvým rámcom** (rovnaký
   vzor ako `initialTheme()` v `theme.js` — ten iba napodob, nekopíruj doňho kód),
   inak rail blikne. Nová `export function` musí byť **hoistovaná**. Selektory
   kreslí A2, ty len prepínaš atribút.
6. **Pohyb — tri zmeny plus jedna oprava:**
   - **Zanorenie:** interpoluj `ent.dim` v `render.js` podľa `S._dimTween`
     (§2.3). Cieľ nastavuje `computeLayout()` (`layout.js:112`, `:819`,
     `DIM_CTX = 0,34`) — **nemeň hodnotu**, meň len to, že sa k nej ide plynulo.
     Tichá verzia: `dim` sadne v jednom rámci **a fokusová skupina dostane
     trvalý obrys** (nie `animation: none`).
   - **Nájdený uzol:** prstenec s **konštantnou** alfou, lineárne vyhasne za
     800 ms. Zmaž `sin()` blikot z `render.js:891–900` — dnes beží **aj pod
     reduced motion**, hoci `anim.js:13` sľubuje statické zvýraznenie. Susedný
     riadok `:872` stráž má; urob to rovnako.
   - **Prílet uzla cez WS** (`ws.js:57–77`): zo siedmich súčasných pohybov nechaj
     **tri** (`birthScale`, prstenec zrodu, toast). Zmaž `spawnPulse` od jadra
     a `emitFlows` — hovoria to isté, čo prstenec. **`kickSim()` alphu NEMEŇ** —
     to je zmena fyziky, nie prechodu, a rozhodnutie 7 ju nekryje; nahlás ju
     v `deviations`.
   - **Toast (`toasts.js`) — najurgentnejšie z celého auditu.** Pod
     `prefers-reduced-motion` sa dnes v šiestich call-site prepisuje **doba
     zobrazenia** 5 200 / 6 000 / 2 500 ms na **0 ms**, takže človek
     s preferenciou **nikdy neprečíta oznámenie**. Znulovať sa smie **len** 200 ms
     odchodový prechod. Doba zobrazenia zostáva rovnaká alebo dlhšia.
7. **Zmaž mŕtvy morph:** `render.js:1712–1727` (blok sa nikdy nevykoná, `S._morph`
   je vždy `null`) a **oprav klamlivý komentár** `anim.js:114`. `state.js:100`
   patrí C1 — nahlás mu to.
8. **`charts.js:74`** číta `prefers-reduced-motion` raz na module scope. Prepni na
   živý listener — ale **zmeraj cenu pred, nie po** (komentár tam obhajuje dopyt
   pri 365 bunkách heatmapy).
9. **Znak do prázdneho doku** (`charon.js:678`) — blok vydá D.

**NESMIEŠ:** `state.js`, `sim.js`, `screens.js`, `urlstate.js` (C1) ·
`screens/*.js`, `filters.js`, `tagfilter.js`, `search.js` (C2) · `shared/*` (B, F2)
· `chat/*`, `console/*` (C3, F2) · CSS · blade nad `</head>` (D, G) · meniť
`DIM_CTX` ani alphu `kickSim()`.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| ligatúry v tvojich súboroch a v `mind.blade.php` | **0** |
| `.textContent = '<ligatúra>'` a `classList.*('ms')` | **0** |
| `window.HADES._iconMiss` po prekliknutí všetkých 8 obrazoviek + palety + toastu | **prázdne** |
| `S._morph` v repe | 0 zápisov, 0 čítaní |
| `S._dimTween` po `go({level:'area'})` | nenull, `dur === 0.18`; po reduced motion `null` |
| prstenec nájdeného uzla | alfa **konštantná** — 10 vzoriek `S._clock` dá tú istú hodnotu (dnes `sin()` dá 10 rôznych) |
| pohyby na jeden `node.created` | **3** (dnes 7) |
| toast bez reduced motion | v DOM po 50 / 500 / 2 000 ms (kladná kalibrácia; zmerané, že dnes to platí) |
| toast s reduced motion | **doba zobrazenia nezmenená** — `setTimeout` argument je 5 200 / 6 000 / 2 500, nie 0 (statická kontrola v kóde; emulovať preferenciu tento harness nevie a **nepredstieraj, že vie**) |
| `rAF` mimo obrazovky Graf | **0 rámcov** — obaľ `window.requestAnimationFrame`, nie `ctx.clearRect()` (tá kalibrácia vracala vždy 0 a nemerala nič) |
| `S._drawMs` pri `graphScope: all` (2 765 uzlov) | nesmie stúpnuť nad **22 ms** (`lifeTier()` prepne na 1); dnes 4,0 ms. Meraj na `all`, nie na `live` — inak meriaš polovicu záťaže |
| `layout.js` fallback `--rail-w` | 80 |
| `export const … = () =>` v dotknutých súboroch | **0** |

---

### F2 — `chat/*` (mimo C3) + `console/*` + `shared/*` (mimo `icons.js`) + dve blade

**Rob:**

1. **Výmena ikon — cesta 5 (`el(tag,'ms',name)`), najväčšia diera doterajších
   auditov** (grep nad markupom o nej nevie nič, nie je tam znak `<`):
   `chat/render.js:434` a `:661` `iconFor`, `:851` `hub`;
   `chat/agents.js:621` `icon()` volaný s `tree` (`:425`), `hub`/`tree` (`:474`),
   `iconFor` (`:564`); `chat/attach.js:622` `icon()` s `x` (`:534`),
   `clock` (`:545`), `file-text` (`:565`, `:569`, `:694`);
   `console/main.js:157` `actionBtn` s `pencil` (`:136`), `trash` (`:142`);
   `console/render.js:76` zoznam `['chip','magnifier','pencil','bolt']`, `:242`
   `alert-circle`; `console/run.js:214` `hub`; `console/tools.js:53`, `:311`
   `iconFor`; `console/slash.js:168` `entry.icon`.
2. **Mapovacie stoly:** `shared/gate.js:32–64` `ICONS` (**zdieľaný modul troch
   plôch** — jedna zabudnutá hodnota nespadne nikde) a `console/slash.js:31–54`
   `SLASH`.
3. **`code` nekresli — zmaž volajúceho:** `gate.js:56–59` kľúče
   `bash`/`shell`/`php`/`artisan`. Taký tool **zámerne neexistuje** (appka je
   tunelovaná cez ngrok) a fallback `bolt` zostáva.
4. **`.textContent = 'lig'`** → `iconSwap()`: `console/main.js:176`.
   **`classList.add/remove('ms')`** pri armed-confirm: `console/main.js:194`.
5. **`.ms.flip` použitia v blade zmaž:** `chat.blade.php:198`,
   `console.blade.php:120` — obe na `arrow_upward`; nastupuje `arrow-down`.
   Pravidlá v CSS maže E.
6. **Bublina chyby na `/chat`:** `chat/render.js:237–246` (`pushError`) dnes
   emituje `.cm-error`, ktorá **nemá kresbu** a chybová správa vyzerá ako bežná
   odpoveď. Markup zjednoť na komponent `.msg-error` (kreslí A1, napája E).
   A **zmaž komentár na `:239`**, ktorý absenciu ikony chyby odôvodňuje subsetom —
   po odchode Material Symbols je to lož.
7. **Znak s animáciou do `chat.blade.php`** (`:86` a `:182`): dnes nemá triedy
   `bc-ring` / `bc-core`, teda sa nikdy nezrodí. Blok vydá D.
8. **26 statických ligatúr** v `chat.blade.php` a `console.blade.php` pod
   `</head>`.

**NESMIEŠ:** `chat/{threads,branches,artifact,main}.js` (C3) · `shared/icons.js`
(B) · `mind/*` (C1, F1) · CSS · blade nad `</head>` (D, G) · pridať tretiu cestu
k modelu (`/api/console/run` a `/decide` sú jediné dve) · zmeniť mechaniku ani
texty brány zápisov.

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| ligatúry v tvojich súboroch a v dvoch blade | **0** |
| `.textContent = '<ligatúra>'`, `classList.*('ms')`, `.ms.flip` | **0** |
| `window.HADES._iconMiss` po prekliknutí `/chat` aj `/console` + jednom behu s toolom + jednej karte povolenia | **prázdne** |
| `gate.js` ICONS | 5 kľúčov (dnes 9), fallback `bolt`, `code` = 0 zásahov |
| `.cm.cm-error` na `/chat` | odlišuje sa od `.cm.cm-system` (spoločné kritérium s E) |
| znak v hlavičke `/chat` | `.bc-ring` má `stroke-dasharray` z CSS (dnes 0 — trieda chýba) |
| karta povolenia | mechanika nezmenená: zápis parkuje, ťah končí **bez rámca `end`**, `/decide` na vlákno podagenta, „Povoliť vždy" sa na karte podagenta **nekreslí** |
| `export const … = () =>` | **0** |

---

### G — odchod Material Symbols

Beží **posledný** v reťazci nad `mind.css` (po A3) **a po D**.

**Rob:**

1. **Over, že sada je naozaj nasadená všade**, PREDTÝM než niečo zmažeš.
   Kritérium: `window.HADES._iconMiss` je prázdne na `/`, `/chat` aj `/console`
   po prekliknutí všetkých obrazoviek, palety, toastu, prázdnych stavov, chýb,
   odznakov istoty, časovej osi, armed režimov, kariet nástrojov a príloh —
   **28 z 61 ligatúr žije za stavom** a pri prekliku prázdnej appky ich nikto
   neuvidí. Ak `_iconMiss` nie je prázdne, **NEMAŽ NIČ** a nahlás to.
2. **`mind.css`:** zmaž `@font-face` (`:80–86`), základné pravidlá `.ms`
   (`:926–938`) a **z každej únie `:is(.ms, .ic)`, ktorú nechal A1, odstráň
   polovicu `.ms`** (zostane `.ic`). Zmaž **riadok `:23`** s číslom glyfov (je aj
   tak nesprávne — 254, nie 215). Trieda `.ic` zostáva.
   `console.css`, `chat.css` a `charon.css` **nevlastníš** — `.ms` z nich odstránil
   E vo vlne 1, over to a v reporte uveď číslo; ak tam ešte je, je to `deviations`,
   nie tvoja oprava.
3. **`<head>` troch blade:** zmaž `<link rel="preload">` fontu ikon
   (`mind.blade.php:45`, `console.blade.php:33`, `chat.blade.php:54`).
   **Preload zvyšných fontov nechaj** — vlna 1 pinovala presne 6 preloadov
   v danom poradí; po odchode ikon ich má byť **5**.
4. **`public/fonts/`:** zmaž `material-symbols-rounded-subset.woff2`. A presuň
   `cinzel-wordmark.woff2` mimo `public/` (je to build-time vstup pre
   `docs/build-brand.py`, nič ho nenačítava, a pritom je verejne servovaný) —
   nahlásil to D. Ak presun znamená zmenu v `docs/build-brand.py`, ten súbor
   **nevlastníš**: `deviations`.
5. **Nemaž tri riadky s číslom 215 mimo `mind.css`** (`CLAUDE.md:148`,
   `docs/BRAND-HADES.md`) — tie súbory nevlastníš, nahlás ich.

**NESMIEŠ:** kresbu `.ic` (A1) · rail (A2) · tokeny (A3) · `console.css`,
`chat.css`, `charon.css` (E) · JS · blade pod `</head>` · `public/favicon.ico`
a `electron/**` (D).

**Zmeraj:**

| Kritérium | Číslo |
|---|---|
| `_iconMiss` pred mazaním | **prázdne** na troch plochách po plnom exercise (toto je vstupná podmienka, nie výstup) |
| `.ms` v `public/css/**`, `public/js/**`, `resources/views/**` | **0** zásahov |
| `@font-face` v `mind.css` | 3 (Geist, Geist Mono, Playfair) — **kalibruj:** pred zmenou 4 |
| `<link rel="preload">` v troch blade | **5** v každom (pred zmenou 6) |
| `public/fonts/` | `material-symbols-rounded-subset.woff2` neexistuje; **304 → 0** požiadaviek na `/fonts/material-symbols*` v `read_network_requests` |
| požiadavky na fonty po zmene | žiadna **404** na `/fonts/*` na `/`, `/chat`, `/console` |
| veľkosť `public/fonts/` | z 276 732 B na ~143 000 B (subset bol 132 196 B = 47,8 %) |
| CSP test | `tests/Feature/ContentSecurityPolicyTest.php` zelený (`script-src 'self'` sa nemenil, ale over to) |

---

## 5. Definitívny zoznam ikon — 60 symbolov

Zdroj pravdy je `docs/BRAND-HADES.md` §7. Tu je len mapovanie
**ligatúra → meno symbolu**, aby ho agenti nemuseli listovať.

| Ligatúra | Symbol | | Ligatúra | Symbol |
|---|---|---|---|---|
| `wb_sunny` | `sun` | | `check_circle` | `check-circle` |
| `hub` | `hub` | | `done_all` | `check-double` |
| `receipt_long` | `receipt` | | `verified` | `shield-check` |
| `gavel` | `gavel` | | `science` | `flask` |
| `bolt` | `bolt` | | `warning` | `alert-triangle` |
| `menu_book` | `book` | | `error` | `alert-circle` |
| `fact_check` | `check-list` | | `cloud_off` | `cloud-off` |
| `assignment` | `clipboard` | | `pending` | `clock` |
| `send` | `send` | | `radio_button_unchecked` | `ring` |
| `help` | `question` | | `redo` | `skip` |
| `tune` | `sliders` | | `article` | `doc` |
| `account_tree` | `tree` | | `calendar_month` | `calendar` |
| `category` | `shapes` | | `description` | `file-text` |
| `layers` | `layers` | | `list` | `list` |
| `center_focus_strong` | `focus` | | `memory` | `chip` |
| `add` | `plus` | | `psychology` | `head-gear` |
| `remove` | `minus` | | `inventory_2` | `box` |
| `more_horiz` | `ellipsis` | | `commit` | `commit` |
| `search` | `magnifier` | | `brightness_7` | **`core`** |
| `search_off` | `magnifier-off` | | `visibility` | `eye` |
| `filter_alt_off` | `filter-off` | | `visibility_off` | `eye-off` |
| `close` | `x` | | `lock` | `lock` |
| `edit` | `pencil` | | `lock_open` | `lock-open` |
| `check` | `check` | | `play_arrow` | `play` |
| `save` | `save` | | `pause` | `pause` |
| `content_copy` | `copy` | | `arrow_upward` | `arrow-up` |
| `delete` | `trash` | | *(nová)* | `arrow-down` |
| `link` | `link` | | `stop` | `stop` |
| `add_link` | `link-plus` | | `sync` | `refresh` |
| `library_add` | `library-plus` | | `menu` | `dots-menu` |

**Nekresliť (2), namiesto toho zmeniť volajúceho:**

| Ligatúra | Kto | Čo urobiť |
|---|---|---|
| `circle` | **F1** | `cmdk.js:244` fallback → `hub` |
| `code` | **F2** | `gate.js:56–59` zmazať kľúče `bash`/`shell`/`php`/`artisan` |

**Kde ligatúry žijú** (sedem ciest, aby ich nikto znova nepodhlásil): statický
markup 26 · template stringy 14 · ternáre 11 miest · **päť mapovacích stolov** ·
**`el(tag,'ms',name)` 17 miest** · **`.textContent =` 7 miest** · prvý argument
`emptyHtml`/`renderEmpty` 10 call-site. **CSS `content:` cestou nie je** —
všetkých 15 výskytov je `content: ''`.

---

## 6. Kanonický slovník krátkych URL kľúčov — 37

Úplný, na opísanie. Zdroj pravdy je `docs/BRAND-HADES.md` §10 (tam je aj
odôvodnenie každého rozhodnutia).

**Pravidlá:** kľúče 1–3 znaky, malé písmená · **poradie kľúčov = poradie riadkov
tejto tabuľky** · defaulty sa **vynechávajú** · množiny = **opakovaný kľúč**,
nikdy separátor · hodnoty množín sa **radia** · prepínače `1`/`0` · strop **24**
opakovaní na kľúč · stavaj **výhradne `URLSearchParams`om** · žiadny base64 balík.

| Kľúč | Rodina | Význam | Hodnoty | Default | História |
|---|---|---|---|---|---|
| `s` | chrbtica | obrazovka | `dnes` `graf` `dennik` `rozhodnutia` `runy` `kniznica` `kontrola` `smernica` | `dnes` | **push** |
| `q` | chrbtica | voľný text hľadania (význam určuje `s`) | text | `''` | replace |
| `a` | graf | id oblasti | int | — | replace |
| `d` | graf | id oddelenia | int | — | replace |
| `n` | graf | id uzla zanorenia | int | — | replace |
| `sel` | graf | id uzla s otvoreným panelom | int | — | replace |
| `gv` | pohľad | pohľad | `layers` | `net` | replace |
| `gs` | pohľad | rozsah | `all` | `live` | replace |
| `ft` | filter | **skryté** typy uzlov | `memory` `skill` `project` | — | replace |
| `fs` | filter | **skryté** zdroje | `session` `skill` `digest` `manual` | — | replace |
| `fa` | filter | **skryté** id oblastí | int | — | replace |
| `fg` | filter | **vybrané** značky (**pozitívny**) | text | — | replace |
| `fr` | filter | **skryté** kategórie vzťahov | `part_of` `uses` `similarity` `co_activation` | — | replace |
| `mw` | filter | min. váha hrany | 0–5 | `0` | replace (debounce 200 ms) |
| `sk` | filter | len kostra | `1` | vyp. | replace |
| `loc` | filter | lokálny graf | `<rootId>.<depth>`, depth 1–3 | — | replace |
| `dep` | Denník | kľúč skupiny projektu | text, môže začínať `#` | všetky | replace |
| `kna` | Knižnica | slug oblasti (**filtruje klient**) | slug | — | replace |
| `kot` | Kontrola | typ | `core` `skill` `project` `memory` | `''` | replace |
| `koc` | Kontrola | istota | `overene` `hypoteza` `pasca` | `''` | replace |
| `koa` | Kontrola | slug oblasti | slug | `''` | replace |
| `kol` | Kontrola | strop | násobky 100, max 500 | `100` | replace |
| `roy` | Rozhodnutia | rok | `YYYY` | — | replace |
| `roa` | Rozhodnutia | id oblasti | int | — | replace |
| `rus` | Runy | stav | `running` `waiting` `failed` `aborted` `done` | — | replace |
| `rum` | Runy | model | text | — | replace |
| `ruo` | Runy | rozbalený beh | uuid | — | replace |
| `b` | `/chat` | vetva konverzácie (**čítacie**) | uuid | aktívna zo servera | **push** |
| `pt` | `/chat` | panel vlákien | `0` | otvorený | replace |
| `pa` | `/chat` | panel artefaktu | `1` | zatvorený | replace |
| `ar` | `/chat` | zdroj artefaktu — **vyhradené, nezavádzať** | id `ConsoleToolCall` | — | replace |
| `hr` | hľadanie | rola | `user` `assistant` | — | replace |
| `ha` | hľadanie | od | `YYYY-MM-DD` | — | replace |
| `hb` | hľadanie | do | `YYYY-MM-DD` | — | replace |
| `hn` | hľadanie | vlákno | uuid | — | replace |
| `hp` | hľadanie | projekt | uuid | — | replace |
| `hl` | hľadanie | strop | int | `30` | replace |

**`level` nie je kľúč** — implikuje ho najhlbší prítomný z `a`/`d`/`n`.
**Kamera nie je kľúč** — force layout je živý, uložený výrez by rámoval iné
miesto siete.

**Rezervované, neemitovať:** `token` (`AuthenticateUi.php:102`) ·
`k` (`bin/hades-app.mjs:109`) · `screen` (legacy, **len na čítanie**, prvý zápis
ho normalizuje na `s` a odstráni). **Každý iný neznámy kľúč sa prenesie
nedotknutý.**

**Nikdy v URL** (preferencia zariadenia): `hades.theme` · `hades.density` ·
`hades.sound` · `hades.opts` (9 hodnôt) · `hades.certRings` · `hades.hints2` ·
`hades.journal.lastSeen` · `hades.chat.threadsW` · `hades.chat.artifactW` ·
`hades.charonThread` · `hades.charonCtx` (**vstup do behu modelu — injekčná
plocha**) · `hades.rail` · `S.cam`.

**Deliaca čiara, ktorá to celé triedi:** čo mení, **KTORÉ** uzly a hrany na
obrazovke sú, ide do URL; čo mení, **AKO** vyzerajú, zostáva lokálne. Jediná
menovaná výnimka je `gv` — mení rozloženie, nie členstvo, ale je to pomenovaný
pohľad s vlastnými tlačidlami a klávesou `V`, nie kozmetický slider.

---

## 7. Geometria znaku — 16 zápisov v repe (vstup pre D)

| # | Miesto | Tvar |
|---|---|---|
| 1 | `public/brand/hades-sigil-mini.svg:7–8` | **kánon mini**: viewBox 100, prstenec r 36 / hrúbka 9, jadro r 15 |
| 2 | `public/brand/hades-sigil.svg:12+` | **kánon master**: A 46 / stupnica 42–46 / B 34 / C 22 / hrana / satelit 5 / obežnica 15 / jadro 8,5 |
| 3 | `public/brand/hades-sigil-mono.svg` | master jednofarebne (`currentColor`) |
| 4 | `resources/views/mind.blade.php:16` | data-URI faviconu: disk r 50 `#0e1413`, prstenec r 36/9 `#c4a2f5`, jadro r 15 `#d8b878` |
| 5 | `resources/views/console.blade.php:20` | to isté, **bajt na bajt** (md5 `c0ebff62…`) |
| 6 | `resources/views/chat.blade.php:44` | to isté, **bajt na bajt** |
| 7 | `resources/views/mind.blade.php:130–131` | viewBox 24: `r 8.64` / `stroke 2.16` / jadro `r 3.6`; `fill="currentColor"`; triedy `bc-ring`/`bc-core` |
| 8 | `resources/views/console.blade.php:55–56` | tie isté tri čísla; `fill="var(--brand-gold)"`; triedy **sú** |
| 9 | `resources/views/chat.blade.php:86–87` | tie isté tri čísla; **triedy NIE SÚ** → bez animácie |
| 10 | `resources/views/chat.blade.php:182–183` | tie isté tri čísla v `.ce-mark`; **triedy NIE SÚ** |
| 11 | `public/js/console/render.js:41–46` | tie isté tri čísla, skladané `setAttribute`om |
| 12 | `public/css/mind.css:1233–1234`, `:1246` | `stroke-dasharray: 54.29` = 2π × 8,64 — **derivát polomeru ako konštanta**, na troch riadkoch |
| 13 | `public/css/mind.css:2637–2652` | `.load-mark` — znak **prekreslený CSS boxmi v INÝCH proporciách**: 26 px box, `border 2px` (0,077 boxu proti kánonickým 0,09), jadro 8 px (0,154 proti 0,15), stredný polomer prstenca **0,46 proti 0,36** |
| 14 | `electron/assets/build-icon.py:16–40` | **znovu implementované v Pythone**, hardcoded RGB tuply, prstenec ako anulus r 40,5 − r 31,5 |
| 15 | `electron/chrome/topbar.html:156–159` | viewBox 100, r 36/9 + r 15, `var(--accent)` / `var(--gold)` |
| 16 | `electron/states/offline.html:64–75` + `:174–177` | viewBox 100, `r 36` v markupe, `stroke-width: 9` a jadro `r 15` v `<style>`; **vlastná kópia `core-pulse 4s ease-in-out`** |
| — | `public/favicon.ico` (40 717 B) | binárka, **generátor v repe NIE JE** |
| — | `electron/assets/hades.ico` | binárka z #14 |

**#13 nie je preklep** — 26 px box s 2 px obrysom je hodnota vybraná pre kontrast
a komentár nad pravidlom to vysvetľuje pravdivo. Generátor teda musí vydať **aj
tieto tri čísla**, nie ich prepísať na 1 : 1 s mini znakom.

**#16 nekryje plošná podlaha `prefers-reduced-motion`** — `offline.html`
nenačítava `mind.css`. Tichú verziu si musí napísať sám.

---

## 8. Zjednotená sada breakpointov

| Hranica | Význam | Kde po zmene |
|---|---|---|
| **1280 px** | chróm hlavičky sa orezáva, `--panel-w` sa zužuje | `mind.css` — **jeden** blok (dnes dva: `:3831`, `:3884`) |
| **900 px** | „úzko": plávajúce panely k pravej hrane, druhý stĺpec padá, raily ako prekryv | `mind.css:3889`, `:4919`, `:4035` (presun z 860), `charon.css:634`, `chat.css:746`, `console.css:1290` (presun z 860) |
| `min-width: 901px` | komplement, **zostáva** | `mind.css:3507` |
| `hover: none` | `.pack-btn`, **zostáva** | `mind.css:3863` |
| ~~`max-height: 860px`~~ | **RUŠÍ SA** — po rozbalení railu stratí volajúceho | `mind.css:1312` |

JS zrkadlí 900 px na troch miestach a **nemení sa**: `mind/dock.js:11`,
`mind/panels.js:18`, `chat/main.js:68`.

**Prečo práve tieto dve:** 860 a 900 sú od seba 40 px a obe znamenajú „úzko", takže
v pásme 861–900 px má appka dnes **dve rôzne definície úzkeho okna naraz** —
`mind.css` už presunul panely, `console.css` ešte drží dva stĺpce. Posun o 40 px je
hlboko v pásme 768–900 z rozhodnutia 18, teda bez straty.

**Pasca:** vnútri `console.css:1290` leží `.auto-accept .lbl { display: none }`
s komentárom o tom, že brána zápisov tam raz spadla na cieľ 13 × 13 px. Blok sa
nesmie presúvať mechanicky.

---

## 9. Tokeny pohybu a tiché verzie

**Rebrík rozhrania** — deväť tokenov, nič medzi nimi:

| Token | Hodnota | Rola | Stav |
|---|---|---|---|
| `--dur-press` | 80 ms | stlačenie | je |
| `--dur-fast` | 150 ms | hover, farba, malý stav | je |
| `--dur-base` | 180 ms | vstup prvku, prepnutie obsahu | je |
| `--dur-slow` | 200 ms | panel, drawer | je |
| `--dur-ambient` | 400 ms | ambientný útlm chrómu | je |
| `--dur-pulse` | 1,4 s | perióda **neurčitého čakania** | je |
| `--ease` | `cubic-bezier(.22,.61,.36,1)` | príchod a transformácia | je |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | odchod | je |
| **`--ease-pulse`** | `cubic-bezier(.4,0,.6,1)` | **slučka** | **nový (A3)** |
| **`--dur-chart-draw`** | 760 ms | obtiahnutie prstenca a segmentov | **nový (A3)** |
| **`--dur-chart-curve`** | 900 ms | krivka rastu | **nový (A3)** |
| **`--dur-chart-reveal`** | 720 ms | odkrytie heatmapy | **nový (A3)** |
| ~~`--transition-base`~~ | — | 0 volajúcich | **mažú sa (A3)** |
| ~~`--transition-slow`~~ | — | 0 volajúcich | **mažú sa (A3)** |

### Tabuľka tichých verzií pre nové a menené pohyby

| Pohyb | Kto | Tichá verzia NIE JE | Tichá verzia JE |
|---|---|---|---|
| zanorenie (`ent.dim` lerp) | F1 + A3 | `animation: none` | `dim` sadne v jednom rámci **+ trvalý obrys** fokusovej skupiny |
| nájdený uzol | F1 + A3 | žiadny znak, alebo `sin()` blikot | prstenec s **konštantnou** alfou, drží 2 s, potom zmizne skokom |
| prílet uzla cez WS | F1 | uzol chýba, alebo ticho | uzol rovno v plnom polomere na finálnej pozícii + prstenec 2 s + toast celý svoj čas |
| **toast** | F1 | **doba zobrazenia 0 ms** (dnešný stav!) | plná doba zobrazenia, bez príchodu a odchodu |
| rail zbaliť / rozbaliť | A3 | preblikne | šírka sa zmení okamžite, atribút je nastavený pred prvým rámcom |
| „model píše" (`.charon-dot`) | E | `animation: none` na `opacity .4` | bodky v **plnej** farbe + text stavu |
| znak v `offline.html` | D | zamrznuté v spodnej fáze | jadro v plnej farbe, statické |
| `charts.js` (heat/seg/line) | F1 | — | triedy sa **vôbec nepridajú** (existujúci správny vzor, nemení sa) |

**Plošná podlaha `mind.css:2852–2861` je jediný nositeľ tichej verzie pre 64
pohybov. NIKTO sa jej nedotkne.** Ani `:where(*)`, ani `0s` namiesto `.01ms`, ani
odstránenie `!important`. `.01ms` je zámerné: prvok **dobehne** a vydá
`transitionend`, takže JS, ktorý na koniec prechodu čaká, sa nezasekne.

**Ako sa podlaha legálne prebije:** pravidlo v **tom istom**
`@media (prefers-reduced-motion: reduce)` bloku, so selektorom aspoň triedovej
špecificity, s `!important` na vlastnostiach, ktoré sa majú líšiť. `!important`
deklarácie súťažia **špecificitou**: `*` = 0-0-0, `.skel::after` = 0-1-0.

---

## 10. Spoločné pasce merania

Každá z nich dala v sondách falošný nález, teda by donútila „opravovať" funkčný kód.

1. **Identita preview servera.** `curl -s http://127.0.0.1:8091/` musí obsahovať
   `src="/js/mind/main.js"`. Keď server zhasne, port prevezme cudzia appka.
2. **`window.innerHeight` je v Browser pane 0**, kým nenastavíš viewport cez
   `resize_window`. Bez toho je každé „je to vidieť?" nezmysel.
3. **Screenshot nefunguje.** Dôkaz je zmeraný DOM a computed style.
4. **Rast výšky kontejnera NIE JE layout shift.** Zoznam rastie **dolu pod
   okraj**. Správna otázka je, či sa pohlo to, čo bolo vidieť.
5. **Prehliadač normalizuje `*::before` na `::before`.** Regex na `*, *::before`
   podlahu nenájde.
6. **CSS zmenu overuj výmenou stylesheetu nad TÝM ISTÝM DOM**, nie dvoma
   načítaniami — Hades je živý a medzi nimi sa naučí uzly. Harness kalibruj
   **A/B/A/B s dosadnutím** (dva rámce + 250 ms).
7. **Kontrast: pozadie treba SKLÁDAŤ** (vrstvy po prvú nepriehľadnú, zlož zdola)
   a **po prepnutí témy meraj v ďalšom volaní** (prechod musí dosadnúť).
   Kalibruj na `body` ~16:1.
8. **Nepíš merací skript ako kópiu formuly z kódu** — nechaj kód vystaviť výsledok
   (`window.HADES._urlKeys`, `_iconMiss`, `S._labelBoxes`) a čítaj ten.
9. **Skeleton sa odkladá o 300 ms** — čakaj ≥ 400 ms, a kalibruj opačne: pri
   rýchlej odpovedi sa kostra objaviť **nesmie**.
10. **Panely testuj po jednom** — `dock.js:36` a `panels.js:30` držia výlučnosť
    pod 900 px; odobranie `.hidden` obom naraz dá falošné prekrytie.
11. **`getBoundingClientRect` dieťaťa v scroll kontejneri hlási nezrezaný box.**
    Orez meraj ako `scrollWidth > clientWidth` pri `overflow-x: visible|hidden`.
12. **Skrytá Browser pane netiká `rAF`** (0 rámcov za 500 ms) a škrtí `setTimeout`
    na ~1 Hz. Tweeny po rámcoch merať nemožno — meraj stavové hodnoty.
13. **`reducedMotion` sa v tomto harnesse emulovať nedá.** Kladnú stranu zmeraj,
    zápornú over **staticky v kóde** a **nepredstieraj, že si ju zmeral**.
14. **Posielaj `tabId`** pri každom `javascript_tool` volaní — prostredie samo
    otvára ďalšie taby na tom istom origine a volanie bez `tabId` občas trafí iný.

---

## 11. Definícia hotového pre celý beh

| Kritérium | Číslo |
|---|---|
| `docker compose exec app php artisan test` | ≥ **596 passed**, **0 failed** |
| MariaDB filter `HybridRecall\|RecallBench\|ConsoleTools\|McpTools` | 0 padnutých |
| `window.HADES._iconMiss` na troch plochách po plnom exercise | **prázdne** |
| ligatúry Material Symbols v repe | **0** |
| obnoviteľných osí filtra (dnes 0) | **11** obrazovkových + 8 grafových + 10 `/chat` |
| test kruhu URL | znakovo totožný pre všetkých 37 kľúčov |
| šírkové `@media` hodnoty | `{1280, 901, 900}`; `860` = 0 |
| rail sa zmestí pri | **614 px** výšky okna (dnes 746) |
| raw px `font-size` v `charon.css` | **0** z 22 |
| ručne zapísaná geometria znaku | **0** zo 16 |
| plošná podlaha reduced-motion | nezmenená, 5 deklarácií, všetky `important` |
| toast pod reduced motion | doba zobrazenia **nezmenená** |
| kontrast | žiadny meraný pár sa nezhoršil, na **oboch** témach |
| dvojité deklarácie | `mind.css` A=0; B a C nenarástli |
| `export const … = () =>` v dotknutých moduloch | **0** |
| brána zápisov | mechanika a texty **nezmenené** |
| `rAF` mimo obrazovky Graf | **0 rámcov** |

**Keď niečo padne, nič nemaž** — vetva zostáva, report popíše stav a ďalší krok.
