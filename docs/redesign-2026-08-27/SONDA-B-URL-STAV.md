# Sonda B — stav v URL a localStorage

Meraci agent, 27. 8. 2026. Vetva `feat/hades-redesign`. **Ziadny produkcny kod
nebol zmeneny** — jediny zapisany subor je tento.

Vsetko nizsie je precitane z kodu k dnesnemu dnu, s cislami riadkov. Kde je
tvrdenie odvodene a nie precitane, je to oznacene slovom **odvodene**.

## 0. Namerany stav v cislach

| Co | Kolko | Ako zmerane |
|---|---|---|
| `localStorage` kluce v repozitari | **21** | `grep -rho "'hades\.[a-zA-Z0-9._]*'" public/js electron resources/views \| sort -u` = 23 retazcov, z toho `hades.ico` je nazov suboru ikony (`electron/assets/build-icon.py`) a `hades.pack` zije len v komentari `public/js/mind/state.js:171` |
| `localStorage.getItem` volani | 22 | `grep -rho "localStorage\.getItem" public/js \| wc -l` |
| `localStorage.setItem` volani | 23 | to iste pre `setItem` |
| `history.pushState` volani | **6** | `mind` 0, `chat` 3, `console` 3, `shared` 0 |
| `history.replaceState` volani | **0** | v celom `public/js` |
| `popstate` listenerov | **4** | `chat` 3, `console` 1, `mind` 0 |
| miest, kde sa cita URL v JS | **1** | `public/js/mind/state.js:87` — `new URLSearchParams(location.search).get('screen')` |
| `sessionStorage` | **0** | nikde |

Zaver z tychto siestich cisel: **appka dnes URL ako nosic stavu nepouziva vobec.**
Jedine, co v URL zije, je identita vlakna (`/chat/<uuid>`, `/console/<uuid>`) a
jeden startovaci parameter (`?screen=`) pre desktop shell. Obrazovka Graf nema
ani jeden `pushState`, ani jeden `popstate` a ani jedno citanie query stringu.

---

## 1. Co dnes zanikne pri obnove stranky

Legenda stlpca **Prezije F5?**:

- **NIE** — po `F5` je hodnota na predvolenej,
- **LS** — prezije, ale z `localStorage` (teda per-prehliadac, nezdielatelne,
  a v druhom tabe toho isteho prehliadaca sa tichom prepisuje),
- **DB** — prezije zo servera,
- **URL** — prezije z adresy.

### 1.1 Plocha `/` — graf a sest obrazoviek dat

| Stav | Kde zije | Prezije F5? | Poznamka |
|---|---|---|---|
| aktivna obrazovka | `S.screen`, `state.js:86-90`, `screens.js:30` | **LS** (`hades.screen`) + `?screen=` ma prednost | Viz pasca §1.5a |
| **zanorenie grafu** `go({level,area,dept,node})` | `S.nav`, `state.js:47-55`, zapis `sim.js:488` | **LS** (`hades.nav`) | Prezije, ale **nezdielatelne** a v druhom tabe sa prepise |
| pohlad siet/vrstvy | `S.gview`, `sim.js:575` | **LS** (`hades.gview`) | |
| **kamera** (`x`,`y`,`k`) | `S.cam`, `state.js:20` | **NIE** | Po F5 sa dorovna na fokusovu skupinu (`_fitOnSettle`) |
| **vybrany uzol / panel detailu** | `S.selected`, `panels.js:27`, `panels.js:391` | **NIE** | Panel je po F5 zavrety, aj keby `nav.node` sedel |
| **lokalny graf** (root + hlbka 1–3) | `S.local`, `filters.js:34-40` | **NIE** | Cip `#local-chip` zmizne, hoci je to plnohodnotny filter |
| **prehravanie casu** (`replay.on/t/playing`) | `S.replay`, `state.js:37` | **NIE** | |
| rezim rucneho prepajania | `S.connectFrom`, `state.js:32` | **NIE** | Spravne — je to gesto, nie stav |
| filter typov / zdrojov / oblasti / znaciek | `S.filter`, `state.js:143-149`, zapis `filters.js:110` | **LS** (`hades.filter`) | |
| filter kategorii vztahov | `S.filter.relations`, `state.js:157-161`, zapis `filters.js:4` | **LS** (`hades.relfilter`) | |
| min. vaha spojeni | `S.minWeight`, `state.js:95`, zapis `controls.js:272` | **LS** (`hades.minWeight3`) | |
| kostra | `S.skeleton`, `state.js:97` | **LS** (`hades.skeleton`) | |
| znacky istoty | `S.certRings`, `state.js:153` | **LS** (`hades.certRings`) | |
| rozsah grafu live/all | `S.graphScope`, `state.js:164`, zapis `pack.js:81` | **LS** (`hades.graphScope`) | |
| vzhlad a pohyb (9 hodnot `S.opts`) | `state.js:120-135` | **LS** (`hades.opts`) | |
| hustota, tema, zvuk | `controls.js:39`, `theme.js:82`, `state.js:38` | **LS** | |
| **dopyt v palete Ctrl+K** | `cmdk.js` (DOM `<input>`) | **NIE** | Spravne |
| **dopyt v hladani znaciek** | `tagQuery`, `tagfilter.js:32` | **NIE** | Spravne |
| **rozbalena sekcia „Pokrocile"** | `<details id="settings-advanced">`, `mind.blade.php:327` | **NIE** | |
| **otvoreny/zavrety dok Charona** | trieda `.open` na `#charon`, `charon.js:229-246` | **NIE** | Nikde sa neuklada |
| vlakno doku Charona | `D.thread`, `charon.js:266,432` | **LS** (`hades.charonThread`) | |
| **vyber uzlov do kontextu** `S.charonCtx` | `charon.js:53,470-478` | **LS** (`hades.charonCtx`) | 8 id, mrtve sa prunuju v `contextIds()` |
| posledne videny Dennik (badge) | `rail.js:44,52` | **LS** (`hades.journal.lastSeen`) | |
| odklikana onboarding karta | `shortcuts.js:226,232` | **LS** (`hades.hints2`) | |

### 1.2 Filtre a hladanie na siestich obrazovkach dat

Vsetko z tohto oddielu zije **len v pamati modulu** a po `F5` je prazdne.
Ziadna z tychto hodnot nema ani `localStorage`, ani URL.

| Obrazovka | Stav | Kde | Server alebo klient? |
|---|---|---|---|
| **Dnes** | ziadny filter | — | — |
| **Dennik** | `journalProject` (kluc projektu, `#bez-projektu` = bez projektu) | `screens/dennik.js:15,67,126` | **server** (`?project=`, `dennik.js:42`) |
| **Dennik** | rozbaleny zoznam cipov nad `JOURNAL_CHIPS_TOP` (8) | `journalChipsOpen`, `dennik.js:78` | klient |
| **Kniznica** | `q` (text) | `libraryState.q`, `kniznica.js:23`, DOM `#library-search` | **server** (`?q=`) |
| **Kniznica** | `areaSlug` (oblast) | `libraryState.areaSlug`, `kniznica.js:23` | **klient** zamerne (`limit => null`, viz komentar `kniznica.js:10-19`) |
| **Rozhodnutia** | `year`, `areaId`, `q` | `decisionsState`, `rozhodnutia.js:30-33`, dopyt `:38-47` | **server** (strop 500) |
| **Rozhodnutia** | rozbaleny dovod karty | len `aria-expanded` v DOM, `rozhodnutia.js:292,406` | klient, zomiera aj pri prekresleni |
| **Runy** | `status`, `model` | `runsState`, `runy.js:20-25`, dopyt `:56-62` | **server** |
| **Runy** | `open` = uuid rozbaleneho behu | `runsState.open`, `runy.js:335-353` | klient + `/api/runs/{uuid}` |
| **Kontrola** | `f.type`, `f.certainty`, `f.area`, `f.q` | `kontrolaState.f`, `kontrola.js:38`, dopyt `:52-62` | **server** (strop stranky 100) |
| **Kontrola** | `limit` (stranka 100, strop 500) | `kontrolaState.limit`, `kontrola.js:26-36` | **server** |
| **Kontrola** | `idx` = pozicia klavesoveho kurzora | `kontrolaState.idx` | klient, spravne netreba |
| **Smernica** | text zadania | DOM `#…-task` input, `smernica.js:72-96` | server pri `runDirectiveBuild()` |
| **Smernica** | `directiveSel` (zaskrtnute node_id) | `smernica.js:24` | klient |

Prakticky dopad: **po `F5` na obrazovke Kontrola s nastavenym filtrom
typ+istota+oblast+text a `limit=300` je clovek spat na prvej stranke celej
fronty bez filtra.** To iste na Rozhodnutiach a Runach.

### 1.3 `/chat`

| Stav | Kde | Prezije F5? |
|---|---|---|
| otvorene vlakno | cesta `/chat/<uuid>`, `run.js:431-433,486,530` | **URL** |
| **aktivna vetva konverzacie** | server `console_threads.active_branch_id`, prepnutie `POST /api/console/branches/{uuid}/activate`, `branches.js:256-281` | **DB** |
| panel vlakien otvoreny/zavrety | `body.dataset.threads`, `main.js:571` | **LS** (`hades.chat.threads`) |
| panel artefaktu otvoreny/zavrety | `body.dataset.artifact`, `main.js:572` | **LS** (`hades.chat.artifact`) |
| sirky oboch panelov | `main.js:164,347` | **LS** (`hades.chat.threadsW/artifactW`) |
| **stav panelov na uzkom okne (<900 px)** | `setPanel(..., remember)`, `main.js:135-140` | **NIE zamerne** — komentar `main.js:120-127` |
| **obsah panela artefaktu** | `artifact.js:363-445` | **NIE** (a viz §1.5c — nema ani producenta) |
| **dopyt a filtre v hladani historie** | `T.query`, `T.filters {role,from,to,thread,project}`, `T.limit`, `threads.js:69-75` | **NIE** |
| rozbalene projekty v paneli | `T.open` (Map), `threads.js:63` | **NIE** |
| rozpisane premenovanie | `T.renaming`, `threads.js:81` | **NIE** (spravne) |
| **strom podagentov rozbaleny?** | `T.open`, `agents.js:69-70` — komentar to priznava: „v ramci stranky, nie v localStorage" | **NIE** |
| rozpracovane prilohy | `A.items`, `attach.js:72-85` | **DB** (`message_id === null`) |
| diktovanie | `V`, `voice.js:44-59` | **NIE** (spravne) |

### 1.4 `/console`

| Stav | Kde | Prezije F5? |
|---|---|---|
| otvorene vlakno | cesta `/console/<uuid>`, `main.js:418,471` | **URL** |
| filter zoznamu vlakien | `listFilter`, `console/main.js:56` | **NIE** |
| stav zoznamu (loading/ready/error) | `listState`, `console/main.js:55` | n/a |
| rozpisane premenovanie | `renaming`, `console/main.js:59` | **NIE** (spravne) |
| tema | cita `hades.theme`, `console/main.js:40` | **LS**, ale **nezapisuje** — viz §1.5b |

### 1.5 Styri pasce, ktore som pri tom nasiel

**a) `?screen=` nie je len citanie — trvale prepisuje ulozenu volbu.**
`state.js:87-89` prijme `?screen=graf`, `main.js:89` zavola `setScreen(S.screen)`
a `screens.js:30` bezpodmienecne zapise `localStorage['hades.screen']`. Kazde
otvorenie desktop shellu (`electron/main.js:96`, `:147`, `bin/hades-app.mjs:202`
posielaju `?screen=…`) teda **prepise clovekovi jeho poslednu obrazovku**. Novy
serializer to musi vyriesit vedome: URL je pohlad, ulozena volba je preferencia,
a jedno nesmie tichom prepisat druhe.

**b) `hades.theme` cita `/`, `/chat` aj `/console`, ale zapisuje ho JEDINE `/`.**
`setTheme()` je len v `mind/theme.js:83`; `chat/main.js:82` a `console/main.js:40`
ho iba citaju a v `chat.blade.php` ani `console.blade.php` nie je ziadny prepinac
temy (`grep -n "theme" resources/views/chat.blade.php` = 0 zasahov). Na `/chat` sa
teda tema **neda prepnut**.

**c) Panel artefaktu nema producenta.** `wireArtifact()` (`artifact.js:494`)
poslucha `chat:artifact`, ale **`document.dispatchEvent(... 'chat:artifact' ...)`
nie je v repozitari ani raz** (`grep -rn "chat:artifact" public/ resources/` = 2
zasahy, oba v `artifact.js`, jeden z nich komentar). Panel sa da otvorit
prepinacom, ale nic doneho nikdy nepride. Dosledok pre zadanie: **„stav artefaktu
v URL" nema dnes co serializovat** — implementacia musi artefaktu najprv dat
identitu. Identita uz existuje na strane dat: `render.js:426` pise
`card.dataset.id = frame.id`, co je `console_tool_calls.id`.

**d) Ziadna stranka nema synchronny zapis temy pred prvym vykreslenim.**
V `mind.blade.php` sa `data-theme` nikde nenastavuje (skripty su na `:572-575`,
vsetky na konci a `main.js` je `type="module"`, teda odlozeny), tema sa nasadzuje
az v `init()` (`mind/main.js:40`). Svetla paleta je pritom v `:root`
(`mind.css:91`) a tmava az v `:root[data-theme="dark"]` (`mind.css:662`).
**Odvodene:** prvy natret stranky je svetly aj pri tmavej teme. Merat to
prehliadacom mi zadanie zakazuje, ale je to cisto z poradia skriptov.

---

## 2. Kazdy `localStorage` kluc

Stlpec **Verdikt** je moj navrh: `LS` = zostava per-prehliadac, `URL` = ma ist do
adresy, `LS+URL` = dvojvrstvove (adresa prebije preferenciu, preferencia je
fallback), `PRYC` = zrusit.

| Kluc | Pise | Cita | Verdikt | Co sa rozbije pri presune do URL |
|---|---|---|---|---|
| `hades.theme` | `mind/theme.js:83` | `mind/theme.js:82`, `chat/main.js:82`, `console/main.js:40` | **LS** | Tema je vlastnost oka a monitora, nie obsahu. V URL by kazdy zdielany odkaz vnucoval prijemcovi cudziu temu, a `?t=light` by sa musel niest cez vsetky tri plochy. Naviac by ju to nezachranilo od bliku (§1.5d) — ten sa lieci synchronnym skriptom v blade, nie nosicom. |
| `hades.density` | `mind/controls.js:48` | `:39` | **LS** | To iste — ergonomia, nie obsah. |
| `hades.screen` | `mind/screens.js:30` | `mind/state.js:89` | **LS+URL** | Presun je nutny (rozhodnutie 8) a rozbije **desktop shell**: tri miesta posielaju `?screen=` (`electron/main.js:96,147`, `bin/hades-app.mjs:202`). Ak sa premenuje na `s`, tie tri miesta treba prepisat, alebo drzat `screen` ako alias na citanie. A treba oddelit „pohlad" od „preferencie" — dnes URL preferenciu prepisuje (§1.5a). |
| `hades.nav` | `mind/sim.js:488` | `mind/state.js:49` | **URL** | Toto je najvacsi zisk celej sondy: zanorenie grafu je dnes nezdielatelne. Rozbije sa: **dva taby**. Dnes je `hades.nav` globalne, takze dva taby si zanorenie prepisuju; po presune do URL bude kazdy tab vlastny — co je oprava, nie regresia. Druha vec: uzol v adrese moze medzitym zmiznut (viz §3.5). |
| `hades.gview` | `mind/sim.js:575` | `mind/state.js:44` | **URL** | Pohlad je cast toho, co clovek vidi. Nic sa nerozbije; hodnota je dvojprvkovy enum. |
| `hades.minWeight3` | `mind/controls.js:272,308` | `mind/state.js:95` | **URL** | Je to filter hran, nie vzhled. Riziko: slider `oninput` — bez debounce by to bol `replaceState` na kazdy pixel tahu (viz §4.3). |
| `hades.skeleton` | `mind/controls.js:252,309` | `mind/state.js:97` | **URL** | — |
| `hades.filter` | `mind/filters.js:110` | `mind/state.js:145` | **URL** | Styri mnoziny. Rozbije sa dlzka URL pri filtri znaciek — znacky su volny text z DB (viz §3.4). |
| `hades.relfilter` | `mind/filters.js:4` | `mind/state.js:159` | **URL** | Zatvoreny slovnik kategorii, bezpecne. |
| `hades.graphScope` | `mind/pack.js:81` | `mind/state.js:164` | **URL** | Pozor: `openNodeFromAnywhere()` (`screens.js:212-227`) rozsiruje scope **sam** a ohlasuje to toastom. Po presune do URL to bude `replaceState` z kodu, nie z gesta cloveka — treba to napisat do zoznamu akcii (§4.2), inak vznikne zaznam v historii, ktory nikto nevyvolal. |
| `hades.certRings` | `mind/tagfilter.js:50` | `mind/state.js:153` | **LS** | Hranicny pripad. Je to kodovanie (prstenec istoty), teda blizsie k vzhledu; do URL by pridal kluc, ktory nikto nezdiela. Nechavam v LS a priznavam to ako rozhodnutie, nie ako fakt. |
| `hades.opts` (9 hodnot) | `mind/controls.js:287,307`, `mind/util.js:14` | `mind/state.js:135` | **LS** | 9 cisel = najdlhsi mozny prispevok do URL za najmensiu zdielatelnu hodnotu. Vzhled a intenzita pohybu. |
| `hades.sound` | `mind/controls.js:364` | `mind/state.js:38` | **LS** | — |
| `hades.charonThread` | `mind/charon.js:432` | `:266` | **LS** | Vlakno doku je „kde som prestal", nie „co ti posielam". Keby bolo v URL, kazdy odkaz na graf by prijemcu posadil do cudzej konverzacie. |
| `hades.charonCtx` | `mind/charon.js:477` | `:470` | **LS** | **Zamerne NIE do URL.** Je to az 8 `node_id`, ktore idu na server ako `context_node_ids` a stanu sa **vstupom do behu modelu** (`ContextBlock`). Adresa, ktora predplni kontext modelu, je mala injekcna plocha na ceste, ktora je verejne tunelovana cez ngrok — a nic sa tym nezisk, lebo `contextIds()` mrtve id aj tak prunuje. Zostava v LS. |
| `hades.journal.lastSeen` | `mind/rail.js:44` | `:52` | **LS** | Per-prehliadac zo svojej podstaty (badge „nove od tvojej poslednej navstevy"). |
| `hades.hints2` | `mind/shortcuts.js:232` | `:226` | **LS** | To iste. |
| `hades.chat.threads` | `chat/main.js:129` | `:571` | **LS+URL** | Rozhodnutie 8 to chce v URL. Rozbije sa **default**: dnes je „otvoreny, ak nie je ulozene `off`". Po presune neplati „chybajuci kluc = default plochy", ale „chybajuci kluc = **moja** preferencia" — viz §3.6. A na uzkom okne sa stav zamerne nepamata (`main.js:120-127,135-140`), takze tam sa kluc nesmie ani citat, ani pisat. |
| `hades.chat.artifact` | `chat/main.js:129` | `:572` | **LS+URL** | To iste. |
| `hades.chat.threadsW` | `chat/main.js:164` | `:347` | **LS** | Sirka v px je ergonomia monitora. A tahanie gripu by bez debounce znamenalo `replaceState` na kazdy `pointermove`. |
| `hades.chat.artifactW` | `chat/main.js:164` | `:347` | **LS** | To iste. |

Dva kluce, ktore v zozname zamerne nie su:

- **`hades.pack`** — mrtvy. Zije len v komentari `state.js:171`, ktory vysvetluje,
  ze sa **nemigruje**. Zadny kod ho necita. Nechat tak (komentar je zaznam
  rozhodnutia, nie kod).
- **`hades.ico`** — nie je `localStorage` kluc, je to nazov suboru
  (`electron/assets/hades.ico`). Do zoznamu sa dostal len tym, ze zacina na
  `hades.`. Uvadzam to preto, aby to niekto nepocital ako 22. kluc.

---

## 3. Navrh schemy URL

### 3.1 Kde schema zije

Rozhodnutie 8 zada „jedno miesto serializuje aj deserializuje". Navrh, ktory to
splna a zaroven nevytvara modul, ktory importuje obe appky:

- `public/js/shared/urlstate.js` — **mechanika**: citanie `location.search`,
  zapis (push/replace), vynechavanie defaultov, `popstate`, rezervovane nazvy,
  koalescencia zapisov v ramci jedneho framu. Nevie nic o Hadesovi.
- `public/js/mind/urlschema.js` a `public/js/chat/urlschema.js` — **tabulka
  schemy** pre svoju plochu: pre kazdy kluc jeho nazov, default, `parse`,
  `serialize` a `apply`. Toto je to „jedno miesto" — pre dany kluc neexistuje
  druhe.

Vsetky exporty **hoistovane `export function`** (grafy modulov oboch ploch su
cyklicke). `urlstate.js` sa v `mind` musi nacitat **pred** `state.js`, pretoze
`state.js` cita startovy stav pri vyhodnoteni modulu (`state.js:44,47,86,95,…`)
— alebo, cistejsie, `state.js` prestane citat startovy stav sam a dostane ho.
To je nevratna zmena tvaru `state.js`, teda **rozhodnutie pre koordinatora**.

### 3.2 Rezervovane nazvy — nepouzivat ako kluc schemy

| Nazov | Kto ho pouziva | Preco je rezervovany |
|---|---|---|
| `token` | `AuthenticateUi::tokenFromRequest()`, `app/Http/Middleware/AuthenticateUi.php:96-102` | Jednorazove odomknutie. Middleware ho po odomknuti **sam odstrihne redirectom** (`:76`) a ostatne query parametre pritom **zachova** (`urlWithoutToken()`, `:104+`) — schema je s tym teda kompatibilna. |
| `k` | `bin/hades-app.mjs:84,109,119,202` | Jednorazovy kluc lokalneho proxy (`crypto.randomBytes(16)`). Proxy ho pred preposlanim maze (`:119`) a dalej mu staci cookie (`:143`), **ale v adresnom riadku prehliadaca zostane**. Kluc schemy s nazvom `k` by kolidoval s tajomstvom. |
| `screen` | legacy, `mind/state.js:87` | Prijimat na citanie ako alias `s`, nikdy nezapisovat. |

**Dosledok, ktory je treba schvalit:** serializer prestavia query string z tabulky
schemy, takze **neznamy parameter z adresy zmizne** pri prvom `replaceState`.
Pre `token` a `k` je to hygiena (obe su tajomstva v URL a obe uz maju druhu cestu
— session cookie), pre cudzie parametre je to strata. Navrh: **`token` a `k`
zahodit, kazdy iny neznamy kluc ponechat nedotknuty** (prenest bez interpretacie).
Tak sa neznamy parameter nestrati a tajomstvo v adrese neprezije.

### 3.3 Konvencie

1. **Kratke kluce**, 1–3 znaky, mala pismena (rozhodnutie 8).
2. **Default sa vynechava.** Cisty stav = `/` bez query stringu.
3. **Poradie klucov je pevne** (poradie riadkov v tabulke schemy), nie poradie
   zmien. Bez toho by ten isty stav dal dve rozne URL a `replaceState` by
   „menil" adresu bez zmeny stavu.
4. **Mnoziny sa serializuju opakovanym klucom** (`ty=memory&ty=project`,
   citanie `getAll`), **nie oddelovacom**. Dovod je merany, nie estetika:
   `S.filter.tags` obsahuje znacky z DB, teda volny text, ktory moze obsahovat
   ciarku aj bodkociarku; s oddelovacom by sa musel escapovat a `URLSearchParams`
   zakodovala ciarku na `%2C`, takze „kratke a citatelne" by prestalo platit.
   Jedna konvencia pre vsetky mnoziny je lepsia nez dve.
5. **Hodnoty mnozin sa radia** (`localeCompare` pre text, numericky pre id).
   Ten isty stav → ta ista URL.
6. **Prepinace su `1` / `0`** a serializuju sa len v nedefaultnej hodnote.

### 3.4 Skupina A — obrazovka a zanorenie grafu (plocha `/`)

| Kluc | Nesie | Typ | Default (vynechava sa) |
|---|---|---|---|
| `s` | aktivna obrazovka | enum z `SCREENS` (`screens.js:23`) | `dnes` |
| `a` | zanorenie: oblast | int `area_id` | chyba = nie je zanorene do oblasti |
| `d` | zanorenie: oddelenie | int `department_id` | chyba |
| `n` | zanorenie: uzol | int `node_id` | chyba |
| `v` | pohlad | `layers` | `net` |
| `sc` | rozsah grafu | `all` | `live` |
| `sel` | otvoreny panel detailu uzla | int `node_id` | chyba = panel zavrety |
| `lg` | lokalny graf | `<rootId>.<depth>`, napr. `793.2` | chyba = vypnuty |

**`level` sa do URL nedava a je to dolezite.** `clampNav()` (`sim.js:68-89`) uz
uroven **dopocita**: z `node` doplni `dept` a `area` (`:74-78`), z `dept` doplni
`area` (`:79`), a ak najhlbsi kus neexistuje, spadne o uroven vyssie
(`:81-83`). Presnost najhlbsieho pritomneho kluca teda uroven urcuje uplne.
`?n=793` je platny a uplny odkaz na uroven uzla; `?a=2` na uroven oblasti.
Piaty kluc `level` by bol druha pravda o tom istom a dal by sa dostat do rozporu
(`level=map&n=793`).

**`sel` vs `n` nie je duplicita.** `n` je **filter** (ostatok scény stmavne na
`DIM_CTX`), `sel` je **otvoreny panel** (`S.selected`, `panels.js:27`). Dnes to
vie nastat nezavisle: klik na uzol v paneli suseda ho vyberie bez zanorenia.
Ak koordinator chce sietku uzsiu, `sel` sa da vynechat a panel nechat mimo URL
— je to **otvorena otazka**, lebo rozhodnutie 8 pomenuvava „stav panelov" len
pri `/chat`.

Filtre grafu (patria do skupiny A, lebo urcuju, co je na platne vidiet):

| Kluc | Nesie | Typ | Default |
|---|---|---|---|
| `ht` | skryte typy uzlov | mnozina (`S.filter.types`) | prazdna |
| `hs` | skryte zdroje | mnozina (`S.filter.sources`) | prazdna |
| `ha` | skryte oblasti | mnozina int (`S.filter.areas`) | prazdna |
| `tg` | **vybrane** znacky (pozitivny filter) | mnozina textu (`S.filter.tags`) | prazdna |
| `hr` | skryte kategorie vztahov | mnozina (`S.filter.relations`) | prazdna |
| `mw` | min. vaha spojeni | desatinne, 1 miesto | `0` |
| `sk` | kostra | `1` | `0` |

Priznana slabina `tg`: pri desiatich vybranych znackach je to desat opakovanych
klucov s percentualnym kodovanim diakritiky. Nie je to krasne, ale je to jediny
tvar, ktory nemoze klamat. **Ak sa ukaze prilis dlhy, spravna reakcia je strop na
pocet znaciek v URL s priznanym skratenim, nie base64 balik** — zabalene JSON v
query stringu je presne to, co odkaz robi nezdielatelnym a nedebugovatelnym.

### 3.5 Skupina B — filtre a hladanie siestich obrazoviek dat

**Kluce filtrov su scopnute klucom `s`.** Naraz je aktivna jedna obrazovka,
takze `q` vzdy znamena „hladanie na aktivnej obrazovke" a nemusi sa menovat
`kontrola_q`. Dosledok, ktory MUSI byt v implementacii: **prepnutie obrazovky
zmaze vsetky kluce skupiny B**, inak `?s=runy&y=2026` prenesie rok z Rozhodnuti
na Runy. Prepnutie obrazovky je preto jedna atomicka zmena URL, nie dve.

| Obrazovka | Kluc | Nesie | Typ | Default |
|---|---|---|---|---|
| Dnes | — | ziadny filter | | |
| Dennik | `pr` | kluc projektu | text (`#bez-projektu` sa zakoduje na `%23bez-projektu`) | chyba = vsetko |
| Kniznica | `q` | text hladania (server) | text | prazdny |
| Kniznica | `ar` | oblast | **slug** (`libraryState.areaSlug`) | chyba |
| Rozhodnutia | `q` | text (server) | text | prazdny |
| Rozhodnutia | `y` | rok | int | chyba |
| Rozhodnutia | `ar` | oblast | **int id** (`decisionsState.areaId`) | chyba |
| Runy | `st` | stav behu | enum `STATUS_ORDER` (`runy.js:36`) | chyba |
| Runy | `md` | model | text | chyba |
| Runy | `r` | rozbaleny beh | uuid | chyba |
| Kontrola | `q` | text (server) | text | prazdny |
| Kontrola | `ty` | typ uzla | enum | prazdny |
| Kontrola | `ce` | istota | enum `CERT_META` | prazdny |
| Kontrola | `ar` | oblast | ako to posiela server (`kontrola.js:59`) | prazdny |
| Kontrola | `lim` | strop stranky | int, 100–500 | `100` (`KONTROLA_PAGE`) |
| Smernica | `t` | text zadania | text | prazdny |

Dve veci na tejto tabulke, ktore treba priznat, nie schovat:

- **`ar` ma na troch obrazovkach tri rozne typy** (slug / int / serverovy tvar
  Kontroly). Je to prijatelne, pretoze typ urcuje `s`, ale musi to byt v tabulke
  schemy zapisane pri kluci, nie odvodene z kontextu. Alternativa (tri rozne
  kluce) je dlhsia a rozhodnutie 8 chce kratke.
- **`t` na Smernici je jediny kluc, ktory nesie pracovny text cloveka.**
  Playbook „Search, navigation + discovery" (uzol 169, oddiel 2) hovori „URL
  neobsahuje secret alebo citlivy raw query bez schvalenej potreby" a appka je
  verejne tunelovana cez ngrok, takze text zadania skonci v access logu Caddy.
  Navrh: `t` serializovat **az po spusteni skladania** (nikdy pri pisani), a
  napisat to do manualu znacky ako vedomu vynimku. Ak to koordinator nechce,
  `t` z URL vypadne a Smernica ostane jedina obrazovka bez deep linku.

### 3.6 Skupina C — vetva konverzacie (`/chat`)

Cesta zostava: `/chat/<uuid>` je **kanonicka adresa vlakna** a nemeni sa (uz to
tak funguje, `run.js:486`, route `routes/web.php:54` s `where uuid`).

| Kluc | Nesie | Typ | Default |
|---|---|---|---|
| `b` | aktivna vetva | **uuid vetvy** | chyba = `console_threads.active_branch_id` zo servera |

**Poradove cislo („Vetva 2") sa do URL nesmie dostat.** Je to slovo tejto plochy
nad `ORDER BY id` (komentar `branches.js:22-26`), takze zmazanim jednej vetvy by
sa vsetky ulozene odkazy tichom presunuli na inu vetvu. Uuid je kanonicka
identita (playbook, oddiel 2: „Canonical URL prezije premenovanie labelu").

**Kto vyhrava, ked sa URL a server nezhoduju** — toto je bezpecnostne relevantne
a musi byt napisane, nie odvodene:

1. Pri otvoreni: `b` v URL → zavolaj `POST /branches/{b}/activate` (existujuca
   cesta, `branches.js:257`) a az potom `loadThread()`. Bez `b` → server rozhoduje
   a `b` sa do URL **nezapisuje** (cista URL pri cistom stave).
2. `b` s neznamym uuid → server odpovie chybou, plocha **ostane na serverovej
   vetve**, kluc z URL sa odstrihne `replaceState`om a povie sa to jednou vetou.
   Nikdy nie prazdna obrazovka.
3. **Beh cita vetvu vzdy zo servera, nikdy z URL.** `AgentRunner::history()` ide
   cez `branchMessages()` (CLAUDE.md, oddiel Vetvenie) a `console_threads` je
   jediny zdroj toho, ktora vetva je aktivna. URL je **poziadavka o pohlad**,
   ktora vetvu aktivuje; nie je to druhy kanal do modelu.
4. Znamy dosledok, ktory sa presunom nezhorsi ani nezlepsi: dva taby na tom istom
   vlakne na roznych vetvach si `active_branch_id` prepisu. Dnes to plati tiez.
   Riesit to nie je uloha tohto redizajnu — **len to nesmie prestat byt pravda**,
   ze zapis do modelu ide zo servera.

Hladanie v historii vlakien (`T.query`, `T.filters`, `T.limit`, `threads.js:69-75`)
navrhujem **nechat v pamati**. Je to gesto „najdi a skoc", nie stav plochy — a
ciel toho gesta, teda vlakno, v URL uz je. Rozhodnutie 8 hovori „filtre +
hladanie" do URL, ale bolo formulovane nad siestimi obrazovkami dat; toto je
**otvorena otazka**.

### 3.7 Skupina D — panely a artefakt (`/chat`)

| Kluc | Nesie | Typ | Default |
|---|---|---|---|
| `tp` | panel vlakien | `1` / `0` | chyba = ulozena preferencia (`hades.chat.threads`), a ak nie je, otvoreny |
| `ap` | panel artefaktu | `1` / `0` | chyba = ulozena preferencia (`hades.chat.artifact`), a ak nie je, zavrety |
| `art` | otvoreny artefakt | int `console_tool_calls.id` | chyba = panel prazdny |

**Default tu nie je konstanta, ale dvojvrstvovy** a je to nutne:

- kluc chyba → **preferencia cloveka** z `localStorage`,
- kluc je → **explicitny prikaz z odkazu**, prebije preferenciu,
- prepnutie panela zapise **oboje** (URL aj `localStorage`).

Bez tejto dvojvrstvy by kazdy odkaz na `/chat` vnucoval prijemcovi cudzie
rozlozenie, alebo by naopak nikdy nesiel poslat „pozri sa na tento artefakt
s otvorenym panelom". Dosledok, ktory treba napisat do manualu: **„cista URL"
tu neznamena „predvolene rozlozenie", ale „moje rozlozenie".**

**Na uzkom okne (<900 px, `NARROW` v `chat/main.js:68`) sa `tp` a `ap` ani
necitaju, ani nepisu.** Dnesny kod stav prekryvu zamerne nepamata
(`main.js:120-127`, `:135-140`) a URL by to obchádzala: odkaz otvoreny na uzkom
okne by pripichnul prekryv, ktory si clovek nikdy nevybral. Rovnaka pravda musi
platit pre oba nosice.

**`art` sa da implementovat az potom, co artefakt dostane producenta** (§1.5c).
Identita je `console_tool_calls.id` — server ju uz posiela a `render.js:426` ju
uz pise do DOM (`card.dataset.id`). Cesta pri obnove: `art=<id>` → dohladaj kartu
nastroja v uz nacitanom vlakne → `artifactFromTool(call)`. Ked karta v tomto
vlakne nie je (iny beh, zmazana sprava), `art` sa odstrihne a panel ostane
prazdny — nie chybovy.

### 3.8 Neplatny stav v URL — jedno pravidlo pre vsetko

Playbook, uzol 169, oddiel 5: *„Unknown/old parameter ma deterministic migration
alebo safe rejection."* A oddiel 10: *„Nezobrazuj ,0 vysledkov' pri network error
ani permission failure."*

Pravidlo pre Hadesa, jedno pre vsetky kluce:

1. **Neplatna hodnota sa zahodi ticho a URL sa opravi `replaceState`om.**
   Adresa po nacitani musi opisovat to, co je na obrazovke — inak sa da `F5`
   dostat do ineho stavu nez z odkazu.
2. **Chybajuci objekt sa neignoruje ticho, ale sa nehlasi ako chyba.** Konkretne:
   - `n` / `d` / `a` ukazuju na uzol, ktory zmizol → `clampNav()` uz to riesi
     spravne: **spadne o uroven vyssie** (`sim.js:81-83`). Toto sa **neprepisuje**,
     len sa mu daju vstupy z URL. Jedna veta v `#breadcrumb`: „Uzol z odkazu uz
     v pamati nie je — si na urovni oblasti."
   - `sel` na neexistujuci uzol → panel sa neotvori, kluc sa odstrihne, ticho
     (panel nic netvrdil).
   - `r` / `art` na neexistujuci beh / volanie → nic sa nerozbali, kluc sa
     odstrihne, ticho.
   - `b` na neznamu vetvu → §3.6 bod 2, jedna veta.
   - `ar` / `y` / `st` / `md` na hodnotu, ktora v odpovedi servera nie je → uz
     dnes existuje spravna mechanika a treba ju pouzit, nie napisat druhu:
     `pruneLibraryArea()` (`kniznica.js:114`), `pruneDecisionFilters()`
     (`rozhodnutia.js:97`), `pruneRunFilters()` (`runy.js:66`). Vsetky tri robia
     to iste: **filter, ktory
     nema co ukazat, sa zrusi, aby obrazovka nebola prazdna BEZ cipu, ktorym sa
     to vypina.** Po zruseni sa kluc odstrihne z URL.
   - `q` / `t` nemaju „neplatnu" hodnotu — text je text. Prazdny vysledok je
     prazdny vysledok a existujuce prazdne stavy uz to hovoria.
3. **Cislo, ktore nie je cislo** (`?a=abc`) → ako chybajuce. `+t.area` v
   `clampNav()` da `NaN`, `S.areas.has(NaN)` je `false`, teda uz dnes spadne na
   `map` — ale to je nahoda, nie kontrakt, takze parser schemy ma vratit `null`
   uz pri parsovani.
4. **Nikdy toast pri obnove stranky.** Toast pri kazdom `F5` je sum. Neplatny
   stav sa hlasi tam, kde by clovek cakal obsah (breadcrumb, prazdny stav karty),
   nie plavajucou bublinou.

---

## 4. Historia — presny zoznam akcii

### 4.1 Co uz s `history` API robi kod dnes (aby nevznikli dve pravdy)

| Miesto | Co robi |
|---|---|
| `chat/run.js:486` | `pushState` na `/chat/<uuid>` pri `applyThread()`, len ak sa cesta lisi |
| `chat/run.js:530` | `pushState` na `/chat/<uuid>` pri `newThread()` |
| `chat/threads.js:434-435` | `pushState` na `/chat` + **rucne vystreleny `PopStateEvent`** (zavretie vlakna) |
| `chat/run.js:428` | `popstate` → `openInitial(uuidFromPath())` |
| `chat/branches.js:514-516` | `popstate` → ak je cesta `/chat` bez uuid, `loadBranches('')` |
| `chat/threads.js:1373` | `popstate` → obnova zoznamu vlakien |
| `console/main.js:233` | `pushState` na `/console` (zmazane aktivne vlakno) |
| `console/main.js:418` | `pushState` na `/console/<uuid>` v `openThread()` |
| `console/main.js:471` | `pushState` na `/console/<uuid>` pri novom vlakne |
| `console/main.js:550-554` | `popstate` → `openThread()` alebo prazdny stav |
| `mind/screens/runy.js:377` | `window.location.href = '/console/' + j.thread` — **cely reload**, medziplochovy skok |
| `mind/*` | **nic** |

Dve veci z toho su zavazne pre implementaciu:

- **`chat/threads.js:435` vystreluje `PopStateEvent` rucne.** Novy serializer,
  ktory bude na `popstate` visiet, dostane teda aj tento **synteticky** event.
  Ak by na nom zacal citat URL a prekreslovat, prebehne to spravne (URL je uz
  prepisana o riadok vyssie) — ale je to zavislost na poradi dvoch riadkov v
  cudzom module. **Cistejsie:** serializer ma vlastnu funkciu „prejdi na tento
  stav" a `threads.js` ju zavola namiesto dvojice `pushState` + synteticky event.
  Je to zmena v cudzom module, teda **rozhodnutie pre koordinatora** (diff v §6).
- **Traja `popstate` odberatelia na `/chat`** (run, branches, threads) uz teraz
  citaju URL kazdy sam. Po zavedeni serializera musi byt **jeden** odberatel,
  ktory prelozi URL na stav a rozposle to udalostami (`chat:*`), inak vzniknu
  styri pravdy o tom, co adresa znamena.

### 4.2 Plocha `/` — akcia → `push` alebo `replace`

Pravidlo rozhodnutia 9 v jednej vete: **`push` = zmenil som, na co sa pozeram;
`replace` = zmenil som, ako sa na to pozeram.**

| Akcia | Kde v kode | `push` / `replace` | Efekt a riziko |
|---|---|---|---|
| klik na rail / `setScreen()` | `controls.js:160`, `shortcuts.js:185-186`, `cmdk.js:150` | **push** | Spat sa vrati na predchadzajucu obrazovku. Musi **atomicky zmazat kluce skupiny B** (§3.5) — inac sa filter prenesie. |
| zanorenie klikom (`goInto`) | `sim.js:540-557` | **push** | Hlavny zisk: Spat = o uroven von. |
| `#btn-up` / `goUp()` | `sim.js:525-532` | **push** | Je to navigacia. Pozor na dojem: Spat po `goUp()` ide **zase dovnutra**, co je spravne, aj ked prekvapive. |
| `Esc` / `clearFilter()` | `sim.js:534-537` | **push** | Zrusenie zanorenia je vyznamovy krok. |
| skok na uzol z hladania / palety (`openNodeFromAnywhere`) | `screens.js:185-228` | **push** (jeden zaznam) | Meni obrazovku **aj** zanorenie **aj** `sel` **aj** mozno `sc` (rozsirenie rozsahu, `:212-227`). Musi to byt **jeden** `pushState`, nie styri — inak jeden preklik zaplni historiu styrmi zaznamami. |
| automaticke rozsirenie rozsahu na `all` | `screens.js:217` | **replace** (v ramci toho jedneho push vyssie) | Nevyvolal to clovek gestom „zmen rozsah", je to dosledok. Ako samostatny `push` by bol zaznam v historii, ktory nikto neurobil. |
| prepnutie pohladu Siet / Vrstvy (`setView`) | `sim.js:571-585`, klavesa `V` | **push** | Je to zmena toho, na co sa clovek pozera. |
| prepnutie rozsahu live / all rucne | `pack.js` `setGraphScope()` | **push** | Meni, kolko siete je na platne. |
| zmena filtra typov / zdrojov / oblasti / vztahov | `controls.js`, `filters.js` | **replace** | Rozhodnutie 9. Riziko: 5 cipov = 5 `replaceState` — bez koalescencie do jedneho framu je to 5 zapisov namiesto jedneho. |
| filter znaciek (klik na znacku) | `tagfilter.js` | **replace** | To iste. |
| slider min. vahy (`oninput`) | `controls.js:272` | **replace, debounce 200 ms** | `oninput` na slideri strieľa desiatky krat za sekundu. Bez debounce to je desiatky zapisov do historie za jeden tah. |
| prepinac kostry | `controls.js:252` | **replace** | |
| predvolba zobrazenia / „Obnovit predvolene" | `controls.js:283-317` | **replace** | Meni `mw`, `sk` aj `S.opts` naraz → **jeden** zapis. |
| tahanie uzla, pan, zoom, pinch | `interaction.js` | **nic** | Kamera do URL nepatri: force layout je zivy, takze ta ista kamera nad ineho usadenou scenou zabera iny vyrez. Zapisovat ju by bola lož. |
| otvorenie panela detailu uzla (`selectNode`) | `panels.js:23-27` | **replace** | Ak sa `sel` vobec zavedie (§3.4). `push` by z kazdeho klikania po susedoch spravil desiatky zaznamov. |
| zavretie panela detailu | `panels.js:391` | **replace** | |
| lokalny graf zap / vyp / hlbka | `filters.js:34-49` | **replace** | Je to filter. |
| otvorenie / zavretie doku Charona | `charon.js:229-252` | **nic** | Nie je to dnes ani v `localStorage` a rozhodnutie 8 dok nepomenuvava. |
| pridanie / odobranie uzla z kontextu doku | `charon.js:474-479` | **nic** | §2, zostava v `localStorage`. |
| prepnutie temy / hustoty / zvuku | `theme.js:83`, `controls.js:48,364` | **nic** | Zostava v `localStorage`. |
| prehravanie casu (`replay`) | `render.js:1728-1734` | **nic** | Je to prehravanie, nie stav. `replace` na kazdy frame by bol najhorsi mozny zapis. |

### 4.3 Plocha `/` — obrazovky dat

| Akcia | `push` / `replace` |
|---|---|
| pisanie do hladania (Kniznica, Rozhodnutia, Kontrola) | **replace**, debounce **220 ms** — ta ista hodnota, aku uz pouziva filtrovanie Kniznice (`kniznica.js:79` komentar) |
| klik na cip filtra (projekt, rok, oblast, stav, model, typ, istota) | **replace** |
| „Nacitat dalsich" (Kontrola, `lim`) | **replace** |
| rozbalenie behu (Runy, `r`) | **replace** |
| rozbalenie dovodu rozhodnutia | **nic** (dnes to nie je ani v stave modulu) |
| spustenie skladania Smernice (`t`) | **replace** |
| klik na zaznam → detail uzla na mieste (`openNodeDetail`) | **replace** — overlay je citacka, `md.js` uz riesi vratenie fokusu |
| klik na zaznam → **skok na Graf** (`openNodeFromAnywhere`) | **push**, jeden zaznam (§4.2) |

Dva `replace` z tejto tabulky su hranicne a chcem ich priznat: **„Nacitat
dalsich"** a **rozbalenie behu** by sa dali obhajit aj ako `push`. Volim `replace`,
pretoze Spat po „Nacitat dalsich" by odloadovalo prave nacitane riadky, co
vyzera ako chyba, a rozbalenie karty je citanie, nie navigacia.

### 4.4 `/chat`

| Akcia | Dnes | Navrh |
|---|---|---|
| otvorenie vlakna zo zoznamu | `pushState` `run.js:486` | **push** — zachovat |
| nove vlakno | `pushState` `run.js:530` | **push** — zachovat |
| zavretie vlakna (`/chat`) | `pushState` + synteticky `popstate`, `threads.js:434-435` | **push**, ale bez synteticheho eventu (§4.1) |
| **prepnutie vetvy** | `POST activate` + `loadThread()`, ziadna zmena URL | **push** + `b` do URL. Je to zmena toho, ktora polovica konverzacie odpoveda — presne to, na co ma Spat fungovat. |
| otvorenie / zavretie panela vlakien alebo artefaktu | `localStorage`, `main.js:129` | **replace** — je to rozlozenie, nie navigacia |
| tahanie sirky panela | `localStorage`, `main.js:164` | **nic** (zostava v `localStorage`) |
| otvorenie artefaktu klikom na kartu nastroja | dnes ziadny producent | **replace** — `art` |
| zavretie / vypratanie artefaktu | `clearArtifact()`, `artifact.js:445` | **replace** |
| pisanie v hladani historie | `T.query`, `threads.js` | **nic** (§3.6) |
| rozbalenie projektu v paneli | `T.open` | **nic** |
| rozbalenie stromu podagentov | `T.open`, `agents.js:69` | **nic** |

### 4.5 `/console`

Konzola je technicka plocha a **nie je v poradi rozhodnutia 10**. Navrh: jej tri
`pushState` a jeden `popstate` **nechat presne tak, ako su**, a serializer sem
nezavadzat. Filter zoznamu vlakien (`listFilter`, `console/main.js:56`) zostava
v pamati. Dovod: kazdy kluc pridany na `/console` je kluc, ktory sa musi drzat
v synchronizacii s `/chat`, a `/console` je jedina plocha, ktoru nikto nezdiela
odkazom.

---

## 5. Referencne appky — konkretne vzory

Ku kazdemu vzoru je verdikt **pouzitelnosti bez build stepu a bez frameworku**
(Hades je vanilla ES moduly, `public/js` nema bundler a CDN je zakazana).

### 5.1 Linear

| Vzor | Co presne robi | Pouzitelne vo vanilla? |
|---|---|---|
| **URL nesie len „hlavne" filtre; view options, quick filters a Insights filtre v nej nie su** | Linear vedome deli filter na „to, co definuje mnozinu" a „to, co definuje zobrazenie" — a do URL da len prve | **ANO, a je to presne moje delenie A/vzhled v §2.** Toto je najhodnotnejsi jediny vzor z celeho oddielu 5: dava jazyk na to, preco `mw` ide do URL a `labelSize` nie. |
| **Filter v URL je „temporary" — zdielanie odkazu neudeluje pristup** | URL nesie stav, nie opravnenie | **ANO.** Pre Hadesa: `?ar=…` nesmie obchadzat `auth.ui`. Uz plati (middleware bezi pred view), ale je dobre to mat napisane. |
| **Ulozene pohlady (`Save view`, Alt+V) su druhy mechanizmus vedla URL** | Trvale pomenovanie filtra, nie dlha adresa | **ANO, ale nenavrhujem to teraz.** Hades uz ma analogicky mechanizmus dvakrat: predvolby zobrazenia (`PRESETS`, `controls.js`) a ulozene smernice (`/api/directives`). Tretia instancia by bola nova plocha, nie URL sonda. |

### 5.2 Notion

| Vzor | Co presne robi | Pouzitelne vo vanilla? |
|---|---|---|
| **Tri urovne identity v jednej adrese: `…/<databaseId>?v=<viewId>&p=<pageId>`** | `v` = ktory pohlad, `p` = ktora stranka je otvorena „nad" nim | **ANO, a je to priamy vzor pre `/chat`:** cesta = vlakno (`databaseId`), `b` = vetva (`v`), `art` = otvoreny artefakt (`p`). To iste na grafe: `a`/`d`/`n` = pohlad, `sel` = co je otvorene nad nim. Potvrdzuje, ze `sel` vedla `n` nie je duplicita, ale dve rozne urovne. |
| **Otvoreny „peek" panel je v URL vlastnym klucom, nie sucastou identity stranky** | Zavretim panela zmizne `p`, stranka zostane | **ANO.** Presne to robi `art` a `sel`. |
| Hashovane id v ceste | `pageId` je 32 hex bez pomlciek | **NIE prebierat.** Hades ma uuid s pomlckami vo `where` route (`routes/web.php:55`) a v DB; skratenie by bola migracia bez citatela. |

### 5.3 Obsidian

| Vzor | Co presne robi | Pouzitelne vo vanilla? |
|---|---|---|
| **Rozlozenie okien = pomenovany „workspace", nie adresa** | Obsidian ma `workspaces.json` a URI `obsidian://adv-uri?workspace=…`; layout sa uklada pod menom, adresa na neho len odkazuje | **ANO ako protivaha.** Toto je argument, aby sirky panelov (`threadsW`, `artifactW`) a `S.opts` do URL **nesli**: aj appka, ktora ma na deep linky celu vrstvu, drzi layout ako pomenovany stav, nie ako query string. |
| **Deep link ma cielovu granularitu: subor → nadpis → blok → riadok** | `obsidian://adv-uri?filepath=…&heading=…&block=…` | **ANO, ciastocne.** Analogia pre Hadesa je `n` (uzol) vs `sel` (otvoreny detail) vs — do buducnosti — kotva v `.md` citacke. Kotva do citacky **teraz nenavrhujem**, `md.js` na to nema anchor. |
| **URI vie aj vykonat prikaz** (`?commandid=…`) | Adresa ako spustac akcie | **NIE.** V Hadesovi by adresa, ktora spusta akciu, bola cesta okolo dvojfazovej brany. Zakazane kontraktom, nenavrhujem ani v citacej podobe. |
| Filtre graph view zije v nastaveniach pohladu, nie v URL | Obsidian graf nema deep link na filter | **Nepreberat** — Hades to ma robit lepsie, to je cely zmysel rozhodnutia 8. |

### 5.4 Claude

| Vzor | Co presne robi | Pouzitelne vo vanilla? |
|---|---|---|
| **Konverzacia je cesta, nie query: `claude.ai/chat/<uuid>`** | uuid v ceste, nie `?id=` | **ANO — uz to tak je** (`/chat/<uuid>`, `/console/<uuid>`). Potvrdenie, ze identitu nemam presuvat do query stringu. |
| **Publikovany artefakt ma vlastnu adresu (`/public/artifacts/<uuid>`), otvoreny artefakt v paneli nie** | Identita zdielaneho artefaktu ≠ stav panela | **ANO, a je to hranica pre `art`.** `art` nesie **ktory** artefakt je otvoreny v paneli tohto vlakna; nie je to publikovana adresa artefaktu a nesmie sa tak tvarit. |
| Prepinac Preview / Code v paneli nie je v URL | Sub-stav panela zostava v pamati | **ANO.** Pre Hadesa: zalozky v `showFile()` (`artifact.js:282-340`) do URL nepatria. |
| `?shared=<uuid>` ako samostatny kluc pre zdielanu instanciu | | **NIE** — Hades nema zdielanie tretim stranam. |

### 5.5 Vseobecny vzor, ktory nesie mechaniku (nie appka, ale zdroj)

Z clanku *„Your URL Is Your State"* (Ahmad Alfy, 10/2025) — vsetko vanilla,
vsetko pouzitelne:

- **Defaulty sa riesia v kode, nie v URL:** `params.get('theme') || 'light'`.
  Zhoduje sa s rozhodnutim 8.
- **`pushState` pre vyznamove kroky, `replaceState` pre dolaďovanie a
  search-as-you-type.** Doslovne to iste ako rozhodnutie 9.
- **Neencoduj base64 JSON balik do query.** „Je to znak, ze tvoja struktura je
  prilis komplexna." Toto je priama namietka proti pokuseniu zabalit
  `S.filter` do jedneho kluca — a duvod, preco §3.3 bod 4 vola po opakovanych
  klucoch.
- **Mechanika je 6 riadkov** `URLSearchParams` + `history.pushState` +
  `popstate`. Ziadna kniznica.

**Jeden rozpor, ktory musim priznat:** ten isty zdroj radi **dlhe, citatelne**
nazvy klucov („clarity over brevity", `?mobile=true&page=2&theme=dark` namiesto
`?foo=true&bar=2&x=dark`). Rozhodnutie 8 zada **kratke kluce** a je zavazne, takze
schema vyssie je kratka. Zmiernenie: tabulka schemy v `urlschema.js` **je**
dokumentaciou (kluc → co nesie → default na jednom riadku) a rovnaka tabulka
patri do manualu znacky. Bez tej tabulky su kratke kluce presne ta chyba, ktoru
clanok pomenuvava.

---

## 6. Diffy v cudzich suboroch (napisane, nie zapisane)

Zadanie mi zakazuje otvorit na zapis subor mimo svojho. Toto su miesta, ktore
implementacia **musi** zmenit, a preco:

1. **`public/js/mind/state.js:44,47-55,86-90,95,97,135,145,153,159,164`** —
   startovy stav sa dnes cita z `localStorage` **pri vyhodnoteni modulu**. Po
   zavedeni URL musi tieto hodnoty dodavat schema. Bez toho vznikne poradie
   „najprv LS, potom URL prepise", teda dva zdroje a jeden blik.
2. **`public/js/mind/screens.js:30`** — `localStorage.setItem('hades.screen', name)`
   bezpodmienecne. Musi sa rozdelit na „zapis preferencie" a „zapis do URL", inak
   `?s=graf` z desktop shellu trvale prepise volbu cloveka (§1.5a).
3. **`public/js/mind/sim.js:488` a `:575`** — `go()` a `setView()` pisu
   `localStorage`. Tieto dve volania sa nahradia jednym volanim serializera.
   `go()` je pritom volana aj z `graph_focus` toolu (`charon.js:461`), takze
   zapis do URL musi znasat aj to, ze ho vyvolal model, nie clovek — vtedy
   **`replace`**, nie `push` (model nenavigoval, len zameril).
4. **`public/js/chat/threads.js:434-435`** — `pushState` + rucne vystreleny
   `PopStateEvent`. Nahradit volanim serializera (§4.1).
5. **`public/js/chat/run.js:428`, `branches.js:514`, `threads.js:1373`** — tri
   nezavisli `popstate` odberatelia. Zredukovat na jedneho v serializeri, ktory
   rozposle `chat:*` udalosti.
6. **`electron/main.js:96`, `:147` a `bin/hades-app.mjs:202`** — posielaju
   `?screen=…`. Ak sa kluc premenuje na `s`, treba ich prepisat; inak drzat
   `screen` ako alias na citanie (a nikdy ho nezapisovat).
7. **`public/js/mind/screens/{rozhodnutia,runy,kontrola}.js`** — tri funkcie uz
   skladaju `URLSearchParams` pre **serverovy dopyt** (`rozhodnutia.js:38-47`,
   `runy.js:56-62`, `kontrola.js:52-62`; Kniznica ma len `'?q=' +
   encodeURIComponent(q)`, `kniznica.js:93`). **Nezluc ich s adresou
   prehliadaca.** Su to dve rozne
   veci: serverovy dopyt nesie aj `limit` a serverove nazvy, adresa nesie kratke
   kluce a nesmie nest `limit` obrazovky Kniznica (server ho posiela `null`).
   Zlucenie by z „jedneho miesta" spravilo jedno miesto pre dve rozne pravdy.
8. **`resources/views/mind.blade.php`, `chat.blade.php`, `console.blade.php`** —
   ak sa ma vyriesit svetly blik pred nasadenim temy (§1.5d), patri tam
   synchronny inline skript, ktory nastavi `data-theme` **pred** stylesheetom.
   To je zmena, ktora sa musi zniest s CSP `script-src 'self'` — teda **nie**
   inline skript, ale externy synchronny `<script src="/js/theme-boot.js">` v
   `<head>` bez `defer`. Nepatri to do tejto sondy, ale patri to do rovnakej
   vlny, lebo obe veci sa tykaju startoveho stavu.

---

## 7. Poradie implementacie (navrh)

Rozhodnutie 10 zada „obrazovky dat prve". To sa da s URL splnit doslovne:

1. **`shared/urlstate.js` + `mind/urlschema.js` s jedinym klucom `s`.** Vyriesi
   §1.5a a da mechanike prvy skutocny test.
2. **Skupina B — sest obrazoviek dat.** Najvacsi zisk za najmensie riziko:
   ziadna z tych hodnot dnes nikde nezije, takze nie je co migrovat a nie je co
   rozbit. Pri kazdej obrazovke pouzij **existujuci** `prune*()`, nepis druhy.
3. **Skupina A — zanorenie grafu, pohlad, rozsah, filtre.** Tu sa migruje
   `hades.nav`, `hades.gview`, `hades.filter`, `hades.relfilter`,
   `hades.minWeight3`, `hades.skeleton`, `hades.graphScope` — sedem klucov.
   Migracia: pri prvom nacitani bez query stringu **precitaj stary `localStorage`
   a hned ho preloz do URL `replaceState`om**, potom kluc zmaz. Jednorazovo, s
   komentarom, ktory hovori, kedy sa ta vetva da odstranit.
4. **Skupina C — vetva.** Vyzaduje jedneho `popstate` odberatela na `/chat` (§4.1).
5. **Skupina D — panely a `art`.** `art` az potom, co artefakt dostane producenta
   (§1.5c) — inak sa implementuje kluc pre stav, ktory nikdy nenastane.
