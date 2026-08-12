import { closeCmdk, openCmdk, renderCmdk } from './cmdk.js';
import { openDock } from './dock.js';
import { anchorOf } from './layout.js';
import { selectNode } from './panels.js';
import { draw, fitView, zoomBy } from './render.js';
import { toggleHelp } from './shortcuts.js';
import { buildSim, kickSim, setView } from './sim.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $, busy, esc, updateHeaderMetrics } from './util.js';

/* ---------- chat ---------- */

export const chatHistory = [];

// E3: uzly priložené do kontextu chatu (perzistentné naprieč reloadmi)
S.chatContext = new Set();
try {
    const cc = JSON.parse(localStorage.getItem('hades.chatContext') || '[]');
    if (Array.isArray(cc)) cc.forEach((id) => S.chatContext.add(+id));
} catch (e) { /* poškodený kontext — prázdny */ }

export function persistChatContext() {
    localStorage.setItem('hades.chatContext', JSON.stringify([...S.chatContext]));
}

export function addToChatContext(id) {
    S.chatContext.add(+id);
    persistChatContext();
    renderContextChips();
}

export function removeFromChatContext(id) {
    S.chatContext.delete(+id);
    persistChatContext();
    renderContextChips();
}

// Čipy nad chatom — štítky uzlov v kontexte, × odoberá, „Vyčistiť" zmaže všetky.
// Mŕtve id (zmazané uzly) sa preskočia a zároveň vyčistia z úložiska.
export function renderContextChips() {
    const row = $('chat-context');
    if (!row) return;
    const ids = [...S.chatContext].filter((id) => S.byId.has(id));
    if (ids.length !== S.chatContext.size) {
        S.chatContext = new Set(ids);
        persistChatContext();
    }
    if (!ids.length) { row.classList.add('hidden'); row.innerHTML = ''; return; }
    row.classList.remove('hidden');
    row.innerHTML = ids.map((id) => {
        const n = S.byId.get(id);
        return '<span class="ctx-chip" data-id="' + id + '">'
            + '<span class="ctx-label">' + esc(n.label) + '</span>'
            + '<button type="button" class="ctx-x ms" title="Odobrať z kontextu" aria-label="Odobrať z kontextu">close</button>'
            + '</span>';
    }).join('')
        + '<button type="button" class="ctx-clear" title="Vyčistiť kontext">Vyčistiť</button>';
    row.querySelectorAll('.ctx-x').forEach((btn) => {
        btn.onclick = () => removeFromChatContext(+btn.closest('.ctx-chip').dataset.id);
    });
    const clr = row.querySelector('.ctx-clear');
    if (clr) clr.onclick = () => { S.chatContext.clear(); persistChatContext(); renderContextChips(); };
}

// E2: potvrdzovacia karta „Zapamätať" v chate — vytvorí uzol po úprave a potvrdení
export function renderSuggestCard(sug) {
    const log = $('chat-log');
    log.classList.remove('hidden');
    const card = document.createElement('div');
    card.className = 'suggest-card';
    const areaOpts = '<option value="">— bez oblasti —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    card.innerHTML =
        '<div class="sc-head"><span class="ms" aria-hidden="true">bookmark_add</span><span>Zapamätať:</span></div>'
        + '<input class="sc-label" maxlength="255" aria-label="Názov uzla">'
        + '<div class="sc-row">'
        +   '<select class="sc-type" aria-label="Typ">'
        +     '<option value="memory">Spomienka</option>'
        +     '<option value="skill">Skill</option>'
        +     '<option value="project">Projekt</option>'
        +   '</select>'
        +   '<select class="sc-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '</div>'
        + '<div class="sc-actions">'
        +   '<button type="button" class="primary sc-save">Uložiť</button>'
        +   '<button type="button" class="ghost sc-cancel">Zrušiť</button>'
        + '</div>';
    log.appendChild(card);
    card.querySelector('.sc-label').value = sug.label || '';
    const typeSel = card.querySelector('.sc-type');
    if (sug.type) typeSel.value = sug.type;
    log.scrollTop = 1e9;

    card.querySelector('.sc-cancel').onclick = () => card.remove();
    card.querySelector('.sc-save').onclick = (ev) => busy(ev.currentTarget, async () => {
        const label = card.querySelector('.sc-label').value.trim();
        if (!label) { showToast('Zadaj názov uzla'); return; }
        try {
            const res = await fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label,
                    type: typeSel.value,
                    description: sug.description || null,
                    area_id: card.querySelector('.sc-area').value ? +card.querySelector('.sc-area').value : null,
                }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                showToast(d.message || 'Vytvorenie sa nepodarilo');
                return;
            }
            const data = await res.json();
            let n = S.byId.get(data.node.id); // WS echo node.created mohol byť rýchlejší
            if (!n) {
                n = { ...data.node };
                const a = anchorOf(n);
                n.x = a.x + (Math.random() - 0.5) * 50;
                n.y = a.y + (Math.random() - 0.5) * 50;
                n.flash = 1;
                S.nodes.push(n);
                S.byId.set(n.id, n);
                buildSim();
                kickSim(0.4);
            }
            updateHeaderMetrics();
            draw();
            card.remove();
            showToast('Uzol vytvorený', n.id);
            selectNode(n);
        } catch (err) {
            showToast('Vytvorenie sa nepodarilo');
        }
    }, 'Ukladám…');
}

export function addMsg(cls, text) {
    const log = $('chat-log');
    log.classList.remove('hidden');
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls.indexOf('thinking') !== -1) {
        div.innerHTML = '<span class="dot">·</span><span class="dot">·</span><span class="dot">·</span>';
    } else {
        div.textContent = text;
    }
    // Hadesove odpovede (aj thinking) dostanú avatar so zlatým prstencom
    let el = div;
    if (cls.indexOf('hades') !== -1) {
        el = document.createElement('div');
        el.className = 'msg-row';
        el.innerHTML = '<span class="avatar" aria-hidden="true">H</span>';
        el.appendChild(div);
    }
    log.appendChild(el);
    log.scrollTop = 1e9;
    return el;
}

export function collapsePrompt() {
    $('prompt').classList.remove('open');
    $('chat-log').classList.add('hidden');
    $('prompt-input').blur();
}

export function setupPrompt() {
    const bar = $('prompt');
    const input = $('prompt-input');
    const form = $('prompt-form');

    const syncSend = () => form.classList.toggle('has-text', input.value.trim().length > 0);
    input.addEventListener('input', syncSend);
    syncSend();

    renderContextChips(); // E3: obnov priložené uzly z úložiska (byId je už naplnené)

    const open = () => {
        bar.classList.add('open');
        if ($('chat-log').children.length) $('chat-log').classList.remove('hidden');
    };

    input.addEventListener('focus', open);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        syncSend();
        open();

        if (text.startsWith('/')) {
            handleCommand(text);
            return;
        }

        addMsg('me', text);
        chatHistory.push({ role: 'user', content: text });
        const thinking = addMsg('hades thinking', '…');

        try {
            // E3: prilož len existujúce uzly (mŕtve id preskoč), backend capuje na 20
            const ctxIds = [...S.chatContext].filter((id) => S.byId.has(id)).slice(0, 20);
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(-12, -1),
                    context_node_ids: ctxIds,
                }),
            });
            const data = await res.json();
            thinking.remove();
            const reply = data.reply || data.message || 'Hades mlčí.';
            addMsg('hades', reply);
            chatHistory.push({ role: 'assistant', content: reply });
            // E2: pri remember-intente backend vráti suggested_node → potvrdzovacia karta
            if (data && data.suggested_node) renderSuggestCard(data.suggested_node);
        } catch (err) {
            thinking.remove();
            addMsg('sys sys--error', 'Spojenie s vedomím zlyhalo.');
        }
    });
}

export function handleCommand(text) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    const arg = parts.join(' ');
    const sys = (m) => addMsg('sys', m);

    switch (cmd) {
        case 'nahlad': case 'view': {
            const map = { mapa: 'map', siet: 'net', 'sieť': 'net', vrstvy: 'layers' };
            const v = map[arg.toLowerCase()];
            if (v) { setView(v); sys('Náhľad prepnutý: ' + arg); }
            else sys('Použi: /nahlad mapa | siet | vrstvy');
            break;
        }
        case 'najdi': case 'find':
            closeCmdk();
            openCmdk();
            if (arg) { $('cmdk-input').value = arg; renderCmdk(arg); }
            sys(arg ? 'Hľadám: ' + arg : 'Otvoril som hľadanie.');
            break;
        case 'zoom':
            if (arg === 'in') zoomBy(1.3);
            else if (arg === 'out') zoomBy(1 / 1.3);
            else fitView();
            sys('Zoom upravený.');
            break;
        case 'legenda': openDock('legend'); sys('Legenda otvorená.'); break;
        case 'statistiky': case 'stats': openDock('stats'); sys('Štatistiky otvorené.'); break;
        case 'pomoc': case 'help': toggleHelp(true); break;
        default:
            sys('Neznámy príkaz. Skús /nahlad, /najdi, /zoom, /legenda, /statistiky, /pomoc');
    }
}
