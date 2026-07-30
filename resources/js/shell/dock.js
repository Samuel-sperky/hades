import { $ } from '../core/dom.js';
import { refreshStats } from '../dock/stats.js';
import { renderStructure } from '../dock/structure.js';
import { loadTagFilter } from '../graph/filters-cert.js';


/* ---------- ovládanie ---------- */

const DOCK_SECTIONS = {
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


/* graph-tools (v hlavičke, viditeľné len na Grafe) + systém (rail). */
export function register(root) {
    const wire = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.onclick = fn; };
    wire('btn-structure', () => openDock('structure'));
    wire('btn-stats', () => openDock('stats'));
    wire('btn-legend', () => openDock('legend'));
    wire('btn-settings', () => openDock('settings'));
    wire('dock-close', closeDock);
}
