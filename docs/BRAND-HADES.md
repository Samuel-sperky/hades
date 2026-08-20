# Značka Hades

Zdroj pravdy pre vizuálnu a verbálnu identitu Hadesa. Vznikol 19. 8. 2026 z 30
rozhodnutí (`KONTRAKT-BRANDING-HADES-2026-08-19.md`).

Hades je **samostatná značka**, nie appka Aury. Časť hodnôt sem historicky prišla
z `handoff/AURA-DESIGN-HANDOFF.md`; od tohto dokumentu sú **vlastné** a nemenia sa
s Aurou. Keď sa rozíde Aura, Hades sa nehýbe.

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

Výnimka je **Charón** (§7): má vlastné meno, lebo je to rozhranie, ktoré s človekom
hovorí. Aj on ale hovorí vecne.

### Slovník (kanonický)

vedomie · uzol · oblasť · oddelenie · spojenie · jadro · istota

Odchýlky sa nezavádzajú. „Node", „graf uzlov", „entita" v UI nepatria.

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

### Wordmark

**Cinzel 600**, rozstup **0,06 em**, prevedený **do kriviek**. Cinzel je kapitálkové
písmo, takže `Hades` sa vysádza ako vysoké `H` a nápisové kapitálky `ADES` — presne
ten rímsky nápisový register, ktorý drží mýtus aj technickú vecnosť naraz.

- rozstup sa **nemení**: bez neho sa `D` a `E` zlepia,
- wordmark je **atramentový** (`--ink`), farbu nesie znak. Amethystový wordmark na
  tmavom papieri hasol,
- v appke sa **nesádza živo** — všade sú krivky, takže lockupy a exporty nezávisia
  od žiadneho fontu. `public/fonts/cinzel-wordmark.woff2` (1,2 kB, subset na glyfy
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

### Pohyb

Dýchanie jadra je **značkový podpis**, nie ozdoba: perióda 4 s, `core-pulse`.
Rýchlosť nesie stav vedomia — `.asleep` pauzne animáciu a stlmí znak (nie slovo,
inak wordmark spadne pod 4,5:1).

**Zrod znaku** (intro) beží raz pri načítaní: prstenec sa obtiahne od dvanástky
(760 ms, oneskorenie 100 ms), potom naskočí jadro s prekmitom na 1,14 (460 ms,
oneskorenie 620 ms). Poradie kopíruje vetu značky — najprv hranica vedomia, potom
jadro. Appka je SPA, takže „raz pri načítaní" znamená raz za sedenie, nie pri
každom prekliku obrazovky.

Obvod prstenca je 2π × 8,64 = **54,29** a je zapísaný v `stroke-dasharray`. Keď
zmeníš polomer, prepočítaj ho — inak sa obtiahnutie zastaví v polovici alebo skočí.

`prefers-reduced-motion` vypína obe animácie a znak je rovno hotový, nie neviditeľný.

---

## 3. Farba

**Amethyst je interaktívny, zlato je značkové.** Amethyst nesie hover, fokus,
aktívny stav a primárne akcie. Zlato nesie dve veci: jadro vedomia a jadro znaku.
Keby zlato nieslo aj interaktívny stav, ten jediný vyhradený význam sa rozdrobí.

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

### Pozadie značky

Značkové je **tmavé** (`#0e1413`) — appka má tmavú tému ako default a zlaté jadro
na nej žiari. Svetlá verzia je povinná, nie druhoradá: každý znak aj lockup musí
existovať a byť overený na oboch.

### Farby oblastí nie sú paleta značky

Prichádzajú z databázy a patria dátam, nie značke. Do manuálu patrí len pravidlo:
**farba = oblasť, tvar = typ**, a utlmenie v OKLCh cez `mutedColor()` (zrezaná
chroma, jednotná cieľová svetlosť, podlaha kontrastu 3,15:1). Každý swatch v DOM
musí ísť cez tú istú funkciu, inak UI hovorí inou farbou než plátno.

Vedľajší efekt prefarbenia: teal `#03797e` je farba oblasti **Vývoj & kód**. Kým bol
akcent tealový, akcent a jedna oblasť mali tú istú farbu. Amethyst tú kolíziu ruší.

### Farby istoty

`overene` / `hypoteza` / `pasca` sú **značková sémantika**, nie bežné
success/warn/error — hovoria o dôveryhodnosti poznatku, nie o výsledku operácie.
Preto majú vlastné tokeny. `--cert-hypoteza` je na tmavej téme tá istá hodnota ako
`--brand-gold`; je to tretia, semantická rola a presun na `--warn` (70° vs 79°)
by kolíziu len zhoršil.

---

## 4. Typografia

| Rola | Písmo |
|---|---|
| UI | **Geist** (variabilné, self-hosted) |
| Čísla, ID, cesty, prompty, tool volania | **Geist Mono** |
| Hero metriky | **Playfair Display** |
| Wordmark | **Cinzel 600** — len v krivkách, viď §2 |

Serif je vzácny, a preto významný: **len** hero metriky. Nadpisy obrazoviek sú
Geist. Cinzel je vyhradený wordmarku a nikde inde sa nepoužíva — je to písmo
značky, nie písmo textu.

Fonty sú **self-hostované v `public/fonts/`**, Google Fonts CDN je zámerne preč —
pri jeho výpadku sa každá ikona vykreslila ako svoj ligatúrový názov.

---

## 5. Ikony

**Material Symbols Rounded**, subset (215 glyfov, 132 kB). Žiadne emoji, nikde.

Platí pre celú appku vrátane Charóna. **Keď pridáš novú ikonu, subset ju nemá a
vykreslí sa ako text — regeneruj** (`pyftsubset --no-layout-closure`). Dnes v subsete
chýba napr. `terminal` a `arrow_downward`.

`font-display: block` pre ikony (nie `swap`): krátky prázdny priestor je lepší než
blik surových ligatúrových názvov.

---

## 6. Hlášky

Značkové stringy sú **kodifikované**, nie náhodné. Mýtus smie hovoriť tam, kde
nikoho nezdržuje; chybové hlásenie musí ostať presné.

| Situácia | Text |
|---|---|
| Pád API (hero) | **Vedomie sa nepodarilo prebudiť** + „Server neodpovedá — skontroluj, či Hades beží." |
| Stav vedomia | `bdie` / `spí` |
| Prázdny Charón | „Napíš úlohu. Charón vidí celú pamäť Hadesa aj súbory projektu — a čo chce zmeniť, ukáže dopredu." |

Pravidlo: **jedna značková veta, potom vecné vysvetlenie.** Nikdy dve mýtické vety
za sebou a nikdy mýtus v texte, ktorý má človek použiť na opravu chyby.

---

## 7. Aplikácia

### Titulky

Formát je **`Hades — <obsah>`**, značka prvá:
`Hades — Vedomie`, `Hades — Charón`.

### Graf

Znak žije v raile (`#brand-core`) — jediný výskyt na obrazovke, so slovom `Hades`
pod ním. Geometria je zmenšenina mini verzie (prstenec r .36 / hrúbka .09,
jadro r .15). Prstenec je amethyst, jadro zlaté.

`#brand-core` je pomenovaná výnimka kánonu: je to `<button>`, ale zlatá tam nesie
identitu, nie interaktívny stav — všetky jeho stavy (fokus, hover) sú amethystové.

### Charón

Konzola vedomia sa volá **Charón** — prievozník, ktorý sprostredkúva medzi človekom
a pamäťou. Nie je to nová URL: `/console` a `/console/<uuid>` zostávajú, aby odkazy
na existujúce vlákna žili.

- vizuálne **žiadne odlíšenie** od zvyšku appky — tie isté tokeny, ten istý chróm,
- v hlavičke vlákna je `Charón`, nie „Konzola vedomia",
- autor odpovedí je **Charón** (Hades je vedomie; Charón je ten, kto hovorí),
- vľavo hore je **znak**, nie ikona `hub` — a klik vedie do grafu.

### Favicon

Mini sigil na tmavom disku: `#0e1413` podklad, prstenec `#c4a2f5` (r 36, hrúbka 9),
jadro `#d8b878` (r 15). Inline SVG v `<link rel="icon">`, rovnaký na všetkých
stránkach.

---

## 8. Assety (`public/brand/`)

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

Mimo tohto adresára: `public/favicon.ico` (z **mini** verzie, 16–256 px) a inline SVG
favicon priamo v `<head>` oboch stránok.

SVG assety sa prispôsobujú téme samy cez `prefers-color-scheme` — jeden súbor drží
obe verzie, netreba `-dark` / `-light` dvojičky.

**Pasca pri vkladaní znaku do väčšieho SVG:** jeho `<style>` platí pre celý
dokument, takže `path { fill: none; stroke: … }` utečie na písmo lockupu a wordmark
sa vykreslí obtiahnutý namiesto vyplneného. Preto sa pravidlá znaku pri vkladaní
zapuzdrujú pod `.sig` (robí to `build-brand.py`).

## 9. Checklist pred odovzdaním

- [ ] žiadny raw hex mimo `:root` — všetko cez tokeny
- [ ] amethyst nesie interaktivitu, zlato len jadro a znak
- [ ] znak: master nad 32 px, mini pod 24 px, nikdy naopak
- [ ] titulok `Hades — <obsah>`
- [ ] nová ikona → regenerovaný subset Material Symbols
- [ ] swatch oblasti v DOM ide cez `mutedColor()`
- [ ] text 4,5:1, grafika 3:1 — a nezhoršiť žiadny pár oproti predchádzajúcemu stavu
- [ ] zmena CSS overená výmenou stylesheetu nad tým istým DOM, nie dvoma načítaniami

---

## 10. Pôvod

Písmo: **Cinzel** (OFL), stiahnuté z Google Fonts 20. 8. 2026 so súhlasom
používateľa, variabilná os `wght` zafixovaná na 600. Zdrojový TTF v repe nie je —
sú v ňom len krivky a 1,2 kB subset.

Assety stavia `build-brand.py` (scratchpad): číta `hades-sigil.svg`, vyťahuje
glyfy z Cinzelu cez `fontTools` a skladá wordmark aj lockupy. Keď sa zmení znak,
prestavajú sa aj lockupy — ručne sa neupravujú.
