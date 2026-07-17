# Frontend component architecture

> Produkčný playbook pre rozdelenie veľkého UI na zrozumiteľné feature moduly, komponentové kontrakty, riadený stav, bezpečný lifecycle a testovateľné hranice bez frameworkového dogmatizmu.

## Výstup, ktorý má skill vytvoriť

Pre každú významnú UI zmenu odovzdaj:

1. mapu features, zodpovedností a závislostí,
2. component contract pre verejné komponenty,
3. model vlastníctva serverového, URL, formulárového a lokálneho stavu,
4. render a event lifecycle vrátane cleanup,
5. test seams a regresnú maticu,
6. postup migrácie, ktorý zachová funkčný produkt.

Nemeň monolit na stovky drobných súborov bez hraníc. Cieľom je lokálne uvažovanie: zmena v jednej feature má mať predvídateľný dopad a nemá vyžadovať znalosť celej aplikácie.

## 1. Začni mapou správania, nie priečinkami

Zmapuj používateľské capabilities, nie typy súborov:

```text
app-shell/
features/
  chat/
  graph/
  memory/
  search/
shared/
  ui/
  domain/
  infrastructure/
```

Pre každú feature zapíš:

| Pole | Povinná otázka |
|---|---|
| Vlastník | Ktorý modul rozhoduje o stave a pravidlách? |
| Verejné API | Aké vstupy, výstupy a udalosti smú použiť ostatné moduly? |
| Dáta | Ktoré endpointy, modely a cache používa? |
| DOM | Ktorý stabilný root vlastní a renderuje? |
| Lifecycle | Ako sa mountne, obnoví, zruší a unmountne? |
| Vedľajšie účinky | Fetch, storage, timers, subscriptions, canvas, focus. |
| Test seam | Čo možno nahradiť deterministickým fake alebo fixture? |

Priečinok `shared` nie je sklad. Vlož doň iba primitive s aspoň dvoma reálnymi používateľmi a stabilným kontraktom.

## 2. Vynúť smer závislostí

Použi jednu čitateľnú hierarchiu:

```text
app shell → feature → shared domain/UI → infrastructure adapter
```

- Feature nesmie importovať interný súbor inej feature; používa iba jej verejný entrypoint alebo doménovú udalosť.
- UI komponent nevolá priamo neznámy endpoint, `localStorage` ani globálnu premennú. Dostane dáta alebo explicitný adapter.
- Infrastructure vrstva nepozná DOM ani vizuálny komponent.
- Domain pravidlo musí byť testovateľné bez browsera.
- Zakáž kruhové importy v CI.
- Nevytváraj všeobecný event bus ako náhradu za vlastníctvo. Udalosť pomenuj minulým časom a zdokumentuj producenta aj konzumentov.
- Globálny singleton povoľ iba pre skutočne aplikačný kontext, napríklad session, router alebo telemetry gateway.

Ak modul potrebuje meniť cudziu internú hodnotu, kontrakt je chybný. Presuň rozhodnutie k vlastníkovi alebo pridaj úzku command/query hranicu.

## 3. Rozdeľ entrypoint a bootstrap

Entrypoint má iba:

1. načítať konfiguráciu a adapters,
2. nájsť stabilné mount roots,
3. vytvoriť store/router, ak sú potrebné,
4. spustiť features,
5. zaregistrovať globálny cleanup.

Nedávaj do entrypointu HTML templating, doménové rozhodnutia ani jednotlivé click handlery. Produkčný cieľ je najviac približne 250 logických riadkov; prekročenie zdôvodni a rozdeľ podľa capability.

Pre Hades migruj `public/js/mind.js` po vertikálnych rezoch. Nevykonávaj jednorazový prepis:

1. pridaj modulový bootstrap,
2. vyber jednu izolovanú feature,
3. zaveď jej verejný kontrakt a charakterizačné testy,
4. odpoj pôvodné handlery,
5. over parity a až potom pokračuj.

## 4. Definuj komponentový kontrakt

Komponent nie je iba HTML funkcia. Pre verejný komponent zapíš:

| Časť kontraktu | Príklad |
|---|---|
| Účel | Vybrať jeden alebo viac uzlov. |
| Vstupy | `items`, `selectedIds`, `disabled`, `density`. |
| Výstupy | `selectionChanged`, `openRequested`. |
| Stavy | empty, pending, error, partial, readonly. |
| Semantika | listbox/table/grid podľa skutočnej interakcie. |
| Focus | po mount, update, delete a close. |
| Obsah | krátke, dlhé, prázdne, lokalizované hodnoty. |
| Motion | enter/exit a reduced-motion ekvivalent. |
| Performance | limit DOM prvkov a frekvencia renderu. |
| Cleanup | listeners, observer, timer, abort a subscriptions. |

### API pravidlá

- Preferuj úzke doménové vstupy pred objektom `options` bez schémy.
- Rozlišuj povinné, voliteľné a deprecated vlastnosti.
- Nepoužívaj boolean explosion. Pri vzájomne sa vylučujúcich režimoch použi explicitný variant alebo state machine.
- Názov udalosti opisuje, čo sa stalo; neprezrádza internú implementáciu.
- Verejná udalosť nesmie odovzdávať mutable interný objekt.
- Komponent nesmie meniť vstupné dáta svojho rodiča.
- Breaking zmena potrebuje migračný návod a verziu, nie tiché premenovanie.

## 5. Priraď každému stavu jedného vlastníka

Rozlišuj:

| Typ stavu | Preferovaný vlastník |
|---|---|
| Serverové dáta | query/cache vrstva s freshness a invalidation pravidlom |
| URL stav | router; filtre a view, ktoré majú prežiť reload/share |
| Formulárový draft | formulár alebo feature, kým nie je potvrdený serverom |
| Výber v pracovnej ploche | najbližší spoločný vlastník dotknutých panelov |
| Čisto vizuálny stav | komponent, napríklad otvorené menu |
| Session/capability | aplikačný kontext s readonly selectorom |

### Pravidlá

- Ukladaj zdroj pravdy iba raz; odvodené hodnoty vypočítaj cez čistý selector.
- Nedrž rovnaký filter súčasne v DOM, URL a globálnom objekte bez určenej synchronizačnej autority.
- Serverové dáta nekopíruj do lokálneho stavu len kvôli renderu.
- Draft oddeľ od potvrdeného serverového modelu.
- State update pomenuj doménovou akciou, nie všeobecným `setState` z cudzej feature.
- Pri súbehu, retry a cancellation použi `skills/it/resilient-async-ui.md`.

## 6. Renderuj deterministicky

Zaveď tok:

```text
event → command → state transition → selector/view-model → render → effect
```

- Rovnaký stav musí vytvoriť rovnaký viditeľný výsledok.
- Čistý render neposiela request, nezapisuje storage ani nepridáva anonymný globálny listener.
- Side effect spusti až po validnom prechode stavu a priraď mu operation ID alebo abort signal.
- Pri partial renderi zachovaj focus, selection a scroll podľa UX kontraktu.
- Nevkladaj neoverený text cez `innerHTML`. Použi DOM API, escaping alebo sanitizovaný trusted template.
- Batchuj DOM čítania a zápisy; nevytváraj layout thrashing v slučke.
- Veľké výpočty oddeľ od input eventu a pri potrebe presuň do workeru.

### View-model

Vytvor view-model, keď komponent potrebuje skladať serverové dáta, permissions, selection a copy. View-model:

- je serializovateľný alebo ľahko porovnateľný,
- neobsahuje DOM referencie,
- má explicitné stavy a povolené akcie,
- nemení zdrojové dáta,
- dá sa testovať bez renderera.

## 7. Vlastni celý lifecycle

Každý mount musí mať symetrický dispose:

```js
export function mountFeature(root, deps) {
  const abort = new AbortController();
  const stop = subscribe(render);
  root.addEventListener('click', onClick, { signal: abort.signal });

  return () => {
    abort.abort();
    stop();
  };
}
```

Pri unmount zruš:

- event listeners,
- fetch a stream subscriptions,
- timers a animation frames,
- `ResizeObserver`, `IntersectionObserver` a media listeners,
- keyboard shortcuts,
- canvas/WebGL resources,
- dočasné portal/overlay uzly.

Po 50 cykloch mount/unmount nesmie vzniknúť duplicitná reakcia, rast listenerov ani stabilný rast pamäte nad dohodnutú toleranciu.

## 8. Navrhni overlay, focus a shortcut infraštruktúru centrálne

- Dialogy, menu, tooltips a toasty renderuj cez spravovaný overlay root.
- Layer/z-index prideľ cez tokeny a stack policy.
- Focus trap, návrat focusu, escape a inert background majú jednu overenú implementáciu.
- Shortcut registry pozná scope, konflikt, editable target a cleanup.
- Feature nesmie preberať globálnu klávesu bez registrácie a používateľského kontextu.
- Toast nie je zdroj pravdy ani jediná forma kritickej spätnej väzby.

Semantiku a keyboard kontrakty prevezmi z `skills/it/accessible-interaction-patterns.md`.

## 9. Zaveď testovaciu pyramídu pre UI

### Contract/unit

- state transition a selector tests,
- parsovanie/formatovanie bez DOM,
- component API a event payload,
- permission a variant matrix.

### Component/integration

- render relevantných stavov,
- používateľská interakcia cez reálne udalosti,
- focus a accessible name,
- cleanup po unmount,
- request race/cancel a partial failure,
- dlhý/lokalizovaný obsah a forced colors.

### End-to-end

- iba kritické pracovné toky,
- skutočný router, browser history a persistence,
- desktop aj úzky viewport,
- keyboard-only a základný screen-reader smoke test,
- vizuálna regresia stabilných stavov.

Testuj verejné správanie. Neviaž každý test na interný selector alebo počet vnorených elementov.

## 10. Performance a loading contract

- Feature načítaj pri route alebo skutočnom používateľskom zámere; neodosielaj celý editor na prvú stránku.
- Každý lazy chunk má error a retry stav.
- Kritické CSS a fonty majú explicitný budget.
- Sleduj LCP, INP a CLS na p75 reálnych návštev; cieľ je LCP ≤ 2,5 s, INP ≤ 200 ms a CLS ≤ 0,1.
- Dlhú prácu nad 50 ms rozdeľ alebo presuň mimo hlavného vlákna.
- Bundle budget, import graph a circular-dependency kontrola bežia v CI.

## Hades kontrakt

Pri práci na Hades:

- rozdeľ chat, graph/canvas, memory a panels do features s vlastným rootom,
- jediný store nech vlastní iba skutočne zdieľaný stav; features používajú selectors a commands,
- automatický recall, streaming run a approval UI modeluj ako samostatné doménové stavy,
- presuň inline HTML templating do bezpečných view funkcií,
- používaj delegated listeners len v rámci feature rootu,
- zaveď charakterizačné testy pred vyrezaním kódu z `public/js/mind.js`,
- neprepíš JS frameworkom bez merateľného dôvodu a migračného plánu.

## Release gate

- [ ] Každá feature má vlastníka, verejný entrypoint, root, dependencies a dispose.
- [ ] Entrypoint iba bootstrapuje a má najviac približne 250 logických riadkov.
- [ ] Neexistuje import interného súboru cudzej feature ani kruhová závislosť.
- [ ] Každý zdieľaný stav má jedného vlastníka a čisté selectors.
- [ ] Render nemá skrytý side effect; efekty sú zrušiteľné alebo idempotentné.
- [ ] Po 50 mount/unmount cykloch nie sú duplicitné handlery ani stabilný leak.
- [ ] Kritické komponenty majú API/state/focus/content/performance contract.
- [ ] Testy pokrývajú transitions, komponentovú interakciu a kritické E2E toky.
- [ ] CI kontroluje circular imports, bundle budget a základnú accessibility regresiu.
- [ ] Migrácia zachováva funkčný produkt a má rollback bod po každom vertikálnom reze.

## Nadväzujúce playbooky

- `skills/it/product-ux-delivery.md` — používateľský problém, flow a handoff.
- `skills/design/ui-design-systems.md` — tokeny a vizuálny kontrakt.
- `skills/it/accessible-interaction-patterns.md` — semantika, focus a widgety.
- `skills/it/resilient-async-ui.md` — requesty, retry, cancel a konflikty.
- `skills/it/responsive-adaptive-app-layouts.md` — app shell a responzívne pravidlá.

## Zdroje

- [MDN — JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [MDN — AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [MDN — Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components)
- [web.dev — Code-split JavaScript](https://web.dev/learn/performance/code-split-javascript)
- [web.dev — Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [web.dev — Use web workers](https://web.dev/articles/off-main-thread)
- [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
