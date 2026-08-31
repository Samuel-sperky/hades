# UX plán — Hades v parite s Aura Marketing

Cieľ: aby Hades (AI-mind) čítal ako ďalšia obrazovka Aura ekosystému — rovnaké
tokeny, rovnaké rozloženie stránky, rovnaká grafová paleta a rovnaké komponentné
názvoslovie ako `C:\Aura\sperky-ai` (Aura Marketing).

Referencie:
- Aura Marketing: `src/app/globals.css` (994 r.), `src/components/charts/chartTheme.ts`, `src/components/Nav.tsx`, `src/app/(app)/layout.tsx`
- Hades: [mind.css](public/css/mind.css), [mind.js](public/js/mind.js), [charts.js](public/js/charts.js), [mind.blade.php](resources/views/mind.blade.php)

---

## 1. Kde Hades už je v parite (nemeniť)

Hades má „AURA-LIGHT" retheme, takže farebné jadro sedí 1:1:

| Token | Aura | Hades | Stav |
|---|---|---|---|
| paper / bg | `#f8f4f7` | `--bg-rgb: 248,244,247` | ✅ |
| panel | `#ffffff` / `#fbf7f9` | `--panel-rgb` + `--surface-2: #fbf7f9` | ✅ |
| ink / ink2 / muted | `#101d1b` / `#2d3a38` / `#566964` | `--text` / `--text-secondary` / `--muted` | ✅ |
| accent / accent2 | `#03797e` / `#05bcc4` | `--accent` / `--accent-300` | ✅ |
| accent-soft / tint | `#d6f5f6` / `#eef9f9` | `--accent-soft` / `--accent-softer` | ✅ |
| gold / brand-gold / gold-text | `#b88a3a` / `#d8b878` / `#8a6417` | rovnaké | ✅ |
| success / danger / warn | `#0f8c5a` / `#d64545` / `#d97706` | rovnaké | ✅ |
| border | `#e6dee3` | `--border` | ✅ |
| fonty | Geist / Geist Mono / Playfair | rovnaké | ✅ |
| radius ladder | 8 / 10 / 14 / 999 | `--r-sm/md/lg/pill` | ✅ |
| dark téma | `[data-theme="dark"]` | `:root[data-theme="dark"]` (r. 192) | ✅ |

Takže **nejde o rebrand, ale o parity rozdielov v štruktúre, hustote a grafoch.**

---

## 2. Gap analýza — 7 reálnych rozdielov

### G1 — Chýba kategoriálna grafová paleta (`--chart-1..8`)
Aura má osem-hodnotový ramp (`chart-1` gold, `chart-2` teal, potom periwinkle,
coral, mint, orchid, amber, sky) s vlastnými dark variantami a `chartTheme.ts`
drift testom. Hades číta v `charts.js` len `--heat-*`, `--cert-*`, `--accent`.
→ Každý ďalší graf v Hadesovi si vymyslí vlastnú farbu.

### G2 — Chýbajú density tokeny
Aura má jeden zdroj pravdy pre hustotu: `--card-pad`, `--card-radius`,
`--kpi-pad`, `--kpi-value`, `--section-gap`, `--row-pad-y/x`, `--control-h`,
`--page-h1`, `--grid-gap` + tri škály (`comfortable` / cozy default / `compact`)
prepínané cez `<html data-density>`. Hades má fixnú 8px škálu (`--sp-0..5`) bez
prepínača — obrazovky Denník / Knižnica / Rozhodnutia sú vizuálne vzdušnejšie
než ekvivalentné Aura tabuľky.

### G3 — Chýbajú viewport-aware chart-height tokeny
Aura: `--chart-h: clamp(220px, 34vh, 380px)`, `--chart-h-sm`, `--chart-h-lg` —
hlavný graf sa vždy zmestí do prvého foldu. Hades má výšky zadrôtované
(`<canvas id="growth-chart" height="60">`).

### G4 — Iná anatómia stránky
Aura stránka = `.page-stack` (vertikálny flow s `--section-gap`) → `h1` +
`.eyebrow` → `.kpi-grid` (`--kpi-cols`, `.kpi-hero` span) → `.card` sekcie.
Hades má `.screen-head` (h1 + `.screen-sub`) a ad-hoc bloky; `.kpi-grid` existuje
len na Dnes (r. 2939), `.metric-grid` (r. 1790) je paralelný duplikát.

### G5 — Navigácia: rail vs. pomenované grupy
Aura: ľavý sidebar `.nav-side` s **pomenovanými sekciami** (`NavGroup.label` ako
uppercase eyebrow), ikony lucide, collapse persistovaný v localStorage, active
stav zlatým `color-mix`. Hades: 56px ikonový rail, 7 destinácií v jednej
nerozdelenej grupe + spodná systémová grupa, Material Symbols, bez collapse a
bez labelov sekcií.

### G6 — Chýba elevation/motion parita
Aura má `--shadow-sm/md/lg/pop/gold` + `--transition: .18s cubic-bezier(.16,1,.3,1)`
a `--transition-fast`. Hades má `--elev-1..` ladder a vlastné časovania.

### G7 — Komponentné názvoslovie sa nedá zdieľať
Aura `.card` / `.card-soft` / `.card-hover` / `.btn-*` / `.pill-*` / `.eyebrow` /
`.tnum` vs. Hades `.panel` / `.ghost` / `.primary` / `.badge` / `.chip`.
Kopírovanie markupu medzi appkami dnes nefunguje.

---

## 3. Plán — 5 vĺn

### Vlna 1 — Token bridge (najvyšší pomer efekt/riziko)
Do `:root` v [mind.css](public/css/mind.css) doplniť **Aura-menované aliasy nad
existujúce Hades tokeny** — nič neprepisovať, len pridať most:

```
--panel2: var(--surface-2);   --ink: var(--text);   --ink2: var(--text-secondary);
--accent2: var(--accent-300); --accent-tint: var(--accent-softer);
--card-pad / --card-radius / --kpi-pad / --kpi-value / --section-gap /
--row-pad-y / --row-pad-x / --control-h / --page-h1 / --grid-gap  (cozy hodnoty)
--chart-1..8 + --chart-gold/--chart-accent  (light + dark blok)
--chart-h / --chart-h-sm / --chart-h-lg
--shadow-sm/md/lg/pop/gold → mapovať na --elev-*
--transition / --transition-fast
```
Riešime G1, G2, G3, G6. Bez zmeny jediného existujúceho pravidla → nulové riziko
regresie. **Toto je jediná vlna, ktorú odporúčam spraviť aj keby sa zvyšok odložil.**

### Vlna 2 — Grafy na Aura paletu
`charts.js` (250 r.) prepnúť z `--accent` na `--chart-*`:
- `donut()` — certainty segmenty: overené `--chart-2` (teal), hypotéza
  `--chart-7` (amber), pasca `--chart-4` (coral), bez `--chart-3`.
- `growthLine()` — línia `--chart-gold`, výplň `color-mix` 14 %, výška
  `--chart-h-sm` namiesto `height="60"`.
- `heatmap()` — ramp derivovať z `--chart-2` cez `color-mix` (5 krokov) namiesto
  samostatných `--heat-*`.
- Prevzať Aura pattern: **jeden `chartTheme` objekt + drift test**, aby light
  fallback nikdy nerozišiel s `:root` (v Aure to chytil až test).
- Pridať `.tnum` (`font-variant-numeric: tabular-nums`) na všetky číselné
  readouty a KPI hodnoty.

### Vlna 3 — Anatómia obrazovky
- `.screen` → obaliť do `.page-stack` (`display:flex; gap: var(--section-gap)`).
- `.screen-head`: `h1` na `--page-h1`, `.screen-sub` → `.eyebrow` treatment
  (11px, `letter-spacing .12em`, uppercase, `--muted`) — presne ako Aura.
- Zlúčiť `.metric-grid` (r. 1790) a `.kpi-grid` (r. 2939) do jedného
  `.kpi-grid` s `--kpi-cols` a `.kpi-hero { grid-column: span 2 }`.
- Zaviesť `.card` / `.card-soft` / `.card-hover` ako aliasy k `.panel` a nové
  bloky písať Aura názvoslovím (G7 sa vyrieši postupne, nie big-bangom).
- **Dnes** dostane Aura dashboard rytmus: KPI strip (uzly / hrany / nové 7d /
  na kontrolu) → hero graf (`--chart-h`) → dva stĺpce (heatmapa + donut) →
  posledné záznamy ako `.tbl` s `--row-pad-*`.

### Vlna 4 — Navigácia
- Rail rozdeliť na pomenované grupy s uppercase eyebrow labelmi:
  **VEDOMIE** (Dnes, Graf) · **ZÁZNAMY** (Denník, Rozhodnutia) ·
  **ZNALOSTI** (Knižnica, Smernica) · **SPRÁVA** (Kontrola, Nastavenia, Pomoc).
- Pridať expand/collapse (56px ↔ 208px) s persistenciou v `localStorage`
  (`hades.nav.collapsed`) — v collapsed stave labely aj eyebrow schované,
  presne ako Aura `.nav-side` collapse.
- Active stav preklopiť na Aura recept: `color-mix(in srgb, var(--brand-gold) 16%, var(--panel))`
  + `--ink` text (dnes teal fill).
- Ikony ostávajú Material Symbols — Aura má lucide, ale výmena je čistý náklad
  bez vizuálneho prínosu pri 10 položkách. **Vedomá odchýlka.**

### Vlna 5 — Density prepínač + a11y dovarenie
- Nastavenia → Vzhľad: segmented `Pohodlné / Cozy / Kompaktné` stampujúci
  `data-density` na `:root` (Aura má rovnaké tri škály).
- Prejsť kontrast na `--muted` v dark bloku (Aura si to pri audite musela
  stmaviť z `#5e7270` na `#566964`, Hades zdedil svetlejšiu hodnotu).
- `prefers-reduced-motion`: vypnúť rise/glow animácie aj na canvase (dnes ich
  vypína len časť chrome).

---

## 4. Poradie a rozsah

| Vlna | Súbory | Rozsah | Riziko |
|---|---|---|---|
| 1 Token bridge | mind.css (`:root` + dark blok) | ~80 riadkov, iba pridanie | žiadne |
| 2 Grafy | charts.js, mind.css | ~150 riadkov | nízke (izolované) |
| 3 Anatómia | mind.css, mind.js (Dnes render) | ~300 riadkov | stredné — treba vizuálny preklik |
| 4 Navigácia | mind.blade.php, mind.css, mind.js | ~200 riadkov | stredné |
| 5 Density + a11y | mind.css, mind.js (Nastavenia) | ~120 riadkov | nízke |

Vlny 1–2 sú `/quick` veľkosti a dajú sa spraviť za jeden beh. Vlny 3–4 sú
`/sprint` (kontrakt + odhad spendu + vizuálne overenie v prehliadači, screenshot
do reportu). Vlna 5 je `/quick` na konci.

## 5. Čo som vedome nenavrhol

- **Nemeniť farebné hodnoty.** Hades už má Aura paletu; každý ďalší „ladenie
  odtieňa" by len rozišiel dve appky.
- **Neprepisovať Hades tokeny na Aura názvy.** Aliasy stačia a nerozbijú 3340
  riadkov CSS ani JS, ktorý číta `--accent-rgb`.
- **Nemigrovať na lucide ikony ani na React.** Hades je vanilla SPA nad canvasom;
  parita je o tokenoch a rytme, nie o stacku.
- **Neriešiť `--aurora` gradient.** Aura ho reálne retirovala (`.aurora-text`
  dnes = plain gold), takže preberať ho by bolo kopírovanie mŕtveho kódu.

## 6. Otvorené rozhodnutie pre vlastníka

Vlna 4 mení muscle memory (rail sa rozšíri, active stav zo teal na zlatý).
Ak chceš rail nechať tak ako je, vlny 1–3 + 5 dávajú ~80 % parity samé.
