# AI-mind — Handoff / história sessionov

> Kompletný prehľad všetkých 20 Claude Code sessionov naviazaných na tento počítač —
> aby si ich videl priamo v Claude Code (v tomto repozitári), nezávisle od toho, pod
> ktorým účtom si prihlásený. Zrkadlová kópia je aj vo firemnom OneDrive
> (`OneDrive - ŠPERKY s.r.o/AI-mind-handoff`).
>
> Legenda stavu: ✅ hotové · 🔄 rozbehnuté / pokračuje · 📝 len plánovanie · ❓ nezdokumentované

## Prečo tento priečinok existuje

Claude Code drží zoznam sessionov **per prihlásený účet** — po prepnutí na iný účet
(`marketing@sperky-eshop.sk`) appka žiadne staré sessiony nevidí a **nedá sa ich tam
naimportovať** (nie je na to podporovaná funkcia). Tento priečinok preto nesie históriu
ako súbory v repozitári, ktoré Claude Code vie kedykoľvek otvoriť a prečítať —
nezávisle od účtu, počítača aj appky.

## Dva zdroje histórie

Tento handoff spája **dva rôzne účty / dva typy histórie**:

1. **Claude Code dev-sessiony** (tento repozitár, účet cez CLI) — vývoj: Hades, Aura appky, Docker, Banner Studio. → tabuľky nižšie.
2. **claude.ai web chaty** (účet Radko Ruščák, `marketing4.sperky@gmail.com`) — biznis/marketing: SEO, KPI, porady, cenotvorba, prezentácie. → **[web-chats/](web-chats/)** — 200 chatov, apríl–júl 2026.
   - **[web-chats/KDE-POKRACOVAT.md](web-chats/KDE-POKRACOVAT.md)** — živé/rozrobené vlákna s ďalšími krokmi (peňaženka bug, cenotvorba, SEO, august porady, certifikát…).
   - **[web-chats/INDEX.md](web-chats/INDEX.md)** — kompletný zoznam všetkých 200.

## Ako to používať

- **Rýchly prehľad** → tabuľky nižšie (zoskupené podľa projektu, chronologicky).
- **Plný priebeh konverzácie** (prompty, odpovede, tool-cally) → `transcripts-readable/<id>.md`
  (dostupné pre 7 z 20 sessionov — ostatné majú len krátke `summary`).
- **Pôvodné strojové summary** → `../summaries/sessions/<id>.md`.
- **Projektové rollupy** → `projects/<projekt>.md`.
- **Web chaty (claude.ai)** → `web-chats/` (INDEX + KDE-POKRACOVAT + threads/).

---

## 📁 Šperky Aura app (9 sessionov)

| Dátum | Stav | Téma | Detail |
|---|---|---|---|
| 15.7. | ✅ | Appka na nasadenie do Dockeru (aura-hr-mapa, HR evidencia) | [summary](../summaries/sessions/0bd5f33b-1701-4d79-a8f0-66ec7d5c4740.md) |
| 15.7. | 🔄 | Spustiť Aura app cez tento počítač + ngrok + Google mind-mapa | [summary](../summaries/sessions/251aa02f-308d-4744-9726-0c6843165bd6.md) |
| 15.7. | ✅ | Docker stack pre banner appku (bannery-db/app) | [summary](../summaries/sessions/57346abd-fac8-49f1-af35-710b2a7c8587.md) |
| 15.7. | ❓ | Do skills Hadesa cez 10 agentov (výsledok nezdokumentovaný) | [summary](../summaries/sessions/ab77c7c8-3c6e-407f-bdf6-ee9a2388234e.md) |
| 15.7. | ✅ | Denné šifrované zálohovanie na OneDrive + lokálny disk | [summary](../summaries/sessions/14f5be6d-bce1-4747-b056-fb02a31bd6ad.md) |
| 17.7. | ❓ | Hľadanie nového dizajnu na vetve (len úvodný prompt) | [summary](../summaries/sessions/3b309da5-8782-489c-9a17-5f7e8dfd6ab7.md) |
| 21.7. | ✅ | Fix parseru Facebook/Meta Ads CSV exportu (ad-level vs. ROAS) | [summary](../summaries/sessions/93c58400-6c55-46fe-a1c6-dec4255ede7a.md) |
| 21.7. | 🔄 | Mindmap orientácia zvislá → vodorovná (GitHub branch, sprint-plán) | [summary](../summaries/sessions/2b2cded7-f9a9-418e-b694-063076aeb746.md) |
| 22.7. | 🔄 | Export kompletnej histórie Claude Code do ZIP-u (predchodca tohto handoffu) | [summary](../summaries/sessions/5ffecd4c-d0cd-486d-b72a-d76c57508a53.md) |

<details>
<summary><b>Detailné briefy — Šperky Aura app</b></summary>

### 15.7. — Appka na nasadenie do Dockeru ✅
**Cieľ:** Vytvoriť aplikáciu na internú evidenciu zamestnancov (maily, pozície, aktivity, používané aplikácie) nasaditeľnú do Dockera.
**Čo sa stalo:** Postavila sa interná HR evidencia „aura-hr-mapa" — Node.js backend s REST API (auth, departments, employees, positions, activities, mailboxes), SQL schémou, šifrovaním a audit logom, dockerizovaná cez docker-compose. Dizajn zladený so Šperky Aura app, bez prihlasovacieho okna. Naplnené dáta od nuly (32 pozícií, 17 oddelení).
**Rozhodnutia:** bez login · dizajn 1:1 s Aura app · Docker nasadenie · Node.js REST API po moduloch · šifrovanie + audit log.
**Tech:** Docker, docker-compose, Node.js, REST API, SQL.
**Výsledok:** Hotové, dockerizované, overené.

### 15.7. — Spustiť Aura app cez tento počítač 🔄
**Cieľ:** Spustiť Šperky Aura na tomto počítači cez Docker a sprístupniť verejne cez ngrok.
**Čo sa stalo:** Appka spustená lokálne z `DeliPistacna/sperky-ai`, ngrok tunel ako Windows služba. Nasadenie/bugfix cez 10+5 paralelných agentov. Riešená chýbajúca časť súborov po migrácii z druhého PC. Postavená Google mind-mapa (migrácia 0043, REST API `/api/mindmap`, tidy-tree layout, `@xyflow/react`).
**Rozhodnutia:** Docker + ngrok ako služba · práca rozdelená medzi paralelných agentov · mind-mapa perzistovaná v SQL + REST.
**Tech:** Docker, ngrok, React, @xyflow/react, PowerShell, GitHub.
**Výsledok:** Appka beží; mind-mapa vo fáze B, nedokončená.

### 15.7. — Pokračuj až kým to necommitneš ✅
**Cieľ:** Pripraviť samostatný Docker stack (MariaDB) pre novú appku na bannery vo vzhľade Aura app.
**Čo sa stalo:** Docker stack pre banner appku (bannery-db + bannery-app, healthy). `/api/health`, login, auto-mount routy, dynamický view-registry. Overené Playwright, sharp, storage. Pripravený plán vĺn A2–A6.
**Rozhodnutia:** aura-banner-studio ako samostatná app · všetko v Dockeri · auto-mount routes · postup formou otázok pred implementáciou.
**Tech:** Docker, MariaDB, REST API, Playwright, sharp.
**Výsledok:** Vlna A1 hotová a commitnutá (d8d0b6a), stack beží.

### 15.7. — Do skills Hadesa cez 10 agentov ❓
**Cieľ:** Cez 10 agentov prehľadať GitHub .md skills pre Claude a naučiť Hadesa pokročilé používanie MCP nástrojov.
**Čo sa stalo:** Session sa začala `mind_recall` (27 uzlov/5 oblastí). Priebeh a výsledky spustenia 10 agentov nie sú v summary zachytené — bez transkriptu.
**Výsledok:** Nezdokumentované, status neznámy.

### 15.7. — Aura app na samostatnej branchi ✅
**Cieľ:** Nastaviť automatické, čo najbezpečnejšie denné zálohovanie Aura appky na OneDrive aj lokálny disk, na samostatnej branchi.
**Čo sa stalo:** Zálohovací systém v PowerShelli (`scripts/backup`) — denná šifrovaná záloha na OneDrive + lokálny disk, test obnovy, setup skript. API route pre backup. PS 5.1 špecifiká: UTF-8 s BOM kvôli diakritike, tíšenie stderr cez cmd.
**Rozhodnutia:** samostatná branch · šifrovacie heslo len ako DPAPI blob (treba zálohovať mimo PC) · UTF-8 BOM pre PS skripty · 20 bezpečnostných otázok pred implementáciou.
**Tech:** PowerShell 5.1, OneDrive, Windows DPAPI, Next.js API route, GitHub.
**Výsledok:** Hotové, overené vrátane testu obnovy.

### 17.7. — Nový dizajn na samostatnej vetve ❓
**Cieľ:** Nájsť nový dizajn implementovaný deň predtým na samostatnej vetve `sperky-ai` (z druhého PC).
**Čo sa stalo:** Summary zachytáva iba úvodný prompt s odkazom na GitHub repo. Žiadny záznam krokov ani výsledku.
**Výsledok:** Nezdokumentované.

### 21.7. — Šperky Aura app — práca 21.7.2026 ✅
**Cieľ:** Opraviť parser Facebook/Meta Ads exportu, ktorý nezvládal ad-level CSV export.
**Čo sa stalo:** Diagnostikované — nahraný CSV bol ad-level export „Reklamy" (1 riadok = 1 reklama) bez stĺpca hodnoty konverzií, len ROAS pomer. Starý parser hľadal chýbajúci stĺpec. Parser opravený + doplnený test.
**Rozhodnutia:** rozlíšiť ad-level vs. kampaňový export · hodnotu konverzií pri ad-level dopočítať z ROAS.
**Tech:** TypeScript, Facebook/Meta Ads CSV, Docker, testy.
**Výsledok:** Nasadené a overené — kontajner healthy, `{"ok":true,"db":true}`.

### 21.7. — Mindmap orientácia (GitHub branch) 🔄
**Cieľ:** Preklopiť mindmapu zo zvislej (tidy-tree) orientácie na vodorovnú, na samostatnej GitHub branchi.
**Čo sa stalo:** Naštudovaný `src/lib/mindmap/layout.ts` — tidy-tree s koreňom vľavo, súrodenci pod sebou (vysoká úzka mapa). Pripravený sprint-plán, rozhodnutia zamknuté do kontraktu. Samotná implementácia nie je v summary doložená.
**Rozhodnutia:** vodorovná orientácia (koreň hore, kampane vedľa seba) = nová predvolená · práca na samostatnej branchi.
**Súbory:** `C:/Aura/mindmap-orient/MINDMAP-ORIENTATION-SPRINT-PLAN.md`, `src/lib/mindmap/layout.ts`.
**Výsledok:** Vo fáze plánovania, implementácia rozbehnutá/nedoložená.

### 22.7. — Komplet história z Claude Code 🔄
**Cieľ:** Vyexportovať kompletnú históriu Claude Code konverzácií do ZIP-u kvôli migrácii na nový profil.
**Čo sa stalo:** Preskúmaný adresár `.claude`, analýza veľkostí podpriečinkov (`projects`, `sessions`). Summary zachytáva len úvodnú fázu — toto je priamy predchodca aktuálneho handoff balíka.
**Výsledok:** Nadviazané touto session (`aed377fa-…`) — pozri AI-mind nižšie.

</details>

---

## 📁 AI-mind / Hades (6 sessionov + aktuálna)

| Dátum | Stav | Téma | Detail |
|---|---|---|---|
| 15.7. | ✅ | Vytvoriť neural AI-mind (Hades) — celý stack od nuly | [summary](../summaries/sessions/17f62a3b-c943-45c0-a7d0-2a3e769d1587.md) · [transkript](transcripts-readable/17f62a3b-c943-45c0-a7d0-2a3e769d1587.md) |
| 17.7. | ✅ | Jednotný UX s logikou v HTML (reklamačný proces + polročný report) | [summary](../summaries/sessions/59030ed9-025a-4ad0-a8f4-3fa8c573fc0d.md) · [transkript](transcripts-readable/59030ed9-025a-4ad0-a8f4-3fa8c573fc0d.md) |
| 17.7. | 🔄 | Paralelní agenti dopĺňajú Hadesa (3→5/6→20 agentov) | [summary](../summaries/sessions/6cb7aa43-3969-4a8c-a189-0365db770845.md) · [transkript](transcripts-readable/6cb7aa43-3969-4a8c-a189-0365db770845.md) |
| 17.7. | 🔄 | 5 agentov na osobné preferencie + 10-agentový expansion (nedokončený) | [summary](../summaries/sessions/ebb8a62a-86c5-4cd7-8f68-c659ef174137.md) · [transkript](transcripts-readable/ebb8a62a-86c5-4cd7-8f68-c659ef174137.md) |
| 20.7. | ✅ | Aura Logistika — nová appka pre zásielky + reklamácie | [summary](../summaries/sessions/75bafbab-4cc3-422a-99b1-14f20a3d22ff.md) · [transkript](transcripts-readable/75bafbab-4cc3-422a-99b1-14f20a3d22ff.md) |
| 21.7. | ✅ | Optimalizácia Marp prezentácie (pricing_info) po 19. slide | [summary](../summaries/sessions/e4aaca9f-7854-432b-8407-323d56c25469.md) · [transkript](transcripts-readable/e4aaca9f-7854-432b-8407-323d56c25469.md) |
| 22.7. | 🔄 | **Táto session:** Handoff balík (OneDrive + čitateľné transkripty) | [transkript](transcripts-readable/aed377fa-768a-42fb-bb09-7b6d2523f3c7.md) |

<details>
<summary><b>Detailné briefy — AI-mind / Hades</b></summary>

### 15.7. — Vytvoriť neural AI-mind (Hades) ✅
**Cieľ:** Od nuly vytvoriť „vedomie AI" (Hades) — trvalú pamäť naprieč Claude Code sessions vizualizovanú ako živá neurónová sieť, ktorá sa automaticky učí z chatov.
**Čo sa stalo:** Po viacerých kolách spresňujúcich otázok (30, 100, 50) postavený kompletný skeleton: Laravel 13 v Docker Compose (app, queue, scheduler, reverb, mariadb, redis), model areas/departments/nodes/edges/activations so seedom jadra. MCP server (`mind_learn/recall/activate/overview`), REST API, MindPulse broadcasty cez Reverb, canvasová glow vizualizácia s pulzmi a timeline. Nasledoval rozsiahly UX/UI redizajn (Material Symbols, icon rail, dokované panely, prompt bar s /príkazmi, a11y), zjednotený dizajn systém, Aura-light business retheme. Session uzavretá auto-ingestom sessions do mozgu a Apollo integráciou (brain-indexer, certainty/review/rozhodnutia, business dashboard).
**Kľúčové rozhodnutia:**
- Full-stack Laravel 13 + MariaDB + Redis + Reverb v Dockeri (nie statický artefakt)
- Automatické učenie cez MCP server riadené globálnym pravidlom v `~/.claude/CLAUDE.md`
- 4 typy uzlov (core/skill/memory/project), hierarchia oblasť → oddelenie
- Živosť siete: logaritmické posilňovanie pri aktivácii + nočný decay (spomienky blednú, nezmiznú)
- Vanilla JS + canvas + d3-force layout, real-time pulzy cez WebSocket (Reverb/Echo)
- Auto-ingest sessions parserom bez modelu (len kódom) — šetrí API
- Zápis do .md mozgu zámerne OFF (`HADES_ALLOW_BRAIN_WRITE=false`)
**Tech:** Laravel 13, PHP, MariaDB, Redis, Reverb, WebSocket, Docker Compose, MCP, REST API, Canvas 2D, d3-force, Material Symbols, Anthropic PHP SDK.
**Výsledok:** Funkčné a overené end-to-end (81 testov PASS). Commit `7436b7a` pushnutý na `feat/apollo-integration`, pripravený na PR.

### 17.7. — Jednotný UX s logikou v HTML ✅
**Cieľ:** Z dvoch HTML súborov (súčasný + nový reklamačný proces) spraviť jeden zjednotený interaktívny UX; prerobiť polročné zhodnotenie na horizontálny layout s animáciou.
**Čo sa stalo:** Zlúčené dva reklamačné diagramy do jedného dokumentu s prepínačom SK/EN, záložkami, mermaid diagramami a interaktívnym sprievodcom (state machine). Polročný report prerobený na horizontálny scroll-snap layout (11 panelov, wheel/šípky/klávesnica). Narazené na to, že file:// aj localhost sú blokované — vyriešené cez puppeteer-core headless Chrome. Opravený off-by-one bug v menu.
**Kľúčové rozhodnutia:** jeden zjednotený HTML namiesto dvoch · horizontálny report ako nový súbor, originál nedotknutý · overenie cez headless Chrome · poznatok uložený do pamäte (`local-html-visual-verify.md`).
**Tech:** HTML, JS (ESM), Mermaid.js, CSS scroll-snap, puppeteer-core, headless Chrome, jsdom, Node.
**Výsledok:** Oba deliverables hotové a overené (logika 15/15, opravený off-by-one).

### 17.7. — AI-mind — práca 17.7.2026 🔄
**Cieľ:** Spúšťať paralelných agentov (3 → 5/6 → 20), ktorí v slučke dopĺňajú Hadesa o profesionálne skills naviazané na reálne appky.
**Čo sa stalo:** Viacero vĺn subagentov cez Hades MCP obohacovalo sieť. Vlna 1 (3 agenti): UX/UI, Backend/PHP/Logic, API/Security/Docker. Ďalšie vlny (5/6): HR/tím, právne/účtovné, CX, logistika, SEO/GEO, email deliverability. Priebežná hygiena — zlúčené 4 páry duplikátov, zmazané prázdne oddelenie „Backend". Na záver spustený 20-agentový beh.
**Kľúčové rozhodnutia:** vlastný `session_key` pre každého agenta · recall-before-learn · tech skills po anglicky, osobné/projekty po slovensky · len uzly vystopovateľné k reálnej práci · merge/prune audit robí hlavný Claude.
**Tech:** Hades MCP, Laravel, MariaDB, Redis, Docker Compose, PHP, d3-force, TF-IDF/cosine similarity.
**Výsledok:** Sieť vyrástla z ~83 na 545 uzlov / 3609 hrán. Session končí spustením 20-agentového behu, jeho výsledok transkript nezachytáva.

### 17.7. — 5 agentov na osobné preferencie 🔄
**Cieľ:** Cez 5 paralelných agentov spracovať osobné preferencie používateľa, potom rozšíriť Hadesa cez 10-agentový workflow.
**Čo sa stalo:** 5 agentov (komunikácia, rozhodovanie, tech, dizajn, biznis) čítalo CLAUDE.md, pamäť, summaries, sieť. Vznikol profil (potvrdené vs. odvodené), 3 nové + 4 posilnené uzly. Následne spustený 10-agentový background workflow „hades-expansion-proposals", ktorý sa **nedokončil** — chýba completion record.
**Kľúčové rozhodnutia:** 5 dimenzií, každú samostatný agent · agenti čítajú priamo súbory, nie Hades MCP schémy · profil bez emoji · 10-agentový build ako dvojkolový workflow s bránou na schválenie.
**Tech:** Hades MCP, Claude Code Workflow/Agent tool, PHP/Laravel, MariaDB, Redis, Reverb, D3-force.
**Výsledok:** Profil vytvorený, čiastočne ukotvený. **Nedokončený workflow, pripravený na resume cez `resumeFromRunId "wf_bfdee00a-005"`** — over, či to ešte platí.

### 20.7. — Rovnaký vzhľad ako Aura app ✅
**Cieľ:** V rovnakom vzhľade ako Aura appky postaviť appku na týždennú/mesačnú evidenciu zásielok a reklamácií s grafmi.
**Čo sa stalo:** Naštudovaný vzor `aura-hr-mapa`. Cez 50 otázok vyzbierané zadanie. Postavená appka **Aura Logistika** (`C:\Aura\aura-logistika`, port 3020) v 6 fázach: infra, DB+seed (~6 mes. demo), API, frontend s inline-SVG line chartom, views, export/backup/QA. Overené vizuálne (aj dark mode), read/write endpointy, ISO-týždne, round-trip restore (494 zásielok).
**Kľúčové rozhodnutia:** stack 1:1 s HR mapou (Node 20 + Express 4 + MariaDB 11.4) · jadro = týždenné čísla (ISO týždeň) · zásielky podľa krajiny, prepravca voliteľný · reklamácie ako hybrid · záloha ako samostatný skript, nie zásah do cudzej rutiny.
**Tech:** Node 20, Express 4, MariaDB 11.4, Docker Compose, vanilla JS SPA, inline SVG grafy, JWT, exceljs, ngrok, ISO 8601.
**Výsledok:** Kompletne postavená, spustená (`http://localhost:3020`, `admin@sperky-eshop.sk / aura-admin`), overená. Zostávalo pridať do gitu + naplánovať zálohu. Nadväzujúci GitHub push + ngrok bol prerušený hneď na začiatku.

### 21.7. — Optimalizuj info po 19. slide ✅
**Cieľ:** Optimalizovať obsah Marp prezentácie (`pricing_info`) od slide 20 ďalej.
**Čo sa stalo:** Marp CLI nebolo nainštalované — upravené slidy 20, 21, 23, 28 v `.md` zdroji a ručne 1:1 zosynchronizované do `.html`. Fakty ostali nezmenené, ostatné slidy netknuté.
**Kľúčové rozhodnutia:** markdown ako zdroj pravdy, HTML ručne sync · nesťahovať Marp cez npx bez súhlasu · meniť len text, zachovať fakty.
**Tech:** Marp, Markdown, HTML.
**Výsledok:** Hotové, zmeny v oboch súboroch.

### 22.7. — Handoff sessionov (OneDrive + Claude Code) — TÁTO SESSION 🔄
**Cieľ:** Obnoviť prístup k starým Claude Code sessionom (iný prihlásený účet) a pripraviť handoff balík na OneDrive.
**Čo sa stalo:** Zmapovaných 19 session súhrnov, 3 projektové rollupy, 7 raw `.jsonl` transkriptov. Vytvorený handoff balík (`HANDOFF.md` + `sessions/INDEX.md` + `projects/` + `transcripts/`, ~52 MB) vo firemnom OneDrive. Následne renderované raw transkripty do čitateľného Markdownu (`render.js`) a poskladaný tento master index priamo v repozitári, aby bolo všetko vidieť v Claude Code.
**Kľúčové rozhodnutia:** staré sessiony sa nedajú naimportovať do appky pod iným účtom — riešenie je súborový handoff · balík ide do firemného OneDrive · obsahuje úplne všetko (súhrny + rollupy + raw transkripty) · raw `.jsonl` sa prevádzajú na čitateľný Markdown priamo v repo (`handoff/transcripts-readable/`).
**Tech:** Claude Code, OneDrive, Node.js, Markdown, JSONL, Git.
**Výsledok:** Prebieha — pozri tento súbor a `transcripts-readable/`.

</details>

---

## 📁 Retuš produktov (2 sessiony)

| Dátum | Stav | Téma | Detail |
|---|---|---|---|
| 21.7. | 📝 | Smernica: produkt foto automatizácia cez agentov v ChatGPT | [summary](../summaries/sessions/8ea942ce-c24f-4d33-8f6d-54b4517b9732.md) |
| 21.7. | 📝 | Smernica: nová aura appka — Calendar MCP + Asana MCP | [summary](../summaries/sessions/c06a6032-8755-447a-ad83-3818b2f61079.md) |

<details>
<summary><b>Detailné briefy — Retuš produktov</b></summary>

### 21.7. — Smernica: produkt foto automatizácia 📝
**Cieľ:** Vytvoriť smernicu, ktorá automatizuje retušovanie/produktové fotografie pomocou agentov v ChatGPT.
**Čo sa stalo:** Vygenerovaná smernica napojená na relevantné znalosti v Hadese (prompt builder). Implementačné detaily nie sú v summary zachytené.
**Tech:** ChatGPT agents, Docker, MCP, Figma, Canva, GitHub, ads.
**Výsledok:** Vznikla smernica/prompt; implementácia neskôr (mimo tejto session).

### 21.7. — Smernica: Calendar + Asana MCP 📝
**Cieľ:** Vygenerovať smernicu pre novú aura appku zameranú na Calendar MCP a Asana MCP.
**Čo sa stalo:** Smernica vyťahuje z Hadesu relevantné znalosti pre tento zámer. Obsahuje aj agregovaný týždenný súhrn (týždeň 29/2026: 469 uzlov, 11 session záznamov; najviac práce: Šperky Aura app, AI-mind, Banner Generator).
**Tech:** MCP, Calendar MCP, Asana MCP, Hades, Laravel, MariaDB, Redis, Reverb, Docker.
**Výsledok:** Prípravný podklad, nie dokončená implementácia.

</details>

---

## 📁 Banner Generator (2 sessiony)

| Dátum | Stav | Téma | Detail |
|---|---|---|---|
| 15.7. | ✅ | Vyskladať Banner Studio (6 sprintov) | [summary](../summaries/sessions/92cd34d4-2fca-4998-82bd-a72c966ae197.md) |
| 15.7. | ❓ | Zálohovanie „aura" appky na samostatnej branchi (len úvod) | [summary](../summaries/sessions/cf9bfa62-8d6d-4131-ae79-87d371414d90.md) |

<details>
<summary><b>Detailné briefy — Banner Generator</b></summary>

### 15.7. — Vyskladať banner generátor ✅
**Cieľ:** Vyskladať appku (Banner Studio) lokálne cez Docker s vlastnou MariaDB, ktorá automatizovane generuje bannery na sociálne siete.
**Čo sa stalo:** Postavené naprieč 6 sprintmi: migrácie 0035-0042 + KB seed, image-edit/inpainting, KB API, deterministický banner template, Playwright render worker, dvojfázové social prompt buildery s vision-QA gates, orchestrátor s learning-loop rejectom, UI moduly, dávkové generovanie 5×7 + ZIP, reels, manifest localize.
**Kľúčové rozhodnutia:** len additívne migrácie · Playwright render worker + atomická render route · two-stage prompt builder s vision-QA · deterministický template s fixnou menou · 6 sprintov podľa plánu schváleného cez 10 otázok.
**Tech:** Docker, MariaDB, TypeScript, Next.js, Playwright, GitHub.
**Výsledok:** Hotové a pushnuté na `feat/banner-studio` (13 commitov, 43 súborov, ~3900 riadkov). PR pripravený na otvorenie.

### 15.7. — Na samostatnej branchi ❓
**Cieľ:** Automaticky zálohovať appku „aura" na OneDrive a lokálny disk, na samostatnej branchi, čo najbezpečnejšie.
**Čo sa stalo:** Zachytený len úvod — asistent sa chystal načítať kontext a položiť 20 spresňujúcich otázok. Žiadne reálne kroky zdokumentované.
**Tech:** GitHub, Git, OneDrive.
**Výsledok:** Nezdokumentované (pravdepodobne pokračuje v session `14f5be6d-…` vyššie, ktorá tú istú tému dotiahla do konca).

</details>

---

## Súhrnná štatistika

| Projekt | Sessiony | ✅ Hotové | 🔄 Rozbehnuté | 📝 Plánovanie | ❓ Nezdokumentované |
|---|---|---|---|---|---|
| Šperky Aura app | 9 | 4 | 4 | 0 | 2 (prekrytie s ❓ vyššie) |
| AI-mind / Hades | 7 | 4 | 3 | 0 | 0 |
| Retuš produktov | 2 | 0 | 0 | 2 | 0 |
| Banner Generator | 2 | 1 | 0 | 0 | 1 |
| **Spolu** | **20** | **9** | **7** | **2** | **2** |

## Otvorené resty naprieč sessionmi (na čo nadviazať)

1. **Hades expansion workflow** — nedokončený beh `wf_bfdee00a-005` (session `ebb8a62a-…`, 17.7.). Over, či ešte platí na resume.
2. **20-agentový beh** na konci session `6cb7aa43-…` (17.7.) — výsledok nebol zachytený transkriptom.
3. **Mindmap orientácia** (Šperky Aura, `2b2cded7-…`, 21.7.) — sprint-plán zamknutý, implementácia neistá.
4. **Aura Logistika → GitHub push + ngrok** (AI-mind, `75bafbab-…`, 20.7.) — prerušené hneď na začiatku.
5. **Google mind-mapa fáza B** (Šperky Aura, `251aa02f-…`, 15.7.) — nedokončená.
6. Tri session so **žiadnym zdokumentovaným výsledkom** (`ab77c7c8-…`, `cf9bfa62-…`, `3b309da5-…`) — ak boli dôležité, over stav priamo v repozitároch (`sperky-ai`, `aura-banner-studio`).

---
*Vygenerované 22.7.2026 z `summaries/sessions/`, `summaries/projects/` a raw `.jsonl` transkriptov cez 20 paralelných archivárskych agentov (Claude Code Workflow).*
