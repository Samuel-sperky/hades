/* Autocomplete v composeri: `/` príkazy (rozhodnutie 91) a `@` uzly (92).

   Uzly sa hľadajú v už načítanej sieti (`S.byId`), nie cez /api/search — je to
   okamžité a funguje aj offline. Vybraný uzol sa vloží ako kontextový čip,
   nie ako text, takže backend dostane `context_node_ids`. */

import { $, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { COMMANDS } from './commands.js';
import { addToChatContext } from './context.js';

const MAX_ITEMS = 8;

let items = [];
let idx = 0;
let kind = null;    // 'cmd' | 'node' | null
let token = '';

const popupEl = () => $('chat-ac');

export const acOpen = () => items.length > 0;

export function closeAc() {
    items = []; idx = 0; kind = null; token = '';
    const p = popupEl();
    if (!p) return;
    p.classList.add('hidden');
    p.innerHTML = '';
    const input = $('prompt-input');
    if (input) input.removeAttribute('aria-activedescendant');
}

function paint() {
    const p = popupEl();
    if (!p) return;
    if (!items.length) { closeAc(); return; }
    p.classList.remove('hidden');
    p.innerHTML = items.map((it, i) => '<div class="ac-row' + (i === idx ? ' active' : '') + '"'
        + ' id="ac-row-' + i + '" role="option" aria-selected="' + (i === idx ? 'true' : 'false') + '"'
        + ' data-ac-index="' + i + '">'
        + '<span class="ac-label">' + esc(it.label) + '</span>'
        + (it.hint ? '<span class="ac-hint">' + esc(it.hint) + '</span>' : '')
        + '</div>').join('');
    const input = $('prompt-input');
    if (input) input.setAttribute('aria-activedescendant', 'ac-row-' + idx);
}

function matchNodes(q) {
    const needle = q.toLowerCase();
    const out = [];
    for (const n of S.nodes) {
        if (!n || !n.label) continue;
        if (needle && !n.label.toLowerCase().includes(needle)) continue;
        out.push({ label: n.label, hint: n.type, nodeId: n.id });
        if (out.length >= MAX_ITEMS * 3) break;
    }
    out.sort((a, b) => a.label.length - b.label.length);
    return out.slice(0, MAX_ITEMS);
}

/** Prepočítaj ponuku podľa textu pred kurzorom. */
export function refreshAc(input = $('prompt-input')) {
    if (!input) return;
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);

    const cmd = before.match(/^\/([\p{L}]*)$/u);
    if (cmd) {
        token = cmd[1].toLowerCase();
        kind = 'cmd';
        items = COMMANDS
            .filter((c) => !token || c.name.startsWith(token) || (c.aliases || []).some((a) => a.startsWith(token)))
            .slice(0, MAX_ITEMS)
            .map((c) => ({ label: '/' + c.name, hint: c.hint, insert: '/' + c.name + ' ' }));
        idx = 0;
        paint();
        return;
    }

    const at = before.match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u);
    if (at) {
        token = at[1];
        kind = 'node';
        items = matchNodes(token);
        idx = 0;
        paint();
        return;
    }

    closeAc();
}

/** Vlož vybranú položku. Vracia true, ak sa niečo vložilo. */
export function acceptAc(input = $('prompt-input')) {
    if (!items.length || !input) return false;
    const it = items[idx];
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const after = input.value.slice(caret);

    if (kind === 'cmd') {
        input.value = it.insert + after;
        const pos = it.insert.length;
        input.setSelectionRange(pos, pos);
    } else {
        // `@fragment` sa nahradí ničím — uzol ide do kontextu ako čip
        const cut = before.replace(/@[\p{L}\p{N}._-]*$/u, '');
        input.value = cut + after;
        input.setSelectionRange(cut.length, cut.length);
        if (it.nodeId != null) addToChatContext(it.nodeId);
    }
    closeAc();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

/** Klávesová obsluha. Vracia true, ak si klávesu vzalo autocomplete. */
export function acKeydown(e, input = $('prompt-input')) {
    if (!items.length) return false;
    switch (e.key) {
        case 'ArrowDown': e.preventDefault(); idx = (idx + 1) % items.length; paint(); return true;
        case 'ArrowUp': e.preventDefault(); idx = (idx - 1 + items.length) % items.length; paint(); return true;
        case 'Enter': case 'Tab': e.preventDefault(); return acceptAc(input);
        case 'Escape': e.preventDefault(); e.stopPropagation(); closeAc(); return true;
        default: return false;
    }
}

export function registerAc() {
    const p = popupEl();
    if (!p) return;
    p.addEventListener('mousedown', (e) => {
        const row = e.target.closest('[data-ac-index]');
        if (!row) return;
        e.preventDefault();
        idx = +row.dataset.acIndex;
        acceptAc();
    });
}
