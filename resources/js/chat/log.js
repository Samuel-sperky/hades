/* Zoznam správ. Tri režimy majú tri kontejnery, ale JEDEN stav — preto sa
   vždy vykresľuje len do aktívneho hosta a pri prepnutí režimu sa zoznam
   poskládá znovu zo `chatState.messages`. Rozpísaná (streamovaná) odpoveď je
   tiež v stave, takže prepnutie režimu ju nezhodí. */

import { $, emptyHtml } from '../core/dom.js';
import { buildMessage } from './message.js';
import { chatState } from './state.js';

const HOSTS = {
    quickbar: 'chat-log',
    overlay: 'chat-overlay-log',
    screen: 'chat-screen-log',
};

export function logHost(mode = chatState.mode) {
    return $(HOSTS[mode] || HOSTS.quickbar);
}

export function scrollLog(host = logHost()) {
    if (host) host.scrollTop = host.scrollHeight;
}

/** Postav zoznam správ nanovo. `streamingId` označí bublinu, ktorá ešte rastie. */
export function renderLog(streamingId = null) {
    const host = logHost();
    if (!host) return;
    host.innerHTML = '';

    const quick = chatState.mode === 'quickbar';
    if (!chatState.messages.length) {
        if (quick) { host.classList.add('hidden'); return; }
        host.innerHTML = emptyHtml('forum', 'Zatiaľ ticho. Napíš prvú otázku.');
        return;
    }
    const frag = document.createDocumentFragment();
    for (const msg of chatState.messages) {
        frag.appendChild(buildMessage(msg, { streaming: msg.id === streamingId }));
    }
    host.appendChild(frag);
    // Quickbar sa v pokoji nerozťahuje: správy sú vykreslené, ale skryté,
    // kým lišta nie je otvorená. Preto ich otvorenie hneď zobrazí históriu.
    const bar = $('prompt');
    host.classList.toggle('hidden', quick && !(bar && bar.classList.contains('open')));
    scrollLog(host);
}

/** Pridaj jednu správu na koniec aktívneho hosta a vráť jej riadok. */
export function appendMessageRow(msg, opts = {}) {
    const host = logHost();
    if (!host) return null;
    if (host.querySelector('.empty')) host.innerHTML = '';
    host.classList.remove('hidden');
    const row = buildMessage(msg, opts);
    host.appendChild(row);
    scrollLog(host);
    return row;
}

/** Riadok konkrétnej správy v aktívnom hostovi (po prepnutí režimu je iný). */
export function rowFor(id) {
    const host = logHost();
    return host ? host.querySelector('[data-msg-id="' + id + '"]') : null;
}
