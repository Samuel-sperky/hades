{{-- Vlastník: A3 (P6 — chatové okno, režim „screen").

     SKELETON. Jeden modul chat/controller.js obsluhuje tri režimy (quickbar →
     overlay → screen) nad JEDNÝM stavom (core/state/chat.js) — prepnutie režimu
     nesmie zhodiť konverzáciu ani rozpísaný draft.

     Stabilné id, na ktoré sa A3 pripája:
       #chat-screen-threads  — zoznam vlákien
       #chat-screen-log      — správy (aria-live per správa, nie na kontejneri)
       #chat-screen-composer — miesto pre composer

     data-chat-action="send|stop|copy|regen|remember|cite|thread" je kontrakt. --}}
<section class="screen" id="screen-chat">
    <header class="screen-head">
        <h1>Chat</h1>
        <p class="screen-sub">Rozhovor s pamäťou — odpovede sa skládajú z uzlov siete</p>
    </header>
    <div id="chat-screen-body" class="chat-screen">
        <aside id="chat-screen-threads" aria-label="Vlákna"></aside>
        <div id="chat-screen-log"></div>
        <div id="chat-screen-composer"></div>
    </div>
</section>
