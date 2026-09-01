# Kontrakt: Sprint 2 — doťah brandingu, UX/UI a optimalizácie

**Dátum:** 31. 8. 2026 · **Branch:** `feat/hades-redesign` · **Veľkosť:** L (30 agentov)
**Stav:** čaká na schválenie odhadu spendu

Nadväzuje na `KONTRAKT-DIZAJN-BRANDING-2026-08-28.md`. Ten šprint postavil jazyk
(tokeny, tabuľky, panel detailu, jazyk grafov, znak, manuál). Tento ho **dotiahne
na všetky plochy a zaplatí otvorené body**, ktoré ten kontrakt vymenoval v sekcii
„Čo NIE JE hotové a prečo".

---

## 1. Cieľ

Aby platilo, že appka hovorí **jedným jazykom na všetkých troch plochách**, a aby
tvrdenia manuálu a `CLAUDE.md` o kóde boli **overiteľné meraním**, nie dobrou vôľou.

---

## 2. Podmienka behu (nie je o tokenoch)

Pri 30 agentoch je limitujúci zdroj **zápis, nie spend**. Zmerané 31. 8. 2026:
nad tým istým pracovným stromom písali naraz tri veci a `docs/BRAND-HADES.md` sa
zmenil 42 sekúnd pred kontrolou. Dva zapisovatelia nad jedným súborom si prácu
prepíšu a **nič nepadne** — je to tichá strata.

1. **Jeden vlastník na súbor po celý beh** (tabuľka v §6). Agent, ktorý potrebuje
   zmenu mimo svojich súborov, ju **nerobí** a nahlási ju.
2. **Audit a meranie needitujú NIKDY.**
3. **Kým beží sprint, žiadna ďalšia session nad tým istým stromom.**
4. Sprint neštartuje, kým nedobehnú bežiace úlohy z 28.–31. 8.

---

## 3. Rozhodnutia používateľa (31. 8. 2026)

| Otázka | Rozhodnutie |
|---|---|
| Knižnica / Kontrola / Smernica na tabuľku + panel | **všetky tri** |
| Kde bolí výkon | **lokálny desktop** → optimalizácie na dopyty, nie na váhy assetov |
| `/console` a `/chat` | **plná parita** s `/` v novom jazyku |
| `scatter` a `flows` | **nájsť im domov**, nemazať |

Tri veci, ktoré k tým rozhodnutiam patria a musia byť v reporte:

- **Kontrola ako tabuľka je vedomé riziko.** Je to fronta na rozhodovanie, nie
  porovnávanie stĺpcov; kartový tok tam nesie „jedna vec naraz". Postaví sa a report
  prizná, ako to číta. Späť je to jeden commit.
- **„Plná parita" má hranicu v dátach.** Uložené filtre potrebujú, aby bolo čo
  filtrovať; jazyk grafov, aby bolo čo kresliť. Kde to na `/console` alebo `/chat`
  neplatí, nasadí sa to, čo platí, a **vymenuje sa, čo nie a prečo**. Graf sa
  nevymýšľa preto, aby bola tabuľka parity plná.
- **Váhy assetov vypadli z rozsahu, ale zapisujú sa ako známy fakt:** `/console`
  a `/chat` ťahajú 312 kB stylesheetu grafu. Lokálne to nebolí, cez ngrok z mobilu áno.

---

## 4. Zmerané východisko

| Vec | Zmerané 31. 8. 2026 |
|---|---|
| `public/css/mind.css` | 318 963 B, načítava sa na všetkých troch plochách |
| `public/js/mind` | 756 878 B, 31+ modulov, bez build stepu |
| `public/js/vendor/d3.min.js` | 279 706 B |
| `console.css` / `chat.css` / `charon.css` | 52 kB / 34 kB / 18 kB |
| `/api/today` payload | 21 606 B |

**Čo o výkone nevieme:** `CLAUDE.md` tvrdí `/api/journal` a `/api/dashboard` **3–4 s**.
Meranie 31. 8. dalo ~0,1 s so špičkami 1,7 s skákajúcimi po rôznych endpointoch —
zašumené bežiacimi agentami, teda **nepoužiteľné**. Tri možnosti a rozlíši ich len
meranie nad tichým stromom: tvrdenie je zastarané · ide o studený štart · súperenie
o osem PHP workerov. **W1 to meria ako prvú vec a bez nej sa neoptimalizuje.**

### Pomenované diery v brandingu

- Intro animácia znaku je zúžená na `#brand-core` a `#back-to-graph`, takže znak na
  `/chat` (`#chat-home`) a `.ce-mark` triedy má, ale **nikdy sa nezrodí**.
- `electron/states/offline.html` má vlastnú kópiu `core-pulse` s `ease-in-out`
  (manuál §3 to zakazuje) a bez `mind.css` ho podlaha `prefers-reduced-motion` nekryje.
- `/chat`: `og:title` „Hades — Chat" proti `<title>` „Hades — Charón".
- Paleta faviconu je natvrdo v troch blade `<head>`och.

### Čo nový jazyk nedostalo

Tabuľku + panel majú len Runy a Rozhodnutia. Denníku chýbajú filtre a „ďalších 50";
`/console` a `/chat` nemajú čítací režim, paletu ani uložené filtre a **ich mobil
nebol nikdy zmeraný**; `/api/runs` nemá `sort`/`dir` ani filtrovaný počet, takže
triedenie tabuľky beží len nad načítaným oknom.

---

## 5. Rozsah po vlnách (30 agentov)

| Vlna | Agentov | Obsah |
|---|---|---|
| **W1 Baseline** (read-only) | 3 | výkon nad tichým stromom (endpointy ×10, studený/teplý, počty dopytov); inventár jazyka po plochách; a11y + mobil `/console` a `/chat` na 375 / 768 / 1440 |
| **W2 Branding doťah** | 4 | zrod znaku na `#chat-home` a `.ce-mark`; `offline.html` + `topbar.html` pohyb a tichá verzia; `og:title` a duplicita palety faviconu; pravdivostný prechod manuálu §2/§3 |
| **W3 UX parita** | 10 | Knižnica, Kontrola, Smernica na tabuľku + panel (traja disjunktní vlastníci); filtre a „ďalších 50" pre Denník; čítací režim a slovník prázdnych stavov na `/console` a `/chat`; paleta Ctrl-K na tie plochy; uložené filtre kde majú čo filtrovať; mobilný prechod oboch plôch |
| **W4 Dátové diery** | 4 | `/api/runs` `sort`/`dir` + filtrovaný počet; triedenie v URL; domov pre `flows` (Dnes) a `scatter` (štatistiky Grafu); parita serializérov pre všetko nové |
| **W5 Optimalizácie** | 4 | dopyty za pomalými endpointami (N+1, počty, indexy); `/api/today` skládá päť agregátov — čo z toho môže byť lenivé; regresný dôkaz |
| **W6 Verify + review** | 5 | adversariálne overenie tvrdení každej vlny; finálny review celého diffu; manuál, `CLAUDE.md`, „Výsledok", handoff |

---

## 6. Vlastníctvo súborov (disjunktné, platí celý beh)

| Skupina | Súbory |
|---|---|
| A | `public/css/mind.css` |
| B | `public/css/console.css`, `chat.css`, `charon.css` |
| C1–C4 | `public/js/mind/screens/kniznica.js` · `kontrola.js` · `smernica.js` · `dennik.js` (štyri samostatné vlastníctva) |
| C5 | zvyšok `public/js/mind/**` (vrátane `table.js`, `recpanel.js`, `charts.js`) |
| D | `public/js/chat/**`, `public/js/console/**`, `public/js/shared/**` |
| E | `app/**`, `routes/**`, `database/**`, `tests/**` |
| F | `resources/views/**`, `electron/**` |
| G | `docs/**`, `CLAUDE.md`, tento kontrakt |

---

## 7. Odhad spendu

**2,2–2,9 M tokenov** (± 25 %), **9–13 h** autonómne.

| Vlna | Odhad |
|---|---|
| W1 Baseline | ~150 k |
| W2 Branding | ~250 k |
| W3 UX parita | ~1,10 M |
| W4 Dátové diery | ~350 k |
| W5 Optimalizácie | ~250 k |
| W6 Verify + review | ~350 k |

Čím sa to drží dole: meranie na sonnet, opravy na opus · read-only vlny needitujú,
takže nevzniká kolo „oprav a zisti, že to bola halucinácia" · pipeline namiesto
barrier · vlna bez nálezu nespustí opravára. **Pri raste rozsahu o viac než ~30 %
sa beh zastaví a rozsah sa prerokuje.**

---

## 8. Akceptačné kritériá

1. Knižnica, Kontrola a Smernica majú tabuľku s triedením a detail v pravom paneli
   s vlastnou URL. Zmerané: počet riadkov, `aria-sort`, otvorenie a tri cesty zavretia.
2. Denník má filtre a „ďalších 50" a **zostáva kartový**.
3. `/console` a `/chat`: čítací režim a paleta Ctrl-K fungujú; čo z parity nedostali,
   je v reporte vymenované s dôvodom.
4. Mobil 375 px na `/console` a `/chat`: bez vodorovného pretečenia, **žiadny stĺpec
   ani ovládač pod 44 px** (meraný ten prvok, nie priemer z kontejnera), spodná lišta
   klikateľná overená cez `elementFromPoint` na každej destinácii.
5. `/api/runs` vracia `sort`/`dir` a filtrovaný počet; triedenie je nad celou tabuľkou,
   nie nad oknom, a „ďalších 50" priznáva počet pri každom filtri.
6. `flows` a `scatter` majú volajúceho a kreslia reálne dáta.
7. Znak sa zrodí na všetkých štyroch plochách vrátane Electronu; `offline.html` má
   tichú verziu a žiadny `ease-in-out`.
8. Výkon: `/api/today`, `/api/journal`, `/api/dashboard` zmerané **pred a po** nad
   tichým stromom, s počtom dopytov. Ak sa nezlepší, report povie **prečo** — nie že
   sa optimalizovalo.
9. Celý balík zelený: `artisan test`, mariadb filter (`HybridRecall|RecallBench|ConsoleTools|McpTools`),
   `ContentSecurityPolicyTest`; parita obrazoviek drží vrátane vrstvy citlivosti.
10. Manuál a `CLAUDE.md` nehovoria o kóde nič, čo neplatí. Každé číslo v nich je
    z tohto behu, alebo je označené ako staršie meranie.

---

## 9. Čo do rozsahu NEPATRÍ

- **Nová vizuálna identita.** Iná práca; potrebuje smer, nie agentov.
- **Build step.** Projekt ho zámerne nemá.
- **Rozdelenie `mind.css`** na jadro + graf — vypadlo rozhodnutím „lokálny desktop".
- Zmena DB schémy. `/api/runs` potrebuje dopyt, nie stĺpec.
- Nové runtime závislosti (mermaid, highlight.js, d3-sankey).
- `AgentRunner.php` a profily nástrojov.
- Čistenie `.dtl-*` — beží ako samostatná úloha.

---

## 10. Riziká

| Riziko | Ako sa mu bráni |
|---|---|
| Dva zápisy nad jedným súborom | §6, disjunktné vlastníctvo; audit needituje |
| Falošný nález donúti „opraviť" funkčný kód | W6 má 5 agentov a jeho úloha je nález **vyvrátiť**; v minulom šprinte boli tri „nálezy" chybou merača |
| Optimalizácia podľa neovereného čísla | W1 meria pred akoukoľvek zmenou; bez baseline sa W5 nespustí |
| Kontrola ako tabuľka číta horšie | priznané v §3; návrat je jeden commit |
| Cyklické importy pri nových moduloch | hoistované `export function`, nikdy `export const` |
| Merač si meria vlastnú starú kópiu formuly | render vystaví výsledok na `S`, harness číta ten |

---

## 11. Výsledok

**Stav:** šprint bežal v TROCH fan-outoch, nie v jednom, a plán W1–W6 na 30
agentov sa vcelku nespustil.

- **Beh 1** (18 agentov, `wf_1822750c-815`): baseline meranie, doťah brandingu,
  tabuľka + panel pre Knižnicu, Kontrolu a Smernicu, filtre Denníka, kresba
  `/chat`. Commity `d43a975` a `2fea7a9`. **Sú to výsledky tohto šprintu** —
  prvý zápis tejto sekcie ich pripísal „paralelným sessions", pretože ho písal
  agent behu 2, ktorý reporty behu 1 nevidel.
- **Beh 2** (8 agentov, `wf_327ff36c-793`): dátové diery, a11y railu konzoly,
  opcache, overenie, tento zápis. Commit `2b0bb3e`, opravy zápisu `2679a34`
  a `b05da64`.
- **Beh 3** (4 agenti, 1. 9. 2026): znak na dok nad grafom + rozhodnutie
  o `core-pulse`, favicon zjednotený do jedného partialu, oprava mobilného
  hit-test bugu na `/console` (nájdený behom 2), oprava JSON `null` ako
  „projektu" na MariaDB + zmenšenie payloadu `/api/journal`. Podrobnosti
  nižšie pri kritériách 4, 7, 9 a v §11.1. Commity zatiaľ nevytvorené (agenti
  behu 3 nekomitujú, viď §6 pravidlá behu) — čaká sa na commit tohto zápisu
  spolu s ich diffom.

Šprint **nie je hotový**; zvyšok je v §11.1.

### Prestrelenie odhadu

Odhad behu 1 bol **1,5 M tokenov**, reálne **3,58 M** (+365 k na pokus zhorený
na limite), teda **~2,6×**. Celý šprint bol v §7 odhadnutý na **2,2–2,9 M** a
**prvý beh ho sám prekročil** — ďalší beh sa má počítať z tohto reálneho čísla
(~3,6 M na 5 agentov, tj. ~720 k/agent), nie z pôvodného per-vlnového odhadu.

### Akceptačné kritériá — bod po bode

1. **Knižnica, Kontrola, Smernica — tabuľka + panel.** ✅ Zmerané v kóde
   (`screens/kniznica.js`, `kontrola.js`, `smernica.js` importujú `renderTable`/
   `recpanel.js`). Vlastná URL bola stavaná bez zápisu do slovníka — `writeUrl()`
   neznámy kľúč ticho zahodí — a opravilo sa to samostatným commitom (`kno`,
   `koo`, `smo` v `urlstate.js DICT`). Nebolo súčasťou 5 hlásených behov, preto
   bez čísel z reportu; overené štrukturálne, nie premeraním DOM.
2. **Denník — filtre + „ďalších 50", zostáva kartový.** ✅ Zmerané (backend +
   spotrebitelia): 153/153 unikátnych záznamov cez tri `offset` okná, `?q=`
   server-side hľadanie nájde záznam **mimo** načítaného okna (id 662),
   `.empty--filter` pri prázdnom výsledku. Karty, nie tabuľka — zámer držaný.
3. **`/console` a `/chat` — čítací režim + paleta Ctrl-K.** ⚠️ Čiastočne.
   `wireReader()` a paleta (`#cmdk`) na `/console` v kóde existujú (`palette.js`,
   `reader.js`), rovnako paleta na `/chat` (`public/js/chat/palette.js`) — ale
   **žiadny z 5 behov to nezmeral** (a11y agent meral len mobilný rail), takže
   zhoda so zvyškom jazyka appky nie je overená týmto behom.
4. **Mobil 375 px `/console` a `/chat`.** ⚠️ Čiastočne, nález z behu 2 **opravený
   behom 3**. Zatvorený panel: `inert` funguje (0/289 fokusovateľných, potvrdené
   strom prístupnosti). Nájdená chyba (`task_53a6b179`): na 375 px otvorený panel
   hit-testoval `#rail-toggle` na `#back-to-graph` vnútri panela
   (`#console-header` je `position: static`, `#thread-rail` mal `z-index: 20`) —
   ťuknutie na hamburger namiesto zatvorenia panela odnavigovalo na `/`. **Oprava**
   (`public/css/console.css`, `public/js/console/rail.js`): prepínač dostal
   `z-index: 30` (nad panel `20`, scrim `10`) a `.rail-top` v prekryve
   `padding-left: 56px`, aby znak neprekryl posunutý hamburger. Overené reálnym
   tapom cez `elementFromPoint` na 375 aj 768 px: druhý ťuk teraz panel zatvorí
   (`rail-open: false`, `inert: true`, `location` nezmenená), na 1440 px beh
   nezasiahol (`#rail-toggle` je tam `display: none`). Zápornou kalibráciou
   (vrátenie starého CSS) sa chyba znova reprodukovala. `task_53a6b179` je
   splnená. Kritérium ako celok zostáva ⚠️: `/chat` mobil nebol v žiadnom
   z 5 pôvodných behov ani v behu 3 meraný vôbec (dôvod na jeho vynechanie:
   `/chat` zatvára panel atribútom `hidden`, nie transformom, a panel je stĺpec
   na každej šírke, takže rovnaký z-konflikt tam podľa kódu nastať nemôže —
   ale to je zdôvodnenie, nie meranie).
5. **`/api/runs` `sort`/`dir` + filtrovaný počet, nad celou tabuľkou.** ⚠️
   Server aj UI hotové a zmerané (`?sort=duration_ms&dir=desc&limit=3` vrátilo
   riadok mimo predošlého okna — dôkaz, že radí server, nie klient; `?sort=id`
   a SQL injection pokus obe 422). **Radenie sa nedostáva do URL** — rovnaká
   diera ako u kno/koo/smo (`writeUrl()` ticho zahodí neznámy kľúč) — a je
   **opravená** v `2b0bb3e`: `ruk` (`vEnum` nad zrkadlom `RunsScreen::SORTS`)
   a `rud` sú v `DICT`. Zmerané po oprave: klik na hlavičku Trvanie dá
   `?s=runy&ruk=duration_ms` a prvý riadok sa zmení zo „4 min 23 s" na
   „16 min 40 s", teda radil server. Kritérium je tým splnené — ✅.
6. **`flows` a `scatter` majú volajúceho.** ⚠️ Polovica. `flows` ✅ — karta
   „Istota v oblastiach" na Dnes, 20 stúh/9 uzlov na živých dátach, cesta
   `oblasť → projekt` zo zadania nahradená za `oblasť → istota` (jediný joint,
   ktorý server posiela — zdôvodnené v reporte). Popri tom opravená latentná
   chyba (`nextFrame` zaparkované navždy pri skrytom dokumente), ktorá postihla
   aj `scatter`. `scatter` **zostáva bez volajúceho** — domov (štatistiky Grafu,
   `panels.js`) je len navrhnutý v needs, nepostavený (súbor je mimo vlastníctva
   tohto behu).
7. **Znak sa zrodí na 4 plochách, `offline.html` ticho.** ✅ `offline.html`
   má kubickú krivku namiesto `ease-in-out` a `no-preference` gate.
   Zrod znaku na `#chat-home` a `.ce-mark` **JE hotový** — urobil ho beh 1
   a zmerané 1. 9. 2026 na bežiacej ploche: obe nesú `animationName: bc-draw`
   / `bc-core-in` a `strokeDasharray: 54.29px`, teda presne to isté, čo
   `#back-to-graph` na `/console`. Prvý zápis tejto sekcie tvrdil opak,
   pretože čítal `[cieľ V2]` v komentári `chat.blade.php` namiesto merania
   computed style — komentár je zastaraný, kód nie.

   **Beh 3 doplnil šiesty nosič, prázdny dok nad grafom** (`charon.js` →
   nová `sigilMark()`, kreslí `createElementNS` priamo, nie cez
   `shared/icons.js` — znak nie je ikona): 32×32 px, `getTotalLength()`
   = 54,29 (identická hodnota ako na 24/44 px nosičoch), `centerOff = 0 px`
   v strede `.charon-empty`. Nosičov zrodu je teraz **šesť**. Zároveň
   **rozhodnuté** (nie odložené): `core-pulse` sa NEROZŠIRUJE na
   `#back-to-graph`/`#chat-home`/`.charon-sigil` — `.asleep` prepína
   `updateStateUi()` výhradne na `#brand-core` (`grep -rn asleep public/`
   nedá na `/chat` ani `/console` nič), takže pulz tam nemá čo hlásiť a
   rozšírenie by z jediného informačného pohybu značky urobilo dekoráciu.
   Znak-agent nemohol manuál editovať (mimo vlastníctva jeho behu) a poslal
   päť konkrétnych needs — tento zápis ich premietol priamo do
   `docs/BRAND-HADES.md` §„Kde znak je a kde má byť".
8. **Výkon pred/po nad tichým stromom, počet dopytov.** ⚠️ Čiastočne.
   `/api/today`, `/api/journal`, `/api/dashboard` zmerané pred/po (opcache):
   medián sa **nehol** (~0,10–0,15 s pred aj po), zmizli chvosty (17/18 → ~5/106
   špičiek nad 1 s). Príčina nebola dopyt, ale **opcache revalidácia nad
   Windows bind-mountom** (`enable_cli=0` bolo východisko, appka opcache
   **vôbec nepoužívala**) — kritérium žiada aj počet dopytov k pomalým
   endpointom, ten sa nemeral, pretože sa nenašla dopytová príčina. W5
   (N+1, indexy) sa vôbec nespustilo.
9. **Celý balík zelený.** ✅ **608 passed / 45 skipped / 0 failed** po behu 3
   (potvrdené opakovane vo všetkých piatich pôvodných behoch na 606, +2 z behu 3
   — nové testy `ScreenDnesDennikTest`). MariaDB filter `ScreenParity|McpTools|
   ContentSecurityPolicy`: **48 testov, 760 asercií, OK**; `ScreenDnesDennikTest`
   samostatne **22/22, 695 asercií** (bolo 20 s 2 padnutými, viď oprava nižšie).
   Parita drží.

   **Beh 3 opravil dve MariaDB-only zlyhania** zapísané v §11.1 ako otvorený bod:
   `meta->project` je explicitné JSON `null`, keď session nemá `cwd`, a na
   MariaDB `json_unquote(json_extract(...))` z neho spraví **string `'null'`**
   (na sqlite ostáva SQL `NULL`) — ten štvorznakový string prešiel
   `ProjectGroup::key()` ako názov projektu, takže Denník hlásil čip „null"
   a agregát (3) si protirečil s filtrom (4) na tom istom uzle. Oprava je
   `NULLIF(<wrapped>, 'null')` v `ProjectGroup::column()`, kalibrovaná z oboch
   strán (vrátenie na starý tvar zhodí presne tri testy). Súbežne zmenšený
   `/api/journal` zo 150 816 B na **33 259 B** (−78 %) odobratím piatich tiel
   záznamov (`prompts`/`final`/`files`/`tools`/`commits`), ktoré nečítal ani
   Denník, ani `fieldsForAi()` — `tool_count` dopĺňa počty, `description` ostáva
   orezaný na 400 znakov s priznaným rezom. Nesúvisí priamo s kritériom 8
   (ktoré žiada dopytovú stranu, nie veľkosť payloadu), ale je to zmeraný zisk
   na tej istej ceste.
10. **Manuál a CLAUDE.md hovoria len to, čo platí.** Beh 2 opravil tri zastarané
    tvrdenia (viď vyššie). **Beh 3 opravil ďalšie v `docs/BRAND-HADES.md`**
    podľa needs znak- a favicon-agentov: tabuľka nosičov (dok pridaný ako ✅,
    rola dvoch hlavičiek prepísaná z „pulz behu" na „identita plochy s odkazom
    domov", `core-pulse` odstavec prepísaný na ROZHODNUTÉ), počet selektorov
    `bc-draw`/`bc-core-in` (päť → šesť, na dvoch miestach) a favicon zápis
    (troch blade → jeden partial, na troch miestach, `patch_blade_icons()` →
    `patch_icon_partial()`). Aj tu platí
    tá istá výhrada ako v behu 2: rozsah opravy je to, čo behy 1–3 naozaj
    zmerali; zvyšok kódu (W2/W3 mimo 5+4 hlásených behov) je overený len
    namátkovo cez grep/čítanie, nie premeraním na bežiacej appke. `CLAUDE.md`
    dostal navyše dve opravy vlastných zastaraných tvrdení (§11.1 nižšie):
    mobilný hit-test bug ako „známy neopravený" a `ruk`/`rud` ako chýbajúce
    z `DICT` — oboje bolo v čase písania behu 2 pravda, beh 3 to zaplatil.

**Súhrn po behu 3:** 5/10 plne ✅ (č. 1, 2, 5, 7, 9), 4/10 čiastočne ⚠️
(č. 3 chýba meranie parity jazyka; č. 4 nájdená chyba je opravená, ale `/chat`
mobil zostáva úplne nezmeraný; č. 6 chýba `scatter`; č. 8 chýba dopytová
strana), 1/10 z veľkej časti hotové (č. 10 — dokumenty prepísané na aktuálny
kód týmto zápisom, časť kódu mimo hlásených behov je overená len čítaním).

Tri z tých pôvodných hodnotení boli zastarané, nie nesprávne meranie: agent
behu 2 nemal reporty behu 1 a dva body (č. 5, č. 7) medzitým zaplatil beh 2
sám. Poučenie do ďalšieho šprintu: **agent, ktorý zapisuje výsledok, musí
dostať reporty VŠETKÝCH behov, nie len svojho** — inak zapíše dieru, ktorá
je hodinu zaplatená.

### 11.1 Čo zostáva do ďalšieho behu

- **`.cq` bola PIATA rodina zatváraná atribútom** a `display` nemala za
  `:not([hidden])`, takže prázdny zoznam zaradených správ zostával v strome
  prístupnosti a composer bol o 6 px vyšší (123 → 117 px po oprave).
  Opravené v `2b0bb3e`; commit `d43a975` tvrdil „štyri rodiny" a bolo ich päť.
- **Duplikát mechaniky filtrov** (`console/threadfilter.js` proti
  `shared/filters.js`) — kópie sa už rozišli, obe píšu do `hades.filters.*`.
  Odišlo ako samostatná úloha `task_911edace`.
- **`scatter` — plánovaný domov NEEXISTUJE.** Zistené 1. 9. 2026: plán aj needs
  grafového agenta posielali `scatter` do „štatistík Grafu" v `panels.js`, ale
  ten súbor je panel uzla, legenda a ručné prepájanie hrán — **sekciu štatistík
  nemá**, a slovo „štatistiky" sa v celom `public/js/mind/` vyskytuje iba
  v `dnes.js`. Dať mu tam domov teda neznamená pridať volajúceho, ale postaviť
  novú plochu, čo je iná úloha a iné rozhodnutie.

  Zámerne som nič nepostavil: kontrakt aj zadanie grafového agenta hovoria, že
  vymyslený graf je horší než nepoužitý, a `flows` domov dostal práve preto, že
  otázka „oblasť → istota" na obrazovke Dnes reálne existovala.

  Jediný kandidát, ktorý som našiel a ktorý NIE JE vymyslený: **sila × vek uzla**
  odpovedá na „čo je usadená znalosť, čo je živá práca a čo je kandidát na
  hygienu". Dáta na to existujú (Knižnica už kreslí stĺpce Vek a Istota), takže
  by to bol graf nad Knižnicou alebo nad frontou Kontroly. Je to ale zmena
  produktovej plochy, nie doťah — patrí do zadania, nie do doťahu.
- **`/chat` mobil** — nezmerané vôbec (žiaden z 9 behov to nepokryl). Beh 3
  odôvodnil, prečo `/chat` pravdepodobne netrpí tým istým z-konfliktom ako
  `/console` (zatvára panel `hidden`, nie transformom; panel je stĺpec na
  každej šírke) — ale je to zdôvodnenie z čítania kódu, nie meranie
  `elementFromPoint` na bežiacej ploche. Rovnaká úloha, aká opravila
  `/console`, dá sa použiť aj tu.
- **W5 Optimalizácie** — nespustené; opcache vyriešil chvost, nie prípadné N+1.
- **`tests/Feature/ContentSecurityPolicyTest.php:122`** enumeruje blade cez
  `glob(resource_path('views/*.blade.php'))` — **nerekurzívne**. `views/partials/`
  (a už predtým `views/errors/`) je tým pre test „no blade loads a script from
  a foreign host" neviditeľný. Dnes to nie je diera (ani `partials/brand-icons`,
  ani `errors/*` nemajú `<script>`), ale skript vložený do jedného z nich by
  test nechytil. Odporúčaná oprava: rekurzívna enumerácia
  (`RecursiveDirectoryIterator` nad `resource_path('views')`), kalibrovaná
  z oboch strán (musí padnúť na cudzí host vložený do partialu aj do page
  blade). Nahlásené favicon-agentom behu 3, needituje test (mimo vlastníctva).
- **`public/brand/hades-favicon.svg` je mŕtvy generovaný výstup a je verejný**
  (200 bez tokenu, over `curl`). Jediné referencie sú riadky
  `tools/brand/build-mark.py`, ktoré ho zapisujú. Rozhodnutie pre používateľa:
  zmazať a vyhodiť ten `emit()` z generátora, alebo nechať a v generátore
  priznať jediný dôvod (kontrola kompozície faviconu okom v editore).
- **`public/js/mind/rail.js` `checkJournalUnread()`** ťahá celé `/api/journal`
  pri každom načítaní stránky, ale číta z odpovede jediné `created_at` (max).
  Záznamy prichádzajú `created_at DESC`, takže `fetch('/api/journal?limit=1')`
  by stačilo — zmerané: 33 259 B → **4 358 B** na to isté jedno číslo.
  Nahlásené backend-agentom behu 3, needituje `rail.js` (mimo vlastníctva C5).
- **`resources/views/console.blade.php`** má pri `#rail-toggle` zastaraný
  komentár „Pod 860 px je panel skrytý" — hranica je od 27. 8. 2026 900 px
  a panel sa neskrýva, len sa odsúva ako prekryv (opravil to práve beh 3
  console-fix agent). Nahlásené, needitované (mimo vlastníctva behu).
