# Sonda A — inventár dnešného stavu + rozpor proti manuálu značky

**Dátum:** 27. 8. 2026 · **Vetva:** `feat/hades-redesign` · **Rola:** merací agent
**Zmenené produkčné súbory:** žiadne.

Každé číslo v tomto dokumente má príkaz alebo `file:line`. Kde som nemohol merať
(prehliadač mi je v tomto zadaní zakázaný), je to napísané nahlas ako otvorený bod
a NIE je to nahradené odhadom.

## Poznámka k zadaniu, ktorú treba vyriešiť skôr než sprint

`KONTRAKT-REDIZAJN-2026-08-27.md` **v repe neexistuje** (`ls` v koreni: 7 kontraktov,
najnovší `KONTRAKT-CHAT-APPKA-2026-08-25.md`). Čítal som teda CLAUDE.md,
`docs/BRAND-HADES.md` a 30 odsúhlasených rozhodnutí zo zadania. Ak kontrakt existuje
mimo repa, časť „otvorené otázky" nižšie sa môže ním už zodpovedať.

## Harness a kalibrácia

Merania nad CSS nerobí grep, ale parser, ktorý drží **selektorový zásobník** — grep
na `font-size:` nevie, ktorému pravidlu deklarácia patrí, a v `@media` blokoch by
stratil zanorenie. Parser: `<scratchpad>/cssparse.py` → `rules.json` (**1188 pravidiel**
zo 4 stylesheetov).

Kalibrácia každého detektora (bez nej sú čísla bezcenné — projekt na to už raz naletel):

| Detektor | Kladný prípad | Záporný prípad | Výsledok |
|---|---|---|---|
| selektor pravidla | `#breadcrumb` = mind.css:1390 | — | sedí (`sed -n '1390p'`) |
| raw farby mimo `:root` | s vypnutým filtrom hlási **130** zásahov vnútri `:root` | so filtrom **0** | detektor funguje, invariant drží |
| ikony (3 cesty) | `hub` cestou A | `teraz` označené ako neikona | zachytené správne |
| TEXT vs PLOCHA | `--danger-ink` 16/16 ako `color:` | `--danger-soft` 0/18 ako `color:` | 100 % na oboch stranách |

---

# 1. Typografia

## 1.1 Úplný inventár veľkostí

Príkaz: `python <scratchpad>/fs.py` (nad `rules.json`).
**309 deklarácií `font-size`**, z toho **38 na ikonovej škále** (`--icon-*`) a
**271 na texte**.

### Tokeny škály (`public/css/mind.css:285–292`, `450–455`)

| Token | Hodnota | Prokládka | Deklarácií | Rola dnes |
|---|---|---|---|---|
| `--fs-micro` | 10 px | `--lh-micro: 1.3` | 23 | eyebrow, `kbd`, popisky grafov, počty v raile |
| `--fs-caption` | 11 px | 1.4 | 56 | čas, cesta, tag, `.cert`, `.origin`, `.kpi-sub` |
| `--fs-small` | 12 px | 1.4 | 60 | **najpoužívanejšia** — breadcrumb, metriky hlavičky, kód, výstup toolu |
| `--fs-body` | 13 px | 1.5 | 57 | bublina, riadok karty, `button` |
| `--fs-base` | 14 px | 1.5 | 20 | `body`, `p`, `input`, `.md-body` |
| `--fs-title` | 16 px | 1.3 | 7 | `h2` doku, `h3` prózy |
| `--fs-display` | 20 px | 1.25 | 4 | `h2` prózy, `.donut-total .dt-num` |
| `--fs-headline` | 24 px | 1.25 | 1 | jediný volajúci: `.md-body h1.md-h` |
| `--fs-h1` | 28 px | — | 2 | `.screen-head h1`, `.empty-network .title` |
| `--fs-h2` | = `--fs-title` | — | 2 | `.dash-title`, `h2` sekcií |
| `--fs-kpi` / `--kpi-value` | 30 px | 1 | 2 | `.tc-val`, `.kpi-val` |
| `--fs-hero` | 44 px | 1 | 1 | `.hero-val` |

Ikonová škála (`mind.css:312–316`): `--icon-2xs` 14 · `--icon-xs` 16 · `--icon-sm` 18 ·
`--icon-md` 20 · `--icon-lg` 22 px.

### Surové veľkosti mimo tokenov (34 deklarácií)

| Súbor | Surové `font-size` | Poznámka |
|---|---|---|
| **`charon.css`** | **22** (7×13, 4×14, 4×12, 2×16, 2×15, 2×11, 1×20) | **`var(--fs-*)` použité 0×, `var(--icon-*)` 0×** |
| `console.css` | 9 (4×16, 2×18, 14, 10, `.92em`) | z toho 6 na ikonách `.ms` |
| `mind.css` | 4 (28px `.empty .ms`, 48px `.empty-network .ms`, `.9em`, `inherit`) | všetky 4 majú vlastný komentár, prečo tokenom nie sú |
| `chat.css` | 1 (`.92em`) | kód v prúde |

`charon.css` (dok nad grafom) je **jediný stylesheet úplne mimo typografickej škály**:
farebné tokeny používa (0 raw farieb), typografické nie. 15 px (`charon.css:110`, `:565`)
a 20 px (`:591`) nie sú stupňami škály vôbec — nová veľkosť v projekte, ktorý má
škálu s jediným zdrojom pravdy.
· **Efekt: vysoký** (dok je v redizajne dotknutý a dnes hovorí inou typografiou).
· **Riziko: nízke** — 13→`--fs-body`, 14→`--fs-base`, 12→`--fs-small`, 16→`--fs-title`
sú hodnotovo identické; skutočná zmena je len 11/15/20 px (5 deklarácií).

## 1.2 DATA vs CHROM pod 13 px (rozhodnutie 12)

Príkaz: `python <scratchpad>/band.py` — pravidlo klasifikácie je v hlavičke skriptu
napísané explicitne, takže číslo je reprodukovateľné a nie dojem.

**149 z 271 textových deklarácií (55,0 %) je pod 13 px.** Delenie:

| | Deklarácií | 10 px | 11 px | 12 px |
|---|---|---|---|---|
| **DATA** | **80** | 6 | 33 | 41 |
| CHROM | 64 | 17 | 23 | 24 |
| nezaradené | 5 | 1 | 1 | 3 |

Päť nezaradených po ručnom prečítaní: `.ca-size` (veľkosť súboru), `.chip-n` (počet),
`.ctx-chip` (label uzla), `#hover-card .m` (metadáta uzla) = DATA; `#charon-pack` = CHROM.
**Reálne teda 84 DATA / 65 CHROM.**

> Zadanie uvádza namerané *85,6 % viditeľného textu pod 13 px*. To je meranie nad DOM
> (počet prvkov), moje 55,0 % je meranie nad CSS (počet deklarácií). Nie sú v rozpore —
> pod 13 px sedia práve tie selektory, ktoré sa v zoznamoch **opakujú stokrát**
> (`.record-time`, `.tag`, `.ti-time`, `.run-when`), zatiaľ čo 14–44 px sú prvky
> vyskytujúce sa raz na obrazovku. Obe čísla merajú tú istú chorobu z dvoch strán.

### Najhoršie prípady — DATA na 10 px (6 deklarácií)

| Miesto | Čo nesie |
|---|---|
| `mind.css:4146` `.heat-months` | os heatmapy 365 dní — mesiace |
| `mind.css:4158` `.heat-legend` | stupnica hustoty heatmapy |
| `mind.css:4189` `.donut-total .dt-lbl` | popis stredu donutu istoty |
| `mind.css:4306` `.dtl-month` | mesiac na osi rozhodnutí |
| `mind.css:2831` `.day-head` | **kľúč dňa v Denníku** |
| `console.css:235` `.tr-open .when` | čas poslednej správy vlákna |

Štyri z nich sú **osi a legendy grafov** — presne tá vrstva, ktorú rozhodnutie 21
zjednocuje. Zdvih dátového textu a zjednotenie grafov sú teda **jedna úloha**, nie dve.

### Najviditeľnejší prípad vôbec

`mind.css:1423` `#header-metrics` = **`--fs-small` (12 px), mono, `--muted`**. To je
text „1109 uzlov · 3053 spojení" — jediné číslo, ktoré appka hlási neustále a o ktorom
je celá. 12 px v utlmenej farbe.
· **Efekt: vysoký** · **Riziko: nízke** (hlavička má `--header-h: 44px`, 13–14 px sa zmestí).

## 1.3 Prokládka (nález R3)

Z **271 textových deklarácií `font-size` deklaruje `line-height` iba 66 (24,4 %)**;
**205 nechá prokládku na dedení alebo na UA.** Pod 13 px je to horšie:
**149 deklarácií, z toho 33 s prokládkou (22,1 %)** — teda 116 najmenších textov
v appke nemá deklarovanú prokládku.

Zadanie uvádza nález *`line-height: normal` na 13 160 prvkoch*. To je DOM meranie a
**nedokázal som ho reprodukovať** (bez prehliadača). CSS strana ho ale vysvetľuje:
`body` má `--lh-base: 1.5` (`mind.css:784`), takže sa dedí *číslo* — a číslo sa dedí
ako **násobiteľ, nie ako výsledok**, takže `.day-head` na 10 px zdedí 15 px prokládky
a `.md-body` na 14 px zdedí 21 px. Prokládka nie je `normal` z dedenia; `normal`
prichádza z **form controls**, ktoré dedenie `line-height` neberú — a tie sú v tomto
súbore deklarované len sčasti (`mind.css:1519` `input`/`textarea` prokládku
**nedeklaruje**, hoci `font-size` áno).

· **Efekt: stredný** (číslo z DOM je veľké, ale väčšina prípadov je optická, nie chybná).
· **Riziko: stredné** — doplnenie `line-height` na 205 miest je najväčší zdroj tichého
  posunu rozloženia v celom redizajne. **Musí ísť cez `cssswap.js`** (výmena stylesheetu
  nad tým istým DOM), inak sa nedokáže, že zmena je zamýšlaná a nie náhodná.
· **Otvorený bod:** presné číslo `line-height: normal` treba dokázať v prehliadači
  a povedať, koľko z tých prvkov sú form controls.

## 1.4 Serif (rozhodnutie 3)

Príkaz: `grep -o "font-family: var(--serif)" public/css/*.css | wc -l`

| Rodina | Deklarácií |
|---|---|
| `var(--mono)` (Geist Mono) | **86** |
| `var(--font)` (Geist) | 22 |
| **`var(--serif)` (Playfair)** | **1** — `mind.css:3994` `.hero-val` |

Jediný volajúci `.hero-val` sa kreslí na jednom mieste v celej appke
(`public/js/mind/screens/dnes.js:178`) — teda **jeden prvok na jednej obrazovke**.
Cena: `playfair-display-latin.woff2` 38 404 B + `playfair-display-latin-ext.woff2`
21 140 B = **59 544 B woff2**, a `latin-ext` sa načíta vždy (slovenská diakritika).
Playfair pritom **nie je v `<link rel="preload">`** na žiadnej z troch strán, takže
to jedno číslo dashboardu sa vykreslí najprv v Georgii a potom preskočí.

### Vedľajší nález v preloadoch

| Strana | Preloady (`grep -o 'preload" href="/fonts/[^"]*"'`) |
|---|---|
| `mind.blade.php:32–34` | material-symbols · geist-latin · **geist-latin-ext** |
| `console.blade.php:33–35` | material-symbols · geist-latin · **geist-mono-latin** |
| `chat.blade.php:54–56` | material-symbols · geist-latin · **geist-mono-latin** |

`/` je plocha s **86 deklaráciami `var(--mono)`** (breadcrumb, metriky hlavičky, všetky
čísla kariet, KPI, časy, cesty) a **Geist Mono na nej nie je preloadovaný**, kým na
`/console` a `/chat` áno. Tretí preload je na `/` použitý na `latin-ext` namiesto mono.
· **Efekt: stredný** (viditeľné pri prvom načítaní dashboardu — čísla preskočia)
· **Riziko: nulové.**

· **Efekt: vysoký** — rozhodnutie 3 chce serifu väčšiu rolu a dnes je pomer 1 : 86
  voči monu. Zaplatený font s jedným volajúcim je najlacnejšia príležitosť v celom sprinte.
· **Riziko: nízke**, ale s jednou pascou: `mind.css:3280–3285` aj `3983–3990` nesú
  komentáre, že serif sa zo `screen-head h1` **zámerne odstránil**, pretože manuál §4
  hovorí „serif len hero metriky". **Rozšírenie role serifu preto vyžaduje najprv zmenu
  manuálu** (rozhodnutie 1), inak sprint prepíše to, čo predchádzajúci sprint zdôvodnil.

---

# 2. Povrchy a hranice

## 2.1 Tokeny a ich volajúci

Príkaz: `for t in …; do grep -o "var(--$t)" public/css/*.css | wc -l; done`

| Token | Svetlá | Tmavá | Volajúcich |
|---|---|---|---|
| `--border` | `#e6dee3` | `rgba(255,255,255,.10)` | **70** |
| `--border-accent` | `#c9b0ee` | `rgba(196,162,245,.45)` | 44 |
| `--line-soft` | `#f0e9ee` | `rgba(255,255,255,.07)` | 30 |
| `--surface-2` | `#fbf7f9` | `#16201f` | 27 |
| `--surface-subtle` | `#f4eefc` | `rgba(255,255,255,.08)` | 19 |
| `--panel` | `rgba(255,255,255,1)` | `rgba(19,27,26, --panel-alpha)` | 17 |
| `--hover-fill` | `rgba(16,29,27,.05)` | `rgba(255,255,255,.06)` | 17 |
| `--border-strong` | `#d9ced6` | `rgba(255,255,255,.16)` | 16 |
| `--panel-solid` | `rgb(255,255,255)` | `rgb(19,27,26)` | 12 |
| `--field-bg` | `#fbf7f9` | `#121b1a` | 10 |
| `--top-rim` | `rgba(255,255,255,.7)` | `rgba(255,255,255,.06)` | 8 |
| `--scrim` | `rgba(16,29,27,.32)` | `rgba(6,10,9,.55)` | 5 |
| `--card-bg` | `= --panel` | `= --panel` | **3** |
| `--surface-raised` | `#f1ebef` | `#1a2322` | **1** (`.shimmer`) |
| `--elev-1/2/3/tooltip` | — | — | 3 / 7 / 5 / 1 |
| `--shadow-1/2/3` (aliasy) | — | — | **1 / 0 / 0** |

Dva nálezy z tabuľky:

- **`--shadow-2` a `--shadow-3` majú 0 volajúcich** (`mind.css:613–614`), `--shadow-1`
  jedného. Komentár na `mind.css:600–610` to priznáva („Zvyšok je zámerne bez volajúceho"),
  takže to nie je diera — ale sú to **dve mená pre tú istú vec** (`--elev-*` vs `--shadow-*`)
  a redizajn si musí vybrať jedno. · Efekt: nízky · Riziko: nízke.
- **`--card-bg` má 3 volajúcich**, pričom „karta" je najčastejší komponent appky. Jeden
  z tých troch (`mind.css:4583`) obsahuje 11 selektorov naraz, druhý `.tool-call`, tretí
  `.perm-card`. `charon.css` `--card-bg` **nepoužíva vôbec** — jeho karty stoja na
  `--panel-solid` (`charon.css:439` `.charon-perm-preview`). · Efekt: stredný · Riziko: nízke.

## 2.2 Sklo — zodpovedá to rozhodnutiu 20?

Mechanika je správna a je jedna: `--panel-a` je na svetlej **1** (`mind.css:99`) a na
tmavej `var(--panel-alpha)` (`:667`); `--glass-blur*` je na svetlej `none` (`:103–105`)
a na tmavej `--blur-1/2/3` (`:668–670`). Slider priehľadnosti píše `--panel-alpha`
inline na `:root`, takže na svetlej ho `--panel-a: 1` neutralizuje. **To drží.**

**Ale tri z dvanástich `backdrop-filter` deklarácií obchádzajú prepínateľné tokeny
a čítajú blur primitív priamo — teda rozostrujú na OBOCH témach:**

| Miesto | Selektor | Hodnota |
|---|---|---|
| `mind.css:2103` | `#help-overlay` | `var(--blur-scrim)` = `blur(4px)` |
| `mind.css:2150` | `#md-overlay` | `var(--blur-scrim)` = `blur(4px)` |
| `mind.css:3437` | `#cmdk` | `var(--blur-1)` = `blur(6px)` |

Ostatných 9 ide cez `--glass-blur*` a na svetlej sú `none`.

Obhájiteľné je to tým, že sú to **scrimy pod modálom, nie panely** — rozostrenie tam
nesie „pod tým je obsah, ktorý teraz nečítaš", nie hĺbku povrchu. Ale:
1. je to **nepomenovaná výnimka** — všetky ostatné výnimky v tomto súbore majú komentár
   a tieto tri nie;
2. `#cmdk` používa `--blur-1` (6 px), nie `--blur-scrim` (4 px), hoci je to tá istá rola —
   **dve hodnoty pre jeden význam**.

· **Efekt: stredný** (viditeľné len pri modáloch na svetlej téme, ale rozhodnutie 20 je
  formulované absolútne). · **Riziko: nízke.**
· **Rozhodnutie pre koordinátora:** buď zaviesť štvrtý prepínateľný token
  `--scrim-blur` (na svetlej `none` alebo menšia hodnota), alebo tú výnimku
  **pomenovať v manuáli** — dnes nie je nikde.

## 2.3 Dva papiere pre jednu rolu

`#dock` a `#node-panel` (`mind.css:1456`) sú **sklo** (`--panel` + `--glass-blur`).
`#charon` (`charon.css:22`), ktorý stojí na tom istom plátne v tej istej role
plávajúceho chrómu, je **`--panel-solid`** — plný povrch, žiadny blur.

· **Efekt: stredný** — na tmavej téme sú vedľa seba dva plávajúce panely, jeden priesvitný,
  druhý nie. · **Riziko: nízke.**

## 2.4 Invariant „žiadny raw hex/rgba mimo `:root`"

**Drží: 0 zásahov** (`python <scratchpad>/raw.py`), kalibrované na 130 zásahoch vnútri
`:root`. `chat.css:19` má vlastný `:root` blok so 4 tokenmi vrátane jednej pomenovanej
výnimky `--ca-frame-bg: #ffffff` (papier `<iframe sandbox>`, zdôvodnené na `chat.css:38–46`).
`console.css:33` má tiež vlastný `:root` (`--stream-w`). Oba súbory hovoria, že je to
dočasné, kým je `mind.css` „v cudzích rukách" — v tomto sprinte už nie je, takže je to
**akcia, nie nález**. · Efekt: nízky · Riziko: nízke.

---

# 3. Animácie

## 3.1 Inventár

Príkaz: `python <scratchpad>/anim.py` (nad `rules.json`).

| | mind.css | console.css | charon.css | chat.css | Σ |
|---|---|---|---|---|---|
| `@keyframes` | 11 | 4 | 1 | 0 | **16** |
| `animation:` deklarácií | 21 | 8 | 2 | 0 | **31** |
| z toho `animation: none` v reduce blokoch | 4 | 4 | 1 | 0 | 9 |
| **živých animácií** | 17 | 4 | 1 | 0 | **22** |
| `transition:` deklarácií | 50 | 7 | 1 | 2 | **59** |
| bloky `prefers-reduced-motion` | 5 | 3 | 1 | 0 | **9** |

## 3.2 Každá animácia: čo nesie a či má tichú verziu

| Animácia | Miesto | Trvanie / easing | Nesie | Tichá verzia |
|---|---|---|---|---|
| `core-pulse` | `mind.css:1143` `#brand-core` | 4 s `--ease` ∞ | **informáciu** — stav vedomia (bdie/spí), `.asleep` pauzuje | **len plošné pravidlo** |
| `bc-draw` | `mind.css:1192` | 760 ms +100 ms, 1× | značkový podpis (zrod znaku) | ✅ `mind.css:1215` + `dashoffset: 0` |
| `bc-core-in` | `mind.css:1201` | 460 ms +620 ms, 1× | značkový podpis | ✅ `mind.css:1215` |
| `panel-in-l` | `mind.css:1469` `#dock` | `--dur-slow` 200 ms | **informáciu** — z ktorej strany panel prišel | **len plošné pravidlo** |
| `panel-in-r` | `mind.css:1470` `#node-panel` | 200 ms | to isté, zprava | **len plošné pravidlo** |
| `rise-fade` | `.toast` 2031, `#help-card` 2109, `#md-card` 2157, `#hint` 2354, `.screen.active` 3276, `#cmdk-card` 3441 | `--dur-base` 180 ms | **dekoráciu** (6×) — okrem `.screen.active`, kde nesie prepnutie obrazovky | **len plošné pravidlo** (6×) |
| `fade-in` | `#help-overlay` 2099, `#md-overlay` 2146 | 180 ms | dekoráciu | **len plošné pravidlo** (2×) |
| `load-breathe` | `mind.css:2545` `.load-mark` | `--dur-pulse` 1,4 s ∞ | informáciu — „pracuje sa" | ✅ `mind.css:2606` |
| `heat-reveal` | `mind.css:2594` | 720 ms `both` | informáciu — poradie čítania od najstaršieho týždňa | ✅ **JS** (`charts.js:257` triedu nepridá) |
| `hades-shimmer` | `mind.css:3919` `.shimmer::after` | 1,4 s ∞ | informáciu — skeleton žije | ✅ `mind.css:3926` |
| `sync-pulse` | `mind.css:4543` `.status-dot[running]` | 1,4 s ∞ | **informáciu** — beh je živý | ✅ `mind.css:4548` |
| `sk-pulse` | `console.css:344` `.sk-row` | **1,4 s `ease-in-out`** ∞ | informáciu — skeleton žije | ✅ `console.css:593` |
| `msg-in` | `console.css:496` `.is-new` | `--dur-base` `both` | **informáciu** — správa práve pribudla | ✅ `console.css:503` |
| `think-blink` | `console.css:568` `.think-dot` | **1,2 s `ease-in-out`** ∞ | informáciu — čaká sa na token | ✅ `console.css:591` |
| `tool-pulse` | `console.css:798` | **1,1 s `ease-in-out`** ∞ | informáciu — tool beží | ✅ `console.css:595` |
| `charon-blink` | `charon.css:202` `.charon-dot` | **1,2 s `ease-in-out`** ∞ | informáciu — čaká sa na token | ✅ `charon.css:219` |

Prechody riadené z JS (mimo CSS `animation`):
`.seg-draw` `stroke-dasharray 760 ms` + stupňovanie `90 ms/segment` (`mind.css:2576`,
`charts.js:374`) · `.line-draw` `stroke-dashoffset 900 ms` (`:2579`, `charts.js:470`) ·
`.chart-fade` `opacity 520 ms +240 ms` (`:2582`) · `birthScale()` ~0,5 s
(`mind/anim.js:156`) · `.leaving` toast `--dur-slow` `--ease-in` (`mind.css:2063`,
`toasts.js:23`) — **všetkých päť má tichú verziu v JS** (`charts.js:75` `REDUCED`,
`anim.js:12/43/53/158`, `toasts.js:24/26/38/67/68` skracujú na 0).

## 3.3 KĽÚČOVÝ NÁLEZ — plošný vypínač namiesto tichých verzií

`public/css/mind.css:2728–2736`:

```
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        animation-delay: 0s !important;
        transition-duration: .01ms !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
    }
}
```

`mind.css` sa načítava PRVÝ na všetkých troch plochách, takže toto pravidlo pokrýva
`mind.css`, `console.css`, `chat.css` aj `charon.css`.

Dôsledok, ktorý rozhoduje o rozhodnutí 7:

- **živých pohybov celkom: 22 animácií + 57 prechodov = 79.**
  (57 = 59 deklarácií `transition` − 1 reduce override na `console.css:594`
  − 1 `transition: none` na `console.css:1131`, ktorý nie je pohyb.)
- pohybov s **pomenovanou tichou verziou**: 10 animácií (v 9 CSS blokoch) +
  1 prechod (`.tr-acts`, `console.css:594`) = 11;
- pohybov s **tichou verziou v JS**: 1 animácia (`heat-reveal`) + 3 prechody
  (`.seg-draw`, `.line-draw`, `.chart-fade`) = 4;
- pohybov, ktorých **jedinou** tichou verziou je toto plošné pravidlo:
  **11 animácií + 53 prechodov = 64**
  (11 = `core-pulse`, `panel-in-l`, `panel-in-r`, `rise-fade` ×6, `fade-in` ×2);
- `!important` na `*` znamená, že **žiadne per-komponentné pravidlo nemôže deklarovať
  vlastný „zmysluplný okamžitý ekvivalent" trvania** — plošné pravidlo ho prebije bez
  ohľadu na špecificitu. Rozhodnutie 7 („nie vypnuté, ale zmysluplný okamžitý
  ekvivalent") je teda s tým pravidlom **v priamom konflikte** a nedá sa splniť
  komponent po komponente, kým existuje.
- 9 existujúcich `animation: none` blokov je týmto pravidlom **zbytočných** —
  fungujú, ale nič nepridávajú. Sú to práve tie miesta, kde niekto tichú verziu
  chcel napísať ručne a nevšimol si, že je plošne vyriešená.

· **Efekt: vysoký** — je to architektonická prekážka rozhodnutia 7, nie kozmetika.
· **Riziko: vysoké** — zrušenie plošného pravidla znamená, že **64 pohybov naraz
  stratí tichú verziu**, kým sa nedopíšu. Musí to byť jeden celok sprintu so
  zoznamom, nie priebežná úprava.
· **Návrh riešenia pre koordinátora (rozhodnutie, nie meranie):** plošné pravidlo
  ponechať ako **podlahu** a zmeniť `.01ms !important` na `0s` bez `!important`,
  aby ho pomenované pravidlo mohlo prebiť. Alebo ho premenovať na `:where(*)` — vtedy
  padne na špecificitu 0-0-0 a čokoľvek pomenované vyhrá.

## 3.4 Surové trvania a easingy mimo tokenov

| Miesto | Hodnota | Poznámka |
|---|---|---|
| `charon.css:257` | `transform .15s ease` | jediný `transition` v súbore; `--dur-fast` je 150 ms, `--ease` je `cubic-bezier(.22,.61,.36,1)` — teda **iná krivka**, nie len iný zápis |
| `charon.css:208–212` | `1.2s`, `.2s`, `.4s` | perióda + stupňovanie bodiek |
| `console.css:349–354` | `1.4s`, `.12s/.24s/.36s` | `1.4s` = hodnota `--dur-pulse`, token neuvedený |
| `console.css:574–578` | `1.2s`, `.16s/.32s` | |
| `console.css:798` | `1.1s` | tretia perióda „neurčitého čakania" |
| `mind.css:1151` | `4s` | perióda dýchania znaku; manuál ju predpisuje, token nemá |
| `mind.css:2577/2580/2587/2595` | `760ms / 900ms / 760ms / 720ms` | grafové trvania, všetky štyri majú komentár |

**Tri periódy pre jeden význam:** „neurčité čakanie" beží na `1.4s` (`--dur-pulse`,
`sk-pulse`, `sync-pulse`, `load-breathe`), `1.2s` (`think-blink`, `charon-blink`) a
`1.1s` (`tool-pulse`). Rovnako **`ease-in-out` sa objavuje 5×** tam, kde má appka
`--ease`. · Efekt: stredný · Riziko: nízke.

## 3.5 Rozpor s manuálom v pohybe znaku

Manuál §2 „Pohyb": *„`prefers-reduced-motion` vypína **obe** animácie a znak je rovno
hotový."* Pomenovaný reduce blok (`mind.css:1215`) vypína **len zrod** (`bc-draw`,
`bc-core-in`), nie **dýchanie** (`core-pulse` na `mind.css:1143`). Dýchanie sa
zastaví iba cez plošné pravidlo z §3.3. Manuál teda opisuje stav, ktorý kód dosahuje
inou cestou, než akú manuál naznačuje — a keď plošné pravidlo padne (§3.3), tvrdenie
manuálu prestane platiť bez toho, aby sa čokoľvek dotklo tohto bloku.
· **Efekt: stredný** · **Riziko: nízke**, ale je to presne tá pasca, ktorú §3.3 otvára.

## 3.6 Znak, ktorý sa nehýbe, hoci manuál hovorí, že áno

Manuál §2 tabuľka: *„Znak (rail, Charón, **prázdny stav**) — prstenec sa obtiahne,
potom jadro."*

| Výskyt znaku | Triedy `bc-ring`/`bc-core`? | Animuje sa? |
|---|---|---|
| `mind.blade.php:114–115` (rail) | ✅ | ✅ |
| `console.blade.php:55–56` (hlavička) | ✅ | ✅ |
| `console/render.js:40–45` (prázdny stav) | ✅ | ✅ |
| **`chat.blade.php:86–87`** (hlavička `/chat`) | ❌ | ❌ |
| **`chat.blade.php:182–183`** (prázdny stav `#chat-empty`) | ❌ | ❌ |
| `charon.js:694` (prázdny dok) | znak **vôbec nie je** | — |

· **Efekt: stredný** · **Riziko: nízke** (pridanie dvoch tried).

---

# 4. Ikony

## 4.1 Nie je ich 37, je ich 41

Príkaz: `python <scratchpad>/icons3.py`. Ligatúra vstupuje do DOM **tromi cestami** a
grep len na markup podhlási:

| Cesta | Ako | Distinct |
|---|---|---|
| A — inline markup `<span class="ms">liga</span>` | Blade + JS stringy | 37 |
| B — **argument** helpera (`emptyHtml(icon, …)`) | `filter_alt_off`, `search_off` (+5 spoločných s A) | 7 |
| C — **`.textContent =`** | `play_arrow`, `pause` (+`delete`, `redo` spoločné) | 4 |

**41 distinct ligatúr** (súčet výskytov neuvádzam — riadok zachytený dvoma cestami
by sa v ňom počítal dvakrát; distinct je to, na čom stojí rozhodnutie 18).
Najčastejšie: `cloud_off` 9 · `close` 7 · `arrow_upward` 6 · `search` 4.
Štyri ligatúry sú pre grep na markup **neviditeľné**:

| Ligatúra | Kde | Význam |
|---|---|---|
| `search_off` | `cmdk.js:258`, `smernica.js:186` | prázdny výsledok hľadania |
| `filter_alt_off` | `dennik.js:134` | prázdny výsledok filtra |
| `play_arrow` | `timeline.js:23`, `:36` | prehrať replay |
| `pause` | `timeline.js:47` | pozastaviť replay |

· **Efekt: vysoký** — rozhodnutie 18 stavia vlastnú SVG sadu „celú naraz". Sada
  postavená zo 37 by mala **4 diery** a tie štyri by sa vykreslili ako surový
  ligatúrový názov, teda presne tá porucha, kvôli ktorej z projektu odišlo Google
  Fonts CDN. · **Riziko: vysoké, ak sa čísla neopravia teraz.**

## 4.2 Semantická mapa — 41 ikon podľa toho, čo nesú

### A. Destinácia (obrazovka v raile) — 8, každá unikátna ✅
| Ikona | Destinácia | Miesto |
|---|---|---|
| `wb_sunny` | Dnes | `mind.blade.php:142` (+ tlačidlo `:76`) |
| `receipt_long` | Denník | `:152` |
| `gavel` | Rozhodnutia | `:155` |
| `bolt` | Runy | `:158` |
| `menu_book` | Knižnica | `:165` |
| `fact_check` | Kontrola | `:168` |
| `assignment` | Smernica | `:171` |
| `hub` | Graf | `:145` |

### B. Typ objektu — 4
`description` = dokument `.md` (`mind.blade.php:439`, `smernica.js:352`) ·
`memory` = model / pamäť (`console.blade.php:90`) ·
`account_tree` = štruktúra (`mind.blade.php:68`) ·
`layers` = pohľad Vrstvy **a zároveň** panel artefaktu (viď kolízie)

### C. Akcia — 17
`add` (nové vlákno / priblížiť) · `remove` (oddialiť) · `close` (zavrieť / odobrať) ·
`delete` (zmazať) · `edit` (upraviť) · `save` (uložiť) · `content_copy` (kopírovať) ·
`link` + `add_link` (prepojiť) · `send` (odoslať) · `arrow_upward` (odoslať / hore /
na spodok / rozbaliť) · `stop` (zastaviť beh) · `search` (hľadať) · `sync`
(synchronizovať) · `tune` (nastavenia) · `help` (pomoc) · `center_focus_strong`
(vycentrovať) · `category` (legenda) · `play_arrow` + `pause` (replay) ·
`verified` (overiť) · `done_all` (vyriešiť / žiadne duplicity) · `redo` (preskočiť) ·
`list` (vlákna)

### D. Stav / výsledok — 6
`check_circle` (úspech) · `cloud_off` (**9× — pád fetchu**) · `search_off` (nič sa
nenašlo) · `filter_alt_off` (filter nič nedal) · `commit` (commit v zázname) ·
`done_all` (prázdna fronta = dobrý stav)

### E. Identita — 0 ikon, 1 znak
`#brand-core` je inline SVG, nie ligatúra. Manuál §7 hovorí, že vľavo hore v Charónovi
je **znak, nie ikona `hub`** — a to sa dodržalo v hlavičke (`console.blade.php:54`),
ale nie na prepínači doku (viď kolízie).

## 4.3 Kde sa tá istá vec kreslí dvomi ikonami — a naopak

### K1 · `arrow_upward` nesie ŠTYRI rôzne veci (najhoršia kolízia)
| Miesto | Význam |
|---|---|
| `chat.blade.php:205`, `console.blade.php:135` | **odoslať správu** |
| `chat.blade.php:198`, `console.blade.php:120` (`.ms.flip`) | **skočiť na spodok** (prevrátené) |
| `mind.blade.php:58` `#btn-up` | **o úroveň von v grafe** |
| `runy.js:219` | **rozbaliť / zbaliť beh** |
· Efekt: vysoký · Riziko: nízke (rozhodnutie 18 sadu kreslí od nuly).

### K2 · „Odoslať" sa kreslí DVOMA ikonami
`arrow_upward` v `/chat` a `/console` · `send` v doku nad grafom
(`mind.blade.php:494` `#charon-send`). Rozhodnutie 19 (jednotná terminológia) má tu
svoj vizuálny dvojník. · Efekt: stredný · Riziko: nízke.

### K3 · „Prepojiť" sa kreslí DVOMA ikonami
`link` (`mind.blade.php:440` `#node-connect`, title „Prepojiť s uzlom") ·
`add_link` (`panels.js:137` `.sug-add`, title „Prepojiť"). Rovnaká akcia, dve kresby.
· Efekt: nízky · Riziko: nízke.

### K4 · „Hotovo / potvrdené" sa kreslí TROMI ikonami
`verified` = Overiť (`kontrola.js:363`) · `done_all` = Vyriešiť (`kontrola.js:364`)
**a zároveň** „Žiadne duplicity" (`structure.js:162`, `:189`) · `check_circle` =
úspešný toast (`toasts.js:60`) a „všetko vybavené" (`dnes.js:188`). Prvé dve stoja
**vedľa seba v jednom riadku fronty**. · Efekt: stredný · Riziko: nízke.

### K5 · `hub` nesie ŠTYRI veci a jedna z nich je proti manuálu
| Miesto | Význam |
|---|---|
| `mind.blade.php:66` `#btn-view-net` | pohľad **Sieť** |
| `mind.blade.php:145` | destinácia **Graf** |
| `mind.blade.php:94` `#charon-toggle` | **otvoriť Charóna** ← manuál §7 tu chce znak |
| `mind.blade.php:438` `#node-charon` | **priložiť uzol do rozhovoru** |
· Efekt: vysoký (rieši aj rozhodnutie 4) · Riziko: nízke.

### K6 · `close` nesie DVE roly
Zavrieť plochu (`#dock-close`, `#node-close`, `#help-close`, `#md-close`,
`#charon-close`, `#chat-artifact-close` = 6×) · **odobrať položku**
(`charon.js:601` `.ctx-x`, `panels.js:86` „Zrušiť spojenie" = 2×). Zatvorenie je
nedeštruktívne, odobranie deštruktívne. · Efekt: stredný · Riziko: nízke.

### K7 · `add`/`remove` sú aj zoom, aj „nové"
`add` = „Nové vlákno" (`chat.blade.php:91`, `console.blade.php:60`) **aj** „Priblížiť"
(`mind.blade.php:466`); `remove` = „Oddialiť" (`:467`). Zoom je +/−, nie add/remove.
· Efekt: nízky · Riziko: nízke.

### K8 · `layers` je pohľad aj panel
`mind.blade.php:67` pohľad **Vrstvy** grafu · `chat.blade.php:166` **panel artefaktu**.
· Efekt: nízky · Riziko: nízke.

### K9 · `redo` znamená „Preskočiť"
`kontrola.js:365`, `:524`, title „Preskočiť". `redo` je „zopakovať". Ikona hovorí
niečo iné než jej vlastný `aria-label`. · Efekt: nízky · Riziko: nízke.

### K10 · `arrow_downward` neexistuje a rieši sa rotáciou — na dvoch miestach
`.ms.flip { transform: rotate(180deg) }` je deklarované **dvakrát s identickou
hodnotou** (`chat.css:107`, `console.css:1208`) a **nie je v `mind.css`**, hoci ten sa
načítava prvý na všetkých troch plochách. Dôvod (`arrow_downward` nie je v subsete) je
zdokumentovaný na oboch miestach. Rozhodnutie 18 tento hack ruší — vlastná sada
nakreslí ikonu nadol. · Efekt: nízky · Riziko: nízke.

## 4.4 Chýbajúci `sans-serif` fallback práve na najväčšej ploche

| Súbor | `.ms` `font-family` | `liga` | Veľkosť |
|---|---|---|---|
| `mind.css:887–889` | `'Material Symbols Rounded'` — **bez fallbacku** | **nedeklaruje** | `--icon-md` 20 px |
| `console.css:1277–1281` | `…, sans-serif` ✅ | ✅ | `--icon-sm` 18 px |
| `chat.css:98–103` | `…, sans-serif` ✅ | ✅ | `--icon-sm` 18 px |

Komentáre v `console.css:1273` aj `chat.css:94` to **priznávajú** doslova:
*„mind.css fallback nemá"*. Keď subset zhavaruje, na `/` — teda na ploche s 8
destináciami v raile, breadcrumbom a grafovými nástrojmi — sa každá ikona vykreslí
ako **surový ligatúrový názov v pätkovom fallbacku**. To je presne porucha, ktorá
podľa CLAUDE.md viedla k odstráneniu Google Fonts CDN, a je opravená na dvoch
plochách z troch.
· **Efekt: vysoký** · **Riziko: nulové** (jedno slovo v jednej deklarácii).

## 4.5 Stav subsetu sa nedá overiť z tohto zadania

CLAUDE.md eviduje **32 ikon k 20. 8. 2026** a metódu overenia (meraj šírku
vykresleného glyfu, nečítaj GSUB). Dnes je ich **41**, teda **pribudlo najmenej 9**,
a subset (`public/fonts/material-symbols-rounded-subset.woff2`, 132 196 B, mtime
**18. 8. 2026 13:38**) sa odvtedy **neprestaval** — je starší než záznam o 32 ikonách.
Meranie vyžaduje prehliadač, ktorý mi je v tomto zadaní zakázaný.
· **Otvorený bod pre koordinátora, nie nález.** Ak rozhodnutie 18 (vlastná SVG sada)
  prebehne, subset ide von celý a bod zaniká. Ak by sa odkládal, treba pustiť
  `iconrender.js` nad všetkými **41**.

---

# 5. Prázdne a chybové stavy

## 5.1 Inventár

Príkaz: `grep -rn "renderEmpty(\|emptyHtml(\|renderLoading(\|loadingHtml(\|emptyCardHtml("`
→ **66 zásahov v 15 moduloch**, z toho 7 v `mind/util.js` sú samé definície helperov,
takže **volaní je 59**. Tri helpery (`mind/util.js:488–522`):

| Helper | Kresba | Podpora akcie |
|---|---|---|
| `emptyHtml(icon, text, hint)` | ikona + veta + nepovinná druhá veta | **žiadna** — parameter neexistuje |
| `emptyCardHtml(text)` | jeden tichý `<p class="card-empty">` | žiadna |
| `loadingHtml(text)` | dýchajúci znak + veta | — |

## 5.2 Rozhodnutie 13 — „ponúka akciu?"

**Jediný prázdny/chybový stav v celej appke s klikateľnou akciou je
`.empty.empty-network`** (`mind/main.js:24–33`): ikona `cloud_off` + h4 *„Vedomie sa
nepodarilo prebudiť"* + *„Server neodpovedá — skontroluj, či Hades beží."* +
`<button class="primary" id="retry-init">Skúsiť znova</button>`. Text presne
zodpovedá manuálu §6. ✅

Druhá výnimka je `.rail-retry` (`console.css:317–330`) — retry v raile vlákien.

**Všetky ostatné (24 miest) ponúkajú maximálne VETU, nikdy tlačidlo.** Rozhodnutie 13
je teda **zmena API helpera**, nie prepis textov.

### Prázdne stavy s poučením (text + rada) — 16

`dennik.js:134/135` · `dnes.js:79` · `kniznica.js:129` · `kontrola.js:140/141` ·
`rozhodnutia.js:202` · `runy.js:76` · `smernica.js:186` a 7 chybových
(viď 5.3). Kvalita je dobrá — napr. `runy.js:76`: *„Konzola ešte nič nebežala" /
„Otvor Charóna a zadaj úlohu — každý ťah sa tu objaví so svojou cenou."* To je presne
tvar, aký chce rozhodnutie 13, len bez tlačidla.

### Prázdne stavy BEZ akejkoľvek rady — 8

| Miesto | Text |
|---|---|
| `cmdk.js:258` | „Nič sa nenašlo" |
| `md.js:118` | „Dokument sa nepodarilo načítať" |
| `smernica.js:103` | „Vyber šablónu alebo napíš úlohu" |
| `structure.js:37` | „Zatiaľ žiadna štruktúra" |
| `structure.js:69` | **„Nepodarilo sa načítať"** — bez predmetu aj bez rady |
| `structure.js:162`, `:189` | „Žiadne duplicity" |
| `structure.js:195` | **„Nepodarilo sa načítať"** |

`structure.js:69` a `:195` sú najslabšie hlásenia v appke: neuvedú **čo** sa
nepodarilo ani **čo robiť**. · Efekt: stredný · Riziko: nízke.

## 5.3 Lže niektorý stav pri padnutom fetch? — NIE

Preveril som všetky `catch` vetvy, ktoré kreslia prázdno. **Ani jedna nehlási
prázdno namiesto chyby.** Všetkých 9 chybových ciest má vlastnú ikonu `cloud_off`
a vetu „Nepodarilo sa načítať X":

`dennik.js:59` · `dnes.js:52` · `dnes.js:79` (**čiastočný pád — hlási len tú časť,
ktorá padla, a priznáva to: „Zvyšok obrazovky je aktuálny"** — vzorové riešenie) ·
`kniznica.js:107` · `kontrola.js:102` · `rozhodnutia.js:69` · `runy.js:50` ·
`smernica.js:174` · `md.js:118` · `structure.js:69/195`. **Pravidlo projektu drží.** ✅

Jedna výnimka v tvare, nie v pravde: `smernica.js:322` kreslí chybu
(*„Uložené smernice sa nepodarilo načítať."*) cez **`emptyCardHtml`**, teda ako tichý
riadok v karte — bez ikony, bez rady, vizuálne nerozlíšiteľné od „zatiaľ nič".
Nelže, ale nepriznáva sa dostatočne. · Efekt: nízky · Riziko: nízke.

## 5.4 Rozhodnutie 15 — koľko chybových komponentov je dnes? DEVÄŤ

| # | Komponent | Miesto | Má akciu |
|---|---|---|---|
| 1 | `.empty.empty-network` | `mind.css:2660+`, `main.js:24` | ✅ tlačidlo |
| 2 | `.empty` + `cloud_off` (9 volaní) | `mind/util.js:488` | ✗ veta |
| 3 | `.card-empty` ako chyba | `smernica.js:322` | ✗ |
| 4 | `.toast.error` | `mind.css:3893–3895`, `http.js:31` | ✗ |
| 5 | `.rail-error` + `.rail-retry` | `console.css:317–330` | ✅ retry |
| 6 | `.msg.error .bubble` | `console.css:599–610` | ✗ |
| 7 | `.agent-error` | `console.css:945` | ✗ |
| 8 | `.charon-msg--error` + `.charon-tool.error` + `.charon-agent-err` | `charon.css:156/292/387` | ✗ |
| 9 | `.run-error` | `mind.css:5158`, `runy.js:224` | ✗ |

Deväť kresieb pre jednu vec, v štyroch stylesheetoch. Tokenovo sú **takmer
konzistentné**: **všetky textové časti komponentov 5–9 idú cez `--danger-ink`**
(16 výskytov, merané) — teda zjednotenie je práca s markupom a triedami, nie s farbou.
Dve výnimky sú **ikony**, nie text: `.empty-network .ms` (`mind.css:2673`, 48 px) a
`.toast.error .ms` (`mind.css:3894`) berú základné `--danger`. Ako grafika majú prah
3:1, takže sú obhájiteľné — patria ale do zoznamu v prílohe.
· **Efekt: vysoký** · **Riziko: stredné** — komponenty 6–8 sú v prúde konverzácie,
  kde chyba nesie aj `who`/`meta` riadok; jeden komponent musí tú rolu zniesť.

## 5.5 Rozhodnutie 14 — skeleton v tvare obsahu existuje na DVOCH miestach z dvanástich

| Mechanika | Kde | Tvar |
|---|---|---|
| `.shimmer` + `hades-shimmer` (translateX) | `dnes.js:25–33` — **6 pruhov kopírujúcich hierarchiu dashboardu** | ✅ v tvare obsahu |
| `.sk-row` + `sk-pulse` (opacity) | `console/main.js:358` — 4 riadky railu | ✅ v tvare obsahu |
| `loadingHtml()` — dýchajúci znak + veta | `dennik.js:40` · `kniznica.js:91` · `kontrola.js:71/72` · `rozhodnutia.js:59` · `runy.js:41` · `smernica.js:146` · `structure.js:12/158` · `md.js:107` = **10 miest** | ✗ nie skeleton |

**Najdôležitejší jediný fakt:** zadanie hovorí, že `/api/journal` a `/api/dashboard`
bežia 3–4 s. Dashboard (**Dnes**) skeleton **má**. **Denník skeleton NEMÁ** —
`dennik.js:40` kreslí dýchajúci znak. Druhý najpomalší endpoint appky je jediný,
ktorý by skeleton potreboval najviac a nemá ho.

Naviac sú tie dve existujúce mechaniky **rôzne** (translateX vs opacity, `--dur-pulse`
vs `1.4s` napísané ručne).
· **Efekt: vysoký** · **Riziko: nízke.**

## 5.6 Hlas — päť hlásení hovorí v prvej osobe (manuál §1 to zakazuje)

Manuál §1: *„Hades hovorí neosobne. „V pamäti je…", „Uložené.", nie „Pamätám si…"."*
`mind/util.js:512–515` to výslovne cituje a text `loadingHtml` je preto „Načítava sa…".

| Neosobne ✅ | V prvej osobe ✗ |
|---|---|
| `dennik.js:40` „Načítava sa denník…" | `kniznica.js:91` **„Načítavam knižnicu…"** |
| `kontrola.js:71` „Načítava sa fronta…" | `kontrola.js:72` **„Načítavam frontu…"** |
| `structure.js:12` „Načítava sa štruktúra…" | `runy.js:41` **„Načítavam behy…"** |
| `md.js:107` „Načítava sa dokument…" | `runy.js:273` **„Načítavam beh…"** |
| `rozhodnutia.js:59` „Načítavajú sa rozhodnutia…" | `smernica.js:146` **„Skladám kontext…"** |
| `structure.js:158` „Hľadajú sa duplicity…" | |

**`kontrola.js` má oba tvary v jednej funkcii, dva riadky od seba** (`:71` neosobne,
`:72` v prvej osobe) — pre tú istú frontu, len raz pri filtrovaní a raz pri prvom
načítaní. To je najčistejší dôkaz, že hlas dnes nie je vynútený ničím.

Naviac `runy.js:273` používa na LOADING stav `emptyCardHtml`, nie `loadingHtml` — teda
načítavanie sa kreslí ako prázdno.
· **Efekt: stredný** · **Riziko: nulové** (5 stringov).

## 5.7 Tri prázdne Charóny, tri rôzne kompozície

Manuál §6 kodifikuje: *„Napíš úlohu. Charón vidí celú pamäť Hadesa aj súbory
projektu — a čo chce zmeniť, ukáže dopredu."*

| Plocha | Znak | Nadpis | Text | Zoznam schopností |
|---|---|---|---|---|
| `/console` (`console/render.js:60–80`) | ✅ | „Charón" | **presne podľa manuálu** ✅ | ✅ 4 položky |
| `/chat` (`chat.blade.php:180–188`) | ✅ bez animácie | „Napíš úlohu pre vedomie" | vlastná parafráza | ✗ |
| dok nad grafom (`charon.js:687–699`) | ✗ **žiadny znak** | „Charón nad grafom" | tretia formulácia | ✗ |

· **Efekt: stredný** · **Riziko: nízke.**

---

# 6. Rozpor proti `docs/BRAND-HADES.md`

## 6.1 Kde sa manuál a kód rozchádzajú

| # | Manuál tvrdí | Kód robí | Efekt | Riziko |
|---|---|---|---|---|
| M1 | §2 Pohyb: `prefers-reduced-motion` vypína **obe** animácie znaku | pomenovaný blok vypína len zrod; dýchanie zastavuje až plošné `*{.01ms}` (`mind.css:2728`) | stredný | nízke |
| M2 | §2 Pohyb: znak sa obtiahne aj v **prázdnom stave** | `chat.blade.php:86/182` nemajú `bc-ring`/`bc-core`; dok (`charon.js:694`) znak vôbec nemá | stredný | nízke |
| M3 | §4: „Serif je vzácny, a preto významný" | 1 deklarácia proti 86 mono; 59,5 kB woff2 na jeden prvok, bez preloadu | vysoký | nízke |
| M4 | §5: Material Symbols subset, „dnes chýba `terminal` a `arrow_downward`" | ikon je **41**, nie 32; subset z 18. 8. je starší než záznam o 32; `mind.css` `.ms` navyše **nemá `sans-serif` fallback** ani `liga` | vysoký | nulové (fallback) / vysoké (subset) |
| M5 | §6: kodifikovaná veta prázdneho Charóna | tri rôzne formulácie na troch plochách | stredný | nízke |
| M6 | §7: „vľavo hore je **znak**, nie ikona `hub`" | dodržané v hlavičke `/console`; `#charon-toggle` nad grafom je `hub` (`mind.blade.php:94`) | vysoký | nízke |
| M7 | §7 Favicon: „Inline SVG, **rovnaký** na všetkých stránkach" | inline SVG je naozaj bit-identické (md5 `c0ebff62…` × 3) ✅, **ale** geometria znaku je zapísaná v **8 nezávislých miestach** (viď 6.2) | vysoký | stredné |
| M8 | §9 checklist: „nová ikona → regenerovaný subset" | posledná zmena subsetu 18. 8. 2026 13:38; ikon odvtedy pribudlo ≥9 | vysoký | vysoké |
| M9 | §3: hodnoty rampy | zhodujú sa do posledného hexu ✅ — **žiadny rozpor** | — | — |
| M10 | §1 hlas: neosobne | 5 hlásení v prvej osobe, dve z nich 2 riadky od seba | stredný | nulové |
| M11 | §2: „`--panel-alpha` sklo len na tmavej" (rozhodnutie 20) | drží pre 9 z 12 `backdrop-filter`; 3 scrimy rozostrujú na oboch témach, bez pomenovanej výnimky | stredný | nízke |

### Bonus — komentár, ktorý tvrdí o kóde nepravdu

`mind.css:267`:
```
--content-left: calc(var(--edge) + var(--rail-w) + var(--edge));   /* 104px */
```
`--edge: 16px` (`:238`), `--rail-w: 80px` (`:258`) → **112 px, nie 104**. Komentár na
`:245` to vie („16 + 72 + 16 = 104 → dnes 112"), ale derivovaný token sa neaktualizoval.
**Rozhodnutie 16 mení rail 80 → ~208 px**, takže ten komentár povedie budúcu session
k zlému číslu presne tam, kde bude počítať. · Efekt: nízky · Riziko: nízke.

## 6.2 Geometria znaku je zapísaná OSEMKRÁT

Rozhodnutie 4 žiada „favicon a Electron `.ico` z JEDNÉHO zdroja". Dnes:

| # | Miesto | Zápis |
|---|---|---|
| 1 | `public/brand/hades-sigil-mini.svg` | asset (r 36 / hrúbka 9 / jadro 15) |
| 2 | `resources/views/mind.blade.php:16` | inline data-URI (r 50 / 40.5 / 31.5 / 15) |
| 3 | `resources/views/chat.blade.php:44` | tá istá data-URI (identická) |
| 4 | `resources/views/console.blade.php:20` | tá istá data-URI (identická) |
| 5 | `resources/views/mind.blade.php:114–115` | `r 8.64` / `stroke 2.16` / `r 3.6`, `fill="currentColor"` |
| 6 | `resources/views/console.blade.php:55–56` | tie isté čísla, `fill="var(--brand-gold)"` |
| 7 | `resources/views/chat.blade.php:86–87` **a** `:182–183` | tie isté čísla, bez tried |
| 8 | `public/js/console/render.js:36–46` | tie isté čísla, skladané v JS |
| — | `electron/assets/build-icon.py:13–40` | **znovu implementované v Pythone** s hardcoded RGB tuplami; docstring priznáva „Geometry **follows** docs/BRAND-HADES.md" |
| — | `public/css/mind.css:1194` | `stroke-dasharray: 54.29` = 2π × 8.64 — **deriváty polomeru zapísaný ako konštanta**, manuál naň sám varuje |

Naviac: `public/favicon.ico` v repe je, ale `build-icon.py` stavia
`electron/assets/hades.ico` — **generátor `favicon.ico` v repe nie je**.
A `fill="currentColor"` (#5) vs `fill="var(--brand-gold)"` (#6, #7): dnes vychádza
rovnako, lebo `#brand-core { color: var(--brand-gold) }`, ale sú to dva mechanizmy.

Deviaty výskyt kruhovej geometrie je **legenda typov uzlov** (`panels.js:262–265`) —
`memory` / `skill` / `project` / `core` ako inline SVG s vlastnými polomermi. Nie je to
znak, ale je to ten istý vizuálny jazyk a rozhodnutie 18 ho bude kresliť.

· **Efekt: vysoký** · **Riziko: stredné** — jeden generátor musí vydať 4 formáty
  (SVG asset, data-URI do Blade, `.ico`, CSS `dasharray`) a musí byť **spustiteľný
  v CI alebo aspoň zdokumentovaný**, inak sa deviaty zápis pridá znova.

## 6.3 ČO V MANUÁLI CHÝBA ÚPLNE (rozhodnutie 1 — manuál sa prepisuje)

Prešiel som manuál sekciu po sekcii proti kódu. Toto v ňom **nie je ani zmienkou**:

| Diera | Rozsah, ktorý sa dnes riadi nikým |
|---|---|
| **`prefers-reduced-motion` ako záväzné pravidlo** | §2 ho zmieni pri znaku a grafoch, ale nikde nestojí, že KAŽDÁ animácia má mať **zmysluplný okamžitý ekvivalent**. Dnes 64 pohybov nemá pomenovanú tichú verziu (§3.3). **Rozhodnutie 7 sem musí pridať samostatnú sekciu.** |
| **URL a hlboký odkaz** | manuál nemá o URL ani vetu. Kód: `/` čítá `?screen=` **raz pri boote** (`state.js:87`) a **nikdy ho nepíše**; `setScreen()` (`screens.js:26–34`) píše len `localStorage` + `body.dataset`; na `/` **nie je ani jeden `pushState`/`replaceState`/`popstate`**. Filtre (`kontrola.js:54`, `rozhodnutia.js:40`, `runy.js:56`) skladajú `URLSearchParams` **len pre fetch**, nie pre adresu. `/chat` (4 `popstate` listenery) a `/console` (1) sú riešené. **8 obrazoviek, 0 zápisov do URL.** |
| **Prázdne stavy** | §6 kodifikuje 3 stringy. Nemá slovo o tvare (ikona? nadpis? akcia?), o rozdiele „prázdno vs chyba vs prázdny filter", ani o tom, že prázdno má **učiť**. |
| **Skeletony / načítavanie** | §2 zmieni `load-breathe` v tabuľke pohybu. Nikde nestojí, KEDY je skeleton a kedy dýchajúci znak, ani že skeleton má byť v tvare obsahu. Dnes: 2 skeletony, 10 dýchajúcich znakov, dve rôzne mechaniky (§5.5). |
| **Chybové stavy** | §6 dáva jednu vetu pre pád API. Nemá komponent, nemá pravidlo „chyba vždy pomenuje predmet + jednu akciu". Dnes 9 komponentov (§5.4). |
| **Ikony ako sada** | §5 hovorí len „Material Symbols Rounded, subset, žiadne emoji". Nemá **semantickú mapu** (čo je akcia, čo stav, čo typ), nemá pravidlo „jeden význam = jedna ikona", nemá mriežku, hrúbku obrysu, ani zoznam. Preto existuje 10 kolízií (§4.3). **Rozhodnutie 18 sem musí pridať celú sekciu.** |
| **Hustota a typografické role** | §4 pomenuje 4 rodiny. Nemá slovo o tom, čo je DATA a čo CHROM, ani o podlahe veľkosti dátového textu. Preto 84 dátových deklarácií pod 13 px (§1.2). |
| **Hlas — terminológia** | §1 dá hlas a slovník vedomia (uzol/oblasť/jadro), ale **nemá slovník Charóna**: vlákno vs konverzácia, beh vs ťah, zápis vs uloženie. Rozhodnutie 19 to zjednocuje a manuál dnes nemá kam. |
| **Responzivita** | manuál nemá ani jednu šírku. Kód má `@media` na 1280 / 900 / 860 px (`mind.css:3725`, `:3730`, `console.css:1295`, `chat.css:750`, `:796`). Rozhodnutie 17 (desktop 1280–1920, nič neprekrýva na 768–900) nemá v manuáli oporu. |
| **Grafy** | §2 dá tri trvania animácií. Nemá jazyk osi, mriežky, tooltipu ani rampy — a rozhodnutie 21 ich zjednocuje. Heatmapová rampa `--heat-1..4` (`mind.css:435–438`) v manuáli **nie je vôbec**, hoci `--heat-4 #8734cf` má v CSS nameraný kontrast (5,63:1). |
| **Rail** | §7 opíše znak v raile. Nemá šírku, nemá stav zbalený/rozbalený, nemá pravidlo pre labely. Rozhodnutie 16 mení 80 → ~208 px. |

---

# 7. Zhrnutie pre plán sprintu

## Vysoký efekt, nízke/nulové riziko — začni tu

| # | Nález | Kde |
|---|---|---|
| 1 | `.ms` v `mind.css` nemá `sans-serif` fallback ani `liga` | `mind.css:887` — **jedna deklarácia** |
| 2 | Ikon je **41, nie 37**; 4 sú neviditeľné pre grep na markup | §4.1 — oprav vstup pre rozhodnutie 18 skôr, než sa kreslí |
| 3 | Serif má 1 deklaráciu proti 86 mono, 59,5 kB bez preloadu | §1.4 |
| 4 | `#header-metrics` — hlavné číslo appky na 12 px `--muted` | `mind.css:1423` |
| 5 | `#charon-toggle` je `hub`, manuál žiada znak | `mind.blade.php:94` |
| 6 | Denník (3–4 s endpoint) nemá skeleton, Dnes ho má | `dennik.js:40` |
| 7 | 5 hlášok v prvej osobe, 2 z nich vedľa seba | §5.6 |

## Vysoký efekt, vyššie riziko — potrebuje vlastný celok sprintu

| # | Nález | Prečo riziko |
|---|---|---|
| 8 | Plošné `*{.01ms !important}` blokuje rozhodnutie 7 | zrušenie odoberie tichú verziu **64 pohybom naraz** |
| 9 | Deväť chybových komponentov → jeden | tri z nich žijú v prúde konverzácie a nesú `who`/`meta` |
| 10 | Geometria znaku zapísaná 8× (+ Python reimplementácia) | generátor musí vydať 4 formáty vrátane CSS `dasharray` |
| 11 | Subset Material Symbols je starší než 9 pridaných ikon | ak rozhodnutie 18 nepríde celé, ikony sa vykreslia ako text |
| 12 | 84 dátových deklarácií pod 13 px + 205 bez `line-height` | najväčší zdroj tichého posunu rozloženia; **povinne cez `cssswap.js`** |

## Stredný efekt

`charon.css` úplne mimo typografickej škály (22 raw veľkostí, 0 tokenov) ·
3 scrimy rozostrujú na svetlej téme · `#charon` je plný povrch, `#dock` sklo ·
3 periódy pre „neurčité čakanie" (1,1 / 1,2 / 1,4 s) · `charon.css:257` má vlastný
easing · znak v `/chat` sa neanimuje · tri prázdne Charóny · `structure.js:69/195`
nepomenujú predmet chyby · kolízie ikon K1/K2/K4/K6 · `--card-bg` má 3 volajúcich.

## Nízky efekt

`--shadow-2/3` bez volajúcich · komentár `/* 104px */` pri 112 px ·
`.ms.flip` deklarované 2× · kolízie K3/K7/K8/K9/K10 · vlastné `:root` bloky
v `chat.css` a `console.css` · `smernica.js:322` kreslí chybu ako prázdno.

## Otvorené otázky, ktoré 30 rozhodnutí nezodpovedá

1. **`KONTRAKT-REDIZAJN-2026-08-27.md` v repe nie je.** Existuje mimo? Ak áno, môže
   časť týchto bodov už riešiť.
2. **Plošné `prefers-reduced-motion` pravidlo — zrušiť, oslabiť, alebo ponechať ako
   podlahu?** Rozhodnutie 7 („nie vypnuté, ale zmysluplný okamžitý ekvivalent") sa
   s `!important` na `*` nedá splniť. Odporúčam `:where(*)` alebo `0s` bez
   `!important`, ale je to nevratné pre 64 pohybov naraz → patrí to koordinátorovi.
3. **Sú tri scrimy (`#help-overlay`, `#md-overlay`, `#cmdk`) výnimkou rozhodnutia 20,
   alebo chybou?** Ak výnimkou, potrebujú štvrtý prepínateľný token a vetu v manuáli.
   Dnes navyše používajú dve rôzne hodnoty (4 px vs 6 px) pre jednu rolu.
4. **Rozšírenie role serifu (rozhodnutie 3) prepisuje predchádzajúci sprint.**
   `mind.css:3280–3285` a `3983–3990` nesú zdôvodnenie, prečo serif zo `screen-head h1`
   odišiel. Ktoré nadpisy serif dostane — a prepíše sa manuál §4 skôr?
5. **Kto vlastní favicon `.ico`?** `build-icon.py` stavia `electron/assets/hades.ico`,
   ale `public/favicon.ico` generátor v repe nemá. Jeden zdroj (rozhodnutie 4)
   potrebuje vedieť, ktorý súbor je koreň.
6. **Ide subset Material Symbols von hneď, alebo až po dokončení SVG sady?**
   Ak sa rozhodnutie 18 rozdelí na etapy, subset treba medzitým regenerovať
   nad 41 ligatúrami — inak sa 9 ikon vykreslí ako text.
7. **Kde má stav grafu (zanorenie, filtre, hľadanie) žiť v URL, keď `/` nemá dnes
   žiadny `pushState` ani `popstate`?** Rozhodnutie 8 a 9 predpisujú tvar, ale na `/`
   sa musí postaviť celý mechanizmus od nuly (`/chat` a `/console` ho majú).
   Vzniká tým aj otázka, či `localStorage['hades.screen']` prežije, alebo URL vyhrá.
8. **`ScreenParityTest` a rozhodnutie 8:** ak sa filtre a krátenie textu presúvajú
   do URL, kto ich serializuje — server (dáta) alebo prehliadač (slová)? Invariant
   dvojitej plochy hovorí „filtre sú DATA a patria na server", ale URL vlastní klient.

## Čo som nemohol zmerať

| Údaj | Prečo |
|---|---|
| `line-height: normal` na 13 160 prvkoch (nález R3) | vyžaduje computed style v prehliadači; Browser pane mám v zadaní zakázaný |
| 85,6 % viditeľného textu pod 13 px | to isté — meranie nad DOM, nie nad CSS |
| Rail 562 px pri 594 px výšky bez `overflow-y` | to isté |
| Ktoré z 41 ligatúr subset naozaj má | metóda z CLAUDE.md (šírka vykresleného glyfu) vyžaduje prehliadač; **GSUB nečítať** |
| Kontrasty po zmenách | rovnako; a merač má dve zdokumentované pasce (skládanie pozadia, dosadnutie po prepnutí témy) |

Skripty merania leží v scratchpade: `cssparse.py` (parser) · `fs.py` / `fs2.py` /
`band.py` (typografia) · `surf.py` / `raw.py` (povrchy) · `anim.py` (pohyb) ·
`icons3.py` (ikony) · `inkuse.py` (TEXT vs PLOCHA).

---

# Príloha — rozhodnutie 2: kde základná hodnota slúži ako text

Príkaz: `python <scratchpad>/inkuse.py`. Kalibrácia: `--danger-ink` 16/16 `color:`,
`--danger-soft` 0/18 `color:` → detektor delí správne.

| Token | ako TEXT | ako PLOCHA | `-ink` varianta existuje |
|---|---|---|---|
| `--accent` | **15** | 44 | ✅ `--accent-ink` (42 volajúcich) |
| `--danger` | **9** | 4 | ✅ `--danger-ink` (16) |
| `--success` | **1** | 4 | ✅ `--success-ink` (5) |
| `--warn` | **1** | 4 | ✅ `--warn-ink` (3) |
| `--brand-gold` | 1 | 0 | — (`#brand-core`, pomenovaná výnimka) |
| `--cert-overene` | 1 | 1 | ✗ nemá |
| `--cert-pasca` | 1 | 1 | ✗ nemá |

**26 deklarácií celkom.** Z nich je **12 na prvkoch `.ms`** — teda ikony, ktoré ako
grafika majú prah 3:1, nie 4,5:1, takže sú obhájiteľné:
`mind.css:2673` (48 px), `:3894`, `:2060`, `:2764`, `:3761`, `:3795`, `:3848`,
`:3213`, `:4427`, `console.css:275` a 2 toastové.

**Zostáva 14 miest, kde základná hodnota nesie skutočný text:**

| Miesto | Selektor | Veľkosť |
|---|---|---|
| `mind.css:1089` | `button.danger` | `--fs-body` 13 px |
| `mind.css:4470` | `button.danger.armed` | `--fs-small` 12 px |
| `mind.css:4485` | `.queue-actions button.armed` | `--fs-small` 12 px |
| `console.css:279` | `.tr-act.armed` | `--fs-caption` 11 px |
| `mind.css:1313` | `#rail .rail-group :is(button,a).active` | `--icon-md` / `.lbl` 10 px |
| `mind.css:3408` | `#graph-tools button.active` | ikona |
| `mind.css:3519` | `.today-chip .n` | `--fs-small` 12 px |
| `mind.css:3819` | `.dir-path` | `--fs-caption` 11 px |
| `mind.css:3828` | `.dir-badge.ok` | `--fs-micro` 10 px |
| **`mind.css:4110`** | **`.kpi-sub`** | **`--fs-caption` 11 px** ← najmenší text na neladenej hodnote |
| `mind.css:4904` | `#btn-up:hover` | ikona + text |
| `mind.css:4941` | `#presets .preset.active .p-name` | `--fs-body` 13 px |
| `mind.css:5002` | `#ambient-row #btn-ambient:hover` | `--fs-body` 13 px |
| `charon.css:627` | `#charon-toggle[aria-expanded="true"]` | ikona |

To je presný, uzavretý zoznam pre rozhodnutie 2. `--cert-overene` a `--cert-pasca`
sú **iný prípad** — `-ink` variantu nemajú, takže sa musí najprv rozhodnúť, či ju
dostanú (a manuál §3 hovorí, že farby istoty sú značková sémantika, nie
success/warn/error, takže to nie je mechanické doplnenie).
· **Efekt: stredný** · **Riziko: nízke**, ale každý pár treba **premerať** —
manuál §9 žiada „nezhoršiť žiadny pár oproti predchádzajúcemu stavu", a `-ink`
hodnoty sú ladené na **tint**, nie na papier a nie na panel.
