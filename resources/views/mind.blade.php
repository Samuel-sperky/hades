<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hades — AI mind</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='%23a78bfa'/><circle cx='50' cy='50' r='45' fill='none' stroke='%23a78bfa' stroke-opacity='.4' stroke-width='4'/></svg>">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0">
    <link rel="stylesheet" href="/css/mind.css">
</head>
<body>
    <canvas id="mind"></canvas>

    <header id="topbar">
        <div id="brand">
            <span id="state-dot" title="Stav vedomia"></span>
            <h1>Hades</h1>
            <span id="state-label">…</span>
        </div>
        <div id="controls">
            <div id="views" role="group" aria-label="Náhľad siete">
                <button data-view="map" title="Mapa oblastí">Mapa</button>
                <button data-view="net" title="Voľná sieť">Sieť</button>
                <button data-view="layers" title="Neurónové vrstvy">Vrstvy</button>
            </div>
            <div id="quick-bg-wrap" title="Intenzita pozadia">
                <span class="ms" aria-hidden="true">blur_on</span>
                <input type="range" id="quick-bg" data-opt="bg" min="0" max="1.5" step="0.05" aria-label="Intenzita pozadia">
            </div>
            <button id="btn-legend" class="ms" title="Legenda" aria-label="Legenda">category</button>
            <button id="btn-stats" class="ms" title="Štatistiky" aria-label="Štatistiky">monitoring</button>
            <button id="btn-settings" class="ms" title="Nastavenia zobrazenia" aria-label="Nastavenia zobrazenia">tune</button>
            <button id="btn-sound" class="ms" title="Zvuk" aria-label="Zvuk">volume_up</button>
            <button id="btn-ambient" class="ms" title="Ambient režim" aria-label="Ambient režim">fullscreen</button>
        </div>
    </header>

    <aside id="stats-panel" class="panel hidden" aria-label="Štatistiky vedomia">
        <h2>Vedomie</h2>
        <div id="stats-totals"></div>
        <h3>Oblasti</h3>
        <div id="stats-areas"></div>
        <h3>Najsilnejšie uzly</h3>
        <div id="stats-top"></div>
        <h3>Aktivita (30 dní)</h3>
        <canvas id="growth-chart" width="260" height="60"></canvas>
    </aside>

    <aside id="settings-panel" class="panel hidden" aria-label="Nastavenia zobrazenia">
        <h2>Zobrazenie</h2>
        <h3>Priehľadnosť</h3>
        <label class="slider">Panely
            <input type="range" data-opt="panelAlpha" min="0.3" max="1" step="0.01">
        </label>
        <label class="slider">Pozadie (plexus)
            <input type="range" data-opt="bg" min="0" max="1.5" step="0.05">
        </label>
        <label class="slider">Spojenia
            <input type="range" data-opt="edgeAlpha" min="0.1" max="1.5" step="0.05">
        </label>
        <label class="slider">Žiara uzlov
            <input type="range" data-opt="glow" min="0.2" max="1.5" step="0.05">
        </label>
        <label class="slider">Popisky
            <input type="range" data-opt="labelAlpha" min="0" max="1.5" step="0.05">
        </label>
        <h3>Veľkosti</h3>
        <label class="slider">Uzly
            <input type="range" data-opt="nodeScale" min="0.6" max="1.6" step="0.05">
        </label>
        <label class="slider">Písmo popiskov
            <input type="range" data-opt="labelSize" min="0.7" max="1.5" step="0.05">
        </label>
        <label class="slider">Hustota častíc
            <input type="range" data-opt="density" min="0" max="2" step="0.1">
        </label>
        <div class="row">
            <button id="opts-reset">Obnoviť predvolené</button>
        </div>
    </aside>

    <aside id="node-panel" class="panel hidden" aria-label="Detail uzla">
        <button class="close ms" id="node-close" aria-label="Zavrieť">close</button>
        <div id="node-view">
            <span id="node-type" class="badge"></span>
            <h2 id="node-label"></h2>
            <p id="node-meta"></p>
            <p id="node-desc"></p>
            <h3>Spojenia</h3>
            <div id="node-neighbors"></div>
            <h3>História</h3>
            <div id="node-history"></div>
            <div class="row">
                <button id="node-edit">Upraviť</button>
                <button id="node-delete" class="danger">Zmazať</button>
            </div>
        </div>
        <div id="node-form" class="hidden">
            <label>Názov<input id="edit-label" maxlength="255"></label>
            <label>Popis<textarea id="edit-desc" rows="5"></textarea></label>
            <div class="row">
                <button id="edit-save">Uložiť</button>
                <button id="edit-cancel">Zrušiť</button>
            </div>
        </div>
    </aside>

    <aside id="legend" class="hidden" aria-label="Legenda">
        <h3>Typy uzlov</h3>
        <div id="legend-types"></div>
        <h3>Oblasti</h3>
        <div id="legend-areas"></div>
    </aside>

    <div id="timeline">
        <button id="tl-play" class="ms" title="Prehrať rast vedomia" aria-label="Prehrať rast vedomia">play_arrow</button>
        <input type="range" id="tl-range" min="0" max="1000" value="1000" aria-label="Časová os">
        <span id="tl-label">teraz</span>
    </div>

    <div id="zoomctl" role="group" aria-label="Ovládanie kamery">
        <button id="zoom-in" class="ms" title="Priblížiť" aria-label="Priblížiť">add</button>
        <button id="zoom-out" class="ms" title="Oddialiť" aria-label="Oddialiť">remove</button>
        <button id="zoom-reset" class="ms" title="Vycentrovať" aria-label="Vycentrovať">center_focus_strong</button>
    </div>

    <div id="chat">
        <button id="chat-toggle" class="ms" title="Opýtaj sa Hadesa" aria-label="Opýtaj sa Hadesa">forum</button>
        <div id="chat-window" class="hidden">
            <div id="chat-head">Hades <button class="close ms" id="chat-close" aria-label="Zavrieť chat">close</button></div>
            <div id="chat-messages"></div>
            <form id="chat-form">
                <input id="chat-input" placeholder="Opýtaj sa, čo viem…" autocomplete="off">
                <button type="submit" class="ms" aria-label="Odoslať">send</button>
            </form>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/pusher-js@8/dist/web/pusher.min.js"></script>
    <script src="/js/mind.js"></script>
</body>
</html>
