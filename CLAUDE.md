# AuraAI — project contract

Fork of Hades (`C:\Users\Ucet\Desktop\AI-mind`, read-only archive). Laravel 12 + MariaDB +
Redis + Reverb, canvas graph frontend, Vite build. Branch: `feat/auraai`.

This file is the source of truth for the 10 parallel W2 packages. **Read §3 (ownership) and
§4 (locked interfaces) before touching a single file.**

---

## 1. Commands

```bash
# stack (compose project name = auraai, app on http://localhost:8082 during the sprint)
docker compose up -d
docker compose ps
docker compose logs -f app

# PHP tests — the gate. Must stay green, 0 skipped.
docker compose exec -T app php artisan test
docker compose exec -T app php artisan test --testsuite=Unit
docker compose exec -T app php artisan test --filter=SomeTest

# frontend build (node 22 + npm live in the app image AND on the host)
npm ci
npm run build                 # -> public/build/manifest.json + assets
npm run dev                   # Vite dev server with HMR

# JS tests
npx vitest run                # unit, jsdom
npx playwright test           # smoke, needs the stack running
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
  views/mind.blade.php          root template (route '/' renders this)
  views/app.blade.php           + views/partials/**   ← partial split, integrator owns the include list
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
- **No raw hex/rgba outside `css/tokens.css` and `css/dark.css`.** Canvas colours come from
  `graph/canvas-colors.js` (which still carries the `THEMES` object — `TODO(P7)`: read CSS custom
  properties instead; this is the only TODO W0 left behind).
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
| `docs/dizajn.md` | P9 |
| `docs/zlozkovanie.md` | P3 |
| `docs/BENCHMARK-LLM.md` | P5 |

### 3.1 Shared files — integrator only

Send a patch in your report; do not commit these yourself.

| File | Why |
|---|---|
| `resources/views/mind.blade.php`, `resources/views/app.blade.php` | root template = the `@include` list |
| `resources/js/app.js` | boot sequence — the order of every `register()` call |
| `resources/css/app.css` | `@import` list; the order IS the cascade |
| `resources/js/core/**` | locked interfaces, read by every package |
| `docker-compose.yml`, `docker/php/Dockerfile` | runtime |
| `.env.example` | env vars from all packages |
| `vite.config.js`, `package.json`, `composer.json` (+ locks) | build and dependencies |
| `phpunit.xml`, `vitest.config.js`, `playwright.config.js` | test gates |
| `config/auraai.php` | core config (per-domain configs have owners) |
| `CLAUDE.md`, `README.md`, `.gitignore` | project contract |
| `database/migrations/**` (existing) | nobody edits an existing migration; add your own new one |

Ownership check before every merge:

```bash
git diff --name-only feat/auraai...feat/auraai-p<N>
# every path must match package <N>'s glob, or be listed as a patch in the report
```

---

## 4. Locked interfaces (18)

Signatures below are frozen. A change goes through the integrator and gets written here first.

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
currently still renders `mind.blade.php`; switching it to `app.blade.php` is an integrator step
(see §7).

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

- **Tests are the gate.** `php artisan test` must stay green with 0 skipped, `npx vitest run` and
  `npx playwright test` green, before every commit.
- **Three attempts rule.** Three failures on the same error → stop, summarise, escalate. Do not
  keep grinding and do not delete anything; the branch stays as it is.
- **Never run a destructive DB operation autonomously** (drop, truncate, delete). Backup +
  explicit user confirmation first, even mid-run. Migrations are fine, always with a `mysqldump`
  into `backups/` (keep the last 3).
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

## 7. Open items handed to the integrator after W0

1. Route `/` still renders `mind.blade.php`. `app.blade.php` + `partials/**` exist in the tree
   (built in parallel with the module split) but are not wired to the route yet — switch it once
   the partials are diffed against the monolith screen by screen.
2. `core/screens.js` lists `chat` and `eshop`. `chat` is interface #16 as specified; **`eshop` is
   not in the spec catalogue** and needs a product decision before P9/P10 build a destination for it.
3. `api.js` exists but the ~26 raw `fetch()` call sites are untouched (see §4.1) — 429/401 still
   surface as an empty response in existing code. Each FE package migrates its own calls.
4. `graph/canvas-colors.js` still holds the `THEMES` literal (`TODO(P7)`).
5. Dead code moved verbatim, not deleted: `dock/search.js` (`renderSearch` has no caller and no
   `#search-results` markup) and `graph/timeline.js` (`setupTimeline` has no caller, no `#tl-range`
   markup). W0 does not delete what recon did not confirm dead — P8/P9 decide.
6. `resources/css/**` still contains raw hex outside `tokens.css`/`dark.css` (inherited from the
   monolith). Stylelint config + baseline is P9's first task.
