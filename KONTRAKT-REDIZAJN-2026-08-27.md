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
| 19+21 | **Vlastná sada inline SVG ikon, celá naraz** (37 použitých ligatúr). Material Symbols subset ide von. |
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

*(dopĺňa sa)*
