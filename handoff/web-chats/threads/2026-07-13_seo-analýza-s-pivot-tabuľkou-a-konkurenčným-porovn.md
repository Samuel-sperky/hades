# SEO analýza s pivot tabuľkou a konkurenčným porovnaním

- **UUID:** 867c966e-b003-4c31-9309-45ee583bf2eb
- **Vytvorené:** 2026-07-13T06:55
- **Aktualizované:** 2026-07-13T08:52
- **Správ:** 22

---

### 🧑 Používateľ
*(prílohy: sperky-eshop.sk-Performance-on-Search-2026-07-13 (1).xlsx, olivie.sk-organic-keywords-subdomains-sk-_2026-07-13_08-21-26.csv, olivie.sk-organic-keywords-subdomains-sk-_2026-07-13_08-21-11.csv, www.sofia.sk-sk-organic-keywords-path-sk-a_2026-07-13_08-20-34.csv, www.sofia.sk-sk-organic-keywords-path-sk-a_2026-07-13_08-20-05.csv, www.izlato.sk-organic-keywords-subdomains-s_2026-07-13_08-19-33.csv, www.izlato.sk-organic-keywords-subdomains-s_2026-07-13_08-18-27.csv, sperky-eshop.sk-organic-keywords-subdomains_2026-07-13_07-52-31.csv, sperky-eshop.sk-Performance-on-Search-2026-07-13.xlsx, sperky-eshop.sk-organic-keywords-subdomains_2026-07-13_07-45-01.csv, top-100-core-kw-sperky-eshop-CISTE-bez-starych-dat.xlsx)*

Priprav mi pivot tabuľku pre SEO analýzu. Prvý tab, nech má všetky mesiace roku 2026 a riadky: Návštevnosť, Počet KW, 1-3, 4-10, 11-20. A interaktívny graf. Údaje sa natiahnu z ahrefs.
Druhý tab bude master tab so 100 KW v stĺpci s metrikami: Zobrazenia, Kliky, CTR, Pozícia a URL. Po kliku na slovo sa slovo otvorí vo svojom tabe (čiže vytvor tab pre každé slovo, kde bude detailne za každý mesiac metriky a graf interaktívny. Údaje sa budú ťahať z GSC.
Tých 100 KW je v prílohe excel.
každú metriku zároveň chceme porovnávať s konkurenciou - to bude osobitný tab. Dám Ti vstupy, ak Ti niečo chýba, povieš mi, doplním. Začni na pokyn "začni".

### 🤖 Claude
[tool_use: view]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

Inventár vstupov overený. Stav:

**GSC (sperky-eshop.sk)**
- Máj 2026: denný graf + 1 000 dopytov (kliky, zobrazenia, CTR, pozícia). Bez URL na úrovni dopytu.
- Jún 2026: to isté.

**Ahrefs (organic keywords, snapshoty aktuálnych pozícií)**
- sperky-eshop.sk: 2 exporty (stav ~máj, stav ~jún)
- olivie.sk: 2 exporty
- izlato.sk: 2 exporty
- sofia.sk: 2 exporty

**Top 100 CORE KW**: 100 slov, 8 segmentov, kompletné.

Chýbajúce vstupy voči zadaniu:

1. **Tab 1 – mesiace celého roka 2026 z Ahrefs.** K dispozícii sú len 2 snapshoty (máj, jún). Na riadky Návštevnosť / Počet KW / 1-3 / 4-10 / 11-20 za január–apríl treba Ahrefs exporty k daným mesiacom (Site Explorer → Organic keywords s historickým dátumom, jeden export na mesiac a doménu). Júl–december 2026 neexistuje — štruktúra bude pripravená na 12 mesiacov, naplnia sa len dostupné.
2. **Detailné taby na KW – „za každý mesiac"**. GSC pokrýva len máj a jún. Na skoršie mesiace treba GSC exporty (Výkonnosť → filter mesiac → export), jeden súbor na mesiac.
3. **URL v master tabe.** GSC export Dopyty neobsahuje URL. Riešenie bez ďalšieho vstupu: URL doplním z Ahrefs (Current URL) pre KW, ktoré tam figurujú; zvyšok ostane prázdny. Ak chceš presné GSC URL, treba export Dopyty+Strany kombinovane (GSC UI to natívne nedáva — alternatíva je API export; inak akceptuj Ahrefs URL).
4. **Konkurencia po metrikách.** Ahrefs dáva pozíciu, volume, traffic — nie kliky/CTR/zobrazenia (to je len tvoje GSC). Porovnávací tab bude teda: pozícia + odhad traffic + volume per KW per doména. Ak to stačí, netreba nič dopĺňať; pri 2 snapshotoch bude porovnanie za 2 obdobia.

Technická poznámka: klik na slovo v master tabe → hyperlink na tab slova = 100 tabov, realizovateľné. Interaktivita grafov v Exceli = natívne Excel grafy per tab; plná interaktivita (hover, prepínanie metrík) by vyžadovala HTML dashboard namiesto Excelu — Excel verzia bude mať štandardné grafy.

Doplň chýbajúce exporty alebo potvrď prácu s dostupným rozsahom. Čakám na „začni".

### 🧑 Používateľ
1. zatial priprav len máj a jún
2. zatiaľ priprav len máj a jún
3. doplň z ahrefs
4. čerpaj len z ahrefs, GSC pre konkurenciu nemáme

### 🤖 Claude
[tool_use: view]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Hotové. 103 tabov:

**Prehľad 2026** — stĺpce január–december, riadky Návštevnosť / Počet KW / 1-3 / 4-10 / 11-20. Naplnený máj (9 092 / 959 / 290 / 577 / 81) a jún (9 737 / 970 / 375 / 503 / 81) z Ahrefs. Dva grafy: návštevnosť + rozloženie pozícií. Ostatné mesiace prázdne, štruktúra pripravená na doplnenie.

**Master 100 KW** — 100 slov s blokmi Máj/Jún (Zobrazenia, Kliky, CTR ako živý vzorec, Pozícia) + URL z Ahrefs (88/100 pokrytie, klikateľné). Klik na slovo otvorí jeho tab. GSC pokrytie: 90 slov máj, 85 jún — prázdne bunky = slovo nebolo v top 1000 dopytoch daného mesiaca.

**Konkurencia** — 100 KW × 4 domény (sperky-eshop, olivie, izlato, sofia): Pozícia za 2 obdobia + Traffic + Volume. Farebne: zelená 1-3, žltá 4-10. sofia.sk má snapshoty apríl+máj (jún v exportoch chýba), stĺpce sú podľa toho označené.

**100 KW tabov** — riadky pre všetkých 12 mesiacov (máj+jún naplnené), kombinovaný graf (stĺpce zobrazenia/kliky, čiara pozícia na sekundárnej osi), spätný link na master.

Metodické poznámky sú v každom tabe (agregácia GSC variantov bez diakritiky, pozícia vážená zobrazeniami, mapovanie Ahrefs snapshotov na mesiace).

Po dodaní exportov za ďalšie mesiace pošli súbory, doplním do existujúcej štruktúry.

### 🧑 Používateľ
ktoré KW sú v jednotlivých taboch?

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

Každý tab má názov `NNN kľúčové slovo` a poradie kopíruje master. Rozpis:

**Všeobecné (001–008):** sperky eshop, šperky, zlaté šperky, strieborné šperky, zlato, striebro, bižutéria eshop, piercing

**Zlaté šperky (009–032):** zlate náušnice, zlate prstene, zlaté retiazky, zlate naramky, zlaté prívesky, zlatý náhrdelník, zlatý piercing, zlate obrucky, zlatý zásnubný prsteň, dámske zlaté náušnice, detské zlaté náušnice, panske zlate nausnice, zlaté nausnice kruhy, zlaté prstene dámske, pánske zlaté prstene, zlaté diamantové prstene, dámske zlaté retiazky, panske zlate retiazky, damske zlate naramky, panske zlate naramky, detske zlate naramky, panske zlate privesky, zlaty prívesok, zlatá retiazka

**Strieborné šperky (033–052):** strieborné náušnice, strieborne prstene, strieborné retiazky, strieborné naramky, strieborne privesky, strieborné náhrdelníky, strieborné sety, strieborne obrucky, damske strieborne nausnice, detske strieborne nausnice, strieborne nausnice kruhy, strieborné prstene dámske, panske strieborne prstene, strieborny zasnubny prsten, strieborná retiazka dámska, strieborna retiazka panska, damsky strieborny naramok, pansky strieborny naramok, strieborny privesok, strieborny prsteň

**Produktové kategórie (053–060):** prstene, retiazka, náramok, sada šperkov, dámske retiazky, panske retiazky, damske náramky, nausnice panske

**Svadobné šperky (061–063):** zasnubne prstene, zasnubny prsten, svadobne obrucky

**Diamantové šperky (064–072):** diamant, diamantove sperky, diamantové nausnice, diamantovy prsten, diamantovy nahrdelnik, diamantovy privesok, briliantovy prsten, briliantove nausnice, briliantovy nahrdelnik

**Oceľ a materiály (073–086):** chirurgicka ocel, ocelové šperky, sperky z chirurgickej ocele, nausnice z chirurgickej ocele, prstene z chirurgickej ocele, retiazka z chirurgickej ocele, naramok z chirurgickej ocele, prívesky z chirurgickej ocele, obrúčky z chirurgickej ocele, titanove obrucky, titanove nausnice, wolframove obrucky, kozene naramky, magneticky naramok

**Piercing (087–100):** piercingy, piercing shop, piercing do ucha, piercing do nosa, piercing do pupka, piercing do jazyka, piercing do obočia, piercing do bradaviek, helix piercing, nostril piercing, labret piercing, septum piercing, plugy do ucha, tunel do ucha

### 🧑 Používateľ
vpíš ich do tabov, nech viem, a zároven metriky každého KW

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Doplnené. Každý zo 100 KW tabov teraz obsahuje:

**Riadok 1** — kľúčové slovo (názov tabu = poradie + slovo, napr. „001 sperky eshop").
**Riadok 2** — segment a úroveň CORE.
**Riadok 3** — súhrn metrík na jeden pohľad, napr.: „Jún 2026: 1 892 zobrazení | 109 klikov | CTR 5,76 % | pozícia 1,8 (pozícia vs. máj: +0,6)". Ak KW nie je v GSC, riadok to explicitne uvádza.
**Riadky 4–16** — mesačná tabuľka (Zobrazenia, Kliky, CTR, Pozícia) + graf ako doteraz.
**Riadky 20–22** — nový Ahrefs blok pre dané KW: Volume, KD, Pozícia máj, Pozícia jún, Traffic jún, klikateľná URL najlepšej stránky. Pri KW mimo Ahrefs exportu je poznámka o chýbajúcom zázname.

Interné prelinkovanie master ↔ taby a vzorce CTR overené, bez chýb.

### 🧑 Používateľ
v tab Master 100 KW máš presné zhody?

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

Nie. Master používa **normalizovanú zhodu, nie presnú**:

**Pravidlo:** GSC dopyt sa počíta do KW, ak sa zhoduje celý reťazec po normalizácii — malé písmená, odstránená diakritika, zjednotené medzery. Kliky a zobrazenia variantov sa sčítajú, pozícia je vážená zobrazeniami, CTR sa počíta z agregátu.

**Rozpad za jún:** 42 KW = jediný variant v GSC (de facto presná zhoda), 43 KW = agregácia 2–6 diakritických variantov, 15 KW = bez dát. Máj: 46 / 44 / 10.

Príklady agregácie (jún): „zlate náušnice" = súčet 6 variantov (zlate nausnice, zlaté nausnice, zlaté náušnice, …) → 29 klikov / 4 500 zobrazení; „šperky" = sperky + šperky → 33 / 1 981.

**Čo agregácia nezahŕňa:** frázové rozšírenia. „zlaté náušnice kruhy" sa nepočíta do „zlate náušnice" — je to samostatné KW (č. 21). Žiadne prekrytie medzi KW nevzniká.

**Dôsledok voľby:** presná zhoda bez normalizácie by pri slovenčine podhodnotila výkon — používatelia píšu s diakritikou aj bez nej a GSC ich eviduje ako rôzne dopyty. Google ich obsluhuje takmer identickými SERP, takže agregát je vernejší obraz výkonu KW. Nevýhoda: čísla v masteri nesedia 1:1 s jedným riadkom v GSC UI.

Ak vyžaduješ presnú zhodu (len riadok identický so znením KW vrátane diakritiky), prepnem — čísla klesnú a časť KW zapísaných bez diakritiky („zlate naramky") by sa párovala na menej frekventovaný variant. Alternatíva: pridám do každého KW tabu rozpis jednotlivých variantov s ich metrikami, agregát v masteri ostane.

### 🧑 Používateľ
*(prílohy: TOP%20100%20KW_traffic_konkurencia_blogy_vyplnene.xlsx)*

Pridaj aj tab blogy, hned za konkurenciu tab

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Tab **Blogy** pridaný na 4. pozíciu, hneď za Konkurenciu. Obsah:

**Detail** — 27 blogových článkov zoradených podľa mesiaca publikovania (január–júl), farebné pruhovanie po mesiacoch. Stĺpce: Mesiac, URL (klikateľná, zobrazená skrátene bez domény), Zobrazenia, Kliky, CTR (živý vzorec), Pozícia.

**Súhrn po mesiacoch** — počet blogov, súčty zobrazení a klikov (SUM vzorce), agregované CTR. Napr. január: 4 blogy, 563 zobrazení, 13 klikov, CTR 2,31 %.

**Graf** — stĺpcový, zobrazenia + kliky po mesiacoch.

Poznámky k dátam: 6 článkov je v podklade bez metrík (zirkon-ktory-vybrat, dokonaly-par, svadobne-sperky a oba júlové) — riadky sú v tabuľke, bunky prázdne, doplnia sa po dodaní. Anomália na kontrolu: „investicia-do-zlata-preco-centralne-banky-nakupuju-zlato" (jún) má pozíciu 59,2 — rád mimo ostatných článkov; over v podklade, či nejde o preklep.

Poradie tabov: Prehľad 2026 → Master 100 KW → Konkurencia → Blogy → 001–100.

### 🧑 Používateľ
mesiace indikujú iba kedy bol blog publikovaný. Dáta sú za jeden mesiac

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Sémantika opravená v celom tabe Blogy:

- Nadpis: „výkon v GSC za jedno mesačné obdobie; Mesiac = dátum publikovania článku".
- Stĺpec premenovaný z „Mesiac" na **„Publikované"** (detail aj súhrn).
- Súhrn premenovaný na „Súhrn podľa mesiaca publikovania (kohorty článkov, rovnaké merané obdobie)" — čísla teda porovnávajú výkon skupín článkov podľa veku, nie mesačný vývoj.
- Graf premenovaný rovnako.
- Zdrojová poznámka: merané obdobie nie je v podklade uvedené; zapísaný predpoklad **jún 2026** (júlové články sú bez dát, čo s tým konzistentné). Ak je merané obdobie iné, pošli ho, poznámku upravím.

Dôsledok pre interpretáciu: pozícia 59,2 pri júnovom článku o centrálnych bankách je čerstvý článok v prvom mesiaci indexácie — anomália z minulej správy je týmto vysvetliteľná, nie nutne preklep.

### 🧑 Používateľ
za jún

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Zapísané ako fakt: merané obdobie = jún 2026. Aktualizovaný nadpis tabu, názov grafu aj zdrojová poznámka (predpoklad odstránený, obdobie označené ako potvrdené).

Interpretačný rámec tabu je teraz jednoznačný: všetkých 27 článkov je merané za jún 2026, kohorty podľa mesiaca publikovania ukazujú, ako výkon rastie s vekom článku — januárová kohorta 563 zobrazení / 13 klikov vs. júnová kohorta v prvom mesiaci života. Prázdne riadky (2 júlové články + 3 staršie bez záznamu) ostávajú na doplnenie z júlového GSC exportu.

### 🧑 Používateľ
Dám Ti dáta a doplň do tab blogy

### 🤖 Claude
Pošli súbor alebo vlož dáta priamo do správy. Očakávaný formát na riadok: URL (alebo koncovka /blog/...), Zobrazenia, Kliky, Pozícia — CTR dopočítam vzorcom. Uveď merané obdobie dát (jún / júl / iné). Po dodaní doplním existujúce prázdne riadky a pridám nové články, ak v tabe zatiaľ nie sú.

### 🧑 Používateľ
*(prílohy: TOP%20100%20KW_traffic_konkurencia_blogy_vyplnene.xlsx)*

tu je aktuálizovaný formát tabu blogy

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Tab Blogy prestavaný na maticový formát podľa šablóny:

**Riadky** — 27 článkov s klikateľnou URL + stĺpec Publikované, plus 5 rezervných riadkov na plánované júlové/augustové články (ako v šablóne). Farebné pruhovanie po publikačných kohortách.

**Stĺpce** — bloky Zobrazenia / Kliky / CTR / Pozícia za každý meraný mesiac. Šablóna mala január–jún; rozšírené na celý rok 2026, aby sa dáta dopĺňali bez ďalšej prestavby. Ukotvené prvé dva stĺpce (URL + Publikované ostávajú viditeľné pri posune doprava).

**Naplnené** — jún 2026 z predchádzajúceho podkladu: 22 článkov s dátami, spolu 1 313 zobrazení / 31 klikov / CTR 2,36 % (riadok SPOLU je živý SUM vzorec za každý mesiac, CTR dopočítavané).

**Graf** — súčty zobrazení a klikov po meraných mesiacoch, napojený vzorcami na riadok SPOLU — po doplnení ďalších mesiacov sa aktualizuje sám.

Ďalšie mesiace: pošli vyplnenú šablónu (stačí s novým mesačným blokom), prenesiem hodnoty do príslušných stĺpcov.

### 🧑 Používateľ
a doplním Ti data

### 🤖 Claude
Rozumiem. Očakávam vyplnenú šablónu (alebo dáta v ľubovoľnej forme: URL + Zobrazenia, Kliky, Pozícia) s označením meraného mesiaca. Po dodaní prenesiem hodnoty do príslušného mesačného bloku v tabe Blogy — CTR, riadok SPOLU aj graf sa dopočítajú automaticky.

