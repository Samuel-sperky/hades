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

## Pre Blade markup (vlastní F1 pre `mind`, F2 pre `chat`)

Na **jadre** je `fill="var(--brand-gold)"` kánon; `currentColor` sa opúšťa — sú to
dva mechanizmy a jeden zanikne pri prvej zmene farby (`mind.blade.php:131` ho ešte
má). **Prstenec** zostáva `var(--accent)`: amethyst je interaktívny nosič, zlatá je
vyhradená jadru. Triedy `bc-ring` / `bc-core` sú povinné, bez nich sa znak nikdy
nezrodí — animáciu na ne vešia `mind.css` (`chat.blade.php:86` a `:182` ich nemajú).

```html
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    <circle class="bc-ring" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
    <circle class="bc-core" cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
</svg>
```

## data-URI faviconu (v `<head>` troch blade súborov, spravuje generátor)

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
