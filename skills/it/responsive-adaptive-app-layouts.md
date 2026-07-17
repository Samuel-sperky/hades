# Responsive + adaptive app layouts

> Produkčný playbook pre responzívne aplikačné shelly, panely, docky, navigáciu, container queries, safe areas, virtuálnu klávesnicu, zoom, orientáciu a prioritu obsahu naprieč veľkosťami a spôsobmi vstupu.

## Navrhni pravidlá, nie tri screenshoty

Responsive návrh nie je desktop zmenšený na telefón. Definuj, ako sa mení hierarchia, dostupnosť akcií a pracovný kontext pri každom dostupnom priestore.

Pre každý view zapíš:

| Pole | Povinné rozhodnutie |
|---|---|
| Primárna úloha | Čo musí zostať dokončiteľné pri najmenšom podporovanom priestore? |
| Persistentné prvky | Čo musí byť stále viditeľné a prečo? |
| Adaptívne prvky | Čo sa môže zbaliť, presunúť, zmeniť pattern alebo odložiť? |
| Kontext | Ktorý výber, filter, kamera, scroll a rozpracovaný vstup sa musí zachovať? |
| Ovládanie | Ako funguje keyboard, pointer, touch, pen a virtuálna klávesnica? |
| Reflow | Čo sa zloží do jednej osi a čo legitímne zostane dvojrozmerné? |
| Overlays | Ktorý overlay má prioritu a ako sa zatvára? |
| Obsah | Ako sa správa dlhý text, lokalizácia a zväčšenie písma? |

## Breakpointy určuj podľa kolapsu obsahu

- Nevyberaj breakpoint podľa názvu zariadenia. Pridaj ho v bode, kde obsah, target alebo úloha prestáva fungovať.
- Začni najmenším podporovaným layoutom a progresívne pridávaj priestor.
- Rozlišuj **viewport breakpoint** pre app shell a **container query** pre znovupoužiteľný komponent.
- Komponent nesmie poznať, či je „v sidebare“ alebo „na mobile“. Reaguje na svoj kontajner.
- Nepoužívaj User-Agent ako layout signál.
- Capability queries (`hover`, `pointer`, `any-pointer`) používaj na jemné úpravy, nie na skrývanie základnej funkcie.
- Orientáciu neuzamykaj, ak nie je pre úlohu nevyhnutná.

### Odporúčané režimy app shellu

Názvy sú sémantické; presné prahy odvoď z testu obsahu:

| Režim | Správanie |
|---|---|
| Compact | Jedna primárna pracovná plocha; navigácia a detail ako modal sheet/overlay. |
| Medium | Primárna plocha + jeden dočasný panel alebo úzky rail. |
| Wide | Primárna plocha + persistentná navigácia a jeden detailný panel. |
| Extra-wide | Povoľ druhý podporný panel iba ak zlepšuje paralelnú úlohu; nerozťahuj text do nečitateľnej šírky. |

## Moderné CSS stavebnice

### App shell

Použi Grid pre hlavné dvojrozmerné zóny a Flex pre jednorozmerné skupiny.

```css
.app-shell {
  min-block-size: 100dvb;
  display: grid;
  grid-template:
    "rail header" auto
    "rail main" minmax(0, 1fr)
    / auto minmax(0, 1fr);
}

.app-main {
  min-inline-size: 0;
  min-block-size: 0;
}
```

- Použi `minmax(0, 1fr)` a `min-inline-size: 0`, aby dlhý obsah neroztlačil grid.
- Uprednostni logical properties (`inline`, `block`, `inset-inline`) pred fyzickým left/right tam, kde smer jazyka môže byť relevantný.
- Použi `gap` namiesto margin hackov medzi súrodencami.
- `subgrid` použi na zarovnanie opakovaných vnorených kariet/formulárov, nie na každú lokálnu skupinu.
- Nevytváraj horizontálny scroll stránky kvôli jednému komponentu; scroll izoluj a jasne označ iba tam, kde je dvojrozmernosť významná.

### Container queries

```css
.panel-region {
  container: panel / inline-size;
}

@container panel (inline-size < 28rem) {
  .node-summary {
    grid-template-columns: 1fr;
  }
}
```

- Container query pridaj na znovupoužiteľný komponent, ktorého priestor závisí od docku, gridu alebo split view.
- Zabezpeč fallback cez prirodzene sa skladajúci Grid/Flex; komponent nemá byť rozbitý bez query.
- Pozor na size containment: kontajner musí dostať rozmer z kontextu, inak sa môže zrútiť.
- Nepoužívaj experimentálny typ query bez overenia browser support matrix a fallbacku.

## Viewport, safe areas a virtuálna klávesnica

- Pre fullscreen shell použi dynamické viewport jednotky (`dvh`/`dvb`) podľa support matrix; `100vh` môže na mobile ignorovať browser chrome.
- Padding interaktívnych prvkov pri okraji doplň cez `env(safe-area-inset-*)`.
- Neumiestni hlavné CTA, prompt alebo Close pod home indicator, notch či browser controls.
- Pri otvorení virtuálnej klávesnice udrž fokusované pole a relevantný submit viditeľné.
- Nezatváraj rozpracovaný overlay iba preto, že viewport zmenil výšku pri klávesnici.
- Dlhý form/textarea nech scrolluje stránku alebo sheet; nepresúvaj focus agresívnym auto-scrollom na každý keypress.
- Použi `scroll-padding`/`scroll-margin` pre sticky header a focus reveal.
- Testuj fyzické zariadenie alebo dôveryhodnú emuláciu; resize desktop okna nereprodukuje safe areas a keyboard.

## Priority obsahu a akcií

Neskrývaj prvky podľa vizuálnej pohodlnosti. Zostav prioritu:

1. stav a orientácia používateľa,
2. primárny obsah/objekt,
3. primárna akcia,
4. recovery a Close/Back,
5. často používané sekundárne akcie,
6. metadáta a pokročilé nastavenia.

Pri nedostatku priestoru:

- najprv zabaľ text a zníž density v medziach tokenov,
- potom zmeň rozloženie,
- následne zoskup sekundárne akcie do pomenovaného menu,
- až nakoniec odlož podporné informácie za disclosure.

Nikdy potichu neodstráň akciu, stav, filter alebo error iba na mobile. Ak zmení miesto, musí zostať nájditeľný a dostupný klávesnicou aj touchom.

## Navigácia a rail

- Persistentný rail používaj iba tam, kde po odčítaní stále zostáva funkčný hlavný priestor.
- V compact režime zmeň rail na menu/drawer alebo bottom navigation podľa počtu a frekvencie destinácií.
- Zachovaj názvy, poradie a selected state naprieč režimami.
- Ikona bez textu musí mať jednoznačný accessible name a dostupnú legendu/help.
- Otvorenie mobilnej navigácie presunie focus dovnútra, nastaví podklad inert a po zatvorení vráti focus invokeru.
- Nemeň route iba zmenou select hodnoty bez explicitného očakávania.

## Panely, docky a split view

- Desktop detail môže byť nonmodal panel; compact detail je modal sheet iba ak zablokuje prácu s pozadím.
- Neotváraj dva konkurenčné side panely, ak ich súčet zničí primárnu plochu.
- Definuj priority overlayov: modal → detail → dock → prompt suggestions → tooltip.
- Escape zatvára najvnútornejší kontext podľa tej istej kaskády vo všetkých režimoch.
- Pri prepnutí breakpointu nezahoď selection, rozpracovaný draft ani scroll.
- Pri prechode desktop panel → mobile sheet obnov správny focus kontrakt a `inert`, nie iba CSS pozíciu.
- Resize handle potrebuje keyboard alternatívu a min/max hranice.
- Ulož používateľskú šírku panelu iba pre režim, kde dáva zmysel; neprenášaj 480 px preferenciu na compact viewport.

## Canvas a dvojrozmerná pracovná plocha

Canvas môže mať výnimku z jednorozmerného reflow, ale jeho ovládania, detail, help, search a DOM alternatíva nie.

- Udrž zoom controls, fit/reset a selection detail dostupné pri 320 CSS px.
- Otvorený panel nesmie automaticky vykonať fit-all a zničiť mentálnu mapu.
- Ak panel zakryje selection, vykonaj iba minimálny reveal; pri reduced motion okamžite.
- Pri compact režime zachovaj kameru a selection za sheetom a po zatvorení ich obnov.
- Touch pan/zoom nesmie blokovať scroll celej stránky mimo explicitnej canvas zóny.
- Poskytni list/tree režim pre úlohy, ktoré sa na úzkom canvase nedajú spoľahlivo vykonať.

## Responzívna typografia a obsah

- Použi `clamp()` iba v rozsahu, kde text zostáva čitateľný a nevytvára nečakané skoky hierarchie.
- Nezmenšuj body text pod design-system minimum, aby sa „zmestil“.
- Dovoľ zalomenie dlhých názvov; technické ID a URL zalamuj bezpečne cez `overflow-wrap`.
- Neodstrihni text pevnou výškou pri 200 % zoome alebo upravenom text spacingu.
- Počítaj s prekladom dlhším o desiatky percent; CTA a tab nesmú závisieť od presnej anglickej/slovenskej dĺžky.
- Dense metadáta môžu wrapnúť do riadkov alebo definition listu; nezmenšuj ich do nečitateľnej mikrotypografie.

## Performance a stabilita layoutu

- Rezervuj priestor pre async obsah, fonty, obrázky a chart/canvas shell, aby nevznikal layout shift.
- Neanimuj layout breakpoint ani `width/height` celej aplikácie pri resize.
- Debounce drahý JS resize výpočet, ale CSS nech reaguje okamžite.
- Nepoužívaj JS na rozhodnutie, ktoré vie spoľahlivo urobiť CSS media/container query.
- Pri hidden paneli neudržuj drahý render iba preto, že je posunutý mimo viewportu.
- Layout-induced CLS drž v rámci celkového produktu na `≤0.1` p75; cielené interakcie odlišuj od nečakaného posunu.

## Hades app-shell kontrakt

Pre súčasný rail + floating header + dock + detail + prompt systém:

- definuj jednu centrálnu mapu otvorených vrstiev a ich priority,
- v medium režime povoľ najviac jeden ľavý dock alebo pravý detail,
- v compact režime zmeň dock/detail na sheet a nenechaj prompt súťažiť o tú istú výšku,
- pri virtual keyboard presuň prompt nad klávesnicu a zachovaj výsledky suggestion,
- udrž header metriky sekundárne; pri nedostatku priestoru ich presuň do overview, nie do horizontálneho scrollu,
- canvas controls oddeľ od toastov a safe-area,
- pridaj režim 320 CSS px/400 % zoom pre všetky DOM panely aj dialógy.

## Testovacia matica

Testuj obsah, nie iba rozmery zariadení:

| Os | Varianty |
|---|---|
| Viewport | 320×568, 360×800, tablet portrait/landscape, 1280×720, 1440×900, 2560×1440 |
| Zoom | 100 %, 200 %, 400 % podľa príslušného reflow scenára |
| Input | keyboard, mouse, touch, pen ak podporovaný |
| Keyboard | zatvorená/otvorená virtuálna klávesnica, landscape mobile |
| Obsah | krátky, dlhý, prázdny, lokalizovaný, 200 % text |
| Layers | navigácia, modal, detail, dock, prompt, toast v hraničných kombináciách |
| Platforma | Chromium, Firefox, Safari/WebKit podľa support matrix |
| Preferences | reduced motion, forced colors, light/dark |

## Release gate

- [ ] Breakpointy vznikli z kolapsu obsahu a úlohy, nie zo zoznamu zariadení.
- [ ] Primárna úloha je dokončiteľná pri 320 CSS px bez straty funkcie.
- [ ] Dvojrozmerný scroll je izolovaný iba na oprávnenú pracovnú plochu.
- [ ] Pri 200/400 % zoome nie sú controls, text ani focus odstrihnuté.
- [ ] Safe areas a virtuálna klávesnica nezakrývajú prompt, CTA ani fokusované pole.
- [ ] Desktop panel a mobile sheet majú správny modal/nonmodal focus kontrakt.
- [ ] Zmena breakpointu zachová draft, selection, filtre, scroll a canvas kameru.
- [ ] Všetky desktop akcie ostávajú nájditeľné v compact režime.
- [ ] Dlhý lokalizovaný text a upravený text spacing nerozbije layout.
- [ ] Layout shift a resize výkon spĺňajú dohodnutý budget.
- [ ] Prešla viewport/browser/input matica a vizuálna regresia.

## Nadväzujúce playbooky

- `skills/it/advanced-ux-ui-delivery-plan.md` — centrálny router a breakpoint/zoom stage gate.
- `skills/it/design-system-component-engineering.md` — container behavior, density a component fixtures.
- `skills/it/frontend-performance-observability.md` — CLS, route budgets a viewport-segmentované RUM.
- `skills/it/accessible-interaction-patterns.md` — focus, modality a reflow accessibility.
- `skills/design/ui-motion-transitions.md` — enter/exit a reduced motion panelov.
- `skills/it/canvas-data-visualization-ux.md` — canvas kamera a DOM alternatíva.
- `skills/it/ux-content-localization.md` — text expansion, locale a direction.

## Zdroje

- [W3C WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [W3C WCAG 2.2 — Orientation](https://www.w3.org/WAI/WCAG22/Understanding/orientation.html)
- [W3C WCAG 2.2 — Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)
- [MDN — CSS Container Queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries)
- [MDN — CSS Subgrid](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid)
- [MDN — CSS Logical Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values)
- [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
