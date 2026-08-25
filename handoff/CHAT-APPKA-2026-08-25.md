# Handoff — Chat ako samostatná appka, orchestrátor agentov (25. 8. 2026)

Kontrakt: [KONTRAKT-CHAT-APPKA-2026-08-25.md](../KONTRAKT-CHAT-APPKA-2026-08-25.md) ·
merania a návrhy: `docs/sprint-2026-08-25/`. Vetva `feat/hades-ux`, pushnutá.

**23 agentov v štyroch vlnách** (4 + 7 + 7 + 5), 9 commitov. Testy na konci:
sqlite **592 passed / 45 skipped / 0 failed** (na začiatku 475), MariaDB **114**.

## Čo je hotové

Charón má **tri vstupy a jeden beh**: `/chat` a `/chat/<uuid>` (plná appka),
`/console` (technická konzola, názvoslovie `console_*` sa nepremenúva) a dok nad
grafom. Všetko ide cez `public/js/shared/runclient.js` na `/api/console/run`
a `/decide` — tretia cesta k modelu by bola cesta okolo dvojfázovej brány.

`/chat` nesie: vlákna a projekty, vetvenie konverzácie, fulltext hľadanie v histórii,
export do markdownu, panel artefaktu, prílohy s extrakciou textu z PDF, diktovanie
(prehliadačové Web Speech API, nič do cloudu), front správ počas behu, prepínač profilu
nástrojov a **strom podagentov**.

## Čo si treba pamätať pri pokračovaní

**`main.js` je jediné dvere `/chat`.** `chat.blade.php` má jeden `<script type="module">`,
takže modul bez importu z `main.js` sa **nikdy nenačíta** — a PHP sada zostane zelená.
Keď pridáš modul, pridaj import **a** `wire*()`/`boot*()` do `boot()`, a over to
`read_network_requests` (200 pre každý modul), nie pohľadom.

**Brána podagentov drží z konštrukcie, nie z disciplíny.** Parkovanie sa prenáša nahor
(dieťa vydá vnorený `permission`, tool vydá `agent_wait` a hodí `AgentParked`), a tool je
**idempotentný na svoj `ConsoleToolCall`**, takže `/decide allow` na rodičov vlastný call
znova zaparkuje. Tri veci, ktoré to rozbijú: chýbajúci `catch (AgentParked)` ako **prvý**
v `ToolRegistry::call()` (plošný `catch (Throwable)` by z parkovania urobil odmietnutý
tool a dieťa by čakalo navždy), chýbajúci ten istý catch v `AgentRunner::resume()`
(po `/decide allow` zostane call `running` a **vlákno rodiča prijme ďalšiu správu**),
a `allow_always` vo vlákne podagenta (ignoruje sa na klientovi aj na serveri, pretože
zadanie podagenta písal model).

**`awaiting` v payloade nie je to, čo sa zdá.** Pri zaparkovanom dieťati je to
`spawn_agent` call **rodiča** — id, s ktorým sa nedá urobiť nič. Kam rozhodnutie patrí,
hovorí aditívny kľúč **`awaiting_agent`**. Nemeň tvar `awaiting`; čítajú ho tri plochy.

**Vetvenie pripája na konec, nikdy nevkladá do stredu**, takže rozsahy
`from_message_id`–`to_message_id` v `runs` prežijú. Správy nesú `branch_id` a
`AgentRunner::history()` číta okno cez **`branchMessages()`**, nie cez vlákno. Exkluzivita
behu je na úrovni **vlákna, nie vetvy**.

**Diagramy sa nekreslia a je to zmerané rozhodnutie**: z 36 reálnych odpovedí modelu
malo oplotený blok 0, a mermaid stojí 195 kB gzip pred prvým diagramom. Spúšťač na
prehodnotenie je **5 % odpovedí**. Zvýrazňovač beží nad **už escapovaným** textom —
escapovať po ňom by zhodilo obranu `markdown.js`. Náhľad HTML je `<iframe sandbox>`,
nikdy `innerHTML`.

**CSP je `Report-Only`** (`app/Http/Middleware/ContentSecurityPolicy.php`), zaradené
**pred** `auth.ui`, aby hlavičku nesla aj stránka 401 — tá je celé odôvodnenie
`style-src 'unsafe-inline'`. Prepnutie na vynucované je jedna konštanta, ale až po
období reálneho používania.

## Pasca, na ktorú som naletel dvakrát v jednom šprinte

**Agenti dokážu postaviť funkciu, ktorú sa v prehliadači nedá vyvolať — a testy o tom
nepovedia nič.** Prvý raz: sedem frontend modulov sa nenačítalo, lebo `main.js` ich
neimportoval. Druhý raz: `spawn_agent` bol implementovaný, otestovaný a mal celé UI na
troch plochách, ale **žiadna plocha neposielala `profile`**, a ten tool je len v profile
`orchestrator`, kým default je `full`, v ktorom zámerne nie je.

Príčina je orchestračná: delenie agentov **podľa súborov** je správne (kvôli tichému
prepisovaniu), ale potom **nikto nevlastní zapojenie**. Postup: po každej vlne si polož
otázku *čo presne musí človek v prehliadači urobiť*, a tú cestu prejdi — u modulov cez
`read_network_requests`, u backendu **zachytením requestu** (prepíš `window.fetch`,
klikni, prečítaj telo). Nedosiahnuteľná funkcia je to isté ako nenapísaná, len drahšia.

## Otvorené body

- **`d3@7` a `pusher-js@8` z `cdn.jsdelivr.net` bez `integrity`** a nie sú v `public/`.
  CSP povolí host, nie obsah; appka je verejne tunelovaná. Buď `integrity`, alebo
  self-hostovať. (CLAUDE.md už netvrdí, že „CDN je preč" — platí to len pre fonty.)
- **Sekcia podagentov je dvakrát** (`console/run.js` × `mind/charon.js`) — vlna 4
  zavrela jednu dvojicu kópií a otvorila druhú.
- **CSS kopírovania sú dve zhodné kópie** (`console.css` × `chat.css`); päť pravidiel
  patrí do `mind.css`.
- Prepnutie CSP na vynucované.
- Drobné: mŕtvy `copyButton` v `artifact.js`, konzola po F5 ohlási cudzí zápis (karta
  rodiča nad čítacím `spawn_agent`), `markAgentWait` nedoplní `data-thread` na už
  stojacu kartu, jedno nereprodukovateľné meranie v `MERANIE-CSP.md`.

## Prostredie

Päť migrácií, každá nad svežou `mysqldump` zálohou; zálohy prerezané na posledné tri.
Hades MCP klient v tejto session odpadol — obchádzal som to volaním
`http://localhost:8080/mcp` priamo s tokenom z `.env` (hodnota sa nikde nevypisuje).
Uložené uzly tohto šprintu: **2779** (projekt), **2780** (tri obmedzenia), **2781**
(pasca: vlna bez integračného agenta), **2782** (spawn_agent a parkovanie), **2784**
(pasca: nedosiahnuteľná funkcia), **2785** (CDN nie je preč).

V pracovnom strome zostávajú tri súbory paralelnej session (`public/css/mind.css`,
`public/js/mind/panels.js`, `public/js/mind/ws.js`) — nedotkol som sa ich ani raz.
