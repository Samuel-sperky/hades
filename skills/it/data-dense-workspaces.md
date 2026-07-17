# Data-dense workspaces

> UX/UI playbook pre profesionálne tabuľky, filtre, výsledkové zoznamy, bulk operácie a analytické pracovné plochy, ktoré zostanú rýchle, čitateľné a ovládateľné aj pri veľkom objeme dát.

## Výstup, ktorý má skill vytvoriť

Nevytváraj iba tabuľku. Odovzdaj pracovný kontrakt:

1. úlohy, dátový model a prioritu polí,
2. query contract pre search, filtre, sort a stránkovanie,
3. table/grid/list rozhodnutie so semantikou a keyboard modelom,
4. selection a bulk-action pravidlá,
5. responzívne, density a column pravidlá,
6. performance budget, telemetry a release maticu.

## 1. Začni rozhodnutím, ktoré človek robí

Pre každú pracovnú plochu zapíš:

| Otázka | Príklad |
|---|---|
| Primárna úloha | Nájsť zlyhaný agent run a bezpečne ho obnoviť. |
| Jednotka riadka | Jeden run, nie neurčitý mix runu a kroku. |
| Porovnanie | Status, vlastník, trvanie, cena, posledná aktivita. |
| Frekvencia | Celodenná operatíva alebo občasný audit. |
| Rozsah | Desiatky, tisíce alebo milióny záznamov. |
| Freshness | Realtime, periodický refresh alebo snapshot. |
| Riziko | Čítanie, editácia, bulk delete, publish, permission. |
| Dokončenie | Aký výsledok potvrdí, že úloha skončila? |

Zobraz pole iba vtedy, keď podporuje identifikáciu, porovnanie, rozhodnutie alebo audit. „Pre istotu“ nie je informačná architektúra.

## 2. Vyber správny pattern

### Natívna tabuľka

Použi HTML `table`, keď ľudia najmä čítajú a porovnávajú údaje po riadkoch a stĺpcoch. Získavaš robustnú semantiku, navigáciu screen readera a predvídateľný layout.

### Interaktívny grid

Použi ARIA grid iba ak bunka dostáva focus a používateľ potrebuje spreadsheet-like keyboard interakciu, inline editing alebo pohyb šípkami. Grid prináša povinnosť implementovať roving tabindex, selection, edit režim a oznámenia správne.

### Zoznam alebo karty

Použi list/card pattern, keď každý objekt má odlišný obsah, dominantnú akciu alebo sa porovnávanie stĺpcov nevyžaduje. Na úzkom viewporte nemeň tabuľku automaticky na karty, ak tým skryješ porovnateľnosť alebo dôležité hodnoty.

### Treegrid

Použi iba pre skutočne hierarchické riadky, ktoré sa rozbaľujú a zbalujú. Ak je detail iba doplnkový panel, použi table + details/drawer.

Zdokumentuj dôvod, semantiku, keyboard model a fallback pre každé rozhodnutie.

## 3. Navrhni dátový a stĺpcový kontrakt

Pre každý stĺpec definuj:

| Pole | Obsah |
|---|---|
| ID | Stabilný identifikátor, nie viditeľný text. |
| Label | Používateľský názov. |
| Typ | text, enum, number, money, duration, date, status, action. |
| Priorita | critical, primary, secondary, optional. |
| Sort | server/client, natural/locale/numeric, null order. |
| Filter | operátory, hodnoty, timezone a invalid state. |
| Format | locale, jednotka, presnosť a fallback. |
| Width | min, preferred, max; wrap alebo truncate. |
| Permission | viditeľnosť a povolené akcie. |
| Export | raw alebo formatted hodnota. |

### Pravidlá buniek

- Zarovnaj text doľava; čísla a merania podľa spoločnej desatinnej logiky doprava.
- Status nikdy nekóduj iba farbou. Použi text a podľa potreby ikonu.
- Dátum bez roku, času alebo zóny zobraz iba ak kontext vylučuje omyl.
- Truncate použi iba s prístupom k plnej hodnote cez focus/click, nie iba hover tooltip.
- Ak je bunka editovateľná, odlíš view a edit režim a zachovaj pôvodnú hodnotu pri chybe.
- Row action menu nesmie byť jediná cesta ku kritickej často používanej akcii.
- Klikateľný riadok neimplementuj ako vnorené konfliktné odkazy. Primárny objekt má explicitný link.

## 4. Query, filtre a výsledkový stav

URL je zdroj pravdy pre stabilný shareable view:

```text
?q=timeout&status=failed,partial&owner=me&sort=-updated_at&page=2
```

- Serializuj query, filtre, sort, stránku a relevantnú density/view vo verziovanom formáte.
- Reload, back/forward a zdieľaný link musia obnoviť rovnaký významový stav.
- Neukladaj citlivý raw query alebo osobné údaje do URL.
- Filter chip ukáže názov, hodnotu a odstránenie; aktívne filtre sú viditeľné bez otvorenia panelu.
- „Zrušiť filtre“ obnoví jasný baseline a zachová search iba vtedy, ak to label explicitne hovorí.
- Rozlišuj „žiadne dáta“, „0 výsledkov pre filtre“, „nemáš oprávnenie“ a „načítanie zlyhalo“.
- Pôvodný dotaz a filtre zachovaj pri chybe aj po návrate z detailu.
- Search a request races rieš podľa `skills/it/resilient-async-ui.md`.

### Filter panel

- Často používané filtre sú priamo dostupné; pokročilé môžu byť v paneli.
- Ukáž počet aktívnych filtrov a výsledkov, ak je známy bez drahého requestu.
- Pri nákladnom query použi explicitné `Použiť filtre`; pri lacnom priebežnom filtrovaní oznamuj výsledok bez focus skoku.
- Závislé filtre vysvetlia, prečo je hodnota nedostupná.
- Uložený view obsahuje schému, ownera, scope, dátum a pravidlo migrácie pri zmene filtrov.

## 5. Sort a poradie

- Každý sortable header má viditeľný stav a správne `aria-sort`.
- Definuj stabilný secondary sort, aby riadky pri rovnosti neskákali.
- Server aj klient používajú rovnakú collation, null a case policy alebo rozdiel explicitne priznaj.
- Multi-sort povoľ len ak úloha vyžaduje poradie podľa viacerých kľúčov; zobrazi jeho prioritu.
- Po refreshi zachovaj pozíciu vybraného objektu, ak zmena poradia nevyžaduje upozornenie.
- Realtime insert nesmie posúvať riadky pod kurzorom počas interakcie; nové dáta oznám a aplikuj kontrolovane.

## 6. Pagination, infinite scroll a virtualizácia

### Pagination

Preferuj pre audit, skok na konkrétnu časť, stabilné URL a bulk výber. Server musí vrátiť total alebo jasne priznať, že ho nevie lacno vypočítať.

### Load more

Použi pre lineárne prezeranie s potrebou zachovať miesto. Tlačidlo ostáva keyboard dostupné a browser history obnoví rozsah aj scroll.

### Infinite scroll

Nepouži pre footer-dependent flow, presné hľadanie ani masové operácie. Ak je opodstatnený, poskytni landmarky, „Načítať viac“ fallback a návrat na rovnakú pozíciu.

### Virtualizácia

Použi pri viac než približne 200 komplexných riadkoch alebo keď meranie preukáže problém. Kontrakt:

- v DOM drž najviac 200 riadkov bez explicitného výkonnostného zdôvodnenia,
- screen reader a keyboard musia poznať pozíciu a celkový počet, ak je známy,
- focusnutý alebo editovaný riadok nesmie zmiznúť bez dokončenia/ukončenia interakcie,
- výška riadka a scroll anchoring musia byť stabilné,
- find-in-page obmedzenie virtualizácie je zdokumentované,
- print/export nepoužíva iba renderovaný viewport.

## 7. Selection contract

Rozlišuj:

- focused row/cell,
- active/open object,
- checked selection,
- selection na aktuálnej strane,
- selection celej query.

Nikdy ich vizuálne ani stavovo nezlievaj.

### Výber celej query

Bezpečný tok:

1. Používateľ vyberie viditeľnú stranu.
2. UI oznámi presný počet.
3. Ponúkne explicitné `Vybrať všetkých N výsledkov`.
4. Zobrazí scope, filtre a výnimky.
5. Zmena query výber zruší alebo vyžiada potvrdenie; pravidlo je konzistentné.

Použi model `allMatching + excludedIds`, nie milión ID v klientovi. Server pred akciou znovu vyhodnotí query, permissions a verziu.

## 8. Bulk akcie a bezpečnosť

Bulk bar ukáže:

- počet a scope vybraných objektov,
- dostupné akcie podľa prieniku permissions,
- nekompatibilné alebo vynechané položky,
- spôsob zrušenia výberu.

Pred rizikovou akciou zobraz exact target set alebo počet, filter snapshot, dôsledok, reversibility a prípadný export. Po vykonaní vráť receipt:

```text
succeeded: 47 | failed: 2 | skipped: 3 | audit_id: ...
```

- Partial success nie je success toast. Umožni stiahnuť alebo prefiltrovať zlyhania.
- Retry opakuje iba bezpečné failed položky a používa idempotency contract.
- Undo sľubuj iba pri reálnej serverovej kompenzácii.
- Permission alebo dátová zmena po confirmation musí akciu bezpečne zastaviť alebo reportovať presný partial výsledok.

## 9. Density, šírka a responzivita

Density je používateľská preferencia, nie náhrada za informačnú prioritu:

- comfortable pre príležitostnú prácu,
- compact pre skúsené desktop workflow,
- touch režim stále spĺňa cieľovú veľkosť ovládania.

Na úzkom viewporte:

1. zachovaj identitu objektu a primárnu akciu,
2. secondary stĺpce presuň do row details alebo horizontálneho kontajnera s jasným signálom,
3. nikdy ticho nevynechaj kritický status, riziko alebo výber,
4. bulk bar nesmie zakryť posledné riadky ani focus,
5. filtre sa môžu presunúť do draweru, ale aktívny stav ostane viditeľný.

Ak sa tabuľka zmení na prioritizovaný zoznam, zachovaj všetky kritické hodnoty a ponúkni explicitný `Tabuľkové zobrazenie` s ovládateľným horizontálnym scrollom. Používateľ si tak môže zvoliť čitateľnosť jednej položky alebo stĺpcové porovnanie; responzívny režim nesmie túto schopnosť ticho odobrať.

Použi pravidlá z `skills/it/responsive-adaptive-app-layouts.md`. Otestuj 320 CSS px, 200 % zoom, touch, keyboard a dlhý lokalizovaný obsah.

## 10. Accessibility contract

- Natívna table má `caption` alebo programovo priradený názov a správne `th`/scope.
- Sort control je reálne tlačidlo v headeri.
- Checkbox má názov objektu, nie iba „Vybrať“.
- Toolbar dodrží APG toolbar keyboard pattern iba ak používa roving tabindex; inak používaj bežné tab poradie.
- Sticky header ani column nesmie zakryť focus pri zoome.
- Horizontal scroll container je focusovateľný a má zrozumiteľný názov, ak sa k nemu keyboard používateľ inak nedostane.
- Grid alebo treegrid implementuj kompletne podľa APG; nepridávaj `role=grid` iba kvôli vzhľadu.
- Dynamický počet výsledkov oznamuj stručne, nie pri každom keypresse.
- Forced colors, reduced motion a vysoký zoom nesmú skryť selection ani status.

## 11. Performance a observability

Rozpočty pre lokálne operácie na už načítaných dátach:

- filter alebo sort feedback do 100 ms,
- prvých 50 riadkov do 100 ms od dostupnosti dát,
- INP ≤ 200 ms na p75 reálnych návštev,
- bez long tasku nad 50 ms pri bežnej interakcii,
- DOM najviac 200 dátových riadkov bez výnimky zdokumentovanej meraním.

Meraj:

- query latency a error/timeout rate,
- time to first usable rows,
- filter reformulation a zero-results recovery,
- sort/filter/view využitie podľa produktovej otázky,
- bulk attempt, partial failure, recovery a cancel,
- long tasks, DOM count a scroll jank,
- task success, nie iba kliky.

Query text, exportované hodnoty a osobné dáta nevkladaj do telemetry bez schválenej potreby a retention.

## Testovacia matica

Otestuj:

- 0, 1, 50, 200, 10 000 a neznámy total,
- veľmi dlhé hodnoty, null, duplicity, locale sort a časové zóny,
- loading, stale, partial, error, permission a realtime update,
- jeden a viac sort kľúčov,
- filtre bez výsledku a reset,
- URL round trip, back/forward a saved view migration,
- stránkový aj query-wide selection,
- partial bulk success, stale permission a retry,
- keyboard, screen reader, 200 % zoom a forced colors,
- 320 px, touch, compact/comfortable density,
- performance na low-end profile a throttled network.

## Release gate

- [ ] Jednotka riadka, primárna úloha a priority polí sú explicitné.
- [ ] Table/list/grid pattern zodpovedá interakcii a má kompletnú semantiku.
- [ ] Query, filtre, sort a stránka prejdú presným URL round tripom.
- [ ] Empty, zero-results, loading, partial, error a permission sú odlíšené.
- [ ] Selection rozlišuje stránku a celú query; scope je vždy viditeľný.
- [ ] Bulk výsledok reportuje succeeded, failed a skipped bez falošného success.
- [ ] Pri viac než 200 riadkoch sa použije pagination/virtualizácia alebo merané zdôvodnenie.
- [ ] Lokálny filter/sort reaguje do 100 ms a INP je ≤ 200 ms na p75.
- [ ] Úzky viewport nestratí identitu, kritický status, výber ani primárnu akciu.
- [ ] Keyboard, screen reader, zoom, forced colors a locale testy prešli.
- [ ] Nie sú otvorené P0/P1 chyby ani známa strata dát pri bulk/retry toku.

## Nadväzujúce playbooky

- `skills/it/accessible-interaction-patterns.md` — table/grid semantika, focus a keyboard.
- `skills/it/resilient-async-ui.md` — request races, partial failure a retry.
- `skills/it/responsive-adaptive-app-layouts.md` — layout, panely a narrow viewport.
- `skills/it/ux-content-localization.md` — locale sort, formátovanie a copy.
- `skills/it/canvas-data-visualization-ux.md` — grafy a non-visual alternatíva.

## Zdroje

- [W3C WAI-ARIA APG — Table Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/)
- [W3C WAI-ARIA APG — Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
- [W3C WAI-ARIA APG — Treegrid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/)
- [W3C WAI-ARIA APG — Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- [W3C WCAG 2.2 — Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [web.dev — Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)
