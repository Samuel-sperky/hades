import { ts } from '../core/format.js';
import { store } from '../core/store.js';
import { fitView } from '../graph/camera.js';
import { requestDraw } from '../graph/render/frame.js';
import { register as registerMobileNav } from './mobile-nav.js';
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


/* Rozbalenie railu 72 ↔ 208 px (rozhodnutie #54).
   Šírku drží token --rail-w; :root[data-rail="expanded"] ho preklopí a #app-header
   aj #screens sa posunú samé cez --shell-left. Persistuje sa v aura.rail.expanded
   (nová voľba — v LEGACY_MAP nemá čo migrovať, shim #2 zostáva nedotknutý). */
export function setRailExpanded(expanded) {
    const on = !!expanded;
    if (on) document.documentElement.dataset.rail = 'expanded';
    else delete document.documentElement.dataset.rail;
    store.setRaw('rail.expanded', on ? '1' : '0');

    const btn = document.querySelector('#rail-toggle');
    if (btn) {
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        btn.setAttribute('aria-label', on ? 'Zbaliť navigáciu' : 'Rozbaliť navigáciu');
    }
    // Canvas počíta so šírkou shellu; prekreslenie po prechode (dur-base 180 ms).
    setTimeout(() => requestDraw(), 220);
}


export function railExpanded() {
    return store.raw('rail.expanded') === '1';
}


/* FÁZA SHELL: hlavná navigácia — pomenované grupy destinácií + jadro (vycentrovanie). */
export function register(root) {
    root.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.onclick = () => setScreen(b.dataset.screen);
    });
    const core = root.querySelector('#brand-core');
    if (core) core.onclick = () => fitView();

    setRailExpanded(railExpanded());
    const toggle = root.querySelector('#rail-toggle');
    if (toggle) toggle.onclick = () => setRailExpanded(!railExpanded());

    // Mobilný bottom nav je druhá tvár tej istej navigácie, preto sa registruje
    // odtiaľto — app.js je zdieľaný súbor (patch pre integrátora je v reporte P9).
    registerMobileNav(root);
}
