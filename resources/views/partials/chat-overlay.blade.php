{{-- Vlastník: A3 (P6 — chat, režim „overlay").

     SKELETON. Fullscreen overlay nad grafom. Rovnaký stav ako quickbar a
     obrazovka Chat (rozhodnutie 82: „mať aj-aj") — prepnutie režimu nesmie
     zhodiť konverzáciu ani rozpísaný draft.

     Stabilné id pre A3:
       #chat-overlay-log       — správy
       #chat-overlay-composer  — composer
       #chat-overlay-threads   — vlákna
     Overlay má mať focus trap a vrátiť fókus (rovnako ako #cmdk, #help-overlay). --}}
<div id="chat-overlay" class="hidden" role="dialog" aria-modal="true" aria-label="Chat">
    <div id="chat-overlay-card">
        <div class="dock-head">
            <h2>Chat</h2>
            <button class="close ms" id="chat-overlay-close" data-chat-action="stop" aria-label="Zavrieť">close</button>
        </div>
        <div id="chat-overlay-threads" aria-label="Vlákna"></div>
        <div id="chat-overlay-log"></div>
        <div id="chat-overlay-composer"></div>
    </div>
</div>
