# Redizajn grafov + agent command centre — konvenčný brief pre build agentov

Pracuj v `C:\Aura\aura-ai`. Appka je **SK-only** (žiadny i18n — všetky texty po slovensky natvrdo).
Farby **len cez CSS premenné** v `resources/css/tokens.css` (stylelint `color-no-hex` je brána).
Build je **manuálny**: `docker compose exec -T app npm run build`.

## Kontrakt (rozhodnutia používateľa)

Traja piliere s pill prepínačom hore (ako skilltree.altari.ai):
- **MAP** = radiálna konštelácia mysle na canvase (domovská obrazovka, nahrádza starý d3-force graf).
- **DASHBOARDS** = živé „command centre" agentov — reálne CLI procesy mysle so živým logom, progresom, run/pause.
- **CHART** = rollout tabuľka agentov podľa miery autonómie.

MAP: 4 úrovne (mapa→oblasť→oddelenie→uzol), deterministický radiálny layout (seed z ID) na klientovi,
jadro=miniatúra siete (klik=expand), rotácia šípky+drag, farby z Aura tokenov, veľkosť uzla=strength,
štruktúrne hrany, badge „Dnes aktívne", tweenovaná kamera, intro anim (prvý vstup plná), hash routing
na každej úrovni, breadcrumb, súrodenci ‹ › + klávesy, search pole na mape, filtre (stlmiť nie skryť),
timeline scrubber. Bez ambientu (prach/halo). Detail uzla = rozšírená hover-card (plný meta + susedia +
akcie aktivovať/upraviť/história). MAP desktop-only; mobil dostane CHART + DASHBOARDS.

Agenti (DASHBOARDS): maintenance procesy + LLM/ingest + externý „workforce" placeholder rámec.
Živý log+progres cez `AgentPulse` (Reverb). Ovládanie spustiť/pozastaviť. Deštruktívne joby
(`mind:cleanup-edges`, `mind:prune-coactivation`, `mind:automerge`) sa z UI **nespustia** bez
`maintenance.destructive_enabled` + explicitného potvrdenia.

`/api/v1/*` sa **nedotýkame** (bit-za-bit), len pridávame nové interné `/api/*` endpointy.

---

## KONVENCIE PROJEKTU (recon)

### API
- `routes/api.php`: interné `/api/*` (SPA, same-origin, bez tokenu) + zrkadlo v `Route::prefix('v1')` s `auth.token`.
  Throttle premenná `$throttleWrite='throttle:60,1'` len na mazacích/merge/directive-save routách.
- Controllery v `app/Http/Controllers/Api/` sú **tenké** wrappery nad service; validácia **inline** `$request->validate([...])`;
  JSON cez `response()->json(...)`; lock→`423`.
- `/api/mind` = `App\Http\Controllers\MindController@graph` → `App\Services\GraphService::payload($scope)`
  (`?scope=live|all`). Vracia `{name, scope, state{awake,last_activity_at}, ws{key,host,port,app_port},
  areas[{id,name,slug,color,angle}], departments[{id,area_id,name,slug}], nodes[Node::toApi()], edges[Edge::toApi()]}`.
- `Node::toApi()`: `id,type,layer_role,source,origin,area_id,department_id,label,description(null v listingu),
  certainty,needs_review,verified_at,source_file,tags[],strength(float),pinned,heat(0..1),last_activated_at,created_at`.
- `Edge::toApi()`: `id,source_id,target_id,weight,kind,auto,relation('part_of'|'uses'|null),created_at`.

### Modely / DB
- `Node` fillable/casts viď recon; `strength=float`, `last_activated_at=datetime`, `meta=array`. Metóda `heat()`.
- `nodes.type` je **DB enum** `['core','skill','memory','project']`; `certainty/kind/relation` sú voľné `string(10)`.
- Migrácie `database/migrations/YYYY_MM_DD_NNNNNN_*.php`, anonymná trieda, `down()` povinný, docblock štýl
  (vzor `2026_07_30_000002_create_llm_runs_table.php`). Štandardná Laravel `migrations` tabuľka.
- Spustenie migrácie: `docker compose exec -T app php artisan migrate`.
- `content_hash` je UNIQUE. Tabuľky: `activations`, `sync_runs`, `llm_runs`, `decisions`, `conversations/messages`.

### Konzoloví „agenti" (pre register)
Class-based v `app/Console/Commands/`: `mind:ingest`, `mind:brain-sync`, `mind:reorganize`, `mind:decay`,
`mind:rewire`, `mind:cleanup-edges`⚠, `mind:prune-coactivation`⚠, `mind:automerge`⚠, `mind:digest`,
`mind:rollup`, `mind:archive-old`, `mind:sync-memory`, `mind:export-memory`, `mind:seed-skills`,
`aura:embed`, `aura:backup`, `sperky:aggregate`.
Closure-based v `routes/console.php`: `aura:dry-run`, `aura:calibrate`, `aura:sync-runs-prune`, `aura:rewire`.
⚠ = deštruktívne (za `config('maintenance.destructive_enabled')`, default OFF). Každý má `->purpose(...)`.
Rozvrh cez `Schedule::command(...)` v `routes/console.php` (frekvencie viď tam).
**Žiadne queue joby ani `Artisan::call` v kóde zatiaľ neexistujú** — queue (`queue:work redis`) beží.

### Broadcasting / WS
- `app/Events/MindPulse.php`: `ShouldBroadcastNow`, `new Channel('mind')` (verejný), `broadcastAs()='pulse'`,
  payload `{type,data,at}`. Dispatch `MindPulse::dispatch($type,$data)`. Typy: `node.*`, `edge.*`,
  `department.created`, `recall`, `chat`.
- Reverb: `config/broadcasting.php` (`REVERB_*`), služba `reverb` `php artisan reverb:start --port=8081` (host 8083).
  FE WS params appka posiela v `/api/mind` payloade (`ws{key,host,port,app_port}`).
- FE `resources/js/graph/ws.js`: **pusher-js priamo** (nie Echo), `pusher.subscribe(ws.channel||'mind').bind('pulse', ...)`,
  `handlePulse(type,data)` mutuje stav + `bus.emit(EV.PULSE,...)` + `requestDraw()`.

### FE SPA
- Entry `resources/js/app.js`: boot poradie je kontrakt (`registerX(root)` moduly → `await loadGraph()` →
  legend/breadcrumb → `connectWs(data.ws)` → `setScreen(S.screen)`). Debug `window.AURA`.
- Router `resources/js/shell/router.js`: **stavový** `setScreen(name)` (žiadny hash/history dnes), prepína
  `.active` na `#rail .dest[data-screen]` a `#screens .screen#screen-<name>`, emitne `EV.SCREEN_CHANGED`.
- Zoznam obrazoviek: `resources/js/core/screens.js` (`SCREENS[]`, `SCREEN_LABELS`, `SCREEN_ICONS`,
  `DEFAULT_SCREEN`, `normalizeScreen()`). **Pridanie obrazovky:** (1) do `screens.js`; (2) `<button class="dest"
  data-screen="X">` do `resources/views/partials/rail.blade.php` (+ `mobile-nav.blade.php`); (3) `<section
  id="screen-X" class="screen">` include do `app.blade.php`; (4) render hook v `router.js::setScreen` alebo
  `EV.SCREEN_CHANGED`.
- Vzor screen `resources/js/screens/today.js`: `renderToday()` async, skeleton → `apiGet(...)` → HTML string
  (`esc()` z `core/dom.js`) → `body.innerHTML` → `wire...(body)`. Render-on-enter, DOM prežíva skrytý.
- Fetch: `resources/js/core/api.js` — `apiGet(path,{query,timeoutMs,signal,retry})`, `apiSend(method,path,body)`,
  `apiStream(...)`. Chyby = `ApiError` s kódom. Nová práca cez `apiGet/apiSend`, nie raw fetch.
- Canvas `<canvas id="mind">` v `resources/views/partials/canvas.blade.php`, pod shellom. Render slučka
  (`graph/render/frame.js`) kreslí **len keď `S.screen==='graf'`**; po zmene stavu volaj `requestDraw()`.
- Graph moduly `resources/js/graph/`: loader, sim, render/ (draw,edges,shapes,zoom,frame), camera, view,
  colors (`nodeColor(n)` = farba oblasti; `CORE_COLOR`,`AREA_RADIUS`,`DEPT_RADIUS`), canvas-el, input, pick,
  hover-card, focus, neighbors, local, anchors, geometry, layers, pulses, animation, awake, filters,
  filters-cert, timeline, ws.
- Farby: `tokens.css` — `--chart-1..8`, `--chart-area-*`, `--accent`, `--node-core/skill/memory/project/relation`,
  `--cert-*`, `--heat-0..4`, dark override v `:root[data-theme="dark"]`. Drift test `tests/js/css-tokens.test.js`.

### Testy
- Vitest: `tests/js/**/*.test.js`, jsdom, `import {describe,it,expect,vi} from 'vitest'`.
  Beh: `docker compose exec -T app npx vitest run`.
- Playwright: `tests/e2e/`, `workers:1`, baseURL host `http://localhost:8082` / kontajner `http://localhost:8080`.
  Projekty desktop-light/desktop-dark(smoke)/mobile. Screenshoty do `tests/e2e/__screenshots__/` (artefakt, nie asercia).
  Beh: `npm run test:e2e` (build POVINNÝ pred behom). Helpers `tests/e2e/helpers.js` (`boot, gotoScreen, settleGraph`).
- PHPUnit: `tests/Feature/`, `docker compose exec -T -e DB_DATABASE=auraai_test_<x> app php artisan test`.
  Tvar payloadu stráži `PayloadShapeTest.php`, v1 mirror `ApiV1Test.php`.

### Blade
- `resources/views/app.blade.php` = zoznam `@include` (poradie = DOM = z-index kontrakt). `@vite` v `partials/head.blade.php`.
  Obrazovky `partials/screens/<x>.blade.php` v `<main id="screens">`. Nav `partials/rail.blade.php` (+ `mobile-nav.blade.php`).
  Prepínač náhľadu grafu `#view-switch` v `partials/graph-tools.blade.php` (vzor pre nový 3-pill).

### PASCE
1. `/api/mind` NIE je v `Api\` namespace (je `App\Http\Controllers\MindController`); logika v `GraphService::payload()`.
2. Build POVINNÝ a manuálny; `node_modules` vo volume kontajnera (po `down -v` treba `npm ci`).
3. Deštruktívne joby za `maintenance.destructive_enabled` (default OFF); `migrate:fresh/refresh/reset/rollback`+`db:wipe`
   blokované guardom `auraai.allow_destructive_db_commands`. **Nespúšťaj `migrate:fresh`.**
4. WS kanál `'mind'` verejný, `channels.php` prázdny. Nový kanál `'agents'` rob rovnako (verejný, ShouldBroadcastNow).
5. `nodes.type` je DB enum — nemeníme. Render slučka spí mimo screen==='graf' — po zmene dát `requestDraw()`.
6. `app.blade.php` a `app.js` boot poradie = kontrakt; nové `@include`/`register()` pridávaj uvážene na koniec.
