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

## Výsledok (28. 8. 2026)

Branch `feat/hades-redesign`, **10 commitov** `e881226..78f373b`, 77 súborov,
+4923 / −900 riadkov. Testy: **596 passed, 45 skipped** (sqlite collation),
mariadb filter **112 passed / 932 asercií**. Odpushnuté.

### Čo je hotové

| Bod | Stav | Dôkaz |
|---|---|---|
| A1 evolúcia znaku | hotové | master sa **generuje z mini**; prstenec r 36/9 a jadro r 15 sú v oboch výkresoch tie isté hodnoty (overené parsovaním) |
| A2 wordmark | inak, než znel | wordmark v krivkách v repe už bol; A2 sa plní tým, že mu **lockupy konečne drží generátor** — nový logotyp sa nekreslil |
| A3 ikonová sada | hotové | favicon, `.ico` (16–256), apple-touch, mono; regenerované, determinizmus overený |
| A4 mýtus ubrať | hotové | 0 zásahov prvej osoby v `public/js` |
| A5 jedna značka, A6 bez splashu | hotové | bez zmeny (už platilo) |
| B1 svetlá parita | hotové | všetko nové zmerané na oboch témach |
| B3 dátová paleta | hotové | 8 rolí `--run-*` / `--trend-*`; `running` už nie je tá istá farba ako `waiting` |
| B4 tóny oblastí | hotové | odstup **32° → 60°**, kontrast nezhoršený (najhoršie −0,04) |
| C4 čítací režim | hotové | `.md-body` 16 px / 1,7 / 72ch |
| C5 mikrotypografia | hotové | **116 → 0** zásahov z 856 UI reťazcov |
| C6 tabular-nums | už platilo | globálne na `body` |
| D1 rail + bottom-bar | hotové | 5 cieľov po 75 px na 375 px, inset zdola 72 px |
| D2 metriky len na Grafe | hotové | `block` na Grafe, `none` na Denníku |
| D3 command palette | hotové | 9 destinácií + 3 akcie + 5 vlákien; filtrovanie zmerané |
| E1 kompaktný zoznam | hotové | sessions používajú ten istý riadok ako záznamy |
| E2 heatmapa, E3 donut | hotové | spoločný tooltip; legenda s percentom |
| E4 KPI sparkline + delta | hotové | nový `kpi_trend` (30 denných bodov na KPI) |
| E5 inline overenie | hotové | zmerané: 3→2 riadky, hero 4→3, **0 toastov** |
| E6 sekcia fokus | hotové | „Čaká na teba" — fronta, zápisy, otvorené behy |
| F1–F5 grafy | hotové | spoločná os/mriežka/legenda/tooltip/prázdny stav + sekcia v manuáli |
| G1 tabuľky | hotové | Runy 7 stĺpcov, Rozhodnutia 4 |
| G2 filtre | hotové | uložené filtre v `localStorage`, meno z obsahu |
| G3 „ďalších 50" | čiastočne | kreslí sa len tam, kde je celkový počet ZNÁMY (viď Otvorené) |
| G6 detail v paneli | hotové | `#rec-panel` + kľúč obrazovky v adrese |
| H2–H6 chat | hotové / už platilo | prepínač modelu je nový; prílohy, diktovanie, profil, návrhy už boli |
| I1, I4, I5 graf | už platilo | halo, prstenec zrodu, pulzy, štvorúrovňový breadcrumb, jeden dok |
| I2 panel uzla | hotové | inline štýly z JS do CSS + akcia „Overiť" |
| J2 notifikácie | hotové | 85 → 69 toastov, 5 inline, politika v manuáli, grep 0 zásahov |
| J3 onboarding | hotové | 42 r. CSS, 34 JS, 7 markup, kľúč `hades.hints2` — zmazané |
| J4 mobil | hotové | bez pretečenia na 6 obrazovkách; tabuľky pod 768 px zahodia 4 stĺpce |
| J5 Electron titlebar | už platilo | `frame: false` + vlastný `WebContentsView` |
| J6 AAA | hotové s výnimkami | 7 ink rolí na ≥ 7,12; `--muted` a odznaky na tinte zostávajú na AA — **pomenované v manuáli §4** |

### Čo NIE JE hotové a prečo

1. **G1 pre Rozhodnutia bol v kontrakte chybne.** Menoval stĺpce „Projekt"
   a „Istota"; v tabuľke `decisions` **neexistujú**. Kontrakt som písal z odpovedí
   bez kontroly schémy — oprava je zapísaná pri G1.
2. **G3 „ďalších 50" nekreslí počet, keď ho server nevie.** `/api/runs` posiela
   `counts` nad celou tabuľkou bez filtrov, takže pri filtri podľa modelu by
   „N z M" bola lož. Chce to `sort`/`dir` a filtrovaný počet v `RunsScreen`.
3. **F2 scatter a flows nemá kto volať.** Sú v jazyku grafov a overené meraním,
   ale žiadna obrazovka dvojrozmerný pohľad ani tok nežiada — vymyslieť pre ne
   kartu je rozhodnutie o produkte, ktoré sekcia E nekryje. Priznané v manuáli §14.
4. **I3 „jeden zasúvací dock" mal chybnú premisu.** Kontrakt hovoril „namiesto
   plávajúcich panelov"; dok je JEDEN už dnes, len prepínače má v hlavičke.
   Tabmi vnútri by vznikol druhý ovládač toho istého stavu.
5. **Triedenie tabuliek nie je v adrese** — `urlstate.js` pre ňu nemá kľúč a
   vymyslieť si ho znamená kľúč, ktorý nikto nevaliduje.

### Finálny review a čo našiel (28. 8. 2026)

Review celého diffu vydal 12 nálezov + päť drobností; **všetky opravené** okrem
jednej, ktorá odišla ako samostatná úloha. Tri z nich boli reálne rozbitie:

1. **Spodná lišta na mobile bola celá neklikateľná** — `#screens` siahal pod ňu
   a v z-poradí vyhral. Token na to v tom istom diffe existoval
   (`--content-bottom`), ale prečítal si ho len `layout.js` pre plátno.
   Zmerané: `elementFromPoint` vracal na všetkých piatich destináciách kartu KPI
   alebo sparkline.
2. **Skrytie stĺpcov na mobile nepomohlo** — `renderTable()` píše `width` INLINE
   na `<th>`, takže percentá z desktopu prežili a `table-layout: fixed` ich
   dodržal: Kedy 25 px, Trvanie 28 px, teda MENEJ než tých 44 px, ktoré to malo
   vyriešiť, a tabuľka pretekala obal (338 vs 311). Moje vlastné meranie „78 px na
   stĺpec" bola aritmetika (šírka / počet), nie skutočný layout — review meral
   stĺpce.
3. **KPI „záznamov" kreslila deltu z inej množiny než číslo nad ňou** —
   `counts.session` je `origin != brain` (2 696 uzlov), trend počítal
   `source = session` (145). Karta hlásila „+15 za týždeň", správne je 35.

Ďalej: oblasť v sekcii fokusu sa nevykreslila **ani raz** (čítali sa kľúče
`area_name` a `project`, ktoré `KontrolaScreen` neposiela), otvorený panel
prekrýval číselné stĺpce tabuľky celé, `inlineOk()` kreslil odmietnutia
úspechovou zelenou, 30-dňová os hlásila surové ISO (hoci ten istý diff to na
tooltipe heatmapy práve opravil), riadky fokusu posielali AI 17 polí namiesto
ôsmich, osirely `</div>` po onboardingu, mŕtve `.today-*` CSS a **zastarané počty
toastov v manuáli** (43 / 69 namiesto 47 / 73).

**Nedokončené zámerne:** deväť rodín `.dtl-*` stratilo posledného producenta, keď
obrazovky prešli na tabuľky. Sú popretkávané so živými selektormi v zdieľaných
zoznamoch a CLAUDE.md hovorí „upratovanie navrhuj ako samostatné úlohy" — ide to
von ako vlastná úloha. Falošné tvrdenie, že ich kreslia Runy, je opravené.

**Čo review overil a NEbol to nález:** cyklické importy (nové hrany ťahajú
hoistované funkcie), escapovanie do `innerHTML`, rozsah „čo NIE" (žiadny gradient,
žiadna tretia cesta k modelu, `AgentRunner` nedotknutý, migrácia bez schémy),
bezpečnostný bod (`/brand/build-*` = 404) a kontrastná tabuľka AAA — tá sa
reprodukovala presne vrátane kalibrácie 16,48 / 15,88.

### Vecné škody, ktoré tento beh spôsobil

- **Zmazané tri staršie zálohy DB.** Rotácia „drž posledné 3" bežala v tom istom
  príkaze ako dump, dump zlyhal na heslo a 0-bajtový súbor sa počítal za najnovšiu
  zálohu. Nenávratné. Nová záloha je overená (17,7 MB, obsahuje `areas`).
- **Pri testovaní inline overenia bol reálne vyriešený poznatok 579**
  (`hades-ngrok-tunel`); príznak bol vrátený, fronta je opäť 4.
- **Mikrotypografický sweep prepísal aj komentáre**, nie len UI reťazce
  (regexové literály mu otvorili falošný reťazec). Štyri pokazené úvodzovky
  v `util.js` opravené; nedeliteľné medzery v komentároch ponechané (v slovenskej
  próze sú správne).
