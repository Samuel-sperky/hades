import { certBadge } from '../certainty.js';
import { clearLocal } from '../filters.js';
import { setRailBadge } from '../rail.js';
import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { S } from '../state.js';
import { showToast, showUndoToast } from '../toasts.js';
import { $, busy, esc, getJson, plainInline, plainText, renderEmpty, renderLoading, timeAgo, typeName } from '../util.js';

/* ---------- obrazovka Kontrola (/api/review/queue) — verify/review fronta ----------
   Fronta needs_review uzlov (.queue*), klávesnica j/k/Enter/v/r/Delete (len na
   tejto obrazovke, viď setupShortcuts). Akcie: Overiť (verify), Vyriešiť
   (resolve-review), Preskočiť (lokálne, s undo). Rail badge cez setRailBadge. */

export const kontrolaState = { items: [], idx: 0, total: 0 };

export async function renderKontrola() {
    const body = $('kontrola-body');
    if (!body) return;
    renderLoading(body, 'Načítavam frontu…');
    try {
        const d = await getJson('/api/review/queue');
        kontrolaState.items = d.queue || [];
        // `total` je serverové číslo a nesie ho rail. Fallback na `items.length`
        // tu bol tichá lož: fronta má strop 100, takže pri 140 čakajúcich uzloch
        // by rail hlásil 100. Server ho posiela vždy (App\Serializers\Screen\
        // KontrolaScreen) a je zámerne NEfiltrovaný.
        kontrolaState.total = d.total || 0;
        kontrolaState.idx = 0;
        rerenderKontrola();
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať frontu', 'Skús obnoviť stránku.');
    }
}

/* moveFocus=true — prekreslenie po AKCII (overiť / vyriešiť / preskočiť / zmazať).
   innerHTML vymení celý zoznam, takže fokus by inak zostal na <body> presne v tom
   okamihu, keď človek pokračuje v práci s frontou. */
export function rerenderKontrola(moveFocus) {
    const body = $('kontrola-body');
    if (!body) return;
    setRailBadge('kontrola', kontrolaState.total);
    const items = kontrolaState.items;
    if (!items.length) {
        renderEmpty(body, 'fact_check', 'Fronta na overenie je prázdna', 'Nové poznatky sem prídu po ďalšej session.');
        return;
    }
    kontrolaState.idx = Math.max(0, Math.min(kontrolaState.idx, items.length - 1));
    body.innerHTML = '<div class="queue">'
        + items.map((n, i) => queueItemHtml(n, i)).join('')
        + '</div>' + kontrolaHintsHtml();
    wireKontrola(body);
    if (moveFocus) markKontrolaSelected(true);
}

export function queueItemHtml(n, i) {
    // description je markdown (rovnaký zdroj ako snippety v Denníku a Knižnici), takže
    // bez plainText tu svietilo „**Čo:** …". Zlepenie riadkov robí plainText tiež,
    // pôvodné .replace(/\s+/g,' ') je v ňom obsiahnuté.
    const desc = plainText(n.description);
    return '<div class="queue-item' + (i === kontrolaState.idx ? ' selected' : '') + '"'
        + ' data-id="' + n.id + '" data-idx="' + i + '" tabindex="-1">'
        + '<div class="queue-body">'
        + '<div class="queue-meta">'
        + '<span>' + esc(typeName(n.type)) + '</span>'
        + originBadge(n.origin) + certBadge(n.certainty)
        + (n.created_at ? '<span>' + esc(timeAgo(n.created_at)) + '</span>' : '')
        + '</div>'
        + '<div class="queue-text"><strong>' + esc(plainInline(n.label)) + '</strong>'
        + (desc ? ' — ' + esc(desc) : '') + '</div>'
        + '</div>'
        + '<div class="queue-actions">'
        + '<button type="button" class="act-verify ms" data-act="verify" title="Overiť (v)" aria-label="Overiť">verified</button>'
        + '<button type="button" class="act-resolve ms" data-act="resolve" title="Vyriešiť (r)" aria-label="Vyriešiť">done_all</button>'
        + '<button type="button" class="act-skip ms" data-act="skip" title="Preskočiť" aria-label="Preskočiť">redo</button>'
        + '</div></div>';
}

export function kontrolaHintsHtml() {
    const kh = (keys, label) => '<span class="kh">'
        + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(label) + '</span>';
    return '<div class="kbd-hints">'
        + kh(['j', 'k'], 'posun')
        + kh(['Enter'], 'detail')
        + kh(['v'], 'overiť')
        + kh(['r'], 'vyriešiť')
        + kh(['Del'], 'zmazať uzol')
        + '</div>';
}

export function kontrolaNodeRef(id) {
    const n = kontrolaState.items.find((x) => x.id === id);
    return n ? { id: n.id, label: n.label, type: n.type, area_id: n.area_id } : { id };
}

export function kontrolaBtn(id, act) {
    return document.querySelector('#kontrola-body .queue-item[data-id="' + id + '"] .act-' + act);
}

export function wireKontrola(body) {
    body.querySelectorAll('.queue-item').forEach((item) => {
        const id = +item.dataset.id;
        const idx = +item.dataset.idx;
        item.addEventListener('mousedown', () => { kontrolaState.idx = idx; markKontrolaSelected(); });
        const bodyEl = item.querySelector('.queue-body');
        if (bodyEl) bodyEl.onclick = () => { kontrolaState.idx = idx; openNodeFromAnywhere(kontrolaNodeRef(id)); };
        const v = item.querySelector('.act-verify');
        if (v) v.onclick = (e) => { e.stopPropagation(); kontrolaVerify(id); };
        const r = item.querySelector('.act-resolve');
        if (r) r.onclick = (e) => { e.stopPropagation(); kontrolaResolve(id); };
        const s = item.querySelector('.act-skip');
        if (s) s.onclick = (e) => { e.stopPropagation(); armKontrolaAction(s, id, 'skip'); };
    });
}

/* focus=true presunie aj skutočný fokus prehliadača na zvolenú položku (.queue-item
   má preto tabindex="-1"). Bez toho zostal fokus po každej akcii na <body>: klávesy
   j/k/v/r fungovali (listener je na window), ale čítač obrazovky ani prstenec fokusu
   nemali čo sledovať a Tab začínal odznova od hlavičky. */
export function markKontrolaSelected(focus) {
    const items = document.querySelectorAll('#kontrola-body .queue-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === kontrolaState.idx));
    const cur = items[kontrolaState.idx];
    if (!cur) return;
    if (focus) cur.focus({ preventScroll: true });
    cur.scrollIntoView({ block: 'nearest' });
}

export function kontrolaMove(delta) {
    if (!kontrolaState.items.length) return;
    const n = kontrolaState.items.length;
    kontrolaState.idx = (kontrolaState.idx + delta + n) % n;
    markKontrolaSelected(true);
}

/* Odober položku z fronty. `serverTotal` je nová dĺžka fronty, ako ju ohlásil
   server (`queue_total` v odpovedi na verify / resolve-review) — nie odhad.

   Predtým sa tu počítadlo v raile dopočítavalo (`total - 1`). To je správne len
   vtedy, keď je táto session jediný pisateľ; pri paralelnom `mind_learn` z inej
   AI alebo pri mutácii, ktorá zhodí viac než jeden uzol, rail lhal až do ďalšieho
   načítania obrazovky. Server to vie povedať presne za jednu `COUNT(*)`. */
export function removeKontrolaItem(id, serverTotal) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    kontrolaState.items.splice(i, 1);
    if (typeof serverTotal === 'number') kontrolaState.total = Math.max(0, serverTotal);
    if (kontrolaState.idx > i) kontrolaState.idx--;
    rerenderKontrola(true);
}

export async function kontrolaVerify(id) {
    const btn = kontrolaBtn(id, 'verify') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/verify', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Overenie zlyhalo', null, 'error'); return; }
            removeKontrolaItem(id, j.queue_total);
            const warns = j.warnings || [];
            showToast(warns.length ? ('Overené — ' + warns[0]) : 'Overené', null, 'success');
        } catch (e) { showToast('Overenie zlyhalo', null, 'error'); }
    }, '…');
}

export async function kontrolaResolve(id) {
    const btn = kontrolaBtn(id, 'resolve') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/resolve-review', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Akcia zlyhala', null, 'error'); return; }
            removeKontrolaItem(id, j.queue_total);
            showToast('Vyriešené', null, 'success');
        } catch (e) { showToast('Akcia zlyhala', null, 'error'); }
    }, '…');
}

// Armed-inline (žiadny natívny confirm): 1. akcia ozbrojí tlačidlo, 2. potvrdí.
// kind='skip' (lokálne preskočenie + undo) alebo 'delete' (DELETE uzla).
export function disarmKontrolaBtn(btn) {
    clearTimeout(btn._disarm);
    btn.classList.remove('armed');
    btn.classList.add('ms');
    btn.textContent = 'redo';
    delete btn.dataset.armKind;
}

export function armKontrolaAction(btn, id, kind) {
    if (!btn) return;
    if (btn.classList.contains('armed') && btn.dataset.armKind === kind) {
        disarmKontrolaBtn(btn);
        if (kind === 'delete') kontrolaDelete(id); else kontrolaSkip(id);
        return;
    }
    document.querySelectorAll('#kontrola-body .act-skip.armed').forEach(disarmKontrolaBtn);
    btn.classList.add('armed');
    btn.classList.remove('ms');
    btn.dataset.armKind = kind;
    btn.textContent = kind === 'delete' ? 'Zmazať uzol?' : 'Preskočiť?';
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmKontrolaBtn(btn); }, 3000);
}

export function kontrolaSkip(id) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [removed] = kontrolaState.items.splice(i, 1);
    if (kontrolaState.idx > i || kontrolaState.idx >= kontrolaState.items.length) {
        kontrolaState.idx = Math.max(0, kontrolaState.idx - (kontrolaState.idx > i ? 1 : 0));
    }
    rerenderKontrola(true);
    // preskočenie je len lokálne (uzol ostáva v serverovej fronte) → total badge nemeníme
    showUndoToast('Preskočené', () => {
        kontrolaState.items.splice(Math.min(i, kontrolaState.items.length), 0, removed);
        kontrolaState.idx = i;
        rerenderKontrola(true);
    });
}

export async function kontrolaDelete(id) {
    const node = kontrolaState.items.find((n) => n.id === id);
    try {
        const res = await fetch('/api/nodes/' + id, { method: 'DELETE' });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            showToast(j.message || 'Nepodarilo sa zmazať', null, 'error');
            return;
        }
        // dorovnaj aj graf, ak je uzol načítaný (rovnako ako node-panel delete)
        if (node && S.byId.has(id)) {
            S.nodes = S.nodes.filter((m) => m.id !== id);
            S.edges = S.edges.filter((e) => e.source.id !== id && e.target.id !== id);
            S.byId.delete(id);
            if (S.local && S.local.rootId === id) clearLocal();
        }
        // JEDINÉ miesto, kde sa dĺžka fronty dopočítava. `DELETE /api/nodes/{id}`
        // je zdieľaný s grafom a o fronte kontroly nehovorí nič — a zmazaný uzol
        // z nej vypadne presne raz, takže „−1" je tu dokázateľné, nie odhad.
        removeKontrolaItem(id, Math.max(0, kontrolaState.total - 1));
        showToast('Uzol zmazaný', null, 'success');
    } catch (e) {
        showToast('Nepodarilo sa zmazať', null, 'error');
    }
}
