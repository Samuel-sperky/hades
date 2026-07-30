{{-- Vlastník: A4 (P11 — SPERKY e-shop).

     SKELETON. Obsah dopĺňa A4 v resources/js/screens/eshop.js.

     POVINNÉ OBMEDZENIA Z 08-SPERKY-API-SPEC.md (nález N1):
       - hlavné číslo obrazovky je POČET objednávok, nie obrat
       - obrat sa zobrazuje LEN rozpadnutý podľa country_iso, s priznaním, že
         mena je odhad; NIKDY jedno súhrnné číslo, NIKDY prepočet na EUR
       - varianty produktu sa NEZOBRAZUJÚ — API ich nevracia (nález N2)
       - všetky čísla sú vždy z API, nikdy z konštanty (nález N7)
       - keď health() = false, obrazovka to jasne povie a nespadne

     Stabilné id:
       #eshop-status   — stav integrácie (dostupnosť API)
       #eshop-kpi      — počty objednávok (deň / týždeň)
       #eshop-countries— rozpad podľa krajín (počty)
       #eshop-orders   — posledné objednávky (stránkované, live)
       #eshop-product  — vyhľadanie produktu podľa ID --}}
<section class="screen" id="screen-eshop">
    <header class="screen-head">
        <h1>E-shop</h1>
        <p class="screen-sub">Živé dáta zo sperky-eshop.sk — nič sa neukladá lokálne</p>
    </header>
    <div id="eshop-status" aria-live="polite"></div>
    <div id="eshop-kpi"></div>
    <div id="eshop-countries"></div>
    <div id="eshop-orders"></div>
    <div id="eshop-product"></div>
</section>
