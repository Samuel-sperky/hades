# Stav Hadesa — 24. 8. 2026

## Vetvy (dôležité)

- `main` je **11 dní pozadu** (posledný commit 13. 8.). Živý stav je na
  **`feat/hades-ux`** — 63 commitov pred `main`, posledný z dnes.
- Nezmergované vetvy: `feat/hades-ux` (63), `feat/hades-klient` (34),
  `feat/hades-branding` (33), `feat/hades-redizajn` a
  `feat/mcp-tags-a-uzly-oblasti` (7), `fix/mind-entity-escaping` (3).
- `claude/keen-kalam-32ee74` sa od `ux` rozišla (1 commit navyše, 4 chýbajú).
- **Najbližší krok: zmergovať to do `main`** — inak sa vetvy rozídu ešte viac.

## Čo je hotové (stav `feat/hades-ux`)

- **Jadro:** Laravel + MariaDB + Redis + Reverb v Dockeri, MCP server na
  `/mcp` (+ stdio), REST API (67 routov), 23 migrácií.
- **MCP: 20 nástrojov** (z pôvodných 4) — `mind_learn/recall/activate/overview`
  + `read/update/delete/rename/move/link`, `journal/today/library/review/
  hygiene/decision(s)/directive/run(s)`.
- **Hades konzola** — vlastná plocha (`public/js/console/`) s behmi Claude
  Code, dvojfázovou bránou zápisov, profilmi nástrojov a run logom.
- **Desktop appka (Electron)** — frameless okno s vlastnou lištou, token cez
  `onBeforeSendHeaders` (bez proxy), stavy „Hades nebeží"/offline/reconnect,
  tray + notifikácia, `electron-builder`. Overené reálnym behom aj ako
  zabalená `Hades.exe`.
- **Chat nad grafom** — dok Charóna nad plátnom, spoločný `runclient`
  s konzolou, `graph_focus`, kontext uzlov skladaný na serveri.
- **Branding** — vlastná značka a paleta (`docs/BRAND-HADES.md`), teal preč.
- **Sémantické recall** — embeddingy uzlov (`node_embeddings`), hybridné
  vyhľadávanie, rewire podľa významu (zmerané, časť vypnutá).
- **Prístupnosť** — reduced-motion, canvas `role=img` so živým aria-labelom,
  skip-linky, jeden globálny `:focus-visible`, zásahové ciele na normu.
- **Frontend** — jeden graf so 4 úrovňami zanorenia, **7 obrazoviek**
  (Dnes, Denník, Knižnica, Kontrola, Rozhodnutia, Runy, Smernica), bez build
  stepu, deterministický layout, tmavá téma default.
- **Testy:** sqlite **475 prešlo / 45 skipped / 0 padnutých**;
  MariaDB sada 116 testov, 0 padnutých. Dvojité CSS deklarácie: 0.

## Otvorené

- **Bezpečnosť:** MCP token a bcrypt hash sú v histórii commitov →
  **rotovať**. Ďalej `docs/BEZPECNOST.md` §8: token v URL sa loguje, jeden
  statický token na okruh bez expirácie, triviálne DB heslá, `APP_DEBUG=true`,
  nechránený `POST /debug/snapshot`, rate limit len na `/api/chat`.
- **UX backlog:** A5 (hľadanie v Rozhodnutiach), A15/A17/A18 (smernica po
  obnove, „Povoliť vždy", front správ), D13, zvyšok R6(c), P13 (prsteň
  composera — merač vracia zamrznutý computed style).
- **Rail pretečie** pod ~600 px výšky (11 destinácií, `#rail` nemá
  `overflow-y`).
- **`electron-builder` audit:** 11 high + 1 critical (`tar`) v build-time
  toolchaine; do balíka nejde nič, vyčistenie žiada breaking bump.
- **Staršie dlhy:** 3 622 tag checkboxov z `/api/tags`, mŕtvy kód spred
  redizajnu (`timeline`, `search.renderSearch`, …), raw hex mimo `:root`,
  žiadne frontend testy (UI sa overuje headless Chromom).

Detaily: `README.md`, `CLAUDE.md`, `docs/BEZPECNOST.md`,
`handoff/UX-DRUHE-KOLO-2026-08-24.md`, `docs/sprint-2026-08-21/`.
