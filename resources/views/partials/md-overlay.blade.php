{{-- Vlastník: A5 (P9 — markdown náhľad uzla). Renderuje sa cez mdToHtml
     (resources/js/markdown.js, vlastník A3) — zamknutá signatúra, rozhranie #10. --}}
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
