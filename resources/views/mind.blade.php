<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hades — AI mind</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='%23b88a3a'/><circle cx='50' cy='50' r='45' fill='none' stroke='%2303797e' stroke-opacity='.4' stroke-width='4'/></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Playfair+Display:wght@500;600;700&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&display=swap">
    <link rel="stylesheet" href="/css/mind.css">
</head>
<body>
    <canvas id="mind"></canvas>

    <nav id="rail" aria-label="Hlavná navigácia">
        <button id="brand-core" type="button" title="Hades" aria-label="Hades — vycentrovať">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <path d="M12 2l2.2 5.8L20 6.4l-3.6 4.9L20 17.6l-6-1.7L12 22l-2-6.1-6 1.7 3.6-6.3L4 6.4l5.8 1.4z" fill="currentColor"/>
            </svg>
        </button>

        <div class="rail-group" role="group" aria-label="Sekcie">
            <button id="btn-search" class="ms" title="Vyhľadať uzol (F)" aria-label="Vyhľadať uzol">search</button>
            <button id="btn-stats" class="ms" title="Štatistiky (S)" aria-label="Štatistiky">monitoring</button>
            <button id="btn-legend" class="ms" title="Legenda (L)" aria-label="Legenda">category</button>
            <button id="btn-timeline" class="ms" title="Časová os (T)" aria-label="Časová os">history</button>
        </div>

        <div class="rail-group bottom" role="group" aria-label="Systém">
            <button id="btn-theme" class="ms" title="Svetlá / tmavá téma (D)" aria-label="Prepnúť tému">dark_mode</button>
            <button id="btn-ambient" class="ms" title="Ambient režim" aria-label="Ambient režim">fullscreen</button>
            <button id="btn-settings" class="ms" title="Nastavenia zobrazenia" aria-label="Nastavenia zobrazenia">tune</button>
        </div>
    </nav>

    <div id="view-switch" role="group" aria-label="Náhľad siete">
        <button data-view="map">Mapa</button>
        <button data-view="net">Sieť</button>
        <button data-view="layers">Vrstvy</button>
    </div>

    <aside id="dock" class="hidden" aria-label="Bočný panel">
        <div class="dock-head">
            <h2 id="dock-title"></h2>
            <button class="close ms" id="dock-close" aria-label="Zavrieť panel">close</button>
        </div>

        <section id="sec-search" class="hidden">
            <input id="search-input" placeholder="Hľadať uzol…" autocomplete="off">
            <div id="search-results"></div>
        </section>

        <section id="sec-stats" class="hidden">
            <div id="stats-totals"></div>
            <h3>Oblasti</h3>
            <div id="stats-areas"></div>
            <h3>Najsilnejšie uzly</h3>
            <div id="stats-top"></div>
            <h3>Aktivita (30 dní)</h3>
            <canvas id="growth-chart" width="248" height="60"></canvas>
        </section>

        <section id="sec-legend" class="hidden">
            <h3>Typy uzlov</h3>
            <div id="legend-types"></div>
            <h3>Oblasti</h3>
            <div id="legend-areas"></div>
        </section>

        <section id="sec-settings" class="hidden">
            <h3>Priehľadnosť</h3>
            <label class="slider">Panely
                <input type="range" data-opt="panelAlpha" min="0.3" max="1" step="0.01">
            </label>
            <label class="slider">Pozadie
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
        </section>
    </aside>

    <aside id="node-panel" class="hidden" aria-label="Detail uzla">
        <div class="dock-head">
            <h2 id="node-label"></h2>
            <button class="close ms" id="node-close" aria-label="Zavrieť">close</button>
        </div>
        <div id="node-view">
            <span id="node-type" class="badge"><span id="node-swatch" class="swatch" aria-hidden="true"></span><span id="node-type-label"></span></span>
            <p id="node-meta"></p>
            <p id="node-desc"></p>
            <button id="node-file" type="button" class="node-file hidden" title="Skopírovať cestu k .md súboru">
                <span class="ms" aria-hidden="true">description</span><code id="node-file-path"></code>
            </button>
            <h3>Spojenia</h3>
            <div id="node-neighbors"></div>
            <h3>História</h3>
            <div id="node-history"></div>
            <div class="row node-actions">
                <button id="node-edit" class="primary">Upraviť</button>
                <button id="node-delete" class="danger ms" aria-label="Zmazať">delete</button>
            </div>
        </div>
        <div id="node-form" class="hidden">
            <label>Názov<input id="edit-label" maxlength="255"></label>
            <label>Popis<textarea id="edit-desc" rows="5"></textarea></label>
            <div class="row">
                <button id="edit-save" class="primary">Uložiť</button>
                <button id="edit-cancel">Zrušiť</button>
            </div>
        </div>
    </aside>

    <div id="timeline" class="hidden">
        <button id="tl-play" class="ms primary" title="Prehrať rast vedomia" aria-label="Prehrať rast vedomia">play_arrow</button>
        <input type="range" id="tl-range" min="0" max="1000" value="1000" aria-label="Časová os">
        <span id="tl-label">teraz</span>
    </div>

    <div id="zoomctl" role="group" aria-label="Ovládanie kamery">
        <button id="zoom-in" class="ms" title="Priblížiť (+)" aria-label="Priblížiť">add</button>
        <button id="zoom-out" class="ms" title="Oddialiť (−)" aria-label="Oddialiť">remove</button>
        <button id="zoom-reset" class="ms" title="Vycentrovať (0)" aria-label="Vycentrovať">center_focus_strong</button>
    </div>

    <div id="prompt">
        <div id="chat-log" class="hidden" aria-live="polite"></div>
        <form id="prompt-form">
            <span class="ms spark" aria-hidden="true">auto_awesome</span>
            <input id="prompt-input" placeholder="Opýtaj sa Hadesa…  ( / pre príkazy )" autocomplete="off" aria-label="Správa pre Hadesa">
            <button type="submit" class="ms send-btn" aria-label="Odoslať">send</button>
        </form>
    </div>

    <div id="toasts" aria-live="polite"></div>
    <div id="hover-card" class="hidden" role="tooltip"></div>

    <div id="help-overlay" class="hidden" role="dialog" aria-modal="true" aria-label="Klávesové skratky">
        <div id="help-card">
            <div class="dock-head">
                <h2>Klávesové skratky</h2>
                <button class="close ms" id="help-close" aria-label="Zavrieť">close</button>
            </div>
            <div id="help-body"></div>
        </div>
    </div>

    <div id="hint" class="hidden" role="dialog" aria-label="Nápoveda">
        <p id="hint-text"></p>
        <div class="hint-foot">
            <button id="hint-skip" class="ghost" type="button">Preskočiť</button>
            <span id="hint-step" class="step"></span>
            <button id="hint-next" class="primary" type="button">Ďalej</button>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/pusher-js@8/dist/web/pusher.min.js"></script>
    <script src="/js/mind.js"></script>
</body>
</html>
