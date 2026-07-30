{{-- Vlastník: P6 (chat, režim „overlay").

     Fullscreen overlay nad ktoroukoľvek obrazovkou; nad grafom je karta
     poloprieh­ľadná, takže graf a chat sú vidieť naraz (rozhodnutie 83).

     Rovnaký stav ako quickbar aj obrazovka Chat — #chat-composer sa sem presúva,
     #chat-overlay-log sa vykresľuje zo `chatState.messages`.

     a11y: role=dialog + aria-modal, focus trap a Esc sú v chat/modes.js; Esc sa
     tu zastaví, aby nepokračoval do kaskády v shell/shortcuts.js (P9). --}}
<div id="chat-overlay" class="hidden" role="dialog" aria-modal="true" aria-hidden="true"
     aria-labelledby="chat-overlay-title">
    <div id="chat-overlay-card">
        <div class="dock-head chat-head">
            <h2 id="chat-overlay-title">Chat</h2>
            <button type="button" id="chat-to-screen" class="ms comp-btn"
                    title="Otvoriť ako obrazovku" aria-label="Otvoriť ako obrazovku">open_in_new</button>
            <button type="button" id="chat-overlay-close" class="close ms"
                    title="Zavrieť (Esc)" aria-label="Zavrieť chat">close</button>
        </div>
        <div id="chat-overlay-body">
            <aside id="chat-overlay-threads" class="chat-threads" aria-label="Vlákna"></aside>
            <div class="chat-main">
                <div id="chat-overlay-log" class="chat-log"></div>
                <div id="chat-overlay-composer" class="chat-composer-host"></div>
            </div>
        </div>
    </div>
</div>
