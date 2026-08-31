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
nemá sekciu. Každé číslo tu má zdroj — nie dojem.

**Druhý prepis (27. 8. 2026, beh vlny 2 + 3)** opravil päť tvrdení, ktoré manuál
podával ako namerané a neplatili. Sú vymenované nahlas, pretože podľa nich už raz
niekto pracoval:

| Kde | Tvrdilo | Namerané |
|---|---|---|
| §2 | geometria znaku je zapísaná **8×** | **16×** v repe + 2 binárky |
| §3 | plošná podlaha je na `mind.css:2728–2736` | **`:2852–2861`**; na 2728 stojí `min-height` prázdnych stavov |
| §3 | `ease-in-out` sa objavuje **5×** | **4×** + jedno `ease` (`charon.css:257`) |
| §7 | ligatúr je **41** (subset 215 glyfov) | **61** ligatúr, **254** glyfov |
| §9 | pri 594 px výšky rail nemá overflow | `overflow-y: visible` áno, ale **obsah 712 px proti 560 px** a dve destinácie sú nedosiahnuteľné |

Merania pochádzajú zo štyroch sond z 27. 8. 2026 (A: URL a `localStorage`,
B: ikony a subset, C: pohyb a tiché verzie, D: rail, zlomy, typografia a chyba),
všetky nad živou appkou cez proxy `127.0.0.1:8091` s overenou identitou servera.

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

**Prepísané 28. 8. 2026** (kontrakt `KONTRAKT-DIZAJN-BRANDING-2026-08-28.md`, A1).
Predchádzajúca konštrukcia (prstenec A 46/1,5, stupnica 60 delení, B 34/3,5, C 22,
satelit na r 46, jadro 8,5) **už neplatí** — je vymenená, nie doplnená.

| Prvok | Polomer | Hrúbka | Poznámka |
|---|---|---|---|
| Vlásková hranica | 47 | 1,0 | neprerušená, opacity 0,55 — len rám deja |
| Stupnica | 43–47 | 1,0 | **12 delení po 30°**; v prerušení mlčí, opacity 0,45 |
| **Nosný prstenec** | **36** | **9** | hmota znaku, **prerušená 34°** v smere 52°. **Totožná s mini kánonom.** |
| Hrana | 30 → 18 | 1,6 | od satelitu k jadru, v smere 52°, opacity 0,75 |
| Satelit | 5,5 | 2,5 | jeden uzol, **prstenec, nie disk**, v prerušení **na** nosnom prstenci |
| Obežnica jadra | 22 | 1,0 | zlatá |
| **Jadro** | **15** | výplň | **jediný plný prvok znaku**, zlaté. **Totožné s mini kánonom.** |

Uhol 52° od vertikály je jediná asymetria a nesie celý dej — neposúvať ho „aby to
bolo vyvážené"; symetrický znak stráca vetu.

### Pravidlo redukcie (prečo master a mini konečne súhlasia)

Dovtedajšia porucha nebola vzhľad, ale to, že **master a mini boli dva rôzne
výkresy**: favicon a načítavacia značka kreslili prstenec s pomerom 0,36 boxu,
master 0,46. Znak vedľa znaku teda nesúhlasil.

Nový master je **nadmnožina mini** — nosný prstenec r 36 / hrúbka 9 a jadro r 15 sú
v oboch tie isté hodnoty (overené parsovaním oboch súborov). Rozdiel je len
v detaile a ten sa **redukuje podľa veľkosti**:

| Veľkosť | Čo sa kreslí |
|---|---|
| ≥ 64 px | celý master: hranica, 12 delení, prerušenie, hrana, satelit, obežnica, jadro |
| < 64 px | mini: nosný prstenec (**zatvorený**) + jadro |

Prerušenie a satelit sa v malom **zatvárajú zámerne**, nie z opomenutia, a dôvod je
technický aj vizuálny. Technický: `Mini` parser generátora prijíma presne dva kruhy,
raster kreslí prstenec ako anulus dvoma diskami a `.load-mark` je CSS `border` —
ani jeden z tých troch výstupov prerušenie vyjadriť nedokáže. Vizuálny: pri 16 px má
34° medzera 3,4 px a satelit obrys 1,8 px, teda detail, ktorý by sa rozpadol na
antialiasingu. **Keď sa raz mini má prerušiť, musia sa zmeniť všetky tri výstupy
naraz** — inak sa vráti presne ten rozchod, ktorý toto pravidlo rieši.

### Jeden zdroj geometrie

**Geometria znaku bola 28. 8. 2026 zapísaná 16× v repe; dnes je z toho 14 miest pod generátorom a lockupy pribudli ako 17. a 18. miesto, ktoré generátor nemal.** Zoznam nižšie je stav PRED zjednotením a číta sa ako inventár, nie ako TODO.
Manuál tu do 27. 8. 2026 tvrdil „osemkrát" — bolo to podhlásené, pretože počítalo
len web a Python a nevidelo Electron chrome, offline stav a **CSS prekresbu**
načítavacej značky. Toto je úplný zoznam a je to vstup pre implementátora znaku:

| # | Miesto | Tvar zápisu |
|---|---|---|
| 1 | `public/brand/hades-sigil-mini.svg:7–8` | **kánon mini**: viewBox 100, prstenec r 36 / hrúbka 9, jadro r 15; farby z `prefers-color-scheme` |
| 2 | `public/brand/hades-sigil.svg` | **kánon master**: hranica 47 / 12 delení / nosný prstenec 36–9 prerušený 34° / hrana / satelit 5,5 / obežnica 22 / jadro 15 — **GENEROVANÝ z mini, ručne needituj** |
| 3 | `public/brand/hades-sigil-mono.svg` | master znovu, jednofarebne (`currentColor`) |
| 4 | `resources/views/mind.blade.php:16` | data-URI faviconu: disk r 50 `#0e1413`, prstenec r 36/9 `#c4a2f5`, jadro r 15 `#d8b878` |
| 5 | `resources/views/console.blade.php:20` | to isté, **bajt na bajt** (md5 `c0ebff62…`) |
| 6 | `resources/views/chat.blade.php:44` | to isté, **bajt na bajt** |
| 7 | `resources/views/mind.blade.php:130–131` | viewBox 24: `r 8.64` / `stroke 2.16` / jadro `r 3.6`; `fill="currentColor"`; triedy `bc-ring` / `bc-core` |
| 8 | `resources/views/console.blade.php:55–56` | tie isté tri čísla; `fill="var(--brand-gold)"`; triedy **sú** |
| 9 | `resources/views/chat.blade.php:86–87` | tie isté tri čísla; `stroke="var(--accent)"`; **triedy nie sú** → bez animácie |
| 10 | `resources/views/chat.blade.php:182–183` | tie isté tri čísla, v `.ce-mark`; **triedy nie sú** |
| 11 | `public/js/console/render.js:41–46` | tie isté tri čísla, skladané `setAttribute`om v JS |
| 12 | `public/css/mind.css:1233–1234` a `:1246` | `stroke-dasharray: 54.29` = 2π × 8,64 — **derivát polomeru zapísaný ako konštanta**, na troch riadkoch |
| 13 | `public/css/mind.css:2637–2652` | `.empty-loading .load-mark` — znak **prekreslený CSS boxmi**, a v **iných proporciách**: 26 px box, `border: 2px` (obrys 0,077 boxu, kánon 0,09), jadro 8 px (0,154 boxu, kánon 0,15), stredný polomer prstenca 0,46 boxu proti kánonickým 0,36 |
| 14 | `electron/assets/build-icon.py:16–40` | **znovu implementované v Pythone**: hardcoded RGB tuply, prstenec ako anulus r 40,5 mínus r 31,5 |
| 15 | `electron/chrome/topbar.html:156–159` | viewBox 100, r 36/9 + r 15, `var(--accent)` / `var(--gold)` |
| 16 | `electron/states/offline.html:64–75` + `:174–177` | viewBox 100, `r 36` v markupe, `stroke-width: 9` a jadro `r 15` v `<style>`; navyše **vlastná kópia `core-pulse 4s ease-in-out`** |
| — | `public/favicon.ico` (40 717 B) | binárka, **generátor v repe NIE JE** |
| — | `electron/assets/hades.ico` | binárka z #14 |

Tri veci, ktoré z tabuľky treba vedieť predtým, než sa to začne zlievať:

- **`.load-mark` (#13) nie je znak, je to jeho nepresná citácia.** Proporcia
  prstenca je 0,46 boxu namiesto 0,36, čo je o 28 % viac — teda načítavanie kreslí
  iný znak než favicon vedľa neho. Nie je to preklep: 26 px box s 2 px obrysom je
  hodnota vybraná pre kontrast (komentár nad pravidlom to vysvetľuje a je pravdivý),
  takže **generátor musí vydať aj tieto tri čísla**, nie ich len prepísať.
- **`fill="currentColor"` (#7) a `fill="var(--brand-gold)"` (#8, #9) dnes vychádzajú
  rovnako**, lebo `#brand-core { color: var(--brand-gold) }` — ale sú to dva
  mechanizmy a jeden z nich zanikne pri prvej zmene farby. Kánon je
  `var(--brand-gold)`; `currentColor` sa opúšťa.
- **`electron/states/offline.html` má vlastnú kópiu `core-pulse`** s krivkou
  `ease-in-out`, ktorú §3 v appke zakazuje. Je to samostatný dokument bez
  `mind.css`, takže **plošná podlaha `prefers-reduced-motion` ho nekryje** — tichú
  verziu si musí napísať sám.

**[cieľ V2] Jeden generátor, šesť výstupov.** Zdroj je `hades-sigil-mini.svg`
(mini) a `hades-sigil.svg` (master). Generátor musí vydať:

1. SVG assety v `public/brand/`,
2. data-URI faviconu pre všetky tri `<head>`,
3. inline `<svg>` znaku pre Blade (viewBox 24, s triedami `bc-ring` / `bc-core`),
4. `public/favicon.ico` **a** `electron/assets/hades.ico`,
5. hodnotu CSS `stroke-dasharray` (dnes `54.29`) a tri čísla `.load-mark`,
6. znak pre Electron chrome a offline stav.

Keď niektorý z tých šiestich vypadne, sedemnásty zápis pribudne znova — už sa to
stalo šesťnásťkrát. **Vlastníctvo:** `public/favicon.ico` je koreň pre web,
`electron/assets/hades.ico` pre desktop, a oba vydáva ten istý generátor.

### Kde znak je a kde má byť

Rozhodnutie 4–5: znak **viac prítomný, ale striedmo — len tam, kde niečo nesie.**
„Nesie" je v tomto manuáli uzavretý zoznam štyroch rolí a nič sa doň nepridáva bez
prepisu tejto vety:

| Rola | Čo znak hlási |
|---|---|
| **načítavanie** | pracuje sa — dýchanie mierkou (`load-breathe`) |
| **prázdny stav** | toto je Hades a je prázdny, nie rozbitý |
| **desktop okno** | identita appky v ráme, ktorý nie je prehliadač |
| **pulz behu** | vedomie bdie / spí (`core-pulse` na `#brand-core`) |

Mimo týchto štyroch rolí je znak **dekorácia** a nepridáva sa — ani do hlavičky
karty, ani do toastu, ani k nadpisu sekcie.

| Výskyt | Rola | Znak | Animuje sa |
|---|---|---|---|
| rail `/` (`mind.blade.php:130`) | pulz behu | ✅ | ✅ `bc-draw` + `core-pulse` |
| hlavička `/console` (`console.blade.php:55`) | pulz behu | ✅ | ✅ |
| prázdny stav `/console` (`console/render.js:41`) | prázdny stav | ✅ | ✅ |
| načítavanie (`.empty-loading .load-mark`) | načítavanie | ✅ | ✅ dýchanie |
| Electron topbar (`electron/chrome/topbar.html:156`) | desktop okno | ✅ | ❌ |
| Electron offline (`electron/states/offline.html:174`) | desktop okno | ✅ | ✅ vlastná kópia |
| hlavička `/chat` (`chat.blade.php:86`) | pulz behu | ✅ | ❌ **chýbajú triedy `bc-ring`/`bc-core`** |
| prázdny stav `/chat` (`chat.blade.php:182`) | prázdny stav | ✅ | ❌ to isté |
| prázdny dok nad grafom (`charon.js:678`) | prázdny stav | ❌ **znak vôbec nie je** | — |

**[cieľ V2]** všetkých deväť výskytov má znak a animáciu z jedného generátora,
a `.avatar` zostáva desiatym pomenovaným výskytom (§9) — nič nad tento zoznam.

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

### Pohyb nesmie zhasnúť informáciu

Toto je druhé pravidlo a je záväznejšie než prvé, pretože jeho porušenie sa nedá
vidieť. **Tichý režim smie odobrať pohyb, nikdy nie obsah, čas na prečítanie ani
spätnú väzbu.**

Nameraná porucha, ktorá to pravidlo vynútila (sonda C, `toasts.js:22–24`, `:38`,
`:67`, `:68`): pod `prefers-reduced-motion` sa v šiestich call-site prepisuje
**doba zobrazenia** toastu — 5 200 ms, 6 000 ms a 2 500 ms na **0 ms**. Toast sa
teda pridá do DOM a v tom istom rámci sa začne odstraňovať, takže človek
s preferenciou **nikdy neprečíta „Naučil som sa: …"** ani ponuku „Vrátiť". Skrátiť
sa smie výhradne 200 ms odchodový prechod.

Bez pohybu má človek **menej** signálu, že sa niečo objavilo, nie viac — takže
doba zobrazenia má byť v tichom režime rovnaká alebo **dlhšia**, nikdy kratšia.

### Trvania sú tokeny, nie čísla v komponente

**Rebrík rozhrania** — deväť tokenov a nič medzi nimi:

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
| `--ease-pulse` **[cieľ V2]** | `cubic-bezier(.4,0,.6,1)` | **slučka** — pulz, dýchanie, blikanie |

**`--ease-pulse` je nový token a nie je to kozmetika.** `--ease` je príchodová
krivka: spomaľuje na konci. Na nekonečnej slučke to znamená, že animácia dobehne
pomaly a potom **skočí** na začiatok — kulhá. Slučka potrebuje symetrickú krivku.
Zavedením tohto tokenu zmizne aj **všetkých päť cudzích kriviek** v repe: 4× ryzé
`ease-in-out` (`console.css:349`, `:574`, `:798`, `charon.css:208`) a jedno `ease`
(`charon.css:257`, kde je navyše natvrdo `.15s` — presne hodnota `--dur-fast`).
Manuál tu do 27. 8. 2026 tvrdil „`ease-in-out` sa objavuje 5×"; nameraných je **4**
a piata cudzia krivka je to `ease`.

**„Neurčité čakanie" má JEDNU periódu a to je `--dur-pulse`.** Dnes ich má štyri:
1,4 s cez token (`hades-shimmer`, `load-breathe`, `sync-pulse`), **1,4 s napísané
rukou** (`sk-pulse`, `console.css:349` — tá istá hodnota, iný zápis), **1,2 s**
(`think-blink` `console.css:574`, `charon-blink` `charon.css:208`) a **1,1 s**
(`tool-pulse` `console.css:798`). **[cieľ V2]** jedna perióda, jedna krivka.

**Grafové trvania sa povyšujú na tokeny [cieľ V2]** — nie preto, aby sa schovali,
ale preto, že jedno z nich už dnes žije na **dvoch** miestach a raz sa rozíde:

| Token | Hodnota | Kde |
|---|---|---|
| `--dur-chart-draw` | 760 ms | `bc-draw` (`mind.css:1238`) **a** `.seg-draw` donutu (`:2669`) — **tá istá hodnota, dva zápisy** |
| `--dur-chart-curve` | 900 ms | `.line-draw` (`mind.css:2672`) |
| `--dur-chart-reveal` | 720 ms | `.heat-grid.heat-reveal` (`mind.css:2687`) |

Zostávajú **číslom v komponente** a majú pri sebe komentár: `520 ms + 240 ms`
oneskorenie (`.chart-fade`), `760 ms` oneskorenie (`.chart-fade-late`),
`460 ms + 620 ms` (`bc-core-in`), `90 ms` stupňovanie segmentov a `4 s` dýchanie
jadra. Sú to jednorazové dramaturgie, nie stupne rebríka.

**Kompozitné tokeny `--transition-base` a `--transition-slow` sa mažú [cieľ V2]** —
majú **nula** používateľov (zmerané). `--transition-fast` má štyri
(`mind.css:5209`, `console.css:1089`, `chat.css:170`, `:403`) a prepisujú sa na
párový zápis `var(--dur-fast) var(--ease)`, ktorý má v repe prevahu 82 : 4. Dôvod
nie je počet, ale to, že kompozit **skrýva, ktorú krivku si dostal**.

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

**Jeden `@keyframes` nesie šesť významov a je to opak pravidla „jeden kanál, jeden
význam":** `rise-fade` (`mind.css:2004`) používajú `.toast`, `#help-card`,
`#md-card`, `#hint`, `.screen.active` a `#cmdk-card`, všetkých šesť s
`var(--dur-base) var(--ease)` a **ani jeden** nemá pomenovanú tichú verziu.
Nerozdeľuje sa to na šesť animácií — rozdeľuje sa to tak, že sa dva výskyty
**škrtnú** (viď nižšie).

**Kandidáti na škrt (rozhodnutie 6 — dekorácia, nie informácia):**

- **fade-in scrimu** pod `#help-overlay` (`mind.css:2146`) a `#md-overlay` (`:2194`)
  — karta nad ním už robí `rise-fade`. Jedna udalosť, dva pohyby.
- **`.screen.active { animation: rise-fade }`** (`mind.css:3415`) — prekresľuje
  **celý** obsah obrazovky pri každom prepnutí, hoci zmenu už hlási aktívny stav
  v raile aj nový `<h1>`. Je to jediný pohyb v appke nad celým obsahom obrazovky.

Tri pasce, na ktorých to inak vyzerá zle:

- **Obnova histórie nie je zrod.** Charón pri otvorení vlákna pridá desiatky blokov
  naraz; keby každý dostal `msg-in`, história by sa rozhýbala celá. `render.js`
  preto počas `renderThread()` triedu `is-new` nepridáva.
- **Heatmapa sa neanimuje po bunkách.** 365 buniek × vlastné oneskorenie = 365
  inline štýlov; odkrytie beží jednou animáciou nad mriežkou.
- **Zastavená animácia nie je tichá animácia.** Zastavený shimmer nechá sweep
  zamrznutý v polovici plochy, teda skeleton vyzerá ako rozbitý gradient. Viď nižšie.

### Štyri pohyby, ktoré vlna 2 mení

Rozhodnutie 7: plátno zostáva, dolaďujú sa **prechody**. Sú to presne štyri
a každý má svoju tichú verziu **hneď tu**, nie ako doplnok.

**1 · Zanorenie (`go()`) — jedna udalosť, jedna rýchlosť.**
Dnes beží na dvoch rýchlostiach naraz: kamera plachtí 550 ms s `easeInOut`
(`sim.js:476`), ale pretmavenie kontextu je **skok o jeden rámec** — `ent.dim`
dostane v `computeLayout()` diskrétnu hodnotu `DIM_CTX = 0,34` (`layout.js:112`,
`:819`) a nikde sa neinterpoluje. Cieľ: `ent.dim` sa interpoluje tým istým
časovačom, `--dur-base` (180 ms) — **kratšie než kamera zámerne**, fokus má byť
čitateľný skôr, než kamera dosadne.
*Tichá verzia:* `dim` aj kamera sadnú v jednom rámci (teda dnešný stav)
**a fokusová skupina dostane trvalý obrys**, ktorý nezhasne. Ukazuje sa výsledok
filtra, nie cesta k nemu. Nie `animation: none` — bez obrysu by človek nevedel,
čo je fokus a čo kontext.

**2 · Hľadanie uzla — jedno plachtenie namiesto skoku a plachtenia.**
Dnes `screens.js:235` priradí `S.cam.k = Math.max(S.cam.k, 1.1)` **pred** tweenom,
takže tween začína z už preskočenej hodnoty; a nájdený uzol nedostane **žiadny**
vlastný znak. Cieľ: podlaha zoomu ide do **cieľa** tweenu, nie pred neho, a nájdený
uzol dostane prstenec s **konštantnou** alfou, ktorý lineárne vyhasne za
2 × `--dur-ambient` (800 ms). Nie dnešný `sin()` blikot.
*Tichá verzia:* kamera skočí na finálny záber a prstenec sa nakreslí a **drží** ~2 s
bez oscilácie, potom zmizne skokom. Prstenec je tu **náhradou** za pohyb, takže
v tichom režime musí byť výraznejší, nie slabší.

**3 · Prílet uzla cez WS — hýbe sa nový uzol, nie sieť.**
Dnes `ws.js:57–77` na jeden nový uzol zavolá `buildSim()` + `kickSim()`, čo zdvihne
alphu simulácie na 0,35 nad **2 765 uzlami a 8 703 hranami** (usadená hodnota pred
tým bola 0,004), a k tomu spustí `birthScale`, expandujúci prstenec, `spawnPulse`
od jadra, `emitFlows`, `blip()` a toast — **sedem súčasných pohybov na jednu
udalosť**. Cieľ: nechať tri, ktoré nesú informáciu (`birthScale`, prstenec zrodu,
toast). `spawnPulse` a `emitFlows` hovoria to isté, čo už povedal prstenec.
*Tichá verzia:* uzol sa nakreslí rovno v plnom polomere na finálnej pozícii,
dostane trvalý prstenec na ~2 s a toast, ktorý **zostane celý svoj čas** (viď
pravidlo hore). Žiadny prílet, žiadne toky — ale ani žiadne ticho.
**Pozor na hranicu rozhodnutia 7:** znížiť alphu `kickSim()` je zmena **fyziky**,
nie prechodu. Patrí to pod samostatné schválenie, nie do vlny prechodov.

**4 · Toast — oprava, nie nový pohyb.** Viď „Pohyb nesmie zhasnúť informáciu".
*Tichá verzia:* toast sa objaví okamžite (bez `rise-fade`), stojí **rovnako dlho**
ako inak, zmizne okamžite (bez slide-out). To je presná definícia „zmysluplného
okamžitého ekvivalentu" z rozhodnutia 8.

### Mŕtvy pohyb sa maže, nie komentuje

`S._morph` (morph pozícií medzi úrovňami) je **mŕtvy kód**: nikde sa nenastavuje na
nenull hodnotu (`render.js:59`, `:84`, `:1723` a `sim.js:497` ho len nulujú), takže
blok `render.js:1712–1727` sa **nikdy nevykoná**. Napriek tomu ho `anim.js:114`
a `state.js:100` opisujú ako živý — komentár, ktorý lže, je horší než chýbajúci.
**[cieľ V2]** blok aj oba komentáre von.

### Tichá verzia je záväzná — a nie je to „vypnuté"

Rozhodnutie 8: **každá animácia má tichú verziu pre `prefers-reduced-motion`, a nie
„vypnuté", ale zmysluplný okamžitý ekvivalent.** Reduced motion nie je „nič sa
nestane" — stav sa zachová textom, ikonou, obrysom, fokusom alebo oznámením.

Merané 27. 8. 2026 (sonda C, nezávisle potvrdzuje číslo 64):

| | Počet |
|---|---|
| deklarácií `transition` / `animation` v štyroch stylesheetoch | **104** |
| `@keyframes` (všetkých 16 má volajúceho) | **16** |
| živých animácií | **22** |
| živých prechodov | **57** |
| **živých pohybov celkom** | **79** |
| pohybov s **pomenovanou** tichou verziou v CSS | 11 |
| pohybov s tichou verziou v **JS** (`charts.js`) | 4 |
| **pohybov, ktorých jedinou tichou verziou je plošné pravidlo** | **64** |

Odpočet od 104 na 79, aby sa dal zopakovať: −14 deklarácií je vnútri
`@media prefers-reduced-motion`, −10 sú modifikátory (`transition-duration`,
`transition-delay`, `animation-play-state`, 7× `animation-delay` na `nth-child`),
−1 je `transition: none`.

Pomenované tiché verzie, ktoré **existujú** (úplný zoznam, aby sa nehľadali znova):
`mind.css:1257` (kryje `bc-draw` aj `bc-core-in`), `:2705` (`load-breathe`),
`:4128` (`hades-shimmer` — `display: none` na sweepe, teda pokojná plocha),
`:4786` (`sync-pulse`); `console.css:506` (`msg-in`), `:592` (`think-blink`),
`:593` (`sk-pulse`), `:594` (`.tr-acts`), `:595` (`tool-pulse`);
`charon.css:220` (`charon-blink`). V JS: `charts.js:257` (`heat-reveal`),
`:370` (`seg-draw`), `:465` (`line-draw` + `chart-fade` + `chart-fade-late`).

**`charon.css:220` je pritom presne zakázaný vzor:** `.charon-dot { animation: none }`
nechá tri bodky na `opacity: .4`, takže indikátor „model píše" stratí rozdiel medzi
pokojom a behom. **[cieľ V2]** bodky v plnej farbe + text stavu.

#### Plošné pravidlo je PODLAHA, nie strop

`public/css/mind.css:2852–2861` je `*, *::before, *::after { animation-duration:
.01ms !important; … }`. `mind.css` sa načítava prvý na všetkých troch plochách,
takže pokrýva aj `console.css`, `chat.css` a `charon.css`.

> Manuál tu do 27. 8. 2026 ukazoval na `mind.css:2728–2736`. Na tých riadkoch dnes
> stojí pravidlo o `min-height` prázdnych stavov. Kto opravoval podľa manuálu,
> otvoril nesprávne miesto — preto je tu číslo overené v CSSOM, nie odhad.

**To pravidlo zostáva a `!important` sa z neho neodstraňuje.** Jeho odstránenie by
zhodilo pravidlo na špecificitu 0-0-0 bez `!important`, teda by prehralo
s **každým** komponentným pravidlom — a 64 pohybov by tichú verziu stratilo naraz,
pričom by si to nikto nevšimol: prejaví sa to len u človeka, ktorý má preferenciu
zapnutú.

Zápis `.01ms` (nie `0s`) je zámerný: prvok tak **dobehne** do koncového stavu
a `transitionend` / `animationend` sa vydá, takže JS, ktorý na koniec prechodu
čaká, sa nezasekne.

**Podlaha nekryje samostatné dokumenty.** `electron/states/offline.html`
a `electron/chrome/topbar.html` `mind.css` nenačítavajú, takže si tichú verziu
musia napísať samy (§2, zápis #16).

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
| „model píše" | bodky na `opacity .4` | bodky v **plnej** farbe + text stavu |
| prílet uzla na plátne | uzol chýba | uzol rovno na mieste, prstenec drží 2 s |
| kamera / fit | animovaný prelet | okamžitý presun |
| zanorenie | len skok pretmavenia | skok + **trvalý obrys** fokusovej skupiny |
| nájdený uzol | žiadny znak | prstenec s konštantnou alfou, drží 2 s |
| toast | **doba zobrazenia 0 ms** | plná doba zobrazenia, bez príchodu a odchodu |

#### Tri pasce, ktoré dávajú falošný nález

1. **Prehliadač normalizuje selektor podlahy na `*, ::before, ::after`.** Regex,
   ktorý v `cssText` hľadá `*, *::before`, ju nenájde a ohlási, že chýba. Je tam.
2. **Parser nad textom CSS treba kalibrovať proti CSSOM v oboch smeroch.** Sonda C
   mala regex, ktorý nepustil dvojsegmentový longhand (`animation-play-state`),
   a ticho stratila 2 deklarácie. A naopak: Chrome zahodí
   `input[type="range"]::-moz-range-thumb` (`mind.css:1631`), takže parser bude mať
   **vždy o 1 prechodové pravidlo viac** než CSSOM — a je to správne.
3. **Tweeny na plátne sa v tomto prostredí po rámcoch merať NEDAJÚ.** Skrytá
   Browser pane netiká `rAF` (zmerané: 0 rámcov za 500 ms) a škrtí `setTimeout` na
   ~1 Hz. Merať sa dajú **stavové hodnoty** (`S._camTween.dur`, `S._simAlpha`,
   `S._drawMs`) a kód, nie priebeh. A meraj na `graphScope: all` (2 765 uzlov), nie
   na defaultnom `live` (~1 095) — inak zmeriaš polovicu záťaže.

#### Kde je manuál a kód dnes rozdielny

Pomenovaný blok (`mind.css:1255–1258`) vypína **len zrod** (`bc-draw`,
`bc-core-in`); **dýchanie (`core-pulse`) zastavuje až plošné pravidlo.** Plošné
pravidlo je teda pre dýchanie znaku **nosné**, nie kozmetické — keby padlo, znak by
dýchal aj v tichom režime.

`render.js:891–900` kreslí `glowA` s `Math.sin(S._clock * 6 + n.id)` **bez** stráže
na reduced motion, a komentár na `:892` to priznáva. Tichý variant pulzu teda dnes
nie je statický: prstenec ~0,83 s osciluje na ~0,955 Hz, hoci `anim.js:13` sľubuje
„statické zvýraznenie". Susedný riadok `:872` stráž **má**. **[cieľ V2]** konštantná
alfa (viď pohyb 2 vyššie).

Poznámka k JS strane, ktorú CSS nevidí: `charts.js:74`, `anim.js`, `toasts.js`
a `sim.js` (`pump()`) riešia tichý režim **tak, že triedu vôbec nepridajú**, nie
tak, že by ju CSS prebíjalo. To je správne poradie a nemení sa. Dve výnimky, ktoré
sú „vypnuté" bez náhrady: `emitFlows()` (`anim.js:136`) len `return` — recall
nedá žiadnu statickú spätnú väzbu, že zasiahol susedov; `maybeSynapse()`
(`anim.js:119`) tiež — tam je ticho správne, je to ambient.

Preferenciu treba čítať **aj po zmene nastavenia** (`MediaQueryList` event
`change`). `sim.js:225–235` to robí a exportuje `reducedMotionActive()`;
`charts.js:74` a `state.js:118` (`REDUCED_MOTION`) čítajú **raz pri načítaní**,
takže preferencia prepnutá za behu utíši plátno, ale nie grafy a nie toasty.
**[cieľ V2]** — s tým, že u `charts.js` sa zaplatí dopyt na `matchMedia` pri každom
vykreslení (komentár na `:74` ten kompromis obhajuje pri 365 bunkách heatmapy):
**merať pred, nie po.**

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

### Material Symbols ide von — a je to jedna zmena, nie postupná

Rozhodnutie 19+21: **vlastná sada inline SVG, celá naraz.** Subset
(`material-symbols-rounded-subset.woff2`) sa maže, `@font-face` v `mind.css:80–86`
aj tri `<link rel="preload">` idú s ním.

Nemôže sa to robiť po častiach a je to zmerané: kým je v hre font, každá
neprekreslená ikona sa vykreslí ako **svoj ligatúrový názov** (`terminal` 144 px
namiesto 18 px). Zmiešaná sada by teda nebola „polovica hotová", ale plocha, na
ktorej sa striedajú kresby s textom.

**Ligatúr je 61, nie 41 ani 37.** Kontrakt aj CLAUDE.md majú nižšie číslo, pretože
im chýbala celá cesta `el(tag, 'ms', name)` a mapovacie stoly. Sonda B ich namerala
dvoma nezávislými skenermi a **krížovo skontrolovala nad živým DOM** na troch
plochách: 33 z 61 je vidieť bez interakcie a **ani jedna ligatúra v DOM nie je mimo
statického zoznamu** — merač je teda kalibrovaný z oboch strán.

**Ligatúra vstupuje do DOM SIEDMIMI cestami.** Toto je zoznam, ktorý musí prejsť
každý budúci audit ikon; grep nad markupom vidí len prvú:

| # | Cesta | Ligatúr | Prečo ju grep nad markupom nevidí |
|---|---|---|---|
| 1 | statický markup v Blade | 26 | vidí ju |
| 2 | template string v JS s literálnou ligatúrou | 14 | vidí ju len grep nad JS |
| 3 | **ternár vnútri template stringu** | 11 miest | grep vidí `+ (x ? 'a' : 'b') +`, nie ligatúru |
| 4 | **mapovací stôl typ → ikona** (5 tabuliek) | — | ligatúra je **hodnota** v objekte |
| 5 | **`el(tag, 'ms', name)`** v `chat` / `console` / `charon` | 17 miest | **nie je tam znak `<`** |
| 6 | **`.textContent = 'lig'`** (armed-confirm, prehrávanie) | 7 miest | trieda `.ms` sa pridáva `classList`om inde |
| 7 | prvý argument `emptyHtml()` / `renderEmpty()` | 10 call-site | ligatúra je argument funkcie |

Päť mapovacích stolov z cesty 4, aby sa nehľadali: `CMDK_TYPE_ICO` (`cmdk.js:190`),
`CERT_META` (`certainty.js:14`), `DIR_SECTIONS` (`smernica.js:33–39`), `ICONS`
(`shared/gate.js:32–64`, **zdieľaný modul troch plôch**) a varianty toastu
(`toasts.js:16`).

**CSS `content:` cestou nie je** — všetkých 15 výskytov v štyroch stylesheetoch je
`content: ''`. Overené.

**Číslo „215 glyfov" v subsete je nesprávne — je ich 254** (`maxp.numGlyphs`, cmap
354). Stojí na troch miestach naraz: `public/css/mind.css:23`, `CLAUDE.md:148`
a v tomto manuáli. Keď subset odíde, tie tri riadky sa **mažú**, neopravujú.

**Kým je subset v hre** (teda kým agent G neskončí), platí: nová ikona →
regeneruj `pyftsubset --no-layout-closure`; bez toho flagu ligatúrová uzávera
vtiahne všetkých 4 271 glyfov späť. Overuje sa **meraním šírky vykresleného glyfu**
(glyf ≈ 1 em ≈ 18 px; nevykreslená ligatúra padne na fallback a je násobne širšia).
GSUB tabuľky **nečítať** — prvý pokus o audit tou cestou hlásil 32 chýbajúcich ikon,
ktoré v subsete boli. Kalibruj na známom kladnom (`hub` = 18 px) aj zápornom
(`terminal` = 144 px, `arrow_downward` = 252 px, vymyslený názov = 342 px).

### Štyri mechaniky, ktoré pri prechode na SVG spadnú TICHO

Toto je najdôležitejšia časť sekcie: ani jedna z týchto štyroch nevydá výnimku.

1. **`.textContent = 'ligatura'`** — 7 miest (`timeline.js:23`, `:36`, `:47`,
   `console/main.js:176`, `controls.js:460`, `kontrola.js:559`,
   `rozhodnutia.js:367`). Na `<svg>` prvku `textContent` nezobrazí **nič**.
   Prepisuje sa na výmenu `<use href>`, nie na `textContent`.
2. **`classList.add('ms')` / `remove('ms')`** pri armed-confirm — 4 miesta
   (`console/main.js:194`, `rozhodnutia.js:354`, `kontrola.js:572`,
   `controls.js:467`). Dnes trieda `.ms` prepína ten istý prvok medzi **ikonovým
   a textovým** režimom. So SVG trieda o fonte nerozhoduje, takže výmena
   ikona ↔ text potrebuje inú mechaniku.
3. **Tri toggle tlačidlá vymieňajú dve rôzne kresby na jednom prvku** cez
   `innerHTML` s ternárom: `add` ↔ `close` (`rozhodnutia.js:140`), `edit` ↔ `check`
   (`rozhodnutia.js:148`, `smernica.js:349`).
4. **`.ms.flip`** (`chat.css:107`, `console.css:1208`) existuje **výhradne** preto,
   že `arrow_downward` nie je v subsete. So vlastnou sadou ten dôvod zmizne —
   pravidlo a obe blade použitia sa **mažú** a nastupuje kresba `arrow-down`.
   Nechať flip bez príčiny znamená nechať v kóde obchádzku, ktorej komentár lže.

### Kresba vlastnej sady

| Vlastnosť | Hodnota |
|---|---|
| viewBox | `0 0 24 24` |
| mriežka | 24 × 24, kresba v poli **20 × 20** (2 px vzduch po okrajoch) |
| hrúbka obrysu | **1,75 px** na 24-mriežke |
| konce a spoje | `round` |
| výplň | **`none`** — jediná výnimka je jadro (viď nižšie) |
| farba | `currentColor` |
| optické veľkosti | `--icon-2xs` 14 · `--icon-xs` 16 · `--icon-sm` 18 · `--icon-md` 20 · `--icon-lg` 22 |

**Sada je výhradne obrysová a v celom systéme je jediný plný prvok: jadro.**
Toto pravidlo viaže ikony na znak a na plátno: uzly na plátne sú priehľadné
prstence, nie plné disky (priehľadnosť nesie *diera*, nie nízka alfa), a jadro
vedomia je jediný sýty plný prvok. Legenda v `panels.js` musí hovoriť ten istý
jazyk — plné disky tam učili zle.

**Namerané veľkosti, ktoré sada musí uniesť:** na `/` sa dnes kreslia štyri —
16 px (5 prvkov), 18 px (10), 20 px (13), 22 px (11). K tomu tri **nemenované
výnimky bez tokenu**, ktoré sa pri prechode zarovnajú na stupeň:
`charon.css:565` 15 px (`#charon-pack`), `mind.css:2782` 48 px
(`.empty.empty-network`), `console.css:535` 14 px (`.msg .who`).

**Kompozícia namiesto nových kresieb.** Zo 60 symbolov je čistá geometria ~44;
zvyšok sú kompozície nad bázou a to je záväzné, nie odporúčanie — inak sada
prestane vyzerať ako sada:

- **prečiarknutie nad bázou:** `magnifier` → `magnifier-off`, `eye` → `eye-off`,
  `filter` → `filter-off`
- **check nad kontejnerom:** `check` → `check-circle`, `check-double`, `shield-check`
- **výkričník nad kontejnerom:** `alert-circle`, `alert-triangle`
- **plus badge nad bázou:** `plus`, `link-plus`, `library-plus`
- **dvojstav = jedno telo, jeden modifikátor:** `lock` / `lock-open`

### Definitívny zoznam — 60 symbolov

Formát: **`ligatúra` → `id-symbolu`** | rola. Zoznam je úplný a je to jediný zdroj;
implementátor nesmie pridať 61. symbol bez prepisu tejto sekcie.

**A · Navigácia a chróm (11)**

| Ligatúra | Symbol | Rola |
|---|---|---|
| `wb_sunny` | `sun` | destinácia Dnes |
| `hub` | `hub` | destinácia Graf (3 veľkosti: 18 / 20 / 22) |
| `receipt_long` | `receipt` | destinácia Denník |
| `gavel` | `gavel` | destinácia Rozhodnutia |
| `bolt` | `bolt` | destinácia Runy, typ skill, origin session, fallback nástroja |
| `menu_book` | `book` | destinácia Knižnica, origin playbook |
| `fact_check` | `check-list` | destinácia Kontrola |
| `assignment` | `clipboard` | destinácia Smernica |
| `send` | `send` | odoslať (rail + dok) |
| `help` | `question` | Pomoc |
| `tune` | `sliders` | Nastavenia |

**B · Graf a plátno (7)**

| Ligatúra | Symbol | Rola |
|---|---|---|
| `account_tree` | `tree` | Štruktúra, koreň stromu podagentov |
| `category` | `shapes` | úroveň oblasti v breadcrumbe, legenda |
| `layers` | `layers` | pohľad Vrstvy |
| `center_focus_strong` | `focus` | vycentrovať / fit |
| `add` | `plus` | priblížiť, nový projekt, nové vlákno, `/new` |
| `remove` | `minus` | oddialiť (`plus` bez svislice) |
| `more_horiz` | `ellipsis` | ďalšie oddelenia |

**C · Akcie nad obsahom (12)**

| Ligatúra | Symbol | Rola |
|---|---|---|
| `search` | `magnifier` | hľadať, tool grep/glob |
| `search_off` | `magnifier-off` | nič sa nenašlo |
| `filter_alt_off` | `filter-off` | prázdno z filtra — **kresli `filter` ako bázu**, aby budúci „filter on" nebol nová geometria |
| `close` | `x` | zavrieť, zrušiť, `/clear` (6 veľkostí) |
| `edit` | `pencil` | upraviť, tool write/edit, režim správy |
| `check` | `check` | hotovo, uložiť premenovanie — **báza pre tri ďalšie** |
| `save` | `save` | uložiť ako `.md` |
| `content_copy` | `copy` | kopírovať smernicu |
| `delete` | `trash` | zmazať natrvalo, tool `mind_delete` |
| `link` | `link` | prepojiť uzly — báza |
| `add_link` | `link-plus` | návrh nového spojenia |
| `library_add` | `library-plus` | priložiť do rozhovoru — **12 instancií na jednom zobrazení, najhustejšia ikona appky** |

**D · Stav a výsledok (10)**

| Ligatúra | Symbol | Rola |
|---|---|---|
| `check_circle` | `check-circle` | úspech, prázdna fronta = dobrý stav |
| `done_all` | `check-double` | vyriešené, žiadne duplicity |
| `verified` | `shield-check` | istota „overené", akcia Overiť |
| `science` | `flask` | istota „hypotéza" |
| `warning` | `alert-triangle` | pasca, warn toast, sekcia Pasce |
| `error` | `alert-circle` | chybový rámec behu |
| `cloud_off` | `cloud-off` | jeden chybový komponent `.empty--error` (10 call-site) |
| `pending` | `clock` | čaká na overenie, príloha sa číta |
| `radio_button_unchecked` | `ring` | bez istoty |
| `redo` | `skip` | preskočiť vo fronte Kontroly |

**E · Dáta a typy uzlov (8)**

| Ligatúra | Symbol | Rola |
|---|---|---|
| `article` | `doc` | záznam Denníka, riadok Dnes |
| `calendar_month` | `calendar` | denný digest |
| `description` | `file-text` | tool read/cat, export vlákna, príloha (6 call-site) |
| `list` | `list` | tool ls/tree, zoznam vlákien |
| `memory` | `chip` | tool `mind_recall` / `mind_read`, `/recall`, `/cost` |
| `psychology` | `head-gear` | tool `mind_learn` / `mind_decision`, sekcia Fakty, typ uzla memory |
| `inventory_2` | `box` | typ uzla project, sekcia Projekty, zložka na `/chat` |
| `commit` | `commit` | commit poznámka v paneli uzla |
| `brightness_7` | **`core`** | typ uzla **jadro** — viď rozhodnutie nižšie |

**F · Dvojstavy (6 kresieb v 3 pároch) — musia mať dva stavy**

| Ligatúra | Symbol | Stav |
|---|---|---|
| `visibility` | `eye` | oblasť je viditeľná |
| `visibility_off` | `eye-off` | oblasť je skrytá (`eye` + prečiarknutie) |
| `lock` | `lock` | zápis do playbookov **vypnutý** |
| `lock_open` | `lock-open` | zápis do playbookov **zapnutý** (rovnaké telo, otvorená spona) |
| `play_arrow` | `play` | prehrať časovú os |
| `pause` | `pause` | pozastaviť — dve geometrie, **jeden slot v DOM** |

**G · Smerové a ostatné (5)**

| Ligatúra | Symbol | Rola |
|---|---|---|
| `arrow_upward` | `arrow-up` | odoslať (send button konzoly a chatu), skrolovanie |
| — **nová** | `arrow-down` | nahrádza `.ms.flip`; dôvod flipu bol len chýbajúci glyf |
| `stop` | `stop` | zastaviť beh |
| `sync` | `refresh` | synchronizovať |
| `menu` | `dots-menu` | prepínač akcií riadka na `/chat` |

**H · Nekresliť (2)** — v kóde sú, dnes nedosiahnuteľné:

| Ligatúra | Namiesto kresby |
|---|---|
| `circle` | fallback `CMDK_TYPE_ICO` pre neznámy typ; štyri typy stôl pokrýva → zmeň fallback v `cmdk.js:244` na `hub` |
| `code` | `gate.js` ICONS pre `bash`/`shell`/`php`/`artisan`; taký tool **zámerne neexistuje** (appka je tunelovaná cez ngrok) → zmaž tie štyri kľúče z `gate.js:56–59` |

### Dve slnká sa zlievajú na znak jadra

`wb_sunny` (obrazovka Dnes) a `brightness_7` (typ uzla `core` v palete) sú dnes
**dve rôzne kresby slnka** a bolo by chybou preniesť tú kolíziu do sady, ktorá má
žiť roky. **Rozhodnutie:** `brightness_7` sa nekreslí ako slnko. Symbol `core` je
**prstenec s plným stredom** — presne tá istá geometria, akú jadro má na plátne
a v znaku, a jediné miesto v sade s výplňou. UI tak začne o jadre hovoriť rovnako
ako graf.

Je to zmena **významu**, nie kresby, preto je zapísaná ako rozhodnutie manuálu
a nie ako detail implementácie.

### Semantická mapa — jeden význam, jedna ikona

Sada opravuje 10 kolízií. Toto je stav po oprave, teda to, čo sa má nakresliť:

| Význam | Symbol | Dnes bolo |
|---|---|---|
| odoslať správu | `send` | **dva tvary** — `arrow_upward` na `/chat` a `/console`, `send` v doku |
| skočiť na spodok | `arrow-down` | `arrow_upward` prevrátený v CSS (`.ms.flip`, **2×**) |
| o úroveň von v grafe | `arrow-up` | `arrow_upward` (zostáva, je to smer von) |
| priblížiť / oddialiť | `plus` / `minus` | `add` / `remove` — a `add` nesie aj „nové" |
| zavrieť plochu | `x` | `close` (6×) |
| prepojiť s uzlom | `link` / `link-plus` | **dva tvary** — `link` a `add_link` |
| vyriešiť položku fronty | `check-double` | `done_all` — stojí **vedľa** `verified` v jednom riadku |
| preskočiť | `skip` | `redo` — „zopakovať" hovorí niečo iné než jej `aria-label` |
| typ uzla jadro | `core` | `brightness_7` — druhé slnko |

**Identita: 0 ikon, 1 znak.** Vľavo hore je **znak, nie `hub`**. Dodržané
v hlavičke `/console`; `#charon-toggle` nad grafom je dnes `hub`
(`mind.blade.php:94`). **[cieľ V2]** `hub` nesie po oprave **jednu** vec:
destináciu Graf.

### Ako sa sada dodáva

Sada je **jeden modul** `public/js/shared/icons.js` (hoistované `export function`,
žiadny bundler, žiadna CDN). Vydáva:

1. `iconSvg(name, opts)` → `<svg>` element pre cestu 5 (`el`-builder),
2. `iconMarkup(name, opts)` → string pre cesty 2, 3 a 7 (template stringy),
3. `iconSwap(el, name)` → výmena kresby na existujúcom prvku pre cesty 6 a 3
   (toggle) — **toto je funkcia, ktorá zabraňuje tichému pádu**,
4. `ICON_NAMES` → zoznam na overenie, že sa nepoužil názov, ktorý sada nemá.

**Neznámy názov nie je ticho prázdny prvok.** `iconSvg('nieco')` vráti kresbu
`ring` (neutrálny prstenec) **a zapíše meno do `window.HADES._iconMiss`**, aby ho
merací harness našiel. Ticho vynechaná ikona je presne ten defekt, ktorý má sada
odstrániť — nesmie ho zaviesť späť v inej podobe.

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
zjednotenie je práca s markupom a triedami, nie s farbou. Vlna 1 zaviedla
`.empty--error` na desiatich call-site šiestich obrazoviek dát.

#### Na `/chat` sa chyba nekreslí VÔBEC — a to je funkčná chyba, nie dlh

Sonda D zmerala, že **štyri triedy, ktoré `/chat` emituje, nemajú v žiadnom zo
štyroch stylesheetov ani jedno pravidlo**:

| Trieda | Kde ju emituje JS | Ako to vyzerá |
|---|---|---|
| `.cm-error` | `chat/render.js:237–246` (`pushError`) | chybová správa má **identický computed style** ako bežná odpoveď — `bubbleBg rgba(0,0,0,0)`, `border 0px`, `color = --text`; odlišuje ju len slovo „Chyba" |
| `.ct-err` + `.ct-note` | `chat/threads.js:1121` | `color` rovnaký ako holá `.ct-note` |
| `.ct-retry` | `chat/threads.js:1121` | kresbu berie len z bare `button` v `mind.css` |
| `.is-err` | `chat/branches.js:430`, `:436`, `:444` | nič |

**Kalibrácia z druhej strany** (aby sa nedalo povedať, že merač nič nevidí): na
`/console` má `.msg.error` `bubbleBg rgb(253,232,232)`, `border rgba(214,69,69,.34)`
a `whoColor rgb(165,42,42)` proti `.msg.system` — teda tam sa chyba **kreslí**
a merač to hlási.

Preto to nie je „prefarbenie": sú to **štyri nové pravidlá**, nie štyri úpravy.

#### Čo sa zlieva a čo zámerne nie

| Rola | Komponent | Členovia |
|---|---|---|
| **plocha sa nenačítala + jedna akcia** | `.empty--error` | `console.css:317–334` (`.rail-error` / `.rail-retry`) a `chat` `.ct-err` / `.ct-retry` sú **tá istá rola** a idú pod jeden komponent |
| **chybová bublina v toku** | jedna kresba | `console.css:610` (`.msg.error`), `chat` `.cm-error`, `charon.css:156` (`.charon-msg--error`) |

**Pri bubline platí verzia konzoly:** telo `--text`, `--danger-ink` len na menovke.
`charon.css:156–159` dáva `color: var(--danger-ink)` celej bubline, čo ide proti
pravidlu zapísanému v `mind.css:2607–2612`.

**Zámerne sa NEZLIEVA:** `.agent-error` / `.charon-agent-err` / `.run-error` (obsah
záznamu behu, nie stav plochy), `.is-failed` (značka stavu), `.toast.error`
(prechodné oznámenie akcie), `.card-empty` (iná rola).

**Duplicita bajt na bajt:** `charon.css:353` `.charon-agent.is-failed` je znak po
znaku to isté pravidlo ako `console.css:887` `.agent-run.is-failed`. Patrí do
jedného stylesheetu. A `charon.css:387–392` píše `font-size: 12px` raw, kým
`console.css:945–949` tú istú rolu píše `var(--fs-small)`.

#### Poradie prác

**Ikony najprv, chybový komponent na `/chat` až potom.** `chat/render.js:239`
odôvodňuje absenciu ikony chyby tým, že Material Symbols je subset a nevykreslená
ligatúra sa ukáže ako svoje meno. Rozhodnutie 19 ten dôvod ruší — **ale až keď sa
font naozaj odstráni.** Opačné poradie tú istú obavu privedie späť.

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

Rail má dva stavy a stav je **persistovaný**.

| | Zbalený | Rozbalený **[cieľ V2]** |
|---|---|---|
| `--rail-w` | **80 px** | **208 px** |
| label destinácie | 10 px **pod** ikonou | vedľa ikony, riadok |
| výška `.dest` | 52 px | **40 px** |
| eyebrow skupín (`Teraz`, `Záznamy`, `Znalosti`) | `--fs-micro`, skrytý pod 860 px výšky | `--fs-micro` |
| stav | — | `localStorage['hades.rail']`, hodnoty `wide` / `slim` |

Rozbalený je **default**; `slim` je voľba človeka. Labely v raile sú **Geist**, nie
wordmark, a zostávajú **chróm** (nezdvíhajú sa s dátovým textom).

#### Oprava nameraného údaju z kontraktu

Kontrakt (rozhodnutie 17) tvrdí: *„pri 594 px výšky má rail 562 px a žiadny
`overflow-y`"*. Tá veta je pravdivá o computed style a **nepravdivá o obsahu**.
Namerané (sonda D, 1280 × 594):

| Veličina | Hodnota |
|---|---|
| `rail.getBoundingClientRect().height` | 562 px |
| `clientHeight` | 560 px |
| **`scrollHeight`** | **712 px** — deficit **152 px** |
| `overflow-y` | `visible` |
| „Nastavenia" | `top 617` – `bottom 669` |
| „Pomoc" | `top 677` – `bottom 729` |
| dolná hrana railu / okna | 578 / 594 |

**Dve destinácie sa teda kreslia pod dolnou hranou railu aj pod okrajom okna a sú
nedosiahnuteľné.** `#rail` je `position: fixed`, takže ich žiadny scroll
nezachráni, a eyebrow labely sú pri tej výške už skryté — zmierňovací mechanizmus
je vyčerpaný.

**Prahy zmestenia (kalibrované z oboch strán, 1280 px šírky):**

| Stav | Obsah | Prah výšky okna | Kalibrácia |
|---|---|---|---|
| dnešný 80px rail, bez eyebrow | 712 px | **746 px** | 745 padne, 746 sadne |
| dnešný 80px rail, s eyebrow | 787 px | **821 px** | jeden eyebrow = 25 px |
| **rozbalený 208px rail** | **580 px** | **614 px** | 613 padne, 614 sadne |

Komentár nad `@media (max-height: 860px)` (`mind.css:1305–1311`) počíta zle: hlási
obsah 796 px a prah ~844 px. Opravuje sa spolu s railom.

#### Rozbalenie rieši výšku a platí šírkou

**Zisk je 132 px potrebnej výšky** (11 destinácií × 12 px, `.dest` 52 → 40 px),
takže prah klesne zo 746 na 614 px a výšková hranica `max-height: 860px` stratí
volajúceho. **Cena je presne 128 px šírky obsahu na každom viewporte:**

| Šírka okna | `#screens` 80px → 208px | `.dash-grid` |
|---|---|---|
| 1920 | 1792 → 1664 | 6 stĺpcov → 6 (249,5 px, len 9,5 px nad podlahou `minmax(240px)`) |
| 1280 | 1152 → 1024 | **4 → 3** |
| 900 | 772 → 644 | 2 → 2 |
| 768 | 640 → 512 | **2 → 1** |

**Nič sa neprekrýva a nič sa neoreže ani na jednej zo štyroch šírok** (zmerané
detektorom `scrollWidth > clientWidth`, kalibrovaným pozitívne pri `--rail-w: 900px`,
kde vyhodil 6 orezaných `.today-item`). Plávajúce panely grafu si pri 768 px nechajú
196 px pásu plátna namiesto dnešných 324 px.

#### Rozbalenie NIE JE výmena tokenu

Vnútro railu má šírku **zadrôtovanú na 68 px v troch pravidlách** a `#rail` má
`align-items: center`, takže samotná zmena `--rail-w` na 208 px vyrobí 70 px
mŕtveho priestoru po oboch stranách a destinácie zostanú 68 px široké stĺpce
(zmerané: odsadenie `.dest` 6 px → 70 px, šírka `.dest` 68 px v oboch prípadoch).

Otvoriť treba **tri miesta**: `mind.css:1186` (`#brand-core`), `:1279`
(`.rail-eyebrow`), `:1373` (`.dest`) — a `.dest` prepnúť zo stĺpca na riadok.

**Pasce, ktoré k railu patria:**

- `mind.css:267` derivuje `--content-left` a komentár pri ňom tvrdí `/* 104px */`,
  ale `--edge` 16 + `--rail-w` 80 + `--edge` = **112 px**. Rozbalenie to číslo mení
  znova, takže sa opravuje spolu s ním.
- `layout.js:129` má fallback `cssPx('--rail-w', 72)` — reálna hodnota je 80.
  Fallback je inertný (preferuje sa `scs.left`), ale **klame**.
- Okraje plátna čítajú CSS tokeny (`--rail-w`, `--header-h`, `--panel-w`, `--edge`)
  — **nezadrôtuj ich znova do JS**.

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

Rozhodnutie 18: **desktop prvý (1280–1920).** Na **768–900 px nesmie nič
prekrývať**. Telefón sa nerieši.

#### Nameraný inventár zlomov (sonda D)

Manuál tu do 27. 8. 2026 uvádzal `mind.css:3725`, `:3730`, `console.css:1295`,
`chat.css:750`, `:796` — **ani jedno z tých čísel dnes neplatí.** Skutočný stav sú
**štyri čísla v desiatich blokoch**:

| Zlom | Miesto | Čo robí |
|---|---|---|
| `max-width: 1280px` | `mind.css:3831` | skryje `#scope-label` |
| `max-width: 1280px` | `mind.css:3884` | zúži `--panel-w`, skryje `#header-metrics` |
| `min-width: 901px` | `mind.css:3507` | mriežka `#library-search` |
| `max-width: 900px` | `mind.css:3889` | `--panel-w`, `--dock-at-left`, panely doprava |
| `max-width: 900px` | `mind.css:4919` | `.dash-card.span-2` |
| `max-width: 900px` | `charon.css:634` | dok |
| `max-width: 900px` | `chat.css:746` | panely `/chat` |
| `max-width: 860px` | `mind.css:4035` | `.dir-cols` na `1fr` |
| `max-width: 860px` | `console.css:1290` | rail konzoly ako prekryv |
| `max-height: 860px` | `mind.css:1312` | skryje `.rail-eyebrow` |
| `hover: none` | `mind.css:3863` | `.pack-btn` |

JS zrkadlí 900 px na troch miestach: `mind/dock.js:11`, `mind/panels.js:18`,
`chat/main.js:68`.

#### Zjednotená sada: dve šírkové hranice, žiadna výšková

| Hranica | Význam |
|---|---|
| **1280 px** | chróm hlavičky sa orezáva, `--panel-w` sa zužuje |
| **900 px** | „úzko" — plávajúce panely k pravej hrane, druhý stĺpec padá, raily sa menia na prekryv |

- **Dva bloky `max-width: 1280px` v `mind.css` sa zlievajú do jedného.** Sú od seba
  53 riadkov a robia to isté.
- **Obe použitia `860 px` idú na `900 px`** (`mind.css:4035`, `console.css:1290`).
  V pásme 861–900 px má appka dnes **dve rôzne definície úzkeho okna naraz**:
  `mind.css` už presunul panely, `console.css` ešte drží dva stĺpce. Posun o 40 px
  je hlboko v pásme 768–900 z rozhodnutia 18, takže sa nič nestráca.
- **`min-width: 901px` zostáva** — je to korektný komplement k `max-width: 900px`,
  nie duplicita.
- **`max-height: 860px` sa ruší** — po rozbalení railu klesne prah s eyebrow na
  ~689 px, teda pravidlo stratí volajúceho. Tým zmizne aj mätúce dvojité použitie
  čísla 860 na dvoch osiach.

**Pasca pri presune 860 → 900:** vnútri `console.css:1290` leží
`.auto-accept .lbl { display: none }` s komentárom o tom, že brána zápisov tam raz
spadla na cieľ 13 × 13 px. Blok sa **nesmie presúvať mechanicky** — po zmene
hranice treba prepočítať šírku toho tlačidla, tak ako to komentár žiada.

Pravidlo pre panely: **na úzkom okne (< 900 px) sa stav prekryvu nepamätá.**
Odkaz otvorený na úzkom okne nesmie pripichnúť prekryv, ktorý si človek nikdy
nevybral — a to platí pre `localStorage` **aj pre URL**.

> **Merací harness:** `window.innerHeight` je v Browser pane **0**, kým sa
> nenastaví viewport cez `resize_window`. Bez toho je každé „je to vidieť?"
> nezmysel. A panely `/chat` sa pri úzkom okne **zámerne** neukladajú — kto meria
> bez `resize_window`, namerá „panely sa nepamätajú" a bude opravovať funkčný kód.

### Charón

Konzola vedomia sa volá **Charón** — prievozník, ktorý sprostredkúva medzi človekom
a pamäťou. Nie je to nová URL: `/console` a `/console/<uuid>` zostávajú, aby odkazy
na existujúce vlákna žili. Od 25. 8. 2026 je `/chat` plnohodnotná appka a `/console`
technická konzola; **beh je jeden** pre všetky tri vstupy vrátane doku nad grafom.

- vizuálne **žiadne odlíšenie** od zvyšku appky — tie isté tokeny, ten istý chróm,
- v hlavičke vlákna je `Charón`, nie „Konzola vedomia",
- autor odpovedí je **Charón** (Hades je vedomie; Charón je ten, kto hovorí),
- vľavo hore je **znak**, nie ikona `hub` — a klik vedie do grafu.

**`charon.css` nehovorí typografickou škálou vôbec** (sonda D): má **22 deklarácií
`font-size` a ani jedna nejde cez token**. Dvadsať je čistá výmena za existujúci
stupeň (11 → `--fs-caption`, 12 → `--fs-small` / `--fs-data-chip`, 13 →
`--fs-body` / `--fs-data`, 14 → `--fs-base` resp. `--icon-2xs`, 16 → `--icon-xs`,
20 → `--icon-md`). **Dve hodnoty 15 px v škále neexistujú** a rozhoduje sa o nich
tu, nie potichu v implementácii:

| Miesto | 15 px | Rozhodnutie |
|---|---|---|
| `charon.css:112` `.charon-empty-title` | text | → **`--fs-title` (16 px)** — je to nadpis prázdneho stavu a §8 mu dáva vlastný predmet; 14 px by ho zrovnalo s telom správy |
| `charon.css:565` `#charon-pack .ms` | ikona | → **`--icon-xs` (16 px)** — je to akčná ikona vedľa 14 px textu, nie chróm |

`charon.css` **nemá raw hex ani rgba** (0 zásahov) — rozchádza sa len typografia.
Pri tom istom prechode sa opravuje `console.css:1336` (`#composer-hint` 10 px →
`var(--fs-micro)`), aby dve sesterské plochy nepísali tú istú rolu dvoma spôsobmi
(`chat.css:796` ju už píše tokenom).

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
stránkach** — dnes bit-identický (md5 `c0ebff62…` × 3) ✅, ale zapísaný trikrát.

**Jeden zdroj pre favicon aj Electron `.ico` je [cieľ V2]** a je to §2: generátor
číta `hades-sigil-mini.svg` a vydáva `public/favicon.ico`,
`electron/assets/hades.ico` **aj** tri data-URI do Blade. Dnes `build-icon.py`
stavia len desktopový `.ico` a generátor `favicon.ico` v repe **nie je** — tá
binárka je 40 717 B bez zdroja.

---

## 10. URL a zdieľateľnosť

Manuál doteraz nemal o URL ani vetu, a kód to odzrkadľoval: **8 obrazoviek,
0 zápisov do URL.**

### Kto serializuje — ZAVRETÉ

**Serializuje KLIENT.** Rozhodnutie 31 používateľa (27. 8. 2026) zaviera otázku,
ktorá tu bola otvorená.

Jeden modul **`public/js/mind/urlstate.js`** je jediné miesto v celom repe, ktoré
query string **číta aj píše**. Server zostáva zdrojom pravdy pre **počty, skupiny
a krátenie textu**.

**Prečo tým invariant dvojitej plochy nepadá:** *URL nie je obsah, je to poloha
čitateľa.* Do adresného riadka ide **kľúč** filtra, nie jeho vyhodnotenie — dotaz
na server sa nemení. Serverová serializácia by navyše znamenala request na každú
zmenu filtra (dnes 3–4 s na `/api/journal`) a plocha AI by dostala kľúč, ktorý pre
model neznamená nič.

**Modul nesmie byť druhým prekladom filtra na serverový dopyt.** Päť obrazoviek ten
preklad už má — `decisionsQuery()` (`rozhodnutia.js:40`), `kontrolaQuery()`
(`kontrola.js:66`), `query()` (`runy.js:58`), `renderLibrary()` (`kniznica.js:99`),
`renderJournal()` (`dennik.js:45`) — a komentár v `rozhodnutia.js:38` to hovorí
priamo: *„dve kópie by znamenali, že prvé načítanie a filtrovanie hľadajú inak."*
To je presne ten rozchod, ktorý našiel audit 19. 8. **Nepíš šiesty preklad.**

**Umiestnenie modulu:** kľúče potrebuje `/`, `/chat` aj `/console`, takže logickejšie
by bolo `public/js/shared/`. Zostáva v `mind/`, pretože tak ho menuje kontrakt
a podľa toho je rozdané vlastníctvo súborov. Cena je jedno pravidlo, ktoré to drží
čisté: **`urlstate.js` nesmie importovať z `mind/state.js` ani z ničoho v `mind/`** —
inak by `/chat` pri jednom importe stiahol celý graf.

### Nameraný stav pred vlnou 2

| Čo | Koľko |
|---|---|
| `history.pushState` v `public/js` | **5 call-site** (`chat/run.js:486`, `:530`, `chat/threads.js:434`, `console/main.js:233`, `:418`, `:471`) — mení **výhradne pathname**, query string ani jedno |
| `history.replaceState` | **0** |
| `popstate` listenerov | **4** (`chat/run.js:428`, `chat/threads.js:1373`, `chat/branches.js:514`, `console/main.js:550`) |
| zápisov do histórie na ploche `/` | **0** (obal nad `history` kalibrovaný z oboch strán: vlastný `replaceState` zachytil 1, štyri prepnutia obrazovky + zanorenie + prepnutie pohľadu zachytili 0) |
| miest, kde sa v JS číta URL | **1** (`mind/state.js:87` — `?screen=`) |
| `localStorage` kľúčov spolu | **21** (15 na `/`, 4 `hades.chat.*`, 2 `hades.charon*`) |
| obnoviteľných osí filtra zo **šiestich obrazoviek dát** | **0** |

Dôsledok, ktorý sa dá napísať ako veta: **po `F5` na obrazovke Kontrola
s nastaveným filtrom typ + istota + oblasť + text a `limit=300` je človek späť na
prvej stránke celej fronty bez filtra.** To isté na Rozhodnutiach a Runách.
A zanorenie grafu prežije, ale **len v `localStorage`** — teda nezdieľateľne, a
v druhom tabe toho istého prehliadača sa ticho prepíše.

**Predvolené hodnoty musia byť v KÓDE, nie v úložisku.** Na čerstvom profile appka
pri boote zapíše len **2 z 15** kľúčov (`hades.screen`, `hades.theme`); ostatných 13
vzniká až prvým dotykom ovládača (kalibrované z oboch strán: 2 pred exercisom, 15
po prekliknutí reálnych ovládačov).

**URL už dnes lže:** `?screen=bogus` zostane v adrese a appka ukáže Dnes
(`state.js` hodnotu nevaliduje, validuje ju až `setScreen()`). Bez zápisu orezanej
pravdy späť sa ten defekt zmnoží na 37 kľúčov namiesto jedného.

### Čo do URL patrí a čo nie

Rozhodnutie 9. Delenie: **do URL ide to, čo definuje MNOŽINU; nie to, čo definuje
ZOBRAZENIE.** Na grafe sa to dá povedať ešte ostrejšie a je to deliaca čiara, podľa
ktorej sa roztriedi všetkých 21 uložených kľúčov: **čo mení, KTORÉ uzly a hrany na
obrazovke sú, ide do URL; čo mení, AKO vyzerajú, zostáva lokálne.**

`mw` (min. váha) a `sk` (kostra) skrývajú hrany → URL. `certRings` je kódovanie
prstenca → lokálne. **Jediná menovaná výnimka je `gv`** (pohľad Sieť / Vrstvy): mení
rozloženie, nie členstvo — ale je to pomenovaný pohľad s vlastnými tlačidlami
v hlavičke a klávesou `V`, nie kozmetický slider.

**Do URL nepatrí — a každý dôvod je vlastný, nie „je toho veľa":**

| Stav | Prečo nie |
|---|---|
| téma | vlastnosť oka a monitora; zdieľaný odkaz by vnucoval prijímateľovi cudziu tému |
| hustota, zvuk, `S.opts` (9 hodnôt), `certRings`, `hints2`, `journal.lastSeen` | ergonómia a vzhľad; 9 čísel je najdlhší možný príspevok za najmenšiu zdieľateľnú hodnotu |
| **kamera** (`x`, `y`, `k`) | force layout je **živý**, takže tá istá kamera nad inak usadenou scénou zaberá iný výrez. Zapisovať ju by bola **lož** |
| šírky panelov (`threadsW`, `artifactW`) | šírka je vlastnosť monitora, nie obsahu; a ťahanie gripu by znamenalo zápis na každý `pointermove` |
| **kontext uzlov v doku** (`hades.charonCtx`) | je to až 8 `node_id`, ktoré idú na server ako `context_node_ids` a stanú sa **vstupom do behu modelu**. Adresa, ktorá predplní kontext modelu, je injekčná plocha na ceste verejne tunelovanej cez ngrok — a nič sa tým nezíska, lebo mŕtve id sa aj tak prunujú |
| vlákno doku (`hades.charonThread`) | per-prehliadač zo svojej podstaty; dok nemá obnovu histórie zo servera |
| prehrávanie času (replay) | je to prehrávanie, nie stav; zápis na každý frame by bol najhorší možný |
| `#dir-task` (zadanie v Smernici) | je to **formulárové pole**, nie filter — a bola by to cesta, ako podstrčiť text zadania odkazom |

### Tvar adresy

Rozhodnutie 27: **krátke kľúče, defaulty sa vynechávajú.** Čistý stav = adresa
bez query stringu.

1. kľúče sú **1–3 znaky, malé písmená**,
2. **poradie kľúčov je pevné** (poradie riadkov v tabuľke schémy), nie poradie
   zmien — inak by ten istý stav dal dve rôzne URL a `replaceState` by „menil"
   adresu bez zmeny stavu,
3. **množiny sa serializujú OPAKOVANÝM KĽÚČOM** (`ft=memory&ft=project`), nikdy
   oddeľovačom. Dôvod je meraný: **6 z 3 712 reálnych značiek obsahuje čiarku**
   (`0,5 g`, `2,49 g`, `kadmium 0,01%`, `olovo 0,05%`, `0,2 µg/cm2`,
   `CMR 8,33 SDR/kg`) — slovenská desatinná čiarka. `fg=0,5 g` by sa rozpadlo na
   `0` a `5 g` a filter by sa po zdieľaní obnovil ako **iný filter**, ticho.
   Čítanie ide cez `getAll()`.
4. **hodnoty množín sa radia** — ten istý stav, tá istá URL,
5. prepínače sú `1` / `0` a serializujú sa len v nedefaultnej hodnote,
6. **stavaj VÝHRADNE cez `URLSearchParams`, nikdy konkatenáciou.** Kľúč skupiny
   Denníka je `#bez-projektu` (`dennik.js:73`) — ručne skladaný query string sa na
   `#` odsekne a celý zvyšok URL padne do fragmentu. Hodnoty nesú aj diakritiku
   (`zákon 108/2024`, `kultúra`, `údržba`).
7. **žiadny base64 JSON balík.** Zabalený stav v query stringu je presne to, čo
   robí odkaz nezdieľateľným a nedebugovateľným.
8. **strop 24 opakovaní na jeden kľúč.** 40 vybraných značiek dá ~900 znakov query;
   nad stropom sa kľúč z URL **vynechá** a stav zostane lokálny. Nie balík.

### Kanonický slovník kľúčov — 37, úplný

**Toto je jediný zdroj a je to zároveň jediné miesto v kóde, ktoré kľúč
serializuje aj deserializuje.** Krátke kľúče sú bez tabuľky chyba.

**Vylúčenie kolízií je štrukturálne, nie disciplínou:** 6 jednoznakových kľúčov je
vyhradených pre chrbticu, dvojznakové nesú rodiny (`g*` pohľad, `f*` filtre grafu,
`p*` panely, `h*` hľadanie v histórii, plus `mw`, `sk`, `ar`), trojznakové sú
obrazovkové (prefix = 2 znaky slugu obrazovky + os) plus `sel` a `loc`. Všetkých 37
je odlišný presný reťazec a ani jeden sa nerovná `token`, `k` ani `screen`.

#### A · Spoločná chrbtica (2)

| Kľúč | Význam | Hodnoty | Default (vynecháva sa) | História |
|---|---|---|---|---|
| `s` | aktívna obrazovka | `dnes` `graf` `dennik` `rozhodnutia` `runy` `kniznica` `kontrola` `smernica` | `dnes` | **push** |
| `q` | voľný text hľadania, význam určuje `s` | text | `''` | replace |

`q` je **zámerne spoločné** a je to jediná menovaná výnimka z prefixov: na
obrazovke je najviac jedno voľné hľadanie a čitateľ je vždy na jednej obrazovke,
takže `knq` / `koq` / `roq` by z najčastejšieho odkazu spravili najdlhší. Väzby:
Knižnica `#library-search`, Kontrola `kontrolaState.f.q`, Rozhodnutia
`decisionsState.q`, `/chat` `T.query`.

#### B · Zanorenie grafu (4)

| Kľúč | Význam | Hodnoty | Default | História |
|---|---|---|---|---|
| `a` | id oblasti | int | neprítomné = mapa | replace |
| `d` | id oddelenia | int | neprítomné | replace |
| `n` | id uzla zanorenia | int | neprítomné | replace |
| `sel` | id uzla s otvoreným panelom detailu | int | neprítomné | replace |

**`level` NIE JE kľúč** — implikuje ho najhlbší prítomný z `a` / `d` / `n`, pretože
`clampNav()` dopĺňa kontext nahor sám. Namerané, nie odvodené:
`go({level:'dept', dept:1})` uložilo `area:2`, hoci `area` sa neposielalo. Žiadny
z troch = úroveň `map`.

`sel` je iná vec než `n`: **`n` filtruje scénu, `sel` otvára panel.** Uzol je dnes
najodkazovateľnejší objekt appky a **nemá adresu** — `S.selected` sa nepersistuje
nikde, ani v `localStorage`.

**Kamera do URL neide** (viď vyššie).

#### C · Pohľad na graf (2)

| Kľúč | Význam | Hodnoty | Default | História |
|---|---|---|---|---|
| `gv` | pohľad | `layers` | `net` | replace |
| `gs` | rozsah grafu | `all` | `live` | replace |

#### D · Filtre grafu (8, všetky opakovateľné)

| Kľúč | Význam | Hodnoty | Default | Väzba |
|---|---|---|---|---|
| `ft` | **SKRYTÉ** typy uzlov | `memory` `skill` `project` | žiadne | `S.filter.types` |
| `fs` | **SKRYTÉ** zdroje | `session` `skill` `digest` `manual` | žiadne | `S.filter.sources` |
| `fa` | **SKRYTÉ** id oblastí | int | žiadne | `S.filter.areas` |
| `fg` | **VYBRANÉ** značky (pozitívny filter!) | text | žiadne | `S.filter.tags` |
| `fr` | **SKRYTÉ** kategórie vzťahov | `part_of` `uses` `similarity` `co_activation` | žiadne | `S.filter.relations` |
| `mw` | min. váha hrany | 0–5 | **0** | `S.minWeight` |
| `sk` | len kostra | `1` | vypnuté | `S.skeleton` |
| `loc` | lokálny graf | `<rootId>.<depth>`, depth 1–3 | neprítomné | `S.local` |

**`fg` je jediný POZITÍVNY filter v rodine** — kto to zamení, obráti význam odkazu.
`ft` a `fs` môžu obe niesť hodnotu `skill`; sú to rôzne kľúče, nie kolízia.

#### E · Obrazovky dát (11) — prefix = 2 znaky slugu + os

| Kľúč | Obrazovka · os | Hodnoty | Default | Väzba |
|---|---|---|---|---|
| `dep` | Denník · projekt | text, môže začínať `#` | všetky | `journalProject` |
| `kna` | Knižnica · slug oblasti | `dizajn-kreativa` … | neprítomné | `libraryState.areaSlug` — **filtruje KLIENT** |
| `kot` | Kontrola · typ | `core` `skill` `project` `memory` | `''` | `kontrolaState.f.type` |
| `koc` | Kontrola · istota | `overene` `hypoteza` `pasca` | `''` | `kontrolaState.f.certainty` |
| `koa` | Kontrola · slug oblasti | slug | `''` | `kontrolaState.f.area` |
| `kol` | Kontrola · strop | násobky 100, max 500 | **100** | `kontrolaState.limit` |
| `roy` | Rozhodnutia · rok | `YYYY` | neprítomné | `decisionsState.year` |
| `roa` | Rozhodnutia · id oblasti | int | neprítomné | `decisionsState.areaId` |
| `rus` | Runy · stav | `running` `waiting` `failed` `aborted` `done` | neprítomné | `runsState.status` |
| `rum` | Runy · model | text | neprítomné | `runsState.model` |
| `ruo` | Runy · rozbalený beh | uuid | neprítomné | `runsState.open` |

**Knižnica má zámernú asymetriu:** `q` filtruje server (SK-aware stemming), oblasť
filtruje prehliadač (server posiela `limit=null`, všetky karty ležia na klientovi).
**`kna` sa nesmie premietnuť do dopytu na server.**

**Dnes a Smernica nemajú ani jeden kľúč.** Obrazovka Dnes má krížový skok, ktorý je
prirodzene prvým hlbokým odkazom appky: čip projektu prepne obrazovku na Denník
**a** nasadí filter projektu (`dnes.js:140–144`) — teda `?s=dennik&dep=AI-mind`
a musí to byť **jeden** `pushState`.

#### F · `/chat` (10) — vlákno nesie pathname `/chat/<uuid>`

| Kľúč | Význam | Hodnoty | Default | História |
|---|---|---|---|---|
| `b` | vetva konverzácie | uuid | `active_branch_id` vlákna | **push** |
| `pt` | panel vlákien | `0` | otvorený | replace |
| `pa` | panel artefaktu | `1` | zatvorený | replace |
| `ar` | zdroj artefaktu | id `ConsoleToolCall` | neprítomné | replace |
| `hr` | hľadanie · rola | `user` `assistant` | neprítomné | replace |
| `ha` | hľadanie · od | `YYYY-MM-DD` | neprítomné | replace |
| `hb` | hľadanie · do | `YYYY-MM-DD` | neprítomné | replace |
| `hn` | hľadanie · vlákno | uuid | neprítomné | replace |
| `hp` | hľadanie · projekt | uuid | neprítomné | replace |
| `hl` | hľadanie · strop | int | **30** | replace |

`pt` / `pa` sú **dva nezávislé kľúče, nie jedna množina** — inak by sa „oba
zatvorené" dalo vyjadriť len prázdnou hodnotou.

**`ar` je vyhradené, ale dnes NEIMPLEMENTOVATEĽNÉ.** Panel artefaktu sa plní priamo
z argumentov živého volania nástroja (`artifact.js`) a nič nenesie id. Kľúč
v slovníku miesto má, aby si ho nikto nezabral; implementácia čaká na id
`ConsoleToolCall`. **Nezavádzaj `ar`, ktoré po obnove stránky ukáže prázdny panel.**

**`b` je ČÍTACIE a je to jediné miesto, kde si rozhodnutie 9 a serverový model
protirečia.** Aktívna vetva je stav **servera** (`console_threads.active_branch_id`),
nie čitateľa; jediná klientská cesta k vetve je dnes
`POST /api/console/branches/{uuid}/activate` (`branches.js:257`), teda **mutácia**.
`b=` v URL, ktoré by pri načítaní zavolalo `/activate`, by zmenilo vlákno **aj
tomu, kto odkaz poslal**. Kým neexistuje serverová čítacia cesta „zobraz vetvu X
bez prepnutia", `b` sa **len číta do UI** a neaktivuje. Rozšíriť to je rozhodnutie
používateľa, nie implementátora.

#### G · `/console` (0)

Bez query kľúčov. Vlákno nesie pathname `/console/<uuid>`, profil nástrojov sa číta
z `console_threads.tool_profile` a **z klienta ho prijať NESMIE**.

### Rezervované názvy

| Názov | Kto ho používa | Pravidlo |
|---|---|---|
| `token` | `AuthenticateUi.php:102` | **nikdy neemitovať, nikdy nezahadzovať** — middleware ho po odomknutí sám odstrihne redirectom (`urlWithoutToken()`, `:105`) a ostatné parametre zachová |
| `k` | `bin/hades-app.mjs:109`, `:119` | to isté; proxy si ho zmaže sám |
| `screen` | legacy `mind/state.js:87` | prijímať na čítanie ako alias `s`; **prvý zápis ho normalizuje na `s=` a `screen` odstráni** |

Manuál tu do 27. 8. 2026 tvrdil, že `token` a `k` sa pri prvom `replaceState`
zahodia. **Je to opravené:** obe cesty si ich mažú samy a modul, ktorý by do nich
zasiahol, by len rozbil redirect. **Každý iný neznámy kľúč sa prenesie nedotknutý.**

**`?screen=` je vonkajší kontrakt dvoch nasadených spúšťačov** (`electron/main.js:96`,
`:147`, `bin/hades-app.mjs:202`) — tichým prechodom na `s=` sa skratka na Graf
zlomí. A pozor: dnes `?screen=` **natrvalo prepíše uloženú voľbu** (namerané:
`dennik` → `graf`), takže kto raz otvorí Electron skratku, má Graf aj v prehliadači.

### História — jedna veta a jedna tabuľka

Rozhodnutie 10: **`push` = zmenil som, na čo sa pozerám. `replace` = zmenil som,
ako sa na to pozerám.**

| `pushState` | `replaceState` | nič |
|---|---|---|
| prepnutie obrazovky (`s`) | filtre a hľadanie (debounce **220 ms**) | ťahanie uzla, pan, zoom, pinch |
| zanorenie / `goUp()` / `Esc` (`a` `d` `n`) | `mw` (debounce **200 ms** — `oninput` na slideri strieľa desiatky ráz za sekundu) | prehrávanie času |
| prepnutie pohľadu `gv` | otvorenie a zavretie panela detailu (`sel`) | téma, hustota, zvuk |
| prepnutie rozsahu `gs` **človekom** | automatické rozšírenie rozsahu **dôsledkom** | otvorenie doku |
| skok na uzol z hľadania — **jeden** záznam, nie štyri | `loc`, `sk`, predvoľby | šírky panelov |
| otvorenie vlákna, nové vlákno, zatvorenie vlákna | „Načítať ďalších" (`kol`), rozbalenie behu (`ruo`) | rozbalenie projektu / stromu podagentov |
| **prepnutie vetvy** (`b`) | stav panelov (`pt` `pa`), artefakt (`ar`) | hľadanie v histórii vlákien |

Rozhodnutie 10 menuje „pohyb v grafe" výslovne ako `replace`. **Panely tiež:**
Späť má opustiť vlákno, nie vrátiť prepnutý panel.

Tri pravidlá, ktoré z tabuľky nie sú vidieť a bez ktorých sa história zaplní:

- **Jedno gesto = jeden záznam.** Skok na uzol z palety mení obrazovku **aj**
  zanorenie **aj** vybraný uzol **aj** možno rozsah. Musí to byť **jeden**
  `pushState`, nie štyri.
- **Zmenu, ktorú nevyvolal človek, robí `replace`.** Automatické rozšírenie rozsahu
  na `all` je dôsledok, nie gesto. To isté platí, keď `go()` vyvolá **model** cez
  `graph_focus`: model nenavigoval, len zameril.
- **Prepnutie obrazovky maže kľúče filtrov atomicky.** Bez toho `?s=runy&roy=2026`
  prenesie rok z Rozhodnutí na Runy.

### Poradie pri boote a pri každom filtri

**Boot:** `URL > localStorage > default v kóde.` `localStorage` sa pýtame **iba
keď kľúč v URL nie je**.

**Filter:** `URL → stav → dopyt → prune → replaceState orezanej pravdy.`

To druhé poradie je záväzné, lebo tri obrazovky už majú `prune`, ktorý zapnutý
filter bez čipu zhodí: `pruneKontrolaFilters()` (`kontrola.js:322`),
`pruneRunFilters()` (`runy.js:64`), `pruneDecisionFilters`, `pruneLibraryArea()`
(`kniznica.js:108`), a `renderJournal()` (`dennik.js:57`) zhodí `journalProject`,
ktorý už nie je v `project_groups`. **URL nesmie vynucovať filter nad prune
logikou** — inak obrazovka zostane trvalo prázdna bez čipu, ktorým sa filter ruší.

`localStorage` môže hodiť (plné úložisko, privátne okno). `sim.js:488` a `:575` to
už majú v `try/catch`; nový modul musí to isté, inak zápis polohy zhodí navigáciu.

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
Pod 900 px sa `pt` / `pa` **nezapisujú do `localStorage`** (§9).

### Adresa nikdy nespúšťa akciu

Odkaz je **žiadosť o pohľad**. Adresa, ktorá vykoná akciu, by v Hadesovi bola cesta
okolo dvojfázovej brány — zakázané, aj v čítacej podobe.

- **beh číta aktívnu vetvu vždy zo servera, nikdy z URL** (viď `b` vyššie),
- **identita v adrese je uuid, nikdy poradové číslo.** „Vetva 2" je slovo plochy
  nad `ORDER BY id`, takže zmazaním jednej vetvy by sa všetky uložené odkazy ticho
  presunuli na inú,
- **zdieľanie odkazu neudeľuje prístup.** Filter v adrese neobchádza `auth.ui`.

### Ako sa modul overuje

1. **Identita servera pred každým meraním:**
   `curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'` musí dať
   `/js/mind/main.js`.
2. **Obal nad `history` kalibruj z oboch strán:** najprv vlastný `replaceState`
   (musí zachytiť 1), až potom tvrď, čo appka zapísala.
3. **Test kruhu:** pre každý kľúč `serializuj → deserializuj → serializuj` a druhý
   výstup musí byť **znakovo totožný**.
4. **Záporná kalibrácia defaultov:** URL s kľúčom nastaveným na default sa **musí**
   po prvom zápise skrátiť; URL bez kľúča sa nesmie predĺžiť. Bez tejto strany sa
   nedá odlíšiť „default sa vynecháva" od „kľúč sa nezapisuje nikdy".
5. **Nepíš merací skript ako kópiu formuly z modulu** — nechaj modul vystaviť
   výsledok (`window.HADES._urlKeys`) a čítaj ten. Inak po zmene kódu meria svoju
   starú kópiu.
6. Panely `/chat` meraj **iba po `resize_window` na ≥ 901 px**.

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
- [ ] geometria znaku pochádza z jedného generátora (§2: šesť výstupov)
- [ ] jeden význam = jedna ikona; sada je obrysová a jediný plný prvok je jadro
- [ ] názov ikony je zo `ICON_NAMES`; `window.HADES._iconMiss` je prázdne
- [ ] žiadne `.textContent = '<ligatúra>'` a žiadne `classList.add('ms')` — výmena
      kresby ide cez `iconSwap()`
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
      a slučka má `--ease-pulse`, nie `--ease`
- [ ] tichý režim neskracuje **dobu zobrazenia** ani neodoberá obsah
- [ ] `rAF` sa mimo obrazovky Graf zastaví

**Rozloženie**
- [ ] šírkové zlomy sú len **1280** a **900**; žiadne 860, žiadna výšková hranica
- [ ] rail sa zmestí do okna vysokého **614 px** (rozbalený) — merané `scrollHeight`,
      nie `overflow-y`
- [ ] pod 900 px nič neprekrýva a stav prekryvu sa nepamätá (ani v URL)

**URL**
- [ ] čistý stav = adresa bez query stringu; default sa vynecháva
- [ ] kľúč je v kanonickom slovníku (§10); žiadny 38. kľúč bez prepisu manuálu
- [ ] množina = **opakovaný kľúč**, adresa stavaná `URLSearchParams`om
- [ ] test kruhu prejde znakovo; `token`, `k` a cudzie kľúče prežijú nedotknuté
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

`public/fonts/cinzel-wordmark.woff2` (1 256 B) je **build-time vstup pre
`docs/build-brand.py`**, nie webový asset: nič ho nenačítava (0 `@font-face`,
0 preloadov, 0 referencií v CSS/JS/Blade), a pritom je verejne servovaný.
Do `public/` nepatrí. Zmerané sondou B.

Merania prvého prepisu (19.–27. 8. 2026) pochádzajú z
`docs/redesign-2026-08-27/SONDA-A-INVENTAR.md` a `SONDA-B-URL-STAV.md`.
Merania druhého prepisu pochádzajú zo štyroch sond behu vlny 2 + 3 (27. 8. 2026);
ich výstupy a plán, ktorý z nich vznikol, sú v `docs/PLAN-VLNA2-3.md`. Skripty
merania sú v scratchpade sond, aby sa dali zopakovať a **prekalibrovať** — a to je
podmienka, nie zdvorilosť: tri z piatich opravených tvrdení vznikli tým, že prvý
harness meral svoju vlastnú kópiu formuly alebo nekalibrovanú stranu.
