# Audit 02 — Čitateľnosť a hustota (Hades)

**Dátum:** 20. 8. 2026 · **Optika:** čitateľnosť, hustota, typografia technických výpisov
**Stav palety pri meraní:** finálna (akcent amethyst) · **Rozsah:** 8 obrazoviek grafu + `/console`,
tmavá (default) aj svetlá téma · **Režim:** read-only, v repozitári nezmenený ani jeden súbor.

Toto je druhý pokus. Prvý padol na strop účtu a merať sa vtedy nedalo — paleta bola v pohybe.

---

## 0. Harness a jeho kalibrácia

Prehliadač: headless Chrome cez `puppeteer-core`, viewport **1920 × 1080**, `--force-device-scale-factor=1`.
Prístup cez reverzný proxy `127.0.0.1:8093`, ktorý si UI token číta z `.env` sám a posiela ho ako
hlavičku `X-Hades-Ui-Token` — token nie je v URL, v histórii ani v tomto dokumente.

**Identita servera overená pred každým behom** (CLAUDE.md, „Pasca: overuj IDENTITU preview servera"):
`curl -s http://127.0.0.1:8093/ | grep -o 'src="/js/[^"]*"'` → `/js/charts.js`, **`/js/mind/main.js`**.
`/__whoami` → `hades-ui-proxy`.

Onboarding karta vypnutá `localStorage.setItem('hades.hints2','done')` **pred** loadom.
Nikde sa nečaká fixný čas na dáta — `waitForFunction` na obsah v `.screen`, pretože
`/api/journal` a `/api/dashboard` bežia 3–4 s.

### Tri pasce, ktoré harness rieši, a čím sa to dokazuje

1. **Pozadie sa SKLÁDA.** `bgStack()` ide od prvku nahor, zbiera vrstvy s alfou > 0 po prvú
   nepriehľadnú, násobí alfu `opacity` reťazcom predkov a skládá zdola. Bez toho by badge
   a tinty hlásili falošné pády.
2. **Téma sa NEPREPÍNA v tom istom synchronnom bloku.** Každá téma je vlastné načítanie
   s `hades.theme` už v `localStorage`. Ako cross-check sa téma raz prepla za behu
   s dosadnutím (dva rámce + 400 ms) — vyšli **presne tie isté čísla**:
   `body` 16,48 → 15,88 a `.screen-sub` 6,40 → 5,35 v oboch smeroch. Merač je overený obojsmerne.
3. **Kalibrácia na známom stave.** `body` = **16,48 : 1** (tmavá) / **15,88 : 1** (svetlá).
   `.screen-sub` = **6,40** / **5,35**. `body` na `/console` = **16,48** / **15,88**.
   Ak by `body` nedalo ~16:1, ostatným číslam sa nesmie veriť.

**Rozsah merania:** 152 unikátnych podpisov prvkov s vlastným textom na 8 obrazovkách
+ `/console` na každej téme (teda ≈ 3× viac než požadovaných 35), plus 108 (tmavá) / 100 (svetlá)
cielených meraní stavových variantov, plus 138 podpisov v inventári veľkostí písma
(13 651 prvkov) a 4 experimenty s prepnutím vlastnosti nad tým istým DOM.

### Čo sa muselo merať nad fixture a prečo

`runs` je v DB **prázdna** (`DB::table('runs')->count()` = 0), takže obrazovka Runy bez zásahu
zobrazí len prázdny stav. Merania Rún preto bežali s **prerušeným `/api/runs*`** a syntetickým
telom v tvare `RunsScreen` / `RunDetailScreen`. **Renderuje sa reálny `runy.js` a reálne
`mind.css`** — syntetické sú len dáta. Rovnako `.diff` v konzole: v `console_tool_calls` nie je
ani jeden `preview` (21 callov, všetky `pv = 0`), takže diff bol vložený do reálneho DOM
s reálnymi triedami. Všade, kde je toto zdrojom čísla, je to označené *(fixture)*.

---

## 1. Nálezy

### R1 — Manuál značky a CSS majú **vymenené role serifu**. NAJVYŠŠIA PRIORITA

**Tvrdenie:** `docs/BRAND-HADES.md` §4 hovorí: *„Hero metriky → **Playfair Display**"*
a *„Serif je vzácny, a preto významný: **len** hero metriky. **Nadpisy obrazoviek sú Geist.**"*

**ZMERANÉ** (computed style, obe témy identické):

| Prvok | Manuál žiada | Realita | px |
|---|---|---|---|
| `.screen-head h1` („Dnes") | Geist | **Playfair Display** 660 | 28 |
| `.hero-val` (hero metrika) | Playfair Display | **Geist Mono** 600 | 44 |
| `.kpi-val` | — | Geist Mono 600 | 30 |
| `.donut-total .dt-num` | — | Geist Mono 600 | 20 |
| `#header-metrics` | — | Geist Mono 400 | 12 |

Obe role sú **presne naopak**. Naviac `mind.css:2833` zdôvodňuje serif na `h1` vetou
*„Serif (Playfair) je štandard APPIEK rodiny Aura"* — čo je v priamom rozpore s hlavičkou manuálu:
*„Hades je samostatná značka, nie appka Aury… od tohto dokumentu sú vlastné a nemenia sa s Aurou."*
Serif je aj na treťom mieste: `.empty.empty-network .title` (`mind.css:2229`).

**Efekt:** vysoký — je to identita, nie kozmetika. Manuál je podľa CLAUDE.md zdroj pravdy.
**Riziko opravy:** nízke technicky (dve `font-family`), **vysoké rozhodovacie** — mení dojem
každej obrazovky. Toto nie je bug, ktorý sa opraví autonómne.
**Návrh:** rozhodnutie používateľa, nie agenta. Buď (a) CSS ide za manuálom: `h1` na `--font`,
`.hero-val` na `--serif` (44 px Playfair je presne ten „vzácny a významný" serif, o ktorom manuál
hovorí), alebo (b) manuál sa opraví na zmeraný stav a doplní sa dôvod. Nechať to rozídené je
jediná neprijateľná možnosť, pretože checklist §9 sa potom nedá odškrtnúť.

---

### R2 — `body { font-variant-numeric }` **nedosiahne dátové riadky**. Tvrdenie v CLAUDE.md aj v audite 1 je nepravdivé

**Tvrdenie, ktoré sa overovalo:** *„`.tnum` sa nepridáva — globálne to už rieši
`body { font-variant-numeric }` (`mind.css:489`), takže 16 opakovaní v súbore je inertných
a majú zmiznúť."* Komentár v `mind.css:501–504` to hovorí ešte silnejšie:
*„Jedna deklarácia tu drží celú appku a lokálne opakovania sú od teraz len zbytočné, nie potrebné."*

**ZMERANÉ — trojkrokový experiment nad tým istým DOM:**

| Krok | Výsledok |
|---|---|
| stav ako je | **19 podpisov / 3 255 prvkov** s číslom má computed `font-variant-numeric: normal` |
| po pridaní `button,input,select,textarea { font-variant-numeric: inherit }` | **0 podpisov / 0 prvkov** |
| kalibrácia | `body` má `tabular-nums` v oboch krokoch |

**Všetkých 19 podpisov je vnútri `<button>`.** Mechanizmus: appka kreslí dátové riadky ako
`<button>` (`button.record`, `button.dtl-card`, `button.lib-skill`, `button.chip`,
`button.today-card-link`, `button.today-item`) a UA stylesheet dáva form controls **`font`
shorthand**, ktorý `font-variant-numeric` resetuje na `normal`. Deklarácia na `body` sa k nim
nikdy nedostane, pretože sa nededí — prehráva s priamym pravidlom UA.

Namerané postihnuté miesta (počty prvkov v jednom načítaní):

| Selektor | n | pred | po |
|---|---|---|---|
| `span.tag.muted` | 1 728 | normal | tabular-nums |
| `span.lib-skill-snip` | 743 | normal | tabular-nums |
| `span.tag` | 379 | normal | tabular-nums |
| `span.lib-skill-label` | 148 | normal | tabular-nums |
| `span.record-time` (Denník, „12:06") | 50 | normal | tabular-nums |
| `span.dtl-date` (Rozhodnutia, „20. 8.") | 45 | normal | tabular-nums |
| `span.chip-n` (počty vo filtroch) | 21–39 | normal | tabular-nums |
| `span.tcl-time`, `span.ti-time`, `span.mr-time` | 16 | normal | tabular-nums |

**A obrátene: 3 z 14 merateľných lokálnych opakovaní NIE SÚ inertné** — ich rodič má `normal`,
takže ich zmazanie by čísla rozhýbalo: `#pack-count` (v `button#pack-trigger`),
`.hero-action .ha-val` (v `button#hero-review`), `#rail … button.dest .count` (v `button#dest-kontrola`).
Ostatných 11 inertných je (`.badge`, `.tree-row .count`, `.tree-muted .count`, `.metric-val`,
`.hero-val`, `.kpi-val`, `.donut-total .dt-num`, `.cert-legend .cl-n`, `.dbar-head .db-n`,
`#header-metrics`, `#status-chip`). 5 selektorov (`.tc-val`, `.run-cost`, `.run-metric b`,
`.dup-pct`, `.key-row kbd`) sa v DOM nevyskytlo → **NEOVERENÉ**.

**Efekt:** vysoký. Presne to, čo komentár sľubuje (čísla v zoznamoch a čipoch neposkakujú),
dnes v zoznamoch a čipoch **neplatí**.
**Riziko opravy:** nízke — jedna deklarácia, mení len tvar číslic. `font: inherit` **nepoužiť**:
zmenilo by `button.record` z 13 px na 14 px (zmerané). Iba `font-variant-numeric: inherit`.
**Návrh:** `button, input, select, textarea { font-variant-numeric: inherit; }` do `mind.css`
vedľa `body`. Potom — a len potom — je bezpečné zmazať aj tie 3 opakovania, ktoré dnes nesú váhu,
a v CLAUDE.md aj v `mind.css:501` opraviť tvrdenie o inertnosti.

---

### R3 — Ten istý koreň, druhý symptóm: `line-height: normal` na 13 160 prvkoch

**ZMERANÉ:** 48 podpisov / **13 160 prvkov** viditeľného textu má computed `line-height: normal`,
hoci škála definuje `--lh-caption: 1.4`, `--lh-body: 1.5`, `--lh-base: 1.5`.
Po pridaní `line-height: inherit` na form controls: **0 podpisov / 0 prvkov**.

Príklady (pred → po): `.record-title` 13 px `normal` → 19,5 px · `.record-time` 11 px → 16,5 px ·
`.tag.muted` 11 px → 16,5 px · `.chip-n` 11 px → 16,5 px · `button.chip` 13 px → 19,5 px.
`button.record` samo: `13px/normal` → `14px/21px` pri `font: inherit`, `13px/19,5px` pri
`line-height: inherit`.

Dôsledok dnes: v jednej appke existujú **tri prokladania pre 11 px text** — `1,4` (token, kde
sa dedí), `1,1` (`.lbl` v raile), a `normal` (≈ 1,2 v Geiste, všade v dátových riadkoch).
**Efekt:** stredný až vysoký — na 11 px texte je rozdiel 16,5 px vs ~13,2 px riadok viditeľný.
**Riziko:** stredné — riadky sa predĺžia, výška karty Knižnice a Denníka narastie. Preto to
patrí do vlny B spolu s density prepínačom, nie ako samostatná záplata.
**Návrh:** `button, input, select, textarea { line-height: inherit; font-variant-numeric: inherit; }`
a v tom istom kroku prepočítať výšku riadku Denníka a karty Knižnice.

---

### R4 — Sedem textových párov padá pod AA na **svetlej** téme; všade sa ako text používa základná hodnota, hoci `-ink` variant existuje alebo má vzniknúť

**ZMERANÉ** (svetlá téma, skládané pozadie; tmavá je pri všetkých v poriadku):

| Selektor | zmerané | AA | token, ktorý je použitý | čo mal byť |
|---|---|---|---|---|
| `.tool-call.waiting .tc-state` | **3,00** | ✗ | `--warn` `#d97706` | `--warn-ink` `#9a4a08` (5,51 na tinte) |
| `.msg.error .who` | **4,02** | ✗ | `--danger` `#d64545` | `--danger-ink` `#a52a2a` |
| `.tool-call.error .tc-state` | **4,12** | ✗ | `--danger` | `--danger-ink` |
| `.cert[data-cert="overene"]` | **4,17** | ✗ | `--cert-overene` `#1f7a4d` na vlastnej tinte | nový `--cert-overene-ink` |
| `.cert[data-cert="pasca"]` | **4,19** | ✗ | `--cert-pasca` `#c0392f` | nový `--cert-pasca-ink` |
| `.diff .df-add` *(fixture)* | **4,27** | ✗ | `--cert-overene` na `--cert-overene-soft` | ink variant |
| `.diff .df-del` *(fixture)* | **4,30** | ✗ | `--cert-pasca` na `--cert-pasca-soft` | ink variant |
| `.cert[data-cert="hypoteza"]` | 4,51 | na hranici | `--cert-hypoteza` `#8f5a12` | — |

Kontrolná skupina, ktorá **prešla** a dokazuje, že je to lokálny nedopatok, nie systémová chyba:
`.badge[data-status]` má všetkých päť stavov v poriadku (5,13–8,02) práve preto, že ide cez
`--success-ink` / `--warn-ink` / `--danger-ink` (`mind.css:4498–4502`). Vzor existuje;
`console.css` (`.tc-state`, `.msg.error .who`, `.diff .df-*`) a `mind.css` `.cert[data-cert]`
ho len nepoužívajú.

**Efekt:** vysoký na svetlej téme, nulový na tmavej. Porušuje checklist §9 manuálu („text 4,5:1").
**Riziko opravy:** nízke — výmena tokenu, žiadna zmena rozloženia. `--cert-*-ink` sú dva nové
tokeny, čo je v duchu §3 manuálu (istota je vlastná semantická rola).
**Návrh:** `.tc-state` a `.msg.error .who` na `--warn-ink` / `--danger-ink`; pre `.cert[data-cert]`
a `.diff .df-add/.df-del` pridať `--cert-overene-ink` / `--cert-pasca-ink` s nameranou hodnotou
v komentári, presne ako to urobil `--accent-ink` a trojica `*-ink`. Tmavú tému nechať
(tam sú `--*-ink` aliasy na základ a merajú 4,71–7,76).

---

### R5 — `a.ghost` v detaile behu nemá **žiadne** pravidlo: 1,87 : 1 a UA modrá `#0000EE`

**ZMERANÉ** *(fixture — Runy sú v DB prázdne)*:

| téma | color | pozadie | pomer |
|---|---|---|---|
| tmavá | `rgb(0, 0, 238)` | `19,26,25` | **1,87 : 1** |
| svetlá | `rgb(0, 0, 238)` | `255,255,255` | 9,40 : 1 |

Vedľa neho `button.ghost` („Spustiť znovu") meria 6,05 / 5,83 a vyzerá úplne inak.

Príčina: `runy.js:257` kreslí `<a class="ghost" href="/console/…">Otvoriť vlákno</a>`, ale
`.ghost` je v CSS napísané **len ako `button.ghost`** (`mind.css:703–704`). V celej appke je to
jediný `<a class=…>` a `mind.css` nemá ani jedno pravidlo pre `a` — takže odkaz padne na UA link
(podčiarknutý, `#0000EE`). Vedľajší efekt: v appke, kde „žiadny raw hex mimo `:root`" je
kontrolované pravidlo, sa na obrazovku dostáva farba, ktorá v palete vôbec nie je.

**Efekt:** vysoký (na tmavej téme, teda v defaulte, je to najhoršie zmerané miesto celého auditu).
**Riziko opravy:** nulové.
**Návrh:** `.ghost` odviazať od `button` (`.ghost { … }` a `button.ghost, a.ghost` pre stavy),
alebo v `runy.js` použiť `<button>` s navigáciou. Prvé je lacnejšie a rieši aj budúce odkazy.

---

### R6 — Hustota: príliš veľký chróm a príliš vysoký riadok. Na 1080p sa nezmestí ani polovica dát

**ZMERANÉ @ 1920 × 1080** (výška hlavičky appky 44 px, teda 1 036 px pre obsah):

| Obrazovka | riadkov celkom | plne vidno | výška riadku | chróm (px) | chróm (%) | výška obsahu |
|---|---|---|---|---|---|---|
| Dnes | 17 | **10** | 33–75 | 102,6 | 9,5 % | 1 342,6 |
| Denník | 50 | **21** | 43–44 | 102,6 | 9,5 % | 2 039,6 |
| Knižnica | **1 667** | **20** | **151** | **194,6** | **18,0 %** | **57 776,6** |
| Rozhodnutia | 45 | **10** | **122,5–255,5** | 138,6 | 12,8 % | 3 206,6 |
| Runy *(fixture)* | 24 | **5** | 144,9–182,9 | 102,6 | 9,5 % | 3 946 |
| Kontrola | 4 | 4 | 97,5 | 102,6 | 9,5 % | 302,6 (**733 px nevyužitých**) |
| Smernica | 2 | 2 | 132–220 | 102,6 | 9,5 % | 490,4 (**546 px nevyužitých**) |
| `/console` — vlákna | 88 | **17** | 52,5 | 48 | 4,4 % | — |
| `/console` — správy | 3 | 3 | 65,5–259 | 48 | 4,4 % | — |

Rail: 80 px zo 1920 = **4,2 %** šírky. Obsah obrazoviek: 1 715,2 px.

Tri veci, ktoré z tejto tabuľky vypadli ako najdrahšie:

1. **Knižnica má dvojitý chróm** (`.screen-head` 110,6 px + `.dtl-filter` 40 px = 18 % výšky),
   karta je **151 px vysoká** a v mriežke 5 × 330 px je vidieť **20 z 1 667**. Karta sa skládá
   z `label` 17 px + `snip` 32 px + `meta` **66 px** + padding 24 px: **44 % karty nesú čipy tagov.**
2. **Rozhodnutia majú riadok 122–255 px** na jednu vetu rozhodnutia. Rozpis:
   `.dtl-card` 106,5–165 px, z toho `.dtl-head` 58,5–117 px, `.dtl-meta` 18 px, padding 24 px.
   Karta je pritom **1 665 px široká** — text sa láme, hoci má miesta dosť.
3. **Knižnica nemá virtualizáciu.** 1 667 kariet = **23 451 DOM prvkov** a 57 776 px scrollu
   pre 20 viditeľných. To je 1,7 % užitočnej práce DOM.

**Efekt:** vysoký. **Riziko opravy:** stredné (density prepínač je vlna B a stojí na tokenoch,
ktoré ešte nie sú v `:root`). **Návrh:** poradie podľa ceny za pixel — (a) `.lib-skill-meta`
skrátiť na jeden riadok s „+N" (dnes je 66 px z 151), (b) `.dtl-head` dať dvojstĺpcový layout
namiesto lámania na plnú šírku, (c) na Knižnici zlúčiť `.screen-head` a `.dtl-filter` do jedného
riadku (−52 px na každej obrazovke s filtrom), (d) virtualizácia Knižnice ako samostatná úloha.

---

### R7 — Typografia: **85,6 % viditeľného textu je pod 13 px**, a bez Knižnice stále 68 %

**ZMERANÉ** (inventár 138 podpisov / 13 651 prvkov viditeľného textu, ikony vylúčené):

| px | prvkov | % |
|---|---|---|
| 10 | 212 | 1,6 % |
| **11** | **9 755** | **71,5 %** |
| 12 | 1 712 | 12,5 % |
| 13 | 1 908 | 14,0 % |
| 14 | 31 | 0,2 % |
| 16 | 14 | 0,1 % |
| 20 / 28 / 30 / 44 | 1 / 6 / 4 / 1 | 0,1 % |

Knižnica počty dominuje (1 667 kariet), takže to isté bez nej: 907 prvkov, z toho
10 px **22,1 %**, 11 px **40,9 %**, 12 px 5,1 %, 13 px 25,7 %, 14 px 3,3 %.
**Pod 13 px je 617 z 907 = 68 %.**

14 px (`--fs-base`, teda deklarovaná základná veľkosť appky) nesie **31 prvkov z 13 651**.
Reálna základná veľkosť Hadesa je **11 px**, nie 14.

Miesta pod 13 px, ktoré nesú technický obsah, nie popisky:

| Selektor | px | lh | rodina | čo to je |
|---|---|---|---|---|
| `.run-diff`, `.run-result` *(fixture)* | **11** | 16,5 | Geist Mono | **unified diff a výstup toolu** |
| `.run-args` *(fixture)* | 11 | 16,5 | Geist Mono | argumenty tool callu |
| `.run-step-who` *(fixture)* | 11 | 16,5 | Geist Mono | rola kroku, stĺpec 88 px = 13 znakov |
| `.tc-state` | 11 | 16,5 | Geist Mono | „2 riadky · 448 ms" |
| `.tc-args`, `.tc-name` | 12 | 18 | Geist Mono | argumenty a názov toolu |
| `.lib-skill-snip` | 12 | normal | Geist | úryvok skillu |
| `.record-time`, `.dtl-date`, `.origin`, `.tag` | 11 | normal | Geist Mono | časy, dátumy, zdroj, tagy |
| `.day-head`, `.dtl-month` | 10 | 14 | Geist Mono | hlavičky dní a mesiacov |
| `kbd` | 10 | normal | Geist Mono | klávesové skratky |

**Najostrejší rozpor:** ten istý artefakt — unified diff — je v konzole na **14 px**
(`.diff .dl`, `line-height` 21 px) a v Runách na **11 px** (`.run-diff`). Rovnaký obsah,
dve veľkosti, rozdiel 27 %.

**Efekt:** vysoký. **Riziko:** stredné (zmena veľkosti mení výšky riadkov).
**Návrh:** podlaha 12 px pre všetko, čo je technický výpis, a 13 px pre diff/kód
(`--fs-body`). Konkrétne: `.run-diff`/`.run-result`/`.run-args` z `--fs-caption` na `--fs-small`
alebo `--fs-body`, aby sedeli s konzolou. Popisky (`.day-head`, `kbd`, `.dtl-month`) na 10 px
môžu zostať — to nie sú dáta.

---

### R8 — Riadková dĺžka: kde je nad ~90 znakov

**ZMERANÉ** — kapacita meraná reálnou šírkou glyfov v tom istom fonte (`canvas.measureText`
s computed `font`), nie odhadom:

| Prvok | px | šírka boxu | **kapacita** | najdlhší reálny riadok | verdikt |
|---|---|---|---|---|---|
| `.run-prompt` *(fixture)* | 14 | 1 665 | **260 zn** | 145 zn | ✗ 2,9× nad 90 |
| `.run-args` *(fixture)* | 11 | 1 561 | **237 zn** | 78 zn | ✗ |
| `.run-diff` *(fixture)* | 11 | 1 529 | **232 zn** | 122 zn | ✗ (`white-space: pre`) |
| `.run-error` *(fixture)* | 12 | 1 665 | **291 zn** | 59 zn | ✗ kapacitou |
| `.diff .dl` (konzola) | 14 | 806 | **122–134 zn** | 109 zn | ✗ mierne |
| `.msg.assistant .bubble p` | 14 | 820 | **113–117 zn** | 29 zn | na hranici |
| `.record-title` (Denník) | 13 | 659–726 | **97–109 zn** | 25 zn | ✗ kapacitou |
| `.lib-skill-snip` | 12 | 268 | **47–48 zn** | 123 zn (2 riadky, **kráti sa**) | ✗ opačne — priúzke |
| `.tr-open .ttl` (vlákna) | 13 | 157 | **24–28 zn** | 24–63 zn | ✗ 8 zo 14 preteká |

**Dva opačné problémy naraz:** obrazovka Runy dáva prompt a diff **celú šírku 1 665 px**
(260-znakové riadky), kým Knižnica dáva úryvok **268 px** (48 znakov na riadok, clamp na 2 riadky,
takže z 123 znakov je vidieť ~96) a panel vlákien 157 px (názov sa reže v 8 z 14 prípadov).

**Efekt:** stredný. **Riziko:** nízke (`max-width` na blok prózy).
**Návrh:** `--measure: 78ch` a dať ho na `.run-prompt`, `.run-error`, `.dtl-text`, `.record-title`;
pre `.run-diff` a `.diff .dl` merať nie mierou textu ale šírkou kódu — tam je 120 zn v poriadku,
ale musia mať **rovnakú** veľkosť (R7).

---

### R9 — Stream konzoly zaberá 42,7 % šírky a `820px` je 5× natvrdo

**ZMERANÉ:** viewport 1920, `#stream` box **1 660 px**, obsah (`.msg`, `.tool-call`, `.diff`)
**820 px** = **42,7 % viewportu**. Zvyšných 840 px je prázdnych.

`--stream-w` **neexistuje** — `820px` je v `console.css` natvrdo na 5 miestach
(riadky 415, 450, 858, 922, 960). Audit 1 to označil ako chýbajúcu hodnotu; stále to tak je.

Ostatné namerané rozmery konzoly: `#stream` padding `24 16 8 16`, `.msg.user .bubble`
padding `10 14`, `.msg.assistant .bubble` padding `2 0` (asymetria je zámerná — odpoveď nemá bublinu),
`.tc-head` 34 px s paddingom `8 12`, `.composer-row` 55 px, `.thread-row` 52,5 px, header 48 px.

**Efekt:** vysoký pre technickú plochu — diff aj tool výstup sú presne to, čo šírku chce.
**Riziko:** nízke. **Návrh:** `--stream-w` do `:root` a hodnota `min(1200px, 100% - 2 × --sp-4)`;
pre `.tool-call`, `.diff` a `pre.code` povoliť **plnú** šírku streamu (próza môže zostať užšia —
to je legitímna miera čítania, kód nie).

---

### R10 — Kde je vzduch produktívny a kde len zaberá (konkrétne bloky)

**Produktívny — nechať:**

| Miesto | Zmerané | Prečo je to správne |
|---|---|---|
| `button.record` (Denník) | riadok 43 px, padding `12px` | 43 px je použiteľný cieľ pre klik/prst; ink je 17 px, ale zvyšok platí za zásah |
| `.tc-head` (konzola) | 34 px, padding `8px 12px` | rozbaľovacia hlavička toolu, hustšie by sa zle mierilo |
| `.badge` | 25,4 px, padding `4px 10px` | tinta potrebuje vnútorný okraj, inak text sedí na hrane |
| `#dock` (graf) | 300 px, padding `16px`, 13 riadkov legendy plne viditeľných | panel s nastaveniami má dýchať; 42 riadkov nastavení, 20 viditeľných |

**Zaberá bez úžitku — merateľne:**

| Miesto | Zmerané | Cena |
|---|---|---|
| `.rec-grid` (Denník) | 2 stĺpce × **853,6 px**, `.record-title` využije **25 zo 109 znakov** | ~77 % šírky riadku prázdnych; pri 3–4 stĺpcoch by sa vidiny riadky zdvojnásobili |
| `.lib-skill-meta` (Knižnica) | **66 px zo 151 px karty** = 44 % | odstránením druhého riadku tagov klesne karta na ~120 px → 26 kariet namiesto 20 |
| `.dtl-head` (Rozhodnutia) | **58,5–117 px** na jednu vetu, karta široká 1 665 px | text sa láme napriek miestu; 45 riadkov dá 3 206 px |
| `.screen-head` + `.dtl-filter` (Knižnica) | **110,6 + 40 = 150,6 px**, 18 % viewportu | dva samostatné pásy nad zoznamom |
| `.dtl-card` v detaile behu *(fixture)* | **857,7 px** pre jeden beh so 4 krokmi | 83 % použiteľného viewportu na jeden záznam |
| `.run-step` mriežka `5.5rem 1fr` | `.run-step-who` **88 px = 13 znakov** kapacity | stĺpec, do ktorého sa „assistant" nezmestí, vedľa 1 561 px stĺpca obsahu |
| Kontrola / Smernica | **733 px** / **546 px** nevyužitej výšky | obrazovka pre 4 položky nechá dve tretiny prázdne |

---

### R11 — Skryté akcie v paneli vlákien (zistené pri kalibrácii, nie je to kontrastná chyba)

`.tr-acts` má v pokoji `opacity: 0` (`console.css:197`, odkrýva sa `:hover`/`:focus-within`),
takže naivný merač by hlásil pomer **1,00 : 1**. Toto je presne ten prípad, kde pozadie treba
skládať a `opacity` predkov násobiť — po korekcii je prvok označený ako *skrytý*, nie *padnutý*.
Pri reálnom hoveri meria `.tr-act` **5,16** (tmavá) / **5,28** (svetlá), teda v poriadku.

**Nález nie je kontrast, ale hustota informácie:** 88 riadkov vlákien, na každom dvoje akcie
(`edit`, `delete`), ktoré sú do hoveru neviditeľné. Na dotyku ich `console.css:1049` odkrýva
natrvalo — takže mobil ich má, myš nie. **Efekt:** nízky. **Riziko:** nulové.
**Návrh:** nechať tak, alebo odkryť na 0,55 opacity — ale nemeniť to bez rozhodnutia,
je to zámer (`console.css:206–207`).

---

## 2. Najhorších 15 zmeraných miest

| # | Miesto | Selektor | Téma | ZMERANÉ | Verdikt |
|---|---|---|---|---|---|
| 1 | „Otvoriť vlákno" v detaile behu | `a.ghost` | tmavá | **1,87 : 1** (UA `#0000EE`) | ✗ AA aj kánon farieb |
| 2 | Stav toolu „čaká na povolenie" | `.tool-call.waiting .tc-state` | svetlá | **3,00 : 1** | ✗ AA (3:1 ok) |
| 3 | Autor chybovej správy | `.msg.error .who` | svetlá | **4,02 : 1** | ✗ AA |
| 4 | Stav toolu „chyba" | `.tool-call.error .tc-state` | svetlá | **4,12 : 1** | ✗ AA |
| 5 | Čip istoty „overené" | `.cert[data-cert="overene"]` | svetlá | **4,17 : 1** | ✗ AA |
| 6 | Čip istoty „pasca" | `.cert[data-cert="pasca"]` | svetlá | **4,19 : 1** | ✗ AA |
| 7 | Pridaný riadok diffu *(fixture)* | `.diff .df-add` | svetlá | **4,27 : 1** | ✗ AA |
| 8 | Zmazaný riadok diffu *(fixture)* | `.diff .df-del` | svetlá | **4,30 : 1** | ✗ AA |
| 9 | Čip istoty „hypotéza" | `.cert[data-cert="hypoteza"]` | svetlá | **4,51 : 1** | na hranici |
| 10 | Diff a výstup toolu v Runách *(fixture)* | `.run-diff`, `.run-result` | obe | **11 px** mono vs 14 px v konzole | ✗ podlaha 13 px |
| 11 | Prompt behu *(fixture)* | `.run-prompt` | obe | **260 znakov** kapacita | ✗ ~90 |
| 12 | Karta Knižnice | `button.lib-skill` | obe | **151 px**, z toho `meta` **66 px**; 20 z 1 667 | ✗ hustota |
| 13 | Riadok Rozhodnutí | `.dtl-item` | obe | **122,5–255,5 px**; 10 z 45 | ✗ hustota |
| 14 | Stream konzoly | `#stream` obsah | obe | **820 px zo 1 920** = 42,7 % | ✗ hustota |
| 15 | Čísla v dátových riadkoch | 19 podpisov, `<button>` | obe | **3 255 prvkov** `fvn: normal` | ✗ tvrdenie CLAUDE.md |

*(Poznámka: vláskové hrany na plátne sa podľa CLAUDE.md ako chyba nehlásia a v tejto tabuľke nie sú.)*

---

## 3. Čo je v poriadku a nemá sa dotýkať

- **Kontrast na tmavej téme.** Zo 152 podpisov na 8 obrazoviek + konzola je pod AA **nula**
  (najnižšie: `.diff .df-del` 4,71 · `.cert` bez istoty 4,79 · `.tag.muted` 4,85).
- **`.badge[data-status]`** — všetkých 5 stavov prechádza na oboch témach (5,13–8,02).
  `--success-ink` / `--warn-ink` / `--danger-ink` fungujú presne tak, ako mali.
- **Hlavička grafu a rail:** `#header-metrics` 6,05 / 5,83 · `kbd` 6,02 / 5,83 ·
  aktívna položka railu 8,24 / 6,93 · slovo `Hades` 15,58 / 17,30.
- **`#dock`** vo všetkých štyroch režimoch (legenda / prehľad / štruktúra / nastavenia):
  0 podpisov pod AA na oboch témach.
- **`textarea::placeholder`** 6,03 / 5,49 — dobre, býva to typické miesto pádu.
- **`.msg.thinking`, `.msg.system`, `.tool-call.denied`** — 5,35–10,58, v poriadku.
- **Žiadne emoji v UI stringoch** (grep na `\x{1F300}-\x{1FAFF}` a `\x{2600}-\x{27BF}`
  v `public/js/**` a `resources/views/*.blade.php`: 0 zásahov v kóde, len v komentároch CSS).
  Manuál §5 platí.

---

## 4. Čo vedome NEROBIŤ

1. **Neopravovať R1 (serif) autonómne.** Je to rozhodnutie o identite, nie chyba. Ktorýkoľvek
   smer je obhájiteľný, ale musí ho vysloviť používateľ — a v tom istom kroku sa musí opraviť
   ten dokument, ktorý ostane pozadu (manuál alebo `mind.css:2833`).
2. **Nepoužiť `font: inherit` na form controls.** Zmerané: `button.record` by preskočil
   z 13 px na 14 px a všetky výšky riadkov by sa posunuli. Iba `line-height: inherit`
   a `font-variant-numeric: inherit`.
3. **Nezmazať 16 opakovaní `font-variant-numeric` pred pridaním pravidla na `button`.**
   Tri z nich (`#pack-count`, `.hero-action .ha-val`, `#rail … .count`) dnes nesú váhu
   a zmazanie by tie čísla rozhýbalo. CLAUDE.md a audit 1 tvrdia opak — je to zmerané.
4. **Nemeniť farby na tmavej téme.** Tam nepadá nič a `--*-ink` sú tam zámerne aliasy na základ.
   Oprava R4 sa má týkať len svetlej rampy, inak sa zhorší pár, ktorý dnes prechádza.
5. **Nezasahovať do `.tr-acts` (R11) bez rozhodnutia** — `console.css:206–207` a `:1049` sú
   zámerná dvojica pravidiel (myš vs dotyk), nie nedopatok.
6. **Nerobiť virtualizáciu Knižnice v tomto kroku.** 1 667 kariet / 23 451 DOM prvkov je reálny
   nález, ale je to nový mechanizmus so stavom, nie density token. Samostatná úloha.
7. **Nehlásiť vláskové hrany na plátne ako kontrastnú chybu** — CLAUDE.md to menuje ako
   vedomú výnimku (význam nesie hustota, pri hoveri hrana prah spĺňa).
8. **Neveriť číslam o Runách ako produkčným.** `runs` je prázdna; všetko označené *(fixture)*
   je reálne CSS a reálny render nad syntetickými dátami. Rozmery a farby platia,
   **počty riadkov v zozname behov nie.**
9. **Nemerať kontrast bez skládania pozadia a bez dosadnutia témy.** Obe pasce sú v tomto
   behu zdokumentované s číslami (1,00 : 1 falošne pri `opacity: 0`; identické výsledky
   fresh-load vs prepnutie s dosadnutím). Merač bez toho lže presvedčivo.

---

## 5. Skripty (scratchpad, mimo repozitára)

| Súbor | Čo meria |
|---|---|
| `rlib.mjs` | telo merača: skládanie pozadia, kontrast, hustota, riadková dĺžka, box metriky |
| `rprobe.mjs` | inventár tried na každej obrazovke (nič sa nehádalo) |
| `r1.mjs` → `r1.json` | kontrast + hustota + typografia, 8 obrazoviek + konzola, obe témy |
| `r2.mjs` → `r2.json` | stavové varianty, hover, cross-check prepnutím témy s dosadnutím |
| `r3.mjs` → `r3.json` | chróm v pixeloch, riadková dĺžka, sweep `font-variant-numeric` |
| `r4-tnum.mjs` → `r4.json` | trojkrokový experiment s `font-variant-numeric` (R2) |
| `r5.mjs` → `r5.json` | inventár veľkostí písma, anatómia riadkov, „vzduch" |
| `r6.mjs` | dôkaz koreňa `line-height: normal` (R3) |
| `r7.mjs` | role serifu vs manuál (R1) |
| `r8.mjs` → `r8.json` | detail behu nad fixture (`.run-diff`, `.run-args`, kroky) |
| `r9.mjs` | `a.ghost` na oboch témach (R5) |
| `uiproxy.js` | reverzný proxy s tokenom z `.env` v hlavičke |
