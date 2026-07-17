# Design-system component engineering

> Produkčný playbook pre domain-neutral UI komponenty medzi design tokenmi a feature kódom: typed API, variants/states, CSS architektúru, stories, vizuálne testy, Figma parity, packaging, verzovanie a migrácie.

## Miesto v pokročilom pláne

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`
- **Requires:** foundations z `skills/design/ui-design-systems.md`, architecture boundary z `skills/it/frontend-component-architecture.md`, semantics z `skills/it/accessible-interaction-patterns.md`.
- **Companions:** `skills/it/ux-content-localization.md`, `skills/it/responsive-adaptive-app-layouts.md`, `skills/design/ui-motion-transitions.md`.
- **Hands off to:** feature implementácii a `skills/it/frontend-performance-observability.md` pre bundle/render gates.

Tento skill nevymýšľa vizuálny jazyk, feature state management ani business workflow. Konzistentne balí schválené tokeny a behavior kontrakty do znovupoužiteľného code API.

## Výstup skillu

Odovzdaj:

1. component admission decision,
2. anatomy/slots/props/events/state contract,
3. token a CSS override contract,
4. story/state/locale/theme test matrix,
5. package/export a bundle contract,
6. Figma–code mapping,
7. version, deprecation a migration plan,
8. ownership a component scorecard.

## 1. Zaveď component taxonomy

Použi tri vrstvy:

| Vrstva | Príklady | Povolené závislosti |
|---|---|---|
| Primitive | Button, IconButton, Text, Stack | tokeny, platforma, a11y behavior |
| Composite | Field, Dialog, DataToolbar, EmptyState | primitives, úzky behavior kontrakt |
| Feature component | GraphNode, MemoryCard, AgentTimeline | domain model, feature state, shared components |

Feature component nevkladaj do shared design-system package iba preto, že sa používa viackrát v jednej feature.

## 2. Admission gate

Komponent prijmi do shared systému iba ak:

- má aspoň dvoch reálnych produkčných consumers,
- jeho správanie je domain-neutral,
- existuje stabilná spoločná anatomy a behavior,
- rozdiely sa dajú vyjadriť composíciou alebo malým variant setom,
- má vlastníka, test fixtures a migration plan,
- prínos zdieľania prevýši coordination a bundle cost.

Ak gate neprejde, ponechaj ho vo feature. Nedizajnuj abstrakciu pre hypotetické budúce použitie.

## 3. Component contract

Pre každý export zapíš:

```yaml
name: StatusChip
status: experimental|stable|deprecated
owner: ui-platform
anatomy: [root, icon, label]
slots: [icon, default]
props: {}
events: {}
states: [default, hover, focus, disabled]
variants: [neutral, success, warning, danger]
content_constraints: {}
semantics: status
focus_contract: none
motion_contract: none
token_contract: []
```

- Typed public API je jediný podporovaný vstup.
- Interný DOM, class names a implementation detail nie sú public API, kým ich výslovne nestabilizuješ.
- Event pomenuj podľa výsledku, nie interného clicku.
- Nevystav mutable interný object.
- Component nevolá endpoint, storage ani globálny product store.
- Business copy prichádza cez catalog/slot, nie je hardcoded v package.

## 4. Rozlišuj variant, state a content

- **Variant** je stabilná podporovaná vizuálno-behaviorálna alternatíva, napríklad `danger`.
- **State** vzniká lifecycle alebo interakciou, napríklad `pending`, `disabled`, `invalid`.
- **Content** je text/dáta dodané consumerom.
- **Mode** mení väčší behavior contract a nemá sa skrývať v troch boolean props.

Namiesto:

```text
compact + danger + loading + iconOnly + destructive + selected
```

vytvor explicitnú state/variant maticu a zakáž neplatné kombinácie typom alebo runtime validáciou.

## 5. Anatomy a composition

- Stabilizuj iba slots, ktoré majú reálne use cases.
- Preferuj composition pred desiatkami style props.
- Escape hatch je úzky, dokumentovaný a testovaný.
- Consumer nesmie cez descendant selector meniť internú anatómiu.
- Ak potrebuje nový slot alebo token, otvor additive API proposal.
- Portal/overlay, focus a keyboard behavior zdieľaj cez jednu overenú infraštruktúru.
- Nested interactive elementy povoľ iba ak semantics a keyboard model sú validné.

## 6. Token contract

Komponent spotrebúva semantic/component tokeny:

```css
@layer components {
  .button {
    color: var(--button-fg);
    background: var(--button-bg);
    border-radius: var(--radius-control);
  }
}
```

- Raw color, spacing, typography, radius, shadow alebo motion hodnota je zakázaná mimo schváleného allowlistu.
- Alias graph nesmie obsahovať cyklus ani unresolved reference.
- Token pomenúva význam, nie momentálnu hex hodnotu.
- Component token má fallback iba ak je to súčasť contractu.
- Theme prepína hodnoty, nie anatomy alebo DOM bez silného dôvodu.
- Forced-colors používa systémové farby a zachováva boundary/focus.

## 7. CSS architektúra

Použi vrstvy:

```css
@layer reset, tokens, base, components, features, overrides;
```

Pravidlá:

- 0 ID selectorov v component CSS,
- 0 neschválených `!important`,
- specificity najviac približne `0,3,1` mimo allowlistu,
- žiadny global element reset z component package,
- logical properties pre inline/block smer,
- style ownership podľa component rootu,
- public custom properties iba s dokumentovaným názvom, rozsahom a fallbackom.

Override layer je posledná riadená cesta, nie skládka opráv.

## 8. Accessibility contract sa dedí, nekopíruje

Každý interactive component preberá pattern z `skills/it/accessible-interaction-patterns.md`:

- native semantics pred ARIA,
- accessible name/description,
- keyboard a focus lifecycle,
- disabled vs readonly behavior,
- status/error announcement,
- touch/pointer alternatívu,
- 200/400 % zoom a forced colors.

Component scorecard odkazuje na konkrétny pattern a test evidence. Automatický axe test nenahrádza manual keyboard/screen-reader test komplexného composite.

## 9. Content a localization contract

- Text dodáva semantic message ID alebo consumer content.
- Component neskladá vetu z fragmentov.
- Long-content a pseudo-locale fixture je povinná.
- `lang`, `dir` a bidi isolation rešpektujú `skills/it/ux-content-localization.md`.
- Icon-only control vyžaduje localized accessible name.
- Error/help slots majú stabilnú programovú väzbu na control.
- Fixed height nesmie clipnúť kritický text.

## 10. Responsive a density contract

- Komponent reaguje na dostupný kontajner, nie iba global viewport.
- Container behavior a priority preberá z `skills/it/responsive-adaptive-app-layouts.md`.
- Density nemení význam, hit target ani dostupnosť actions.
- Touch a pointer mode nemiešaj iba podľa šírky.
- Consumer môže meniť layout cez schválené slots/variants, nie cez interný selector.
- Každý composite má min/max content test a narrow-container story.

## 11. Motion contract

- Motion hodnoty čerpaj z tokenov `skills/design/ui-motion-transitions.md`.
- Reduced motion je explicitný story/state.
- Enter/exit a interruption nesmú poškodiť focus alebo cleanup.
- Component package nesie iba lokálny motion behavior; cross-route choreography vlastní feature/app shell.
- JS animácia má cancel/dispose a nesmie vytvárať duplicate frame loop.

## 12. Stories ako executable contract

Povinná story matica:

- default,
- každý variant a size,
- interactive states,
- disabled, readonly, pending, success, error,
- short, empty, long a hostile content,
- pseudo-locale a RTL,
- light, dark a forced colors,
- comfortable a compact density,
- reduced motion,
- narrow a wide container,
- permission-restricted state, ak je súčasť generic API.

Story nie je iba galéria. Je fixture pre render, interaction, accessibility a visual regression test.

## 13. Test stack

Pre stable component spusti:

1. type/API tests,
2. render smoke pre každú povinnú story,
3. interaction test s reálnymi user events,
4. automated accessibility check,
5. manual keyboard/screen-reader check pre complex composite,
6. visual regression v schválenej browser/theme/locale matici,
7. bundle/tree-shaking test,
8. SSR/hydration test, ak platforma SSR používa,
9. lifecycle test po opakovanom mount/unmount.

Gate: 0 neodsúhlasených snapshot rozdielov a 0 critical accessibility violation.

## 14. Bundle a package contract

- Per-component ESM export.
- `sideEffects` metadata zodpovedá realite; globálny CSS side effect je explicitný.
- Neimportovaný component pridá 0 runtime bytes.
- Static primitive: inkrementálne ≤2 KiB JS a ≤3 KiB CSS gzip.
- Interactive composite: inkrementálne ≤8 KiB JS a ≤5 KiB CSS gzip.
- Shared dependency nevytvára duplicate runtime.
- Package export map a types sú testované z consumer fixture.
- Server-only a browser-only API sú oddelené.

Budget prekročenie vyžaduje measurement, ownera, dôvod a expiry; neobchádza sa premenovaním chunku.

## 15. Figma–code parity

Mapuj:

| Figma | Code |
|---|---|
| Component set | public component |
| Variant property | typed variant |
| Boolean/text/instance property | prop alebo slot |
| Variable | design token |
| Mode | theme/density contract |
| Deprecated component | deprecated export + migration |

- Code Connect pridaj až po stabilizovaní code API.
- Mapovanie je verzované a má design aj engineering ownera.
- Figma variant, ktorý code nepodporuje, je gap; nie vizuálna výnimka.
- Code state bez design fixture je rovnako gap.
- Screenshot nie je component contract.

## 16. Versioning a deprecation

- Breaking public API = major SemVer a migration guide.
- Additive compatible API = minor.
- Fix bez contract change = patch.
- Odstránenie nastane až po minimálne jednom minor deprecation období alebo projektovej policy.
- Deprecated API loguje/lintuje používanie bez user telemetry.
- Migration obsahuje codemod iba ak je deterministický a otestovaný.
- Consumer inventory určí blast radius pred release.

## 17. Governance a scorecard

Každý stable component má:

- design ownera,
- engineering ownera,
- API stability status,
- počet a zoznam consumers,
- posledný accessibility/manual review,
- story/test coverage,
- bundle size,
- open exceptions a expirácie,
- Figma/code mapping version,
- deprecation/migration stav.

Quarterly alebo pri major zmene vyhodnoť duplicity, nepoužívané variants a escape-hatch abuse.

## Hades adoption

1. Baseline-ni tokeny, selectors a opakované patterns v `mind.css`/`mind.js`.
2. Vytvor vrstvy `reset`, `tokens`, `base`, `components`, `features`, `overrides`.
3. Ako prvé extrahuj `Button`, `IconButton`, `StatusChip`, `Field`, `Toast`, `EmptyState`, `Panel/DrawerShell`.
4. `GraphNode`, memory workflow a agent timeline ponechaj vo features.
5. Pridaj isolated story harness, visual regression, accessibility a bundle report.
6. Migruj po vertikálnych slices s characterization tests; legacy ostáva dočasný rollback.
7. Code Connect pridaj až po stabilnom API a Figma variable mappingu.

## Release gate

- [ ] Shared component má ≥2 consumers a domain-neutral správanie.
- [ ] 100 % exports má typed API, ownera a stability status.
- [ ] 0 unresolved token alias/cycle a 0 raw design value mimo allowlistu.
- [ ] Povinná story matica pokrýva states, content, locale, theme, density a forced colors.
- [ ] Interaction, accessibility, visual, bundle a lifecycle testy prešli.
- [ ] 0 neodsúhlasených visual diffs a critical accessibility violations.
- [ ] CSS nemá ID selector ani neschválený `!important`.
- [ ] Neimportovaný component pridáva 0 runtime bytes a size budget prešiel.
- [ ] Package nevolá endpoint, storage ani product global state.
- [ ] Figma/code mapping je verzovaný a bez nezdokumentovaného gapu.
- [ ] Breaking change má major verziu, migration guide a consumer inventory.
- [ ] Každá výnimka má measurement, ownera, ticket a expiry.

## Zdroje

- [Design Tokens Community Group — Format Module](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/)
- [W3C — CSS Custom Properties](https://www.w3.org/TR/css-variables-1/)
- [W3C — CSS Cascade Level 5](https://www.w3.org/TR/css-cascade-5/)
- [Storybook — UI testing](https://storybook.js.org/docs/writing-tests)
- [Storybook — Accessibility testing](https://storybook.js.org/docs/writing-tests/accessibility-testing)
- [Storybook — Visual testing](https://storybook.js.org/docs/writing-tests/visual-testing)
- [Figma — Code Connect](https://developers.figma.com/docs/code-connect/)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
