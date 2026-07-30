/* Markup obrazovky Kontrola. Čisté funkcie stavu → HTML, žiadny fetch, žiadny
   zápis do stavu — aby sa dal render čítať oddelene od akcií nad frontou. */

import { esc } from '../../core/dom.js';
import { emptyStateHtml, kpiGridHtml, sectionHtml } from '../shared/anatomy.js';
import { areaCoverage, coverage } from './coverage.js';

export const TABS = [
    ['review', 'Na overenie', 'fact_check'],
    ['bez', 'Bez istoty', 'radio_button_unchecked'],
];


/** KPI pás pokrytia istoty. Bez dashboardu sa nekreslí nič (nie nuly). */
export function statsHtml(cert) {
    if (!cert) return '';
    const c = coverage(cert);
    return kpiGridHtml([
        { value: c.pct, label: 'pokrytie istoty', suffix: '%', hero: true },
        { value: c.overene, label: 'overené', cert: 'overene' },
        { value: c.hypoteza, label: 'hypotéza', cert: 'hypoteza' },
        { value: c.pasca, label: 'pasca', cert: 'pasca' },
        { value: c.bez, label: 'bez značky', cert: 'bez' },
        { value: c.needsReview, label: 'na overenie', cert: 'pending' },
    ]);
}


/** Prepínač fronty s počtami. `role=tab` je na blade kontejneri `role=tablist`. */
export function tabsHtml(state) {
    const counts = {
        review: state.total,
        bez: state.cert ? (+state.cert.bez || 0) : null,
    };
    return TABS.map(([key, label, icon]) => {
        const on = state.tab === key;
        const n = counts[key];
        return '<button type="button" class="chip' + (on ? ' active' : '') + '"'
            + ' role="tab" aria-selected="' + (on ? 'true' : 'false') + '" data-tab="' + key + '">'
            + '<span class="ms" aria-hidden="true">' + icon + '</span>' + esc(label)
            + (n != null ? '<span class="chip-n tnum">' + n + '</span>' : '') + '</button>';
    }).join('');
}


/** Prázdny stav sa líši podľa fronty — každý vedie k inému ďalšiemu kroku. */
export function emptyForTabHtml(state) {
    if (state.tab === 'bez') {
        return emptyStateHtml('verified', 'Každý poznatok má značku',
            'Nič nezostalo na triedenie — celá sieť je označená.');
    }
    const bez = state.cert ? (+state.cert.bez || 0) : 0;
    return emptyStateHtml('fact_check', 'Fronta na overenie je prázdna',
        bez
            ? 'Nikto nič neoznačil na kontrolu. ' + bez + ' poznatkov však stále nemá značku '
              + 'istoty — prepni sa na „Bez istoty" a pretrieď ich.'
            : 'Backend nič neoznačil na kontrolu.',
        bez ? { id: 'kontrola-goto-bez', label: 'Otvoriť „Bez istoty"', icon: 'radio_button_unchecked' } : null);
}


/** Priznanie zdroja — keď fronta „bez istoty" prišla z klientskeho výberu. */
export function sourceNoteHtml(state) {
    if (state.tab !== 'bez' || state.source !== 'graph') return '';
    return '<p class="queue-note">Zobrazených ' + state.items.length
        + ' najsilnejších neoznačených uzlov (klientsky výber z grafu).</p>';
}


/** Najslabšie pokryté oblasti — hovoria, kde sa triedenie najviac vyplatí. */
export function areaSectionHtml(perArea) {
    const areas = areaCoverage(perArea).filter((a) => a.count > 0);
    if (!areas.length) return '';
    return sectionHtml('Najslabšie pokryté oblasti',
        areas.slice(0, 5).map((a) =>
            '<div class="dbar" style="--lobe:' + esc(a.color || 'var(--accent)') + ';">'
            + '<div class="dbar-head"><span class="db-dot"></span>'
            + '<span class="db-name">' + esc(a.name) + '</span>'
            + '<span class="db-n tnum">' + a.pct + ' %</span></div>'
            + '<div class="dbar-track"><div class="dbar-fill" style="width:' + a.pct + '%;"></div></div></div>').join(''),
        { cls: 'kontrola-areas', note: 'podiel značených' });
}
