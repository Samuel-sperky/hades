import { closeNodePanel, refreshStats } from './panels.js';
import { renderStructure } from './structure.js';
import { loadTagFilter } from './tagfilter.js';
import { $ } from './util.js';

/* Pod 900 px dostanú dock aj detail uzla v mind.css rovnaké `right: var(--edge)`
   a rovnakú šírku, takže otvorené naraz ležia presne na sebe. V CSS sa to vyriešiť
   nedá — stylesheet nevie, ktorý z nich je práve otvorený. Preto sa vylučujú tu.
   Hranica MUSÍ sedieť s @media (max-width: 900px) v mind.css; keď sa tam zmení,
   zmeň ju aj tu. */
const NARROW = window.matchMedia('(max-width: 900px)');


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
    if (NARROW.matches) closeNodePanel(); // úzke okno: dock a detail ležia na sebe
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
