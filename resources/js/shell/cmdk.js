import { $, emptyHtml, esc } from '../core/dom.js';
import { certTagMatch, parseQueryFilter } from '../core/query-filter.js';
import { SCREEN_ICONS, SCREEN_LABELS, SCREENS } from '../core/screens.js';
import { gotoDirective } from '../screens/directive.js';
import { certBadge } from '../screens/shared/cert.js';
import { trapFocus } from './focus-trap.js';
import { openNodeFromAnywhere, setScreen } from './router.js';


/* ---------- Cmd-K paleta (zjednotené hľadanie + navigácia) ---------- */

/* Odvodené zo zamknutého rozhrania #16, nie opísané ručne. Predtým tu bol vlastný
   sedemprvkový zoznam z čias pred pridaním obrazoviek Chat a E-shop, takže sa na ne
   paletou nedalo dostať — bolo to posledné miesto, kde duplikát whitelistu prežil. */
const CMDK_NAV = SCREENS.map((screen) => ({
    screen,
    label: SCREEN_LABELS[screen],
    icon: SCREEN_ICONS[screen],
}));

let cmdkTimer = null, cmdkSeq = 0;


// Rozhodnutie #80: focus trap + návrat fókusu po zatvorení.
let releaseCmdkTrap = null;


export function openCmdk() {
    const overlay = $('cmdk');
    overlay.classList.remove('hidden');
    const input = $('cmdk-input');
    input.value = '';
    renderCmdk('');
    if (!releaseCmdkTrap) releaseCmdkTrap = trapFocus(overlay, { initial: input });
}

export function closeCmdk() {
    $('cmdk').classList.add('hidden');
    if (releaseCmdkTrap) { releaseCmdkTrap(); releaseCmdkTrap = null; }
}

export function cmdkOpen() { return !$('cmdk').classList.contains('hidden'); }


export function setupCmdk() {
    $('cmdk-trigger').onclick = openCmdk;
    const overlay = $('cmdk');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCmdk(); });
    const input = $('cmdk-input');
    input.addEventListener('input', () => renderCmdk(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = overlay.querySelector('.cmdk-item');
            if (first) { e.preventDefault(); first.click(); }
        }
    });
}


function bindCmdkItems(root) {
    root.querySelectorAll('.cmdk-item[data-nav]').forEach((el) => {
        el.onclick = () => { closeCmdk(); setScreen(el.dataset.nav); };
    });
    root.querySelectorAll('.cmdk-item[data-id]').forEach((el) => {
        el.onclick = () => {
            closeCmdk();
            openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: el.dataset.type });
        };
    });
    root.querySelectorAll('.cmdk-item[data-pb]').forEach((el) => {
        el.onclick = () => {
            const holder = el.closest('#cmdk-remote');
            const books = (holder && holder._books) || [];
            const b = books[+el.dataset.pb];
            if (b && b.node_id != null) {
                closeCmdk();
                openNodeFromAnywhere({ id: b.node_id, label: b.title || b.path, type: 'skill' });
            }
        };
    });
    root.querySelectorAll('.cmdk-item[data-action="directive"]').forEach((el) => {
        el.onclick = () => {
            const q = ($('cmdk-input').value || '').trim();
            closeCmdk();
            gotoDirective(q);
        };
    });
}


const CMDK_TYPE_NAMES = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };

const CMDK_TYPE_ICO = { core: 'brightness_7', skill: 'bolt', memory: 'psychology', project: 'inventory_2' };

const cmdkGroup = (t) => '<div class="cmdk-group">' + t + '</div>';


export function renderCmdk(q) {
    const query = (q || '').trim();
    const ql = query.toLowerCase();
    const wrap = $('cmdk-results');

    const nav = CMDK_NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql));
    let html = '';
    if (nav.length) {
        html += cmdkGroup('Prejsť na')
            + nav.map((n) => '<button type="button" class="cmdk-item" data-nav="' + n.screen + '">'
                + '<span class="ms" aria-hidden="true">' + n.icon + '</span>'
                + '<span class="cmdk-text"><span class="cmdk-title">' + esc(n.label) + '</span></span></button>').join('');
    }
    // Akcia: poskladať smernicu z aktuálneho dopytu (skočí na obrazovku Smernica)
    html += cmdkGroup('Akcia')
        + '<button type="button" class="cmdk-item" data-action="directive">'
        + '<span class="ms" aria-hidden="true">assignment</span>'
        + '<span class="cmdk-text"><span class="cmdk-title">Vytvor smernicu' + (query ? ': ' + esc(query) : '…') + '</span>'
        + '<span class="cmdk-sub">Poskladá kontext pre Claude Code</span></span></button>';
    html += '<div id="cmdk-remote"></div>';
    wrap.innerHTML = html;
    bindCmdkItems(wrap);

    // vzdialené hľadanie — jeden zdroj pravdy: SK-aware /api/search (uzly + playbooky).
    // Debounce 180 ms, od 2 znakov; nav ostáva okamžitá.
    clearTimeout(cmdkTimer);
    const seq = ++cmdkSeq;
    if (query.length < 2) return;
    const remote = $('cmdk-remote');
    if (remote) remote.innerHTML = '<div class="cmdk-hint-row">Hľadám…</div>';
    cmdkTimer = setTimeout(async () => {
        try {
            const data = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
            if (seq !== cmdkSeq) return;
            const box = $('cmdk-remote');
            if (!box) return;
            const nodes = data.nodes || [];
            const books = data.playbooks || [];
            let h = '';
            const pf = parseQueryFilter(query);
            const filtered = (pf.cert || pf.tag)
                ? nodes.filter((n) => certTagMatch(n, pf))
                : nodes;
            if (filtered.length) {
                h += cmdkGroup('Uzly')
                    + filtered.map((n) => '<button type="button" class="cmdk-item" data-id="' + n.id + '"'
                        + ' data-label="' + esc(n.label || '') + '" data-type="' + esc(n.type || 'skill') + '">'
                        + '<span class="ms" aria-hidden="true">' + (CMDK_TYPE_ICO[n.type] || 'circle') + '</span>'
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(n.label)
                        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '') + '</span>'
                        + '<span class="cmdk-sub">' + (n.snippet ? esc(n.snippet) : (CMDK_TYPE_NAMES[n.type] || esc(n.type || ''))) + '</span>'
                        + '</span></button>').join('');
            }
            if (books.length) {
                h += cmdkGroup('Playbooky')
                    + books.map((b, i) => '<button type="button" class="cmdk-item" data-pb="' + i + '">'
                        + '<span class="ms" aria-hidden="true">menu_book</span>'
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(b.title || b.path || '') + '</span>'
                        + (b.snippet ? '<span class="cmdk-sub">' + esc(b.snippet) + '</span>' : '')
                        + '</span></button>').join('');
            }
            if (!filtered.length && !books.length) h = emptyHtml('search_off', 'Nič sa nenašlo');
            box.innerHTML = h;
            box._books = books;
            bindCmdkItems(box);
        } catch (e) { /* offline nevadí */ }
    }, 180);
}


export function register(root) {
    setupCmdk(root);
}
