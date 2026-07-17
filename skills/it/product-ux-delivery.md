# Product UX delivery

> Profesionálny playbook na premenu nejasnej požiadavky na overený, implementovateľný a merateľný produktový tok — od problému a výskumu cez prototyp až po release a učenie z prevádzky.

## Výstup, ktorý má skill vytvoriť

Nevyrábaj iba obrazovku. Odovzdaj balík rozhodnutí, podľa ktorého vie tím produkt postaviť, otestovať a vyhodnotiť:

1. **Problem brief** — používateľ, problém, dôkaz, dopad, baseline a cieľ.
2. **Task model** — kritické úlohy, vstupy, rozhodnutia, výstupy a zlyhania.
3. **Flow** — happy path aj alternatívne, chybové, permission a recovery vetvy.
4. **State matrix** — obsah, komponenty, async stavy, responzivita a prístupnosť.
5. **Prototyp + testovací scenár** — čo sa overuje a aké správanie znamená úspech.
6. **Handoff kontrakt** — copy, pravidlá, telemetry, acceptance criteria a otvorené riziká.

## 1. Zarámcuj problém pred návrhom

Zapíš brief na jednu stranu:

| Pole | Povinná otázka |
|---|---|
| Používateľ | Kto vykonáva úlohu, v akom kontexte a s akým oprávnením? |
| Job | Čo sa snaží dokončiť, nie akú feature si pýta? |
| Dôkaz | Z akého pozorovania, dát, ticketov alebo výskumu problém poznáme? |
| Dopad | Čo problém stojí používateľa a produkt? |
| Baseline | Aký je dnešný čas, úspešnosť, chybovosť alebo počet kontaktov podpory? |
| Cieľ | Aká merateľná zmena má nastať a dokedy? |
| Obmedzenia | Právo, bezpečnosť, platforma, dáta, výkon, čas a závislosti. |
| Neznáme | Čo je fakt, predpoklad alebo otvorená otázka? |

Použi jazyk výsledku, nie riešenia: „Administrátor potrebuje nájsť príčinu zlyhania do 2 minút“ je lepšie než „potrebujeme nový dashboard“.

### Pracuj s dôkazom a neistotou

- Označ každé tvrdenie ako **evidence**, **assumption** alebo **constraint**.
- Ku kľúčovému rozhodnutiu zapíš hypotézu, dôkaz, mieru istoty a spôsob overenia.
- Nezamieňaj požiadavku stakeholdera za používateľský výskum.
- Pri chýbajúcich dátach navrhni najlacnejší test, ktorý môže rozhodnutie zmeniť.
- Zastav riešenie, ak nie je jasné, kto má problém alebo podľa čoho sa spozná úspech.

## 2. Modeluj úlohu a informačnú architektúru

### Rozlož kritickú úlohu

Pre každý job zapíš:

1. spúšťač a očakávanie používateľa,
2. potrebné informácie a oprávnenia,
3. rozhodnutia, ktoré musí urobiť,
4. akcie systému a ich spätnú väzbu,
5. definíciu dokončenia,
6. zlyhania a cestu k zotaveniu.

Skráť cestu podľa **rozhodovacej náročnosti**, nie iba podľa počtu klikov. Jeden preplnený krok môže byť horší než tri jasné kroky.

### Navrhni informačnú architektúru

- Zoskup obsah podľa používateľovho mentálneho modelu a pracovného postupu.
- Použi názvy z domény používateľa; interné názvy tabuliek, stavov a služieb skry.
- Udrž rovnaký objekt, akciu a stav pomenované rovnako v navigácii, nadpise, CTA aj notifikácii.
- Pri hlbšej štruktúre zobraz polohu, rodiča a bezpečnú cestu späť.
- Pri vyhľadávaní definuj scope, syntax, prázdny výsledok, filtre, zoradenie a obnovu pôvodného stavu.
- Over findability samostatnou úlohou; pekná karta nevyrieši zlú kategorizáciu.

## 3. Nakresli flow ako stavový systém

Každý kritický flow doplň minimálne o tieto vetvy, ak sú relevantné:

- prvé použitie a onboarding,
- happy path,
- prázdne dáta,
- počiatočné načítanie a obnovenie,
- čiastočný alebo zastaraný výsledok,
- validačná chyba,
- timeout, offline a serverová chyba,
- 401, 403 a expirované oprávnenie,
- konflikt súbežnej úpravy,
- zrušenie a návrat,
- deštruktívna akcia a recovery,
- dokončenie a ďalší odporúčaný krok.

### State matrix

Pre obrazovku alebo komponent vytvor tabuľku:

| Dimenzia | Povinné varianty |
|---|---|
| Dáta | none, one, many, maximum, malformed/partial |
| Request | idle, pending, success, empty, error, cancelled, stale |
| Permission | owner, editor, viewer, denied, expired |
| Input | keyboard, pointer, touch; prípadne switch/voice |
| Viewport | úzky, stredný, široký; 200 % zoom |
| Theme | light, dark, forced colors |
| Motion | normal, reduced/no motion |
| Content | krátky, dlhý, lokalizovaný, neznámy |

Nedizajnuj každý prienik ako unikátnu obrazovku. Definuj pravidlá priority: napríklad permission error má prednosť pred empty state a prvé načítanie sa nesmie tváriť ako prázdny výsledok.

## 4. Prototypuj len to, čo potrebuješ zistiť

- Použi skicu na IA a poradie, klikateľný prototyp na flow a živý kód na výkon, focus, canvas alebo gesto.
- Neinvestuj do vizuálneho polishu pred overením kritického toku.
- Urob reálne texty, realistické množstvo dát a najhorší rozumný obsah.
- Prototypuj aj zlyhania; test iba happy pathu skrýva produkčné riziko.
- Pri nevratnom alebo bezpečnostne citlivom kroku testuj porozumenie následku, nie iba nájdenie tlačidla.

### Napíš usability scenár

Zadaj cieľ bez prezradenia ovládacieho prvku. Sleduj:

- dokončenie bez pomoci,
- kritickú chybu alebo nesprávny výsledok,
- čas iba tam, kde je rýchlosť súčasťou cieľa,
- zaváhania, návraty a nesprávne interpretácie,
- sebaistotu po dokončení,
- recovery po vloženej chybe.

Nehodnoť účastníka. Hodnoť, či rozhranie poskytlo správny signál v správnom čase.

### Triáž nálezov

| Závažnosť | Definícia | Release rozhodnutie |
|---|---|---|
| P0 blocker | Úlohu nemožno dokončiť alebo hrozí strata/únik dát. | Blokuj release. |
| P1 critical | Významná časť používateľov zlyhá bez bezpečnej obchádzky. | Oprav alebo formálne akceptuj riziko vlastníkom. |
| P2 major | Úloha je dokončiteľná, ale s merateľným trením alebo neistotou. | Naplánuj s vlastníkom a metrikou. |
| P3 polish | Lokálna nekonzistentnosť bez významného dopadu na úlohu. | Rieš podľa kapacity. |

## 5. Odovzdaj implementačný kontrakt

Ku každému toku prilož:

- názov a cieľ používateľa,
- diagram toku s vetvami a návratmi,
- state matrix a prioritu stavov,
- finálny UI text vrátane chýb a potvrdení,
- responsive pravidlá, nie iba tri screenshoty,
- keyboard flow, poradie focusu a návrat focusu,
- sémantiku elementov a oznamovanie async zmien,
- väzbu na existujúce tokeny a komponenty,
- pravidlá validácie a serverové zdroje pravdy,
- analytické udalosti a privacy obmedzenia,
- acceptance criteria v pozorovateľnom jazyku,
- známe riziká, otvorené otázky a ownera rozhodnutia.

### Píš acceptance criteria ako správanie

Použi formát:

> Keď [stav a rola], po [akcia], systém [pozorovateľný výsledok] a [focus/oznámenie/dáta], aj keď [relevantné zlyhanie].

Príklad:

> Keď editor uloží zmenu a server vráti konflikt, formulár zachová jeho vstup, označí konfliktné polia, vysvetlí rozdiel a ponúkne znovunačítanie; focus sa presunie na súhrn konfliktu.

„Vyzerá podľa Figmy“ nie je acceptance criterion.

## 6. Meraj výsledok bez telemetrického chaosu

Pre každú udalosť definuj:

| Pole | Príklad |
|---|---|
| Event | `node_search_completed` |
| Trigger | výsledok sa zobrazil po explicitnom hľadaní |
| Properties | latency bucket, result count, active filters |
| Zakázané dáta | plný query text, PII, secret |
| Owner | product/analytics owner |
| Retencia | podľa data policy |
| Otázka | nájdu ľudia relevantný uzol bez opakovania? |

- Nemeraj každý klik. Meraj kroky, zlyhania a výsledky, ktoré odpovedajú na produktovú otázku.
- Oddeľ **exposure**, **attempt**, **success**, **failure** a **recovery**.
- Pred release over, že udalosť nevzniká duplicitne pri retry alebo re-renderi.
- Po release porovnaj výsledok s baseline a kvalitatívne vysvetli odchýlky.

## Release gate

- [ ] Používateľ, problém, dôkaz, baseline a cieľ sú explicitné.
- [ ] Fakty, predpoklady a obmedzenia sú oddelené.
- [ ] Kritické úlohy majú flow aj recovery vetvy.
- [ ] State matrix pokrýva dáta, request, permission, input, viewport, theme a motion.
- [ ] Prototyp používa realistický obsah a testuje aspoň jedno zlyhanie.
- [ ] P0 sú odstránené; P1 sú odstránené alebo formálne akceptované vlastníkom.
- [ ] Handoff obsahuje copy, focus, responsive a async pravidlá.
- [ ] Acceptance criteria sú pozorovateľné a testovateľné.
- [ ] Telemetria má otázku, ownera, privacy pravidlo a ochranu pred duplicitou.
- [ ] Po release existuje termín vyhodnotenia a vlastník ďalšieho rozhodnutia.

## Časté zlyhania

- **Feature bez problému.** Tím optimalizuje riešenie, ale nevie, či zmenil výsledok.
- **Happy-path Figma.** Produkcia následne improvizuje chyby, permissions a loading.
- **Výskum ako dekorácia.** Rozhodnutie je už prijaté a test má iba potvrdiť názor.
- **Desktop screenshot ako špecifikácia.** Chýbajú pravidlá pre obsah, zoom a úzky viewport.
- **Copy až vo vývoji.** Nejasný jazyk odhalí nejasný model príliš neskoro.
- **Kliky bez otázky.** Telemetria rastie, ale nepomáha rozhodovať.
- **Handoff bez ownerov.** Otvorené riziká sa stratia medzi dizajnom a implementáciou.

## Nadväzujúce playbooky

- `skills/it/ux-ui.md` — heuristiky, formuláre a základný audit.
- `skills/design/ui-design-systems.md` — tokeny, komponenty a vizuálny systém.
- `skills/it/accessible-interaction-patterns.md` — keyboard, focus a komplexné widgety.
- `skills/it/resilient-async-ui.md` — requesty, chyby, retry a súbežnosť.
- `skills/design/ui-motion-transitions.md` — význam, tokeny a QA pohybu.

## Zdroje

- [GOV.UK Service Manual — Understand users and their needs](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs)
- [GOV.UK Service Manual — Using prototypes](https://www.gov.uk/service-manual/design/making-prototypes)
- [GOV.UK Service Manual — Measuring service success](https://www.gov.uk/service-manual/measuring-success)
- [W3C WAI — Planning and Managing Web Accessibility](https://www.w3.org/WAI/planning-and-managing/)
- [W3C WAI — Involving Users in Web Projects](https://www.w3.org/WAI/planning/involving-users/)
