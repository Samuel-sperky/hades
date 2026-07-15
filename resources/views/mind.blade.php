<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hades — AI mind</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='%23a78bfa'/><circle cx='50' cy='50' r='45' fill='none' stroke='%23a78bfa' stroke-opacity='.4' stroke-width='4'/></svg>">
    <link rel="stylesheet" href="/css/mind.css">
</head>
<body>
    <canvas id="mind"></canvas>

    <header id="topbar">
        <div id="brand">
            <span id="state-dot" title="stav"></span>
            <h1>Hades</h1>
            <span id="state-label">…</span>
        </div>
        <div id="controls">
            <div id="views">
                <button data-view="map" title="Mapa oblastí">Mapa</button>
                <button data-view="net" title="Voľná sieť">Sieť</button>
                <button data-view="layers" title="Neurónové vrstvy">Vrstvy</button>
            </div>
            <button id="btn-stats" title="Štatistiky">📊</button>
            <button id="btn-sound" title="Zvuk">🔊</button>
            <button id="btn-ambient" title="Ambient režim">⛶</button>
        </div>
    </header>

    <aside id="stats-panel" class="panel hidden">
        <h2>Vedomie</h2>
        <div id="stats-totals"></div>
        <h3>Oblasti</h3>
        <div id="stats-areas"></div>
        <h3>Najsilnejšie uzly</h3>
        <div id="stats-top"></div>
        <h3>Aktivita (30 dní)</h3>
        <canvas id="growth-chart" width="260" height="60"></canvas>
    </aside>

    <aside id="node-panel" class="panel hidden">
        <button class="close" id="node-close">×</button>
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

    <div id="timeline">
        <button id="tl-play" title="Prehrať rast vedomia">▶</button>
        <input type="range" id="tl-range" min="0" max="1000" value="1000">
        <span id="tl-label">teraz</span>
    </div>

    <div id="chat">
        <button id="chat-toggle" title="Opýtaj sa Hadesa">💬</button>
        <div id="chat-window" class="hidden">
            <div id="chat-head">Hades <button class="close" id="chat-close">×</button></div>
            <div id="chat-messages"></div>
            <form id="chat-form">
                <input id="chat-input" placeholder="Opýtaj sa, čo viem…" autocomplete="off">
                <button type="submit">➤</button>
            </form>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/pusher-js@8/dist/web/pusher.min.js"></script>
    <script src="/js/mind.js"></script>
</body>
</html>
