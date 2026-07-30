{{-- Vlastník: P6 (chat, režim „screen").

     Samostatná obrazovka „Chat" v raili (rozhranie #16, `data-screen="chat"`).
     Plná šírka, história vľavo. Jeden modul chat/controller.js obsluhuje tri
     režimy (quickbar → overlay → screen) nad JEDNÝM stavom — prepnutie režimu
     nezhodí konverzáciu ani rozpísaný draft, pretože #chat-composer je jeden
     a len sa presúva medzi hostmi.

     data-chat-action="send|stop|copy|regen|remember|cite|thread" je kontrakt §4.7. --}}
<section class="screen" id="screen-chat">
    <header class="screen-head chat-screen-head">
        <div class="chat-screen-title">
            <h1>Chat</h1>
            <p class="screen-sub">Rozhovor s pamäťou — odpovede sa skládajú z uzlov siete</p>
        </div>
        <div class="chat-screen-acts">
            <button type="button" id="chat-screen-new" class="ghost">Nové vlákno</button>
            <button type="button" id="chat-screen-export" class="ghost">Export .md</button>
        </div>
    </header>
    <div id="chat-screen-body" class="chat-screen">
        <aside id="chat-screen-threads" class="chat-threads" aria-label="Vlákna"></aside>
        <div class="chat-main">
            <div id="chat-screen-log" class="chat-log"></div>
            <div id="chat-screen-composer" class="chat-composer-host"></div>
        </div>
    </div>
</section>
