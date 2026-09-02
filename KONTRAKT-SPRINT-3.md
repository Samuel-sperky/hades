# Kontrakt: Sprint 3 — sieťový znak a doťah matice schopností

**Dátum:** 1.–2. 9. 2026 · **Branch:** `feat/hades-redesign` · **Veľkosť:** L (20 agentov,
jeden fan-out)
**Stav:** beh dobehol, tento zápis je jeho záznam — kontrakt vznikol súbežne
s výsledkom, nie pred ním (viď §0).

Nadväzuje na `KONTRAKT-SPRINT-2-2026-08-31.md` (tabuľka + panel pre Knižnicu,
Kontrolu, Smernicu; jazyk grafov; branding doťah) a na `docs/UX-AUDIT-2026-08-19.md`
resp. jeho aktualizovanú maticu schopností naprieč ôsmimi obrazovkami a troma
plochami (`/`, `/console`, `/chat`), ktorá po Sprinte 2 ešte obsahovala prázdne
bunky (uložené filtre, klávesový kurzor, radenie v URL, prázdne/chybové stavy,
mobilná podlaha 44 px, dáta pre `flows`/`scatter`).

---

## 0. Poznámka k tomuto zápisu

Na rozdiel od Sprintu 2 nebol pre tento beh vopred napísaný kontrakt so
schváleným odhadom spendu — 20 agentov bežalo naraz na základe priameho
rozhodnutia používateľa (§2) bez samostatnej kontraktovej fázy. Tento dokument
je preto **spätný záznam**: cieľ a rozsah rekonštruuje z toho, čo agenti
reálne dostali za úlohu a čo odovzdali, nie z plánu napísaného vopred. Kde
report agenta obsahuje presné meranie, je prevzaté; kde nie, je označené
NEZMERANÉ.

---

## 1. Cieľ

Dve nezávislé veci naraz:

1. **Vymeniť znak** zo sústredných prstencov za **sieť** — appka je sieť pamäti
   a znak mal odvtedy, čo redizajn ukázal Graf ako plátno priehľadných
   prstencov, hovoriť ten istý jazyk ako to, čo predstavuje.
2. **Zavrieť zvyšné prázdne bunky matice schopností** zo Sprintu 2 — uložené
   filtre, klávesový kurzor, radenie v URL, prázdne/chybové stavy, mobilná
   podlaha — na obrazovkách a plochách, ktoré ich do vtedy nemali, a urobiť to
   **meraním na bežiacej appke**, nie čítaním kódu.

---

## 2. Rozhodnutia používateľa (1. 9. 2026)

| Otázka | Rozhodnutie |
|---|---|
| Tvar znaku | **sieť** — jadro + 3–4 uzly, **jeden uzol sýty** (jadro) |
| Pohyb znaku | **bohatší, celý v CSS** — nie SMIL (nectí `prefers-reduced-motion`, prehliadače ho v `<img>`/favicone neanimujú) |
| Veľkosť behu | **všetko naraz, 20 agentov** — jeden fan-out, nie vlny s bránami ako Sprint 2 |

Dôsledok rozhodnutia „všetko naraz": bez W1 baseline vlny (Sprint 2 ju mal a
zaplatil ňou objav, že tvrdenia o výkone boli zastarané) agenti merali
každý svoj vlastný východiskový stav priamo v úlohe. Riziko dvoch
zapisovateľov nad jedným súborom (Sprint 2 §2) bolo znova riešené
**disjunktným vlastníctvom súborov** (§6), tentoraz bez explicitného
kontraktového textu — vlastníctvo si niesol každý agent v zadaní.

---

## 3. Zmerané východisko (1. 9. 2026, pred behom)

| Vec | Stav |
|---|---|
| Testy | 608 passed / 45 skipped (baseline zo Sprintu 2) |
| Znak | sústredné prstence, `docs/BRAND-HADES.md` §2 ho tak aj opisoval |
| `urlstate.js` DICT | 43 kľúčov — chýbali osi Dnes/Denníka/Knižnice/Kontroly/Smernice a `/console` filtra modelu |
| Klávesový kurzor tabuliek | len Kontrola a Denník (vlastné, neopakovateľné implementácie); Runy, Rozhodnutia, Knižnica, Smernica nič nemali |
| `charts.js` | `scatter()` v kóde, bez volajúceho (Sprint 2 §11.1) |
| `GET /api/console/threads` | bez `counts`, bez `offset`, `pinned`/`archived` `null` na všetkých riadkoch |
| `--target-min` | token neexistoval, osem ovládačov appky pod 24 px na 1440 aj na mobile |

---

## 4. Rozsah — čo sa reálne robilo

Rekonštruované z odovzdaných prác (§7), zoskupené podľa toho, ČO sa zatváralo,
nie podľa vlny:

- **Znak.** Nová sieťová geometria na troch nezávislých miestach (`SIGIL_NET`
  v `util.js`, `net_geometry()` v `build-mark.py`, kontrakt `.bc-mark`
  v `mind.css`), nové pravidlo redukcie, prepis všetkých nosičov (rail,
  `/console`, `/chat`, dok nad grafom, spinner, 401, Electron), nový slovník
  pohybu (uzly → hrany → jadro), regenerované assety (`public/brand/**`,
  favicony, lockupy, OG).
- **Klávesový kurzor tabuliek** — spoločný modul (`table.js` + `shortcuts.js`)
  pre Runy, Rozhodnutia, Knižnicu; Kontrola a Denník zostali na vlastnej
  implementácii (zámerne, iná sémantika).
- **Uložené filtre, „ďalších N", chybové/prázdne stavy, URL stav** — Dnes,
  Denník, Knižnica, Kontrola, Smernica, `/chat` (história), `/console`
  (vlákna) — každá obrazovka samostatný vlastník.
- **URL slovník** — 11 chýbajúcich kľúčov doplnených do `DICT` naraz, jedným
  agentom, po tom, čo ich obrazoviek-agenti nechali napísané, ale nezaradené
  (rovnaká trieda diery ako `kno`/`koo`/`smo`/`ruk`/`rud` zo Sprintu 2).
- **`GET /api/console/threads`** — `counts.total`, `offset`, `pinned`/`archived`
  ako boolean nad timestampom, 8 nových testov.
- **`charts.js`** — `scatter()` a jeho jediný helper `gridLines()` zmazané
  (zmerané rozhodnutie, nie diera — §7 bod „Jazyk grafov"), prázdne stavy
  pre `heatmap`/`donut`/`growthLine` doplnené.
- **`--target-min: 24px`** — WCAG 2.5.8 (AA), nie 2.5.5 (AAA); jedna menovaná
  výnimka na 44 px (lišta uložených filtrov pod 768 px).
- **Mobilná podlaha `/console`, `/chat`, `/`** — `elementFromPoint` overenie
  na desiatkach ovládačov na 375 px, dve opravy CSS (`chat.css`
  `.ct-filter`, `console.css` `.auto-accept`).
- **Dokumentácia** — tento zápis, `docs/BRAND-HADES.md` §2 prepísané, §3
  doplnené, `CLAUDE.md` doplnené (tento agent).

---

## 5. Rozsah po plochách/obrazovkách — kto čo zatvoril

| Oblasť | Čo pribudlo |
|---|---|
| Dnes | URL kľúč `dng` (obdobie karty rastu), chybový stav s akciou, hero po vyriešení poslednej položky, odznak istoty vo fronte |
| Denník | URL kľúče `deo`/`dez` (klientske osi), klávesový kurzor (vlastný, id-based) |
| Knižnica | uložené filtre, klávesový kurzor (cez spoločný `table.js`), URL radenie `knk`/`knd`, chybový stav |
| Kontrola | uložené filtre, chybový stav Hygieny s fokusovým dlhom, URL radenie `kok`/`kod` |
| Smernica | filtre (text + obdobie), uložené filtre, stĺpec „Kedy" + radenie, URL stav, klávesový kurzor (vlastné API, čaká na `shortcuts.js`) |
| `/chat` | uložené filtre nad hľadaním histórie (`saved.js`), klávesový kurzor nad zoznamom vlákien (`cursor.js`), mobilná podlaha `.ct-filter` |
| `/console` | duplicitná mechanika uložených filtrov zmazaná (nahradená zdieľanou), URL stav pre `q`, klávesový kurzor nad `.tr-open`, `--target-min` mobilná oprava `.auto-accept` |
| Backend | `ThreadController` `counts`/`offset`/`pinned`/`archived`, 8 testov, kalibrácia deviatimi mutantmi |
| `charts.js` | `scatter()`/`gridLines()` zmazané, prázdne stavy pre `heatmap`/`donut`/`growthLine` |
| `urlstate.js` | 11 kľúčov doplnených do `DICT` (43 → 54) |
| `mind.css` | znak prekreslený na sieť, `--target-min` token + 8 selektorov, kresba `.record.selected`, drobné opravy (odstup, mobilné stĺpce) |
| Znak (generátor + carriers) | `tools/brand/build-mark.py`, `util.js`, `charon.js`, blade markup na troch plochách, Electron, 401, všetky brand assety |

---

## 6. Vlastníctvo súborov (disjunktné, tak ako ho niesol každý agent v zadaní)

| Skupina | Súbory |
|---|---|
| Znak — generátor | `tools/brand/build-mark.py`, `tools/brand/build-raster.js`, `public/brand/**` |
| Znak — web kontrakt | `public/js/mind/util.js`, `public/js/mind/charon.js`, `resources/views/*.blade.php` (inline SVG bloky), `electron/**` |
| `public/css/mind.css` | jeden vlastník po celý beh |
| `public/css/console.css`, `chat.css`, `charon.css` | jeden vlastník |
| `public/js/mind/screens/kniznica.js` · `kontrola.js` · `smernica.js` · `dennik.js` · `dnes.js` | päť samostatných vlastníctiev |
| `public/js/mind/table.js`, `shortcuts.js` | jeden vlastník (klávesový kurzor) |
| `public/js/mind/urlstate.js` | jeden vlastník, posledný v poradí (potrebuje hotové obrazovky) |
| `public/js/charts.js` | jeden vlastník |
| `public/js/chat/**`, `public/js/console/**` | dvaja vlastníci |
| `app/Http/Controllers/Console/ThreadController.php`, `tests/Feature/ConsoleThreadListTest.php` | jeden vlastník |
| `docs/**`, `CLAUDE.md`, tento kontrakt | tento agent |

---

## 7. Výsledok — bod po bode

Zdroj je report každého agenta (plný text je v transkripte session, nie
duplikovaný sem — čísla nižšie sú z neho prevzaté, nie prepočítané znova
týmto zápisom, okrem testov, ktoré tento agent spustil sám).

### 7.1 Znak — HOTOVÉ, zmerané opakovane z troch nezávislých generátorov

Nová konštrukcia (jadro plný kotúč r 2,6 + tri nepravidelné satelity-prstence
r 1,9 + štyri hrany vrátane jednej chordy, ktorá mine jadro) je vo **všetkých**
nosičoch, ktoré appka má: rail `/`, hlavičky `/console` a `/chat`, prázdne
stavy na oboch, dok nad grafom, spinner (`.load-mark`, prestal byť CSS
`border`), `errors/401.blade.php`, Electron topbar aj offline stav.

Kalibrované z oboch strán opakovane (nie raz): generátor sám padol na prvom
návrhu geometrie (`NET_CORE_BOX = 44` dalo hranu 1,25 jednotky, pod prahom
6,0) a bol opravený predtým, než vydal čokoľvek; `pathLength="100"` overené
rasterizáciou (s ním 10,8 % nakreslenej hrany pri dashoffset 90, bez neho
100 %); tichá verzia overená `Animation.currentTime` posunom (Browser pane má
`document.hidden === true`, takže `document.timeline.currentTime` stojí na 0
a čakanie na dosadnutie by dalo falošný „zamrznutý" nález).

Tri nezávislé geometrie (web `SIGIL_NET`, python `net_geometry()`, CSS
kontrakt `.bc-mark`) dnes súhlasia (rovnaké pomery, rovnaké dĺžky hrán), ale
nič v kóde to nevynucuje — je to zapísané ako riziko do `docs/BRAND-HADES.md`
a `CLAUDE.md`, nie vyriešené štrukturálne. Presne tento rozchod postihol
kruhový znak do 28. 8. 2026.

**Nález, ktorý zostáva otvorený:** `--brand-gold` nie je prepnuté na svetlú
tému (1,74:1 voči papieru proti `--gold-text` 4,92:1) a nový znak stavia jadro
do role jediného sýteho prvku, takže na svetlej téme sa mu stráca kontrast o
niečo viac, než strácal starému prstencu. Rozhodnutie (ktorý token má jadro
niesť na všetkých nosičoch) nie je urobené — je to v §8 nižšie.

### 7.2 Klávesový kurzor tabuliek — HOTOVÉ na troch obrazovkách, zámerne nedotknuté na dvoch

`table.js` (`tableRows`, `tableCursorRow`, `moveTableCursor`) + riadok v
`shortcuts.js` dali `j`/`k`/`↑`/`↓`/`Home`/`End` Runom, Rozhodnutiam a
Knižnici bez štvrtej kópie logiky. Kurzor je stav v DOM (`.rec-row.selected`),
nie premenná — prekreslenie ho nemusí dorovnávať. Vedľajšia oprava: Enter na
fokusovanom riadku predtým súčasne otváral panel AJ prepínal filter grafu
(spiaca chyba, chytená až týmto kurzorom, pretože predtým sa na riadok dalo
dostať len Tabom).

Kontrola (vlastná sémantika štartu — index 0, nie −1) a Denník (nemá
`<table>`, id-based kurzor kvôli rastu zoznamu nahor) zostali na vlastných
implementáciách — zmerané rozlíšiteľným podpisom (rôzny počiatočný index),
nie len tvrdené.

Smernica dostala vlastné API (`dirMove`, `dirCursorRow`) bez pripojenia do
`shortcuts.js` — je to nahlásená potreba, čaká na vlastníka toho súboru.

### 7.3 Uložené filtre, prázdne/chybové stavy, „ďalších N" — HOTOVÉ na siedmich miestach

Dnes, Denník, Knižnica, Kontrola, Smernica, `/chat` (história), `/console`
(vlákna) majú `renderSavedFilters` zo zdieľaného `shared/filters.js` —
**žiadna nová druhá mechanika**; `/console` naopak stratila svoju druhú
kópiu (duplikát, ktorý inak vznikol paralelne so zdieľaným modulom).
Chybové/prázdne stavy majú vlastný predmet a jednu akciu (manuál §8),
overené vynúteným zlyhaním `fetch` na živej appke, nie čítaním kódu.

### 7.4 URL — 11 kľúčov doplnených, jedna trieda chyby zaplatená znova

`urlstate.js` DICT narástol zo 43 na **54** kľúčov (`dng`, `deo`, `dez`,
`knk`, `knd`, `kok`, `kod`, `smp`, `smk`, `smd`, `cm`). Presne tá istá trieda
diery, akú Sprint 2 zaplatil pri `kno`/`koo`/`smo`/`ruk`/`rud` — obrazovka
napísala zápis do `writeUrl()` správne, kľúč chýbal v slovníku a `writeUrl()`
ho ticho zahodil — sa stala znova na jedenástich miestach naraz, pretože
päť obrazovkových agentov bežalo paralelne bez spoločného slovníka pred sebou.
Zaplatená jedným agentom na konci, s enumami overenými grepom nad živým kódom
(nie odvodenými zo zadania), a s deep-linkmi overenými pre každý kľúč.

### 7.5 `GET /api/console/threads` — HOTOVÉ, 8 testov, kalibrované deviatimi mutantmi

`counts.total`, `offset` (`sometimes|integer|min:0|max:100000`), `pinned`/
`archived` ako boolean nad `pinned_at`/`archived_at` timestampom. Radenie
`CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END` pred `last_message_at DESC`.
Deväť mutantov (chýbajúce pole, celkový počet nad celou tabuľkou namiesto
filtrovaného rozsahu, sanitizácia namiesto odmietnutia, prepis timestampu pri
opakovanom pripnutí…) každý rozbil aspoň jeden test.

### 7.6 `charts.js` — `scatter()` zmazané, nie ponechané ako mŕtvy kód

Zmerané, prečo: jediný reálny kandidát na dvojrozmerný tvar (`/api/mind`,
sila × vek uzla, 1 223 uzlov) preťažuje plochu 320×180 (150 % preplnenie
farbou, 81 % bodov nerozoznateľných na polovičnú pixelovú pozíciu) a
`bindTip` viazal 3 669 listenerov na kartu. `gridLines()` (jediná volajúca
bola `scatter()`) odišla s ním. Prázdne stavy pre `heatmap`/`donut`/
`growthLine` doplnené (predtým 3 z 5 typov nehovorili `.chart-empty`).

### 7.7 `--target-min: 24px` — HOTOVÉ, štyri návrhy na 44 px ODMIETNUTÉ

Osem selektorov dostalo token na miesto `min-height: auto` (nie ako siedme
prekrývajúce pravidlo). Zdvih na 44 px (WCAG AAA) bol navrhnutý štyrikrát
(Dnes, Denník, Smernica, Kontrola/Knižnica) a **odmietnutý**: tento súbor si
sám deklaruje latku 2.5.8 AA = 24 px, a 44 px by merateľne rozbilo stĺpec
akcií Kontroly na mobile (tri tlačidlá potrebujú 194 px, cela má 172 px) —
a bolo by to nepravdivo označené ako „mobilné", keď defekt je aj na desktope.
Jediná prijatá výnimka na 44 px je lišta uložených filtrov pod 768 px —
zjednotená s hodnotou, akú si `/chat` a `/console` dali samostatne pár dní
predtým.

### 7.8 Mobilná podlaha — HOTOVÉ na `/console`, čiastočne na `/chat`

Nájdené a opravené: `input.ct-filter` na `/chat` (375 px) malo `min-height: 34px`
namiesto deklarovaných 44 px — špecificita `(1,1,1)` prehrala proti
`(0,3,1)` v `mind.css`; opravené scopovaným `#chat-app input.ct-filter`.
`.auto-accept` na `/console` malo šírku 29 px namiesto 44 (výška bola, šírka
nie); opravené `min-width` + centrovanie. Overené `elementFromPoint` na 303
ovládačoch `/console` a desiatkach na `/chat` po opravách — 0 pod 44 px mimo
zdokumentovaných výnimiek (`.skip-link`, natívny `<input>` checkbox).

---

## 8. Čo zostáva do ďalšieho behu

- **`--brand-gold` nie je prepnuté pre svetlú tému** (§7.1) — jadro nového
  znaku je jediný sýty prvok a na svetlej téme má 1,74:1 namiesto 4,92:1.
  Rozhodnutie (ktorý token nosiť na ktorom nosiči) nie je urobené.
- **Tri nezávislé geometrie znaku** (web/python/CSS kontrakt) súhlasia dnes,
  ale nič to nevynucuje štrukturálne — zapísané ako riziko, nevyriešené.
- **`docs/BRAND-HADES.md` §10 („Kanonický slovník kľúčov — 41, úplný")** je
  po tomto sprinte **stale** (DICT má 54 kľúčov, nie 41) — nebolo v rozsahu
  tohto zápisu (§2/§3 boli explicitná úloha), nahlásené, needitované.
- **Smernica — klávesový kurzor bez pripojenia** do `shortcuts.js` (§7.2).
- **`/chat` mobil** zostal z veľkej časti nezmeraný v predošlom sprinte a
  tento beh zmeral len `.ct-filter` — nie celú plochu tak dôkladne ako
  `/console` (303 ovládačov tam, `/chat` menej).
- **`public/brand/hades-favicon.svg`** je stále mŕtvy generovaný výstup,
  verejný bez tokenu (Sprint 2 §11.1 to už nahlásil) — rozhodnutie
  zmazať/priznať dôvod nepadlo ani v tomto sprinte.
- **`errors/401.blade.php` favicon** zostáva mimo `partials/brand-icons.blade.php`
  zámerne (vlastný výkres) — otvorená otázka zo Sprintu 2 (zjednotiť vs.
  ponechať) trvá.
- **W5-štýl optimalizácie** (N+1, indexy pod pomalými endpointmi) sa v tomto
  behu vôbec neriešili — mimo rozsahu, ktorý si agenti dali.
- **Scatter, ak sa niekedy vráti**, musí prísť s volajúcim a s agregáciou
  naraz (hexbin/binning), nie v pôvodnom tvare bodov — inak je to ten istý
  defekt znova, len za iným menom typu.

---

## 9. Testy

`docker compose exec -T app php artisan test` → **616 passed / 45 skipped,
4400 asercií, 93,75 s** (spustené týmto agentom 2. 9. 2026, po celom behu).
Baseline zo Sprintu 2 bol 608 — nárast je presne 8 nových testov
`ConsoleThreadListTest` (§7.5), žiadny iný súbor test nepridal ani nestratil.
MariaDB filter a plný security/CSP prechod tento agent nespúšťal (žiadna
zmena v recalle/embeddingoch/nástrojoch Charóna a žiadna zmena v
auth/uploadoch v tomto behu, ktorú by bolo treba prekontrolovať).
