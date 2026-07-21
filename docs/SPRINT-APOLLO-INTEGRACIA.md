# SPRINT: Integrácia Apolla do Hadesa — „brain-indexer režim"

> Záväzný master plán. Zlučuje tri oblastné plány (backend/dáta, obrazovky/funkcie, dizajn/UX)
> do jedného rozvrhu 10 implementačných agentov. Rozhodnutia master plánovača v sekcii 4 sú finálne.
> Jazyk: SK, technické termíny EN. Bez build stepu (JS/CSS servírované staticky z `public/`).
> PHP výhradne cez `docker compose exec -T app php artisan …`.

---

## 1. Cieľ + záväzné rozhodnutia

**Cieľ:** Hades získava druhý spôsob učenia — **brain-indexer režim** — popri existujúcom učení zo
sessions. Indexuje ľudsky písané `.md` „mozgy" (memory export, `skills/`, externé cesty) do tej istej
neurónovej siete, pridáva znalostný model z Apolla (certainty, verify/review, decisions, tagy),
čistý REST API a dva nové pohľady (Rozhodnutia, Kontrola). Apollo je **referenčná predloha na
portovanie** — žiadna dependency, kód sa prepisuje do Hades štýlu.

**Záväzné rozhodnutia používateľa (skrátené):**

1. **Stratégia = ZLÚČIŤ.** Hades ostáva základ; brain-indexer je nový režim, nie samostatný systém.
2. **Markdown-as-master HYBRID.** Indexovaný `.md` = zdroj pravdy (CRUD naň píše, DB je index).
   Session-learned uzly (`mind_learn`) ostávajú DB-first. Hranica cez pole **`origin`**: `brain` (.md) vs `session` (DB).
3. **Viac zdrojov naraz:** (a) memory export Hadesa, (b) `skills/*.md` v repe, (c) externé cesty cez `.env`.
   Všetko sa zlúči do jednej siete.
4. **Znalostný model z Apolla:** certainty ✅ overené / 🧪 hypotéza / ⚠️ pasca; verify/review workflow
   (fronta `needs_review` + „Označiť ako overené" → `verified_at`); decisions ako časová os; tagy (M:N).
5. **Dashboard (Dnes):** 365-dňová heatmapa aktivity, kumulatívny graf rastu, donut istoty + bary per oblasť.
6. **Architektúra:** `SecretScanner` pri každom zápise (hlási názov vzoru, nie hodnotu); REST `/api/v1/*`
   s Bearer tokenom popri MCP; brain-write guard (env flag, default OFF, fail-safe).
7. **Navigácia:** +2 obrazovky — **Rozhodnutia** (časová os) a **Kontrola** (verify/review fronta).
   Výsledná nav: **Dnes / Denník / Graf / Knižnica / Rozhodnutia / Kontrola / Smernica**.
8. **Dizajn = BUSINESS-CLEAN.** Základ ostáva Aura (paper `#f8f4f7`, ink `#101d1b`, teal `#03797e`,
   gold `#b88a3a` len brand/core, Geist + Geist Mono + Playfair, Material Symbols Rounded). Z Apolla
   preberáme **disciplínu** (vrstvené neutrálne plochy, jednotné kontrakty, cert/heat ramp,
   focus-visible), **nie** navy/serif identitu. Living animácie ostávajú decentné.
9. **Postup:** plán → implementácia cez 10 agentov (sekvenčne tam, kde zdieľajú `mind.js`).

**Data-safety poučenia z auditu Apolla (NEZDEDIŤ jeho chyby):**
`content_hash` MUSÍ byť UNIQUE; pri presune medzi súbormi najprv zapíš+over cieľ, až potom zmaž zdroj
(temp-file + atomic rename); edit textu prenesie tagy/`verified_at` na nový záznam; sync lock
(`Cache::lock`) serializuje sync z UI/API/watch/writer; osirelé hrany po delete presmerovať/zmazať;
placeholder/parser nič nezahadzuje ticho → radšej `needs_review`.

---

## 2. Architektonický prehľad

```
                        ┌──────────────────────────────────────────────────┐
   ZDROJE (.md)         │                    HADES  JADRO                   │
 ┌────────────────┐     │                                                  │
 │ skills/*.md    │──┐  │   ┌───────────────┐        ┌──────────────────┐  │
 │ memory/hades   │  │  │   │ BrainSync     │        │   MindService    │  │
 │ /transcripts:ro│  ├─►│   │ Service       │──uzly─►│  learn / recall  │  │
 │ HADES_BRAIN_   │  │  │   │ (indexer)     │  hrany │  activate        │  │
 │  PATHS (.env)  │──┘  │   └───────┬───────┘        └────────┬─────────┘  │
 └────────────────┘     │          │                         │            │
        ▲               │   ┌───────▼─────────────────────────▼────────┐  │
        │ BrainWriter   │   │  MariaDB — nodes(origin=brain|session,   │  │
        │ guard OFF     │◄──┤  certainty, needs_review, verified_at,   │  │
        │ atomic tmp    │   │  content_hash UNIQUE) · tags · decisions │  │
        │  +rename      │   │  · brain_sources · sync_runs             │  │
        │               │   └──────────────────┬───────────────────────┘  │
        │  SecretScanner │                      │                          │
        │ (každý zápis)  │   ┌──────────────────▼───────────────────────┐  │
   MCP ─┼───────────────►│   │  REST /api/v1/* (Bearer token)  +  interné│  │
 (mind_learn/recall/     │   │  /api/* (SPA, same-origin, bez tokenu)   │  │
  activate/decision)     │   └──────────────────┬───────────────────────┘  │
                        └──────────────────────┼──────────────────────────┘
                                               │  JSON kontrakt (§4)
                    ┌──────────────────────────▼───────────────────────────┐
                    │  SPA:  mind.js  +  public/js/charts.js  +  mind.css   │
                    │  (Aura tokeny + business-clean disciplína)            │
                    │  Dnes · Denník · Graf · Knižnica · Rozhodnutia ·      │
                    │  Kontrola · Smernica                                  │
                    └───────────────────────────────────────────────────────┘
```

**Ako to do seba zapadá:**
- **BrainSyncService** číta zdroje z registra (`config/hades.php` → `brain_sources`, `.env` cesty),
  parsuje 1 `.md` = 1 uzol, adoptuje existujúce skill/memory uzly cez zachované `external_key`, tvorí
  `wiki` hrany z `[[odkazov]]`, flaguje neštruktúrovaný obsah a zmiznuté súbory na `needs_review`.
- **BrainWriter** je jediná cesta zápisu do `.md` (guard default OFF); atomický `tmp+rename`; po zápise
  targetovaný resync v tom istom locku.
- **SecretScanner** je jediný zdroj pravdy pre detekciu tajomstiev (MCP aj brain-write ho volajú).
- **SPA** konzumuje jednotný JSON kontrakt (§4). `charts.js` sú pure SVG/CSS-grid buildery mimo IIFE;
  `mind.css` vlastní tokeny + komponenty; wiring ostáva v `mind.js`.

---

## 3. Desať implementačných agentov

Skratky: **B** = backend, **D** = dizajn (CSS), **F** = frontend (mind.js/blade). DoD = definition of done.

### Backend track

#### Agent B1 — „Schéma a modely" (foundation)
- **Zadanie** (backend plán §a, §d/B1): 4 migrácie — `add_brain_columns_to_nodes`
  (`origin` default `session`, `certainty`, `needs_review`, `verified_at`, `source_file`, `source_line`,
  `content_hash` **UNIQUE**, index `created_at`), `create_tags_tables`, `create_decisions_table`
  (`content_hash` UNIQUE), `create_brain_sync_tables` (`brain_sources`, `sync_runs`).
  Modely `Tag`, `Decision`, `BrainSource`, `SyncRun`. Rozšíriť `Node` (fillable/casts, `tags()` BelongsToMany,
  `decisions()` HasMany, **`toApi()` + `origin, certainty, needs_review, verified_at, tags[], source_file`
  — kontrakt pre frontend**). `MindService::KIND_RANK` + `'wiki'=>3, 'manual'=>4`; `MindService::learn()`
  + voliteľné `?string $certainty, array $tags`. `config/hades.php` (+`brain_sources`, `allow_brain_write`
  default false, `api_token`, `version`), `.env.example` (+3 kľúče), alias `auth.token` v `bootstrap/app.php`,
  skeleton `AuthenticateApiToken` (hash_equals, prázdny token = fail-closed 401).
- **Súbory:** `database/migrations/2026_07_21_0000{01..04}_*.php`, `app/Models/{Tag,Decision,BrainSource,SyncRun,Node}.php`,
  `app/Services/MindService.php`, `config/hades.php`, `.env.example`, `bootstrap/app.php`,
  `app/Http/Middleware/AuthenticateApiToken.php`.
- **Závislosti:** žiadne (prvý).
- **DoD:** `php artisan migrate` prejde; `SHOW CREATE TABLE nodes` potvrdí UNIQUE na `content_hash`;
  Pest model testy (Node↔Tag, Node↔Decision, casts). `mind_learn`/`mind_recall` bez nových parametrov beží nezmenene.
- **Beh:** sekvenčne prvý v backend tracku; **paralelne s D1**.

#### Agent B2 — „Brain indexer"
- **Zadanie** (backend plán §b `app/Services/Brain/`, R1–R3, R6–R7): `BrainText` (normalize/hash sha256/wikiLinks),
  `BrainLineParser` (emoji `✅|🧪|⚠️`, FE0F variant prvý; placeholder → null; nerozpoznané → `needs_review`),
  `Frontmatter` (minimal-YAML z `ClaudeMemoryIngestService`), `BrainFileParser` (1 súbor → DTO),
  `BrainSourceRegistry` (config+`.env` → zdroje, adaptéry skills/claude-memory/memory/externé,
  **adopcia cez zachované `external_key`**: `skill:<folder>/<slug>`, `memory:<sha1>`, `brain:<key>:<sha1>`),
  `BrainSyncService` (`Cache::lock('brain-sync',600)`, `sync_runs` záznam, in-memory dedupe podľa
  `content_hash` PRED zápisom, `updateOrCreate` podľa `external_key`, strength sa NIKDY neresetuje,
  wiki hrany R6, zmiznuté súbory → `needs_review` R7, MindPulse eventy). Príkaz `mind:brain-sync {--source=} {--dry-run}`,
  scheduler (`everyTenMinutes()->withoutOverlapping(30)` + `dailyAt('03:25')`), delegácia `MindSeedSkills`/`MindSyncMemory`,
  úprava `MindExportMemory` (R3 — export len `origin=session`, prune len súborov s `source: hades`),
  vetva v `NodeMarkdownResolver`.
- **Súbory:** `app/Services/Brain/*.php`, `app/Console/Commands/{MindBrainSync,MindSeedSkills,MindSyncMemory,MindExportMemory}.php`,
  `routes/console.php`, `app/Services/{NodeMarkdownResolver,ClaudeMemoryIngestService}.php`.
- **Závislosti:** B1.
- **DoD:** Pest `BrainSyncTest` (idempotencia = 2. beh 0 created; dedupe hash; mirror R3; **adopcia existujúcich
  skill/memory external_keys = 0 duplikátov**; missing-file R7; wiki hrany R6), `FrontmatterTest`, `BrainLineParserTest`.
  Manuálne: `mind:brain-sync` na živej DB, `SELECT COUNT(*) FROM nodes` pred/po nezmenené (okrem nových).
- **Beh:** po B1; **paralelne s F1** (rôzne súbory).

#### Agent B3 — „Writer, guardy, SecretScanner"
- **Zadanie** (backend plán §b/B3, R4–R5, AUDIT): `BrainWriter` (create/update/delete;
  **atomický `<file>.tmp.<pid>` v tom istom adresári + `rename()`**; presun: cieľ zapíš+over, potom zmaž zdroj;
  guard `config('hades.allow_brain_write')` default OFF → `BrainWriteDisabledException`; targetovaný resync v locku;
  `Tombstone` pri delete; `verify(node)` → frontmatter `certainty: overene`; `writeDecision()` append),
  `SecretScanner` (Apollo patterny verbatim + Hades hex ≥40; vracia **len názvy vzorov**), `NodeDraft` DTO,
  výnimky `BrainWriteDisabledException`/`SecretsDetectedException`/`BrainFileNotFoundException`.
  Prepnúť `McpController::looksLikeSecret` na `SecretScanner` (injekcia).
- **Súbory:** `app/Services/Brain/{BrainWriter,SecretScanner,NodeDraft}.php`, `app/Exceptions/*.php`,
  `app/Http/Controllers/McpController.php`.
- **Závislosti:** B2.
- **DoD:** Pest `BrainWriterTest` (guard OFF → mtime súboru nezmenený; atomic tmp+rename; presun cieľ-pred-zdrojom;
  simulovaná výnimka → obsah aspoň v jednom súbore, tmp nezostáva; secret 422 + `force`), `SecretScannerTest`
  (každý pattern; **assert že hodnota tajomstva NIE JE v message**).
- **Beh:** po B2; sekvenčne v backend tracku.

#### Agent B4 — „REST API v1 + interné /api/* + stats"
- **Zadanie** (backend plán §b Api/*, frontend A1/A5): `Health`, `Knowledge` (index filtre
  `type,area,origin,certainty,tag,needs_review,q,limit,page`; `q` cez `MindService::searchNodes`;
  write: origin=brain → `BrainWriter`, origin=session → `MindService`; error mapovanie 403/409/422/423),
  `Graph`, `Search` (tenké wrappery, zdieľanú logiku extrahovať do služby — NEduplikovať), `Stats`
  (jednotný dashboard payload §4.4), `Sync` (POST `{source?,dry_run?}`; lock → **423**), `Decision`
  (GET filtre `year,area,origin`; POST). Routes: `Route::prefix('v1')` (health bez tokenu, zvyšok `auth.token`)
  **+ interné `/api/*` bez tokenu pre SPA** (viď §4.3): `/api/dashboard`, `/api/sync`, `/api/decisions`,
  `/api/tags`. Príkaz-parita: `mind:brain-sync` tabuľkový výstup.
- **Súbory:** `app/Http/Controllers/Api/{Health,Knowledge,Graph,Search,Stats,Sync,Decision}Controller.php`,
  `routes/api.php`, zdieľané služby pre graph/search.
- **Závislosti:** B3 (write endpointy volajú `BrainWriter`); **stats/health/graph/search časť môže začať po B1**.
- **DoD:** Pest `ApiV1Test` (401 bez/zlý/prázdny token fail-closed; CRUD; 423 lock; stats shape §4.4);
  curl smoke: `curl -H "Authorization: Bearer $T" localhost:8080/api/v1/stats`; `route:list` obsahuje v1 aj interné.
- **Beh:** po B3; merge **pred B5** (obaja editujú `routes/api.php`).

#### Agent B5 — „MCP + verify/review"
- **Zadanie** (backend plán §b/B5, frontend A3): `ReviewController` (GET fronta `needs_review` od najnovších,
  POST `nodes/{node}/verify` = `verified_at=now`, `certainty=overene`, `needs_review=false`, + frontmatter upgrade
  pri guard ON / `warnings` pri OFF, MindPulse; POST `nodes/{node}/resolve-review` = len `needs_review=false`) +
  routes (interné `/api/*` aj v1). `McpController`: `mind_learn` inputSchema +`certainty`(enum)/`tags`(array);
  `mind_recall` odpoveď +`certainty,tags,verified,origin`; `mind_overview` +`needs_review` count; nový tool
  `mind_decision` (decided_on?, text, reason?, area? → DB decision `origin=session`).
- **Súbory:** `app/Http/Controllers/{Api/ReviewController,McpController}.php`, `routes/api.php`.
- **Závislosti:** B1 (verify/review + MCP); frontmatter časť po B3; **merge po B4**.
- **DoD:** Pest `ReviewFlowTest`, `McpToolsTest` (JSON-RPC POST na `/mcp`: learn s certainty/tags, recall vracia certainty,
  verify DB-only pri guard OFF + warnings).
- **Beh:** po B1; paralelne s B4 vo vývoji, **merge až po B4**.

### Frontend / dizajn track

#### Agent D1 — „Design tokens & component library" (foundation, vlastní `mind.css`)
- **Zadanie** (dizajn plán §B, §C, §E-P0/P1): celý token blok — `--surface-raised`, `--track` (odteal-ovanie chróme B1-retarget),
  `--cert-overene/hypoteza/pasca/none`, `--heat-0..4` (teal ramp), `--fs-kpi/lh-kpi/fs-h1/fs-h2`, `--sp-2h`, `--gutter`
  (light `:root` AJ `:root[data-theme="dark"]`). Komponentové kontrakty: **`.dash-card`**, **`.cert`** (+`.cert--icon`,
  `data-cert=`), **`.tag`/`.tag--accent`** (neutrál), **`.origin`** (brain/session monochróm), `.dbar/.dbar-track/.dbar-fill`,
  `.heat/.heat-cell(.l1..l4,.out)`, `.donut/.donut-total/.cert-legend`, `.kpi-grid/.kpi-card/.kpi-label/.kpi-val/.kpi-suffix`,
  **`.dtl*`** (decisions timeline), **`.queue*`** (kontrola), `.kbd-hints`, `#dest-kontrola .count` (rail počítadlo).
  Flatten resting kariet (B6), jednotná field výška 34px (C2), raw→token (A5), toast varianty success/warn/error (E7),
  `.shimmer` skeleton (E8).
- **Súbory:** `public/css/mind.css` (výhradne).
- **Závislosti:** žiadne (paralelne s B1).
- **DoD:** kontrastné kontroly WCAG (dizajn plán §G — všetko ≥ AA text / ≥3:1 UI) na oboch témach;
  vizuálny sanity check tokenov v prehliadači; `node`/CSS lint nie je (statický CSS) — over cez browser render.
- **Beh:** prvý vo frontend tracku; **paralelne s B1**. Odomyká F1–F4.

#### Agent F1 — „Shell & architektúra + charts.js"
- **Zadanie** (frontend plán §A6, §D/F1): pridať `'rozhodnutia'`,`'kontrola'` do `SCREENS` (~3486),
  `SCREEN_LABELS`, inline validačné pole (~56), `CMDK_NAV` (~4000); rail nav (`gavel` / `fact_check`) + 2
  `<section class="screen">` v blade; `setScreen` switch → vetvy `renderDecisions()`/`renderKontrola()` (zatiaľ stub
  `renderEmpty`). Zovšeobecniť `setJournalDot` → **`setRailBadge(screen,count)`** (spätne kompat.). Vytvoriť
  **`public/js/charts.js`** s `window.HadesCharts = { heatmap(el,data), donut(el,segs), growthLine(el,series) }`
  (pure SVG/CSS-grid, číta `--cert-*`/`--heat-*` cez `getComputedStyle`), `<script src="/js/charts.js">` **pred** `mind.js`.
- **Súbory:** `public/js/charts.js` (nový), `resources/views/mind.blade.php`, `public/js/mind.js`.
- **Závislosti:** D1 (tokeny, čitateľné cez getComputedStyle).
- **DoD:** `node --check public/js/mind.js && node --check public/js/charts.js`; browser: rail prepína na
  Rozhodnutia/Kontrola (stub empty), 0 console chýb; `charts.js` renderuje so statickými dátami.
- **Beh:** po D1; **paralelne s B2/B3** (rôzne súbory). Sekvenčne pred F2/F3/F4 (zdieľajú `mind.js`).

#### Agent F2 — „Dnes dashboard + Sync UI"
- **Zadanie** (frontend plán §A1/§A5, dizajn plán §D1): rewrite `renderToday` (~3555) na dashboard grid —
  zachovať hero/„tento týždeň"/sessions/records/projekty; pridať KPI rad (`.kpi-*`), **heatmapu** (`HadesCharts.heatmap`),
  **donut istoty** (`HadesCharts.donut`) + **bary per oblasť** (`.dbar`, farby oblastí), **kumulatívny rast**
  (`HadesCharts.growthLine`), **Sync kartu** (stav ok/partial/error/running, „Sync teraz" → `POST /api/sync` + toast + refresh,
  indikátor brain-write guard). Helper `originBadge()`. Empty/loading (`.shimmer`) stavy. Rozšíriť `.screen` max-width pre dashboard.
- **Súbory:** `public/js/mind.js` (`renderToday`, `renderDashboardBlocks`), voliteľne `app/Http/Controllers/TodayController.php`
  (ak treba doladiť interný payload — hlavný zdroj je `/api/dashboard` z B4).
- **Závislosti:** F1 (charts.js, `setRailBadge`), D1 (tokeny), **B4** (`/api/dashboard`, `/api/sync`).
  Môže stavať UI proti kontraktu §4.4 s mock dátami, naostro sa napojí po B4.
- **DoD:** `node --check`; browser: Dnes vykreslí heatmapu/donut/growth/sync bez chýb; donut segmenty+legenda sedia
  (ošetrený `total=0`); heatmapa v `overflow-x:auto` (body sa horizontálne neskroluje); Sync tlačidlo funguje; light+dark OK.
- **Beh:** po F1; sekvenčne (mind.js).

#### Agent F3 — „Rozhodnutia + Kontrola"
- **Zadanie** (frontend plán §A2/§A3, dizajn plán §D2/§D3): `renderDecisions` (timeline `.dtl*`, filter chipy obdobie/oblasť,
  detail/expand, manuálne pridanie → `POST /api/decisions`) a `renderKontrola` (fronta `.queue*`, akcie
  Overiť/Vyriešiť/Preskočiť, rail badge počtu cez `setRailBadge`). Do `setupShortcuts` (~3417) vetva pri
  `S.screen==='kontrola'`: **`j/k`** posun, **`Enter`** detail, **`v`** verify, **`r`** resolve, **`Delete`** zmazať
  (rešpektuj input-guard `INPUT|TEXTAREA|SELECT` ~3405; skratky mimo obrazovky NEstrieľajú). Delete/„Preskočiť" cez
  univerzálny armed-inline pattern (žiadne natívne `confirm()`), toast success/undo (E7).
- **Súbory:** `public/js/mind.js` (`renderDecisions`, `renderKontrola`, `setupShortcuts`).
- **Závislosti:** F1 (screen shells, `setRailBadge`), D1 (`.dtl*`, `.queue*`), **B4** (`/api/decisions`),
  **B5** (`/api/review/queue`, verify, resolve-review).
- **DoD:** `node --check`; browser: timeline sa renderuje + filtre menia zoznam; Kontrola fronta + akcie + rail badge;
  `j/k/Enter/v/r/Delete` fungujú v Kontrole a mimo nej NIE; manuálne pridanie rozhodnutia funguje.
- **Beh:** po F2; sekvenčne (mind.js).

#### Agent F4 — „Certainty + tagy + canvas integrácia"
- **Zadanie** (frontend plán §A4, dizajn plán §D4): `drawShape` (~1718) — **certainty prstenec + dash encoding**
  (dizajn §D4, CVD-safe: verified=solid ring, hypoteza=dashed, pasca=solid+`warning` pip; farby z `--cert-*` cez
  getComputedStyle) len nad zoom prahom `k>0.8`, default ON, prepínač „Značky istoty" v `#sec-settings`; brain-origin
  uzly jemný `--border-strong` vnútorný rim. `S.filter.tags:Set` + dynamické checkboxy z `/api/tags` + perzistencia
  `hades.filter`. `renderLibrary` (~3644): `.cert` badge + `.tag` chips. `renderCmdk`/`renderSearch`: `.cert` badge +
  voliteľný `cert:`/`tag:` parse. Node detail panel (`#node-panel`): `.origin` + `.cert` + `.tag`.
- **Súbory:** `public/js/mind.js` (`drawShape`, `renderLibrary`, `renderCmdk`, `renderSearch`, node-panel, settings).
- **Závislosti:** F1; D1 (`--cert-*`, `.cert`, `.tag`, `.origin`); **B1** (`Node::toApi` polia); **B4** (`/api/tags`, library payload).
- **DoD:** `node --check`; browser: cert prstene na brain uzloch nad zoom prahom (subtílne, prepínateľné);
  tag filter mení graf; Knižnica/cmdk/search/panel zobrazujú cert+tag+origin; hustý graf bez vizuálneho šumu.
- **Beh:** posledný (saha do `draw()` + render fns menené F2/F3); sekvenčne.

---

## 3.1 Rozvrh vĺn

Dva tracky bežia súbežne, synchronizujú sa na JSON kontraktoch (§4). **Frontend F1→F2→F3→F4 je striktne
sekvenčný** (zdieľajú `mind.js`). Backend má jednu paralelnú vetvu (B4-stats/B5 vedľa hlavnej reťaze).

| Vlna | Backend track | FE/dizajn track | Poznámka |
|------|---------------|-----------------|----------|
| **1** | **B1** (schéma/modely/toApi) | **D1** (CSS tokeny/komponenty) | Bez závislostí, rôzne súbory → plne paralelne |
| **2** | **B2** (indexer) | **F1** (shell + charts.js + blade) | B2 po B1; F1 po D1; rôzne súbory → paralelne |
| **3** | **B3** (writer/guard/secrets) | *(F1 hotový; F2 stavia UI proti kontraktu §4.4 s mockom)* | B3 po B2 |
| **4** | **B4** (REST v1 + interné + stats) → potom **B5** (MCP/review) | **F2** (Dnes dashboard) naostro | B4 pred B5 (routes/Mcp konflikt); F2 sa napojí po B4 |
| **5** | *(backend hotový; smoke/curl)* | **F3** (Rozhodnutia + Kontrola) | F3 potrebuje B4+B5 (hotové) |
| **6** | — | **F4** (certainty/tagy/canvas) | Posledný, minimalizuje konflikty v `draw()` |

**Kritická cesta:** B1 → B2 → B3 → B4 → F2 → F3 → F4. D1 a F1 „predbehnú" vpravo (paralelne s B1/B2),
takže keď dobehne B4, frontend má hotovú kostru aj CSS a stačí napojiť dáta.

---

## 4. Riešenie konfliktov medzi oblastnými plánmi (finálne rozhodnutia master plánovača)

> Kde sa plány líšili, platí nasledovné. Preferencia: jednoduchšie riešenie bez nových dependencies.

### 4.1 `/api/today` rozšírenie vs samostatný `/api/dashboard`
**ROZHODNUTIE:** samostatný **`GET /api/dashboard`** (interný, bez tokenu) obsluhovaný `StatsController`.
`/api/today` ostáva ľahký (sessions/records/projekty). Ťažké agregáty (heatmapa/growth/donut/per_area) idú do
`/api/dashboard`, ktorý zdieľa telo s `GET /api/v1/stats` (tokenovaný externý mirror). Dôvod: 365-dňová heatmapa +
kumulatívny growth + per-area donut sú ťažké agregáty — oddelenie drží `/api/today` rýchly a dáva backendu jedno
miesto na cache. (Backend to takto navrhol; frontendová preferencia „1 round-trip" ustupuje výkonu.)

### 4.2 Názvy JSON polí — `per_area` vs `by_area`
**ROZHODNUTIE:** jednotne **`per_area`** (backendový `StatsController` je autoritatívny). Frontend `by_area` sa NEpoužíva.

### 4.3 Autentifikácia UI vs externý prístup
**ROZHODNUTIE:** dve vrstvy nad zdieľanými controllermi:
- **Interné `/api/*`** (same-origin, **bez** Bearer tokenu) — volá ich SPA (`mind.js`). Sem patria:
  `/api/dashboard`, `/api/sync`, `/api/decisions` (GET/POST), `/api/tags`, `/api/review/queue`,
  `/api/nodes/{id}/verify`, `/api/nodes/{id}/resolve-review`, plus existujúce `/api/today`, `/api/library`.
- **Externé `/api/v1/*`** (Bearer `auth.token`, fail-closed) — programatický mirror: `health, knowledge, graph,
  search, stats, sync, decisions, review`.
SPA nikdy nedrží token (žiadny token vo frontend kóde). Controllery sú zdieľané, netreba duplikovať logiku.

### 4.4 Jednotný dashboard payload (kontrakt `StatsController` → `/api/dashboard` = `/api/v1/stats`)
Toto je **záväzný tvar** pre B4 (produkuje) aj F2 (konzumuje):
```jsonc
{
  "heatmap": {
    "weeks": [ [ {"date":"2026-07-21","count":3,"level":2}, /* …7 buniek; null = mimo rozsahu */ ], /* …≤53 */ ],
    "months": { "0":"aug", "4":"sep" },        // index stĺpca → skratka mesiaca
    "total": 1234
  },
  "growth": { "labels": ["2025-08", "2025-09", …], "values": [12, 34, …] },   // KUMULATÍVNE
  "certainty": { "overene": 40, "hypoteza": 12, "pasca": 3, "bez": 70, "total": 125, "needs_review": 5 },
  "per_area": [ {"slug":"it","name":"IT","color":"#03797e","count":42,
                 "overene":20,"hypoteza":5,"pasca":1,"bez":16}, … ],
  "counts":  { "nodes":125, "edges":300, "decisions":8, "brain":60, "session":65 },
  "sync":    { "status":"ok","finished_at":"2026-07-21T03:25:12Z","created":3,"updated":5,
               "deleted":0,"skipped":1,"message":"…","brain_write_enabled":false },
  "brain_write_enabled": false
}
```
Poznámky: `heatmap.weeks[i][j]` je buď `{date,count,level}` alebo **`null`** pre bunky mimo rozsahu — `charts.js`
ich vykreslí ako `.heat-cell.out` (žiadne tiché nuly). `level` je 0–4 (počíta backend). `certainty.bez` = uzly
`origin=brain` so `certainty=null` a štruktúrované. Origin split je v `counts.brain`/`counts.session`.

### 4.5 Názvy CSS tried — dizajn plán je autoritatívny
`mind.css` vlastní **výhradne D1**, preto platia **dizajnové** názvy (frontendové aliasy sa NEpoužívajú):

| Účel | ZÁVÄZNÝ názov (D1) | NEpoužívať |
|---|---|---|
| Certainty badge | **`.cert`** (`data-cert="overene\|hypoteza\|pasca"`, `.cert--icon`) | `.cert-badge` |
| Tag | **`.tag`** / `.tag--accent` (neutrál, teal len aktívny) | `.tag-chip` |
| Origin indikátor | **`.origin`** (`data-origin="brain\|session"`) | `.origin-badge` |
| Decisions timeline | **`.dtl` / `.dtl-month` / `.dtl-item` / `.dtl-dot` / `.dtl-card`** | `.dec-*` |
| Kontrola fronta | **`.queue` / `.queue-item` / `.queue-meta` / `.queue-text` / `.queue-actions`** | `.rev-*` |
| Dashboard karta / KPI | **`.dash-card` / `.kpi-grid` / `.kpi-card` / `.kpi-val`** | — |
| Heatmapa / donut / bar | **`.heat*` / `.donut*` / `.dbar*`** | — |

### 4.6 Certainty na canvase — dizajnová verzia vyhráva
**ROZHODNUTIE:** NIE „4px tečka" (frontend), ale **prstenec za uzlom + dash encoding** (dizajn §D4, double-encoding,
CVD-safe): verified = solid ring, hypoteza = dashed, pasca = solid + `warning` pip. Renderovať **len nad zoom prahom
`k>0.8`**, **default ON**, prepínateľné v Nastaveniach. Hue certainty NEkóduje (kolízia s farbou typu uzla). Farby z
`--cert-*` cez `getComputedStyle`. Brain-origin uzly: jemný `--border-strong` vnútorný rim.

### 4.7 Manuálne rozhodnutie pri brain-write OFF
**ROZHODNUTIE:** **POVOLIŤ.** `POST /api/decisions` funguje aj pri guard OFF → uloží DB decision `origin=session`.
Pri guard ON + writable zdroj → zapíše do brain `.md` (`origin=brain`). (Potvrdzuje frontend open question 2 aj backend `DecisionController`.)

### 4.8 Ikony a nav poradie
**ROZHODNUTIE:** Material Symbols Rounded (žiadne emoji v UI chróme). Certainty: `verified`/`science`/`warning`/
`radio_button_unchecked` (bez)/`pending` (neštrukt.). Origin: `menu_book` (brain)/`bolt` (session). Nav ikony:
Rozhodnutia = **`gavel`** (medzi Knižnica a Kontrola), Kontrola = **`fact_check`** (pred Smernicou). Emoji `✅🧪⚠️`
ostávajú len v `.md` dátach.

### 4.9 charts.js mimo closure
**ROZHODNUTIE:** jediný modularizačný súbor `public/js/charts.js` (`window.HadesCharts`), pure buildery bez závislosti
na `S`. Zvyšok wiringu ostáva v `mind.js` (delenie by rozbilo closure — potvrdené oboma plánmi). Žiadny build step.

### 4.10 Certainty ako string, nie DB enum
**ROZHODNUTIE:** `certainty` je `string(10)` (`overene|hypoteza|pasca|null`), validácia v aplikácii — konzistentné
s Hades štýlom (`kind`, `relation` sú tiež string). Žiadny backfill (default `session` pre origin sedí; skill/memory
uzly preklopí na `brain` prvý sync).

---

## 5. Riziká + mitigácie (top 8)

| # | Riziko | Mitigácia + overenie |
|---|---|---|
| 1 | **Export↔index slučka** (memory/hades): sync zduplikuje exportované uzly alebo export zmaže používateľove `.md` | R3: súbor s `node_id` frontmatterom = mirror (nevytvára uzol); `MindExportMemory` exportuje len `origin=session`, prune maže len súbory s `source: hades`. Pest: export → brain-sync → počet uzlov nezmenený; prune nemaže súbor bez `source: hades` |
| 2 | **Duplicity pri adopcii**: zmena `external_key` by zdvojila 60+ skill/memory uzlov | Zachovať kľúče `skill:<folder>/<slug>`, `memory:<sha1>`; `updateOrCreate` podľa `external_key`. Pest: seed starého kľúča → sync → stále 1 uzol, `origin='brain'`. Manuálne `SELECT COUNT(*)` pred/po |
| 3 | **UNIQUE `content_hash` spadne** pri dvoch identických súboroch | In-memory dedupe PRED zápisom; NULL povolený pre session uzly. Pest: 2 rovnaké súbory → 1 uzol + `skipped_dup_hash=1`, status ok |
| 4 | **Strata dát pri brain-write** (Apollo mazal zdroj prvý) | Atomický `tmp+rename` v tom istom adresári; presun = cieľ zapíš+over, potom zmaž zdroj. Pest: simulovaná výnimka → obsah v aspoň jednom súbore, tmp nezostáva |
| 5 | **Guard/token zlyhá otvorene** | `allow_brain_write` default false; prázdny `api_token` = fail-closed 401. Pest: bez env → brain-write 403 + mtime nezmenený; prázdny token → v1 requesty 401 |
| 6 | **Secret leak do DB/logov** | `SecretScanner` jediný zdroj pravdy, vracia len názvy vzorov. Pest: response/log obsahuje názov vzoru, NIKDY matched hodnotu |
| 7 | **`mind.js` konflikty** (F1–F4 zdieľajú súbor) | Striktne sekvenčné (F1→F2→F3→F4); po každom `node --check` oboch JS + browser check; ťažké charty extrahované do `charts.js` |
| 8 | **Vizuálny šum / kontrast** (cert prstene, heatmapa, dark režim) | Cert encoding len nad `k>0.8`, prepínateľný; heatmapa v `overflow-x:auto`; tokeny pre light AJ `:root[data-theme="dark"]`; WCAG kontroly (§G dizajn plánu) na oboch témach |

Ďalšie sledované: zmiznutý súbor = strata histórie (R7 → `needs_review`, mazanie až po 30 dňoch); súbežný sync
(`Cache::lock('brain-sync')` → API 423, command exit≠0, writer čaká v locku); Windows/Docker atomic rename
(tmp v rovnakom adresári — cross-device rename padá); výkon heatmapy (`EXPLAIN` na `created_at` index, `/api/v1/stats` < 500 ms).

---

## 6. Overovací plán (koniec sprintu)

**Prostredie & migrácie**
1. `docker compose up -d` — všetky služby (app, MariaDB, Redis, Reverb) bežia.
2. `docker compose exec -T app php artisan migrate` — 4 nové migrácie prejdú; `SHOW CREATE TABLE nodes` potvrdí
   **UNIQUE `content_hash`**; `tags`, `node_tag`, `decisions`, `brain_sources`, `sync_runs` existujú.

**Brain-sync na reálnych zdrojoch**
3. `docker compose exec -T app php artisan mind:brain-sync --dry-run` → potom ostrý beh.
4. `SELECT COUNT(*) FROM nodes` pred/po: **žiadny duplikát** existujúcich skill/memory uzlov (adopcia OK);
   nové brain uzly majú `origin='brain'`.
5. Druhý beh `mind:brain-sync` = **0 created** (idempotencia). `sync_runs` status `ok`, `stats` obsahuje
   `skipped_dup_hash`, `edges_created`, `flagged_missing`.
6. Guard OFF (default): `POST /api/v1/knowledge` na brain uzol → **403**, mtime `.md` nezmenený.

**Testy (Pest)**
7. `docker compose exec -T app php artisan test` — všetky nové suity zelené: `BrainLineParserTest`,
   `SecretScannerTest`, `FrontmatterTest`, `BrainSyncTest`, `BrainWriterTest`, `ApiV1Test`, `ReviewFlowTest`,
   `McpToolsTest`. Regres: `mind:ingest` prejde, `mind_learn`/`mind_recall` cez JSON-RPC bez nových parametrov funguje.

**API smoke**
8. `route:list` obsahuje `/api/v1/*` aj interné `/api/{dashboard,sync,decisions,tags,review/queue,nodes/{id}/verify}`.
9. `curl -H "Authorization: Bearer $T" localhost:8080/api/v1/stats` → payload podľa §4.4, < 500 ms;
   bez tokenu → 401; obsadený lock → `POST /api/v1/sync` → 423.

**Frontend (browser cez `localhost:8080`)**
10. `node --check public/js/mind.js && node --check public/js/charts.js` — bez chýb.
11. Pre každú obrazovku: screenshot + `read_page` + `read_console_messages` (**0 chýb**). Overiť:
    - rail prepína na **Rozhodnutia** aj **Kontrola**;
    - **Dnes** vykreslí heatmapu / donut / growth / per-area bary / Sync kartu; donut segmenty+legenda sedia
      (aj `total=0`); heatmapa v `overflow-x:auto` (body sa horizontálne neskroluje);
    - **Rozhodnutia** timeline + filtre; manuálne pridanie funguje;
    - **Kontrola** fronta + akcie + rail badge; `j/k/Enter/v/r/Delete` fungujú v Kontrole a mimo nej NIE;
    - **Graf** cert prstene nad zoom prahom (subtílne, prepínateľné); tag filter mení graf;
    - **Knižnica / cmd-K / search / panel** zobrazujú `.cert` + `.tag` + `.origin`;
    - **light aj dark** režim tokenov; living animácie decentné.

**Uzavretie**
12. Dizajn-QA prechod (D1): kontrasty na oboch témach, konzistencia radiusov/spacingu, focus-visible na nových
    interaktívnych prvkoch, `prefers-reduced-motion`.
13. Commit + push (feature branch, PR na `main`) — až po zelených testoch a browser overení.

---

*Koniec master plánu. Kontrakty §4 (endpointy, JSON tvar §4.4, CSS názvy §4.5) sú záväzné pre všetkých 10 agentov.*
