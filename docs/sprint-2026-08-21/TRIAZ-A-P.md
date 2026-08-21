# Triáž auditných nálezov A1–A21 (IA a toky) a P1–P13 (prístupnosť)

**Dátum:** 21. 8. 2026 · **Vetva:** `feat/hades-ux` · **HEAD pri triáži:** `3747310`
**Režim:** read-only. Overované staticky (čítanie kódu + grep) nad pracovným
adresárom, ktorý je voči HEAD čistý (`git diff --stat` prázdny), takže každý riadok
nižšie je dôkaz o **commitnutom** stave, nie o rozpracovanej zmene.

**Zdroje:** `docs/audit/03-ia-flows.md` (A1–A21), `docs/audit/04-a11y.md` (P1–P13),
`KONTRAKT-UX-APPKA-CHAT-2026-08-21.md` §4.

## Súhrn

| Stav | Počet | ID |
|---|---|---|
| **OPEN** | 15 | A2, A3, A4, A10, A12, A19, P2, P3, P5, P6, P7, P9, P10, P11, P13 |
| **FIXED** | 14 | A1, A5, A7, A11, A15, A16, A17, A18, A20, A21, P1, P4, P8, P12 |
| **WONTFIX** | 2 | A6, A14 |
| **SUPERSEDED** | 1 | A13 |
| **in scope wave 4** | 2 | A8, A9 |

Zavreté commitom `3747310`: A1, A16, A20, A21, P12 (a tri zo siedmich riadkov A19).
A5 zaviedol `7bbf3a4`. A7, A11, A15, A17, A18, P1, P4, P8 a druhá polovica P3 pribudli
20. 8. 2026 pod rukami auditov — komentáre v kóde to datujú samé.

**Pozor pri čítaní tabuľky:** štyri nálezy sú zavreté len čiastočne (A19, P3, P5, P7).
Vediem ich ako OPEN so zvyškom, nie ako FIXED — inak by zvyšok zmizol.

---

## Tabuľka

| ID | Stav | Dôkaz (súbor:riadok) | Efekt | Riziko | Čo presne treba spraviť |
|---|---|---|---|---|---|
| **A1** — konzola nedosiahnuteľná z grafu | **FIXED** (`3747310`) | `resources/views/mind.blade.php:146` → `<a href="/console" class="dest" aria-label="Charón — chat s vedomím">`, vlastná `rail-group aria-label="Charón"` (:144) | vysoký | — | Nič. Mikro-zvyšok: `CMDK_NAV` (`public/js/mind/cmdk.js:9–17`) nemá ani Charóna, ani **Runy** — paleta pozná 7 obrazoviek, appka ich má 8. Riešiť pod A12, nie ako A1. |
| **A2** — `Ctrl+K` + `Enter` skočí na Smernicu | **OPEN** | `public/js/mind/cmdk.js:86` → `const first = cmdkItems()[0]; first.click()`; `renderCmdk()` (:148–166) skladá `nav → Akcia → #cmdk-remote`, takže pri dopyte, ktorý nezhoduje názov obrazovky, je `items[0]` vždy „Vytvor smernicu" | stredný | malé | `Enter` z `#cmdk-input` nech vezme prvý `.cmdk-item` s `data-id`/`data-pb` (výsledok) a až pri jeho absencii akciu. Poradie skupín **nemeniť** — je to vizuálna hierarchia. |
| **A3** — odpad vidí len AI, nie človek | **OPEN** | `grep -rn "hygiene\|noise\|odpad" public/js/mind/ resources/views/mind.blade.php` = **0 zásahov**; `mind_hygiene` žije len v `app/Http/Controllers/McpController.php` | stredný | stredné | Sekcia „Hygiena" na obrazovke **Kontrola** nad tým istým serializérom, ktorý kŕmi `mind_hygiene` (dvojitá plocha to aj tak vyžaduje → riadok do `ScreenParityTest::registry()`). Novú obrazovku nezakladať — kontrakt počet zmrazil. |
| **A4** — Denník nemá detail na mieste | **OPEN** | `public/js/mind/screens/dennik.js:173` → `openNodeFromAnywhere({...})`; `public/js/mind/screens.js:86` → `setScreen('graf')` bezpodmienečne; to isté `screens/kontrola.js:381`. Kontrast: `screens/kniznica.js:116` → `openMdOverlay()` a zostane na obrazovke | stredný | malé | (1) záznam Denníka otvárať `openMdOverlay()` — jeden idióm na celú appku; (2) do hlavičky dňa „+N poznatkov"; (3) skok na Graf ako sekundárna akcia vnútri overlayu. |
| **A5** — Rozhodnutia sa nedajú hľadať textom | **FIXED** (`7bbf3a4`) | `public/js/mind/screens/rozhodnutia.js:150` → `<input id="dec-search" type="search">` v `.dtl-filter`; handler `:353`; prázdny stav rozlišuje „pre tento filter" vs. „zatiaľ žiadne" (:199–200) | — | — | Nič. `/api/search` sa **nerozširovalo** — presne ako WONTFIX #6 auditu chce. |
| **A6** — zlyhanie `/api/mind` zhodí všetkých 7 obrazoviek | **WONTFIX** | V kóde stále platí (`public/js/mind/main.js:50` → `renderInitError(); return;`), ale audit si to sám zakázal (§ „Čo vedome NEROBIŤ" bod 5) a kontrakt §4 ten zákaz preberá | stredný | stredné | Nenavrhovať. „Appka bez grafu" je nový stav aplikácie, nie príznak; `S.byId`/`S.areas` číta priveľa modulov. |
| **A7** — panel vlákien bez chybového stavu | **FIXED** | `public/js/console/main.js:51` → `let listState = 'loading' \| 'ready' \| 'error'`; `:74` `aria-busy`; `:86` `if (listState === 'error') list.append(errorNote())`; chyba **nezahadzuje** existujúce riadky (komentár :83–85) | — | — | Nič. |
| **A8** — tri mechanizmy na „daj kontext Claude Code" | **in scope wave 4** | — | — | — | Nenavrhovať prácu. Rieši vlna 4 (kontrakt §3 „Chat nad grafom" berie A8 so sebou). Zároveň WONTFIX #4 auditu zakazuje mazať `packBtn()`. |
| **A9** — mŕtvy chat v grafe duplikuje konzolu | **in scope wave 4** | Stále v kóde: `resources/views/mind.blade.php:285–286` (prepínač v Nastaveniach), `:434` (`#chat-log`), `public/js/mind/chat.js` (10 561 B) | — | — | Nenavrhovať prácu. Kontrakt §1 R-1 z toho robí dok Charóna nad plátnom; §6 predpisuje poradie: **najprv dok funguje, potom sa maže**. |
| **A10** — dok „Prehľad" duplikuje obrazovku Dnes | **OPEN** | `resources/views/mind.blade.php:232` (`#sec-stats`), `:62` (`#btn-stats` v `#graph-tools`), `public/js/mind/dock.js:18` (`stats: { title: 'Prehľad' }`), `public/js/mind/controls.js:120` → `openDock('stats')`. Oba zdroje čítajú `/api/dashboard` | nízky | malé | Zredukovať dok na „Otvoriť Dnes" — klávesa `S` nech otvorí obrazovku, nie druhý panel s tými istými číslami. Zjednocovanie komponentov patrí do vlny B. |
| **A11** — mŕtve endpointy a akcie v konzole | **FIXED** | `public/js/console/main.js:206` → `json('/api/console/threads/${uuid}', { method: 'DELETE' })` s armovaním (:184); premenovanie `:52` (`renaming`) prežije prekreslenie; filtrovanie panela `:62 matchesFilter()` + `fold()` bez diakritiky (:58); `/model` berie argument — `public/js/console/slash.js:43–48` `local: switchModel` | — | — | Nič. |
| **A12** — rail: destinácie bez princípu poradia | **OPEN** | `resources/views/mind.blade.php:105–131` = **jedna** `rail-group role="group" aria-label="Obrazovky"` s **8** destináciami (Runy pribudli); `public/js/mind/screens.js:18` `SCREENS` v tom istom poradí; `CMDK_NAV` (`cmdk.js:9–17`) má **7** z 8 — chýbajú Runy | stredný | malé | Rozdeliť do skupín TERAZ / ZÁZNAMY / PRÁCA (Charón a Systém už vlastné skupiny majú) a **v tom istom kroku** dorovnať `CMDK_NAV` na 8 obrazoviek + položku Charón, ktorá robí `location.href`, nie `setScreen`. `localStorage['hades.screen']` drží názov, nie index → uložená obrazovka prežije. |
| **A13** — kam patria Runy v toku | **SUPERSEDED** | Runy existujú a sú v raile (`mind.blade.php:122–124`), v `SCREENS` (`screens.js:18`) aj ako obrazovka (`public/js/mind/screens/runy.js`); log behov je zavretý (`RunRecorder`, tabuľka `runs`) | — | — | Nič. Bol to návrh, nie nález; zanikol tým, že vlna C dobehla. Zvyšok (Runy v `CMDK_NAV`) je vedený pod A12. |
| **A14** — kandidát na nepoužívanú destináciu: Smernica | **WONTFIX** | Audit sám: „Neoznačujem ju za nepoužívanú… **NEOVERENÉ**"; WONTFIX #1 („Smernicu nezrušiť") + kontrakt §4 | — | — | Nenavrhovať. Bez telemetrie je to úsudok, nie nález. |
| **A15** — systémová smernica sa po F5 vypíše ako správa | **FIXED** | `app/Http/Controllers/Console/ThreadController.php:127` → `->reject(fn ($m) => $m->role === 'system')` **na serveri**, nie až v UI; `public/js/console/render.js:418` to potvrdzuje komentárom | — | — | Nič. Opravené na správnej strane (payload), ako audit navrhoval. |
| **A16** — strop krokov vyzerá ako hotová odpoveď | **FIXED** (`3747310`) | nový modul `public/js/console/runstate.js` (0 importov → mimo cyklu): `cleanStop()`, `stopNote()`, `runNote()`; `public/js/console/run.js:379` `noteStop(frame.stop_reason)`, `:398` `cleanStop(...) ? 'Odpoveď dokončená' : 'Beh prerušený'`; obnovené vlákno `render.js:405` `runNote(run)` | — | — | Nič. Jeden zdroj textov pre živý beh aj obnovu — presne to, čo §6 auditu žiadalo. |
| **A17** — „Povoliť vždy" nezobrazí zapnutý auto-accept | **FIXED** | `public/js/console/run.js:437–449` (`syncAutoAccept`): `C.thread.auto_accept = frame.auto_accept`, `$('#auto-accept').checked = frame.auto_accept`, pri prechode `false→true` navyše `announce('Zápisy sa v tomto vlákne už nepýtajú.')` | — | — | Nič. |
| **A18** — písanie počas behu je tichý no-op | **FIXED** | `public/js/console/run.js:66–71` → `if (C.running) { pushNotice('Beh ešte beží — zastav ho klávesou Esc…'); announce('Beh ešte beží. Správa neodišla.'); return; }`; text v poli zostáva | — | — | Nič. **Front správ** je WONTFIX #7 auditu — nenavrhovať (rozpor s kontraktom §3 je rozobraný v poznámkach pod poradím prác). |
| **A19** — slash paleta pokrýva demo, nie prácu | **OPEN** (3 zo 7 riadkov zavreté) | Zavreté: `public/js/console/slash.js:43–48` `/model <id>` → `switchModel`, `:50` `/tools` → `showTools`, `:51` `/cost` → `showCost`. **Nezavreté:** `grep -rn "copy\|clipboard\|Kopírovať" public/js/console/` = **0** — žiadne „kopírovať" na bubline ani na `pre` bloku; `Ctrl+N` žije len v `title` atribúte (`resources/views/console.blade.php:48`), `#composer-hint` (:134–137) ho nemenuje | stredný | nízke | (1) tlačidlo „Kopírovať" na bubline asistenta a na každom `pre` bloku v `renderMarkdown` — čisto aditívne; (2) `Ctrl+N` do `#composer-hint` alebo do prehľadu skratiek. `/cc`, `/orchestrate` = vlna D, nerobiť. |
| **A20** — „krok 1/12" visí po Stope | **FIXED** (`3747310`) | `public/js/console/run.js:192` → v `finally` bloku `stream()`: `if (!C.awaiting) C.step = null;` — podmienka je správna, zaparkovaný ťah krok stále má | — | — | Nič. |
| **A21** — tokeny a rýchlosť po obnove zmiznú | **FIXED** (`3747310`) | `public/js/console/render.js:256–258` → `costLabel({ ..., tokens_per_second: meta.tokens_per_second })` v `assistantShell()`; hlavička ide tou istou funkciou (`:503`), takže bublina a `#run-stats` nemôžu hovoriť inak | — | — | Nič. |
| **P1** — plátno sa hýbe pri `prefers-reduced-motion` | **FIXED** | `public/js/mind/sim.js:239` → `if (!shown \|\| (REDUCED_MOTION && !S._interacting))` — pumpa dosadá ticho aj **na** Grafe, v dávkach 10 ms/50 ms; `:243–249` raz skočí do usadenej kamery, `finishSettle()` dokreslí. Výnimka pre ťahanie uzla je zámerná (komentár :233–236) | — | — | Nič. Determinizmus **nezavedený**, d3 tiká ďalej → kontrakt §4 dodržaný. |
| **P2** — žiadny skip link, >400 Tabov ku composeru | **OPEN** | `grep -n "skip-link" public/css/*.css resources/views/*.blade.php` = 0; jediný „Preskočiť" v repe je `#hint-skip` onboarding karty (`resources/views/mind.blade.php:483`), čo je iná vec | vysoký | nulové | `<a class="skip-link" href="#composer">Preskočiť na zadanie</a>` ako prvý prvok `<body>` v `console.blade.php` a `<a href="#screens">` v `mind.blade.php`, viditeľné na `:focus`. `.sr-only` je v `console.css:50`, do `mind.css` sa musí doplniť (zároveň D6). |
| **P3** — po rozhodnutí padne fokus na `<body>` | **OPEN** (polovica zavretá) | **Zavreté (Runy):** `public/js/mind/screens/runy.js:117–118` → po prekreslení `body.querySelector('button[data-toggle="…"]')?.focus()`, stav v `runsState.focus` (:23, :330). **Nezavreté (karta povolenia):** `public/js/console/tools.js:462–481` — `decide()` zakáže tlačidlá a `.pc-actions` nahradí odstavcom, ale `card.focus()` v celom `decide()` nie je; jediné `.focus()` v súbore je `:423`, teda pri **vzniku** karty | vysoký | nízke | Na konci `decide()` `card.focus()` — `tabIndex` je už `-1` a karta v DOM zostáva. Jeden riadok. |
| **P4** — brána ohlási nástroj, nie zápis ani výsledok | **FIXED** | `public/js/console/tools.js:445–459` `writeAsk(frame)` → „Zápis: `<nástroj>` — `<argsSummary \| prvý riadok náhľadu>`. Enter povolí, Esc zamietne.", volané z `run.js:358`; výsledok `tools.js:476` `announce('<DECISION_LABEL> — <nástroj>.')` | — | — | Nič. |
| **P5** — `a.ghost`: prsteň 1,08:1 a žiadny štýl tlačidla | **OPEN** (polovica zavretá) | **Zavreté (farba):** `public/css/mind.css:722–723` → `button.ghost, a.ghost { … color: var(--muted) }` + `:hover`, komentár :718–721. **Nezavreté (prsteň):** fokusové pravidlo je stále `public/css/mind.css:703` `button:focus-visible`, a `<a class="ghost">` (`public/js/mind/screens/runy.js:286`) nespadne pod žiadne `a…:focus-visible` v `mind.css` — jediné take je `:901`, viazané na `#rail .rail-group` | stredný | nulové | Promovať `:focus-visible` na globálne pravidlo v `mind.css` (vzor `console.css:44` `.console-body :focus-visible`) a zrušiť 54 per-komponentných opakovaní — je to zároveň D6. Minimum: pridať `a.ghost` k `mind.css:703`. |
| **P6** — heatmapa: dáta len farbou a `title`, prsteň 1,08:1 | **OPEN** | `public/js/charts.js:149–160` → `el('div', 'heat-cell')` + `setAttribute('data-tip'/'title')`, bez `role`, bez `aria-label`, bez textu; kontejner `.heat` (`:128`) nemá `role` ani `aria-label` (`role: 'img'` je v súbore len na `:210` a `:292`, teda na iných grafoch); legenda „menej – rampa – viac" (`:168–176`) je slovami, dáta nie | stredný | nízke | `role="img"` + `aria-label` so súhrnom („365 dní, spolu N záznamov, najviac M dňa D") na `.heat`; `.sr-only` veta alebo tabuľka pod grafom; explicitný `tabindex="0"` s vlastným prstencom, ak má kontejner zostať skrolovateľný. |
| **P7** — filtračné čipy nehlásia zapnutý filter | **OPEN** (1 z 5 miest zavreté) | **Zavreté:** `public/js/mind/screens/runy.js:149–151` → `aria-pressed="…"` + komentár, prečo je povinné (:146). **Nezavreté:** `screens/dennik.js:81` a `:85`, `screens/kontrola.js:173`, `screens/kniznica.js:144`, `screens/rozhodnutia.js:112` — všade len trieda `.active`, teda farba | vysoký | nulové | Jeden atribút v štyroch `chip()` funkciách. Lepšie: **jedna spoločná** `chip()` (súvisí s D2/D21) — päť kópií tej istej funkcie je práve dôvod, prečo sa oprava zastavila na jednej z nich. |
| **P8** — karta behu `role="button"` s vnorenými akciami | **FIXED** | `public/js/mind/screens/runy.js:193–197` (komentár priznáva pôvodný návrh ako chybu), `:208` `<article class="dtl-card run-card">` už bez `role`, `:214` hlavička je skutočné tlačidlo s `aria-expanded` + `aria-controls="<panelId>"`, detail je súrodenec | — | — | Nič. Idióm z Rozhodnutí prevzatý. |
| **P9** — plátno grafu nemá prístupnú alternatívu | **OPEN** | `resources/views/mind.blade.php:38` → `<canvas id="mind"></canvas>` bez `role`, `aria-label` a bez vnútorného fallbacku; `:241` to isté pre `<canvas id="growth-chart">`; `grep -rn "role=\"img\"" public/js/mind/` = 0 | stredný | nízke | `role="img"` + `aria-label` z čísel, ktoré už počíta `updateHeaderMetrics()`, + `aria-describedby` na `#structure-tree`. Text musí čítať **výsledok** z `S`, nie druhú kópiu formuly — inak po zmene metrík hlási staré čísla. |
| **P10** — `button.switch` je 34×20 px (6 výskytov) | **OPEN** | `public/css/mind.css:1222` → `width: 34px; height: 20px; min-height: 20px` | stredný | nízke | 24 px výška, alebo neviditeľná zásahová zóna `::after { inset: -2px }` — cieľ vyrastie, kresba zostane. Farebné hodnoty sa nedotýkajú (kontrakt §4). |
| **P11** — `#auto-accept` (brána zápisov) je 128×18, na úzkom 13×13 | **OPEN** | `public/css/console.css:423` → `.auto-accept { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }` — **žiadny `min-height`, žiadny `padding`**; `:1063` `.auto-accept .lbl { display: none }` pod 860 px stále platí, takže cieľ spadne na samotné 13×13 políčko | stredný | nulové | `min-height: 24px` na `.auto-accept` + `padding` na labeli. Najzávažnejší prepínač v appke nesmie byť jej najmenší cieľ. |
| **P12** — slash paleta neexistuje pre čítačku | **FIXED** (`3747310`) | `resources/views/console.blade.php:121–122` → `role="combobox" aria-expanded="false" aria-controls="slash-palette" aria-autocomplete="list" aria-haspopup="listbox"`; `public/js/console/slash.js:166` `item.id = 'sp-…'`, `:186` `aria-expanded=true`, `:201` `aria-activedescendant` v `paintCursor()`, `:218` atribút sa **maže**, nenastavuje na prázdno | — | — | Nič. Klávesová logika sa nemenila, ako audit predpisoval. |
| **P13** — composer má 1 px indikátor namiesto prstenca | **OPEN** | `public/css/console.css:874` → `border: 1px solid var(--border)`; `:883` `.composer-row:focus-within { border-color: var(--accent) }`; `:884` `#composer #prompt:focus-visible { box-shadow: none }` | nízky | nulové | `border-width: 2px` na `.composer-row` **rezervovaný v pokoji** (aby sa layout pri fokuse nehýbal), alebo `box-shadow: 0 0 0 1px var(--accent)` navyše. Zámer „jeden indikátor, nie dva" (komentár :879–882) **zachovať** — nepridávať prsteň na textareu. |

---

## Poradie prác podľa pomeru efekt/riziko

Len OPEN nálezy. Poradie je pomer, nie abecedná priorita: hore je to, čo dá najviac
za najmenej, dole to, čo si žiada rozhodnutie o štruktúre.

### Dávka 1 — nulové riziko, dá sa zapísať bez zmeny jediného toku

| # | ID | Prečo prvé |
|---|---|---|
| 1 | **P2** (skip link) | Vysoký efekt, nulové riziko. Dnes je konzola klávesnicou prakticky nedostupná (>400 Tabov) a je to jediné miesto, kde sa rozhoduje o zápise do pamäte. Dva `<a>` + jedna trieda. Nesie zároveň polovicu D6 (`.sr-only` do `mind.css`). |
| 2 | **P7** (čipy `aria-pressed`) | Vysoký efekt, nulové riziko, a `runy.js:149–151` už ukazuje hotový vzor vrátane komentára, prečo je atribút povinný. Štyri miesta. Ak sa pri tom `chip()` zjednotí do jednej funkcie, zmizne aj príčina, prečo sa oprava zastavila na jednej z piatich. |
| 3 | **P11** (`.auto-accept` 24 px) | Dva riadky CSS, nulové riziko, a je to zásahový cieľ tej brány, na ktorej stojí celý bezpečnostný model konzoly. |
| 4 | **P5** (prsteň pre `a.ghost`) | Nulové riziko a **polovica práce je hotová** (farba). Odporúčam rovno globálne `:focus-visible` v `mind.css` — je to D6 a zruší 54 opakovaní; minimum je pridať `a.ghost` k `mind.css:703`. |
| 5 | **P13** (composer 2 px) | Jeden riadok. Šírku rezervovať v pokoji, inak sa pri fokuse pohne layout. |

### Dávka 2 — nízke riziko, ale treba napísať správanie, text alebo súhrn

| # | ID | Prečo tu |
|---|---|---|
| 6 | **P3** (fokus po rozhodnutí) | Jeden riadok (`card.focus()`), ale je to správanie, nie štýl → patrí za CSS dávku. Bez P2 je efekt polovičný (druhé rozhodnutie v tom istom vlákne je aj tak nedosiahnuteľné), takže **P2 pred P3**. |
| 7 | **P9** (plátno `role="img"`) | Aditívne, čísla už počíta `updateHeaderMetrics()`. |
| 8 | **P6** (heatmapa) | Aditívne, ale treba zložiť súhrnnú vetu a rozhodnúť `tabindex` vs. skrolovateľnosť kontejnera. |
| 9 | **P10** (`button.switch` 24 px) | Vizuálna zmena na 6 prepínačoch → povinný `cssswap.js` dôkaz inertnosti zvyšku. |
| 10 | **A19 zvyšok** (kopírovanie odpovede a kódu, `Ctrl+N` v nápovede) | Čisto aditívne a jasne pomenované. Kopírovanie je najviditeľnejšia chýbajúca vec voči Claude Code. |
| 11 | **A2** (`Enter` v palete) | Malé riziko: poradie skupín je zároveň vizuálna hierarchia, takže sa **nemení poradie**, len výber položky. |

### Dávka 3 — zasahuje štruktúru, až po dávkach 1 a 2

| # | ID | Prečo neskôr |
|---|---|---|
| 12 | **A12** (grupy v raile + `CMDK_NAV` na 8) | Malé riziko (`localStorage` drží názov, nie index), ale mení DOM railu aj `cmdk.js`. Robiť **jedným krokom** s dorovnaním `CMDK_NAV` — dnes v ňom chýbajú Runy aj Charón a rozdiel by sa inak zaplatil dvakrát. |
| 13 | **A10** (dok Prehľad → „Otvoriť Dnes") | Nízky efekt, ale je to zlúčenie komponentov z vlny B a dotýka sa klávesy `S`. |
| 14 | **A4** (idióm detailu v Denníku) | Malé riziko pri overlay variante (`md.js` je odskúšaný), ale mení tok na dvoch obrazovkách (Denník, Kontrola). Efekt je vysoký pre úlohu „čo sa naučilo za 3 dni". |
| 15 | **A3** (hygiena na Kontrole) | Jediný OPEN so **stredným** rizikom: potrebuje serializér a dvojitú plochu UI = MCP, teda riadok v `ScreenParityTest::registry()`. Novú obrazovku nezakladať. |

### Poznámky k poradiu

- **P1 a P8**, ktoré audit označil za jediné dve vyžadujúce rozhodnutie o architektúre,
  sú **obe už zavreté** a P1 bez zavedenia determinizmu. Dávka 1 je preto čisté CSS
  a atribúty — v prístupnosti tohto šprintu neexistuje práca s vysokým rizikom.
- **A18 vs. kontrakt:** kontrakt §3 menuje „A18 (front správ počas behu)", ale audit
  si front sám zakázal (WONTFIX #7: „má vzniknúť až s logom behov, aby sa zaradená
  správa dala aj zaznamenať"). Log behov **už existuje**, takže zákaz stratil svoj
  dôvod — je to však zmena rozsahu, nie triáž. Hlásim ako otvorený bod na rozhodnutie
  používateľa. Samotné hlásenie „beh ešte beží" je hotové (`run.js:66–71`).
- **A6** je jediný nález, ktorý v kóde **stále platí** a napriek tomu je WONTFIX.
  Píšem to výslovne, aby ho nikto pri ďalšom audite nenahlásil ako nový.
- **A19, P3, P5 a P7** sú čiastočne zavreté. Kto ich bude robiť, nech nezačína od
  nuly — polovica je v kóde a druhá polovica je v tabuľke pomenovaná riadkom.
