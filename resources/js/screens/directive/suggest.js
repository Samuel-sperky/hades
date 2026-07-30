/* Návrhový checklist Smernice — markup položiek a skupín.

   Skupiny sú fixné (skills / projects / facts / rules) a poradie je súčasťou
   výsledného markdownu, takže sa nemení bez zmeny markdown-builder.js. */

import { esc } from '../../core/dom.js';

export const DIR_SECTIONS = [
    { key: 'skills', title: 'Skilly', icon: 'bolt' },
    { key: 'projects', title: 'Projekty', icon: 'inventory_2' },
    { key: 'facts', title: 'Fakty', icon: 'psychology' },
    { key: 'rules', title: 'Pravidlá', icon: 'gavel' },
];


function dirItemHtml(key, it, checked) {
    const id = +it.id;
    let sub = '';
    if (key === 'skills' && it.path) sub = '<code class="dir-path">' + esc(it.path) + '</code>';
    else if (key === 'projects' && it.info) sub = '<span class="dir-sub">' + esc(it.info) + '</span>';
    else if (it.snippet) sub = '<span class="dir-sub">' + esc(it.snippet) + '</span>';

    let badge = '';
    if (key === 'skills') {
        badge = it.verified
            ? '<span class="dir-badge ok">overené</span>'
            : '<span class="dir-badge warn">neoverené</span>';
    }

    return '<label class="check dir-check' + (checked ? '' : ' off') + '">'
        + '<input type="checkbox" data-id="' + id + '"' + (checked ? ' checked' : '') + '>'
        + '<span class="box" aria-hidden="true"></span>'
        + '<span class="dir-item-text"><span class="dir-item-label">' + esc(it.label || '') + badge + '</span>'
        + sub + '</span></label>';
}


/** @param {object} suggested payload `/api/directive/build`
    @param {Set<number>} selected */
export function suggestHtml(suggested, selected) {
    const sug = suggested || {};
    let h = '';
    for (const sec of DIR_SECTIONS) {
        const items = sug[sec.key] || [];
        if (!items.length) continue;
        h += '<div class="dir-group"><div class="dir-group-head">'
            + '<span class="ms" aria-hidden="true">' + sec.icon + '</span>' + esc(sec.title)
            + '<span class="dir-group-n tnum">' + items.length + '</span></div>'
            + items.map((it) => dirItemHtml(sec.key, it, selected.has(+it.id))).join('')
            + '</div>';
    }
    return h;
}


/** Celkový počet návrhov vo všetkých skupinách. */
export function suggestTotal(suggested) {
    const sug = suggested || {};
    return DIR_SECTIONS.reduce((n, s) => n + ((sug[s.key] || []).length), 0);
}


/** Zaškrtnuté položky po skupinách — vstup pre markdown builder. */
export function pickSelected(suggested, selected) {
    const out = {};
    for (const sec of DIR_SECTIONS) {
        out[sec.key] = ((suggested || {})[sec.key] || []).filter((it) => selected.has(+it.id));
    }
    return out;
}
