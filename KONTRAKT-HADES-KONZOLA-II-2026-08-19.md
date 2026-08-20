# Kontrakt II — Hades: plnohodnotný klient, orchestrácia agentov, programové ovládanie

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-klient` (worktree `.claude/worktrees/hades-klient`)
**Nadväzuje na:** `KONTRAKT-HADES-KONZOLA-2026-08-19.md` (vlny 0–3 hotové, vlna 4 otvorená)
**Súbežný kontrakt:** `KONTRAKT-UX-RUNY-CCBRIDGE-2026-08-19.md` — iná session, vetva
`feat/hades-konzola`, vlastní orchestráciu, cc-bridge, log runov a redizajn UI
**Veľkosť:** L (agentový fan-out po vlnách)

## 1. Cieľ

Z konzoly urobiť **plnohodnotného klienta na ovládanie Hadesa s možnosťami Claude Code**:
kódovanie (vrátane reálneho spúšťania testov), HTML reporty, bežné chatovanie,
orchestrácia agentov. K webu pridať **lokálny program v dvoch podobách** (terminálový
TUI + desktop okno) a **programové ovládanie** — konzolu má vedieť riadiť skript,
scheduler alebo iná AI, nie len človek v okne. Doplniť jazykové modely: Anthropic
ako prepínateľný provider + odmeraný silnejší lokálny kandidát.

## 2. Zistený stav (19. 8. 2026, pred štartom vlny 5)

- Appka beží (7 služieb Up), logy appky čisté.
- **Vlna 3 je z veľkej časti postavená, ale NEcommitnutá:** `AgentRunner` (644 r.),
  `ToolRegistry`, 14 toolov (`mind_*`, `read_file`, `glob`, `grep`/ripgrep,
  `edit_file`, `write_file`, `PathGuard` 292 r., `UnifiedDiff` 285 r.),
  3 kontroléry, 11 frontend modulov (2181 r.), `console.css` (818 r.),
  4 test súbory (1618 r.). `/console` vracia **401 bez session** — brána drží.
- Ollama beží na hoste (`:11434`) s `qwen3:8b`, `qwen3-coder:30b`, `nemotron-mini`.
  Vlastná compose služba `ollama` je profilová (nie default), aby sa nezdvojili modely.
- `ANTHROPIC_API_KEY` prázdny → Anthropic provider je napísaný a otestovaný, ale mŕtvy.
- Na hoste: Node v24.18, npm 11.16. **Rust/cargo NIE JE** → Tauri odpadá.
- Nález mimo rozsahu: race na `session:<key>` uzle (1062 Duplicate entry) — flagnutý
  ako samostatná úloha, v tomto šprinte sa ho nedotýkam.

## 3. Schválené rozhodnutia (2. dávka, 19. 8. 2026)

| # | Rozhodnutie |
|---|---|
| 11 | **Shell tool ÁNO, ale v klietke** — biely zoznam príkazov, povinné potvrdenie pri prvom výskyte vzoru, timeout, beží vnútri kontejnera `app`. Ruší rozhodnutie #7 („Bash tool NIE") |
| 12 | **Anthropic provider zapnúť** (kľúč dopĺňa používateľ) **aj odmerať silnejší lokálny model**; prepínač v hlavičke. RAM WSL sa **nezvyšuje** — `wsl --shutdown` by zhodil prácu na inej vetve |
| 13 | **Lokálny program: OBOJE** — terminálový TUI (`hades`) aj desktop okno |
| 14 | **Desktop = Electron** (npm je na stroji, Rust nie) — tray, globálna skratka, nativ. notifikácia |
| 15 | **Programové ovládanie: všetky tri** — (a) HTTP API + headless CLI + MCP tooly `console_*`, (b) **ovládanie počítača** (screenshot, písanie, klik), (c) **plánované behy** cez scheduler |
| 16 | **Rozdelenie práce medzi dve sessions** (19. 8. 2026, 13:40). V hlavnom checkoute na `feat/hades-konzola` beží druhá session s vlastným schváleným kontraktom, ktorý už vlastní orchestráciu agentov, bridge na `claude.exe`, log runov a redizajn konzoly. Idem preto do **worktree na vetvu `feat/hades-klient`** a beriem si len to, čo nevlastní nikto. **W7 (orchestrácia) a W10 (ovládanie počítača) z tohto kontraktu VYPADÁVAJÚ** — ich cesta cez skutočný `claude.exe` je silnejšia než podagenti nad 8B modelom a stavať to druhýkrát by bola škoda. Odhad klesol z 2,4 M na ~1,5 M tokenov |

## 4. Predvolené rozhodnutia (moje, dajú sa zmeniť)

- **Klietka shellu:** biely zoznam vzorov (`php artisan …`, `composer …`, `npm …`,
  `git status|diff|log|show|branch`, `curl localhost…`, `ls|cat|head|tail|wc|rg`).
  Zakázané vždy a bez možnosti allow-always: `rm`, `mv` mimo repo, `drop`, `truncate`,
  presmerovanie do `/etc`, `sudo`, `wsl`, `docker compose down -v`, `git push`,
  `git reset --hard`. Timeout 120 s, výstup strihaný na 30 kB.
- **Ovládanie počítača NEbeží z kontejnera** (nemá prístup na plochu hosta). Beží ako
  **host bridge** — `hades bridge`, proces na hoste, ktorý si od konzoly vyzdvihuje
  úlohy. Screenshot a vstupy cez PowerShell/.NET (`System.Windows.Forms`,
  `Graphics.CopyFromScreen`), teda **bez nativ. závislostí** typu nut.js.
  **Allow-always je pre tieto tooly vypnuté** — každý klik a každé písanie sa potvrdzuje.
  Bez bežiaceho bridgeu tool vráti „bridge nebeží", nie chybu.
- **Orchestrácia agentov:** tool `spawn_agent` + `agent_result`, max **4 paralelné**
  podagentov, hĺbka **1** (podagent nesmie spawnovať ďalších). Podagenti sú
  **read-only** (recall/read/glob/grep/bash-read) — každý zápis ide cez hlavného agenta
  a tvoju potvrdzovaciu bránu. Beh v queue, výsledky ako zbaliteľné karty v streame.
- **HTML reporty:** tool `write_report` → `storage/app/reports/<uuid>.html`, servované
  autentizovanou routou `/console/reports/<uuid>`, v streame karta s náhľadom a
  odkazom „otvoriť / stiahnuť". Šablóna nesie tokeny z `mind.css` (tmavá aj svetlá).
- **Plánované behy:** tabuľka `console_schedules`, `mind:console-schedules` v scheduleri,
  **len read-only tooly + reporty**; čokoľvek zápisové sa odloží do frontu potvrdení.
- **Perzistencia:** nové tabuľky `console_reports`, `console_schedules`,
  `console_agent_runs`, `console_bridge_tasks`. Pred migráciou `mysqldump` do `backups/`.
- **Lokálny klient nezdvojuje logiku** — TUI aj Electron hovoria s tou istou
  `/api/console/*`. Autentizácia CLI: osobný token v `~/.hades/config.json`.
- **TUI bez build stepu**, čisté Node ESM + ANSI (žiadny React/Ink).

## 5. Rozsah — čo ÁNO

**W5 — Zavretie vlny 3. HOTOVÉ, a nie mnou.** Balík je zelený (326 prešlo, 43 skipped,
0 padlo) a konzolu commitla druhá session ako `9eeaf28`. Moja vetva z toho commitu
vychádza. Zostáva mi z tejto vlny len preklik `/console` v prehliadači vo W13.

**W6 — Klietka + reporty.** `BashTool` s bielym zoznamom a potvrdením,
`write_report` + route + šablóna, karty v UI. Testy: zakázaný vzor sa odmietne,
`deny` beh zastaví, timeout zaberie, report je dostupný len so session.

**W7 — Orchestrácia agentov. NEROBÍM.** Vlastní ju druhá session (vlna D jej kontraktu):
rozklad na ≤ 4 behy, `parent_run_id`, zlúčený report, slash `/orchestrate` — a robí ju
cez skutočný `claude.exe`, nie cez podagentov nad lokálnym 8B modelom.

**W8 — Modely.** Anthropic prepínač v hlavičke (bez kľúča ostáva vypnutý, nie rozbitý),
počítadlo tokenov a ceny, `mind:models --bench` nad ďalšími 8B kandidátmi,
auto-fallback pri nedostupnosti providera.

**W9 — Programové ovládanie.** `hades run "…" --json` (headless), token-auth pre
API zvonku, MCP tooly `console_run` / `console_threads` / `console_result`,
`console_schedules` + scheduler job.

**W10 — Host bridge + počítač. ODLOŽENÉ.** Druhá session stavia `bin/cc-bridge/` — host
daemon, ktorý na tomto počítači spúšťa procesy. Dva host daemony na jednom stroji sú
zbytočnosť, takže tooly na ovládanie počítača (`screen_shot`, `type_text`, `click`,
`focus_window`) sa majú pridať do JEJ bridgeu, až keď dobehne. Vypadáva z tohto behu.

**W11 — Klienty.** Node TUI (stream, tool karty, diff, permission prompt, slash
príkazy, vlákna) + Electron okno (tray, globálna skratka, notifikácia po dobehnutí).

**W12 — Vlna 4 z pôvodného kontraktu.** Decay + teplota + posilňovanie, prewiring
cez embeddings, automatické sumáre, rozšírené MCP tooly (**len aditívne**).

**W13 — Kvalitná brána.** Celý balík zelený, preklik so screenshotmi (web, TUI,
Electron), review agent (`effort: high`) vrátane security prehliadky, dokumentácia.

## 6. Rozsah — čo NIE

- **Žiadne `wsl --shutdown`, žiadne zvýšenie RAM VM** — zhodilo by prácu na inej vetve.
- Žiadny zásah do iných worktree (`.claude/worktrees/*`) ani do cudzích vetiev.
- Žiadny upgrade MariaDB, žiadna zmena tvaru `mind_recall` payloadu ani `/api/v1`.
- Žiadne mazanie uzlov ani dát bez potvrdenia, žiadne plošné reformaty.
- Žiadny ngrok/verejný deploy, žiadna GPU akcelerácia, žiadny rebranding na AuraAI.
- Žiadny build step pre webový frontend (konzola zostáva natívne ES moduly).
- Bridge **neposiela** obsah obrazovky nikam von — zostáva v lokálnej appke.

## 7. Akceptačné kritériá

1. `/console` v prehliadači: chat streamuje, tool karty a diff fungujú, `deny` zastaví.
2. Konzola vyrieši reálnu kódovaciu úlohu end-to-end: nájde miesto v kóde, upraví ho,
   **spustí testy cez `bash`** a v odpovedi ukáže ich výstup.
3. Konzola vygeneruje HTML report z dát vedomia; report otvorí len prihlásený.
4. Konzola rozdelí úlohu na ≥ 2 paralelných podagentov a zhrnie ich výsledky;
   Stop zruší celú skupinu.
5. `hades` v termináli robí to isté ako web nad tým istým vláknom; `hades run --json`
   dobehne bez interakcie; `hades gui`/Electron okno otvorí konzolu s tray ikonou.
6. MCP tool `console_run` z iného klienta pošle správu do konzoly a vráti odpoveď.
7. Ovládanie počítača: screenshot a napísanie textu do iného okna prejde **len po
   potvrdení**; bez bridgeu tool zdvorilo oznámi, že bridge nebeží.
8. Zakázaný shell vzor je odmietnutý (test), povolený prejde s potvrdením (test).
9. Celý balík zelený (dnes 228 + nové), `auth.ui` chráni aj nové routy (401/419 testy).
10. CLAUDE.md, README, `docs/BEZPECNOST.md` a oba kontrakty aktuálne.

## 8. Otvorené riziká

| Riziko | Prečo hrozí | Ako to riešim |
|---|---|---|
| **Shell v klietke je nová plocha útoku** | Appka je tunelovateľná cez ngrok; shell v kontejneri je eskalácia | Biely zoznam vzorov (nie čierny), povinné potvrdenie, bez `push`/`sudo`/`rm`, security prehliadka vo W13 |
| **Ovládanie počítača slabým modelom** | Qwen 8B klikne naslepo do cudzieho okna | Bridge na hoste, allow-always vypnuté, screenshot pred akciou, len na tvoje vyžiadanie |
| Kvalita lokálneho modelu na orchestráciu | 9,3 tok/s a 8B na plánovanie podagentov je málo | Anthropic prepínač; pri lokálnom modeli strop 2 podagenti a plochšie schémy |
| Electron váži 150–200 MB | Disk a prvý build | Samostatný podpriečinok `desktop/`, mimo webového buildu, `.gitignore` na `node_modules` |
| Migrácie počas cudzej práce | Iná vetva používa tú istú DB | `mysqldump` do `backups/` pred migráciou, len aditívne tabuľky, žiadna zmena existujúcich |
| Rast rozsahu (9 vĺn) | Je to veľa | Pri prekročení odhadu o > 30 % zastavím a ozvem sa; hlásim na každej hranici vlny |

## 9. Výsledok

**Stav 19. 8. 2026:** vetva `feat/hades-klient` (worktree), 5 commitov nad `9eeaf28`,
pushnutá na origin. **448 PHP testov zelených** (baseline 369, teda +79) a **45 Node
testov** klienta. Sada worktree od tohto šprintu naozaj testuje worktree.

| Vlna | Stav | Čo z toho vzniklo |
|---|---|---|
| W5 | hotové, nie mnou | konzolu commitla druhá session ako `9eeaf28` |
| W6 | **hotové** | `CommandCage` + `BashTool` (16 testov), `ReportWriter` + `write_report` + `/console/reports/<uuid>` (14 testov), karty v UI, úzke povolenia (`NarrowsAllowance`, 6 testov) |
| W7 | vypustené | vlastní iná vetva (orchestrácia cez `claude.exe`) |
| W8 | **hotové, menšie než odhad** | prepínač providera už existoval; doplnené len pomenovanie nedostupného providera. Bench ďalších modelov sa nerobil |
| W9 | **hotové** | `auth.console` (loopback-only, bez CSRF), `HeadlessRunner` (read-only register), `/api/console/headless`, `/api/console/cli/*`, MCP `console_run`/`console_threads`/`console_result`/`console_schedules`, plánované behy (17 + 8 testov) |
| W10 | odložené | patrí do bridgeu druhej vetvy |
| W11 | **hotové** | `bin/hades/` (TUI + headless, bez závislostí, 45 testov), `desktop/` (Electron obal) |
| W12 | **otvorené** | z pôvodnej vlny 4 už bežalo všetko okrem jedného: `mind:rewire` páruje uzly **TF-IDF kosínusom, nie embeddingmi**, hoci 2672 vektorov v DB je |
| W13 | **hotové** | review + adversariálna bezpečnostná prehliadka, dokumentácia, zápis do Hadesa |

### Čo sa počas behu ukázalo inak, než kontrakt čakal

1. **Kolízia dvoch sessions.** Druhá session pracovala v tom istom pracovnom priečinku na
   tej istej vetve a jej schválený kontrakt už vlastnil orchestráciu, bridge a redizajn UI.
   Preto worktree a preto W7/W10 vypadli (rozhodnutie #16).
2. **W8 a W12 boli z väčšiny hotové.** Prepínač providera fungoval a `mind:decay`,
   `mind:rewire`, `mind:rollup`, `mind:digest`, `mind:automerge` bežia nočne od skorších vĺn.
   Odhad preto klesol z 2,4 M na ~1,2 M ešte pred stavbou.
3. **Sada worktree netestovala worktree.** Viď `tests/worktree-autoload.php` — bez
   `APP_BASE_PATH` boli config, views, routy a migrácie z cudzej vetvy.
4. **Bezpečnostné zúženie, ktoré kontrakt nepredpisoval.** Plošné „povoliť vždy" by po
   pridaní shellu znamenalo, že súhlas s `php artisan test` povolí aj `mind_delete`.

### Čo NIE JE overené

**Preklik konzoly v prehliadači sa nestal.** Docker servuje hlavnú vetvu na `:8080`, takže
routy tejto vetvy tam nie sú, a pokus spustiť vlastný kontejner z toho istého obrazu na
`:8092` zamietol klasifikátor. Karty toolov, diff a permission prompt sú teda overené
testami a čítaním kódu, **nie na obrazovke**. Electron okno sa z toho istého dôvodu tiež
nespúšťalo — overený je len toolchain (`electron --version`) a syntax.

### Čo našla kvalitná brána (a je opravené)

Dva agenti s `effort: high` — jeden na správnosť proti kontraktu, jeden adversariálne
na bezpečnosť. Nálezy neboli dojmy: každý bol podložený **spustením**.

| Závažnosť | Nález | Ako sa prejavil |
|---|---|---|
| **bloker** | `cat ".env"` **prešlo** | Deny vzor chcel `.env` na hranici (začiatok/medzera/lomka) a úvodzovka ňou nie je — shell ju pri behu strhne. Overené spustením: 2237 B vrátane `APP_KEY`, `DB_PASSWORD` a všetkých tokenov, teda **všetky štyri autentifikačné okruhy naraz** |
| **bloker** | plošné `auto_accept` zakrylo úzke povolenie | „Povoliť vždy" na `mind_learn` zapne `auto_accept` a od tej chvíle by **každý** príkaz shellu bežal bez potvrdenia. Diera, ktorú do kódu priniesla prvá verzia zúženia; dosiahnuteľná aj programovo cez `PATCH` na vlákno |
| major | `git log -p`, `git show <ref>:<cesta>` | Vypíšu obsah z **histórie**, kde podľa `docs/BEZPECNOST.md` žije kompromitovaný bcrypt hash basic-auth hesla. Súborové tooly do histórie nevidia — plocha, ktorú pridal výlučne shell |
| major | `sort -o <súbor>` zapisuje | Tá istá trieda ako `sed -n '1w …'`; `sort` bol v bielom zozname s kľúčom `sort` |
| major | `write_report` chýbal v headless sade | `isWrite()` neznamená „mení dáta", ale „čaká na človeka". Plánovaný beh preto nemal ako vyrobiť report — jeho jediný zmysluplný výstup. Vyriešené značkou `SafeUnattended` |
| major | **Electron by ani nenabehol** | Tray ikona, ktorá v repe nie je (výnimka v `ready`, takže sa nezaregistrovala ani globálna skratka), `require()` v ESM module, a ESM preload v sandboxe = notifikácia napísaná a mŕtva |
| major | okruh bol z hosta **nepoužiteľný** | Appka beží v kontejneri a request z hosta prichádza SNAT-nutý z brány mostu (zmerané: `172.19.0.1`). Kontrola len na `127.0.0.1` by terminálovému klientovi vracala 403 — a testy to nezachytili, lebo Symfony klient chodí z loopbacku |
| minor | `npm install <balík>` | `postinstall` je spustenie cudzieho kódu v kontejneri; kľúč `npm install` by to po jednom „vždy" povolil natrvalo |
| minor | prefixová kontrola originu v Electrone | `http://localhost:8080.evil.com/` prefix spĺňa |
| minor | `xlink:href` v sanitizácii | `<svg><a xlink:href="javascript:…">` prešlo prvou vrstvou (CSP ho dnes zastaví, ale vrstva má tvrdiť len to, čo robí) |
| minor | dva klienty, dva názvy kľúča | `token` vs `ui_token` v `~/.hades/config.json` |

Všetko opravené v `77b9cf1` a `83dff5e`, každý bloker má test, ktorý by ho bol zachytil.
Sada: **462 PHP testov + 45 Node testov zelených**.

### Spend

Agenti: **1 099 k** tokenov (W6 425 k · W9 307 k · W11 367 k) + brána W13. Proti odhadu
520 k pre W6+W9 je to +40 %; celkovo pod schváleným stropom 2,4 M, nad revidovaným 1,2 M.
