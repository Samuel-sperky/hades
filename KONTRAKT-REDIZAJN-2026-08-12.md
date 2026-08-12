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

## 8. Výsledok

_(dopĺňa sa po dokončení šprintu)_
