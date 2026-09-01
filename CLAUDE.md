# Hades (AI-mind) — poznámky pre Claude Code

Laravel + MariaDB + Redis + Reverb v Dockeri. MCP server `hades` na
http://localhost:8080/mcp, vizualizácia na http://localhost:8080.

## Frontend

Vizualizácia **nemá build step**. `resources/views/mind.blade.php` je statické HTML
a načítava `public/js/mind/main.js` ako `<script type="module">`. Vite v projekte je,
ale `mind.js` sa cez neho nikdy nepúšťal — needituj `vite.config.js` kvôli grafu.

`public/js/mind/` je **31 natívnych ES modulov** (do 8/2026 to bol jeden IIFE
s 5933 riadkami). Kľúčové:

| Modul | Zodpovednosť |
|---|---|
| `state.js` | zdieľaný objekt `S` — jediný zdroj pravdy, všetci ho importujú |
| `layout.js` | `computeLayout()` — deterministické rozloženie pre aktuálnu úroveň, `viewInsets()` / `camInsets()` |
| `sim.js` | stavový stroj `go({level, area, dept, node})`, `currentPath()`, `goUp()` |
| `render.js` | kreslenie canvasu, `fitCam()`, `graphActive()`, `publishNavApi()` |
| `edges.js` | hrany a agregované stuhy medzi oblasťami |
| `controls.js` | ovládanie + presety nastavení |
| `screens/*.js` | jednotlivé obrazovky (Dnes, Denník, Knižnica, …) |

**Cyklické importy sú v tomto grafe nevyhnutné** (`render` ↔ `panels` ↔ `controls`).
Preto: **exportuj funkcie ako hoistované `export function`, nikdy ako
`export const foo = () => {}`** — arrow v `const` nie je hoistovaná a pri cykle spadne
na `ReferenceError: Cannot access 'foo' before initialization`.

### Graf

**Jedna veľká scéna, dva pohľady, zanorenie je len filter.**

- `S.gview` = `'net'` (organický oblak) alebo `'layers'` (vodorovné pásy podľa
  `layer_role`: vstup → skryté → jadro → výstup). Prepínače `#btn-view-net` /
  `#btn-view-layers` v hlavičke, kláves `V`. **Pohľady NIE SÚ zrušené** —
  `setView()` je živý kód, nie shim.
- `go({level, area, dept, node})` v `sim.js` **nemení pozície ani nevymieňa scénu**.
  Je to filter: fokusová skupina zostane plná, zvyšok stmavne na `DIM_CTX` (0,34).
  `L.pos` preto obsahuje **vždy všetky uzly** (19. 8. 2026: 2675), na každej úrovni.
  Default `graphScope` je ale `live`, takže bez prepnutia na `all` sa kreslí ~1095.
  `Esc` zruší filter, `#btn-up` ide o úroveň von.

**d3 `forceSimulation` JE späť** (od `a4497ff`) a pozície sú organické, nie
deterministické. Determinizmus bola moja vlastná podmienka z augusta 2026, ktorú
používateľ nikdy nežiadal a ktorá zabila živý dojem siete — nezavádzaj ju znova.
Ťahanie uzlov funguje (`fx/fy` + `holdSim`).

**Simuláciu tiká vlastná rAF pumpa** (`pump()` v `sim.js`), nie d3 timer — ten beží
na `requestAnimationFrame` a rozbil by pravidlo „mimo Grafu sa nekreslí". Mimo Grafu
pumpa **netiká na rAF, ale dosadá ticho** cez `setTimeout` (10 ms dávka / 50 ms):
bez toho by alpha nikdy neklesla, timer sa preplanoval navždy a každý WS zrod uzla
by zaplatil studený burst ~150 ms na zablokovanom vlákne.

**Ako scéna vyplní viewport bez determinizmu:** gravitácia je **anizotropná** — v Y
je `ar^squashPow`-krát silnejšia (`PHYS.squashPow = 2`). V rovnováhe má oblak pomer
strán ≈ pomer viewportu, takže fit sadne na obe osi naraz. Bez toho by sa force
layout usadil do kruhu a na 16:9 pokryl ~55 % šírky. `normalizeAspect()` to po
usadení dotiahne. Okraje sa čítajú z CSS tokenov (`--rail-w`, `--header-h`,
`--panel-w`, `--edge`) — nezadrôtuj ich znova do JS.

**Vizuálna sémantika** (jeden význam na kanál): farba = oblasť, tvar = typ.
Uzly sú **priehľadné prstence**, nie plné disky — priehľadnosť nesie *diera*, nie
nízka alfa, takže sa prekrývajúce uzly dajú čítať. Podlaha obrysu sa medzitým
**rozdvojila podľa role** (`render.js`): pokojový uzol má `RING_LW = 1,15` px
a informačný — pod kurzorom, vo výbere, s popiskom, jadro a hub — `RING_LW_HOT`
**1,7** px. To druhé číslo nie je 1,5 preto, aby mal obrys plne pokrytý pixel aj
pri najnepriaznivejšom subpixelovom zarovnaní. Pokojový uzol prah 3:1 zámerne
nespĺňa a je to ten istý argument ako pri hranách: informáciu nesie hustota
oblaku, nie jedna vláska. Do 1. 9. 2026 tu stálo `RING_LW = 1,5`, čo neplatilo
ani pre jednu z tých dvoch hodnôt. Spomienka = jeden prstenec, skill = dva súosé,
projekt = prstenec s plným stredom, **jadro = jediný sýty plný prvok** (zlato).
Legenda v `panels.js` musí hovoriť ten istý jazyk — plné disky tam učili zle.

**Farby oblastí sa utlmujú v OKLCh** (`mutedColor()` v `theme.js`): zrezaná chroma
a **jednotná cieľová svetlosť** pre všetky oblasti, takže oko ich číta ako jednu
tichú vrstvu a rozlišuje len tónom. Podlaha kontrastu (3,15:1 voči papieru) je
súčasťou funkcie, nie kozmetika. Každý swatch oblasti v DOM (legenda, štatistiky,
strom, Knižnica, Dnes) musí ísť cez `mutedColor()`, inak UI hovorí inou farbou než
plátno. V HSL to nerob — z gold by bola špinavo hnedá.

**Hrany sú hlavný nosič dojmu, nie dekorácia.** Kreslia sa všetky (19. 8. 2026: 8271) ako
vlásková textúra; hustota nesie štruktúru. `S.minWeight` default je **0** (bolo 1,0
a skrývalo 791 hrán). Jednotlivá hrana zámerne nedosahuje 3:1 — pri 2000 vláskach
to je nezlučiteľné s „jemnou sieťou"; význam nesie hustota a pri hoveri ide hrana
na akcent, kde prah **spĺňa**.

Mimo obrazovky Graf sa `requestAnimationFrame` **zastaví** (`graphActive()`).
Keď pridávaš window listener, ktorý siaha na graf, daj mu `graphActive()` strážcu —
inak beží nad 1000+ uzlami na obrazovkách, kde graf nikoho nezaujíma.

### Dotyk a ovládanie plátna

Plátno počúva **`touch*` vedľa myšacích handlerov**, nie zjednotené pointer eventy.
Myšacia cesta nesie veci, ktoré dotyk nemá (hover karta, `S.cursor` pre gravitáciu
kurzora, tvar kurzora), takže `pointermove` by sa aj tak vetvil na `pointerType` —
jedna cesta by bola tá istá dvojkoľajnosť schovaná vnútri. Zdieľané je **telo gesta**:
`beginDragAt()`, `moveDragTo()`, `resolveClick()`, `zoomAt()`.

**Pinch je ukotvený v strede medzi prstami**, nie v strede plátna: namerané, drift
svetového bodu pod stredom gesta je 0.000, kotva v strede plátna ho posunie o ~365
jednotiek sveta. Dvojklep má vlastnú detekciu (300 ms / 30 px) — `preventDefault`
na `touchstart` syntetický `dblclick` nikdy nevydá.

`touch-action: none` je v CSS a je **viazané na `body[data-screen="graf"]`**. Musí
byť: plátno je `position: fixed; inset: 0` pod obsahom, takže natvrdo vypnuté gestá
by na dotyku zabili scrollovanie stránky všade, kde sa prst trafí mimo textu.

### Metriky v hlavičke sú po filtri

`updateHeaderMetrics()` počíta viditeľné uzly cez `filterPass()` a hrany cez oba
konce + `minWeight` + `edgeCategoryHidden()`. Bez aktívneho filtra je text znak po
znaku pôvodný („1109 uzlov · 3053 spojení"), s filtrom hlási pomer („230 z 1109").
Do 20. 8. 2026 hlásil surové `S.nodes.length`, takže vypnuté typy sa v číslach
neprejavili vôbec.

### Ikony — ako sa overuje subset

**Nečítaj GSUB tabuľky, meraj šírku vykresleného glyfu.** Prvý pokus o audit hlásil
32 chýbajúcich ikon vrátane tých, o ktorých je nižšie napísané, že v subsete sú —
čítal ligatúrové lookupy zle. Metóda, ktorá sa kalibruje sama: vykresli názov ikony
v Material Symbols a odmeraj šírku. Vykreslený glyf ≈ 1 em (18 px), nevykreslená
ligatúra padne na fallback a je násobne širšia (`terminal` 144 px, `arrow_downward`
252 px). Kalibruj na známom kladnom (`hub` = 18 px) aj zápornom prípade.
Stav k 20. 8. 2026: **všetkých 32 ikon použitých v kóde je v subsete**.

### Fonty

**Self-hosted v `public/fonts/`, Google Fonts CDN je zámerne preč.** Pri jeho
nedostupnosti sa každá ikona vykreslila ako svoj ligatúrový názov („wb_sunny", „hub")
v serif fallbacku a rail sa rozpadol. `@font-face` bloky sú na začiatku `mind.css`,
Geist / Geist Mono / Playfair sú variabilné (jedna os `wght`), preto `font-weight`
deklaruje rozsah. `latin-ext` nesie slovenskú diakritiku, načíta sa vždy.

**„CDN je preč" platí od 26. 8. 2026 aj pre skripty.** Dovtedy ťahal `mind.blade.php`
`d3@7` a `pusher-js@8` z `https://cdn.jsdelivr.net`, ani jeden nebol v `public/` a ani
jeden nemal `integrity` — CSP tak povolila **host, nie obsah**, a kompromitovaný
jsdelivr by na appke tunelovanej cez ngrok prešiel. Oba sú teraz **self-hostované
v `public/js/vendor/`** (d3 **7.9.0**, pusher-js **8.6.0**, bajt na bajt z upstreamu;
sha256, licencie a postup pri aktualizácii sú v `public/js/vendor/README.md`).

Sú to **UMD** balíky, takže si globály `d3` a `Pusher` nastavia samy — presne tie mená,
ktoré čítajú `mind/sim.js` (so strážou `d3ok()`) a `mind/ws.js`. Preto to bol drop-in
a tie dva súbory sa nemuseli meniť. **Poradie v blade drž:** oba vendor skripty musia
stáť **pred** `/js/mind/main.js`, inak `sim.js` d3 nenájde.

Dôsledok pre CSP: `script-src 'self'` platí **na všetkých troch plochách bez vetvenia
podľa route** a drží to **test** (`tests/Feature/ContentSecurityPolicyTest.php`,
kalibrovaný z oboch strán — vrátenie CDN do politiky aj do blade zhodí každé svoj test).
Predtým to bola len disciplína toho, kto naposledy editoval blade: docblock sľuboval
test, ktorý **nikdy neexistoval**.

**Ikonový font je preč (28. 8. 2026).** Ikony sú **inline SVG z `public/js/shared/icons.js`** —
jedna sada 60 symbolov pre `/`, `/console` aj `/chat`, kreslí ju trieda `.ic`. Statický
markup v blade nesie SVG priamo (výmena v JS by ukázala stránku najprv bez ikon), JS
používa `iconMarkup()` (string), `iconSvg()` (element) a `iconSwap()` (výmena na mieste).

**`textContent` na `<svg>` nezobrazí NIČ a výnimku nevydá** — preto každé armed-confirm
tlačidlo ide cez `iconSwap()`. Priame priradenie by ho ticho vyprázdnilo. Kto si ikonu
odkladá, nech si odkladá **uzol**, nie meno: `btn.textContent` je po prechode prázdny
reťazec.

**Neznáme meno sa nezamlčí:** `iconMarkup()` ho zapíše do `window.HADES._iconMiss`
a nakreslí `ring`. Merací harness ho tam nájde skôr než používateľ; pri migrácii to
chytilo štyri preklepy. Nová ikona sa pridáva DO SADY — nič sa už neregeneruje.

**Ligatúry vstupovali do DOM SEDMIMI cestami** a preto sa ich počet trikrát menil
(37 → 41 → 61): statický markup, template stringy, ternáre, päť mapovacích stolov,
`el(tag,'ms',meno)`, `.textContent =`, a prvý argument `emptyHtml`/`renderEmpty`.
Statický sken nad `/chat` a `/console` našiel **nula** call-site, kým bežiaca stránka
kreslila **192** a **97** ikon. Keď niečo počítaš grepom nad markupom, over to na
bežiacej stránke.

`font-display: block` pre ikony (nie `swap`): krátky prázdny priestor je lepší než
blik surových ligatúrových názvov, čo je presne tá porucha, ktorú tu riešime.

### CSS

**Značka má vlastný manuál: `docs/BRAND-HADES.md`** — identita, znak, farebná rampa
s nameranými kontrastmi, typografia, hlas, assety. Je to zdroj pravdy; keď sa tu
a tam niečo rozíde, platí manuál.

`public/css/mind.css`, **6849 riadkov** (1. 9. 2026 — číslo rastie, ber ho ako rád
veľkosti, nie ako fakt). Pravidlo: **žiadny raw hex/rgba mimo `:root`**,
všetko cez tokeny. Svetlá paleta je v `:root`, tmavá v `:root[data-theme="dark"]`.
**Tmavá je default** (`initialTheme()` v `theme.js`).

Presvitanie utlčeného grafu pod obsahom je **len na tmavej téme** — na svetlej
ostáva plátno mimo Grafu skryté, pretože pod poloprehľadnými chipmi tam kontrast
textu závisel od obsahu grafu.

**Kánon akcentu: amethyst je interaktívny, zlatá je značková.** Amethyst (`--accent`,
`#6d3fb5` svetlá / `#c4a2f5` tmavá) nesie hover, fokus, aktívny stav a primárne akcie.
Teal tu bol do 19. 8. 2026; prefarbenie bola **výmena hodnôt, nie refaktor** (akcent
bol plne tokenizovaný) a nezhoršilo ani jeden meraný kontrastný pár. Vedľajší efekt:
teal starého akcentu bol prakticky farba oblasti *Vývoj & kód* (`#007b76`), takže
akcent a jedna oblasť mali
dovtedy tú istú farbu. Zlatá (`--gold`) je vyhradená značke
a jadru vedomia — jadro je na plátne jediný sýty plný prvok a je zlaté. Keby zlatá
nesla aj interaktívny stav, ten jeden vyhradený význam by sa rozdrobil. Menované
výnimky (a nič nad ne nepridávaj): `#brand-core` je síce `<button>`, ale zlatá tam
nesie identitu jadra (prstenec okolo neho je amethyst, tak ako v znaku) a všetky
jeho stavy sú amethystové; `.avatar` a `.empty-loading .load-mark`
sú značkový znak. `--cert-hypoteza` je na tmavej téme tá istá hodnota ako
`--brand-gold` — je to tretia, semantická rola a presun na `--warn` (70° vs 79°)
by kolíziu len zhoršil, preto zostáva.

Dvojité deklarácie (~46 dvojíc „selektor + vlastnosť" s inou hodnotou) boli
**zaplatené v `c1a3a96`** a dnes je ich **0**. Čo v súbore ostáva, je zámerné:
4 dvojice `--card-pad` (základ + varianta, 17 riadkov od seba) a 15 legitímnych
prepisov (media queries, rovnako pomenované kroky rôznych `@keyframes`). Detektor
je `w4dup.js` v scratchpade. **Ten detektor mal chybu** — delil selektorové zoznamy
na každej čiarke, teda aj vnútri `:is(button, a)`, a hlásil 12 neexistujúcich dvojíc.
Opravená verzia delí len na nulovej hĺbke zanorenia; **kalibruj ju z oboch strán**
(na verzii pred zmenou musí hlásiť staré čísla), inak „opravíš" funkčné CSS.
Stav 24. 8. 2026: `mind.css` **A=0 B=1**, `console.css` **A=0**.

**`console.css` drží A=0 vďaka `:is(a, button):where(...)` na špecificite 0-0-1.**
`:where()` nepridáva špecificitu, takže reset prebije bare `button` z `mind.css`
(rovnaká špecificita, `console.css` sa načítava druhý) a zároveň mu ustúpi každé
pravidlo s triedou alebo id — **bez ohľadu na poradie v zdroji**. Nový selektor
s rovnakou špecificitou v tej skupine vráti závislosť na poradí; nerob to.

**Jeden fokusový prsteň, jedna klávesa, jeden papier karty** (druhé kolo, 24. 8. 2026):

- Prsteň nesie **jedno globálne `:focus-visible`** (0-1-0) v RESET & BASE. Per-komponentné
  pravidlo pridávaj len ak nesie **niečo iné** než prsteň. `border-radius` v globálnom
  pravidle zámerne **nie je** — prebilo by `button { border-radius: var(--r-md) }` (0-0-1)
  a každé tlačidlo by pri fokuse skočilo z 10 px na 8 px. Výnimka
  `input[type="range"]:focus-visible { box-shadow: none }` je zámerná (prsteň nesie thumb).
- `kbd` je **jedna bare kresba** v `mind.css` (`mind.css` sa načítava prvý aj na
  `/console`); komponenty dopisujú len rozdiel. Radius vždy cez `--r-sm`.
- Povrch karty je token **`--card-bg`** (default `var(--panel)`), druhý papier je
  deklarovaná rola **`.card--nested`** (`--surface-2`). Základ je `--panel` z **funkčného**
  dôvodu: je to jediný povrch nesúci sklo (`--panel-alpha` píše slider inline na `:root`),
  takže karta na `--surface-2` ticho vypadne zo slidera priehľadnosti. A pozor —
  `--surface-2` je na **tmavej** téme *svetlejšia* než `--panel`, takže „sunken" je preň
  nesprávne slovo.
- Prázdny stav má jeden slovník: **`.empty`** je základ, **`.empty--hero`** modifikátor.
  `.card-empty` zostáva zámerne (iná rola, vlastný komentár) — nezlievaj ho.
- Tokeny sú pomenované **podľa role, nie podľa čísla**: `--disabled-opacity`,
  `--accent-disabled-fill` / `-focus-wash` / `-hover-wash`. `.perm-card.denied` má `.72`
  zámerne — *zamietnuté* nie je *vypnuté*.
- Prefix **`.tc-` v `console.css` už neexistuje** — časti karty nástroja sú `.tool-*`
  (podľa `.tool-call`). `mind.css` si drží `.tc-val`/`.tc-label` (tabulárne číslo karty
  Dnes) a dok nad grafom vlastné `.charon-tc-*`. Tri prefixy, tri významy, žiadna kolízia.
- **Rez, ktorý sa nepriznáva, je lož.** `.lib-skill-meta` je `nowrap` + `overflow: hidden`,
  takže čipy sa režú — `data-more` preto sčítava klientsky rez **aj** serverový
  `tags_more`. Keby sčítal len jedno, karta by hlásila menšie číslo než realita.
- **Kresba bloku kódu a kopírovania je JEDNA a je v `mind.css`** (od 26. 8. 2026) —
  je to jediný stylesheet, ktorý sa načítava na `/`, `/console` aj `/chat`. Markup
  skladá jeden `renderMarkdown()` a mechaniku jeden `public/js/shared/copy.js`.
  Per-plochu zostáva **len** rodič riadka mena pri `margin-left: auto`
  (`.msg .who` na konzole, `.cm-who` na chate — a ten je dnes inertný, `.cm-who`
  nie je flexový; je to zapísané pri pravidle).
- **Keď chceš pravidlo ÚMYSELNE oslabiť, použi `:where()`, nie `:is()`.** `:is()`
  berie **najsilnejší** zo svojich argumentov. Zaplatené 26. 8. 2026: prepis
  `.bubble.md code` na `:is(.bubble.md, .msg.system) code` mal držať (0,1,1), ale
  `.bubble.md` sú **dve triedy**, takže to je (0,2,1) — a reset bloku kódu
  `pre.code code` (0,1,2) tým neprebil. Zmerané: `code` vnútri `pre.code` si nechal
  `padding: 1px 5px` a podfarbenie. Správne je `:where(...)` = (0,0,1). Pozor na
  asymetriu: `:is(.cm-md, .md) code` v `chat.css` (0,1,1) **je** správne, pretože
  `.cm-md` je jedna trieda — ten istý zápis je teda na jednej ploche dobrý a na
  druhej nie. **Spočítaj triedy v najsilnejšom argumente a zmeraj computed style.**

**Hustota, stavy a pohyb (vlna 1 redizajnu, 27. 8. 2026).** Päť vecí, ktoré vyzerajú
ako neporiadok a nie sú ním:

- **`--fs-data` / `--fs-data-chip` / `--fs-chart-axis` NIE SÚ stupne škály**, ale rolové
  tokeny hustoty. Sú zámerne **za** blokom škály, nie vnútri neho — komentár nad škálou
  ju opisuje ako uzavretú a vloženie role medzi `--fs-base` a `--fs-title` by z toho
  komentára urobilo lož. Nezlievaj ich so škálou. Pravidlo, ktoré za nimi stojí:
  **dátový text sa zdvihol na 13 px, chróm (eyebrow, popisky, jednotky) zostal mikro** —
  a kalibrácia zmeny je práve to, že chróm sa nepohol (`.rail-eyebrow` 10 px,
  `.kpi-label` 11 px). Merač, ktorý zdvihne všetko, nemeria nič.
- **Kostra je rodina `.skel*`, nie `.sk-*`** — `.sk-row` už žije v `console.css` a
  `mind.css` sa načítava prvý na všetkých troch plochách, takže rovnaké meno by na
  `/console` prehralo a na `/` vyhralo. **Rozmery drží CSS, nie volajúci**: rozmer
  napísaný v JS je pre CSSOM neviditeľný a žiadna asercia ho nenájde — presne tak vznikol
  inline `font-size: 10px` na osi grafu. Kontejner `.skel-list` **musí** nesť
  `font-size: var(--fs-data)`, pretože `.skel-line` je vysoký `1em`; bez toho zdedí
  14 px z `body` a skeleton zachová práve ten skok, ktorý má odstrániť.
- **Kresba sa odkladá o 300 ms** (`deferSkeleton()` v `util.js`). Asercia, ktorá meria
  „o rámec neskôr", preto hlási regresiu, ktorá nie je — čakaj ≥ 400 ms. A **kalibruj
  opačným smerom**: pri rýchlej odpovedi sa kostra objaviť **nesmie** (zmerané: 0 ms →
  obsah za 1 ms bez kostry, 120 ms → obsah za 132 ms bez kostry). Bez tej druhej strany
  sa nedá odlíšiť „odloženie funguje" od „kostra sa nekreslí nikdy".
- **Vzor tichej verzie pre `prefers-reduced-motion`:** plošná podlaha
  `*, *::before, *::after { … !important }` **zostáva** a prebíja sa **triedou
  + `!important` v tom istom bloku`** — `!important` deklarácie súťažia špecificitou,
  takže `.skel::after` (0-1-0) vyhrá nad `*` (0-0-0). Tichá verzia je **zmysluplný
  okamžitý ekvivalent**, nie „vypnuté": u kostry je to pokojná zdvihnutá plocha
  (`display: none` na sweep), nie `animation: none`, ktoré by nechalo gradient zamrznutý
  v polovici. Každé „upratanie" tej podlahy je horšie než nechať ju tak.
- **Sklo je len na tmavej a už bez nepomenovanej výnimky:** štvrtý prepínateľný token
  `--scrim-blur` (tmavá `blur(4px)`, svetlá `none`) nesie tri scrimy pod modálmi, ktoré
  dovtedy čítali blur primitívu priamo a rozmazávali na oboch témach. Nový
  `backdrop-filter` ber vždy z prepínateľného tokenu.

**Serif má odteraz DVE role**, nie jednu: `.hero-val` a `.screen-head h1` (váha 600,
`letter-spacing: 0`). Predchádzajúci sprint mal komentáre, prečo serif z titulkov
odišiel — sú prepísané a hovoria, že ide o **zmenu rozhodnutia**, nie o opomenutie.
Nevracaj titulky na Geist bez toho, aby si najprv prepísal manuál. V **chybe** je serif
zakázaný (manuál §8): je to text, ktorý má človek použiť na opravu.

**Sada má 60 symbolov** (viď vyššie). Staršie záznamy o 32, 37 a 41 ikonách hovoria
o subsete, ktorý už neexistuje.

**Chyba má jeden komponent a vlastný predmet.** `.empty--error` + `.empty .title`
+ jedna `.empty-act` na desiatich call-site šiestich obrazoviek („Denník sa nepodarilo
načítať", nie „Nastala chyba"). `.empty--filter` je **zámerne bez vlastnej kresby** —
manuál §8 zakazuje prázdnemu stavu vymýšľať si novú farbu, takže sa líši textom a svojou
jednou akciou. Asercia, ktorá hľadá pravidlo `.empty--filter`, nič nenájde a **je to
správne**. Čo sa zámerne nezlialo: `.run-error` (obsah záznamu behu, nie stav plochy),
`.toast.error` (prechodné oznámenie akcie) a `.card-empty` (iná rola).
**Kontrola pri `soft` refreshi kostru NEKRESLÍ** — zmazala by presne to, na čo sa človek
pozerá; hlási len `aria-busy`.

**`transition` nad hodnotou z custom property ZMRAZÍ tú vlastnosť.** Zaplatené
28. 8. 2026 hodinou hľadania: `#rail { width: var(--rail-w); transition: width … }`
spôsobí, že sa šírka po prvom vykreslení **už nikdy neprepočíta** — token sa na `:root`
zmení (zmerané: 80 ↔ 208 px) a odvodené tokeny sa prepočítajú, ale prvok zostane na
hodnote z načítania. **`@property` so `syntax: '<length>'` to NEOPRAVÍ** (skúšané);
opraví to jedine odstránenie prechodu. Držalo to naraz `#rail { width }`,
`#app-header { left }` aj `#screens { left }`, takže zbalenie railu uvoľnilo 128 px,
ktoré si obsah nevzal. Keď chceš pohyb aj token, museli by hodnoty stáť priamo
v stavových pravidlách — ale to je druhá kópia hodnoty, ktorú číta `layout.js`.

**`resize_window` v Browser pane neposiela do stránky `resize`.** Zmení
`window.innerWidth` aj `matchMedia().matches`, ale kód visiaci na tej udalosti sa
nespustí, takže funkčná responzivita vyzerá pokazene. Over ju ručne odoslaným
`window.dispatchEvent(new Event('resize'))`.

**Keď meníš CSS, over, že zmena je inertná, výmenou stylesheetu nad TÝM ISTÝM DOM**
(`w8/cssswap.js`) — nie dvoma načítaniami stránky, Hades je živý a medzi nimi sa
naučí uzly. Ten harness sa **musí kalibrovať A/B/A/B s dosadnutím** (dva rámce
+ 250 ms po výmene) a počítať len to, čo je stabilné v oboch: jeho prvá verzia
hlásila 96 110 „stabilných" rozdielov, ktoré boli len rozbehnuté prechody.

## Charón (`/chat`, `/console` a dok nad grafom)

**Tri vstupy, JEDEN beh** (od 25. 8. 2026). Od `/chat` a `/chat/<uuid>` je Charón
plnohodnotná appka: layout na celú obrazovku (vlákna vľavo, konverzácia, panel
artefaktu vpravo), projekty, vetvenie konverzácie, hľadanie v histórii, export do
markdownu, prílohy, diktovanie a strom podagentov. `/console` zostáva **technická
konzola** a jej názvoslovie (`console_*`, `Console*`) sa nepremenúva; dok nad grafom
je rýchly prístup. Všetky tri idú cez `public/js/shared/runclient.js` na
`/api/console/run` a `/api/console/decide` — **tretia cesta k modelu nesmie vzniknúť**,
pretože by to bola cesta okolo dvojfázovej brány.

**Frontend `/chat` je `public/js/chat/*` a `main.js` je jeho JEDINÝ vstup.**
`chat.blade.php` má jediný `<script type="module">`, takže **modul bez importu
z `main.js` sa nikdy nenačíta** — presne tak sa 25. 8. 2026 stalo, že sedem hotových
modulov vlny bolo mŕtvym kódom a PHP testy o tom nepovedali nič. Keď pridáš modul,
pridaj mu import **a** `wire*()`/`boot*()` do `boot()`, a over to **meraním**
(`read_network_requests` na `/js/chat/<modul>.js` musí dať 200, a `wire*` musí naozaj
niečo pripojiť do DOM).

**`chat.css` dostal kresbu komponentov 31. 8. 2026 (97 → 309 pravidiel)** a niesla
si vlastnú pascu: `chat/main.js` zatvára oba bočné panely ATRIBÚTOM `hidden`, nie
triedou, a UA pravidlo `[hidden] { display: none }` má špecificitu 0-1-0 — prehrá
s hocijakým autorským `display: flex/grid` na tom istom selektore bez ohľadu na
poradie v zdroji. Preto **každé pravidlo, ktoré nastavuje `display` na prvku
skrývanom `hidden`, musí ísť cez `:not([hidden])`** (`#chat-threads`,
`#chat-artifact`, `.ct-acts`, `.ch-right :is(a, button)` — komentáre pri každom
to opakujú). Bez toho zostal zatvorený panel na mobile na obrazovke a hlavička
kreslila nad jeho tlačidlami.

**Mobilný rail na `/console` má jediného zapisovateľa** (od 31. 8. 2026):
`public/js/console/rail.js` (`setRail`, `applyRailState`, `trapTab`, `wireRail`,
`syncRail`). Zatvorený prekryv (pod 900 px) nesie **`inert`, nie `hidden`** ako
`/chat` — panel je v tomto režime `position: fixed` s prechodom `transform`
a `[hidden]{display:none}` by ho zabil; nad 900 px, keď je rail trvalý stĺpec,
`applyRailState()` `role`/`aria-modal`/`inert` sám odoberie. Režim prekryvu sa
**nečíta z `matchMedia`** — hranica 900 px je literál v troch stylesheetoch a JS
by bol štvrtý zdroj pravdy — ale z toho, čo hovorí CSS (`position: fixed`).
**Opravený bug, poučný pre budúce prekryvy** (`task_53a6b179`, opravené 1. 9. 2026):
na 375 px s otvoreným panelom hit-testoval stred `#rail-toggle` na `#back-to-graph`
vnútri panela (`#console-header` je `position: static`, `#thread-rail` má
`z-index: 20`) — ťuknutie na hamburger odnavigovalo na `/` namiesto zatvorenia
panela. Oprava NIE JE presun prepínača do panela (ten nesie `inert` v zatvorenom
stave, takže by bol pri otváraní sám fokusovo mŕtvy) ani zdvihnutie celej hlavičky
(103 px pri 375 px, prekryla by `.rail-top` aj `.rail-find`), ale **z-poradie**:
`#rail-toggle` dostal `position: relative; z-index: 30` (nad panel `20`, scrim
`10`) a `.rail-top` v prekryve `padding-left: 56px`, aby znak neprekryl posunutý
hamburger. V ceste od `#rail-toggle` po `html` nevytvára stacking context žiadny
predok, takže poradie súťaží v koreňovom kontexte a `z-index: 30` naozaj vyhrá.

**Podagenti: `spawn_agent` a parkovanie prenášané nahor.** Profil `orchestrator`
(`mind_recall` + `spawn_agent`, 626 tok proti stropu 680) je jediný, ktorý ten tool
má — `TOOLS` je 14, ale **`full` zostáva presne dvanástka**. Dieťa môže zaparkovať na
človeku, ale rodič nesmie držať jedného z ôsmich PHP workerov, takže: dieťa vydá
vnorený `permission`, tool vydá top-level `agent_wait` a hodí `AgentParked`, `drain()`
vráti `spawn_agent` call rodiča do `pending` a ťah skončí **BEZ `end`**. Oba behy sú
`waiting` a jediná cesta ďalej je `/decide` na vlákno **podagenta**. Tool je
**idempotentný na svoj `ConsoleToolCall`**, takže `/decide allow` na rodičov vlastný
call znova zaparkuje — **brána drží z konštrukcie, nie z disciplíny volajúcich**.

Tri veci, ktoré sa okolo toho dajú ľahko pokaziť:
- `ToolRegistry::call()` má plošný `catch (Throwable)`. Bez `catch (AgentParked) { throw; }`
  ako **prvého** by sa parkovanie preložilo na odmietnutý tool, ťah by skončil `end`
  a dieťa by čakalo navždy.
- `AgentRunner` má `catch (AgentParked)` na **dvoch** miestach (`drain()` aj `resume()`).
  Bez toho v `resume()` zostane po `/decide allow` call v stave `running` a **vlákno
  rodiča prijme ďalšiu správu** — fail-open presne v mieste brány.
- `allow_always` sa vo vlákne podagenta **ignoruje** (a `PATCH` na vlákno ho zahodí):
  `Subagent::start()` zámerne nededí `auto_accept`, pretože zadanie podagenta nepísal
  človek, ale model.

**Vetvenie:** vetvy pripájajú na konec, nikdy nevkladajú do stredu, takže rozsahy
`from_message_id`–`to_message_id` v `runs` prežijú. Správy nesú `branch_id` a
`AgentRunner::history()` číta okno cez **`branchMessages()`**, nie cez vlákno — inak by
model po odbočení dostal práve tie `id`, ktoré aktívnej vetve nepatria. Exkluzivita behu
je na úrovni **vlákna, nie vetvy**.

**Diagramy sa nekreslia a je to zmerané rozhodnutie**, nie opomenutie: z 36 reálnych
odpovedí modelu malo oplotený blok **0**, diagramov 0, tabuliek 0 — a mermaid stojí
195 kB gzip pred prvým diagramom. ` ```mermaid ` je preto blok kódu; **spúšťač na
prehodnotenie je 5 % odpovedí**. Zvýrazňovanie nesie vlastný ~1,8 kB zvýrazňovač
(highlight.js je CJS a bez bundlera sa self-hostovať nedá). Zvýrazňovač beží **nad už
escapovaným textom** — escapovať po ňom by zhodilo obranu `markdown.js`. Náhľad HTML
je **`<iframe sandbox>`**, nikdy `innerHTML`: je to výstup modelu.

---

Historicky (24. 8. 2026): Charón žil na **dvoch plochách so zdieľaným behom**: plná
konzola `/console` a **dok nad plátnom grafu** (`public/js/mind/charon.js`, `public/css/charon.css`,
markup v `mind.blade.php`, id `#charon-*`). Obe idú cez **jeden modul streamu**
`public/js/shared/*` — `ndjson.js` (parser rámcov, buffer cez chunky), `runclient.js`
(`createRunClient`: fetch + ReadableStream + CSRF, **nikdy EventSource** — nevie token),
`gate.js` (slovník dvojfázovej brány), `runstate.js` a `markdown.js` (**presunuté** sem
z `public/js/console/`). Druhá kópia streamu už neexistuje; konzola je re-pointnutá
s nulovým funkčným diffom. Dok napojený cez `startRun(body)`, `body.profile='graph'`,
`body.context_node_ids` = vybrané uzly.

**Mŕtvy chat nad grafom je preč** (A9): `chat.js`, `#prompt`/`#chat-log`/`#chat-context`
grafu aj prepínač „Chat s Hadesom" sú zmazané; `ChatController` ostal len ako referenčná
SDK implementácia, route `POST /chat` je odpojená. A8 zlúčené: `S.pack` (Balík) plní
kontext doku (`packBtn` už nekopíruje do schránky).

**Profily nástrojov** (`ToolRegistry::PROFILES`, konštanta v kóde, nie config): `memory`
/ `files` / `graph` / `full`. Beh dostane len tooly profilu; **neznámy profil sa ODMIETNE**
(nie fallback na full) — členstvo rozhoduje, ktoré *zápisové* tooly v behu vôbec existujú,
takže je to bezpečnostne tvarovaný zoznam. Dôvod nie je len strop `num_ctx` (12 definícií
≈ 2,6k tok, 13. nezmestí), ale aj že slabý model volí z piatich toolov lepšie než
z dvanástich. `ConsoleToolsTest` pinuje **strop tokenov na profil** (memory 1600 / files
1400 / graph 1350 / full 2600) — test padne, keď definícia narastie (overené). `graph_focus`
je len v profile `graph`, **nie vo `full`** — testy naň musia použiť helper `canon()`
(13 toolov), nie `registry()` (aktívny profil). `/decide` profil **neprijíma** (`prohibited`);
profil obnovy sa číta z `console_threads.tool_profile`, nie z klienta.

**`graph_focus`** (`Tools/GraphFocusTool.php`) je **čítací** navigačný tool (neparkuje).
Vracia presne argument `go({level,area,dept,node})` — `go()` je **filter** (nemení pozície,
nevymieňa scénu), tak dok len zavolá `go(res.nav)` a nič neprekladá. Neznámu oblasť
**odmietne**, nehádaní.

**`ContextBlock`** (`app/Services/Console/ContextBlock.php`) skladá kontext vybraných uzlov
**na serveri, iba z id** — nikdy z textu prehliadača (ten istý dôvod ako história z DB:
klient by inak podstrčil uzol, ktorý v pamäti nie je, a model má zápisové tooly). Stropy
v `config('hades.console.context')`: 8 uzlov / 2400 znakov / 300 na popis, **žiadne telo
`.md`**, priznané skrátenie „(kontext skrátený: N z M uzlov)". `RunController::run()` pošle
**model = kontext + otázka**, ale **`runs.prompt` = len otázka** (aby „Spustiť znovu"
vrátilo zadanie, nie aktuálny výber). Validácia `context_node_ids` číta strop z toho istého
configu ako `ContextBlock`. Bez validačného pravidla Laravel pole ticho zahodí — to bola
chyba, ktorú review vlny B chytil.

`runs.tool_profile` a `console_threads.tool_profile` (nullable, migrácia 21. 8.): `null`
= beh z čias pred profilmi. Obrazovka Runy ho ukáže v `.run-profile`.

**Desktop appka** je Electron shell v `electron/` (`main.js`, `preload.js`, `chrome/`,
`states/`, `tray.js`, `electron-builder.yml`). Token sa vkladá cez
`session.webRequest.onBeforeSendHeaders`, takže **žiadny lokálny proxy nevzniká** a token
sa nedostane do rendereru — nevracaj proxy, viď komentár v `main.js`. `bin/hades.cmd`
ostáva ako cesta bez inštalácie. Boot inštalátora neoverený v headless prostredí.

---

Historicky: samostatné rozhranie (nie obrazovka v raile grafu): agentová smyčka
nad vlastnou pamäťou a nad súbormi projektu. Vlákna majú vlastnú URL
(`/console/<uuid>`). Vzniklo 19. 8. 2026, meno **Charón** dostalo 20. 8. 2026 —
prievozník je ten, kto hovorí, Hades je vedomie, za ktoré hovorí. **Charón je
meno pre človeka, nie identifikátor**: route `/console`, kľúč `hades.console.*`,
tabuľky `console_*`, triedy `Console*` aj adresáre `app/Services/Console` a
`public/js/console` zostávajú technické — premenovať ich by bola migrácia bez
jediného čitateľa. **URL sa nemenila**, aby odkazy na existujúce vlákna žili.

**Beh je dvojfázový a to je jeho podstata.** Čítacie tooly bežia hneď; každý
zápisový tool zaparkuje ako `pending` s náhľadom (unified diff, resp. before/after)
a čaká na kliknutie človeka. Turn tým **skončí bez `end` rámca** a beh sa obnoví až
z `/api/console/decide`. Nie je to slušnosť voči používateľovi, ale nutnosť:
blokujúce čakanie by držalo jedného z ôsmich PHP workerov a lokálny model si
zaparkovaný zápis **naozaj skúsil pretlačiť** — po zamietnutí `mind_learn` ho zavolal
znova s iným labelom, hoci to systémový prompt zakazuje. Brána teda nesie váhu, nie
je to dvojitá poistka.

**História vlákna je len v DB** (`console_messages`). Skladá sa odtiaľ, nikdy z toho,
čo poslal prehliadač — inak by si klient vedel podstrčiť tool výsledok, ktorý nikdy
nenastal. Test to overuje podstrčenou históriou.

**Protokol je NDJSON, nie SSE**, a to zámerne: `EventSource` nevie poslať CSRF
hlavičku, takže SSE endpoint by musel vypadnúť z guardovaného okruhu (§8.11
`docs/BEZPECNOST.md`). `fetch` + `ReadableStream` zvládne CSRF aj `abort`. Rámce
nesie kľúč `t`: `start`, `delta`, `step`, `tool`, `tool_result`, `permission`, `end`,
`error`. **JSON objekt sa môže rozdeliť medzi dva chunky** — parser preto drží buffer.

**`think` je vypnuté** (`hades.console.think`). Qwen3 je hybridný a reasoning posiela
v `message.thinking`, ktoré parser zahodí: namerané 231 z 309 tokenov do koša a 25 s
ticha pred prvým znakom, kým ten istý správny tool call s `think=false` stál
34 tokenov. Pri ~8 tok/s na CPU to nie je optimalizácia, ale podmienka použiteľnosti.

**Model beží lokálne** (Ollama). Na stroji nie je použiteľná GPU — AMD Radeon iGPU,
ktorú Docker na Windows do kontejnera nepustí — takže inferencia je CPU-only a
default je `qwen3:8b` (~8–9 tok/s). `qwen3-coder:30b` je stiahnutý, ale **nedal prvý
token ani za 300 s**: 18,6 GB modelu sa nevojde do Docker VM (~22,9 GiB, WSL2 default
= polovica hosta) a swapuje. Ollama server na porte 11434 **patrí inému projektu**
(`auraai-ollama-1`); Hadesova vlastná služba `ollama` v compose je profilová
(`--profile ollama`, port 11435), aby sa nebili o tú istú RAM.

**Cesty sa odmietajú, nesanitizujú** (`Tools/PathGuard`). Sanitizovaná cesta ticho
zapíše niekam inam, čo je horšie než chyba. Mimo `hades.console.files_root`, `.env`,
`.git`, `vendor`, `node_modules` a čokoľvek so bodkou na začiatku názvu je zakázané
na čítanie aj zápis, symlinky sa rozbaľujú a kontroluje sa cieľ. **Bash/shell tool
zámerne neexistuje** — appka je verejne tunelovaná cez ngrok.

**Kontextový strop je reálne blízko.** Definície 12 nástrojov sú ~2,6k tokenov
v každom requeste, obyčajný ťah ~3k, ťah ktorý prečíta `CLAUDE.md` ~15k pri
`num_ctx` 16384. Trinásty nástroj alebo druhé čítanie celého súboru narazí.

### Log behov (`runs`, obrazovka Runy)

**Beh je agregát nad existujúcimi tabuľkami, nie tretia kópia dát.** `runs` drží
stav a cenu ťahu, ale členstvo správ nesie **rozsah id**
(`from_message_id` – `to_message_id`), nie stĺpec `run_id`. Vlákno beží jeden ťah
naraz (`RunController::run` odmietne správu, kým čaká nedorozhodnutý zápis), takže
rozsah je presný, nie približný.

**`RunRecorder` visí na `$emit`, nie v `AgentRunner`i** — vznikol tak, aby sa
nedotkol súboru, ktorý paralelne prepisovala iná session, a ukázalo sa to ako
lepší návrh: recorder je testovateľný bez modelu, stačí mu poslať rámce.
`AgentRunner.php` je preto v celom diffe logu behov nezmenený a **má taký zostať**.

**Tokeny sa NEBERÚ z rámca `end`.** Ťah, ktorý zaparkuje na potvrdení zápisu,
`end` **nikdy nepošle**, takže cena jeho prvého segmentu by z logu vypadla.
Sčítavajú sa z `console_messages`, kde `duration_ms` je **generovací** čas
(`AgentRunner` doňho ukládá `evalDurationMs`). Dôsledok, ktorý treba poznať:
`runs.duration_ms` je **wall clock** a obsahuje minúty, kým sa človek rozhodoval
o zápise, kým `tokens_per_second` je z generovacieho času. Sú to dva rôzne údaje
a **ani jeden nie je chyba** — preto sú v UI vedľa seba a pomenované inak.

Beh, ktorý zostal visieť v `running` po smrti procesu (reštart kontejnera), zametá
`mind:reap-runs` každých 10 minút, strop 30 minút. Zaparkované (`waiting`) sa
nezametajú nikdy — čakajú na človeka a môžu tak čakať dni. `finally` v
`RunController` pokryje výnimku aj odchod klienta; smrť procesu nie.

**„Spustiť znovu" nič nespúšťa.** Vráti zadanie a nový ťah ide bežnou cestou cez
`/console/run`. Druhá cesta k modelu, ktorá obchádza dvojfázovú bránu, je presne
to, čo tu nesmie vzniknúť.

### Dvojitá plocha: UI = MCP

**Každá z 8 obrazoviek má jeden serializér v `app/Serializers/Screen/`.** Endpoint
vráti `data()`, MCP tool vráti `dropEmpty(project(data(), fieldsForAi()))`. Rozdiel
medzi plochou človeka a plochou AI je **deklarovaný zoznam kľúčov, nie druhá
implementácia**. Nová obrazovka = serializér + **jeden riadok** do
`ScreenParityTest::registry()`; test si zvyšok vynúti sám.

**Hygiena** (24. 8. 2026) je deviaty serializér a vzor, ako to spraviť správne:
`app/Serializers/Screen/HygienaScreen.php` **volá existujúci klasifikátor**
(`mind:hygiene`, ktorý stojí na `MindService::noiseOf()`) namiesto toho, aby ho
prepísal, a `McpController::toolHygiene()` sa tým scvrkol na tri riadky. Je to
**sekcia na obrazovke Kontrola, nie nová obrazovka** — kontrakt počet obrazoviek
zmrazil. Do 24. 8. 2026 videla odpad v pamäti **len AI** (`mind_hygiene`), človek
nie; sekcia preto ponúka **opravu (premenovanie), nie tichý výmaz** — recall odpad
označí a zaradí za čisté uzly, nemaže ho.

Prečo to existuje: audit 19. 8. 2026 našiel šesť miest, kde sa plochy už rozišli,
a vždy z tej istej príčiny — dve implementácie jedného obsahu. Smernica skladala
markdown na serveri aj v prehliadači a texty sa líšili na **20 zo 48 riadkov**
(PHP kráti na `...`, JS krátil na `…`). Denník počítal čipy projektov z 50
načítaných záznamov, takže čip sľuboval číslo, ktoré zoznam nedal. Kontrola mala
fallback `total ?? items.length`, čo bola tichá lož pri fronte nad 100.

Pravidlo, ktoré z toho platí: **dátové veci na server, slová do prehliadača.**
Počty, skupiny, filtre, kľúč dňa a krátenie textu sú dáta. Popisok „dnes/včera",
formát trvania, `timeAgo` a šírka baru v pixeloch sú slová a vizuál — tie do
serializéra nepatria.

`ScreenParityTest` má **štvrtú vrstvu, ktorá dokazuje vlastnú citlivosť** (úmyselný
rozchod musí padnúť, kozmetický UI kľúč nie). Nezahoď ju — bez nej môže byť test
zelený a nemerať nič, čo je pasca, na ktorú tento projekt už raz naletel.

Obrazovka **Smernica** má v registri `requires_mariadb`, pretože `searchNodes`
používa `COLLATE utf8mb4_unicode_ci`. Na sqlite sa preskočí **len ona**, nie celý
test; overuj ju cez `phpunit.mariadb.xml` (tam je 344 asercií proti 322).

**`mind_recall` má stále DVA tvary** (`McpController.php` × `MindRecallTool.php`)
a už sa rozišli — konzola má `id`, nemá `strength/department/verified/origin/semantic`.
Nezjednotilo sa to zámerne (kontrolér mala rozpracovaný iná session). Detail je
v `docs/UX-AUDIT-2026-08-19.md`.

**Nové vystavenie:** `mind_runs` a `mind_run` sprístupňujú cez MCP texty promptov
a výsledky toolov, kam MCP predtým nevidelo. Dáta nové nie sú, ale ak sa do promptu
vloží tajomstvo, vedie k nemu odteraz aj táto cesta. Redakcia cez `SecretScanner`
sa nezaviedla — na ploche AI by rozbila paritu.

### Tabuľky záznamov (od 28. 8. 2026)

**Appka mala do tejto vlny nula tabuliek** — jediný `<table>` v repe bola textová
alternatíva heatmapy. Runy, Rozhodnutia, **Knižnica, Kontrola a Smernica** (od
31. 8. 2026) sú `<table class="rec-table">` z **`public/js/mind/table.js`**,
Denník zostáva kartový zámerne (naratívna os, nie stĺpce) — **Kontrola ako
tabuľka je vedomé riziko** (fronta na rozhodovanie číta lepšie po jednej veci
naraz než po stĺpcoch; návrat je jeden commit, kontrakt Sprint 2 §3).

- `renderTable(container, columns, opts)` — stĺpec je `{key, label, kind?, width?,
  cell?, sortValue?, titleFrom?}`. `kind: 'num'` zarovná vpravo a nasadí mono +
  tabulárne číslice.
- **`sortValue` je povinné, keď sa zobrazená hodnota nedá porovnať.** Zaplatené:
  surové ISO `started_at` nesie offset `+02:00`, takže jeho abecedné poradie NIE JE
  chronologické; „53 s" je ako text pred „6 min"; text rozhodnutia nesie
  `backticky` (4 zo 41 živých riadkov), takže by sa zoradil inde, než kam ho oko
  čaká. Radenie je stabilné a nečíselné ide cez `localeCompare('sk')` — bez toho
  „Č" skončí za „Z" presne na slovenských popiskoch.
- **`titleFrom(row)` priznáva rez.** Cely sú `overflow: hidden` s výpustkou, takže
  plný text musí byť dosiahnuteľný. Dopisovať `title` ťahom po hotovej kresbe je
  druhý prechod nad tým istým DOM a pri novom stĺpci sa zabudne.
- **`table-layout: fixed` je podmienka, nie optimalizácia:** bez neho prehliadač
  prepočíta šírky z obsahu a „Ďalších 50" prehodí stĺpce pod rukou.
- **Šírky stĺpcov: `rem` tam, kde obsah nerastie, percento tam, kde rastie.**
  `min(7.5rem, 22%)` prehliadač v `table-layout: fixed` ZAHODÍ (zmerané: všetky
  stĺpce dostali rovnakých 125,5 px).
- Stĺpce sa adresujú triedou **`col-<key>`**, nie `:nth-child` — poradie sa medzi
  obrazovkami líši a index je väzba, ktorá sa ticho rozíde. Pod 768 px sa tým
  skrývajú `model`, `tool_profile`, `tokens_out`, `origin`: Runy mali 7 stĺpcov
  v 311 px, teda 44 px na stĺpec (zmerané), bez pretečenia — teda nie „rozpadnuté",
  ale ani použiteľné.
- **`moreRow()` nekreslí nič, keď celkový počet nie je známy.** `/api/runs` posiela
  `counts` nad celou tabuľkou BEZ filtrov, takže pri filtri podľa modelu by
  „N z M" bola lož. Priznanie počtu je vtedy lepšie vynechať.
- **Uložené filtre žijú v `localStorage`** (`hades.filters.<obrazovka>`), nie v DB:
  filter je pohľad na dáta, nie dáta. Meno si filter skladá z vlastného obsahu —
  natívny `prompt()` by bol jediné modálne okno v celej appke.

### Detail záznamu — jeden pravý panel

**`public/js/mind/recpanel.js`**, markup `#rec-panel` v `mind.blade.php`, geometriu
dedí z `#node-panel` (spoločné pravidlo v CSS, aby `camInsets()` čítalo `--panel-w`
raz).

- **Adresu nesie kľúč OBRAZOVKY** (`ruo` Runy, `roo` Rozhodnutia, `kno` Knižnica,
  `koo` Kontrola, `smo` Smernica), nie vlastný kľúč panelu. Kľúče v `urlstate.js`
  sú viazané na obrazovku, takže sa pri prepnutí zahodia samy a dva panely sa
  v jednej adrese otvoriť nedajú.
- **`writeUrl()` neznámy kľúč TICHO ZAHODÍ** (`if (!e) continue` v `urlstate.js`).
  Panel sa otvorí a funguje, adresu ale nenesie — a nič nespadne, takže sa to
  nájde len meraním `location.search`. Presne to sa stalo `kno`/`koo`/`smo`
  (tri nezávislé obrazovky postavili panel správne, žiadna nedoplnila slovník)
  a rovnako **`ruk`/`rud`** (radenie tabuľky Runy — server aj UI ho posielali
  a čítali skôr, než pribudli do `DICT`). Všetkých päť je od `2b0bb3e`
  (1. 9. 2026) v `DICT` — `grep -n "kno\|koo\|smo\|ruk\|rud" public/js/mind/urlstate.js`
  ich nájde. Nový panel/filter s vlastným kľúčom: over `location.search` po
  akcii, nie len že sa UI zmenilo — presne táto trieda chyby sa už zopakovala
  päťkrát na piatich rôznych obrazovkách.
- **`onRecPanelClose(ns, fn)` je API, nie pohodlie.** Panel sa zatvára TROMI cestami
  (krížik, Esc, `dropRecPanel()` pri prepnutí obrazovky) a bez ohlásenia obe
  obrazovky sledovali DÔSLEDOK: jedna `MutationObserver`om nad triedou panelu, druhá
  párom listenerov so `setTimeout(0)`. Sledovanie dôsledku funguje, kým nepribudne
  štvrtá cesta k zavretiu.
- **Zvýraznenie otvoreného riadka sa mení NA MIESTE, nie prekreslením tabuľky.**
  `renderTable()` prepíše `innerHTML`, takže odložený `document.activeElement`
  v `recpanel.js` by bol odpojený a Esc by fokus nevrátil nikam.

### Notifikácie — tri prípady, nič medzi nimi

Politika je v `docs/BRAND-HADES.md` §8. Skrátene: **viditeľná zmena plochy hlási
sama** (nekreslí sa nič), **akcia bez viditeľnej zmeny** hlási inline pri pôvode
(`inlineOk()` v `util.js`), **zlyhanie a udalosť mimo obrazovky** je toast.
Menované výnimky: nevratná akcia, hromadná zmena a toast nesúci `nodeId`.

**Zlyhanie MUSÍ mať variant `'error'`** a dá sa to zmerať:

```
grep -rn "showToast(" public/js/mind/ | grep -v toasts.js \
  | grep -iE "nepodaril|zlyhal|nenašl|vypršal|zamknut" | grep -v "'error'"
```

Stav 28. 8. 2026: **0 zásahov** (43 error, 6 warn, 3 success, 17 neutrálnych,
5 inline — 69 toastov proti pôvodným 85). Vzor musí byť **koreň slova**: prvá
verzia hľadala „nepodarilo" a minula ženské „nepodarila".

### Grafy — jeden jazyk, bez závislostí

`public/js/charts.js` zostáva **bez závislostí**, hoci d3 je na `/` načítané: jadro
d3 nemá sankey (to je samostatný balík), zvyšok sú škály a cesty, ktoré si súbor
skládá sám, a bez závislosti sa dá načítať aj na `/console` a `/chat`.

Spoločné helpery, ktoré nový typ MUSÍ použiť: `gridLines`, `axisRow`, `legendRow`,
`bindTip`, `emptyChart`, `periodSwitch`. Tooltip je **jeden na dokument** (dva naraz
sú vždy chyba) a nesie `pointer-events: none`, inak si berie `mouseleave` prvku pod
sebou. **Dotyk tooltip nedostáva** — hover tam neexistuje a prst zakryje práve to,
na čo sa človek pozerá.

`sparkline`, `scatter` a `flows` sú nové. **`flows` dostalo domov 31. 8. 2026**:
karta „Istota v oblastiach" na Dnes (`renderCertaintyFlows()` v `dnes.js`), oblasť
× istota, 20 stúh / 9 uzlov na živých dátach — pôvodné zadanie „oblasť → projekt"
nahradené za jediný joint, ktorý server naozaj posiela (`per_area`). **`scatter`
zostáva bez volajúceho a je to priznané, nie zamlčané** (`docs/BRAND-HADES.md`):
navrhovaný domov „štatistiky Grafu" v `panels.js` **neexistuje** (ten súbor je
panel uzla, legenda a ručné prepájanie hrán — sekciu štatistík nemá), dať mu tam
domov by bola nová plocha, nie doťah. Jediný nevymyslený kandidát je sila × vek
uzla nad Knižnicou alebo frontou Kontroly — patrí do zadania, nie do upratovania.

### Generátory značky žijú MIMO `public/`

`tools/brand/build-mark.py` (SVG kánon, favicon, `.ico`, `DERIVED.md`, lockupy)
a `tools/brand/build-raster.js` (PNG cez headless Chrome). **Poradie je povinné:**
python najprv, node potom.

Dôvod je bezpečnostný a je zmeraný: všetko pod `public/` servuje web server priamo
a `auth.ui` naň nedosiahne — `/` dáva 401, ale `/brand/build-mark.py` dávalo **200
bez tokenu**, a appka je tunelovaná cez ngrok. `build-raster.js` navyše nesie
lokálnu cestu k Chrome. **Keď pridávaš čokoľvek do `public/`, over to:**

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/<cesta>
```

**Master znaku sa GENERUJE z mini** (`hades-sigil-mini.svg` je jediný ručný zdroj
geometrie). Nosný prstenec r 36 / hrúbka 9 a jadro r 15 sú v oboch výkresoch tie
isté hodnoty; prerušenie a satelit sa pod 64 px zatvárajú, pretože `Mini` parser
prijíma dva kruhy, raster kreslí anulus dvoma diskami a `.load-mark` je CSS
`border` — ani jeden z tých troch výstupov prerušenie vyjadriť nedokáže.

**Favicon má od 1. 9. 2026 jeden zdroj pravdy: `resources/views/partials/brand-icons.blade.php`.**
Predtým `build-mark.py` prepisoval `<link rel="icon">` v troch page blade zvlášť
(`patch_blade_icons()`); dnes je blok (`icon` data-URI, `alternate icon`,
`apple-touch-icon`) v jednom partiali a `mind.blade.php`/`console.blade.php`/
`chat.blade.php` ho vkladajú `@include('partials.brand-icons')`. Generátorová
funkcia je `patch_icon_partial()`; `assert_partial_is_only_truth()` beží pred
zápisom a odmietne stav, keď má niektorý page blade vlastný `<link rel="icon">`
alebo partial chýba v `@include`. **`errors/401.blade.php` je zámerne mimo** —
nesie od kánonu odlišný výkres (zlatý disk + prstenec na 40 % alfy), nie kópiu
tejto pravdy. `public/brand/hades-favicon.svg` je mŕtvy generovaný výstup
(len zdroj kompozície pre editor, nič ho nenačítava) a je **verejný** — over
rovnako ako pri každom novom súbore pod `public/`.

## Docker a opcache

**Zmena v `.php` (vrátane `.blade.php`) sa NEPREJAVÍ bez reštartu** (od
31. 8. 2026). `docker/php/php.ini` má `opcache.validate_timestamps=0`, pretože
pri bind-mounte z Windows hostu spustila každá medzera > 2 s stat storm nad
542 súbormi (zmerané 1,7–6,8 s na `/api/*`, po zmene 0,10–0,15 s medián,
špičky nad 1 s klesli 17/18 → ~5/106). Predtým bola opcache na tomto stroji
**úplne mŕtva** (`php artisan serve` je CLI SAPI, `opcache.enable_cli` je
default 0) — samotné zapnutie s `validate_timestamps=1` nezlepšilo nič, cena
nebola v kompilácii, ale v revalidácii pri každom requeste. Aplikuj zmenu cez:

```
docker compose restart -t 1 app
```

`-t 1` nie je kozmetika — `php artisan serve` neobsluhuje SIGTERM, bez neho
compose čaká default 10 s a SIGKILL-ne (zmerané 11 s). **Blade je najmenej
očividný prípad**: kompiluje sa do `storage/framework/views/<hash>.php`, kde
hash je z **cesty**, nie z obsahu, takže nový obsah na tej istej ceste dostane
starý opcode bez reštartu. JS a CSS sa opcache netýka.

`session.driver=file` bol preverený a **vylúčený** ako príčina zvyšnej
zriedkavej špičky (2,1–2,6 s, ~1 z 30 dopytov): A/B proti `SESSION_DRIVER=redis`
dalo redis stranu horšiu (1/24 vs 0/24 špičiek). Nemeň ho bez nového merania.

## Overenie UI

Docker servuje repo z jeho koreňa, takže **worktree na 8080 neuvidíš**. Postup,
ktorý funguje (prehliadače v tomto prostredí blokujú `file://` aj `localhost`):
headless Chrome cez `puppeteer-core` (`C:\Program Files\Google\Chrome\Application\chrome.exe`,
node na `C:\Program Files\nodejs\node.exe`). Pre worktree si postav malý statický
server, ktorý servuje `public/` a `/api` proxuje na 8080.

**Druhá cesta, overená 20. 8. 2026 a bez závislostí: reverzný proxy + Browser
pane.** Appka je za `auth.ui`, takže sa treba odomknúť — a `?token=...` v URL je
zlé, pretože token skončí v histórii prehliadača, v access logu aj v transkripte
session. Postav preto malý node proxy (~40 riadkov, len `http`), ktorý si token
prečíta z `.env` **sám** a pridá ho ako hlavičku `X-Hades-Ui-Token`; potom otvor
`http://127.0.0.1:<port>` nástrojmi `mcp__Claude_Browser__*`. Daj mu
`/__whoami` a `accept-encoding: identity`. Vzor býva v scratchpade ako
`uiproxy.js`. Pozor: WebSocket sa takto neupgraduje, takže konzolové chyby
`ws://.../app/...` sú limit harnessu, nie chyba appky.

**Screenshot v tomto prostredí NEFUNGUJE** — Browser pane nekompozituje rámce
a `computer{action:"screenshot"}` padne na timeout. Dôkaz o UI je preto **zmeraný
DOM a computed style**, nie obrázok. Nesnaž sa to obchádzať; zmerané číslo je aj
tak silnejší dôkaz než snímka.

**Dve pasce, na ktoré som naletel pri overovaní vlny 1** — obe dali falošný pád, teda
by ma donútili „opravovať" funkčný kód:

1. **Rast výšky kontejnera NIE JE layout shift.** Denník po dosadnutí 50 záznamov narastie
   z 781 na 4571 px, čo je „82,9 % skok" — a je to bezcenné číslo: zoznam rastie **dolu
   pod okraj**. Správna otázka je, či sa pohlo to, čo bolo **vidieť**: `top` titulku
   a zoznamu (zmerané 0 px a 0 px) a či kostra vyplnila záhyb (98,3 %). A `window.innerHeight`
   je v Browser pane **0**, kým nenastavíš viewport cez `resize_window` — bez toho je každé
   „je to vidieť?" nezmysel.
2. **Prehliadač normalizuje `*::before` na `::before`.** Regex, ktorý v `cssText` hľadá
   `*, *::before`, podlahu reduced-motion nenájde a ohlási, že chýba. Bola tam celý čas.

**Merač kontrastu má dve pasce a obe dávajú falošný PÁD** (teda by ťa donútili
„opravovať" funkčný dizajn):

1. **Pozadie treba SKLÁDAŤ.** Zbieraj vrstvy od prvku nahor po prvú
   NEPRIEHĽADNÚ a potom ich zlož zdola (alfa kompozícia). Verzia, ktorá vzala
   prvú nájdenú `background-color`, hlásila badge 1,92–2,80:1 na farbách, ktoré
   mali 5–7:1.
2. **Po prepnutí témy nechaj DOSADNÚŤ.** `data-theme` spustí CSS prechod; meranie
   v tom istom synchronnom bloku prečíta farby rozbehnutého prechodu — vyšlo
   `.run-prompt` 1,22:1 namiesto 17,3:1. Prepni v jednom volaní, meraj v ďalšom.

A vždy **kalibruj na známom stave**: zmeraj aj `body` (~16:1). Keď to nesedí,
ostatným číslam sa nedá veriť.

Onboarding karta sa vypína `localStorage.setItem('hades.hints2', 'done')` **pred**
loadom (`evaluateOnNewDocument`) — klik na `#hint-skip` po loade ju nespoľahlivo skryje
a prekryje každý screenshot.

**Harness si vždy skalibruj na známom stave.** Merač kreslenia obaľoval `ctx.clearRect()`,
ktorý render nepoužíva, takže vracal vždy 0 a kritérium „rAF stojí mimo Grafu"
vyzeralo splnené bez toho, aby čokoľvek meralo. Obaľuj `window.requestAnimationFrame`.
Pri kontraste neber farbu textu cez `elementFromPoint` — vracia iný element, a tým
cudziu farbu (dávalo to falošné 1,01:1 na bielom texte na akcentovej výplni).

Ďalšie tri pasce toho istého druhu, na každú z nich sa dá naletieť:

- **Nečakaj fixný čas, čakaj na obsah.** `/api/journal` a `/api/dashboard` mávajú
  špičky **1,5–6,8 s** (zmerané pred opravou nižšie), aj keď medián je 0,1–0,2 s —
  krátky spánok tak nasnímka loading skeleton nepredvídateľne, nie vždy. Čakaj na
  `waitForFunction`, kým v `.screen.active` nie sú položky.
- **Nepíš merací skript ako kópiu formuly z kódu.** Po zmene kódu bude merať svoju
  starú kópiu a hlásiť nezmenené čísla. Nechaj render vystaviť výsledok na `S`
  (napr. `S._labelBoxes`) a čítaj ten.
- **Hades je živý.** Medzi dvoma načítaniami sa naučí nové uzly a Denníku narastie
  celý nový deň, takže „pred a po" screenshoty sa líšia aj bez tvojej zmeny. Pri
  porovnávaní CSS prepni stylesheet nad tým istým DOM v tom istom okamihu.

## Testy

`docker compose exec app php artisan test` — **606 testov** (45 preskočených na sqlite,
stav 1. 9. 2026; +10 oproti staršej báze 596 z paralelnej práce na Denníku a Runoch),
všetko PHP (backend, MCP,
API). Frontend testy nie sú; UI sa overuje prekliknutím v prehliadači.

**Zelená sada na sqlite NEZNAMENÁ overený recall.** `phpunit.xml` beží na sqlite
`:memory:`, ale `MindService::searchNodes()` má natvrdo `COLLATE utf8mb4_unicode_ci`,
takže sa **45 testov preskočí** — a medzi nimi celý `HybridRecallTest` (9 prípadov),
teda aj tá vlastnosť, ktorú CLAUDE.md volá tvrdým požiadavkom: *spadnutý model nesmie
spôsobiť, že pamäť vyzerá prázdna*. Keby to niekto pokazil, sada zostane zelená.
Nie je to test, ktorý nemôže padnúť — je to test, ktorý sa v defaultnej konfigurácii
nespustí. **Preto po každej zmene v recalle, embeddingoch alebo v nástrojoch Charóna
pusti aj:**

```
docker compose exec app php vendor/bin/phpunit -c phpunit.mariadb.xml \
  --filter="HybridRecall|RecallBench|ConsoleTools|McpTools"
```

Overené 19. 8. 2026: tam je to **93 testov, 0 preskočených, 0 padnutých**.

**Vo worktree tá istá sada netestuje worktree.** `vendor` je symlink na hlavný
checkout, Composer si z jeho polohy počíta `$baseDir` a autoloader je optimalizovaný
(classmap), takže `App\` aj `Tests\` ukazujú na **hlavnú vetvu** — nová metóda hlási
„Call to undefined method" a zelená sada nehovorí o tvojej zmene nič. Vo worktree
preto:

```
docker compose exec -w /var/www/html/.claude/worktrees/<vetva> app \
  php vendor/bin/phpunit -c tests/phpunit.worktree.xml
```

`tests/worktree-autoload.php` prepíše classmap aj PSR-4 na worktree (cesty v classmape
nie sú normalizované — na tom prvá verzia tichom padla). DB je `hades_test`; názov
**musí** končiť na `_test`, `Tests\TestCase` to overuje a inak beh odmietne.

## Pasca: overuj IDENTITU preview servera

Harness beží na `127.0.0.1:8091` (predtým 8099 — ten zabral kontejner
`zapis_porady_app`). Keď preview server zhasne, port prevezme **cudzia appka** a
harness potom meria ju: `verify.js` vráti „VERDICT: OK", `rvsweep.js` nahlási
neexistujúcu kontrastnú regresiu a `a3-check.js` sa nedočká `window.HADES`.
Naletel som na to.

**Pred každým meraním over, že server je náš:**

```
curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'
```

Musí vypísať `/js/mind/main.js`. Ak vypíše niečo iné (alebo hlavička odpovede
obsahuje `X-Powered-By: PHP`), meriaš cudziu appku a všetky čísla sú bezcenné.

## MCP — odpoveď je pre AI, nie pre človeka

`mind_recall` konzumuje Claude Code, takže tvar odpovede je súčasťou kontraktu:

- `relevance` (0–1) je podiel konceptov dopytu, ktoré uzol trafil, plus tretinová
  váha zhody v **labeli**. Bez tej druhej časti dostalo dvanásť uzlov rovnakých 0,5.
- Uzol s `via` **nie je priamy zásah** — pritiahla ho hrana od toho suseda a má
  polovičnú relevanciu. Susedia sa radia podľa relevancie, nie sily: AI kráti
  kontext zdola.
- `related` sú labely najsilnejších spojení. Prednosť majú uzly už v odpovedi
  (ich label je raz zaplatený).
- **Prázdne polia sa neposielajú** a význam vynechania je v popise nástroja
  (`origin` chýba = `session`, `verified` chýba = neoverené). Nepridávaj polia
  s `null` — je to 20 B za nulovú informáciu na každom uzle.
- `mind_read` vracia jeden uzol celý (popis, všetky tagy, cesta k .md, spojenia).
  Práve to `description_truncated: true` sľubuje.
- `noiseOf()` v `MindService` klasifikuje odpad (`markdown` / `raw-prompt` / `slug` /
  `stub`). Recall ho **označí a zaradí za čisté uzly, nemaže** — skrytý odpad sa
  nikdy neopraví. Smernica (prompt) ho zahodí úplne.

- **`semantic: true`** znamená zásah cez vektor, nie cez slovo — v uzle teda slová
  z dopytu **nie sú** a nemá zmysel ich tam hľadať.

Zmeny tu drž **aditívne** — `mind_recall` volajú živé sessions. `recall()` vracia
`Collection<Node>` pre ChatController; metadáta pre AI pridáva `recallWithMeta()`.

### Recall je hybridný (od 19. 8. 2026)

Kľúčová vetva (FULLTEXT/LIKE + skóre tagov) a vektorová vetva (bge-m3, 1024D,
`node_embeddings`, kosínus v PHP nad BLOB float32) sa **fúzujú cez RRF**, nevyberá sa
jedna. Namerané na 28 reálnych dopytoch (`mind:recall-bench`): pass@3 71,4 % → 100 %,
MRR 0,680 → 0,845, 11 win / 17 same / 0 loss, +213 ms na dopyt (123 ms vektorizácia
dopytu + ~84 ms sken a fúzia).

**Odkiaľ zdvih naozaj pochádza** — dôležité, aby sa nezdôvodňoval nesprávne:
všetkých 14 čisto semantických zásahov skončilo na miestach 6–12 a **ani jeden nebol
tou správnou odpoveďou**. Zdvih robí (a) rozšírenie kandidátov za hranicu keyword
top-12 a (b) RRF preradenie, ktoré zlomí dominanciu „tučných" uzlov: uzol [793] bol
v keyword vetve #1 pre tri nesúvisiace dopyty, v hybride pre žiadny.

Keď je `hades.embeddings.enabled` false, model nedostupný alebo korpus prázdny,
recall sa chová **presne ako predtým** (short-circuit na `COUNT(*)`). To je tvrdý
požiadavok, nie optimalizácia: `mind_recall` volajú živé sessions a spadnutý model
nesmie spôsobiť, že pamäť vyzerá prázdna.

MariaDB 11.4 natívny `VECTOR` nemá (až 11.7+), preto BLOB + brute-force nad ~2700
uzlami. Pri raste rádovo vyššie treba prehodnotiť, nie skôr.

`config/hades.php` → `embeddings.*` (model, batch, `rrf_k`, `candidates`,
`min_similarity`). Backfill: `php artisan mind:embed --stale` (inkrementálny podľa
`source_hash`, prerušiteľný, opakovanie dorobí zvyšok).
