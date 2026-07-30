{{-- Vlastník: P9 (mobilná vrstva).

     Rozhodnutie #76 — mobil je v rozsahu pre chat a dashboardy, graf zostáva
     desktop-only. Rozhodnutie #78 — bottom nav pod 640 px: 4 hlavné destinácie
     + „Viac".

     Markup je v DOM vždy; zobrazuje ho výhradne mobile.css pod 640 px, takže na
     desktope nemá žiadny vizuálny ani layoutový dopad. shell/mobile-nav.js drôtuje
     data-screen presne tak ako rail (kontrakt §4.7) — router o mobile nič nevie. --}}
<nav id="mobile-nav" aria-label="Mobilná navigácia">
    <button class="mdest" data-screen="dnes" type="button" aria-label="Dnes">
        <span class="ms" aria-hidden="true">wb_sunny</span><span class="lbl">Dnes</span>
    </button>
    <button class="mdest" data-screen="chat" type="button" aria-label="Chat">
        <span class="ms" aria-hidden="true">forum</span><span class="lbl">Chat</span>
    </button>
    <button class="mdest" data-screen="dennik" type="button" aria-label="Denník">
        <span class="ms" aria-hidden="true">receipt_long</span><span class="lbl">Denník</span>
    </button>
    <button class="mdest" data-screen="kniznica" type="button" aria-label="Knižnica">
        <span class="ms" aria-hidden="true">menu_book</span><span class="lbl">Knižnica</span>
    </button>
    <button class="mdest" id="mobile-more" type="button" aria-label="Viac" aria-haspopup="dialog" aria-expanded="false">
        <span class="ms" aria-hidden="true">more_horiz</span><span class="lbl">Viac</span>
    </button>
</nav>

{{-- Graf je desktop-only. Namiesto prázdneho plátna dostane mobil zrozumiteľnú
     výzvu s odkazom na Dnes (akceptačné kritérium 30 + riziko „mobil bez grafu
     vyzerá ako rozbitá appka"). Na desktope je element vypnutý v mobile.css. --}}
<section id="mobile-graph-note" aria-live="polite">
    <span class="ms" aria-hidden="true">desktop_windows</span>
    <h2>Vizualizácia je len na desktope</h2>
    <p>Mapa vedomia potrebuje veľké plátno a myš. Na telefóne sú k dispozícii
       Dnes, Chat, Denník a Knižnica — celý obsah siete v čitateľnej podobe.</p>
    <button class="primary" data-screen="dnes" type="button">Prejsť na Dnes</button>
</section>

{{-- Spodný list „Viac" — zvyšné destinácie + systém. Focus trap a Escape rieši
     shell/mobile-nav.js cez shell/focus-trap.js (rovnako ako Cmd-K a Pomocník). --}}
<div id="mobile-sheet" class="hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-sheet-title">
    <div class="msheet-card">
        <div class="msheet-head">
            <h2 id="mobile-sheet-title">Viac</h2>
            <button class="close ms" id="mobile-sheet-close" type="button" aria-label="Zavrieť">close</button>
        </div>
        <div class="msheet-grid">
            <button class="msheet-item" data-screen="graf" type="button">
                <span class="ms" aria-hidden="true">hub</span><span>Graf</span>
            </button>
            <button class="msheet-item" data-screen="rozhodnutia" type="button">
                <span class="ms" aria-hidden="true">gavel</span><span>Rozhodnutia</span>
            </button>
            <button class="msheet-item" data-screen="kontrola" type="button">
                <span class="ms" aria-hidden="true">fact_check</span><span>Kontrola</span>
            </button>
            <button class="msheet-item" data-screen="smernica" type="button">
                <span class="ms" aria-hidden="true">assignment</span><span>Smernica</span>
            </button>
            <button class="msheet-item" data-screen="eshop" type="button">
                <span class="ms" aria-hidden="true">storefront</span><span>E-shop</span>
            </button>
            <button class="msheet-item" id="mobile-settings" type="button">
                <span class="ms" aria-hidden="true">tune</span><span>Nastavenia</span>
            </button>
            <button class="msheet-item" id="mobile-help" type="button">
                <span class="ms" aria-hidden="true">help</span><span>Pomoc</span>
            </button>
        </div>
    </div>
</div>
