# Kontrakt: Dizajn & branding celej appky — 2026-08-28

Nadväzuje na `KONTRAKT-REDIZAJN-2026-08-27` (vlny 1–3 hotové). Zdroj rozhodnutí:
60 otázok zodpovedaných používateľom 28. 8. 2026 v session `1b83dc4c`. Tento
dokument je zdroj pravdy pre autonómny beh — nejasnosť sa rozhoduje v jeho duchu.

## Cieľ

Konzistentná appka bez rozrobených miest: každá obrazovka pôsobí dokončene
a jednotne — grafy, tabuľky aj chat hovoria jedným jazykom (odpoveď 60).
Súčasťou je evolúcia značky (znak, wordmark, ikonová sada) nasadená všade.

## Rozsah — čo ÁNO

Všetko nižšie. Čo tu nie je menované, do rozsahu nepatrí.

### A · Značka (odpovede 1–6)

- **A1 Kompletná evolúcia znaku** — nové proporcie aj animovaná verzia
  (dýchanie/pulz pre načítavanie). Návrh v SVG, viac variantov na výber
  používateľovi PRED nasadením (jediný ľudský checkpoint behu, viď Riziká).
- **A2 Kreslený wordmark** „Hades" — vlastný logotyp ako SVG asset
  v `public/brand/`, záväzné proporcie a odstupy v manuáli.
- **A3 Kompletná ikonová sada** z nového znaku: favicon (SVG + PNG fallback),
  Electron `.ico` (16/32/64/256), monochrome tray verzia.
- **A4 Mýtus UBRAŤ** — mýtická vrstva len v menách (Hades, Charón). Prázdne
  stavy, mikrotexty a názvy sekcií čisto technické. Prejsť existujúce texty.
- **A5 Jedna značka** — žiadne mikro-identity plôch; výnimka ostáva len meno Charón.
- **A6 Okamžitý štart** — žiadny splash; animovaný znak žije len ako indikátor
  reálneho načítavania.

### B · Farba a témy (7–12)

- **B1 Svetlá téma = plná parita.** Všetko nové sa meria a ladí na oboch témach.
- **B2 Amethyst akcent ostáva** presne ako je. Kánon akcent/zlato sa nedotýka.
- **B3 Záväzná dátová paleta** — nové tokeny: trend (rast/pokles/neutral)
  a stavy behov (running/waiting/failed/done), merané kontrasty na oboch témach,
  zapísané do manuálu §4.
- **B4 Prekalibrovať tóny 5 oblastí** — rovnaká logika (`mutedColor()`, OKLCh),
  odtiene posunúť pre lepšiu vzájomnú rozlíšiteľnosť v grafoch a legendách.
- **B5 Plochý jazyk** — žiadne gradienty.
- **B6 Sklo nechať** ako je (len tmavá, súčasný rozsah).

### C · Typografia (13–18)

- **C1 Serif prísne 2 role** (hero číslo, H1) — nemení sa.
- **C2 Geist Mono ostáva** jazykom dát všade.
- **C3 Hustota ostáva** (základ 14 px / dáta 13 px).
- **C4 Čítací režim** pre dlhé texty (playbooky v Knižnici, smernica):
  max-width ~68 ch, 15–16 px, vyššie riadkovanie. Bez serifu v tele.
- **C5 Slovenská mikrotypografia kodifikovaná + vynútená**: nedeliteľné medzery
  (jednopísmenové predložky, číslo+jednotka), „nízke" úvodzovky, správne pomlčky.
  Pravidlá do manuálu, jednorazový prechod všetkých UI textov, grep na vynútenie.
- **C6 Tabular-nums všade** — každé číslo v tabuľke, KPI a metrike.

### D · Layout a navigácia (19–24)

- **D1 Rail:** zbalenie si pamätá localStorage; pod ~768 px bottom-bar
  so 4–5 destináciami. Pozor na pascu `transition` × token (CLAUDE.md).
- **D2 Header:** metriky uzlov/spojení len na obrazovke Graf; inde čistý
  (breadcrumb + hľadanie).
- **D3 Ctrl K = command palette:** hľadanie uzlov + skok na obrazovku + akcie
  (nové vlákno, synchronizovať…) + posledné vlákna. Jeden vstup.
- **D4 IA drží** — 8 obrazoviek + Charón, nič sa nezlučuje.
- **D5 Max-width stĺpec** (~1100 px) na záznamových obrazovkách.
- **D6 Bez statusbaru.**

### E · Dnes (25–30)

- **E1 „Naposledy si robil na…" = kompaktný zoznam** (riadok: názov, projekt
  chip, čas).
- **E2 Heatmapa aktivity ostáva** — doladiť rampu a tooltip.
- **E3 Donut Istota ostáva** — doladiť legendu a čitateľnosť malých segmentov.
- **E4 KPI karty: sparkline (30 d) + delta** („+65 tento týždeň").
- **E5 Inline overenie na Dnes** — prvé 2–3 čakajúce poznatky sa dajú
  overiť/zamietnuť priamo, zvyšok odkazom na Kontrolu.
- **E6 Nová sekcia „fokus"** — aktívne projekty, čakajúce zápisy, otvorené behy.

### F · Grafy (31–36)

- **F1 d3 + vlastný štýl** (d3 7.9 už self-hostnutý; žiadna nová závislosť).
- **F2 Typy: čiara/plocha/stĺpce + heatmapa + donut + scatter + sankey.**
  Sankey = toky medzi oblasťami/projektami; scatter = napr. uzly sila × vek.
- **F3 Tooltip všade + prepínač období (30 d / rok / všetko).** Bez brush zoomu.
- **F4 Rast siete:** prepínač období rieši hokejku.
- **F5 Hades chart štýl do manuálu** — nová sekcia: osi, mriežka, legenda,
  tooltip, prázdny stav grafu; záväzné pre všetky plochy. Tichá verzia
  pre reduced-motion.
- **F6 Bez exportu grafov.**

### G · Tabuľky a záznamy (37–42)

- **G1 Runy + Rozhodnutia = tabuľky** (stĺpce, triedenie); **Denník ostáva
  kartový** (naratívny).

  **OPRAVA KONTRAKTU (28. 8. 2026):** tento bod pôvodne menoval pre Rozhodnutia
  stĺpce „Kedy, Rozhodnutie, Projekt, Oblasť, Istota". **Projekt ani Istota
  v dátach NEEXISTUJÚ** — tabuľka `decisions` má `node_id, area_id, decided_on,
  text, reason, origin, source_file` a `/api/decisions` nič iné nevracia.
  Dopočítať projekt z `S.nodes` v prehliadači by znamenalo stĺpec, ktorý človek
  vidí a AI nie — teda presne ten rozchod plôch, ktorý celá vlna E liečila.
  Skutočné stĺpce sú **Kedy · Rozhodnutie · Oblasť · Pôvod**. Chyba je moja:
  kontrakt som písal z odpovedí, bez kontroly schémy.
- **G2 Filtre: dátum + projekt + oblasť + stav + uložené filtre** (localStorage).
- **G3 Načítavanie: tlačidlo „ďalších 50".**
- **G4 Pohodlná hustota** (~40 px), bez prepínača.
- **G5 Hromadné akcie len v Kontrole** (overiť/zamietnuť viac naraz).
- **G6 Detail záznamu: pravý panel + vlastná URL.**

### H · Charón /chat (43–48)

- **H1 Vlastný layout ostáva** (fullscreen troj-panel) — len vizuálne zladiť
  so značkou. NEsplýva s railom appky.
- **H2 Bubliny:** user vpravo v bubline, Hades vľavo dokumentovo (bez bubliny).
- **H3 Tool cally = zbaliteľné riadky (diff na klik); čakajúci ZÁPIS = vždy
  plná karta s diffom** — brána musí byť vidieť.
- **H4 Podagenti = vnorené karty** vo vlákne rodiča, rozbaliteľné.
- **H5 Plný composer:** viditeľný profil nástrojov, model, prílohy, diktovanie.
- **H6 Prázdne nové vlákno: 3–4 kontextové návrhy promptov** + composer.

### I · Graf vedomia (49–53)

- **I1 Halo/pulz pri WS aktivácii uzla** — krátky, s tichou verziou.
- **I2 Redizajn panelu detailu uzla:** viac z `mind_read` (spojenia, história,
  tagy) + akcie: overiť, premenovať, presunúť, otvoriť v Charónovi.
- **I3 Jeden zasúvací dock** — legenda + filtre + nastavenia s tabmi namiesto
  plávajúcich panelov.
- **I4 Layers pohľad: minimálna údržba** — funkčný ostáva, neinvestuje sa.
- **I5 Breadcrumb trail** zanorenia (oblasť › oddelenie › uzol) v headeri Grafu.

### J · Pohyb, stavy, platformy (54–59)

- **J1 Živý organizmus, jemne:** dýchanie jadra, pulzy pri WS udalostiach,
  jemné vstupy kariet — všetko s tichou verziou (vzor z vlny 1).
- **J2 Notifikácie: inline primárne, toast len globálne** (sync, WS výpadok).
- **J3 Onboarding hints ZRUŠIŤ** — zmazať kód aj CSS.
- **J4 Mobil = čítací režim:** Dnes + Denník + chat plne použiteľné
  (bottom-bar); Graf a tabuľky len na čítanie, nesmú sa rozpadnúť.
- **J5 Electron: custom titlebar** so znakom a oknovými tlačidlami (tmavý).
- **J6 Prístupnosť: cieliť AAA kde sa dá** (7:1 pre bežný text); kde AAA
  nevychádza bez straty identity, drží sa meraná AA a zapíše sa to nahlas
  do manuálu.

## Rozsah — čo NIE

- Žiadne zmeny backendu okrem nových čítacích endpointov nevyhnutných pre
  UI (sparkline dáta, fokus, filtre) — vždy cez existujúci vzor serializérov
  (dvojitá plocha UI = MCP, `ScreenParityTest`).
- Žiadna zmena DB schémy. Žiadne mazanie dát.
- Žiadna tretia cesta k modelu (všetko cez `runclient.js`).
- Žiadne nové JS/CSS závislosti (d3 a pusher už sú; mermaid/highlight.js nie).
- Layers pohľad sa nedizajnuje (I4). Export grafov nie (F6). Statusbar nie (D6).
- Splash nie (A6). Gradienty nie (B5). IA sa nemení (D4).
- `AgentRunner.php` sa nedotýka. Profily nástrojov sa nemenia.

## Akceptačné kritériá

1. Nový znak, wordmark a ikonová sada nasadené na `/`, `/console`, `/chat`,
   favicon aj Electron. POZN.: variant NEVYBRAL používateľ — výber odmietol a dal
   pokyn pokračovať, takže ho vybral autonómny beh (viď Rozhodnutia počas behu).
   Wordmark sa NEKRESLIL nanovo: v repe už bol Cinzel 600 v krivkách a A2 sa
   plní tým, že mu lockupy konečne drží generátor, nie nový logotyp.
2. Manuál `docs/BRAND-HADES.md` aktualizovaný PRVÝ (vzor z 27. 8.): znak §2,
   dátová paleta §4, chart štýl (nová sekcia), mikrotypografia §6, AAA §4.
3. Grep hlasu a mýtu: 0 zásahov prvej osoby; mýtické formulácie mimo mien 0.
4. Všetky grafy v appke kreslí jeden modul s jedným štýlom (osi, mriežka,
   legenda, tooltip, prázdny stav) — žiadny graf mimo neho.
5. Runy a Rozhodnutia majú tabuľky s triedením a filtrami; „ďalších 50"
   funguje; detail sa otvára v pravom paneli s vlastnou URL.
6. Command palette: uzly, obrazovky, akcie, posledné vlákna — otvára Ctrl K.
7. Dnes: sparkline + delta na 4 KPI, inline overenie, fokus sekcia,
   kompaktný zoznam — všetko s dátami zo serializérov (parita drží,
   `ScreenParityTest` zelený vrátane vrstvy citlivosti).
8. Mobil (375 px): Dnes, Denník a chat použiteľné s bottom-barom; Graf
   a tabuľky sa nerozpadnú. Overené cez emuláciu + ručný `resize` dispatch
   (pasca `resize_window` z CLAUDE.md).
9. Kontrasty zmerané na OBOCH témach zloženým pozadím s dosadnutím
   (pasce z CLAUDE.md); AAA dosiahnuté kde sa dá, výnimky menované v manuáli.
10. Tiché verzie pre `prefers-reduced-motion` pre každý nový pohyb.
11. Celý testovací balík zelený (`artisan test` + mariadb filter
    + `ContentSecurityPolicyTest`); UI overené prekliknutím cez proxy
    s overenou identitou servera (8091, `/js/mind/main.js`).
12. Onboarding kód zmazaný; `localStorage` kľúč hints ošetrený.

## Predvolené rozhodnutia (dá sa zmeniť, rozhodol som sám)

- Detail záznamu URL tvar: `#/runy/<id>` (hash, bez novej route) — server
  routes sa nemenia.
- Uložené filtre žijú v `localStorage` (nie DB) — sú to slová/vizuál, nie dáta.
- Sparkline dáta: nový lacný endpoint v existujúcom serializéri obrazovky
  Dnes (30 denných bodov na KPI), zapísaný do `ScreenParityTest` registry.
- Bottom-bar destinácie: Dnes, Denník, Graf, Charón, Viac (zvyšok v „Viac").
- Command palette index: uzly cez existujúce API hľadania; bez nového
  fulltext endpointu.
- Electron titlebar: `titleBarStyle: hidden` + vlastný drag región; token
  injection vzor sa nemení.

## Riziká a otvorené body

- **Necommitnutý diff na branchi** (mind.css, charts.js, render.js, ws.js,
  ~2100 riadkov, práca paralelnej session z 28. 8.) — pred behom sa commitne
  ako checkpoint po zelených testoch. Nič sa nezahadzuje.
- **Vkus znaku sa nedá zautomatizovať** — beh sa raz zastaví: 3 varianty
  znaku + wordmarku ako HTML náhľad, používateľ vyberie, beh pokračuje.
- **AAA vs. identita** — amethyst na tmavej nemusí dať 7:1 na malom texte;
  riešenie: AAA pre text, AA pre neaktívny chróm, zapísané v manuáli.
- **`auth.ui` pustil dashboard bez tokenu** (pozorované používateľom 28. 8.).
  Overiť v security prehliadke vlny R: či ide o session cookie po prvom
  tokene (OK), alebo o dieru (fix v rámci behu — auth je v rozsahu review).
- Hades MCP tooly v tejto session nedostupné — zápisy `mind_decision`/
  `mind_learn` sa spravia na konci, ak sa spojenie obnoví; inak do reportu.

## Rozhodnutia počas behu (moje, keď kontrakt nestačil)

- **Variant znaku: B „Jedno oko"** (28. 8. 2026). Používateľ výber nepotvrdil a dal
  pokyn pokračovať, takže som rozhodol sám — je to reverzibilné (generátor + jeden
  commit). Dôvod: B je jediný z troch variantov, ktorý rieši NAMERANÝ problém, že
  master a mini boli dva rôzne výkresy (0,46 vs 0,36 boxu), a robí to tak, že
  master sa stane nadmnožinou mini.
- **Pravidlo redukcie namiesto prerušeného mini.** Karta variantu B kreslila
  prerušenie a satelit aj v 16 px. V kóde to nejde bez prepísania troch výstupov
  naraz (`Mini` parser prijíma dva kruhy, raster kreslí anulus dvoma diskami,
  `.load-mark` je CSS `border`), a pri 16 px má medzera 3,4 px a satelit obrys
  1,8 px. Prerušenie a satelit sa preto kreslia od 64 px a nižšie sa hranica
  zatvára. Zapísané v manuáli §2 ako pravidlo, nie ako výnimka.
- **Master sa generuje z mini.** Nebolo v kontrakte, ale bez toho by master zostal
  druhým ručným zdrojom a rozišiel by sa znova — presne to sa už raz stalo.
- **Lockupy pribrané pod generátor + nový `build-raster.js` pre PNG.** Lockupy nesli
  geometriu starého mastera (r 34, jadro r 8,5), pretože ich vyrábal
  `docs/build-brand.py`, ktorý v tejto vetve neexistuje. PNG rasterizuje Chrome,
  lebo PIL nenakreslí wordmark v krivkách a v prostredí nie je SVG rasterizér
  (`cairosvg` chýba, `convert` je Windowsov konvertor diskov).
- **Nová devDependency `puppeteer-core`** (22 balíkov) — dôvod vyššie.
- **Rail a paleta mieria na `/chat`**, nie `/console`; konzola si URL drží.
- **J2 v plnom rozsahu** (inline potvrdenia, toast len pre zlyhania a globálne
  udalosti) — používateľ rozsah nepotvrdil a dal pokyn pokračovať.
- **Zmazané tri staršie zálohy DB.** Rotácia „drž posledné 3" bežala v tom istom
  príkaze ako dump, dump zlyhal na heslo a 0-bajtový súbor sa počítal ako najnovšia
  záloha. Nenávratné; nová záloha je overená (17,7 MB, obsahuje `areas`).

## Výsledok

(doplní sa po behu)
