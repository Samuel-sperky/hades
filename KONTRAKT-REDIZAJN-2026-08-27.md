# Kontrakt — frontend UX/UI, branding, animácie, URL logika

Dátum: 27. 8. 2026 · vetva `feat/hades-redesign` (nová, z `fba459a`)
Záloha: **`feat/hades-ux` drží dnešný funkčný stav** — sqlite 596 passed / 0 failed,
MariaDB 114. Návrat je jeden `git checkout`.

## 0. Cieľ

Dotiahnuť frontend ako **systém**, nie ako sériu záplat: branding, typografia, hustota,
stavy, pohyb, ikony a URL logika. Doteraz sa robili audítne nálezy jeden po druhom —
toto je prvý raz, čo sa rieši jazyk celej appky.

## 1. Odsúhlasené rozhodnutia (30 otázok, 27. 8. 2026)

Poradie je poradie otázok; každé je záväzné pre agentov.

| # | Rozhodnutie |
|---|---|
| 1 | **Manuál značky sa najprv PREPÍŠE** (má diery: animácie, URL, prázdne stavy, ikony, skeletony, hlas), potom sa k nemu UI dotiahne. Manuál je zdroj pravdy. |
| 2 | **Hodnoty palety zostávajú** (amethyst interaktívny, zlatá značková a jadro). Mení sa len **použitie** — hlavne tam, kde základná hodnota slúži ako text a má `-ink` variantu. |
| 3 | **Serif (Playfair) dostane väčšiu rolu** — dnes má jediné miesto (`.hero-val`). |
| 4–5 | **Znak viac prítomný, ale striedmo:** len tam, kde niečo nesie (načítavanie, prázdne stavy, desktop okno, pulz behu). Animácia znaku áno. Favicon a Electron `.ico` **z jedného zdroja**. |
| 6 | **Pohyb nesie informáciu.** Žiadne dekoratívne prechody — model beží ~8 tok/s a na plátne je 2700 uzlov. |
| 7 | Plátno grafu **zostáva** (živý force layout); dolaďujú sa len **prechody** (zanorenie, hľadanie uzla, prílet uzla cez WS). |
| 8 | **Každá nová animácia má tichú verziu** pre `prefers-reduced-motion` — a nie „vypnuté", ale zmysluplný okamžitý ekvivalent. Zapíše sa to do manuálu ako záväzné. |
| 9 | **Do URL patrí:** obrazovka + zanorenie grafu, filtre + hľadanie, vetva konverzácie, stav panelov a artefaktu. |
| 10 | **História:** navigácia (obrazovka, vlákno) = `pushState`; filtre a pohyb v grafe = `replaceState`. |
| 11 | **Obrazovky dát prvé** (Dnes, Denník, Knižnica, Rozhodnutia, Kontrola, Runy). |
| 12 | **Obe témy rovnocenné** — každá zmena sa meria na tmavej aj svetlej. |
| 13 | Hustota: **zdvihnúť dátový text**, chróm (popisky, jednotky, eyebrow) nechať mikro. Namerané: 85,6 % viditeľného textu bolo pod 13 px. |
| 14 | **Prázdny stav učí:** čo to je, prečo je prázdne, **jedna** konkrétna akcia. |
| 15 | **Skeleton v tvare obsahu** — `/api/journal` a `/api/dashboard` bežia 3–4 s. |
| 16 | **Jeden chybový komponent** pre všetky plochy. |
| 17 | **Rail sa rozbalí** na široký s labelmi (80 → ~208 px) s možnosťou zbaliť, persistovane. Zmerané: pri 594 px výšky má rail 562 px a žiadny `overflow-y`. |
| 18 | **Desktop prvý** (1280–1920); na 768–900 px nesmie nič prekrývať. Telefón sa nerieši. |
| 19+21 | **Vlastná sada inline SVG ikon, celá naraz** (**41** použitých ligatúr — pôvodne tu stálo 37, sonda A §4.1 namerala 41; štyri vstupujú do DOM cestami, ktoré grep nad markupom nevidí). Material Symbols subset ide von. |
| 20 | **Hlas vecný a presný** ako teraz; zjednotí sa len terminológia (vlákno/konverzácia, beh/ťah, zápis/uloženie). |
| 22+25 | **Hĺbka = sklo a priehľadnosť, ale LEN na tmavej téme.** Na svetlej plné povrchy — pod polopriehľadnými čipmi tam kontrast textu závisel od obsahu grafu. |
| 23 | **Grafy zjednotiť na jeden jazyk** osi, mriežky, tooltipov a rámp. Heatmapa si drží `role="img"` a `.sr-only` tabuľku. |
| 24+26 | **Veľký redizajn naraz**, na tejto vetve. `feat/hades-ux` zostáva funkčná. |
| 27 | **URL: krátke kľúče, defaulty sa vynechávajú.** Jedno miesto serializuje aj deserializuje. |
| 29 | **Bez stropu spendu.** Rozsah je reálne na 4–6M; zastavím sa na chybách, nie na cene. |
| 30 | **Sondy merajú všetky štyri veci:** inventár dnešného stavu, rozpor proti manuálu, stav v URL a `localStorage`, referenčné appky. |

## 2. Nedotknuteľné (§28)

Aj keby to dizajn navrhoval:

- **Dvojfázová brána zápisov.** Vzhľad karty povolenia sa môže zmeniť, ale mechanika
  a jej texty sú bezpečnostné: zápis zaparkuje, ťah skončí **bez rámca `end`**, obnova
  len z `/decide`, a pri podagentovi ide `/decide` na **jeho** vlákno. „Povoliť vždy"
  sa na karte podagenta **nekreslí**.
- **Živý force layout grafu.** Determinizmus sa **nezavádza** — bola to raz vlastná
  podmienka, ktorá zabila živý dojem siete. `rAF` sa mimo obrazovky Graf **musí zastaviť**.
- **Dvojitá plocha UI = MCP.** Každá obrazovka má serializér a riadok v
  `ScreenParityTest`. Počty, skupiny, filtre a krátenie textu sú **dáta** a patria na
  server; „dnes/včera", formát trvania a šírka baru v px sú **slová**.

## 3. Ďalšie invarianty, ktoré platia ďalej

- Žiadny bundler nad `public/js`, žiadna CDN závislosť (`d3` a `pusher` sú
  self-hostované, `script-src 'self'` drží test).
- Žiadny raw hex/rgba mimo `:root`.
- Jeden globálny `:focus-visible` (0-1-0); `border-radius` v ňom zámerne nie je.
- **`:where()` keď chceš oslabiť, nie `:is()`** — `:is()` berie najsilnejší argument.
- Hoistovaná `export function`, nikdy `export const foo = () => {}`.
- Kresba bloku kódu a kopírovania je **jedna** a je v `mind.css`.

## 4. Ako sa to overuje

- **Dôkaz je zmeraný DOM a computed style, nie screenshot.** Browser pane
  nekompozituje rámce, kým nie je zobrazený — vracia zamrznutý rámec alebo timeout.
  Overené 26. 8. kalibráciou (červený panel cez celú stránku sa v snímke neobjavil).
- Dvojité deklarácie: `w4dup.js`, **kalibrovaný z oboch strán**.
- Kontrast: skladané pozadie, po prepnutí témy merať v ďalšom volaní, kalibrácia na
  `body` ~16:1.
- Ikony: šírka vykresleného glyfu (glyf ≈ 1 em) — platí, kým je subset v hre.
- Testy: `php artisan test` ≥ 596 passed, 0 failed; MariaDB filter 0 padnutých.

## 5. Štruktúra behu

Podľa zadania: **2 sondy** (merajú) → **koordinátor** (zloží sprint plán a prepíše
manuál) → **2 implementátori** (stavajú prvú vlnu). Delenie práce je **podľa súborov**,
nie podľa témy — dva agenti píšuci do jedného súboru sa ticho prepíšu.

## 6. Výsledok

### Vlna 1 — hustota, stavy, pohyb, serif (27. 8. 2026)

Beh: 2 sondy → koordinátor → 2 implementátori. Delenie **podľa súborov** vyšlo:
I1 vlastnil `public/css/mind.css` + hlavičku `mind.blade.php`, I2 sedem obrazoviek,
`util.js`, `structure.js` a `charts.js`. **Prieniku nula** — nikto nikomu nič neprepísal.

Zavedené: tri rolové tokeny hustoty (`--fs-data` 13 px / `--fs-data-chip` 12 px /
`--fs-chart-axis` 11 px) a zdvih 44 deklarácií dátového textu, jeden chybový komponent
`.empty--error` na desiatich call-site šiestich obrazoviek, kostra v tvare obsahu
(rodina `.skel*`, jedna mechanika, perióda `--dur-pulse`), prázdno z filtra
`.empty--filter` s jednou funkčnou akciou, serif na `.screen-head h1` vedľa
`.hero-val`, jeden jazyk osi grafov (`.chart-axis`), sklo len na tmavej cez
`--scrim-blur`, `.ms` fallback + `liga`, neosobný hlas.

**Namerané (DOM a computed style, nie snímka):**

| Vec | Číslo |
|---|---|
| `php artisan test` | 596 passed · 0 failed · 45 skipped (základná čiara) |
| Dvojité deklarácie `mind.css` | A=0 B=1 C=16 · kalibrované na predvlnovom súbore (A=0 B=1 C=17) |
| Kalibrácia chrómu (nesmel sa zdvihnúť) | `.rail-eyebrow` 10 px · `.kpi-label` 11 px · `body` 14 px |
| Preload fontov | presne 6, v poradí zo T9 |
| Kostra: posun videného obsahu | **0 px** titulok, **0 px** zoznam · záhyb vyplnený 98,3 % |
| Kostra pod 300 ms | pri 0 ms sa neobjaví (obsah 1 ms), pri 120 ms sa neobjaví (obsah 132 ms) |
| Inline rozmery a `font-size` v JS | 0 (predtým `font-size:10px` na osi grafu) |
| Chyba na 6 obrazovkách | vlastný predmet + `cloud_off` + presne 1 akcia · iná kresba chyby 0 |
| Kontrast ikony chyby | svetlá **4,02:1** · tmavá **6,65:1** (kalibrácia `body` 15,88 / 16,48) |
| Sklo | svetlá `--scrim-blur: none`, tri scrimy `backdrop-filter: none` · tmavá `blur(4px)` |
| Os grafu | 11 px Geist Mono, prokládka 13,2 px |
| Prvá osoba v DOM | 0 zásahov |
| Načítané moduly | všetkých 11 dotknutých (žiadny mŕtvy kód) |

**Tri veci, ktoré som po implementátoroch zavrel sám** — spadli do medzery medzi
vlastníctvami súborov, takže ich nemohol dokončiť ani jeden:

1. `.skel-list` nenieslo `font-size`, hoci komentár nad `.skel-line` to vyžadoval.
   Bez toho `1em` dedilo 14 px z `body` namiesto 13 px, teda skeleton zachoval presne
   ten CLS skok, ktorý má odstrániť. Zmerané po oprave: riadok = 13 px.
2. `.skel-block--hero` emitoval JS a CSS ho nekreslilo — hero pás Dnes padal na
   default 58 px namiesto 84 px. Zmerané: 84 vs 58.
3. `.shimmer` prežila ako mŕtvy kód a komentár I1 o nej **lhal** („má vo vlne 1 stále
   volajúceho `screens/dnes.js`"). Zmerané: nula volajúcich. Trieda zmazaná,
   `@keyframes hades-shimmer` a `--shimmer-sheen` ostávajú (používa ich `.skel`).

**Šesť odchýlok od litery plánu, všetky prijaté** (každá mala lepší dôvod než plán):
umiestnenie rolových tokenov za škálu, `margin-top` osi 6 px z vymenovaného zoznamu,
`.empty--filter` zámerne bez vlastnej kresby (manuál §8), `renderError` s akciou
v Smernici namiesto `errorHtml`, Kontrola pri `soft` kostru **nekreslí** (plán si
v tej istej sekcii protirečil, manuál §8 rozhodol), a rozšírenie opravy hlasu z piatich
reťazcov na deväť.

**Dve moje vlastné falošné merania, opravené pred zápisom** (patria sem, lebo to je
opakovaná pasca projektu): (a) CLS som najprv počítal ako rast celkovej výšky kontejnera
a dostal „82,9 % pád" — rast pod okrajom nie je posun, správne je 0 px posunu videného;
(b) podlahu `*` v reduced-motion bloku môj regex nenašiel, pretože prehliadač
normalizuje `*::before` na `::before` — podlaha tam je, s `!important`.

### Otvorené (vlna 2 a 3)

URL a hlboký odkaz (rozhodnutia 9/10/27) · 41 vlastných SVG ikon a odchod Material
Symbols · animácie znaku a jeden zdroj faviconu (geometria je zapísaná 8× + raz
v Pythone) · rozbalenie railu 80 → ~208 px · `charon.css` na typografickú škálu ·
chybový komponent na `/console`, `/chat` a v doku · audit 64 pohybov bez pomenovanej
tichej verzie · zjednotenie breakpointov.

**Zavretá otázka (rozhodnutie 31, 27. 8. 2026, používateľ):** filtre a hľadanie do URL
serializuje **klient**. Jeden modul v `public/js` (`mind/urlstate.js`) je jediné miesto,
ktoré query string číta **aj** píše — krátke kľúče, defaulty sa vynechávajú. Server
zostáva zdrojom pravdy pre počty, skupiny a krátenie textu.

Dôvod, prečo tým invariant dvojitej plochy nepadá: **URL nie je obsah, je to poloha
čitateľa.** Do adresného riadka ide *kľúč* filtra, nie jeho vyhodnotenie — dotaz na
server sa nemení. Serverová serializácia by navyše znamenala request na každú zmenu
filtra (dnes 3–4 s na `/api/journal`) a plocha AI by dostala kľúč, ktorý pre model
neznamená nič.

### Vlna 2 + 3 — beh z 27. 8. 2026 (20 agentov)

Rozsah: všetko otvorené naraz. Štruktúra: 4 sondy → koordinačný plán a prepis manuálu →
9 implementátorov (delenie **podľa súborov**; `mind.css` je sekvenčný reťazec A1→A2→A3,
pretože rail, ikony aj pohyb naň siahajú) → 2 agenti výmeny ikonových call-site →
1 agent odchodu Material Symbols → 3 overovatelia (testy, zmeraný DOM, adversariálny
review). Výsledok sa dopíše po behu.

**Dobehlo 13 z 20 agentov; sedem padlo na session limit** (A3 pohyb v `mind.css`,
F1 a F2 výmena ikonových call-site, G odchod Material Symbols, a všetci traja
overovatelia). Ich práca tu **nie je** a vlna 2 preto nie je uzavretá. Podľa
pravidla projektu som ich zmeny nehľadal ani neprerábal — čo pristálo, pristálo
celé; čo nie, chýba celé.

**Čo pristálo (commit `f5f3b8e`):** `mind/urlstate.js` ako jediné miesto v repe,
ktoré query string číta aj píše (37 kľúčov, radené, defaulty sa vynechávajú),
URL na šiestich dátových obrazovkách, v grafe a na `/chat`; prepísaný manuál
značky (1256 → 2026 riadkov) a `docs/PLAN-VLNA2-3.md`; jeden zdroj geometrie
znaku (`public/brand/build-mark.py` + `DERIVED.md`, favicon a Electron `.ico`
z neho); `charon.css`, `console.css` a `chat.css` na typografickú škálu;
kresba `.ic` pre vlastnú sadu a `shared/icons.js` so 61 ikonami.

**Namerané po behu (koordinátor, nie agent):**

| Vec | Číslo |
|---|---|
| `php artisan test` | 596 passed · 0 failed · 45 skipped — základná čiara |
| MariaDB filter | 112 testov OK · 0 padnutých |
| Syntax všetkých dotknutých ES modulov | 0 chýb |
| `export const` arrow v dotknutých moduloch | 0 |
| Hlboký odkaz `?s=graf&a=3&gv=layers&mw=1.5` | obnovil obrazovku, zanorenie, pohľad aj váhu |
| Množinový filter `ft=project&ft=skill&fr=similarity` | obnovil oba Set-y presne |
| Default sa v adrese neobjaví | `mw`=0 → v `location.search` nie je |
| História | navigácia +1 záznam · zanorenie grafu +0 |
| Konzola prehliadača na `/`, `/chat`, `/console` | 0 chýb okrem `ws://` (limit proxy) |

**Medzera po A3, ktorú som zavrel sám:** `charon.css` a `console.css` čítajú
`--ease-pulse`, ktorý mal do `:root` doplniť A3. Agent E to predvídal a zapísal
tie animácie **longhandom** — v shorthande by neznáma hodnota zneplatnila celú
deklaráciu a `animation-name` by spadlo na `none`, teda indikátor behu by
prestal existovať, nie len zmenil krivku. Vďaka tomu appka nebola pokazená, len
degradovaná na `ease`. Token som doplnil; zmerané: rozpustí sa na všetkých troch
plochách.

**Prečo Material Symbols zostáva:** `shared/icons.js` existuje, ale **nemá ani
jedného volajúceho** — F1 a F2 padli. Je to teda dnes mŕtvy kód, presne v zmysle
pasce tohto projektu, a je to zapísané tu, nie zamlčané. Fallback `.ms` drží
všetkých 60 ikon na ploche; odstrániť ho pred výmenou by bola chyba.

**Tri opravy kontraktu, každá overená mnou, nie prevzatá od agenta:**

1. Rozhodnutie 19+21 hovorí **41** použitých ligatúr. Správne je **61**. Vlna 1
   opravila 37 na 41 tým, že našla štyri ikony neviditeľné pre grep; sonda B
   našla **celú šiestu a siedmu cestu** do DOM (ternár v template stringu,
   mapovacie stoly typ → ikona). Krížová kontrola: môj vlastný naivný regex nájde
   40 — teda presne to, čo vidí grep — a `CMDK_TYPE_ICO` v `cmdk.js` nesie
   `brightness_7`, `psychology`, `inventory_2` a `circle`, z ktorých nevidí ani
   jednu. To je dôkaz **pre** číslo 61, nie proti nemu.
2. Geometria znaku nie je zapísaná 8×, ale **16×**.
3. Meraný údaj v rozhodnutí 17 („pri 594 px výšky má rail 562 px a žiadny
   `overflow-y`") je pravdivý len spolovice — výška a `overflow` sedia, ale prah
   je 589 px (588 padne, 589 sadne, kalibrované z oboch strán).

### Zostáva na vlnu 3

Pohyb v `mind.css` (A3), výmena 61 ikonových call-site (F1, F2), odchod
Material Symbols (G), a **celé overenie** — zmeraný DOM naprieč oboma témami,
kontrast nových povrchov a adversariálny review diffu. Plán a vlastníctvo súborov
pre nich sú hotové v `docs/PLAN-VLNA2-3.md`, takže sa dá nadviazať bez nových sond.

**Oprava kontraktu:** rozhodnutie 19 hovorí „37 použitých ligatúr". Správne číslo je
**41** (sonda A §4.1) — štyri vstupujú do DOM cestami, ktoré grep nad markupom nevidí
(`search_off`, `filter_alt_off`, `play_arrow`, `pause`).
