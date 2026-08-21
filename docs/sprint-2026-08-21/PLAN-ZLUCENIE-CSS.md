# Plán zlúčenia `mind.css` × `console.css`

**Dátum:** 21. 8. 2026 · **Vetva:** `feat/hades-ux` · **Agent:** triáž/návrh (nemenil ani riadok produkčného kódu)
**Predmet:** `public/css/mind.css` (**4 607 r.**) × `public/css/console.css` (**1 073 r.**)
**Zdroj nálezov:** `docs/audit/01-design-system.md` (D1–D23), kontrakt `KONTRAKT-UX-APPKA-CHAT-2026-08-21.md` §3/§4

---

## 0. Prvá vec, ktorú musí vykonávateľ vedieť: čísla auditu už NEPLATIA

Audit merial `mind.css` na **4 168 r.** a `console.css` na **818 r.** Dnešné súbory
majú **4 607** a **1 073**. **Ani jedno číslo riadku z auditu nesedí** a časť nálezov
bola medzitým zaplatená. Zmerané dnes skriptom nad aktuálnymi súbormi
(`scratchpad/overlap2.js`, blokový parser s odstránením komentárov):

| | `mind.css` | `console.css` |
|---|---|---|
| riadkov | 4 607 | 1 073 |
| blokov pravidiel | 776 | 162 |
| unikátnych tried | 354 | 88 |
| unikátnych id | 88 | 19 |

**Čo je už hotové — nerob znova:**

- **D2 zaplatené.** `.btn-primary/.btn-ghost/.btn-danger` v `console.css` neexistujú;
  `.pc-btn` používa `button.primary/.ghost/.danger` z `mind.css` (komentár
  `console.css:829–834` to dokumentuje).
- **D1 zaplatené na ~90 %.** Pomenovaný reset chrómu tlačidiel **existuje**
  (`console.css:57–74`, jeden zoznam 12 selektorov). `font: inherit` už nie je 7×
  na tlačidlách, `background: transparent` nie je 9×. Zvyšok merám v §M6 — je to
  **17 riadkov, nie ~200**.
- **D6 polovica zaplatená.** `.sr-only` (`console.css:97–107`) a globálne
  `.console-body :focus-visible` (91–95) existujú — ale **stále len v `console.css`**;
  `mind.css` nemá ani jedno (`grep sr-only public/css/mind.css` = 0 zásahov).
- **D22 tretina zaplatená.** `cursor: default` už nie je na `.pc-btn:disabled`
  ani na `#send:disabled`.
- **D23 zaplatené.** `console.css` má dva `@media (prefers-reduced-motion: reduce)`
  bloky (468–472, 551–555) a používa `--dur-fast`/`--ease` (241, 462).

**Čo audit prehliadol a čo tento plán pridáva:** markdown je nakreslený dvakrát
(§M12), vzor „ozbrojené mazanie" je nakreslený **štyrikrát** (§M10), a
`.tc-val`/`.tc-label`/`.today-card` v `mind.css` sú **mŕtvy kód s nula volajúcimi**
(§M7) — čím sa D7 rieši mazaním, nie premenovaním.

**Kaskádový fakt, ktorý platí pre celý dokument:** `resources/views/console.blade.php:32–33`
načítava **oba** stylesheety, `mind.css` prvý. Pri rovnakej špecificite teda
**`console.css` vyhráva**. Každý „duplikát" je preto buď (a) mŕtvy zápis, alebo
(b) živý prepis, ktorého zmazanie **mení vypočítaný štýl**. Pri každom bode nižšie
je to rozhodnuté a napísané.

---

## 1. Zhrnutie plánu

| # | Nález | Čo zaniká | Čo zostáva | Riadkov (netto) | Call sites | Vypočítaný štýl |
|---|---|---|---|---|---|---|
| M1 | D5 | `console.css:1007` | `mind.css:522` | −1 | 0 | nemení |
| M2 | D6a | — (presun) | `.sr-only` v `mind.css` | 0 | 0 | nemení |
| M3 | D6b | 31 pravidiel v `mind.css` | jedno globálne `:focus-visible` | −23 | 0 | **MENÍ** |
| M4 | D4 | 2 celé + 2 skrátené `kbd` | bare `kbd` v `mind.css` | −16 | 0 | **MENÍ** |
| M5 | D22 | `console.css:846, 929` | `mind.css:704` + `--disabled-opacity` | −2 | 0 | **MENÍ** (mierne) |
| M6 | D1 | 17 r. zbytočného chrómu | reset 57–74 (prestavaný) | −17 | 0 | nemení |
| M7 | D7 | `mind.css:3040–3047` + 3 zoznamy | `.tc-*` konzoly | −11 | 0 | nemení |
| M8 | D9 | `mind.css:2334–2368` | `.kpi-*` | −24 | 4 | **MENÍ VIDITEĽNE** |
| M9 | D11 | `.empty-state` (názov) | `.empty` + `.empty--hero` | −2 | 3 | **MENÍ**, ak sa neprepíše |
| M10 | D12 | `.on` (4 selektory) | `[aria-current]` / `[aria-selected]` | 0 | 2 | nemení |
| M11 | D8 | `console.css:1011–1022` | `mind.css:524–537` | −10 | 0 | **MENÍ** (degenerát) |
| M12 | nový | dvojitý markdown chróm | jedna trojica pravidiel | −10 | 0 | **MENÍ** |
| M13 | D18 + R9 | 5× `820px`, pasca na 445 | `var(--stream-w)` | 0 | 0 | nemení |
| M14 | D21 | 6 raw `px` ikon | `--icon-*` | 0 | 0 | nemení |

**Súčet: 14 zlúčení, netto −116 riadkov CSS, 2 zmazané riadky JS, 9 miest na prepis.**

**Poradie vykonávania (záväzné):** M1 → M2 → M13 → M14 → M6 → M5 → M7 → M10 →
M4 → M11 → M3 → M9 → M12 → M8.
Prvých osem je inertných alebo takmer inertných (dôkaz `cssswap.js`), posledných
šesť mení pixely a každé chce vlastný preklik. **M8 ide posledné**, pretože je to
jediný redizajn, nie zlúčenie.

---

## M1 — `.hidden` je bajt za bajt to isté (D5)

- **Zaniká:** `public/css/console.css:1007` → `.hidden { display: none !important; }`
- **Zostáva:** `public/css/mind.css:522` → `.hidden { display: none !important; }`
- **Presun:** žiadny.
- **HTML/JS:** nič. (`console.blade.php:108, 140` a `tools.js:115` používajú `.hidden` ďalej.)
- **Vypočítaný štýl:** nemení sa. Oba súbory sa načítavajú, druhý zápis dnes nikdy nič nezmení.
- **Riziko:** žiadne.

---

## M2 — `.sr-only` promovať do `mind.css` (D6a)

- **Zaniká:** `console.css:97–107` (11 r.).
- **Zostáva / kam sa presúva:** doslovne, bez zmeny hodnôt, do `mind.css`
  **hneď za `.hidden` (r. 522)** — je to tá istá rodina utilít.
- **HTML/JS:** nič. `console.blade.php:144` (`#run-announce.sr-only`) funguje ďalej.
- **Vypočítaný štýl:** na `/console` sa nemení. Graf **získava** utilitu, ktorú dnes
  nemá vôbec — to je jediná zmena a je aditívna.
- **Riziko:** žiadne. Najlepší pomer efekt/riziko v celom dokumente.

---

## M3 — jedno globálne `:focus-visible` namiesto 31 kópií (D6b)

**Zmerané dnes:** `mind.css` má **54** výskytov `focus-visible` a **41** výskytov
`var(--focus-ring)`. Z toho je **31 pravidiel znak po znaku identických**
(`{ outline: none; box-shadow: var(--focus-ring); }`):

```
675, 703, 901, 1001, 1244, 1334, 1367, 1416, 1487, 1544, 1618, 1750, 1761,
1854, 2558, 2771, 2940, 2956, 3068, 3125, 3162, 3247, 3332, 3441, 3602,
3886, 3930, 3955, 4341, 4373, 4427
```

- **Zaniká:** tých 31 pravidiel v `mind.css` a `console.css:91–95`
  (`.console-body :focus-visible`).
- **Zostáva / kam sa presúva:** do `mind.css` **pred sekciu `RESET & BASE` (r. 500)**
  jedno pravidlo so **selektorom `:focus-visible` (špecificita 0,1,0)**:
  ```
  :focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-sm); }
  ```
  Nízka špecificita je zámer: každé zvyšné, špecifickejšie pravidlo (napr.
  `#brand-core:focus-visible` s `--r-md`) ho ďalej prebíja bez zásahu.
- **HTML/JS:** nič.
- **Vypočítaný štýl: MENÍ SA a je to najväčšie riziko tohto plánu.** Bare
  `:focus-visible` chytí **každý** fokusovateľný prvok, teda aj tie, ktoré dnes
  prsteň zámerne nemajú. Zmerané výnimky, ktoré treba **explicitne vypnúť**
  (`box-shadow: none`), inak je to regresia:

  | Miesto | Dnešný stav | Čo urobí globálne pravidlo |
  |---|---|---|
  | `mind.css:1187` `input[type="range"]:focus-visible` | len `outline: none`, prsteň nesie **thumb** (1188–1189) | pridá druhý prsteň okolo celého slidera |
  | `mind.css:3024` `.cmdk-item` | `background: --accent-softer`, `outline: none` | pridá prsteň k podfarbeniu (dva signály) |
  | `mind.css:3084` `.today-item` | to isté | to isté |
  | `console.css:884` `#composer #prompt:focus-visible` | `box-shadow: none` (fokus nesie rámik riadku) | už vypnuté, **ponechať** |

  Ďalej: odkazy v markdowne (`.md-body a`, `.bubble.md a`) prsteň **získajú**.
  Je to zlepšenie prístupnosti, ale **je to zmena pixelov** a patrí do reportu,
  nie do kolónky „inertné".
- **Riziko:** stredné. Postup: (1) pridaj globálne pravidlo, (2) pridaj 3 výnimky,
  (3) až potom maž tých 31, (4) `cssswap.js` nad tým istým DOM na obrazovke Graf
  aj na `/console`, (5) klávesnicový preklik `Tab` po raile, hlavičke, composeri
  a karte potvrdenia.

**Ponechať bez zmeny (majú vlastný recept, nie sú duplikát):** 748, 809, 1123,
1188–1189, 2601, 2646, 2753, 2784, 2816, 3117, 3158, 3187, 3220, 3328, 3437, 3882.

---

## M4 — jeden `kbd` namiesto piatich (D4)

**Zmerané dnes** (audit hlásil 5 verzií / 4 hodnoty; dnes to platí, riadky sú iné):

| Kde | padding | radius | veľkosť | pozadie | rozmer |
|---|---|---|---|---|---|
| `console.css:109–118` (bare `kbd`) | `1px 5px` | `--r-sm` | `--fs-micro` | `--surface-2` | — |
| `mind.css:1922–1932` `.key-row kbd` | `0 6px` | `--r-sm` | `--fs-small` | `--surface-2` | `22×22` |
| `mind.css:2958–2964` `#cmdk-trigger kbd` | `1px 5px` | **raw `5px`** | `--fs-micro` | **`--panel-solid`** | — |
| `mind.css:3001–3007` `.cmdk-input-row kbd` | `1px 6px` | **raw `5px`** | `--fs-micro` | `--surface-2` | — |
| `mind.css:4031–4039` `.kbd-hints kbd` | `0 5px` | `--r-sm` | `--fs-caption` | `--surface-2` | `20×20` |

- **Zaniká:**
  - `mind.css:2958–2964` celé (7 r.) — po presune základu ho nič neodlišuje.
  - `mind.css:3001–3007` celé (7 r.) — to isté.
  - `mind.css:571` (`.key-row kbd` v skupine mono/tabular-nums) — základ už dáva
    `font-family: var(--mono)`, riadok je potom zbytočný (−1 r.).
  - z `mind.css:1922–1932` zaniká `padding`, `background`, `border`, `border-radius`,
    `color` (−6 r.); zostáva `display/align/justify`, `min-width`, `height`,
    `font-weight`, `font-size`.
  - z `mind.css:4031–4039` zaniká `background`, `border`, `border-radius`,
    `font-family`, `color` (−5 r.); zostáva `display/align/justify`, `min-width`,
    `height`, `padding`, `font-size`.
- **Zostáva / kam sa presúva:** `console.css:109–118` doslovne do `mind.css`
  **do sekcie `RESET & BASE`, hneď za `.ms` (r. 537)** — je to bare element selector
  a patrí k ostatným. V `console.css` **musí zmiznúť odtiaľ**, nie vzniknúť druhýkrát tam.
- **HTML/JS:** nič.
- **Vypočítaný štýl: MENÍ SA na dvoch miestach a je to dobrovoľné zjednotenie:**
  - `#cmdk-trigger kbd`: pozadie `--panel-solid` → `--surface-2`, radius `5px` → `8px`.
  - `.cmdk-input-row kbd`: padding `1px 6px` → `1px 5px`, radius `5px` → `8px`.
  - `.pc-btn kbd` (`console.css:845`) dnes prepisuje `background: transparent` a
    `border-color` — po presune základu funguje **rovnako**, nechať.
- **Zisk navyše:** tri raw `5px` radiusy z `mind.css` zmiznú
  (`grep -E "border-radius: *[0-9]+px" public/css/mind.css` klesne zo 7 na 4;
  zvyšné 4 sú `2px` hairline a `4px` scrollbar, tie nie sú stupne škály).
- **Riziko:** nízke. Preklik: `Cmd-K` trigger v hlavičke, `Cmd-K` paleta,
  `?` overlay (`.key-row`), obrazovka Kontrola (`.kbd-hints`), karta potvrdenia na `/console`.

---

## M5 — jedna hodnota pre `disabled` (D22)

**Zmerané dnes** (`grep -n disabled` v oboch súboroch):

| Miesto | Hodnota | Stav |
|---|---|---|
| `mind.css:704` `button:disabled` | `.45` + `cursor: not-allowed` + `pointer-events: none` | základ |
| `mind.css:1129` `input/textarea:disabled` | `.5` | iná rola (pole) |
| `mind.css:1190` `input[type=range]:disabled` | `.5` | iná rola |
| `mind.css:1488` `.sug-add:disabled` | `.5` | duplikát základu |
| `mind.css:1545` `#zoomctl button:disabled` | `.4` | duplikát základu |
| `console.css:846` `.pc-btn:disabled` | `.5` | **duplikát základu** |
| `console.css:929` `#send:disabled` | `.45` | **presne základ, teda mŕtve** |
| `console.css:784` `.perm-card.denied` | `.72` | **iná rola** (rozhodnuté, nie zakázané) |

- **Zaniká:** `console.css:929` (mŕtve, `.45` = základ) a `console.css:846`
  (`.5` → zdedí `.45`).
- **Zostáva:** `mind.css:704` ako jediný zdroj pre tlačidlá.
- **Presun:** do `:root` pridať `--disabled-opacity: .45;` a použiť ho na
  `mind.css:704`. **Nič viac.** `.5` na poliach, `.4` na zoome a `.72` na
  `.perm-card.denied` sú **pomenované iné roly** — ich zlúčenie by bolo vizuálna
  zmena bez zisku a plán ju nenavrhuje.
- **HTML/JS:** nič.
- **Vypočítaný štýl:** `.pc-btn:disabled` `.5` → `.45`. Merateľné, oku takmer
  neviditeľné; treba to napísať, nie zamlčať.
- **Oprava tvrdenia auditu:** audit píše, že `cursor: default` je na oboch miestach
  inertné vďaka `pointer-events: none`. Dnes zostal **jeden** taký riadok —
  `console.css:421` `#model-select:disabled { color: var(--muted); cursor: default; }`
  — a **tam inertný NIE JE**: `<select>` nie je `<button>`, `mind.css:704` sa ho
  netýka a `mind.css` nemá žiadne pravidlo pre `select:disabled`
  (jeho select pravidlá sú scoped na `#node-form`/`.dept-actions`, r. 2633). **Nechať.**
- **Riziko:** žiadne až nízke.

---

## M6 — D1: čo z chrómu ovládacích prvkov je dnes naozaj zbytočné

Audit hlásil „~200 z 818 riadkov". **To už nie je pravda** — pomenovaný reset
(`console.css:57–74`) tú prácu odviedol. Zvyšok som premeral deklaráciu po
deklarácii proti `mind.css:681–700` (`button {}`). Rozdeľuje sa na tri druhy.

### (a) 12 riadkov, ktoré sú hodnota za hodnotou to isté — zmazať, je to inertné

| Riadok | Deklarácia | Prebíja to isté z |
|---|---|---|
| `console.css:73` | `cursor: pointer` (v resete) | `mind.css:695` pre `button`, UA pre `a[href]` |
| `console.css:668` | `align-items: center` (`.tc-head`) | `mind.css:692` |
| `console.css:669` | `gap: var(--sp-1)` (`.tc-head`) | `mind.css:694` |
| `console.css:836` | `display: inline-flex` (`.pc-btn`) | `mind.css:691` |
| `console.css:837` | `align-items: center` (`.pc-btn`) | `mind.css:692` |
| `console.css:918` | `display: inline-flex` (`#send, #stop`) | `mind.css:691` |
| `console.css:919` | `align-items: center` | `mind.css:692` |
| `console.css:920` | `justify-content: center` | `mind.css:693` |
| `console.css:947` | `display: inline-flex` (`#to-bottom`) | `mind.css:691` |
| `console.css:948` | `align-items: center` | `mind.css:692` |
| `console.css:949` | `justify-content: center` | `mind.css:693` |
| `console.css:1007` | `.hidden` | viď M1 |

Všetkých 12 selektorov resetu je `<button>` alebo `<a>` — overené:
`main.js:376` `.rail-retry`, `main.js:119` `.tr-open`, `main.js:158` `.tr-act`,
`tools.js:102` `.tc-head`, `tools.js:270` `.tc-more`, `tools.js:387` `.pc-btn`,
`console.blade.php:42` `.rail-top a`, `:68` `#rail-toggle`, `:108` `#to-bottom`.
Základ `button {}` na nich teda naozaj platí.

### (b) 2 riadky, ktoré sú dnes inertné a ich „oprava" je rozhodnutie, nie úklid

`console.css:923` (`#send, #stop { height: 30px }`) a `console.css:951`
(`#to-bottom { height: 30px }`). `mind.css:687` dáva každému `<button>`
`min-height: 32px` a **`min-height` prebíja `height`** — tie prvky sú dnes
**32 px vysoké, nie 30**. `#to-bottom` teda nie je kruh, ale 30×32 pilulka.

Dve cesty, obe legitímne — **vyber jednu a napíš to do reportu:**
1. **Zmazať `height: 30px`** (−2 r.) — vizuálne inertné, ale ostane rozdiel
   medzi deklarovaným zámerom a skutočnosťou.
2. **Dopísať `min-height: 0`** (+2 r.) — ovládacie prvky **skutočne** klesnú na
   30 px. To je viditeľná zmena a je to práve ten `--control-h` konflikt, ktorý
   audit menoval (32 vs 30). Ak sa ide touto cestou, patrí to k density tokenom
   vlny B, nie sem.

Plán odporúča **(1)** teraz a `--control-h` riešiť naraz s density prepínačom.

### (c) 6 riadkov „zruš a vráť to isté" — prestavba resetu

Reset (`console.css:70`) dáva `border: 0` všetkým dvanástim selektorom. Šesť blokov
potom **vráti presne `1px solid var(--border)`**, teda hodnotu, ktorú `mind.css:684`
dával už predtým: `console.css:145` (`.rail-top a/button`), `319` (`.rail-retry`),
`385` (`#rail-toggle`), `748` (`.tc-more`), `840` (`.pc-btn`), `952` (`#to-bottom`).

- **Zaniká:** tých 6 riadkov `border: 1px solid var(--border)`.
- **Zostáva / presun:** reset `console.css:57–74` sa rozdelí na **dva zoznamy** —
  jeden **bez** `border: 0` (pre tie šesť; `.tr-act` tiež, dáva si
  `1px solid transparent` sám) a jeden **s** `border: 0`
  (`.tr-open`, `.tc-head`, `#send`, `#stop`).
  Netto **−6 +3 = −3 riadky** a reset prestane lhať o tom, čo robí.
- **Vypočítaný štýl:** nemení sa v ani jednom prípade (kontrolovať `cssswap.js`).

### Čo z D1 vyzerá ako duplikát a NIE JE — nesiahať

- **`font: inherit` v resete (`console.css:72`) + `font-size: var(--fs-body)`
  v štyroch blokoch** (147, 218, 672, 842). Vyzerá to ako „zruš a vráť". Nie je:
  `font: inherit` resetuje aj `font-weight` (`--fw-medium` → `--fw-regular`) **aj
  `line-height`** (UA `normal` → dedené `--lh-*`). Zámena `font: inherit` za
  `font-weight: var(--fw-regular)` by vrátila `line-height: normal` a **posunula
  výšku každého tlačidla konzoly**. **WONTFIX** — ponechať a dopísať k tomu vetu.
- **`font: inherit` / `border: 0` / `background: transparent` na `#thread-find`
  (176–179), `.tr-input` (290), `#model-select` (417), `#composer #prompt`
  (905–908).** Nie sú to tlačidlá: `<input>`/`<textarea>` dostávajú chróm z
  `mind.css:1110–1120`, `<select>` z ničoho (mind má select scoped na
  `#node-form`/`.dept-actions`, r. 2633). Tieto resety sú **nutné**. Nechať.

**Súčet M6: −17 riadkov, 0 call sites, vypočítaný štýl sa nemení.**

---

## M7 — prefix `.tc-` (D7): rieši sa MAZANÍM, nie premenovaním

**Zmerané dnes.** `mind.css` má `.tc-val` (3043–3046) a `.tc-label` (3047),
`console.css` má osem `.tc-*` (`.tc-head`, `.tc-caret`, `.tc-name`, `.tc-args`,
`.tc-state`, `.tc-body`, `.tc-result`, `.tc-more`). Suffixy sa nekrížia, kolízia
**nie je aktívna** — presne ako píše audit.

**Ale:** `grep -rn "tc-val\|tc-label"` po celom repe (mimo `.css`, `vendor`,
`node_modules`, worktrees) = **0 zásahov**. To isté pre `.today-card` — používa sa
len `.today-card-link` (`dnes.js:386`) a `.today-card-wrap` (`dnes.js:385`).
**Celá trojica je mŕtvy kód.**

- **Zaniká:**
  - `mind.css:3040–3047` (`.today-card`, `.tc-val`, `.tc-label`) — 8 r.
  - `.today-card,` zo troch zoznamov selektorov: `mind.css:4096`, `4130`, `4152`
    — 3 r. **Pozor: na r. 4153 je `.today-grid > .today-card-wrap`, tú NEMAZAŤ.**
- **Zostáva:** `.tc-*` konzoly bez zmeny. Prefix má potom v appke **jeden význam**.
- **HTML/JS:** nič. Nula call sites.
- **Vypočítaný štýl:** nemení sa (mŕtve pravidlá).
- **Riziko:** nízke, s jednou podmienkou — **`grep` zopakuj tesne pred mazaním**.
  V repe pracuje viac session (`git status` ukazuje rozpracovanú vlnu) a niekto
  mohol `.today-card` medzitým začať používať.
- **Náhradná cesta, ak sa `.today-card` ukáže ako živá:** premenuj konzolové
  `.tc-*` na `.tool-*` (karta sa už menuje `.tool-call`). Cena: `tools.js`
  riadky 102, 109, 111, 112, 113, 115, 185, 196, 219, 220, 221, 248, 270, 301, 302
  — **15 miest v jednom súbore** — a 14 selektorov v `console.css`. Vypočítaný štýl
  sa nemení.

---

## M8 — `.metric-*` → `.kpi-*` (D9, kontrakt §3)

**Zmerané dnes:**

| | `.metric-*` | `.kpi-*` |
|---|---|---|
| CSS | `mind.css:2334–2368` (35 r.) | `mind.css:3613–3650` (38 r.) |
| mriežka | `grid-template-columns: 1fr 1fr`, `gap --sp-1` | `repeat(auto-fit, minmax(160px, 1fr))` |
| číslo | `--fs-metric` = `--fs-headline` = **24 px** (r. 250, 387) | `--fs-kpi` = **30 px** (r. 383) |
| chróm | vlastný: `--surface-2`, `1px --border`, `--r-md`, `padding 12px --sp-2` | zdedený zo zjednotenej karty (r. 4096–4117: `--panel`, `--card-pad`) |
| tvar | dvojriadkový blok | jednoriadkový strip na účiare (`align-items: baseline`, r. 3624) |
| volajúci | `panels.js:567–569`, `mind.blade.php:233` | `dnes.js:172–174` (helper) + `:30`, `:192` |

- **Zaniká:** `mind.css:2334–2368` celé (35 r.) — `.metric-grid`, `.metric`,
  `.metric-val`, `.metric-label`, `.metric-sub`.
- **Zostáva:** rodina `.kpi-*`.
- **Presun / čo treba pridať** (~11 r., preto netto −24):
  - `.kpi-card--block { flex-direction: column; align-items: stretch; }` —
    dvojriadková podoba ako **modifikátor**, nie druhá rodina.
  - `.kpi-sub { font-size: var(--fs-caption); color: var(--accent); margin-top: 4px; }`
    — `.metric-sub` nemá v `.kpi-*` ekvivalent a `panels.js` ho používa.
  - `.kpi-grid--pair { grid-template-columns: 1fr 1fr; }` — **povinné**, viď regresia nižšie.
- **HTML/JS na prepis (4 miesta):**
  - `resources/views/mind.blade.php:233` → `<div id="stats-cards" class="kpi-grid kpi-grid--pair">`
  - `public/js/mind/panels.js:567` → `'<div class="kpi-card kpi-card--block"><div class="kpi-val">'`
  - `public/js/mind/panels.js:568` → `'<div class="kpi-label">'`
  - `public/js/mind/panels.js:569` → `'<div class="kpi-sub">'`
  - (`panels.js:562` `renderEmpty($('stats-cards'), …)` sa nemení.)
- **Vypočítaný štýl: MENÍ SA VIDITEĽNE — toto je redizajn panela Štatistiky, nie úklid.**
  1. Číslo **24 px → 30 px**.
  2. Chróm `--surface-2` → `--panel`, padding `12px 16px` → `--card-pad` (`--sp-2` = 16 px)
     a pribudne `text-align: left` zo zjednotenej karty.
  3. **Mriežka**: `--panel-w` je `300px` (`mind.css:223`, na užších oknách
     `min(300px, 26vw)` na r. 3294). `repeat(auto-fit, minmax(160px, 1fr))` dá v
     300 px paneli **jeden stĺpec**, nie dva — bez `.kpi-grid--pair` sa panel
     Štatistiky natiahne na dvojnásobnú výšku. **Toto je najpravdepodobnejšia
     tichá regresia celého plánu.**
  4. `.kpi-card` je v zjednotenej karte (r. 4098), ale **zámerne nie** v skupine
     `align-items: stretch` (komentár 4125–4129 to vysvetľuje) — modifikátor
     `--block` musí `align-items: stretch` vrátiť sám, inak dvojriadkový obsah
     zostane na účiare.
- **Riziko: stredné, povinný preklik panela Štatistiky** v grafe na širokom aj
  úzkom okne, na svetlej aj tmavej téme. Ide **posledné** v poradí.

---

## M9 — tri prázdne stavy na jeden (D11)

**Zmerané dnes:**

| | `.empty-state` | `.empty` | `.card-empty` |
|---|---|---|---|
| CSS | `console.css:621–634` (+ v skupine na 443–445) | `mind.css:2132–2156` (+ `.screen .empty` 2244, `.empty-network` 2250–2282) | `mind.css:2117–2129` |
| volajúci | `render.js:58, 142, 166` | `renderEmpty()` v `util.js` | `emptyCardHtml()` v `util.js` |

- **Zaniká:** názov `.empty-state`.
- **Zostáva:** `.empty` ako základ + nový modifikátor `.empty--hero`.
- **Presun:** `console.css:621–634` sa prepíše na `.empty--hero` a **musí explicitne
  vrátiť** to, čo `.empty` (2132–2137) vnucuje: `align-items: flex-start`,
  `text-align: left`, `padding: 0`.
- **HTML/JS na prepis (3 miesta):**
  - `public/js/console/render.js:58` → `el('div', 'empty empty--hero')`
  - `public/js/console/render.js:142` → `stream.querySelector('.empty--hero')?.remove()`
  - `public/js/console/render.js:166` → to isté
- **Vypočítaný štýl: MENÍ SA, ak sa modifikátor nedopíše.** `.empty` je
  `display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: var(--sp-4) var(--sp-2)`. Prázdny stav Charóna je **ľavostranná próza
  s `<h2>` a `<ul class="empty-can">`** — vycentrovanie by z toho urobilo
  vycentrovaný zoznam schopností. S dopísaným modifikátorom je zmena nulová.
- **Poctivé priznanie:** **úspora riadkov je ~2, nie 20.** Zisk je slovník
  (jedno meno pre prázdny stav v celej appke), nie počet riadkov. Ak vlna nemá
  na to rozpočet, je to legitímne odložiť — ale potom to treba **napísať**, nie
  vydávať za hotové.
- **`.card-empty` sa nezlučuje** — `mind.css:2113–2116` to už raz rozhodol
  s dôvodom (audit §9/2). **WONTFIX.**
- **`.empty-can` a `.empty-sigil` zostávajú** — je to zoznam schopností a znak,
  nie chróm prázdneho stavu.
- **Bonus (pasca z D18, opraviť tu):** `console.css:445` dáva
  `.tool-call, .perm-card, .empty-state { max-width: 820px }`, a `console.css:622`
  o **177 riadkov nižšie** to prepíše na `600px`. Kto čita 445, uverí 820. Riešenie:
  `.empty-state` (po prepise `.empty--hero`) **vyňať zo skupiny na 445**. −0 riadkov,
  −1 pasca.

---

## M10 — jeden slovník stavov (D12)

**Zmerané dnes** (`grep -oE "\.<stav>\b" | wc -l`):

| Stav | `mind.css` | `console.css` |
|---|---|---|
| `.active` | 16 (652, 903, 904, 906, 2406, 2429, 2433, 2579, 2583, 2584, 2881, 2936, 4374, 4379 + komentáre) | 0 |
| `.open` | 3 (1558, 1575, 3295 — všetky `#prompt.open`) | 0 |
| `.armed` | 3 (1442, 3998, 4013) | 1 (269) |
| `.current` | 1 (`#breadcrumb .current`, 1004) | 0 |
| `.selected` | 1 (`.queue-item.selected`, 3925) | 0 |
| `.on` | 0 | 4 (206, 207, 990, 992) |

### Navrhnutý slovník (jedno slovo na jednu rolu)

| Rola | Nositeľ | Prečo |
|---|---|---|
| „toto je práve zobrazená obrazovka / cieľ navigácie / vybraný filter" | **`.active`** | 16 volajúcich, de facto štandard tohto projektu |
| „toto je aktuálna položka v zozname / v ceste" | **`[aria-current="true"]`** | jeden zdroj pravdy pre CSS aj čítačku |
| „toto je zvýraznená možnosť v listboxe" | **`[aria-selected="true"]`** | to isté |
| „toto je rozbalené" | **`[aria-expanded="true"]`** | konzola už to tak robí (`console.css:692`) |
| „prvý klik ozbrojil nevratnú akciu" | **`.armed`** | nemá ARIA ekvivalent, slovo je správne |
| „beh / prvok je v priebežnom stave" | **`.running` / `.waiting` / `.denied` / `.decided`** | doménové stavy, nie UI stavy |

`.on` z tohto slovníka **vypadáva úplne.** `.current` a `.selected` v `mind.css`
majú **jedného volajúceho každý** → **WONTFIX** (audit §9/5). `.open` je celé na
`#prompt` a **umiera s `chat.js`** (kontrakt §3) — netreba naň siahať.

### Vykonanie `.on` → ARIA (JS už ARIA nastavuje, takže je to takmer len prepis selektorov)

- **`console.css:990`** `.sp-item.on { background: var(--accent-soft); }`
  → `.sp-item[aria-selected="true"]`. Špecificita `(0,2,0)` → `(0,2,0)`, **identická**.
- **`console.css:992`** `.sp-item.on .ms { color: var(--accent-ink); }`
  → `.sp-item[aria-selected="true"] .ms`. To isté.
- **`console.css:206`** `.thread-row.on { border-color: var(--border-accent); }`
  → `.thread-row:has(.tr-open[aria-current="true"])`.
- **`console.css:207`** `.thread-row.on .tr-open { color: var(--accent-ink); }`
  → `.tr-open[aria-current="true"]` (jednoduchšie a presnejšie).
- **JS — 2 zmazané riadky, nič sa nepridáva:**
  - `public/js/console/slash.js:192` `item.classList.toggle('on', i === cursor);`
    → **zmazať**; riadok 193 už robí
    `item.setAttribute('aria-selected', i === cursor ? 'true' : 'false')`.
  - `public/js/console/main.js:123` `row.classList.add('on');`
    → **zmazať**; riadok 122 už robí `open.setAttribute('aria-current', 'true')`.
- **Vypočítaný štýl:** nemení sa. (`:has()` je `(0,3,0)`, teda vyššie než pôvodné
  `(0,2,0)`, ale o `border-color` na `.thread-row` nesúťaží nič iné než `:hover`
  na r. 205 — over prekliknutím, že hover na aktívnom riadku vyzerá ako predtým.)
- **Zisk navyše:** paleta príkazov prestane mať dieru pre čítačku, ktorú
  `console.blade.php:140` (`role="listbox"`) sľubuje.

### Nález, ktorý audit prehliadol: `.armed` je nakreslený štyrikrát

`mind.css:1442` (`#node-delete.armed`), `mind.css:3998–4007` (`button.danger.armed`),
`mind.css:4013–4018` (`.queue-actions button.armed`), `console.css:269–277`
(`.tr-act.armed`). Hodnoty:

| | mind 3998 | mind 4013 | console 269 |
|---|---|---|---|
| padding | `0 10px` | `0 10px` | `0 8px` |
| font-family | `--font` | `--font` | `--font` |
| font-size | `--fs-small` | `--fs-small` | `--fs-caption` |
| color | `--danger` | `--danger` | `--danger` |
| border-color | `--danger-border-hover` | `--danger-border-hover` | `--danger-border` |
| background | `--danger-soft` | `--danger-soft` | `--danger-soft` |
| width | `auto` | `auto` | — |

`mind.css:3993–3997` pritom **sám hovorí**, že vzor má appka na štyroch miestach
a štýl mali len dve. Dnes ich je päť a štýl majú štyri.

- **Návrh:** v `mind.css` jedno pravidlo `.armed` (~8 r.) s hodnotami z r. 3998
  a `mind.css:4013–4018` zmazať (−6 r.).
- **`console.css:269–277` NEZLUČOVAŤ do základu** — jeho tri odchýlky (padding 8,
  `--fs-caption`, `--danger-border`) sú vedomé: gombík je v 26 px riadku, nie
  v 32 px tlačidle. Po pridaní základu z neho zaniknú `color`, `background`,
  `font-family` (−3 r.), zostanú tri odchýlky + `white-space: nowrap`.
- **Vypočítaný štýl:** nemení sa, ak sa základ napíše z hodnôt r. 3998 a odchýlky
  sa ponechajú. Netto **−9 r.** Toto je bonus mimo tabuľky v §1 (konzervatívne
  ho tam nepočítam).

---

## M11 — aktívne kolízie tried a id (D8), zmerané

`scratchpad/overlap2.js` nad dnešnými súbormi: **8 zdieľaných tried, 1 zdieľané id.**

| Meno | `console.css` | `mind.css` | Verdikt |
|---|---|---|---|
| `.msg` | 459, 479, 489, 500, 510, 519, 525, 557, 567, 569, 587 | 1641, 1650, 1651, 1666, 1681, 1688, 1694, 1695, 1702, 1703 | **AKTÍVNA**, riešená prepisom `.console-body .msg` (479, komentár 474–478) |
| `#prompt` | 884, 894 | 1550, 1558, 1575, 2287, 2865 | **AKTÍVNA**, riešená `#composer #prompt` + dva `!important` (894–895, komentár 887–893) |
| `.ms` | 170, 500, 651, 677, 793, 960, 991, 992, **1011** | 524 (+27 miest, ktoré len menia `font-size`) | **AKTÍVNA**, viď nižšie |
| `.thinking` | 525 (`.msg.thinking .bubble`) | 1694, 1695, 1702, 1703 | aktívna, **benígna** — `mind.css:1694` `color: var(--muted)` dopadne na konzolový riadok, ale `.think-note` (547) a `.think-dot` (533) si farbu nesú sami. **Over prekliknutím, nemeň.** |
| `.hidden` | 1007 | 522 | duplikát → M1 |
| `.armed` | 269 | 1442, 3998, 4013 | **nie je kolízia** — mind má `button.danger.armed` a `#node-delete.armed`, konzolový gombík je `tr-act ms`, teda ani jedno neplatí. Je to **duplicita vzoru**, viď M10. |
| `.error` | 557, 567, 569, 664, 716 | 3466, 3467, 3468 | benígna — mind má len `.toast.error` |
| `.primary` | 848 (`.pc-btn.primary kbd`) | 707, 713, 714, 715, 3348 | **nie je kolízia, je to zámerné znovupoužitie** po D2 |

### `.ms` — jediná kolízia, ktorá sa dá zavrieť v tejto vlne

`console.css:1011–1022` vyzerá ako celá druhá definícia, ale je to **čiastočný
prepis**. Rozdiely proti `mind.css:524–537`:

| Vlastnosť | `mind.css:524` | `console.css:1011` | Kto vyhráva na `/console` |
|---|---|---|---|
| `font-family` | `'Material Symbols Rounded'` | `'Material Symbols Rounded', sans-serif` | console (má fallback) |
| `font-size` | `var(--icon-md)` = **20 px** | **18 px** (= `--icon-sm`) | console |
| `font-feature-settings` | — | `'liga'` (+ `-webkit-`) | console |
| `display: inline-block` | áno | — | **mind** (console ho neprepisuje) |
| `direction: ltr` | áno | — | mind |
| `font-variation-settings` | `'FILL' 0, 'wght' 400, …` | — | mind |
| `-webkit-font-smoothing` | áno | — | mind |

- **Zaniká:** `console.css:1011–1022` (12 r.).
- **Zostáva / presun:** `mind.css:524–537` ako jediný základ, plus **dva riadky**:
  - do `mind.css:525` dopísať `, sans-serif` (prospeje aj grafu — dnes tam
    fallback nie je vôbec);
  - do `console.css` jediný riadok `.console-body .ms { font-size: var(--icon-sm); }`,
    pretože 18 px je vedomá voľba konzoly.
  Netto **−10 r.**
- **HTML/JS:** nič.
- **Vypočítaný štýl:** veľkosť ani rodina sa nemenia. Zaniká
  `font-feature-settings: 'liga'` — Material Symbols kreslí ligatúry aj bez neho
  (dokazuje to rail grafu, ktorý ho nikdy nemal), ale **je to degenerátna cesta
  a treba ju prekliknúť**: ak sa niektorá ikona na `/console` vykreslí ako svoj
  názov, riadok sa vracia. Overuj **meraním šírky glyfu** (glyf ≈ 18 px,
  nevykreslená ligatúra je násobne širšia), nie okom.
- **Oprava tvrdenia auditu:** audit označil `.ms` za „NEOVERENÉ, možno duplikát".
  Nie je to duplikát — je to prepis dvoch vlastností zo siedmich, napísaný ako
  celá definícia. Práve to je na ňom nebezpečné.

### `.msg` a `#prompt` — NESIAHAŤ V TEJTO VLNE

Audit §9/7 to zakazuje a mám pre to dnes silnejší dôvod: kontrakt §3 hovorí, že
`chat.js` (398 r.), `ChatController` a prepínač v Nastaveniach **idú von** a
nahradí ich dok Charóna. Tým **umiera pôvodca oboch kolízií**:

- `mind.css:1641–1703` (`.msg`, `.msg.me`, `.msg.hades`, `.msg.sys`, `.msg.sys--error`,
  `.msg.thinking`, `.avatar`, `.msg-row`) kreslí **len** `chat.js` — jediné volajúce
  miesta v celom repe sú `chat.js:143` (`div.className = 'msg ' + cls`) a `:153`
  (`el.className = 'msg-row'`), s hodnotami `me` / `hades` / `hades thinking` /
  `sys` / `sys sys--error` (r. 199, 201, 218, 224, 233).
- `mind.css:1550–1618` (`#prompt`, `#prompt-form`, `#prompt-input`) + `2865`
  (`body:not(.chat-on) #prompt { display: none !important }`) kreslí ten istý modul
  (`main.js:7` `setupPrompt`, `shortcuts.js:4` `collapsePrompt`).

**Správne poradie je teda:** dok Charóna vznikne → `chat.js` zomrie →
`mind.css` `.msg*`/`#prompt*`/`.avatar` sa zmažú → **a až vtedy** padne
`.console-body .msg` (479) a `#composer #prompt` (894) so svojimi dvoma
`!important`. Nikdy naopak a nikdy po jednom. **Zapísať do reportu ako závislosť
medzi vlnami, nie ako neurobený nález.**

---

## M12 — nový nález: markdown je nakreslený dvakrát

Audit ho nemá. `mind.css:2009–2031` (`.md-body code`, `.md-body .md-code`,
`.md-body .md-code code`) × `console.css:587–613` (`.bubble.md code, .msg.system code`,
`.bubble.md pre.code`, `.bubble.md pre.code code`) je ten istý chróm, päťkrát
mierne inak:

| | mind (`.md-body`) | console (`.bubble.md`) |
|---|---|---|
| inline `background` | `--surface-subtle` | `--surface-subtle` (zhoda) |
| inline `border` | `1px solid var(--line-soft)` | **žiadny** |
| inline `border-radius` | `var(--r-sm)` (8 px) | **raw `5px`** |
| inline `font-size` | `.9em` | `.92em` |
| inline `letter-spacing` | `var(--ls-mono)` | **žiadne** |
| blok `padding` | `var(--sp-2)` (16 px) | `10px 12px` |
| blok `margin-bottom` | `var(--sp-2)` | `12px` |
| blok `border` / `radius` / `bg` | `--border` / `--r-md` / `--surface-2` | to isté (zhoda) |

- **Zaniká:** `console.css:587–595` a `597–613` ako samostatné bloky.
- **Zostáva / presun:** v `mind.css` sa zoznamy selektorov **zjednotia** —
  `.md-body code, .bubble.md code, .msg.system code` a
  `.md-body .md-code, .bubble.md pre.code` a
  `.md-body .md-code code, .bubble.md pre.code code`. V `console.css` zostanú len
  odchýlky, ktoré chceme podržať (`overflow-wrap: anywhere`, `white-space: pre`,
  `line-height: 1.5`). Netto **−10 r.**
- **HTML/JS:** nič (`render.js` triedy nemení).
- **Vypočítaný štýl: MENÍ SA na piatich miestach** — inline kód konzoly získa
  hairline rám a radius 8 px namiesto 5, `.92em` → `.9em`, blok kódu padding
  `10px 12px` → 16 px. Je to viditeľné v každej odpovedi modelu.
- **Riziko:** nízke technicky, stredné vizuálne. **Priorita nízka** — ak vlna
  dochádza, toto je prvý kandidát na odloženie a stačí zapísať ako známy dlh.

---

## M13 — `--stream-w` existuje a nepoužíva sa (D18 + R9)

`console.css:26` definuje `--stream-w: 820px` s komentárom (19–24), ktorý presne
opisuje, prečo. **A potom je `820px` v súbore literálne päťkrát:**
`445` (`.tool-call, .perm-card, .empty-state`), `480` (`.console-body .msg`),
`871` (`.composer-row`), `933` (`#composer-hint`), `969` (`#slash-palette`,
vo forme `min(820px, …)`).

- **Zaniká:** päť literálov.
- **Zostáva:** `var(--stream-w)`.
- **HTML/JS:** nič.
- **Vypočítaný štýl:** nemení sa (tá istá hodnota).
- **Bonus:** vyňať `.empty-state` zo skupiny na 445 (pasca z §M9).
- **Riziko:** žiadne. Najlacnejšia položka plánu.

---

## M14 — raw `px` na tokeny (D21), len tam, kde je to inertné

- **Ikony — 6 zásahov, hodnota sa nemení, teda inertné:**
  `console.css:170` `16px` → `var(--icon-xs)`; `:500` `14px` → `var(--icon-2xs)`;
  `:651` `18px` → `var(--icon-sm)`; `:677` `16px` → `var(--icon-xs)`;
  `:793` `18px` → `var(--icon-sm)`; `:991` `16px` → `var(--icon-xs)`.
  (Tokeny sú `mind.css:270–274`: `--icon-2xs: 14px`, `--icon-xs: 16px`,
  `--icon-sm: 18px`, `--icon-md: 20px`, `--icon-lg: 22px`.)
  `console.css:1013` (`18px` v `.ms`) zaniká celé v §M11.
- **Spacing — `4/8/12/16` na `--sp-*`:** hodnota sa nemení, teda inertné.
  Zmerané: `console.css` má **72** číselných `px` v `padding`/`margin`/`gap`.
- **NEROBIŤ teraz:** hodnoty mimo škály (`6, 7, 10, 14, 18, 20, 22 px`) —
  `console.css` si nesie vlastnú nepomenovanú medziškálu a rozhodnúť sa o nej má
  **naraz s density tokenmi vlny B**, nie po jednej (audit D21c).
- **NEROBIŤ vôbec bez rozhodnutia:** tri raw radiusy `console.css:414` (`6px`),
  `:590` (`5px`), `:749` (`6px`). `--r-sm` je **8 px**, takže tokenizácia je
  **zmena vypočítaného štýlu**, nie úklid. `:590` sa rieši v §M12, `:414`
  (`#model-select`) a `:749` (`.tc-more`) nechať a zapísať.

---

## 2. Čo tento plán ZÁMERNE nerobí (WONTFIX)

Zoznam je záväzný — sú to body, ktoré si audity samé označili v „Čo vedome NEROBIŤ",
alebo ktoré som premeral a vyšli negatívne.

1. **`.badge` a `.chip` sa nezliévajú** (D10, kontrakt §4). `.badge` je statický
   popisok, `.chip` má `cursor`/`:hover`/`:active`/`:focus-visible`. Rozdiel nesie
   kánon „akcent je interaktívny". Zlúčenie získa ~12 riadkov a rozbije kánon.
   *(Samostatný, stále platný nález D10: konzola nemá ani jedno a stav toolu kreslí
   ako `.tc-state` so štyrmi farbami — `console.css:707–717`. Pred obrazovkou Runy
   z toho má byť `.badge` s modifikátorom stavu, inak vznikne tretia rodina.
   To je **návrh na inú vlnu**, nie zlúčenie duplikátu.)*
2. **`.card-empty` sa nezliéva s `.empty`** — `mind.css:2113–2116` to už rozhodol
   s dôvodom (nadpis karty kontext povedal; `min-height: 132px` drží mriežku).
3. **`.active` / `.current` / `.selected` / `.open` v `mind.css` sa nezjednocujú.**
   `.current` a `.selected` majú **jedného volajúceho každý** (`#breadcrumb .current`
   1004, `.queue-item.selected` 3925). `.open` je celé `#prompt.open` a umiera
   s `chat.js`. Výnos nula, riziko nenulové.
4. **Hades tokeny sa neprepisujú na Aura názvy** — len aliasy (audit §9/3).
5. **`font: inherit` v resete konzoly sa nemení na `font-weight`** — resetuje aj
   `line-height` a zmena by posunula výšku každého tlačidla konzoly (§M6).
6. **`.console-body .msg` (479) ani `#composer #prompt` (894–895) sa nedotýkame** —
   padnú len naraz s `chat.js` (§M11).
7. **`#model-select:disabled { cursor: default }` (`console.css:421`) sa nemaže** —
   na `<select>` **nie je** inertné, hoci audit tvrdil opak (§M5).
8. **Mŕtve tokeny „diera v škále"** (`--muted-strong`, `--accent-press`,
   `--glow-accent-lg`, `--success-soft`, `--z-vignette`) sa nemažú (audit §9/6).
9. **`--control-h` (32 vs 30 px) sa nerieši tu** — patrí k density prepínaču
   vlny B, nie k zlučovaniu duplikátov (§M6b).
10. **`.ms` v `console.css` sa nerieši „bez prekliku"** (audit §9/8) — v §M11 je
    presne zmerané, čo z neho vyhráva, a preklik je súčasťou postupu.
11. **`.tnum` sa nezavádza** (audit §9/9) — `mind.css:516` má
    `font-variant-numeric: tabular-nums` globálne na `body`.
12. **Farebné hodnoty a zlatá sa nemenia** (kontrakt §4). `console.css` používa
    zlatú 0×; kánon je na konzole splnený a každé „ladenie odtieňa" ho môže len pokaziť.

---

## 3. Ako sa každý krok overuje

1. **Inertnosť** (M1, M2, M6, M7, M10, M13, M14): `cssswap.js` — výmena stylesheetu
   **nad tým istým DOM**, dva rámce + 250 ms na dosadnutie, A/B/A/B kalibrácia.
   Nie dve načítania stránky: Hades je živý a medzi nimi sa naučí uzly.
2. **Zmeny pixelov** (M3, M4, M5, M8, M9, M11, M12): zmeraný computed style pred
   a po, na **oboch témach**, s dosadnutím po prepnutí `data-theme`
   (prepni v jednom volaní, meraj v ďalšom) a s kalibráciou na `body` (~16:1).
   **Screenshot nie je dôkaz** — Browser pane v tomto prostredí nekompozituje rámce.
3. **Kontrastná matrica** po M3, M4 a M12 (menia pozadia a rámy):
   0 textových párov pod AA, pozadie **skládané** alfa kompozíciou po prvú
   nepriehľadnú vrstvu.
4. **Ikony** po M11: šírka vykresleného glyfu (glyf ≈ 18 px, nevykreslená ligatúra
   násobne širšia), kalibrovaná na známom kladnom (`hub`) aj zápornom (`terminal`)
   prípade. **Nečítať GSUB.**
5. **`w4dup.js`** po každom kroku: baseline je `mind.css` `A=0` a `console.css`
   `A=0` (kontrakt §5/5). Beh nad **dnešnými** súbormi treba spustiť a zapísať
   ako východisko — čísla `B` a `C` z auditu boli namerané na 818-riadkovom súbore.
6. **Identita preview servera** pred každým meraním:
   `curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'` musí vypísať
   `/js/mind/main.js`. Inak meriaš cudziu appku a všetky čísla sú bezcenné.
7. **Preklik po každej rizikovej položke:** M3 → `Tab` naprieč railom, hlavičkou,
   composerom a kartou potvrdenia; M4 → `Cmd-K` trigger + paleta + `?` overlay +
   Kontrola + karta potvrdenia; M8 → panel Štatistiky na širokom aj úzkom okne;
   M9 → prázdny stav Charóna; M11 → všetky ikony na `/console`; M12 → odpoveď
   modelu s inline kódom aj s blokom kódu.
