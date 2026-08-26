# Kontrakt — Chat ako samostatná appka, orchestrátor agentov, lokálny rast

Dátum: 25. 8. 2026 · vetva `feat/hades-chat` (nová, z `feat/hades-ux`)
Východiskový stav: `feat/hades-ux` @ `82ae1cb`, sqlite **475 passed / 0 failed**,
MariaDB (`ScreenParity|ConsoleTools|McpTools`) **100 testov / 0 padnutých**.

## 0. Cieľ

Z Charóna urobiť **plnohodnotnú chatovú appku na vlastnej URL**, ktorá má to, čo
človek pozná z Claude Code a ChatGPT — vlákna a projekty, artefakty, prílohy, hlas,
a **orchestrátor podagentov** — a súčasne nechať Hades rásť lokálne (desktop shell,
lokálne dáta).

## 1. Odsúhlasené rozhodnutia (dávka 1, 25. 8. 2026)

| # | Rozhodnutie | Poznámka |
|---|---|---|
| C-1 | **Nová plná appka na `/chat` a `/chat/<uuid>`.** `/console` zostáva ako dnešná technická konzola (URL sa neláme, odkazy na vlákna žijú), dok nad grafom zostáva ako rýchly prístup. **Tri vstupy, jeden beh** — všetky idú cez `public/js/shared/runclient.js` a `/api/console/run`. | Druhá cesta k modelu, ktorá obchádza dvojfázovú bránu, nesmie vzniknúť. |
| C-2 | **Všetky štyri skupiny funkcií** sú v rozsahu: (a) vlákna, projekty, hľadanie, vetvenie; (b) vizuály a artefakty; (c) orchestrátor agentov; (d) prílohy, hlas, streamovanie. | |
| C-3 | **Orchestrátor = podagenti v behu + vizualizácia.** `spawn_agent` s vlastným profilom nástrojov a stropom krokov; podbehy sa zapíšu do `runs` ako **deti** a UI ich ukáže ako strom. Paralelne **max 2–3**. | **Dvojfázová brána platí aj pre podagentov** — je to tvrdý požiadavok, nie voľba. |
| C-4 | **Lokálny rast: desktop appka + lokálne dáta a súbory.** Silnejší lokálny model (`qwen3-coder:30b`) **nie je** v rozsahu — viď §2. | |

## 2. Tri obmedzenia, ktoré môžu tento šprint zabiť

Menujem ich hneď, nie na konci, pretože každé z nich mení návrh.

### 2a. Kontextový strop je už teraz blízko
Definície 12 nástrojov sú ~2,6k tokenov v každom requeste; pri `num_ctx` 16384
**trinásty nástroj narazí**. `graph_focus` je trinásty a preto je len v profile `graph`.
`spawn_agent` by bol **štrnásty**.

**Dôsledok pre návrh:** `spawn_agent` nesmie pribudnúť do profilu `full`. Dostane
vlastný profil (`orchestrator`) s **úzkou** sadou — a podagent dostane profil podľa
úlohy, nie `full`. Test na strop per profil už existuje a **musí zostať zelený**.

### 2b. Model beží na CPU, ~8 tok/s
`qwen3:8b` je default a je to strop použiteľnosti. Orchestrátor, ktorý spustí päť
podagentov, na tomto stroji **nedobehne**. Preto max 2–3 paralelne a strop krokov na
podagenta. `qwen3-coder:30b` (19 GB) je stiahnutý, ale podľa CLAUDE.md **nedal prvý
token ani za 300 s** — 18,6 GB sa nevojde do Docker VM (~22,9 GiB) a swapuje.
Zdvihnutie WSL2 pamäte je **mimo rozsahu** tohto šprintu (rozhodnutie C-4).

### 2c. Frontend nemá build step a CDN je zámerne preč
`mind.blade.php` a `console.blade.php` načítavajú natívne ES moduly; Google Fonts CDN
bol odstránený, pretože pri jeho nedostupnosti sa appka rozpadla. **Mermaid ani
highlight.js sa preto nesmú tahať z CDN.** Možnosti, ktoré vlna 1 rozhodne meraním:
self-hostovaný mermaid (~1 MB), serverové vykreslenie do SVG, alebo vlastný minimálny
renderer pre podmnožinu diagramov. **Nezavádzať bundler nad `public/js`.**

## 3. Rozsah — čo ÁNO

### `/chat` — samostatná appka
- Route `/chat` a `/chat/<uuid>` pod `auth.ui`, vlastný blade + `public/js/chat/*`
  + `public/css/chat.css`. Layout na celú obrazovku.
- **Vlákna a projekty:** bočný panel, projekty/zložky, premenovanie, pripnutie,
  archivácia. Fulltext hľadanie v histórii (`console_messages`).
- **Vetvenie:** editácia vlastnej správy a znovu-vygenerovanie → nová vetva vlákna,
  pôvodná zostáva. Prepínanie medzi vetvami.
- **Export** vlákna do markdownu.

### Vizuály a artefakty
- Panel artefaktu vedľa konverzácie: zvýraznená syntax, náhľad HTML/SVG, tabuľky,
  diagramy (technológia podľa §2c). Kopírovanie a stiahnutie.
- Streamovaný markdown zostáva na zdieľanom `renderMarkdown` — **žiadna druhá kópia**.

### Orchestrátor agentov
- Nástroj `spawn_agent(task, profile, max_steps)` v novom profile `orchestrator`.
- `runs` dostane `parent_run_id` → podbehy sú deti, log behov ich ukáže ako **strom**.
- Vizualizácia priebehu: kroky, nástroje, tokeny, čas, náhľady diffov — nad existujúcou
  obrazovkou Runy, nie druhá implementácia.
- **Dvojfázová brána platí aj v podagentovi**; zaparkovaný zápis podagenta čaká na
  človeka a rodičovský beh sa nesmie „pretlačiť" okolo neho.

### Prílohy, hlas, streamovanie
- Nahrávanie súborov a obrázkov do konverzácie, čítanie PDF, diktovanie hlasom
  (prehliadačové Web Speech API — **nič do cloudu**), zastavenie a pokračovanie behu,
  **front správ počas behu** (nález A18).

### Lokálny rast
- **Desktop appka:** globálna klávesová skratka, rýchly vstup do chatu, notifikácia
  o dobehnutí behu, offline režim, voliteľné spustenie Dockeru pri starte.
- **Lokálne dáta:** viac koreňov než dnešný `files_root`, indexovanie lokálnych
  dokumentov do pamäte, sledovanie zmien v priečinku a ponuka ako kontext.

## 4. Rozsah — čo NIE

- **Nezavádzať druhú cestu k modelu.** Všetko cez `/api/console/run` a
  `public/js/shared/*`.
- **Nezdvíhať `num_ctx`** ani nemeniť default model (§2a, §2b).
- **Nezavádzať bundler nad `public/js`** ani CDN závislosť (§2c).
- **Nezavádzať bash/shell tool** do behu. Appka je verejne tunelovaná cez ngrok.
- **Nepremenovávať** `console_*` tabuľky, `hades.console.*` kľúče ani `Console*` triedy
  — migrácia bez čitateľa.
- **Neobchádzať `PathGuard`.** Prílohy ani nové korene to nesmú oslabiť: cesty sa
  **odmietajú, nesanitizujú**.
- Nemeniť hodnoty palety; kánon akcentu drží.

## 5. Akceptačné kritériá

1. `php artisan test` zelené, **≥ 475 passed**, 0 failed.
2. MariaDB filter (`ScreenParity|HybridRecall|RecallBench|ConsoleTools|McpTools`) —
   0 skipped, 0 failed.
3. **Test na strop tokenov per profil zostáva zelený**, vrátane nového `orchestrator`.
   Kalibrovať: umelý nárast definície musí test zhodiť.
4. **Dvojfázová brána v podagentovi dokázaná testom**: zápisový tool podagenta zaparkuje,
   turn skončí bez rámca `end`, beh sa obnoví len z `/api/console/decide`.
5. **Podagent nesmie eskalovať profil.** Test: podagent vyžiadaný s profilom `graph`
   nedostane súborové tooly ani keď si ich vyžiada.
6. Prílohy: **PathGuard neoslabený** — test, že cesta mimo povolených korenov sa
   odmietne, aj cez prílohu.
7. `/chat` je pod `auth.ui`; bezpečnostná prehliadka pokrýva upload, nové korene
   a `spawn_agent`.
8. Žiadna nová dvojitá deklarácia v CSS (`w4dup.js`, kalibrované z oboch strán).
9. Kontrast: 0 textových párov pod AA na oboch témach, kalibrácia `body` ~16:1.
10. Ikony: každá nová overená **meraním šírky glyfu** (glyf ≈ 1 em), nie odhadom.
11. Migrácie: **mysqldump záloha pred každou**, posledné 3 v `backups/`.
12. `AgentRunner.php` sa mení **len** o to, čo `spawn_agent` naozaj vyžaduje.

## 6. Riziká

| Riziko | Ako ho držím |
|---|---|
| Kontextový strop (§2a) | `spawn_agent` mimo `full`; test na strop je brána. |
| CPU nezvládne podagentov (§2b) | max 2–3 paralelne, strop krokov, merať čas na prvý token. |
| Mermaid/CDN (§2c) | vlna 1 rozhodne **meraním** veľkosti a času, nie preferenciou. |
| Prílohy = nová útočná plocha | povinná bezpečnostná prehliadka; PathGuard sa neoslabuje. |
| Podagent obíde bránu zápisov | test ako akceptačné kritérium 4 a 5. |
| Dve session v jednom strome | pred commitom `git diff --cached --name-only`, stageovať explicitne, nikdy `git add -A`. |
| Horúce súbory medzi agentmi | delenie **podľa súborov**, koľaje paralelne len bez spoločného súboru. |

## 7. Výsledok (25. 8. 2026)

**18 agentov v troch vlnách** (4 + 7 + 7), commitnuté a pushnuté na `feat/hades-ux`.
Plánoval som 20; vlny vyšli na 18, pretože integračného agenta som do vlny 3 nedal —
a to bola chyba, viď nižšie.

### Čo je hotové

- **`/chat` a `/chat/<uuid>`** pod `auth.ui`: layout na celú obrazovku (vlákna,
  konverzácia, artefakt), beh napojený cez zdieľaný `runclient` — **tri vstupy, jeden
  beh**. Zmerané: mriežka `268/704/0`, prepnutie artefaktu `268/324/380`.
- **Orchestrátor:** `spawn_agent`, profil `orchestrator` (2 tooly, 626 tok proti stropu
  680), `Subagent`, `AgentParked`, strom podbehov v logu, vizualizácia stromu v UI.
- **Vlákna, projekty, vetvenie, hľadanie, export** — všetko so serializérom a paritou.
- **Prílohy** (MIME whitelist, náhodné meno na disku, sha256, PDF → text), **hlas**
  (prehliadačové Web Speech API, nič do cloudu), **front správ počas behu**.
- **Zvýrazňovanie kódu** vlastným ~1,8 kB zvýrazňovačom; **mermaid sa nerobí** (§7b).
- **Desktop appka:** globálna skratka, rýchly vstup do chatu, notifikácia o dobehnutí,
  offline režim, voliteľné spustenie Dockeru (defaultne vypnuté).
- **Lokálne korene** + inkrementálne indexovanie dokumentov do pamäte.

### Kde ma review zachránil

Finálny review vrátil **KRITICKE** a najhorší nález bol môj: `chat.blade.php` má jediný
`<script type="module">`, `main.js` importoval len `run.js`, a **ostatných sedem modulov
vlny 3 sa na stránku nenačítalo vôbec** — celá vlna bola mŕtvy kód. Príčina je
orchestračná: vo vlne 3 nebol integračný agent, takže každý dodal svoj kus a nikto
nevlastnil ich zapojenie. Po oprave sa načíta všetkých 10 modulov (zmerané, 200, bez
chýb v konzole).

Ďalej boli skutočné a opravené:
- **Vetvenie bolo kozmetika** — `AgentRunner` zakladal správy bez `branch_id` a
  `history()` čítalo okno nad vláknom, teda po odbočení práve tie `id`, ktoré aktívnej
  vetve nepatria.
- **Dekompresná bomba v PDF** — `gzuncompress`/`gzinflate` bez `max_length` v cykle;
  deflate dáva ~1000:1, takže 8 MB upload nafúkne gigabajty v jednom z ôsmich workerov.
- **„Povoliť vždy" na karte podagenta** — nastavovalo `auto_accept` na jeho vlákne, čím
  z druhej strany rušilo to, čo `Subagent::start()` zámerne nededí. Zavreté na klientovi
  aj na serveri (aj `PATCH` na vlákno podagenta `auto_accept` zahodí).
- **Prílohy nemali ani jednu route** (celá funkcia nedosiahnuteľná, UI klamalo),
  zametač nebol naplánovaný, a `ChatScreen` sľuboval plochu pre AI, ktorú nikto
  nevolal → `mind_chat_search` + riadok v paritnom registri.

Pri poslednom z nich test pinujúci zoznam MCP nástrojov padol — a **správna oprava bola
presunúť nový tool na koniec, nie prepísať test**: ten test existuje presne preto, aby
preradenie toho, čo vidí živá session, neprešlo nepozorovane.

### Testy

sqlite **589 passed / 45 skipped / 0 failed** (na začiatku 475). MariaDB
(`ScreenParity|ConsoleTools|McpTools|HybridRecall|RecallBench`) **121 testov, 0
padnutých**. Parita narástla z 262 na 499 asercií. Migrácie (5) nad svežou zálohou,
zálohy prerezané na tri.

**Tri brány boli kalibrované rozbitím naschvál:** budget test padá na 701 > 680,
eskalácia profilu padá po pridaní `full` do `CHILD_PROFILES`, a parkovanie padá, keď
`drain()` prestane chytať `AgentParked`. Pri tej tretej som **najprv trafil zlý `catch`**
(`resume()` namiesto `drain()`) a test prešiel — keby som to nechal tak, hlásil by som
overenú bránu, ktorú som neotestoval.

### Zostáva

- **Zaparkovaný zápis podagenta sa po obnove stránky nedá rozhodnúť:**
  `ThreadController::payload()` posiela `awaiting` = `pendingToolCall()` TOHTO vlákna,
  takže pending call dieťaťa v payloade nie je. V tom istom sedení bez F5 to funguje.
- `/console` a dok rámce `agent_*` nepoznajú (`runclient.js` ich hodí do `default:`) —
  beh s podagentom tam prežije, ale zaparkované dieťa sa v UI neukáže.
### Drobné z review — zavreté (25. 8. 2026)

Sedem z jedenástich, a jedno z nich malo väčšiu cenu než veľkosť:

- **`runclient.js` nepoznal rámce `agent_*`** — padali do `default:`, takže `/console`
  a dok beh s podagentom prežili, ale **zaparkované dieťa neukázali** a klient hlásil
  „beh sa skončil bez odpovede". `route()` ich teraz obsluhuje, `agent_wait` ukončí ťah
  ako `permission` a `state.awaiting` nesie `thread`. Vnorená obálka `{t:'agent'}`
  zámerne do `route()` nechodí.
- **Dva pisatelia jedného stavu:** `chat/run.js` si `R.awaiting` nastavoval sám, a keďže
  posiela `R` ako `state` klienta, písali doň obaja. Dnes rovnaký tvar, prvýkrát pri
  zmene dve pravdy. Vlastníkom je zdieľaný klient.
- `RipgrepTool::DENY_GLOBS` **odmieta koreň príloh** — `PathGuard` ho odmietal pri čítaní
  jedného súboru, ale `grep`/`glob` idú cez `rg`, ktorý o `PathGuard`e nevie, takže
  obrana visela na tom, že `rg` ctí `storage/app/.gitignore`. To je náhoda, nie pravidlo.
- `tray.js` menoval **tri neexistujúce tooly** (`mind_forget`, `file_write`, `file_edit`)
  → skutočná šestica.
- **Throttle na `/console/search`** (`LOWER(content) LIKE` sken nad celou tabuľkou).
- **Fokus po prepnutí vetvy** — `loadThread()` prekreslí pás a prvok s fokusom zmizne
  (tá istá trieda ako P3); vracia sa na pilulku s `aria-current`.
- **Dva `aria-live` regióny si prekričali** hlásenie o vetve (`role="status"` na
  viditeľnej vete **a** zdieľaný región v tom istom volaní) → jeden región.
- **Slovenské skloňovanie**: „strop 6 kroky" bolo zlé pre každý strop okrem 2–4.
  Použil sa trojtvarový `plural()`, ktorý `threads.js` už exportuje — vzniká tým cyklus
  `render ↔ threads`, overený v prehliadači, že sa rozväzuje pri volaní.

### Vlna 4 — všetky štyri otvorené body zavreté (25. 8. 2026, 5 agentov)

- **Zaparkovaný zápis podagenta sa dá rozhodnúť aj po F5.** Kľúč, ktorý to celé držal:
  `awaiting` nikdy nebolo prázdne — `AgentRunner::park()` vracia do `pending`
  `spawn_agent` call **rodiča**, takže payload nesie id, s ktorým sa nedá urobiť nič.
  Nový **aditívny** kľúč `awaiting_agent` (tvar tool callu + `thread` a `run` dieťaťa)
  hovorí, kam rozhodnutie patrí. Čítajú ho **obe** plochy.
- **CSP je zavedené ako `Report-Only`** (`ContentSecurityPolicy` middleware), politika
  vyšla z merania (`docs/sprint-2026-08-25/MERANIE-CSP.md`). Review našiel, že sa
  **na stránku 401 nikdy nedostalo** — `AuthenticateUi` je v prioritnom zozname a
  odpovedal skôr — a práve tá stránka je celé odôvodnenie `style-src 'unsafe-inline'`.
  Zaradené pred guard, **zmerané**: 401 hlavičku nesie. A posledná neodmeraná direktíva
  je odmeraná: `srcdoc` iframe so `sandbox=""` na `/chat` vytvoril browsing context,
  vykreslil sa (268×357) a pod `frame-src 'none'` **nespôsobil violáciu**.
- **Kopírovanie je jedna implementácia** (`public/js/shared/copy.js`, leaf bez importov).
  Štyri funkcie boli znak po znaku rovnaké — **zmerané, nie odhadnuté**. Jeden skutočný
  rozdiel bol v `equipCode()`: konzola čítala `pre.textContent` pri KLIKU, chat PRED
  zvýraznením. Správna je chatová, pretože `diffHtml()` spája riadky ako `display:block`
  spany **bez `\n`** — po zvýraznení by konzola skopírovala celý diff na jednom riadku.
  Pre konzolu dokázateľne nulový funkčný diff.
- **Podagenti sú aj na `/console` a v doku** (rámce, meta, karta brány na vlákno dieťaťa).

### Najvážnejší nález review: funkcia bola nedosiahnuteľná

`spawn_agent` bol implementovaný, otestovaný a mal celé UI — ale **žiadna plocha
neposielala `profile`**, a ten tool je len v profile `orchestrator`, kým default je
`full`, v ktorom zámerne NIE JE. Celá funkcia bola v prehliadači mŕtva. `/chat` dostal
prepínač profilu v hlavičke; **dokázané zachytením requestu**:
`{"message":"test orchestratora","profile":"orchestrator","thread":"db535b66…"}`.

Je to **druhýkrát v tomto šprinte**, čo agenti postavili niečo nedosiahnuteľné (prvý raz
sedem nenačítaných modulov). Uložené v Hadesovi ako pasca (uzol 2784) s postupom: po
každej vlne si polož otázku *čo presne musí človek v prehliadači urobiť*, a tú cestu
prejdi — u modulov cez `read_network_requests`, u backendu zachytením requestu.

### Testy

sqlite **592 passed / 45 skipped / 0 failed** (na začiatku šprintu 475).
MariaDB **114 testov, 0 padnutých**.

### Dokončené 26. 8. 2026 (posledná vlna, 5 agentov + dorobenie)

- **CDN je preč aj pre skripty.** `d3@7.9.0` a `pusher-js@8.6.0` sú self-hostované
  v `public/js/vendor/` (provenance a sha256 v jeho README, overené proti druhému
  npm mirroru). Z CSP zanikla výnimka `cdn.jsdelivr.net` a `script-src 'self'`
  platí bez vetvenia — **drží to test**, ktorý dovtedy len docblock sľuboval.
- **Kresba bloku kódu a kopírovania je jedna** (`mind.css`); `console.css` a
  `chat.css` majú po jednom per-plochovom pravidle. `mind.css A=0`, `console.css A=0`,
  `chat.css A=0`.
- **Sekcia podagentov nie je dvakrát** (`public/js/shared/agents.js` ako leaf;
  kreslenie zostalo per-plochu). `markAgentWait` dopĺňa `data-thread` na už stojacu
  kartu — dovtedy bola záloha na `state.awaiting` jediná obrana.
- **Mŕtvy stats dok zametený** (`refreshStats`, jeho import, vetva a CSS).
- Konzola po F5 už nehlási cudzí zápis; „zapisuje tento nástroj" má jednu odpoveď
  (serverovú); mŕtvy `copyButton` zmazaný; nereprodukovateľné merania opravené.

### Zostáva (do backlogu, nie do tohto šprintu)

- **`d3@7` a `pusher-js@8` idú z `cdn.jsdelivr.net` bez `integrity`** a nie sú
  v `public/`. CSP povolí host, nie obsah — na verejne tunelovanej appke je to reálna
  plocha. Buď `integrity`, alebo self-hostovať. (CLAUDE.md opravené, uzol 2785.)
- **Sekcia podagentov je teraz dvakrát** — `console/run.js` a `mind/charon.js` majú
  zhodnú štruktúru. Vlna zavrela jednu dvojicu kópií (kopírovanie) a otvorila druhú.
  Vyňať aspoň texty a skladanie meta zlomku do `shared/`.
- **CSS kopírovania je stále dve zhodné kópie** (`console.css` × `chat.css`) — JS je
  jeden, päť pravidiel patrí do `mind.css`.
- Prepnutie CSP na **vynucované** — až po období reálneho používania v Report-Only,
  aby sa zachytilo to, čo syntetická sonda nevie (napr. artefakt od modelu s inline
  `onclick`).
- Drobné z review: mŕtvy `copyButton` v `artifact.js`, konzola po F5 ohlási cudzí zápis
  (karta rodiča nad čítacím `spawn_agent`), `markAgentWait` nedoplní `data-thread` na už
  stojacu kartu, a jedno nereprodukovateľné meranie v `MERANIE-CSP.md` (grep na `url()`
  vracia 7 zásahov, nie 0 — všetky `/fonts/`).
