{{-- Vlastník: A5 (P10 — obrazovky).

     Kontrola nie je len „fronta needs_review". Tá má dnes 5 uzlov zo 684, takže
     obrazovka pôsobila rozbito. Po P10 je to triedič istoty: pokrytie (koľko
     poznatkov nesie značku), fronta na overenie a fronta „bez istoty".
     Rozhodnutie 132/49: model NIKDY nedopĺňa certainty sám — značkuje človek tu.

     Stabilné id:
       #kontrola-stats — KPI pás pokrytia (z /api/dashboard)
       #kontrola-tabs  — prepínač fronty (role=tablist)
       #kontrola-body  — zoznam (kontrakt so smoke testom a shortcuts.js:
                         `#kontrola-body .queue-item[data-id]`) --}}
<section class="screen" id="screen-kontrola">
    <div class="page-stack">
        <header class="page-head">
            <p class="eyebrow">Prevádzka</p>
            <h1>Kontrola</h1>
            <p class="page-sub">Istota poznatkov — čo je overené, čo čaká a čo nikto nikdy neoznačil</p>
        </header>
        <div id="kontrola-stats"></div>
        <div class="screen-toolbar" id="kontrola-tabs" role="tablist" aria-label="Fronty kontroly"></div>
        <div id="kontrola-body"></div>
    </div>
</section>
