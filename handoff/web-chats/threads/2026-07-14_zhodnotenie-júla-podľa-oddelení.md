# Zhodnotenie júla podľa oddelení

- **UUID:** 77a7b043-425d-4995-91c8-3b19058630d6
- **Vytvorené:** 2026-07-14T22:28
- **Aktualizované:** 2026-07-14T22:34
- **Správ:** 10

---

### 🧑 Používateľ
vojdi do kalendaru a priprav mi zhodnotenie za mesiac jul od zaciatku mesiaca progress 

v jednotlivych uloch pre jednotlive oddelenia max 5 uloh zobrazene v grafe

### 🤖 Claude
[tool_use: user_time_v0]

[tool_result]

[tool_use: event_search_v0]

[tool_result]

### 🧑 Používateľ
musis pouzit google calendar

### 🤖 Claude
[tool_use: tool_search]

[tool_result]

[tool_use: Google Calendar:list_events]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

Deadliny fixné: 15.7. návrhy SMS + flows, 22.7. dizajn automatizácií, 31.7. preklady a spustenie. Dnes je 15.7. — prvý míľnik sa vyhodnocuje na dnešnej porade Ema_Projekty.

Súhrn: IT najsilnejší progres (2 z 5 úloh uzavreté), Ads plní ~85 % plánu pri klesajúcom dopyte, SEO rastie v TOP 3 ale bez merania tržieb, Foto/Nahrávanie stagnuje na opakovaných bodoch, Ema má najtesnejšie deadliny do konca mesiaca.

### 🧑 Používateľ
teraz kompletne stats na osobu s grafmi

### 🤖 Claude
Kompletné štatistiky na osobu, obdobie 1.7.–15.7.2026. Prvý graf = zaťaženie poradami, potom progres úloh na osobu. Hodnoty pri Delajovi, Kristiánovi, Danielovi a Samuelovi (Heslá) sú z reportov; ostatné sú odhad zo zápisov.

**Porady na osobu (1.7.–15.7.)**

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

**Delaja** — najvyššia miera uzavretia úloh v IT.

[tool_use: chart_display_v0]

[tool_result]

[tool_use: chart_display_v0]

[tool_result]

### 🧑 Používateľ
sprav zaver z dnesnych porad v kalendary to je

### 🤖 Claude
Dnešné porady (streda 15.7.2026) — 6 položiek v kalendári:

**Samuel – ½-ročné vyhodnotenie** (celodenné)
Hlavný bod dňa. Podklady z júna: rozpočet plnený na 84 %, tržby na 87 %, pokles dopytu po šperkoch kompenzovaný kampaňou.

**Ema_Projekty** (10:15–11:15) — kontrola deadlinu "do 15.7."
1. SMS: UX/UI vizuál k webu, mind-map logika, návrh políčka v košíku, návrh pre zákaznícky účet, IT vyjadrenie
2. Automatizácie: flow Pravidelné novinky + Investovanie do zlata
3. Bannery: Ben update
Ďalšie míľniky: 22.7. dizajny, 31.7. preklady a spustenie.

**Kristián – IT follow-up** (11:00–11:15)
Kontrola úloh: označenie IČO (UX), zmeny naviazané na Omegu, bug fix DPH, UX zmeny coupon assist, UI logika. Coupon asistent je nasadený v testovaní — dnes sa uzatvára zvyšok.

**Samuel – Prístupy/Heslá** (11:00–11:30) — úloha na 60 %, dnes splatné:
1. Vytvoriť hlavný mail r.ruscak@sperky-eshop.sk
2. Hierarchia do HTML (voliteľne Aura)
3. Maily pre zamestnancov / skupiny
4. Aktivovať Google Workspace
Konflikt: prekrýva sa s Kristiánovým callom 11:00–11:15.

**Ema Projekt: SMS** (22:15–22:45) a **Ema Projekt: Automatizácie** (22:30–23:00)
Duplikujú body rannej porady Ema_Projekty a navzájom sa prekrývajú o 15 min. Kandidáti na zrušenie alebo presun, ak sa ráno uzavrú.

Súhrn dňa: 3 kontrolné body s pevným termínom 15.7. (Ema SMS+automatizácie, Samuel heslá), 1 vyhodnocovací (½-rok), 2 časové konflikty v kalendári.

### 🧑 Používateľ
vcerajsie

### 🤖 Claude
Včerajšie porady (utorok 14.7.2026) — 4 položky, tri majú zapísané závery:

**Daniel – IT follow-up** (10:45) — Peňaženka a pokladňa
1. Implementované: priame vloženie kreditu z pokladne (kód poukážky → okamžitý vklad) a čiastočná úhrada kreditom (zvyšok kartou, funguje s kupónmi). Pokračuje napojenie košík → objednávka → peňaženka, zápis transakcií v DB.
2. Hlášky: generická hláška pre ~80 % prípadov, špecifické pri kupónoch zostávajú. Samuel navrhne jednotný formát.
3. Dizajn: Ema pripraví návrhy (hlášky, pokladňa, komponenty) po častiach vo Figme; Dano dodá HTML+CSS preview. Layout: kupóny nad wallet, wallet ako roll-up.
4. Dano má voľno štvrtok a piatok — grafický review až po funkčných častiach.

**Delaja – IT follow-up** (11:15) — Cenotvorba
1. Prechod na model nákupná cena × markup, ruší sa výpočet cez materiál/gramáž. V admine zatiaľ len vizuálne, pokrytie ~90 % sortimentu.
2. Kalibrácia: zistená delta 58 % (príklad 67 € vs. 28,19 €), markup 160→260, cieľ odchýlka 0–2 %, 2–3 behy, delta >20 % sa preskočí. Mesačné kontroly po nasadení.
3. Do adminu pribudne kalkulačka a filter marží; zmeny cien len cez kód.
4. Komentáre sa migrujú na štruktúrované dáta s časovými eventami — základ pre obrátkovosť.
5. API pre AI marketing hotové, prístup cez WireGuard VPN; Git zmeny pôjdu ako auto-report (AI súhrn + PDF).
Deadline: 31.7. prechod do implementácie.

**IT_KPI / Report** (11:30) — bez nového zápisu, stav podľa 7.7.: coupon asistent 120 % (testing), dopravcovia 100 %, účtovníctvo 95 %, cenotvorba 80 %, darčekový poukaz 60 %.

**SEO KPI – Gabika** (13:00) — jún vs. máj
1. 970 sledovaných KW (cieľ 1000+), priem. pozícia 5,52 (+0,2), kliky 4 398, CTR 1,70 %. Impresie klesli (258 787 vs. 283 174) — nižší dopyt na zlato. Tržby nemerané — chýba eventová mapa GA.
2. TOP 3: +85 slov (375). Zistená kanibalizácia KW — vyžaduje analýzu.
3. Rast: pozlátené prstene, strieborné prívesky. Pokles: diamantové prstene, pozlátené retiazky, svadobný segment (vypnuté CMS svadba).
4. iZlato: 539 spoločných slov, ich pozícia 2,83 vs. naša 6,18; my vedieme v piercingu.
5. Akčný plán: A–B porovnanie reportov (priorita), eventová mapa GA, 4 blogy na zlato, obnoviť CMS svadba, pridať konkurentov Sofia SK a Olivie, marketingová podpora Helix Piercing.

Prierezový záver dňa: dve najväčšie IT témy (peňaženka, cenotvorba) majú jasné akčné plány s termínom do konca júla; SEO má rastové pozície, ale bez napojenia na tržby — eventová mapa GA je opakovane blokujúci bod.

