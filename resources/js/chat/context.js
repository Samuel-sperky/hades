import { $, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { store } from '../core/store.js';


/* Strop kontextu podľa rozhodnutia 147 — pri malom routeri je budget malý.
   Backend si vstup capuje tiež; toto je strop toho, čo vôbec pošleme.
   Čipy nad stropom zostávajú viditeľné, ale sú označené ako nevyužité
   (rozhodnutie 93 — indikátor využitia kontextu). */
export const CONTEXT_CAP = 5;


export function persistChatContext() {
    store.setRaw('chatContext', JSON.stringify([...S.chatContext]));
}


/** Id uzlov pre backend — len existujúce, orezané na strop. */
export function chatContextIds() {
    return [...S.chatContext].filter((id) => S.byId.has(id)).slice(0, CONTEXT_CAP);
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


export function clearChatContext() {
    S.chatContext.clear();
    persistChatContext();
    renderContextChips();
}


// Čipy nad chatom — štítky uzlov v kontexte, × odoberá, „Vyčistiť" zmaže všetky.
// Mŕtve id (zmazané uzly) sa preskočia a zároveň vyčistia z úložiska.
// Riadok #chat-context sa pri prepnutí režimu presúva spolu s composerom,
// takže je to stále ten istý element — čipy prepnutie neprežijú len tak, ony ho
// vôbec nezaznamenajú.
export function renderContextChips() {
    const row = $('chat-context');
    if (!row) return;
    // Chat sa registruje PRED `await loadGraph()`, takže tu môže byť sieť ešte
    // prázdna. Vtedy sa nesmie ani kresliť, ani prořezávať — inak by prvý render
    // po reloade zmazal celý uložený kontext. Prekreslenie zabezpečí controller.
    if (!S.byId.size) { row.classList.add('hidden'); return; }
    const ids = [...S.chatContext].filter((id) => S.byId.has(id));
    if (ids.length !== S.chatContext.size) {
        S.chatContext = new Set(ids);
        persistChatContext();
    }
    if (!ids.length) { row.classList.add('hidden'); row.innerHTML = ''; return; }
    row.classList.remove('hidden');
    row.innerHTML = ids.map((id, i) => {
        const n = S.byId.get(id);
        const over = i >= CONTEXT_CAP;
        return '<span class="ctx-chip' + (over ? ' ctx-chip--over' : '') + '" data-id="' + id + '"'
            + (over ? ' title="Nad strop kontextu — táto správa ho nepošle"' : '') + '>'
            + '<span class="ctx-label">' + esc(n.label) + '</span>'
            + '<button type="button" class="ctx-x ms" title="Odobrať z kontextu" aria-label="Odobrať z kontextu">close</button>'
            + '</span>';
    }).join('')
        + '<span class="ctx-usage">' + Math.min(ids.length, CONTEXT_CAP) + '/' + CONTEXT_CAP + '</span>'
        + '<button type="button" class="ctx-clear" title="Vyčistiť kontext">Vyčistiť</button>';
    row.querySelectorAll('.ctx-x').forEach((btn) => {
        btn.onclick = () => removeFromChatContext(+btn.closest('.ctx-chip').dataset.id);
    });
    const clr = row.querySelector('.ctx-clear');
    if (clr) clr.onclick = clearChatContext;
}
