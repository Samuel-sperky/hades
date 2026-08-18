import { certBadge } from './certainty.js';
import { openNodeFromAnywhere, setScreen } from './screens.js';
import { gotoDirective } from './screens/smernica.js';
import { certTagMatch, parseQueryFilter } from './search.js';
import { $, emptyHtml, esc, plainInline, plainText, prettyProject, typeName } from './util.js';

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
// Kam sa vráti fokus po zavretí palety. Bez toho spadol na <body>, takže Tab po
// zavretí začínal od začiatku dokumentu — a paletu otvára KLÁVESOVÁ skratka,
// čiže presne ten používateľ, ktorému to vadí najviac.
export let cmdkReturnFocus = null;

export function openCmdk() {
    const overlay = $('cmdk');
    if (!cmdkOpen()) cmdkReturnFocus = document.activeElement;
    overlay.classList.remove('hidden');
    const input = $('cmdk-input');
    input.value = '';
    renderCmdk('');
    setTimeout(() => input.focus(), 30);
}
export function closeCmdk() {
    $('cmdk').classList.add('hidden');
    const back = cmdkReturnFocus;
    cmdkReturnFocus = null;
    // <body> nie je „kam sa vrátiť" — paletu často otvorí skratka v okamihu, keď nemá
    // fokus nič konkrétne, a vrátiť ho na body je to isté ako ho stratiť. Vtedy ho
    // dostane spúšťač palety, teda prvok, ktorý o nej hovorí.
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
    else { const t = $('cmdk-trigger'); if (t) t.focus(); }
}
export function cmdkOpen() { return !$('cmdk').classList.contains('hidden'); }

export function cmdkItems() {
    return [...$('cmdk-results').querySelectorAll('.cmdk-item')];
}

/* Šípky posúvajú SKUTOČNÝ fokus po položkách, nie vlastnú triedu „active":
   .cmdk-item:focus-visible má v CSS presne to podsvietenie, ktoré vlastná trieda
   potrebovala, a takto ho vidí aj čítač obrazovky (a Enter funguje nativne). */
export function cmdkMove(delta) {
    const items = cmdkItems();
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    const next = cur < 0
        ? (delta > 0 ? 0 : items.length - 1)
        : (cur + delta + items.length) % items.length;
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
}

export function setupCmdk() {
    $('cmdk-trigger').onclick = openCmdk;
    const overlay = $('cmdk');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCmdk(); });
    const input = $('cmdk-input');
    input.addEventListener('input', () => renderCmdk(input.value));

    // Listener je na OVERLAY, nie na vstupe: keď fokus sedí na položke, vstup už
    // žiadny keydown nedostane a šípky by prestali fungovať po prvom stlačení.
    overlay.addEventListener('keydown', (e) => {
        /* Paleta je modálny dialóg, takže si klávesy berie ona — von pustíme len Esc
           (globálna kaskáda ju má zavrieť) a Tab. Bez tohto by po odšípkovaní na
           položku (BUTTON, nie INPUT) prešlo „d" strážcom v setupShortcuts a appka by
           pod otvorenou paletou preskočila na Denník. Ctrl+K si tiež berie window
           handler — ten stojí nad strážcom a zavrie paletu, čo je správne. */
        if (e.key !== 'Escape' && e.key !== 'Tab' && !((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
            e.stopPropagation();
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdkMove(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); cmdkMove(-1); return; }
        if (e.key === 'Enter') {
            // na položke si Enter obslúži prehliadač sám (je to <button>)
            if (document.activeElement !== input) return;
            const first = cmdkItems()[0];
            if (first) { e.preventDefault(); first.click(); }
            return;
        }
        // Písanie po odšípkovaní musí ísť do dopytu, nie do prázdna. Hodnotu meníme
        // ručne — spoliehať sa na to, že sa znak „dodoručí" novo zaostrenému vstupu,
        // je závislé na prehliadači.
        if (document.activeElement === input) return;
        if (e.key === 'Backspace') {
            e.preventDefault();
            input.value = input.value.slice(0, -1);
            input.focus();
            renderCmdk(input.value);
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            input.value += e.key;
            input.focus();
            renderCmdk(input.value);
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
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(plainInline(prettyProject(n.label)))
                        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '') + '</span>'
                        + '<span class="cmdk-sub">' + (n.snippet ? esc(plainText(n.snippet)) : esc(typeName(n.type))) + '</span>'
                        + '</span></button>').join('');
            }
            if (books.length) {
                h += cmdkGroup('Playbooky')
                    + books.map((b, i) => '<button type="button" class="cmdk-item" data-pb="' + i + '">'
                        + '<span class="ms" aria-hidden="true">menu_book</span>'
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(plainInline(b.title || b.path || '')) + '</span>'
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
