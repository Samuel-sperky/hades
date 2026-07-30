{{-- Vlastník: A4 (P8 — interakcia grafu).
     Markup nesie data-view (číta shell/view-switch.js, A5) a data-dock (číta
     shell/dock.js, A5) — to je zámer kontraktu data-*: A5 drôtuje chovanie na
     markup A4 bez toho, aby tento súbor otvorila. --}}
<div id="graph-tools" role="group" aria-label="Nástroje grafu">
    <button id="btn-structure" class="ms" data-dock="structure" title="Štruktúra (R)" aria-label="Štruktúra">account_tree</button>
    <button id="btn-stats" class="ms" data-dock="stats" title="Prehľad (S)" aria-label="Prehľad">monitoring</button>
    <button id="btn-legend" class="ms" data-dock="legend" title="Legenda (L)" aria-label="Legenda">category</button>
</div>
<div id="view-switch" role="group" aria-label="Náhľad siete">
    <button data-view="map">Mapa</button>
    <button data-view="net">Sieť</button>
    <button data-view="layers">Vrstvy</button>
</div>
{{-- Časová os (prehrávanie rastu siete). Do W2 chýbal markup, takže graph/timeline.js
     nemal volajúceho (CLAUDE.md §7.5) — dopĺňa ho P8. Kontejner je skrytý a odkryje
     ho až graph/timeline.js::register(), aby bez zadrôtovania nesvietilo mŕtve UI. --}}
<div id="timeline" class="hidden" role="group" aria-label="Prehrávanie rastu siete">
    <button id="tl-play" class="ms" type="button" aria-label="Prehrať rast siete" aria-pressed="false">play_arrow</button>
    <input id="tl-range" type="range" min="0" max="1000" step="1" value="1000" aria-label="Časová os siete">
    <span id="tl-label" aria-live="polite">teraz</span>
</div>
