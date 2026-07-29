# HANDOFF — Aura dizajn systém pre HTML zobrazenia a nové appky

Prenositeľná špecifikácia. Kto dostane tento dokument, postaví HTML stránku,
report alebo celú appku, ktorá vyzerá ako súčasť Aura ekosystému — bez toho, aby
otváral akýkoľvek iný repozitár.

**Zdroj pravdy:** `C:\Aura\sperky-ai\src\app\globals.css` (Aura Marketing).
Hodnoty nižšie sú z neho odpísané 1:1, vrátane a11y korekcií, ktoré vznikli
kontrastným auditom — **neladiť ich „od oka", inak sa appky rozídu.**

Použitie podľa cieľa:
- **jednorazový HTML report / náhľad** → §1 tokeny + §2 anatómia + §4 komponenty, všetko inline v jednom `<style>`
- **nová appka** → celé §1–§7 ako `styles.css` + §8 checklist pred odovzdaním
- **existujúca appka, ktorú ladíme do parity** → §9 postup migrácie

---

## 1. Token blok (copy-paste, nemeniť hodnoty)

```css
:root {
  /* ---- surfaces (warm paper, nie čistá biela/čierna) ---- */
  --bg: #f8f4f7;
  --panel: #ffffff;
  --panel2: #fbf7f9;

  /* ---- ink ramp ---- */
  --ink: #101d1b;
  --ink2: #2d3a38;
  --muted: #566964;      /* AA ≈5,8:1 na paneli — NEZOSVETLOVAŤ */
  --border: #e6dee3;
  --border2: #d4dce3;

  /* ---- teal accent = interaktivita ---- */
  --accent: #03797e;     /* AA na --bg pre malý text/linky */
  --accent2: #05bcc4;
  --accent-soft: #d6f5f6;
  --accent-tint: #eef9f9;
  --accent-rgb: 3, 121, 126;
  --on-accent: #ffffff;

  /* ---- gold = brand a „si tu" moment, NIE interaktivita ---- */
  --gold: #b88a3a;              /* dekoratívne fills/borders */
  --brand-gold: #d8b878;        /* koruna/logo — rovnaké v light aj dark */
  --brand-gold-rgb: 216, 184, 120;
  --gold-text: #8a6417;         /* zlatý TEXT v light (brand-gold je ~1,9:1 = nečitateľný) */
  --gold-soft: #ead7b0;
  --on-gold: #1a1410;           /* text NA zlatom — tmavý v oboch témach */

  /* ---- semantika ---- */
  --success: #0f8c5a;  --success-bg: #e6f5ec;  --success-rgb: 15, 140, 90;
  --warn:    #d97706;  --warn-bg:    #fdf0e3;  --warn-rgb: 217, 119, 6;
  --error:   #d64545;  --danger-bg:  #fde8e8;  --error-rgb: 214, 69, 69;
  --danger: var(--error);
  --danger-bg-hover: #fdf2f2;
  --rose: #d8a9a0;
  --ink-rgb: 16, 29, 27;

  /* ---- grafová paleta (kategoriálna, 8 hodnôt) ---- */
  --chart-1: #d8b878;  /* brand gold  — PRVÁ séria = „my" */
  --chart-2: #05bcc4;  /* accent teal — DRUHÁ séria = konkurent/porovnanie */
  --chart-3: #6f86d6;  /* periwinkle */
  --chart-4: #e0857b;  /* coral rose */
  --chart-5: #6ec6a4;  /* mint */
  --chart-6: #c08adb;  /* orchid */
  --chart-7: #e0a850;  /* amber */
  --chart-8: #5b9bd5;  /* sky */
  --chart-gold: var(--chart-1);
  --chart-accent: var(--chart-2);

  /* ---- výšky grafov (viewport-aware, aby hlavný graf sadol do 1. foldu) ---- */
  --chart-h:    clamp(220px, 34vh, 380px);
  --chart-h-sm: clamp(180px, 28vh, 300px);
  --chart-h-lg: clamp(240px, 38vh, 420px);

  /* ---- hustota (default = COZY) ---- */
  --card-pad: 14px;        --card-radius: 12px;
  --kpi-pad: 14px;         --kpi-pad-accent: 16px;
  --kpi-value: 24px;       --kpi-value-accent: 28px;
  --kpi-pad-sm: 10px;      --kpi-value-sm: 16px;
  --section-gap: 14px;     --grid-gap: 16px;
  --row-pad-y: 8px;        --row-pad-x: 16px;
  --control-h: 32px;       --page-h1: 30px;
  --gap-xs: 4px;           --gap-sm: 6px;
  --chip-pad-y: 5px;       --chip-pad-x: 11px;
  --tab-gap: 3px;          --control-gap: 8px;

  /* ---- elevácia / radius / typ / motion ---- */
  --shadow-sm: 0 1px 2px rgba(15,40,38,.05);
  --shadow-md: 0 1px 2px rgba(15,40,38,.05), 0 8px 24px -14px rgba(15,40,38,.12);
  --shadow-lg: 0 4px 12px rgba(15,40,38,.08), 0 18px 40px -18px rgba(15,40,38,.22);
  --shadow-pop: 0 8px 24px -10px rgba(15,40,38,.22);   /* menu, tooltip, drawer */
  --shadow-gold: 0 1px 2px rgba(15,40,38,.05), 0 14px 32px -16px rgba(var(--brand-gold-rgb),.35);

  --radius-sm: 8px;    /* buttony, inputy */
  --radius-md: 10px;   /* menu, tooltip, nav, taby */
  --radius-pill: 999px;
  --thumb-radius: 6px;

  --text-xs: 11px;  --text-sm: 12px;  --text-md: 13px;
  --type-small: 12px; --type-body: 13px; --type-label: 14px;
  --heading-4: 15px; --heading-3: 17px; --heading-2: 20px; --heading-1: 24px;

  --transition: .18s cubic-bezier(.16, 1, .3, 1);
  --transition-fast: .12s ease;
  --focus-ring: 0 0 0 2px var(--accent);
  --topbar-blur: 12px;

  accent-color: var(--accent);
}

/* ---- DARK (stampni data-theme="dark" na <html>) ---- */
[data-theme="dark"] {
  --bg: #0e1413;
  --panel: #161f1d;
  --panel2: #1b2624;
  --ink: #eaf3f1;
  --ink2: #c3d1ce;
  --muted: #8a9b98;
  --border: #27332f;
  --border2: #33433e;
  --accent: #05bcc4;
  --accent2: #4dd9df;
  --accent-soft: #0a3a3c;
  --accent-tint: #0d2a2b;
  --gold: #d8b878;
  --gold-soft: #5a4a2e;
  --gold-text: #d8b878;   /* v dark je svetlá zlatá čitateľná */
  --rose: #e3b5ac;
  --warn: #e8912f;   --warn-bg:    rgba(232,145,47,.16);   --warn-rgb: 232, 145, 47;
  --error: #e26464;  --danger-bg:  rgba(226,100,100,.16);  --error-rgb: 226, 100, 100;
  --success: #2fae74; --success-bg: rgba(47,174,116,.16);  --success-rgb: 47, 174, 116;
  --danger-bg-hover: rgba(226,100,100,.12);
  --accent-rgb: 5, 188, 196;
  --gold-rgb: 216, 184, 120;
  --ink-rgb: 234, 243, 241;
  --topbar-blur: 16px;
  --chart-1: #d8b878;  /* gold ostáva */
  --chart-2: #4dd9df;  /* jasnejší teal na tmavom paneli */
  --chart-3: #8a9cf0;  --chart-4: #ec988f;  --chart-5: #7fd6b4;
  --chart-6: #d29ff0;  --chart-7: #ecba6c;  --chart-8: #74b0e8;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.3);
  --shadow-md: 0 1px 2px rgba(0,0,0,.3), 0 12px 30px -16px rgba(0,0,0,.55);
  --shadow-lg: 0 4px 12px rgba(0,0,0,.4), 0 20px 44px -20px rgba(0,0,0,.65);
  --shadow-pop: 0 10px 28px -12px rgba(0,0,0,.6);
  --shadow-gold: 0 1px 2px rgba(0,0,0,.3), 0 16px 38px -18px rgba(0,0,0,.6);
  color-scheme: dark;
}
```

### Voliteľné škály hustoty
```css
[data-density="comfortable"] { --card-pad:20px; --card-radius:18px; --kpi-pad:18px;
  --kpi-pad-accent:22px; --kpi-value:26px; --kpi-value-accent:32px; --kpi-pad-sm:12px;
  --kpi-value-sm:18px; --section-gap:22px; --row-pad-y:12px; --row-pad-x:22px;
  --control-h:38px; --page-h1:42px; --grid-gap:22px; --gap-xs:5px; --gap-sm:8px;
  --chip-pad-y:6px; --chip-pad-x:13px; --tab-gap:4px; --control-gap:10px; }

[data-density="compact"] { --card-pad:10px; --card-radius:10px; --kpi-pad:11px;
  --kpi-pad-accent:12px; --kpi-value:22px; --kpi-value-accent:26px; --kpi-pad-sm:8px;
  --kpi-value-sm:15px; --section-gap:10px; --row-pad-y:5px; --row-pad-x:12px;
  --control-h:28px; --page-h1:22px; --grid-gap:12px; --gap-xs:3px; --gap-sm:5px;
  --chip-pad-y:4px; --chip-pad-x:9px; --tab-gap:2px; --control-gap:6px; }
```

**Železné pravidlo:** mimo `:root` a `[data-theme="dark"]` nesmie byť žiadny
raw hex ani rgba. Ak niečo potrebuješ tónovať, použi
`color-mix(in srgb, var(--token) N%, transparent)`.

---

## 2. Anatómia stránky

Každá obrazovka má rovnaký rytmus zhora dole:

```
┌ topbar (sticky, backdrop-filter: blur(var(--topbar-blur)))
├ .page-stack ─────────────────────────────────────────────
│   .eyebrow            ← 11px, uppercase, ls .12em, --muted
│   h1.display          ← --page-h1, weight 600, ls -.01em, tabular-nums
│   .kpi-grid           ← 4 dlaždice, hero span 2
│   .card               ← hlavný graf, výška --chart-h
│   .grid-2 > .card     ← dva sekundárne grafy (--chart-h-sm)
│   .card > .tbl        ← detailná tabuľka
└──────────────────────────────────────────────────────────
```

```css
.page-stack { display: flex; flex-direction: column; gap: var(--section-gap); }
.kpi-grid { display: grid; grid-template-columns: repeat(var(--kpi-cols, 4), 1fr);
            gap: var(--grid-gap); grid-auto-flow: dense; }
.kpi-grid > .kpi-hero { grid-column: span var(--hero-span, 2); }
@media (max-width: 1100px) { .kpi-grid { grid-template-columns: repeat(2,1fr); }
                             .kpi-grid > .kpi-hero { grid-column: span 2; } }
@media (max-width: 700px)  { .kpi-grid { grid-template-columns: 1fr; }
                             .kpi-grid > .kpi-hero { grid-column: auto; } }
@media (max-width: 900px)  { main { padding: 20px 14px !important; } }
@media (max-width: 760px)  { :root { --control-h: 38px; }   /* touch targety */
                             main { padding: 14px 10px !important; }
                             h1.display { font-size: 26px !important; } }
```

Poradie informácií je zámerné: **agregát → trend → rozpad → riadky.** Kto číta
prvý fold, má odpoveď; kto potrebuje dôkaz, scrolluje.

---

## 3. Typografia

| Rola | Font | Veľkosť | Poznámka |
|---|---|---|---|
| `h1.display` | Geist 600 | `--page-h1` | `letter-spacing: -.01em`, `tabular-nums` |
| `.italic-display` | Playfair Display italic 600 | dedí | brand fragment v titulku, farba `--gold-text` |
| `.eyebrow` | Geist 700 | `--text-xs` | uppercase, `letter-spacing: .12em`, `--muted` |
| body / control | Geist 400–500 | `--type-body` 13px | |
| `.meta` | Geist | `--text-xs` | `letter-spacing: .04em`, `--muted` |
| `.mono` / `.tnum` | Geist Mono / dedí | | `font-variant-numeric: tabular-nums` |

```css
@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@1,600&display=swap");
body { font-family: "Geist", system-ui, -apple-system, "Segoe UI", sans-serif;
       -webkit-font-smoothing: antialiased; background: var(--bg); color: var(--ink); }
```

**Každé číslo v tabuľke a v KPI dostane `.tnum`.** Bez tabular-nums sa číslice
nezarovnajú v stĺpci a tabuľka vyzerá rozhodená.

---

## 4. Komponenty (recepty)

```css
/* ---- surfaces ---- */
.card       { background: var(--panel);  border: 1px solid var(--border);
              border-radius: var(--card-radius); box-shadow: var(--shadow-sm); }
.card-soft  { background: var(--panel2); border: 1px solid var(--border);
              border-radius: var(--card-radius); }                  /* inset, bez tiene */
.card-elevated { box-shadow: var(--shadow-md); }
.card-overlay  { box-shadow: var(--shadow-pop); }                   /* menu/drawer */
.card-hover { transition: transform var(--transition), box-shadow var(--transition), border-color .18s; }
.card-hover:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }

/* ---- buttony ---- */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:7px;
       font: 500 13px/1 inherit; letter-spacing:-.005em; padding:9px 14px;
       min-height: var(--control-h); border:1px solid transparent;
       border-radius: var(--radius-sm); cursor:pointer; white-space:nowrap;
       transition: all var(--transition); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity:.55; cursor:not-allowed; }
.btn-primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.btn-primary:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px);
       box-shadow: 0 4px 10px -3px rgba(var(--accent-rgb), .35); }
.btn-gold    { background: var(--brand-gold); color: var(--on-gold); border-color: var(--brand-gold); }
.btn-outline { background: var(--panel); color: var(--ink); border-color: var(--border2); }
.btn-outline:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-tint); transform: translateY(-1px); }
.btn-ghost   { background: transparent; color: var(--ink2); }
.btn-ghost:hover:not(:disabled) { background: rgba(var(--ink-rgb), .05); }
.btn-danger  { background: var(--panel); color: var(--danger); border-color: var(--border2); }
.btn-danger:hover:not(:disabled) { background: var(--danger-bg-hover); border-color: var(--danger); }
.btn-sm { min-height:32px; padding:7px 12px; font-size:12px; }
.btn-xs { min-height:26px; padding:5px 10px; font-size:11px; }

/* ---- pilulky (stavy) ---- */
.pill { display:inline-flex; align-items:center; gap:4px; padding:2px 8px;
        border-radius: var(--radius-pill); font-size: var(--text-xs);
        letter-spacing:.06em; text-transform:uppercase; }
.pill-positive { background: var(--success-bg); color: var(--success); }
.pill-negative { background: var(--danger-bg);  color: var(--danger); }
.pill-warning  { background: var(--warn-bg);    color: var(--warn); }
.pill-accent   { background: var(--accent-tint); color: var(--accent); }
.pill-neutral  { background: var(--panel2);      color: var(--muted); }
.pill-gold     { background: color-mix(in srgb, var(--brand-gold) 14%, transparent); color: var(--gold-text); }

/* ---- ľavá navigácia ---- */
.nav-side { display:flex; align-items:center; gap:10px; padding:7px 11px; width:100%;
            border:1px solid transparent; border-radius: var(--radius-md);
            font-size: var(--text-md); font-weight:500; color: var(--ink2);
            text-align:left; white-space:nowrap; cursor:pointer;
            transition: background .16s, color .16s, transform .16s; }
.nav-side:hover  { background: var(--accent-tint); color: var(--accent); }   /* teal = interakcia */
.nav-side.active {                                                            /* gold = si tu */
  background: color-mix(in srgb, var(--brand-gold) 12%, var(--panel));
  color: var(--ink); font-weight: 700;
  border-color: color-mix(in srgb, var(--brand-gold) 24%, transparent);
  box-shadow: var(--shadow-sm), inset 3px 0 0 var(--brand-gold); }
.nav-side.active:hover { background: color-mix(in srgb, var(--brand-gold) 16%, var(--panel)); color: var(--ink); }

/* ---- fokus a selekcia (globálne, nikdy nevypínať outline bez náhrady) ---- */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
::selection { background: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--ink); }

/* ---- skeleton ---- */
@keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
.skeleton { background: linear-gradient(90deg, var(--panel2) 25%, var(--border) 37%, var(--panel2) 63%);
            background-size: 200% 100%; animation: shimmer 1.2s linear infinite;
            border-radius: var(--radius-sm); }
```

**Farebná gramatika — jediné pravidlo, ktoré sa nesmie porušiť:**
teal = *dá sa s tým interagovať*, zlatá = *toto je brand alebo si práve tu*,
semantické farby = *stav dát*. Zlatý button existuje (`.btn-gold`), ale je to
jeden hero CTA na obrazovku, nie bežná akcia.

---

## 5. Grafy (dataviz kontrakt)

1. **Séria 1 = `--chart-gold`** (naše dáta), **séria 2 = `--chart-accent`**
   (porovnanie/konkurent), ďalej `--chart-3..8` v poradí.
2. Výplň plochy pod líniou = `color-mix(in srgb, var(--chart-N) 14%, transparent)`,
   nikdy plná farba.
3. Výška zvonku: hlavný graf `--chart-h`, sekundárny `--chart-h-sm`, hero `--chart-h-lg`.
   Numerický override je povolený len pre mini drill-down grafy.
4. Farby čítať runtime z CSS premenných, nie hardcodovať:
   ```js
   const cssVar = (n, fb) =>
     (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || fb;
   ```
   Tým je graf theme-aware zdarma (prepnutie `data-theme` = správne farby bez re-renderu logiky).
5. **Ak appka drží JS fallback paletu, musí na ňu existovať drift test** proti
   `:root`. V Aure sa práve tu rozišiel light fallback s tokenmi a chytil to až test.
6. Osi a mriežka: `--border` pre linky, `--muted` pre labely, žiadne gradienty,
   žiadne 3D, žiadne tiene na dátových prvkoch (tiene sú pre panely).
7. Sekvenčný ramp (heatmapy) derivovať z jednej farby cez `color-mix` 5 krokmi,
   nie ručne vyberanými odtieňmi.
8. Klikacie tvary grafu dostávajú `cursor: pointer` + `:focus-visible` ring.

---

## 6. Pohyb

```css
@keyframes fadeUp { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important;
                           transition-duration:.01ms !important; scroll-behavior:auto !important; }
}
```
- Vstupy sekcií: `fadeUp` s stagger `i % 3 * 90ms` (IntersectionObserver).
- Hover lift: `translateY(-1px)`, nikdy viac.
- Trvanie: `--transition` na všetko interaktívne, `--transition-fast` na hover farby.
- `prefers-reduced-motion` musí vypnúť aj canvas/WebGL animácie, nielen CSS.

---

## 7. Prístupnosť (nezjednávateľné)

- Kontrast: `--muted` je najsvetlejší povolený text. Zlatý text = `--gold-text`,
  nikdy `--brand-gold` na svetlom podklade (1,9:1).
- Každý interaktívny prvok má `:focus-visible` ring; `outline: none` len s náhradou.
- Touch targety ≥ 38px pod 760px (`--control-h` sa tam prepína).
- Stav nesmie byť oznámený len farbou — pilulka má vždy aj text.
- Live regióny (`aria-live="polite"`) na toasty, počítadlá a stavové chipy.
- SK texty v UI, EN názvy v kóde a triedach.

---

## 8. Checklist pred odovzdaním

- [ ] `grep -E '#[0-9a-fA-F]{3,6}|rgba?\('` mimo `:root`/`[data-theme]` nevracia nič
- [ ] Prepnutie `data-theme="dark"` nerozbije žiadnu obrazovku (preklik všetkých)
- [ ] Všetky tri `data-density` škály držia layout
- [ ] Grafy majú farby z `--chart-*`, výšky z `--chart-h*`
- [ ] Čísla majú `.tnum`
- [ ] Aktívna navigácia je zlatá, hover teal
- [ ] Tab-om sa dá prejsť celá stránka a ring je vždy vidno
- [ ] 390px šírka: žiadny horizontálny scroll
- [ ] `prefers-reduced-motion` zastaví všetko
- [ ] Vizuálne overené v prehliadači + screenshot v reporte

---

## 9. Migrácia existujúcej appky do parity

Osvedčené poradie (z prípadu Hades/AI-mind, kde už farebné jadro sedelo, ale
štruktúra nie):

1. **Token bridge** — do `:root` len *pridať* Aura-menované aliasy nad existujúce
   tokeny (`--panel2: var(--surface-2)` atď.) + doplniť chýbajúce skupiny
   (`--chart-*`, density, `--chart-h*`, shadows, transitions). Žiadne existujúce
   pravidlo sa nemení → nulové riziko regresie. **Toto samo dá najväčší efekt.**
2. **Grafy** na `--chart-*` + jeden theme objekt + drift test + `.tnum`.
3. **Anatómia** — `.page-stack`, `.eyebrow`, zlúčiť duplicitné KPI mriežky do
   jednej `.kpi-grid`, dashboard prerovnať na rytmus z §2.
4. **Navigácia** — pomenované grupy s eyebrow labelmi, collapse persistovaný
   v `localStorage`, active stav na zlatý recept.
5. **Density prepínač + a11y dovarenie** (kontrast, reduced-motion na canvas).

Kroky 1–2 sú `/quick`. Kroky 3–4 sú `/sprint` (kontrakt + odhad + vizuálny
preklik). Krok 5 je `/quick` na konci.

**Nemigrovať:** framework, ikonovú sadu ani `--aurora` gradient (Aura ho reálne
vyradila — `.aurora-text` je dnes plain `--gold-text`). Parita je o tokenoch,
rytme a grafoch, nie o stacku.
