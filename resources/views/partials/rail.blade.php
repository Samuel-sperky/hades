{{-- Vlastník: P9 (navigácia).

     PRESTAVBA NAVIGÁCIE — rozhodnutie #51 / #54, UX plán vlna 4:
       · 4 pomenované obsahové grupy + systémová grupa dole (uppercase eyebrow)
       · collapse 72 ↔ 208 px, persistované v localStorage (aura.rail.expanded)
       · aktívny stav zlatý (color-mix nad --brand-gold), nie teal fill

     KONTRAKT §4.7: data-screen musí zodpovedať zoznamu v core/screens.js;
     shell/rail.js a shell/router.js čítajú `#rail .dest[data-screen]`,
     shell/dock.js číta `#btn-settings`, shell/help.js `#btn-help`,
     shell/rail.js dopĺňa `.dot` / `.count` do `.dest`. Nič z toho sa nemení. --}}
<nav id="rail" aria-label="Hlavná navigácia">
    <div class="rail-top">
        <button id="brand-core" type="button" title="AuraAI — vycentrovať graf" aria-label="AuraAI — vycentrovať graf">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                <circle cx="12" cy="12" r="3.6" fill="currentColor"/>
                <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-opacity=".55" stroke-width="1.6"/>
            </svg>
            <span class="brand-word">AuraAI</span>
        </button>
        <button id="rail-toggle" type="button" class="rail-toggle"
                aria-expanded="false" aria-controls="rail" aria-label="Rozbaliť navigáciu">
            <span class="ms" aria-hidden="true">chevron_right</span>
        </button>
    </div>

    <div class="rail-scroll">
        <div class="rail-group" role="group" aria-labelledby="rail-grp-vedomie">
            <div class="rail-cap eyebrow" id="rail-grp-vedomie">Vedomie</div>
            <button class="dest" data-screen="dnes" type="button" aria-label="Dnes">
                <span class="ms" aria-hidden="true">wb_sunny</span><span class="lbl">Dnes</span>
            </button>
            <button class="dest" data-screen="graf" type="button" aria-label="Graf">
                <span class="ms" aria-hidden="true">hub</span><span class="lbl">Graf</span>
            </button>
            <button class="dest" data-screen="agenti" type="button" aria-label="Agenti">
                <span class="ms" aria-hidden="true">smart_toy</span><span class="lbl">Agenti</span>
            </button>
            <button class="dest" data-screen="chat" type="button" aria-label="Chat">
                <span class="ms" aria-hidden="true">forum</span><span class="lbl">Chat</span>
            </button>
        </div>

        <div class="rail-group" role="group" aria-labelledby="rail-grp-zaznamy">
            <div class="rail-cap eyebrow" id="rail-grp-zaznamy">Záznamy</div>
            <button class="dest" data-screen="dennik" type="button" aria-label="Denník">
                <span class="ms" aria-hidden="true">receipt_long</span><span class="lbl">Denník</span>
            </button>
            <button class="dest" data-screen="rozhodnutia" type="button" aria-label="Rozhodnutia">
                <span class="ms" aria-hidden="true">gavel</span><span class="lbl">Rozhodnutia</span>
            </button>
        </div>

        <div class="rail-group" role="group" aria-labelledby="rail-grp-znalosti">
            <div class="rail-cap eyebrow" id="rail-grp-znalosti">Znalosti</div>
            <button class="dest" data-screen="kniznica" type="button" aria-label="Knižnica">
                <span class="ms" aria-hidden="true">menu_book</span><span class="lbl">Knižnica</span>
            </button>
            <button class="dest" data-screen="smernica" type="button" aria-label="Smernica">
                <span class="ms" aria-hidden="true">assignment</span><span class="lbl">Smernica</span>
            </button>
        </div>

        {{-- E-shop je otvorený bod CLAUDE.md §7.2 (nie je v katalógu rozhraní #16).
             Destinácia zostáva na mieste, kam ju umiestnila W0; zaradenie do grupy
             PREVÁDZKA je predbežné a mení sa po produktovom rozhodnutí. --}}
        <div class="rail-group" role="group" aria-labelledby="rail-grp-prevadzka">
            <div class="rail-cap eyebrow" id="rail-grp-prevadzka">Prevádzka</div>
            <button id="dest-kontrola" class="dest" data-screen="kontrola" type="button" aria-label="Kontrola">
                <span class="ms" aria-hidden="true">fact_check</span><span class="lbl">Kontrola</span>
            </button>
            <button class="dest" data-screen="eshop" type="button" aria-label="E-shop">
                <span class="ms" aria-hidden="true">storefront</span><span class="lbl">E-shop</span>
            </button>
        </div>
    </div>

    <div class="rail-group bottom" role="group" aria-label="Systém">
        <button id="btn-settings" class="dest" data-dock="settings" type="button" aria-label="Nastavenia">
            <span class="ms" aria-hidden="true">tune</span><span class="lbl">Nastavenia</span>
        </button>
        <button id="btn-help" class="dest" type="button" aria-label="Pomocník">
            <span class="ms" aria-hidden="true">help</span><span class="lbl">Pomoc</span>
        </button>
    </div>
</nav>
