{{-- Vlastník: A5 (P9 — shell, nastavenia).

     POZOR na kontrakt data-*: filtre nesú data-filter-type|source|area|relation|cert,
     ktoré drôtuje graph/filters.js (A4). A5 smie markup filtrov presúvať a
     preštylovať, ale NESMIE zmeniť ani odstrániť tieto atribúty bez zápisu do
     CLAUDE.md — inak A4 stratí úchyt. Dnešné data-ftype/data-fsource/data-frel
     zostávajú ako aliasy, kým A4 neprejde na nové názvy. --}}
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

    {{-- ZJEDNOTENÉ NASTAVENIA — rozhodnutie #67.
         Používateľ za celú históriu appky nezmenil ani jednu zo 17 volieb, preto sa
         nastavenia ZOŠKRTÁVAJÚ, nie rozširujú: nad foldom sú 4 veci, ktoré sa reálne
         prepínajú, ostatné sa presunuli do <details> „Pokročilé".
         Žiadne id ani data-* sa nemenili — settings.js, filters.js, filters-cert.js,
         pack.js, ambient.js a chat/controller.js si držia svoje úchyty. --}}
    <section id="sec-settings" class="hidden">
        <h3>Téma</h3>
        {{-- Rozhodnutie #64: tretia možnosť „Systém". Starý #theme-toggle zostáva
             v DOM (skrytý), kým naň mieri smoke test — theme.js drôtuje oba. --}}
        <div id="theme-seg" class="seg" role="radiogroup" aria-label="Téma">
            <button type="button" class="seg-btn" data-theme-pref="light" role="radio" aria-checked="false">Svetlá</button>
            <button type="button" class="seg-btn" data-theme-pref="dark" role="radio" aria-checked="false">Tmavá</button>
            <button type="button" class="seg-btn" data-theme-pref="system" role="radio" aria-checked="false">Systém</button>
        </div>
        <div class="switch-row visually-hidden">
            <span id="theme-toggle-label">Tmavý režim</span>
            <button id="theme-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="theme-toggle-label"></button>
        </div>

        <h3>Základné</h3>
        <div class="switch-row">
            <span id="sound-toggle-label">Zvuk</span>
            <button id="btn-sound" class="switch" type="button" role="switch" aria-checked="true" aria-labelledby="sound-toggle-label"></button>
        </div>
        <div class="switch-row">
            <span id="scope-label">Zobraziť knižnicu v grafe</span>
            <button id="scope-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="scope-label"></button>
        </div>
        <div class="row">
            <button id="btn-ambient" class="ghost" type="button">Ambient režim (celá obrazovka)</button>
        </div>

        <details id="settings-advanced" class="adv">
            <summary>
                <span class="ms" aria-hidden="true">expand_more</span>
                <span>Pokročilé</span>
            </summary>

        {{-- Chat: rozhodnutie #84 hovorí, že prepínač má zmiznúť a chat byť zapnutý
             by default. Odstránenie vlastní P6 (chat/controller.js drží .chat-on
             cez tento prvok) — do tej doby zostáva tu, len pod foldom. --}}
        <div class="switch-row">
            <span id="chat-toggle-label">Chat s AuraAI</span>
            <button id="chat-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="chat-toggle-label"></button>
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
        <div class="check-cap">Typy</div>
        <label class="check"><input type="checkbox" data-ftype="memory" data-filter-type="memory" checked><span class="box" aria-hidden="true"></span><span>Spomienky</span></label>
        <label class="check"><input type="checkbox" data-ftype="skill" data-filter-type="skill" checked><span class="box" aria-hidden="true"></span><span>Skills</span></label>
        <label class="check"><input type="checkbox" data-ftype="project" data-filter-type="project" checked><span class="box" aria-hidden="true"></span><span>Projekty</span></label>
        <div class="check-cap">Zdroje</div>
        <label class="check"><input type="checkbox" data-fsource="session" data-filter-source="session" checked><span class="box" aria-hidden="true"></span><span>Záznamy</span></label>
        <label class="check"><input type="checkbox" data-fsource="skill" data-filter-source="skill" checked><span class="box" aria-hidden="true"></span><span>Playbooky</span></label>
        <label class="check"><input type="checkbox" data-fsource="digest" data-filter-source="digest" checked><span class="box" aria-hidden="true"></span><span>Súhrny a archívy</span></label>
        <label class="check"><input type="checkbox" data-fsource="manual" data-filter-source="manual" checked><span class="box" aria-hidden="true"></span><span>Ručné</span></label>
        <div class="check-cap">Vzťahy</div>
        <label class="check"><input type="checkbox" data-frel="part_of" data-filter-relation="part_of" checked><span class="box" aria-hidden="true"></span><span>Kostra (part_of)</span></label>
        <label class="check"><input type="checkbox" data-frel="uses" data-filter-relation="uses" checked><span class="box" aria-hidden="true"></span><span>Použitia (uses)</span></label>
        <label class="check"><input type="checkbox" data-frel="similarity" data-filter-relation="similarity" checked><span class="box" aria-hidden="true"></span><span>Podobnosti</span></label>
        <label class="check"><input type="checkbox" data-frel="co_activation" data-filter-relation="co_activation" checked><span class="box" aria-hidden="true"></span><span>Co-aktivácie</span></label>
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
        <h3>Sieť — sily</h3>
        <label class="slider">Odpudzovanie
            <input type="range" data-force="charge" min="-240" max="-20" step="1">
            <output></output>
        </label>
        <label class="slider">Vzdialenosť spojení
            <input type="range" data-force="linkDistance" min="40" max="220" step="1">
            <output></output>
        </label>
        <label class="slider">Sila spojení
            <input type="range" data-force="linkStrength" min="0.2" max="3" step="0.1">
            <output></output>
        </label>
        <label class="slider">Gravitácia
            <input type="range" data-force="gravity" min="0.2" max="2" step="0.1">
            <output></output>
        </label>
        <div class="row">
            <button id="forces-reset" class="ghost" type="button">Obnoviť sily</button>
        </div>
        <div class="switch-row">
            <span id="sizedeg-label">Veľkosť podľa spojení</span>
            <button id="sizedeg-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="sizedeg-label"></button>
        </div>
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
        <div class="row">
            <button id="opts-reset">Obnoviť predvolené</button>
        </div>
        </details>
    </section>
</aside>
