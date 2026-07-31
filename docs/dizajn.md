# Dizajn — AuraAI · Aura light business

Dizajnový systém AuraAI. Cieľ: appka má čítať ako ďalšia obrazovka Aura ekosystému —
rovnaké tokeny, rovnaký rytmus stránky, rovnaká grafová paleta a rovnaké komponentné
názvoslovie ako `C:\Aura\sperky-ai` (Aura Marketing).

Vlastník dokumentu: **P9**. Zdroj hodnôt je vždy `resources/css/tokens.css` (light) a
`resources/css/dark.css` (dark) — tento dokument ich opisuje, nenahrádza.

---

## 1. Kontrakt dizajnového systému

Tri pravidlá, ktoré drží linter aj test:

1. **Farebné literály existujú len v `tokens.css` a `dark.css`** (kontrakt §4.8).
   Všade inde sa používa `var(--token)`. Sankcionovaná výnimka je `rgba(var(--x-rgb), .3)` —
   alfa nad tokenovým tripletom, nie nová farba.
2. **`app.css` je len zoznam `@import` a jeho poradie JE kaskáda.** Presunutie importu
   mení špecificitu. `app.css` vlastní integrátor.
3. **Žiadny CSS súbor nemá viac než 400 riadkov** (cieľ ≤ 250).

Vynucovanie:

```bash
npm run lint:css                 # stylelint, .stylelintrc.json — baseline 0 chýb
npx vitest run tests/js/css-tokens.test.js   # tá istá brána v testovom balíku
```

`.stylelintrc.json` zapína `color-no-hex` a zakazuje `rgba()/hsla()` s číselnými
zložkami; `overrides` to vypína presne pre `tokens.css` a `dark.css`. Kozmetické
pravidlá `stylelint-config-standard` (import-notation, hex-length, vendor prefixy…)
sú vypnuté zámerne — nie sú predmetom kontraktu a robili by z lintera šum.

---

## 2. Tokeny

### 2.1 Plocha a text

| Rola | Light | Dark |
|---|---|---|
| paper / `--bg` | `#f8f4f7` | `#0e1413` |
| panel / `--panel-solid` | `#ffffff` | `#161f1d` |
| `--surface-2` (= rodinné `--panel2`) | `#fbf7f9` | `#1b2624` |
| `--surface-raised` | `#f1ebef` | `#1f2b29` |
| `--field-bg` | `#fbf7f9` | `#121b1a` |
| `--border` (= `--line`) | `#e6dee3` | `#27332f` |
| `--border-strong` (= `--line2`) | `#d9ced6` | `#33433e` |
| `--text` (= `--ink`) | `#101d1b` | `#eaf3f1` |
| `--text-secondary` (= `--ink2`) | `#2d3a38` | `#c3d1ce` |
| `--muted` | `#566964` (5,3:1) | `#8a9b98` |

### 2.2 Akcent, zlato, semantika

- **Akcent teal** `--accent` `#03797e` / dark `#05bcc4` — jediný chrome akcent
  (klikateľné, aktívne, focus). `--accent-300` = rodinné `--accent2`.
- **Zlato** je vzácne a vyhradené: jadro vedomia, brand, avatar, **aktívna destinácia
  v navigácii**. `--gold` `#b88a3a` / dark `#d8b878`; na text vždy `--gold-text`
  (`#8a6417` light — 4,9:1 na paperi; `#d8b878` dark — audit EST-001).
- `--success` · `--danger` · `--warn` + `-soft` varianty; `--cert-*` rampa pre istotu
  (overené / hypotéza / pasca / bez značky), `--heat-0..4` pre aktivitu.

### 2.3 Kategoriálna grafová paleta (`--chart-1..8`)

Prevzatá 1:1 z rodiny (rozhodnutie #55). Drift chráni test
`tests/js/css-tokens.test.js › Aura family drift`.

| Token | Light | Dark | Význam |
|---|---|---|---|
| `--chart-1` = `--chart-gold` | `#d8b878` | `#d8b878` | brand gold, téma-stabilný |
| `--chart-2` = `--chart-accent` | `#05bcc4` | `#4dd9df` | accent teal |
| `--chart-3` | `#6f86d6` | `#8a9cf0` | periwinkle |
| `--chart-4` | `#e0857b` | `#ec988f` | coral rose |
| `--chart-5` | `#6ec6a4` | `#7fd6b4` | mint |
| `--chart-6` | `#c08adb` | `#d29ff0` | orchid |
| `--chart-7` | `#e0a850` | `#ecba6c` | amber |
| `--chart-8` | `#5b9bd5` | `#74b0e8` | sky |

Farby 5 oblastí sú oficiálnou súčasťou rampy (rozhodnutie #61):
`--chart-area-marketing` `#b88a3a` · `--chart-area-vyvoj` `#03797e` ·
`--chart-area-dizajn` `#9d5c7a` · `--chart-area-biznis` `#2f6d8f` ·
`--chart-area-osobne` `#a86a4a`. **Nemenia sa** — riadia rozloženie na canvase.

### 2.4 Density tokeny

Jeden zdroj pravdy pre hustotu. Predvolená škála je „cozy" (`:root`). Rozhodnutie #59:
**tokeny áno, UI prepínač nie** — škály sú opt-in cez `<html data-density="…">`.

| Token | cozy (default) | comfortable | compact |
|---|---|---|---|
| `--card-pad` | 14px | 20px | 10px |
| `--card-radius` | 12px | 18px | 10px |
| `--kpi-pad` / `-accent` / `-sm` | 14 / 16 / 10 | 18 / 22 / 12 | 11 / 12 / 8 |
| `--kpi-value` / `-accent` / `-sm` | 24 / 28 / 16 | 26 / 32 / 18 | 22 / 26 / 15 |
| `--section-gap` | 14px | 22px | 10px |
| `--row-pad-y` / `-x` | 8 / 16 | 12 / 22 | 5 / 12 |
| `--control-h` | 32px | 38px | 28px |
| `--page-h1` | 30px | 42px | 22px |
| `--grid-gap` | 16px | 22px | 12px |

### 2.5 Výšky grafov, elevation, motion

- `--chart-h: clamp(220px, 34vh, 380px)`, `--chart-h-sm`, `--chart-h-lg` — hlavný graf
  sa vždy zmestí do prvého foldu. Utility `.chart-box`, `.chart-box-sm`, `.chart-box-lg`.
  **Žiadne pevné výšky SVG grafov v markupe** — výšku dáva `.chart-box`, nie atribút.
  Výnimka je `<canvas>`: atribúty `width`/`height` tam určujú rozlíšenie bitmapy, nie
  layout, takže `partials/dock.blade.php` má legitímne `<canvas id="growth-chart"
  width="248" height="60">`. Pri canvase je to správne; pri SVG to je dlh.
- Elevation: pôvodná `--elev-1..3` ladder (s inset rimom) **aj** rodinné
  `--shadow-sm/md/lg/pop/gold`. Nové komponenty používajú `--shadow-*`.
- Motion: `--dur-fast/base/slow/ambient` + `--ease`; rodinné `--transition`
  (`.18s cubic-bezier(.16,1,.3,1)`) a `--transition-fast`.

### 2.6 Geometria shellu

Rail je jediný zdroj šírky. Všetko ostatné sa počíta z neho:

```
--rail-w-collapsed: 72px      --rail-w-expanded: 208px
--rail-w: var(--rail-w-collapsed)     ← prepína :root[data-rail="expanded"]
--shell-left: calc(var(--edge) + var(--rail-w) + var(--sp-2))
--shell-top:  calc(var(--edge) + var(--header-h) + var(--sp-1))
--mobile-nav-h: 60px
```

`#app-header`, `#screens`, `#dock` čítajú `--shell-left`. Collapse railu preto posunie
celý shell bez jediného riadku JS a **bez zásahu do cudzích súborov**.

---

## 3. Komponenty

### 3.1 Anatómia stránky (`components/page.css`)

Rodinný rytmus obrazovky:

```
.page-stack            vertikálny flow, gap: var(--section-gap)
  .page-head
    .eyebrow           uppercase mono, 11px, letter-spacing .12em, --muted
    h1                 serif, var(--page-h1)
    .page-sub
  .kpi-grid            KPI strip
  .card / .card-soft   sekcie
```

`.screen-head .screen-sub` dostáva `.eyebrow` ošetrenie automaticky, takže existujúce
obrazovky (P10) získali rytmus bez zmeny markupu.

### 3.2 Karty a názvoslovie (G7)

`.card` · `.card-soft` · `.card-flat` · `.card-hover` · `.card-elevated` · `.card-overlay`
sú rodinné mená nad existujúcou gramatikou. Staré `.panel`, `.dash-card`, `.today-card`
**zostávajú funkčné** — parita sa dorába postupne, nie big-bangom.

`.pill` + `.pill-neutral/-accent/-positive/-negative/-gold` nad `.badge`/`.chip`.
`.tnum` = `font-variant-numeric: tabular-nums` na každom číselnom readoute.
`.tbl` = tabuľka v rodinnej hustote (`--row-pad-y/-x`).

### 3.3 KPI mriežka — zlúčená

`.metric-grid` a `.kpi-grid` boli dva paralelné duplikáty tej istej mriežky.
**Zlúčené:** layout definuje jeden blok v `components/kpi.css`, `.metric-grid` je jeho
alias, prezentačné triedy (`.metric-*` vs `.kpi-*`) sa nemenili.

- stĺpce: `repeat(auto-fit, minmax(min(140px, 100%), 1fr))`, `--kpi-cols` ako riadiaci token
- `.kpi-hero { grid-column: span var(--hero-span, 2) }`
- `#dock .kpi-grid` je vždy 2 stĺpce (dock je 300 px)

> **Pozor pri responzivite:** v jednostĺpcovej mriežke musí ísť `--hero-span` na `1`.
> `span 2` v jednom stĺpci vyrobí implicitný druhý stĺpec a dashboard sa rozsype.

### 3.4 Navigácia

**Rail (desktop).** 4 pomenované obsahové grupy + systémová grupa dole:

| Grupa | Destinácie |
|---|---|
| VEDOMIE | Dnes · Graf · Chat |
| ZÁZNAMY | Denník · Rozhodnutia |
| ZNALOSTI | Knižnica · Smernica |
| PREVÁDZKA | Kontrola · E-shop¹ |
| (dole) SYSTÉM | Nastavenia · Pomoc |

¹ Zaradenie E-shopu je **predbežné** — je to otvorený bod `CLAUDE.md` §7.2 (destinácia
nie je v katalógu rozhraní #16 a čaká na produktové rozhodnutie).

- **Collapse 72 ↔ 208 px**, `#rail-toggle`, persistencia `aura.rail.expanded`.
  V zbalenom stave: ikona + label pod ňou, eyebrow grupy skryté. V rozbalenom: ikona
  vľavo, label vedľa, eyebrow viditeľné, badge `.count` sa presunie na koniec riadku.
- **Aktívny stav je zlatý** (rodinný recept, zmena z teal fill):
  `color-mix(in srgb, var(--brand-gold) 16%, var(--panel-solid))` + `--gold-text` ikona
  + `--text` label + zlatý pill vľavo.
- Zóna destinácií je skrolovateľná (`.rail-scroll`) — rail sa nepreleje pri nízkom okne.
- Ikony zostávajú **Material Symbols Rounded** (rozhodnutie #60; lucide je vedomá odchýlka
  od rodiny — výmena je čistý náklad pri 11 položkách).

**Bottom nav (mobil).** Pozri §5.

### 3.5 Nastavenia

Rozhodnutie #67 + zadanie „zoškrtaj, nerozširuj" (používateľ zmenil 0 zo 17 volieb):

- **nad foldom 4 veci**: Téma (segment), Zvuk, Zobraziť knižnicu v grafe, Ambient režim
- **`<details>` „Pokročilé"** (zavreté): Chat, Pohyb, Sieť — filter, Sieť — sily,
  Priehľadnosť, Veľkosti, resety — 32 ovládacích prvkov

Žiadne `id` ani `data-*` sa nemenili, takže `settings.js`, `filters.js`, `filters-cert.js`
(injektuje `#certrings-toggle` a `#filter-tags` do `.switch-row` reťazca), `pack.js`,
`ambient.js` a `chat/controller.js` si držia svoje úchyty.

**Téma má tri možnosti** (rozhodnutie #64): `Svetlá / Tmavá / Systém`, segmentovaný
prepínač `#theme-seg` s `role="radiogroup"`. Starý dvojstavový `#theme-toggle` zostáva
v DOM ako `.visually-hidden` (mieri naň Playwright smoke) a `theme.js` drôtuje oba.

---

## 4. Téma light / dark / system

`localStorage aura.theme` drží **preferenciu** (`light | dark | system`), na `:root`
sa stampuje vždy **rozložená** hodnota (`data-theme="light|dark"`).

Prečo v JS a nie v CSS: variant „system" by v CSS znamenal druhý
`@media (prefers-color-scheme: dark)` blok s duplikátom ~80 tokenov. `theme.js`
preferenciu rozloží a drží `matchMedia` listener, takže CSS má **jediný prepínací bod**
(`:root[data-theme="dark"]`) a zmena OS témy sa dobehne za behu.

Kompatibilita: shim `hades.theme → aura.theme` (kontrakt #2) zostáva nedotknutý;
staré hodnoty `light`/`dark` sú platné preferencie, takže nič netreba migrovať.

---

## 5. Breakpointy a responzivita

Záväzný zoznam (dokumentovaný aj ako `--bp-lg/-md/-sm` v `tokens.css`):

| Breakpoint | Čo sa mení | Súbor |
|---|---|---|
| **≤ 1280 px** | užšie `#dock`/`#node-panel` (`min(300px, 26vw)`), skryté `#header-metrics` | `responsive.css` |
| **≤ 900 px** | dock a node-panel doprava, skryté `#brand-name` a cmdk hint | `responsive.css` |
| **≤ 640 px** | **MOBIL**: rail von, bottom nav, obsah na celú šírku, dock/node-panel ako spodné listy, graf desktop-only | `mobile.css` |
| **≤ 390 px** | `--edge: 8px`, jednostĺpcové mriežky (`--hero-span: 1`), menšie h1 a labely | `mobile.css` |

`mobile.css` sa importuje z `shell/rail-badge.css` (slot 71 zo 72), takže leží na konci
kaskády a nepotrebuje ani jeden `!important` na prebitie komponentových šírok.

### 5.1 Mobil (rozhodnutia #76, #77, #78)

**V rozsahu:** Chat, Dnes, Denník, Knižnica (+ Rozhodnutia, Kontrola, Smernica) na 390 px.
**Mimo rozsahu:** graf na mobile a touch gestá pre canvas.

- **Bottom nav** `#mobile-nav`: 4 destinácie (Dnes · Chat · Denník · Knižnica) + „Viac",
  výška 60 px + `env(safe-area-inset-bottom)`. Aktívny stav ten istý zlatý recept ako rail.
- **Spodný list „Viac"** `#mobile-sheet`: Graf, Rozhodnutia, Kontrola, Smernica, E-shop,
  Nastavenia, Pomoc. Nastavenia a Pomoc **delegujú klik** na `#btn-settings` / `#btn-help`
  v rely — jeden zdroj pravdy. Focus trap + Escape (najvyššia vrstva kaskády).
- **Graf** má na mobile `#mobile-graph-note`: „Vizualizácia je len na desktope" +
  tlačidlo na Dnes. **Nikdy prázdne plátno.**
- Dotykové cieľové plochy ≥ 40 px; `#screens` má spodný priestor na nav; `#prompt`
  sa posadí nad nav.
- Markup mobilnej vrstvy je v DOM vždy, viditeľnosť riadi **výhradne `mobile.css`** —
  na desktope má nulový layoutový dopad.

---

## 6. Prístupnosť

- **Focus ring** na všetkom interaktívnom (`--focus-ring`), nikdy `outline: none` bez náhrady.
- **Focus trap** (`shell/focus-trap.js`, rozhodnutie #80) v Cmd-K, Pomocníkovi, Markdown
  náhľade a mobilnom spodnom liste: Tab/Shift+Tab cyklí vnútri dialógu, počiatočný fókus
  na prvý ovládací prvok, po zatvorení sa fókus **vráti na spúšťač**.
- **Escape kaskáda** (`shell/shortcuts.js`) — jeden Esc zavrie vždy len najvrchnejšiu
  vrstvu; poradie: mobilný list → Cmd-K → balík → prepájanie → ambient → md → pomocník →
  detail uzla → dock → prompt → lokálny graf → fokus.
- **`prefers-reduced-motion`** (rozhodnutie #81) je **dynamický**: `base/motion.css`
  vypína CSS animácie, `shell/reduced-motion.js` naviac znuluje pohyb canvasu
  (`S.opts.anim`, `S.opts.life`) **bez zápisu do localStorage** a po vypnutí preferencie
  vráti pôvodné hodnoty. Stampuje `:root[data-reduced-motion="1"]`.
- **Kontrast**: text ≥ 4,5:1, grafika ≥ 3:1. `--muted` 5,3:1 na paperi.
  Zlatý aktívny stav používa `--gold-text`, nie `--gold`.
- `.visually-hidden` na prístupné skrytie (element zostáva pre čítačku a pre testy).
- Canvas: `role="img"` + `aria-label` + skrytý textový sumár (minimum podľa rozhodnutia #79);
  plná klávesová navigácia grafu je mimo rozsahu sprintu.

---

## 7. Plátno (canvas)

- **Žiadna hmla**: bez častíc, halo gradientov, area blobov a vignette — plné kruhy
  s ink obrysom (slider „Obrysy uzlov").
- **Farba = oblasť** vo všetkých náhľadoch; **typ = tvar**: spomienka plný disk,
  skill donut (diera vo farbe papiera), projekt disk s tenkým vonkajším prstencom,
  jadro zlaté koncentrické kruhy.
- **Auto-fit** pri štarte, prepnutí náhľadu a klávese `0`.
- **Stlmenie s podlahou**: fokus/hover stlmí zvyšok na min. 0,30 (uzly) / 0,20 (hrany),
  v dark 0,35/0,25 — kontext nikdy nezmizne úplne.
- **Labely** na plátne max 30 znakov s „…", plný text v tooltipe a paneli.
- Pulzy = plné krúžky vo farbe oblasti; sila uzla = polomer 7–16 (jadro 24).

---

## 8. Interakcie

- **Fokus oblasti/oddelenia**: klik v strome štruktúry alebo dvojklik na oblasť v mape.
- **Klávesnica** funguje aj na slovenskom rozložení (fyzické `Digit1/2/3/0`); skratky sa
  nespúšťajú vo formulárových poliach.
- **Hľadanie má jediný vstup: Cmd-K paleta** (`Ctrl+K`, `F`, `/`). Hľadá cez SK-aware
  `/api/search` (uzly + playbooky), pozná `cert:` a `tag:` prefix, navigáciu aj akciu
  „Vytvor smernicu". Starý dockový `renderSearch` bol **zmazaný** — duplikoval ju horšie
  (lokálny filter nad `S.nodes`) a nemal ani volajúceho, ani markup.
- **Async akcie**: tlačidlo disabled + „Ukladám…", toast pri úspechu aj chybe; mazanie
  cez arm-confirm („Naozaj zmazať?", 3 s), žiadne systémové dialógy.
- **Empty/error stavy**: jednotný komponent (ikona + text); pád API zobrazí hero
  „Vedomie sa nepodarilo prebudiť" + Skúsiť znova.

---

## 9. Zásady

1. Jedna sémantika farieb — farba hovorí „kam patrí", tvar „čo to je".
2. Zlato je vzácne — čím menej ho je, tým viac znamená jadro. Jediné rozšírenie: aktívna
   destinácia v navigácii (rodinný recept).
3. Kontrast pred dekoráciou — WCAG 4,5:1 text, 3:1 grafika.
4. Feedback na každú akciu — používateľ nikdy neháda, či sa niečo stalo.
5. Žiadne hviezdy, žiadne emoji, žiadna hmla — len čisté kruhy a hairliny.
6. **Tokeny sa dopĺňajú, neprepisujú.** Farebné hodnoty rodiny sa nikdy neladia „o odtieň" —
   rozišlo by to dve appky.

---

## 10. Známy dlh

Vyriešené (overené v kóde 31. 7. 2026 — nehláste to znovu):

- ~~Fonty nie sú vendorované.~~ **Vendorované sú** (rozhodnutie #142, akceptačné
  kritérium 10). `resources/css/base/fonts.css` je aktívny, v `resources/views/`ani
  `resources/css/` nie je jediný request na `fonts.googleapis.com` / `fonts.gstatic.com`
  a Vite hashuje `.woff2` do `public/build/assets/` (Geist, Geist Mono, Playfair Display,
  Material Symbols Rounded subset). Licencie sú v `resources/fonts/`. Appka **je**
  offline-ready.
- ~~`graph/canvas-colors.js` má vlastný `THEMES` objekt.~~ **Číta CSS custom properties**;
  `THEMES` literál aj `TODO(P7)` sú zmazané. Zostal len komentár o hex parite s pôvodným
  literálom (canvas berie oboje).

Stále otvorené / zámerné:

- Density škály `comfortable` / `compact` sú definované, ale nemajú UI vstup —
  zámerne (#59). Prepínač by bol over-engineering.
- „Žiadny raw hex" mimo `tokens.css` a `dark.css` stráži `npm run lint:css` (stylelint).
  Dnes je čistý: jediné zvyšné výskyty `#…` v `resources/css/**` sú **v komentároch**
  (`base/fonts.css`, `screens/decisions.css`) — nie sú to literály.
- `tokens.css` definuje **228 tokenov**. Pri pridávaní platí zásada 6: dopĺňať, neprepisovať.
