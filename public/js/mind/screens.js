import { closeNodePanel, selectNode } from './panels.js';
import { markJournalSeen } from './rail.js';
import { focusNode, requestDraw, scheduleFrame } from './render.js';
import { renderJournal } from './screens/dennik.js';
import { renderToday } from './screens/dnes.js';
import { renderLibrary } from './screens/kniznica.js';
import { renderKontrola } from './screens/kontrola.js';
import { renderDecisions } from './screens/rozhodnutia.js';
import { renderDirective } from './screens/smernica.js';
import { S } from './state.js';
import { $, esc, renderBreadcrumb } from './util.js';

/* ---------- FÁZA SHELL: obrazovky Dnes / Denník / Graf / Knižnica ---------- */

export const SCREENS = ['dnes', 'dennik', 'graf', 'kniznica', 'rozhodnutia', 'kontrola', 'smernica'];
export const SCREEN_LABELS = { dnes: 'Dnes', dennik: 'Denník', graf: 'Graf', kniznica: 'Knižnica', rozhodnutia: 'Rozhodnutia', kontrola: 'Kontrola', smernica: 'Smernica' };

export function setScreen(name) {
    if (!SCREENS.includes(name)) name = 'dnes';
    const changed = S.screen !== name;
    S.screen = name;
    localStorage.setItem('hades.screen', name);
    document.body.dataset.screen = name;

    document.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.classList.toggle('active', b.dataset.screen === name);
    });
    document.querySelectorAll('#screens .screen').forEach((s) => {
        s.classList.toggle('active', s.id === 'screen-' + name);
    });

    renderScreenBreadcrumb(name);

    if (name === 'graf') {
        // plátno je hotové z kola 1 — len prebuď slučku (dirty + scheduleFrame)
        requestDraw();
        scheduleFrame();
    } else if (name === 'dnes') {
        renderToday();
    } else if (name === 'dennik') {
        renderJournal();
        markJournalSeen();
    } else if (name === 'kniznica') {
        renderLibrary();
    } else if (name === 'rozhodnutia') {
        renderDecisions();
    } else if (name === 'kontrola') {
        renderKontrola();
    } else if (name === 'smernica') {
        renderDirective();
    }
    if (changed && name !== 'graf') closeNodePanel();
}

export function renderScreenBreadcrumb(name) {
    if (name === 'graf') { renderBreadcrumb(); return; }
    const bc = $('breadcrumb');
    if (bc) bc.innerHTML = '<span class="current">' + esc(SCREEN_LABELS[name]) + '</span>';
}

// Uzol otvorený z ktorejkoľvek obrazovky (Denník/Knižnica/Dnes/Cmd-K) → skoč na Graf a otvor detail.
// ref môže byť plný načítaný uzol, alebo odľahčený {id,label,type,area_id} z hľadania/knižnice.
// Graf beží v scope=live (nie všetky uzly sú na plátne) — ak uzol nie je načítaný, otvor aspoň
// jeho detail (selectNode si dotiahne /api/nodes/{id}), len bez kamerového zaostrenia.
export function openNodeFromAnywhere(ref) {
    if (!ref || ref.id == null) return;
    const id = +ref.id;
    const loaded = S.byId.get(id);
    setScreen('graf');
    if (loaded) {
        S.cam.k = Math.max(S.cam.k, 1.1);
        focusNode(loaded);
        selectNode(loaded);
    } else {
        selectNode({
            id,
            label: ref.label || '',
            type: ref.type || 'skill',
            description: '',
            strength: ref.strength || 1,
            area_id: ref.area_id != null ? ref.area_id : null,
        });
    }
}
