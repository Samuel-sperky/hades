{{-- Vlastník: SPERKY-FE (P11 — SPERKY e-shop).

     Markup napĺňa resources/js/screens/eshop.js; tu je len statický skelet,
     ktorý drží anatómiu obrazovky (page-head → toolbar → sekcie) a stabilné id.
     Formulár hľadania produktu je zámerne statický (nie generovaný JS), aby sa
     dal použiť aj keď /api/eshop/summary padne.

     POVINNÉ OBMEDZENIA Z 08-SPERKY-API-SPEC.md (nález N1):
       - hlavné číslo obrazovky je POČET objednávok, nie obrat
       - obrat sa zobrazuje LEN rozpadnutý podľa country_iso, s priznaním, že
         mena je odhad; NIKDY jedno súhrnné číslo, NIKDY prepočet na EUR
       - varianty produktu sa NEZOBRAZUJÚ — API ich nevracia (nález N2)
       - všetky čísla sú vždy z API, nikdy z konštanty (nález N7)
       - keď health() = false, obrazovka to jasne povie a nespadne

     Stabilné id:
       #eshop-status         — stav integrácie (dostupnosť API), aria-live
       #eshop-refresh        — znovunačítanie živých dát
       #eshop-kpi            — počty objednávok (hlavné číslo)
       #eshop-days           — počty objednávok po dňoch v okne
       #eshop-countries      — rozpad podľa krajín (počty + sumy po menách)
       #eshop-orders         — posledné objednávky (stránkované, live)
       #eshop-order-detail   — detail vybranej objednávky, aria-live
       #eshop-product-form   — hľadanie produktu podľa id
       #eshop-product-id     — vstup id produktu
       #eshop-product-result — výsledok hľadania, aria-live --}}
<section class="screen screen--wide" id="screen-eshop">
    <div class="page-stack">
        <header class="page-head">
            <p class="eyebrow">Integrácia</p>
            <h1>E-shop</h1>
            <p class="page-sub">Živé dáta zo sperky-eshop.sk — nič sa neukladá lokálne</p>
        </header>

        <div class="screen-toolbar">
            <button type="button" class="chip chip--action" id="eshop-refresh"
                    aria-label="Znovu načítať živé dáta z e-shopu">
                <span class="ms" aria-hidden="true">refresh</span>Načítať znova
            </button>
            <span class="toolbar-note" id="eshop-checked"></span>
        </div>

        <div id="eshop-status" role="status" aria-live="polite"></div>
        <div id="eshop-kpi"></div>
        <div id="eshop-days"></div>
        <div id="eshop-countries"></div>

        <div id="eshop-orders"></div>
        <div id="eshop-order-detail" aria-live="polite"></div>

        <section class="screen-sec es-product">
            <div class="section-head">
                <h2 class="section-title">Produkt podľa ID</h2>
                <span class="sec-note">varianty API nevracia</span>
            </div>
            <form class="es-find" id="eshop-product-form" autocomplete="off">
                <label class="es-find-label" for="eshop-product-id">ID produktu</label>
                <input class="es-find-input" id="eshop-product-id" name="id" type="number"
                       min="1" step="1" inputmode="numeric" placeholder="napr. 22"
                       aria-describedby="eshop-find-hint">
                <button type="submit" class="primary es-find-go" aria-label="Nájsť produkt podľa ID">
                    <span class="ms" aria-hidden="true">search</span>Nájsť
                </button>
            </form>
            <p class="es-note" id="eshop-find-hint">
                Katalóg je verejný — kľúč netreba. Varianty produktu API nevracia (nález N2),
                obrazovka ich preto nezobrazuje.
            </p>
            <div id="eshop-product-result" aria-live="polite"></div>
        </section>
    </div>
</section>
