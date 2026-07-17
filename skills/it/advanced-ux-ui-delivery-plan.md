# Advanced UX/UI delivery plan

> Centrálny orchestrátor pre výskum, obsah, design system, komponenty, responzivitu, accessibility, motion, async správanie, AI human control, výkon, bezpečnosť a release ako jeden auditovateľný produktový plán.

## Výsledok plánu

Použi tento skill ako vstupný router pre významnú UX/UI alebo AI-product zmenu. Nevyrábaj izolované obrazovky ani nenačítaj celý katalóg naraz. Zostav najmenší potrebný skill path, odovzdávaj verzované artefakty a nepusti prácu cez nesplnený hard gate.

Finálny balík obsahuje:

1. decision brief a evidence pack,
2. risk/data/trust mapu,
3. task, IA, search a content contract,
4. design-system a component contract,
5. responsive, accessibility, motion a async pravidlá,
6. implementation a platform contract,
7. performance, security, privacy a AI eval dôkazy,
8. release decision, rollout, rollback a ownerov.

## Typy väzieb medzi skills

Každú väzbu čítaj presne:

| Typ | Význam |
|---|---|
| `requires` | Bez výstupu predchádzajúceho skillu nezačni. |
| `companion` | Použi súbežne, ak je podmienka relevantná. |
| `hands-off-to` | Výstup je povinný vstup nasledujúceho skillu. |
| `specializes` | Užší playbook nahrádza iba danú časť, nie celý parent. |
| `governed-by` | Skill vykonáva prácu, ale policy/gate vlastní iný playbook. |

Nevytváraj link iba preto, že dva súbory hovoria o UI. Link musí prenášať konkrétny artefakt, rozhodnutie alebo gate.

## Router: načítaj iba potrebnú vetvu

### Povinné jadro významnej produktovej zmeny

1. `skills/it/product-ux-delivery.md`
2. `skills/it/ux-content-localization.md`
3. `skills/design/ui-design-systems.md`
4. `skills/it/design-system-component-engineering.md`
5. `skills/it/responsive-adaptive-app-layouts.md`
6. `skills/it/accessible-interaction-patterns.md`
7. `skills/it/resilient-async-ui.md`
8. `skills/it/frontend-performance-observability.md`

### Podmienené vetvy

| Trigger | Pridaj skills |
|---|---|
| Neistý problém alebo zásadné rozhodnutie bez dôkazu | `skills/it/ux-research-operations.md` |
| Search, autocomplete, filtre, relevance alebo findability | `skills/it/search-navigation-discovery.md` |
| Tabuľky, bulk výber, auditné zoznamy | `skills/it/data-dense-workspaces.md` |
| Graf, mapa, canvas alebo analytická vizualizácia | `skills/it/canvas-data-visualization-ux.md` |
| Nový component API, varianty alebo knižnica | `skills/it/design-system-component-engineering.md` |
| Nová feature hranica alebo refactor monolitu | `skills/it/frontend-component-architecture.md` |
| Animácia, gesture, enter/exit alebo shared transition | `skills/design/ui-motion-transitions.md` |
| Personal data, consent, permission, export alebo delete | `skills/it/privacy-permissions-trust-ux.md` |
| AI odpoveď, memory, tool, agent, approval alebo cost | `skills/ai-nastroje/ai-product-ux-human-control.md` |
| API, auth, authorization alebo external write | `skills/it/api-security.md` |
| Persistencia, query model alebo migrácia dát | `skills/it/mariadb.md` |
| Deploy, queue, observability alebo rollback | `skills/it/devops-backend.md` |
| Figma file, library alebo design-to-code MCP workflow | `skills/design/figma-mcp-agentic-studio.md` |

### Execution router

- Použi `skills/ai-nastroje/five-agent-low-spend-loop.md` na úzky design/UX návrh s pevným capom a najviac dvoma kolami.
- Použi `skills/ai-nastroje/sprint-context-200.md` na zber chýbajúceho kontextu pre veľký cross-functional sprint.
- Použi `skills/ai-nastroje/ten-agent-sprint-run.md` až na schválený implementačný sprint s kódom, testami a release integráciou.
- Execution skill nesmie meniť poradie hard gates tohto plánu ani sám rozšíriť scope alebo budget.

## Spoločný artifact envelope

Každý handoff prenášaj v rovnakom obale:

```json
{
  "artifact_id": "uuid",
  "artifact_type": "decision_brief|evidence_pack|risk_map|ux_contract|component_contract|release_evidence",
  "version": 3,
  "status": "draft|reviewed|approved|superseded|blocked",
  "owner": "role-or-team",
  "source_skills": [],
  "decision_ids": [],
  "evidence_ids": [],
  "assumptions": [],
  "constraints": [],
  "open_risks": [],
  "acceptance_criteria": [],
  "created_at": "ISO-8601"
}
```

- Nikdy neposúvaj plný agentový transcript ako handoff.
- Cituj evidence ID pri tvrdení, ktoré mení návrh alebo release.
- Zmenu schváleného rozhodnutia ulož ako novú verziu s dôvodom a ownerom.
- `blocked` artefakt jasne pomenuje chýbajúce rozhodnutie, authority alebo dôkaz.
- Chain-of-thought, secrets, PII a unredacted research recordings do envelope nepatria.

## Fáza 0 — scope, context a orchestration

**Vstup:** požiadavka, repo, existujúce rozhodnutia a constraints.

1. Rozlíš feature, experiment, refactor, incident alebo design-system zmenu.
2. Zvoľ execution route: lokálna práca, five-agent loop alebo 10-agent sprint.
3. Pri materiálnych medzerách vyplň relevantné bloky zo `skills/ai-nastroje/sprint-context-200.md`.
4. Vytvor scope, out-of-scope, budget, ownerov a stop podmienky.

**Výstup:** `decision_brief@v1`, dependency map a skill path.

**Exit gate:** používateľ, problém, dôkaz, cieľ, scope, rozhodovacia autorita a hard constraints sú explicitné.

## Fáza 1 — evidence a research

**Requires:** `decision_brief`.

- `skills/it/product-ux-delivery.md` vytvorí task model, hypotézy a success baseline.
- `skills/it/ux-research-operations.md` zvolí metódu, recruitment, consent, pilot, syntézu a confidence iba pri otázkach, ktoré môžu rozhodnutie zmeniť.
- `skills/it/ux-ui.md` použi ako základný heuristický audit, nie ako náhradu výskumu.

**Výstup:** `evidence_pack`, research findings s traceability a updated decision brief.

**Exit gate:** každý kritický predpoklad má dôkaz, plán overenia alebo explicitne akceptované riziko.

## Fáza 2 — privacy, permissions a trust boundaries

**Requires:** task/data flow a evidence pack.

- `skills/it/privacy-permissions-trust-ux.md` vlastní purpose, consent, deny/revoke, export/delete a deceptive-pattern review.
- `skills/it/api-security.md` vlastní serverovú auth, authorization, validation, rate limits a audit.
- Pri AI pridaj `skills/ai-nastroje/ai-product-ux-human-control.md` pre memory, provenance, approvals, cancel a cost disclosure.

**Výstup:** `risk_map`, data inventory, permission matrix a approval policy.

**Exit gate:** žiadny data flow, permission alebo consequential action nemá neznámeho ownera, účel, scope alebo retention.

## Fáza 3 — IA, search a content

**Requires:** task model, glossary candidates a risk map.

- `skills/it/ux-content-localization.md` vlastní voice, terminology, message IDs, locale, plural a error/recovery copy.
- `skills/it/search-navigation-discovery.md` vlastní query model, facets, ranking, zero-results a saved search.
- Product UX vlastní celkovú IA a task flow; search skill špecializuje iba discovery/findability vetvu.

**Výstup:** content model, glossary, message catalog, navigation/search contract a localized state matrix.

**Exit gate:** kritická úloha je nájditeľná, pomenovaná konzistentne a dokončiteľná bez interného technického slovníka.

## Fáza 4 — visual system a Figma contract

**Requires:** schválený flow, content a risk constraints.

- `skills/design/ui-design-systems.md` vlastní foundations, tokeny, component taxonomy a variant principles.
- `skills/design/figma-mcp-agentic-studio.md` vykoná Figma/library workflow, keď existuje MCP write zadanie.
- Nevytváraj nový primitive, kým nevieš preukázať opakovanú potrebu a gap v systéme.

**Výstup:** token delta, component inventory, Figma/code mapping a visual acceptance states.

**Exit gate:** návrh používa existujúce tokeny/komponenty alebo má schválený additive change s ownerom migrácie.

## Fáza 5 — component a frontend architecture

**Requires:** component inventory a state matrix.

- `skills/it/design-system-component-engineering.md` vlastní semantic/API/state matrix, stories, versioning a deprecation.
- `skills/it/frontend-component-architecture.md` vlastní feature boundaries, state ownership, dependency direction, lifecycle a test seams.
- UI komponent nesmie obísť API/security alebo si vytvoriť druhý zdroj pravdy.

**Výstup:** component contracts, feature map, public APIs, ownership map a migration slices.

**Exit gate:** každý public component a feature má ownera, vstupy, výstupy, states, cleanup a test boundary.

## Fáza 6 — layout, workspaces a visualization

**Requires:** content, components a priority model.

- `skills/it/responsive-adaptive-app-layouts.md` vlastní app shell, panely, container queries, zoom, safe areas a keyboard viewport.
- `skills/it/data-dense-workspaces.md` špecializuje tabuľky, filtre, selection, bulk a density.
- `skills/it/canvas-data-visualization-ux.md` špecializuje 2D navigáciu, grafy a non-canvas alternatívu.

**Výstup:** responsive rules, priority map, workspace/view contracts a breakpoint test matrix.

**Exit gate:** pri 320 CSS px, 200/400 % zoome a dlhom locale sa nestratí kritická informácia, akcia ani cesta k alternatíve.

## Fáza 7 — accessibility contract

**Requires:** reálny content, states a interakčný prototyp.

`skills/it/accessible-interaction-patterns.md` je cross-cutting gate pre semantics, accessible names, keyboard, focus, announcements, forced colors a assistive technology.

Automatizovaný audit je prvá kontrola, nie dôkaz zhody. Kritické flows otestuj manuálne s keyboardom, zoomom a relevantnou assistive technology.

**Výstup:** accessibility acceptance criteria, focus map, announcement contract a defect register.

**Exit gate:** nulový blocker/critical defect; manuálne testy kritickej úlohy prešli.

## Fáza 8 — motion a continuity

**Requires:** stabilný layout, states a focus contract.

`skills/design/ui-motion-transitions.md` vlastní účel pohybu, duration/easing/distance tokeny, interruption, reverse, reduced motion a performance budget. Video/marketing animáciu rieši `skills/design/motion-video.md`, nie tento produktový lane.

**Výstup:** motion spec, state transition table a reduced/no-motion ekvivalenty.

**Exit gate:** každý motion má funkčný účel, dá sa prerušiť a nestráca význam pri reduced motion.

## Fáza 9 — async, realtime a AI behavior

**Requires:** component, API, focus a risk contracts.

- `skills/it/resilient-async-ui.md` vlastní pending/stale/partial/error/cancel/retry/conflict a recovery.
- `skills/ai-nastroje/ai-product-ux-human-control.md` špecializuje durable AI run, streaming, citations, memory, approval, cost a agent progress.
- `skills/ai-nastroje/five-agent-low-spend-loop.md` vlastní iba orchestration a hard spend workflow, nie UI truth.

**Výstup:** state machines, event schema, idempotency/cancel contract, receipts a adversarial cases.

**Exit gate:** retry neduplikuje účinok, cancel zastaví nové kroky, partial stav nie je final a approval sa viaže na immutable action.

## Fáza 10 — performance a observability

**Requires:** production-like build a kritické flows.

`skills/it/frontend-performance-observability.md` vlastní route/component budgets, lab + field measurement, RUM, release segmentation a regression policy. Špecializované motion, canvas a table budgets ostávajú vo svojich skills.

**Výstup:** performance budget, trace/RUM dashboard, baseline, regression report a ownerov.

**Exit gate:** p75 field alebo schválený pre-release proxy spĺňa LCP ≤ 2,5 s, INP ≤ 200 ms a CLS ≤ 0,1; žiadny budget nemá neznámeho ownera.

## Fáza 11 — platform, data a release engineering

**Requires:** implementačný kontrakt, risk map a SLO/budgets.

- `skills/it/mariadb.md` vlastní schema, constraints, transactions, indexy a migrácie.
- `skills/it/api-security.md` vlastní endpoint security a authorization.
- `skills/it/devops-backend.md` vlastní CI/CD, queue, secrets, health, observability, rollout a rollback.

**Výstup:** migration plan, API contract, deployment manifest, dashboards, alerts a rollback drill.

**Exit gate:** forward aj rollback cesta sú otestované; security, privacy, data integrity a spend enforcement sú serverové.

## Fáza 12 — integrated verification a release decision

Zostav dôkazovú maticu:

| Gate | Dôkaz | Owner | Stav |
|---|---|---|---|
| Problem fit | research + task success | Product/UX | pass/fail |
| Content/localization | catalog + native review | Content | pass/fail |
| Accessibility | automated + manual | A11y owner | pass/fail |
| Component/system | stories + visual/interaction tests | UI engineering | pass/fail |
| Resilience | fault/race/cancel tests | Frontend/backend | pass/fail |
| Privacy/security | threat/privacy review | Security/privacy | pass/fail |
| AI trust | citation/approval/injection eval | AI owner | pass/fail/N/A |
| Performance | lab + field/RUM | Performance owner | pass/fail |
| Operations | rollout/rollback/alerts | Platform | pass/fail |

Release povoľ iba pri nulovom blocker/critical defekte, splnených hard gates a pomenovanom ownerovi každého accepted risku. „Vyzerá hotovo“ nie je dôkaz.

## Konfliktné pravidlá a priorita

Pri rozpore rozhoduj v tomto poradí:

1. zákon, bezpečnosť a ochrana ľudí,
2. data integrity, privacy a serverová authorization,
3. accessibility a human control,
4. task success a recovery,
5. content clarity a system consistency,
6. performance budget,
7. motion a vizuálny polish.

Vyššia priorita nemá automaticky zrušiť nižšiu. Najprv hľadaj riešenie, ktoré spĺňa obe; ak to nejde, zapíš trade-off, evidence, ownera a expiry rozhodnutia.

## Stop podmienky

Zastav fázu a nepredstieraj dokončenie, ak:

- chýba rozhodovacia autorita alebo consent,
- kritický predpoklad nemá dôkaz ani schválené riziko,
- security/privacy/accessibility blocker ostáva otvorený,
- UI sľubuje účinok, ktorý server nevynucuje,
- design token alebo component contract je v konflikte bez ownera,
- performance alebo spend cap nemá enforcement,
- release nemá rollback, observability alebo incident ownera.

## Hades adoption order

1. Zaveď tento plan ako router a doplň obojsmerné links do skills.
2. Vytvor artifact envelope a decision/evidence IDs bez ukladania plných transcriptov.
3. Rozdeľ `mind.js` po vertikálnych feature rezoch podľa frontend architecture.
4. Zaveď message catalog, component contracts a test stories.
5. Pridaj durable run/event API, AI approvals, cancel a strict spend ledger.
6. Pridaj RUM, performance budgets, security/privacy/a11y gates do CI.
7. Až potom povoľ gated external writes a autonómne produkčné runy.

## Release gate plánu

- [ ] Skill path je minimálny, zdôvodnený a nečíta celý katalóg bez potreby.
- [ ] Každá fáza má requires, výstup, ownera a exit gate.
- [ ] Handoffs používajú artifact envelope, verziu a evidence/decision IDs.
- [ ] Priame susedné skills na seba odkazujú oboma smermi.
- [ ] Hard gates majú serverový alebo CI enforcement, nie iba checklist.
- [ ] Conditional vetvy sú označené triggerom a N/A rozhodnutím.
- [ ] Konflikty majú priority, ownera, evidence a expiry.
- [ ] Integrated evidence matrix je úplná a auditovateľná.
- [ ] Rollout, rollback, telemetry a incident ownership sú pripravené.
- [ ] Autonómny run sa nespustí bez auth, approvals, spend capu a recovery drillov.

## Primárne zdroje

- [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C — Privacy Principles](https://www.w3.org/TR/privacy-principles/)
- [GOV.UK — Service Manual](https://www.gov.uk/service-manual)
- [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [Storybook — UI testing](https://storybook.js.org/docs/writing-tests)
- [NIST — Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [OWASP — Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
