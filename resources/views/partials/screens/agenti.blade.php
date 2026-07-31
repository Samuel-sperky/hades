{{-- Vlastník: W2 (DASHBOARDS — živé command centre agentov).

     Anatómia (vzor dnes.blade.php, §G4): .page-stack → .page-head → #agenti-body.
     JS (resources/js/screens/agenti.js) plní #agenti-body kartami agentov po
     kategóriách a živo ich aktualizuje cez WebSocket kanál 'agents'.

     Stabilné id (kontrakt s testom):
       #agenti-body     — kontajner kariet (KPI pás + sekcie kategórií)
       #agent-log       — drawer s posledným behom (log), skrytý kým sa neotvorí --}}
<section class="screen screen--wide" id="screen-agenti">
    <div class="page-stack">
        <header class="page-head">
            <p class="eyebrow">Vedomie</p>
            <h1>Agenti</h1>
            <p class="page-sub">Živé command centre — kto pracuje, ako a čo spustiť</p>
        </header>
        <div id="agenti-body"></div>
    </div>

    {{-- Log drawer — otvorí ho tlačidlo „Log" na karte agenta. --}}
    <aside id="agent-log" class="ag-log hidden" role="dialog" aria-modal="false"
           aria-labelledby="agent-log-title" aria-hidden="true">
        <div id="agent-log-backdrop" class="ag-log-backdrop"></div>
        <div class="ag-log-card">
            <div class="ag-log-head">
                <h2 id="agent-log-title" class="ag-log-title">Log agenta</h2>
                <button id="agent-log-close" class="ag-log-close ms" type="button" aria-label="Zavrieť log">close</button>
            </div>
            <div id="agent-log-body" class="ag-log-body" aria-live="polite"></div>
        </div>
    </aside>
</section>
