/* Jedna správa v chate — bublina + citácie + mikro-label + akcie.

   Markdown ide cez zamknuté rozhranie #10 (mdToHtml), ktoré escapuje zdroj
   PRED formátovaním, takže odpoveď modelu nemôže vložiť HTML.

   a11y (rozhodnutie 80): bublina je atomický `aria-live` región. Počas
   streamovania má `aria-busy="true"`, takže čítač neoznamuje každý token —
   ohlási sa raz, keď je odpoveď hotová. „Thinking" indikátor je aria-hidden. */

import { esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { mdToHtml } from '../markdown.js';

const MD_OPTS = { codeCopyButton: true, frontmatter: false };

export function renderMarkdown(text) {
    return mdToHtml(text || '', MD_OPTS);
}

function actionBtn(action, icon, label) {
    return '<button type="button" class="msg-act ms" data-chat-action="' + action + '"'
        + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' + icon + '</button>';
}

/** Mikro-label: model · tok/s · čas (rozhodnutie 120). */
export function metaLine(msg) {
    const bits = [];
    if (msg.model) bits.push(esc(msg.model));
    if (msg.tokPerS) bits.push(Math.round(msg.tokPerS) + ' tok/s');
    if (msg.ms) bits.push((msg.ms >= 1000 ? (msg.ms / 1000).toFixed(1) + ' s' : Math.round(msg.ms) + ' ms'));
    if (msg.degraded) bits.push('z pamäte');
    return bits.join(' · ');
}

/** Citácie „Vychádzal som z:" — klik na čip vyberie uzol a preletí naň kamerou. */
function citationsHtml(ids) {
    const known = (ids || []).map((id) => +id).filter((id) => S.byId.has(id));
    if (!known.length) return '';
    const chips = known.map((id) => '<button type="button" class="cite-chip" data-chat-action="cite"'
        + ' data-node-id="' + id + '">' + esc(S.byId.get(id).label) + '</button>').join('');
    return '<div class="msg-cites"><span class="msg-cites-label">Vychádzal som z:</span>' + chips + '</div>';
}

/** Vytvor DOM element správy. `streaming` nechá bublinu v busy stave. */
export function buildMessage(msg, { streaming = false } = {}) {
    const row = document.createElement('div');
    row.className = 'msg-row msg-row--' + (msg.role === 'user' ? 'user' : msg.role);
    row.dataset.msgId = msg.id;
    if (msg.role === 'user') {
        const b = document.createElement('div');
        b.className = 'msg me';
        b.textContent = msg.content;
        row.appendChild(b);
        row.appendChild(footer(msg, ['copy', 'remember']));
        return row;
    }
    if (msg.role === 'system') {
        const b = document.createElement('div');
        b.className = 'msg sys' + (msg.error ? ' sys--error' : '');
        b.textContent = msg.content;
        row.appendChild(b);
        return row;
    }

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = 'A';
    row.appendChild(avatar);

    const col = document.createElement('div');
    col.className = 'msg-col';

    const bubble = document.createElement('div');
    bubble.className = 'msg aura md-body';
    bubble.setAttribute('aria-live', 'polite');
    bubble.setAttribute('aria-atomic', 'true');
    bubble.setAttribute('aria-busy', streaming ? 'true' : 'false');
    if (streaming && !msg.content) {
        bubble.innerHTML = '<span class="thinking" aria-hidden="true">'
            + '<span class="dot">·</span><span class="dot">·</span><span class="dot">·</span></span>';
    } else {
        bubble.innerHTML = renderMarkdown(msg.content);
    }
    col.appendChild(bubble);

    if (msg.citations && msg.citations.length) {
        const cites = document.createElement('div');
        cites.innerHTML = citationsHtml(msg.citations);
        if (cites.firstElementChild) col.appendChild(cites.firstElementChild);
    }

    if (!streaming) col.appendChild(footer(msg, ['copy', 'regen', 'remember']));
    row.appendChild(col);
    return row;
}

function footer(msg, actions) {
    const foot = document.createElement('div');
    foot.className = 'msg-foot';
    const meta = metaLine(msg);
    const labels = { copy: 'Kopírovať', regen: 'Regenerovať', remember: 'Zapamätať' };
    const icons = { copy: 'content_copy', regen: 'refresh', remember: 'bookmark_add' };
    foot.innerHTML = (meta ? '<span class="msg-meta">' + esc(meta) + '</span>' : '')
        + '<span class="msg-acts">'
        + actions.map((a) => actionBtn(a, icons[a], labels[a])).join('')
        + '</span>';
    return foot;
}

/** Prepíš telo streamovanej bubliny novým textom. */
export function updateStreamingBubble(row, text) {
    if (!row) return;
    const bubble = row.querySelector('.msg');
    if (!bubble) return;
    bubble.innerHTML = renderMarkdown(text);
}

/** Streamovanie skončilo — doplň citácie, mikro-label a akcie. */
export function finishStreamingRow(row, msg) {
    if (!row) return;
    const bubble = row.querySelector('.msg');
    const col = row.querySelector('.msg-col');
    if (bubble) {
        bubble.innerHTML = renderMarkdown(msg.content);
        bubble.setAttribute('aria-busy', 'false');
    }
    if (!col) return;
    if (msg.citations && msg.citations.length) {
        const wrap = document.createElement('div');
        wrap.innerHTML = citationsHtml(msg.citations);
        if (wrap.firstElementChild) col.appendChild(wrap.firstElementChild);
    }
    col.appendChild(footer(msg, ['copy', 'regen', 'remember']));
}
