import { collapsePrompt } from '../chat/composer.js';
import { $ } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { closePackDrawer, packDrawerOpen } from '../dock/pack.js';
import { fitView, zoomBy } from '../graph/camera.js';
import { setFocus } from '../graph/focus.js';
import { clearLocal, setLocal } from '../graph/local.js';
import { setView } from '../graph/view.js';
import { openCreateNode } from '../node/create-node.js';
import { cancelConnect } from '../node/edge-admin.js';
import { closeMdOverlay } from '../node/md-overlay.js';
import { closeNodePanel } from '../node/node-panel.js';
import { armKontrolaAction, disarmKontrolaBtn, kontrolaBtn, kontrolaMove, kontrolaNodeRef, kontrolaResolve, kontrolaState, kontrolaVerify } from '../screens/review.js';
import { closeCmdk, cmdkOpen, openCmdk } from './cmdk.js';
import { closeDock, dockOpen, openDock } from './dock.js';
import { toggleHelp } from './help.js';
import { openNodeFromAnywhere, setScreen } from './router.js';
import { showToast } from './toasts.js';


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


export function register(root) {
    setupShortcuts(root);
}
