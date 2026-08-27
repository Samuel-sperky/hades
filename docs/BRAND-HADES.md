# Značka Hades

Zdroj pravdy pre vizuálnu a verbálnu identitu Hadesa. Vznikol 19. 8. 2026 z 30
rozhodnutí (`KONTRAKT-BRANDING-HADES-2026-08-19.md`). **Prepísaný 27. 8. 2026**
z 30 rozhodnutí redizajnu (`KONTRAKT-REDIZAJN-2026-08-27.md`, rozhodnutie 1:
manuál sa prepíše prvý, UI sa k nemu dotahuje).

Hades je **samostatná značka**, nie appka Aury. Časť hodnôt sem historicky prišla
z `handoff/AURA-DESIGN-HANDOFF.md`; od tohto dokumentu sú **vlastné** a nemenia sa
s Aurou. Keď sa rozíde Aura, Hades sa nehýbe.

## Ako sa tento manuál čita

Manuál opisuje **cieľový stav**. Kde sa kód od cieľa líši, je to napísané nahlas,
so značkou a s číslom, nie zamlčané:

| Značka | Znamená |
|---|---|
| *(bez značky)* | platí v kóde dnes |
| **[cieľ V1]** | zavádza vlna 1 redizajnu (`docs/redesign-2026-08-27/SPRINT-PLAN.md`) |
| **[cieľ V2]** / **[cieľ V3]** | vlna 2 / vlna 3 |

Manuál, ktorý tvrdí o kóde niečo, čo v ňom nie je, je horší než manuál, ktorý
nemá sekciu. Merania pochádzajú zo sond A a B z 27. 8. 2026 a každé číslo tu má
zdroj — nie dojem.

---

## 1. Identita

| | |
|---|---|
| **Meno** | `Hades` — vždy takto, nie HADES, nie H.A.D.E.S. |
| **Rozpis** | **H**ierarchical **A**ssociative **D**ata **E**mbedding **S**ystem |
| **Definícia** | Živá pamäť, ktorá prežije každú session |
| **Publikum** | jeden človek — používateľ. Značka nemusí nič predávať ani vysvetľovať. |
| **Tón** | technický s jemným mýtom |
| **Jazyk** | UI slovensky, značka a technické pojmy anglicky |

Rozpis skratky **nie je nadpis**. Žije v tooltipe znaku (`#brand-core`), v manuáli
a v decku. V bežnom UI sa nepíše.

### Hlas

Hades hovorí **neosobne**. „V pamäti je…", „Uložené.", nie „Pamätám si…".
Dôvod: pri dlhej práci je entita, ktorá o sebe hovorí v prvej osobe, rušivá —
a mýtus už nesie meno, nemusí ho niesť aj každá veta.

Výnimka je **Charón** (§9): má vlastné meno, lebo je to rozhranie, ktoré s človekom
hovorí. Aj on ale hovorí vecne.

**Pravidlo je vynútiteľné jediným grepom** a treba ho spustiť pri každej zmene
hlásení:

```
grep -rn "Načítavam\|Skladám\|Pamätám\|Hľadám\|Ukladám" public/js/
```

Stav 27. 8. 2026: **päť zásahov** — `kniznica.js:91`, `kontrola.js:72`, `runy.js:41`,
`runy.js:273`, `smernica.js:146`. Dva z nich sú **dva riadky od seba pre tú istú
frontu** (`kontrola.js:71` neosobne, `:72` v prvej osobe), čo je najčistejší dôkaz,
že hlas dnes nie je vynútený ničím. **[cieľ V1]** nula zásahov.

### Slovník vedomia (kanonický)

vedomie · uzol · oblasť · oddelenie · spojenie · jadro · istota

Odchýlky sa nezavádzajú. „Node", „graf uzlov", „entita" v UI nepatria.

### Slovník Charóna (kanonický)

Toto je nová sekcia a existuje preto, že tri pojmy sa dnes v UI miešajú.

| Pojem | Znamená | Nie je |
|---|---|---|
| **vlákno** | jedna trvalá konverzácia s vlastnou URL (`/chat/<uuid>`) | „konverzácia", „chat", „session" |
| **vetva** | odbočka vo vlákne; identita je **uuid**, nikdy poradové číslo | „verzia" |
| **beh** | jeden záznam v `runs` — má stav, cenu, trvanie | „ťah" |
| **ťah** | jedna výmena s modelom vnútri behu | „beh", „request" |
| **zápis** | tool, ktorý mení pamäť alebo súbor a zaparkuje na bráne | „uloženie" |
| **uloženie** | odloženie výsledku pre človeka (napr. smernica do `/api/directives`) | „zápis" |
| **brána** | dvojfázové potvrdenie zápisu človekom | „potvrdenie", „dialóg" |
| **podagent** | beh, ktorý spustil model cez `spawn_agent` | „vlákno" |
| **artefakt** | výstup nástroja otvorený v pravom paneli `/chat` | „súbor", „príloha" |
| **profil nástrojov** | `memory` / `files` / `graph` / `full` / `orchestrator` | „režim" |

**„Beh" a „ťah" sú nezameniteľné a je to dôvod z dát:** ťah, ktorý zaparkuje na
bráne, **nikdy nepošle rámec `end`**, takže cena jeho prvého segmentu by z logu
vypadla, keby sa počítala z behu. `runs.duration_ms` je **wall clock** (obsahuje
minúty, kým sa človek rozhodoval), `tokens_per_second` je z **generovacieho** času.
Sú to dva rôzne údaje a ani jeden nie je chyba — preto sú v UI vedľa seba
a pomenované inak.

**[cieľ V1]** zjednotené na obrazovke Runy a v Smernici. **[cieľ V3]** zvyšok
(`charon.js`, `chat/*`, `console/*`).

---

## 2. Znak

Znak je **sigil zo súosných prstencov** — uzol z plátna povýšený na značku.
Číta sa ako veta: *uzol vstupuje prerušením hranice a je viazaný na jadro.*

### Konštrukcia (viewBox 100 × 100, stred 50 50)

| Prvok | Polomer | Hrúbka | Poznámka |
|---|---|---|---|
| Prstenec A | 46 | 1,5 | hranica vedomia, **prerušená 26°** v smere 52° |
| Stupnica | 42–46 | 0,8 / 1,2 | 60 delení po 6°, každé piate dlhšie; v prerušení mlčí |
| Prstenec B | 34 | 3,5 | nosná hmota znaku |
| Prstenec C | 22 | 1,5 | |
| Hrana | — | 1,6 | od satelitu k jadru, v smere 52°, opacity 0,75 |
| Satelit | 5 | 2,0 | jeden uzol, **prstenec, nie disk**, v strede prerušenia |
| Obežnica jadra | 15 | 1,0 | zlatá |
| **Jadro** | 8,5 | výplň | **jediný plný prvok znaku**, zlaté |

Progresia 46 / 34 / 22 je krok 12. Uhol 52° je jediná asymetria a nesie celý dej —
neposúvať ho „aby to bolo vyvážené"; symetrický znak stráca vetu.

### Jeden zdroj geometrie

**Geometria znaku je dnes zapísaná OSEMKRÁT** a to je porucha, nie stav:

| # | Miesto | Zápis |
|---|---|---|
| 1 | `public/brand/hades-sigil-mini.svg` | asset (r 36 / hrúbka 9 / jadro 15) |
| 2–4 | `mind.blade.php:16`, `chat.blade.php:44`, `console.blade.php:20` | inline data-URI faviconu (bit-identické, md5 `c0ebff62…` × 3) |
| 5 | `mind.blade.php:114–115` | `r 8.64` / `stroke 2.16` / `r 3.6`, `fill="currentColor"` |
| 6 | `console.blade.php:55–56` | tie isté čísla, `fill="var(--brand-gold)"` |
| 7 | `chat.blade.php:86–87` **a** `:182–183` | tie isté čísla, **bez tried** (teda bez animácie) |
| 8 | `public/js/console/render.js:36–46` | tie isté čísla, skladané v JS |
| + | `electron/assets/build-icon.py:13–40` | **znovu implementované v Pythone** s hardcoded RGB tuplami |
| + | `public/css/mind.css:1194` | `stroke-dasharray: 54.29` = 2π × 8,64 — **derivát polomeru zapísaný ako konštanta** |

**[cieľ V2] Jeden generátor, štyri výstupy.** Zdroj je `hades-sigil-mini.svg`;
generátor musí vydať SVG asset, data-URI do Blade, `.ico` **aj** hodnotu CSS
`stroke-dasharray`. Keď niektorý z tých štyroch vypadne, deviaty zápis pribudne
znova — už sa to stalo osemkrát.

Vlastníctvo súborov ikony: **`public/favicon.ico` je koreň pre web,
`electron/assets/hades.ico` pre desktop**, a oba vydáva ten istý generátor. Dnes
`build-icon.py` stavia len ten druhý a generátor `favicon.ico` v repe **nie je**.

`fill="currentColor"` (#5) a `fill="var(--brand-gold)"` (#6, #7) dnes vychádzajú
rovnako, lebo `#brand-core { color: var(--brand-gold) }` — ale sú to **dva
mechanizmy** a jeden z nich zanikne pri prvej zmene farby.

### Kde znak je a kde má byť

Rozhodnutie 4–5: znak viac prítomný, ale **striedmo — len tam, kde niečo nesie**
(načítavanie, prázdny stav, desktop okno, pulz behu).

| Výskyt | Znak | Animuje sa |
|---|---|---|
| rail `/` (`mind.blade.php:114`) | ✅ | ✅ |
| hlavička `/console` (`console.blade.php:55`) | ✅ | ✅ |
| prázdny stav `/console` (`console/render.js:40`) | ✅ | ✅ |
| načítavanie (`.empty-loading .load-mark`) | ✅ | ✅ (dýchanie) |
| hlavička `/chat` (`chat.blade.php:86`) | ✅ | ❌ **chýbajú triedy `bc-ring`/`bc-core`** |
| prázdny stav `/chat` (`chat.blade.php:182`) | ✅ | ❌ to isté |
| prázdny dok nad grafom (`charon.js:694`) | ❌ **znak vôbec nie je** | — |

**[cieľ V2]** všetkých sedem výskytov má znak a animáciu.

### Wordmark

**Cinzel 600**, rozstup **0,06 em**, prevedený **do kriviek**. Cinzel je kapitálkové
písmo, takže `Hades` sa vysádza ako vysoké `H` a nápisové kapitálky `ADES` — presne
ten rímsky nápisový register, ktorý drží mýtus aj technickú vecnosť naraz.

- rozstup sa **nemení**: bez neho sa `D` a `E` zlepia,
- wordmark je **atramentový** (`--ink`), farbu nesie znak. Amethystový wordmark na
  tmavom papieri hasol,
- v appke sa **nesádza živo** — všade sú krivky, takže lockupy a exporty nezávisia
  od žiadneho fontu. `public/fonts/cinzel-wordmark.woff2` (1 256 B, subset na glyfy
  `Hades`) leží v repe len pre prípad, že by sa niekedy sádzal živý text,
- slovo pod znakom v raile zostáva **Geist** — je to 10 px mikrotypografia, nie
  wordmark, a kapitálky by tam ubrali čitateľnosť.

### Lockupy

| | Pravidlo |
|---|---|
| Horizontálny | výška znaku : výška verzálky = **1,55 : 1**, medzera = **0,34 × výška znaku**, wordmark opticky centrovaný na stred znaku |
| Vertikálny | znak nad wordmarkom, medzera = **0,22 × výška znaku**, obe časti centrované |

Ochranná zóna: **0,34 × výška znaku** na všetkých stranách (tá istá hodnota ako
medzera v lockupe — tak sa nedá pomýliť).

### Dve verzie

- **Master** (`hades-sigil.svg`) — od 32 px vyššie: deck, hero, tlač, OG.
- **Mini** (`hades-sigil-mini.svg`) — pod 24 px: favicon, avatar, rail, hlavička
  Charóna. Dva prvky: prstenec r 36 / hrúbka 9 a zlaté jadro r 15. Nič viac.

Overené renderom v oboch témach na 180 / 64 / 32 / 24 / 16 px. Master pod 32 px
zapadá do blata — preto existuje mini a preto sa nepoužíva jeden súbor na všetko.

### Čo sa so znakom nerobí

- nedopĺňa sa písmeno H do jadra (jadro je plocha, nie monogram),
- nemení sa počet prstencov ani ich rytmus,
- nepridávajú sa satelity (jeden uzol = jeden dej),
- prerušenie sa nezacelí,
- znak sa nedáva na farebnú výplň inú než papier (svetlý/tmavý) — na cudzom
  podklade sa použije monochróm.

---

## 3. Pohyb

### Prvé pravidlo

**Pohyb nesie poradie čítania alebo hlási zmenu — nikdy nie je ozdoba.**
Preto sa animuje geometria (obtiahnutie, odkrytie, narastanie), nie fade celej
karty; fade hovorí „niečo pribudlo", geometria hovorí „takto to vzniklo".

Rozhodnutie 6 to zaostruje na tento produkt: **model beží ~8 tok/s a na plátne je
2 700 uzlov**, takže plynulosť nesmie byť na úkor dojmu rýchlosti. Animácia, ktorá
odďaľuje ďalšiu akciu, je chyba.

Ak po odstránení animácie človek nestratí informáciu ani kontext, pohyb je
voliteľný — a v tomto projekte to znamená, že sa nepridáva.

### Trvania sú tokeny, nie čísla v komponente

| Token | Hodnota | Rola |
|---|---|---|
| `--dur-press` | 80 ms | stlačenie |
| `--dur-fast` | 150 ms | hover, farba, malý stav |
| `--dur-base` | 180 ms | vstup prvku, prepnutie obsahu |
| `--dur-slow` | 200 ms | panel, drawer |
| `--dur-ambient` | 400 ms | ambientný útlm chrómu |
| `--dur-pulse` | **1,4 s** | perióda **neurčitého čakania** |
| `--ease` | `cubic-bezier(.22,.61,.36,1)` | príchod a transformácia |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | odchod |

**„Neurčité čakanie" má JEDNU periódu a to je `--dur-pulse`.** Dnes ich má tri:
1,4 s (`sk-pulse`, `sync-pulse`, `load-breathe`), **1,2 s** (`think-blink`,
`charon-blink`) a **1,1 s** (`tool-pulse`). Rovnako `ease-in-out` sa objavuje **5×**
tam, kde má appka `--ease`, a `charon.css:257` má vlastnú krivku
(`transform .15s ease` — teda iná krivka, nie len iný zápis). **[cieľ V3]** jedna
perióda, jedna krivka.

Grafové trvania sú **zámerne pomenované číslom** a majú komentár: `760 ms`
(obtiahnutie prstenca a segmentov donutu), `900 ms` (krivka rastu), `720 ms`
(odkrytie heatmapy), `90 ms` (stupňovanie segmentov). Sú to jednorazové dramaturgie,
nie stupne rebríka.

### Katalóg pohybu

| Miesto | Pohyb | Trvanie | Nesie |
|---|---|---|---|
| Znak (rail, Charón, prázdny stav) | prstenec sa obtiahne, potom jadro | 760 + 460 ms | značkový podpis |
| Jadro v raile | dýchanie = stav vedomia (`bdie` / `spí`) | 4 s, slučka | **informáciu** |
| Načítavanie (`load-breathe`) | znak dýcha mierkou | `--dur-pulse` | informáciu — „pracuje sa" |
| Skeleton (`hades-shimmer`) | jeden sweep cez plochu | `--dur-pulse` | informáciu — skeleton žije |
| Obrazovka | `rise-fade` pri prepnutí | `--dur-base` | prepnutie |
| Panel (`#dock`, `#node-panel`) | vstup zo svojej strany | `--dur-slow` | **informáciu** — z ktorej strany prišel |
| Donut istoty | segmenty od dvanástky, stupňovane po 90 ms | 760 ms | poradie čítania |
| Krivka rastu | čiara sa obtiahne zľava, plocha a bodka dobehnú | 900 ms | poradie čítania |
| Heatmapa | odkrytie zľava (od najstaršieho týždňa) | 720 ms | poradie čítania |
| Uzol na plátne | `birthScale()` pri zrode z WS | 0,5 s | **informáciu** — pribudol uzol |
| Beh je živý (`sync-pulse`) | pulz bodky stavu | `--dur-pulse` | **informáciu** |
| Správa v Charónovi | `msg-in` — len pri živom pribudnutí | `--dur-base` | **informáciu** |

Tri pasce, na ktorých to inak vyzerá zle:

- **Obnova histórie nie je zrod.** Charón pri otvorení vlákna pridá desiatky blokov
  naraz; keby každý dostal `msg-in`, história by sa rozhýbala celá. `render.js`
  preto počas `renderThread()` triedu `is-new` nepridáva.
- **Heatmapa sa neanimuje po bunkách.** 365 buniek × vlastné oneskorenie = 365
  inline štýlov; odkrytie beží jednou animáciou nad mriežkou.
- **Zastavená animácia nie je tichá animácia.** Zastavený shimmer nechá sweep
  zamrznutý v polovici plochy, teda skeleton vyzerá ako rozbitý gradient. Viď nižšie.

### Tichá verzia je záväzná — a nie je to „vypnuté"

Rozhodnutie 8: **každá animácia má tichú verziu pre `prefers-reduced-motion`, a nie
„vypnuté", ale zmysluplný okamžitý ekvivalent.** Reduced motion nie je „nič sa
nestane" — stav sa zachová textom, ikonou, obrysom, fokusom alebo oznámením.

Merané 27. 8. 2026 (sonda A §3.1–3.3):

| | Počet |
|---|---|
| `@keyframes` v štyroch stylesheetoch | **16** |
| živých animácií | **22** |
| živých prechodov | **57** |
| **živých pohybov celkom** | **79** |
| pohybov s **pomenovanou** tichou verziou v CSS | 11 |
| pohybov s tichou verziou v **JS** (`charts.js`, `anim.js`, `toasts.js`) | 4 |
| **pohybov, ktorých jedinou tichou verziou je plošné pravidlo** | **64** |

#### Plošné pravidlo je PODLAHA, nie strop

`public/css/mind.css:2728–2736` je `*, *::before, *::after { animation-duration:
.01ms !important; … }`. `mind.css` sa načítava prvý na všetkých troch plochách,
takže pokrýva aj `console.css`, `chat.css` a `charon.css`.

**To pravidlo zostáva a `!important` sa z neho neodstraňuje.** Jeho odstránenie by
zhodilo pravidlo na špecificitu 0-0-0 bez `!important`, teda by prehralo
s **každým** komponentným pravidlom — a 64 pohybov by tichú verziu stratilo naraz,
pričom by si to nikto nevšimol: prejaví sa to len u človeka, ktorý má preferenciu
zapnutú.

Zápis `.01ms` (nie `0s`) je zámerný: prvok tak **dobehne** do koncového stavu
a `transitionend` / `animationend` sa vydá, takže JS, ktorý na koniec prechodu
čaká, sa nezasekne.

#### Ako sa podlaha legálne prebije

> **Tichá verzia = pravidlo v tom istom `@media (prefers-reduced-motion: reduce)`
> bloku, so selektorom aspoň triedovej špecificity, s `!important` na tých
> vlastnostiach, ktoré sa majú líšiť.**

Mechanika, aby to niekto „neopravil": `!important` deklarácie súťažia medzi sebou
**špecificitou**. Plošné pravidlo je `*` = 0-0-0, `.skel::after` je 0-1-0 — teda
`.skel::after { display: none !important }` vyhrá. Bez `!important` by prehralo.

Príklady zmysluplných okamžitých ekvivalentov:

| Pohyb | Tichá verzia NIE JE | Tichá verzia JE |
|---|---|---|
| skeleton sweep | zastavený sweep | pokojná zdvihnutá plocha bez lesku |
| dýchanie znaku načítania | znak v spodnej fáze | znak na **plnej** mierke, statický |
| zrod znaku | neviditeľný znak | znak **rovno hotový** |
| pulz behu | zastavená bodka | bodka v plnej farbe + text stavu |
| prílet uzla na plátne | uzol chýba | uzol rovno na mieste, krátke zvýraznenie obrysu |
| kamera / fit | animovaný prelet | okamžitý presun |

#### Kde je manuál a kód dnes rozdielny

Do 27. 8. 2026 tu stálo, že `prefers-reduced-motion` vypína **obe** animácie znaku.
Pravda je presnejšia a treba ju vedieť: pomenovaný blok (`mind.css:1215`) vypína
**len zrod** (`bc-draw`, `bc-core-in`); **dýchanie (`core-pulse`) zastavuje až
plošné pravidlo.** Plošné pravidlo je teda pre dýchanie znaku **nosné**, nie
kozmetické — keby padlo, znak by dýchal aj v tichom režime.

**[cieľ V1]** vzor zavedený a aplikovaný na `.skel::after` a `.load-mark`.
**[cieľ V3]** audit všetkých 64 pohybov, jeden celok so zoznamom.

Poznámka k JS strane, ktorú CSS nevidí: `charts.js:75` (`REDUCED`),
`anim.js:12/43/53/158`, `toasts.js:24/26/38/67/68` a `sim.js` (`pump()`) riešia
tichý režim **tak, že triedu vôbec nepridajú**, nie tak, že by ju CSS prebíjalo.
To je správne poradie a nemení sa. `pump()` naviac mimo obrazovky Graf **netiká na
rAF, ale dosadá ticho** cez `setTimeout` — bez toho by alpha nikdy neklesla.

Preferenciu treba čítať **aj po zmene nastavenia** (`MediaQueryList` event
`change`), nie iba pri štarte. **[cieľ V3]**

---

## 4. Farba

**Amethyst je interaktívny, zlato je značkové.** Amethyst nesie hover, fokus,
aktívny stav a primárne akcie. Zlato nesie dve veci: jadro vedomia a jadro znaku.
Keby zlato nieslo aj interaktívny stav, ten jediný vyhradený význam sa rozdrobí.

**Hodnoty palety sa redizajnom NEMENIA** (rozhodnutie 2). Mení sa ich **použitie**.

### Rampa

| Token | Svetlá | Tmavá |
|---|---|---|
| `--accent` | `#6d3fb5` | `#c4a2f5` |
| `--accent-300/400` | `#a97ded` | `#d0b8f8` |
| `--accent-600` (hover výplň) | `#58309a` | `#d9c6fa` |
| `--accent-ink` | = `--accent-600` | = `--accent-300` |
| `--accent-soft` | `#e9dcfa` | `rgba(196,162,245,.16)` |
| `--accent-softer` | `#f4eefc` | `rgba(196,162,245,.10)` |
| `--border-accent` | `#c9b0ee` | `rgba(196,162,245,.45)` |
| `--on-accent` | `#ffffff` | `#0e1413` |

Zlato sa nemenilo: `--gold #b88a3a`, `--brand-gold #d8b878`, `--gold-text #8a6417`
(svetlá) / `#d8b878` (tmavá).

### Namerané (19. 8. 2026)

Kritérium nebolo „prejsť absolútny prah", ale **nezhoršiť sa oproti tealu**, ktorý
tu bežal predtým — časť párov (tenké linky, tinty) totiž nedosahovala 3:1 ani s ním.

| Pár | Teal | Amethyst |
|---|---|---|
| `--accent` ako text na paperi (svetlá) | 4,77 | **6,36** |
| biela na `--accent` výplni (svetlá) | 5,20 | **6,93** |
| `--accent-ink` na `--accent-soft` (svetlá) | 5,80 | **6,98** |
| `--accent` ako text na paneli (tmavá) | 7,35 | **8,03** |
| ink na `--accent` výplni (tmavá) | 7,97 | **8,72** |
| ink na hover výplni (tmavá) | 9,39 | **11,89** |
| `--accent-ink` na `--accent-soft` (tmavá) | 5,59 | **7,17** |
| fokusový prstenec vs papier (svetlá) | 3,72 | **4,63** |
| fokusový prstenec vs panel (tmavá) | 3,62 | **3,88** |

Amethyst je lepší na **všetkých** meraných pároch. Merač: `amethyst2.js` / `dark2.js`.

### Základná hodnota nie je farba textu

Toto je nové pravidlo a je to celý obsah rozhodnutia 2: **kde má token `-ink`
variantu, text ide cez `-ink`; základná hodnota je pre plochu, obrys a grafiku.**

Merané (sonda A, príloha; detektor kalibrovaný na `--danger-ink` 16/16 ako `color:`
a `--danger-soft` 0/18):

| Token | ako TEXT | ako PLOCHA | `-ink` varianta |
|---|---|---|---|
| `--accent` | **15** | 44 | ✅ `--accent-ink` (42 volajúcich) |
| `--danger` | **9** | 4 | ✅ `--danger-ink` (16) |
| `--success` | **1** | 4 | ✅ `--success-ink` (5) |
| `--warn` | **1** | 4 | ✅ `--warn-ink` (3) |
| `--brand-gold` | 1 | 0 | — (`#brand-core`, pomenovaná výnimka) |
| `--cert-overene` | 1 | 1 | ✗ nemá |
| `--cert-pasca` | 1 | 1 | ✗ nemá |

Z 26 deklarácií je **12 na prvkoch `.ms`** — teda ikony, ktoré ako grafika majú
prah **3:1**, nie 4,5:1, takže sú obhájiteľné a **zostávajú**. Zvyšných **14 nesie
skutočný text** a je to uzavretý zoznam: `button.danger`, `button.danger.armed`,
`.queue-actions button.armed`, `.tr-act.armed`, `#rail … .active`,
`#graph-tools button.active`, `.today-chip .n`, `.dir-path`, `.dir-badge.ok`,
**`.kpi-sub`** (11 px — najmenší text na neladenej hodnote), `#btn-up:hover`,
`#presets .preset.active .p-name`, `#ambient-row #btn-ambient:hover`,
`#charon-toggle[aria-expanded="true"]`.

Každý pár sa musí **premerať**, nie mechanicky prepísať: `-ink` hodnoty sú ladené
na **tint**, nie na papier a nie na panel.

`--cert-overene` a `--cert-pasca` `-ink` variantu **nedostávajú automaticky** —
farby istoty sú značková sémantika (nižšie), nie success/warn/error, takže je to
rozhodnutie o význame, nie doplnenie tokenu.

### Pozadie značky

Značkové je **tmavé** (`#0e1413`) — appka má tmavú tému ako default a zlaté jadro
na nej žiari. Svetlá verzia je povinná, nie druhoradá: **obe témy sú rovnocenné**
(rozhodnutie 12) a každá zmena sa meria na tmavej aj svetlej.

### Farby oblastí nie sú paleta značky

Prichádzajú z databázy a patria dátam, nie značke. Do manuálu patrí len pravidlo:
**farba = oblasť, tvar = typ**, a utlmenie v OKLCh cez `mutedColor()` (zrezaná
chroma, jednotná cieľová svetlosť, podlaha kontrastu 3,15:1). Každý swatch v DOM
musí ísť cez tú istú funkciu, inak UI hovorí inou farbou než plátno. V HSL to
nerobiť — zo zlata by bola špinavo hnedá.

Vedľajší efekt prefarbenia: teal `#03797e` je farba oblasti **Vývoj & kód**. Kým bol
akcent tealový, akcent a jedna oblasť mali tú istú farbu. Amethyst tú kolíziu ruší.

### Farby istoty

`overene` / `hypoteza` / `pasca` sú **značková sémantika**, nie bežné
success/warn/error — hovoria o dôveryhodnosti poznatku, nie o výsledku operácie.
Preto majú vlastné tokeny. `--cert-hypoteza` je na tmavej téme tá istá hodnota ako
`--brand-gold`; je to tretia, semantická rola a presun na `--warn` (70° vs 79°)
by kolíziu len zhoršil.

### Rampa hustoty (heatmapa)

`--heat-1` … `--heat-4` (`mind.css:435–438`) je **jediná sekvenčná rampa v appke**
a do 27. 8. 2026 v manuáli nebola vôbec. Pravidlá:

- rampa je **sekvenčná, nie divergentná** — nesie „koľko", nie „na ktorú stranu",
- najtemnejší krok `--heat-4 #8734cf` má nameraný kontrast **5,63:1**,
- rampa sa **nepoužíva na kategórie**. Kategórie nesie farba oblasti,
- nulová hodnota nie je najsvetlejší krok rampy, ale **papier s obrysom** — inak
  „nič" a „málo" vyzerajú rovnako.

---

## 5. Hĺbka a povrchy

Rozhodnutie 22+25: **hĺbka = sklo a priehľadnosť, ale LEN na tmavej téme.**
Na svetlej sú povrchy **plné** — pod polopriehľadnými čipmi tam kontrast textu
závisel od obsahu grafu, teda od dát.

Mechanika, ktorá to drží (a je jedna):

| Token | Svetlá | Tmavá |
|---|---|---|
| `--panel-a` | `1` | `var(--panel-alpha)` |
| `--glass-blur1/2/3` | `none` | `--blur-1/2/3` |
| `--scrim-blur` **[cieľ V1]** | `none` | `--blur-scrim` (4 px) |

Slider priehľadnosti píše `--panel-alpha` inline na `:root`, takže na svetlej ho
`--panel-a: 1` neutralizuje. **To drží** — merané, 9 z 12 `backdrop-filter`
deklarácií ide cez prepínateľné tokeny.

**Pomenovaná výnimka: scrimy pod modálom.** `#help-overlay`, `#md-overlay` a `#cmdk`
rozostrujú **na oboch témach**, pretože tam rozostrenie nenesie hĺbku povrchu, ale
vetu „pod tým je obsah, ktorý teraz nečítaš". Je to výnimka, **nie chyba** — a od
27. 8. 2026 je pomenovaná. Podmienky výnimky:

1. platí len pre **scrim pod modálom**, nikdy pre panel,
2. má **jednu hodnotu** (`--scrim-blur`), nie dve. Do vlny 1 mali `#help-overlay`
   a `#md-overlay` 4 px a `#cmdk` **6 px** — dve hodnoty pre jednu rolu,
3. scrim sa **neanimuje mierkou ani posunom**, len opacitou.

Ostatné pravidlá povrchov:

- **Povrch karty je token `--card-bg`** (default `var(--panel)`), druhý papier je
  deklarovaná rola `.card--nested` (`--surface-2`). Základ je `--panel`
  z **funkčného** dôvodu: je to jediný povrch nesúci sklo, takže karta na
  `--surface-2` by ticho vypadla zo slidera priehľadnosti. A `--surface-2` je na
  **tmavej** téme *svetlejšia* než `--panel`, takže „sunken" je preň nesprávne slovo.
- `--card-bg` má v `mind.css` **tri odkazy, ale pokrývajú deväť selektorov kariet**
  (`.kpi-card`, `.dash-card`, `.lib-skill`, `.record`, `.dtl-card`, `.queue-item`,
  `.dir-group`, `.dir-preview-wrap`, `.dir-saved-item`) — povrch karty **je**
  zjednotený. Skutočný rozpor je `charon.css:439`, kde karty stoja na
  `--panel-solid`, teda dva plávajúce panely nad tým istým plátnom, jeden priesvitný
  (`#dock`) a druhý nie (`#charon`). **[cieľ V3]**
- **Žiadny raw hex ani rgba mimo `:root`.** Stav 27. 8. 2026: **0 zásahov**
  (detektor kalibrovaný na 130 zásahoch vnútri `:root`). Pomenované výnimky sú dve
  a obe majú komentár: `chat.css:19` (`--ca-frame-bg: #ffffff` — papier
  `<iframe sandbox>`) a `console.css:33` (`--stream-w`).
- **Elevácia má jedno meno.** `--elev-1/2/3/tooltip` majú volajúcich (3/7/5/1),
  `--shadow-1` jedného a **`--shadow-2` aj `--shadow-3` nula**. Dve mená pre jednu
  vec; kánon je `--elev-*`. **[cieľ V3]**

---

## 6. Typografia a hustota

| Rola | Písmo |
|---|---|
| UI | **Geist** (variabilné, self-hosted) |
| Čísla, ID, cesty, prompty, tool volania | **Geist Mono** |
| Titulok obrazovky a hero metrika | **Playfair Display** |
| Wordmark | **Cinzel 600** — len v krivkách, viď §2 |

Fonty sú **self-hostované v `public/fonts/`**, Google Fonts CDN je zámerne preč —
pri jeho výpadku sa každá ikona vykreslila ako svoj ligatúrový názov.

### Rola serifu

Do 27. 8. 2026 tu stálo „serif len hero metriky" a serif mal preto **jednu
deklaráciu proti 86 deklaráciám mono** (`.hero-val`, jeden prvok na jednej
obrazovke), pričom zaplatený font stojí **59 544 B woff2** a `latin-ext` sa načíta
vždy kvôli slovenskej diakritike. Zaplatený font s jedným volajúcim je plytvanie
identitou.

**Serif nesie DVE role a nič iné:**

1. **jedno primárne číslo obrazovky** (`.hero-val`, 44 px) — odlišuje ho od radu
   monospace odpočtov pod ním, takže hierarchiu nesie aj rez písma, nie len veľkosť;
2. **titulok obrazovky** (`.screen-head h1`, 28 px) — jeden výskyt na obrazovku.
   **[cieľ V1]**

Serif **nikdy**: chybová hláška, prázdny stav, chróm, os grafu, telo textu, nadpis
sekcie, KPI čísla, badge. Mýtické písmo v texte, ktorý má človek použiť na opravu
chyby, je zakázané (§8).

Serif má vlastné typografické hodnoty, nie hodnoty ladené pre Geist: **váha 600**
(nie `--fw-heading` 660) a **`letter-spacing: 0`** (nie `--ls-heading` −.025em).
Negatívne prostrkanie na vysokokontrastnom serife zlepuje pätky.

**Playfair musí byť preloadovaný na každej ploche, kde nesie titulok** — inak sa
titulok vykreslí najprv v Georgii a preskočí. Dnes nie je preloadovaný nikde.
**[cieľ V1]**

### Preload — rozpočet, nie zvyk

| Súbor | Bajty | `/` dnes | `/` [cieľ V1] | `/` [cieľ V3] |
|---|---|---|---|---|
| `material-symbols-rounded-subset.woff2` | 132 196 | ✅ | ✅ | **—** |
| `geist-latin.woff2` | 29 400 | ✅ | ✅ | ✅ |
| `geist-latin-ext.woff2` | 16 512 | ✅ | ✅ | ✅ |
| `geist-mono-latin.woff2` | 23 128 | ✗ | ✅ | ✅ |
| `playfair-display-latin.woff2` | 38 404 | ✗ | ✅ | ✅ |
| `playfair-display-latin-ext.woff2` | 21 140 | ✗ | ✅ | ✅ |
| **Σ** | | **178 108** | **260 780** | **128 584** |

Dve veci z tabuľky, ktoré boli poruchou: `/` je plocha s **86 deklaráciami
`var(--mono)`** (breadcrumb, metriky hlavičky, všetky čísla kariet, KPI, časy,
cesty) a **Geist Mono na nej preloadovaný nie je**, kým na `/console` a `/chat` áno.
A tretí preload je na `/` použitý na `geist-latin-ext` namiesto mono.

`font-display`: **`block` pre ikony** (krátky prázdny priestor je lepší než blik
surových ligatúrových názvov), **`swap` pre text** vrátane Playfairu — `block`
na titulku obrazovky by nechal prázdne miesto.

### Škála

| Token | Hodnota | Prokládka | Rola |
|---|---|---|---|
| `--fs-micro` | 10 px | 1,3 | eyebrow, `kbd`, počty v raile |
| `--fs-caption` | 11 px | 1,4 | popisky, jednotky, chróm |
| `--fs-small` | 12 px | 1,4 | ovládacie prvky, kód |
| `--fs-body` | 13 px | 1,5 | telo karty, `button` |
| `--fs-base` | 14 px | 1,5 | `body`, `p`, `input`, próza |
| `--fs-title` | 16 px | 1,3 | nadpis sekcie |
| `--fs-display` | 20 px | 1,25 | `h2` prózy |
| `--fs-headline` | 24 px | 1,25 | `h1` prózy v čítačke |
| `--fs-h1` | 28 px | 1,2 | **titulok obrazovky (serif)** |
| `--fs-kpi` | 30 px | 1 | KPI odpočet (mono) |
| `--fs-hero` | 44 px | 1 | **jedno primárne číslo obrazovky (serif)** |

Ikonová škála: `--icon-2xs` 14 · `--icon-xs` 16 · `--icon-sm` 18 · `--icon-md` 20 ·
`--icon-lg` 22 px. Veľkosti 28 px a 48 px v prázdnych stavoch sú **kresba, nie
stupeň škály** — pomenovaná výnimka.

### DATA vs CHRÓM — nové pravidlo hustoty

Rozhodnutie 13: **zdvihnúť dátový text, chróm nechať mikro.**

| | Je to | Podlaha |
|---|---|---|
| **DATA** | hodnota, ktorú človek číta ako obsah: čas, cesta, počet, značka, snippet, kľúč dňa, cena behu | **13 px** (`--fs-data`) |
| **DATA v čipe** | hodnota vnútri badge, kde ju rámuje obrys | **12 px** (`--fs-data-chip`) |
| **os grafu** | mesiac na osi, stupnica legendy, popis stredu donutu | **11 px** (`--fs-chart-axis`) |
| **CHRÓM** | popisok, jednotka, eyebrow, klávesová nápoveda, názov jazyka bloku kódu | 10–11 px, **nezdvíha sa** |

Osi idú na 11 px, nie na 13 px, a je to zmeraný dôvod: heatmapa má 365 buniek na
šírku obrazovky a 12 mesačných popiskov nad nimi. Čitateľnosť dohráva `.sr-only`
tabuľka, ktorú si heatmapa drží.

**Namerané pred vlnou 1** (sonda A §1.2, pravidlo klasifikácie je v hlavičke
meracieho skriptu, takže číslo je reprodukovateľné):

- **149 z 271** textových deklarácií `font-size` je pod 13 px = **55,0 %**,
- z toho **84 je DATA** a 65 CHRÓM,
- **6 deklarácií je DATA na 10 px**, a štyri z nich sú osi a legendy grafov;
  piata je `.day-head` — **kľúč dňa v Denníku**,
- `#header-metrics` — text „1109 uzlov · 3053 spojení", jediné číslo, o ktorom je
  celá appka — je **12 px mono v `--muted`**.

Meranie nad DOM dalo **85,6 % viditeľného textu pod 13 px**. Nie je to v rozpore
s 55,0 % nad CSS: pod 13 px sedia práve tie selektory, ktoré sa v zoznamoch
**opakujú stokrát** (`.record-time`, `.tag`, `.ti-time`, `.run-when`), kým 14–44 px
sú prvky raz na obrazovku. Obe čísla merajú tú istú chorobu z dvoch strán.

**Prokládku deklaruje každá deklarácia veľkosti.** Dnes ju deklaruje **66 z 271
(24,4 %)** a pod 13 px je to horšie — **33 zo 149 (22,1 %)**. Číslo sa dedí ako
**násobiteľ, nie ako výsledok**, takže `.day-head` na 10 px zdedí 15 px prokládky
a `.md-body` na 14 px zdedí 21 px. `normal` prichádza z **form controls**, ktoré
dedenie `line-height` neberú.

Doplnenie prokládky je **najväčší zdroj tichého posunu rozloženia** v celom
redizajne. Preto sa každá taká zmena overuje **výmenou stylesheetu nad tým istým
DOM**, nie dvoma načítaniami — Hades je živý a medzi nimi sa naučí uzly.

### Jeden stylesheet, jedna škála

`charon.css` (dok nad grafom) je **jediný stylesheet úplne mimo typografickej
škály**: farebné tokeny používa (0 raw farieb), typografické **nie** —
`var(--fs-*)` 0×, `var(--icon-*)` 0×, **22 surových veľkostí**. 15 px a 20 px nie
sú stupňami škály vôbec. **[cieľ V3]**

Kresba **bloku kódu a kopírovania je JEDNA** a je v `mind.css` — jediný stylesheet
načítaný na všetkých troch plochách.

---

## 7. Ikony

### Dnešný stav a prečo sa mení

**Material Symbols Rounded**, subset (215 glyfov, 132 196 B). Žiadne emoji, nikde.

Rozhodnutie 19: **vlastná sada inline SVG, celá naraz. Material Symbols subset ide
von.** **[cieľ V3]**

Dôvody sú tri a všetky sú zmerané:

1. **Ligatúr je 41, nie 37.** Vstupujú do DOM **tromi cestami** a grep na markup
   podhlási: inline `<span class="ms">` (37), **argument helpera** `emptyHtml(icon,…)`
   (`search_off` v `cmdk.js:258` a `smernica.js:186`, `filter_alt_off`
   v `dennik.js:134`) a **`.textContent =`** (`play_arrow`, `pause` v `timeline.js`).
   Sada postavená zo 37 by mala **štyri diery**, ktoré by sa vykreslili ako surový
   ligatúrový názov.
2. **Subset je starší než ikony.** `material-symbols-rounded-subset.woff2` má mtime
   **18. 8. 2026 13:38**, kým záznam o „32 ikonách" je z 20. 8. — a dnes ich je 41.
   Pribudlo najmenej 9 a subset sa neprestavil.
3. **`.ms` v `mind.css:887` nemá `sans-serif` fallback ani `liga`**, kým
   `console.css:1277` a `chat.css:98` ich majú a ich komentáre doslova priznávajú
   „mind.css fallback nemá". Keď subset zhavaruje, práve na `/` — teda na ploche
   s 8 destináciami v raile — sa každá ikona vykreslí ako ligatúrový názov
   v pätkovom fallbacku. **[cieľ V1]** fallback doplnený ako poistka do vlny 3.

**Kým je subset v hre, platí:** nová ikona → **regeneruj**
(`pyftsubset --no-layout-closure`; bez toho flagu ligatúrová uzávera vtiahne všetky
4 271 glyfov späť). Overuje sa **meraním šírky vykresleného glyfu** (glyf ≈ 1 em
≈ 18 px, nevykreslená ligatúra padne na fallback a je násobne širšia — `terminal`
144 px, `arrow_downward` 252 px). **GSUB tabuľky nečítať** — prvý pokus o audit tou
cestou hlásil 32 chýbajúcich ikon, ktoré v subsete boli. Kalibruj na známom kladnom
(`hub` = 18 px) aj zápornom prípade.

### Kresba vlastnej sady

| Vlastnosť | Hodnota |
|---|---|
| viewBox | `0 0 24 24` |
| hrúbka obrysu | 1,75 px na 24-mriežke |
| konce a spoje | `round` |
| výplň | **`none`** |
| farba | `currentColor` |
| optické veľkosti | existujúce stupne `--icon-2xs` … `--icon-lg` (14–22 px) |

**Sada je výhradne obrysová a v celom systéme je jediný plný prvok: jadro.**
Toto pravidlo viaže ikony na znak a na plátno: uzly na plátne sú priehľadné
prstence, nie plné disky (priehľadnosť nesie *diera*, nie nízka alfa), a jadro
vedomia je jediný sýty plný prvok. Legenda v `panels.js` musí hovoriť ten istý
jazyk — plné disky tam učili zle.

### Semantická mapa — jeden význam, jedna ikona

Toto je nová sekcia. Existuje preto, že dnes je **10 kolízií**, kde tá istá vec má
dve kresby alebo jedna kresba nesie štyri veci.

**A · Destinácia** — 8, každá unikátna, žiadna kolízia ✅

| Význam | Dnes |
|---|---|
| Dnes | `wb_sunny` |
| Graf | `hub` |
| Denník | `receipt_long` |
| Rozhodnutia | `gavel` |
| Runy | `bolt` |
| Knižnica | `menu_book` |
| Kontrola | `fact_check` |
| Smernica | `assignment` |

**B · Typ objektu** — dokument `.md` (`description`) · model / pamäť (`memory`) ·
štruktúra (`account_tree`) · pohľad Vrstvy (`layers`)

**C · Akcia** — kanonická mapa po vyriešení kolízií:

| Význam | Ikona | Dnes |
|---|---|---|
| odoslať správu | `send` | **dva tvary** — `arrow_upward` na `/chat` a `/console`, `send` v doku |
| skočiť na spodok | šípka **dolu** | `arrow_upward` prevrátený v CSS (`.ms.flip`, deklarované **2×** v `chat.css:107` a `console.css:1208`, a **nie je** v `mind.css`) |
| o úroveň von v grafe | šípka **von** (nie hore) | `arrow_upward` |
| rozbaliť / zbaliť | chevron | `arrow_upward` |
| nové vlákno | `add` | `add` |
| priblížiť / oddialiť | **`zoom-in` / `zoom-out`** | `add` / `remove` — zoom nie je „nové" |
| zavrieť plochu | `close` | `close` (6×) |
| odobrať zo zoznamu | **`remove-item`** | `close` (2×) — zatvorenie je nedeštruktívne, odobranie nie |
| zrušiť spojenie | **`link-off`** | `close` |
| prepojiť s uzlom | `link` | **dva tvary** — `link` a `add_link` |
| zmazať natrvalo | `delete` | `delete` |
| upraviť / uložiť / kopírovať | `edit` / `save` / `content_copy` | rovnako |
| zastaviť beh | `stop` | `stop` |
| hľadať | `search` | `search` |
| synchronizovať | `sync` | `sync` |
| nastavenia / pomoc / vycentrovať / legenda | `tune` / `help` / `center_focus_strong` / `category` | rovnako |
| prehrať / pozastaviť replay | `play_arrow` / `pause` | rovnako |
| overiť poznatok | `verified` | `verified` |
| vyriešiť položku fronty | **`check`** | `done_all` — stojí **vedľa** `verified` v jednom riadku fronty |
| preskočiť | **`skip`** | `redo` — „zopakovať" hovorí niečo iné než jej vlastný `aria-label` |

**D · Stav / výsledok**

| Význam | Ikona |
|---|---|
| úspech | `check_circle` |
| pád fetchu | `cloud_off` (**9× — najčastejšia ikona v appke**) |
| nič sa nenašlo | `search_off` |
| filter nič nedal | `filter_alt_off` |
| commit v zázname | `commit` |
| prázdna fronta = dobrý stav | `check_circle` (nie `done_all`) |

**E · Identita** — **0 ikon, 1 znak.** Vľavo hore je **znak, nie ikona `hub`**.
Dodržané v hlavičke `/console`; `#charon-toggle` nad grafom je dnes `hub`
(`mind.blade.php:94`). **[cieľ V2]**

`hub` dnes nesie **štyri** veci: pohľad Sieť, destinácia Graf, otvoriť Charóna
a priložiť uzol do rozhovoru. Po vyriešení nesie **jednu**: destinácia Graf.

---

## 8. Stavy — prázdno, chyba, načítavanie

Toto je nová sekcia. Manuál mal doteraz tri kodifikované stringy a nič o tvare.

### Prázdny stav UČÍ

Rozhodnutie 14: **čo to je · prečo je prázdne · JEDNA konkrétna akcia.**

| Riadok | Obsah |
|---|---|
| ikona | kresba stavu (28 px, `opacity .5`) |
| **prvý riadok** | konštatovanie: „Fronta na overenie je prázdna" |
| **druhý riadok** | čo bude ďalej: „Nové poznatky sem prídu po ďalšej session." |
| **akcia** | **najviac jedna**, a len ak sa naozaj dá niečo kliknúť |

Dve veci, ktoré prázdny stav nesmie:

- **nevymýšľa si novú farbu.** Ostáva jednou tichou plochou v `--muted`; druhý
  riadok je tichší **veľkosťou**, nie farbou.
- **neponúka dve akcie.** Dve akcie znamenajú, že stav nevie, čo je jeho jedna
  cesta ďalej.

**„Nič tu nie je" a „tvoj filter to skryl" sú dve rôzne správy** a musia vyzerať
inak. Prázdno z filtra má vlastnú rolu (`.empty--filter`) a jeho jedna akcia je
**zrušiť filter**. Pozor: appka už má tri funkcie, ktoré filter bez výsledku
**rušia samé** (`pruneLibraryArea()`, `pruneDecisionFilters()`, `pruneRunFilters()`) —
tlačidlo sa ponúka len tam, kde je filter platný a naozaj skrýva dáta, inak vznikne
tlačidlo, ktoré nič nerobí.

**Namerané pred vlnou 1:** z 25 prázdnych/chybových stavov má klikateľnú akciu
**jeden** (`.empty.empty-network`). Šestnásť má text + radu, **osem nemá radu vôbec**.
Prázdno **vnútri karty** (`.card-empty`) je zámerne iná rola — karta má vlastný
nadpis, ktorý už povedal, o čo ide, takže 28 px ikona pod ním len zdvojí to isté.
**Nezlievať.**

### Chyba pomenuje PREDMET a ponúka jednu akciu

Rozhodnutie 16: **jeden chybový komponent pre všetky plochy.**

| Riadok | Obsah |
|---|---|
| ikona | `cloud_off` v `--danger` — **grafika s prahom 3:1**, nie text |
| **prvý riadok** | *predmet* + čo sa stalo: „Denník sa nepodarilo načítať" |
| **druhý riadok** | vecné vysvetlenie: „Server neodpovedá — skús to znova." |
| **akcia** | **Skúsiť znova** |

Pravidlá:

- **text chyby ide vždy cez `--text` / `--muted`, nikdy cez `--danger`.** Základná
  hodnota je pre grafiku; pre text má appka `--danger-ink` (16 volajúcich).
- **chyba nikdy nehlási prázdno.** Sonda A preverila všetkých 11 chybových ciest:
  ani jedna dnes nehlási prázdno namiesto chyby a **to je invariant, nie zhoda**.
  Jediná mäkká výnimka je `smernica.js:322`, ktorá chybu kreslí ako tichý riadok
  v karte — nelže, ale nepriznáva sa dostatočne. **[cieľ V1]**
- **čiastočný pád sa priznáva.** `dnes.js:79` je vzor: hlási len tú časť obrazovky,
  ktorá padla, a dopovie „Zvyšok obrazovky je aktuálny". Zjednotenie ten tvar
  nesmie zošúchať na generickú vetu.
- **hero podoba chyby je vyhradená pádu štartu.** `.empty-network` je
  `position: fixed; inset: 0` nad plátnom; chyba v karte obrazovky nesmie byť fixed.
- **v chybe nie je mýtus.** „Vedomie sa nepodarilo prebudiť" je jediná mýtická
  chybová veta a je vyhradená pádu štartu; jej titulok je **Geist, nie serif**.

**Namerané pred vlnou 1: deväť kresieb chyby v štyroch stylesheetoch.** Tokenovo sú
takmer konzistentné — **všetok text komponentov 5–9 ide cez `--danger-ink`** — takže
zjednotenie je práca s markupom a triedami, nie s farbou. **[cieľ V1]** šesť
obrazoviek dát; **[cieľ V3]** `/console`, `/chat`, dok.

### Načítavanie — skeleton alebo dýchajúci znak

Rozhodnutie 15: **skeleton v tvare obsahu.** `/api/journal` a `/api/dashboard`
bežia **3–4 s**, takže načítavanie nie je okrajový stav.

| Situácia | Kresba |
|---|---|
| endpoint plní **zoznam alebo mriežku** a beží > ~300 ms | **skeleton v tvare obsahu** |
| endpoint plní **jednu hodnotu v už existujúcej karte** | **dýchajúci znak** |
| soft-refresh nad už vykresleným zoznamom | **nič** — ponechaj starý obsah |

Pravidlá skeletonu:

- **kopíruje hierarchiu hotovej obrazovky** (hľadanie → hero → mriežka → karty),
  aby sa rozloženie po dobehnutí dát neprelialo. Cieľ je CLS < 10 % výšky.
- **rozmery drží CSS, nie volajúci.** Rozmer napísaný v JS je pre CSS neviditeľný
  a žiadna asercia nad CSSOM ho nenájde — presne tak vznikol inline
  `font-size:10px` na osi grafu (`charts.js:484`).
- **jedna mechanika, jedna perióda.** Dnes existujú dve mechaniky (translateX
  v `mind.css` a opacity v `console.css`) a perióda je raz `--dur-pulse`, raz ručne
  napísané `1.4s`.
- **pod ~300 ms sa skeleton nekreslí** — blik pôsobí pomalšie než ticho.
- **skeleton má `sr-only` oznámenie.** `console/main.js:78` to robí správne
  (`<p class="sr-only">Vlákna sa načítavajú…</p>`); bez toho čítačka obrazovky
  nedostane nič.
- **tichá verzia skeletonu je pokojná plocha bez lesku**, nie zastavený sweep.

**Dýchajúci znak** je súosé kruhy značky (ten istý motív ako jadro a favicon), nie
generický spinner. Prstenec je **plný `--accent`**, nie `--border-accent`: je to
jediný nositeľ informácie „pracujem", takže musí sám držať 3:1 (poloprehľadný okraj
dával na tmavej 2,7:1 a na svetlej 1,5:1). Animácia hýbe **len mierkou** — keď
dýchala aj opacitou, v spodnej fáze klesol kontrast na svetlej téme na 2,3:1.

**Namerané pred vlnou 1: skeleton majú 2 miesta z 12.** Dashboard (**Dnes**) ho má,
**Denník nie** — druhý najpomalší endpoint appky je jediný, ktorý by ho potreboval
najviac. **[cieľ V1]** šesť miest.

### Kodifikované stringy

| Situácia | Text |
|---|---|
| Pád API (hero) | **Vedomie sa nepodarilo prebudiť** + „Server neodpovedá — skontroluj, či Hades beží." |
| Pád načítania (komponent) | **„&lt;Predmet&gt; sa nepodarilo načítať"** + „Server neodpovedá — skús to znova." |
| Stav vedomia | `bdie` / `spí` |
| Načítavanie | „Načítava sa…" — **neosobne** |
| Prázdny Charón | „Napíš úlohu. Charón vidí celú pamäť Hadesa aj súbory projektu — a čo chce zmeniť, ukáže dopredu." |

Pravidlo: **jedna značková veta, potom vecné vysvetlenie.** Nikdy dve mýtické vety
za sebou a nikdy mýtus v texte, ktorý má človek použiť na opravu chyby.

**Prázdny Charón má dnes tri rôzne kompozície na troch plochách** — `/console`
presne podľa manuálu (znak + nadpis + text + 4 schopnosti), `/chat` vlastnú
parafrázu bez zoznamu a bez animácie znaku, dok nad grafom tretiu formuláciu bez
znaku. **[cieľ V2]** jedna kompozícia.

---

## 9. Aplikácia

### Titulky

Formát je **`Hades — <obsah>`**, značka prvá:
`Hades — Vedomie`, `Hades — Charón`.

### Graf

Znak žije v raile (`#brand-core`) — jediný výskyt na obrazovke, so slovom `Hades`
pod ním. Geometria je zmenšenina mini verzie (prstenec r .36 / hrúbka .09,
jadro r .15). Prstenec je amethyst, jadro zlaté.

`#brand-core` je pomenovaná výnimka kánonu: je to `<button>`, ale zlatá tam nesie
identitu, nie interaktívny stav — všetky jeho stavy (fokus, hover) sú amethystové.
Ďalšie menované výnimky, a **nič nad ne nepridávaj**: `.avatar` a
`.empty-loading .load-mark` sú značkový znak.

**Plátno grafu sa redizajnom nemení** (rozhodnutie 7): živý force layout zostáva,
determinizmus sa **nezavádza** — bola to raz vlastná podmienka, ktorá zabila živý
dojem siete. Dolaďujú sa len **prechody**: zanorenie, hľadanie uzla, prílet uzla
cez WebSocket. `rAF` sa mimo obrazovky Graf **musí zastaviť**.

### Rail

Nová sekcia — manuál doteraz nemal šírku ani stav.

| | Zbalený | Rozbalený **[cieľ V2]** |
|---|---|---|
| šírka | `--rail-w: 80px` | ~208 px |
| labely | 10 px pod ikonou | vedľa ikony |
| stav | — | **persistovaný** |

- rail sa dá **zbaliť aj rozbaliť** a stav prežije obnovu stránky,
- labely v raile sú **Geist**, nie wordmark, a zostávajú **chróm** (nezdvíhajú sa
  s dátovým textom),
- eyebrow skupín (`Teraz`, `Záznamy`, `Znalosti`) je `--fs-micro` a zostáva.

Zmerané: **pri 594 px výšky okna má rail 562 px a žiadny `overflow-y`**, takže
rozbalenie nemá dôvod pridať vnútorný scroll.

**Pasca, ktorá k tomu patrí:** rail je vstupom do derivovaného tokenu
`--content-left` a **komentár pri ňom tvrdí nepravdu** — `mind.css:267` hovorí
`/* 104px */`, ale `--edge: 16px` + `--rail-w: 80px` + `--edge` = **112 px**.
Rozbalenie railu to číslo mení znova, takže sa opravuje spolu s ním.
Okraje plátna čítajú CSS tokeny (`--rail-w`, `--header-h`, `--panel-w`, `--edge`) —
**nezadrôtuj ich znova do JS**.

### Grafy — jeden jazyk

Rozhodnutie 23. Manuál doteraz dával len tri trvania animácií.

| Vrstva | Pravidlo |
|---|---|
| **os** | mono, `--fs-chart-axis` (11 px), `--muted`, `--ls-mono`; trieda `.chart-axis`, **nikdy inline rozmer** |
| **mriežka** | `--line-soft`; mriežka nesmie byť kontrastnejšia než dáta |
| **legenda** | tá istá veľkosť ako os; swatch oblasti vždy cez `mutedColor()` |
| **tooltip** | `--elev-tooltip`, papier `--panel-solid`, nikdy sklo |
| **rampa** | sekvenčná `--heat-1..4`; kategórie nesie farba oblasti |
| **nula** | papier s obrysom, **nie** najsvetlejší krok rampy |
| **prístupná alternatíva** | heatmapa si drží `role="img"` a `.sr-only` tabuľku — **povinné**, nie voliteľné |

Animácie grafov (760 / 900 / 720 / 90 ms) sú v §3 a ich tichá verzia je v JS —
`charts.js` triedy **vôbec nepridá**, nie že by ich CSS potom prebíjalo.

### Responzivita

Nová sekcia — manuál doteraz nemal ani jednu šírku.

Rozhodnutie 18: **desktop prvý (1280–1920).** Na **768–900 px nesmie nič
prekrývať**. Telefón sa nerieši.

Existujúce zlomy v kóde: **1280 px** a **900 px** (`mind.css:3725`, `:3730`),
**860 px** (`console.css:1295`, `chat.css:750`, `:796`). Tri zlomy, tri súbory —
zjednotiť na 1280 / 900. **[cieľ V3]**

Pravidlo pre panely: **na úzkom okne (< 900 px) sa stav prekryvu nepamätá.**
Odkaz otvorený na úzkom okne nesmie pripichnúť prekryv, ktorý si človek nikdy
nevybral — a to platí pre `localStorage` **aj pre URL**.

### Charón

Konzola vedomia sa volá **Charón** — prievozník, ktorý sprostredkúva medzi človekom
a pamäťou. Nie je to nová URL: `/console` a `/console/<uuid>` zostávajú, aby odkazy
na existujúce vlákna žili. Od 25. 8. 2026 je `/chat` plnohodnotná appka a `/console`
technická konzola; **beh je jeden** pre všetky tri vstupy vrátane doku nad grafom.

- vizuálne **žiadne odlíšenie** od zvyšku appky — tie isté tokeny, ten istý chróm,
- v hlavičke vlákna je `Charón`, nie „Konzola vedomia",
- autor odpovedí je **Charón** (Hades je vedomie; Charón je ten, kto hovorí),
- vľavo hore je **znak**, nie ikona `hub` — a klik vedie do grafu.

**Brána zápisov je bezpečnostná mechanika, nie dizajn.** Vzhľad karty povolenia sa
môže zmeniť; mechanika a jej texty nie. Zápis zaparkuje, ťah skončí **bez rámca
`end`**, obnova je len z `/decide`, a pri podagentovi ide `/decide` na **jeho**
vlákno. **„Povoliť vždy" sa na karte podagenta nekreslí** — zadanie podagenta
nepísal človek, ale model.

**Diagramy sa nekreslia** a je to zmerané rozhodnutie, nie opomenutie: z 36
reálnych odpovedí modelu malo oplotený blok 0, diagramov 0, tabuliek 0 — a mermaid
stojí 195 kB gzip pred prvým diagramom. ` ```mermaid ` je preto blok kódu; spúšťač
na prehodnotenie je **5 % odpovedí**. Náhľad HTML je `<iframe sandbox>`, nikdy
`innerHTML` — je to výstup modelu.

### Favicon

Mini sigil na tmavom disku: `#0e1413` podklad, prstenec `#c4a2f5` (r 36, hrúbka 9),
jadro `#d8b878` (r 15). Inline SVG v `<link rel="icon">`, **rovnaký na všetkých
stránkach** — dnes bit-identický (md5 `c0ebff62…` × 3) ✅, ale zapísaný trikrát;
jeden zdroj je **[cieľ V2]** (§2).

---

## 10. URL a zdieľateľnosť

Nová sekcia. Manuál doteraz nemal o URL ani vetu, a kód to odzrkadľoval: **8
obrazoviek, 0 zápisov do URL.**

### Nameraný stav pred vlnou 2

| Čo | Koľko |
|---|---|
| `history.pushState` v `public/js` | **6** (`chat` 3, `console` 3, `mind` **0**) |
| `history.replaceState` | **0** |
| `popstate` listenerov | **4** (`chat` 3, `console` 1, `mind` **0**) |
| miest, kde sa v JS číta URL | **1** (`mind/state.js:87` — `?screen=`) |
| `localStorage` kľúčov | **21** |

Dôsledok, ktorý sa dá napísať ako veta: **po `F5` na obrazovke Kontrola
s nastaveným filtrom typ + istota + oblasť + text a `limit=300` je človek spät na
prvej stránke celej fronty bez filtra.** To isté na Rozhodnutiach a Runách.
A zanorenie grafu prežije, ale **len v `localStorage`** — teda nezdieľateľne, a
v druhom tabe toho istého prehliadača sa ticho prepíše.

### Čo do URL patrí a čo nie

Rozhodnutie 9. Delenie je Linearovo a je to jazyk, ktorý toto rozhodnutie
potrebuje: **do URL ide to, čo definuje MNOŽINU; nie to, čo definuje ZOBRAZENIE.**

**Do URL patrí:**
obrazovka · zanorenie grafu (oblasť / oddelenie / uzol) · pohľad Sieť / Vrstvy ·
rozsah live / all · filtre grafu vrátane min. váhy a kostry · filtre a hľadanie
šiestich obrazoviek dát · vetva konverzácie · stav panelov a otvorený artefakt.

**Do URL nepatrí — a každý dôvod je vlastný, nie „je toho veľa":**

| Stav | Prečo nie |
|---|---|
| téma | vlastnosť oka a monitora; zdieľaný odkaz by vnucoval prijímateľovi cudziu tému |
| hustota, zvuk, `S.opts` (9 hodnôt) | ergonómia a vzhľad; 9 čísel je najdlhší možný príspevok za najmenšiu zdieľateľnú hodnotu |
| **kamera** (`x`, `y`, `k`) | force layout je **živý**, takže tá istá kamera nad inak usadenou scénou zaberá iný výrez. Zapisovať ju by bola **lož** |
| šírky panelov | ergonómia monitora; a ťahanie gripu by znamenalo zápis na každý `pointermove` |
| **kontext uzlov v doku** (`hades.charonCtx`) | je to až 8 `node_id`, ktoré idú na server ako `context_node_ids` a stanú sa **vstupom do behu modelu**. Adresa, ktorá predplní kontext modelu, je injekčná plocha na ceste verejne tunelovanej cez ngrok — a nič sa tým nezíska, lebo mŕtve id sa aj tak prunujú |
| prehrávanie času (replay) | je to prehrávanie, nie stav; zápis na každý frame by bol najhorší možný |
| vlákno doku, badge „nové od poslednej návštevy", odklikaná onboarding karta | per-prehliadač zo svojej podstaty |

### Tvar adresy

Rozhodnutie 27: **krátke kľúče, defaulty sa vynechávajú.** Čistý stav = adresa
bez query stringu.

1. kľúče sú **1–3 znaky, malé písmená**,
2. **poradie kľúčov je pevné** (poradie riadkov v tabuľke schémy), nie poradie
   zmien — inak by ten istý stav dal dve rôzne URL a `replaceState` by „menil"
   adresu bez zmeny stavu,
3. **množiny sa serializujú opakovaným kľúčom** (`ty=memory&ty=project`), nie
   oddeľovačom. Dôvod je meraný: `S.filter.tags` obsahuje značky z DB, teda voľný
   text, ktorý môže obsahovať čiarku aj bodkočiarku, a `URLSearchParams` by čiarku
   zakódovala na `%2C`,
4. **hodnoty množín sa radia** — ten istý stav, tá istá URL,
5. prepínače sú `1` / `0` a serializujú sa len v nedefaultnej hodnote,
6. **žiadny base64 JSON balík.** Zabalený stav v query stringu je presne to, čo
   robí odkaz nezdieľateľným a nedebugovateľným. Ak je kľúč príliš dlhý, správna
   reakcia je **strop na počet hodnôt s priznaným skrátením**, nie balík.

**Krátke kľúče sú bez tabuľky chyba.** Preto je tabuľka schémy (kľúč → čo nesie →
default) súčasťou manuálu **a** jediným miestom v kóde, ktoré kľúč serializuje aj
deserializuje.

### Rezervované názvy

| Názov | Kto ho používa | Prečo je rezervovaný |
|---|---|---|
| `token` | `AuthenticateUi::tokenFromRequest()` | jednorazové odomknutie; middleware ho po odomknutí sám odstrihne redirectom a ostatné parametre zachová |
| `k` | `bin/hades-app.mjs` | jednorazový kľúč lokálneho proxy; **v adresnom riadku zostane** |
| `screen` | legacy `mind/state.js:87` | prijímať na čítanie ako alias `s`, **nikdy nezapisovať** |

**`token` a `k` sa pri prvom `replaceState` zahodia** (obe sú tajomstvá v adrese
a obe už majú druhú cestu — session cookie). **Každý iný neznámy kľúč sa prenesie
nedotknutý** — tak sa cudzí parameter nestratí a tajomstvo v adrese neprežije.

### História — jedna veta a jedna tabuľka

Rozhodnutie 10: **`push` = zmenil som, na čo sa pozerám. `replace` = zmenil som,
ako sa na to pozerám.**

| `pushState` | `replaceState` | nič |
|---|---|---|
| prepnutie obrazovky | filtre a hľadanie (debounce **220 ms**) | ťahanie uzla, pan, zoom, pinch |
| zanorenie / `goUp()` / `Esc` | min. váha (debounce **200 ms** — `oninput` na slideri strieľa desiatky ráz za sekundu) | prehrávanie času |
| prepnutie pohľadu Sieť / Vrstvy | otvorenie a zavretie panela detailu | téma, hustota, zvuk |
| prepnutie rozsahu live / all **človekom** | automatické rozšírenie rozsahu **dôsledkom** | otvorenie doku |
| skok na uzol z hľadania — **jeden** záznam, nie štyri | lokálny graf, kostra, predvolby | šírky panelov |
| otvorenie vlákna, nové vlákno, zatvorenie vlákna | „Načítať ďalších", rozbalenie behu | rozbalenie projektu / stromu podagentov |
| **prepnutie vetvy** konverzácie | stav panelov, otvorený artefakt | hľadanie v histórii vlákien |

Dve pravidlá, ktoré z tabuľky nie sú vidieť a bez ktorých sa história zaplní:

- **Jedno gesto = jeden záznam.** Skok na uzol z palety mení obrazovku **aj**
  zanorenie **aj** vybraný uzol **aj** možno rozsah. Musí to byť **jeden**
  `pushState`, nie štyri.
- **Zmenu, ktorú nevyvolal človek, robí `replace`.** Automatické rozšírenie rozsahu
  na `all` je dôsledok, nie gesto — ako `push` by bol záznamom v histórii, ktorý
  nikto neurobil. To isté platí, keď `go()` vyvolá **model** cez `graph_focus`:
  model nenavigoval, len zameril.
- **Prepnutie obrazovky maže kľúče filtrov atomicky.** Bez toho `?s=runy&y=2026`
  prenesie rok z Rozhodnutí na Runy.

### Neplatný stav v adrese — jedno pravidlo pre všetko

1. **Neplatná hodnota sa zahodí ticho a adresa sa opraví `replaceState`om.**
   Adresa po načítaní musí opisovať to, čo je na obrazovke — inak sa dá `F5`
   dostať do iného stavu než z odkazu.
2. **Chýbajúci objekt sa nehlási ako chyba, ale ani sa neignoruje.** Uzol z odkazu,
   ktorý medzitým zmizol, **spadne o úroveň vyššie** (existujúca mechanika
   `clampNav()`) a povie to jednou vetou v breadcrumbe. Filter, ktorý nemá čo
   ukázať, sa zruší existujúcimi `prune*()` funkciami — **nepíš druhú**.
3. **Číslo, ktoré nie je číslo, je ako chýbajúce** — a to už pri parsovaní, nie
   náhodou v `NaN`.
4. **Nikdy toast pri obnove stránky.** Neplatný stav sa hlási tam, kde by človek
   čakal obsah (breadcrumb, prázdny stav karty), nie plávajúcou bublinou.

### „Čistá URL" pri paneloch neznamená „predvolené rozloženie"

Pri stave panelov je default **dvojvrstvový** a je to nutné:

- kľúč **chýba** → preferencia človeka z `localStorage`,
- kľúč **je** → explicitný príkaz z odkazu, prebije preferenciu,
- prepnutie panela zapíše **oboje**.

Bez tej dvojvrstvy by každý odkaz vnucoval prijímateľovi cudzie rozloženie, alebo
by sa naopak nikdy nedalo poslať „pozri sa na tento artefakt s otvoreným panelom".
Preto: **čistá URL tu znamená „moje rozloženie", nie „predvolené".**

### Adresa nikdy nespúšťa akciu

Odkaz je **žiadosť o pohľad**. Adresa, ktorá vykoná akciu, by v Hadesovi bola cesta
okolo dvojfázovej brány — zakázané, aj v čítacej podobe.

Z toho vyplývajú dve konkrétne veci:

- **beh číta aktívnu vetvu vždy zo servera, nikdy z URL.** `console_threads` je
  jediný zdroj toho, ktorá vetva je aktívna; kľúč v adrese vetvu **aktivuje**
  existujúcou cestou, nie je to druhý kanál do modelu.
- **identita v adrese je uuid, nikdy poradové číslo.** „Vetva 2" je slovo plochy
  nad `ORDER BY id`, takže zmazaním jednej vetvy by sa všetky uložené odkazy ticho
  presunuli na inú.
- **zdieľanie odkazu neudeľuje prístup.** Filter v adrese neobchádza `auth.ui`.

### Jedna otvorená otázka

**Kto serializuje filtre — server alebo prehliadač?** Invariant dvojitej plochy
hovorí „počty, skupiny, filtre a krátenie textu sú **dáta** a patria na server",
ale adresu vlastní klient. Sonda B navrhuje **nezlučovať** serverový dopyt
(`URLSearchParams` v `rozhodnutia.js:38`, `runy.js:56`, `kontrola.js:52`) s adresou
prehliadača — sú to dve rôzne veci a zlúčenie by z „jedného miesta" spravilo jedno
miesto pre dve pravdy. **Nerozhodnuté; nerobiť pred odpoveďou používateľa.**

---

## 11. Assety (`public/brand/`)

| Súbor | Použitie |
|---|---|
| `hades-sigil.svg` | znak, master — od 32 px |
| `hades-sigil-mini.svg` | znak, mini — pod 24 px |
| `hades-sigil-mono.svg` | jednofarebné podklady, tlač, razítko (`currentColor`) |
| `hades-wordmark.svg` | samotný wordmark v krivkách (`currentColor`) |
| `hades-lockup-h.svg` | horizontálny lockup |
| `hades-lockup-v.svg` | vertikálny lockup |
| `hades-og.png` | náhľad odkazu, 1200 × 630, tmavý |
| `hades-sigil-{512,256,128}.png` | znak pre deck a prezentácie, priehľadné pozadie |
| `hades-lockup-{1200,600,300}.png` | lockup pre deck, priehľadné pozadie |
| `apple-touch-icon.png` | dlaždica iOS, 180 × 180 |

Mimo tohto adresára: `public/favicon.ico` (z **mini** verzie, 16–256 px),
`electron/assets/hades.ico` (desktop) a inline SVG favicon priamo v `<head>`
všetkých troch stránok.

SVG assety sa prispôsobujú téme samy cez `prefers-color-scheme` — jeden súbor drží
obe verzie, netreba `-dark` / `-light` dvojičky.

**Pasca pri vkladaní znaku do väčšieho SVG:** jeho `<style>` platí pre celý
dokument, takže `path { fill: none; stroke: … }` utečie na písmo lockupu a wordmark
sa vykreslí obtiahnutý namiesto vyplneného. Preto sa pravidlá znaku pri vkladaní
zapuzdrujú pod `.sig` (robí to `build-brand.py`).

---

## 12. Checklist pred odovzdaním

**Farba a povrch**
- [ ] žiadny raw hex ani rgba mimo `:root` — všetko cez tokeny
- [ ] amethyst nesie interaktivitu, zlato len jadro a znak
- [ ] základná hodnota nie je farba textu tam, kde existuje `-ink` varianta
- [ ] sklo len na tmavej téme; scrim pod modálom je pomenovaná výnimka s **jednou** hodnotou
- [ ] swatch oblasti v DOM ide cez `mutedColor()`
- [ ] text 4,5:1, grafika 3:1 — a **nezhoršiť žiadny pár** oproti predchádzajúcemu stavu

**Typografia**
- [ ] každá deklarácia `font-size` deklaruje aj `line-height`
- [ ] dátový text nie je pod 13 px (čip 12, os grafu 11); chróm zostal 10–11
- [ ] serif len na dvoch rolách — titulok obrazovky a jedno primárne číslo
- [ ] font, ktorý nesie prvý rámec, je preloadovaný
- [ ] titulok `Hades — <obsah>`

**Znak a ikony**
- [ ] znak: master nad 32 px, mini pod 24 px, nikdy naopak
- [ ] geometria znaku pochádza z jedného generátora
- [ ] jeden význam = jedna ikona; sada je obrysová a jediný plný prvok je jadro
- [ ] nová ikona → regenerovaný subset (kým je subset v hre), overený **šírkou glyfu**

**Stavy**
- [ ] prázdny stav: čo to je / prečo / **najviac jedna** akcia
- [ ] prázdno z filtra sa odlišuje od prázdna z neexistencie dát
- [ ] chyba pomenuje predmet, ponúka jednu akciu a **nikdy nehlási prázdno**
- [ ] skeleton kopíruje tvar obsahu, rozmery drží CSS, má `sr-only` oznámenie
- [ ] hlas neosobný — `grep -rn "Načítavam\|Skladám\|Pamätám" public/js/` = 0

**Pohyb**
- [ ] každá animácia má pomenovaný účel
- [ ] každá nová animácia má **tichú verziu** = zmysluplný okamžitý ekvivalent,
      nie „vypnuté"
- [ ] trvanie a krivka sú tokeny; „neurčité čakanie" má **jednu** periódu
- [ ] `rAF` sa mimo obrazovky Graf zastaví

**URL**
- [ ] čistý stav = adresa bez query stringu; default sa vynecháva
- [ ] jedno gesto = jeden záznam v histórii
- [ ] neplatná hodnota sa opraví `replaceState`om, nie toastom
- [ ] adresa nespúšťa akciu a nenesie tajomstvo

**Overenie**
- [ ] dôkaz je zmeraný DOM a computed style, **nie screenshot**
- [ ] zmena CSS overená výmenou stylesheetu nad **tým istým** DOM
- [ ] merací harness **kalibrovaný z oboch strán** — na známom kladnom aj zápornom prípade
- [ ] merané na **oboch** témach

---

## 13. Pôvod

Písmo: **Cinzel** (OFL), stiahnuté z Google Fonts 20. 8. 2026 so súhlasom
používateľa, variabilná os `wght` zafixovaná na 600. Zdrojový TTF v repe nie je —
sú v ňom len krivky a 1,2 kB subset.

Assety stavia `build-brand.py` (scratchpad): číta `hades-sigil.svg`, vyťahuje
glyfy z Cinzelu cez `fontTools` a skladá wordmark aj lockupy. Keď sa zmení znak,
prestavajú sa aj lockupy — ručne sa neupravujú.

Merania v tomto manuáli pochádzajú z `docs/redesign-2026-08-27/SONDA-A-INVENTAR.md`
(inventár a rozpor proti manuálu) a `SONDA-B-URL-STAV.md` (stav v URL
a `localStorage`), oba z 27. 8. 2026. Skripty merania sú v scratchpade sond;
ich mená sú uvedené v sondách, aby sa dali zopakovať a **prekalibrovať**.
