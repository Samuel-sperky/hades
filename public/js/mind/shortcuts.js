import { closeCmdk, cmdkOpen, openCmdk } from './cmdk.js';
import { closeDock, dockOpen, openDock } from './dock.js';
import { clearLocal, setLocal } from './filters.js';
import { collapsePrompt } from './chat.js';
import { closeMdOverlay } from './md.js';
import { closePackDrawer, packDrawerOpen } from './pack.js';
import { cancelConnect, closeNodePanel, openCreateNode } from './panels.js';
import { fitView, zoomBy } from './render.js';
import { openNodeFromAnywhere, setScreen } from './screens.js';
import { armKontrolaAction, disarmKontrolaBtn, kontrolaBtn, kontrolaMove, kontrolaNodeRef, kontrolaResolve, kontrolaState, kontrolaVerify } from './screens/kontrola.js';
import { setView } from './sim.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $, setFocus } from './util.js';

export const SHORTCUTS = [
    ['Ctrl K / F / /', 'Hľadať (paleta)'],
    ['1 / 2 / 3', 'Náhľad grafu: Mapa / Sieť / Vrstvy'],
    ['D', 'Denník'],
    ['R', 'Štruktúra'],
    ['S', 'Prehľad'],
    ['L', 'Legenda'],
    ['G', 'Lokálny graf zvoleného uzla'],
    ['N', 'Nový uzol'],
    ['+ / −', 'Zoom'],
    ['0', 'Vycentrovať'],
    ['?', 'Tento pomocník'],
    ['Esc', 'Zavrieť panely'],
];

export const MOUSE_HINTS = [
    ['ťahanie', 'Posun plátna'],
    ['ťahanie uzla', 'Presun uzla (mapa / sieť)'],
    ['koliesko', 'Zoom'],
    ['klik na uzol', 'Detail'],
    ['dvojklik na oblasť', 'Zaostrenie oblasti'],
    ['Esc', 'Postupné zatváranie'],
];

export let helpReturnFocus = null;

export function toggleHelp(show) {
    const el = $('help-overlay');
    const target = show === undefined ? el.classList.contains('hidden') : show;
    el.classList.toggle('hidden', !target);
    if (target && !$('help-body').children.length) {
        const row = ([k, d]) => {
            const caps = k.split(/\s*\/\s*/).map((x) => '<kbd>' + x + '</kbd>').join('<span class="sep">/</span>');
            return '<div class="key-row"><span class="label">' + d + '</span><span>' + caps + '</span></div>';
        };
        $('help-body').innerHTML = SHORTCUTS.map(row).join('')
            + '<h3>Myš</h3>'
            + MOUSE_HINTS.map(row).join('');
    }
    if (target) {
        helpReturnFocus = document.activeElement;
        $('help-close').focus();
    } else if (helpReturnFocus) {
        helpReturnFocus.focus();
        helpReturnFocus = null;
    }
}

export function setupShortcuts() {
    $('help-close').onclick = () => toggleHelp(false);
    $('help-overlay').addEventListener('click', (e) => {
        if (e.target === $('help-overlay')) toggleHelp(false);
    });

    window.addEventListener('keydown', (e) => {
        // FÁZA SHELL: Cmd/Ctrl+K → globálna paleta (hľadanie + navigácia), toggle
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            if (cmdkOpen()) closeCmdk(); else openCmdk();
            return;
        }

        if (e.key === 'Escape') {
            // kaskáda — jeden Esc zavrie vždy len najvrchnejšiu vrstvu
            if (cmdkOpen()) { closeCmdk(); return; }
            if (packDrawerOpen()) { closePackDrawer(); return; }
            if (S.connectFrom) { cancelConnect(); showToast('Prepájanie zrušené'); return; }
            if (S.screen === 'kontrola') {
                const armed = document.querySelector('#kontrola-body .act-skip.armed');
                if (armed) { disarmKontrolaBtn(armed); return; }
            }
            if (document.body.classList.contains('ambient')) {
                document.body.classList.remove('ambient');
                return;
            }
            if (!$('md-overlay').classList.contains('hidden')) { closeMdOverlay(); return; }
            if (!$('help-overlay').classList.contains('hidden')) { toggleHelp(false); return; }
            const deptRow = document.querySelector('#structure-tree .dept-actions');
            if (deptRow) { deptRow.remove(); return; }
            if (!$('node-panel').classList.contains('hidden')) { closeNodePanel(); return; }
            if (dockOpen) { closeDock(); return; }
            if ($('prompt').classList.contains('open') || !$('chat-log').classList.contains('hidden')) {
                collapsePrompt();
                return;
            }
            if (S.local) { clearLocal(); return; }
            if (S.focus.areaId) setFocus(null, null);
            return;
        }

        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;

        // Obrazovka Kontrola — klávesová fronta (skratky NEstrieľajú mimo nej)
        if (S.screen === 'kontrola' && kontrolaState.items.length) {
            const cur = kontrolaState.items[kontrolaState.idx];
            let handled = true;
            switch (e.key) {
                case 'j': case 'ArrowDown': kontrolaMove(1); break;
                case 'k': case 'ArrowUp': kontrolaMove(-1); break;
                case 'Enter': if (cur) openNodeFromAnywhere(kontrolaNodeRef(cur.id)); break;
                case 'v': case 'V': if (cur) kontrolaVerify(cur.id); break;
                case 'r': case 'R': if (cur) kontrolaResolve(cur.id); break;
                case 'Delete': case 'Backspace': if (cur) armKontrolaAction(kontrolaBtn(cur.id, 'skip'), cur.id, 'delete'); break;
                default: handled = false;
            }
            if (handled) { e.preventDefault(); return; }
        }

        // SK klávesnica: fyzické kódy číslic fungujú nezávisle od rozloženia
        switch (e.code) {
            case 'Digit1': setView('map'); return;
            case 'Digit2': setView('net'); return;
            case 'Digit3': setView('layers'); return;
            case 'Digit0': fitView(); return;
            case 'NumpadAdd': zoomBy(1.3); return;
            case 'NumpadSubtract': zoomBy(1 / 1.3); return;
        }

        switch (e.key) {
            case '1': setView('map'); break;
            case '2': setView('net'); break;
            case '3': setView('layers'); break;
            case '/': case 'f': case 'F': e.preventDefault(); openCmdk(); break;
            case 'r': case 'R': openDock('structure'); break;
            case 's': case 'S': openDock('stats'); break;
            case 'd': case 'D': setScreen('dennik'); break;
            case 'l': case 'L': openDock('legend'); break;
            case 'g': case 'G':
                // lokálny graf zvoleného uzla — toggle; hĺbka sa zachováva
                if (S.selected) {
                    if (S.local && S.local.rootId === S.selected.id) clearLocal();
                    else setLocal(S.selected.id, S.local ? S.local.depth : 1);
                }
                break;
            case 'n': case 'N': openCreateNode(); break;
            case 'c': case 'C':
                if (document.body.classList.contains('chat-on')) {
                    e.preventDefault();
                    $('prompt').classList.add('open');
                    $('prompt-input').focus();
                }
                break;
            case '+': case '=': zoomBy(1.3); break;
            case '-': zoomBy(1 / 1.3); break;
            case '0': fitView(); break;
            case '?': toggleHelp(); break;
        }
    });
}

export const HINTS = [
    { pos: { left: '104px', top: '120px' }, text: 'Vľavo prepínaš obrazovky — Dnes, Denník, Graf a Knižnica. Hades sa otvorí na Dnes.' },
    { pos: { left: '50%', top: '76px', transform: 'translateX(-50%)' }, text: 'Hore vpravo je hľadanie (Ctrl K alebo /). Nájde uzly, playbooky aj obrazovky.' },
    { pos: { left: '50%', top: '40%', transform: 'translateX(-50%)' }, text: 'Na obrazovke Graf klik na uzol otvorí detail. Dvojklik na oblasť ju zaostrí — Esc zaostrenie zruší.' },
    { pos: { left: '104px', bottom: '24px' }, text: 'Dole vľavo nájdeš Nastavenia (tmavý režim, sieť, chat) a Pomocníka.' },
];

export function setupHints() {
    if (localStorage.getItem('hades.hints2') === 'done') return;
    const el = $('hint');
    let i = 0;

    const finish = () => {
        el.classList.add('hidden');
        localStorage.setItem('hades.hints2', 'done');
    };

    const show = () => {
        if (i >= HINTS.length) { finish(); return; }
        const h = HINTS[i];
        $('hint-text').textContent = h.text;
        const step = $('hint-step');
        if (step) step.textContent = (i + 1) + ' / ' + HINTS.length;
        $('hint-next').textContent = i === HINTS.length - 1 ? 'Hotovo' : 'Ďalej';
        el.style.left = ''; el.style.top = ''; el.style.bottom = ''; el.style.transform = '';
        Object.assign(el.style, h.pos);
        el.classList.remove('hidden');
    };

    $('hint-next').onclick = () => { i++; show(); };
    const skip = $('hint-skip');
    if (skip) skip.onclick = finish;
    show();
}
