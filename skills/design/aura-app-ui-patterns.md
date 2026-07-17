# Aura app — UI/UX interakčné vzory

> Kuchárka reálnych interakčných a vizuálnych vzorov internej Aura appky (aura-hr-mapa) — layout, zoznamy, detail, formuláre, akcie, stavy a mikrocopy — ako predloha pre ďalšie interné Aura nástroje s prémiovým, pokojným dojmom.

## Prehľad

`aura-hr-mapa` je interná evidencia zamestnancov, pozícií, mailov a aplikácií pre značku Aura (šperky). Frontend je **čisté browser JS bez frameworku a bez CDN** — jeden zdieľaný „UI kit + router" v `app.js`, ktorý cez `window.APP` a `window.VIEWS` obsluhuje jednotlivé pohľady v `public/views/*.js`. Vizuál nesie prémiovú šperkársku identitu: teal akcent, zlatá koruna (brand-gold), krémovo-ružové pozadie, Geist + Playfair Display, plná light/dark téma.

Prečo na tom pri ďalších Aura appkách záleží: appky majú vyzerať ako **jedna rodina**. Ten istý UI kit (rovnaké tlačidlá, karty, badge, modaly, toasty, prázdne stavy, command palette) drží celý interný ekosystém na jednej vizuálnej a interakčnej úrovni bez frameworkovej réžie. Cieľom nie je maximum funkcií na obrazovke, ale **pokoj, jasná hierarchia a dôvera** — striedme menu, minimum čísel navyše, decentné animácie, konzistentné mikrocopy po slovensky.

Táto kuchárka opisuje, čo appka reálne robí, aby sa vzory dali skopírovať do ďalších Aura nástrojov.

## Kľúčové pojmy

- **UI kit (`window.APP`)** — objekt vyexportovaný v `app.js` so všetkými zdieľanými helpermi: `api`, `esc`, `el`, `money`, `avatar`, `badge`, `deptChip`, `statusBadge`, `icon`, `toast`, `undo`, `openModal`, `openDrawer`, `confirmDialog`, `detailPage`, `emptyState`, `segmented`, `tabsHtml`, `barList`, `donut`, `canEdit`, `canAdmin`, `go`, `openDetail`, `refresh`, `setOnNew`. Pohľady si ho berú cez `const A = window.APP;`.
- **Pohľad (view)** — modul v `public/views/<id>.js`, IIFE, ktorý sa registruje do `window.VIEWS.<id>` (zoznam) a voliteľne `window.VIEWS.<id>__detail` (detail = plná stránka). Žiadne `import`/`export`.
- **Hash router** — `parseHash()` číta `#/view` alebo `#/view/id`. `route()` vyberie list alebo detail funkciu, prekreslí `#view`, medzitým zobrazí skeleton.
- **Detail = plná stránka** (nie modal) — `detailPage(root, {...})` vykreslí hlavičku (späť + názov + stav + akcie + `⋯` menu) a telo (`detail-main` + voliteľný sticky `detail-aside`).
- **Density (hustota)** — `cozy` / `compact`, uložené v `localStorage` (`aura_density`), aplikované cez `data-density` na `<html>`; `compact` len zmenší paddingy a fonty cez CSS override.
- **Segmented vs Tabs** — `segmented` = pilulkový prepínač obsahu na mieste (napr. Tabuľka/Karty); `tabs` = podčiarknuté taby vo vnútri pohľadu.
- **Lookups + badges** — appka po prihlásení prednačíta zoznamy (`departments`, `positions`, `employees`, `applications`, `activities`) do `state.lookups` a alert počty do `state.badges` (jediné čísla, ktoré menu ukazuje).

## Architektúra frontendu

Vrstvenie je zámerne ploché a bez závislostí:

1. `index.html` — kostra: `#loader`, `#login`, `#app` (sidebar + topbar + `#view`), `#modal-root`, `#toasts`, `#cmdk` (command palette). Načíta `styles.css` a potom `app.js` + všetky `views/*.js` cez klasické `<script>` tagy s `?v=` cache-bustingom. Inline skript v `<head>` nastaví tému a hustotu z `localStorage` **pred** vykreslením (žiadny flash).
2. `styles.css` — jediný stylesheet. `:root` a `[data-theme="dark"]` definujú CSS premenné (semantické tokeny: `--paper`, `--surface`, `--surface-2`, `--ink`, `--muted`, `--line`, `--accent`, `--brand-gold`, `--danger`, `--ok`, `--warn`, tiene `--shadow*`, rádiusy `--r-sm/--r/--r-lg`). Všetky komponenty referencujú len tieto premenné — light/dark je len prepnutie mapy.
3. `app.js` — UI kit + router + auth + command palette + skratky + téma. Nič nevykresľuje samo, len poskytuje `window.APP`.
4. `views/*.js` — konkrétne obrazovky. Každá si drží vlastný lokálny stav filtra/sortu v premennej modulu (prežije návrat z detailu), renderuje HTML stringom cez template literály (`esc()` na všetky dáta) a naväzuje eventy po vložení do DOM.

Dátový tok: `boot()` → `api('/meta')` (user + workspace) → `loadLookups()` + `loadBadges()` → `renderNav()` → `route()`. API helper `api(path, opts)` pridáva `/api` prefix, JSON, `credentials: same-origin`; pri `401` zavolá `showLogin()`; pri chybe hodí `Error(data.error)`.

## Layout a navigácia

- **Sidebar** (`.sidebar`, 240px, sticky, `var(--surface)`): brand (zlatá koruna + „Aura / HR mapa"), `nav` so sekciami (`nav-sep`: „Prehľad", „Systém"), dole `side-user` s menom, e-mailom a `role-pill`.
- **Nav položka** (`.nav-item`): ikona (inline SVG z `ICONS`) + label. Aktívna položka má **zlatý ľavý prúžok** (`inset 3px 0 0 var(--brand-gold)`) a jemné zlaté pozadie — nie teal, aby akcent ostal na akcie. Hover je teal tint.
- **Striedme menu — bez bežných počtov.** `navCount()` zámerne vracia `null`; jediný badge v menu je oranžový `nav-alert` (napr. „Maily bez správcu"). Menej šumu = pokojnejší dojem.
- **Topbar** (`.topbar`, sticky, `backdrop-filter: blur`): hamburger (mobil), názov pohľadu, vpravo `top-actions` — „Ctrl K Hľadať", `?` nápoveda, `◐` téma, `⎋` odhlásiť. Ikonové tlačidlá sú `btn-ghost btn-icon` s `title`/`aria-label`.
- **Mobil** (`max-width: 900px`): sidebar sa mení na off-canvas (`.sidebar.open` + `.overlay`), hamburger sa zobrazí, `cols-2/3` a `fld-row` padajú do jedného stĺpca.

## Zoznam / tabuľka (vzor)

Referencia: `views/employees.js`, `views/mailboxes.js`.

- **Page-actions riadok** navrchu: `filters` (hľadanie + select filter), vpravo `segmented` prepínač zobrazenia (Tabuľka/Karty), a `btn-accent` „Pridať" (len ak `canEdit()`).
- **Hľadanie** (`.filters .search`): input s lupou (`::before content: "⌕"`), filtruje **lokálne a okamžite** na `input` evente (žiadny submit). Filtruje cez viac polí naraz (meno, mail, pozícia, oddelenie).
- **Tabuľka** (`table.tbl` v `.panel` + `.tbl-wrap` pre horizontálny scroll): len **4 kľúčové stĺpce** (zvyšok patrí do detailu — `COLS` v employees). Hlavičky sú malé uppercase muted; klik na hlavičku triedi (`data-sort`, šípka ▲/▼), prázdne hodnoty vždy naspodok, `localeCompare` so slovenčinou.
- **Riadok**: `cursor: pointer`, hover teal tint; klik kdekoľvek okrem checkboxu/inputu otvorí detail (`A.openDetail("employees", id)`). Prvá bunka je `cell-emp` = `avatar` (iniciály) + meno.
- **Bunky ako komponenty**: `deptChip(name, color)` (farebná bodka + názov oddelenia), `statusBadge(status)` (zelená „Aktívny" / muted „Neaktívny", `badge dot`), `avatar(name, ini)` (zlato-tónovaný štvorec s iniciálami).
- **Karty** (`.emp-cards`, alternatíva k tabuľke): grid `minmax(240px,1fr)`, každá karta má farebný ľavý okraj oddelenia (`--c`), avatar, meno, pozíciu, chips. Prepínač Tabuľka/Karty sa pamätá v `localStorage` (`aura_emp_view`).
- **Zoskupovanie**: mailboxes vie zoskupiť podľa oddelenia (`aura_mb_group`).

## Hromadný výber (bulk)

- Každý riadok/karta má `row-check` checkbox; hlavičková „vybrať všetkých" (`#emp-all`) drží indeterminate stav.
- Pri `selected.size > 0` sa nad zoznamom zjaví **bulk bar** (`.bulk-bar`, teal tint): „Vybratých N" + akcie: Priradiť aplikáciu, Zmeniť oddelenie, Poskladať mail, Zrušiť výber.
- Bulk akcie bežia cez modal a **sekvenčné API volania** v cykle; po dokončení `toast(...,"ok")` + `A.refresh()`. Dôležitý reálny detail: pri PUT, ktorý prepisuje všetky polia, sa najprv dotiahne plný detail záznamu, aby sa nezmazali ostatné polia.

## Detail — plná stránka (vzor)

Referencia: `employeeDetail()` v `views/employees.js` cez `A.detailPage`.

- **Hlavička** (`.detail-head`): tlačidlo Späť (`←`, `backToList()`), názov `h1` + `sub`, `detail-status` (badge stavu), vpravo `detail-actions`: primárne akcie ako `btn` (`btn-accent` pre hlavnú, `btn-outline` inak) + `⋯` menu (`menu-pop`) pre sekundárne/nebezpečné (napr. „Karta (tlač)", „Zmazať" — `menu-item danger`, len `canAdmin`).
- **Telo dvojstĺpcové** (`.detail-body.has-aside`, grid `2fr 1fr`): `detail-main` = obsah, `detail-aside` = sticky bočný panel. Na mobile padá do 1 stĺpca.
- **Definičné sekcie** (`.def` + `h4` uppercase muted + `.def-row` „label vpravo hodnota"): appka takto ukladá Zaradenie, Kontakt, Nadriadení, Schránky, Aplikácie. Chýbajúce hodnoty = `<span class="muted">—</span>`.
- **Chips a badge v deteile**: aplikácie sa rozlišujú „· priamo" (neutrálna) vs „· cez pozíciu" (`badge off`), s `title` na presný zdroj.
- **Interaktívne prvky v deteile bez reloadu**: onboarding checklist (toggle/pridať/zmazať) prekresľuje len svoju časť a synchronizuje cez API s optimistickým rollbackom pri chybe.
- Detail dáta ťahá paralelne (`Promise.all`) — hlavný záznam + zdedená náplň z pozície + onboarding, každé best-effort (`.catch(()=>{})`).

## Formuláre (vzor)

Referencia: `employeeForm()`, `ownBlocksModal()`.

- **Formulár = modal** (`A.openModal`, `wide` pri komplexnejších). Detail je stránka, ale editácia beží v modale nad ňou.
- **Pole** = `label.fld` s `span` popiskom (malý uppercase muted) nad inputom. Dvojice polí vedľa seba cez `.fld-row` (grid 1fr 1fr, na mobile 1 stĺpec).
- **Progresívne odhalenie**: povinné/časté polia hore, zvyšok skrytý v `<details><summary>Viac možností</summary>` — formulár tak nepôsobí zahltene.
- **Nenásilné inline upozornenia** (nie blokujúce validácie): duplicitné meno (`#f-dup`) a nesúlad oddelenia s oddelením pozície (`#f-dept-note`) sa ukážu ako žltý (`--warn`) text pod poľom pri písaní/zmene — varujú, ale nebránia uloženiu.
- **Footer** modalu: `btn-outline` „Zrušiť" + `btn-accent` s ikonou check „Uložiť". Pri odoslaní sa tlačidlo `disabled`, po úspechu `closeModal()` + `toast("Uložené","ok")` + `A.refresh()`; pri chybe sa `disabled` vráti a zobrazí `toast(e.message,"err")`.
- **Skladanie obsahu** (`ownBlocksModal`, block editor): položky rozdelené do 4 farebných typov (Zodpovednosti ◆, Úlohy ✓, Právomoci ⚖, KPI ◎), pridávanie cez input+Enter, mazanie cez `×`; uloženie prepíše celý zoznam (jasne oznámené v mikrocopy).

## Akcie, spätná väzba a undo

- **Toasty** (`toast(msg, kind)`): pilulka vpravo dole, auto-zmizne po 2,6 s; `ok` = teal, `err` = červená, default = tmavá.
- **Undo (soft delete)** (`undo(msg, commitFn, delay=5000)`): namiesto okamžitého zmazania sa ukáže toast „… Späť"; commit sa spustí až po 5 s, ak sa neklikne Späť. Prémiový pocit bezpečia.
- **Potvrdenie** (`confirmDialog(msg, onYes, {okLabel})`): malý modal pre nezvratné akcie (mazanie).
- **Drawer** (`openDrawer`) — bočný panel sprava (`slideIn` animácia) pre rýchly náhľad bez opustenia zoznamu.
- **Kopírovanie** má vždy fallback: `navigator.clipboard` → záložný `textarea + execCommand`, s toastom o výsledku.

## Command palette a klávesové skratky

- **Ctrl/⌘ + K** otvorí `#cmdk` (`openCmdk`): input + výsledky. Prázdny dotaz ukáže rýchle akcie (Nový zamestnanec/schránka/…) + navigáciu; od 2 znakov debounced (180 ms) volá `/api/search`. Šípky + Enter + Esc, aktívna položka `scrollIntoView`.
- **Skratky** (`document keydown`, ignoruje písanie v poliach): `?` nápoveda, `N` nový záznam v aktuálnom pohľade (cez `state.onNew`, ktorý si view nastaví `A.setOnNew`), `1–8` prepnutie pohľadu, `Esc` zavrie modal/drawer/cmdk. Nápoveda (`openHelp`) vypisuje `SHORTCUTS` v `kbd-list`.

## Stavy: prázdny, loading, error

- **Loading (skeleton)**: `route()` pred načítaním vloží `skeleton-view` s niekoľkými `.skeleton` blokmi (shimmer animácia). Dashboard má textové „Načítavam prehľad…".
- **Prázdny stav** (`emptyState(icon, title, desc, ctaLabel, ctaFn)`): kruhová ilustrácia s ikonou, tučný titul, popis, a CTA tlačidlo **len ak `canEdit()`**. Rozlišuje sa „žiadne dáta vôbec" (s CTA „Pridať prvého…") vs „filter nič nenašiel" (bez CTA, text „Skús upraviť hľadanie alebo filter").
- **Error**: pri zlyhaní `route()` vykreslí `emptyState("close","Chyba",e.message)`. Dashboard pri chybe ponúkne panel s tlačidlom „Skúsiť znova". `401` nikdy nezobrazuje chybu — presmeruje na login.
- Prázdne hodnoty v dátach sú vždy jednotné pomlčkou `—` (`T.none`), nie prázdny reťazec.

## Vizuálny jazyk (prémiový pokojný dojem)

- **Farby**: neutrálne krémovo-ružové/teal-tmavé plochy, **teal** (`--accent`) pre akcie a odkazy, **zlatá koruna** (`--brand-gold`) len ako brandový akcent (aktívna nav, hover okraje kariet, login prúžok, hero glow). Sémantické `--ok`/`--warn`/`--danger` striedmo.
- **Typografia**: Geist (UI) + Playfair Display italic (`serif-italic`) pre brandové drobnosti; `mono` je zámerne mapované na Arial (tabular-nums pre čísla).
- **Pohyb**: jemný, `cubic-bezier(.16,1,.3,1)`, karty/staty sa pri hover mierne nadvihnú (`translateY(-2px)`) so zlatým tieňom (`--shadow-gold`). Rešpektuje `prefers-reduced-motion` (vypne animácie).
- **Hĺbka**: mäkké viacvrstvové tiene (`--shadow`, `--shadow-lg`, `--shadow-gold`), rádiusy 8/10/14 px, `1px` linky (`--line`).
- **Hero** (`.hero`): decentný gradientový pás (zlatý + teal glow) navrchu dashboardu s korunou a „Vitaj späť · Aura".
- **Dashboard**: malý hero + 4 KPI staty (klik nav5 do pohľadu) + panel „Mesačné náklady" s donut grafom (CSS `conic-gradient`, `DONUT_COLORS`) + panel „Na doriadenie" (zoznam todo riadkov s warn badge a chevronom).

## Mikrocopy (slovensky, sentence case, bez emoji)

- Tlačidlá slovesom/vecne: „Pridať", „Uložiť", „Zrušiť", „Upraviť", „Zmazať", „Priradiť", „Kopírovať adresy", „Otvoriť v pošte".
- Sekcie a stavy: „Na doriadenie", „Náplň práce", „Osobné doplnky", „Zaradenie", „Nadriadení", „Aktívny/Neaktívny", „primárny", „· cez pozíciu".
- Slovenské skloňovanie počtov (`plural(x, one, few, many)`, `dniWord`) — „1 schránka / 2 schránky / 5 schránok", „o 3 dni".
- Prázdne/empty texty sú konkrétne a nápomocné: „Pridaj prvého člena tímu.", „Skús upraviť hľadanie alebo filter oddelenia.", „Pozícia nemá vyplnenú náplň."
- Vysvetľujúce drobné popisy pod prepínačmi: „Tmavý režim šetrí oči večer…", „Kompaktná zobrazí viac dát na obrazovku.", „Podrž Ctrl/⌘ pre výber viacerých."

## Checklist pre novú Aura appku

- Prevezmi `app.js` UI kit (`window.APP`) + `styles.css` tokeny; pohľady píš ako IIFE registrujúce `window.VIEWS.<id>` (+ `__detail`).
- Nastav tému a hustotu inline v `<head>` z `localStorage` pred renderom (žiadny flash).
- Zoznam = filtre + segmented prepínač + `Pridať` (gate `canEdit()`); tabuľka max ~4 stĺpce, klik na riadok → detail.
- Detail = plná stránka cez `detailPage` (späť + stav + primárne akcie + `⋯` menu; main + sticky aside s `.def` sekciami).
- Formulár = modal s `.fld`/`.fld-row`, časté polia hore, zvyšok v `<details>`; nenásilné inline `--warn` upozornenia; save → disable → toast → refresh.
- Vždy tri stavy: skeleton loading, `emptyState` (CTA len pri práve na úpravu), error s „Skúsiť znova"; `401` → login, nie chyba.
- Escapuj všetky dáta cez `A.esc()` v template literáloch.
- Menu drž striedme (bez bežných počtov, len alert badge). Undo pri mazaní. Toasty krátke.
- Mikrocopy slovensky, sentence case, bez emoji; pomlčka `—` pre prázdno; správne skloňovanie počtov.
- Ikonové tlačidlá vždy s `title` + `aria-label`; `:focus-visible` outline; rešpektuj `prefers-reduced-motion`.

## Časté chyby / gotchas

- **PUT prepisuje celý záznam.** Pri čiastkovej zmene (bulk zmena oddelenia) najprv dotiahni plný detail a pošli všetky polia, inak vymažeš pozície a ostatné údaje. Reálne riešené v `bulkChangeDept`.
- **Lokálny stav filtra drž v premennej modulu**, nie v `renderList` scope — inak sa po návrate z detailu resetne (mailboxes `flt`, employees `empQuery/empDept/empSort`).
- **`state.onNew`** treba nastaviť (`A.setOnNew`) v každom pohľade, kde má fungovať skratka `N`; inak `N` nič nespraví.
- **Cache-busting**: pri zmene JS/CSS zvýš `?v=` v `index.html`, inak prehliadač servíruje staré súbory.
- **Escapovanie**: dáta do HTML vždy cez `esc()`; do `mailto:`/URL cez `encodeURIComponent`. Nikdy neinterpoluj surové dáta.
- **Tlačová karta** (`printCard`) otvára `window.open` — ošetri blokované pop-upy toastom.
- **Menu-pop / dropdown** zatváraj aj klikom mimo (`document click`) — inak ostane otvorený.
- **Nezavádzaj framework ani CDN.** Celý štýl appky stojí na tom, že je to malé, samostatné, rýchle vanilla JS; pridanie knižnice rozbije jednotnosť a build-less nasadenie.

## Súbory a miesta

- `server/public/index.html` — kostra appky, poradie `<script>` tagov, inline theme/density bootstrap, favicon (SVG koruna).
- `server/public/styles.css` — všetky tokeny (`:root` + `[data-theme="dark"]`), komponenty (btn, input, panel, stat, tbl, badge, avatar, donut, org tree, drawer, modal, toast, cmdk, empty, skeleton, matrix, block editor), density override, responzíva.
- `server/public/app.js` — UI kit `window.APP`, router (`parseHash/route/detailPage`), auth (`boot/showLogin`), lookups/badges, nav, command palette, skratky, téma/hustota.
- `server/public/views/dashboard.js` — hero + KPI staty + náklady (donut) + „Na doriadenie"; vzor slovenského skloňovania.
- `server/public/views/employees.js` — najúplnejší vzor: zoznam (tabuľka/karty), filtre, sort, bulk bar, detail plná stránka, formulár v modale s `<details>`, block editor, tlačová karta.
- `server/public/views/mailboxes.js` — zoskupovanie podľa oddelenia, typové badge s farebnou bodkou, forward diagram (`fwd-diagram`).
- `server/public/views/positions.js`, `applications.js`, `settings.js` — pozície (náplň), aplikácie (pricing/obnovy), nastavenia (Vzhľad/Firma/Používatelia/Audit v sekciách bez tabov).

## Zdroje

- Kód appky: `C:\Users\Ucet\Desktop\Šperky Aura app\aura-hr-mapa\server\public\` (frontend) a `\server\src\routes\` (API tvary, ktoré view konzumujú).
- Súvisiace Aura skills: `skills/design/ui-design-systems.md` (tokeny, OKLCH, light/dark), `skills/design/ui-motion-transitions.md` (pohyb), `skills/design/brand-graphics.md` (brand koruna, farby).
