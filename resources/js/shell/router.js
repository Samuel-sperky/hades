import { bus } from '../core/bus.js';
import { $, esc } from '../core/dom.js';
import { EV } from '../core/events.js';
import { SCREEN_LABELS, normalizeScreen } from '../core/screens.js';
import { S } from '../core/state/index.js';
import { store } from '../core/store.js';
import { focusNode } from '../graph/camera.js';
import { requestDraw, scheduleFrame } from '../graph/render/frame.js';
import { closeNodePanel, selectNode } from '../node/node-panel.js';
import { renderDecisions } from '../screens/decisions.js';
import { renderDirective } from '../screens/directive.js';
import { renderJournal } from '../screens/journal.js';
import { renderLibrary } from '../screens/library.js';
import { renderKontrola } from '../screens/review.js';
import { renderToday } from '../screens/today.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { markJournalSeen } from './rail.js';


/* ---------- FÁZA SHELL: prepínanie obrazoviek ----------
   Zoznam obrazoviek a popisky sú v core/screens.js (zamknuté rozhranie #16).
   Obrazovky bez vlastnej render funkcie (chat, eshop) sa vykresľujú na bus
   event `screen:changed` — router o nich nemusí nič vedieť. */


export function setScreen(name) {
    name = normalizeScreen(name);
    const from = S.screen;
    const changed = from !== name;
    S.screen = name;
    store.setRaw('screen', name);
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

    // Jediný oznam o zmene obrazovky. Moduly, ktoré nemajú v routeri render hook
    // (chat P6, e-shop P11), sa naň prihlasujú cez bus a router ich neimportuje.
    bus.emit(EV.SCREEN_CHANGED, { from, to: name });
}


function renderScreenBreadcrumb(name) {
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
