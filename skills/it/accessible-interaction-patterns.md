# Accessible interaction patterns

> Implementačný playbook pre prístupné produktové UI: natívna sémantika, keyboard a focus kontrakty, overlaye, komplexné widgety, drag/touch alternatívy, live aktualizácie a manuálne release testy.

## Základný kontrakt

Navrhni rozhranie tak, aby sa kritická úloha dala dokončiť bez myši, bez farby, bez animácie a bez nutnosti vidieť canvas. Prístupnosť nie je vrstva ARIA na hotovom komponente; je to správanie komponentu od prvého návrhu.

Pre každý interaktívny prvok definuj:

1. **name** — čo používateľ počuje alebo číta,
2. **role** — čo prvok je,
3. **value/state** — selected, expanded, checked, invalid, busy a podobne,
4. **keyboard contract** — ako sa naň príde, ovláda a opustí,
5. **focus lifecycle** — kam focus ide po otvorení, zatvorení, zmazaní a chybe,
6. **pointer/touch contract** — veľkosť cieľa, cancel a alternatíva ku gestu,
7. **announcement** — ktoré dynamické zmeny treba oznámiť,
8. **visual contract** — focus, hover, selected a disabled sú odlíšiteľné.

## Native HTML first

- Použi `button`, `a`, `input`, `select`, `textarea`, `details`, `dialog`, nadpisy, landmarky a tabuľky skôr než generický `div` s ARIA.
- Nenahrádzaj natívny element custom widgetom iba kvôli vzhľadu; CSS vie upraviť vzhľad bez straty správania.
- ARIA nemení keyboard správanie. Ak pridáš rolu, implementuj celý príslušný WAI-ARIA pattern.
- Nepoužívaj ARIA na prepis nesprávnej HTML štruktúry, ak ju vieš opraviť v markupe.
- Daj každému inputu trvalo dostupný label. Placeholder nie je label.
- Udrž prístupný názov v zhode s viditeľným textom, aby voice input vedel prvok aktivovať.
- Ikonové tlačidlo potrebuje prístupný názov; dekoratívna ikona má byť skrytá pred accessibility tree.

## Keyboard a focus

### Všeobecné pravidlá

- Všetky akcie sprístupni klávesnicou, nie iba focusovateľnosťou.
- Drž DOM poradie zhodné s vizuálnym a čítacím poradím. Nepoužívaj kladné `tabindex`.
- Použi Tab medzi komponentmi a arrow keys vo vnútri composite widgetov podľa APG.
- Zobraz viditeľný focus vždy. Odlíš focus od selected state.
- Neaktivuj akciu iba cez `keydown` bez ošetrenia opakovania; pre tlačidlo použi natívne správanie.
- Globálne skratky nespúšťaj pri písaní v inpute, textarea, selecte alebo contenteditable.
- Zverejni skratky v UI a umožni konfliktujúce skratky zmeniť alebo vypnúť.
- Escape nech ruší najvnútornejší dočasný kontext, nie náhodne celý workflow.

### Focus lifecycle

Focus nikdy nestrácaj na `body` po odstránení aktívneho prvku.

| Udalosť | Cieľ focusu |
|---|---|
| Otvorenie modalu | logický prvok v modale; pri dlhom obsahu statický nadpis s `tabindex="-1"` |
| Zatvorenie modalu | invoker, ak stále existuje; inak logický sused |
| Otvorenie nonmodal panelu | podľa úlohy: panel alebo zachovaný invoker; pravidlo musí byť konzistentné |
| Zmazanie položky | nasledujúca položka, predchádzajúca pri konci, alebo nadpis prázdneho stavu |
| Chyba formulára | error summary alebo prvé chybné pole podľa patternu |
| Route change | hlavný nadpis/obsah novej route, nie browser chrome |
| Filter/sort | zachovaj focus na ovládaní; výsledok oznám bez presunu |
| Async refresh | zachovaj focus aj scroll, ak používateľ nepožiadal o navigáciu |

## Dialog a overlay

Modal implementuj ako modal iba vtedy, keď musí zablokovať zvyšok úlohy.

- Daj kontajneru `role="dialog"` alebo natívny `<dialog>`, prístupný názov a `aria-modal="true"` tam, kde je potrebné.
- Presuň focus dovnútra pri otvorení.
- Udrž Tab a Shift+Tab v modale.
- Urob podklad neinteraktívny (`inert` alebo ekvivalent), nie iba vizuálne tmavý.
- Escape zavrie bežný modal; pri rozpracovanej strate dát najprv vysvetli následok.
- Zahrň viditeľné tlačidlo Zavrieť/Zrušiť.
- Po zatvorení vráť focus invokeru alebo logickému náhradníkovi.
- Pri nested dialogoch udrž zásobník invokerov a zatváraj iba vrchnú vrstvu.
- Nenechaj sticky header, prompt bar, toast alebo chat prekryť fokusovaný prvok.

Nonmodal panel netrapuje focus. Musí mať jasnú cestu medzi panelom a hlavným obsahom.

## Disclosure, tooltip a popover

- Jednoduché zobrazenie/skrytie rieš `button` + `aria-expanded` + `aria-controls`, prípadne `<details>`.
- Tooltip obsahuje doplnkový text, nie akciu. Ak obsahuje ovládanie, je to popover/dialog, nie tooltip.
- Obsah vyvolaný hoverom alebo focusom musí byť dismissible, hoverable a persistent podľa WCAG 1.4.13.
- Podstatnú informáciu nesprístupňuj iba na hover. Zobraz ju aj pri focus, kliknutí alebo priamo v obsahu.
- Escape zavrie dočasný popover a vráti focus podľa interakcie.
- Pohyb pointera z triggera do popupu nesmie obsah okamžite zavrieť.

## Tabs

- Použi `tablist`, `tab` a `tabpanel` iba pre vrstvy toho istého kontextu, nie ako náhradu hlavnej navigácie.
- Tab vstúpi do tablistu na aktívny tab; Left/Right menia focus medzi tabmi, Home/End idú na okraj.
- Aktivuj tab automaticky iba vtedy, keď sa panel zobrazí bez citeľnej latencie. Inak použi Enter/Space.
- Nastav `aria-selected`, väzbu tab ↔ panel a focusovateľnosť roving `tabindex`.
- Panel musí mať prístupný názov a logické poradie.
- Pri odstránení tabu presuň focus na susedný tab podľa APG.

## Menu, listbox a combobox

- Bežný zoznam odkazov nie je ARIA menu. Menu pattern použi pre aplikačné príkazy.
- V menu naviguj arrow keys, Home/End; Escape zavrie a focus vráti triggeru.
- `select` nahraď custom listboxom iba ak natívny prvok skutočne nestačí.
- V comboboxe odlíš text input, popup, aktívnu option a vybranú value.
- Podpor textovú navigáciu a jasný no-results stav.
- Nechaj používateľa zmazať alebo zmeniť výber klávesnicou.
- Pri multi-selecte oznám počet a stav výberu; nespoliehaj sa na farbu chipu.

## Tree, toolbar a komplexné pracovné plochy

### Tree

- Right otvorí alebo vstúpi do children, Left zavrie alebo prejde na parent; Up/Down menia viditeľnú položku.
- Odlíš focus, selection a expanded state.
- Udrž jednu položku v tab sekvencii a naviguj roving tabindex/`aria-activedescendant` podľa architektúry.
- Poskytni search/filter alternatívu pri veľkom strome.

### Toolbar

- Zoskup príbuzné ovládania do `toolbar` s prístupným názvom.
- Tab nech vstúpi raz; arrow keys navigujú medzi controls.
- Neumiestni do jednej toolbar skupiny toľko ovládaní, že arrow navigácia bude dlhšia než bežný Tab tok.

### Canvas a graf

Canvas sám neposkytuje použiteľný accessibility tree. Doplň ekvivalentný DOM model:

- vyhľadateľný zoznam alebo strom uzlov,
- textový detail vybraného uzla,
- príkazy pre select, open, focus, zoom/fit a návrat,
- zhrnutie filtrov a počtu výsledkov,
- tabuľkový alebo listový pohľad na vzťahy, ak sú súčasťou úlohy,
- oznámenie zmeny výberu a relevantného live eventu.

Každá canvas-only akcia musí mať DOM/keyboard cestu. Drag uzla potrebuje alternatívu cez ovládanie, formulár alebo príkaz; wheel zoom potrebuje tlačidlá a reset/fit.

## Pointer, touch a gestá

- Mier aspoň na 44×44 CSS px pre primárne touch controls; minimum WCAG 2.5.8 je 24×24 CSS px s definovanými výnimkami a spacing pravidlom.
- Ku drag operácii poskytni single-pointer alternatívu bez drag podľa WCAG 2.5.7, ak drag nie je nevyhnutný.
- Ku multipoint alebo path-based gestu poskytni jednoduché ovládanie podľa WCAG 2.5.1.
- Nevykonaj deštruktívnu akciu na pointer down. Umožni pointer cancellation alebo undo.
- Podpor mouse, touch aj pen cez Pointer Events; nespoliehaj sa iba na `mousedown`.
- Ošetri `pointercancel`, stratu capture a Escape.
- Nenechaj hover meniť kritický stav bez explicitnej aktivácie.
- Motion actuation (shake/tilt) doplň UI alternatívou a možnosťou vypnutia.

## Formuláre a chyby

- Zobraz label, hint a error ako samostatné prvky prepojené cez ID.
- Označ povinnosť textom, nie iba hviezdičkou.
- Validuj po zmysluplnom momente: po blur alebo submit; neprerušuj písanie agresívnymi hláškami.
- Pri chybe zachovaj zadané hodnoty.
- Error summary na vrchu odkazuje na konkrétne polia; inline error vysvetlí opravu.
- Error text obsahuje problém a ďalší krok, nie iba „Neplatná hodnota“.
- Nastav `aria-invalid` až pri skutočne vyhodnotenej chybe.
- Pri async validácii oznám pending a výsledok bez spamovania live regionu.
- Neblokuj paste, password manager ani prístupnú autentizáciu kognitívnym testom bez alternatívy.

## Live regiony a async zmeny

Oznamuj výsledok, nie každý interný krok.

- `aria-live="polite"` použi na výsledky search/filter, uloženie, načítanie a neurgentný status.
- `role="alert"` rezervuj pre urgentnú chybu, ktorá potrebuje okamžitú pozornosť.
- Neoznamuj zmenu, ktorú focus presun už dostatočne vysvetlí.
- Debounce rýchle live aktualizácie a oznam agregát, napríklad „12 výsledkov“.
- Pri `aria-busy` udrž stabilný kontajner; nevymieňaj live region v tom istom momente, keď ho chceš prečítať.
- Toast nie je jediný záznam chyby. Stav musí zostať dostupný pri zdroji alebo v histórii.
- WebSocket pulzy filtruj podľa relevancie; screen reader nesmie čítať každý grafický frame.

## Visual accessibility

- Text drž minimálne na WCAG kontraste 4.5:1, veľký text 3:1; non-text UI a focus indikátory over podľa príslušného kritéria.
- Farba nesmie byť jediný nositeľ typu, statusu, chyby alebo selection.
- Pri 200 % zoome musí byť obsah a funkcia použiteľná bez straty informácie; pri úzkom viewporte sa vyhni obojsmernému scrollu, ak nejde o legitímnu pracovnú plochu.
- Podpor text spacing bez prekrytia a odstrihnutia.
- V `forced-colors` over focus, border, ikony a selected state; gradient môže zmiznúť.
- Reduced motion zachová feedback cez text, ikonu, border alebo krátky color/opacity prechod.
- Nezakrývaj focus sticky prvkami; používaj vhodný `scroll-margin` a riadený scroll.

## Testovací gate

Automatizácia nájde časť problémov, nie správnosť celej interakcie. Release vyžaduje:

1. validný DOM a automatický axe/Lighthouse ekvivalent bez kritických nálezov,
2. manuálny keyboard-only prechod všetkých kritických úloh,
3. focus audit pri otvorení, zatvorení, zmazaní, route change a chybe,
4. screen-reader smoke test aspoň na jednej desktop a jednej mobilnej kombinácii podľa support matrix,
5. 200 % zoom a úzky viewport,
6. light, dark a forced-colors/high contrast,
7. reduced motion,
8. touch target a drag-alternative test,
9. pomalý request, live update a error announcement,
10. DOM alternatívu ku canvasu.

### Defect severity

| Priorita | Príklad |
|---|---|
| P0 | Kritická úloha nie je dokončiteľná klávesnicou alebo screen readerom. |
| P1 | Focus sa stratí, modal pustí focus do pozadia, názov/rola/stav sú nesprávne. |
| P2 | Tok je možný, ale neefektívny; chýba oznámenie, target je rizikovo malý. |
| P3 | Lokálny polish, redundancia alebo nekonzistentný, no použiteľný pattern. |

## Release checklist

- [ ] Použité sú natívne elementy, kde postačujú.
- [ ] Každý custom widget implementuje celý APG keyboard contract.
- [ ] Focus je vždy viditeľný, predvídateľný a po odstránení neskončí na body.
- [ ] Modal trapuje focus, podklad je inert, Escape funguje a invoker sa obnoví.
- [ ] Hover/focus obsah je dismissible, hoverable a persistent.
- [ ] Pointer a drag akcie majú keyboard/single-pointer alternatívu.
- [ ] Form error zachová vstup, vysvetlí opravu a presunie/oznámi focus správne.
- [ ] Live regiony oznamujú relevantný výsledok bez spamu.
- [ ] Farba, animácia ani canvas nie sú jediný nositeľ informácie.
- [ ] 200 % zoom, forced colors a reduced motion sú použiteľné.
- [ ] Prebehol manuálny keyboard a screen-reader smoke test.

## Integrácia do pokročilého plánu

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`; accessibility je cross-cutting hard gate.
- **Requires:** reálny content, states, layout a component contracts, nie prázdny wireframe.
- **Companions:** `skills/it/design-system-component-engineering.md`, `skills/it/search-navigation-discovery.md`, `skills/it/privacy-permissions-trust-ux.md`, `skills/it/data-dense-workspaces.md` a `skills/it/canvas-data-visualization-ux.md` podľa surface.
- **Hands off to:** motion/async/implementation ako focus, semantics, keyboard a announcement acceptance criteria.

## Zdroje

- [W3C — Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C WAI — ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [W3C APG — Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [W3C APG — Dialog Modal Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [W3C — Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
- [W3C — Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- [W3C — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [MDN — ARIA live regions](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)
