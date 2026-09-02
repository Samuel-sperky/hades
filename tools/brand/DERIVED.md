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

## Pre `public/css/mind.css` (vlastní A3)

```css
/* Obvod prstenca = 2π × 8.64 = 54.29 — DERIVÁT POLOMERU
   z tools/brand/build-mark.py, nie ručná konštanta. Keď sa zmení zdroj znaku,
   prepočíta ho generátor a vypíše sem. */
stroke-dasharray: 54.29;
stroke-dashoffset: 54.29;
```

`.load-mark` — tri čísla. Box 26 px je **vstup** (hodnota vybraná pre
kontrast, komentár nad pravidlom to vysvetľuje pravdivo), ostatné dve sú z neho
odvodené kánonickými pomermi:

```css
width: 26px; height: 26px;
border: 2px solid var(--accent);
/* jadro */
width: 8px; height: 8px; margin: -4px 0 0 -4px;
```

Stredný polomer prstenca vyjde 0.4615 boxu, nie
0.3600 ako v kánone. **Nie je to drift:** CSS `border` rastie
dovnútra boxu, takže polomer je funkcia boxu a obrysu, nie voľné číslo. Prepísať
ho na 1 : 1 s kánonom by znamenalo zmenšiť box a stratiť kontrast.

## Pre Blade markup — RETIROVANÉ (jeden uzol vo viewBoxe 24)

Tento blok bol kánonom, kým bol znak prstenec. Od 1. 9. 2026 je znak **sieť** a
inline znak v Blade nesie sieť z diskov s triedami `bc-node` / `bc-edge` / `bc-core`
(vlastní `mind.css` a Blade, nie tento generátor). Blok tu zostáva pre **jeden uzol**,
lebo to je stále kresba pod 48 px — a `.load-mark`, favicon aj
Electron topbar ju používajú.

Na **jadre** je `fill="var(--brand-gold)"` kánon; `currentColor` sa opúšťa — sú to
dva mechanizmy a jeden zanikne pri prvej zmene farby. **Prstenec** je
`var(--accent)`: amethyst je interaktívny nosič, zlatá je vyhradená jadru.

```html
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle class="bc-ring" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
    <circle class="bc-core" cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
</svg>
```

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

## Nový znak: SIEŤ (1. 9. 2026)

Znak je **výsek siete**: jadrový uzol a tri vedľajšie uzly, viazané štyrmi hranami
(tri od jadra + jedna bočná). Prstencový znak „Jedno oko" je retirovaný a jeho
slovník sa neprekladá — v sieti nemá čo pomenovať.

| Uzol | stred | prstenec | obrys | vlastný box |
|---|---|---|---|---|
| jadro | 50, 50 | r 13.68 | 3.42 | 38 |
| vedľajší 1 | 63.49, 16.62 | r 7.92 | 1.98 | 22 |
| vedľajší 2 | 11.85, 39.78 | r 6.48 | 1.62 | 18 |
| vedľajší 3 | 71.73, 84.77 | r 5.4 | 1.35 | 15 |

Zlatý stred jadra: r 5.7. Hrany: šírka 1.8, zárez
1.5 pred obrubou uzla, bočná hrana na 50 % krytia proti
80 % u hrán od jadra.

**Kompozícia je optická, nie mriežková, a generátor si to VYNUCUJE**
(`assert_optical()`): rozstupy uhlov vedľajších uzlov vyšli
137° / 97° / 126° — teda ani rovnostranný trojuholník
(3 × 120°), ani úsečka. Tri rôzne veľkosti uzlov nesú hĺbku susedstva. Keby niekto
zmenil jedno číslo v `NET_SATS` tak, že kompozícia sadne do mriežky, **generátor
padne** namiesto toho, aby vydal mriežkový znak.

## Stupne redukcie — namerané, nie odhadnuté

Podlaha kontrastu obrysu je **1.5 px** (CLAUDE.md, „Vizuálna sémantika":
pri 1,1 px zoberie antialiasing viac než polovicu kontrastu). Rebrík má **tri**
stupne, nie dva, a ten tretí som pri prvom návrhu vynechal: podlaha platí na
**obrys**, a uzol nakreslený ako plný disk obrys nemá. Sieť z diskov preto drží
hlboko pod 128 px — v diskovom stupni rozhoduje najtenší prvok, ktorý tam
zostal, teda **hrana**.

Stĺpce „prstence by mali" a „disky by mali" sú kalibrácia opačným smerom: koľko by
meral najtenší prvok toho stupňa, keby sa kreslil aj na tejto veľkosti. Bez tej
polovice sa nedá poznať, či sú 128 a 48 namerané hranice,
alebo len prvé vyskúšané čísla.

| px | čo sa kreslí | najtenší prvok | prstence by mali | disky by mali | tvarov | podlaha |
|---|---|---|---|---|---|---|
| 16 px | jeden uzol | 1.44 px | 0.22 px | 0.51 px | 2 | PADÁ |
| 24 px | jeden uzol | 2.16 px | 0.32 px | 0.77 px | 2 | drží |
| 32 px | jeden uzol | 2.88 px | 0.43 px | 1.02 px | 2 | drží |
| 48 px | sieť · disky | 1.54 px | 0.65 px | 1.54 px | 8 | drží |
| 64 px | sieť · disky | 2.05 px | 0.86 px | 2.05 px | 8 | drží |
| 128 px | sieť · prstence | 1.73 px | 1.73 px | 4.10 px | 9 | drží |
| 256 px | sieť · prstence | 3.46 px | 3.46 px | 8.19 px | 9 | drží |

Čo presne na ktorom stupni **zmizne**:

* **16 px, 24 px, 32 px** — jeden uzol: amethystový prstenec, zlatý stred. Hrany aj
  vedľajšie uzly sú zatvorené. Toto je stupeň faviconu (`hades-favicon.svg`,
  data-URI, rámce `.ico` 16–32) a Electron topbaru (`.sigil` 16 px). Pri 32 px by
  hrana v diskovom stupni mala 1.02 px, teda pod podlahou —
  preto ani tu ešte nie je sieť.
* **48 px, 64 px** — **sieť z plných diskov**. Prstence tu nejdú: najtenší obrys uzla
  by mal 0.65–0.86 px. Disk stratí
  „priehľadnosť nesie diera", a je to správny ústupok: diera tejto veľkosti by aj tak
  zanikla. Zmizne obruba uzla a amethystový prstenec okolo jadra; zostanú štyri hrany,
  tri amethystové disky a zlaté jadro.
* **128 px a viac** — **sieť z prstencov**, plný kánon: hrany
  2.30 px, najtenší obrys uzla
  1.73 px, jadro ako prstenec so sýtym zlatým stredom.
  Nezmizne nič.

**Riadok 16 px hlási PADÁ a je to priznanie, nie chyba tabuľky.** Obrys jedného uzla
má pri 16 px 1.44 px, teda pod podlahou 1.5 px.
Vykreslený rámec je čitateľný (`.ico` sa rastruje 4× nadvzorkovane
a LANCZOSom), takže to nie je porucha, ktorú by bolo vidieť — ale číslo je pod
podlahou a zamlčať sa nemá. Oprava by bola hrúbka prstenca **10 namiesto 9**
(1.60 px pri 16 px), a NEUROBILA SA zámerne: mini kánon nesie aj
`.load-mark` (`border` 2 px) a inline znak v Blade, teda súbory, ktoré
tento generátor nevlastní. Je to zmena pomeru, nie kozmetika — patrí do jedného
rozhodnutia so spodným bodom nižšie.

Dôsledok pre `.ico`: multi-size ikona nesie **tri rôzne výkresy** (16–32 jeden uzol,
48–64 sieť z diskov, 128–256 sieť z prstencov). Presne na to multi-size `.ico` je;
jeden škálovaný výkres by buď na 16 px zamrzol do kaše, alebo na 256 px stratil sieť.

## Nosiče znaku a `.load-mark` — čo kam patrí

Načítavacia značka `.load-mark` je CSS `border` na boxe 26 px. Rámom
sa dá nakresliť kruh, **zhluk uzlov nie** — sieť teda na tom nosiči vyjadriť nemožno
a potrebuje inline SVG. Zároveň platí druhá vec: 26 px je pod
48 px, takže na tomto nosiči je **správna kresba jeden uzol**. Obe
tvrdenia platia naraz a nie sú v spore — a preto tu `border` môže zostať.

| nosič | veľkosť | stupeň | poznámka |
|---|---|---|---|
| `<link rel="icon">` data-URI | 16–32 px | jeden uzol | `hades-favicon.svg`, spravuje generátor |
| Electron topbar `.sigil` | 16 px | jeden uzol | generátor, medzi ZNAK markermi |
| `.load-mark` | 26 px | jeden uzol | CSS `border` stačí, čísla nižšie sú nezmenené |
| inline znak v Blade | viewBox 24 | **sieť z diskov** | vlastní `mind.css` / Blade, viď otvorený bod |
| Electron offline `.sigil` | 84 px | sieť z diskov | generátor, medzi ZNAK markermi |
| `apple-touch-icon.png` | 180 px | sieť z prstencov | generátor |
| PNG znaku 128/256/512, OG, lockupy | ≥ 128 px | sieť z prstencov | generátor |

## OTVORENÝ BOD (1. 9. 2026): dva výseky tej istej siete

Vlna, ktorá znak prekresľovala, bežala **v dvoch rukách naraz** a každá nakreslila
vlastný výsek. Nie je to zamlčané, pretože presne toto je drift, kvôli ktorému
generátor existuje:

* **Kánon značky** (tento generátor, `public/brand/**`): jadrový uzol v strede
  + tri vedľajšie na -68° / 195° / 58°
  vo vzdialenostiach 36 / 39.5 / 41.
  Uzol je nad 128 px **prstenec**, jadro má amethystový prstenec so zlatým
  stredom. Electron (oba dokumenty) je z tohto zdroja.
* **Plocha appky** (`.bc-mark` v `mind.css`, markup v troch Blade, viewBox
  24): vlastné súradnice, uzly **plné disky**, jadro bez amethystového
  prstenca, hrany 8,70 / 9,40 / 8,80 / 10,40 jednotky.

Rozhodnúť treba **jednu** vec: či plocha appky prevezme súradnice z tohto generátora
(potom sa `blade_inline_svg()` prepíše na sieťový výkres a Blade markup sa začne
generovať, ako sa generuje Electron), alebo či generátor prevezme súradnice plochy
(potom sa prekreslia `NET_SATS` a všetkých sedem výstupov). **Kým sa to nerozhodne,
znak v karte prehliadača a znak v raile sú dva rôzne výseky** a `docs/BRAND-HADES.md`
nemá jednu pravdu, ktorú by opísal.

Čo tomu NEPREKÁŽA a netreba meniť: jeden uzol na malých nosičoch je v oboch rukách
tá istá kresba (prstenec r 36 / hrúbka 9, zlatý
stred r 15), takže favicon, `.ico` do 32 px, topbar a `.load-mark`
sú konzistentné bez ohľadu na to, ako sa spor rozhodne.

## Inline sieť z KÁNONU — PODMIENENÝ blok, implementuj len po rozhodnutí

**Nezavádzaj tento blok, kým sa nerozhodne otvorený bod vyššie.** Plocha appky má
dnes vlastnú živú sieť (`.bc-mark` / `.bc-node` / `.bc-edge` / `.bc-core`) a tretia
rodina tried pre ten istý znak by bola presne ten drift, ktorý má tento generátor
brániť. Blok je tu ako **hotová alternatíva pre variantu „plocha prevezme kánon
značky"**: vtedy sa `bc-*` prekreslí na tieto súradnice a `bn-*` sa zahodí, alebo
sa `bn-*` použije a `bc-*` zmizne — jedno z dvoch, nikdy oboje.

`data-len` aj `--bn-len` na každej hrane je jej **dĺžka po záreze** — presne to
číslo, ktoré potrebuje `stroke-dasharray` na dokreslenie hrany. Ručne sa nepočíta.

```html
<svg viewBox="0 0 100 100" class="bn" aria-hidden="true">
  <g class="bn-edges">
    <line class="bn-edge" data-len="8.70" x1="56.33" y1="34.34" x2="59.59" y2="26.27" stroke-width="1.8" style="--bn-len: 8.70; --bn-i: 1"/>
    <line class="bn-edge" data-len="13.82" x1="33.69" y1="45.63" x2="20.34" y2="42.05" stroke-width="1.8" style="--bn-len: 13.82; --bn-i: 2"/>
    <line class="bn-edge" data-len="16.53" x1="58.95" y1="64.32" x2="67.71" y2="78.35" stroke-width="1.8" style="--bn-len: 16.53; --bn-i: 3"/>
    <line class="bn-edge bn-edge--lat" data-len="37.39" x1="53.99" y1="20.88" x2="19.87" y2="36.18" stroke-width="1.8" style="--bn-len: 37.39; --bn-i: 4"/>
  </g>
  <circle class="bn-node" cx="63.49" cy="16.62" r="7.92" stroke-width="1.98" style="--bn-i: 1"/>
  <circle class="bn-node" cx="11.85" cy="39.78" r="6.48" stroke-width="1.62" style="--bn-i: 2"/>
  <circle class="bn-node" cx="71.73" cy="84.77" r="5.4" stroke-width="1.35" style="--bn-i: 3"/>
  <circle class="bn-node bn-node--core" cx="50" cy="50" r="13.68" stroke-width="3.42"/>
  <circle class="bn-core" cx="50" cy="50" r="5.7"/>
</svg>
```

Pohyb (**CSS, nie SMIL** — SMIL nectí `prefers-color-scheme` ani
`prefers-reduced-motion` a vo `<img>`/faviconoch ho prehliadače neanimujú):

```css
.bn .bn-node { fill: none; stroke: var(--accent); }
.bn .bn-edge { stroke: var(--accent); stroke-linecap: round; opacity: .8; }
.bn .bn-edge--lat { opacity: .5; }
.bn .bn-core { fill: var(--brand-gold); stroke: none; }

/* ZROD: uzly sa zjavia -> hrany sa DOKRESLIA -> jadro sa presýti.
   Poradie je obsah, nie ozdoba: sieť vzniká tým, že sa uzly spoja. */
.bn .bn-node { animation: bn-node-in 260ms var(--ease) both;
               animation-delay: calc(60ms * var(--bn-i, 0)); }
.bn .bn-edge { stroke-dasharray: var(--bn-len); stroke-dashoffset: var(--bn-len);
               animation: bn-edge-draw var(--dur-chart-draw) var(--ease) both;
               animation-delay: calc(300ms + 80ms * var(--bn-i, 0)); }
.bn .bn-core { animation: bn-core-in 460ms var(--ease) 760ms both; }

@keyframes bn-node-in { from { opacity: 0; transform: scale(.86); }
                        to { opacity: 1; transform: scale(1); } }
@keyframes bn-edge-draw { to { stroke-dashoffset: 0; } }
@keyframes bn-core-in { from { opacity: 0; } to { opacity: 1; } }

/* Tichá verzia MUSÍ byť dosadnutý stav, nie zamrznutý polostav: hrany dokreslené
   (dashoffset 0), uzly a jadro plné. `animation: none` samo by nechalo hranu
   s dashoffset = dĺžka, teda NEVIDITEĽNÚ — sieť by vyzerala ako štyri samostatné
   uzly bez spojení. To je iný znak, nie tichšia verzia toho istého. */
@media (prefers-reduced-motion: reduce) {
  .bn .bn-node, .bn .bn-edge, .bn .bn-core { animation: none; }
  .bn .bn-edge { stroke-dashoffset: 0; }
  .bn .bn-node, .bn .bn-core { opacity: 1; transform: none; }
}
```

**Dýchanie jadra (`core-pulse`) sem NEIDE** a nie je to opomenutie: rozhodnutie
z 1. 9. 2026 hovorí, že pulz nesie stav vedomia bdie/spí a patrí **jedinému**
selektoru `#brand-core` v raile (dôvod je zapísaný pri pravidle v `mind.css`).
Sieť v prázdnom stave je ticho pred prácou, nie stav vedomia.
