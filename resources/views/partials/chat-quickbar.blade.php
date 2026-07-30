{{-- Vlastník: P6 (chat, režim „quickbar").

     Dnešná prompt lišta zostáva ako rýchly vstup (rozhodnutie 82). Je to zároveň
     domovský host bloku #chat-composer — ten sa pri prepnutí režimu FYZICKY
     presúva do overlayu / obrazovky Chat, takže rozpísaný draft a kontextové
     čipy nie sú duplikované a prepnutie ich nemôže zhodiť.

     Id #prompt / #prompt-form / #prompt-input sú v CSS aj v skratkách (P9) —
     zostávajú, len #prompt-input je už <textarea> (Shift+Enter, rozhodnutie 88).
     data-chat-action="send|stop" je kontrakt §4.7. --}}
<div id="prompt">
    {{-- aria-live je per správa v chat/message.js (rozhodnutie 80), nie na kontejneri. --}}
    <div id="chat-log" class="chat-log hidden"></div>

    <div id="chat-composer">
        <div id="chat-context" class="hidden" aria-label="Kontext chatu"></div>
        <div id="chat-ac" class="hidden" role="listbox" aria-label="Návrhy k dopísaniu"></div>
        <form id="prompt-form">
            {{-- POZOR: trieda .spark je obsadená sparkline grafmi v charts.css
                 (`.spark { width: 100% }`), ktorý sa importuje neskôr a roztiahol by
                 ikonu na celú lištu. Chat má preto vlastnú .chat-spark. --}}
            <span class="ms chat-spark" aria-hidden="true">hub</span>
            <textarea id="prompt-input" rows="1" autocomplete="off" spellcheck="false"
                      placeholder="Opýtaj sa AuraAI… (/ príkazy, @uzol)"
                      aria-label="Správa pre AuraAI" aria-describedby="chat-enter-hint"></textarea>
            <span id="chat-enter-hint" class="visually-hidden">Enter odošle správu, Shift a Enter vloží nový riadok.</span>
            <button type="button" id="chat-expand" class="ms comp-btn"
                    title="Chat na celú obrazovku" aria-label="Chat na celú obrazovku">open_in_full</button>
            <button type="submit" id="chat-send" class="ms send-btn"
                    data-chat-action="send" aria-label="Odoslať">send</button>
            <button type="button" id="chat-stop" class="ms send-btn hidden"
                    data-chat-action="stop" aria-label="Zastaviť generovanie">stop</button>
        </form>
    </div>
</div>
