import { ts } from '../core/format.js';
import { store } from '../core/store.js';
import { fitView } from '../graph/camera.js';
import { setScreen } from './router.js';


// Rail badge — jeden generický indikátor na destinácii v ľavom rely.
// Boolean → teal bodka (.dot, neprečítané, napr. Denník); číslo → číselný pill
// (.count, napr. fronta Kontroly). Spätne kompatibilné so setJournalDot.
export function setRailBadge(screen, count) {
    const btn = document.querySelector('#rail .dest[data-screen="' + screen + '"]');
    if (!btn) return;

    // Boolean režim — bodka neprečítaného
    if (count === true || count === false) {
        let dot = btn.querySelector('.dot');
        if (count && !dot) {
            dot = document.createElement('span');
            dot.className = 'dot';
            dot.setAttribute('aria-hidden', 'true');
            btn.appendChild(dot);
        }
        if (!count && dot) dot.remove();
        return;
    }

    // Číselný režim — pill (skryje sa cez CSS pri data-count="0")
    const n = Math.max(0, +count || 0);
    let pill = btn.querySelector('.count');
    if (n > 0 && !pill) {
        pill = document.createElement('span');
        pill.className = 'count';
        pill.setAttribute('aria-hidden', 'true');
        btn.appendChild(pill);
    }
    if (pill) {
        pill.dataset.count = String(n);
        pill.textContent = n > 99 ? '99+' : String(n);
    }
}


// Denník — neprečítané záznamy (teal bodka na destinácii Denník). Tenký wrapper.
export function setJournalDot(show) {
    setRailBadge('dennik', !!show);
}


export function markJournalSeen() {
    store.setRaw('journal.lastSeen', new Date().toISOString());
    setJournalDot(false);
}


export function checkJournalUnread() {
    fetch('/api/journal').then((r) => r.json()).then((d) => {
        let latest = 0;
        for (const r of d.records || []) latest = Math.max(latest, ts(r.created_at));
        const seen = ts(store.raw('journal.lastSeen'));
        if (latest && latest > seen) setJournalDot(true);
    }).catch(() => { /* offline check nevadí */ });
}


/* FÁZA SHELL: hlavná navigácia — 7 pomenovaných obrazoviek + jadro (vycentrovanie). */
export function register(root) {
    root.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.onclick = () => setScreen(b.dataset.screen);
    });
    const core = root.querySelector('#brand-core');
    if (core) core.onclick = () => fitView();
}
