/* Network filter slice. `filter.types/sources/areas/relations` hold HIDDEN values,
   `filter.tags` is a POSITIVE filter (empty = no filtering). */

import { store } from '../store.js';

export const filters = {
    // Filtre siete (Obsidian filters) — množiny SKRYTÝCH typov / zdrojov / oblastí.
    // tags je POZITÍVNY filter (F4): množina VYBRANÝCH značiek — prázdna = bez filtra,
    // inak sa zobrazia len uzly nesúce aspoň jednu vybranú značku (jadro vždy prejde).
    filter: { types: new Set(), sources: new Set(), areas: new Set(), tags: new Set(), relations: new Set() },
    // FÁZA HRANY: default 1.0 (skryje similarity 0.5 + jednorazové co_activation 0.6).
    minWeight: (() => { const v = store.raw('minWeight'); return v == null ? 1.0 : (parseFloat(v) || 0); })(),
    // FÁZA HRANY: režim kostry — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    skeleton: store.raw('skeleton') === '1',
    // FÁZA CERTAINTY (F4, §4.6): značky istoty na canvase (prstenec + dash encoding). Default ON.
    certRings: store.raw('certRings') !== '0',
    // FÁZA OBRAZOVKY: rozsah grafu — 'live' (jadro + projekty + spomienky + aktívne skilly)
    // alebo 'all' (celá sieť vrátane knižnice). Default 'live'.
    graphScope: store.raw('graphScope') === 'all' ? 'all' : 'live',
};

try {
    const f = JSON.parse(store.raw('filter') || '{}');
    for (const k of ['types', 'sources', 'areas', 'tags']) {
        if (Array.isArray(f[k])) filters.filter[k] = new Set(f[k]);
    }
} catch (e) { /* poškodený filter — čisté predvolené */ }

// FÁZA HRANY: filter kategórií vzťahov (part_of / uses / similarity / co_activation).
// manual + skill_mention (kategória 'core') je štruktúra a nefiltruje sa. Množina drží SKRYTÉ kategórie.
try {
    const rf = JSON.parse(store.raw('relfilter') || '[]');
    if (Array.isArray(rf)) filters.filter.relations = new Set(rf);
} catch (e) { /* poškodený filter vzťahov — čisté predvolené */ }
