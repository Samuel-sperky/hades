# Sprint plán redizajnu — vlna 1

**Dátum:** 27. 8. 2026 · **Vetva:** `feat/hades-redesign` · **Rola:** koordinátor
**Vstupy:** `SONDA-A-INVENTAR.md`, `SONDA-B-URL-STAV.md`, `KONTRAKT-REDIZAJN-2026-08-27.md`,
`docs/BRAND-HADES.md` (prepísaný v tom istom ťahu ako tento plán)
**Produkčný kód zmenený týmto plánom:** žiadny.

---

## 0. Ako sa tento plán čita

Plán je napísaný tak, aby ho dvaja implementátori vykonali **bez uvažovania o zámere**.
Každá téma má štyri časti a všetky štyri sú povinné:

| Časť | Čo v nej stojí |
|---|---|
| **ČO** | súbor + selektor alebo funkcia + stará hodnota → nová hodnota |
| **OVERENIE** | presná DOM / CSSOM / computed-style asercia, ktorú orchestrátor spustí v prehliadači |
| **ČO SA MÔŽE ROZBIŤ** | konkrétny mechanizmus, nie „pozor na regresie" |
| **VLASTNÍK** | jeden implementátor, jeden súbor |

**Screenshoty neexistujú.** Browser pane v tomto prostredí nekompozituje rámce
(`KONTRAKT §4`), takže dôkaz je vždy zmeraný DOM a computed style.

**Delenie je podľa SÚBOROV, nie podľa témy.** Dva agenti píšuci do jedného súboru
sa ticho prepíšu — posledný vyhrá, bez konfliktu a bez varovania. Preto je §2
(vlastníctvo) najdôležitejšia časť tohto dokumentu a §1 (zmrazený kontrakt) je
druhá najdôležitejšia: bez nej by sa implementátori museli rozprávať, a to nemôžu.

---

## 1. ZMRAZENÝ KONTRAKT MEDZI IMPLEMENTÁTORMI

Toto je jediné miesto, kde sa I1 a I2 stretávajú. **Nič z tejto sekcie sa nemení
bez koordinátora.** I1 píše kresbu týchto názvov, I2 píše markup s týmito názvami.
Ak jeden z nich zmení názov, druhý o tom nebude vedieť a chyba bude tichá.

### 1.1 Nové typografické role-tokeny (deklaruje I1 v `mind.css:root`)

| Token | Hodnota | Rola | Prokládka |
|---|---|---|---|
| `--fs-data` | `13px` | dátový text v zoznamoch a kartách: časy, cesty, počty, snippety | `--lh-data: 1.45` |
| `--fs-data-chip` | `12px` | hodnota vnútri čipu / badge (`.tag`, `.cert`, `.origin`) | `--lh-data-chip: 1.3` |
| `--fs-chart-axis` | `11px` | osi, legendy a stupnice grafov | `--lh-chart-axis: 1.2` |

Chróm **zostáva** na `--fs-caption` (11 px) a `--fs-micro` (10 px). Rozhodnutie 13
zdvíha dátový text, nie popisky.

Hodnoty sú zámerne **rovné existujúcim stupňom škály** (`--fs-body`, `--fs-small`,
`--fs-caption`), nie nové čísla — mení sa pomenovanie role a **priradenie**, nie
škála. Deklaruj ich ako doslovné `px`, nie ako `var(--fs-body)`: rola sa má dať
posunúť bez toho, aby sa posunul stupeň škály pre všetkých ostatných.

### 1.2 Nové názvy tried (I1 kreslí, I2 vkladá)

| Trieda | Význam | Poznámka |
|---|---|---|
| `.empty` | základ prázdneho stavu — **existuje**, nemení sa | `mind.css:2510` |
| `.empty .title` | **nová** — prvý riadok prázdneho/chybového stavu, keď nesie predmet | dnes ju má len `.empty-network .title` |
| `.empty .hint` | druhý riadok „čo s tým" — **existuje** | `mind.css:2529` |
| `.empty--error` | **nová** — jeden chybový komponent (rozhodnutie 16) | modifikátor `.empty`, nie nový základ |
| `.empty--filter` | **nová** — prázdno spôsobené filtrom, nie neexistenciou dát | |
| `.empty-act` | **nová** — `<button>` s jednou konkrétnou akciou (rozhodnutie 14) | |
| `.skel` | **nová** — základná plocha skeletonu (nasleduje `.shimmer`) | |
| `.skel-line` | **nová** — jeden riadok textu; výška z `--skel-h` alebo default | |
| `.skel-block` | **nová** — blok; výška z `--skel-h` | |
| `.skel-card` | **nová** — blok s papierom, radiusom a paddingom karty | |
| `.skel-list` | **nová** — obal skupiny riadkov (drží `gap`) | |
| `.chart-axis` | **nová** — os grafu; nahrádza inline `font-size:10px` v `charts.js:484` | |

**`.sk-row`, `.sk-*` a `.rail-skeleton` sú ZAKÁZANÉ názvy.** `.sk-row` už existuje
v `console.css:344`. `mind.css` sa načítava prvý na všetkých troch plochách, takže
rovnaké meno v `mind.css` by na `/console` prehralo s `console.css` a na `/` vyhralo —
tá istá trieda by kreslila dve rôzne veci podľa plochy. Preto prefix `.skel`.

**`.shimmer` sa vo vlne 1 NERUŠÍ.** I1 pridá `.skel*` vedľa nej; I2 prepíše jediného
volajúceho (`dnes.js:26`). Zmazanie `.shimmer` je riadok vlny 2 — keby ju I1 zmazal
teraz a I2 by nedobehol, dashboard by mal skeleton bez kresby.

### 1.3 Nové a zmenené exporty v `public/js/mind/util.js` (vlastní I2)

Všetko **hoistovaná `export function`**, nikdy `export const foo = () => {}` —
graf modulov je cyklický a arrow v `const` spadne na `ReferenceError`.

```
export function emptyHtml(icon, text, hint, action)
export function renderEmpty(container, icon, text, hint, action)
export function errorHtml(subject, hint)
export function renderError(container, subject, retry)
export function filterEmptyHtml(text, hint)
export function renderFilterEmpty(container, text, hint, clear)
export function skeletonHtml(shape)
export function renderSkeleton(container, shape)
export function loadingHtml(text)          // zostáva, viď 1.4
export function renderLoading(container, text)
```

- `action` je **štvrtý** parameter `emptyHtml`, presne z toho istého dôvodu, z akého
  je `hint` tretí: `cmdk.js`, `md.js`, `pack.js`, `panels.js` a `charon.js` volajú
  `emptyHtml(icon, text)` a **vlna 1 ich nevlastní**. Štvrtý nepovinný parameter
  ich necháva funkčné. Tvar: `{ label: 'Zruš filter', act: 'clear-filter' }` →
  vykreslí `<button type="button" class="empty-act" data-act="clear-filter">`.
- `renderError(container, subject, retry)` nastaví `innerHTML` a **potom pripojí
  listener** na `.empty-act`. `retry` je funkcia; typicky sa doňho pošle ta istá
  render funkcia, v ktorej fetch spadol.
- `subject` je predmet v **4. páde bez slova „nepodarilo"**: `renderError(list, 'denník')`
  vykreslí „Denník sa nepodarilo načítať". Reťazec zloží helper, nie volajúci —
  inak sa formulácia rozíde tak, ako sa dnes rozišiel hlas (§5.6 sondy A).
- `shape` je **enum**, nie objekt s rozmermi: `'dashboard' | 'list' | 'cards' | 'table' | 'prose'`.
  Rozmery patria CSS, nie JS.

### 1.4 Kedy skeleton a kedy dýchajúci znak — záväzné

| Situácia | Kresba |
|---|---|
| Endpoint, ktorý plní **zoznam alebo mriežku** a beží > ~300 ms | `renderSkeleton(...)` |
| Endpoint, ktorý plní **jednu hodnotu v už existujúcej karte** | `renderLoading(...)` |
| Krátke soft-refresh nad už vykresleným zoznamom | nič — ponechaj starý obsah |

`loadingHtml()` teda **neodchádza**, len sa mu zmenšuje pôsobisko z 10 miest na
tie, kde skeleton nemá čo kopírovať.

### 1.5 Zakázané v celej vlne

- **`onclick=` / `onerror=` v generovanom HTML.** `script-src 'self'` je bez
  `unsafe-inline` na všetkých troch plochách (`ContentSecurityPolicy.php:114`) a
  komentár nad tou direktívou tvrdí ako **zmeraný fakt**, že v `public/js` nie je
  ani jeden `onclick=`. Inline handler by bol mŕtvy kód **a** ten komentár by začal
  lhať. Vždy `addEventListener`.
- **Inline `style="font-size:…"` a inline trvania.** `style-src` `unsafe-inline`
  síce povoľuje, takže sa to *vykreslí* — a práve preto je to nebezpečné: rozmer
  napísaný v JS je pre CSS neviditeľný a žiadna asercia nad CSSOM ho nenájde.
  Presne tak vznikol `charts.js:484`.
- **Raw hex / rgba mimo `:root`.** Dnes 0 zásahov (merané sondou A §2.4) — nech to
  tak zostane.
- **`:is()` na oslabenie.** `:is()` berie špecificitu najsilnejšieho argumentu.
  Keď chceš pravidlo oslabiť, `:where()`.
- **Druhé globálne `:focus-visible`.** Jedno je v RESET & BASE a `border-radius`
  v ňom zámerne nie je.

---

## 2. VLASTNÍCTVO SÚBOROV — VLNA 1

### Implementátor 1 — kresba

| Súbor | Rozsah |
|---|---|
| `public/css/mind.css` | **celý, výhradne** |
| `resources/views/mind.blade.php` | **iba `<head>`, riadky 28–37 (blok `<link rel="preload">`)** — nič iné v tom súbore neotvárať |

### Implementátor 2 — stavy a obsah

| Súbor | Rozsah |
|---|---|
| `public/js/mind/util.js` | celý |
| `public/js/mind/screens/dnes.js` | celý |
| `public/js/mind/screens/dennik.js` | celý |
| `public/js/mind/screens/kniznica.js` | celý |
| `public/js/mind/screens/rozhodnutia.js` | celý |
| `public/js/mind/screens/runy.js` | celý |
| `public/js/mind/screens/kontrola.js` | celý |
| `public/js/mind/screens/smernica.js` | celý |
| `public/js/mind/structure.js` | celý |
| `public/js/charts.js` | celý |

### Súbory, ktoré vo vlne 1 NEOTVÁRA NIKTO

`public/css/console.css` · `public/css/chat.css` · `public/css/charon.css` ·
`public/js/mind/{state,sim,screens,render,panels,controls,filters,charon,cmdk,md,rail,layout,edges,interaction,anim,theme,toasts,http,api,tagfilter,timeline,search,shortcuts,dock,pack,certainty,ws,main}.js` ·
`public/js/chat/*` · `public/js/console/*` · `public/js/shared/*` ·
`resources/views/{chat,console}.blade.php` · `electron/*` · `app/*` · `tests/*`

**Prečo je `charts.js` u I2 a nie u I1:** jeho jediný typografický hriech je inline
`font-size:10px` v JS (`charts.js:484`), teda **markup**, nie kresba. I2 ho nahradí
triedou `.chart-axis`, I1 tú triedu nakreslí. Keby `charts.js` vlastnil I1, potreboval
by aj `dnes.js` (volajúci), a tým by prevzal polovicu obrazoviek.

**Prečo `structure.js` u I2 a nie inde:** je to sekcia obrazovky **Kontrola**
(strom + duplicity) a nesie **dva najslabšie chybové stavy v appke**
(`structure.js:69`, `:195` — „Nepodarilo sa načítať" bez predmetu aj bez rady).
Bez neho by Kontrola mala zjednotenú chybu len napolovic.

**Prečo I1 dostal aj `mind.blade.php`:** serif dostáva vo vlne 1 osemnásobne väčšie
pôsobisko (§3.7) a `playfair-display-*.woff2` **nie je preloadovaný na žiadnej
ploche** (merané sondou A §1.4). Preload je jediná zmena, ktorá k tomu patrí a je
mimo CSS. Vo vlne 1 blade neotvára nikto iný, takže kolízia nevznikne — vo vlne 2
blade prechádza na iného vlastníka celý.

---

## 3. IMPLEMENTÁTOR 1 — `public/css/mind.css`

Poradie tém je poradím vykonania. T1–T3 sú základ, na ktorom stoja ostatné.

### T1 · Role-tokeny hustoty

**ČO.** Do bloku typografických tokenov (`mind.css:283–292`, hneď za `--lh-base`)
pridaj tri páry z §1.1: `--fs-data`/`--lh-data`, `--fs-data-chip`/`--lh-data-chip`,
`--fs-chart-axis`/`--lh-chart-axis`. Komentár nad blokom musí povedať **rolu**, nie
číslo, a musí povedať, že chróm zostáva na `--fs-caption`/`--fs-micro` — inak
budúca session zdvihne aj popisky.

**OVERENIE.**
```js
const cs = getComputedStyle(document.documentElement);
JSON.stringify(['--fs-data','--lh-data','--fs-data-chip','--lh-data-chip',
  '--fs-chart-axis','--lh-chart-axis'].map(t => [t, cs.getPropertyValue(t).trim()]));
// očakávané: 13px / 1.45 / 12px / 1.3 / 11px / 1.2
```

**ČO SA MÔŽE ROZBIŤ.** Nič — token bez volajúceho je inertný. Riziko je opačné:
tokeny pridané a nepoužité. Preto T1 a T2 musia landnúť v jednom celku.

---

### T2 · Zdvih dátového textu — presný, uzavretý zoznam

**ČO.** Zameň `font-size` na vymenovaných riadkoch a **ku každému doplň
`line-height`** z páru tokenu. Čísla riadkov sú z dnešného `mind.css`; po prvej
zmene sa posunú, preto pracuj podľa selektora, nie podľa čísla.

**Skupina A — `--fs-data` + `--lh-data` (13 px), 31 deklarácií**

| Riadok | Selektor | Dnes |
|---|---|---|
| 1429 | `#header-metrics` | `--fs-small` 12 |
| 2774 | `.record-time` | `--fs-small` 12 |
| 2816 | `.chip-n` | `--fs-caption` 11 |
| 2834 | `.day-head` | **`--fs-micro` 10** |
| 2888 | `.rec-prompts` | `--fs-caption` 11 |
| 2923 | `.rec-commit` | `--fs-small` 12 |
| 2933 | `.rec-final` | `--fs-small` 12 |
| 2971 | `.tree-row .count` | `--fs-caption` 11 |
| 3010 | `.tree-muted .count` | `--fs-caption` 11 |
| 3082 | `.dup-pct` | `--fs-caption` 11 |
| 3549 | `.ti-snip` | `--fs-small` 12 |
| 3557 | `.ti-time` | `--fs-caption` 11 |
| 3566 | `.lib-count` | `--fs-small` 12 |
| 3603 | `.lib-skill-snip` | `--fs-small` 12 |
| 3644 | `.tcl-proj` | `--fs-caption` 11 |
| 3649 | `.tcl-time` | `--fs-caption` 11 |
| 3796 | `.dir-group-n` | `--fs-small` 12 |
| 3815 | `.dir-sub` | `--fs-small` 12 |
| 3820 | `.dir-path` | `--fs-caption` 11 |
| 3872 | `.dsi-path` | `--fs-caption` 11 |
| 4100 | `.kpi-suffix` | `--fs-small` 12 |
| 4111 | `.kpi-sub` | `--fs-caption` 11 |
| 4200 | `.cert-legend .cl-row` | `--fs-small` 12 |
| 4223 | `.dbar-head` | `--fs-small` 12 |
| 4364 | `.dtl-card .dtl-date` | `--fs-caption` 11 |
| 4371 | `.dtl-card .dtl-reason` | `--fs-small` 12 |
| 4406 | `.queue-meta` | `--fs-caption` 11 |
| 4448 | `.sync-stats` | `--fs-small` 12 |
| 5120 | `.run-when, .run-model, .run-profile` | `--fs-caption` 11 |
| 5147 | `.run-cost` | `--fs-small` 12 |
| 5236 | `.run-args` | `--fs-small` 12 |

**Skupina B — `--fs-data-chip` + `--lh-data-chip` (12 px), 8 selektorov / 9 deklarácií**

| Riadok | Selektor | Dnes |
|---|---|---|
| 2477 | `.lib-skill-meta[data-more]::after` | `--fs-caption` 11 |
| 2781 | `.tag` | `--fs-caption` 11 |
| 2820 | `.chip-more` | `--fs-caption` 11 |
| 2906 | `.meta-chip` | `--fs-caption` 11 |
| 3517 / 3524 | `.today-chip` (2 deklarácie) | `--fs-small` 12 → len prepis tokenu |
| 3551 | `.ti-tag` | `--fs-caption` 11 |
| 4256 | `.cert` | `--fs-caption` 11 |
| 4287 | `.origin` | `--fs-caption` 11 |

**Skupina C — `--fs-chart-axis` + `--lh-chart-axis` (11 px), 4 deklarácie**

| Riadok | Selektor | Dnes |
|---|---|---|
| 4152 | `.heat-months` | `--fs-micro` 10 |
| 4162 | `.heat-legend` | `--fs-micro` 10 |
| 4191 | `.donut-total .dt-lbl` | `--fs-micro` 10 |
| 4309 | `.dtl-month` | `--fs-micro` 10 |

**Osi idú na 11 px, nie na 13 px, a je to zmeraný dôvod, nie kompromis:**
heatmapa má 365 buniek na šírku obrazovky a 12 mesačných popiskov nad nimi. 13 px
by ich zlepilo. Zdvih 10 → 11 je maximum, ktoré os unesie; čitateľnosť dohráva
`.sr-only` tabuľka, ktorú si heatmapa drží.

**CHRÓM — vymenovaný, NEDOTKNUTÝ.** Tieto zostávajú na 10/11 px a keby ich niekto
zdvihol, rozhodnutie 13 by prestalo platiť v druhej polovici: `.rail-eyebrow`,
`#brand-core .bc-word`, `#rail .rail-group :is(button,a).dest .lbl`, `… .dest .count`,
`kbd`, `.kbd-hints kbd`, `.code-lang`, `.copy-btn`, `.check-cap`, `.dir-badge`,
`.h-scope #scope-label`, `.preset-state`, `#presets .preset .p-sub`, `.adv-title`,
`.adv-n`, `.run-step-who`, `.run-stop`, `.sync-guard`, `.legend-note`,
`.legend-row.legend-strength .cap`, `.result-divider`, `.cmdk-group`.

**OVERENIE — 1. krok, CSSOM (nezávislý od dát):**
```js
function fsOf(sel) {
  const hit = [];
  for (const sh of document.styleSheets) {
    let rs; try { rs = sh.cssRules } catch (e) { continue }
    (function walk(list) {
      for (const r of list) {
        if (r.cssRules) walk(r.cssRules);
        else if (r.selectorText === sel) {
          const v = r.style.getPropertyValue('font-size');
          const lh = r.style.getPropertyValue('line-height');
          if (v) hit.push([v.trim(), lh.trim() || 'CHÝBA']);
        }
      }
    })(rs);
  }
  return hit;
}
const A = ['#header-metrics','.record-time','.chip-n','.day-head','.rec-prompts',
 '.rec-commit','.rec-final','.tree-row .count','.tree-muted .count','.dup-pct',
 '.ti-snip','.ti-time','.lib-count','.lib-skill-snip','.tcl-proj','.tcl-time',
 '.dir-group-n','.dir-sub','.dir-path','.dsi-path','.kpi-suffix','.kpi-sub',
 '.cert-legend .cl-row','.dbar-head','.dtl-card .dtl-date','.dtl-card .dtl-reason',
 '.queue-meta','.sync-stats','.run-when, .run-model, .run-profile','.run-cost','.run-args'];
JSON.stringify(A.map(s => [s, fsOf(s)]).filter(([s, h]) =>
  !h.length || h.some(([fs, lh]) => fs !== 'var(--fs-data)' || lh === 'CHÝBA')));
// PASS = "[]"
```
To isté pole pre skupinu B (`var(--fs-data-chip)`) a C (`var(--fs-chart-axis)`).

**Kalibrácia detektora je povinná** — spusť `fsOf('.rail-eyebrow')` a musí vrátiť
`var(--fs-micro)`. Keď detektor nenájde ani chróm, nenachádza nič a prázdne pole
nie je PASS, ale ticho.

**OVERENIE — 2. krok, živý computed style.** Nečakaj fixný čas, **čakaj na obsah**:
`/api/journal` a `/api/dashboard` bežia 3–4 s a pri kratšom spánku sa meria skeleton.
```js
// pre každú obrazovku: klik na rail → čakaj, kým .screen.active má položky → meraj
const probe = {'.day-head':'13px','#header-metrics':'13px','.kpi-sub':'13px',
  '.tag':'12px','.cert':'12px','.heat-months':'11px','.rail-eyebrow':'10px'};
JSON.stringify(Object.entries(probe).map(([s, exp]) => {
  const el = document.querySelector(s);
  if (!el) return [s, 'CHÝBA V DOM'];
  const c = getComputedStyle(el);
  return [s, c.fontSize, exp, c.lineHeight];
}));
// každý riadok: fontSize === exp AND lineHeight !== 'normal'
```

**ČO SA MÔŽE ROZBIŤ.**
1. **`.day-head` 10 → 13 px je +30 % a je to hlavička dňa v Denníku** — sticky
   hlavička skupiny. Ak má `position: sticky` a fixnú výšku, obsah pod ňou sa
   podsunie. Skontroluj výšku, nie len veľkosť písma.
2. **`.lib-skill-meta` je `nowrap` + `overflow: hidden` a rez sa priznáva cez
   `data-more`.** Zdvih `::after` z 11 na 12 px zmení, koľko čipov sa zmestí — teda
   **zmení číslo, ktoré karta hlási**. Číslo skládá klient **aj** server
   (`tags_more`); ak sa po zdvihu prestanú sčítavať, karta bude hlásiť menej než je
   pravda. Toto je jediné miesto v T2, kde zmena veľkosti mení **dáta**, nie vzhľad.
3. **`#header-metrics` je vo hlavičke s `--header-h: 44px`** a má
   `flex: 0 0 auto` — nesmie tlačiť `.h-center`. 13 px mono s `--ls-mono` je širšie;
   na 1280 px over, že breadcrumb nezalomí.
4. **`.heat-months` a `.dtl-month`** sú osi s pevným krokom mriežky. 10 → 11 px môže
   spôsobiť prekryv popiskov; ak áno, os musí ukázať menej popiskov, nie menšie písmo.
5. **`.queue-meta`, `.run-*`, `.dtl-*` sú v zoznamoch po stovkách riadkov.** Zmena
   výšky riadka × 100 je zmena výšky stránky; over, že „Načítať ďalších" v Kontrole
   ostane dosiahnuteľné a že sa nezmenil počet riadkov na obrazovku tak, že
   klávesový kurzor (`kontrolaState.idx`) skáče mimo viewport.
6. **Doplnenie `line-height` je najväčší zdroj tichého posunu rozloženia v celom
   redizajne** (sonda A §1.3: 205 deklarácií dnes prokládku nedeklaruje). Preto:
   **výmena stylesheetu nad TÝM ISTÝM DOM** (`w8/cssswap.js`), nie dve načítania.
   Hades je živý a medzi dvoma načítaniami sa naučí uzly. Harness kalibruj
   A/B/A/B s dosadnutím (dva rámce + 250 ms) a počítaj len to, čo je stabilné
   v oboch — jeho prvá verzia hlásila 96 110 „stabilných" rozdielov, ktoré boli
   rozbehnuté prechody.

---

### T3 · Jeden chybový komponent (rozhodnutie 16, časť pre `/`)

**ČO.** Do bloku EMPTY STATE (`mind.css:2394+`, za `.empty .hint`) pridaj:

```
.empty .title      — Geist, --fw-heading, --fs-title (16px), --ls-heading, color: var(--text)
.empty--error .ms  — color: var(--danger); opacity: 1
.empty--filter .ms — color: var(--muted);  opacity: .5   (dedí základ, deklaruj len ak sa líši)
.empty .empty-act  — akcia; kreslí sa ako existujúce `button`, len s margin-top: var(--sp-1)
```

Pravidlá, ktoré musia platiť a sú dôvodom, prečo je to modifikátor a nie nový základ:

- `.empty--error` **nededí** `.empty-network` — tá je `position: fixed; inset: 0;
  pointer-events: none` a je to hero nad plátnom pri páde štartu. Chyba v karte
  obrazovky nesmie byť fixed.
- `.ms` v `--danger` je **grafika s prahom 3:1**, nie text. Precedens je zapísaný:
  `.empty-network .ms` má na svetlom papieri 4,02:1 a na tmavej 6,65:1
  (`mind.css:2666–2672`). Text chyby ide vždy cez `--text` / `--muted`, nikdy cez
  `--danger` — v `--danger-ink` má appka pre text 16 volajúcich a rovnaká hodnota
  ako plocha by v texte spadla pod prah.
- `.empty-act` **nedeklaruje vlastný fokusový prsteň.** Jeden globálny
  `:focus-visible` (0-1-0) je v RESET & BASE a per-komponentné pravidlo sa pridáva
  len vtedy, keď nesie **niečo iné** než prsteň.

**OVERENIE.** Vynúť chybu bez zmeny servera:
```js
// 1. zablokuj jeden endpoint
window.__orig = window.fetch;
window.fetch = (u, o) => String(u).includes('/api/journal')
  ? Promise.reject(new Error('harness')) : window.__orig(u, o);
// 2. prekresli obrazovku
document.querySelector('#rail .dest[data-screen="dennik"]').click();
```
o rámec neskôr:
```js
const e = document.querySelectorAll('#screen-dennik .empty--error');
const b = document.querySelector('#screen-dennik .empty--error .empty-act');
JSON.stringify({
  pocet: e.length,                                    // === 1
  title: e[0] && e[0].querySelector('.title').textContent,
  fixed: e[0] && getComputedStyle(e[0]).position,     // !== 'fixed'
  akcia: !!b,                                         // === true
  akciaKlikatelna: b && getComputedStyle(b).pointerEvents, // 'auto'
  ikonaFarba: e[0] && getComputedStyle(e[0].querySelector('.ms')).color,
  loading: document.querySelectorAll('#screen-dennik .empty-loading').length // === 0
});
```
Potom `window.fetch = window.__orig` a klik na `.empty-act` → obsah sa vráti.

**ČO SA MÔŽE ROZBIŤ.**
1. `.screen .empty { min-height: 220px; justify-content: center }` platí aj na
   `.empty--error`. Ak chyba padne **vnútri karty** (napr. `dnes.js:79` — čiastočný
   pád, ktorý hlási len tú časť, čo padla), 220 px vysoká chyba roztrhne mriežku
   dashboardu. `dnes.js:79` je vzorové riešenie čiastočného pádu a **nesmie sa
   zhoršiť** — potrebuje kompaktnú variantu bez `min-height`.
2. `.empty--error` a `.empty--hero` sú oba modifikátory `.empty` a `.empty--hero`
   ruší `align-items`, `text-align`, `padding` aj `gap`. Ak sa niekedy zložia na
   jednom prvku, poradie v zdroji rozhodne — nikdy ich nekombinuj.
3. Ikona v `--danger` na **svetlej** téme: merač kontrastu má dve pasce, obe dávajú
   falošný PÁD. Pozadie treba **skládať** (vrstvy od prvku nahor po prvú
   nepriehľadnú, potom alfa kompozícia zdola) a po prepnutí témy nechať **dosadnúť**
   (prepni v jednom volaní, meraj v ďalšom). Kalibruj na `body` (~16:1).

---

### T4 · Skeleton v tvare obsahu (rozhodnutie 15)

**ČO.** Do sekcie SHIMMER SKELETON (`mind.css:3905+`) pridaj rodinu `.skel*` zo §1.2.
Mechanika: **jeden sweep cez `::after`** (translateX), rovnaká ako dnešná
`.shimmer` — nie druhá mechanika. Perióda z `--dur-pulse` (1,4 s), **nie ručne
napísané `1.4s`**: dnes existujú tri periódy pre jeden význam „neurčité čakanie"
(1,1 / 1,2 / 1,4 s) a štvrtá nesmie pribudnúť.

Rozmery drží CSS, nie volajúci:
```
.skel        { background: var(--surface-raised); border-radius: var(--r-md); position: relative; overflow: hidden }
.skel::after { animation: hades-shimmer var(--dur-pulse) infinite }
.skel-line   { height: 1em; }               /* dedí font-size kontextu */
.skel-line--half  { width: 50% }
.skel-line--short { width: 30% }
.skel-block  { height: var(--skel-h, 58px) }
.skel-card   { height: var(--skel-h, 160px); border-radius: var(--card-radius); }
.skel-list   { display: flex; flex-direction: column; gap: var(--gutter) }
```
`--surface-raised` má dnes **jediného volajúceho** (`.shimmer`) — po T4 ho má rodina
`.skel`, čím token prestáva byť osamelý.

**Tichá verzia (rozhodnutie 8) — v tom istom `@media` bloku:**
```
@media (prefers-reduced-motion: reduce) {
    .skel::after { display: none !important }
}
```
Nie `animation: none`. Zastavená animácia nechá sweep **zamrznutý v polovici plochy**,
takže skeleton vyzerá ako rozbitý gradient. Zmysluplný okamžitý ekvivalent je
**pokojná zdvihnutá plocha bez lesku** — plocha stále hlási „tu bude obsah", len
bez pohybu. `!important` a trieda sú tu nutné, viď T7.

**OVERENIE.** Zmraz endpoint (nie odmietni):
```js
window.__orig = window.fetch;
window.fetch = (u, o) => String(u).includes('/api/journal')
  ? new Promise(() => {}) : window.__orig(u, o);
document.querySelector('#rail .dest[data-screen="dennik"]').click();
```
o rámec neskôr:
```js
const s = document.querySelectorAll('#screen-dennik .skel');
JSON.stringify({
  skeletonov: s.length,                                              // > 0
  dychajucichZnakov: document.querySelectorAll('#screen-dennik .empty-loading').length, // === 0
  vyskaPrveho: s[0] && Math.round(s[0].getBoundingClientRect().height),
  sweep: s[0] && getComputedStyle(s[0], '::after').animationName,    // 'hades-shimmer'
  perioda: s[0] && getComputedStyle(s[0], '::after').animationDuration // '1.4s'
});
```
**Tvar sa overuje porovnaním, nie okom:** zapamätaj si výšku `#journal-list`
so skeletonom, potom nechaj dáta dobehnúť a zmeraj znova. Rozdiel je CLS skok,
ktorý má skeleton odstrániť; cieľ je < 10 % výšky.

**ČO SA MÔŽE ROZBIŤ.**
1. **`.skel-line { height: 1em }` dedí `font-size` z rodiča** — a T2 práve zmenil
   `font-size` desiatok selektorov. Ak I2 vloží `.skel-line` do kontejnera bez
   deklarovanej veľkosti, výška skeletonu bude iná než výška reálneho riadka a CLS
   skok zostane. Kontejner musí mať `font-size` z tokenu.
2. `overflow: hidden` na `.skel` a `position: relative` — ak sa `.skel` použije ako
   obal pre skutočný obsah (nemá), obsah sa oreže.
3. Skeleton pod 300 ms je **blik**. Playbook `skills/design/ui-motion-transitions.md`
   to hovorí priamo: „Nezačni spinner pri každom sub-100 ms requeste, ak by iba
   blikal." Kresba to nevyrieši — je to úloha I2 (T13).

---

### T5 · Sklo len na tmavej — štvrtý prepínateľný token

**ČO.** Rozhodnutie 22+25 je formulované absolútne, ale **tri z dvanástich
`backdrop-filter` deklarácií rozostrujú na oboch témach**, pretože čítajú blur
primitív priamo namiesto prepínateľného tokenu (merané, sonda A §2.2):

| Riadok | Selektor | Dnes |
|---|---|---|
| 2103 | `#help-overlay` | `var(--blur-scrim)` = 4 px |
| 2150 | `#md-overlay` | `var(--blur-scrim)` = 4 px |
| 3437 | `#cmdk` | `var(--blur-1)` = **6 px** |

**Koordinátorovo rozhodnutie (sonda A otvorená otázka 3):** sú to **scrimy pod
modálom, nie panely** — rozostrenie tam nesie „pod tým je obsah, ktorý teraz
nečítaš". Je to teda **pomenovaná výnimka, nie chyba**. Zaveď štvrtý prepínateľný
token vedľa `--glass-blur*`:

```
:root                    { --scrim-blur: none }              /* svetlá */
:root[data-theme="dark"] { --scrim-blur: var(--blur-scrim) }  /* tmavá */
```
a všetky **tri** miesta preveď na `var(--scrim-blur)`. `#cmdk` tým stráca 6 px
a dostane 4 px — dve hodnoty pre jednu rolu prestanú existovať.

Manuál to už hovorí ako záväzné pravidlo (§ Hĺbka) — kód sa k nemu dotahuje, nie naopak.

**OVERENIE.** Prepni v jednom volaní, meraj v ďalšom (CSS prechod musí dosadnúť):
```js
// volanie 1
document.documentElement.setAttribute('data-theme', 'light');
// volanie 2
JSON.stringify(['help-overlay','md-overlay','cmdk'].map(id => {
  const el = document.getElementById(id);
  return [id, el ? getComputedStyle(el).backdropFilter : 'CHÝBA'];
}));
// svetlá: všetky 'none'
// po prepnutí na 'dark': všetky 'blur(4px)'
```

**ČO SA MÔŽE ROZBIŤ.** `#cmdk` je paleta Ctrl+K a je nad **plátnom grafu**. Na
tmavej téme presvitá utlmený graf pod obsahom; na svetlej je plátno mimo Grafu
skryté práve preto, že pod poloprehľadnými chipmi tam kontrast textu závisel od
obsahu grafu. Ak sa `#cmdk` na svetlej téme prestane rozostrovať, jeho podklad je
buď plný panel (v poriadku) alebo priesvitný scrim nad bielym papierom
(v poriadku) — ale **over to, nespoliehaj sa**: je to jediné miesto, kde sa mení
priehľadnosť nad plátnom.

---

### T6 · Jeden jazyk osi, mriežky a legendy grafov (rozhodnutie 23)

**ČO.**
1. Pridaj `.chart-axis` (§1.2): `font-family: var(--mono)`, `font-size:
   var(--fs-chart-axis)`, `line-height: var(--lh-chart-axis)`,
   `letter-spacing: var(--ls-mono)`, `color: var(--muted)`,
   `display: flex; justify-content: space-between; margin-top: var(--sp-0h)`.
   Kresba je **presne** to, čo dnes stojí inline v `charts.js:484` — s jedinou
   zmenou: 10 px → `--fs-chart-axis` (11 px).
2. Heatmapová rampa `--heat-1..4` (`mind.css:435–438`) v manuáli **nebola vôbec**.
   Manuál ju už má; hodnoty **sa nemenia** (rozhodnutie 2). Skontroluj len, že
   `--heat-4 #8734cf` naozaj drží nameraných 5,63:1, a čísla zapíš do reportu.
3. Legendy troch grafov (`.heat-legend`, `.cert-legend .cl-row`, `.dbar-head`)
   idú cez tokeny z T2, nie cez vlastné veľkosti — už sú v zozname.

**OVERENIE.**
```js
const a = document.querySelector('.chart-axis');
const c = a && getComputedStyle(a);
JSON.stringify(a ? {
  fs: c.fontSize,           // '11px'
  ff: c.fontFamily,         // obsahuje 'Geist Mono'
  ls: c.letterSpacing,
  inline: a.getAttribute('style')   // === null  ← žiadny inline rozmer
} : 'CHÝBA');
```
Druhá asercia, ktorá dokazuje, že inline rozmer naozaj odišiel:
```js
[...document.querySelectorAll('#screen-dnes [style]')]
  .filter(el => /font-size/.test(el.getAttribute('style'))).length   // === 0
```

**ČO SA MÔŽE ROZBIŤ.** `.chart-axis` je nová trieda, ale kreslí prvok, ktorý dnes
nemá **žiadnu** triedu (`el('div')` v `charts.js:481`). Ak I2 triedu nepridá,
CSS je mŕtve a asercia hlási `CHÝBA` — to je správne PADNUTIE, nie falošný poplach.
T6 a T14 musia landnúť spolu.

---

### T7 · Tichá verzia namiesto plošného vypínača — len pre pohyb, ktorý sa mení

**ČO.** Sonda A §3.3 je najdôležitejší architektonický nález celého redizajnu:
`mind.css:2728–2736` je plošné `*, *::before, *::after { … !important }` a
**`!important` na `*` znamená, že žiadne per-komponentné pravidlo nemôže deklarovať
vlastný zmysluplný okamžitý ekvivalent.** Rozhodnutie 8 je s tým pravidlom
v priamom konflikte.

Merané: **11 animácií a 53 prechodov má tichú verziu JEDINE cez toto pravidlo.**
Jeho zrušenie by odobralo tichú verziu **64 pohybom naraz**.

**Koordinátorovo rozhodnutie (sonda A otvorená otázka 2).** Plošné pravidlo
**zostáva ako podlaha**, `!important` sa **neodstraňuje**, a nič sa z neho nevyhadzuje.
Namiesto toho sa zavádza **vzor, ako ho legálne prebiť**, a vlna 1 ho aplikuje
výhradne na pohyb, ktorého sa dotýka:

> Tichá verzia = pravidlo **v tom istom `@media (prefers-reduced-motion: reduce)`
> bloku**, so selektorom aspoň triedovej špecificity, s `!important` na tých
> vlastnostiach, ktoré sa majú líšiť.

Mechanika, ktorú treba poznať, aby to niekto „neopravil": `!important` deklarácie
medzi sebou súťažia **špecificitou**. Plošné pravidlo je `*` = 0-0-0. `.skel::after`
je 0-1-0. Preto `.skel::after { display: none !important }` vyhrá, kým bez
`!important` by prehralo. Odstránenie `!important` z plošného pravidla by ho naopak
zhodilo na 0-0-0 **bez** `!important`, teda by prehralo s **každým** komponentným
pravidlom — a to je práve tých 64 pohybov.

Vo vlne 1 dostanú pomenovanú tichú verziu presne tri veci:

| Pohyb | Dnes v reduce | Vlna 1 |
|---|---|---|
| `.skel::after` sweep | (nový) | `display: none !important` — pokojná plocha, nie zamrznutý gradient |
| `.empty.empty-loading .load-mark` (`mind.css:2607`) | `animation: none` | doplň `transform: none !important`, aby prstenec stál na plnej mierke, nie v spodnej fáze dýchania |
| `hades-shimmer` na `.shimmer` (`mind.css:3926`) | `animation: none` | ponechať bez zmeny — `.shimmer` odchádza vo vlne 2 |

**Plný audit 64 pohybov je vlna 3** (§7). Vlna 1 zavádza vzor, nie revíziu.

**OVERENIE — nad CSSOM, nezávisle od schopnosti emulovať preferenciu:**
```js
function reduceBlock() {
  const out = [];
  for (const sh of document.styleSheets) {
    let rs; try { rs = sh.cssRules } catch (e) { continue }
    for (const r of rs) {
      if (r.type === CSSRule.MEDIA_RULE && /prefers-reduced-motion/.test(r.conditionText)) {
        for (const q of r.cssRules) out.push([sh.href.split('/').pop(), q.cssText]);
      }
    }
  }
  return out;
}
JSON.stringify(reduceBlock());
// musí obsahovať: pravidlo pre `*, *::before, *::after` s !important (podlaha stojí)
// a pravidlo `.skel::after` s `display: none !important`
```
Kalibrácia: v návratovej hodnote musí byť aj dnešný `.empty.empty-loading .load-mark`.
Ak tam nie je, funkcia neprešla `mind.css` a prázdny výsledok nič nedokazuje.

**ČO SA MÔŽE ROZBIŤ.** Toto je jediná téma vo vlne 1, kde nesprávna oprava je
**horšia než žiadna**: každé „upratanie" plošného pravidla (`:where(*)`, `0s`,
odstránenie `!important`) vypne tichú verziu 64 pohybom a nikto si to nevšimne,
pretože sa to prejaví len u človeka, ktorý má preferenciu zapnutú. Komentár nad
pravidlom musí to číslo (64) obsahovať.

---

### T8 · Ikonový fallback — jedno slovo, ktoré drží celú plochu `/`

**ČO.** `mind.css:887–889` deklaruje `.ms { font-family: 'Material Symbols Rounded' }`
**bez fallbacku** a **bez `font-feature-settings: 'liga'`**. `console.css:1277`
aj `chat.css:98` majú `…, sans-serif` a `liga` — a ich komentáre doslova priznávajú
„mind.css fallback nemá".

Doplň `, sans-serif` a `font-feature-settings: 'liga'`. Keď subset zhavaruje, na
ploche s 8 destináciami v raile, breadcrumbom a grafovými nástrojmi sa dnes každá
ikona vykreslí ako **surový ligatúrový názov v pätkovom fallbacku** — presne tá
porucha, kvôli ktorej z projektu odišlo Google Fonts CDN.

**OVERENIE.**
```js
const c = getComputedStyle(document.querySelector('#rail .ms'));
JSON.stringify({ ff: c.fontFamily, feat: c.fontFeatureSettings });
// ff musí končiť na 'sans-serif'; feat musí obsahovať 'liga'
```

**ČO SA MÔŽE ROZBIŤ.** Nič — ikonová sada vo vlne 2 `.ms` ruší celú. Dovtedy je
toto poistka, ktorú stojí za to mať aj jeden týždeň.

---

### T9 · Serif dostáva druhú rolu (rozhodnutie 3)

**ČO.** Dnes: `var(--serif)` má **1 deklaráciu** proti 86 deklaráciám
`var(--mono)`, na jedinom prvku na jednej obrazovke (`.hero-val`,
`mind.css:3994`, kreslené v `dnes.js:178`). Cena je **59 544 B woff2** a
`latin-ext` sa načíta vždy (slovenská diakritika).

Manuál je prepísaný a hovorí: **serif nesie dve veci — jedno primárne číslo
obrazovky a titulok obrazovky.** Preto:

1. `.screen-head h1` (`mind.css:3287`) → `font-family: var(--serif)`,
   `font-weight: 600` (nie `--fw-heading` 660 — Playfair je vysokokontrastný a 660
   je hodnota ladená pre Geist), `letter-spacing: 0` (nie `--ls-heading` −.025em —
   negatívne prostrkanie na serife zlepuje pätky).
2. `.hero-val` **zostáva** nezmenená.
3. **Komentáre na `mind.css:3279–3285` a `3983–3990` treba PREPÍSAŤ, nie zmazať.**
   Oba dnes hovoria „serif tu bol a odišiel, pretože manuál §4 hovorí *len hero
   metriky*". Manuál to už nehovorí. Nový komentár musí povedať, čo platí teraz
   **a že je to zmena predchádzajúceho rozhodnutia, nie jeho prehliadnutie** —
   inak tretia session serif odstráni znova.
4. `resources/views/mind.blade.php` riadky 28–37: pridaj preload
   `playfair-display-latin.woff2`, `playfair-display-latin-ext.woff2` a
   `geist-mono-latin.woff2`.

**Prečo aj mono:** `/` je plocha s 86 deklaráciami `var(--mono)` (breadcrumb,
metriky hlavičky, všetky čísla kariet, KPI, časy, cesty) a Geist Mono na nej
**preloadovaný nie je**, kým na `/console` a `/chat` áno. Tretí preload je na `/`
použitý na `geist-latin-ext` namiesto mono.

Rozpočet hlavičky, aby sa to nemuselo hádať:

| | Dnes | Po T9 | Po vlne 2 (Material Symbols odchádza) |
|---|---|---|---|
| material-symbols-rounded-subset | 132 196 | 132 196 | **0** |
| geist-latin | 29 400 | 29 400 | 29 400 |
| geist-latin-ext | 16 512 | 16 512 | 16 512 |
| geist-mono-latin | — | 23 128 | 23 128 |
| playfair-display-latin | — | 38 404 | 38 404 |
| playfair-display-latin-ext | — | 21 140 | 21 140 |
| **Σ** | **178 108** | **260 780** | **128 584** |

Preload rastie o 82 672 B na jednu vlnu a potom padá o 50 kB **pod** dnešný stav.
Toto je vedomý dočasný účet, nie prehliadnutie.

**Prečo obe podmnožiny Playfairu:** titulky obrazoviek sú slovenské — `Knižnica`
má `ž` (U+017E), teda `latin-ext`. Preload len jednej by nechal titulok skočiť
z Georgie do Playfairu po dobehnutí druhého súboru, čo je presne ten blik, ktorý
sa rieši. `font-display: swap` na Playfaire zostáva (`mind.css:75`) — `block`
by na titulku obrazovky nechal prázdne miesto.

**OVERENIE.**
```js
JSON.stringify({
  h1: getComputedStyle(document.querySelector('.screen.active .screen-head h1')).fontFamily,
  h1w: getComputedStyle(document.querySelector('.screen.active .screen-head h1')).fontWeight,
  h1ls: getComputedStyle(document.querySelector('.screen.active .screen-head h1')).letterSpacing,
  hero: document.querySelector('.hero-val') &&
        getComputedStyle(document.querySelector('.hero-val')).fontFamily,
  serifDeklaracii: (() => { let n = 0;
    for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules } catch(e){ continue }
      (function w(l){ for (const r of l) { if (r.cssRules) w(r.cssRules);
        else if (/var\(--serif\)/.test(r.style && r.style.fontFamily || '')) n++ } })(rs) }
    return n; })(),                      // === 2
  preload: [...document.querySelectorAll('link[rel="preload"][as="font"]')]
             .map(l => l.href.split('/').pop())    // 6 súborov, viď tabuľka
});
```
Kontrast titulku premeraj znova: Playfair má tenšie tahy než Geist pri rovnakej
váhe, takže **rovnaká farba nemusí dať rovnaký pár**. Manuál §9 žiada „nezhoršiť
žiadny pár oproti predchádzajúcemu stavu".

**ČO SA MÔŽE ROZBIŤ.**
1. **`.empty.empty-network .title` a `.empty--hero` NESMÚ dostať serif.** Ich
   komentáre na `mind.css:2674–2680` to zdôvodňujú tým, že je to **chybová
   hláška** a mýtické písmo v texte, ktorý má človek použiť na opravu chyby, manuál
   zakazuje. `.empty .title` z T3 je z tej istej rodiny — Geist.
2. `--fs-h1` je 28 px a je **mimo škály zámerne**. Playfair na 28 px je opticky
   menší než Geist na 28 px (menšia x-výška). Ak sa titulok bude zdať drobný,
   správna reakcia je zdvihnúť `--fs-h1`, nie pridať váhu — Playfair pri 700+
   zhustne a na tmavej téme zaleje.
3. `.screen-head h1` je na 8 obrazovkách. Ak niektorá má titulok na dva riadky
   pri 1280 px, prokládka 1.2 na serife bude tesná.

---

## 4. IMPLEMENTÁTOR 2 — `util.js`, `screens/*.js`, `structure.js`, `charts.js`

### T10 · Nové API prázdnych a chybových stavov (`util.js`)

**ČO.** Implementuj §1.3. Kľúčové body, ktoré nie sú v podpise vidieť:

- `errorHtml(subject, hint)` skládá vetu **v helperi**: `'<Subject> sa nepodarilo
  načítať'` s prvým veľkým písmenom z `subject`. Volajúci posiela `'denník'`,
  `'knižnicu'`, `'behy'`, `'frontu'`, `'rozhodnutia'`, `'prehľad'`, `'štruktúru'`,
  `'duplicity'`, `'dokument'`. Default `hint`: `'Server neodpovedá — skús to znova.'`
- `renderError` **musí** pripojiť listener, nie `onclick`. Pod `script-src 'self'`
  bez `unsafe-inline` je inline handler mŕtvy a navyše by zneplatnil zmeraný
  komentár v `ContentSecurityPolicy.php:100–103`.
- Akcia v `.empty-act` je **jedna** (rozhodnutie 14). Ak sa niekde ponúkajú dve,
  je to znak, že prázdny stav nevie, čo je jeho jedna cesta ďalej.
- `renderFilterEmpty(container, text, hint, clear)` — `clear` je funkcia, ktorá
  zruší filter. Toto je jediné miesto, kde prázdny stav **mení stav appky**.

**OVERENIE.** Modul musí byť naozaj načítaný a helper musí naozaj niečo pripojiť:
```js
// v Browser pane: read_network_requests na /js/mind/util.js → 200
// a potom, po vynútenej chybe (T3):
const b = document.querySelector('.empty--error .empty-act');
JSON.stringify({ jeButton: b && b.tagName, type: b && b.type,
                 nemaOnclick: b && b.getAttribute('onclick') === null });
```

**ČO SA MÔŽE ROZBIŤ.** `emptyHtml` volá **päť modulov, ktoré vlna 1 nevlastní**
(`cmdk.js:258`, `md.js:118`, `panels.js:89/105/128`, `charon.js:687`, `pack.js`).
Zmena poradia alebo významu prvých troch parametrov ich rozbije **ticho** — vykreslí
sa nesprávny text alebo `undefined`. Preto je `action` štvrtý a preto sa `emptyHtml`
nesmie prepísať na objektový argument.

---

### T11 · Jeden chybový komponent na šiestich obrazovkách

**ČO.** Nahraď všetkých 11 chybových call-site `renderError(...)`:

| Súbor:riadok | Dnes | Nové |
|---|---|---|
| `dnes.js:52` | `renderEmpty(body,'cloud_off','Nepodarilo sa načítať prehľad','Skús obnoviť stránku.')` | `renderError(body,'prehľad', renderToday)` |
| `dnes.js:79` | `emptyHtml('cloud_off','Súhrnné čísla…')` | `errorHtml('súhrnné čísla', …)` — **kompaktná varianta v karte**, nechaj priznanie „Zvyšok obrazovky je aktuálny" |
| `dennik.js:59` | `renderEmpty(list,'cloud_off',…)` | `renderError(list,'denník', renderJournal)` |
| `kniznica.js:107` | `renderEmpty(body,'cloud_off',…)` | `renderError(body,'knižnicu', renderLibrary)` |
| `kontrola.js:102` | `renderEmpty(…,'cloud_off',…)` | `renderError(…,'frontu', renderKontrola)` |
| `rozhodnutia.js:69` | `renderEmpty(body,'cloud_off',…)` | `renderError(body,'rozhodnutia', renderDecisions)` |
| `runy.js:50` | `renderEmpty(body,'cloud_off',…)` | `renderError(body,'behy', renderRuns)` |
| `smernica.js:174` | `renderEmpty(suggest,'cloud_off','Nepodarilo sa poskladať smernicu','Skús to znova.')` | `renderError(suggest,'smernicu', runDirectiveBuild)` |
| `smernica.js:322` | `emptyCardHtml('Uložené smernice sa nepodarilo načítať.')` | `errorHtml('uložené smernice', …)` — **chyba sa dnes kreslí ako prázdno**, čo je najtichšie priznanie v appke |
| `structure.js:69` | `renderEmpty(wrap,'cloud_off','Nepodarilo sa načítať')` | `renderError(wrap,'štruktúru', …)` — **dnes bez predmetu aj bez rady** |
| `structure.js:195` | `renderEmpty(wrap,'cloud_off','Nepodarilo sa načítať')` | `renderError(wrap,'duplicity', …)` — to isté |

`md.js:118` **nechaj** — `md.js` vlna 1 nevlastní.

**Dve kresby, ktoré sa NEMIGRUJÚ, a je to rozdiel v role, nie prehliadnutie:**

- **`.run-error`** (`mind.css:5158`, `runy.js:224`) nevykresľuje pád fetchu, ale
  **chybový text, ktorý vydal samotný beh**. Je to obsah záznamu, nie stav plochy.
  Zliať ho s `.empty--error` by znamenalo tvrdiť, že sa nepodarilo načítať beh,
  hoci beh sa načítal a hlási svoju vlastnú chybu.
- **`.toast.error`** (`mind.css:3893`, `http.js:31`) je prechodné oznámenie akcie,
  nie stav plochy. Toast naviac nesmie byť **jediným** nositeľom kritickej chyby —
  chyba pri načítaní žije v `.empty--error` pri zdroji, toast len pri akcii.

**OVERENIE.** Pre každú zo šiestich obrazoviek zopakuj slučku z T3 (patchni `fetch`,
klikni na rail, zmeraj) a k tomu jedna súhrnná asercia, že iná kresba chyby na `/`
nezostala:
```js
JSON.stringify({
  cloudOffBezErroru: [...document.querySelectorAll('#screens .ms')]
    .filter(m => m.textContent === 'cloud_off' && !m.closest('.empty--error')).length, // === 0
  chybaVKarte: document.querySelectorAll('#screens .card-empty').length // len skutočné prázdna
});
```

**ČO SA MÔŽE ROZBIŤ.**
1. **`dnes.js:79` je vzorové riešenie čiastočného pádu** — hlási len tú časť
   obrazovky, ktorá padla, a **priznáva to** vetou „Zvyšok obrazovky je aktuálny".
   To je jediné miesto v appke, ktoré takto hovorí, a zjednotenie ho nesmie
   zošúchať na generickú vetu.
2. `kontrola.js:102` má **dva ciele** (`soft && $('kontrola-list')` alebo `body`)
   podľa toho, či ide o filtrovanie nad už vykresleným zoznamom, alebo o prvé
   načítanie. Ak `renderError` dostane vždy `body`, filtrovanie zmaže celú obrazovku.
3. `retry` nesmie byť funkcia, ktorá **znova prečíta stav z DOM, ktorý práve zmizol**.
   `renderKontrola` číta `kontrolaState`, nie DOM — over to pri každom z desiatich.
4. Sonda A §5.3 preverila, že **ani jedna `catch` vetva dnes nehlási prázdno namiesto
   chyby.** To je invariant projektu a T11 ho musí nechať platiť: po zmene znovu
   over, že padnutý fetch nikdy nedá „Zatiaľ žiadne záznamy".

---

### T12 · Prázdny stav učí a ponúka jednu akciu (rozhodnutie 14)

**ČO.** Dnes je **jediný** prázdny/chybový stav v celej appke s klikateľnou akciou
(`.empty.empty-network`, `main.js:24–33`). Ostatných 24 ponúka najviac vetu.

Doplň akciu tam, kde akcia **existuje**, a nikde inde:

| Miesto | Dnes | Nové |
|---|---|---|
| `dennik.js:134` | „Žiadne záznamy pre tento projekt" / „Zruš filter a uvidíš celý denník." | `renderFilterEmpty` + akcia **Zruš filter** (`journalProject = null; renderJournal()`) |
| `kontrola.js:140` | „Filtru nevyhovuje ani jeden uzol" | `renderFilterEmpty` + akcia **Zruš filter** |
| `runy.js:177` | `emptyCardHtml('Tomuto filtru neodpovedá žiadny beh.')` | `filterEmptyHtml` + akcia **Zruš filter** |
| `kniznica.js:129` | veta | akcia podľa toho, či je aktívny `q`/`areaSlug`: **Zruš hľadanie** |
| `rozhodnutia.js:202` | veta | to isté (`year`/`areaId`/`q`) |
| `smernica.js:186` | „Nič relevantné sa nenašlo" / „Opíš úlohu inými slovami." | ponechať bez akcie — akcia je „prepíš pole", a to nie je tlačidlo |
| `cmdk.js:258` | „Nič sa nenašlo" bez rady | **nevlastníme** — vlna 3 |

Prázdne stavy **bez filtra** (`dennik.js:135`, `kontrola.js:141`, `runy.js:76`,
`structure.js:37`) dostanú tvar „čo to je / prečo je prázdne / čo bude ďalej",
**ale nedostanú tlačidlo** — nie je čo kliknúť. `runy.js:76` je dnes vzor toho
tvaru („Konzola ešte nič nebežala" / „Otvor Charóna a zadaj úlohu — každý ťah sa
tu objaví so svojou cenou.") a slúži ako referencia pre ostatné.

**Rozdiel `.empty--filter` vs obyčajné `.empty` je informácia, nie kozmetika:**
„nič tu nie je" a „tvoj filter to skryl" sú dve rôzne správy a dnes vyzerajú
rovnako. To je aj dôvod, prečo `.empty--filter` má vlastnú triedu.

**OVERENIE.**
```js
// Denník s filtrom, ktorý nič nedá
document.querySelector('#rail .dest[data-screen="dennik"]').click();
// … nastav filter na projekt bez záznamov, potom:
const e = document.querySelector('#screen-dennik .empty--filter');
const b = e && e.querySelector('.empty-act');
JSON.stringify({ jeFilter: !!e, maAkciu: !!b, label: b && b.textContent });
b.click();
// o rámec neskôr: .empty--filter zmizne a zoznam má položky
```
Súhrnná asercia hustoty akcií (nesmie ich byť viac než jedna na stav):
```js
[...document.querySelectorAll('#screens .empty')]
  .map(e => e.querySelectorAll('.empty-act').length)
  .filter(n => n > 1).length     // === 0
```

**ČO SA MÔŽE ROZBIŤ.** Existujúce `prune*()` funkcie robia **presne to isté
gesto automaticky**: `pruneLibraryArea()` (`kniznica.js:114`),
`pruneDecisionFilters()` (`rozhodnutia.js:97`), `pruneRunFilters()` (`runy.js:66`),
a `dennik.js:52–56` ruší filter, ktorý v skupinách zo servera už nie je. Ak sa
pridá tlačidlo „Zruš filter" tam, kde `prune*` filter už zrušil, vznikne prázdny
stav **s tlačidlom, ktoré nič nerobí**. Akciu ponúkaj len vtedy, keď filter je
platný a naozaj skrýva dáta.

---

### T13 · Skeleton v tvare obsahu na šiestich obrazovkách (rozhodnutie 15)

**ČO.** Dnes: skeleton majú **2 miesta z 12** (`dnes.js:25–33` a `console/main.js:358`),
zvyšných 10 kreslí dýchajúci znak. **Denník je najhoršie:** `/api/journal` beží
3–4 s a `dennik.js:40` kreslí `renderLoading`.

| Súbor:riadok | Dnes | Nové |
|---|---|---|
| `dnes.js:25–33` | vlastný `todaySkeleton()` s inline `style="width…;height…"` | `renderSkeleton(body, 'dashboard')` — inline rozmery **von** |
| `dennik.js:40` | `renderLoading(list,'Načítava sa denník…')` | `renderSkeleton(list, 'list')` |
| `kniznica.js:91` | `renderLoading(body,'Načítavam knižnicu…')` | `renderSkeleton(body, 'cards')` |
| `rozhodnutia.js:59` | `renderLoading` | `renderSkeleton(body, 'cards')` |
| `runy.js:41` | `renderLoading` | `renderSkeleton(body, 'table')` |
| `kontrola.js:71/72` | `renderLoading` ×2 | `renderSkeleton(list \|\| body, 'list')` |
| `structure.js:12` | `renderLoading(wrap,'Načítava sa štruktúra…')` | `renderSkeleton(wrap, 'list')` |
| `structure.js:158` | `renderLoading(wrap,'Hľadajú sa duplicity…')` | **ponechať** `renderLoading` — hľadanie duplicit nemá tvar, ktorý sa dá predkresliť |
| `smernica.js:146` | `renderLoading(suggest,'Skladám kontext…')` | **ponechať** `renderLoading` — to isté, plus text sa mení (T15) |
| `md.js:107` | `renderLoading` | **nevlastníme** |
| `runy.js:273` | `emptyCardHtml('Načítavam beh…')` | `loadingHtml('Načítava sa beh…')` — **načítavanie sa dnes kreslí ako prázdno** |

**Nekresli skeleton pod ~300 ms.** Playbook `skills/design/ui-motion-transitions.md`:
skeleton pod 300 ms je blik, ktorý pôsobí pomalšie než ticho. Riešenie je jeden
`setTimeout(…, 300)`, ktorý sa zruší, keď odpoveď príde skôr — a **nie** obal
`.skel` okolo obsahu, ktorý potom prebliká.

**OVERENIE.** Slučka z T4 pre každú obrazovku, plus:
```js
// inline rozmery naozaj odišli z Dnes
document.querySelectorAll('#screen-dnes [style*="height"]').length   // === 0
// CLS: výška pred a po dobehnutí dát
```
A merací harness **nesmie byť kópiou formuly z kódu** — čítaj skutočné
`getBoundingClientRect()`, nie prepočet z `shape`.

**ČO SA MÔŽE ROZBIŤ.**
1. `kontrola.js:71/72` rozlišuje `soft` (filtrovanie nad vykresleným zoznamom) od
   prvého načítania. Skeleton pri `soft` **zmaže zoznam, ktorý tam už bol** — a to
   je regresia, nie zlepšenie. Pri `soft` sa má ponechať starý obsah.
2. `dnes.js` má skeleton, ktorý **kopíruje hierarchiu hotovej obrazovky** (hľadanie →
   hero → KPI mriežka → dve karty) a je to zámer napísaný v komentári na
   `dnes.js:22–24`. Prepis na `renderSkeleton(body,'dashboard')` musí tú hierarchiu
   udržať; ak ju `shape` nevie vyjadriť, `shape` je nesprávne navrhnutý.
3. Skeleton je `aria` diera. `console/main.js:78` pridáva k skeletonu
   `<p class="sr-only">Vlákna sa načítavajú…</p>` — rovnaké oznámenie musí mať
   každý nový skeleton, inak čítačka obrazovky nedostane nič.

---

### T14 · Os grafu prestane mať rozmer v JS

**ČO.** `public/js/charts.js:481–489` skládá os cez `el('div')` **bez triedy** a
nastavuje `axis.style.cssText` s `font-size:10px`. Nahraď:

```
const axis = el('div', 'chart-axis');
```
a `cssText` **zmaž celý** — `display`, `justify-content`, `font-family`,
`letter-spacing`, `color` aj `margin-top` prevzalo `.chart-axis` z T6.

**OVERENIE.** Asercie z T6, plus:
```js
document.querySelectorAll('.chart-axis').length > 0 &&
[...document.querySelectorAll('.chart-axis')].every(a => a.getAttribute('style') === null)
```

**ČO SA MÔŽE ROZBIŤ.** `charts.js` je **klasický skript, nie ES modul** — beží ako
IIFE a vystavuje `window.HadesCharts`. Nesmie doňho pribudnúť `import`/`export`;
`mind.blade.php:574` ho načítava bez `type="module"` a modulárny súbor by tam
ticho spadol. `el()` je jeho vlastný lokálny helper, nie import z `util.js`.

---

### T15 · Hlas — päť hlásení v prvej osobe

**ČO.** Manuál §1 hovorí, že Hades hovorí neosobne, a `util.js:512–515` to výslovne
cituje. Päť hlásení to porušuje a **dve z nich sú dva riadky od seba, pre tú istú
frontu**:

| Súbor:riadok | Dnes | Nové |
|---|---|---|
| `kniznica.js:91` | „Načítavam knižnicu…" | (skeleton, T13 — text zaniká) |
| `kontrola.js:72` | „Načítavam frontu…" | (skeleton, T13 — text zaniká) |
| `runy.js:41` | „Načítavam behy…" | (skeleton, T13 — text zaniká) |
| `runy.js:273` | „Načítavam beh…" | **„Načítava sa beh…"** |
| `smernica.js:146` | „Skladám kontext…" | **„Skladá sa kontext…"** |

T13 tri z piatich odstráni tým, že text zruší celý. Zostávajúce dva sú dva
reťazce. **Kontrola po T13:** `grep -rn "Načítavam\|Skladám\|Pamätám" public/js/mind/`
musí vrátiť 0 zásahov.

**ČO SA MÔŽE ROZBIŤ.** Nič. Je to päť reťazcov a nulové riziko — preto to patrí
do vlny 1 aj napriek nízkemu efektu: neskôr by sa na to zabudlo.

---

### T16 · Terminológia — len to, čo vlna 1 vlastní (rozhodnutie 20)

**ČO.** Manuál má teraz slovník Charóna (vlákno / beh / ťah / zápis). Vo vlne 1
sa zjednocuje **iba na obrazovke Runy a v Smernici**, pretože tie súbory vlastní I2:

- **„beh"** = jeden záznam v `runs` (má cenu, trvanie, stav). **„ťah"** = jedna
  výmena s modelom vnútri behu. Nezameniteľné.
- **„zápis"** = tool, ktorý mení pamäť alebo súbor a zaparkuje na bráne.
  **„uloženie"** = uloženie smernice do `/api/directives`. Dnes sa miešajú.
- Obrazovka Runy nesmie hovoriť „konverzácia", keď myslí „vlákno".

`grep -rn "konverzáci\|ťah\|beh" public/js/mind/screens/runy.js public/js/mind/screens/smernica.js`
a každý zásah porovnaj so slovníkom.

**ČO SA MÔŽE ROZBIŤ.** **Nič v `charon.js`, `chat/*` ani `console/*` sa nemení** —
tam žije väčšina rozporu a tie súbory vlna 1 nevlastní. Neúplné zjednotenie je
prijateľné; **tiché prepísanie cudzieho súboru nie.**

---

## 5. AKO SA VLNA OVERUJE — spoločný postup

1. **Over identitu preview servera, inak sú všetky čísla bezcenné.** Harness beží
   na `127.0.0.1:8091`; keď server zhasne, port prevezme cudzia appka a harness
   meria ju.
   ```
   curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'
   ```
   Musí vypísať `/js/mind/main.js`. Ak vypíše niečo iné, alebo hlavička odpovede
   obsahuje `X-Powered-By: PHP`, meriaš cudziu appku.
2. Appka je za `auth.ui`. **`?token=…` v URL nepoužívaj** — token by skončil
   v histórii prehliadača, v access logu a v transkripte session. Postav malý node
   proxy (~40 riadkov, len `http`), ktorý si token prečíta z `.env` sám a pridá ho
   ako hlavičku `X-Hades-Ui-Token`; daj mu `/__whoami` a `accept-encoding: identity`.
3. **Onboarding karta prekryje meranie.** Vypni ju
   `localStorage.setItem('hades.hints2','done')` **pred** loadom; klik na
   `#hint-skip` po loade ju skryje nespoľahlivo.
4. **Čakaj na obsah, nie na čas.** `/api/journal` a `/api/dashboard` bežia 3–4 s;
   pri kratšom spánku sa meria skeleton a všetky obrazovky vyzerajú prázdne.
5. **Každú CSS zmenu over výmenou stylesheetu nad TÝM ISTÝM DOM** (`cssswap.js`),
   nie dvoma načítaniami — Hades je živý a medzi nimi sa naučí uzly.
6. **Obe témy sú rovnocenné** (rozhodnutie 12). Každá kontrastná asercia sa robí
   dvakrát; prepni v jednom volaní, meraj v ďalšom.
7. **Dvojité deklarácie:** `w4dup.js`, kalibrovaný z oboch strán. Stav pred vlnou:
   `mind.css` A=0 B=1. Po vlne sa `A` nesmie zvýšiť.
8. **WebSocket sa cez proxy neupgraduje**, takže konzolové chyby `ws://.../app/…`
   sú limit harnessu, nie chyba appky. Nehádaj ich za regresiu.
9. Testy: `php artisan test` ≥ 596 passed / 0 failed. **Vlna 1 nemení PHP ani
   serializéry**, takže zmena čísla je signál, že sa dotklo niečoho, čoho sa
   dotknúť nemalo.

---

## 6. ČO SA VO VLNE 1 NEROBÍ — a prečo

| Téma | Prečo nie teraz |
|---|---|
| **41 vlastných SVG ikon** (rozhodnutie 19) | Nie je ich 37, ale **41** — štyri vstupujú do DOM cestami, ktoré grep na markup nevidí (`search_off` v `cmdk.js:258` a `smernica.js:186`, `filter_alt_off` v `dennik.js:134`, `play_arrow`/`pause` v `timeline.js`). Sada postavená zo 37 by mala **štyri diery** a tie by sa vykreslili ako surový ligatúrový názov. Naviac treba **najprv rozhodnúť 10 semantických kolízií** (`arrow_upward` nesie štyri veci, `hub` štyri, `close` dve, „hotovo" sa kreslí tromi ikonami) — inak vlastná sada zdedí zmätok Material Symbols. A dotýka sa **všetkých troch blade súborov a desiatok JS modulov**, teda každého súboru, ktorý vlna 1 drží. |
| **URL a hlboký odkaz** (rozhodnutia 9, 10, 27) | Vyžaduje dva nové moduly (`shared/urlstate.js`, `mind/urlschema.js`) a **nevratnú zmenu tvaru `state.js`** — ten dnes číta startovací stav z `localStorage` pri vyhodnotení modulu (`state.js:44,47,86,95,…`). Zasahuje `state.js`, `screens.js`, `sim.js` **a všetkých šesť obrazoviek**, teda presne súbory, ktoré vo vlne 1 drží I2. Dva agenti nad `screens/*.js` sa ticho prepíšu. |
| **Animácie znaku a jeden zdroj faviconu** (rozhodnutia 4–5) | Geometria znaku je zapísaná **osemkrát** (+ reimplementácia v Pythone + `stroke-dasharray: 54.29` ako konštanta z polomeru). Jeden generátor musí vydať štyri formáty (SVG asset, data-URI do Blade, `.ico`, CSS `dasharray`) a musí byť spustiteľný, inak sa deviaty zápis pridá znova. Dotýka sa `mind.blade.php`, `chat.blade.php`, `console.blade.php`, `console/render.js`, `mind.css`, `public/brand/*`, `electron/assets/*`. |
| **Rozbalenie railu 80 → ~208 px** (rozhodnutie 17) | Mení `--rail-w`, `--content-left` a tým **okraje plátna** — `viewInsets()`/`camInsets()` čítajú CSS tokeny, takže fit kamery sa presúva na celom grafe. Rovnaký súbor (`mind.css`) drží vo vlne 1 I1, a rail potrebuje aj markup v `mind.blade.php`. Naviac `#rail .dest .lbl` je 10 px chróm, ktorý rozbalený rail redefinuje — konflikt s T2, keby sa robilo naraz. |
| **Plný audit 64 pohybov bez tichej verzie** | Vlna 1 zavádza **vzor** (T7) a aplikuje ho na tri veci, ktorých sa dotýka. Prepísanie 64 pohybov naraz je jeden celok s vlastným zoznamom; ak sa urobí popri, časť ostane s plošnou podlahou a časť s pomenovanou verziou a nikto nebude vedieť, ktorá je ktorá. |
| **Chybový komponent na `/console`, `/chat` a v doku** | Zvyšné **päť z deviatich** kresieb chyby žije v `console.css`, `chat.css` a `charon.css` a tri z nich sú v prúde konverzácie, kde chyba nesie aj `who`/`meta` riadok. Vlna 1 tie súbory nevlastní. Rozhodnutie 16 sa tým splní **napolovic a je to napísané nahlas** — komponent existuje, migrácia dobehne vo vlne 3. |
| **`charon.css` na typografickú škálu** | 22 surových veľkostí, `var(--fs-*)` použité 0×, `var(--icon-*)` 0×. 13/14/12/16 px sú hodnotovo identické s tokenmi (nulové riziko), ale 11/15/20 px sú **nové stupne mimo škály** a treba ich rozhodnúť, nie prepísať. Súbor navyše nevlastníme. |
| **`--shadow-2` / `--shadow-3` bez volajúceho a `--elev-*` vs `--shadow-*`** | Dve mená pre tú istú vec; redizajn si musí vybrať jedno. Efekt nízky, a `--card-bg` sa ukázalo ako **nie diera** — jeho tri odkazy pokrývajú deväť selektorov kariet dátových obrazoviek (`mind.css:4575–4583`), takže povrch karty **je** zjednotený. Skutočný rozpor je `charon.css:439` na `--panel-solid` — a to je vlna 3. |
| **Komentár `/* 104px */` pri hodnote 112 px** (`mind.css:267`) | Opraviť ho v rámci railu (vlna 2), pretože rozhodnutie 17 to číslo mení. Oprava teraz by bola oprava na hodnotu, ktorá o týždeň neplatí. |

---

## 7. PORADIE ĎALŠÍCH VLN

Poradie je zvolené tak, aby sa **nemuselo znovu merať** a aby v každej vlne boli
dve nepretínajúce sa sady súborov.

### Vlna 2 — dva „jediné zdroje"

| | Implementátor A | Implementátor B |
|---|---|---|
| Téma | **URL a hlboký odkaz** | **Znak z jedného zdroja + rozbalenie railu** |
| Súbory | `public/js/shared/urlstate.js` (nový) · `public/js/mind/urlschema.js` (nový) · `state.js` · `screens.js` · `sim.js` · `screens/*.js` · `structure.js` | `resources/views/{mind,chat,console}.blade.php` · `public/css/mind.css` · `public/js/console/render.js` · `public/brand/*` · `electron/assets/build-icon.py` |
| Prečo teraz | Sonda B dokazuje, že skupina B (šesť obrazoviek dát) je **najväčší zisk za najmenšie riziko**: ani jedna z tých hodnôt dnes nikde nežije, takže nie je čo migrovať. A rozhodnutie 11 („obrazovky dát prvé") sa tým plní doslovne. | Rail je CSS + blade (`viewInsets()` čítá CSS tokeny, takže JS sa nedotýka) a znak je blade + assety. Ani jeden nepotrebuje `screens/*.js`. |
| Poradie vnútri | 1. `urlstate.js` + `urlschema.js` s jediným kľúčom `s` (vyrieši, že `?screen=` z desktop shellu trvale prepisuje uloženú voľbu) → 2. skupina B, šesť obrazoviek, s **existujúcimi** `prune*()` → 3. skupina A, sedem `localStorage` kľúčov s jednorazovou migráciou | 1. jeden generátor znaku (4 formáty) → 2. `.ico` + favicon z neho → 3. rail 80 → 208 px so zbalením a persistenciou → 4. komentár `/* 104px */` |

Nepretínajú sa: A je čisto JS mimo `mind.css`, B je čisto CSS + blade + assety.
Jediný stret by nastal, keby A potreboval CSS pre nový stav v URL — nepotrebuje.

### Vlna 3 — 41 ikon (jeden veľký kus, sám)

Ikony sa nedajú rozdeliť na dvoch, pretože **jeden štýl a jeden generátor** je
celá podstata rozhodnutia 19. Druhý implementátor v tej vlne robí cross-surface
sweep, ktorý sa ikon nedotýka:

| | Implementátor A | Implementátor B |
|---|---|---|
| Téma | vlastná sada 41 SVG ikon, Material Symbols von | `charon.css` na škálu · chybový komponent na `/console`, `/chat`, dok · terminológia · plný audit 64 pohybov |
| Súbory | `public/js/mind/icons.js` (nový) · všetky blade · JS call-sity ikon | `public/css/{console,charon,chat}.css` · `public/js/{chat,console}/*` · `public/js/mind/charon.js` |

Poznámka, ktorá musí prejsť do vlny 3: **ak by sa ikony odložili ešte raz, treba
medzitým regenerovať subset nad všetkými 41 ligatúrami.** Subset
(`material-symbols-rounded-subset.woff2`, 132 196 B, mtime 18. 8. 2026 13:38) je
**starší než záznam o 32 ikonách** a odvtedy ich pribudlo najmenej 9. Metóda
overenia je **meranie šírky vykresleného glyfu** (glyf ≈ 1 em ≈ 18 px, nevykreslená
ligatúra padne na fallback a je násobne širšia); GSUB tabuľky **nečítať** — prvý
pokus o audit tou cestou hlásil 32 chýbajúcich ikon, ktoré v subsete boli.

---

## 8. ROZHODNUTIA KOORDINÁTORA — zaznamenané, aby sa nehľadali znova

Sonda A nechala osem otvorených otázok. Sedem z nich rozhodujem tu; ôsma patrí
používateľovi.

| # | Otázka | Rozhodnutie |
|---|---|---|
| 1 | `KONTRAKT-REDIZAJN-2026-08-27.md` v repe nie je | **Je.** Sonda A merala pred jeho vznikom. Kontrakt platí a je konzistentný s oboma sondami; jeho rozhodnutie 19 hovorí „37 ligatúr", **správne číslo je 41** (§6). |
| 2 | Plošné `prefers-reduced-motion` — zrušiť, oslabiť, ponechať? | **Ponechať ako podlahu s `!important`** a zaviesť vzor, ako ho legálne prebiť (trieda + `!important` v tom istom `@media` bloku). Odstránenie `!important` by odobralo tichú verziu 64 pohybom naraz. Detail a mechanika v T7. |
| 3 | Sú tri scrimy výnimkou rozhodnutia 22+25, alebo chybou? | **Pomenovanou výnimkou.** Sú to scrimy pod modálom, nie panely — rozostrenie tam nesie „pod tým je obsah, ktorý teraz nečítaš". Dostávajú štvrtý prepínateľný token `--scrim-blur` a vetu v manuáli. `#cmdk` stráca 6 px a dorovnáva sa na 4 px: dve hodnoty pre jednu rolu zanikajú. (T5) |
| 4 | Ktoré nadpisy dostane serif? Prepíše sa manuál skôr? | **Manuál je prepísaný v tom istom ťahu ako tento plán.** Serif nesie **dve** role: jedno primárne číslo obrazovky (`.hero-val`) a titulok obrazovky (`.screen-head h1`). **Nikdy** chybu, prázdny stav, chróm, os grafu ani telo textu. Váha 600 a `letter-spacing: 0`, nie hodnoty ladené pre Geist. (T9) |
| 5 | Kto vlastní `favicon.ico`? | **`public/favicon.ico` je koreň pre web, `electron/assets/hades.ico` pre desktop, a oba vydáva jeden generátor z `hades-sigil-mini.svg`.** Dnes generátor `favicon.ico` v repe nie je. Vlna 2. |
| 6 | Ide subset Material Symbols von hneď, alebo po dokončení SVG sady? | **Po dokončení, jedným krokom vo vlne 3.** Do tej doby platí T8 (fallback) ako poistka. Ak by sa vlna 3 odložila, subset treba regenerovať nad 41 ligatúrami. |
| 7 | Kde má žiť stav grafu v URL, keď `/` dnes nemá `pushState`? | **Vlna 2, implementátor A, v poradí navrhnutom sondou B** (najprv kľúč `s`, potom skupina B, potom skupina A s jednorazovou migráciou zo `localStorage`). `localStorage['hades.screen']` **prežíva ako preferencia**; URL je pohľad. Jedno nesmie ticho prepísať druhé — dnes ho prepisuje (`?screen=` z desktop shellu). |
| 8 | `ScreenParityTest` a URL: kto serializuje filtre? | **PATRÍ POUŽÍVATEĽOVI.** Invariant dvojitej plochy hovorí „filtre sú DATA a patria na server", ale adresu vlastní klient. Sonda B navrhuje **nezlučovať** serverový dopyt (`URLSearchParams` v `rozhodnutia.js:38`, `runy.js:56`, `kontrola.js:52`) s adresou prehliadača — sú to dve rôzne veci a zlúčenie by z „jedného miesta" spravilo jedno miesto pre dve pravdy. Odporúčam to prijať, ale je to rozhodnutie o architektúre dvojitej plochy, ktorú kontrakt označil za nedotknuteľnú. **Nerobiť pred odpovedou.** |

Nad rámec sondy A rozhodujem ešte dve veci, ktoré sa pri delení ukázali:

| Téma | Rozhodnutie |
|---|---|
| Rozpočet preloadu fontov | Vlna 1 zdvíha hlavičku o **82 672 B** (Playfair ×2 + Geist Mono) a vlna 3 ju znižuje o **132 196 B** (Material Symbols odchádza), teda **50 kB pod dnešný stav**. Je to vedomý dočasný účet. Ak sa vlna 3 nestihne, tento účet zostáva otvorený a treba ho priznať, nie prehliadnuť. |
| `.shimmer` a `--surface-raised` | `.shimmer` **nezaniká vo vlne 1**. I1 pridá `.skel*` vedľa nej, I2 prepíše jediného volajúceho, zmazanie je riadok vlny 2. Keby I1 zmazal `.shimmer` a I2 nedobehol, dashboard by mal skeleton bez kresby — a nikto by to nevidel, kým by nebolo pomalé pripojenie. |

---

## 9. Súhrn — čo je hotové, keď je vlna 1 hotová

- Dátový text má **pomenovanú rolu a podlahu** (13 px), chróm zostal mikro;
  44 deklarácií zmenených (31 + 9 + 4), každá s deklarovanou prokládkou, každá zmeraná
  nad CSSOM aj nad živým DOM. Zdvih `.day-head` je 10 → 13 px, teda +30 % na
  kľúči dňa v Denníku.
- **Jeden chybový komponent** na šiestich obrazovkách dát namiesto troch kresieb
  (`.empty` + `cloud_off`, `.card-empty` použité ako chyba, `renderEmpty` bez predmetu);
  každá chyba pomenuje **predmet** a ponúka **jednu akciu**. Zostávajúcich päť
  kresieb na `/console`, `/chat` a v doku je priznaný zvyšok, nie prehliadnutie.
- **Skeleton v tvare obsahu** na šiestich miestach namiesto dvoch; Denník
  (endpoint 3–4 s) ho prvýkrát má. Inline rozmery odišli z JS.
- **Prázdno učí a odlišuje** „nič tu nie je" od „tvoj filter to skryl".
- **Sklo je len na tmavej téme bez výnimky bez mena** — štvrtý prepínateľný token,
  jedna hodnota pre jednu rolu.
- **Os grafu má jeden jazyk** a nemá rozmer v JS.
- **Tichá verzia má vzor**, ktorý sa dá aplikovať bez toho, aby 64 pohybov stratilo
  podlahu.
- **Serif má druhú rolu** a prvýkrát je preloadovaný.
- `.ms` na najväčšej ploche má fallback.
- **Hlas je neosobný na 100 %** hlásení, ktoré vlna vlastní.
