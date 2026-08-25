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

## 7. Výsledok

*(dopĺňa sa po dokončení)*
