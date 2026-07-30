/* Riadok fronty Kontroly (.queue-item) — spoločný markup pre obe fronty.

   `.queue-item[data-id]` a `.act-verify` / `.act-resolve` / `.act-skip` sú
   kontrakt so `shell/shortcuts.js` (klávesy j/k/Enter/v/r/Delete) — triedy sa
   nesmú premenovať bez patchu do shortcuts.js. */

import { esc } from '../../core/dom.js';
import { timeAgo } from '../../core/format.js';
import { certBadge } from '../shared/cert.js';
import { originBadge } from '../shared/origin-badge.js';

const ACTIONS = {
    verify:  ['verified', 'Overiť (v)', 'Overiť'],
    resolve: ['done_all', 'Vyriešiť (r)', 'Vyriešiť'],
    skip:    ['redo', 'Preskočiť', 'Preskočiť'],
};


function actionBtn(kind) {
    const a = ACTIONS[kind];
    return '<button type="button" class="act-' + kind + ' ms" data-act="' + kind + '"'
        + ' title="' + esc(a[1]) + '" aria-label="' + esc(a[2]) + '">' + a[0] + '</button>';
}


/** @param {object} n uzol z toApi()  @param {number} i index vo fronte
    @param {boolean} selected  @param {string[]} acts poradie akcií */
export function queueItemHtml(n, i, selected, acts) {
    const desc = n.description ? String(n.description).replace(/\s+/g, ' ').trim() : '';
    return '<div class="queue-item' + (selected ? ' selected' : '') + '"'
        + ' data-id="' + n.id + '" data-idx="' + i + '" tabindex="-1">'
        + '<div class="queue-body">'
        + '<div class="queue-meta">'
        + '<span>' + esc(n.type || 'uzol') + '</span>'
        + originBadge(n.origin) + certBadge(n.certainty)
        + (n.created_at ? '<span>' + esc(timeAgo(n.created_at)) + '</span>' : '')
        + '</div>'
        + '<div class="queue-text"><strong>' + esc(n.label || '') + '</strong>'
        + (desc ? ' — ' + esc(desc) : '') + '</div>'
        + '</div>'
        + '<div class="queue-actions">' + acts.map(actionBtn).join('') + '</div>'
        + '</div>';
}


/** Legenda klávesových skratiek pod frontou. */
export function hintsHtml(withResolve) {
    const kh = (keys, label) => '<span class="kh">'
        + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(label) + '</span>';
    return '<div class="kbd-hints">'
        + kh(['j', 'k'], 'posun')
        + kh(['Enter'], 'detail')
        + kh(['v'], 'overiť')
        + (withResolve ? kh(['r'], 'vyriešiť') : '')
        + kh(['Del'], 'zmazať uzol')
        + '</div>';
}
