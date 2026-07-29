# Aura KPI — KONTRAKT rozhodnutí

> Záväzný zoznam rozhodnutí pre stavbu appky **Aura KPI**. Vychádza zo 14 xlsx KPI súborov
> a zo 100-otázkového dotazníka (`AI-mind/handoff/projects/kpi-appka-odpovede.md`, 23.7.2026).
> Toto je zdroj pravdy pre `BUILD-SPEC.md` a sprint agentov.

---

## 0. Rozhodnuté (23.7.2026) + zvyšné otvorené

| # | Bod | ROZHODNUTIE | Pozn. |
|---|-----|-------------|-------|
| P0-1 | **Šperky-Admin-Evidencia** | ❌ **VYNECHANÉ** — modul sa nestavia | Možno neskôr po dodaní súboru |
| P0-2 | **Expedícia mapovanie** | ✅ `prijaté = SUM(sent)`, `spracované = SUM(delivered)` za mesiac | z Logistiky auto |
| P0-3 | **Copywriter TOP 3 zdroj** | ✅ **Ahrefs live snapshot** (posledný v mesiaci) → ~29/100 | metodika pozícií SEO appky |
| P0-4 | **SMTP / e-maily** | ❌ **VYNECHANÉ** — len in-app badge | SMTP možno P2 |
| P0-5 | **Väzba na porady/Asanu** | P1 len pole „prebrané na porade dňa"; hlbšie P2 | rozsah otvorený |
| P0-6 | **Copywriter pásma** | Top100 TOP3: Min 20 % / Max 40 %; hustota 1–3: 150–250; 4–10: 300–500; CTR: 1–2 % | Admin vie zmeniť per mesiac |
| P0-7 | **Hospodársky EBITDA pásmo** | Min 1 % / Max 5 % (ot. 15) | Admin vie zmeniť per mesiac |

---

## 1. Účel, používatelia, rozsah

- **Účel:** mesačné a ročné sledovanie KPI tímu Šperky Aura; CEO/COO dashboard + samoobslužné vypĺňanie oddeleniami.
- **Používatelia:** COO (Admin, plný prístup) + vedúci oddelení (Editor, len svoje) + manažment (Prehliadač, read-only).
- **Viditeľnosť:** Editor vidí len svoje oddelenie(-ia) + celotímové Team score %. Admin a Prehliadač vidia všetko. **Hospodársky (EBITDA, marže) vidí LEN Admin + Prehliadač.**
- **Zdroj pravdy:** appka (nie Excel). **Bez seed importu histórie** — štart prázdny, júl 2026 sa už vypĺňa v appke. Export do xlsx ostáva.
- **Roky:** entita „rok"; 2025 ako ručne zadané referenčné hodnoty (tržby, COGS minulý rok) pre medziročné metriky.
- **Granularita:** mesiac = základ; kvartál pre AppAI/Projekty; denníkový detail pre Sklad a Externistky (agreguje sa do mesiaca).
- **Jazyk:** SK + EN (prepínač). **Dark mode** (light default). **Responsive/mobil** (vypĺňanie z telefónu). **Bez tlače/PDF** (len xlsx export).

## 2. Oddelenia a moduly (13 KPI oblastí + rozšírenia)

| # | Oddelenie | Kto vypĺňa | Zdroj dát | Vplyv na Team score |
|---|-----------|-----------|-----------|---------------------|
| 1 | Performance (marža, ROAS, tržba) | COO | ručne | ÁNO |
| 2 | AppAI (stav Aura appiek, kvartál) | COO | ručne | nie (info) |
| 3 | Hospodársky (EBITDA) | COO | ručne (predbežné/finálne) | ÁNO (EBITDA zložka) |
| 4 | Team score | — | dopočítané | — |
| 5 | Nahrávanie | Sam / tím nahrávania | ručne | ÁNO |
| 6 | Fotografka | fotografka (samostatne, NEprepája s Nahrávaním) | ručne | ÁNO |
| 7 | Newsletter-AI (-1M metodika) | Newsletter (assignee config) | ručne | ÁNO |
| 8 | Copywriter (60/20/20) | Gabika | **SEO appka API (P1 auto)** | ÁNO |
| 9 | Externistky (úlohy + SLA) | Admin/COO | ručne (číselník externistiek) | nie (default; konfig.) |
| 10 | Import (COGS, KO/FA, tovar) | COO | ručne | nie |
| 11 | Sklad (denník pohybov) | sklad | ručne priebežne (číselník druhov) | nie |
| 12 | Expedícia | — | **Logistika API (P1 auto), štart júl** | nie |
| 13 | Reklamácie | — | **Logistika API (P1 auto), štart júl** | nie |

**Rozšírenia (v scope, P1):**
- **SEO porada modul** — 72-otázkový workflow (Príprava / TOP 100 KW / Porada / Záver a akcie) podľa `SEO-porada-otazky.xlsx`.
- **Šperky-Admin-Evidencia modul** — prevádzková evidencia (objednávky, faktúry, platby, tovar, fotoprotokol) — čaká na dodanie súboru (P0-1).
- **Polročné/ročné vyhodnotenie** tímu (report ako Samuel ½-rok).
- **Väzba na porady/Asanu** — rozsah P0-5.

## 3. KPI metodika (jednotné pravidlá)

- **Plnenie — 3 typy výpočtu:**
  1. **Pásmo:** `plnenie = min((skutočnosť − Min) / (Max − Min), 1)`. Môže byť záporné (zobrazí sa reálne, červenou).
  2. **Zavreté/otvorené:** `plnenie = min(zavreté / otvorené, 1)` (Fotografka, Nahrávanie, Expedícia, Reklamácie).
  3. **Tolerancia (0/100):** ak `|rozdiel| ≤ tolerancia` → 1, inak 0 (Import).
- **Prázdny vstup → prázdne plnenie** (nekazí priemery). Plnenie sa počíta **až keď sú vyplnené všetky vstupy riadku** (žiadne artefakty).
- **Pásma a plány** sú verzované **per KPI per mesiac** („vyplň dopredu"); mení len **Admin** (logované).
- **Team score** = priemer plnení 6 zložiek (Performance, Newsletter-AI, Copywriter, Fotografka, Nahrávanie, EBITDA), zloženie **konfigurovateľné** (Admin). Do priemeru vstupuje **floor 0 %**. Prázdne zložky sa vynechajú + indikátor „počítané z X/6".
- **Odvodené metriky** (MoM %, vs cieľ %, YTD, najlepší/najhorší mesiac, medziročný rast) — vždy **server-side, needitovateľné**.
- **Odmeny € sa NEEVIDUJÚ** (stĺpce Odmena sa neprenášajú).
- **Formáty:** % na 1 desatinné (uložené ako zlomok), € na 2, ks celé.

### Kľúčové vzorce per oddelenie (z excelov)
- **Performance / Marža:** pásmo, Min/Max per mesiac (Admin).
- **Performance / ROAS (očistený):** ROAS = (tržba s DPH − 12 % storná − 2 % bonitný zákazník) ÷ náklad na reklamu = **tržba s DPH × 0,86 ÷ ad cost**. Pásmo Min/Max per mesiac. (tooltip pri metrike)
- **Performance / Tržba:** medziročný rast = tento rok ÷ minulý rok − 1; pásmo **Min 10 % / Max 25 %**.
- **Hospodársky:** EBITDA € = marža objednávok − náklad; EBITDA marža % = EBITDA / marža objednávok; pásmo **1–5 %** (P0-7), predbežné/finálne príznak.
- **Newsletter-AI (-1M):** Pomer = tržba kupóny (bez DPH) ÷ Admin (bez DPH); Plnenie = `min(0,6 × (Pomer ÷ Plán) + 0,4 × (marža % v pásme 45–55 → 1/0), 1)`; kontrola odchýlky badge OK (≤5 %) / Pozor (≤10 %) / Nesedí (odchýlka = (atribuovaná+mailchimp) ÷ kupóny − 1). DPH časť = kupóny s DPH × 0,2.
- **Copywriter (60/20/20):** `celkom = 0,6 × Top100 + 0,2 × hustota + 0,2 × CTR`, pri chýbajúcom KPI sa **váhy prepočítajú na dostupné**.
  - Top100 (60 %): **% z fixných 100 KW v TOP 3** (P0-3), pásmo P0-6.
  - Hustota (20 %): priemer plnení pásiem KW 1–3 (150–250) a KW 4–10 (300–500).
  - CTR (20 %): pásmo 1–2 %.
  - Blogy: informatívne, bez váhy.
- **Externistky:** úlohy plnenie = splnené ÷ plán (cap); SLA plnenie = priemer 3 pomerov cieľ ÷ skutočnosť (cap 100 %, menej je lepšie). Detail (mesiac × externistka) sa agreguje SUMIFS-štýlom.
- **Import:** plnenie = tolerancia (|COGS − vyplatené| ≤ 5 % z vlaňajšieho COGS → 100/0); 5 % konfigurovateľné; predikcia COGS = manuálne pole s históriou.
- **Sklad:** denník (mesiac/kov/druh/pohyb/ks/€) → mesačná agregácia (zlato/striebro × vyzbierané/priskladnené × ks/€).
- **Expedícia/Reklamácie:** zavreté/otvorené, saldo (viď P0-2 mapovanie).

## 4. Workflow

- **Mesačná uzávierka:** mesiac *otvorený* → oddelenia vypĺňajú → Admin *uzavrie* (zamkne; potom edituje len Admin, logované).
- **Deadline:** do **10. dňa** nasledujúceho mesiaca (konfigurovateľné). E-mail pripomienky pred deadline (P0-4) + in-app badge.
- **Formulár „Vyplň mesiac"** per oddelenie: len vlastné polia + minulý mesiac pre kontext + voliteľný komentár (zobrazí sa na dashboarde).
- **Bez konceptov** — uložené = platí.
- **Grid editor** na hromadné doplnenie viac mesiacov naraz.
- **Kvartálne položky** (AppAI, Projekty) — priebežne + pripomienka na konci kvartálu.
- **Plný audit log** každej zmeny (kto, kedy, stará→nová).

## 5. Dashboard a vizualizácie

- **Dashboard:** Team score hero + KPI karty plnení + tabuľka Oblasť/Ukazovateľ/Hodnota/Plnenie/Trend.
- **Grafy** (vlastné inline SVG, bez knižníc, hover tooltips): line trend (12 mes.), bar plnení per oddelenie, donut Team score.
- **Heatmapa** oddelenie × mesiac (plnenie farbou) — ročný prehľad.
- **Farebné prahy:** zelená ≥ 100 %, žltá 60–99 %, červená < 60 %, sivá = nevyplnené (konfigurovateľné).
- **Trend šípky** MoM ↑↓; **A/B porovnanie** 2 ľubovoľných mesiacov.
- **Obrazovky:** Dashboard, Oddelenia (detail + Vyplň mesiac), Analýza, Rok, Na doplnenie, SEO porada, Admin-Evidencia, Nastavenia.
- **Modul „Na doplnenie":** zoznam oddelenie × mesiac × chýbajúce pole + počítadlo + badge v menu.

## 6. Roly, účty, bezpečnosť

- Roly **Admin / Editor / Prehliadač**; menné účty (gabika, delaja…) s vlastnými heslami (audit). Účty zakladá Admin, bez registrácie.
- **M:N** — jeden účet edituje viac oddelení (Lucia: Expedícia+Reklamácie…).
- Login JWT/session (cookie) ako HR mapa/Logistika.
- Hospodársky + citlivé len Admin + Prehliadač.
- Zálohy: backup skript (docker cp dump, testovaný restore) + týždenný cron.

## 7. Stack a nasadenie

- **Node 20 + Express 4 + MariaDB 11.4 + vanilla JS SPA + JWT**, Docker. Vzor 1:1 = `aura-logistika`.
- Umiestnenie `C:\Aura\aura-kpi`, **port 3030**, kontajnery `aura-kpi-app` / `aura-kpi-db` + voliteľný `ngrok` (profil tunnel).
- **Vizuál:** Aura dizajn systém (teal #03797e + zlatá koruna, `styles.css` z HR mapy/Logistiky, light+dark, `.panel/.stat/.tbl/.badge` komponenty).
- **Výpočty výhradne server-side** (ukladajú sa aj vypočítané plnenia); frontend len zobrazuje. Čisté REST `/api/v1`.
- **Číselníky v admin sekcii:** oddelenia, KPI definície (typ výpočtu, jednotka, váhy, pásma), mesiace/roky, osoby/účty, externistky, druhy tovaru, kovy.
- **Integrácie P1:** SEO appka (Copywriter, DB `aura_marketing` cez sieť `sperky-ai_aura_net`), Logistika (Expedícia/Reklamácie, DB `aura_logistika` cez sieť `aura-logistika`), SMTP. **P2:** e-shop tržby, KPI builder v UI.
- **GitHub:** súkromné repo, commity po fázach (fallback lokálny git).
- **KPI builder v UI = až P2** — v P1 je 13 oddelení + KPI definované v konfigu/kóde.

## 8. Integračné adaptéry (read-only)

- **Logistika** (`aura-kpi` sa pripojí na external sieť `aura-logistika`, host `mariadb:3306`, DB `aura_logistika`, ideálne read-only user):
  - Zásielky mesačne: `SELECT DATE_FORMAT(week_start,'%Y-%m') m, SUM(sent), SUM(delivered), SUM(returned), SUM(lost) FROM shipments GROUP BY m` (týždeň patrí do mesiaca svojho pondelka — zhodné s dashboardom Logistiky).
  - Reklamácie mesačne: otvorené = `COUNT` podľa `DATE_FORMAT(opened_on,'%Y-%m')`; zavreté = `COUNT WHERE resolved_on IS NOT NULL` podľa `DATE_FORMAT(resolved_on,'%Y-%m')`.
  - Mapovanie na KPI podľa P0-2.
- **SEO appka** (external sieť `sperky-ai_aura_net`, host `sperky-ai-db-1:3306`, DB `aura_marketing`, read-only user):
  - Fixný zoznam 100 KW: `seo_top_kw WHERE active=1`.
  - Top100 v TOP 3 (Ahrefs live): posledný own-ahrefs snapshot v mesiaci → počet KW z `seo_top_kw` s `position ≤ 3`.
  - Hustota 1–3 / 4–10: z posledného snapshotu mesiaca (`seo_keywords`).
  - CTR/kliky/impresie: z posledného **GSC** snapshotu mesiaca (`seo_keywords` source=gsc), príp. `seo_top_kw_monthly`.
  - Adaptér má **fallback na ručné zadanie**, ak DB/sieť nedostupná.
- Automaticky ťahané hodnoty sú v UI **odlíšené** (badge „auto z Logistiky/SEO") a Admin ich vie prepísať (override, logované).

## 9. Build

- Sprint agentov podľa `BUILD-SPEC.md` (5–7 agentov + integračná kontrola), funkčné MVP na konci.
- **Deadline:** MVP do pár dní; júl 2026 sa vypĺňa v appke (deadline vyplnenia júla = 10. august).

---
*23.7.2026 — vychádza z kpi-appka-odpovede.md (100/100). Ďalší krok: BUILD-SPEC.md + sprint.*
