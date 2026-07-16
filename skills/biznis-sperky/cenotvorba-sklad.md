# Cenotvorba + sklad šperkov

> Praktický referenčný playbook pre kalkuláciu cien šperkov Aura, cenové stratégie a riadenie skladu, variantov (SKU), nákupu a sezónnosti.

## Prehľad — čo to je a prečo to pre Auru je dôležité

Cenotvorba a riadenie skladu sú dve najviac prepletené finančné páky celého šperkárskeho biznisu. Zle nastavená cena buď zabíja maržu (predávaš pod nákladmi a nevieš o tom), alebo zabíja objem (si drahá bez opodstatnenia). Zle riadený sklad viaže hotovosť v kuse kovu a kameňov, ktoré ležia mesiace bez predaja — a práve cash flow býva to, čo malé šperkárske značky položí, nie nedostatok dopytu.

Pre Auru je to kritické z troch dôvodov:

1. **Materiál je volatilný.** Zlato v roku 2025 lámalo rekordy a v 2026 sa obchoduje výrazne vyššie než ešte pred dvoma rokmi. Striebro ho nasleduje. Ak cenu nastavíš raz a "zabudneš", pri rastúcich cenách kovu ticho skĺzneš do straty na každom kuse.
2. **Vysoký počet SKU.** Jeden dizajn v 3 kovoch a 4 veľkostiach = 12 SKU. Katalóg 30 modelov ľahko narastie na stovky variantov. Bez disciplinovaného SKU systému sa stráca prehľad o tom, čo reálne zarába.
3. **Extrémna sezónnosť.** Šperky majú najkoncentrovanejší sezónny dopyt z celého retailu — Valentín + Vianoce môžu tvoriť 40–60 % ročných tržieb. To znamená, že nákup a sklad sa musia plánovať mesiace dopredu.

Cieľ playbooku: mať jeden opakovateľný vzorec na cenu, jeden systém na SKU a jeden rytmus na nákup a repricing, aby sa rozhodovania nerobili "od oka".

## Kľúčové pojmy — glosár

- **COGS (Cost of Goods Sold)** — priame náklady na výrobu kusu: materiál + priama práca. Základ každej ceny.
- **Materiálový náklad** — súčet všetkých vstupov v konkrétnom kuse: kov (podľa aktuálnej ceny za gram), kamene, retiazka, zapínanie, drôt, spájka, galvanika/pokovovanie. Vždy v **aktuálnych** trhových cenách, nie v tých, za ktoré si kúpila zásobu pred rokom.
- **Práca (labor)** — hodiny na dizajn, výrobu, dokončenie (leštenie), kontrolu kvality a balenie × hodinová sadzba. Minimum sa dnes odporúča 15–20 €/hod, pri metalsmithingu a špecializovaných zručnostiach výrazne viac.
- **Overhead (režia)** — nepriame náklady: nájom dielne, energie, nástroje a ich údržba, poistenie, software, marketing, balenie, poštovné. Alokuje sa buď ako % z (materiál + práca), alebo súčtom mesačných nákladov delený počtom vyrobených kusov.
- **Marža (profit margin)** — zisk ako **% z predajnej ceny** (nie z nákladov). Pozor na zámenu s markupom.
- **Markup (prirážka)** — násobok nákladov (COGS). Napr. 3× COGS = markup 200 %. Marža a markup nie sú to isté: markup 2× = marža 50 %, markup 4× = marža 75 %.
- **Keystone** — tradičný retailový štandard: predajná = 2× veľkoobchodná cena (2× COGS). V DTC e-commerce je dnes takmer vždy nedostatočný.
- **Wholesale (veľkoobchodná) cena** — cena pre butiky/predajcov, typicky 50 % z retailu (2–2,5× COGS).
- **Retail (maloobchodná) cena** — koncová cena pre zákazníka.
- **SKU (Stock Keeping Unit)** — jedinečný kód konkrétneho variantu (model + kov + veľkosť). Nie parent produkt, ale konkrétny predávateľný variant.
- **Variant** — kombinácia atribútov (napr. Luna prsteň / striebro / veľkosť 54). Každý variant = 1 SKU.
- **Reorder point (bod objednania)** — hladina zásoby, pri ktorej treba znovu objednať, aby si nevypredala počas lead time.
- **Safety stock (poistná zásoba)** — vankúš navyše proti výkyvom dopytu a oneskoreniu dodávok.
- **Lead time** — čas od objednávky materiálu/výroby po naskladnenie.
- **Inventory turns (obrátky zásob)** — koľkokrát za rok sa sklad "pretočí". Vyššie = menej viazanej hotovosti.
- **Days of inventory (DOI)** — na koľko dní predaja máš zásobu.
- **Open-to-buy (OTB)** — nákupný rozpočet na obdobie: koľko smieš minúť na nový sklad podľa plánovaného predaja.
- **Sell-through rate** — % kolekcie predané za dané obdobie; kľúčové pre sezónne drops.
- **AOV (Average Order Value)** — priemerná hodnota objednávky.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Cenový vzorec — kanónický tvar

Odporúčaný "profi" vzorec (marža ako podiel z ceny, nie ako markup):

```
Predajná cena = (Materiál + Práca) × (1 + Overhead %) ÷ (1 − Marža %)
```

Zjednodušený DTC vzorec, keď nemáš wholesale:

```
Retail = (Materiál + Práca + Overhead) × 2,5 až 3
```

Klasický dvojkrokový (ak plánuješ aj wholesale):

```
Wholesale = (Materiál + Práca + Overhead) × 2
Retail    = Wholesale × 2
```

### Násobky podľa kanála a úrovne (2025/2026 benchmark)

- **Keystone (2× COGS)** — tradičný kamenný retail. Pre online **nestačí** — nepokryje akvizíciu zákazníka (ads), dopravu zdarma ani spracovanie vratiek.
- **DTC e-commerce: 4–5× COGS** — dnešný štandard pre online značky, práve aby pokryl CAC, shipping a platform fees.
- **Wholesale do butikov: 2–2,5× COGS.**
- Podľa skúsenosti/pozicioningu: začiatočník 2,5–3×, stredne pokročilý 3–4×, profesionál 4–6×, luxus 6–10×.
- **Cieľová marža:** zdravý štart je 35–50 % marže na retaile a wholesale = 50 % retailu. Wholesale "podlaha" = materiál + práca + overhead bez ďalšej marže — pod ňu nikdy nejdi.

### Čo sa zmenilo v 2025/2026

- **Cena zlata a striebra sa stala aktívnou premennou, nie konštantou.** Zlato v 2025 na rekordoch, prognózy na koniec 2026 smerujú vysoko (rádovo tisíce USD/oz). Dôsledok: **repricing threshold** — nastav si prah, typicky **10–15 % pohyb** ceny hlavného materiálu oproti bodu, kde si naposledy cenila. Keď kov prekročí prah nahor či nadol, prehodnoť ceny. Toto je najväčšia zmena oproti "nastav raz a zabudni" praxi z minulých rokov.
- **Posun z keystonu na 4–5× v DTC.** Rastúce náklady na reklamu (Meta/Google CAC) a očakávanie dopravy zdarma spravili z keystonu stratovú stratégiu online.
- **Vysoko-SKU fulfillment a barcode/RFID** sa stali normou aj pre malé značky — kvôli synchronizácii skladu naprieč Shopify/Etsy/Amazon.
- **Cash-trap povedomie** — silný dôraz na to, že sklad = zamrznutá hotovosť; plánuje sa cez OTB rozpočet a DOI ciele, nie "kúpim, čo sa mi páči".

### Sklad a SKU (2025/2026)

- **Nikdy nenechávaj SKU pole prázdne.** Shopify ho nevyžaduje pri vytvorení produktu, ale prázdne SKU je katastrofa pre synchronizáciu a fulfillment.
- **Track quantity per variant.** V Shopify má každý variant vlastný prepínač sledovania zásob — zapni ho na každej veľkosti/kove zvlášť, produktová úroveň nestačí.
- **Audit skladu minimálne mesačne** (kvartálne nestačí rastúcemu katalógu) — hľadaj chýbajúce SKU, duplicitné SKU a varianty s nulovou zásobou.
- **Benchmark obrátok 2026:** core replenishable modely cieľ **3–4 obrátky/rok a 90–120 dní zásob**.
- **Split katalógu:** oddel **core replenishment** (stále modely, riadené reorder pointom) od **sezónnych drops** (plánované cez forward-weeks-of-supply a sell-through).

## Krok za krokom — pracovný postup

### A. Nacenenie jedného nového modelu

1. **Rozpíš kusovník (BOM).** Zapíš každý vstup: gramáž kovu × aktuálna cena/g, každý kameň, retiazku, zapínanie, spotrebný materiál (spájka, galvanika). Použi **dnešnú** cenu kovu.
2. **Zmeraj čas.** Odstopuj reálne minúty na dizajn (amortizuj cez počet kusov), výrobu, leštenie, QC a balenie. Vynásob hodinovou sadzbou (min. 15–20 €/hod, viac za náročnosť).
3. **Spočítaj COGS** = materiál + práca.
4. **Pridaj overhead.** Buď % prirážkou k COGS, alebo mesačná režia ÷ počet kusov/mesiac.
5. **Aplikuj vzorec.** Retail = (Materiál + Práca) × (1 + Overhead %) ÷ (1 − Marža %). Cieľ marže 35–50 %.
6. **Cross-check násobkom.** Over, či retail vychádza rádovo na 4–5× COGS (DTC). Ak je pod 3×, marža je tenká; ak nad 6× bez luxus pozicioningu, over konkurenciu.
7. **Over trh a pozicioning.** Vzorec dáva podlahu, nie strop. Ak trh a vnímaná hodnota unesú viac, cena môže ísť vyššie — vzorec je poistka proti podceneniu, nie zákon.
8. **Zaokrúhli psychologicky** (napr. 49 €, 89 €) a zapíš do cenníka s dátumom a cenou kovu, pri ktorej cena platí.

### B. Nastavenie SKU pre variant

1. **Definuj schému SKU:** `TYP-MODEL-KOV-VEĽKOSŤ`. Príklad: prsteň Luna, striebro, veľkosť 54 → `PR-LUNA-AG-54`; náhrdelník Aura, pozlátené, 45 cm → `NA-AURA-GP-45`.
2. **Len písmená, čísla, pomlčky.** Žiadne medzery ani špeciálne znaky — kvôli spracovaniu naprieč systémami.
3. **Vytvor všetky varianty** a **na každom zapni Track quantity**.
4. **Naskladni počiatočné množstvo** a nastav reorder point + safety stock (viď C).
5. **Zaraď do triedy:** A (bestseller/core), B (stredný), C (dlhý chvost / sezónne).

### C. Nákup a doplňovanie

1. **Klasifikuj SKU do A/B/C** podľa obrátky a marže.
2. **Core (A/B):** vypočítaj reorder point = (priemerný denný predaj × lead time) + safety stock. Doplň späť na DOI cieľ (90–120 dní), keď zásoba klesne pod trigger.
3. **Safety stock** = (max denný predaj × max lead time) − (priem. denný predaj × priem. lead time). Pre A-tier pred Valentínom drž 3–4 týždne poistnej zásoby.
4. **Sezónne drops (C):** plánuj cez forward-weeks-of-supply a sell-through, nie cez reorder point — po sezóne dopredaj, nedopĺňaj.
5. **Nastav OTB rozpočet** na obdobie: koľko smieš minúť na nový sklad podľa plánovaného predaja, aby si neviazala hotovosť.
6. **Dodávatelia:** drž min. 2 zdroje pri kritických vstupoch, sleduj ich lead time a spoľahlivosť, prehodnocuj podľa reálnych dodávok.

### D. Sezónny rytmus

1. **Plánuj naopak od špičiek:** Vianoce (nov–dec), Valentín (feb), Deň matiek (máj), svadobná sezóna (jar–leto), promócie (jún).
2. **Objednávaj materiál/výrobu s dostatočným predstihom** pred špičkou (podľa lead time + safety).
3. **Po špičke agresívne dopredaj** sezónne kusy, aby neviazali hotovosť — sklad je zamrznutá cash.

### E. Repricing (kvartálne + trigger)

1. **Kvartálne** prejdi cenník proti aktuálnej cene kovu.
2. **Trigger:** keď hlavný materiál (zlato/striebro) prekročí **10–15 %** oproti bodu poslednej cenotvorby, preceň dotknuté modely.
3. Priebežne aktualizuj hodnotu skladu podľa aktuálnych cien kovu (nielen predajné ceny).

## Checklist

**Cenotvorba**
- [ ] Kusovník (BOM) rozpísaný do posledného vstupu?
- [ ] Použitá **dnešná** cena kovu za gram?
- [ ] Reálne zmeraný čas × férová sadzba (min. 15–20 €/hod)?
- [ ] Overhead zahrnutý (nájom, nástroje, marketing, balenie, poštovné)?
- [ ] Marža 35–50 % a cross-check na 4–5× COGS (DTC)?
- [ ] Wholesale nikdy pod podlahu (materiál + práca + overhead)?
- [ ] Cena zapísaná s dátumom a referenčnou cenou kovu?

**Sklad / SKU**
- [ ] Každý variant má neprázdne SKU podľa schémy?
- [ ] Track quantity zapnuté na každom variante?
- [ ] SKU zaradené do tried A/B/C?
- [ ] Reorder point + safety stock nastavené pre core?
- [ ] Mesačný audit (chýbajúce/duplicitné SKU, nulové zásoby)?
- [ ] OTB rozpočet na obdobie definovaný?

**Sezóna / repricing**
- [ ] Nákup pred špičkou naplánovaný s predstihom (lead time)?
- [ ] Po-sezónny doprodaj naplánovaný?
- [ ] Kvartálny repricing prebehol?
- [ ] Trigger 10–15 % pohybu kovu ustrážený?

## Časté chyby a ako sa im vyhnúť

1. **Zamieňanie marže a markupu.** "Chcem 50 % zisk" a nastavíš 1,5× náklady = v skutočnosti len 33 % marža. Riešenie: maržu počítaj ako % z **ceny**, nie z nákladov (vzorec s ÷ (1 − Marža %)).
2. **Cena kovu "zamrznutá v čase."** Cenníš podľa toho, čo si za kov zaplatila pred rokom. Pri rastúcom zlate predávaš pod nákladmi. Riešenie: aktuálna cena/g + repricing trigger.
3. **Neplatíš si prácu.** Do ceny dáš len materiál a "nejaký zisk". Riešenie: hodiny × sadzba sú povinná položka.
4. **Zabudnutý overhead.** Nájom, nástroje, balenie, poštovné a ads sa "stratia". Riešenie: overhead ako pevná zložka vzorca.
5. **Keystone online.** 2× COGS na e-shope nepokryje ads a dopravu → strata. Riešenie: DTC 4–5× COGS.
6. **Prázdne SKU pole.** Vyzerá neškodne, rozbije synchronizáciu a fulfillment. Riešenie: každý variant má SKU pred publikovaním.
7. **Track quantity len na produkte.** Varianty potom nesledujú zásobu. Riešenie: zapni per-variant.
8. **Preinvestovaný sklad (cash trap).** Kúpiš, čo sa páči, hotovosť zamrzne v kuse. Riešenie: OTB rozpočet + DOI ciele + obrátky 3–4×.
9. **Rovnaká stratégia pre core aj sezónne.** Dopĺňaš vianočný kus vo februári. Riešenie: A/B/C split, sezónne cez sell-through, nie reorder point.
10. **Nákup nezohľadňujúci lead time pred špičkou.** Objednáš v novembri na Vianoce a nestihneš. Riešenie: plánuj naopak od dátumu špičky mínus lead time + safety.
11. **Audit len kvartálne.** Rastúci katalóg medzitým nazbiera duplicity a nulové zásoby. Riešenie: minimálne mesačne.
12. **Cena len podľa vzorca, ignorovanie trhu.** Vzorec je podlaha; ak vnímaná hodnota unesie viac, necháš peniaze na stole. Over konkurenciu a pozicioning.

## Nástroje

- **Craftybase** — inventory + pricing pre makerov; sleduje materiálové náklady, COGS a maržu; má kalkulačku cien šperkov.
- **Shopify** — katalóg, varianty, per-variant tracking, inventory reporty; jadro DTC predaja.
- **Inventory Planner / Prediko** — pokročilé forecastovanie, OTB, reorder pointy nad Shopify.
- **Sumtracker / Extensiv / Linnworks** — multi-channel sync skladu (Shopify + Etsy + Amazon), audit SKU.
- **PIRO** — dedikovaný jewelry software (výroba + sklad) pre väčšie prevádzky.
- **Barcode/RFID skener** — fyzická inventúra a rýchly príjem pri vysokom počte SKU.
- **Vlastný pricing sheet (Google Sheets/Excel)** — BOM kalkulačka s premennou cenou kovu za gram a repricing triggerom; najlacnejší štart.
- **Kitco / cenové feedy kovov** — sledovanie spot ceny zlata/striebra pre repricing trigger.

## Zdroje

- [Jewelry Store Profit Margin: Pricing Formula & Benchmarks — Branvas](https://branvas.com/blogs/news/how-to-price-jewelry-for-profit)
- [Free Jewelry Pricing Calculator — Craftybase](https://craftybase.com/jewelry-pricing-calculator)
- [The Jewelry Pricing Formula Every Maker Needs to Know — Craftybase](https://craftybase.com/blog/jewelry-pricing-formula)
- [How Much Markup on Jewelry? 2025 Insider Pricing Guide — OY Display](https://oydisplay.com/how-much-markup-on-jewelry-an-insiders-guide-to-pricing/)
- [How to Price Jewelry: Pricing Formulas Are not Everything! — Halstead](https://www.halsteadbead.com/articles/pricing-your-jewelry)
- [How to Price Your Jewelry: A Guide for Independent Jewelers — Metalsmith Society](https://metalsmithsociety.com/a/blog/how-to-price-your-jewelry-guide-for-independent-jewelers)
- [Shopify Jewelry Inventory Management: A Complete Guide — Sumtracker](https://www.sumtracker.com/blog/jewelry-accessories-inventory-management-shopify)
- [Shopify Inventory Management for Jewelry Stores: Complete Guide (2026) — Debnix](https://www.debnix.com/blog/shopify-inventory-management-jewelry-store)
- [Shopify Jewelry SKU System: Variants & Pricing Rules — Branvas](https://branvas.com/blogs/news/shopify-jewelry-sku-variants-pricing)
- [High-SKU Jewelry Brands: How to Stay Organized with Smart Fulfillment — eFulfillment Service](https://www.efulfillmentservice.com/2025/09/high-sku-jewelry-brands-how-to-stay-organized-with-smart-fulfillment/)
- [Jewelry Brand Inventory Planning: The Cash Trap Guide — Eightx](https://eightx.co/blog/jewelry-brand-inventory-planning)
- [Reorder Point Calculator and Formula Guide — inFlow](https://www.inflowinventory.com/blog/reorder-point-formula-safety-stock/)
- [Strategy to Manage Seasonality in the Custom Jewelry Business — AssetLab](https://assetlab.us/strategy-to-manage-seasonality-in-the-custom-jewelry-business/)
- [Inventory management best practices for jewelers — PIRO](https://www.gopiro.com/blog/inventory-management-best-practices-jewelers)
