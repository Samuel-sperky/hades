{{-- Vlastník: A5 (P10 — obrazovky).

     Aura anatómia (§G4 UX plánu, komponenty vlastní P9 v components/page.css):
     .page-stack → .page-head (.eyebrow + h1 + .page-sub) → obsah.
     Eyebrow zrkadlí grupu v raili (Vedomie / Záznamy / Znalosti / Prevádzka),
     takže obrazovka a navigácia hovoria to isté bez zdieľaného kódu.

     Stabilné id (kontrakt so smoke testom):
       #dnes-body — celý obsah dashboardu (KPI, grafy, sync, panel LLM) --}}
<section class="screen screen--wide" id="screen-dnes">
    <div class="page-stack">
        <header class="page-head">
            <p class="eyebrow">Vedomie</p>
            <h1>Dnes</h1>
            <p class="page-sub">Čo sa práve deje vo vedomí</p>
        </header>
        <div id="dnes-body"></div>
    </div>
</section>
