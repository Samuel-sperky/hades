import { setGraphScope } from './pack.js';
import { showToast } from './toasts.js';
import { closeNodePanel, selectNode } from './panels.js';
import { markJournalSeen } from './rail.js';
import { focusNode, requestDraw, scheduleFrame } from './render.js';
import { renderJournal } from './screens/dennik.js';
import { renderToday } from './screens/dnes.js';
import { renderLibrary } from './screens/kniznica.js';
import { renderKontrola } from './screens/kontrola.js';
import { renderDecisions } from './screens/rozhodnutia.js';
import { renderDirective } from './screens/smernica.js';
import { renderRuns } from './screens/runy.js';
import { S } from './state.js';
import { $, esc, renderBreadcrumb } from './util.js';

/* ---------- FÁZA SHELL: obrazovky Dnes / Denník / Graf / Knižnica ---------- */

export const SCREENS = ['dnes', 'dennik', 'graf', 'kniznica', 'rozhodnutia', 'runy', 'kontrola', 'smernica'];
export const SCREEN_LABELS = { dnes: 'Dnes', dennik: 'Denník', graf: 'Graf', kniznica: 'Knižnica', rozhodnutia: 'Rozhodnutia', runy: 'Runy', kontrola: 'Kontrola', smernica: 'Smernica' };

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
    } else if (name === 'runy') {
        renderRuns();
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

/* Poradie preklikov a rozbehnuté rozšírenie rozsahu pre openNodeFromAnywhere().
   Deklarované PRED funkciou zámerne: `let` v dočasnej mŕtvej zóne by pri cyklickom
   importe, kde by niekto zavolal openNodeFromAnywhere() ešte počas vyhodnocovania
   modulov, spadlo na ReferenceError. V tomto grafe modulov cykly sú. */
let openSeq = 0;
let scopeWidening = null;

// Uzol otvorený z ktorejkoľvek obrazovky (Denník/Knižnica/Dnes/Cmd-K) → skoč na Graf a otvor detail.
// ref môže byť plný načítaný uzol, alebo odľahčený {id,label,type,area_id} z hľadania/knižnice.
//
// Graf beží v scope=live, takže na plátne je len časť siete. Do 20. 8. 2026 sa pri
// uzle mimo rozsahu otvoril detail, ale kamera sa nepohla a NIČ to nepovedalo —
// človek videl panel a na plátne uzol nikde. Hľadanie tým prestávalo hľadať.
// Teraz sa pohľad rozšíri na celú sieť, uzol sa zaostrí a rozšírenie sa ohlási:
// je to zmena trvalého nastavenia, takže o nej musí byť vidieť.
export function openNodeFromAnywhere(ref) {
    if (!ref || ref.id == null) return;
    const id = +ref.id;
    const seq = ++openSeq;
    const loaded = S.byId.get(id);
    setScreen('graf');
    if (loaded) {
        focusFound(loaded);
        return;
    }

    // detail hneď (selectNode si dotiahne /api/nodes/{id}), aby obrazovka nebola prázdna
    selectNode({
        id,
        label: ref.label || '',
        type: ref.type || 'skill',
        description: '',
        strength: ref.strength || 1,
        area_id: ref.area_id != null ? ref.area_id : null,
    });

    /* Rozšírenie rozsahu je async a dovtedy sa toho môže stať dosť: človek klikne
       na iný uzol, alebo odíde na inú obrazovku. Bez strážcu by staršia odpoveď
       dobehla ako posledná a strhla panel späť na predošlý uzol — prípadne ho
       otvorila na obrazovke, kde detail uzla nemá čo robiť (#node-panel nie je
       vnorený v .screen, takže ho prepnutie obrazovky samo neskryje).
       Je to ten istý vzor ako `reloadSeq` v api.js. */
    const widened = S.graphScope !== 'all';
    if (!widened && !scopeWidening) return; // širšie sa už ísť nedá a nič nebeží

    // druhý preklik nespúšťa druhé rozšírenie, pripojí sa na to bežiace
    const wait = widened
        ? (scopeWidening = setGraphScope('all').finally(() => { scopeWidening = null; }))
        : scopeWidening;

    wait.then(() => {
        if (seq !== openSeq) return;      // medzitým prišiel novší preklik
        if (S.screen !== 'graf') return;  // človek medzitým odišiel inam
        const now = S.byId.get(id);
        if (!now) return; // uzol nie je ani v celej sieti (zmazaný medzitým) — detail stačí
        if (widened) showToast('Graf rozšírený na celú knižnicu — uzol bol mimo živého pohľadu');
        focusFound(now);
    });
}


/** Zaostrenie na nájdený uzol: priblíž, doleť, otvor detail. */
function focusFound(node) {
    S.cam.k = Math.max(S.cam.k, 1.1);
    focusNode(node);
    selectNode(node);
}
