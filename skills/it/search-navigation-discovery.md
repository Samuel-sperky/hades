# Search, navigation + discovery

> UX/engineering playbook pre findability, informačnú architektúru, navigáciu, deep links, query model, autocomplete, facets, relevance evaluation, provenance, zero-results recovery a privacy-safe search observability.

## Miesto v pokročilom pláne

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`
- **Requires:** task/IA brief z `skills/it/product-ux-delivery.md` a terminology z `skills/it/ux-content-localization.md`.
- **Companions:** `skills/it/data-dense-workspaces.md`, `skills/it/resilient-async-ui.md`, `skills/it/accessible-interaction-patterns.md`, `skills/it/responsive-adaptive-app-layouts.md`.
- **Hands off to:** data-dense pre lokálnu results table/bulk mechaniku a frontend/API implementation pre query contract.

Tento skill vlastní cross-page a cross-domain findability. Nevlastní lokálny sort/selection/bulk, request races, combobox keyboard algoritmus, layout ani privacy policy; tieto deleguje špecialistom.

## Výstup skillu

Odovzdaj:

1. discovery intent a corpus contract,
2. content inventory, taxonomy a canonical URLs,
3. navigation/location contract,
4. search/query/suggestion contract,
5. result identity, provenance a freshness contract,
6. facets a zero-results recovery,
7. versioned relevance test set a thresholds,
8. privacy-safe search metrics a release gate.

## 1. Definuj discovery intent

Rozlišuj:

| Intent | Príklad | Primárny pattern |
|---|---|---|
| Known-item | Nájsť run podľa ID | search/direct link |
| Exploratory | Preskúmať chyby agentov | facets + results |
| Re-finding | Vrátiť sa k včerajšiemu uzlu | recent/saved/deep link |
| Recovery | Nájsť objekt po zlom názve | typo/synonym/zero recovery |
| Navigation | Prejsť do settings/privacy | stable IA/menu |
| Command | Spustiť konkrétnu akciu | command palette iba s jasným scope |

Pre intent zapíš corpus, audience, permissions, freshness, frequency, device a success criterion.

## 2. Vytvor inventory a canonical identity

Každý findable object má:

```yaml
object_type: agent_run
canonical_id: uuid
canonical_url: /ops/runs/{id}
primary_label: "..."
aliases: []
parent: /ops/runs
permission_scope: runs.read
freshness_field: updated_at
index_source: database
```

- Canonical URL prežije premenovanie labelu.
- Alias nespôsobí duplicate result.
- Deleted/restricted object neuniká cez title, count, suggestion ani timing.
- URL neobsahuje secret alebo citlivý raw query bez schválenej potreby.
- Redirect/migration policy chráni staré deep links.

## 3. Taxonomy a labels

- Kategorizuj podľa mental modelu a tasks, nie interných tabuliek.
- Jeden koncept má jeden schválený label z glossary.
- Polyhierarchiu použi iba ak ľudia skutočne hľadajú objekt viacerými cestami.
- Facet, navigation category a content type nezlievaj bez dôvodu.
- Synonym map je verzovaná, locale-specific a má ownera.
- Acronym rozšír iba v kontexte, kde nepoškodí precision.
- AI-generated tag nie je trusted taxonomy bez review/provenance.

IA validuj card sortom, tree testom alebo reálnou findability úlohou podľa rizika.

## 4. Navigation contract

Pre global, local a contextual navigation definuj:

- účel a scope,
- poradie a stabilitu,
- current location,
- parent/back behavior,
- deep link a browser history,
- permission-restricted položky,
- responsive variant,
- keyboard/focus pattern.

Pravidlá:

- Opakovaná navigácia má konzistentné poradie a labels.
- Nested page ukáže polohu cez heading, selected item, breadcrumb alebo ekvivalent.
- Browser Back vráti predchádzajúci významový stav, nie default page.
- Hidden navigation nie je jediná cesta ku kritickej úlohe.
- Breadcrumb reprezentuje hierarchy, nie klik history.
- Permission-denied destination sa nezobrazuje ako prázdna úspešná stránka.

## 5. Query contract

Definuj schema:

```json
{
  "q": "timeout",
  "scope": "runs",
  "filters": { "status": ["failed"] },
  "sort": ["-updated_at", "run_id"],
  "page": { "cursor": null, "size": 50 },
  "locale": "sk-SK",
  "time_zone": "Europe/Bratislava",
  "query_version": 2
}
```

- Query/filter/sort/page state prejde URL round-tripom, reloadom, back/forward a share.
- Server validuje scope, operator, sort fields a page size.
- Unknown/old parameter má deterministic migration alebo safe rejection.
- Search text zostáva viditeľný vo výsledkoch a pri recoverable chybe.
- Default sort je stabilný a má tie-breaker.
- Empty query behavior je explicitné: recent, suggested, all alebo nič.

## 6. Search input a suggestions

- Input má zrozumiteľný label a scope.
- Placeholder nie je label.
- Suggestion rozlišuje query completion, object result, recent search a command.
- Každý typ má vizuálnu aj programovú identitu.
- Highlight neprepíše accessible name fragmentmi.
- Keyboard/focus/announcement preberá z `skills/it/accessible-interaction-patterns.md`.
- Debounce, AbortController a response race preberá z `skills/it/resilient-async-ui.md`.
- Recent/suggestion nesmie prezradiť citlivý query na shared device alebo inému accountu.
- Autocomplete nepoužíva nevysvetlenú personalizáciu pri consequential domain.
- Enter vykoná viditeľný intent; nesmie náhodne prijať skrytú auto-selection.

## 7. Typo, synonym a locale behavior

- Normalizuj Unicode a case podľa locale/corpus policy.
- Diakritika môže mať tolerantný matching, ale výsledok zachová správny display label.
- Typo tolerance sprísni pre IDs, finančné alebo bezpečnostné identifikátory.
- Synonym je direction-aware, ak pojmy nie sú zameniteľné oboma smermi.
- Stemming/lemmatization testuj na domain terms.
- Slovenské a anglické query majú samostatné qrels alebo explicitný cross-language contract.
- Exact match a canonical ID majú predvídateľnú prioritu.

## 8. Result contract

Každý výsledok ukáže podľa potreby:

- primary identity,
- type/source,
- match reason alebo relevantný excerpt,
- freshness/date,
- parent/location,
- permission-limited actions,
- stale/conflicting status,
- bezpečný deep link.

- Result title nie je neoverený HTML.
- Excerpt zvýrazní match bez zmeny významu.
- Duplicity merge-ni podľa canonical identity a ukáž sources, ak sú relevantné.
- Stale result neskrývaj; označ dopad a refresh cestu.
- Ranking score ani internú confidence nepoužívaj ako user-facing truth bez kalibrácie.
- Unauthorized result sa neobjaví ani ako počet, suggestion alebo „hidden item“.

## 9. Facets a discovery filters

Search skill definuje význam facety:

- stable ID a localized label,
- source field a allowed values,
- single/multi-select a operator,
- unknown/null behavior,
- count semantics a freshness,
- permission filtering,
- URL serialization.

Lokálny filter panel, table layout, selection a bulk action implementuj podľa `skills/it/data-dense-workspaces.md`.

- Facet count zodpovedá aktuálnemu scope a permission.
- Nula count nepôsobí ako selectable bez vysvetlenia.
- Active filters sú viditeľné a resetovateľné.
- Zmena scope invaliduje nekompatibilné facets explicitne.

## 10. Zero-results recovery

Rozlišuj:

- corpus je prázdny,
- query nemá match,
- filtre odstránili všetky výsledky,
- scope je zlý,
- index je stale/partial,
- používateľ nemá permission,
- request zlyhal.

Každý stav ponúkne relevantnú recovery:

- opraviť typo,
- odstrániť konkrétny filter,
- rozšíriť scope,
- použiť canonical ID,
- otvoriť recent/saved,
- požiadať o permission,
- retry/refresh podľa async contractu.

Nezobrazuj „0 výsledkov“ pri network error ani permission failure.

## 11. Relevance evaluation

Vytvor versioned golden set:

```yaml
query_id: Q-017
locale: sk
intent: known-item
query: "beh 9f3a"
segment: editor
qrels:
  run-9f3a: 3
  doc-runbook-9f3a: 1
must_not_reveal: []
```

Dataset pokrýva:

- known-item,
- exploratory,
- typo a synonym,
- zero result,
- filtered/sorted,
- permission boundary,
- stale/duplicate,
- každý enabled locale,
- sensitive query.

Starter gate:

- žiadny P0 known-item nie je pod top 3,
- aspoň 90 % priority queries má intended result v top 3 alebo projektom preddefinovaný domain threshold,
- 0 unauthorized leakage,
- ranking zmena sa porovná na rovnakých qrels,
- každý regression má query ID a ownera.

Použi MRR/NDCG/Precision@k podľa intentu; jedna agregovaná metrika nesmie skryť P0 known-item failure.

## 12. Search observability

Meraj:

- task success a result open podľa intentu,
- zero-results a recovery success,
- query reformulation,
- time to useful result,
- stale/permission/error rate,
- relevance regression podľa test setu,
- autocomplete acceptance iba ak odpovedá produktovej otázke.

Raw query, result title a osobné dáta neloguj defaultne. Použi query class/ID, privacy review, sampling a retention. Engagement nie je automaticky relevance.

## Hades contract

- Search nodes, skills, runs a memory majú oddelený scope aj canonical type.
- Exact node/run ID má deterministic match.
- Automatic recall pre chat nie je to isté ako user search a nepoužíva rovnaké UI sľuby.
- Search result ukáže source, type, freshness a match reason.
- Query/filter/sort/view je shareable iba bez citlivého obsahu.
- Saved search má schema version a migration.
- Index permission filter je server-side a testuje metadata/suggestion leakage.

## Release gate

- [ ] Každý P0 object/task má canonical deep link a relevantné findability paths.
- [ ] Nested views ukazujú location a navigation terminology/order je konzistentné.
- [ ] Query/scope/filter/sort/page prejde URL round-tripom, reloadom a history.
- [ ] Suggestion typy, scope a keyboard behavior sú jednoznačné.
- [ ] Golden set pokrýva intents, typo/synonym, zero, permission, stale a locales.
- [ ] Žiadny P0 known-item nie je pod top 3; priority threshold je splnený.
- [ ] 0 unauthorized title, snippet, count, timing alebo suggestion leakage.
- [ ] Každý result ukazuje identity, type/source a decision-relevant freshness.
- [ ] Každý zero-results variant má otestovanú recovery.
- [ ] Async, accessibility, responsive, localization a privacy companion gates prešli.
- [ ] Ranking/personalization zmena je verzovaná a regresne otestovaná na rovnakých qrels.

## Zdroje

- [W3C WCAG 2.2 — Consistent Navigation](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html)
- [W3C WCAG 2.2 — Headings and Labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html)
- [W3C WAI-ARIA APG — Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [GOV.UK Design System — Breadcrumbs](https://design-system.service.gov.uk/components/breadcrumbs/)
- [GOV.UK — Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)
- [USWDS — Search](https://designsystem.digital.gov/components/search/)
- [NIST — Text REtrieval Conference](https://trec.nist.gov/)
- [OpenSearch — Search relevance](https://docs.opensearch.org/latest/search-plugins/search-relevance/)
