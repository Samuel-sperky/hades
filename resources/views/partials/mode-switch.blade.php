{{-- Vlastník: W2 (3-pill prepínač troch pilierov — vzor skilltree.altari.ai).

     MAP → obrazovka 'graf' (radiálna mapa), DASHBOARDS → 'agenti' (command centre),
     CHART → 'chart' (rollout tabuľka, dodá W3 — dovtedy je tlačidlo disabled).

     Prepínač je viditeľný len na obrazovkách tejto rodiny (graf/agenti/chart) —
     rieši to CSS cez body[data-screen] (shell/mode-switch.css), takže JS o
     viditeľnosti nič nevie. Chovanie drôtuje shell/mode-switch.js na data-mode. --}}
<div id="mode-switch" role="group" aria-label="Režim zobrazenia">
    <button data-mode="graf" type="button" aria-label="Mapa vedomia">MAP</button>
    <button data-mode="agenti" type="button" aria-label="Dashboardy agentov">DASHBOARDS</button>
    <button data-mode="chart" type="button" aria-label="Rollout agentov (čoskoro)">CHART</button>
</div>
