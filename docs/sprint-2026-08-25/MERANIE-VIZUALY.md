# Meranie — ako kresliť diagramy a kód (W1-D, kontrakt §2c)

Dátum: 25. 8. 2026 · vetva `feat/hades-ux` @ `82ae1cb` · rozhoduje kontrakt §2c
(„vlna 1 rozhodne **meraním**, nie preferenciou").

Tento súbor je **meranie**, nie preferencia. Každé číslo nižšie je namerané na tomto
stroji a je uvedené, čím. Kde som niečo nezmeral, je to napísané ako nezmerané.

Harness: node v24.18.0 (`C:\Program Files\nodejs\node.exe`), npm 11.16.0, gzip
`zlib.gzipSync({level:6})`. Balíky stiahnuté `npm pack` do scratchpadu
(`…/scratchpad/w1d/`), **do `public/` sa nekopírovalo nič**. Prehliadač som
nepoužíval (Browser pane patrí orchestrátorovi), takže časy parsovania sú z V8
v node — ten istý engine, iný host.

---

## 0. Odporúčanie na jednu obrazovku

| | Odporúčam | Cena | Namerané „prečo" |
|---|---|---|---|
| **Diagramy** | **NEROBIŤ nič teraz.** Ak treba, vlastný renderer podmnožiny `flowchart TD/LR` (**4,7 kB / 2,0 kB gzip, 98 riadkov**). Mermaid **nie**. | 0 kB dnes / 2 kB neskôr | **0 z 36** reálnych odpovedí modelu obsahuje ```mermaid. **0 z 37** požiadaviek človeka žiadalo diagram. Mermaid stojí **195 kB gzip** len za to, že sa načíta. |
| **Zvýraznenie kódu** | **Vlastný minimálny zvýrazňovač** (**3,8 kB / 1,8 kB gzip, 55 riadkov**, 9 gramatík). highlight.js **nie**, shiki **nie**. | ~2 kB gzip | highlight.js je **CJS bez ESM/browser buildu** → bez bundlera (zakázaný §4) sa self-hostovať nedá. shiki potrebuje import map + **456 kB WASM** + balík jazykov **8,65 MB**. Nameraný rozdiel rýchlosti (0,006 vs 0,206 ms/blok) je pri 8 tok/s bezvýznamný. |
| **Serverové vykreslenie** | **NEROBIŤ.** | +492 MB do image | mermaid bez DOM nefunguje; pod jsdom „prejde", ale vydá SVG s **0 `<text>` prvkami** a `viewBox 116×32` pre 6-uzlový diagram. Správna cesta je headless Chromium — **492 MB** na jednu verziu. |

**Ak je odpoveď „mermaid sa nevyplatí" — áno, je. Nevyplatí sa.**

Čo sa má robiť namiesto toho, tiež z merania (§4).

---

## 1. Empirický základ: čo lokálny model NAOZAJ generuje

Zadanie žiadalo dotaz do `console_messages`. Docker som spustiť nesmel, ale **dotaz
nebol potrebný**: `backups/hades-2026-08-25.sql` je mysqldump živej DB z dnešných
03:00 a obsahuje všetky tri `console_*` tabuľky. Parsoval som ho priamo
(`scratchpad/w1d/parse.js`, `dump2.js`, `dump3.js`, `dump4.js` — jeden tuple na
riadok, tak to mysqldump v tomto projekte píše).

**Overenie proti živej DB si aj tak vypýtam** — dump je 6 hodín starý a nový beh
medzitým mohol pridať riadky. Presné dotazy sú v §6.

### 1a. Korpus

| | počet |
|---|---|
| `console_threads` (vlákna) | 29 |
| `console_messages` celkom | 147 (37 user, 82 assistant, 28 system) |
| z toho odpovede asistenta **s textom** | **36** (46 asistentských riadkov je ťah, ktorý volal len tool) |
| znaky textu asistenta celkom | 14 582 (medián odpovede **214**, max 2 461) |
| `console_tool_calls` | 48 |
| `runs` | 13 |
| modely | `qwen3:8b` 59 správ, `qwen3-coder:30b` 22 |
| dni | 19. 8. (24 odpovedí), 20. 8. (3), 21. 8. (9) |

**Korpus je malý (36 odpovedí, 14,6 kB).** Nepredstieram, že je to štatistika.
Ale je to *všetko, čo tento model v tejto appke kedy napísal*, a jeho výpoveď je
jednosmerná a bez výnimky — viď 1b.

### 1b. Bloky v odpovediach modelu — nula diagramov, nula blokov kódu

| vlastnosť | v koľkých z 36 odpovedí | % |
|---|---|---|
| **oplotený blok ```** (akýkoľvek jazyk) | **0** | 0,0 |
| **```mermaid / flowchart / graph TD / sequenceDiagram / …** | **0** | 0,0 |
| **GFM tabuľka** (`\|…\|` + oddeľovač) | **0** | 0,0 |
| `` `inline kód` `` | 15 | 41,7 |
| `**tučné**` | 11 | 30,6 |
| odrážky | 10 | 27,8 |
| číslovaný zoznam | 6 | 16,7 |
| **vnorený zoznam** (odsadená odrážka) | **3** | **8,3** |
| nadpis `#` | 1 | 2,8 |
| *kurzíva*, odkaz, citát `>`, `---`, `~~preškrtnuté~~`, `- [ ]`, surové HTML, odsadený kód, LaTeX | 0 | 0,0 |

A z druhej strany — **čo si človek pýtal**: z 37 správ používateľa **0** obsahuje
slovo diagram / schéma / mermaid / nakresli / vizualizuj / tabuľka. Tri žiadali
HTML / report / graf.

### 1c. Artefakt v tejto appke NIE JE blok kódu v chate — je to zapísaný súbor

Toto je najdôležitejší nález celého merania a mení, kam patrí práca.

Model síce nenapísal ani jeden ```blok, ale **napísal HTML artefakty** — cez tool
`write_file`:

| tool | cesta | veľkosť | riadkov | stav | `<style>` | `<table>` | `<svg>` |
|---|---|---|---|---|---|---|---|
| `write_file` | `aura-ui-ux-report.html` | 9,5 kB | 314 | done | ✅ | ✅ | — |
| `write_file` | `desktop/aura-ui-ux-report.html` | 9,5 kB | 314 | failed (PathGuard) | ✅ | ✅ | — |
| `write_file` | `sprint-plan-aura-ui-ux.md` | 1,8 kB | 58 | done | — | — | — |
| `write_file` | `storage/app/console-proof.txt` | 15 B | 1 | denied → done | — | — | — |
| `edit_file` | `app/Services/Console/AgentRunner.php` | — | — | pending | — | — | — |

Rozdelenie 48 tool callov: `mind_recall` 14, `read_file` 7, `glob` 7, `grep` 5,
`write_file` 5, `mind_read` 5, `mind_learn` 3, `mind_overview` 1, `edit_file` 1.
Stavy: done 38, failed 5, denied 3, pending 2.

Ďalšie dva namerané rozmery, ktoré určujú, čo panel artefaktu dostane do ruky:

- **náhľady pri bráne** (`console_tool_calls.preview`): 7 kusov, 3,0 kB celkom,
  **priemer 442 B**. To je diff, ktorý človek číta pri rozhodovaní.
- **výsledky `read_file`**: 9,2 kB, 10,2 kB, 13,3 kB, 13,3 kB a **58,8 kB**
  (`McpController.php`). To je reálny horný okraj toho, čo by zvýrazňovač kedy
  dostal — nie 600 B odsek.

**Dôsledok:** panel artefaktu nemá primárne kresliť diagramy. Má (a) ukázať
náhľad HTML/SVG, (b) zvýrazniť **zdroj** toho HTML a (c) zvýrazniť **442 B diff**
pri bráne. Jazyky, ktoré tú prácu tvoria, sú `html`, `css`, `md`, `php`, `js` —
nie python a typescript.

### 1d. Ani korpus, ktorý model ČÍTA, mermaid neobsahuje

`hades.console.files_root` je `base_path()`, takže model vie čítať celé repo
(mínus `PathGuard`: `.env`, `.git`, `vendor`, `node_modules`, čokoľvek s bodkou na
začiatku). Oplotené jazyky vo `*.md`, ktoré sú takto dosiahnuteľné:

| kde | bare ``` | python | typescript | json | ts | sh | php | css | js | bash | yaml | **mermaid** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `docs/` + root `*.md` + `handoff/` + `directives/` | 308 | 66 | 62 | 47 | 19 | 19 | 10 | 6 | 4 | 4 | 2 | **0** |
| `skills/` | 81 | — | — | 15 | — | — | 2 | 6 | 2 | 1 | 8 | **3** |

Celkovo grep našiel 60 ```mermaid v repozitári, ale **57 z nich je v
`.claude/worktrees/*/skills/`** — teda v adresári, ktorý `PathGuard` odmieta
(bodka na začiatku). Vo vlastnej dokumentácii Hadesa je mermaidov **nula**.

Model teda nemá odkiaľ mermaid ani odkukať. A **systémový prompt**
(`app/Services/Console/SystemPrompt.php`) mu o diagramoch nehovorí nič; končí
vetou „Odpovedaj po slovensky, krátko a vecne, bez úvodov". Krátko a vecne ≠
diagram.

---

## 2. Cesta 1 — self-hostovaná knižnica

### 2a. mermaid 11.17.1

**Existuje ESM build bez bundlera? ÁNO, ale nie ten, ktorý `exports` ponúka.**

| entry | veľkosť | bare specifiery | použiteľné natívne? |
|---|---|---|---|
| `dist/mermaid.core.mjs` (to, čo `exports["."]` vracia) | 53 265 B | `ts-dedent`, `d3`, `stylis`, `dompurify`, `es-toolkit/compat` | **NIE** — treba bundler alebo import map |
| `dist/mermaid.esm.min.mjs` | 30 255 B | **žiadne** | **ÁNO** |
| `dist/mermaid.min.js` | 3 572 657 B | (IIFE) | áno, ale nie ESM |

Ale tých 30 kB je len vstup. Statická (eager) uzávera relatívnych importov:

| | súborov | raw | gzip |
|---|---|---|---|
| **eager uzávera `mermaid.esm.min.mjs`** | **19** | **736 kB** | **195 kB** |
| + flowchart chunk (net navyše) | +6 | +64 kB | +21 kB |
| + dagre layout (net navyše) | +2 | +39 kB | +14 kB |
| + sequence diagram (net navyše) | +3 | +116 kB | +31 kB |
| **eager + flowchart + dagre + sequence** | **29** | **954 kB** | **261 kB** |
| celý `dist` (všetky `.mjs`, 41 typov diagramov) | 274 | 13 137 kB | 2 906 kB |

Tarball je 17,8 MB, rozbalené 84,3 MB, 1 183 súborov. Do `public/fonts/`-štýlu
self-hostu by teda šlo **29 súborov v adresárovej štruktúre s hashovanými menami**
(`chunks/mermaid.esm.min/chunk-IJBDOHL6.mjs` a spol.) — a tie mená sa pri každom
`npm update` zmenia.

**Čas parsovania a prvého vykreslenia:**

- eager uzávera, `import()` v node V8: **36,5 / 35,8 / 36,2 ms** (3 behy, teplý disk).
- **prvé vykreslenie sa nedá zmerať bez DOM**: `mermaid.parse()` v čistom node padne
  na `TypeError: Rt.addHook is not a function` (DOMPurify chce `window`). Pod jsdom
  áno — viď §3, kde je to zmerané aj s výsledkom, ktorý sa nedá použiť.

**Čo to znamená pre §2c.** Kontrakt hovorí „self-hostovaný mermaid (~1 MB)".
Namerané: **954 kB raw / 261 kB gzip** pre tri typy diagramov, alebo 13,1 MB pre
všetky. Odhad v kontrakte bol správny. Cena je reálna a je to cena za funkciu,
ktorá sa v 36 odpovediach nevyskytla ani raz.

**A ešte jedna vec, ktorú §2c pomenúva správne:** 41 chunkov sa načítava
`import()`-om **za behu**. Keby ktorýkoľvek z nich chýbal (zlá cesta, zabudnutý
súbor pri deploy), diagram spadne presne tým spôsobom, akým sa rozpadol rail pri
nedostupnom Google Fonts CDN — až u používateľa, nie pri builde. Self-host mermaidu
je 29 nových šancí na tú istú chybu.

### 2b. highlight.js 11.12.0 — **nemá ESM build vôbec**

Toto je tvrdý blokátor, nie preferencia:

- `lib/core.js` končí `module.exports = highlight;` — **CJS**.
- `es/core.js` má **4 riadky** a je to Node dual-package obal:
  `import HighlightJS from '../lib/core.js'` — teda ESM obal nad CJS. V prehliadači
  to nezbeží.
- V balíku **nie je ani jeden `.min.js`** (`find . -name '*.min.js'` = nič).
  Browser bundle žije len na CDN / v release zipe, a CDN je podľa §2c preč.

Self-hostovať sa dá jedine tak, že sa vendor kód **prepíše ručne** (`module.exports`
→ `export default`, a to isté v každom jazykovom súbore) — čo je fork 74 kB cudzieho
kódu, ktorý sa pri každej aktualizácii prepisuje znova. Bundler §4 zakazuje.

Namerané veľkosti (aby cena bola na papieri, keby sa niekto rozhodol inak):

| | raw | gzip |
|---|---|---|
| `lib/core.js` | 74,5 kB | 22,0 kB |
| 12 jazykov (php, js, css, json, sql, python, sh, xml, md, yaml, ts, diff) | ~119 kB | ~38 kB |
| **spolu** | **~194 kB** | **~60 kB** |
| tém (CSS) v balíku | 167 súborov | |

Načítanie v node: `require('lib/core.js')` **3,0 ms** + registrácia 12 jazykov
**8,3 ms** = 11,3 ms.

Priepustnosť (20 prechodov, priemer):

| jazyk | vstup | čas | priepustnosť |
|---|---|---|---|
| php (`SystemPrompt.php`) | 4,5 kB | 0,70 ms | 6,3 MB/s |
| javascript (`shared/markdown.js`) | 5,1 kB | 1,36 ms | 3,8 MB/s |
| css (`console.css`) | 44,0 kB | 4,73 ms | 9,3 MB/s |
| sql (`decisions-…sql`) | 37,7 kB | 1,33 ms | 28,3 MB/s |
| **typický blok 584 B** | | **0,206 ms** | |

### 2c. shiki 4.4.3 — ESM áno, ale nič z toho sa nedá načítať samo

- `type: module`, všetko `.mjs`. Ale **každý dist entry importuje bare
  `@shikijs/*`**: `dist/bundle-web.mjs` (7,6 kB) → `@shikijs/core`, `dist/wasm.mjs`
  → `@shikijs/engine-oniguruma/wasm-inlined`.
- Bez bundlera by to znamenalo **import map** s ôsmimi a viac mapovaniami
  (`@shikijs/core`, `/langs`, `/themes`, `/types`, `/engine-javascript`,
  `/engine-oniguruma`, `/vscode-textmate`, `@types/hast`). Import map *nie je*
  bundler, takže §4 formálne neporušuje — ale je to osem ďalších ciest, ktoré musia
  na produkcii existovať.
- Hmotnosť závislostí (npm `dist.unpackedSize`):
  `@shikijs/langs` **8 653 550 B / 725 súborov**, `@shikijs/themes` 1 479 330 B /
  135 súborov, `@shikijs/engine-oniguruma` 643 892 B, `@shikijs/core` 64 493 B.
- `dist/onig.wasm` = **456 kB raw / 155 kB gzip**. Sám WASM je **86× väčší** než
  celý prototyp z §4.

shiki je nesprávny nástroj pre appku bez build stepu. Je postavený na tom, že
bundler vyberie, ktoré jazyky idú do výstupu.

---

## 3. Cesta 2 — serverové vykreslenie do SVG

### 3a. V kontejneri nie je čím

`docker/php/Dockerfile` je `php:8.4-cli` + `git unzip libzip-dev mariadb-client
ripgrep` + composer. **Žiadny node, žiadny Chromium.** PHP implementácia mermaidu
neexistuje (referenčná je JS a potrebuje DOM), takže „PHP alebo node CLI cez
artisan" znamená v praxi node CLI — a ten treba do image doniesť.

### 3b. jsdom: mermaid „prejde" a vydá nepoužiteľný SVG

Toto som zmeral, nie odhadol (`scratchpad/w1d/srv/probe.mjs`; `npm i jsdom mermaid`
= **151 balíkov, 170 MB** `node_modules`).

| krok | výsledok |
|---|---|
| boot jsdom | 44 ms |
| `import('mermaid')` | 479–518 ms |
| `mermaid.parse()` | **funguje**, 12,5–15,5 ms |
| `mermaid.render()` bez shimov | **`ReferenceError: CSSStyleSheet is not defined`** |
| `mermaid.render()` po doplnení `CSSStyleSheet`, `getBBox`, `getComputedTextLength`, `getScreenCTM` | „OK" 103–111 ms cold / 47 ms warm, 16 050 B SVG |

A teraz to, čo z toho SVG naozaj vyšlo:

```
COUNTS nodes=13 edgePaths=5 texts=0 viewBox="-8 -8 116 32"
```

**Nula `<text>` prvkov** a `viewBox` 116 × 32 px pre šesťuzlový `flowchart TD`.
Diagram bez písma, natlačený do 116 px.

**Kalibrácia (aby sa tomu číslu dalo veriť):** menil som len návratovú šírku
falošného `getBBox()`:

| shim `getBBox().width` | výsledný `viewBox` |
|---|---|
| 40 | `-8 -8 **56** 32` |
| 100 | `-8 -8 **116** 32` |
| 200 | `-8 -8 **216** 32` |

Rozloženie teda **určuje moje vymyslené číslo**, nie font. To je definícia
nepoužiteľného výsledku: jsdom nemá SVG merania a mermaid ich na sadzbu textu
potrebuje.

### 3c. Správna serverová cesta je headless Chromium a je to 492 MB

`@mermaid-js/mermaid-cli` 11.16.0 to hovorí sám:
`peerDependencies = { puppeteer: '^23 || ^24 || ^25' }`, `engines.node >= 18.19`.

Namerané ceny:

| položka | hodnota | ako zmerané |
|---|---|---|
| jedna verzia Chrome na tomto stroji | **492 MB** | `du -sm "/c/Program Files/Google/Chrome/Application/151.0.7922.174"` |
| studený start node procesu (host) | **77 / 79 / 82 / 85 / 94 ms** | 5 behov `node -e 0` |
| node runtime do image | ~60–90 MB | nezmerané, uvádzam ako rád veľkosti |
| štart Chromium + render jedného diagramu | **NEZMERANÉ** | nechcel som ťahať 492 MB prehliadača do scratchpadu; typicky stovky ms až ~1 s na štart |

Do `docker/php/Dockerfile` by teda pribudol node + Chromium + jeho systémové
knižnice. **To je väčšia zmena prostredia než celý zvyšok tohto šprintu.**

### 3d. Čo to znamená pri streamovanej odpovedi — áno, diagram príde až po

Protokol je NDJSON s rámcami `start`, `delta`, `step`, `tool`, `tool_result`,
`permission`, `end`. Serverové vykreslenie by muselo bežať takto:

1. `delta` rámce nesú text po znakoch; ```mermaid je otvorené, ale **kde končí, sa
   zistí až posledným ` ``` `**. `renderMarkdown` to dnes rieši elegantne — počas
   streamu kreslí nezavretý blok ako blok kódu (`(?:```|$)`), takže človek vidí, že
   sa niečo píše.
2. Až po zavretí bloku môže klient poslať jeho text na render. To je **druhý HTTP
   round trip**, ktorý začína v okamihu, keď už text v bubline stojí.
3. Kým render beží (node cold start ≥ 80 ms + Chromium + samotný render), stream
   dobehol a `end` rámec je dávno doma.

**Odpoveď na otázku zo zadania: diagram sa objaví až po dobehnutí, a navyše až po
druhom round tripe.** Pri lokálnom modeli na ~8 tok/s je 100 riadkov mermaidu
samo o sebe ~30–60 s generovania — a diagram sa dovtedy nekreslí vôbec, potom
skočí naraz. Klientský render (cesta 1 alebo 3) kreslí v okamihu, keď blok zavrie,
bez ďalšieho requestu.

Vedľajšia poznámka, ktorú treba povedať nahlas: serverový render je **čítacia**
operácia, takže dvojfázovou bránou nechodí. To je v poriadku a **nesmie sa to zmeniť
na výnimku** — brána stráži zápisy, render nič nezapisuje.

---

## 4. Cesta 3 — vlastný minimálny renderer (dva zmerané prototypy)

Prototypy sú v scratchpade (`hl-proto.mjs`, `flow-proto.mjs`), **do `public/` sa
nekopírovalo nič**. Sú tam, aby cena cesty 3 bola nameraná, nie odhadnutá.

### 4a. Zvýrazňovač — 3,8 kB / 1,8 kB gzip / 55 riadkov

Jedna tabuľka na jazyk (blokový komentár, riadkový komentár, string, kľúčové slová,
číslo), jeden `String.replace` s jedným zloženým regexom, výstup len
`<span class="t-c|t-s|t-k|t-n">` nad **už escapovaným** textom — teda presne v tom
poradí, ktoré `markdown.js` ustanovil („escapuj všetko, potom povoľ menovaný
zoznam"). Gramatiky: php, js, ts, python, sql, sh, css, json, html, diff + 14 aliasov.

| jazyk | vstup | čas / prechod | priepustnosť | spanov |
|---|---|---|---|---|
| php | 4,5 kB | **0,06 ms** | 78 MB/s | 65 |
| js | 5,1 kB | **0,03 ms** | 188 MB/s | 104 |
| css | 44,0 kB | **0,19 ms** | 231 MB/s | 743 |
| json | 0,8 kB | 0,01 ms | 97 MB/s | 9 |
| sql | 37,7 kB | 0,10 ms | 391 MB/s | 399 |
| **typický blok 672 B** | | **0,006 ms** | | |

Proti highlight.js: **0,006 vs 0,206 ms** na typický blok (34×), a **1,8 vs ~60 kB**
gzip (33×). Pri 8 tok/s je rozdiel v čase bezvýznamný — rozhoduje tá gzip
tridsaťtrojka a to, že prototyp je ESM a nepotrebuje bundler.

**Čo prototyp NEROBÍ** (a je to cena, ktorú treba priznať):

- Nemá kontextové stavy — vnorený reťazec v šablóne, heredoc v PHP, JSX ani
  regex-literál od delenia nerozlíši.
- **Nájdená chyba pri kalibrácii:** SQL kľúčové slová sa porovnávajú
  case-sensitive, takže `SELECT id FROM nodes` sa **nezvýrazní**, kým `select` áno.
  Overené výstupom; oprava je jeden `i` flag pre gramatiky, ktoré ho chcú.
  (Kalibrácia z oboch strán: `class`/`public`/`function`/`return` v PHP a `"ahoj $x"`
  aj `// komentar` sa zvýraznia správne — takže merač meria.)
- Nemá 386 jazykov highlight.js. Má tie, ktoré §1c nameral ako reálnu prácu.

### 4b. Diagramy — 4,7 kB / 2,0 kB gzip / 98 riadkov

Podmnožina: `flowchart|graph TD|TB|LR|RL|BT`, uzly `A[…]`, `A(…)`, `A((…))`,
`A{…}`, hrany `-->`, `---`, `-.->`, `==>` s voliteľným `|popisom|`. Vrstvenie
najdlhšou cestou (s ochranou proti cyklu), výstup SVG. Farby idú výhradne cez
`currentColor` a triedy (`.dg-n`, `.dg-e`, `.dg-t`) — **žiadny raw hex**, tak ako
káže projektové pravidlo.

| meranie | hodnota |
|---|---|
| 6-uzlový `flowchart TD` (ten z §3b) | **1 793 B SVG za 0,008 ms** |
| 61-uzlový diagram | **0,038 ms** |
| `sequenceDiagram` na vstupe | vráti `null` → padne späť na blok kódu |

Pre porovnanie: mermaid na ten istý 6-uzlový diagram potrebuje 195 kB gzip
načítať, 36 ms parsovať a potom ešte vykresliť.

**Čo prototyp NEROBÍ** (toto je dôvod, prečo ho neodporúčam stavať *teraz*):

- **Nemeria text.** Uzly majú fixnú šírku 150 px, takže „Používateľ pošle správu"
  sa vojde a dlhší popis vytečie. Správne riešenie je `getComputedTextLength()`
  v prehliadači (tam je, na rozdiel od jsdom, k dispozícii) — ale to je ďalších
  ~30 riadkov a jeden reflow.
- Nezalamuje popisy, neminimalizuje kríženie hrán, nepozná `subgraph`.
- Pozná **jeden** typ diagramu. Sequence, class, ER, gantt, state, pie — nič.

---

## 5. Odporúčanie s číslami — a čo sa NEROBÍ a prečo

### 5a. Diagramy: nerobiť nič. Mermaid sa nevyplatí.

**Cena:** 195 kB gzip len za načítanie, +21 kB za flowchart, 36 ms parse,
29 súborov s hashovanými menami v `public/`, 41 dynamických importov ako nových
šancí na „rozpadnutý rail".
**Výnos podľa merania:** 0 výskytov v 36 odpovediach, 0 žiadostí zo 37, 0 mermaidov
vo vlastnej dokumentácii, ktorú model čítá, 0 zmienok o diagramoch v systémovom
prompte.

**Preto: v tomto šprinte diagram renderer nevzniká.** ```mermaid zostane blokom
kódu s hlavičkou `code-lang` a tlačidlom Kopírovať — presne ako dnes. To **nie je
regresia**, je to zachovanie stavu, ktorý nikomu nechýbal.

**Spúšťač na prehodnotenie, aby to nebolo „nikdy" zo zvyku:** keď sa ```mermaid
objaví v **≥ 5 % odpovedí asistenta** (dnes 0 %), postaví sa prototyp z §4b —
2 kB gzip, nie 216 kB. Dotaz na overenie je v §6 a dá sa pustiť kedykoľvek.

### 5b. Kód: vlastný zvýrazňovač, ~2 kB gzip

**Prečo nie highlight.js:** balík **nemá ESM ani browser build**, len CJS +
štvorriadkový Node obal. Bez bundlera (§4) sa nedá self-hostovať bez forku vendor
kódu. To je koniec diskusie, nie preferencia.
**Prečo nie shiki:** import map s 8+ mapovaniami, `onig.wasm` 456 kB (155 kB gzip),
balík jazykov 8,65 MB / 725 súborov. Je navrhnutý pre bundler.
**Prečo áno prototyp:** 1,8 kB gzip, čistý ESM, hoistované `export function`, žiadny
raw hex, 34× rýchlejší na typickom bloku, a pokrýva presne tie jazyky, ktoré §1c
nameral (`html`, `css`, `md`, `php`, `js`, `json`, `sql`, `sh`, `diff`).

Pri jeho zavedení treba dodržať poradie z `markdown.js`: **zvýrazňuje sa už
escapovaný text** a vkladajú sa len `<span class="t-*">`. Ak by sa zvýrazňovalo pred
escapovaním, celá obrana proti `<img onerror=…>` z pamäte padne.

### 5c. Serverové vykreslenie: nerobiť. Ani ako záložnú cestu.

+492 MB Chromium (alebo nepoužiteľný jsdom s 0 `<text>`), ≥ 80 ms cold start na
diagram, druhý HTTP round trip, a diagram sa aj tak objaví až po dobehnutí streamu.
Za funkciu s nameranou nulovou frekvenciou.

### 5d. Čo sa má robiť NAMIESTO toho (tiež z merania)

Toto sú nálezy, ktoré vypadli z §1 a majú vyššiu hodnotu na kilobajt než akýkoľvek
diagram. Nie sú v mojom zadaní, uvádzam ich ako podklad pre orchestrátora.

1. **`renderMarkdown` nepodporuje vnorené zoznamy** — a tie sú v **3 z 36 (8,3 %)**
   reálnych odpovedí, teda častejšie než ktorákoľvek vizuálna funkcia z celého §2.
   Dnes `^\s{0,3}[-*+]\s+` spracuje odsadenú odrážku ako plochú položku, takže
   hierarchia odpovede sa v UI stratí. Cena opravy: rádovo 15 riadkov v jednom
   zdieľanom module.
2. **`renderMarkdown` nepodporuje tabuľky** — v chate ich model dnes nepíše (0/36),
   ale kontrakt §3 tabuľky v paneli artefaktu **žiada** a obidva HTML artefakty,
   ktoré model naozaj napísal, `<table>` obsahujú.
3. **Panel artefaktu má merateľnú náplň už dnes, a nie sú to diagramy:** 9,5 kB HTML
   so `<style>` a `<table>`, 1,8 kB markdown a **442 B priemerný diff** pri bráne.
   Náhľad HTML musí byť **sandboxovaný iframe**, nie `innerHTML` — je to výstup
   modelu, teda nedôveryhodný vstup, presne ten dôvod, pre ktorý `markdown.js`
   existuje. A SVG (keby raz diagram vznikol) musí zostaviť **náš** kód z parsovaného
   vstupu, nikdy sa nesmie prepustiť SVG od modelu.

---

## 6. Dotazy, ktoré si vypýtam od orchestrátora

Merania v §1 sú z `backups/hades-2026-08-25.sql` (dump z dnešných 03:00). Docker
spúšťať nesmiem, takže **overenie proti živej DB** patrí orchestrátorovi. Ak čísla
vyjdú rovnako, §1 platí; ak sa v novom behu objavil prvý ```mermaid, vie sa to hneď.

```sql
-- 1) korpus a frekvencia oplotených blokov v odpovediach modelu
SELECT COUNT(*)                                              AS assistant_msgs,
       SUM(content LIKE '%```%')                             AS with_fence,
       SUM(content REGEXP '```[[:space:]]*mermaid')           AS with_mermaid,
       SUM(content REGEXP '(flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram|mindmap)') AS with_diagram_kw,
       SUM(content REGEXP '\n[[:space:]]*\\|.*\\|')           AS with_pipe_table,
       ROUND(AVG(CHAR_LENGTH(content)))                       AS avg_chars,
       MAX(CHAR_LENGTH(content))                              AS max_chars
FROM console_messages
WHERE role = 'assistant' AND content IS NOT NULL AND content <> '';

-- 2) aké jazyky sa v tých blokoch vyskytujú (ak with_fence > 0)
SELECT id, thread_id, model, LEFT(content, 400) AS head
FROM console_messages
WHERE role = 'assistant' AND content LIKE '%```%'
ORDER BY id DESC
LIMIT 30;

-- 3) žiadal človek niekedy diagram?
SELECT COUNT(*) AS user_msgs,
       SUM(content REGEXP '(diagram|mermaid|schém|nakresl|vizualiz)') AS asked_diagram,
       SUM(content REGEXP '(tabuľk|tabulk)')                          AS asked_table,
       SUM(content REGEXP '(html|report|artefakt|graf|chart)')        AS asked_artifact
FROM console_messages
WHERE role = 'user' AND content IS NOT NULL;

-- 4) čo model reálne zapisuje (skutočný artefakt) a aké veľké to je
SELECT name,
       COUNT(*)                                                   AS calls,
       SUM(status = 'done')                                       AS done,
       ROUND(AVG(CHAR_LENGTH(arguments)))                         AS avg_args_chars,
       MAX(CHAR_LENGTH(arguments))                                AS max_args_chars,
       ROUND(AVG(CHAR_LENGTH(preview)))                           AS avg_preview_chars
FROM console_tool_calls
GROUP BY name
ORDER BY calls DESC;

-- 5) prípony ciest, do ktorých sa zapisuje (jazyky pre zvýrazňovač)
SELECT JSON_UNQUOTE(JSON_EXTRACT(arguments, '$.path')) AS path,
       CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(arguments, '$.content'))) AS content_chars,
       status
FROM console_tool_calls
WHERE name IN ('write_file', 'edit_file')
ORDER BY content_chars DESC;
```

Očakávané hodnoty z dumpu (aby sa dalo porovnať): (1) 36 / 0 / 0 / 0 / 0 /
405 / 2461 · (3) 37 / 0 / 0 / 3 · (4) `mind_recall` 14, `read_file` 7, `glob` 7,
`grep` 5, `write_file` 5, `mind_read` 5, `mind_learn` 3, `mind_overview` 1,
`edit_file` 1; priemerný `preview` 442 B · (5) dva 9,5 kB `.html`, jeden 1,8 kB
`.md`, dva drobné `.txt`.

---

## 7. Čo toto meranie NEHOVORÍ

- **Nezmeral som čas prvého vykreslenia mermaidu v prehliadači.** Browser pane patrí
  orchestrátorovi, takže parse/eval je z V8 v node (36 ms) a render z jsdom (47–111 ms
  s nepoužiteľným výsledkom). Reálny browser render bude iný — ale rozhodnutie
  nestojí na ňom, stojí na 195 kB gzip proti nulovej frekvencii.
- **Nezmeral som štart headless Chromia ani render cez `mermaid-cli`.** Znamenalo by
  to stiahnuť ~492 MB prehliadača do scratchpadu. Namerané sú komponenty (footprint
  Chromu, cold start node, peer dependency); súčet je odhad a je tak označený.
- **Korpus 36 odpovedí je malý.** Je to celý korpus, aký existuje, a jeho výpoveď je
  jednosmerná (0 blokov, 0 diagramov, 0 tabuliek, 0 žiadostí) — ale nie je to
  štatistika nad tisíckami odpovedí. Preto je v §5a spúšťač na prehodnotenie
  s konkrétnym prahom, nie „nikdy".
- **Prototypy sú prototypy.** 55 a 98 riadkov v scratchpade, s vymenovanými dierami
  (SQL case, meranie textu). Ak sa jeden z nich schváli, čaká ho dorobenie —
  nameraná cena je cena tohto rozsahu, nie hotového modulu.
- Nezmeral som veľkosť ani kontrast ničoho v UI. Toto meranie je o technológii, nie
  o vzhľade; čísla o kontraste sú v `docs/sprint-2026-08-21/BASELINE-MERANIA.md`.
