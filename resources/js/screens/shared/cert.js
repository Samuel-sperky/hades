import { $, esc } from '../../core/dom.js';
import { originBadge } from './origin-badge.js';

const CERT_META = {
    overene: ['verified', 'Overené'],
    hypoteza: ['science', 'Hypotéza'],
    pasca: ['warning', 'Pasca'],
    pending: ['pending', 'Neštruktúrované'],
    bez: ['radio_button_unchecked', 'Bez istoty'],
};


export function certBadge(cert, iconOnly) {
    const key = CERT_META[cert] ? cert : 'bez';
    const meta = CERT_META[key];
    return '<span class="cert' + (iconOnly ? ' cert--icon' : '') + '" data-cert="' + key + '"'
        + (iconOnly ? ' title="' + esc(meta[1]) + '"' : '') + '>'
        + '<span class="ms" aria-hidden="true">' + meta[0] + '</span>'
        + (iconOnly ? '' : esc(meta[1])) + '</span>';
}


// F4: badge riadok v detaile uzla — origin + cert + needs_review + značky (chipy).
// Injektovaný do #node-view za #node-type (blade patrí F1). n má polia z toApi().
export function renderNodeBadges(n) {
    const view = $('node-view');
    if (!view) return;
    let row = $('node-badges');
    if (!row) {
        row = document.createElement('div');
        row.id = 'node-badges';
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 2px;';
        const anchor = $('node-type');
        if (anchor) anchor.insertAdjacentElement('afterend', row);
        else view.insertBefore(row, view.firstChild);
    }
    const tags = Array.isArray(n.tags) ? n.tags : [];
    const chips = tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    row.innerHTML = originBadge(n.origin)
        + (n.certainty ? certBadge(n.certainty) : '')
        + (n.needs_review ? certBadge('pending', true) : '')
        + chips;
}
