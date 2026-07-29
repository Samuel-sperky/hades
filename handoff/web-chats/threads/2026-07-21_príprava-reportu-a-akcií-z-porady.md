# Príprava reportu a akcií z porady

- **UUID:** 45f56502-2be4-423e-a7b7-2de9d469443e
- **Vytvorené:** 2026-07-21T07:46
- **Aktualizované:** 2026-07-21T08:00
- **Správ:** 6

---

### 🧑 Používateľ
*(prílohy: 1784619946363_image.png, Sperky-eshop-Reklamy-21.-6.-2026-20.-7.-2026.csv)*

do dnešnej porady ads cez  kalendar vypíš  report a akčne kroky  dopytuj otazkami

### 🤖 Claude
[tool_use: view]

[tool_result]

### 🧑 Používateľ
*(prílohy: google-roas-board-2026-07-21.csv)*

použi iba tento csv

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

# Report — porada Ads 10:15 (dáta 21.6.–20.7.2026)

**Celok:** spend 23 495 €, hodnota konverzií 95 397 €, blended ROAS **4,06**, 2 093 nákupov, 63 aktívnych kampaní (+92 s nulovým spendom).

## Rozdelenie podľa pásiem

| Pásmo | Spend | Podiel | ROAS | Nákupy | Board |
|---|---|---|---|---|---|
| 0–3,5× | 6 465 € | 27,5 % | 2,22 | 415 | PAUSE / −50 % |
| 3,5–5× | 11 315 € | 48,2 % | 3,98 | 1 130 | OPTIMALIZOVAŤ / −10 % |
| 5–6× | 4 248 € | 18,1 % | 5,54 | 370 | DRŽAŤ / +5 % |
| 6–6,6× | 780 € | 3,3 % | 6,37 | 55 | NAVÝŠIŤ / +10 % |
| 6,6×+ | 686 € | 2,9 % | 11,03 | 123 | NAVÝŠIŤ / +15 % |

Štruktúrny problém: 27,5 % rozpočtu horí pod 3,5×, zatiaľ čo pásma nad 6× dostávajú len 6,2 % spendu pri ROAS 6,4–11×. Realokácia zdola nahor je hlavná páka mesiaca.

## Krajiny (aktívny spend)

| Krajina | Spend | ROAS | Verdikt |
|---|---|---|---|
| RO | 6 819 € | 4,02 | jadro, mix dobrý aj zlý (Main P-Max RO ťahá dole) |
| HU | 6 440 € | 4,16 | stabilné jadro |
| SK | 2 334 € | 4,18 | OK |
| SI | 2 188 € | 3,03 | podpriemer, prečistiť |
| BG | 1 971 € | **5,79** | podfinancované — škálovať |
| HR | 1 756 € | **4,99** | podfinancované — škálovať |
| CZ | 1 386 € | 2,66 | stratové pásmo |
| PL | 601 € | **1,61** | najhoršie, kandidát na stop |

## Kritické body do diskusie

1. **Main P-Max RO** — najväčšia kampaň účtu (2 136 €, 47 nákupov, ROAS 1,96) má na boarde PAUSE. Vypnutie zoberie ~9 % spendu a zasiahne signály celého RO. Alternatíva: −50 % budget + zvýšiť tROAS, nie tvrdý pause.
2. **Hraničné PAUSE prípady:** Zlaté náušnice RO (3,05), SK_Booster (3,15), Piercing RO (3,34) — tesne pod prahom 3,5×. Bez znalosti break-even ROAS per krajina/kov je pause pri 3,1–3,3 potenciálne vypínanie ziskových kampaní. Stĺpec „Náš ROAS" je v celom súbore prázdny — prah 3,5× je zjavne plošný, nie maržový.
3. **Škálovacie kandidáty s malým spendom:** RO_S_Zlato (9,88×, 376 €), HR Všeobecné [B] (16,9×, 99 €), BG Piercing [B] (16,7×), Piercing CZ (12,9×). +15 % na 17 € spende je kozmetika — tieto znesú +30–50 % s denným monitoringom.
4. **92 mŕtvych kampaní** s nulovým spendom vrátane duplikátov (Main P-Max RO #2, Video Dosah 2×, Search_traffic #2). Riziko omylov a chaos v reporte.

## Akčné kroky (návrh na schválenie)

1. Pásmo <3,5×: kampane s ROAS <2,5 → PAUSE ihneď (Main Search PL, Search_CZ_2025, Zlaté prívesky CZ, Strieborné náhrdelníky SI, Strieborný set SI). Kampane 2,5–3,5 → −50 % budget + tROAS nahor, revízia o 14 dní.
2. Main P-Max RO: nerušiť, −50 % + audit asset groups a feedu (RO má zároveň najlepšie kampane účtu — problém je kampaň, nie trh).
3. Uvoľnený budget (~2 500–3 000 €/mes.) presunúť: BG a HR search/P-Max (+30 %), pásmo 6,6×+ (+30–50 % namiesto +15 %), pásmo 5–6× (+10 %).
4. PL: rozhodnúť stop alebo posledný test s novým feedom/cenotvorbou — 1,61 pri 601 € nemá obhajobu.
5. CZ: audit Shopping feedu a cien vs. konkurencia; CZ 2,66 pri fungujúcom SK 4,18 ukazuje na cenu/feed, nie kreatívu.
6. Hygiena: archivovať 92 nulových kampaní, zmazať duplikáty.
7. Doplniť do boardu stĺpec „Náš ROAS" (break-even per krajina × kov) — bez neho sú prahy pásiem arbitrárne.
8. Kontrola o 7 dní (28.7.): efekt −50 % zásahov, o 14 dní rozhodnutie pause vs. návrat.

## Otázky na poradu

1. Aký je break-even ROAS per krajina a per kategória (zlato vs. striebro vs. oceľ)? Bez toho je prah 3,5× nepodložený.
2. Prečo PAUSE namiesto tROAS biddingu v pásme <3,5× — sú kampane na tCPA/max. conversion value bez cieľa?
3. Aký conversion lag má P-Max v účte? Časť pásma <3,5× môže dobiehať hodnotu (obdobie končí 20.7., posledný týždeň je podhodnotený).
4. Je celkový mesačný budget fixný (realokácia), alebo sa pri ROAS 4,06 navyšuje absolútne?
5. PL — existuje biznisový dôvod držať trh (logistika, sklad), alebo je čisto výkonnostný?
6. Kto exekuuje zmeny a do kedy — dnes po porade, alebo batch k 1.8.?
7. Zahŕňa „Hodnota konv." vratky a DPH, alebo hrubú hodnotu objednávok? Pri šperkoch vratkovosť mení reálny ROAS o 10–20 %.

### 🧑 Používateľ
k dnešku to tam dopíš

### 🤖 Claude
[tool_use: tool_search]

[tool_result]

[tool_use: tool_search]

[tool_result]

[tool_use: Google Calendar:list_events]

[tool_result]

[tool_use: Google Calendar:update_event]

[tool_result]

Zapísané do dnešnej udalosti „Samuel_Ad´s - Report / optimalizácia - 2/3" (10:15–10:45). Pôvodný text „Zhrnutie k 20." zachovaný, doplnený celý report, akčné kroky a otázky. Bez e-mailových notifikácií účastníkom. Zmena sa týka len dnešnej inštancie, nie celej série.

