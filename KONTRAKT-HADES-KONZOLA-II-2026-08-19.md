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
- **Plánované behy:** tabuľka `console_schedules`, `mind:console-run` v scheduleri,
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

_(dopíše sa po dobehnutí šprintu)_
