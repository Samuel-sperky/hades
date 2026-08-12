import { refreshStats } from './panels.js';
import { renderStructure } from './structure.js';
import { loadTagFilter } from './tagfilter.js';
import { $ } from './util.js';

/* ---------- ovládanie ---------- */

export const DOCK_SECTIONS = {
    structure: { title: 'Štruktúra', btn: 'btn-structure' },
    stats: { title: 'Prehľad', btn: 'btn-stats' },
    legend: { title: 'Legenda', btn: 'btn-legend' },
    settings: { title: 'Zobrazenie', btn: 'btn-settings' },
};

export let dockOpen = null;

export function openDock(name) {
    if (dockOpen === name) { closeDock(); return; }
    dockOpen = name;
    $('dock').classList.remove('hidden');
    $('dock-title').textContent = DOCK_SECTIONS[name].title;

    for (const key of Object.keys(DOCK_SECTIONS)) {
        $('sec-' + key).classList.toggle('hidden', key !== name);
        $(DOCK_SECTIONS[key].btn).classList.toggle('active', key === name);
    }

    if (name === 'structure') renderStructure();
    if (name === 'stats') refreshStats();
    if (name === 'settings') loadTagFilter(); // F4: obnov značky (mohli pribudnúť brain-syncom)
}
export function closeDock() {
    dockOpen = null;
    $('dock').classList.add('hidden');
    for (const key of Object.keys(DOCK_SECTIONS)) {
        $(DOCK_SECTIONS[key].btn).classList.remove('active');
    }
}
