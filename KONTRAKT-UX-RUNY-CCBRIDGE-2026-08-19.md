# Kontrakt — Hades: jeden dizajnový jazyk, log runov, dvojitá plocha

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-konzola` (hlavný checkout, **zdieľaná s druhou session**)
**Veľkosť:** M–L · **Kadencia:** jedno schválenie, potom beh do konca
**Nadväzuje na:** [KONTRAKT-HADES-KONZOLA-2026-08-19.md](KONTRAKT-HADES-KONZOLA-2026-08-19.md) (vlny 0–3 zaplatené), [docs/UX-PLAN-AURA-PARITA.md](docs/UX-PLAN-AURA-PARITA.md)
**Susedný kontrakt:** [KONTRAKT-HADES-KONZOLA-II-2026-08-19.md](KONTRAKT-HADES-KONZOLA-II-2026-08-19.md) — druhá session, prekrývajúci sa rozsah, viď §0

## 0. Kolízia dvoch session a jej rozseknutie (19. 8. 2026, 13:36)

Počas prípravy tohto kontraktu sa zistilo, že **v tom istom checkoute a na tej istej
vetve pracuje ďalšia živá Claude Code session**:

- commit `9eeaf28` „Build the console, and let it stop the model from writing junk"
  o 13:33:09 — commitla necommitnutú vlnu 3 (konzolu),
- za 10 minút prepísala `app/Services/Console/AgentRunner.php` (644 → 651 r.),
  `CLAUDE.md` a `config/hades.php`; o 13:54 mala rozpracované
  `McpController.php` a `tests/Feature/McpToolsTest.php`,
- napísala si `KONTRAKT-HADES-KONZOLA-II-2026-08-19.md`, ktorého jadro
  („orchestrácia agentov, programové ovládanie — konzolu má vedieť riadiť skript,
  scheduler alebo iná AI" + TUI + desktop okno) sa prekrýva s pôvodnou vlnou D
  tohto kontraktu.

**Rozhodnutie používateľa:** tento kontrakt sa **zúži na to, čo druhá session
nerobí**. Ovládanie Claude Code z Hadesa, bridge daemon a orchestrácia behov
**prechádzajú na druhú session** a z tohto rozsahu vypadávajú (§6).

**Dôsledok pre návrh, nie len pre rozsah:** všetko, čo tu staviam, musí byť
navrhnuté tak, aby sa **nedotýkalo hot ciest, ktoré druhá session prepisuje** —
menovite `AgentRunner.php` a `McpController.php`. Preto je log runov agregát nad
existujúcimi tabuľkami a nie zápis v behu (§4).

## 1. Cieľ

1. **Jeden dizajnový jazyk pre celý Hades** — graf (7 obrazoviek) aj konzola hovoria
   tým istým názvoslovím, tokenmi a hustotou. Technickejšie, čitateľnejšie,
   jednoduchšie: menej komponentov, menej duplikátov, viac dát na obrazovku bez
   straty vzduchu.
2. **Log runov** — každý beh konzoly je perzistovaný, prehliadateľný na vlastnej
   obrazovke a čitateľný pre AI v tom istom tvare.
3. **Dvojitá plocha: UI = MCP.** Čo vidí človek na obrazovke, to AI dostane jedným
   MCP toolom v rovnakom tvare, z jedného serializéra, a paritu stráži test.

Prierezovo: appka je pamäť pre AI, do ktorej vie vojsť aj človek. Ani jedna z tých
dvoch plôch nesmie byť odvodená z druhej dohadom.

## 2. Zistený stav (19. 8. 2026, pred štartom)

- Appka beží (app, caddy, mariadb, redis, reverb, queue, scheduler), logy čisté.
- **Baseline testy zelené:** 326 passed, 43 skipped, 0 failed (80,9 s).
- **Záloha DB:** `backups/hades-2026-08-19-pred-ux-runy.sql` (17 MB).
  Pozn.: v tomto image **nie je `mysqldump`**, volá sa `mariadb-dump`.
- Vlna 3 (konzola) je commitnutá druhou session v `9eeaf28`: 11 frontend modulov
  (2 191 r.), `console.css` 818 r., 14 toolov, `AgentRunner` 651 r.
- Graf: `mind.css` ~3 700 r., 31 ES modulov, 6 screen modulov + Graf.
- **`console.blade.php:22–23` načítava OBA stylesheety.** `mind.css` teda platí aj
  na `/console`; duplikáty nie sú dva oddelené svety, ale kaskádový boj v jednom
  dokumente. To mení optiku celej vlny B.
- **MCP plocha má dnes 9 toolov a všetky sú nad uzlom** (nájdi / prečítaj / zapíš).
  Ani jeden nie je ekvivalentom obrazovky → parita ≈ 15 %.
- **Log behov naozaj neexistuje** (žiadna `runs` / `run_events`; `sync_runs` je
  brain-sync, nie toto; `tokens_per_second` sa počíta a nikde neukladá).
  **Ale dáta z veľkej časti v DB už sú:** `console_messages.tokens_in/out`,
  `duration_ms`, `stop_reason`, `model` a celá `console_tool_calls`.
- `AgentRunner` **nevysiela žiadny event** (`grep event(|dispatch(` = 0 zásahov).
- Precedens zdieľaného serializéra v projekte existuje: `GraphService::payload()`
  živí interné `/api/mind` aj externé `/api/v1/graph`.

### Baseline dvojitých deklarácií a farieb (zmerané, vlna A)

| Súbor | A (identické) | B (iná hodnota) | C (media/keyframes) | raw hex mimo `:root` |
|---|---|---|---|---|
| `mind.css` (743 blokov) | 0 | 4 (menovaná `--card-pad` výnimka) | 15 | 0 |
| `console.css` | 0 | 4 | 8 | 0 |

Kritérium §7/1 („žiadne nové dvojice") sa meria voči **týmto** číslam.

## 3. Schválené rozhodnutia

| # | Rozhodnutie |
|---|---|
| 1 | **Rozsah UX:** konzola + graf, jeden jazyk. Nie rebrand — zjednotenie názvoslovia, hustoty a čitateľnosti. |
| 2 | **Log runov:** obrazovka **Runy** + DB. Prompt, model, tooly, diffy, tokeny, tok/s, trvanie, výsledok, chyby; filter + detail + znovu spustiť. Čitateľné pre AI cez MCP. |
| 3 | **Hĺbka zmien:** stredná. Zlúčiť duplikáty komponentov, density tokeny, technická čitateľnosť, prekresliť Dnes + konzolu. Počet obrazoviek ostáva (+ Runy). |
| 4 | **AI + človek:** dvojitá plocha UI = MCP, jeden serializér, parity test. |
| 5 | **Baseline:** zelené testy pred stavbou (splnené: 326/0). |
| 6 | **Kolízia:** zúžiť sa na to, čo druhá session nerobí (§0). Bridge a orchestrácia sú jej. |
| 7 | **Vetva:** pokračovať na `feat/hades-konzola` v hlavnom checkoute (Docker servuje koreň repa). |
| 8 | **Vlna E pokrýva všetkých 8 obrazoviek**, nie 6 — audit ukázal, že Smernica a Graf sú tie dve, kde sa plochy dnes rozchádzajú najviac. |

## 4. Predvolené rozhodnutia (moje, dajú sa zmeniť)

- **Runy sú agregát, nie tretia kópia dát.** Tabuľka `runs` drží iba to, čo
  agregát potrebuje, a členstvo správ v behu nesie **rozsah id**
  (`from_message_id` – `to_message_id`). `console_messages.id` je autoincrement a
  jeden ťah je v rámci vlákna súvislý, takže rozsah je presný.
  **Dôsledok: `AgentRunner.php` sa nemení vôbec** — beh otvára a zatvára
  `RunController`, ktorý je jeho vstupný bod. To je priama reakcia na §0.
- **Žiadny `run_id` do `console_messages` ani `console_tool_calls`.** Bola by to
  migrácia na dvoch hot tabuľkách a zápis v hot ceste, teda presne to, čomu sa
  kvôli kolízii chceme vyhnúť.
- **Serializéry:** `app/Serializers/Screen/*` — jedna trieda na obrazovku,
  endpoint vráti `data()`, MCP tool vráti `dropEmpty(project(data(), FIELDS_AI))`.
  Rozdiel plôch je **jeden deklarovaný zoznam kľúčov**, nie dva kusy kódu.
- **`mind_recall` sa v tomto šprinte nezjednocuje.** Audit našiel, že jeho tvar
  existuje dvakrát (`McpController.php:470–520` × `MindRecallTool.php:89–120`) a už
  sa rozišiel — ale druhá session má `McpController.php` rozpracovaný. Zápis
  o rozchode ide do auditu a do CLAUDE.md; kód ostáva.
- **`verify` sa z MCP nedáva.** Overenie poznatku je akt človeka; AI by si vedomie
  odobrila sama.
- **Runy v raile** patria do skupiny ZÁZNAMY vedľa Denníka a Rozhodnutí.
- **Density prepínač** (Pohodlné / Cozy / Kompaktné) ide do Nastavení.
- **Konzolové CSS sa nerozbíja.** `console.css` dostane tokeny a primitívy
  z `mind.css`, ale prepisujem ho **minimálne a aditívne** — druhá session v tom
  súbore môže robiť tiež.
- **Smer zlučovania je k lepšie napísanému kódu, nie k staršiemu.** Audit našiel
  prípad, kde je novšia konzola správnejšia než graf: `console.css` má `.sr-only`
  a jedno globálne `:focus-visible`, kým `mind.css` `.sr-only` nemá vôbec
  a `--focus-ring` opakuje 34× per-komponent. Promuje sa konzola do grafu.

## 5. Rozsah — čo ÁNO

### Vlna A — Baseline + orchestrovaný audit ⚠️ ČIASTOČNE
- Zelené testy (326/0), záloha DB, 5 paralelných read-only audit agentov.
- **Dobehli tri:** dizajnový systém, IA a toky, parita AI plochy.
- **Padli dva na strop účtu** (17:00 reset): čitateľnosť a hustota, prístupnosť.
  Dobiehajú po resete; ich nálezy sú vstup do vlny B, nie jej podmienka.
- Výstup: `docs/UX-AUDIT-2026-08-19.md`.

### Vlna B — Jeden dizajnový jazyk (graf + konzola)
- Density tokeny (`--card-pad` do `:root`, `--row-pad-*`, `--control-h`) +
  `--chart-1..8`, `--chart-h*` a `--stream-w`, light aj dark. Kde stačí alias,
  pridať alias (`--card-radius`, `--shadow-*`, `--transition*`, `--section-gap`,
  `--page-h1`, `--kpi-value`).
- Zlúčiť paralelné komponenty do jedného názvoslovia podľa nálezov auditu:
  `.pc-btn.btn-*` → `button.primary/.ghost/.danger`, `kbd` z 5 kresieb na 1,
  karta konzoly do zjednotenej karty, `.ms` ikonové rozmery na `--icon-*`.
- Promovať `.sr-only` a globálne `:focus-visible` z konzoly do `mind.css`.
- Prekresliť **Dnes** (KPI strip → hero graf → dva stĺpce → tabuľka) a **konzolu**
  (tok správ, karty toolov, diff, permission prompt) — konzolu aditívne.
- Technické tabuľky hustejšie; zmazať 16 inertných opakovaní `font-variant-numeric`
  (globálne to už rieši `body`).
- Density prepínač v Nastaveniach; `prefers-reduced-motion` dotiahnuť na canvas.
- Nálezy prístupnosti z auditu: fokus, klávesnica, cieľové veľkosti, ARIA.
- Každá zmena CSS overená výmenou stylesheetu nad tým istým DOM (`cssswap.js`).

### Vlna C — Runy: schéma, agregát, obrazovka
- Migrácia `runs` (záloha z vlny A už existuje).
- `RunRecorder` — otvorenie a zatvorenie behu v `RunController`, agregát nad
  `console_messages` a `console_tool_calls` cez rozsah id.
- Obrazovka **Runy**: zoznam s filtrom (model, stav, dátum), detail behu s časovou
  osou krokov, tool callmi, diffmi a spotrebou, akcia „spustiť znovu".
- MCP tooly `mind_runs` (zoznam) a `mind_run` (detail) — **aditívne**.

### Vlna E — Dvojitá plocha (UI = MCP)
- `app/Serializers/Screen/*` pre **všetkých 8** obrazoviek: Dnes, Denník, Knižnica,
  Rozhodnutia, Kontrola, Smernica, Graf, Runy.
- Zabiť existujúce rozchody, ktoré audit dokázal: Smernica si markdown skladá
  v prehliadači, hoci ho server posiela (`smernica.js:209,216–279` ×
  `DirectiveController.php:190`); Denník počíta projekty z 50 načítaných záznamov,
  hoci server posiela všetky (`dennik.js:63–69`); skupina „bez projektu" je
  klientska heuristika (`dennik.js:47–50`); Rozhodnutia berú názov oblasti
  z grafového payloadu, lebo `/api/decisions` ho nevracia (`rozhodnutia.js:94,175`).
- **Parity test, 4 vrstvy:** (1) pokrytie — každá obrazovka má route aj tool,
  (2) hodnoty — endpoint aj tool nad tou istou fixture, každý spoločný kľúč `===`,
  (3) deklarované agregáty sedia s nezávislým prepočtom, (4) frontend nesmie čítať
  koreňový kľúč, ktorý serializér nedáva. Zámerne netestuje DOM, screenshoty,
  plurály, `timeAgo`, farby — kozmetická zmena UI ho nezhodí.

### Vlna F — Kvalitná brána
- Celý balík zelený, nové testy na runy a paritu.
- Preklik v prehliadači (headless Chrome, `puppeteer-core`) so screenshotmi
  pred/po, na tmavej aj svetlej téme, všetky obrazovky.
- Jeden review agent (`effort: high`) proti tomuto kontraktu; security prehliadka
  pre nové endpointy (`/api/runs*`) — appka je verejne tunelovaná cez ngrok.
- `composer audit`, aktualizovať CLAUDE.md, README, sekcia Výsledok, handoff súmar,
  `mind_decision` + `mind_learn`.

## 6. Rozsah — čo NIE

**Prenechané druhej session (pôvodná vlna D):**
- Ovládanie Claude Code z Hadesa, host bridge daemon, spúšťanie `claude.exe -p`.
- Orchestrácia paralelných behov, fan-out a zlúčený report.
- TUI a desktop okno, programové ovládanie konzoly skriptom či schedulerom.
- Zistenie, ktoré tejto session zostáva ako dôkaz vykonanej práce a druhá session
  ho môže použiť: `claude.exe` je na hoste v
  `%APPDATA%\Claude\claude-code\<verzia>\claude.exe` (dnes 2.1.229), podporuje
  `-p`, `--output-format stream-json`, `--input-format stream-json`,
  `--permission-mode`, `--session-id`, `--resume`, `--add-dir`, `--agents`,
  `--append-system-prompt`, a **beží pod existujúcou autentifikáciou desktop
  appky, teda bez `ANTHROPIC_API_KEY`**. Cestu treba **hľadať**, nie zadrôtovať —
  verzia je jej súčasťou. Node na hoste v24.18.0.

**Mimo rozsahu úplne:**
- Žiadne zníženie počtu obrazoviek ani zlučovanie Denníka s Rozhodnutiami.
- Žiadna zmena farebných hodnôt ani rebrand; kánon akcentu platí ďalej.
- Žiadny build step pre frontend, žiadna migrácia na React/lucide.
- Žiadne premenúvanie tokenov na Aura názvy (`--sp-1` má 151 volajúcich).
- `.badge` × `.chip` sa nezlučuje — statický vs interaktívny, nesie kánon teal.
- Žiadna zmena tvaru `mind_recall`, žiadny zásah do `McpController.php`.
- Žiadna zmena `/api/v1/*` kľúčov.
- Žiadne mazanie uzlov ani dát autonómne. Žiadne plošné reformaty CSS/JS.
- Žiadny `run_id` do hot tabuliek, žiadny zásah do `AgentRunner.php`.
- Žiadny upgrade MariaDB, žiadny ngrok/deploy krok.

## 7. Akceptačné kritériá

1. Graf aj konzola používajú jedno komponentné názvoslovie; detektor dvojitých
   deklarácií nehlási viac dvojíc než baseline v §2; density prepínač funguje na oboch.
2. Dnes a konzola prekreslené, screenshoty pred/po v reporte, tmavá aj svetlá téma.
3. Kontrast: každý text a interaktívny stav spĺňa WCAG AA, mimo vedome menovaných
   výnimiek pre vláskové hrany na plátne.
4. Nálezy prístupnosti s efektom „vysoký" z auditu sú opravené alebo písomne
   odmietnuté s dôvodom.
5. Každý beh konzoly sa objaví v `runs` a na obrazovke Runy so správnymi tokenmi,
   trvaním a tool callmi; „spustiť znovu" funguje. `AgentRunner.php` je v diffe
   nezmenený.
6. `mind_runs` a `mind_run` vracajú ten istý obsah ako obrazovka; parity test zelený.
7. Parity test padne, keď sa obrazovka a MCP rozídu, a nepadne pri kozmetickej
   zmene UI (dokázať oboma smermi — jeden úmyselný rozchod, jedna kozmetická zmena).
8. Celý testovací balík zelený (326 + nové).
9. CLAUDE.md, README a tento kontrakt aktuálne; handoff súmar napísaný.

## 8. Otvorené riziká

| Riziko | Prečo hrozí | Ako to riešim |
|---|---|---|
| **Druhá session v tých istých súboroch** | Jedna vetva, jeden checkout, dva plány | Nulový zásah do `AgentRunner.php` a `McpController.php`, aditívne zmeny v `console.css` a `console.blade.php`, časté malé commity, pred každým commitom `git log` na cudzie zmeny |
| Strop účtu (reset 17:00) | Dva audit agenti už na ňom padli | Práca pokračuje v hlavnej smyčke bez fan-outu; agentové vlny sa plánujú po resete |
| Rozsah id ako členstvo v behu | Súbežné ťahy v jednom vlákne by rozsah prekryli | Vlákno beží jeden ťah naraz (`RunController` + throttle), test na súbežnosť |
| UX prepis rozbije graf | 3 700 r. CSS, 31 modulov, cyklické importy | `cssswap.js` nad tým istým DOM, screenshot diff, hoistované `export function` |
| Dvojitá plocha sa rozíde | Dva zdroje pravdy | Jeden serializér + parity test, nie dve implementácie |
| Rast rozsahu | Päť vĺn | Pri prekročení odhadu o > 30 % zastaviť a ozvať sa |

## 9. Výsledok (20. 8. 2026)

**Hotové: vlny A, C, E. Zaparkované: vlna B a obrazovka Runy. Vlna F čiastočne.**

### Čo stojí v kóde

| Commit | Čo |
|---|---|
| `318fe2b` | Audit troch optík + zúžený kontrakt |
| `0c845a4` | Tabuľka `runs`, `RunRecorder`, endpointy, `ScreenSerializer`, 16 testov |
| `b42915f` | MCP `mind_runs` / `mind_run` + parity test (7 testov) |
| `196fe04` | `mind:reap-runs` + scheduler |
| `1e3dd66` | Dnes + Denník na serializér, `mind_today` / `mind_journal` |
| `e340983` | Knižnica, Smernica, Rozhodnutia, Kontrola + ich štyri MCP dvojčatá |

**Testy: 421 passed, 45 skipped, 0 failed** (107 s). Parity test aj proti MariaDB:
7 testov, 344 asercií (na sqlite 322 — tých 22 navyše je porovnanie Smernice,
ktoré sqlite nezvládne pre `COLLATE utf8mb4_unicode_ci` v `searchNodes`).

**Parita plôch: z ~15 % na 8 obrazoviek z 8.** MCP má 20 toolov (12 nad uzlom
+ 8 nad obrazovkami). Každá obrazovka číta ten istý `data()` ako jej MCP dvojča;
rozdiel plôch je deklarovaný zoznam kľúčov, nie druhá implementácia.

### Splnené kritériá

4 (nálezy prístupnosti — čiastočne, audit nedobehol), 5 (`AgentRunner.php`
v celom diffe nedotknutý), 6, 7 (citlivosť dokázaná oboma smermi), 8, 9.
**Nesplnené: 1, 2, 3** — všetky tri sú vlna B a obrazovka Runy.

### Zabité rozchody plôch, každý s číslom

- **Smernica** bola najhoršia: server skladal markdown, prehliadač ho zahodil
  a poskladal si vlastný. Zmerané pred zmenou na troch úlohách: líšili sa na
  **20/48, 15/42 a 23/46 riadkoch** (PHP kráti na `...`, JS krátil na `…`).
  Dokument, ktorý si človek skopíroval, a dokument pre AI boli iné texty.
  Serverovi chýbal jediný údaj — výber v checklistoch — takže sa doplnil, nie
  že by sa klientsky builder zachoval.
- **Denník** počítal čipy projektov z 50 načítaných záznamov, takže čip sľuboval
  číslo, ktoré zoznam nedal. Skupina „bez projektu" bola klientska heuristika:
  človek videl jednu skupinu, AI 12 uzlov typu `mystifying-mclaren-23750a`.
- **Dnes** dostávalo 8 sessions a kreslilo 6 — dve existovali len pre AI.
  Neznámy stav synchronizácie sa mlčky prekresľoval na „v poriadku".
- **Rozhodnutia** brali názov oblasti z grafového payloadu, lebo vlastný
  endpoint ho nevracal.
- **Kontrola** mala fallback `total ?? items.length`, čo bola tichá lož pri
  fronte nad 100.
- **Knižnica** krátila tagy na 5 v pohľade: uzol s 8 tagmi vyzeral ako s 5, kým
  AI dostala všetkých 8. Po oprave sa objavilo **197 čipov „+N"**, ktoré človek
  dovtedy nikdy nevidel.
- Knižnica pre AI je **13,5 kB proti 508 kB** pre človeka (2,7 %) — ten istý
  serializér odpovedá na užšiu otázku, nie druhý endpoint na inú.

### Dve veci, ktoré návrh zmenila kolízia, a obe k lepšiemu

1. **Cena behu sa sčítava z `console_messages`, neberie sa z rámca `end`.**
   Vzniklo to ako obchádzka `AgentRunner`a a ukázalo sa ako jediná správna
   voľba: ťah, ktorý zaparkuje na potvrdení zápisu, `end` **nikdy nepošle**,
   takže cena jeho prvého segmentu by z logu vypadla. Vedľajší efekt je pravdivé
   tok/s — správy nesú generovací čas, beh nesie wall clock.
2. **Členstvo správ v behu nesie rozsah id**, nie stĺpec `run_id`. Žiadna
   migrácia na dvoch hot tabuľkách, žiadny zápis v hot ceste.

### Bezpečnosť

`/api/runs`, `/api/runs/{uuid}`, `/api/runs/{uuid}/rerun` majú poradie
cookies → session → `auth.ui` → CSRF a **nie sú** v externom Bearer mirrore
`/api/v1/*` (overené `route:list`). „Spustiť znovu" vedome nespúšťa nič — vracia
zadanie a nový ťah ide bránou cez `/console/run`, aby nevznikla druhá cesta
k modelu, ktorá obchádza potvrdzovanie zápisov.

**Nové vystavenie, ktoré treba vedieť:** `mind_runs` a `mind_run` sprístupňujú
cez MCP **texty promptov a výsledky toolov z konzoly**, ku ktorým MCP predtým
nemalo prístup. Dáta samotné nie sú nové (`AgentRunner` ich do
`console_messages` ukládá tak či tak) a čitateľom je ten istý človek, ktorý drží
UI token. Ale ak sa niekedy do promptu vloží tajomstvo, odteraz vedie k nemu aj
cesta cez MCP. Redakcia cez `SecretScanner` sa **nezaviedla** — na ploche AI by
rozbila paritu, na oboch plochách by menila to, čo človek vidí, a pôvodné
uloženie tým nezmizne. Je to otvorený bod, nie hotová vec.

`composer audit`: jeden medium nález, `league/commonmark` 2.8.3,
CVE-2026-71478 (`AttributesExtension` unsafe-link bypass). **V tejto appke
nevyužiteľný** — knižnica je tranzitívna, grep na `AttributesExtension`,
`CommonMark`, `Str::markdown` a `commonmark` naprieč `app/`, `config/`
a `resources/views/` nedal ani jeden zásah. Update `vendor/` sa vedome
neurobil: worktree `.claude/worktrees/hades-klient` má `vendor` ako symlink na
tento checkout a v tom čase tam bežala paralelná session. Flagnuté ako
samostatná úloha.

### Prečo vlna B a Runy nedobehli

Nie pre rozsah ani pre chybu. V hlavnom checkoute paralelne bežal **schválený
branding šprint** (`KONTRAKT-BRANDING-HADES-2026-08-19.md`, strop 600k), ktorý
prefarbuje akcent na amethyst, mení znak a premenúva konzolu na **Charón** —
teda prepisuje presne tie tokeny, na ktorých vlna B stála. Zdieľaný pracovný
adresár znamená, že tam nie je merge, ale **posledný zápis vyhráva bez
varovania**, takže `public/css/mind.css`, `resources/views/mind.blade.php` ani
`console.blade.php` som neotvoril na zápis vôbec.

**Dva padnuté audity (čitateľnosť a hustota, prístupnosť) sa vedome nespúšťali
znova** — merali by kontrast palety, ktorá sa práve mení. Po dosadnutí brandingu
budú tie čísla platné; teraz by boli odpad.

### Ďalší krok

1. Nechať dobehnúť branding, potom pustiť tie dva audity nad **finálnou** paletou.
2. Vlna B nad finálnymi tokenmi + obrazovka Runy (backend na ňu čaká hotový:
   `/api/runs*` aj `mind_runs`/`mind_run` bežia a sú otestované).
3. Vlna F dokončiť: preklik so screenshotmi pred/po, review agent `effort: high`.

### Otvorené body

- Redakcia tajomstiev v logu behov (viď Bezpečnosť).
- `KniznicaScreen::pathFor()` × `MindService::sourcePathOf()` — dve implementácie
  cesty k .md; zjednotenie by dnes otvorilo v overlay cudzí dokument. Flagnuté.
- `mind_recall` má **dva tvary** (`McpController.php` × `MindRecallTool.php`) a už
  sa rozišli. Z rozsahu vypadlo, lebo `McpController` mala rozpracovaný druhá
  session. Detail je v `docs/UX-AUDIT-2026-08-19.md`.
- Definície toolov v každom MCP requeste narástli o 8 nástrojov. Konzolový
  kontextový strop to nezasahuje (to je `ToolRegistry`, iná sada), ale sessions
  Claude Code platia väčší tool list.
