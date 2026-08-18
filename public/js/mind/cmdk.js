import { certBadge } from './certainty.js';
import { openNodeFromAnywhere, setScreen } from './screens.js';
import { gotoDirective } from './screens/smernica.js';
import { certTagMatch, parseQueryFilter } from './search.js';
import { $, emptyHtml, esc, plainText, prettyProject, typeName } from './util.js';

/* ---------- Cmd-K paleta (zjednotené hľadanie + navigácia) ---------- */

export const CMDK_NAV = [
    { screen: 'dnes', label: 'Dnes', icon: 'wb_sunny' },
    { screen: 'dennik', label: 'Denník', icon: 'receipt_long' },
    { screen: 'graf', label: 'Graf', icon: 'hub' },
    { screen: 'kniznica', label: 'Knižnica', icon: 'menu_book' },
    { screen: 'rozhodnutia', label: 'Rozhodnutia', icon: 'gavel' },
    { screen: 'kontrola', label: 'Kontrola', icon: 'fact_check' },
    { screen: 'smernica', label: 'Smernica', icon: 'assignment' },
];
export let cmdkTimer = null, cmdkSeq = 0;

export function openCmdk() {
    const overlay = $('cmdk');
    overlay.classList.remove('hidden');
    const input = $('cmdk-input');
    input.value = '';
    renderCmdk('');
    setTimeout(() => input.focus(), 30);
}
export function closeCmdk() { $('cmdk').classList.add('hidden'); }
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

export function bindCmdkItems(root) {
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

/* Vlastná kópia mapy typov je zrušená — jediný zdroj je TYPE_NAMES v util.js,
   čítaný cez hoistovanú typeName(). Eager alias by tu bol pasca: const sa vyhodnotí
   pri načítaní modulu a util.js je súčasťou cyklov (importuje render.js aj sim.js),
   takže by mohol byť undefined. Pravidlo projektu je jasné — cez cyklus sa ťahajú
   HOISTOVANÉ funkcie, nie hodnoty. */
export const CMDK_TYPE_ICO = { core: 'brightness_7', skill: 'bolt', memory: 'psychology', project: 'inventory_2' };
export const cmdkGroup = (t) => '<div class="cmdk-group">' + t + '</div>';

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
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(prettyProject(n.label))
                        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '') + '</span>'
                        + '<span class="cmdk-sub">' + (n.snippet ? esc(plainText(n.snippet)) : esc(typeName(n.type))) + '</span>'
                        + '</span></button>').join('');
            }
            if (books.length) {
                h += cmdkGroup('Playbooky')
                    + books.map((b, i) => '<button type="button" class="cmdk-item" data-pb="' + i + '">'
                        + '<span class="ms" aria-hidden="true">menu_book</span>'
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(b.title || b.path || '') + '</span>'
                        + (b.snippet ? '<span class="cmdk-sub">' + esc(plainText(b.snippet)) + '</span>' : '')
                        + '</span></button>').join('');
            }
            if (!filtered.length && !books.length) h = emptyHtml('search_off', 'Nič sa nenašlo');
            box.innerHTML = h;
            box._books = books;
            bindCmdkItems(box);
        } catch (e) { /* offline nevadí */ }
    }, 180);
}
