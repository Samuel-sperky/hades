# Handoff — UX/UI, desktop appka, chat nad grafom (21.–24. 8. 2026)

Kontrakt: [KONTRAKT-UX-APPKA-CHAT-2026-08-21.md](../KONTRAKT-UX-APPKA-CHAT-2026-08-21.md) ·
triáž a baseline: `docs/sprint-2026-08-21/`. Vetva `feat/hades-ux`.

## Čo je hotové (commitnuté)

Štyri ciele zadania — UX/UI, desktop appka a jej dizajn, chat nad grafom, dokončenie
zvyšku auditu — sú z veľkej časti hotové, otestované a overené meraním v prehliadači.

- **Dizajn systém + čitateľnosť** (D1/D2/D5/D6/D18/D19/D21/D23, R2–R5/R7–R9, P5):
  `console.css` dvojité deklarácie A=15→0 cez `:is(a,button):where(...)` na špecificite
  0-0-1; jeden globálny `:focus-visible`; density prepínač (3 škály, cozy = bez atribútu);
  `-ink` kontrast tokeny; brána zápisov dostala späť variantné tlačidlá.
- **Prístupnosť** (P1–P4/P7/P9–P11/P13): reduced-motion (sieť dosadne a stojí, žiadny
  determinizmus), canvas `role=img` + živý aria-label, skip-link na oboch plochách, fokus
  po rozhodnutí, karta povolenia hlási zápis cez `#console-live`, `aria-pressed` na čipoch,
  zásahové ciele na normu.
- **Desktop appka (Electron, `electron/`):** frameless okno s vlastnou lištou a identitou,
  token cez `onBeforeSendHeaders` (žiadny proxy), stavy „Hades nebeží"/offline/reconnect,
  tray + notifikácia „beh čaká na potvrdenie" (bez obsahu zápisu), `electron-builder`.
- **Chat nad grafom:** dok Charóna nad plátnom na zdieľanom `runclient` (jedna cesta
  k modelu, dvojfázová brána platí), profily nástrojov, `graph_focus`, `ContextBlock`
  (kontext uzlov skladaný na serveri z id), mŕtvy `chat.js` von, A8 zlúčené.

## Čo treba vedieť pri pokračovaní

- **Jeden stream, dve plochy.** Dok aj konzola idú cez `public/js/shared/*`
  (`runclient`/`ndjson`/`gate`/`runstate`/`markdown`). Nerob tretiu kópiu. `runstate.js`
  a `markdown.js` sa SEM presunuli z `public/js/console/`.
- **Profily = bezpečnostný zoznam.** `ToolRegistry::PROFILES`, neznámy sa odmieta. Test
  pinuje strop tokenov na profil a **padne pri raste definície** (overené na `MindRecallTool`:
  memory 1604 > 1600). `graph_focus` je len v `graph`; testy naň používaj `canon()`, nie
  `registry()` (to bola príčina 6 pádov, ktoré som opravil).
- **`ContextBlock` skladá kontext NA SERVERI z id.** Klient posiela len `context_node_ids`.
  Bez validačného pravidla v `RunController` Laravel pole ticho zahodí — to bola tichá
  smrť funkcie, ktorú review chytil a ja opravil (+ 7 testov `ContextBlockTest`).
- **Electron nemá proxy a nesmie ho dostať** — token ide cez `onBeforeSendHeaders`. Komentár
  v `main.js` to vysvetľuje. `bin/hades.cmd` ostáva ako záloha bez inštalácie.

## Otvorené body (backlog, triáž hotová)

- **IA toky (neurobené):** A2 (Ctrl+K → prvá položka, nie „Vytvor smernicu"), A4 (detail
  Denníka/Kontroly na mieste namiesto skoku na Graf), A5 (hľadanie v Rozhodnutiach), A10
  (dok Prehľad → otvoriť Dnes), A12 (pomenované grupy railu + CMDK nav pre Runy/Charón),
  A15 (smernica ako správa po obnove), A17 („Povoliť vždy" v hlavičke), A18 (front správ
  počas behu), kopírovanie odpovede/kódu. Všetko v `docs/sprint-2026-08-21/TRIAZ-A-P.md`.
- **P13 (prsteň composera):** CSS správne v zdroji aj CSSOM, ale merač v headless Browser
  pane vracia zamrznutý computed style (aj `!important` kópia sa neprejaví, čo porušuje
  cascade → chyba merača). Re-verifikovať na čistom loade / reálnou klávesnicou.
- **Electron inštalátor:** konfigurácia hotová, ale build/boot **neoverený** (headless, bez
  GUI/wine). Otestovať na reálnom stroji: `npm run app` a `npm run app:build`.
- **`electron-builder` audit:** 12 advisories (11 high, 1 critical `tar`) sú jeho build-time
  toolchain, **nebalia sa** do appky (ALLOW-list = `electron/**`). Vyčistenie žiada breaking
  bump `electron-builderu` — na pokyn, nie autonómne.

## Prostredie a testy

- Migrácia `tool_profile` spustená, záloha v `backups/hades-2026-08-24-pred-tool-profile.sql`
  (držané posledné 3).
- `php artisan test` (sqlite): **475 passed, 45 skipped, 0 failed.**
- `phpunit.mariadb.xml --filter="HybridRecall|RecallBench|ConsoleTools|McpTools"`:
  **107 testov, 0 padnutých, 0 preskočených.**
- Merací harness a identita preview servera (8093) overené; Hades MCP bol počas behu
  odpojený, pracoval som bez neho.

## Pasca zapísaná

Keď Workflow agenta zabije týždenný limit, jeho Edit zmeny **sú už na disku** — over
`git status`, neprerábaj (stalo sa dvakrát: vlny 3 a 5). Uložené aj do súborovej pamäti
ako `workflow-limit-salvage`.
