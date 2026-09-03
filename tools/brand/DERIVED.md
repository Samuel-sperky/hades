<!-- GENEROVANÉ tools/brand/build-mark.py — needituj ručne. -->
# Odvodené hodnoty znaku

Tento súbor je výstup `tools/brand/build-mark.py`. Nesie čísla pre miesta, ktoré
generátor **nevlastní** (CSS a Blade markup), aby ich nikto nepočítal rukou. Keď sa
zmení `hades-sigil-mini.svg`, spusti generátor a prepíš podľa tejto tabuľky.

Regenerácia:

```
python tools/brand/build-mark.py
```

## Kánon mini (zo zdroja)

| Vec | Hodnota |
|---|---|
| viewBox | 100 × 100 |
| prstenec | r 36 · hrúbka 9 · pomer 0.3600 boxu |
| jadro | r 15 · pomer priemeru 0.3000 boxu |
| akcent (tmavá / svetlá) | `#c4a2f5` / `#6d3fb5` |
| zlatá (tmavá / svetlá) | `#d8b878` / `#b88a3a` |
| atramentový disk | r 50 · `#0e1413` (z `--bg-rgb` tmavej témy v mind.css) |

## Pre `public/css/mind.css` a Blade — stupeň `'core'` vo viewBoxe 24

Mini kánon prepočítaný na mriežku appky. Sú to **živé** čísla: `sigilNetMarkup(cls,
{step: 'core'})` v `public/js/shared/sigil.js` kreslí presne tento tvar a nesú ho
24 px hlavičkové nosiče (`#brand-core`, `#back-to-graph`, `#chat-home`).

| Vec | viewBox 24 | pomer boxu |
|---|---|---|
| prstenec | r 8.64 · obrys 2.16 | 0.3600 / 0.0900 |
| zlaté jadro | r 3.6 | 0.1500 |

`SIGIL_NET.mini` v appke nesie `r 8.64 / sw 2.16 /
gold 3.6` — tie isté tri čísla, a generátor to **vynucuje**
(`assert_mini_matches_app()`). Keď niekto prekreslí `hades-sigil-mini.svg` a zabudne
na appku, generátor padne namiesto toho, aby vydal favicon s iným redukovaným znakom,
než aký nesie rail.

```html
<svg viewBox="0 0 24 24" aria-hidden="true">
    <g class="bc-nodes">
        <circle class="bc-node" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
    </g>
    <circle class="bc-core" cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
</svg>
```

Blok je **kontrola, nie zadanie**: statický markup si appka nesie sama (v Blade musí
SVG stáť priamo, inak stránka najprv ukáže prázdno) a generátor ho neprepisuje.

**Čo z tejto sekcie ODIŠLO 2. 9. 2026 a prečo:** `stroke-dasharray` odvodený z obvodu
prstenca (2π × 8.64) a tri čísla `.load-mark` (box 26, `border`,
jadro). Ani jedno už nemá čitateľa — `mind.css` používa `stroke-dasharray: 100`, čo je
`pathLength="100"` na hranách a nie obvod ničoho, a `.load-mark` prestal byť CSS
`border`: je to inline `<svg>` v boxe 32 px. Vydávať odvodené číslo
do prázdna je horšie než ho nevydať, pretože podľa neho niekto „opraví" funkčný súbor.

## data-URI faviconu (`resources/views/partials/brand-icons.blade.php`, spravuje generátor)

Jeden cieľ, nie tri: page blade si partial `@include`ujú a generátor si overuje,
že žiadna z nich nemá vlastný `<link rel="icon">`.

```
data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%230e1413'/><circle cx='50' cy='50' r='36' fill='none' stroke='%23c4a2f5' stroke-width='9'/><circle cx='50' cy='50' r='15' fill='%23d8b878'/></svg>
```

## Lockupy a rastrové derivát y — DVA generátory, jeden kánon

Lockupy (`hades-lockup-h.svg`, `hades-lockup-v.svg`) vydáva tento generátor: vymení
v nich **skupinu `.sig`** za aktuálny master a wordmark nechá presne tam, kde je.
Umiestnenie wordmarku (výška znaku : výška verzálky = 1,55 : 1, medzera 0,34 ×
výška znaku) vypočítal retirovaný `docs/build-brand.py` z metrík fontu Cinzel,
ktorý v tejto vetve nie je — preto sa neprepočítava, len zachováva.

Do 28. 8. 2026 lockupy generátor **nevlastnil nikto** a nesli geometriu starého
mastera (prstenec r 34, jadro r 8,5) dlho po tom, ako sa master zmenil. Assety bez
generátora zastarajú a nikto si to nevšimne.

PNG derivát y (`hades-lockup-300/600/1200.png`, `hades-sigil-128/256/512.png`,
`hades-og.png`) vydáva **`tools/brand/build-raster.js`** (node + headless Chrome).
Je to druhý skript, a to zámerne: PIL v tomto generátore vie kresliť kruhy, takže
zvládne favicon aj `.ico`, ale **wordmark je písmo v krivkách a ten nenakreslí**.
V prostredí nie je žiadny SVG rasterizér (`cairosvg` chýba, `convert` je Windowsov
konvertor diskov, nie ImageMagick), takže rasterizuje Chrome — cesta, ktorú si
projekt zapísal ako funkčnú v CLAUDE.md.

**Poradie je povinné**, PNG sa fotia z hotových SVG:

```
python tools/brand/build-mark.py     # SVG kánon
node   tools/brand/build-raster.js   # PNG z neho
```

## Znak je SIEŤ a jej geometriu vlastní APPKA (rozhodnuté 2. 9. 2026)

Znak je **výsek siete**: jadro a tri satelity, viazané štyrmi hranami (tri z jadra
+ jedna chorda medzi satelitmi). Prstencový znak „Jedno oko" je retirovaný a jeho
slovník sa neprekladá — v sieti nemá čo pomenovať.

**Tabuľka geometrie žije v `public/js/shared/sigil.js` (`SIGIL_NET`, viewBox
24) a tento generátor ju PARSUJE.** Do 2. 9. 2026 tu boli vlastné polárne
`NET_SATS` a bol to druhý výkres tej istej siete: kánon mal satelity v troch rôznych
veľkostiach na 195° / 58° / -68° vo vzdialenostiach 36 / 39,5 / 41 boxu 100, appka
vlastné karteziánske súradnice v boxe 24 — a jadro mali RÔZNE (appka plný zlatý kotúč,
kánon amethystový prstenec so zlatým stredom). Rozhodnutie: **vyhráva appka**, pretože
prstenec okolo jadra by z jadra urobil štvrtý prstencový uzol a „jadro = jediný sýty
plný prvok" by prestalo platiť.

| Prvok | stred (box 100) | polomer | obrys | pomer stredu k boxu |
|---|---|---|---|---|
| jadro (plné, zlaté) | 50, 50 | r 10.83 | — | 0.500000, 0.500000 |
| satelit 1 (prstenec) | 16.92, 32.33 | r 7.92 | 5 | 0.169167, 0.323333 |
| satelit 2 (prstenec) | 83.54, 36.25 | r 7.92 | 5 | 0.835417, 0.362500 |
| satelit 3 (prstenec) | 58.42, 84.83 | r 7.92 | 5 | 0.584167, 0.848333 |

Hrany (šírka 4.58, bočná na 50 % krytia proti 80 % u hrán od jadra).
„Vidno" je dĺžka MIMO zlatého kotúča jadra — prvých 10.83 jednotiek každej
hrany od jadra je pod ním skrytých:

| hrana | dĺžka cesty | vidno | rola |
|---|---|---|---|
| 1 | 27.07 | 16.23 | jadro -> satelit |
| 2 | 25.84 | 15.01 | jadro -> satelit |
| 3 | 25.42 | 14.58 | jadro -> satelit |
| 4 | 33.86 | 33.86 | chorda satelit-satelit |

### DÔKAZ: kánon a appka kreslia ten istý výsek

`assert_same_cutout()` porovnáva **normalizované pomery** — každú vydanú súradnicu
delenú boxom mastera (100) proti tej istej súradnici delenej boxom appky
(24). Zmerané pri tomto behu: **32 pomerov, všetky do 1e-9**, teda
identické. A to isté meranie na **vydanom** `hades-sigil.svg`, nie na modeli v pamäti:
28 pomerov, najhorší rozdiel **0.000050 boxu** proti stropu
zaokrúhlenia 0,000050 (`num()` reže na dve desatiny, takže 6,27/24 = 0,261250 je v súbore
zapísané ako 26,12/100 = 0,261200). Bez tej druhej polovice by sa dalo tvrdiť „pomery
sedia" o čísle, ktoré v súbore nie je.

Nie je to tautológia z toho, že generátor tabuľku appky číta: keby prepočet
niesol offset, iný stred alebo zaokrúhlenie, stráž padne. Absolútne hodnoty sa
NEZHODUJÚ a zhodovať sa nemajú (jadro r 10.83 v boxe 100 proti
r 2.6 v boxe 24) — **identita je v pomeroch**.

**Kompozícia je optická, nie mriežková, a generátor si to VYNUCUJE**
(`assert_optical()`): rozstupy uhlov satelitov vyšli
132° / 130° / 99° — teda ani rovnostranný trojuholník
(3 × 120°), ani úsečka (plocha trojuholníka 1668 = 0.167
boxu², prah 0,12 boxu²). Chorda jadro obchádza s odstupom 23.48 proti jeho
okraju 10.83. Keby niekto v `sigil.js` zmenil jedno číslo tak, že
kompozícia sadne do mriežky alebo že chorda prejde cez jadro, **generátor padne**
namiesto toho, aby vydal iný znak.

## Stupne redukcie — namerané, nie odhadnuté

Podlaha kontrastu obrysu je **1.5 px** (CLAUDE.md, „Vizuálna sémantika").
Prah siete je **32 px** a je **STUBLOVÝ, nie obrysový**: rozhoduje, či
z hrany vidno dosť na to, aby znak hovoril „sieť". Pri 32 px vidno
4.67 px z najkratšej hrany, pri 24 px už len
3.50 px — a to je stubla, nie spojenie. Prah nesie appka
(`shared/sigil.js`) a kánon ho prevzal, pretože je to ten istý znak.

Rebrík mal do 2. 9. 2026 **tri** stupne a stredný (sieť z plných diskov) je
retirovaný. Nebol to zbytočný stupeň, ale dôsledok STAREJ geometrie: hrana široká
1,8 v boxe 100 je 0,018 boxu, `SIGIL_NET` má 1.1 v boxe 24,
teda 0.046 boxu — **2.5x
hrubšie**. Rovnaká podlaha 1,5 px preto padne o dva a pol stupňa nižšie a ústupok
„zahoď obrys, kresli disky" stratil dôvod.

Stĺpec „prstence by mali" je kalibrácia opačným smerom: koľko by meral najtenší prvok
siete, keby sa kreslila aj na tejto veľkosti.

| px | čo sa kreslí | najtenší prvok | prstence by mali | najkratšia stubla | tvarov | podlaha |
|---|---|---|---|---|---|---|
| 16 px | jeden uzol | 1.44 px | 0.73 px | 2.33 px | 2 | PADÁ |
| 24 px | jeden uzol | 2.16 px | 1.10 px | 3.50 px | 2 | drží |
| 32 px | sieť · prstence | 1.47 px | 1.47 px | 4.67 px | 8 | PADÁ |
| 48 px | sieť · prstence | 2.20 px | 2.20 px | 7.00 px | 8 | drží |
| 64 px | sieť · prstence | 2.93 px | 2.93 px | 9.33 px | 8 | drží |
| 128 px | sieť · prstence | 5.87 px | 5.87 px | 18.67 px | 8 | drží |
| 256 px | sieť · prstence | 11.73 px | 11.73 px | 37.33 px | 8 | drží |

Čo presne na ktorom stupni **zmizne**:

* **16 px, 24 px** — jeden uzol: amethystový prstenec, zlatý stred. Hrany aj satelity
  sú zatvorené. Toto je stupeň faviconu (`hades-favicon.svg`, data-URI, rámce `.ico`
  16–24), Electron topbaru (`.sigil` 16 px) a 24 px hlavičkových nosičov appky
  (`#brand-core`, `#back-to-graph`, `#chat-home`). Zmizne presne to, čo hovorí
  `shared/sigil.js`: tri satelity a všetky štyri hrany. Amethyst prežije — zlatý kotúč
  sám by značka nebol.
* **32 px a viac** — **plná sieť z prstencov**, kánon bez ústupkov: štyri
  hrany, tri prstencové satelity, plné zlaté jadro. Nezmizne nič.

**Riadok 16 px hlási PADÁ a je to priznanie, nie chyba tabuľky.** Obrys jedného uzla
má pri 16 px 1.44 px, teda pod podlahou 1.5 px.
Vykreslený rámec je čitateľný (`.ico` sa rastruje 4x nadvzorkovane
a LANCZOSom), takže to nie je porucha, ktorú by bolo vidieť — ale číslo je pod
podlahou a zamlčať sa nemá.

**A riadok 32 px hlási PADÁ rovnako priznane.** Hrana má pri 32 px
1.47 px, teda **0.03 px
pod podlahou** — pri obryse satelitu 1.60 px, ktorý
drží. Nie je to omyl v prahu: prah je stublový a appka na tomto nosiči plnú sieť
NAOZAJ kreslí (`.load-mark`, `.charon-sigil`, oba 32 px). Je to ten
istý argument, aký si projekt zapísal o hranách plátna: jedna vláska prah nespĺňa,
informáciu nesie hustota — a tu ju nesie stubla, ktorá má 4.67 px,
teda 3.2x viac než svoju šírku.
Zdvihnúť hranu na 1,5 px by znamenalo prekresliť `SIGIL_NET`, teda znak na všetkých
troch plochách appky — to nie je oprava tabuľky, ale zmena znaku.

Dôsledok pre `.ico`: multi-size ikona nesie **dva rôzne výkresy** (16–24 jeden uzol,
32–256 plná sieť). Presne na to multi-size `.ico` je; jeden škálovaný výkres
by buď na 16 px zamrzol do kaše, alebo na 256 px stratil sieť.

## Nosiče znaku — čo kam patrí

| nosič | veľkosť | stupeň | poznámka |
|---|---|---|---|
| `<link rel="icon">` data-URI | 16–24 px | jeden uzol | `hades-favicon.svg`, spravuje generátor |
| Electron topbar `.sigil` | 16 px | jeden uzol | generátor, medzi ZNAK markermi |
| `#brand-core`, `#back-to-graph`, `#chat-home` | 24 px | jeden uzol | appka, stupeň `'core'` |
| `.load-mark`, `.charon-sigil` | 32 px | plná sieť | appka; `.load-mark` už nie je CSS `border` |
| `.empty-sigil`, `.ce-mark` | 44 px | plná sieť | appka |
| Electron offline `.sigil` | 84 px | plná sieť | generátor; do 2. 9. 2026 disky |
| `apple-touch-icon.png` | 180 px | plná sieť | generátor |
| PNG znaku 128/256/512, OG, lockupy | ≥ 128 px | plná sieť | generátor |

`errors/401.blade.php` je zámerne mimo tejto tabuľky aj mimo generátora: nesie tú istú
geometriu vlastnými lokálnymi triedami, pretože `mind.css` sa tam nenačítava a appka
ten dokument nevydáva cez router.

## Electron: dva dokumenty, ktoré si nesú znak SAMY

`electron/chrome/topbar.html` a `electron/states/offline.html` **nenačítavajú
`mind.css`** — offline stav sa zobrazuje práve vtedy, keď server nebeží. Preto majú
vlastnú kresbu (generátor, medzi markermi `ZNAK` a `ZNAK-STYLE`) **aj vlastnú tichú
verziu `prefers-reduced-motion`** (dokument, zámerne MIMO markerov, inak by ju prvý
beh generátora zmazal).

Tichá verzia je tam postavená správne a treba to tak nechať: základný stav je
**dosadnutý znak** (hrany `stroke-dashoffset: 0`, uzly `scale(1)`, plná farba)
a pohyb je zabalený v `@media (prefers-reduced-motion: no-preference)`. Nie
`animation: none` nad rozbehnutým stavom — to by hranu nechalo s `dashoffset` = dĺžka,
teda NEVIDITEĽNÚ, a znak by sa rozpadol na tri uzly bez spojení.

`.core` má `transform-origin` v ZNAK-STYLE (view-box súradnice, stred boxu), uzly
`transform-box: fill-box` + `center` v dokumente — uzly majú tri rôzne stredy, takže
konštanta by musela byť v CSS trikrát.

## Kde geometria siete NIE JE, hoci by tam patrila

Kánon dnes vydáva jednu geometriu z jedného zdroja, ale **kontrakt tried `.bc-mark`
v `mind.css` je stále vlastný zápis** — spína zrod, nekreslí tvar, a nič v kóde
nevynucuje, že jeho `pathLength`/dash matematika sedí s výkresom. Zmena geometrie sa
preto musí overiť **meraním na bežiacej appke**, nie čítaním jedného zdroja. Toto je
posledné miesto, kde môže znak driftnúť tichom.
