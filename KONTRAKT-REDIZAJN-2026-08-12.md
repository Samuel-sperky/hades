# KONTRAKT — Redizajn Hades (graf + ujednotenie dizajnu)

**Dátum:** 12. 8. 2026
**Branch:** `feat/hades-redizajn` (git worktree, základ `feat/hades-hygiena` @ cac67b0)
**Rozsah:** iba frontend — `public/js/mind.js`, `public/css/mind.css`, `resources/views/mind.blade.php`. Žiadne zmeny backendu, DB ani API.

---

## 1. Cieľ

Odstrániť tri konkrétne, zmerané problémy:

1. **Graf je úzky na celej ploche.** `layerLayout()` ([mind.js:937](public/js/mind.js:937)) rozdeľuje uzly do 5 stĺpcov na fixných `LAYER_X = [-560,-280,0,280,560]` → šírka scény ~1300 jednotiek. Pri 1023 uzloch má najväčšia vrstva stovky uzlov, `SUB_MAX = 4` → ~250 uzlov na stĺpec → `spacing` padne na minimum 48 px → výška scény ~12 000 jednotiek. Pomer 1300 × 12 000, `fitView()` fituje výšku → úzky stĺpec a ~90 % prázdnej plochy. Overené renderom na 2560 × 1400.
2. **Graf pôsobí chaoticky.** 1023 uzlov ako plné bodky jedného tvaru, 2754 hrán ako súvislá šedá vata, žiadny LOD (oddialené = to isté, len menšie), popisky oblastí zakryté uzlami. Farba nesie dva významy naraz, hoci projekt má hotový štandard *farba = oblasť, tvar = typ* (Hades skill `Color-area shape-type encoding`), ktorý canvas nepoužíva.
3. **Obrazovky nemajú responzivitu.** Na 2560 px má `#screens` šírku 2440 px, ale obsah sedí v ľavých ~35 %. Knižnica dá 3 stĺpce a 70 % plochy nechá prázdnu. Karty majú arbitrárne šírky (183 / 200 / 248 px), spodky sa nezarovnajú. V Knižnici sú titulky centrované, telo textu vľavo — v tej istej karte.

---

## 2. Odsúhlasené rozhodnutia

| # | Rozhodnutie | Voľba |
|---|---|---|
| R1 | Koncepcia grafu | **Jeden graf so zanorením.** Prepínač Mapa/Sieť/Vrstvy sa ruší. 4 úrovne: mapa → oblasť → oddelenie → uzol, jeden stavový stroj `go({level, area, dept, node})`. Inšpirácia: `hades-aura-graf.html` (31. 7. 2026). |
| R2 | Úroveň „mapa" | **Huby + prach.** Jadro ♛ + 5 hubov oblastí s počtami, dominantné. Všetkých 1023 uzlov viditeľných zároveň ako veľmi jemný priehľadný prach okolo hubov. |
| R3 | Priehľadnosť | Všetky štyri: sklo nad živým grafom, jemnejšie uzly a hrany, tmavý ambient, menej chrómu. |
| R4 | Sklo a pozadie | **Všade, ale utlčený a zamrznutý.** Mimo Grafu je graf silne rozostrený, stmavený a pozastavený (rAF sa zastaví → nulové CPU). |
| R5 | Téma | **Tmavá default, svetlá zostane prepnuteľná.** Na svetlej téme sa sklo nahradí plnou plochou (na svetlom vyzerá ako mlieko). |
| R6 | Šírka obsahu | **Fluidná mriežka cez celú šírku** na všetkých obrazovkách. |
| R7 | Nastavenia | **3–4 presety + Pokročilé zbalené.** Presety: Čisté / Živé / Husté / Ambient. Všetkých 30+ ovládačov zostáva, ale v zbalenej sekcii. |
| R8 | Hlavička grafu | **Breadcrumb cesty zanorenia** (`Hades › Vývoj & kód › Frontend`), klikateľný. Bez časového posuvníka. |
| R9 | Animácie | **Pokojné.** Dýcha len jadro, prach sa veľmi pomaly unáša, ostatné stojí. Animácia sa spustí pri zanorení a pri novom uzle. |
| R10 | Modularizácia | **Natívne ES moduly, bez build stepu.** `public/js/mind/*.js` + `<script type="module">`. Vite sa nezapája. |
| R11 | Postup | **Rovno do kódu** na feature branchi, screenshot po každom celku. |

### Predvolené (rozhodol som sám, dá sa zmeniť)

- **Kódovanie tvarov** podľa existujúceho Hades štandardu: spomienka = plný disk, skill = donut, projekt = disk s vonkajším prstencom, jadro = zlaté súosé kruhy.
- **Značka istoty** (overené / hypotéza / pasca) sa kreslí až od úrovne oddelenia, ako štýl obrysu — na mape by preťažila vnem.
- **Prach nemá hrany.** Hrany sa kreslia len pre uzly na aktuálnej úrovni; medzi oblasťami len agregované zviazané stuhy.
- **Klávesy** `1/2/3` (dnes prepínanie pohľadov) sa premapujú na úrovne zanorenia, `Esc` = o úroveň von, `‹ ›` = súrodenci.
- Worktree, nie priama práca v repo — na `feat/hades-hygiena` beží iná session.

---

## 3. Rozsah

### ÁNO
- Nový grafový engine: stavový stroj 4 úrovní, radiálny deterministický layout, LOD, dual-channel kódovanie, aspect-aware fit.
- Tmavá téma ako default, dolaďenie svetlej, sklo nad zamrznutým grafom, odľahčenie chrómu.
- Fluidné mriežky a zjednotenie kariet na Dnes, Denník, Knižnica, Rozhodnutia, Kontrola, Smernica.
- Presety v nastaveniach + zbalené Pokročilé.
- Breadcrumb zanorenia v hlavičke.
- Rozsekanie `mind.js` (5933 riadkov, jeden IIFE) na natívne ES moduly podľa existujúcich 34 sekčných značiek.

### NIE
- Žiadne zmeny backendu, DB schémy, API kontraktov ani MCP nástrojov.
- Žiadny časový posuvník rastu siete (nová funkcia, nie redizajn).
- Žiadny Vite/Tailwind build step pre `mind.js`.
- Žiadny mobil pre graf (graf zostáva desktop-only), obrazovky nechávam responzívne ako dnes.
- Bez plošných reformatov nedotknutého kódu.

---

## 4. Akceptačné kritériá (merateľné)

| # | Kritérium | Ako sa overí |
|---|---|---|
| A1 | Na 2560 × 1400 zaberá graf po default fite **≥ 70 % šírky viewportu** na každej úrovni zanorenia. | puppeteer render + zmeraný bounding box |
| A2 | Žiadna úroveň grafu nie je užšia ako 60 % šírky viewportu. | to isté |
| A3 | Popisky hubov a oblastí sa **neprekrývajú** s uzlami ani medzi sebou na 1600 aj 2560 px. | screenshot review |
| A4 | Typ uzla je čitateľný z tvaru bez legendy (4 tvary), oblasť z farby. | screenshot review |
| A5 | Na 2560 px využíva Knižnica **≥ 85 % dostupnej šírky** obsahu, karty v riadku majú rovnakú výšku a rovnaké zarovnanie textu. | zmeraný layout + screenshot |
| A6 | Mimo obrazovky Graf je `requestAnimationFrame` **zastavený** (nulová kresliaca aktivita). | `page.evaluate` počítadlo framov |
| A7 | Zanorenie funguje po všetkých 4 úrovniach a `Esc` vracia späť; breadcrumb odráža stav. | preklik v prehliadači |
| A8 | Tmavá téma je default, svetlá prepnuteľná a použiteľná (kontrast textu ≥ 4,5:1). | prepnutie + kontrastná kontrola |
| A9 | Celý PHP testovací balík zelený. | `php artisan test` |
| A10 | Konzola prehliadača bez chýb na všetkých obrazovkách. | `read_console_messages` |

---

## 5. Plán vĺn

| Vlna | Obsah | Agenti | Model / effort |
|---|---|---|---|
| W0 | Worktree + rozsekanie `mind.js` na ES moduly podľa 34 sekcií, bez zmeny logiky. Musí byť prvá — inak si paralelné vlny sadnú do `setupControls()`. | 2 | haiku / low (mechanické) |
| W1 | Dizajnové tokeny: tmavá default, sklo, odľahčenie chrómu. Sekvenčne — všetko ostatné na tokenoch stojí. | 1 | default |
| W2 | Paralelne: **(a)** grafový engine (stavový stroj, layout, LOD, kódovanie, aspect fit) **(b)** obrazovky (fluidné mriežky, karty) **(c)** nastavenia (presety) + breadcrumb | 3 | default |
| W3 | Integrácia, overenie v prehliadači na 1600 aj 2560, testy, oprava nálezov. | main loop | — |
| W4 | Review celého diffu proti kontraktu a akceptačným kritériám. | 1 | high effort |

**Security prehliadka:** nepovinná — šprint sa nedotýka auth, uploadov ani exponovaných endpointov (čisto frontend). Ak by sa to zmenilo, doplní sa.

---

## 6. Odhad spendu

**Veľkosť L.** Odhad **0,6–0,9 M tokenov**, strop **1 M**. Autonómny beh ~2–4 h.

| Vlna | Odhad |
|---|---|
| W0 rozsekanie | 80–120k |
| W1 tokeny + tmavá + sklo | 60–90k |
| W2a grafový engine | 150–250k |
| W2b obrazovky | 80–120k |
| W2c nastavenia + breadcrumb | 50–70k |
| W3 integrácia + overenie | 80–120k |
| W4 review | 60–100k |

Pri prekročení rozsahu o > 30 % sa beh zastaví a ohlási.

---

## 7. Otvorené riziká

1. **Merge poradie.** Worktree stojí na `feat/hades-hygiena`, nie na `main`. Redizajn sa dá zmergovať až po nej. Ak sa hygiena prepíše alebo zahodí, treba rebase.
2. **Iná aktívna session** v tom istom repo (`app/Models/Node.php` rozrobený). Worktree to izoluje, ale konflikt v `mind.js` by vznikol, keby tá session siahla na frontend.
3. **1023 uzlov ako prach** je kresliaco lacné, ale pri veľmi vysokom počte (> 5000) bude treba dlaždicovanie alebo offscreen cache. Dnes to nie je problém, do budúcna áno.
4. **Sklo na svetlej téme** sa nedá spraviť dobre — preto sa na svetlej nahrádza plnou plochou. Dve témy = dvojnásobné ladenie každého komponentu.
5. **`mind.js` je jeden IIFE s 309-riadkovým `setupControls()`.** Rozsekanie je mechanické, ale zavlečená regresia by sa prejavila až za behu. Preto W0 končí prekliknutím všetkých obrazoviek pred ďalšou vlnou.

---

## 8. Výsledok — DOKONČENÉ

**Stav 12. 8. 2026: všetky vlny hotové, vrátane review a opravy jeho nálezov.** Branch `feat/hades-redizajn`, 11 commitov nad `cac67b0`, 41 súborov, +7806 / −6175.

| Commit | Vlna |
|---|---|
| `f684d49` | W0 — `mind.js` (5933 r., jeden IIFE) na 31 natívnych ES modulov |
| `d4a38dc` | W1 — tmavá téma default, sklo, odľahčenie chrómu |
| `3dd00b7` | W2a — jeden graf so 4 úrovňami zanorenia |
| `96f88fe` | W2b — fluidné mriežky cez celú šírku, zjednotenie kariet |
| `f83c4b0` | W3a — mapa ako veniec namiesto pentagramu, váha jadra, oblaky prachu |
| `a645290` | W3b — kontrast akcentu na tmavej, grafy dashboardu vyplnia kartu, tokeny chrómu |
| `fb96c28` | W3c — okraje scény z CSS tokenov, uhnutie otvorenému panelu |
| `3d910d2` | W2c — presety nastavení, breadcrumb 4. úroveň, klávesy, mŕtvy chróm |
| `7a00762` | úklid — zvyšky force simulácie |
| `c0260c1` | W4 — opravy nálezov review |

### Akceptačné kritériá — nezávisle zmerané

| # | Kritérium | Baseline | Výsledok | |
|---|---|---|---|---|
| A1 | Graf ≥ 70 % šírky, každá úroveň | 42 % | **93/92/91/90 %** (1600), **95/95/94/93 %** (2560) | ✅ |
| A2 | Žiadna úroveň pod 60 % | 42 % | minimum **90 %** | ✅ |
| A3 | Popisky sa neprekrývajú | prekrývali (26–51 na mape, 59–76 na oblasti) | **0** prekrytých uzlov na všetkých 4 úrovniach × 2 rozlíšenia, medzi sebou 0 kolízií, všetkých 23 popiskov sa zobrazí | ✅ |
| A4 | Typ čitateľný z tvaru | 1 tvar | 4 tvary od úrovne `dept`; na `map` sú uzly prach 2,6 px **bez tvaru** | ⚠️ |
| A5 | Knižnica ≥ 85 % šírky, rovnaké výšky | 40 % | **98 %**, 7 stĺpcov, 236 riadkov kariet a **0 s nerovnakou výškou** | ✅ |
| A6 | rAF zastavený mimo Grafu | metrika bola slepá | **0** mimo Grafu, 57–60 na Grafe | ✅ |
| A7 | Zanorenie 4 úrovní + Esc + breadcrumb | — | všetky 4 úrovne, breadcrumb má 4. crumb, `Esc` ide o jednu úroveň | ✅ |
| A8 | Tmavá default, svetlá použiteľná, ≥ 4,5:1 | — | **0 padajúcich miest v oboch témach** (najhoršie 4,60 tmavá / 4,52 svetlá) | ✅ |
| A9 | PHP balík zelený | 95 ✓ | **95 ✓**, 1 skipped, 363 assertions | ✅ |
| A10 | Konzola bez chýb | čistá | **0 chýb, 0 pageerrors**, 0 chýbajúcich exportov | ✅ |

**A4 je jediné nesplnené a je to principiálne:** na mape je typ z tvaru nečitateľný, pretože pri 1028 uzloch je prach 2,6 px, kde sa tvar nedá vykresliť. Dual-channel funguje od úrovne oddelenia. Kritérium bolo napísané bez ohľadu na to, že mapa má prach — chyba v kontrakte, nie v implementácii.

**A3 bolo dodatočne splnené** troma zmenami naraz: rámy popiskov sa počítajú pred kreslením prachu a prach v nich sa nekreslí; sub-huby oddelení nesú polomer vlastného klastra (`labelR`) a popisok sa oň odsadí; a umiestnenie skúša pod, nad a ďalej, pričom berie prvého kandidáta, ktorý nekoliduje ani s iným popiskom, ani s tvarovým uzlom.

### Odchýlky od kontraktu

- **d3 `forceSimulation` zrušená úplne**, nie len pohľady. Determinizmus (podmienka kontraktu) sa s force layoutom a `Math.random()` nedá zladiť. Dôsledok: ťahanie uzlov zrušené, slidery síl odstránené.
- **R7 nedodržané v litere** — kontrakt sľuboval, že všetkých 30+ ovládačov zostane. 4 slidery síl a `Obnoviť sily` sú zmazané, pretože po zrušení simulácie nič neovládali.
- **R4 dodané len na tmavej téme.** Na svetlej ostáva plátno mimo Grafu skryté: pod poloprehľadnými chipmi tam kontrast textu závisel od obsahu grafu (merané 4,07:1, nestabilné medzi behmi). Tmavá je default, takže presvitanie je tam, kde ho používateľ vidí.
- **`public/js/charts.js` je mimo rozsahu** uvedeného v sekcii 3 (+69 r.) — grafy dashboardu inak nechali v karte prázdnu spodnú tretinu.
- **Príčiny dvoch z troch problémov boli iné, než kontrakt tvrdil.** Úzkosť obrazoviek nespôsobili chýbajúce fluidné mriežky (tie `auto-fill minmax()` už mali), ale `.screen { max-width: 920px }` a inline `maxWidth = '1120px'` v `dnes.js`. A „centrované titulky" neboli `text-align`, ale UA `align-items: center` na stĺpcových flex `<button>`-och.

### Dodatočne dokončené po review

- **A3** — 0 prekrytých uzlov (viď vyššie).
- **46 dvojíc „dvoch pravd"** v `mind.css` zlúčených na 0. Dokázané ako vizuálne neutrálne prepnutím stylesheetu nad tým istým DOM v tom istom okamihu (nie dvoma načítaniami — Hades je živý a medzi nimi narastie Denník): **98 zo 98 kombinácií** bajtovo identických, 7 obrazoviek × 2 témy × šírky 760–2560. Súbor 3752 → 3682 riadkov. Lživý komentár na konci opravený.
- **`--focus-ring`** zvýšený na **3,55:1** (tmavá) / **3,77:1** (svetlá) — nad prahom WCAG 2.4.11.
- **Zvyšky po zrušenej simulácii**: `makeStars()` (no-op volaný 3×) a `S.stars` zmazané, 13 volaní `kickSim()` zbavených ignorovaného parametra, mŕtva vetva `if (S.sim && …)` v `main.js` odstránená.

### Zostáva (samostatné úlohy)

1. **`/api/tags` vracia 3622 značiek** → `tagfilter.js` z nich robí 3622 checkboxov. Zbalená sekcia to schová, nevyrieši.
2. **Mŕtvy kód starší ako tento šprint**: `timeline.setupTimeline()`, `search.renderSearch`, `structure.findDuplicates`, `pack.addToPack`, `chat.addToChatContext`. Zámerne nedotknuté — pravidlo projektu je refaktorovať len dotknutý kód. Pozor: `#tl-range` nie je v blade vôbec a `render.js` číta `tlr.value`, takže timeline môže byť nedokončená funkcia, nie mŕtvy kód.
3. **17 raw hex/rgba mimo `:root`** v `mind.css` (thumby slidrov, knob prepínača, tiene `#brand-core`, `.shimmer::after`) — porušuje pravidlo projektu, ale je to stav pred šprintom a prebarvenie nesie riziko vizuálnej zmeny.
4. **Testovateľnosť**: dva loading stavy (`.shimmer`, `Načítavam…`) a async fetchy `.dir-templates` / `.dir-saved` nemajú „settled" príznak, a klik na `.dest` občas obrazovku neprepne. Každý budúci vizuálny harness bude potrebovať tie isté obchádzky.

### Predchádzajúci priebežný stav (pred dokončením)

**W0, W1, W2a, W2b boli hotové a beh sa zastavil na vyčerpaní stropu 1 M.** Používateľ následne schválil dokončenie. Pôvodný odhad na dokončenie (+300k) bol optimistický — reálne to bolo ~+1,2 M, pretože každý agentský beh vychádzal na 205–293k.
