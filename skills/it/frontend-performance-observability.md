# Frontend performance + observability

> Produkčný playbook pre výkon kritických používateľských ciest od lab profilu po privacy-safe RUM, route/component budgets, atribúciu regresií, alerty a rollback rozhodnutia.

## Miesto v pokročilom pláne

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`
- **Requires:** kritické journeys z `skills/it/product-ux-delivery.md`, feature IDs z `skills/it/frontend-component-architecture.md` a async boundaries z `skills/it/resilient-async-ui.md`.
- **Companions:** `skills/it/responsive-adaptive-app-layouts.md`, `skills/design/ui-motion-transitions.md`, `skills/it/canvas-data-visualization-ux.md`, `skills/it/data-dense-workspaces.md`.
- **Hands off to:** `skills/it/devops-backend.md` pre canary, alerty a rollback; vlastníkovi feature pre remediation.

Tento skill meria a atribuuje. Nevlastní feature boundaries, motion choreography, canvas algoritmus, component tokeny ani accessibility semantics.

## Výstup skillu

Odovzdaj:

1. critical-journey performance contract,
2. metric dictionary a meracie body,
3. lab a RUM profil,
4. asset/network/main-thread/render/memory budgets,
5. attribution a privacy-safe telemetry kontrakt,
6. CI, canary, alert a rollback gates,
7. výnimky s ownerom a expiráciou.

## 1. Definuj journey, nie iba page score

Pre každú kritickú úlohu zapíš:

| Pole | Príklad |
|---|---|
| Journey ID | `ops_run_open` |
| Start | navigation alebo autentizovaný user intent |
| Usable end | detail má dáta, povolené akcie a stabilný focus |
| Segments | route, device class, locale, connection, release |
| Dataset | 50 behov, 5 agentov, realistická timeline |
| Budget | shell, network, render, interaction a total |
| Owner | feature + performance owner |
| Recovery | degrade, lazy load, rollback alebo accepted exception |

Neoptimalizuj iba syntetický homepage score, ak používateľ zlyháva pri searchi, canvas interakcii alebo otváraní detailu.

## 2. Udrž metric dictionary

Každá metrika má:

```yaml
metric_id: graph_first_usable
unit: ms
start: navigationStart
end: graph rendered + hit testing ready + primary controls enabled
source: performance-mark
segments: [build_id, route_id, device_class, locale]
sample_rate: 0.1
owner: graph
retention: 30d
```

- Názov metriky nemen bez verzie.
- Start a end sú pozorovateľné eventy, nie neurčitý dojem.
- Nezmiešaj cold a warm cache, foreground/background ani mobile/desktop do jedného priemeru.
- Percentily počítaj nad events alebo sessions podľa explicitnej definície.
- Pri zmene instrumentácie označ discontinuity; neporovnávaj nekompatibilné baseline.

## 3. Kombinuj lab a field dáta

### Lab

Použi na reprodukovateľnú diagnostiku pred release:

- konkrétny commit/build,
- cold a warm cache,
- mobile aj desktop viewport,
- Fast 4G alebo projektový network profile,
- 4× CPU slowdown pre starter profile,
- stabilný seed dataset,
- aspoň 5 behov a median + worst relevant run,
- performance trace, bundle report a screenshot stavov.

### RUM

Použi na skutočnú používateľskú skúsenosť:

- p75 pre Core Web Vitals,
- segment podľa route, release/build, device a connection class,
- locale a experiment iba pri dostatočnej vzorke,
- sampled raw events s agregáciou bez user contentu,
- data-quality dashboard a known instrumentation gaps.

Lab nevie dokázať produkčný výsledok. RUM bez lab trace nevie spoľahlivo vysvetliť príčinu. Release decision používa oba.

## 4. Core Web Vitals gate

Na p75 relevantných reálnych návštev cieľ:

| Metrika | Good threshold |
|---|---:|
| LCP | ≤ 2,5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0,1 |

- Vyhodnocuj mobile a desktop oddelene.
- Pri SPA route zaveď projektové soft-navigation meranie popri štandardných page metrics; neoznač ho automaticky za oficiálne CWV.
- Field dáta označ podľa origin/URL coverage a sample confidence.
- Ak ešte nie je RUM vzorka, použi schválený lab proxy a release označ ako `provisional`, nie `pass-field`.

## 5. Hades starter budgets

Tieto čísla sú projektové počiatočné limity; po získaní baseline ich sprísni alebo formálne zmeň.

| Oblasť | Gate |
|---|---|
| Shell | `navigation → mind_shell_ready` ≤ 1,5 s v mobile lab profile |
| Graph | `navigation → graph_first_usable` ≤ 2,5 s; network a render osobitne |
| Local feedback | select/search/dock vizuálna odozva ≤ 100 ms |
| Handler | p95 vlastného handlera ≤ 50 ms v lab fixture |
| Main thread | 0 feature-owned task > 50 ms na kritickej ceste bez splitu alebo výnimky |
| Initial JS | ≤ 200 KiB gzip |
| Initial CSS | ≤ 80 KiB gzip |
| Initial fonts | ≤ 150 KiB transfer |
| Critical requests | ≤ 30 pred usable shell |
| Lazy chunk | ≤ 80 KiB gzip |
| Entrypoint delta | >5 KiB gzip vyžaduje budget review |
| DOM lifecycle | po 50 mount/unmount: 0 detached feature nodes a 0 duplicate listeners/observers |
| Memory proxy | stabilized heap nárast ≤10 % v definovanom lab scenári |

Experimentálne browser memory API nepouži ako jediný hard release gate. Kombinuj heap snapshot, lifecycle counters a reprodukovateľný scenár.

## 6. Instrumentuj cez jeden adaptér

Vytvor projektový performance adapter nad:

- `PerformanceObserver`,
- User Timing marks/measures,
- Navigation/Resource Timing,
- Long Animation Frames alebo Long Tasks podľa podpory,
- Server Timing,
- web-vitals knižnicu alebo ekvivalent pre CWV,
- interný trace/correlation ID.

Feature volá stabilné API:

```js
perf.mark('search_request_start', { feature: 'search' });
perf.measure('search_results_ready', 'search_request_start', {
  route: 'mind',
  outcome: 'success',
});
```

- Browser capability checkni a chýbajúcu metriku označ `unsupported`.
- Observer registruj raz a dispose-ni subscriptions.
- Performance measurement nesmie samo vytvárať long tasks alebo layout thrashing.
- High-cardinality raw URL, selector ani user-provided ID neposielaj.

## 7. Atribuuj čas po vrstvách

Rozlož journey:

```text
navigation
  → connection/TTFB
  → critical assets
  → parse/compile
  → app bootstrap
  → data request
  → state/view-model
  → DOM/canvas render
  → usable interaction
```

Pri regresii urč:

- build a first bad release,
- route/feature/component,
- network vs server vs main thread vs render,
- blocking resource alebo long task ownera,
- affected device/locale/connection segment,
- user outcome, nie iba ms delta.

Nepriraď vinu frameworku alebo sieti bez trace evidence.

## 8. Asset a bundle governance

- Každý entrypoint má JS/CSS/font/media budget.
- CI vytvorí manifest delta podľa entrypointu a feature.
- Neimportovaný component musí pridať 0 runtime bytes.
- Lazy loading má loading, error, retry a preload policy podľa používateľského intentu.
- Duplicate dependency, polyfill a locale data reportuj osobitne.
- Source map drž dostupný pre profiling bez verejného úniku zdrojov podľa deployment policy.
- Font subset, preload a fallback musia chrániť content aj CLS.

## 9. Main-thread a rendering budget

- Rozdeľ task nad 50 ms alebo zdôvodni výnimku.
- Event handler vykoná minimum; drahú prácu naplánuj, chunkni alebo presuň do workeru.
- Batchuj DOM reads/writes.
- Nemeranú mikro-optimalizáciu odmietni.
- Canvas, motion a virtualizáciu profiluj na ich realistickom worst-reasonable datasete.
- Pri animácii sleduj frame time, missed frames a input contention, nie iba CSS vlastnosť.
- Pri component rerenderi meraj príčinu a affected subtree.

## 10. Privacy-safe RUM

Povoľ minimálne:

- build/route/feature ID,
- metric ID, duration/value a outcome,
- coarse device/connection class,
- supported locale ID,
- anonymný sampling bucket,
- trace ID s krátkou retenciou podľa policy.

Zakáž defaultne:

- prompt, chat alebo memory content,
- node labels a search queries,
- email, meno, file path alebo raw URL params,
- auth token, session ID a secrets,
- DOM text, screenshot a chain-of-thought.

Gate: aspoň 98 % sampled telemetry events prejde schema/data-quality validáciou. Consent, purpose a retention rieš s `skills/it/privacy-permissions-trust-ux.md`.

## 11. CI a release policy

CI zastaví:

- prekročenie hard asset budgetu,
- chýbajúcu metric schema alebo ownera,
- neodsúhlasenú regresiu >10 % oproti baseline na stabilnom lab profile,
- duplicate listener/lifecycle leak v definovanom teste,
- telemetry payload s forbidden fieldom.

Canary release:

1. začni 5–10 % oprávneného trafficu,
2. oddeľ build/device/route,
3. čakaj na minimálnu vzorku alebo časové okno,
4. porovnaj baseline aj absolute budget,
5. rozšír, zastav alebo rollbackni podľa policy.

Rollback trigger: p75 budget breach v dvoch vyhodnocovacích oknách a súčasná regresia >10 %, alebo okamžite pri kritickom task failure. Prahy uprav podľa trafficu a rizika; pravidlo musí existovať pred release.

## 12. Výnimky

Každá výnimka obsahuje:

```yaml
budget: initial_js
measured: 216KiB
limit: 200KiB
reason: temporary-editor-migration
owner: frontend-platform
remediation: split-editor-chunk
ticket: PERF-42
expires: 2026-09-01
```

Expirácia bez nápravy znovu zablokuje release. Trvalá výnimka je zmena budgetu a vyžaduje nový baseline aj schválenie.

## Hades adoption

1. Zmeraj baseline `mind.js`, `mind.css`, shell, graph, select node, dock, search a chat status.
2. Zaveď Vite-managed entrypoints a ponechaj dočasnú rollback cestu pre legacy assets.
3. Pridaj marks `mind_shell_ready`, `graph_first_usable`, `node_detail_ready`, `search_results_ready`, `chat_first_status`.
4. Segmentuj RUM podľa build, route, device a locale; neposielaj node/chat obsah.
5. Pridaj bundle manifest delta, token/component tests a lab profile do CI.
6. Nasadzuj cez canary a rozširuj až po budget a data-quality gate.

## Release gate

- [ ] Kritické journeys majú start, usable end, dataset, segments, budget a ownera.
- [ ] Lab profile je reprodukovateľný a verzovaný.
- [ ] RUM a lab metriky sa nezamieňajú; field pass má dostatočnú vzorku.
- [ ] LCP, INP a CLS spĺňajú good thresholds na p75 alebo je release explicitne provisional.
- [ ] Asset, request, main-thread, lifecycle a telemetry budgets prešli.
- [ ] Regresia má feature/component atribúciu a remediation ownera.
- [ ] RUM payload neobsahuje user content, PII ani secrets.
- [ ] Výnimky majú meranie, ticket, ownera a expiry.
- [ ] Canary, alert a rollback pravidlá sú otestované.

## Zdroje

- [W3C — Performance Timeline](https://www.w3.org/TR/performance-timeline/)
- [W3C — Resource Timing](https://www.w3.org/TR/resource-timing/)
- [W3C — Server Timing](https://www.w3.org/TR/server-timing/)
- [MDN — PerformanceObserver](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)
- [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [web.dev — Measure Web Vitals in the field](https://web.dev/articles/vitals-field-measurement-best-practices)
- [Chrome for Developers — Lighthouse](https://developer.chrome.com/docs/lighthouse)
- [Laravel 13 — Vite](https://laravel.com/docs/13.x/vite)
