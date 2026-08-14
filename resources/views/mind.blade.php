<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- CSRF token pre zápisy na interné /api/* — mind.js ho pripája do každého
         non-GET fetchu (ValidateCsrfToken, §3.5 docs/BEZPECNOST.md). --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Hades — AI mind</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='%23b88a3a'/><circle cx='50' cy='50' r='45' fill='none' stroke='%2303797e' stroke-opacity='.4' stroke-width='4'/></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Playfair+Display:wght@500;600;700&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&display=swap">
    <link rel="stylesheet" href="/css/mind.css">
</head>
<body>
    <canvas id="mind"></canvas>

    <header id="app-header">
        <div class="h-left">
            <span id="brand-name">Hades</span>
            <button id="btn-up" class="hidden" type="button" title="O úroveň von (Esc)" aria-label="O úroveň von">
                <span class="ms" aria-hidden="true">arrow_upward</span>
            </button>
            <nav id="breadcrumb" aria-label="Aktuálny kontext"></nav>
            <span id="status-chip" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="txt">spí</span></span>
        </div>
        <div class="h-center">
            <div id="graph-tools" role="group" aria-label="Nástroje grafu">
                <!-- VLNA GRAF A: prepínač pohľadu — organická Sieť / neurónové Vrstvy (V) -->
                <button id="btn-view-net" class="ms" title="Sieť (V)" aria-label="Pohľad Sieť" aria-pressed="true">hub</button>
                <button id="btn-view-layers" class="ms" title="Vrstvy (V)" aria-label="Pohľad Vrstvy" aria-pressed="false">layers</button>
                <button id="btn-structure" class="ms" title="Štruktúra (R)" aria-label="Štruktúra">account_tree</button>
                <button id="btn-stats" class="ms" title="Prehľad (S)" aria-label="Prehľad">monitoring</button>
                <button id="btn-legend" class="ms" title="Legenda (L)" aria-label="Legenda">category</button>
            </div>
            <div id="header-metrics" aria-live="polite"></div>
        </div>
        <div class="h-right">
            <button id="pack-trigger" type="button" class="hidden" aria-label="Balík pre Claude Code">
                <span class="ms" aria-hidden="true">inventory_2</span>
                <span id="pack-count">0</span>
            </button>
            <button id="cmdk-trigger" type="button" aria-label="Hľadať (Ctrl+K)">
                <span class="ms" aria-hidden="true">search</span>
                <span class="cmdk-hint">Hľadať</span>
                <kbd>Ctrl K</kbd>
            </button>
        </div>
    </header>

    <nav id="rail" aria-label="Hlavná navigácia">
        <button id="brand-core" type="button" title="Hades — vycentrovať graf" aria-label="Hades — vycentrovať graf">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <circle cx="12" cy="12" r="3.6" fill="currentColor"/>
                <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.6"/>
            </svg>
        </button>

        <div class="rail-group" role="group" aria-label="Obrazovky">
            <button class="dest" data-screen="dnes" type="button" aria-label="Dnes">
                <span class="ms" aria-hidden="true">wb_sunny</span><span class="lbl">Dnes</span>
            </button>
            <button class="dest" data-screen="dennik" type="button" aria-label="Denník">
                <span class="ms" aria-hidden="true">receipt_long</span><span class="lbl">Denník</span>
            </button>
            <button class="dest" data-screen="graf" type="button" aria-label="Graf">
                <span class="ms" aria-hidden="true">hub</span><span class="lbl">Graf</span>
            </button>
            <button class="dest" data-screen="kniznica" type="button" aria-label="Knižnica">
                <span class="ms" aria-hidden="true">menu_book</span><span class="lbl">Knižnica</span>
            </button>
            <button class="dest" data-screen="rozhodnutia" type="button" aria-label="Rozhodnutia">
                <span class="ms" aria-hidden="true">gavel</span><span class="lbl">Rozhodnutia</span>
            </button>
            <button id="dest-kontrola" class="dest" data-screen="kontrola" type="button" aria-label="Kontrola">
                <span class="ms" aria-hidden="true">fact_check</span><span class="lbl">Kontrola</span>
            </button>
            <button class="dest" data-screen="smernica" type="button" aria-label="Smernica">
                <span class="ms" aria-hidden="true">assignment</span><span class="lbl">Smernica</span>
            </button>
        </div>

        <div class="rail-group bottom" role="group" aria-label="Systém">
            <button id="btn-settings" class="dest" type="button" aria-label="Nastavenia">
                <span class="ms" aria-hidden="true">tune</span><span class="lbl">Nastavenia</span>
            </button>
            <button id="btn-help" class="dest" type="button" aria-label="Pomocník">
                <span class="ms" aria-hidden="true">help</span><span class="lbl">Pomoc</span>
            </button>
        </div>
    </nav>

    <main id="screens">
        <section class="screen" id="screen-dnes">
            <header class="screen-head">
                <h1>Dnes</h1>
                <p class="screen-sub">Čo sa práve deje vo vedomí</p>
            </header>
            <div id="dnes-body"></div>
        </section>

        <section class="screen" id="screen-dennik">
            <header class="screen-head">
                <h1>Denník</h1>
                <p class="screen-sub">Záznamy zo sessions po dňoch</p>
            </header>
            <div id="journal-filter"></div>
            <div id="journal-list"></div>
        </section>

        <section class="screen" id="screen-kniznica">
            <header class="screen-head">
                <h1>Knižnica</h1>
                <p class="screen-sub">Skills usporiadané podľa oblastí</p>
                <input id="library-search" placeholder="Filtrovať skills…" autocomplete="off" aria-label="Filtrovať skills">
            </header>
            <div id="library-body"></div>
        </section>

        <section class="screen" id="screen-rozhodnutia">
            <header class="screen-head">
                <h1>Rozhodnutia</h1>
                <p class="screen-sub">Časová os rozhodnutí naprieč projektami</p>
            </header>
            <div id="rozhodnutia-body"></div>
        </section>

        <section class="screen" id="screen-kontrola">
            <header class="screen-head">
                <h1>Kontrola</h1>
                <p class="screen-sub">Fronta poznatkov čakajúcich na overenie</p>
            </header>
            <div id="kontrola-body"></div>
        </section>

        <section class="screen" id="screen-smernica">
            <header class="screen-head">
                <h1>Smernica</h1>
                <p class="screen-sub">Povedz Hadesovi na čom robíš — poskladá kontext pre Claude Code</p>
            </header>
            <div id="directive-body"></div>
        </section>
    </main>

    <aside id="dock" class="hidden" aria-label="Bočný panel">
        <div class="dock-head">
            <h2 id="dock-title"></h2>
            <button class="close ms" id="dock-close" aria-label="Zavrieť panel">close</button>
        </div>

        <section id="sec-structure" class="hidden">
            <div id="structure-tree"></div>
            <button id="btn-new-node" class="ghost" type="button">+ Nový uzol</button>
        </section>

        <section id="sec-stats" class="hidden">
            <div id="stats-cards" class="metric-grid"></div>
            <h3>Oblasti</h3>
            <div id="stats-areas"></div>
            <h3>Najsilnejšie uzly</h3>
            <div id="stats-top"></div>
            <h3>Posledné záznamy</h3>
            <div id="stats-recent"></div>
            <h3>Aktivita (30 dní)</h3>
            <canvas id="growth-chart" width="248" height="60"></canvas>
        </section>

        <section id="sec-legend" class="hidden">
            <h3>Typy uzlov</h3>
            <div id="legend-types"></div>
            <h3>Oblasti</h3>
            <div id="legend-areas"></div>
            <h3>Sila</h3>
            <div id="legend-strength"></div>
            <h3>Spojenia</h3>
            <div id="legend-connections"></div>
        </section>

        <section id="sec-settings" class="hidden">
            <h3>Predvoľby</h3>
            <div id="presets" role="group" aria-label="Predvoľby zobrazenia">
                <button type="button" class="preset" data-preset="clean" aria-pressed="false">
                    <span class="p-name">Čisté</span><span class="p-sub">ticho, len kostra</span>
                </button>
                <button type="button" class="preset" data-preset="live" aria-pressed="false">
                    <span class="p-name">Živé</span><span class="p-sub">predvolené</span>
                </button>
                <button type="button" class="preset" data-preset="dense" aria-pressed="false">
                    <span class="p-name">Husté</span><span class="p-sub">všetky spojenia</span>
                </button>
                <button type="button" class="preset" data-preset="ambient" aria-pressed="false">
                    <span class="p-name">Ambient</span><span class="p-sub">na pozeranie</span>
                </button>
            </div>
            <p id="preset-state" class="preset-state" aria-live="polite">vlastné nastavenie</p>
            <div class="switch-row">
                <span id="theme-toggle-label">Tmavý režim</span>
                <button id="theme-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="theme-toggle-label"></button>
            </div>
            <div class="row" id="ambient-row">
                <button id="btn-ambient" class="ghost" type="button">Spustiť na celú obrazovku</button>
            </div>

            <details id="settings-advanced">
                <summary><span class="adv-title">Pokročilé</span><span class="adv-n">jednotlivé ovládače</span></summary>
                <div class="adv-body">
                    <h3>Vzhľad</h3>
                    <div class="switch-row">
                        <span id="chat-toggle-label">Chat s Hadesom (potrebuje API kľúč)</span>
                        <button id="chat-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="chat-toggle-label"></button>
                    </div>
                    <div class="switch-row">
                        <span id="sound-toggle-label">Zvuk</span>
                        <button id="btn-sound" class="switch" type="button" role="switch" aria-checked="true" aria-labelledby="sound-toggle-label"></button>
                    </div>
                    <h3>Pohyb</h3>
                    <label class="slider">Život
                        <input type="range" data-opt="life" min="0" max="1" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Animácie
                        <input type="range" data-opt="anim" min="0" max="1" step="0.05">
                        <output></output>
                    </label>
                    <h3>Sieť — filter</h3>
                    <div class="switch-row">
                        <span id="scope-label">Zobraziť knižnicu v grafe</span>
                        <button id="scope-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="scope-label"></button>
                    </div>
                    <div class="check-cap">Typy</div>
                    <label class="check"><input type="checkbox" data-ftype="memory" checked><span class="box" aria-hidden="true"></span><span>Spomienky</span></label>
                    <label class="check"><input type="checkbox" data-ftype="skill" checked><span class="box" aria-hidden="true"></span><span>Skills</span></label>
                    <label class="check"><input type="checkbox" data-ftype="project" checked><span class="box" aria-hidden="true"></span><span>Projekty</span></label>
                    <div class="check-cap">Zdroje</div>
                    <label class="check"><input type="checkbox" data-fsource="session" checked><span class="box" aria-hidden="true"></span><span>Záznamy</span></label>
                    <label class="check"><input type="checkbox" data-fsource="skill" checked><span class="box" aria-hidden="true"></span><span>Playbooky</span></label>
                    <label class="check"><input type="checkbox" data-fsource="digest" checked><span class="box" aria-hidden="true"></span><span>Súhrny a archívy</span></label>
                    <label class="check"><input type="checkbox" data-fsource="manual" checked><span class="box" aria-hidden="true"></span><span>Ručné</span></label>
                    <div class="check-cap">Vzťahy</div>
                    <label class="check"><input type="checkbox" data-frel="part_of" checked><span class="box" aria-hidden="true"></span><span>Kostra (part_of)</span></label>
                    <label class="check"><input type="checkbox" data-frel="uses" checked><span class="box" aria-hidden="true"></span><span>Použitia (uses)</span></label>
                    <label class="check"><input type="checkbox" data-frel="similarity" checked><span class="box" aria-hidden="true"></span><span>Podobnosti</span></label>
                    <label class="check"><input type="checkbox" data-frel="co_activation" checked><span class="box" aria-hidden="true"></span><span>Co-aktivácie</span></label>
                    <div class="switch-row">
                        <span id="softhover-label">Spojenia len pri hovere</span>
                        <button id="softhover-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="softhover-label"></button>
                    </div>
                    <div class="switch-row">
                        <span id="skeleton-label">Len kostra</span>
                        <button id="skeleton-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="skeleton-label"></button>
                    </div>
                    <label class="slider">Min. váha spojení
                        <input type="range" id="minweight-slider" min="0" max="5" step="0.5" value="1">
                        <output></output>
                    </label>
                    <h3>Priehľadnosť</h3>
                    <label class="slider">Panely
                        <input type="range" data-opt="panelAlpha" min="0.3" max="1" step="0.01">
                        <output></output>
                    </label>
                    <label class="slider">Pozadie
                        <input type="range" data-opt="bg" min="0" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Spojenia
                        <input type="range" data-opt="edgeAlpha" min="0.1" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Obrysy uzlov
                        <input type="range" data-opt="glow" min="0.2" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Popisky
                        <input type="range" data-opt="labelAlpha" min="0" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <h3>Veľkosti</h3>
                    <label class="slider">Uzly
                        <input type="range" data-opt="nodeScale" min="0.6" max="1.6" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Písmo popiskov
                        <input type="range" data-opt="labelSize" min="0.7" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <div class="switch-row">
                        <span id="sizedeg-label">Veľkosť podľa spojení</span>
                        <button id="sizedeg-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="sizedeg-label"></button>
                    </div>
                    <div class="row">
                        <button id="opts-reset">Obnoviť predvolené</button>
                    </div>
                </div>
            </details>
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
            <div id="node-record"></div>
            <h3>Spojenia</h3>
            <div id="node-neighbors"></div>
            <div id="node-suggestions-sec">
                <h3>Možno súvisí</h3>
                <div id="node-suggestions"></div>
            </div>
            <h3>História</h3>
            <div id="node-history"></div>
            <div class="row node-actions">
                <button id="node-edit" class="primary">Upraviť</button>
                <button id="node-pack" class="ghost ms" title="Do balíka" aria-label="Do balíka" aria-pressed="false">library_add</button>
                <button id="node-md" class="ghost ms hidden" title="Zobraziť dokument" aria-label="Zobraziť dokument">description</button>
                <button id="node-connect" class="ghost ms" title="Prepojiť s uzlom" aria-label="Prepojiť s uzlom">link</button>
                <button id="node-delete" class="danger ms" aria-label="Zmazať">delete</button>
            </div>
        </div>
        <div id="node-form" class="hidden">
            <label>Názov<input id="edit-label" maxlength="255"></label>
            <label>Popis<textarea id="edit-desc" rows="5"></textarea></label>
            <label id="edit-type-row" class="hidden">Typ<select id="edit-type">
                <option value="memory">Spomienka</option>
                <option value="skill">Skill</option>
                <option value="project">Projekt</option>
            </select></label>
            <label>Oblasť<select id="edit-area"></select></label>
            <label>Oddelenie<select id="edit-dept"></select></label>
            <div class="row">
                <button id="edit-save" class="primary">Uložiť</button>
                <button id="edit-cancel">Zrušiť</button>
            </div>
        </div>
    </aside>

    <aside id="pack-drawer" class="hidden" aria-label="Balík pre Claude Code">
        <div class="dock-head">
            <h2>Balík pre Claude Code</h2>
            <button class="close ms" id="pack-close" aria-label="Zavrieť">close</button>
        </div>
        <p class="pack-hint">Vybrané uzly skopíruješ ako markdown a vložíš do Claude Code.</p>
        <div id="pack-list"></div>
        <div class="row pack-actions">
            <button id="pack-copy" class="primary" type="button">Kopírovať pre Claude Code</button>
            <button id="pack-clear" class="ghost" type="button">Vyprázdniť</button>
        </div>
    </aside>

    <div id="zoomctl" role="group" aria-label="Ovládanie kamery">
        <button id="zoom-in" class="ms" title="Priblížiť (+)" aria-label="Priblížiť">add</button>
        <button id="zoom-out" class="ms" title="Oddialiť (−)" aria-label="Oddialiť">remove</button>
        <button id="zoom-reset" class="ms" title="Vycentrovať (0)" aria-label="Vycentrovať">center_focus_strong</button>
    </div>

    <div id="prompt">
        <div id="chat-context" class="hidden" aria-label="Kontext chatu"></div>
        <div id="chat-log" class="hidden" aria-live="polite"></div>
        <form id="prompt-form">
            <span class="ms spark" aria-hidden="true">hub</span>
            <input id="prompt-input" placeholder="Opýtaj sa Hadesa… (/ príkazy)" autocomplete="off" aria-label="Správa pre Hadesa">
            <button type="submit" class="ms send-btn" aria-label="Odoslať">send</button>
        </form>
    </div>

    <div id="toasts" aria-live="polite"></div>
    <div id="hover-card" class="hidden" role="tooltip"></div>

    <div id="cmdk" class="hidden" role="dialog" aria-modal="true" aria-label="Hľadať">
        <div id="cmdk-card">
            <div class="cmdk-input-row">
                <span class="ms" aria-hidden="true">search</span>
                <input id="cmdk-input" placeholder="Hľadať uzly, playbooky, obrazovky…" autocomplete="off" aria-label="Hľadať">
                <kbd>esc</kbd>
            </div>
            <div id="cmdk-results"></div>
        </div>
    </div>

    <div id="help-overlay" class="hidden" role="dialog" aria-modal="true" aria-label="Klávesové skratky">
        <div id="help-card">
            <div class="dock-head">
                <h2>Klávesové skratky</h2>
                <button class="close ms" id="help-close" aria-label="Zavrieť">close</button>
            </div>
            <div id="help-body"></div>
        </div>
    </div>

    <div id="md-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="md-title">
        <div id="md-card">
            <div class="dock-head">
                <h2 id="md-title"></h2>
                <button class="close ms" id="md-close" aria-label="Zavrieť">close</button>
            </div>
            <div id="md-body" class="md-body"></div>
            <div id="md-foot">
                <button type="button" class="ghost hidden" id="md-copypath">Kopírovať cestu</button>
                <button type="button" class="primary" id="md-pack">Do balíka</button>
            </div>
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

    <!-- VLNA GRAF A: d3 je späť — layout uzlov počíta d3.forceSimulation (sim.js).
         Keby CDN nedobehlo, buildSim() to zvládne aj bez neho (uzly zostanú na
         deterministických semienkach pri svojich kotvách, len bez relaxácie). -->
    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/pusher-js@8/dist/web/pusher.min.js"></script>
    <script src="/js/charts.js"></script>
    <script type="module" src="/js/mind/main.js"></script>
</body>
</html>
