# E-shop cenotvorba a klasifikátor

> Logika automatickej cenotvorby e-shopu Aura: klasifikátor priradí každému produktu triedu GROUP/VARIANT a z nej sa vypočíta predajná cena z nákupnej cez markup tier. Single source of truth je `pricing.php`, ktoré zrkadlí `sperky_cenotvorba.xlsx`.

## Prehľad

E-shop nekalkuluje cenu ručne od kusa. Namiesto toho má jeden deklaratívny config (`pricing.php`), ktorý robí dve veci naraz:

1. **Klasifikuje** produkt — z jeho kategórií a textu odvodí, z akého je materiálu (GROUP) a aký je to typ šperku (VARIANT). Výsledok je reťazec `<GROUP>/<VARIANT>`, napr. `GOLD_18K/RINGS` alebo `GIFT_WRAPPING/S`.
2. **Ocení** produkt — podľa priradenej triedy a nákupnej ceny vyberie správny markup a vypočíta predajnú cenu.

Model triedy je teda dvojosový: **materiál × typ šperku**. Materiály sú primárna os (`groups`), typy šperku sú zdieľaná sekundárna os (`variants`). Vďaka tomu netreba definovať cenu pre každú kombináciu zvlášť — markupy sú per materiál, typ šperku len rozlišuje kategóriu a poradie.

Prečo to takto: katalóg má stovky SKU v mnohých materiáloch a typoch. Ručná cenotvorba by neškálovala a rozišla by sa s Excelom. Config drží obchodnú logiku (markupy = biznis dáta majiteľky) na jednom mieste, verzionovateľne, a kód ju len aplikuje.

## Kľúčové pojmy

- **GROUP (skupina / materiál)** — primárna os. Buď materiál (`GOLD_18K`, `SILVER`, `TITANIUM`, …), alebo špeciálna skupina `GIFT_WRAPPING` (darčekové balenie). Nesie `label`, klasifikačné signály (`cats`, `strings`), odkaz na sadu variantov (`variants`), default variant a tabuľku markupov.
- **VARIANT (typ šperku)** — sekundárna os. Zdieľaná sada, na ktorú GROUP odkazuje. Materiály používajú sadu `jewelry_types` (rings, earrings, necklaces, chains, bracelets, anklets, pendants, sets, piercing, other); gift wrapping používa sadu `gift_sizes` (s, m, xl).
- **cats** — klasifikačný signál: zoznam ID kategórií. Matchuje sa proti **subtree** kategórie produktu (teda aj podkategórie sa počítajú). Váha 10× oproti stringu.
- **strings** — klasifikačný signál: kľúčové slová. Matchujú sa proti normalizovanému textu produktu + názvom kategórií + názvu materiálu z `ps_material`. Váha 1×. Sú tu už ako lowercase ASCII bez diakritiky (napr. `pozlat`, `naramok na nohu`, `316l`), lebo text sa pred porovnaním normalizuje (lowercase + odstránenie diakritiky).
- **markup** — PLNÉ percento nákupnej ceny, nie prirážka navyše. `100` = predaj za náklad (0 % marža), `155` = nákup + 55 %, `200` = 2× nákup. Predaj = nákup × markup / 100.
- **tier (cenový stupeň)** — položka v `markups[variant]`: `['max_threshold' => €|null, 'markup' => %]`. Tiery sú zoradené vzostupne; vyberie sa prvý, do ktorého nákupná cena spadne (`purchase <= max_threshold`). `null` znamená „a vyššie" (posledný tier). Lacnejšie kusy majú vyšší markup, drahšie nižší.
- **max_threshold** — horný prah nákupnej ceny (bez DPH, v EUR) pre daný tier.
- **default_variant** — variant použitý, keď sa žiadny typ nedetekuje (materiály `other`, gift wrapping `s`).
- **tax** — DPH e-shopu v %, jediný zdroj `pricing.php['tax']`, číta sa cez `app()->taxRate()`. Aktuálne 23 %.
- **currency** — mena celej cenotvorby, `EUR`. `ps_product.purchase_price` je uložená **bez DPH** v tejto mene.

## Architektúra — ako je config poskladaný

```
return [
  'tax'      => 23.0,          // DPH % (app()->taxRate())
  'currency' => 'EUR',
  'groups'   => [ <GROUP> => [ label, cats, strings, variants, default_variant, markups ] ... ],
  'variants' => [ 'jewelry_types' => [...], 'gift_sizes' => [...] ],
];
```

Každá položka v `groups`:

- `label` — zobrazovací názov (slovensky, napr. `Zlato 18k`).
- `cats` — pole ID kategórií, ktoré identifikujú materiál (subtree match).
- `strings` — kľúčové slová pre materiál (fallback, keď kategórie nesedia).
- `variants` — meno zdieľanej sady variantov (`jewelry_types` pre materiály, `gift_sizes` pre balenie).
- `default_variant` — variant, keď sa nič nedetekuje.
- `markups` — mapa `variant => [ tier, tier, ... ]`. U materiálov sú markupy pre všetky typy šperku v rámci jedného materiálu **rovnaké** (typ šperku mení len klasifikáciu, nie cenu); u gift wrappingu sa markup líši podľa veľkosti.

Sada `variants['jewelry_types']` má každý typ s vlastnými `cats` a `strings`. Kľúčový komentár v configu: typ šperku je pod-kategória pod každým materiálom (napr. „Zlaté prstene", „Strieborné prstene", „Prstene z ocele"), preto každý variant vymenúva type-kategóriu **všetkých** materiálov. `gift_sizes` (s/m/xl) zatiaľ nemajú auto-detekčné signály → vždy padnú na default `s`.

## Ako to funguje — klasifikátor

Klasifikátor beží v dvoch nezávislých skórovaniach a spojí ich do výsledku `<GROUP>/<VARIANT>`.

1. **Normalizácia vstupu.** Text produktu (názov, popis), názvy jeho kategórií a názov materiálu z `ps_material` sa spoja, prevedú na lowercase a odstráni sa diakritika → ASCII lowercase. Kategórie produktu sa rozvinú na **subtree** (kategória + jej potomkovia / celá vetva).

2. **Skórovanie GROUP.** Pre každú skupinu v `groups`:
   - za každé ID z `cats`, ktoré sedí do subtree kategórie produktu → **+10**,
   - za každý string z `strings`, ktorý je obsiahnutý v normalizovanom texte → **+1**.
   Vyberie sa skupina s najvyšším skóre.

3. **Skórovanie VARIANT.** Z vybranej sady (`jewelry_types` alebo `gift_sizes`) sa rovnako oskóruje každý variant (cats 10×, strings 1×). Vyberie sa variant s najvyšším skóre; pri nule sa použije `default_variant`.

4. **Výsledok** = `<GROUP>/<VARIANT>` (napr. `SILVER/EARRINGS`).

### Prečo cats rozhodujú nad strings

`cats` majú váhu 10×, `strings` len 1×. Katalóg je kategorizovaný správne v drvivej väčšine prípadov, takže jedna sediaca kategória (10 bodov) prebije aj viac náhodných keyword zásahov. Stringy sú len **fallback** pre produkty, ktoré sú zle alebo vôbec nezaradené do kategórií. Dôsledok: keď chceš spoľahlivo preklasifikovať produkt, oprav mu kategóriu — nie text.

### Prečo poradie variantov (anklets pred bracelets)

Poradie v `jewelry_types` je „najšpecifickejšie prvé" a slúži ako **tie-break** v skórovaní. `anklets` (náramky na nohu) sú uvedené pred `bracelets` (náramky na ruku). Anklety sú v strome kategórií **súrodenci** braceletov, nie ich potomkovia, takže sa subtree matchom nekrížia — ale ich stringy (`naramok na nohu`) sa čiastočne prekrývajú s `naramok`. Skorším poradím anklet vyhrá tam, kde by inak nastala remíza, a nezožerie ich všeobecnejší `bracelets`. Rovnako `piercing` je prvý, lebo má vlastný veľký subtree.

## Ako to funguje — cena

Po klasifikácii sa cena počíta takto:

1. **Vezmi nákupnú cenu** `ps_product.purchase_price` (bez DPH, EUR).
2. **Vyber tier.** V `markups[variant]` prejdi tiery vzostupne a vezmi prvý, kde `purchase <= max_threshold`; ak žiadny (alebo tier má `max_threshold => null`), použi posledný („a vyššie").
3. **Vypočítaj čistú predajnú cenu:** `selling = purchase × markup / 100`. Markup je plné % nákupu (155 = +55 %).
4. **Pridaj DPH** na zobrazenie: `selling_s_dph = selling × (1 + tax/100)`, kde `tax` = `app()->taxRate()` = 23 %.

Príklad: strieborné náušnice, nákup 30 € (≤ 50 prah) → tier markup 170 → čistá predajná = 30 × 170/100 = 51,00 € → s DPH 23 % = 62,73 €. To isté striebro nákup 80 € (> 50 prah) → markup 163 → 130,40 € čistá.

## Tabuľka markupov (biznis dáta Aura — archivovať)

Materiály majú pre **všetky** typy šperku rovnaké markupy; líšia sa len prahom a materiálom. Prah = `max_threshold` (nákup bez DPH v EUR); „≤ prah" = markup pre lacnejšie kusy, „> prah" = markup nad prahom.

| GROUP | label | prah (€) | markup ≤ prah | markup > prah |
|---|---|---|---|---|
| GOLD_18K | Zlato 18k | 100 | 155 | 149,5 |
| GOLD_14K | Zlato 14k | 100 | 160 | 154 |
| GOLD_9K | Zlato 9k | 100 | 165 | 158,5 |
| GOLD_18K_DIA | Zlato 18k s diamantom | 100 | 150 | 145 |
| GOLD_14K_DIA | Zlato 14k s diamantom | 100 | 155 | 149,5 |
| GOLD_9K_DIA | Zlato 9k s diamantom | 100 | 160 | 154 |
| SILVER | Striebro | 50 | 170 | 163 |
| SILVER_DIA | Striebro s diamantom | 50 | 160 | 154 |
| SILVER_GILDED | Pozlátené striebro | 50 | 175 | 167,5 |
| TUNGSTEN | Wolfrám | 50 | 180 | 172 |
| TITANIUM | Titán | 50 | 185 | 176,5 |
| STEEL | Oceľ | 50 | 190 | 181 |
| BIJOU | Bižutéria | 50 | 200 | 190 |
| ACRYLIC | Akryl | 50 | 220 | 208 |
| OTHER | Iné | 50 | 180 | 172 |

Gift wrapping má vlastnú os `gift_sizes` a jediný tier (bez prahu, `null`):

| GROUP | variant | markup |
|---|---|---|
| GIFT_WRAPPING | s (Malé) | 155 |
| GIFT_WRAPPING | m (Stredné) | 150 |
| GIFT_WRAPPING | xl (Veľké) | 145 |

Logika markupov: čím lacnejší / menej ušľachtilý materiál, tým vyšší markup (striebro 170 / oceľ 190 / bižutéria 200 / akryl 220), lebo pri nízkej nákupnej cene treba vyššie % na pokrytie fixných nákladov. Diamantové varianty majú **nižší** markup než ich bezdiamantový základ (drahší vstup, nižšie %). Drahšie kusy nad prahom majú vždy o niečo nižší markup než lacné pod prahom.

## Klasifikačné signály — referencia

Materiály (`groups`), okrem markupov:

| GROUP | cats | kľúčové strings |
|---|---|---|
| GOLD_18K | 74, 127 | 18k, 750 |
| GOLD_14K | 74, 127 | 14k, 585 |
| GOLD_9K | 74, 127 | 9k, 375 |
| GOLD_18K_DIA | 74, 127, 118 | 18k, 750, diamant, briliant, brilliant, diamond |
| GOLD_14K_DIA | 74, 127, 118 | 14k, 585, diamant… |
| GOLD_9K_DIA | 74, 127, 118 | 9k, 375, diamant… |
| SILVER | 50 | (žiadne) |
| SILVER_DIA | 50, 118 | diamant, briliant, brilliant, diamond |
| SILVER_GILDED | 50 | pozlat, gold plated, gold-plated, goldplated, vermeil |
| TUNGSTEN | 9 | wolfram, tungsten |
| TITANIUM | 8 | titan |
| STEEL | 2 | 316l, ocel |
| BIJOU | 44 | bizuter |
| ACRYLIC | (žiadne) | akryl, acryl |
| OTHER | (žiadne) | (žiadne) |
| GIFT_WRAPPING | 45 | darcekove balenie, darcekove vrecusko, darcekova krabicka, vrecusko na sperky |

Poznámky: zlaté podskupiny zdieľajú kategórie 74/127 a líšia sa len rýdzosťou v stringoch (18k/750 vs 14k/585 vs 9k/375). Diamantové varianty pridávajú kategóriu 118 a kamene v stringoch, čím prebijú bezdiamantový základ. `SILVER` má prázdne strings — spolieha sa čisto na kategóriu 50. `OTHER` je fallback bez signálov (vyhrá len keď nič iné neboduje).

Typy šperku (`variants['jewelry_types']`), poradie = tie-break:

| variant (poradie) | cats | kľúčové strings |
|---|---|---|
| piercing | 14, 109, 42, 122 | piercing, plug, tunel, expander, podkova |
| anklets | 166, 167, 168 | naramok na nohu, naramky na nohu, anklet |
| rings | 75, 55, 5, 119, 26, 28, 111 | prsten, obruck, obrucka, ring |
| earrings | 77, 54, 11, 120, 113 | nausnic, naus, earring |
| necklaces | 80, 56, 34, 121, 114 | nahrdelnik, necklace |
| chains | 78, 52, 12 | retiaz, chain |
| bracelets | 79, 53, 6, 27, 112 | naramok, naramky, naramk, bracelet |
| pendants | 76, 51, 10, 123 | privesk, privesok, prives, pendant |
| sets | 81, 73, 126, 115 | suprav, sada, sety, set |
| other | (žiadne) | (žiadne) |

`gift_sizes`: `s` / `m` / `xl` — všetky bez cats a strings, teda zatiaľ vždy default `s`.

## Krok za krokom — od produktu k cene

1. Produkt má kategórie a text; načíta sa aj názov materiálu z `ps_material`.
2. Normalizuj text (lowercase + bez diakritiky), rozviň kategórie na subtree.
3. Oskóruj všetky `groups` (cats ×10 + strings ×1) → vyber najvyšší GROUP.
4. Podľa `groups[GROUP]['variants']` vezmi sadu (`jewelry_types` / `gift_sizes`), oskóruj ju → vyber VARIANT; pri nule použi `default_variant`.
5. Zlož triedu `<GROUP>/<VARIANT>`.
6. V `markups[VARIANT]` vyber tier podľa `purchase <= max_threshold`.
7. `selling = purchase × markup / 100`.
8. Zobraz s DPH: `selling × (1 + app()->taxRate()/100)`.

## Checklist — ako pridať nový materiál (GROUP)

- [ ] Pridaj kľúč do `groups`, napr. `PLATINUM`.
- [ ] Nastav `label` (slovensky, napr. „Platina").
- [ ] Zisti ID kategórie/-í materiálu v katalógu a daj do `cats` (rozhodujú, subtree match).
- [ ] Doplň `strings` ako fallback — už lowercase, bez diakritiky, ASCII (napr. `platina`, `pt950`).
- [ ] Nastav `variants => 'jewelry_types'` a `default_variant => 'other'`.
- [ ] Vyplň `markups` pre všetky varianty (rings…other). Zvyčajne rovnaký tier pre všetky: dvojica `[max_threshold => prah, markup => %]` + `[max_threshold => null, markup => %]`.
- [ ] Over, že markup je PLNÉ % nákupu (155 = +55 %), nie prirážka.
- [ ] Skontroluj, či nový materiál nekoliduje v cats s existujúcim (napr. diamantová podskupina musí mať navyše cat 118, aby prebila základ).
- [ ] Zosúlaď s `sperky_cenotvorba.xlsx` (config zrkadlí Excel).

## Checklist — ako pridať nový typ šperku (VARIANT)

- [ ] Pridaj kľúč do `variants['jewelry_types']` (a pri gift wrappingu do `gift_sizes`).
- [ ] Nastav `label`, `cats` (type-kategórie **naprieč všetkými** materiálmi), `strings` (lowercase bez diakritiky).
- [ ] Zaraď na správne miesto v poradí — špecifickejšie / kolízne varianty vyššie (tie-break). Ak sa string prekrýva s existujúcim (ako anklets vs bracelets), daj nový vyššie.
- [ ] Pridaj tento variant do `markups` **každého** GROUP-u, inak preň nebude cena.
- [ ] Skontroluj subtree kolízie (súrodenec vs potomok) v strome kategórií.

## Časté chyby / gotchas

- **Zámena markup vs prirážka.** `markup => 155` znamená predaj = 155 % nákupu (nie +155 %). 100 = náklad, pod 100 by bola strata.
- **Diakritika a case v strings.** Signály musia byť lowercase ASCII bez diakritiky, lebo text sa normalizuje pred matchom. `Pozlátené` v configu by nikdy nesedelo — preto je tam `pozlat`.
- **Nový variant bez markupu v niektorom GROUP-e.** Ak zabudneš pridať variant do `markups` daného materiálu, produkt danej triedy nedostane cenu. Pridávaj variant do všetkých skupín.
- **Spoliehanie na strings namiesto kategórie.** Keďže cats sú 10×, oprava klasifikácie ide cez správnu kategóriu, nie cez text. Zle zaradený produkt spadne na `OTHER`/`other`.
- **Prah je nákup bez DPH.** `max_threshold` sa porovnáva s `purchase_price`, ktorá je ex-DPH. Neporovnávaj ju s cenou s DPH.
- **Poradie tierov.** Tiery musia byť vzostupne podľa `max_threshold`, posledný `null`. Klasifikátor berie prvý sediaci — zlé poradie = zlý markup.
- **Diamant vs základ.** Diamantová podskupina musí mať v cats navyše 118 a diamantové stringy, inak ju prebije lacnejší bezdiamantový základ so zhodnými materiálovými cats.
- **DPH je jeden zdroj.** Nezadávaj 23 % na viacerých miestach — vždy `app()->taxRate()` čítajúce `pricing.php['tax']`.

## Súbory a miesta

- `pricing.php` — single source of truth cenotvorby a klasifikácie (návratové pole `tax`, `currency`, `groups`, `variants`). Zrkadlí `sperky_cenotvorba.xlsx`.
- `sperky_cenotvorba.xlsx` — biznisový zdroj markupov a prahov, z ktorého sa `pricing.php` udržiava.
- `ps_product.purchase_price` — nákupná cena bez DPH v EUR (vstup cenotvorby).
- `ps_material` — názov materiálu, jeden zo vstupov klasifikátora (do normalizovaného textu).
- `app()->taxRate()` — akcesor DPH, číta `pricing.php['tax']`.

## Zdroje

- `pricing.php` (hlavička s dokumentáciou modelu GROUP/VARIANT, autor Delaja Fedorco, 2026-07-08).
- Interný playbook `skills/biznis-sperky/cenotvorba-sklad.md` — ručná cenotvorba, marže vs markup, sklad a SKU (kontext pre obchodné rozhodnutia nad týmto configom).
