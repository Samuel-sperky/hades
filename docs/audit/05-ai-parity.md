# Audit 5 — Parita AI plochy (read-only)

Cieľ: rozhodnutie #6 kontraktu `KONTRAKT-UX-RUNY-CCBRIDGE-2026-08-19.md` — „dvojitá
plocha UI = MCP". Zisťujem, ako ďaleko je dnešný stav, kde presne sa dve plochy
rozchádzajú a ako by mal vyzerať jeden zdieľaný serializér + parity test.

Rozsah čítaného kódu: `public/js/mind/screens/*.js`, `public/js/mind/panels.js`,
`app/Http/Controllers/**`, `app/Services/MindService.php`, `app/Services/GraphService.php`,
`app/Services/Console/Tools/*`, `app/Http/Controllers/McpController.php`, `routes/api.php`,
`database/migrations/`, `tests/Feature/`.

---

## 0. Inventár MCP plochy (fakt, nie dojem)

MCP server je **jeden** controller: `app/Http/Controllers/McpController.php` (848 r.),
route `/mcp` (mimo `routes/api.php`, viď `AuthenticateMcp`; v `routes/api.php` nie je).
`toolDefinitions()` vracia **9 toolov** (`McpController.php:133–326`):

| tool | druh | riadok |
|---|---|---|
| `mind_learn` | zápis | 133 |
| `mind_recall` | čítanie (hľadanie) | 181 |
| `mind_read` | čítanie (1 uzol) | 213 |
| `mind_activate` | zápis (posilnenie) | 229 |
| `mind_overview` | čítanie (štruktúra) | 243 |
| `mind_decision` | **len zápis** | 252 |
| `mind_rename` / `mind_move` / `mind_delete` | zápis | 274 / 289 / 308 |

**Ani jeden z nich nie je ekvivalentom obrazovky.** Všetkých 9 je nad *uzlom*
(nájdi / prečítaj / zapíš), nie nad *plochou* (čo je dnes nové, čo čaká na overenie,
aké rozhodnutia padli v auguste, aké skilly sú v oblasti Vývoj). Dnešná AI plocha je
API nad grafom; UI plocha je 7 obrazoviek nad agregátmi. Prekryv je `mind_overview`
(≈ 4 čísla z dashboardu) a nič viac.

Druhá AI plocha, ktorú kontrakt nemenuje: **tooly konzoly** v
`app/Services/Console/Tools/` (12 toolov, `ToolRegistry::TOOLS`). Z nich
`MindRecallTool`, `MindReadTool`, `MindOverviewTool`, `MindLearnTool`, `MindRenameTool`,
`MindMoveTool`, `MindDeleteTool` sú **druhá implementácia tvaru** tých istých MCP
odpovedí. Takže „dvojitá plocha" je v skutočnosti **trojitá**: UI, MCP, konzola.

---

## 1. Obrazovka po obrazovke

### Dnes (`screens/dnes.js`, 365 r.)
- **Zobrazuje:** hero číslo `counts.nodes` + veta o týždni; KPI rad (spojenia,
  playbooky, záznamy, rozhodnutia); tlačidlo „N čaká na overenie" (`certainty.needs_review`);
  365-dňová heatmapa aktivít; donut istoty (overené/hypotéza/pasca/bez); kumulatívny
  rast 12 mesiacov; bary per oblasť; karta Sync (stav, +/~/−/» počty, brain-write guard);
  „Naposledy si robil na…" (6 sessions), „Posledné záznamy" (6), „Aktívne projekty" (chipy).
- **Endpointy:** `GET /api/today` (`TodayController`) + `GET /api/dashboard`
  (`Api\StatsController::dashboard()`, ten istý payload ako `/api/v1/stats`).
- **Tvar:** `{recent_sessions[], week_added{nodes,sessions}, top_projects[], recent_records[]}`
  a `{heatmap{weeks,months,total}, growth{labels,values}, certainty{...,needs_review},
  per_area[], counts{nodes,edges,decisions,brain,session}, sync{...}, brain_write_enabled}`.
- **MCP ekvivalent:** **čiastočne** — `mind_overview` dá `areas[].nodes`,
  `totals.nodes/edges`, `totals.needs_review` (`MindService.php:1245`, `McpController.php:754`).
  Chýba všetko ostatné: heatmapa, rast, donut istoty, per-area rozklad istoty, sync stav,
  recent sessions/records/projekty, week_added.

### Denník (`screens/dennik.js`, 161 r.)
- **Zobrazuje:** záznamy `source in (session,digest)` zoskupené po dňoch
  (Dnes / Včera / „14. augusta 2026"), filtračné chipy projektov s počtami (top 8 + „viac"),
  badge počtu súborov a commitov, čas HH:MM.
- **Endpoint:** `GET /api/journal` (`JournalController`), limit 50.
- **Tvar:** `{records[{id,source,label,description,project,created_at,prompt_count,
  file_count,commits[],files[],tools[],prompts[],final}], projects{name:count}, total}`.
- **MCP ekvivalent:** **nie.** `mind_recall` nevie filtrovať podľa `source`, nevie radiť
  podľa `created_at`, nevracia `created_at`, `file_count`, `commits`. AI nemá spôsob, ako
  sa dozvedieť „čo som robil včera".

### Knižnica (`screens/kniznica.js`, 75 r.)
- **Zobrazuje:** skilly zoskupené po oblastiach (bodka farby, počet), label, snippet,
  origin badge, cert badge, do 5 tagov; klik → .md overlay.
- **Endpoint:** `GET /api/library?q=` (`LibraryController`).
- **Tvar:** `{areas[{name,color,skills[{id,label,path,snippet,origin,certainty,tags[]}]}]}`.
- **MCP ekvivalent:** **čiastočne** — `mind_recall` s `areas` filtrom vráti podobné uzly,
  ale skórované podľa dopytu, nie **kompletný abecedný zoznam skillov v oblasti**, a bez
  `path` (tú dá až `mind_read` po jednom uzle, `sourcePathOf()`). AI nevie požiadať
  „vypíš mi všetky skilly v oblasti X s cestami k .md" jedným volaním.

### Rozhodnutia (`screens/rozhodnutia.js`, 257 r.)
- **Zobrazuje:** časová os po mesiacoch, filtre rok a oblasť s počtami, karta rozhodnutia
  (dátum, text, rozbaliteľný dôvod, origin badge, oblasť, „uzol #id"), formulár pridania.
- **Endpoint:** `GET /api/decisions` (`Api\DecisionController`), limit 500, filtre
  `year/area/origin` sú na serveri, ale UI ich **nepoužíva** (fetch bez query).
- **Tvar:** `{decisions[Decision::toApi()]}`.
- **MCP ekvivalent:** **nie** — `mind_decision` je len `write`. **AI vie rozhodnutie
  zapísať, ale nevie si prečítať, čo už bolo rozhodnuté.** To je najtvrdšia diera
  v celom audite: pravidlo „nevratné rozhodnutia sa nemenia bez dôvodu" je nevymožiteľné,
  keď si ich nová session nevie vytiahnuť.

### Kontrola (`screens/kontrola.js`, 231 r.)
- **Zobrazuje:** fronta `needs_review` (typ, origin, cert, timeAgo, label + popis),
  akcie Overiť / Vyriešiť / Preskočiť / Del, rail badge z `total`.
- **Endpoint:** `GET /api/review/queue` + `POST /api/nodes/{n}/verify`,
  `POST /api/nodes/{n}/resolve-review` (`Api\ReviewController`).
- **Tvar:** `{queue[Node::toApi()], total}`.
- **MCP ekvivalent:** **nie** pre čítanie fronty (len `mind_overview.totals.needs_review`
  = jedno číslo), **nie** pre `verify`/`resolve`. AI, ktorá uzol vytvorila a zaradila do
  fronty, ho nevie ani prečítať, ani overiť.

### Smernica (`screens/smernica.js`, 360 r.)
- **Zobrazuje:** šablóny, vstup úlohy, návrh v 5 sekciách (skilly / pasce / projekty /
  fakty / pravidlá) ako checklist, **klientsky prestavovaný markdown náhľad**, uložené
  smernice v `directives/*.md`.
- **Endpointy:** `POST /api/directive/build`, `POST /api/directive/save`,
  `GET /api/directive/templates`, `GET /api/directives`, `GET /api/directive/{name}`.
- **Tvar `build`:** `{task, suggested{skills,pitfalls,projects,facts,rules}, markdown}`.
- **MCP ekvivalent:** **nie.** A je to iróniou celej obrazovky: Smernica existuje na to,
  aby *človek skopíroval kontext do Claude Code*. Keby ju vedel Claude Code vyžiadať
  jedným toolom, obrazovka by bola len jej vizualizácia. **Kontrakt navyše Smernicu
  vo vlne E nemenuje** (§5 vlna E: Dnes, Denník, Knižnica, Rozhodnutia, Kontrola, Runy)
  — buď to je vedomé vynechanie a patrí do §6, alebo diera v zadaní.

### Graf (`render.js`, `panels.js`, `edges.js`)
- **Zobrazuje:** ~1065 uzlov, ~2882 hrán, oblasti/oddelenia, filtre, legenda, panel
  detailu uzla (návrhy, .md, prompty/súbory/commity z `meta`), štatistiky.
- **Endpointy:** `GET /api/mind?scope=live|all` (`GraphService::payload()`),
  `GET /api/mind/stats` (`MindController::stats`), `GET /api/nodes/{id}`,
  `/suggestions`, `/markdown`, `GET /api/structure`, `GET /api/activations`.
- **MCP ekvivalent:** **čiastočne** — `mind_read` dá jeden uzol + `related` labely,
  `mind_overview` dá štruktúru. Topológiu (kto s kým a akou váhou) AI nedostane;
  `mind_read.related` je len zoznam labelov bez váh a bez typu hrany.
- **Poznámka v prospech projektu:** `GraphService::payload()` je **jediný existujúci
  precedens zdieľaného serializéra** — interné `/api/mind` aj externé `/api/v1/graph`
  ho volajú a payload je bit-za-bit ten istý (`MindController.php:14–29`). Vlna E má
  toto zovšeobecniť, nie vymyslieť.

### Konzola (`resources/views/console.blade.php`, `public/js/console/*`)
- Vlákna, správy, karty toolov, diffy, permission prompt, tokeny/tok-s v riadku stavu
  (`console/render.js:342–345`, `run.js:293–294`).
- **Endpointy:** `/api/console/threads*`, `/api/console/run`, `/api/console/decide`,
  `/api/console/models`.
- **MCP ekvivalent:** **nie** (a kontrakt ho ani nežiada — konzola je vstup, nie plocha).

---

## 2. Nálezy

### M1 — MCP nemá ani jeden tool na úrovni obrazovky; parita je dnes ~15 %
**Tvrdenie:** zo 7 obrazoviek má MCP čiastočný ekvivalent pre 3 (Dnes, Knižnica, Graf) a
žiadny pre 4 (Denník, Rozhodnutia, Kontrola, Smernica). Ani jeden „čiastočný" nevracia
ten istý tvar — vracia iný rez tých istých dát.
**Dôkaz:** `McpController.php:133–326` (9 toolov, všetky nad uzlom);
`MindService.php:1245–1279` (`overview()` = areas + 4 čísla).
**Efekt:** AI nevie odpovedať na otázku, ktorú človek vyrieši pohľadom („čo čaká na
overenie", „čo som rozhodol v júli", „čo som robil včera").
**Riziko:** stredné — nič sa nerozbije, len sa nevie.
**Návrh:** 6 nových **čítacích** toolov (§4), všetky aditívne.

### M2 — `mind_decision` je write-only: AI si nevie prečítať vlastné rozhodnutia
**Tvrdenie:** rozhodnutia sú jediná entita v Hadese, ktorú AI vie zapísať a nevie prečítať.
**Dôkaz:** `McpController.php:252` (definícia, len vstupy `text/reason/area/decided_on`),
`McpController.php:767` (`toolDecision`); `routes/api.php` má `GET /api/decisions` aj
`GET /api/v1/decisions` — čítanie **existuje**, len nie pre MCP.
**Efekt:** každá nová session môže rozhodnúť opak včerajšieho rozhodnutia.
**Riziko:** **vysoké** — je to priamy rozpor s tým, načo Hades je.
**Návrh:** `mind_decisions` (zoznam + filtre year/area/origin/limit). Backend hotový,
stačí ho zabaliť.

### M3 — Kontrola nemá AI plochu ani na čítanie, ani na akciu
**Tvrdenie:** AI plní frontu (`mind_learn` → `needs_review`, duplicate_candidates), ale
frontu nevidí a nevie ju vyprázdniť.
**Dôkaz:** `Api\ReviewController::queue()` (existuje na `/api/review/queue` a `/api/v1/...`),
v `McpController::toolDefinitions()` žiadny ekvivalent.
**Efekt:** fronta je jednosmerná: AI ju plní, len človek ju čistí.
**Riziko:** stredné. `verify` z MCP je navyše **rozhodnutie o dôveryhodnosti** —
nemá sa dať autonómne, patrí za guard alebo úplne von (viď §3 „čo NESMIE").
**Návrh:** `mind_review_queue` (len čítanie). `verify` z MCP **nenavrhujem** —
overenie je akt človeka; nech to zostane na obrazovke.

### M4 — Denník: AI nemá prístup k časovej osi práce
**Tvrdenie:** `mind_recall` je skórované hľadanie, nie chronológia. Nevracia `created_at`.
**Dôkaz:** `McpController.php:470–520` (row bez `created_at`), `JournalController` vracia
`created_at`, `file_count`, `commits`.
**Efekt:** „čo sme robili včera / v tomto projekte minulý týždeň" je pre AI nedostupné,
hoci je to presne to, čo `session` uzly nesú.
**Riziko:** nízke-stredné.
**Návrh:** `mind_journal` (§4, `days`/`project`/`limit`).

### M5 — Smernica: server markdown vyrába a UI ho zahodí a poskladá si vlastný
**Tvrdenie:** `POST /api/directive/build` vracia `markdown` (`DirectiveController.php:190`),
ale `smernica.js` ho **ignoruje** a skladá si vlastný klientsky
(`smernica.js:209`, `216–279` `buildDirectiveMarkdown()`, s vlastným `dirHowTo()`:287,
`dirOneLine()`:303 a `dirInfoSuffix()`:300).
Komentár v kóde to priznáva: „zrkadlí `DirectiveController::buildMarkdown()`. Keď meníš
jedno, zmeň aj druhé" (`smernica.js:214–215`).
**Efekt:** dve implementácie toho istého výstupu. Človek kopíruje klientsku verziu, MCP
tool by poslal serverovú. **Toto je presne ten rozchod, ktorý má vlna E zabiť — a existuje
už dnes, pred pridaním čohokoľvek.**
**Riziko:** **vysoké** pre paritu; nízke pre funkčnosť dnes.
**Návrh:** urobiť server zdrojom pravdy. Klient posiela `node_ids` (výber checkboxov)
a dostane `markdown` z toho istého `buildMarkdown()`. Náhľad = `mdToHtml(server.markdown)`.
Zmazať `buildDirectiveMarkdown()` a jeho 4 pomocníkov (≈ 90 r. JS). Bez toho parity test
pre Smernicu nemá čo porovnávať.

### M6 — Denník si prepočítava počty projektov, hoci server ich posiela
**Tvrdenie:** `JournalController` vracia `projects{name:count}` — `dennik.js` to pole
**nikdy nečíta** a počty si prepočíta z `records` (teda len z 50 načítaných, nie zo všetkých).
**Dôkaz:** `dennik.js:63–69` (`counts.set(...)` nad `journalRecords`), `:108` (klientsky
filter), `:116` (klientsky sort), `JournalController.php` (`projects` + `total`).
**Efekt:** čipy hlásia počty **v načítanej stránke**, nie v denníku. Server hlási iné čísla
než obrazovka. AI by dostala serverové.
**Riziko:** stredné — sú to viditeľne nesprávne čísla.
**Návrh:** serializér vracia `projects[{key,label,count}]` už s folded skupinou
„bez projektu" (viď M7) a UI ich len vypíše.

### M7 — Skupina „bez projektu" je čisto klientska heuristika
**Tvrdenie:** `isMachineName()` (`util.js:354`) rozhoduje, či je `project` strojový názov
dočasného adresára, a `journalKey()` (`dennik.js:50`) ho preto zlepí do sentinelu
`'#bez-projektu'` (`dennik.js:47`). To isté robí `prettyProject()` (`util.js:369`) a
`prettyLabel()` (`util.js:381`) v Dnes, Denníku a paneloch.
**Efekt:** **AI dostane 12 jednopočetných projektov „mystifying-mclaren-23750a", človek
vidí jednu skupinu „bez projektu".** Dva rôzne svety nad tými istými dátami.
**Riziko:** vysoké pre paritu — je to sémantika, nie formátovanie.
**Návrh:** presunúť `isMachineName` do PHP (`ProjectName::isMachine()`), serializér vracia
`project_key` (folded) **a** `project` (surový, identita) — UI aj MCP čítajú `project_key`.

### M8 — Rozhodnutia: celá filtračná os sa počíta v prehliadači
**Tvrdenie:** roky, oblasti, ich počty aj samotné filtrovanie sú klientske; server má na to
`year/area/origin` parametre a UI ich nepoužíva.
**Dôkaz:** `rozhodnutia.js:58` (`years`), `:59` (`areaIds`), `:74`/`:79` (počty),
`:109–113` (filter), `:150` (mesačné buckety), `:175` a `:94` (`S.areas.get(aid)` —
**názov oblasti sa dopĺňa z grafového payloadu, nie z odpovede endpointu**).
**Efekt:** `/api/decisions` nevracia názov oblasti; obrazovka ho vie len preto, že má
načítaný graf. MCP tool nad tým istým endpointom by vrátil `area_id: 7` bez názvu —
pre AI bezcenné.
**Riziko:** vysoké pre paritu.
**Návrh:** serializér doplní `area` (názov) a `years[]`/`areas[]` s počtami.

### M9 — Knižnica: počet skillov v oblasti počíta klient z dĺžky poľa
**Dôkaz:** `kniznica.js:52` (`a.skills.length`), `:14` (`tags.slice(0,5)`).
**Efekt:** pri budúcom strope/paginácii bude „počet" = počet zobrazených. Tag cap 5 je
klientsky, MCP má vlastný `recall_tag_cap` = 8 (`config/hades.php`) — dva rôzne stropy
na tú istú vec.
**Riziko:** nízke dnes, stredné po pridaní stropu.
**Návrh:** `count` a `tags_total` zo servera; jeden konfigurovateľný cap.

### M10 — Kontrola: `total` má klientsky fallback a klientsky sa dekrementuje
**Dôkaz:** `kontrola.js:24` (`d.total != null ? d.total : items.length`), `:137`
(`total = Math.max(0, total - 1)`), `:281–...` `kontrolaSkip()` (preskočenie je **len
lokálne**, uzol zostáva v serverovej fronte).
**Efekt:** rail badge a MCP `needs_review` sa po pár akciách rozídu; „preskočené" je stav,
ktorý existuje len v pamäti tabu a AI o ňom nikdy nevie.
**Riziko:** nízke (badge), ale je to vzorový rozchod.
**Návrh:** badge z jedného čísla serializéra; „preskočiť" nechať klientske, ale
**dokumentovať v popise toolu**, že fronta z MCP je serverová a nepozná preskočenia.

### M11 — Dnes: hero, plurály, škálovanie barov a Sync labely sú klientske
**Dôkaz:** `dnes.js:85` (`sessions.slice(0,6)` — server pošle 8, obrazovka ukáže 6),
`:141` (`review`), `:151` (SK plurál), `:224` (`Math.max.apply` — normalizácia barov),
`:240` (`statusLabel` mapa sync stavov), `:241` (`guardOn` z dvoch rôznych polí).
**Efekt:** plurály a labely sú UI vec (v poriadku), ale `slice(0,6)` a `Math.max` sú
**dátové rozhodnutia v prehliadači**. `guardOn` s dvojitým fallbackom navyše priznáva, že
`brain_write_enabled` je v payloade dvakrát (`StatsController` root aj `sync{}`).
**Riziko:** nízke.
**Návrh:** limity do serializéra (`recent_sessions` už orezané na to, čo sa zobrazuje),
`per_area[].share` (0–1) počítať na serveri, `brain_write_enabled` **raz**.

### M12 — Tvar `mind_recall` existuje v dvoch nezávislých kópiách a už sa rozišli
**Tvrdenie:** `McpController::toolRecall()` a `Console\Tools\MindRecallTool::execute()`
skladajú ten istý riadok uzla dvakrát, s inými poliami a inými stropmi.
**Dôkaz:** `McpController.php:470–520` vs `MindRecallTool.php:89–120`. Rozdiely:
konzola má `id` a **nemá** `strength`, `department`, `verified`, `origin`, `semantic`;
default limit 8 vs 12; MCP má trojstupňový strop popisu (`recall_desc_top_chars`
900/300/200), konzola dvojstupňový (300/200). `dropEmpty()` je raz metóda
(`McpController.php:615`) a raz inline `array_filter` (`MindRecallTool.php:103`).
To isté pre `mind_read` (`McpController.php:530–601` vs `MindReadTool.php:79–96`).
**Efekt:** kánon z CLAUDE.md („prázdne polia sa neposielajú", význam vynechania v popise
toolu) sa musí držať na dvoch miestach a jedno z nich už zaostáva.
**Riziko:** stredné — a rastie s každým novým toolom.
**Návrh:** vytiahnuť `NodeRow` serializér (viď §3) s dvoma profilmi
(`profile: 'mcp' | 'console'`), aby rozdiel bol **deklarovaný** (jedna konštanta polí),
nie odvodený z dvoch kópií kódu. **Payload `mind_recall` sa pritom nesmie zmeniť** —
refaktor musí byť bit-za-bit identický, čo je presne to, čo `RecallForAiTest` overí.

### M13 — Log runov naozaj neexistuje (kontrakt potvrdený)
**Overenie:**
- Migrácie: posledná je `2026_08_19_000002_create_node_embeddings_table`; tabuľka
  `runs` ani `run_events` **neexistuje** (`ls database/migrations`).
- `grep -rl "run_id\|RunRecorder\|\bruns\b" app database routes tests` → **2 zásahy, oba
  o brain-syncu**: `app/Console/Commands/MindBrainSync.php`, `app/Services/Brain/BrainSyncService.php`
  (tabuľka `sync_runs` z `2026_07_21_000004_create_brain_sync_tables.php`, model `SyncRun`).
- Konzola perzistuje **vlákno**, nie beh: `console_threads`, `console_messages`
  (`stop_reason`, `tokens_in`, `tokens_out`, `duration_ms`), `console_tool_calls`
  (`status`, `arguments`, `result`, `error`, `preview`, `duration_ms`, `decided_at`) —
  `database/migrations/2026_08_19_000001_create_console_tables.php`.
- `storage/logs/` obsahuje jediný `laravel.log` (žiadny per-run log, žiadny NDJSON).
- `tokens_per_second` sa dnes počíta na serveri a posiela v rámci streamu
  (`public/js/console/run.js:293–294`, `render.js:342–345`) — **nikde sa neukladá**.
**Záver:** kontrakt má pravdu. **Dôležitý dôsledok pre vlnu C:** dáta pre `runs` z veľkej
časti **už v DB sú**, len rozsypané po `console_*`. `RunRecorder` má byť pohľad/agregát nad
existujúcimi tabuľkami + nový riadok `runs` na hlavičku behu, nie tretia kópia tých istých
čísel. Inak bude tok/s v `runs` iné než súčet `console_messages`.

### M14 — Kontrakt vo vlne E vynecháva Smernicu a Graf
**Dôkaz:** §5 vlna E menuje „Dnes, Denník, Knižnica, Rozhodnutia, Kontrola, Runy" —
teda 6 zo 7 obrazoviek (+ Runy). Smernica a Graf chýbajú.
**Efekt:** akceptačné kritérium 5 sa dá splniť pri dvoch nepokrytých obrazovkách.
**Návrh:** buď doplniť `mind_directive` + `mind_graph` do rozsahu, alebo ich vedome
zapísať do §6 „čo NIE" s dôvodom. Smernica je pritom **najhodnotnejší kandidát** —
je to doslova „poskladaj mi kontext", teda MCP tool prevlečený za obrazovku.

### M15 — NEOVERENÉ: či sa `mind_recall` payload zmenil pri refaktore
Nemeral som živý payload (read-only audit, appku som nespúšťal). Tvrdenia o veľkostiach
(2 052 B z 38 362 B, 77 493 znakov, 25 389 B najväčší uzol) sú **prevzaté z komentárov
v kóde a z `RecallForAiTest`**, nie zmerané mnou. Pred refaktorom podľa §3 to treba
premerať znova — a merať cez `tests/Feature/RecallForAiTest.php`, nie skriptom, ktorý si
formulu skopíruje (pasca z CLAUDE.md).

---

## 3. Návrh: jeden zdieľaný serializér na obrazovku

### Umiestnenie a menná konvencia
`app/Serializers/Screen/` — jeden `final readonly class` na obrazovku, metóda `data(): array`.
Kód anglicky (pravidlo používateľa), UI texty zostávajú v JS.

| Trieda | Vracia (kánonické kľúče) | Endpoint | MCP tool |
|---|---|---|---|
| `TodayScreen` | `counts{}`, `week_added{}`, `certainty{}`, `per_area[]` (+`share`), `heatmap{}`, `growth{}`, `sync{}`, `recent_sessions[]`, `recent_records[]`, `top_projects[]`, `brain_write_enabled` | `GET /api/today`, `GET /api/dashboard`, `GET /api/v1/stats` | `mind_today` |
| `JournalScreen` | `records[]` (s `project_key`, `created_at`, `file_count`, `commit_count`), `projects[{key,label,count}]`, `total` | `GET /api/journal` | `mind_journal` |
| `LibraryScreen` | `areas[{name,color,count,skills[{id,label,path,snippet,origin,certainty,verified,tags[],tags_total}]}]` | `GET /api/library` | `mind_library` |
| `DecisionsScreen` | `decisions[{id,text,reason,decided_on,area,area_id,origin,node_id}]`, `years[{year,count}]`, `areas[{id,name,count}]`, `total` | `GET /api/decisions`, `/api/v1/decisions` | `mind_decisions` |
| `ReviewScreen` | `queue[{id,label,type,area,certainty,origin,created_at,description,description_truncated}]`, `total` | `GET /api/review/queue`, `/api/v1/...` | `mind_review_queue` |
| `DirectiveScreen` | `task`, `suggested{skills,pitfalls,projects,facts,rules}`, `markdown` | `POST /api/directive/build` | `mind_directive` |
| `RunsScreen` / `RunScreen` | §4 | `GET /api/runs`, `GET /api/runs/{id}` | `mind_runs`, `mind_run` |
| `GraphService` (**už existuje**) | `nodes[]`, `edges[]`, `areas[]` | `GET /api/mind`, `/api/v1/graph` | (`mind_graph`, voliteľné) |

Plus **`NodeRow`** — nie obrazovka, ale spoločný riadok uzla pre `mind_recall` /
`mind_read` / `mind_review_queue` / konzolové tooly, s deklarovanými profilmi
(`FIELDS_MCP`, `FIELDS_CONSOLE`) a jedným `dropEmpty()`. Rieši M12.

### Kto ho volá
- **Endpoint** vráti `data()` **bez zmeny** (JSON tak, ako je).
- **MCP tool** vráti `dropEmpty(project(data(), FIELDS_AI))` — teda **podmnožinu tých
  istých kľúčov s tými istými hodnotami**, len bez prázdnych polí a bez toho, čo je čisto
  vizuálne (`color`, `heatmap.weeks` mriežka — AI stačí `heatmap.total` a
  `heatmap.top_days[]`).
- Rozdiel medzi plochami je **jeden deklarovaný zoznam kľúčov na triedu**, nie dva kusy kódu.

### Čo sa NESMIE zmeniť
1. **Tvar `mind_recall`.** Volajú ho živé sessions (`McpController.php:181`, konzola,
   `ChatController`). Kánon z CLAUDE.md: `relevance` = podiel konceptov + tretinová váha
   labelu; uzol s `via` je nepriamy zásah s polovičnou relevanciou; `related` = labely
   najsilnejších spojení, prednosť uzlom už v odpovedi; **prázdne polia sa neposielajú** a
   význam vynechania žije v popise toolu (`origin` chýba = session, `verified` chýba =
   neoverené). Refaktor na `NodeRow` musí byť **bit-za-bit identický** — a `RecallForAiTest`,
   `RecallTagsTest`, `RecallScopeTest`, `HybridRecallTest`, `McpToolsTest` sú tá brána.
2. **`/api/v1/*` kontrakt** (§6 kontraktu) — `StatsController::dashboard()`,
   `GraphService::payload()`, `DecisionController::index()`, `ReviewController::queue()`
   sú zdieľané s Bearer plochou. Serializér ich smie **obohatiť** (nové kľúče), nie
   pretvoriť ani prekľúčovať (`per_area` zostáva `per_area`, nie `by_area` — §4.2).
3. **`mind_recall` nesmie dostať nové povinné argumenty.**

### Čo je čisto aditívne (bezpečné)
- 6–8 **nových** MCP toolov, všetky read-only okrem už existujúcich zápisov.
- **Nové kľúče** v existujúcich endpointoch (`project_key`, `area` v decisions,
  `count`/`tags_total` v library, `share` v `per_area`, `years`/`areas` v decisions).
  Klienti, ktorí ich nečítajú, sa nezmenia.
- `mind_overview` môže dostať `totals.decisions`, `totals.sessions` — aditívne.

---

## 4. Nové MCP tooly pre runy — konkrétne schémy

Držia kánon z CLAUDE.md: **odpoveď je pre AI**, prázdne polia sa neposielajú, význam
vynechania je v popise toolu, žiadne `null` polia, žiadny `JSON_PRETTY_PRINT`.

### `mind_runs` — zoznam behov

```json
{
  "name": "mind_runs",
  "description": "List agent runs — every console turn and every Claude Code run Hades started, newest first. Use it to see what was already tried before repeating work, or to find the run whose diffs you need. How to read the answer: `status` is one of running/done/aborted/failed/awaiting_permission. `source` is `console` (the mind's own console) or `claude_code` (a run on the host). A run with `parent` is one leg of a fan-out — its parent holds the merged report. `tools` counts tool calls, `writes` counts the ones that changed files or the mind; a run with no `writes` key changed nothing. Empty fields are omitted: no `error` means it did not fail, no `parent` means it was not part of a fan-out, no `cwd` means the mind's own database rather than a directory. Use mind_run with `id` for the step-by-step timeline and diffs.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "source":  {"type": "string", "enum": ["console", "claude_code"], "description": "Restrict to one source. Omit for both."},
      "status":  {"type": "string", "enum": ["running", "done", "aborted", "failed", "awaiting_permission"]},
      "model":   {"type": "string", "description": "Restrict to one model name, as reported by the provider."},
      "project": {"type": "string", "description": "Restrict to runs whose working directory belongs to this project."},
      "days":    {"type": "integer", "description": "Only runs started within the last N days (default 7)."},
      "limit":   {"type": "integer", "description": "Max runs to return (1-50, default 20)."}
    }
  }
}
```

Odpoveď (`RunsScreen::data()` → projekcia):

```json
{
  "found": 3,
  "runs": [
    {"id": 412, "source": "claude_code", "status": "done", "model": "claude-opus-5",
     "prompt": "Zjednoť density tokeny v console.css",
     "started": "2026-08-19T14:02:11+02:00", "duration_s": 214,
     "tokens_in": 18422, "tokens_out": 3110, "tps": 9.4,
     "tools": 17, "writes": 4, "cwd": "C:/Users/Ucet/Desktop/AI-mind",
     "parent": 410}
  ]
}
```
`error`, `parent`, `writes`, `cwd` chýbajú, keď nie sú — význam je v popise.
`prompt` je skrátený na `config('hades.runs_prompt_chars', 200)`; keď sa skrátil, ide
`prompt_truncated: true` (ten istý kánon ako `description_truncated`).

### `mind_run` — detail jedného behu

```json
{
  "name": "mind_run",
  "description": "Read one run in full: its prompt, the ordered timeline of steps (assistant turns, tool calls, permission decisions) and the diffs it produced. Use it after mind_runs, or when a run id appears in a report. Identify the run by `id`. How to read the answer: `steps` is chronological; each step has `kind` (say/tool/decision/error) and only the fields that kind carries. A tool step with `denied: true` was refused by the human and did not run. `diff` is a unified diff of what the step actually wrote — it is omitted for read-only steps. `outcome` is the run's own last word; `error` appears only when it failed. Set `steps: false` when you only need the header and totals.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id":    {"type": "integer", "description": "Run id, as returned by mind_runs."},
      "steps": {"type": "boolean", "description": "Include the step timeline (default true). False returns header and totals only."},
      "diffs": {"type": "boolean", "description": "Include unified diffs in write steps (default true). Diffs are the largest part of the answer — turn them off when you only need to know what was touched."}
    },
    "required": ["id"]
  }
}
```

Odpoveď:

```json
{
  "id": 412, "source": "claude_code", "status": "done", "model": "claude-opus-5",
  "prompt": "Zjednoť density tokeny v console.css",
  "started": "2026-08-19T14:02:11+02:00", "duration_s": 214,
  "tokens_in": 18422, "tokens_out": 3110, "tps": 9.4,
  "permission_mode": "plan", "cwd": "C:/Users/Ucet/Desktop/AI-mind",
  "totals": {"tools": 17, "writes": 4, "files": 2},
  "outcome": "Zjednotil som 6 density tokenov; console.css o 41 riadkov kratší.",
  "steps": [
    {"i": 1, "kind": "say", "text": "Najprv si prečítam oba stylesheety."},
    {"i": 2, "kind": "tool", "name": "read_file", "args": {"path": "public/css/console.css"}, "ms": 34},
    {"i": 3, "kind": "tool", "name": "edit_file", "args": {"path": "public/css/console.css"},
     "ms": 51, "diff": "@@ -12,3 +12,3 @@\n-  padding: 14px;\n+  padding: var(--card-pad);"},
    {"i": 4, "kind": "decision", "name": "write_file", "denied": true, "reason": "human declined"}
  ]
}
```

**Poznámky ku kánonu:** `parent`/`children` len keď fan-out existuje; `denied: true` sa
posiela (je to hodnota), `denied: false` nie; `args` sa skracujú na cesty a kľúčové
parametre — celé argumenty patria do UI, nie do kontextu AI; `diff` má strop
`config('hades.run_diff_chars')` a pri skrátení `diff_truncated: true`.

**Bezpečnosť (vlastný nález, mimo zadania):** `runs.prompt` a `run_events` môžu obsahovať
tajomstvá z promptu človeka. `SecretScanner` (`app/Services/Brain/SecretScanner.php`, už
používaný v `McpController::looksLikeSecret()`) treba pustiť na výstup `mind_run` — MCP
plochu čítajú cudzie sessions. `CC_BRIDGE_TOKEN` sa v `runs` nesmie objaviť nikdy.

---

## 5. PARITY TEST — čo presne porovnávať

Cieľ: **padne, keď sa obrazovka a MCP rozídu; nepadne pri kozmetickej zmene UI.**
Preto sa netestuje DOM, screenshot ani HTML — testuje sa **serializér a jeho dve projekcie**.
Súbor: `tests/Feature/ScreenParityTest.php` (PHP, ide do balíka 228+).

### Register — jeden zdroj pravdy pre celý test
```php
// app/Serializers/Screen/ScreenRegistry.php
public const SCREENS = [
  'today'      => [TodayScreen::class,     'GET /api/today+/api/dashboard', 'mind_today'],
  'journal'    => [JournalScreen::class,   'GET /api/journal',              'mind_journal'],
  'library'    => [LibraryScreen::class,   'GET /api/library',              'mind_library'],
  'decisions'  => [DecisionsScreen::class, 'GET /api/decisions',            'mind_decisions'],
  'review'     => [ReviewScreen::class,    'GET /api/review/queue',         'mind_review_queue'],
  'directive'  => [DirectiveScreen::class, 'POST /api/directive/build',     'mind_directive'],
  'runs'       => [RunsScreen::class,      'GET /api/runs',                 'mind_runs'],
  'run'        => [RunScreen::class,       'GET /api/runs/{id}',            'mind_run'],
];
```

### Test 1 — pokrytie (padne, keď pridáš obrazovku bez toolu)
Pre každý záznam registra: route existuje (`Route::has` / `getRoutes()`), MCP `tools/list`
obsahuje meno toolu. **Naopak tiež:** každý `data-screen` v `resources/views/mind.blade.php`
musí byť v registri (alebo na menovanom allowliste, dnes `graf`). Tento test padne presne
pri „pridal som obrazovku a zabudol na AI" — čo je ten scenár, ktorý #6 rieši.

### Test 2 — jeden zdroj dát (padne pri druhej implementácii)
Zavolaj endpoint aj tool nad **tou istou fixture DB** a over, že tool nevie nič, čo
endpoint nevie, a naopak nevynechal nič deklarované:
```
$ui  = flatten($this->getJson($route)->json());          // 'counts.nodes' => 12
$ai  = flatten($this->rpcTool($tool, $args));
// (a) žiadny kľúč navyše: keys($ai) ⊆ keys($ui) ∪ AI_ONLY (found, hint, *_truncated)
// (b) žiadna iná hodnota: pre každý spoločný kľúč $ui[$k] === $ai[$k]
// (c) žiadny vypadnutý kľúč: FIELDS_AI ⊆ keys($ai) ∪ dropEmpty-vynechané
```
Bod **(b) je jadro celého testu**: keby niekto pridal do MCP toolu vlastný výpočet
(druhá implementácia), hodnota sa rozíde a test padne. Keby prepísal CSS, farbu, poradie
DOM alebo slovenský popisok, test sa nedotkne ničoho.

### Test 3 — deklarované agregáty (padne pri klientskom dopočítavaní)
Toto je odpoveď na §2 M6–M11. Pre každú obrazovku existuje zoznam **faktov, ktoré
obrazovka zobrazuje a ktoré nie sú surové pole záznamu**:
`journal.projects[].count`, `journal.total`, `decisions.years[].count`,
`decisions.areas[].count`, `decisions[].area` (názov!), `library.areas[].count`,
`review.total`, `today.per_area[].share`, `today.certainty.needs_review`,
`runs[].tools`/`writes`, `run.totals.*`.
Test tvrdí: **každý taký fakt je v `data()`** a jeho hodnota sedí s nezávisle
prepočítaným očakávaním nad fixture (napr. `Decision::whereYear(...)->count()`).
Padne, keď niekto fakt zo serializéra vyhodí „veď si ho počíta frontend".

### Test 4 — frontend nečíta, čo serializér nedáva (statický, netriviálny, ale stabilný)
Regexom vytiahni z `public/js/mind/screens/<x>.js` každý prístup na koreň odpovede
(`d.<key>`, `data.<key>`, `data\[['"]key`) a over, že **každý prečítaný kľúč je v
`data()`**. Nekontroluje sa opak (serializér smie dať viac — AI ich číta).
Padne, keď frontend začne čítať pole, ktoré na AI ploche neexistuje. Nepadne pri zmene
CSS, textov, poradia DOM ani pri refaktore vnútra funkcií.
*Ohraničenie:* je to jediný krehký test zo štyroch. Držať ho **len na koreňových kľúčoch**
(nie na `d.a.b.c`), inak sa z neho stane brzda.

### Čo test zámerne NEROBÍ
- Neporovnáva screenshoty ani HTML (kozmetika by ho zhodila).
- Neporovnáva SK plurály, `timeAgo`, `prettyLabel`, `esc()`, farby, ikony a poradie
  chipov — to je prezentácia a patrí do UI (M11).
- Netestuje `mind_recall` na paritu s obrazovkou (recall nie je obrazovka) — ten drží
  `RecallForAiTest` a spol., ktoré musia zostať zelené **bez zmeny**.
- Nekontroluje `heatmap.weeks` mriežku v AI projekcii (mriežka je vizuál; AI dostane
  `total` + `top_days`) — to je menovaná, deklarovaná výnimka v `FIELDS_AI`.

### Doplnok, ktorý sa vyplatí (2 riadky, vysoká hodnota)
`ScreenParityTest::test_no_screen_reads_area_names_from_the_graph()` — dnes
`rozhodnutia.js:94,175` berie názov oblasti z `S.areas` (grafový payload). Test tvrdí, že
`/api/decisions` vracia `area`, takže obrazovka **nemusí** mať načítaný graf. To je M8
zabalená do jedného tvrdenia.

---

## 6. Poradie práce (efekt / riziko)

| # | Krok | Efekt | Riziko |
|---|---|---|---|
| 1 | `mind_decisions` (čítanie rozhodnutí) | veľký | nulové (aditívne, backend hotový) |
| 2 | `mind_review_queue` | veľký | nulové |
| 3 | Smernica: server je zdroj markdownu (M5), zmazať klientsku kópiu | veľký | malé (jedna obrazovka) |
| 4 | `DecisionsScreen` + `area` názov + `years/areas` počty (M8) | veľký | malé (aditívne kľúče) |
| 5 | `JournalScreen` + `project_key` a `isMachineName` do PHP (M6, M7) | veľký | stredné (sémantika skupín) |
| 6 | `mind_journal`, `mind_library`, `mind_today` | stredný | nulové |
| 7 | `NodeRow` s profilmi (M12) — **bit-za-bit identický recall** | stredný | **vysoké** — brána sú existujúce recall testy |
| 8 | `runs`/`run_events` + `mind_runs`/`mind_run` (vlna C) | veľký | stredné (nová schéma, `mysqldump` pred migráciou) |
| 9 | `ScreenParityTest` (Testy 1–4) | drží všetko vyššie | nulové |

**Vedome sa nerobí:** `verify` z MCP (M3 — overenie je akt človeka), `mind_graph`
s topológiou (payload ~2882 hrán je pre AI kontext neúnosný; `mind_read.related` stačí),
parity test nad Grafom a Konzolou (nie sú to plochy s agregátmi).
