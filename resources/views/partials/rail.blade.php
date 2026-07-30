{{-- Vlastník: A5 (P9 — navigácia).
     Prestavba na 4 pomenované grupy (VEDOMIE / ZÁZNAMY / ZNALOSTI / SPRÁVA)
     + collapse 56↔208 px je práca A5. Tu je dnešná podoba plus dve nové
     destinácie (Chat, E-shop), aby si ich A3 a A4 nemuseli pridávať sami.

     data-screen musí zodpovedať zoznamu v resources/js/core/screens.js. --}}
<nav id="rail" aria-label="Hlavná navigácia">
    <button id="brand-core" type="button" title="AuraAI — vycentrovať graf" aria-label="AuraAI — vycentrovať graf">
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
        <button class="dest" data-screen="chat" type="button" aria-label="Chat">
            <span class="ms" aria-hidden="true">forum</span><span class="lbl">Chat</span>
        </button>
        <button class="dest" data-screen="eshop" type="button" aria-label="E-shop">
            <span class="ms" aria-hidden="true">storefront</span><span class="lbl">E-shop</span>
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
        <button id="btn-settings" class="dest" data-dock="settings" type="button" aria-label="Nastavenia">
            <span class="ms" aria-hidden="true">tune</span><span class="lbl">Nastavenia</span>
        </button>
        <button id="btn-help" class="dest" type="button" aria-label="Pomocník">
            <span class="ms" aria-hidden="true">help</span><span class="lbl">Pomoc</span>
        </button>
    </div>
</nav>
