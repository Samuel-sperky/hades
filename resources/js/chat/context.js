import { $, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { store } from '../core/store.js';


export function persistChatContext() {
    store.setRaw('chatContext', JSON.stringify([...S.chatContext]));
}


export function addToChatContext(id) {
    S.chatContext.add(+id);
    persistChatContext();
    renderContextChips();
}


export function removeFromChatContext(id) {
    S.chatContext.delete(+id);
    persistChatContext();
    renderContextChips();
}


// Čipy nad chatom — štítky uzlov v kontexte, × odoberá, „Vyčistiť" zmaže všetky.
// Mŕtve id (zmazané uzly) sa preskočia a zároveň vyčistia z úložiska.
export function renderContextChips() {
    const row = $('chat-context');
    if (!row) return;
    const ids = [...S.chatContext].filter((id) => S.byId.has(id));
    if (ids.length !== S.chatContext.size) {
        S.chatContext = new Set(ids);
        persistChatContext();
    }
    if (!ids.length) { row.classList.add('hidden'); row.innerHTML = ''; return; }
    row.classList.remove('hidden');
    row.innerHTML = ids.map((id) => {
        const n = S.byId.get(id);
        return '<span class="ctx-chip" data-id="' + id + '">'
            + '<span class="ctx-label">' + esc(n.label) + '</span>'
            + '<button type="button" class="ctx-x ms" title="Odobrať z kontextu" aria-label="Odobrať z kontextu">close</button>'
            + '</span>';
    }).join('')
        + '<button type="button" class="ctx-clear" title="Vyčistiť kontext">Vyčistiť</button>';
    row.querySelectorAll('.ctx-x').forEach((btn) => {
        btn.onclick = () => removeFromChatContext(+btn.closest('.ctx-chip').dataset.id);
    });
    const clr = row.querySelector('.ctx-clear');
    if (clr) clr.onclick = () => { S.chatContext.clear(); persistChatContext(); renderContextChips(); };
}
