# Aura app dizajnové tokeny

> Referenčný archív presných dizajnových tokenov appky Aura HR mapa (server/public/styles.css) — farby, typografia, spacing, radiusy, tiene a komponenty pre 1:1 replikáciu prémiovej šperkárskej identity (teal akcent + zlatá koruna).

## Prehľad

Toto je **archív hodnôt**, nie návod na dizajn. Zdrojom pravdy je jeden CSS súbor `styles.css` postavený na CSS custom properties (`:root` premenné) s light aj dark témou. Identita: krémovo-ružové pozadie (`paper`), tmavá teal-čierna `ink`, teal akcent (`accent`), zlatá koruna značky (`brand-gold`). Fonty Geist (UI) + Playfair Display (dekoratívny italic). Všetko je škálovateľné cez premenné — zmena `--accent` alebo `--brand-gold` sa premietne všade.

Téma sa prepína atribútom `data-theme="dark"` na koreňovom elemente; hustota atribútom `data-density="compact"`. Farba oddelenia sa injektuje per-komponent cez lokálnu premennú `--c` (fallback `var(--accent)`).

## Kľúčové pojmy

- **CSS custom property token** — pomenovaná premenná v `:root` (napr. `--accent: #03797e`), referencovaná cez `var(--accent)`. Základná jednotka celého systému.
- **Sémantické názvy** — tokeny sú pomenované účelom (`paper`, `surface`, `ink`, `muted`, `line`, `accent`, `brand-gold`), nie surovou farbou. Dark téma len prepisuje hodnoty tých istých názvov.
- **`--c` lokálna premenná** — farba oddelenia (department color), nastavuje sa inline na prvku (`.node`, `.org-card`, `.emp-card`, `.dept-chip`, `.org-panel`), fallback `var(--accent)`. Riadi ľavý/horný farebný okraj kariet a farebný panel vetvy organogramu.
- **`color-mix()`** — použité na priehľadné odtiene priamo z tokenu, napr. `color-mix(in srgb, var(--brand-gold) 12%, var(--surface))` pre aktívnu nav položku.
- **`brand-gold-rgb`** — RGB trojica zlatej (`216, 184, 120`) pre `rgba()` v gradientoch a tieňoch (tam kde treba alfa nad brand-gold).
- **Elevation** — tri úrovne tieňov: `--shadow` (karty), `--shadow-lg` (modály, drawery), `--shadow-gold` (hover zlatých kariet).

## Farby — light téma (`:root`)

| Token | Hex | Použitie |
| --- | --- | --- |
| `--paper` | `#f8f4f7` | Základné pozadie stránky (krémovo-ružová), body, loader, login |
| `--surface` | `#ffffff` | Plochy: panely, karty, sidebar, modály, tlačidlá default |
| `--surface-2` | `#fbf7f9` | Sekundárna plocha: badge, kbd, segmented, bar-track, blk-col, hover menu |
| `--ink` | `#101d1b` | Primárny text (tmavá teal-čierna) |
| `--ink-soft` | `#2d3a38` | Jemnejší text: nav položky, seg/tab labely, bar-label |
| `--muted` | `#566964` | Stlmený text: eyebrow, meta, počty, uppercase labely |
| `--line` | `#e6dee3` | Základné okraje a deliace čiary |
| `--line-soft` | `#f0e9ee` | Jemnejšie čiary: riadky tabuliek (td), def-row |
| `--accent` | `#03797e` | Teal akcent: primárne CTA, odkazy, focus, aktívne stavy |
| `--accent2` | `#05bcc4` | Svetlejší teal: gradienty (login pruh, hero) |
| `--accent-soft` | `#d6f5f6` | Mäkké teal pozadie |
| `--accent-tint` | `#eef9f9` | Najsvetlejší teal tint: hover nav/outline, focus ring, bulk-bar, cmdk hover |
| `--accent-line` | `#a9dedf` | Teal okraj (bulk-bar border) |
| `--accent-ink` | `#05666a` | Teal text na tintoch: seg.active, tab.active, node .em, org-glabel hover |
| `--gold` | `#b88a3a` | Sýta zlatá (block-item authority, gold-soft base) |
| `--gold-soft` | `#ead7b0` | Mäkká zlatá |
| `--brand-gold` | `#d8b878` | **Zlato značky** — koruna, gold tlačidlo, aktívna nav, avatary, hover okraje |
| `--brand-gold-rgb` | `216, 184, 120` | RGB pre rgba() gradienty/tiene brand-gold |
| `--gold-text` | `#8a6417` | Zlatý text: serif-italic, role-pill, avatar iniciály |
| `--danger` | `#d64545` | Chyby, KPI block-item, danger tlačidlo/badge/toast |
| `--danger-soft` | `#fde8e8` | Mäkké červené pozadie (badge, login-error, toast) |
| `--warn` | `#d97706` | Upozornenia, nav-alert, warn badge |
| `--warn-soft` | `#fdf0e3` | Mäkké oranžové pozadie |
| `--ok` | `#0f8c5a` | Úspech, ok badge |

## Farby — dark téma (`[data-theme="dark"]`)

Prepisuje tie isté názvy; `color-scheme: dark`.

| Token | Hex / hodnota | Poznámka |
| --- | --- | --- |
| `--paper` | `#0e1413` | Tmavé pozadie |
| `--surface` | `#161f1d` | Plochy |
| `--surface-2` | `#1b2624` | Sekundárna plocha |
| `--ink` | `#eaf3f1` | Text |
| `--ink-soft` | `#c3d1ce` | Jemný text |
| `--muted` | `#8a9b98` | Stlmený text |
| `--line` | `#27332f` | Okraje |
| `--line-soft` | `#202b28` | Jemné čiary |
| `--accent` | `#05bcc4` | Akcent (svetlejší teal v dark) |
| `--accent2` | `#4dd9df` | Svetlý teal |
| `--accent-soft` | `#0a3a3c` | Mäkké teal pozadie |
| `--accent-tint` | `#0d2a2b` | Teal tint (hover) |
| `--accent-line` | `#2a5247` | Teal okraj |
| `--accent-ink` | `#7fe0e4` | Teal text |
| `--gold` | `#d8b878` | Zlatá |
| `--gold-soft` | `#5a4a2e` | Mäkká zlatá (tmavá) |
| `--gold-text` | `#d8b878` | Zlatý text (v dark = brand-gold) |
| `--brand-gold` | `#d8b878` | Zlato značky (nezmenené) |
| `--danger` | `#e26464` | Chyba |
| `--danger-soft` | `rgba(226,100,100,.16)` | Mäkké červené |
| `--warn` | `#e8912f` | Upozornenie |
| `--warn-soft` | `rgba(232,145,47,.16)` | Mäkké oranžové |
| `--ok` | `#2fae74` | Úspech |

`--brand-gold-rgb` sa v dark nemení (dedí `216, 184, 120`).

## Typografia

Fonty sa načítavajú z Google Fonts v `index.html`: `Geist` (váhy 400;500;600;700) a `Playfair Display` (ital 500;600). Pozn.: koreňový `--mono` bol zámerne prepísaný na Arial (nie Geist Mono) — „na želanie všade Arial".

| Token | Hodnota | Použitie |
| --- | --- | --- |
| `--font` | `"Geist", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` | Základné UI písmo (body, tlačidlá, inputy) |
| `--serif` | `"Playfair Display", Georgia, serif` | Dekoratívny italic (`.serif-italic`) |
| `--mono` | `Arial, Helvetica, sans-serif` | „Mono" role: kbd, .mono, počty, em kódy, fwd-diagram (reálne Arial, nie monospace) |

Globálny `font-size` na `html, body` je **14px**; `-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`.

### Veľkosti a váhy podľa komponentov

| Miesto | font-size | font-weight | letter-spacing | Ďalšie |
| --- | --- | --- | --- | --- |
| body / base | 14px | 400 | — | — |
| `.loader-mark` | 40px | 700 | -.02em | prefix ♛ v brand-gold |
| `.detail-titles h1` | 24px | 700 | -.02em | — |
| `.login-brand h1` / `.hero h2` | 22px | 700 | -.01em | — |
| `.topbar h2` / `.drawer-head h3` | 20px | 700 | -.01em | — |
| `.modal-head h3` | 18px | 700 | -.01em | — |
| `.side-brand-txt strong` | 17px | 700 | -.01em | — |
| `.cmdk input` | 15px | — | — | vyhľadávanie |
| `.panel-head h3` / `.empty-t` | 15px | 600 / 700 | — | — |
| `.node .nm` | 13.5px | 700 | — | meno v strome |
| default text / tabuľky / inputy | 13px | 400–500 | — | `.btn` 13px/500 |
| `.badge` | 11px | 600 | — | pill |
| `.eyebrow` / `.fld > span` | 11px | 700 | .12em / .1em | UPPERCASE |
| `.stat .k` | 11px | 700 | .1em | UPPERCASE, muted |
| `.stat .v` | 28px | 700 | -.02em | tabular-nums |
| `table.tbl th` | 10.5px | 700 | .08em | UPPERCASE, muted |
| `.side-brand-txt span` | 10px | — | .22em | UPPERCASE |
| `.role-pill` / `.org-glabel` | 10px | 700 | .06em / .08em | UPPERCASE pill |
| `.kbd` / `.nav-alert` | 10px | 700 | — | mono |

Vzory: veľké čísla a nadpisy majú záporný `letter-spacing` (-.01 až -.02em); malé UPPERCASE labely majú kladný (.06–.22em) a `font-weight: 700`. Číselné hodnoty používajú `font-variant-numeric: tabular-nums`.

## Spacing, grid a rozmery

Nie je definovaná pomenovaná spacing škála — používajú sa priame px hodnoty. Prevládajúci rytmus: **6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 px**.

| Kontext | Hodnota |
| --- | --- |
| `.view` padding | 24px (compact: 16px) |
| `.topbar` padding | 13px 24px |
| `.panel-body` padding | 16px 18px (compact: 12px 14px) |
| `.panel-head` padding | 15px 18px (compact: 11px 14px) |
| `.stat` padding | 16px 18px (compact: 12px 14px) |
| `.grid` gap | 16px (compact: 12px) |
| `.modal-body` / `.drawer-body` padding | 18px 20px |
| Sidebar šírka | 240px (mobil: off-canvas -260px) |
| `.view` max-width | 1280px |
| `.detail` max-width | 1100px |
| Inputy/tlačidlá min-height | 34px (sm 30, xs 26; compact 30) |

### Grid systémy

| Trieda | grid-template-columns |
| --- | --- |
| `.grid-cards` | `repeat(auto-fill, minmax(220px, 1fr))` |
| `.cols-2` | `1fr 1fr` |
| `.cols-3` | `repeat(3, 1fr)` |
| `.grid-4` | `repeat(4, 1fr)` (≤1100px: 2, ≤700px: 1) |
| `.emp-cards` | `repeat(auto-fill, minmax(240px, 1fr))` |
| `.fld-row` / `.blk-cols` | `1fr 1fr` / `repeat(2, 1fr)` (mobil: 1fr) |
| `.detail-body.has-aside` | `2fr 1fr` (≤900px: 1fr) |

Responzívny breakpoint: hlavný **900px** (sidebar off-canvas, cols → 1fr), plus 1100px a 700px pre grid-4/blk-cols.

## Radiusy

| Token | Hodnota | Použitie |
| --- | --- | --- |
| `--r-sm` | 8px | tlačidlá, inputy, badge blocky, block-item, menu-item |
| `--r` | 10px | nav-item, node, org-card, blk-col, menu-pop |
| `--r-lg` | 14px | panely, staty, modály, login-card, hero, emp-card, matrix |
| pill | `999px` | badge, dept-chip, role-pill, segmented, toast, tree-ctrl, count |
| avatar | 8px (org-card 6px) | štvorcový zaoblený |
| `.brand-mark` | 12px | logo box |
| `.org-panel` | 16px | farebný panel vetvy |

## Tiene / elevation

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow` | `0 1px 2px rgba(15,40,38,.05), 0 8px 24px -14px rgba(15,40,38,.12)` | `0 1px 2px rgba(0,0,0,.3), 0 12px 30px -16px rgba(0,0,0,.55)` |
| `--shadow-lg` | `0 4px 12px rgba(15,40,38,.08), 0 18px 40px -18px rgba(15,40,38,.22)` | `0 4px 12px rgba(0,0,0,.4), 0 20px 44px -20px rgba(0,0,0,.65)` |
| `--shadow-gold` | `0 1px 2px rgba(15,40,38,.05), 0 14px 32px -16px rgba(var(--brand-gold-rgb),.35)` | `0 1px 2px rgba(0,0,0,.3), 0 16px 38px -18px rgba(0,0,0,.6)` |

`--shadow` = karty/panely/staty v pokoji. `--shadow-lg` = plávajúce vrstvy (modál, drawer, cmdk, menu-pop, login-card). `--shadow-gold` = hover zlatých interaktívnych kariet (stat, node, org-card, emp-card). Focus ring: `box-shadow: 0 0 0 3px var(--accent-tint)` na inputoch; `:focus-visible` = `outline: 2px solid var(--accent); outline-offset: 2px`.

## Komponenty — kľúčové špecifikácie

### Tlačidlá (`.btn`)
Base: inline-flex, gap 7px, font-weight 500, 13px, letter-spacing -.005em, radius `--r-sm`, padding 9px 14px, min-height 34px, border 1px transparent, transition `all .18s cubic-bezier(.16,1,.3,1)`. Veľkosti: `.btn-sm` (30px/12px), `.btn-xs` (26px/11.5px), `.btn-icon` (štvorec 34px).

| Variant | Pozadie | Text | Hover |
| --- | --- | --- | --- |
| `.btn-accent` / `.btn-primary` | `--accent` | #fff | brightness(1.06), translateY(-1px), teal glow |
| `.btn-gold` | `--brand-gold` | `#1a1410` | brightness(1.05), zlatý glow |
| `.btn-outline` | `--surface` + `--line` border | `--ink` | border `--accent`, bg `--accent-tint` |
| `.btn-ghost` | transparent | `--ink-soft` | bg ink 6% mix |
| `.btn-danger` | transparent | `--danger` | bg `--danger-soft` |

Aktívny stav: `transform: translateY(.5px)`; disabled: `opacity .55`.

### Karty a panely
- `.panel` — surface, 1px line, radius `--r-lg`, `--shadow`. Hlavička `.panel-head` (padding 15px 18px, spodná čiara), telo `.panel-body`.
- `.stat` — stat tile, radius `--r-lg`, `--shadow`; hover: translateY(-2px), zlatý okraj (brand-gold 45% mix) + `--shadow-gold`. `.k` (uppercase label), `.v` (28px číslo), `.sub`.
- `.emp-card` / `.org-card` / `.node` — karty s farebným okrajom oddelenia (`border-left`/`border-top: 3px solid var(--c, var(--accent))`), hover zlatý zdvih.

### Tabuľky (`table.tbl`)
`border-collapse: collapse`, font 13px. `th`: 10.5px UPPERCASE muted 700, letter-spacing .08em, spodný `--line`, nowrap. `td`: padding 10px 12px, spodný `--line-soft`. Riadok hover: `background: color-mix(in srgb, var(--accent) 8%, transparent)`, `cursor: pointer`. Wrapper `.tbl-wrap` má `overflow-x: auto`. Matrix tabuľka (`table.matrix`) má sticky hlavičku/prvý stĺpec a vertikálny text (`writing-mode: vertical-rl`).

### Badge / chip
`.badge` — pill 999px, 11px/600, padding 2px 9px, border `--line`, bg `--surface-2`, text `--ink-soft`. Varianty `.ok` / `.warn` / `.danger` (farba + mix pozadie, transparent border), `.dot` (7px kruh `currentColor`). `.dept-chip` a `.avatar` používajú brand-gold mix pozadia a `--c` farbu oddelenia.

### Ostatné komponenty
Inputy (34px, focus teal ring), segmented control (pill prepínač), tabs (spodný border, aktívny `--brand-gold` underline + `--accent-ink` text), bar-list (progres 8px track), donut (132px conic-style), org tree/organogram (CSS spojnice `border-top/left`, farebné panely vetiev), drawer (min 560px, slideIn animácia), modál (min 640px, .wide 860px), toasts (pill, ok/err/undo), command palette (`.cmdk`, 560px), skeleton (shimmer gradient), tooltip (`[data-tip]` cez `::after`).

### Animácie
- `@keyframes slideIn` — translateX(24px)+opacity .6 → 0 (drawer, modál, toast).
- `@keyframes shimmer` — background-position -200% → 200% (skeleton).
- Prechod pruhov: `width .5s cubic-bezier(.16,1,.3,1)`; hover karty `.16s`.
- `@media (prefers-reduced-motion: reduce)` vypína animácie (duration .001ms).

### Značkové prvky
- `.crown` — zlatá koruna cez CSS mask z `/aura-crown.png`, `background: var(--brand-gold)`, 33×28px (`.lg` 60×50px, hero-crown 46×40px s drop-shadow).
- `.loader-mark::before` a `.toast` prefix používajú unicode `♛` v brand-gold.
- `.login-card::before` a `.hero` — gradientový pruh/žiara `linear-gradient(90deg, var(--brand-gold), var(--accent2))` a radiálne gradienty z brand-gold + teal.
- `.serif-italic` — Playfair Display italic 600, `--gold-text`.

## Súbory a miesta

- `C:\Users\Ucet\Desktop\Šperky Aura app\aura-hr-mapa\server\public\styles.css` — jediný a kompletný zdroj tokenov (521 riadkov). `:root` = light (r. 4–38), `[data-theme="dark"]` = dark (r. 39–66), `[data-density="compact"]` (r. 419–429).
- `C:\Users\Ucet\Desktop\Šperky Aura app\aura-hr-mapa\server\public\index.html` — načítanie fontov (Google Fonts `Geist` + `Playfair Display`, r. 10–12), pripojenie `/styles.css?v=8`, favicon SVG so zlatou korunou.
- `/aura-crown.png` (v public) — zdroj masky pre `.crown` a `.hero-crown`.

## Zdroje

- Google Fonts: Geist (`wght@400;500;600;700`), Playfair Display (`ital,wght@1,500;1,600`).
- Interné skills: `skills/design/ui-design-systems.md`, `skills/design/brand-graphics.md` (širší kontext značky Aura a design tokenov).
