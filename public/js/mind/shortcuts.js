import { closeCmdk, cmdkOpen, openCmdk } from './cmdk.js';
import { toggleCharon } from './charon.js';
import { closeDock, dockOpen, openDock } from './dock.js';
import { clearLocal, setLocal } from './filters.js';
import { closeMdOverlay } from './md.js';
import { cancelConnect, closeNodePanel, openCreateNode } from './panels.js';
import { fitView, zoomBy } from './render.js';
import { openNodeFromAnywhere, setScreen } from './screens.js';
import { armKontrolaAction, disarmKontrolaBtn, kontrolaBtn, kontrolaMove, kontrolaNodeRef, kontrolaResolve, kontrolaState, kontrolaVerify } from './screens/kontrola.js';
import { clearFilter, currentPath, go, goUp, largestAreaId, largestDeptId, setView } from './sim.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $ } from './util.js';

export const SHORTCUTS = [
    ['Ctrl K / F / /', 'Hľadať (paleta)'],
    // Šípky v palete existovali len ako Enter na prvej položke; odkedy posúvajú
    // fokus po výsledkoch, patrí to aj do pomocníka — inak je to skrytá funkcia.
    ['↑ / ↓ / Enter', 'Pohyb v palete a potvrdenie'],
    ['1 / 2 / 3 / 4', 'Filter: celá sieť / oblasť / oddelenie / uzol'],
    ['V', 'Pohľad: Sieť ↔ Vrstvy (na Grafe)'],
    ['C', 'Charón — rozhovor nad grafom'],
    ['Enter', 'Zamerať zvolený uzol'],
    ['Esc', 'Zrušiť filter'],
    ['Backspace', 'O úroveň von'],
    ['D', 'Denník'],
    ['R', 'Štruktúra (na Kontrole: vyriešiť položku)'],
    ['S', 'Prehľad'],
    ['L', 'Legenda'],
    ['G', 'Lokálny graf zvoleného uzla'],
    ['N', 'Nový uzol'],
    ['+ / −', 'Zoom'],
    ['0', 'Vycentrovať'],
    ['?', 'Tento pomocník'],
];

export const MOUSE_HINTS = [
    ['ťahanie plátna', 'Posun scény'],
    ['ťahanie uzla', 'Prehodenie uzla (sieť sa preleje)'],
    ['koliesko', 'Zoom'],
    ['klik na uzol', 'Detail + zúženie filtra'],
    ['klik do prázdna', 'O úroveň von'],
    ['dvojklik do prázdna', 'Zrušiť celý filter naraz'],
];

/* VLNA GRAF A: klávesy 1–4 zužujú FILTER nad jednou scénou. go({level}) doplní
   chýbajúci kontext z S.nav; keď ho nemá odkiaľ vziať (napr. „2" bez zvolenej
   oblasti), clampNav by úroveň zhodil na mapu a kláves by ticho nerobil nič —
   preto tu doplníme najväčšiu oblasť / oddelenie. setView() sa už NEpoužíva,
   ten dnes prepína pohľad (Sieť / Vrstvy), nie úroveň. */
function goLevel(level) {
    if (level === 'node') {
        if (S.selected) return go({ level: 'node', node: S.selected.id });
        // Bez vybraného uzla clampNav úroveň zhodí a kláves by ticho nerobil nič,
        // hoci ho pomocník inzeruje — povedzme to používateľovi.
        showToast('Najprv vyber uzol (klik alebo Ctrl+K)');
        return currentPath();
    }
    if (level === 'map') return go({ level: 'map' });
    if (level === 'area') {
        const a = S.nav.area != null ? S.nav.area : largestAreaId();
        if (a == null) return currentPath();
        return go({ level: 'area', area: a });
    }
    const area = S.nav.area != null ? S.nav.area : largestAreaId();
    const d = S.nav.dept != null ? S.nav.dept : largestDeptId(area);
    if (d == null) return currentPath();
    return go({ level: 'dept', dept: d });
}

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
            if (S.local) { clearLocal(); return; }
            // VLNA GRAF A: posledný stupienok kaskády = ZRUŠ FILTER. Scéna je jedna,
            // takže niet kam „vyskakovať" — Esc len vráti celú sieť do plnej sily.
            // Postupné vynáranie po jednej úrovni má #btn-up a Backspace.
            clearFilter();
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
            case 'Digit1': goLevel('map'); return;
            case 'Digit2': goLevel('area'); return;
            case 'Digit3': goLevel('dept'); return;
            case 'Digit4': goLevel('node'); return;
            case 'Digit0': fitView(); return;
            case 'NumpadAdd': zoomBy(1.3); return;
            case 'NumpadSubtract': zoomBy(1 / 1.3); return;
        }

        switch (e.key) {
            case '1': goLevel('map'); break;
            case '2': goLevel('area'); break;
            case '3': goLevel('dept'); break;
            case '4': goLevel('node'); break;
            // Backspace / Enter až tu — nad inputmi ich odfiltroval strážca vyššie
            // a obrazovka Kontrola si ich zoberie skôr (jej blok je nad týmto).
            case 'Backspace': e.preventDefault(); goUp(); break;
            case 'Enter': if (S.selected) go({ level: 'node', node: S.selected.id }); break;
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
            // Pohľad grafu má zmysel len na Grafe. Mimo neho V prestavovalo fyziku
            // celej siete (zmerané 143 ms zaseknutého vlákna) bez akejkoľvek spätnej
            // väzby — obrazovka sa nezmenila, takže sa to javilo ako zaseknutie appky.
            case 'v': case 'V':
                if (S.screen !== 'graf') { showToast('Pohľad prepneš na obrazovke Graf'); break; }
                setView(S.gview === 'layers' ? 'net' : 'layers');
                break;
            // C otvára/zatvára dok Charóna nad grafom (kontrakt R-2/§1b: dok sa
            // otvára klávesou a tlačidlom, bez prepínača v Nastaveniach). Nahradil
            // mŕtvy chat, ktorý C otváral len keď bola zapnutá trieda `chat-on`.
            case 'c': case 'C':
                e.preventDefault();
                toggleCharon();
                break;
            case '+': case '=': zoomBy(1.3); break;
            case '-': zoomBy(1 / 1.3); break;
            case '0': fitView(); break;
            case '?': toggleHelp(); break;
        }
    });
}

export const HINTS = [
    { pos: { left: '104px', top: '120px' }, text: 'Vľavo prepínaš sedem obrazoviek — Dnes, Denník, Graf, Knižnica, Rozhodnutia, Kontrola a Smernica. Hades sa otvorí na Dnes.' },
    { pos: { left: '50%', top: '76px', transform: 'translateX(-50%)' }, text: 'Hore vpravo je hľadanie (Ctrl K alebo /). Nájde uzly, playbooky aj obrazovky.' },
    { pos: { left: '50%', top: '40%', transform: 'translateX(-50%)' }, text: 'Graf je jedna veľká sieť — chodíš po nej ťahaním a zoomom. Klik na oblasť, oddelenie alebo uzol ju len zaostrí (zvyšok stmavne), Esc filter zruší. V prepne na Vrstvy.' },
    { pos: { left: '104px', bottom: '24px' }, text: 'Dole vľavo nájdeš Nastavenia (tmavý režim, hustota, sieť) a Pomocníka.' },
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
