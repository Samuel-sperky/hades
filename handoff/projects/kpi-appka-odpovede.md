# Aura KPI appka — odpovede na 100 otázok

> Priebežne ukladané odpovede z dotazníka `kpi-appka-100-otazok.md`. Stav: **KOMPLET (1–100)**, 23.7.2026.

## A. Účel, používatelia a rozsah

1. **Primárny používateľ:** CEO + oddelenia — CEO dashboard, každé oddelenie vidí a vypĺňa svoju sekciu.
2. **Viditeľnosť:** bežný účet vidí len svoje oddelenie + celotímové skóre; Admin vidí všetko.
3. **Vzťah k Excelu:** appka = zdroj pravdy. Jednorazový import z xlsx, ďalej sa píše len do appky; export do xlsx ostáva.
4. **Spätné roky:** áno — ročníky ako entita, 2025 ako ručne zadané referenčné hodnoty (tržby, COGS).
5. **Granularita:** ako v exceli — mesiac základ, kvartál pre AppAI/Projekty, denníkový detail pre Sklad/Externistky pod mesiacom.
6. **Názov:** Aura KPI.
7. **Jazyk:** SK + EN (prepínač ako v Internej evidencii).
8.–9. **Nasadenie:** Docker v C:\Aura\aura-kpi (port ~3030), 1:1 vzor aura-hr-mapa/logistika + ngrok tunel pre tím s loginom.
10. **Zapisovanie:** kombinácia — niektoré oddelenia samy, citlivé (Hospodársky) len CEO. Presné mapovanie doriešiť pri ot. 85.

## B. Import existujúcich dát a vzťah k Excelom

11. **Seed import:** NIE — appka štartuje prázdna, história sa dopĺňa ručne (bez automatického importu z xlsx).
12. **Zdroj pravdy pri nesúladoch:** oddelený súbor = novší = pravda (Newsletter -1M, Hospodársky…); master len doplnok.
13. **Newsletter metodika:** finálna je „-1M" verzia — Pomer = Admin ÷ kupóny, DPH logika, tolerancie 5 %/10 %, stĺpec Upozornenie (OK/Pozor/Nesedí).
14. **Neúplné riadky:** plnenie sa počíta až keď sú vyplnené všetky vstupy riadku; dovtedy „rozpracované" (žiadne artefakty typu EBITDA 100 %).
15. **EBITDA pásmo 2026:** 1–5 % (podľa oddeleného súboru), NIE 15–25 % z Legendy.
16. **Manažment pohľad:** áno — read-only rola/odkaz s Dashboardom, Analýzou a Team score.
17.–18. **Scope: VŠETKO ZAHRNÚŤ** — KPI + SEO porada workflow (72 otázok Príprava/Porada/Záver) + prevádzková evidencia typu Šperky-Admin-Evidencia v jednej appke. ⚠️ Šperky-Admin-Evidencia.xlsx nebol v ZIPe — treba dodať súbor na analýzu.
19. **Export:** áno — xlsx export celého roka aj jedného oddelenia; + import CSV/xlsx pre hromadné doplnenie.
20. **Audit:** plný audit log každej zmeny (kto, kedy, stará→nová), ako v Logistike.

## C. KPI model a výpočty

21. **Definícia plnenia:** áno — 3 typy výpočtu: pásmo (Skutočnosť−Min)/(Max−Min) cap 100 %, pomer zavreté/otvorené (cap 100 %), tolerancia 0/100 % (Import). Prázdne → prázdne.
22. **Záporné plnenie:** ukladať a zobrazovať reálne (červenou); do Team score priemeru vstupuje floor 0 %.
23. **Team score:** 6 zložiek ako doteraz + zloženie konfigurovateľné checkboxom per oddelenie (Admin).
24. **Prázdne v Team score:** priemer z dostupných zložiek + indikátor „počítané z X/6 oddelení".
25. **Pásma/plány:** verzované per KPI per mesiac, s funkciou „vyplň dopredu".
26. **Práva na pásma:** mení len Admin; zmeny sa logujú.
27. **Copywriter váhy:** presne 60/20/20 (Top100/hustota/CTR) vrátane prepočtu váh na dostupné KPI.
28. **Copywriter Top 100:** ⚠️ zmena oproti excelu — používateľ: „Top 100 a malo by ich tam byť 100". Metrika sa viaže na FIXNÝ zoznam 100 KW (core monitoring zo SEO zošita), nie podiel z 1500. Presnú definíciu doladiť (viď doplňujúca otázka).
29. **Odmeny €:** vôbec neevidovať — odmeny ostávajú mimo appky (stĺpce Odmena sa neprenášajú).
30.–31. **Import KPI:** tvrdé 0/100 % pri tolerancii (5 % konfigurovateľné); predikcia COGS = manuálne pole s históriou zmien.
28b. **Top 100 definícia (doplnené):** plnenie = % z fixného zoznamu 100 KW, ktoré sú v **TOP 3**. Pásmo Min/Max nastavíme v kontrakte (Admin konfigurovateľné).
32.–33. **Analýza:** MoM %, vs cieľ %, YTD, najlepší/najhorší mesiac — všetko server-side, needitovateľné; Analýza ako samostatná sekcia.
34. **Ročný pohľad:** áno — samostatná obrazovka Rok (YTD súčty, ročné plnenie per oddelenie, ročný Team score).
35. **Formáty:** % na 1 desatinné, € na 2, ks celé — jednotne.

## D. Oddelenia — špecifiká

36. **Performance pásma:** Admin pri otvorení mesiaca, predvyplnené z minulého mesiaca.
37. **Tržby 2025:** dodá používateľ ručne (12 čísel), zadanie v nastaveniach roka; e-shop API až P2.
38. **ROAS „očistený" — definícia:** tržba s DPH očistená o 12 % storná a 2 % bonitný zákazník (t. j. −14 % z celkovej tržby s DPH) ÷ náklady na reklamu. Uložiť ako tooltip k metrike.
39. **Performance vypĺňa:** používateľ (COO) sám.
40. **AppAI:** meria stav nasadenia interných Aura appiek (HR, Logistika, KPI…) per kvartál — zoznam appiek + done stav → % hotových.
41. **Projekty:** univerzálny modul dostupný pre každé oddelenie; zapnutý zatiaľ pre Newsletter-AI, Copywriter + AppAI.
42. **Projekty váha:** čisto informatívne, bez vplyvu na plnenie/Team score.
43.–44. **Hospodársky:** príznak predbežné/finálne číslo (vizuálne odlíšené, predbežné sa počíta); vypĺňa COO/Admin.
45. **Nahrávanie vypĺňa:** Sam / tím nahrávania — mesačný formulár.
46. **Fotografka ↔ Nahrávanie:** NEPREPÁJAŤ — fotografka zadáva Novinky/Dofocovanie samostatne (zmena oproti excelu).
47. **Fotografka „Otvorené":** odpoveď „200" — počíta sa s úrovňou ~200 nových/mesiac (plán); 500 z januára bol backlog artefakt. Keďže seed import nie je, platí definícia Legendy: Otvorené = nové prijaté v mesiaci (nie backlog).
48. **Fotografka detail:** počet fotiek + „z toho…" stĺpce = nepovinný detail, plnenie sa z nich nepočíta.
49. **Evidencia fotiek pre Sam:** samostatná appka (mimo scope); KPI appka berie len mesačné súčty.
50. **Newsletter kontrola:** áno — badge OK/Pozor/Nesedí + vysvetlenie; tolerancie 5 %/10 % konfigurovateľné.
51. **Newsletter jún (atribuovaná/Mailchimp):** bezpredmetné — seed import nie je (ot. 11).
52. **Copywriter zadáva:** Gabika po SEO porade — formulár presne s týmito poľami.
53. **SEO API integrácia:** ⚠️ HNEĎ V P1 — Copywriter KPI sa ťahajú automaticky zo SEO appky (karma-crucial snapshoty/top100/CTR). Treba preveriť API SEO appky a formát snapshotov.
54. **Blogy:** informatívne bez váhy; vypĺňa copywriterka.
55. **Externistky:** číselník externistiek v nastaveniach; response/resolution časy ručne mesačne. (Počet/mená doplniť pri stavbe číselníka.)
56. **SLA vzorec:** priemer 3 pomerov cieľ/skutočnosť (menej je lepšie), cap 100 % — presne ako v exceli.
57. **Import vypĺňa:** COO (používateľ) sám.
58. **Sklad:** číselník druhov (retiazka, prsteň…) + priebežný zápis denníka; mesačná tabuľka sa agreguje automaticky.
59. **Expedícia/Reklamácie história:** NEDOPĹŇAŤ — štart od júla 2026 (aktuálny mesiac).
60. **Logistika integrácia:** ⚠️ HNEĎ V P1 — Expedícia/Reklamácie sa plnia automaticky mesačnými súčtami z Aura Logistika appky. Preveriť API/DB Logistiky.

## E. Dashboard, analýza a vizualizácie

61.–62. **Dashboard:** ako master — KPI karty plnení, tabuľka Oblasť/Ukazovateľ/Hodnota/Plnenie, Team score hero, trend; vlastné inline SVG grafy (line/bar/donut) bez knižníc, hover tooltips.
63. **Heatmapa:** áno — oddelenie × mesiac, plnenie farbou, ročný prehľad.
64. **Farebné prahy:** zelená ≥ 100 %, žltá 60–99 %, červená < 60 %, sivá nevyplnené; konfigurovateľné.
65.–66. **Trendy + A/B:** šípky ↑↓ MoM všade + A/B porovnanie 2 ľubovoľných mesiacov.
67.–68. **Rok + Na doplnenie:** obrazovka Rok + modul „Na doplnenie" (oddelenie × mesiac × pole) s počítadlom a badge v menu.
69. **Tlač/PDF:** NIE — stačí obrazovka (xlsx export ostáva z ot. 19).
70.–71. **Dark mode + mobil:** áno oboje — light default, dark mode; formuláre použiteľné na mobile.
72. **Živé prepočty:** áno — po uložení sa okamžite prepočíta plnenie, Team score aj dashboard bez reloadu.

## F. Workflow vypĺňania a notifikácie

73.–74. **Uzávierka:** mesiac otvorený → vypĺňanie → uzavretý (zamknutý, edituje len Admin); deadline do 10. dňa nasledujúceho mesiaca, konfigurovateľné.
75. **Pripomienky:** ⚠️ E-MAILY HNEĎ V P1 — automatické e-maily oddeleniam X dní pred deadline (treba SMTP; doriešiť ktorý účet — asi Google Workspace).
76.–77. **Formulár:** jednoobrazovkový „Vyplň mesiac" per oddelenie s minulým mesiacom pre kontext + voliteľný komentár per oddelenie × mesiac (zobrazí sa na dashboarde).
78. **Koncepty:** nie — uložené = platí.
79.–80. **Grid editor + kvartál:** tabuľkový editor pre viac mesiacov naraz; kvartálne položky priebežne + pripomienka na konci kvartálu.
81. **KPI builder:** P1 = 15 hárkov definovaných v konfigu; P2 = admin UI builder.
82. **Ďalšie oddelenia (IT, dizajn, marketing):** štruktúra pripravená na rozšírenie; obsahovo teraz len 11 oddelení z excelov.

## G. Roly, účty a bezpečnosť

83.–84. **Roly + účty:** Admin / Editor / Prehliadač; menné účty (gabika, delaja…) s vlastnými heslami kvôli audit logu.
85. **M:N práva:** áno — jeden účet môže editovať viac oddelení (Lucia: Expedícia+Reklamácie…).
86. **Login:** JWT/session ako HR mapa/Logistika; účty zakladá Admin, bez registrácie.
87. **Citlivosť:** Hospodársky (EBITDA, marže) vidí len Admin + Prehliadač/manažment; Team score % vidia všetci.
88. **Zálohy:** backup skript ako Logistika (docker cp dump, testovaný restore) + týždenný cron.

## H. Stack, build a integrácie

89.–90. **Stack:** Node 20 + Express 4 + MariaDB 11.4 + vanilla JS SPA + JWT, Docker; C:\Aura\aura-kpi, port 3030, kontajnery aura-kpi-app/-db + ngrok.
91.–92. **Vizuál + Git:** Aura dizajn tokeny (teal #03797e + zlatá, styles.css vzor Banner Studio); súkromné GitHub repo, commity po fázach (fallback lokálny git).
93.–95. **Backend:** číselníky v admin sekcii (oddelenia, KPI, externistky, druhy tovaru); výpočty výhradne server-side (ukladajú sa aj vypočítané plnenia); čisté REST /api/v1.
96. **Integrácie:** P1 = SEO appka (Copywriter) + Logistika (Expedícia/Reklamácie) + SMTP e-maily; P2 = e-shop API (tržby), KPI builder.
97.–98. **Build:** sprint agentov (KONTRAKT-rozhodnutia + BUILD-SPEC, 5–7 agentov, integračná kontrola). MVP scope: login+roly (M:N), číselníky, 11 oddelení, dashboard+analýza+rok+heatmapa+A/B, modul Na doplnenie, xlsx export+import, plný audit, uzávierky, komentáre, SEO+Logistika integrácie, e-mail pripomienky, SEO porada modul, Admin-Evidencia modul (po dodaní súboru), SK+EN, dark mode, mobil.
99. **Deadline:** MVP do pár dní — júl 2026 sa už vypĺňa v appke (deadline vyplnenia júla = 10. august).
100. **Navyše (nie je v exceloch):** a) polročné/ročné vyhodnotenie tímu (report ako Samuel ½-rok), b) väzba na porady/Asanu.

---

## Otvorené body pred KONTRAKTOM

1. **Šperky-Admin-Evidencia.xlsx** — dodať súbor (nebol v ZIPe); modul sa špecifikuje po analýze.
2. **SEO appka API** — preveriť endpointy/formát snapshotov karma-crucial pre P1 integráciu Copywriter KPI (Top 3 zo 100 fixných KW, CTR, kliky, impresie, KW 4–10).
3. **Logistika API/DB** — preveriť, ako ťahať mesačné súčty (Expedícia: prijaté/spracované; Reklamácie: otvorené/zavreté).
4. **SMTP** — ktorý účet na odosielanie pripomienok (Google Workspace?).
5. **Číselník osôb a oddelení** — mená účtov + mapovanie M:N (kto edituje čo), vrátane externistiek.
6. **Top 3 pásmo** — Min/Max pre nové Copywriter KPI „% zo 100 KW v TOP 3" (návrh dám v kontrakte).
7. **Väzba na porady/Asanu (ot. 100)** — upresniť rozsah: prepojenie KPI mesiaca na zápis z porady / Asana úlohy.
