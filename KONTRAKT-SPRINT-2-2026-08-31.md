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

_(dopíše sa po behu)_
