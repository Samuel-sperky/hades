# Audit 1 — DIZAJNOVÝ SYSTÉM (read-only)

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-konzola` · **Agent:** audit č.1
**Predmet:** `public/css/mind.css` (4 168 r.) × `public/css/console.css` (818 r.),
tokeny v `:root`, komponentné názvoslovie, dvojité deklarácie.

## Metóda a nástroje

Všetko v tomto dokumente je zmerané skriptom alebo grepom, nie odhadnuté.
Skripty v scratchpade tejto session:

| Skript | Čo meria |
|---|---|
| `w4dup.js` (prevzaté zo session `3fdaec41`) | páry „selektor + vlastnosť" s rôznou hodnotou |
| `rawcolor2.js` (nový) | literálne farby mimo `:root` (brace-tracking, nie regex na riadok) |
| `tokens.js` (nový) | inventár `:root` tokenov + počet volajúcich v `public/` a `resources/` |
| `overlap.js` (nový) | kolízie tried/id medzi oboma stylesheetmi |
| `usage.js` (nový) | výskyty názvu triedy v JS/blade |

Výstupy: `w4dup-mind.txt`, `w4dup-console.txt`, `tokens.txt`, `overlap.txt`.

**Kľúčový fakt pre celý audit:** `resources/views/console.blade.php:22–23` načítava
**oba** stylesheety. `mind.css` teda plne platí aj na `/console` — každý bare
element selector (`button`, `input`, `textarea`, `body`, `*`) a každá zdieľaná
trieda z grafu je na konzole živá. Duplikáty preto nie sú „dva svety", ale
**kaskádový boj v jednom dokumente**.

**Neoverené (a prečo):** appka na `http://localhost:8080` vracia **401** (`auth.ui`,
commit `cbc2ac1`), bez prihlásenia som nespravil ani jeden screenshot ani meranie
computed styles. Všetky nálezy nižšie sú statické; nikde netvrdím vizuálny dopad,
ktorý som nezmeral z kódu. Body označené NEOVERENÉ potrebujú preklik.

---

## 1. Prekryv a duplicita mind.css × console.css

### D1 — console.css utráca ~200 z 818 riadkov na chróm ovládacích prvkov, ktorý `mind.css` už dodáva bare `button` selektorom

**Tvrdenie:** každý klikací prvok konzoly najprv zdedí `mind.css` `button {}`
(r. 650–669: `background`, `color`, `border`, `border-radius`, `padding`,
`min-height: 32px`, `font-size`, `font-weight`, `font-family`, `display`,
`align-items`, `justify-content`, `gap`, `cursor`, `transition`) a potom to
console.css po jednom vypína.

**Dôkaz:**
- `font: inherit` sa v console.css objavuje **7×** — r. 102, 132, 218, 413, 495,
  584, 663. Každý z nich existuje len preto, aby prebil `mind.css:656–659`
  (`font-size`/`font-weight`/`font-family` na `button`).
- `border: 0` / `border: none` 4× (r. 59, 410, 660, 679), `background: transparent`
  **9×** — resety `mind.css:651–653`.
- Osem blokov re-deklaruje 8–11 z tých istých 15 vlastností:
  `.rail-top a, .rail-top button` (r. 92–112), `.thread-row` (r. 123–140),
  `#rail-toggle` (r. 179–188), `.tc-head` (r. 404–417), `.tc-more` (r. 488–498),
  `.pc-btn` (r. 575–587), `#send, #stop` (r. 671–684), `#to-bottom` (r. 699–716).

**Efekt:** vysoký — je to najväčší jednotlivý zdroj duplicity a hlavný dôvod, prečo
konzola „nesedí" hustotou na graf (viď D3).
**Riziko opravy:** stredné. Každý reset niečo drží; slepé zmazanie vráti prvkom
32px výšku a panelové pozadie.
**Návrh:** v `mind.css` doplniť variantu `button.bare` (bez rámu, bez výplne,
`min-height: auto`, `font: inherit`) ako **jednu** pomenovanú výnimku a v
console.css nechať v tých ôsmich blokoch len to, čím sa daný prvok líši.
Nepridávať to ako nový súbor — patrí to do sekcie
`BASE BUTTON + VARIANTS` (`mind.css:647`).

---

### D2 — `.pc-btn.btn-primary/.btn-ghost/.btn-danger` je čistý PREMENOVANIE `button.primary/.ghost/.danger`, hodnoty sú identické

**Dôkaz (hodnota za hodnotou):**

| console.css | mind.css | zhoda |
|---|---|---|
| `.pc-btn.btn-primary` r. 592–596: `border-color: --accent; background: --accent; color: --on-accent` | `button.primary` r. 676–681: to isté + `font-weight: --fw-semibold` | áno |
| r. 599 hover: `background: --accent-600; border-color: --accent-600` | r. 682: to isté | **1:1** |
| `.pc-btn.btn-ghost:hover` r. 600: `border-color: --border-accent; background: --accent-softer` | `button.ghost:hover` r. 688: `background: --accent-softer; color: --text` | takmer |
| `.pc-btn.btn-danger` r. 602: `color: --danger; border-color: --danger-border` | `button.danger` r. 690–696: to isté | **1:1** |
| r. 603 hover: `border-color: --danger-border-hover; background: --danger-soft` | r. 697: to isté | **1:1** |

**Použitie:** `public/js/console/tools.js:383–387` — trojica
`['btn-primary','btn-ghost','btn-danger']`, jediné miesto v repe.
`btn-*` sa nikde inde nevyskytuje (`grep`: 1 zásah na každý názov, všetky v tom
istom poli).

**Efekt:** vysoký (dva slovníky pre jednu vec je presne cieľ §3/#7 kontraktu).
**Riziko opravy:** nízke — jeden riadok JS.
**Návrh:** v `tools.js:383–385` prepísať `btn-primary → primary`,
`btn-ghost → ghost`, `btn-danger → danger`, `el('button', 'pc-btn ' + cls)`
nechať; zmazať console.css r. 592–603 (12 r.) a nechať `.pc-btn` len na tom, čo
je špecifické pre kartu potvrdenia (`kbd` vnútri, `gap`). **Smer zlúčenia je
jednoznačne k `mind.css`** — tam je základ, tam je viac volajúcich (11 pre
`primary`, 15 pre `ghost`).

---

### D3 — `.tool-call` a `.perm-card` nie sú v zjednotenej karte, ktorú `mind.css` postavil práve na tento účel — a majú iný povrch

**Dôkaz:** `mind.css:3821–3843` je pomenovaný „JEDINÝ zdroj pravdy pre CHRÓM
kariet" a zoskupuje **11** kariet (`.today-card`, `.today-card-link`, `.kpi-card`,
`.dash-card`, `.lib-skill`, `.record`, `.dtl-card`, `.queue-item`, `.dir-group`,
`.dir-preview-wrap`, `.dir-saved-item`) s `padding: var(--card-pad)`,
`background: var(--panel)`, `border: 1px solid var(--border)`,
`border-radius: var(--r-md)`, `box-shadow: none`, `text-align: left`.

console.css deklaruje ten istý chróm dvakrát nezávisle:
- `.tool-call` r. 393–399: `border: 1px solid var(--border)`, `border-radius: var(--r-md)`,
  **`background: var(--surface-2)`**
- `.perm-card` r. 519–526: `border: 1px solid var(--border-accent)`,
  `border-radius: var(--r-lg)`, `background: var(--panel)`, `box-shadow: var(--glow-accent)`
- `.pc-preview` r. 555–569 a `.bubble.md pre.code` r. 335–343: znova
  `--border` + `--r-md` + `--surface-2`

**Merateľný rozdiel:** karty grafu stoja na `--panel`, karty konzoly na
`--surface-2`. Sú to dve rôzne hodnoty v oboch témach (`mind.css:100` vs `:106`,
`:394`) — teda dva rôzne „papiere karty" v jednej appke.

**Efekt:** vysoký (priamo proti „jeden dizajnový jazyk").
**Riziko opravy:** stredné — `--surface-2` je na tmavej téme svetlejšia než
`--panel`, prepnutie mení dojem toku správ. NEOVERENÉ vizuálne.
**Návrh:** pridať `.tool-call` a `.perm-card` do zoskupenia na `mind.css:3821`
a v console.css nechať len odlišnosti (`.perm-card` má akcentový rám + glow,
`.tool-call` má `overflow: hidden`). Ak sa `--surface-2` má zachovať, urobiť
z toho pomenovanú variantu `--card-bg` na skupine, nie tichý rozdiel.

---

### D4 — `kbd` je nakreslený **päťkrát** so štyrmi rôznymi hodnotami

**Dôkaz:**

| Kde | padding | radius | veľkosť | pozadie |
|---|---|---|---|---|
| `console.css:62` (bare `kbd`) | `1px 5px` | `--r-sm` | `--fs-micro` | `--surface-2` |
| `mind.css:1829` `.key-row kbd` | `0 6px`, `min-w 22px`, `h 22px` | `--r-sm` | `--fs-small` | `--surface-2` |
| `mind.css:2803` `#cmdk-trigger kbd` | `1px 5px` | **`5px`** | `--fs-micro` | `--panel-solid` |
| `mind.css:2846` `.cmdk-input-row kbd` | `1px 6px` | **`5px`** | `--fs-micro` | `--surface-2` |
| `mind.css:3756` `.kbd-hints kbd` | `0 5px`, `min-w 20px`, `h 20px` | `--r-sm` | `--fs-caption` | `--surface-2` |

Tri z piatich používajú raw `5px` radius namiesto `--r-sm` (8px).

**Efekt:** stredný.
**Riziko opravy:** nízke — `kbd` je čisto vizuálny prvok, `--border-strong` a
`--surface-2` sú v štyroch z piatich rovnaké.
**Návrh:** presunúť `console.css:62–71` do `mind.css` ako **bare `kbd`** základ
(je to najúspornejšia z piatich verzií), zmazať `#cmdk-trigger kbd` a
`.cmdk-input-row kbd` úplne, a `.key-row kbd` / `.kbd-hints kbd` skrátiť len na
`min-width`/`height` (ich jediná odlišnosť je pevný rozmer klávesu).
Zisk: −28 riadkov, `5px` radius zmizne.

---

### D5 — `.hidden` je bajt za bajt to isté pravidlo v oboch súboroch

**Dôkaz:** `mind.css:495` `.hidden { display: none !important; }` ·
`console.css:766` `.hidden { display: none !important; }`. Keďže sa načítavajú
oba, druhé nikdy nič nezmení.

**Efekt:** nízky · **Riziko:** žiadne · **Návrh:** zmazať `console.css:766`.

---

### D6 — `.sr-only` a `:focus-visible` idú **opačným** smerom: console.css to má lepšie a `mind.css` to nemá vôbec

**Dôkaz:**
- `.sr-only` (`console.css:50–60`) v `mind.css` **neexistuje** —
  `grep "sr-only\|clip-path: inset(50%)" public/css/mind.css` = 0 zásahov.
- `console.css:44–48` má **jedno** globálne pravidlo
  `.console-body :focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--r-sm); }`.
  `mind.css` to isté rieši **34×** per-komponent (`grep -c "var(--focus-ring)"` = 34,
  `grep -c "focus-visible"` = 46).

**Efekt:** vysoký (34 miest na jednu pravdu je presne to, čo `mind.css` sám
o sebe hovorí, že už neplatí — viď komentár pri `tabular-nums`, r. 485–488).
**Riziko opravy:** stredné — časť tých 34 nesie iný `border-radius`
(napr. `#brand-core:focus-visible` r. 773 dopisuje `--r-md`) a `input:focus-visible`
(r. 1032) má vlastný recept. Globálne pravidlo ich prebije len ak bude mať nižšiu
špecificitu; treba prejsť všetkých 34 a nechať výnimky.
**Návrh:** promovať `.sr-only` a `:focus-visible` z console.css do `mind.css`
(sekcia pri `.hidden`, r. 495), potom zmazať tie z 34 miest, ktoré nemajú vlastný
radius. Zisk odhadom −25 riadkov + a11y parita pre graf. **Toto je najlepší pomer
efekt/riziko z celého auditu, pretože sa hýbe SMEROM K už napísanému kódu.**

---

### D7 — prefix `.tc-` znamená v dvoch súboroch dve rôzne veci

**Dôkaz:** `mind.css:522, 530, 2888, 2892` = `.tc-val`, `.tc-label` („today card"
hodnota a popisok). `console.css` = `.tc-head`, `.tc-name`, `.tc-args`, `.tc-state`,
`.tc-body`, `.tc-result`, `.tc-more`, `.tc-caret` („tool call"). Dnes sa suffixy
nekrížia, takže kolízia **nie je** aktívna — je to nabitá zbraň: `mind.css` pri
ďalšej karte pridá `.tc-head` a tichým spôsobom prekreslí karty toolov na konzole.

**Efekt:** stredný (dnes 0 chýb, zajtra tichá regresia)
**Riziko opravy:** nízke — `.tc-*` konzoly má 1 volajúceho (`tools.js`).
**Návrh:** premenovať konzolové `.tc-*` na `.tool-*` (karta sa už menuje
`.tool-call`), alebo mind-ové `.tc-*` na `.today-val`/`.today-label`. Lacnejší je
prvý smer: `tools.js` je jeden súbor.

---

### D8 — aktívne kolízie tried a id (zmerané, nie odhadnuté)

`overlap.js` na oboch súboroch: mind.css 743 blokov / 320 tried / 85 id;
console.css 145 blokov / 71 tried / 18 id. Kolízie:

| Meno | console.css | mind.css | stav |
|---|---|---|---|
| `.msg` | r. 253, 263, 274, 284, 293, 296, 305, 307, 326 | r. 1550–1610 | **aktívna**, riešená prepisom `.console-body .msg` (r. 253, komentár r. 248–252) |
| `#prompt` | r. 639, 649 | r. 1459, 1467, 1484, 2157, 2714, 3091 | **aktívna**, riešená `display: block !important` (r. 649, komentár r. 642–648) |
| `.ms` | 8 blokov | 25 blokov | benígna (obe kreslia tú istú ikonu, ale `.ms` je v console.css **znovu definované celé** r. 770–781) |
| `.error` | r. 296, 305, 307, 402, 459 | r. 3257–3259 | benígna — mind má len `.toast.error` |
| `.hidden` | r. 766 | r. 495 | duplikát, viď D5 |
| `.lbl` | r. 813 | r. 840 | benígna (rôzne rodičia) |

`.ms` (r. 770–781) je 12 riadkov, ktoré `mind.css` už má — ale nemohol som overiť,
či je mind-ová verzia identická bez prekliku (`font-variation-settings` sa v grafe
mení per-komponent). **NEOVERENÉ**, treba porovnať computed style.

---

## 2. Paralelné komponenty s tou istou úlohou a iným menom

### D9 — `.metric-*` × `.kpi-*`: dve rodiny pre „číslo s popiskom"

| | `.metric-*` | `.kpi-*` |
|---|---|---|
| CSS | `mind.css:2187–2220` (34 r.): `.metric-grid`, `.metric`, `.metric-val`, `.metric-label`, `.metric-sub` | `mind.css:3396–3433` (38 r.): `.kpi-grid`, `.kpi-card`, `.kpi-val`, `.kpi-label`, `.kpi-suffix` |
| mriežka | `grid-template-columns: 1fr 1fr`, `gap: --sp-1` | `repeat(auto-fit, minmax(160px, 1fr))`, `gap: --sp-1` |
| číslo | `--fs-metric` (= `--fs-headline`, 24px) | `--fs-kpi` (30px) |
| chróm | vlastný (`--surface-2` + `--border` + `--r-md`, `padding: 12px --sp-2`) | zdedený zo zjednotenej karty (r. 3821) |
| volajúci v JS/blade | `resources/views/mind.blade.php:181` (`#stats-cards`), `public/js/mind/panels.js:522–524` | `public/js/mind/screens/dnes.js:143–170` (helper + 5 volaní), `:29` (skeleton) |
| celkovo výskytov `grep` | 1 blade + 3 riadky JS | 2 riadky JS |

**Efekt:** stredný — je to menovaný cieľ G4/vlny 3 v `docs/UX-PLAN-AURA-PARITA.md`.
**Riziko opravy:** stredné. Nie sú to len iné názvy: `.metric` je **dvojriadkový
blok s vlastným rámom**, `.kpi-card` je **jednoriadkový strip na účiare**
(`mind.css:3405–3410` to výslovne vysvetľuje ako uvážené rozhodnutie). Slepé
premenovanie zmení panel štatistík grafu.
**Návrh (lacnejší smer):** `.metric-*` → `.kpi-*`, pretože má **menej volajúcich
v JS** (3 riadky v `panels.js` vs helper s 5 volaniami v `dnes.js`) a jeho chróm sa
tým **zaradí pod zjednotenú kartu** (r. 3821), čo je čistý zisk. Dvojriadkovú
podobu podržať modifikátorom `.kpi-card--block` (grid-template `1fr 1fr` +
`flex-direction: column`), nie druhou rodinou. Odhad: −30 r. CSS,
`panels.js:522–524` + `mind.blade.php:181`, povinný preklik panelu Štatistiky.

### D10 — `.badge` × `.chip`: NIE je to duplicita, nezlučovať

Overil som hodnoty: `.badge` (`mind.css:1161–1175`) je **statický** mono popisok
verzálkami (`--surface-subtle`, `--accent-ink`, `--ls-mono-caps`, `--fs-caption`,
bez `cursor`, bez `:hover`), `.chip` (`mind.css:1307–1326`) je **interaktívny**
(`cursor: pointer`, `:hover` na `--accent-softer`, `:active` `scale(.97)`,
`:focus-visible`). Komentár na r. 1306 to hovorí explicitne
(„Chip — interactive (neighbor browsing = core loop)").

To je presne kánon z CLAUDE.md: teal nesie interaktívny stav. Zliať ich by ten
kánon rozbilo. **Efekt zlúčenia: negatívny.** Patrí to do sekcie „NEROBIŤ".

Čo je ale reálny nález: **konzola nemá ani jedno z nich** — `.badge`/`.chip`
v console.css chýbajú (0 blokov), a stav toolu sa kreslí ako
`.tc-state { color; font-size; font-family }` (r. 450–460, štyri stavy
`running`/`waiting`/`error`/`denied`). Keď vlna C postaví obrazovku **Runy**,
vymyslí si tretiu rodinu. Návrh: `.tc-state` prepísať na `.badge` s modifikátorom
stavu ešte **pred** Runami.

### D11 — `.empty-state` × `.empty` × `.card-empty`: tri prázdne stavy

| | `.empty-state` | `.empty` | `.card-empty` |
|---|---|---|---|
| CSS | `console.css:359–389` (+ r. 246, `.empty-can`) | `mind.css:2039–2060` | `mind.css:2024–2036` |
| tvar | `max-width: 600px`, `margin-top: 10vh`, `h2` na `--fs-display` | flex column, centrovaný, ikona 28px `opacity .5` | jeden riadok, `min-height: 132px` |
| volajúci | `public/js/console/render.js` (2×) | `renderEmpty()` v `util.js`, 5 volajúcich JS | `emptyCardHtml()` v `util.js` |

`mind.css:2020–2023` výslovne vysvetľuje, prečo `.card-empty` **nie je** `.empty`
(nadpis karty už kontext povedal). To je legitímny rozpad na dva. Tretí
(`.empty-state`) je ale **onboarding obrazovka konzoly**, teda štvrtá vec s tretím
menom.

**Efekt:** nízky-stredný · **Riziko:** nízke ·
**Návrh:** `.empty-state` premenovať na `.empty--hero` (modifikátor `.empty`)
a prevziať z neho `align-items`/`gap`; `.empty-can` nechať, je to zoznam schopností,
nie prázdny stav.

### D12 — stavové názvy: `.active` × `.current` × `.selected` × `.open` × `.on`

**Dôkaz (`grep -c`):** `mind.css`: `.active` 16, `.open` 3, `.armed` 2,
`.current` 1, `.selected` 1. `console.css`: `.on` (r. 749, 751) + atribúty
`[aria-current="true"]` (r. 143) a `[aria-expanded="true"]` (r. 435).

Konzola robí správnu vec (stav na ARIA atribúte, jeden zdroj pravdy pre CSS aj
čítačku) na dvoch z troch miest a `.on` je výnimka.
**Efekt:** nízky · **Riziko:** nízke ·
**Návrh:** `.sp-item.on` → `.sp-item[aria-selected="true"]`
(`#slash-palette` už má `role="listbox"`, `console.blade.php:103`) — vyrieši to aj
dieru pre čítačku. Zjednocovanie `.active`/`.current`/`.selected` v `mind.css`
nechať mimo tejto vlny: `.current` a `.selected` majú 1 volajúceho každý, výnos je
nulový a riziko nenulové.

### D13 — dve slovníkové sady pre správu v chate

| Rola | graf (`mind.css`) | konzola (`console.css`) |
|---|---|---|
| správa používateľa | `.msg.me` (r. 1559) | `.msg.user` (r. 284) |
| odpoveď modelu | `.msg.hades` (r. 1560) | `.msg.assistant` (r. 293) |
| systémová | `.msg.sys` (r. 1590) | `.msg.system` (r. 295) |
| chyba | `.msg.sys--error` (r. 1597) | `.msg.error` (r. 296, 305, 307) |
| telo | *(žiadne, text priamo v `.msg`)* | `.bubble` (r. 284, 293, 296…) |
| autor | `.avatar` (r. 1574) | `.who` + `.who-model` (r. 263, 276) |

Toto je koreň kolízie z D8: dva slovníky pre jeden komponent v jednom dokumente.
**Efekt:** vysoký (najviditeľnejšie „dve appky v jednej") ·
**Riziko opravy:** stredné-vysoké — `.msg` v grafe kreslí `chat.js`, v konzole
`console/render.js` (9 miest), a `.console-body .msg` prepis (r. 253–261) by pri
prečistení musel padnúť naraz s ním.
**Návrh:** zjednotiť na **konzolový** slovník (`user`/`assistant`/`system`/`error`
+ `.bubble`), pretože je popisnejší, má `.bubble` ako telo (graf ho potrebuje tiež,
dnes bublinu maľuje na `.msg` samotný) a je zhodný s tvarom API. Cena: `chat.js`
+ ~10 selektorov v `mind.css`. **Toto je jediná zmena z auditu, ktorá si zaslúži
vlastnú vlnu a vlastný preklik.**

---

## 3. Raw hex / rgba() / hsl() mimo `:root`

### D14 — pravidlo je splnené v oboch súboroch: **0 literálnych farieb mimo `:root`**

Zmerané `rawcolor2.js` (brace-tracking `:root` a `:root[data-theme="dark"]`,
komentáre odstránené, `#id` selektory odfiltrované podľa pozície za `:`):

| Súbor | riadkov v `:root` | RAW farba mimo `:root` |
|---|---|---|
| `mind.css` | 378 | **0** |
| `console.css` | 0 | **0** |

Prvá verzia môjho skriptu hlásila 139 zásahov v `mind.css` — všetky boli
false-positives (`:root` telo nesprávne detegované cez viacriadkový komentár,
plus `#dec-add-toggle`, `#dec-area`, `#dec-date` čítané ako hex `#dec`).
**Detektor sa musí kalibrovať na známom stave** — presne tá pasca, ktorú CLAUDE.md
menuje pri meracích harnessoch.

### D15 — 8 miest komponuje alfu z tokenového tripletu s natvrdo zapísanou hodnotou

**Dôkaz:** `mind.css:684, 1093, 1095, 1097, 1098, 1481, 1486, 1511` —
`rgba(var(--accent-rgb), .35 / .16 / .16 / .30 / .30 / .16 / .10 / .75)`.
Farba je tokenová (pravidlo neporušené), **alfa nie** — sedem rôznych hodnôt pre
tri roly (disabled, focus wash, tichý text).

**Efekt:** nízky · **Riziko:** nízke ·
**Návrh:** nepridávať `--alpha-*` škálu (bola by to škála bez významu). Namiesto
toho tri pomenované tokeny: `--accent-disabled-fill`, `--accent-focus-wash`,
`--accent-text-quiet`. Ak sa nerobí, netreba to hlásiť ako dlh — pravidlo z
CLAUDE.md hovorí o farbe, nie o alfe.

### D16 — favicon konzoly nesie tri natvrdo zapísané hodnoty palety

**Dôkaz:** `resources/views/console.blade.php:13` — `%230e1413` (`--on-accent`
dark), `%2305bcc4` (`--accent` dark), `%23d8b878` (`--brand-gold`).
Data-URI SVG nemôže čítať CSS premenné, takže **toto je nevyhnutné**. Hlásim to
len preto, aby to pri zmene palety niekto nezabudol.
**Efekt:** nízky · **Návrh:** komentár v blade, ktorý menuje tri tokeny.
Nič viac.

---

## 4. Dvojité deklarácie (`w4dup.js`)

### D17 — tvrdenie z CLAUDE.md je pravdivé: `mind.css` má **A=0**

Beh na dnešnom `public/css/mind.css` (4 168 r., **743** blokov,
**3 498** unikátnych párov selektor+vlastnosť; v session `3fdaec41` to bolo
718 / 3 376 — súbor odvtedy narástol, dvojice nie):

```
A) dve pravdy, rovnaká špecificita, mimo at-rule, span >= 120 r.:  0
B) dve pravdy, span < 120 r.:                                      4
C) legitímne override-y (iná špecificita alebo at-rule):          15
```

Tie 4 v skupine B sú presne menovaná výnimka z CLAUDE.md:
`.lib-skill / .record / .dtl-card / .dir-saved-item ## --card-pad`,
`var(--sp-2)` → `var(--sp-2h)`, **span 17** — presne to číslo, ktoré CLAUDE.md
uvádza. (`w4dup` reportuje riadok otváracej zátvorky bloku, teda 3831 a 3848;
samotné deklarácie sedia na 3832 a 3848.)
Skupina C má 15 položiek, všetky media query alebo `prefers-reduced-motion`.
**Zhoda s dokumentáciou: úplná.** Nemám čo opraviť.

### D18 — `console.css` má tiež **A=0**, ale štyri „skupina + variant" prepisy

Beh na `console.css` (146 blokov, 691 párov): `A=0, B=4, C=8`. Tie štyri:

| Pár | prvý zápis | prepis | vzdialenosť |
|---|---|---|---|
| `.empty-state ## max-width` | r. 246 `820px` (v skupine s `.tool-call, .perm-card`) | r. 359 `600px` | **113 r.** |
| `#stop ## background` | r. 672 `--accent` (v skupine s `#send`) | r. 687 `--danger` | 15 r. |
| `.msg.error .bubble ## background` | r. 296 `--surface-2` (skupina so `.msg.system`) | r. 307 `--danger-soft` | 11 r. |
| `.msg.error .bubble ## color` | r. 296 `--text-secondary` | r. 307 `--text` | 11 r. |

Tri z nich sú tesné a čitateľné (11–15 r.), rovnaký idiom ako `--card-pad`
v `mind.css`. **`.empty-state ## max-width` (113 r.) je ale pasca** rovnakého
druhu, akú CLAUDE.md opisuje: kto čita r. 246, uveria, že prázdny stav má 820 px,
a 600 px nájde o 113 riadkov nižšie.

`C=8` je celé v jedinom `@media (max-width: 860px)` (r. 783–818) — legitímne.

**Efekt:** nízky · **Riziko:** žiadne ·
**Návrh:** z r. 246 vyňať `.empty-state` (`.tool-call, .perm-card` nechať) a
`max-width: 600px` na r. 359 tým osamostatniť. Do kontraktu zapísať
`console.css: A=0, B=4, C=8` ako **baseline** — bez zapísaného čísla akceptačné
kritérium §7/1 („detektor hlási 0 nových dvojíc") nemá voči čomu merať.

---

## 5. Chýbajúce tokeny — čo existuje pod iným menom, čo naozaj chýba

Overené `grep -- "--<meno>" public/css/mind.css` na každom mene z §5 vlny B kontraktu.

### Stačí ALIAS (hodnota už existuje, chýba len Aura meno)

| Žiadaný | Existujúci ekvivalent | Kde |
|---|---|---|
| `--card-radius` | `--r-md: 10px` | `mind.css:182` |
| `--shadow-sm/md/lg` | `--elev-1 / --elev-2 / --elev-3` | r. 274–276 |
| `--shadow-pop` | `--elev-tooltip` | r. 277 |
| `--shadow-gold` | `--core-shadow`, `--core-glow-min/max` | r. 283–286 |
| `--transition` | `var(--dur-base) var(--ease)` (180 ms + `cubic-bezier(.22,.61,.36,1)`) | r. 312, 315 |
| `--transition-fast` | `var(--dur-fast) var(--ease)` (150 ms) | r. 311 |
| `--section-gap` / `--grid-gap` | `--gutter: 20px` („dashboard grid gutter") | r. 373 |
| `--page-h1` | `--fs-headline: 24px` + `--lh-headline` | r. 242 |
| `--kpi-value` | `--fs-kpi: 30px` + `--lh-kpi` | r. 362 |
| `.tnum` utilita | `body { font-variant-numeric: tabular-nums }` — **globálne od r. 489** | r. 485–489 |

`.tnum` z plánu parity teda **netreba vôbec** — `mind.css:485–489` to už vyriešil
globálne a komentár tam hovorí, že lokálne opakovania sú „od teraz len zbytočné".
**Ale:** 16 z nich v súbore stále je (r. 545, 927, 1166, 1976, 2209, 2424, 2464,
2535, 2890, 3044, 3353, 3382, 3424, 3503, 3525, 3545, 3780 — selektory
`#status-chip`, `#header-metrics`, `.badge`, `#hint .step`, `.metric-val`,
`.tree-row .count`, `.tree-muted .count`, `.dup-pct`, `.tc-val`, `#pack-count`,
`.hero-val`, `.ha-val`, `.kpi-val`, `.dt-num`, `.cl-n`, `.db-n`). Všetky sedia na
`div`/`span`, teda **sú inertné** a dajú sa zmazať (−16 r., riziko žiadne).
**Pozor pri tom:** UA štýl na `button`/`select`/`input`/`textarea` používa `font`
shorthand, ktorý `font-variant-numeric` resetuje na `normal` — na formulárových
prvkoch to inertné **nie je**. `console.css` má `tabular-nums` **0×** a `#run-stats`
(r. 227) je `<span>`, takže dedí správne; `#model-select` je `<select>` a čísla
nenesie. NEOVERENÉ v prehliadači.

### Naozaj CHÝBA (nemá ekvivalent, treba pridať hodnotu)

| Žiadaný | Prečo nejde aliasovať | Dôkaz dnešného stavu |
|---|---|---|
| `--chart-1..8` | existujú len dve rodiny a ani jedna nie je kategoriálna osmica: `--heat-0..4` (sekvenčný teal ramp, r. 351–355) a `--cert-overene/hypoteza/pasca/none` (semantická štvorica, r. 340–348) | G1 v `docs/UX-PLAN-AURA-PARITA.md`; `charts.js` číta `--heat-*`, `--cert-*`, `--accent`, `--muted`, `--track`, `--mono`, `--ls-mono` |
| `--chart-h / -sm / -lg` | výška je zadrôtovaná v HTML | `resources/views/mind.blade.php:189` — `<canvas id="growth-chart" width="248" height="60">` |
| `--row-pad-y / --row-pad-x` | dnes **štyri rôzne** hodnoty pre ten istý riadok zoznamu: `.stat-row` `var(--sp-1) 10px` (`mind.css:1330`), `.thread-row` `var(--sp-1) 10px` (`console.css:126`), `.tc-head` `8px 12px` (r. 409), `.sp-item` `7px 10px` (r. 743) | zmerané grepom |
| `--control-h` | dnes **tri** výšky ovládacích prvkov: `button { min-height: 32px }` (`mind.css:656`), `button.close { 32px }` (r. 707–708), `#send/#stop { 30px }` (`console.css:677–678`), `#to-bottom { 30px }` (r. 706–707) | 32 vs 30 px je viditeľný rozdiel na tom istom riadku |
| `--kpi-cols` | zadrôtované `repeat(auto-fit, minmax(160px, 1fr))` | `mind.css:3397` |
| `--kpi-pad` | dnes prichádza z `--card-pad`, ktorý **nie je v `:root`** | viď nižšie |
| `--stream-w` (nežiadané, ale treba) | `820px` je **5× natvrdo** v console.css | r. 246, 254, 626, 690, 728 |

### `--card-pad` je špeciálny prípad: existuje, ale je nedosiahnuteľný

`--card-pad` sa deklaruje **na skupine kariet** (`mind.css:3832`), nie v `:root`.
Console.css sa naň preto nedostane a `.tool-call`/`.perm-card` si píšu padding
ručne (`8px 12px`, `12px 14px`). Komentár na r. 3818–3819 to obhajuje („lokálny
prepínač varianty, nie globálny token") a pre **variantu** to je správne —
ale základná hodnota do `:root` patrí, inak nemá density prepínač na čom stáť.
**Návrh:** `:root { --card-pad: var(--sp-2); }` a na skupine ponechať len
variantu `--card-pad: var(--sp-2h)`. Tým zostane B=4 dvojica v `w4dup` nezmenená
(je to `.lib-skill` a spol., nie `:root`).

---

## 6. Mŕtve tokeny

### D19 — z **157** tokenov v `:root` je **10** bez jediného volajúceho; 3 z nich sú vedome ponechané

`tokens.js` počítal `var(--tok)`, `var(--tok,`, `'--tok'`, `"--tok"`, `` `--tok` ``
naprieč `public/**/*.{css,js,php,html}` a `resources/**/*.{php,css,js}`,
s vylúčením definičných riadkov.

| Token | def. riadky | poznámka |
|---|---|---|
| `--muted-strong` | 123, 407 | nepoužité |
| `--accent-400` | 128, 410 | nepoužité; **hodnota je identická s `--accent-300`** (`#05bcc4` v oboch témach) → nie je to stupeň škály, je to duplikát |
| `--accent-press` | 135, 422 | nepoužité (`:active` používa `--accent-soft`) |
| `--glow-accent-lg` | 143, 426 | nepoužité |
| `--success-soft` | 164, 430 | nepoužité (`--danger-soft` áno, 8×) |
| `--danger-rgb` | 166, 432 | komentár na r. 166 tvrdí „JS/derived triplet: msg.sys--error, danger btn" — **to už nie je pravda**, `--accent-rgb` má 8 volajúcich, `--danger-rgb` nula |
| `--z-vignette` | 321 | súčasť z-index rebríka (`--z-canvas`…`--z-overlay`) |
| `--sp-5` | 192 | **vedome** — komentár r. 232 |
| `--lh-micro` | 235 | **vedome** — komentár r. 232 |
| `--lh-small` | 237 | **vedome** — komentár r. 232 |

**Prvá verzia detektora hlásila 8, nie 10** — regex `/^\s*(--[\w-]+)\s*:/` bral
z riadku len prvý token, a škála je písaná **párovo na jednom riadku**
(`--fs-micro: 10px;   --lh-micro: 1.3;`). Presne tie dva, ktoré CLAUDE.md menuje
ako vedome ponechané, detektor nevidel. Zaznamenávam to, aby to ďalší beh nezopakoval.

**Efekt:** nízky · **Riziko:** nízke ·
**Návrh:** zmazať `--accent-400` (duplikát `--accent-300`) a `--danger-rgb`
(jeho komentár klame o stave kódu). `--muted-strong`, `--accent-press`,
`--glow-accent-lg`, `--success-soft`, `--z-vignette` **nechať** a doplniť im
riadok komentára v duchu r. 232 — sú to úplné roly v úplných škálach
(muted ladder, accent state ladder, glow ladder, semantic soft ladder, z ladder)
a diera v škále je horšia než nepoužitý stupeň. Presne tento argument už súbor
raz vyhral pri `--sp-5`.

### D20 — `--glow-accent` je token grafu, ktorého jediný volajúci je konzola

`tokens.js`: `--glow-accent  console=1  mind=0`. Definované `mind.css:142` (light)
a `:425` (dark), použité **len** `console.css:525` (`.perm-card`).
Nie je to chyba, ale je to jediný token, ktorý sa „presťahoval" — pri prípadnom
čistení `mind.css` by ho niekto zmazal ako mŕtvy, hoci konzola na ňom stojí.
**Návrh:** komentár pri r. 142: „jediný volajúci je `.perm-card` v console.css".

---

## 7. Hustota: merateľný rozdiel disciplíny

### D21 — `console.css` má ~3× vyššiu hustotu natvrdo zapísaných rozmerov než `mind.css`

Zmerané: výskyty číselnej `px` hodnoty v `padding`/`margin`/`gap`:

| Súbor | riadkov | `px` v spacingu | na 100 riadkov |
|---|---|---|---|
| `mind.css` | 4 168 | 135 | **3,2** |
| `console.css` | 818 | 77 | **9,4** |

Rozklad hodnôt v `console.css`: `10px`×20, `6px`×13, `12px`×11, `8px`×10,
`14px`×5, `4px`×4, `18px`×3, `7px`×2, `5px`×2, `3px`, `2px`, `22px`, `20px`.
Škála projektu je `--sp-0..4` = 4/8/16/24/32 + `--sp-2h` = 12.
**Mimo škály je 6, 7, 10, 14, 18, 20, 22 px** — teda console.css si nesie **vlastnú
7-hodnotovú medziškálu**, ktorá nikde nie je pomenovaná.

Ikony sú ten istý prípad: `console.css` píše `font-size: 14px / 16px / 18px`
na r. 274, 389, 420, 539, 750, 772, kým `--icon-2xs: 14px`, `--icon-xs: 16px`,
`--icon-sm: 18px` existujú (`mind.css:262–264`). **Šesť zásahov, nulové riziko.**

**Efekt:** stredný — bez toho density prepínač z vlny B na konzole nezaberie
(nemá čo prepnúť).
**Riziko opravy:** nízke pri ikonách, stredné pri spacingu (mení sa optika).
**Návrh:** (a) 6 ikonových hodnôt na `--icon-*` hneď, (b) 4/8/12/16 na `--sp-*`
hneď (35 zásahov, hodnota sa nemení, teda vizuálne inertné — overiť `cssswap.js`),
(c) hodnoty mimo škály (6/7/10/14/18/20/22) **nechať na vlnu B** a rozhodnúť o nich
naraz s density tokenmi, nie po jednej.

### D22 — tri rôzne hodnoty pre „disabled" a dve inertné deklarácie

**Dôkaz:** `mind.css:673` `button:disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }`
· `console.css:590` `.pc-btn:disabled { opacity: .5; cursor: default; }`
· `console.css:686` `#send:disabled { opacity: .45; cursor: default; }`
· `console.css:530` `.perm-card.denied { opacity: .72; }`

Dve pozorovania:
1. `.pc-btn:disabled` má `.5`, `#send:disabled` `.45` — **v tom istom súbore, dve
   hodnoty pre ten istý stav**. `w4dup` ich nezachytí (iné selektory), a práve preto
   ich treba hlásiť ručne.
2. `cursor: default` na r. 590 aj 686 je **inertné**: `mind.css:673` nastavuje
   `pointer-events: none` na každý `button:disabled`, takže sa kurzor nad prvkom
   nikdy nevyhodnotí. Je to mŕtvy kód spôsobený kaskádou medzi súbormi.

**Efekt:** nízky · **Riziko:** žiadne ·
**Návrh:** zmazať `cursor: default` z r. 590 a 686, `opacity: .5` zjednotiť na
`.45`, a `.45` promovať na token `--disabled-opacity` (aby `.perm-card.denied`
`.72` bola viditeľne **iná** rola, nie tretia náhoda).

### D23 — `console.css` nemá `prefers-reduced-motion` blok, hoci má nekonečnú animáciu

**Dôkaz:** `grep prefers-reduced-motion`: `mind.css` 4 bloky (r. 2094, 2175, 3290,
3802), `console.css` **0**. Pritom `console.css` animuje:
`@keyframes tc-pulse` na `.tool-call.running .tc-state` (r. 457, 462) —
`infinite`, `transition: transform .12s` na `.tc-caret` (r. 432),
`transition: transform .16s` na `#thread-rail` (r. 795).

Vecne to patrí auditu č.4 (prístupnosť), sem to píšem preto, že je to **systémová
diera, nie prehliadnutie**: mind.css má štyri bloky a jeden zdroj pravdy pre
časovanie (`--dur-*`), konzola nemá ani jedno, a nové animácie sa budú pridávať
tam. Konzola tiež nepoužíva `--dur-*`/`--ease` vôbec (`.12s ease`, `.16s ease`,
`1.1s ease-in-out` sú natvrdo).
**Návrh:** `--dur-fast`/`--ease` do tých troch prechodov + jeden
`@media (prefers-reduced-motion: reduce)` blok na koniec `console.css`.

---

## 8. Zhrnutie: poradie podľa pomeru efekt/riziko

| # | Nález | Efekt | Riziko | Odhad |
|---|---|---|---|---|
| 1 | **D6** promovať `.sr-only` + globálny `:focus-visible` z console.css do mind.css | vysoký | stredné | −25 r., a11y parita pre graf |
| 2 | **D2** `btn-* → primary/ghost/danger` | vysoký | nízke | 3 r. JS, −12 r. CSS |
| 3 | **D21a** 6 ikonových px → `--icon-*`, 35 spacingov → `--sp-*` | stredný | nízke | vizuálne inertné |
| 4 | **D5** zmazať duplicitné `.hidden` · **D22** zmazať 2 inertné `cursor` · **§5** zmazať 16 inertných `tabular-nums` | nízky | žiadne | −19 r. |
| 5 | **§5** `--card-pad` do `:root` + aliasy (`--card-radius`, `--shadow-*`, `--transition*`, `--section-gap`, `--page-h1`, `--kpi-value`) | vysoký | žiadne | vlna 1 plánu parity, iba pridávanie |
| 6 | **§5** nové hodnoty: `--chart-1..8`, `--chart-h*`, `--row-pad-*`, `--control-h`, `--kpi-cols`, `--stream-w` | vysoký | nízke | nosič density prepínača |
| 7 | **D4** jeden `kbd` základ | stredný | nízke | −28 r. |
| 8 | **D1** `button.bare` varianta + prečistiť 8 blokov | vysoký | stredné | −60 r., povinný preklik |
| 9 | **D3** `.tool-call`/`.perm-card` do zjednotenej karty | vysoký | stredné | rozhodnúť `--panel` vs `--surface-2` |
| 10 | **D9** `.metric-* → .kpi-*` | stredný | stredné | preklik panelu Štatistiky |
| 11 | **D7** `.tc-* → .tool-*` v konzole | stredný | nízke | 1 súbor JS |
| 12 | **D13** jeden slovník pre `.msg` | vysoký | vysoké | vlastná vlna |
| 13 | **D19** zmazať `--accent-400`, `--danger-rgb`; ostatným dopísať komentár | nízky | nízke | −2 r. |
| 14 | **D18** baseline `console.css: A=0 B=4 C=8` do kontraktu | — | žiadne | 1 riadok |

---

## 9. Čo vedome NEROBIŤ

1. **Nezliať `.badge` s `.chip`** (D10). Overil som hodnoty: badge je statický
   popisok, chip má `cursor`, `:hover`, `:active`, `:focus-visible`. Rozdiel nesie
   kánon „teal je interaktívny" z CLAUDE.md. Zlúčenie by ho rozbilo a získalo by
   ~12 riadkov.

2. **Nezliať `.card-empty` s `.empty`.** `mind.css:2020–2023` to už raz rozhodol
   s dôvodom (nadpis karty kontext povedal; `min-height: 132px` drží mriežku
   dashboardu). Je to zdôvodnené rozhodnutie, nie zabudnutý duplikát.

3. **Neprepisovať Hades tokeny na Aura názvy** — len pridávať aliasy.
   `docs/UX-PLAN-AURA-PARITA.md` §5 to hovorí a čísla to potvrdzujú:
   `--sp-1` má 139 volajúcich v mind.css a 12 v console.css, `--muted` 113 + 22,
   `--mono` 63 + 13. Premenovanie je stovky zásahov za nulový vizuálny výnos.

4. **Nerobiť tú istú prácu na `w4dup` v `mind.css`.** A=0, B=4 = presne menovaná
   výnimka, C=15 = media queries. Zaplatené v `c1a3a96`. Jediné, čo tu treba, je
   **zapísať baseline pre `console.css`**, aby akceptačné kritérium §7/1 malo
   voči čomu merať.

5. **Nezjednocovať `.active`/`.current`/`.selected`/`.open` v `mind.css`.**
   `.current` a `.selected` majú **1 volajúceho každý**. Výnos nula, riziko
   nenulové. `.sp-item.on` v konzole áno (D12) — tam to zároveň dopĺňa ARIA.

6. **Nemazať tokeny „mŕtve v škále".** `--muted-strong`, `--accent-press`,
   `--glow-accent-lg`, `--success-soft`, `--z-vignette` sú úplné roly v úplných
   rebríkoch. Tento argument už `mind.css` raz vyhral pri `--sp-5` (komentár
   r. 232) a platí ďalej: diera v škále je horšia než nepoužitý stupeň.
   Zmazať len `--accent-400` (číselný duplikát `--accent-300`) a `--danger-rgb`
   (jeho komentár tvrdí niečo, čo v kóde nie je).

7. **Nesiahať na `.console-body .msg` (r. 253) a `#composer #prompt` (r. 649)
   izolovane.** Obidva sú zdokumentované obchádzky aktívnych kolízií
   (komentáre r. 248–252 a 642–648) a jedna z nich potrebuje **dva** `!important`.
   Padnú **len naraz** s D13; každý samostatný zásah rozbije konzolu.

8. **Neriešiť `.ms` v console.css (r. 770–781) bez prekliku.** Vyzerá to ako
   duplikát `mind.css`, ale `font-variation-settings` sa v grafe mení
   per-komponent a bez computed styles neviem, či sú hodnoty naozaj zhodné.
   NEOVERENÉ — appka vracia 401.

9. **Nezavádzať `.tnum`** z plánu parity. `mind.css:485–489` má
   `font-variant-numeric: tabular-nums` **globálne na `body`** a jeho komentár
   výslovne hovorí, že lokálne opakovania sú už len zbytočné. Pridať utilitu by
   znamenalo tretí mechanizmus na tú istú vec. Namiesto toho zmazať 16 inertných
   opakovaní — ale **overiť pri každom, či nesedí na formulárovom prvku**
   (UA `font` shorthand `font-variant-numeric` resetuje).

10. **Nemeniť farebné hodnoty ani zlatú.** Overené: `console.css` používa zlatú
    **0×** (`grep gold` = 0 v CSS aj v `public/js/console/`), takže kánon je
    dnes na konzole splnený bezo zbytku. Každé „ladenie odtieňa" ho môže len
    pokaziť.
