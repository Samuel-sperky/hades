# Aura KPI appka — 100 otázok pred štartom

> Podklad: ZIP `KPI-20260723T071610Z-1-001.zip` — 14 xlsx súborov (Master, Manažment súhrn,
> 11 oddelení + SEO porada). Každá otázka má **[Odporúčanie]** vychádzajúce z dát a z existujúcich
> Aura appiek. Odpovedaj pokojne stručne: „všetko podľa odporúčaní okrem č. 12, 37, 80…" + korekcie.

---

## A. Účel, používatelia a rozsah (1–10)

1. **Primárny používateľ appky si ty (CEO pohľad), alebo aj vedúci oddelení, ktorí si budú sami zapisovať čísla?**
   [Odporúčanie: oboje — CEO dashboard + každé oddelenie vidí a vypĺňa len svoju sekciu.]
2. **Majú jednotliví zamestnanci (Gabika, Delaja, Daniel…) vidieť KPI ostatných oddelení, alebo len svoje?**
   [Odporúčanie: bežný účet vidí len svoje oddelenie + celotímové skóre; Admin vidí všetko.]
3. **Nahrádza appka Excel úplne (Excel zanikne), alebo Excel ostáva ako zdroj a appka je len vizualizácia?**
   [Odporúčanie: appka = primárny zdroj pravdy, Excel len jednorazový import + priebežný export.]
4. **Rok 2026 je štartovací. Má appka podporovať aj spätné roky (2025 pre medziročné porovnania Performance/Import)?**
   [Odporúčanie: áno — ročníky ako entita, minulý rok stačí ako ručne zadané referenčné hodnoty.]
5. **Časová granularita: všetko je mesačné, len AppAI/Projekty sú kvartálne a Sklad/Externistky majú denníkový detail. Sedí to tak do appky?**
   [Odporúčanie: áno — mesiac ako základ, kvartál pre projekty, denník ako detail pod mesiacom.]
6. **Názov appky?** [Odporúčanie: „Aura KPI".]
7. **Jazyk: len slovenčina, alebo SK+EN ako Interná evidencia?** [Odporúčanie: len SK — všetky podklady sú SK.]
8. **Kde má appka bežať — rovnaký vzor ako aura-logistika (C:\Aura\aura-kpi, Docker, vlastný port ~3030, ngrok profil)?**
   [Odporúčanie: áno, 1:1 vzor aura-hr-mapa/aura-logistika.]
9. **Má byť prístupná verejne cez ngrok tunel pre tím (ako HR mapa), alebo len lokálne?**
   [Odporúčanie: ngrok s basic-auth/loginom — tím vypĺňa z vlastných počítačov.]
10. **Kto bude čísla reálne zapisovať — každé oddelenie samo po porade, alebo ty centrálne pri mesačnej uzávierke?**
    [Odporúčanie: oddelenia samy, ty len kontroluješ a uzatváraš mesiac.]

## B. Import existujúcich dát a vzťah k Excelom (11–20)

11. **Mám pri štarte naimportovať existujúce vyplnené hodnoty z týchto xlsx (Hospodársky 1–6/2026, Newsletter 1–6, Copywriter hustota 1–6, Fotografka január, Performance apríl–máj…)?**
    [Odporúčanie: áno — jednorazový import ako seed, nech appka od prvého dňa žije.]
12. **Master a oddelené súbory sa už rozišli (Hospodársky: iné Min/Max pásma; Newsletter: nová definícia pomeru, DPH, tolerancie). Ktorý je pravda?**
    [Odporúčanie: oddelený súbor = novší = pravda; master beriem len ako doplnok. Potvrď.]
13. **Newsletter „-1M" verzia: Pomer = Admin ÷ Tržba kupóny s DPH logikou a kontrolou odchýlky M+N vs kupóny (OK/Pozor/Nesedí). Je toto finálna metodika Newsletter KPI?**
    [Odporúčanie: áno, prebrať vrátane tolerancií 5 %/10 % a stĺpca Upozornenie.]
14. **Hospodársky jún: zadaná marža 160 190 € bez nákladu → EBITDA marža 100 % (artefakt). Mám takéto neúplné riadky pri importe označiť ako „rozpracované" namiesto počítania?**
    [Odporúčanie: áno — plnenie sa počíta až keď sú vyplnené všetky vstupy riadku.]
15. **Hospodársky pásma: oddelený súbor má pre jan–máj Min 1 %/Max 5 %, master 15 %/25 %. Ktoré pásmo platí pre 2026?**
    [Odporúčanie: 15–25 % (Legenda to uvádza ako definíciu); január–máj prepočítať.]
16. **Manazment-Suhrn.xlsx je zamrznutá kópia pre manažment. Má appka mať ekvivalent — zdieľateľný „manažment pohľad" (read-only)?**
    [Odporúčanie: áno — read-only rola/odkaz s Dashboardom, Analýzou a Team score.]
17. **Súbor SEO-porada-otazky (72 otázok Príprava/Porada/Záver) je iný žáner než KPI. Patrí do tejto appky, alebo ostáva mimo (rieši ho SEO reporting framework)?**
    [Odporúčanie: mimo — appka KPI; do appky len Copywriter KPI čísla.]
18. **Úvod master súboru odkazuje na „Šperky-Admin-Evidencia.xlsx" (objednávky, faktúry, fotoprotokol). Ten v ZIPe nie je — je mimo scope?**
    [Odporúčanie: mimo scope tejto appky.]
19. **Potrebuješ priebežný export do xlsx (rovnaká štruktúra ako teraz) pre ľudí, čo chcú ostať v Exceli?**
    [Odporúčanie: áno — export celého roka aj jedného oddelenia; import CSV/xlsx pre hromadné doplnenie.]
20. **Ak niekto po uzávierke opraví staré číslo, má sa to logovať (audit trail: kto, kedy, stará→nová hodnota)?**
    [Odporúčanie: áno, plný audit log ako v Logistike.]

## C. KPI model a výpočty (21–35)

21. **Jednotná definícia plnenia: (Skutočnosť − Min)/(Max − Min), cap 100 %, prázdne → prázdne. Platí bez výnimky?**
    [Odporúčanie: áno, + typ „zavreté/otvorené" (cap 100 %) a typ „tolerancia" (Import: 0/100 %).]
22. **Môže byť plnenie záporné (Hospodársky marec −18 %), alebo floor 0 %?**
    [Odporúčanie: ukladať reálne (aj záporné), v UI zobrazovať s jasným červeným stavom; floor 0 % len v Team score priemere — potvrď.]
23. **Team score = priemer Performance, Newsletter-AI, Copywriter, Fotografka, Nahrávanie, EBITDA. Prečo tam nie sú Expedícia, Reklamácie, Import, Sklad, Externistky — majú pribudnúť?**
    [Odporúčanie: nechať 6 zložiek ako doteraz, ale spraviť zloženie konfigurovateľné (checkbox per oddelenie).]
24. **Pri prázdnom mesiaci oddelenia sa Team score počíta z dostupných (AVERAGE ignoruje prázdne). Zachovať?**
    [Odporúčanie: áno + vizuálne označiť „počítané z X/6 oddelení".]
25. **Min/Max pásma sa menia v čase (Fotografka plán 200→250→400; Newsletter plán štvrťročne spätne). Má appka pásma/plány verzovať per mesiac?**
    [Odporúčanie: áno — cieľ/pásmo je hodnota per KPI per mesiac, s možnosťou „vyplň dopredu".]
26. **Kto smie meniť pásma Min/Max a plány — len Admin?** [Odporúčanie: len Admin; zmeny sa logujú.]
27. **Copywriter váhy 60/20/20 (Top100/hustota/CTR) s prepočtom váh pri chýbajúcom KPI. Zachovať presne takto?**
    [Odporúčanie: áno, vrátane prepočtu váh na dostupné.]
28. **Copywriter Top 100: podiel = KW v top 100 ÷ 1500, pásmo 50–60 %. Číslo 1500 je fixné, alebo konfigurovateľné?**
    [Odporúčanie: konfigurovateľný parameter s default 1500.]
29. **Newsletter odmena 385 €/mes je v exceli konštanta. Má appka počítať aj odmeny (plnenie × odmena), alebo odmeny nechať mimo?**
    [Odporúčanie: evidovať odmenu ako info pole per oddelenie/mesiac, bez mzdovej logiky.]
30. **Import: plnenie = |COGS − vyplatené| ≤ 5 % z vlaňajšieho COGS → 100 %, inak 0 %. Tvrdé 0/100, alebo radšej odstupňovať?**
    [Odporúčanie: nechať 0/100 podľa metodiky; 5 % ako konfigurovateľný parameter.]
31. **Predikcia COGS (cieľ) sa „dopĺňa mesačne" — dopĺňa ju Import manuálne, alebo sa má počítať?**
    [Odporúčanie: manuálne pole s históriou zmien.]
32. **MoM % a vs cieľ % — počítať všade automaticky ako v exceli?** [Odporúčanie: áno, vždy odvodené, nikdy needitovateľné.]
33. **YTD, najlepší/najhorší mesiac (hárok Analýza) — prebrať celý analytický hárok do appky?**
    [Odporúčanie: áno ako sekciu „Analýza" s automatikou.]
34. **Ročné zhrnutie: okrem YTD súčtov chceš aj ročné plnenie per oddelenie (priemer mesiacov) a ročný Team score?**
    [Odporúčanie: áno — ročný pohľad je druhá hlavná os (mesiac po mesiaci + rok).]
35. **Zaokrúhľovanie a formáty: % na 1 desatinné, € na 2, ks celé — jednotne v celej appke?**
    [Odporúčanie: áno.]

## D. Oddelenia — špecifiká a prázdne sekcie (36–60)

**Performance (36–39)**
36. **Marža % a ROAS majú Min/Max zadávané per mesiac ručne (apríl 0.6/0.65; máj ROAS 4.62/5). Kto ich určuje a kedy?**
    [Odporúčanie: Admin pri otvorení mesiaca; predvyplniť z minulého mesiaca.]
37. **Tržba: treba doplniť „minulý rok €" pre všetky mesiace 2025 (teraz len apríl+máj). Dodáš čísla, alebo ich importujeme z e-shopu/GA?**
    [Odporúčanie: jednorazovo dodať tabuľku 12 čísel pri seede; API napojenie na e-shop až v P2.]
38. **ROAS „očistený" — očistený o čo (brand kampane? DPH?)? Do appky dám tooltip s definíciou.**
    [Odporúčanie: napíš definíciu 1 vetou, uložím k metrike.]
39. **Performance vypĺňa kto — Samuel (Ads)?** [Odporúčanie: potvrď zodpovednú osobu pre notifikácie.]

**AppAI + Projekty (40–42)**
40. **KPI - AppAI (kvartál × appka × page × done) je takmer prázdne — jediný riadok „Q2 Aura / všetky relevantné nástroje / Nie". Čo presne má tento hárok merať?**
    [Odporúčanie: zoznam AI/app úloh per kvartál so stavom Áno/Nie; % hotových. Potrebujem 2–3 vety, čo je „úloha".]
41. **Projekty Newsletter-AI a Projekty Copywriter (kvartál × projekt × uzavretý × očakávaná zmena) — má každé oddelenie dostať vlastnú záložku „Projekty", alebo je to len pre tieto dve?**
    [Odporúčanie: univerzálny modul Projekty dostupný pre každé oddelenie, zapnutý zatiaľ pre tieto dve + AppAI.]
42. **Vplýva % uzavretých projektov na plnenie oddelenia/Team score, alebo je čisto informatívne?**
    [Odporúčanie: informatívne (v exceli nemá váhu).]

**Hospodársky (43–44)**
43. **Vypĺňa sa marža objednávok a náklad spoločnosti — odkiaľ berieš náklad (účtovníctvo mesačne s oneskorením)? Má appka podporovať „predbežné" vs „finálne" číslo?**
    [Odporúčanie: áno — príznak predbežné/finálne, predbežné sa počíta ale je vizuálne odlíšené.]
44. **Vypĺňať bude kto — ty?** [Odporúčanie: potvrď.]

**Nahrávanie + Fotografka (45–49)**
45. **Nahrávanie: stĺpce Novinky/Dofocovanie/Plán/Otvorené/Uverejnené sú celé prázdne (len plán máj–jún 200). Odkiaľ sa tie čísla majú brať — kto ich počíta?**
    [Odporúčanie: mesačný formulár pre Sam/nahrávanie; definuj mi 1 vetou rozdiel Otvorené vs Novinky.]
46. **Fotografka ťahá Novinky/Dofocovanie z Nahrávania — v appke prepojiť automaticky rovnako?** [Odporúčanie: áno.]
47. **Fotografka: vyplnený len január (160/500/plán 200). „Otvorené 500" je backlog alebo nové v mesiaci? Legenda hovorí „nové prijaté za mesiac (nie backlog)" — sedí to?**
    [Odporúčanie: potvrď definíciu; ak 500 bol backlog, január pri importe opravíme.]
48. **Fotografka „Počet fotiek" + *Z toho fotky/retušované/modelky — stĺpce existujú ale nič sa tam nepíše. Dotiahnuť (povinné polia), alebo zrušiť?**
    [Odporúčanie: nechať ako nepovinný detail, plnenie z nich nepočítať.]
49. **Nadväzuje na nápad z porady 20.7. „appka pre Sam na evidenciu fotiek pri nahrávaní" — má KPI appka tento denník rovno obsiahnuť, alebo ostane samostatná appka?**
    [Odporúčanie: samostatná; KPI appka berie len mesačné súčty.]

**Newsletter-AI (50–51)**
50. **Vyplnené 1–6/2026 vrátane kontroly „Nesedí" každý mesiac (odchýlka M+N vs kupóny 10–28 %). Tá kontrola reálne funguje / chceš ju v appke ako upozornenie?**
    [Odporúčanie: áno — badge OK/Pozor/Nesedí + vysvetlenie.]
51. **Jún má prázdnu atribuovanú a Mailchimp tržbu (odchýlka −100 %). Sú tie dáta ešte dostupné na doplnenie?**
    [Odporúčanie: doplniť pri seede, ak ich vieš dohľadať.]

**Copywriter (52–54)**
52. **Vyplnená je len hustota KW 1–3 (jan–jún). Top 100 podiel, CTR/Impresie/Kliky a KW 4–10 sú prázdne — pritom majú 60 % + 20 % váhy. Dáta existujú (v SEO zošite je 375 top3 / 503 4–10, CTR 1,70 %) — kto ich má mesačne prepisovať?**
    [Odporúčanie: Gabika mesačne po SEO porade; appka jej dá formulár presne s týmito poľami.]
53. **Nemá sa Copywriter KPI plniť automaticky z tvojej SEO appky (karma-crucial ngrok — snapshoty, top100, CTR)? Linky na ňu sú v každom riadku SEO zošita.**
    [Odporúčanie: P2 — API import zo SEO appky; P1 ručný formulár.]
54. **Blogy: rozpracované/vytvorené/plánované — vyplnené 1–6. Kto vypĺňa a je OK, že je to bez váhy?**
    [Odporúčanie: áno, informatívne; vypĺňa copywriterka.]

**Externistky (55–56)**
55. **Detail úloh (mesiac × externistka × plán × splnené) je úplne prázdny, aj SLA časy. Koľko externistiek a ako sa volajú (číselník)? Odkiaľ sa vezmú response/resolution časy — z mailu/helpdesku?**
    [Odporúčanie: číselník externistiek v nastaveniach; časy ručne mesačne; ak je helpdesk, napíš aký.]
56. **SLA plnenie = priemer troch pomerov cieľ/skutočnosť capnutých na 1 — kde je „menej je lepšie". Zachovať túto formulu?**
    [Odporúčanie: áno.]

**Import (57)**
57. **Celý hárok prázdny (COGS, vyplatené, KO/FA, tovar na ceste/colnici/sklade). Kto ho bude vypĺňať (nákup/Import — Lucia?) a máš čísla spätne od januára?**
    [Odporúčanie: doplniť spätne aspoň od začiatku roka pri seede; potvrď osobu.]

**Sklad (58)**
58. **Denník pohybov (mesiac/kov/druh/pohyb/ks/€) prázdny. Druh je voľný text alebo číselník (retiazka, prsteň…)? Má sklad zapisovať priebežne (denne), alebo raz mesačne súhrn?**
    [Odporúčanie: číselník druhov + priebežný zápis; mesačná tabuľka sa agreguje automaticky.]

**Expedícia + Reklamácie (59–60)**
59. **Obe úplne prázdne. Lucia tieto čísla reportuje na poradách — máš ich spätne 1–6/2026 na import?**
    [Odporúčanie: áno, dodať pri seede.]
60. **Nekoliduje to s Aura Logistika appkou (týždenné zásielky/reklamácie per krajina/prepravca)? Nemá KPI appka ťahať mesačné súčty z Logistiky automaticky?**
    [Odporúčanie: P2 API prepojenie na Logistiku; P1 ručne — ale potvrď, či Logistika reálne beží a má dáta.]

## E. Dashboard, analýza a vizualizácie (61–72)

61. **Úvodná obrazovka = Dashboard ako v masteri: KPI karty plnení (8 kariet) + tabuľka Oblasť/Ukazovateľ/Hodnota/Plnenie + trend?**
    [Odporúčanie: áno + Team score hero číslo hore.]
62. **Grafy: line chart trendu per KPI (12 mesiacov), bar plnení per oddelenie, donut Team score — stačí tento set (inline SVG ako v Logistike)?**
    [Odporúčanie: áno, vlastné SVG grafy bez knižníc, hover tooltips.]
63. **Heatmapa oddelenie × mesiac (plnenie farbou) — chceš ju ako ročný prehľad?** [Odporúčanie: áno, je to najrýchlejší ročný pohľad.]
64. **Farebné stavy plnenia: zelená ≥ 100 %, žltá 60–99 %, červená < 60 %, sivá = nevyplnené. Sedia prahy?**
    [Odporúčanie: áno, prahy konfigurovateľné.]
65. **Trend šípky MoM (↑↓) pri každej hodnote ako v Analýze?** [Odporúčanie: áno.]
66. **Porovnanie mesiacov: vybrať 2 ľubovoľné mesiace vedľa seba (ako A/B v SEO appke)?** [Odporúčanie: áno, jednoduchý A/B prepínač.]
67. **Ročný pohľad: YTD súčty, najlepší/najhorší mesiac, ročné plnenie — samostatná obrazovka „Rok"?** [Odporúčanie: áno.]
68. **Chýbajúce dáta na dashboarde: má svietiť zoznam „čo treba dotiahnuť" (oddelenie × mesiac × pole) — presne tie prázdne sekcie, čo ťa trápia?**
    [Odporúčanie: áno — modul „Na doplnenie" s počítadlom per oddelenie, aj ako badge v menu.]
69. **Tlač/PDF mesačného reportu pre poradu (1 strana per oddelenie + súhrn)?** [Odporúčanie: áno, print CSS ako v Logistike.]
70. **Dark mode?** [Odporúčanie: áno, light default — Aura štandard.]
71. **Mobil: vedúci vypĺňajú z telefónu?** [Odporúčanie: responsive, formuláre použiteľné na mobile.]
72. **Živé prepočty: po uložení čísla sa okamžite prepočíta plnenie, Team score aj dashboard (bez reloadu)?** [Odporúčanie: áno.]

## F. Workflow vypĺňania a notifikácie (73–82)

73. **Mesačná uzávierka: mesiac je „otvorený" → oddelenia vypĺňajú → ty ho „uzavrieš" (zamkne sa). Chceš tento cyklus?**
    [Odporúčanie: áno; po uzávierke edituje len Admin.]
74. **Deadline vypĺňania: do ktorého dňa nasledujúceho mesiaca (napr. do 10.)?** [Odporúčanie: 10. deň, konfigurovateľné.]
75. **Pripomienky: e-mail/notifikácia oddeleniam, ktoré nemajú vyplnené X dní pred deadline?**
    [Odporúčanie: P1 badge v appke; e-maily P2 (potrebovali by SMTP).]
76. **Vypĺňací formulár: oddelenie vidí len svoje polia na aktuálny mesiac s minulým mesiacom pre kontext?**
    [Odporúčanie: áno — jednoobrazovkový formulár „Vyplň jún" per oddelenie.]
77. **Komentár k mesiacu: možnosť pripísať 1–2 vety vysvetlenia k číslam (prečo pokles)?**
    [Odporúčanie: áno, voliteľný komentár per oddelenie × mesiac, zobrazí sa na dashboarde pri hoveri.]
78. **Stavy hodnôt: koncept (rozpísané) vs odoslané (platí do výpočtov)?**
    [Odporúčanie: zjednodušene — uložené = platí; „koncept" netreba.]
79. **Hromadné doplnenie histórie: wizard „doplň mesiace január–jún" pre oddelenia, čo začínajú od nuly (Expedícia, Reklamácie, Import, Sklad, Nahrávanie, Externistky)?**
    [Odporúčanie: áno — tabuľkový grid editor, celý polrok naraz.]
80. **Kvartálne položky (AppAI, Projekty): vypĺňajú sa priebežne alebo pri kvartálnej porade?**
    [Odporúčanie: priebežne, pripomienka na konci kvartálu.]
81. **Nové oddelenie/KPI v budúcnosti (PPC má vlastný súbor KPI-Performance — pribudne Social? Sklad monitor <200k€ z Asany?): má byť pridanie nového KPI možné z admin UI bez programátora?**
    [Odporúčanie: P1 KPI definované v kóde/konfigu (presne týchto 15 hárkov); P2 admin builder. Builder by výrazne zväčšil rozsah.]
82. **Máš v pláne KPI aj pre oddelenia, ktoré v ZIPe nie sú (IT — Delaja/Daniel/Kristián, Ema/dizajn, Ben/marketing)? IT_KPI porady existujú.**
    [Odporúčanie: pripraviť štruktúru tak, aby sa dali dopísať; obsahovo teraz len tých 11 z excelov. Ak IT chceš hneď, napíš metriky.]

## G. Roly, účty a bezpečnosť (83–88)

83. **Roly: Admin (ty) / Editor per oddelenie / Prehliadač (manažment view). Stačia tri?**
    [Odporúčanie: áno, Editor viazaný na oddelenie(-ia).]
84. **Účty: menné (gabika, delaja…) s vlastnými heslami, alebo zdieľané heslo per oddelenie?**
    [Odporúčanie: menné účty — kvôli audit logu „kto zapísal".]
85. **Osoby máp na oddelenia: 1 oddelenie = 1 zodpovedná osoba, alebo viacerí (Lucia má Expedíciu+Reklamácie+Import?)?**
    [Odporúčanie: M:N — jeden účet môže editovať viac oddelení; potvrď mapovanie osôb.]
86. **Prihlásenie ako ostatné Aura appky: session/JWT, bez registrácie, účty zakladá Admin?** [Odporúčanie: áno.]
87. **Citlivosť dát: EBITDA, marže a odmeny sú citlivé — má ich vidieť len Admin+Prehliadač (nie editori ostatných oddelení)?**
    [Odporúčanie: áno — Hospodársky + odmeny skryté pre bežných editorov; Team score % vidia všetci.]
88. **Zálohy: rovnaký backup skript ako Logistika (docker cp dump, testovaný restore)?** [Odporúčanie: áno + týždenný cron.]

## H. Stack, build a integrácie (89–100)

89. **Stack 1:1 aura-hr-mapa: Node 20 + Express 4 + MariaDB 11.4 + vanilla JS SPA + JWT, všetko v Dockeri?**
    [Odporúčanie: áno — konzistentné s Logistikou/Banner Studiom. (Alternatíva Laravel ako Zápis z porady — povedz, ak preferuješ.)]
90. **Umiestnenie: C:\Aura\aura-kpi, port 3030, kontajnery aura-kpi-app / aura-kpi-db (+ ngrok)?** [Odporúčanie: áno.]
91. **Vizuál: Aura dizajn systém (teal #03797e, zlatá koruna, paper pozadie, light+dark, .panel/.stat/.tbl komponenty zo styles.css Banner Studia)?**
    [Odporúčanie: áno, 1:1 tokeny z aura-app-design-tokens.]
92. **GitHub repo (súkromné) + commity po fázach?** [Odporúčanie: áno, ak je gh k dispozícii; inak lokálny git.]
93. **Číselníky v DB: oddelenia, KPI definície (typ výpočtu, jednotka, váhy), mesiace/roky, externistky, druhy tovaru — spravované cez admin sekciu?**
    [Odporúčanie: áno — „Nastavenia" obrazovka pre Admina.]
94. **Výpočty robiť na backende (jeden zdroj pravdy, ukladať aj vypočítané plnenia), frontend len zobrazuje?**
    [Odporúčanie: áno — server-side výpočet + prepočet pri každej zmene vstupu.]
95. **API: REST endpointy aj pre budúce integrácie (Logistika, SEO appka, e-shop) — pripraviť čisté /api/v1 od začiatku?**
    [Odporúčanie: áno.]
96. **Automatické integrácie v P1 žiadne (všetko ručne), v P2: Logistika (Expedícia/Reklamácie), SEO appka (Copywriter), e-shop API (tržby). Súhlasíš s takýmto fázovaním?**
    [Odporúčanie: áno — P1 nech stojí na ručnom vstupe, integrácie po overení metodiky.]
97. **Build proces: sprint agentov podľa kontraktu (ako Banner Studio — BUILD-SPEC, 5–7 agentov, integračná kontrola), s funkčným MVP na konci?**
    [Odporúčanie: áno — po odpovediach napíšem KONTRAKT + BUILD-SPEC a spustím sprint.]
98. **MVP scope P1: login+roly, číselníky, 11 oddelení + master dashboard + analýza + rok, seed import z xlsx, modul „Na doplnenie", export xlsx, audit, print. Bez e-mailov, bez integrácií, bez KPI buildera. Sedí?**
    [Odporúčanie: áno.]
99. **Deadline/priorita: kedy to chceš mať nasadené a je niečo, čo musí byť skôr (napr. dotiahnutie prázdnych sekcií za 1–6/2026 pred júlovou uzávierkou)?**
    [Odporúčanie: MVP + seed do pár dní, júl už vypĺňať v appke.]
100. **Je niečo, čo v exceloch NIE JE a v appke to chceš od začiatku (napr. polročné vyhodnotenie pre Samuela, väzba na porady/Asanu, ciele 2027)?**
    [Odporúčanie: napíš voľne — zapracujem do kontraktu.]

---

*Po odpovediach vznikne `KONTRAKT-rozhodnutia.md` + `BUILD-SPEC.md` a sprint agentov (vzor Banner Studio / Zápis z porady).*
