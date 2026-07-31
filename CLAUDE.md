# AuraAI — project contract

Fork of Hades (`C:\Users\Ucet\Desktop\AI-mind`, read-only archive still serving on port 8080 —
never touch it). Laravel 12 + MariaDB 11.4 + Redis 7 + Reverb + Caddy + Ollama, canvas graph
frontend, Vite build. Branch: `feat/auraai`. App on http://localhost:8082.

This file is the source of truth for the 10 parallel W2 packages. **Read §3 (ownership) and
§4 (locked interfaces) before touching a single file.**

**State after W2 (verified 2026-07-31 against the code, not from memory):**

- Gate green: **467 PHP tests / 1 630 assertions** and **370 Vitest across 31 files**, 0 skipped.
  (The older "446 PHP" figure circulating in agent briefs is stale — packages added tests.)
- Route `/` now renders `app.blade.php`; `mind.blade.php` **no longer exists** (§7.1 done).
- All 18 locked interfaces in §4 re-verified present with unchanged signatures.
- Destructive maintenance jobs remain **off** (§6) — network intact at 709 nodes / 2 170 edges /
  6 563 activations.
- `eshop` is now a real screen with a service layer, not an open question (§7.2 done).

---

## 1. Commands

```bash
# stack (compose project name = auraai, app on http://localhost:8082 during the sprint)
docker compose up -d
docker compose ps
docker compose logs -f app

# PHP tests — the gate. Must stay green, 0 skipped. Today: 467 tests / 1 630 assertions.
docker compose exec -T app php artisan test
docker compose exec -T app php artisan test --testsuite=Unit
docker compose exec -T app php artisan test --filter=SomeTest

# Running at the same time as another agent? Take your own schema FIRST.
# RefreshDatabase migrates at the start of every test, so two concurrent runs over one
# schema tear down each other's migrations ("Base table or view already exists"). In the
# first wave that produced dozens of phantom failures and hid the real ones: 10 failed on
# the shared schema, 61 on the second attempt, 3 in isolation. phpunit.xml pins
# DB_DATABASE=auraai_test, but <env> does not override an already-set variable, so -e wins.
sh scripts/test-db.sh p3      # create/reset auraai_test_p3 (needs root inside the container)
docker compose exec -T -e DB_DATABASE=auraai_test_p3 app php artisan test

# frontend build (node 22 + npm live in the app image AND on the host)
npm ci
npm run build                 # -> public/build/manifest.json + assets
npm run dev                   # Vite dev server with HMR

# JS tests — 370 across 31 files. Run them in the container so the node_modules volume is used.
docker compose exec -T app npx vitest run     # unit, jsdom
npm run lint:css                              # stylelint — guards the "no raw hex" rule
npx playwright test           # smoke, needs the stack running (host-side browsers)
npx playwright test --project=desktop-light

# artisan inside the container
docker compose exec -T app php artisan schedule:list
docker compose exec -T app php artisan migrate
```

**The Vite build is mandatory before serving.** `docker-compose.yml` bind-mounts the project
over `/var/www/html`, so assets are never baked into the image — run `npm ci && npm run build`
on the host or via `docker compose exec -T app npm run build`. Without `public/build/manifest.json`
the page throws "Vite manifest not found" (loud failure by design, never a silent stale asset).

---

## 2. Layout after W0

```
resources/
  views/app.blade.php           root template — route '/' renders THIS (mind.blade.php is gone)
                                + views/partials/**  ← partial split, integrator owns the include list
  js/app.js                     entry point + boot order (SHARED — integrator only)
  js/core/**                    locked interfaces, read by every package (SHARED)
  js/theme.js  js/markdown.js
  js/graph/**                   canvas: render/**, physics, interaction, data
  js/shell/**                   rail, header, dock, settings, router, cmdk, toasts, help…
  js/dock/**                    structure, stats, search, duplicates, pack
  js/node/**                    node panel, suggestions, record, edge admin, md overlay
  js/chat/**                    existing chat (controller, log, composer, context, commands)
  js/screens/**                 today, journal, library, decisions, review, directive, shared
  js/charts/**                  SVG chart builders (window.HadesCharts)
  css/app.css                   @import list only — the order IS the cascade (SHARED)
  css/{tokens,dark,responsive,charts}.css + css/{base,components,shell,graph,chat,screens,dock}/**
tests/
  js/**                         Vitest
  e2e/**                        Playwright + __screenshots__/ baseline
  snapshots/**                  API payload snapshots
```

Hard rules from W0:

- **≤ 400 LOC per file** in `resources/js/**` and `resources/css/**` (target ≤ 250).
- **No raw hex/rgba outside `css/tokens.css` and `css/dark.css`.** Enforced by
  `npm run lint:css` (stylelint, config in `.stylelintrc.json`). Canvas colours come from
  `graph/canvas-colors.js`, which now reads CSS custom properties — the `THEMES` literal and its
  `TODO(P7)` are **gone**; only a comment about hex parity with the old literal remains.
  `tokens.css` currently defines **228 tokens**; the only hex-looking strings left elsewhere in
  `resources/css/**` are inside comments in `base/fonts.css` and `screens/decisions.css`.
- Code identifiers, comments and commit messages in **English**; UI strings in **Slovak**.
- `public/js/mind.js` and `public/css/mind.css` no longer exist. Never re-add a `<script src>`
  or `<link rel=stylesheet>` for app assets — everything goes through `@vite(...)`.

---

## 3. File ownership (machine readable)

**One file = one owner.** Need a change in someone else's file? Do **not** edit it. Either attach
behaviour through a `data-*` attribute and a `bus` event (§5), or put the patch in your report for
the integrator. Editing a foreign file gets the commit rejected and the package re-run.

| Glob | Package |
|---|---|
| `app/Services/Recall/**`, `app/Services/Similarity/**`, `app/Services/Embeddings/**`, `app/Services/MindService.php`, `app/Services/SimilarityService.php` | P1 |
| `app/Services/Maintenance/**`, `routes/console.php`, `config/maintenance.php` | P2 |
| `app/Services/Ingest/**`, `app/Services/Brain/**` (except `SecretScanner.php`), `app/Services/SummaryService.php`, `app/Services/ClaudeMemoryIngestService.php` | P3 |
| `app/Mcp/**`, `app/Http/Middleware/**`, `app/Http/Controllers/**` (except `Chat/**`), `app/Services/GraphService.php`, `app/Services/SearchService.php`, `app/Services/NodeMarkdownResolver.php`, `app/Services/Directive/**`, `app/Services/Brain/SecretScanner.php`, `routes/api.php`, `routes/web.php`, `routes/channels.php`, `bootstrap/app.php`, `config/cors.php`, `docker/Caddyfile` | P4 |
| `app/Llm/**`, `app/Http/Controllers/Chat/**`, `app/Services/Chat/**`, `app/Models/{Conversation,Message,LlmRun}.php`, `routes/chat.php`, `config/llm.php`, `config/prompts.php`, `docker/ollama/**` | P5 |
| `resources/js/chat/**`, `resources/js/markdown.js`, `resources/css/chat/**`, `resources/css/components/md.css`, `resources/views/partials/chat-*.blade.php`, `resources/views/partials/screens/chat.blade.php` | P6 |
| `resources/js/graph/render/**`, `resources/js/graph/{geometry,anchors,layers,sim,view,animation,pulses,awake,neighbors,colors,canvas-colors,canvas-el}.js`, `resources/css/graph/canvas.css` | P7 |
| `resources/js/graph/{input,pick,camera,hover-card,focus,filters,filters-cert,local,timeline,loader,ws}.js`, `resources/css/graph/**` (except `canvas.css`), `resources/views/partials/{graph-tools,zoomctl}.blade.php` | P8 |
| `resources/css/{tokens,dark,responsive,mobile}.css`, `resources/css/base/**`, `resources/css/components/**` (except `md.css`), `resources/css/shell/**`, `resources/css/dock/**`, `resources/js/theme.js`, `resources/js/shell/**`, `resources/js/dock/**`, `resources/js/node/**`, `resources/views/partials/{rail,header,dock,node-panel,pack-drawer,cmdk,help-overlay,md-overlay,hint,toasts,hover-card,mobile-nav}.blade.php` | P9 |
| `resources/js/screens/**`, `resources/js/charts/**`, `resources/css/screens/**`, `resources/css/charts.css`, `resources/views/partials/screens/*.blade.php` (except `chat.blade.php`) | P10 |
| `docs/dizajn.md` | P9 (created), docs agent maintains |
| `docs/zlozkovanie.md` | P3 (created), docs agent maintains |
| `docs/BENCHMARK-LLM.md` | P5 |
| `README.md`, `CLAUDE.md`, `docs/**` | docs agent — see the note below |

### 3.1 Shared files — integrator only

Send a patch in your report; do not commit these yourself.

| File | Why |
|---|---|
| `resources/views/app.blade.php` | root template = the `@include` list (`mind.blade.php` is deleted) |
| `resources/js/app.js` | boot sequence — the order of every `register()` call |
| `resources/css/app.css` | `@import` list; the order IS the cascade |
| `resources/js/core/**` | locked interfaces, read by every package |
| `docker-compose.yml`, `docker/php/Dockerfile` | runtime |
| `.env.example` | env vars from all packages |
| `vite.config.js`, `package.json`, `composer.json` (+ locks) | build and dependencies |
| `phpunit.xml`, `vitest.config.js`, `playwright.config.js` | test gates |
| `config/auraai.php` | core config (per-domain configs have owners) |
| `.gitignore` | project contract |
| `CLAUDE.md`, `README.md`, `docs/**` | contract + docs. A **dedicated docs agent** owns these during a wave; feature packages still do not edit them — put doc changes in your report. |
| `database/migrations/**` (existing) | nobody edits an existing migration; add your own new one |

Ownership check before every merge:

```bash
git diff --name-only feat/auraai...feat/auraai-p<N>
# every path must match package <N>'s glob, or be listed as a patch in the report
```

---

## 4. Locked interfaces (18)

Signatures below are frozen. A change goes through the integrator and gets written here first.

**Re-verified 2026-07-31 — all 18 still hold as written.** Spot checks that were run:
`core/api.js` exports `ApiError`/`codeForStatus`/`apiGet`/`apiSend`/`apiStream`; `core/store.js`
exports `NS = 'aura.'`/`LEGACY_MAP`/`store`; `core/bus.js` exports `bus` with `on`/`once`/`emit`;
`core/events.js` holds exactly the 21 events listed in §4.4; `core/screens.js` exports `SCREENS`
(9 entries), `SCREEN_LABELS`, `SCREEN_ICONS`, `DEFAULT_SCREEN = 'dnes'`, `normalizeScreen`;
`markdown.js` exports `mdToHtml(src, opts = {})`; `app/Llm/ChatProvider.php` declares
`chat`/`stream`/`embed`/`health`/`name`; `tests/Support/FakeProvider.php` present;
`RecallEngine::recall(string, int = 12, ?string = null)` and `::search(string, int = 12)`;
`SimilarityService::warmCorpus/score/topSimilar`; `tests/snapshots/**` populated with
`*.json` + `*.shape.json` pairs; `POST /api/chat/stream` wired to `ChatStreamController`.

### 4.1 `core/api.js` — #1

```js
export class ApiError extends Error {}   // .status, .code, .body
// code: 'unauthorized'|'rate_limited'|'unavailable'|'timeout'|'aborted'|'offline'|'server'|'bad_request'
export function codeForStatus(status): string
export async function apiGet(path, opts = {})                  // opts {signal, timeoutMs=15000, retry=1, query}
export function apiSend(method, path, body = null, opts = {})   // no retry
export function apiStream(path, body, { onToken, onMeta, onCitations, onDone, onError, signal, timeoutMs = 300000 })
                                                               // → { done: Promise, abort(): void }
```

Retry is one attempt, GET only, `code === 'server'` only. **No caller ever checks `res.ok` again.**
W0 created this module and its tests but deliberately did **not** rewire the ~26 existing raw
`fetch()` calls — that is behaviour change, i.e. per-package W2 work. When you touch a screen or
a panel, migrate its fetches to `api.js` as part of that work.

### 4.2 `core/store.js` — #2

```js
export const NS = 'aura.';
export const LEGACY_MAP = { 'hades.<key>': 'aura.<key>', … }   // 17 entries
export const store = {
  get(key, fallback), set(key, value), del(key),                // JSON, parse guarded
  raw(key, fallback = null), setRaw(key, value),                // plain string
  migrateLegacy(),                                              // → number of keys moved
};
```

Keys are passed **without** the prefix (`store.raw('theme')`). Reads fall back to the legacy
`hades.*` key when the new one is absent; writes always target `aura.*`. `migrateLegacy()` runs
once from `app.js` before any `register()`, is idempotent (`aura.__migrated`), and **keeps the old
keys** as the rollback net until W4. Renames carried by the map: `minWeight2 → minWeight`,
`hints2 → hints`.

### 4.3 `core/bus.js` — #3

```js
export const bus = {
  on(event, fn),      // → () => void  (unsubscribe)
  once(event, fn),
  emit(event, payload),
};
```

A throwing handler is logged and never blocks the other subscribers.

### 4.4 `core/events.js` — #4 (closed catalogue)

`screen:changed` · `theme:changed` · `graph:loaded` · `graph:dirty` · `graph:forces-changed` ·
`graph:filters-changed` · `graph:highlight` · `graph:scope-changed` · `node:selected` ·
`node:created` · `node:updated` · `node:deleted` · `edge:created` · `edge:deleted` · `pulse` ·
`chat:opened` · `chat:mode-changed` · `chat:cited` · `toast:show` · `dock:opened` · `journal:unread`

Always import from `EV`, never type the string. A new event = a line in `events.js` **and** here,
reviewed by the integrator.

### 4.5 State slices — #5

```js
import { S, graph, ui, filters, chat, perf, markDirty } from './core/state/index.js';
```

| Slice | Owns |
|---|---|
| `state/graph.js` | `name, nodes, edges, areas, departments, byId, sim, cam, dpr, w, h, pulses, hover, selected, focus, local, degree, connectFrom, awakeUntil, awakeMinutes, dim, activations, replay` + memo caches |
| `state/ui.js` | `sound, audio, view, screen, opts, forces, pack` + `OPT_DEFAULTS`, `FORCE_DEFAULTS` |
| `state/filters.js` | `filter{types,sources,areas,tags,relations}, minWeight, skeleton, certRings, graphScope` |
| `state/chat.js` | `chatContext` (P6 extends) |
| `state/perf.js` | `_clock, _anim, _life, _lifeTier, _drawMs, _dirty, _settleFrames, _lastAmbient, _nextSynapse, _vp, _flows, _morph, _interacting, _labelShown, cursor` |

`S` is a **compat façade**: every slice key is projected onto it with a get/set accessor, so
`S.nodes === graph.nodes` always. It exists so W0 could move ~1 900 `S.foo` call sites without
rewriting them. New code should read the slice it owns directly; `S` stays for the untouched
render pipeline. Slices are deliberately mutable plain objects (no reactivity) — the draw loop
reads them every frame.

### 4.6 `register(root)` — #6

```js
export function register(root /* HTMLElement */) /* : void */ {}
```

Every module that touches the DOM exports exactly this, is called once from `app.js`, finds its
own elements **inside `root`** via `data-*` or a stable `id`, returns nothing, and must not assume
another module already ran (use `bus` for that). This convention replaced `setupControls()` — the
309-line function that wired the whole app and would have been a guaranteed merge conflict.
**`setupControls` must never come back.**

Boot order in `app.js` (contract — anything listening on `bus` must be registered before `loadGraph()`):

```
store.migrateLegacy() → setTheme → resize
→ registerFrame, Theme, Ambient, Settings, Filters, CertFilter, ViewSwitch, Rail, Dock, Help,
  Camera, NodePanel, CreateNode, EdgeAdmin, MdOverlay, Library, GraphInput(canvas), Shortcuts,
  Cmdk, Pack, Chat
→ await loadGraph()            (GET /api/mind, fills the graph slice, computeReplayBounds)
→ buildLegend, updateHeaderMetrics, renderBreadcrumb, applyOpts, setView, fitView
→ registerHints, connectWs, checkJournalUnread, setScreen
→ window.HADES / window.AURA (same object), scheduleFrame()
```

### 4.7 `data-*` contract — #7

| Attribute | Read by | Markup lives in |
|---|---|---|
| `data-screen="dnes\|dennik\|graf\|kniznica\|rozhodnutia\|kontrola\|smernica\|chat"` | `shell/rail.js`, `shell/router.js` (P9) | `rail`, `mobile-nav` |
| `data-dock="structure\|stats\|legend\|settings"` | `shell/dock.js` (P9) | `header`, `dock` |
| `data-view="map\|net\|layers"` | `shell/view-switch.js` (P9) → `graph/view.js` (P7) | `graph-tools` |
| `data-opt="<key>"` | `shell/settings.js` (P9) | `dock` |
| `data-force="charge\|linkDistance\|linkStrength\|gravity"` | `shell/settings.js` (P9) → `GRAPH_FORCES` | `dock` |
| `data-ftype` / `data-fsource` / `data-frel` | `graph/filters.js` (P8) | `dock` (P9) |
| `data-node-action="pack\|edit\|delete\|connect\|local\|md\|verify\|resolve"` | `node/node-panel.js` (P9) | `node-panel` |
| `data-chat-action="send\|stop\|copy\|regen\|remember\|cite\|thread"` | `chat/controller.js` (P6) | `chat-*` |
| `data-zoom="in\|out\|reset"` | `graph/camera.js` (P8) | `zoomctl` |
| `data-pack-id` / `data-pack-label` | `dock/pack.js` (P9) | any list row |

This is the mechanism that makes the packages disjoint: P8 wires elements that live in P9's
template without ever opening that template.

### 4.8 CSS token contract — #8

`css/tokens.css` (light `:root`) and `css/dark.css` (`:root[data-theme="dark"]`) are the only
files allowed to contain colour literals. `css/app.css` is an `@import` list and **its order is
the cascade** — it reproduces the original section order of `mind.css` exactly. Partials suffixed
`-late` are later occurrences of an already-imported component; merging them is W2 work, moving
them changes specificity.

### 4.9 Blade partial contract — #9

`app.blade.php` holds only `<head>` + `@vite(...)` + `@include`s; each partial has exactly one
owner and its `id`/`aria-*` attributes are carried over from the monolith unchanged. Route `/`
**renders `app.blade.php`** (`routes/web.php`: `Route::get('/', fn () => view('app'))`) and
`mind.blade.php` has been deleted — the integrator step is done. Eight destinations are
`#screen-<name>` sections; `graf` is the `<canvas id="mind">` beneath the shell.

### 4.10 `mdToHtml` — #10

```js
export function mdToHtml(src, opts = {})   // XSS-safe: escapes the source BEFORE formatting
// opts (P6 extension): { frontmatter, tables, links, orderedLists, blockquote, headingDepth, codeCopyButton }
```

W0 moved today's renderer as-is (frontmatter, `#`–`###`, bullets, fences, `hr`, inline code/bold/
italic). Tables, links, ordered lists, blockquote and `####` are P6.

### 4.11 `SCREENS` — #16

`core/screens.js` is the single source of truth: `SCREENS`, `SCREEN_LABELS`, `SCREEN_ICONS`,
`DEFAULT_SCREEN`, `normalizeScreen(name)`. `shell/router.js` and `core/state/ui.js` read it; the
whitelist that used to be duplicated is gone. DOM conventions it implies: the section id is
`screen-<name>`, the rail destination carries `data-screen="<name>"`.

### 4.12 Backend interfaces — #11 … #18

- **`ChatProvider`** (#11) `app/Llm/ChatProvider.php` — `chat(array $messages, ChatOptions): ChatResult`,
  `stream(array $messages, ChatOptions, callable $onDelta): ChatResult`, `embed(array $texts, EmbedOptions): array`,
  `health(): ProviderHealth`, `name(): string`. DTOs: `ChatOptions{model,maxTokens,temperature,system,timeoutMs,stop,task}`,
  `ChatResult{text,model,promptTokens,completionTokens,ms,tokPerS,finishReason}`, `EmbedOptions{model,dimensions}`,
  `ProviderHealth{ok,chat,embed,models,latencyMs,error}`. **No method throws on an unavailable model** —
  it returns `finishReason: 'error'` / `ok: false` and the caller decides. Owner P5.
- **`FakeProvider`** (#12) `tests/Support/FakeProvider.php`, deterministic, `->broken()` switch. Owner P5, consumers P1/P3.
- **`RecallEngine`** (#13) `recall(string $query, int $limit = 12, ?string $sessionKey = null): RecallResult`,
  `search(string $query, int $limit = 12): Collection`, `RecallResult{primaries, neighbours, total}`. Owner P1.
- **`SimilarityService`** (#14) `warmCorpus`, `score`, `topSimilar` — signatures unchanged. Owner P1, consumer P2.
- **API payload snapshots** (#15) `tests/snapshots/**` — shape change = failing test. Owner P4.
- **SSE `/api/chat/stream`** (#17) `POST {message, conversation_id, context_node_ids, model?}`,
  events `token`, `meta`, `citations`, `done`, `error`. Server P5, client P6.
- **`llm_runs` / `conversations` / `messages` schema** (#18). Owner P5, consumer P10.

---

## 5. How to attach behaviour to someone else's markup

1. Ask for a `data-*` hook (§4.7) — if it exists, query it inside your `register(root)`.
2. Need to react to something? `bus.on(EV.X, …)`. Need to announce something? `bus.emit(EV.X, …)`.
3. Need a new hook or event? Put the exact snippet in your report; the integrator adds it and
   records it here. **Never edit a foreign file, not even for one attribute.**

---

## 6. Working rules

- **Tests are the gate.** `php artisan test` must stay green with 0 skipped (467 today),
  `npx vitest run` (370) and `npx playwright test` green, before every commit. **Take your own
  schema first** (`sh scripts/test-db.sh <suffix>`, then `-e DB_DATABASE=auraai_test_<suffix>`)
  whenever another agent might be testing at the same time — see §1 for why.
- **The three destructive maintenance jobs stay off.** `mind:cleanup-edges`,
  `mind:prune-coactivation` and `mind:automerge` are gated behind
  `config('maintenance.destructive_enabled')` ← `AURAAI_DESTRUCTIVE_JOBS`, fail-safe `false`
  (`config/maintenance.php`; `auraai.destructive_jobs_enabled` remains a fallback reading the same
  env var). They irreversibly delete edges and merge nodes **over a single copy of the memory**,
  and their thresholds (automerge 0.92, prune 0.08, cleanup weight < 1.0 & older than 90 days) are
  calibrated for TF-IDF — on embeddings the same numbers mean something else entirely
  (decision #32). **Turning them on requires, in order:** (1) `aura:dry-run` over live data,
  (2) `aura:calibrate` for the threshold sweep, (3) recalibrated thresholds, (4) the user's
  explicit approval after reading the report. No package and no `.env.example` may flip it.
  Both read-only commands verify afterwards that node and edge counts did not change.
  Control counts — if any of these drops, something destructive ran and it must be reported:
  **nodes ≥ 704, edges ≥ 2 081, activations ≥ 6 467** (measured 2026-07-31: 709 / 2 170 / 6 563).
- **`aura:sync-runs-prune` only rotates the `sync_runs` audit table**, never knowledge data, and
  catching up historical no-op rows needs an explicit `--purge-noop` (decision #36).
- **Three attempts rule.** Three failures on the same error → stop, summarise, escalate. Do not
  keep grinding and do not delete anything; the branch stays as it is.
- **Never run a destructive DB operation autonomously** (drop, truncate, delete). Backup +
  explicit user confirmation first, even mid-run. Migrations are fine, always with a `mysqldump`
  into `backups/` (keep the last 3).
- **`migrate:fresh` / `migrate:refresh` / `migrate:reset` / `migrate:rollback` / `db:wipe` never
  go near the live DB.** On 2026-07-30 `migrate:fresh --env=testing --force` wiped live `auraai`:
  `--env` and `--database` do **not** switch the database (`--database` picks a *connection*), and
  `phpunit.xml`'s `<env DB_DATABASE>` only applies when PHPUnit boots the app. A guard in
  `AppServiceProvider` now prohibits those five commands unless the connected database name looks
  like a test DB (`/_test(?:_[a-z0-9-]+)?$/i`, e.g. `auraai_test_p7`) — `--force` does not bypass
  it. Reset a test DB via PHPUnit's `RefreshDatabase`, or name the database **literally** in the
  command. Override only ad-hoc with `AURAAI_ALLOW_DESTRUCTIVE_DB_COMMANDS=true`, never in `.env`.
- **`docker/Caddyfile` contains a plaintext MCP token — never commit it.** It stays a local
  modification until P4 moves the token into env.
- **Seed/test data is always fictional.** Read `.env` if you must, never print secret values into
  chat, logs, commits or Hades.
- Commit per finished + tested unit, messages in English. Feature branches `feat/auraai-p<N>`;
  push feature branches only, never `main`.
- Any UI change is verified in a real browser (click-through + screenshot in the report).
  Logic change = test. Purely visual/text tweaks need no test.
- Findings outside your scope: flag them, do not widen the package.

---

## 7. Open items — status after W2

Closed since W0 (verified in the code on 2026-07-31, do not re-report these):

1. ~~Route `/` renders `mind.blade.php`.~~ **Done.** `routes/web.php` has
   `Route::get('/', fn () => view('app'))` and `mind.blade.php` is deleted — `resources/views/`
   contains only `app.blade.php` + `partials/`.
2. ~~`eshop` needs a product decision.~~ **Done.** `partials/screens/eshop.blade.php`,
   `routes/eshop.php` and `app/Services/Sperky/**` (client, aggregator, order scanner, currency,
   domain answerer) all exist. MCP tools `aura_shop_orders` / `aura_shop_products` ship behind
   `AURAAI_MCP_SHOP_TOOLS`, default **off**.
4. ~~`graph/canvas-colors.js` holds the `THEMES` literal.~~ **Done** — it reads CSS custom
   properties; the `TODO(P7)` is gone.
5. ~~`dock/search.js` dead code.~~ **Done** — the file is deleted (`resources/js/dock/` is
   `duplicates.js`, `pack.js`, `stats.js`, `structure.js`). `graph/timeline.js` was the opposite
   call: it was **kept and wired**, `setupTimeline()` now has a caller in the same module.
6. ~~Raw hex outside `tokens.css`/`dark.css`.~~ **Done** — `npm run lint:css` (stylelint) guards
   it; the two remaining matches are hex mentioned inside comments, not literals.

Still open:

3. **`api.js` migration is partial.** `resources/js/**` still contains **20 raw `fetch()` calls**
   (down from ~26). In those call sites 429/401 still surface as an empty response instead of an
   `ApiError`. Each FE package migrates its own calls when it next touches that screen or panel —
   this is behaviour change, so it needs a test.
7. **Port 8082 is temporary.** Hades keeps 8080 as the live read-only fallback until AuraAI has
   proven itself; switching to the final port is the last step of the sprint and touches
   `docker-compose.yml` (integrator).
8. **`docker/Caddyfile` still carries a plaintext MCP token** and therefore stays an uncommitted
   local modification until the token moves into env (§6).
9. **Destructive job thresholds are still TF-IDF-calibrated** and the jobs stay off until the
   dry-run/calibrate → approval sequence in §6 completes.

---

## 8. Rules for a future session

Read in this order: this file (§3 ownership, §4 locked interfaces, §6 rules) →
`docs/zlozkovanie.md` for where code lives and how ingest flows → `docs/dizajn.md` before any
CSS or UI work → `docs/BENCHMARK-LLM.md` before changing a model or a prompt.

- Verify the app is up and the logs are clean before starting: `curl localhost:8082/up`,
  `docker compose logs -f app`.
- **Never touch Hades on port 8080** — read-only archive, separate compose project, separate
  volume (`hades_dbdata`). AuraAI's data lives in `auraai_dbdata`.
- **Never write documentation you have not verified against the code.** Every claim in `README.md`
  and in `docs/**` was checked against a file, a config value or a query — keep it that way.
  A doc that lies is worse than no doc.
- Do not print secret values (tokens, keys, passwords) into chat, logs, commits or Hades, not even
  partially. Reading `.env` is fine.
- Slovak for comments and UI strings, English for identifiers and commit messages.
- Three failures on the same error → stop, write it down, escalate. Delete nothing.
- Findings outside your scope: flag them, do not widen the package.
