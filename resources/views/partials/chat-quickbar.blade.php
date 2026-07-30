{{-- Vlastník: A3 (P6 — chat, režim „quickbar").

     Dnešná prompt lišta. Zostáva ako rýchly vstup aj po prestavbe (rozhodnutie 82) —
     nemaže sa, len sa napojí na rovnaký stav ako overlay a obrazovka Chat.
     Id #prompt / #prompt-form / #prompt-input sú v CSS aj v skratkách — meniť ich
     znamená zápis do CLAUDE.md. --}}
<div id="prompt">
    <div id="chat-context" class="hidden" aria-label="Kontext chatu"></div>
    {{-- aria-live na kontejneri je dnešné chovanie; presun na per-správu je práca A3. --}}
    <div id="chat-log" class="hidden" aria-live="polite"></div>
    <form id="prompt-form">
        <span class="ms spark" aria-hidden="true">hub</span>
        <input id="prompt-input" placeholder="Opýtaj sa AuraAI… (/ príkazy)" autocomplete="off" aria-label="Správa pre AuraAI">
        <button type="submit" class="ms send-btn" data-chat-action="send" aria-label="Odoslať">send</button>
    </form>
</div>
