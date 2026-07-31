{{-- Vlastník: SPERKY-FE (P11 — SPERKY e-shop).

     Markup napĺňa resources/js/screens/eshop.js (+ eshop/**); tu je len statický
     skelet, ktorý drží anatómiu obrazovky (page-head → toolbar → sekcie) a
     stabilné id. Formulár hľadania produktu je zámerne statický (nie generovaný
     JS), aby sa dal použiť aj keď /api/eshop/summary padne.

     POVINNÉ OBMEDZENIA Z 08b-SPERKY-API-SPEC-V2.md:
       - hlavné čísla obrazovky sú POČTY objednávok, nie obrat
       - obrat je samostatná sekcia s jedným riadkom na menu (EUR, HUF, RON,
         PLN, CZK); NIKDY jedno číslo naprieč menami, NIKDY prepočet na EUR
       - mena je autoritatívna z API — žiadny odhad z krajiny, žiadna značka
         „odhad"; suma sa však nikdy nezobrazí bez meny
       - varianty produktu sa ZOBRAZUJÚ vrátane stavu zásoby (rozhodnutie 4)
       - filter sumy je aktívny len s vybranou krajinou (rozhodnutie 8)
       - všetky čísla sú vždy z API, nikdy z konštanty
       - keď health() = false, obrazovka to jasne povie a nespadne

     Stabilné id:
       #eshop-status         — stav integrácie (dostupnosť API), aria-live
       #eshop-refresh        — znovunačítanie živých dát
       #eshop-window         — prepínač dátumového okna (7 / 30 / 90 dní)
       #eshop-kpi            — počty objednávok (hlavné čísla)
       #eshop-revenue        — obrat po menách (samostatná sekcia)
       #eshop-days           — počty objednávok po dňoch v okne
       #eshop-countries      — rozpad podľa krajín (presné počty)
       #eshop-filters        — filtre zoznamu: krajina + suma od
       #eshop-orders         — posledné objednávky (stránkované, live)
       #eshop-order-detail   — detail vybranej objednávky, aria-live
       #eshop-product-form   — hľadanie produktu podľa id
       #eshop-product-id     — vstup id produktu
       #eshop-product-result — výsledok hľadania (vrátane variantov), aria-live --}}
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
            <span class="es-win-label">Okno</span>
            <span class="es-window" id="eshop-window" role="group" aria-label="Dátumové okno"></span>
            <span class="toolbar-note" id="eshop-checked"></span>
        </div>

        <div id="eshop-status" role="status" aria-live="polite"></div>
        <div id="eshop-kpi"></div>
        <div id="eshop-revenue"></div>
        <div id="eshop-days"></div>
        <div id="eshop-countries"></div>

        <div class="es-filters" id="eshop-filters"></div>
        <div id="eshop-orders"></div>
        <div id="eshop-order-detail" aria-live="polite"></div>

        <section class="screen-sec es-product">
            <div class="section-head">
                <h2 class="section-title">Produkt podľa ID</h2>
                <span class="sec-note">vrátane variantov a zásoby</span>
            </div>
            <form class="es-find" id="eshop-product-form" autocomplete="off">
                <label class="es-find-label" for="eshop-product-id">ID produktu</label>
                <input class="es-find-input" id="eshop-product-id" name="id" type="number"
                       min="1" step="1" inputmode="numeric" placeholder="napr. 49"
                       aria-describedby="eshop-find-hint">
                <button type="submit" class="primary es-find-go" aria-label="Nájsť produkt podľa ID">
                    <span class="ms" aria-hidden="true">search</span>Nájsť
                </button>
            </form>
            <p class="es-note" id="eshop-find-hint">
                Katalóg je verejný — kľúč netreba. Pri produkte s variantmi sa vypíše tabuľka
                s príplatkom, referenciou, EAN13 a stavom zásoby.
            </p>
            <div id="eshop-product-result" aria-live="polite"></div>
        </section>
    </div>
</section>
