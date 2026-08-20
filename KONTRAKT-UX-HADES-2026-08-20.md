# Kontrakt — Hades: UX a UI naprieč rozhraním

**Dátum:** 20. 8. 2026 · **Vetva:** `feat/hades-ux` (z `feat/hades-branding`)
**Veľkosť:** L · **Podklad:** 5 paralelných read-only auditov (Dnes/Denník, Graf,
štyri správcovské obrazovky, Charón, prierezová prístupnosť)

## 1. Cieľ

Spraviť rozhranie **použiteľné a profesionálne** — v poradí: (1) nech neklame,
(2) nech nemá slepé uličky, (3) nech sa dá ovládať aj inak než myšou, (4) nech
každý stav niečo hovorí.

## 2. Metóda a čo z auditu NEprešlo

Päť agentov auditovalo read-only, ich nálezy som **overil v kóde** a časť zamietol:

| Zamietnutý nález | Dôvod |
|---|---|
| „Knižnica kreslí 1660 kariet naraz" | `LibraryController.php:20` to popisuje ako **vedomé rozhodnutie o UI**, nie zabudnutý strop. Do plánu ide len užšia časť: chýbajúce chipy oblastí. |
| „Smernica mieša dva prázdne štýly" | Rozdiel karta vs. obrazovka je zdokumentovaný v `util.js:426`. Ponechať. |
| Návrhy meniť force layout, zanorenie-ako-filter, NDJSON, dvojfázovú bránu | Zámerné rozhodnutia (`CLAUDE.md`). Agenti ich do zadania dostali ako zakázané, ani jeden ich nenavrhol — uvádzam pre úplnosť. |

## 3. Vlny

### Vlna 1 — Rozhranie nesmie klamať (najvyššia priorita)

Miesta, kde UI tvrdí niečo nepravdivé alebo koná na nesprávnom objekte.

| # | Nález | Súbor | Odhad |
|---|---|---|---|
| 1.1 | **„Povoliť vždy" vypne bránu zápisov, ale checkbox zostane odškrtnutý.** Backend nastaví `thread->auto_accept = true`, klient ho aktualizuje len pri načítaní vlákna. Ďalšie zápisy idú bez pýtania a UI tvrdí opak. | `AgentRunner.php:140`, `console/main.js:93,143`, `console/tools.js:435` | S |
| 1.2 | **Klávesy `v`/`r`/`Del` na Kontrole konajú na `idx`, nie na fokusovaný riadok.** `idx` sa mení len cez `j/k` a `mousedown`. Tab na tretí riadok + `v` overí prvý uzol. | `shortcuts.js:143`, `screens/kontrola.js:104` | M |
| 1.3 | **Beh zrezaný stropom 12 krokov vyzerá ako dokončený.** Rámec `end` nesie `stop_reason`, klient ho ignoruje. | `console/run.js:290` | M |
| 1.4 | **Chybová odpoveď zahadzuje telo.** Pri `!res.ok` sa presná hláška z backendu stratí a človek dostane `HTTP 422`. | `console/run.js:144` | S |
| 1.5 | **Hlavička hlási surové počty**, nie počet po filtri — vypnuté typy či zdroje sa v metrikách neprejavia. | `util.js:181` | S |

### Vlna 2 — Slepé uličky a nedosiahnuteľné funkcie

Backend to vie, UI to nevystavuje. Toto je najväčší objem hotovej práce, ktorá
sa nedá použiť.

| # | Nález | Súbor | Odhad |
|---|---|---|---|
| 2.1 | Kontrola má strop **100 položiek** bez stránkovania a bez hlásenia; rail pritom ukazuje vyšší `total`. | `KontrolaScreen.php:36`, `screens/kontrola.js:22` | L |
| 2.2 | Kontrola a Rozhodnutia: serializery prijímajú `q`/`area`/`type`/`certainty`, UI ich **nikdy neposiela**. | `KontrolaScreen.php:102`, `screens/rozhodnutia.js` | M |
| 2.3 | Charón: vlákna sa nedajú premenovať ani zmazať — `PATCH`/`DELETE` na backende existujú a nikto ich nevolá. | `Console/ThreadController.php:63`, `console/main.js:45` | M |
| 2.4 | Rozhodnutia sa nedajú opraviť ani zmazať (`DecisionController` má len `index`+`store`). | `Api/DecisionController.php` | M |
| 2.5 | Graf: hľadanie nájde uzol mimo `graphScope`, panel sa otvorí, **kamera sa nepohne a nič to nepovie**. | `screens.js:65` | M |
| 2.6 | Knižnica: endpoint podporuje `?area=`, v UI nie je chip. | `LibraryController.php:28`, `screens/kniznica.js` | S |
| 2.7 | Dnes: čipy projektov sú `<span>`, hoci Denník filtruje presne podľa nich. | `screens/dnes.js:105` | S |
| 2.8 | Smernica: uložené smernice sa nedajú mazať (chýba `destroy`). | `DirectiveController.php` | S |
| 2.9 | Graf: oblasť a oddelenie v detaile uzla sú text, nie odkaz — jediný slepý koniec panela. | `panels.js:61` | S |
| 2.10 | Graf: prepínač `scope` (1095 vs 2675 uzlov) je pochovaný v zbalených Pokročilých nastaveniach. | `mind.blade.php:264` | S |

### Vlna 3 — Dotyk a responzivita

Vyšlo zhodne zo štyroch auditov nezávisle. Appka je tunelovaná cez ngrok, takže
telefón nie je hypotetický.

| # | Nález | Súbor | Odhad |
|---|---|---|---|
| 3.1 | **Plátno nemá jediný dotykový handler** — 0 pointer/touch, 3 myšacie. Na dotyku sa graf nedá ani posunúť. | `interaction.js:64` | L |
| 3.2 | `.pack-btn` má pokojový `opacity: 0` a appka nemá **ani jednu** `hover: none` query. | `mind.css:3093` | S |
| 3.3 | Pod 900 px dostanú dock aj detail uzla rovnaké `right` — môžu ležať na sebe. | `mind.css:3183` | S |
| 3.4 | Charón pod 860 px skryje nápovedu skratiek úplne. | `console.css:844` | S |
| 3.5 | Dva breakpointy (860 vs 900) bez dôvodu, obe natvrdo. | `console.css:810`, `mind.css:3178` | S |

### Vlna 4 — Stavy, fokus, hlas

| # | Nález | Súbor | Odhad |
|---|---|---|---|
| 4.1 | Charón: zoznam vlákien nemá loading, empty ani chybový stav. | `console/main.js:45` | S |
| 4.2 | Charón: pri ~8 tok/s je prvých 25 s ticho — jediný signál je drobný text v rohu hlavičky, ďaleko od miesta, kam sa človek pozerá. | `console/render.js:226` | M |
| 4.3 | Toasty sa pauznú na hover, **nie na fokus** — klávesnicový používateľ môže prísť o „Späť". | `toasts.js:26,59` | S |
| 4.4 | Päť typov kariet má `:focus-visible` bez `--focus-ring`. | `mind.css` (5 miest) | S |
| 4.5 | `loadingHtml()` hovorí **„Načítavam…"** — prvá osoba, v priamom rozpore s §6 manuálu, ktorý som sám napísal. Dedí sa do 7 obrazoviek. | `util.js:440` | S |
| 4.6 | „Uloženie zlyhalo" vs „Uloženie sa nepodarilo" — dva tvary tej istej chyby. | `smernica.js`, `rozhodnutia.js`, `controls.js` | S |
| 4.7 | Dnes: prázdne sekcie miznú bez stopy, kým karty grafov majú prázdny stav. | `screens/dnes.js:87` | S |
| 4.8 | Denník: filter-čip sa označí až po odpovedi servera — klik pôsobí ako „nezabral". | `screens/dennik.js:95` | S |

### Vlna 5 — Upratanie

| # | Nález | Odhad |
|---|---|---|
| 5.1 | `search.js:renderSearch` je **mŕtvy kód** — cieli na `#search-results`, ktoré v DOM neexistuje. | S |
| 5.2 | Skratka `R` je na Kontrole prepísaná, pomocník o tom mlčí. | S |
| 5.3 | Dvojklik do prázdna ruší celý filter, nie je v `MOUSE_HINTS`. | S |
| 5.4 | Knižnica: karta bez dátumu; Rozhodnutia: dátum bez roku. | S |
| 5.5 | Dnes: `syncCardHtml` skladá vzhľad z inline štýlov namiesto tried. | S |

## 4. Orchestrácia

**Kritické obmedzenie: `public/css/mind.css` má ~3800 riadkov a siaha doň takmer
každá vlna.** Paralelní agenti by si ho prepísali. Preto:

- agenti sú delení **podľa vlastníctva súborov**, nie podľa vĺn,
- `mind.css` píše **jeden vlastník naraz** (hlavná slučka medzi vlnami),
- každá vlna končí zeleným `php artisan test` pred ďalšou.

| Vlna | Agenti | Vlastníctvo súborov |
|---|---|---|
| 1 | 2 paralelne | A: `public/js/console/*` · B: `shortcuts.js`, `screens/kontrola.js`, `util.js` |
| 2 | 3 paralelne | A: `console/*` + `Console/ThreadController` · B: `screens/*` + serializery · C: PHP kontrolery + testy |
| 3 | 1 + hlavná slučka | agent: `interaction.js` (pointer eventy) · ja: `mind.css`, `console.css` |
| 4 | 2 paralelne | A: `console/*` · B: `screens/*` + `toasts.js` + `util.js` · ja: `mind.css` |
| 5 | 1 | zvyšok |

## 5. Odhad spendu

| Vlna | Odhad |
|---|---|
| 1 — rozhranie nesmie klamať | 110–150k |
| 2 — slepé uličky | 220–300k |
| 3 — dotyk a responzivita | 100–150k |
| 4 — stavy, fokus, hlas | 130–180k |
| 5 — upratanie | 50–80k |
| overenie, testy, dokumentácia | 90–130k |
| **Spolu** | **700–990k**, strop **1,2M** |

## 6. Hotovo, keď

- [ ] žiadne miesto, kde UI tvrdí iný stav, než aký je na backende
- [ ] žiadna klávesová akcia nekoná na inom objekte, než ktorý je pod fokusom
- [ ] každá funkcia, ktorú backend vie, je z UI dosiahnuteľná — alebo je zapísané, prečo nie
- [ ] plátno sa dá ovládať dotykom
- [ ] každý asynchrónny zoznam má tri stavy
- [ ] `php artisan test` zelený, screenshoty dotknutých obrazoviek v oboch témach
- [ ] `docs/BRAND-HADES.md` §6 sedí s tým, čo appka naozaj hovorí

## 7. Výsledok

_(dopĺňa sa po behu)_
