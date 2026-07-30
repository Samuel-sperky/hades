import { handleCommand } from './commands.js';
import { renderContextChips } from './context.js';
import { addMsg, chatHistory } from './log.js';
import { renderSuggestCard } from './suggest.js';
import { $ } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { store } from '../core/store.js';


export function setupPrompt() {
    const bar = $('prompt');
    const input = $('prompt-input');
    const form = $('prompt-form');

    const syncSend = () => form.classList.toggle('has-text', input.value.trim().length > 0);
    input.addEventListener('input', syncSend);
    syncSend();

    renderContextChips(); // E3: obnov priložené uzly z úložiska (byId je už naplnené)

    const open = () => {
        bar.classList.add('open');
        if ($('chat-log').children.length) $('chat-log').classList.remove('hidden');
    };

    input.addEventListener('focus', open);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        syncSend();
        open();

        if (text.startsWith('/')) {
            handleCommand(text);
            return;
        }

        addMsg('me', text);
        chatHistory.push({ role: 'user', content: text });
        const thinking = addMsg('hades thinking', '…');

        try {
            // E3: prilož len existujúce uzly (mŕtve id preskoč), backend capuje na 20
            const ctxIds = [...S.chatContext].filter((id) => S.byId.has(id)).slice(0, 20);
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(-12, -1),
                    context_node_ids: ctxIds,
                }),
            });
            const data = await res.json();
            thinking.remove();
            const reply = data.reply || data.message || 'Hades mlčí.';
            addMsg('hades', reply);
            chatHistory.push({ role: 'assistant', content: reply });
            // E2: pri remember-intente backend vráti suggested_node → potvrdzovacia karta
            if (data && data.suggested_node) renderSuggestCard(data.suggested_node);
        } catch (err) {
            thinking.remove();
            addMsg('sys sys--error', 'Spojenie s vedomím zlyhalo.');
        }
    });
}


/* FÁZA SHELL: chat je schovaný (nefunguje bez API kľúča) — prepínač ho vráti */
export function register(root) {
    setupPrompt(root);

    const chatBtn = root.querySelector('#chat-toggle');
    if (!chatBtn) return;
    const chatOn = store.raw('chat') === '1';
    document.body.classList.toggle('chat-on', chatOn);
    chatBtn.setAttribute('aria-checked', chatOn ? 'true' : 'false');
    chatBtn.onclick = () => {
        const on = !document.body.classList.contains('chat-on');
        document.body.classList.toggle('chat-on', on);
        store.setRaw('chat', on ? '1' : '0');
        chatBtn.setAttribute('aria-checked', on ? 'true' : 'false');
    };
}
