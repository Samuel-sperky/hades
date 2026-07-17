# Canvas + data visualization UX

> Profesionálny playbook pre grafy, siete, mapy, časové osi a canvas pracovné plochy: vizuálne kódovanie, navigácia, výber, hustota, prístupná alternatíva, veľké dáta, výkon a usability testy.

## Začni otázkou, nie typom grafu

Pred návrhom pomenuj úlohu, ktorú má vizualizácia urýchliť:

- **nájsť** konkrétny objekt,
- **pochopiť** štruktúru alebo susedstvo,
- **porovnať** hodnoty alebo skupiny,
- **odhaliť** trend, anomáliu alebo zmenu,
- **sledovať** tok/sekvenciu v čase,
- **vybrať a konať** nad objektom,
- **vysvetliť** výsledok inému človeku.

Ak sa úloha rieši rýchlejšie tabuľkou, zoznamom alebo textovým súhrnom, použi ich. Canvas nie je automaticky lepší len preto, že dáta majú vzťahy.

### Zmluva vizualizácie

Zapíš:

| Pole | Otázka |
|---|---|
| Publikum | Kto číta vizualizáciu a akú doménu pozná? |
| Primárna otázka | Čo má používateľ zistiť do 10–30 sekúnd? |
| Jednotka | Čo predstavuje jeden mark/uzol/bod? |
| Encoding | Čo znamená pozícia, veľkosť, tvar, farba, hrúbka a opacity? |
| Interakcia | Čo sa dá select, filter, zoom, compare a exportovať? |
| Aktualizácia | Je snapshot, live stream, replay alebo editovateľný model? |
| Neistota | Ktoré dáta sú chýbajúce, odhadnuté, stale alebo agregované? |
| Alternatíva | Ako sa tá istá úloha dokončí bez canvasu? |

## Vizuálne kódovanie

- Mapuj jednu vlastnosť na jeden stabilný vizuálny kanál.
- Pozíciu a dĺžku použi pre presné porovnanie; plochu a farbu skôr pre kategóriu alebo orientačný rozdiel.
- Farbu nikdy nepouži ako jediný nositeľ typu, statusu alebo výberu. Doplň tvar, stroke, ikonu alebo text.
- Veľkosť marku musí mať legendu a jasnú transformáciu; pri ploche škáluj plochu, nie naivne polomer.
- Hrúbku hrany používaj konzistentne pre jednu veličinu. Smer zobraz šípkou, animácia nie je postačujúca.
- Opacity nepouži na kritický rozdiel, ak môže splývať s pozadím alebo dimmingom.
- Nezamieňaj dekoratívny glow za dáta.
- Nechaj chýbajúce/nezistené dáta vizuálne odlíšené od nulovej hodnoty.

### Legenda je ovládanie aj dokumentácia

- Zobraz všetky používané kanály: farbu, tvar, veľkosť, hrúbku, smer a stav.
- Ak legenda filtruje, urob ju keyboard-operable a ukáž aktívny filter aj počet výsledkov.
- Umožni reset jedným krokom.
- Nevypínaj položku iba opacity zmenou; pridaj checkbox/state label.
- Pri prázdnom filtri vysvetli, ktoré obmedzenie odstrániť.

## Priestorový model

Používateľ musí vedieť:

1. kde sa nachádza,
2. aký je rozsah dát,
3. čo je vybrané,
4. čo je skryté filtrom alebo mimo viewportu,
5. ako sa vráti do bezpečného prehľadu.

Preto vždy poskytnite:

- zoom in/out,
- **fit all / reset view**,
- viditeľný scale/zoom stav, ak mení interpretáciu,
- breadcrumbs alebo context label pri fokusovanom subgrafe,
- indikátor aktívnych filtrov a result count,
- stabilný selected/focused stav,
- jasný spôsob zrušenia focusu a návratu.

### Pan a zoom

- Wheel/pinch zoom ukotvi pod kurzorom alebo centroidom.
- Priamy pan/drag mapuj 1:1 bez oneskorenia a bez driftu.
- Tlačidlový zoom používaj pre keyboard/touch alternatívu.
- Nezablokuj browser zoom. Canvas zoom a page zoom sú odlišné funkcie.
- Pri 200 % page zoome udrž ovládania dostupné a text čitateľný.
- Po resize zachovaj používateľov kontext; automatický fit spúšťaj iba pri štarte alebo explicitnej zmene view, nie po každom paneli.
- Pri reduced motion urob automatický focus/fit okamžite.

## Výber, focus a detail

Rozlišuj tri stavy:

- **hover** — dočasný preview,
- **keyboard focus** — aktuálny ovládaný objekt,
- **selection** — trvalý pracovný výber.

Nespoliehaj sa na rovnaký tenký halo pre všetky tri.

- Klik/Enter vyberie objekt; Escape najprv zavrie detail, potom zruší selection/focus podľa dokumentovanej kaskády.
- Vybraný objekt zostane rozoznateľný aj po dimmingu, theme zmene a forced colors.
- Detail zobrazí plný názov, typ, stav, metriky, zdroj, čas aktualizácie a dostupné akcie.
- Truncated label vždy sprístupni v detaile, focus/hover popise a DOM alternatíve.
- Po filtrovaní vybraného objektu vysvetli, že už nie je vo výsledku, alebo selection bezpečne presuň; nenechaj zombie detail.
- Live update nesmie prepísať rozpracovanú editáciu bez conflict flow.

## Labely a hustota

- Prioritizuj labely: selected/focused → aktívna cesta/susedia → významné uzly → ostatné.
- Odstráň kolízie deterministicky; nekmitaj medzi dvoma layoutmi každý frame.
- Drž screen-konštantnú čitateľnú veľkosť textu v rozumnom zoom rozsahu.
- Pri oddialení agreguj alebo skry sekundárne labely; pri priblížení ich odhaľ progresívne.
- Nenechaj tooltip ako jediný zdroj plného textu.
- Zobraz počet skrytých/agregovaných prvkov, ak zmena level-of-detail môže meniť interpretáciu.
- Pri veľmi hustých hranách použi focus/hover susedstvo, edge bundling alebo agregáciu; nevytváraj nečitateľný „hairball“.

## Graf a sieť

### Layout

- Vyber layout podľa otázky: hierarchia, tok, skupiny, geografia alebo voľná asociácia nie sú ten istý problém.
- Udrž stabilitu medzi reloadom, filtrom a drobnou live zmenou; náhodný preskok ničí mentálnu mapu.
- Seeduj deterministicky alebo persistuj pozície tam, kde priestor nesie význam.
- Force simulation po ustálení zastav. Pri drag aktivuj iba potrebnú lokálnu energiu.
- Pri pin/unpin zobraz stav a spôsob návratu.
- Nevytváraj syntetické hrany vizuálne rovnocenné skutočným hranám.

### Susedstvo a cesty

- Pri selection zvýrazni priame susedstvo a smer vzťahov bez úplného zmiznutia kontextu.
- Umožni zobraziť inbound/outbound alebo typ hrany.
- Daj používateľovi zoznam susedov a ich vzťahov mimo canvasu.
- Pri path highlight vysvetli kritérium a dĺžku; „najkratšia“ nemusí znamenať „najsilnejšia“.
- Pri chýbajúcej ceste rozlišuj „neexistuje“ od „je skrytá filtrom“.

## Čas, replay a live udalosti

- Ukáž rozdiel medzi event time a ingestion time, ak sa môžu líšiť.
- Pri replayi zobraz aktuálny čas, rozsah, rýchlosť, play/pause a návrat na live.
- Autoplay nespúšťaj bez jasného dôvodu; rešpektuj reduced motion.
- Umožni seek bez nutnosti sledovať celú animáciu.
- Live režim nesmie automaticky precentrovať kameru pri každom evente.
- Pulz je dočasný signál; dôležitá udalosť potrebuje aj journal/log alebo textový status.
- Pri event storme agreguj počet a typ, neprehrávaj stovky pulzov.
- Pri návrate z hidden tab neprehrávaj backlog ako nekontrolovanú animáciu.

## Accessible DOM alternatíva

Canvas nesmie byť jediná interakčná vrstva. Udrž synchronizovaný DOM model:

1. search s result count,
2. strom alebo zoznam oblastí/objektov,
3. detail selection,
4. zoznam vzťahov a susedov,
5. ovládania zoom/fit/filter/view,
6. textový status live/replay,
7. keyboard príkazy pre kritické akcie.

- Tab vstupuje do hlavných komponentov, nie do stoviek neviditeľných canvas markov.
- V strome/zozname použi príslušný APG pattern a arrow-key navigáciu.
- Selection v DOM a na canvas musí byť jeden spoločný stav.
- Po výbere oznám názov, typ, pozíciu v množine a počet vzťahov podľa relevancie.
- K vizuálnej ceste poskytnite textový zoznam krokov.
- Export alebo share výstup obsahuje title, filtre, čas a vysvetlenie encodingu.

## Prázdne, chybové a degradované stavy

Rozlišuj:

- žiadne dáta v systéme,
- žiadny výsledok po filtri,
- dáta sa načítavajú,
- čiastočné dáta,
- stale snapshot,
- WebSocket odpojený, ale REST snapshot dostupný,
- API chyba,
- príliš veľa dát pre plný detail,
- nepodporovaná grafika/canvas.

Každý stav vysvetlí dopad a ďalší krok. Pri čiastočnom alebo stale stave zobraz, čo chýba a z akého času sú posledné dôveryhodné dáta.

## Výkon a veľké dáta

- Renderuj canvas iba pri dirty stave, aktívnej kamere, pulze, replayi alebo simulácii; v idle zastav rAF.
- Pozastav render a simulation pri hidden tab.
- Batchni pointer/live udalosti do jedného frame.
- Použi spatial index na hit testing; neprechádzaj všetky uzly pri každom `pointermove`.
- Zavádzaj level-of-detail podľa zoomu a hustoty.
- Cudzí alebo drahý text layout cacheuj; nepremeriavaj všetky labely každý frame.
- Obmedz device pixel ratio podľa merania, typicky najviac 2 pre veľké canvas plochy.
- Virtualizuj DOM alternatívu, ale zachovaj screen-reader a keyboard kontrakt.
- Pri prekročení kapacity degraduj explicitne: agregácia, sample, limit hrán alebo server-side filter; nikdy potichu neodhoď dáta.

### Výkonový budget

Nastav a meraj pre cieľové zariadenie:

- limit uzlov/hrán pre každý view a level-of-detail,
- p95 hit-test a frame work,
- čas počiatočného fit/renderu,
- INP kritických ovládaní,
- pamäť po 10 minútach live prevádzky,
- nulový idle frame loop,
- správanie pri 4× CPU slowdown a 200 % zoome.

## Usability testy pre vizualizáciu

Nedávaj účastníkovi otázku „páči sa vám graf“. Zadaj reálne úlohy:

- nájdi konkrétny uzol a otvor detail,
- zisti, ku ktorým objektom je pripojený a akým smerom,
- vráť sa na celý prehľad,
- vyfiltruj skupinu a vysvetli, čo zostalo skryté,
- nájdi zmenu v čase,
- dokonči rovnakú úlohu iba klávesnicou/zoznamom,
- zotav sa po prázdnom výsledku alebo odpojenom live kanáli.

Meraj úspech, kritické omyly, čas k prvému správnemu kroku, počet resetov, nesprávnu interpretáciu encodingu a recovery.

## Release gate

- [ ] Primárna používateľská otázka a jednotka vizualizácie sú explicitné.
- [ ] Encoding má legendu a farba/animácia nie sú jediný nositeľ informácie.
- [ ] Hover, keyboard focus a selection sú odlíšené.
- [ ] Zoom in/out, fit all, reset, filtre a result count sú vždy dostupné.
- [ ] Selection zostane stabilný po resize, filtri, theme a live update.
- [ ] Labely majú prioritu, collision pravidlá a plný text mimo canvasu.
- [ ] Graf layout je stabilný a force simulation sa v idle zastaví.
- [ ] Canvas-only akcie majú DOM/keyboard alternatívu.
- [ ] Live/replay má čas, pause, seek a textový záznam dôležitých udalostí.
- [ ] Empty, partial, stale, disconnected a error stavy sú rozlíšené.
- [ ] Veľké dáta degradujú explicitne a merane.
- [ ] Kritické úlohy prešli keyboard, 200 % zoom, reduced motion a performance testom.

## Integrácia do pokročilého plánu

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`.
- **Requires:** používateľskú otázku z `skills/it/product-ux-delivery.md` a tokeny z `skills/design/ui-design-systems.md`.
- **Companions:** `skills/it/data-dense-workspaces.md` pre tabuľkovú alternatívu, `skills/it/responsive-adaptive-app-layouts.md`, `skills/it/accessible-interaction-patterns.md` a `skills/design/ui-motion-transitions.md`.
- **Hands off to:** `skills/it/frontend-performance-observability.md` s datasetom, frame/render budgetom a measurement hooks.

## Zdroje

- [W3C WAI — Canvas accessibility use cases](https://www.w3.org/WAI/PF/HTML/wiki/Canvas_Accessibility_Use_Cases)
- [W3C APG — Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
- [W3C APG — Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [W3C APG — Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [W3C Pointer Events](https://www.w3.org/TR/pointerevents3/)
- [MDN — Canvas API accessibility](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Basic_usage#accessibility_concerns)
- [web.dev — Rendering performance](https://web.dev/articles/rendering-performance)
