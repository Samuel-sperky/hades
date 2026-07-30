import { S } from '../core/state/index.js';
import { fitView } from './camera.js';
import { refreshVisibility } from './filters.js';


/* ---------- lokálny graf (Obsidian local graph) ---------- */

// BFS zo S.local.rootId po hĺbku — množina viditeľných uzlov, cache ako _hlSet
export function localSet() {
    if (!S.local) return null;
    const key = S.local.rootId + ':' + S.local.depth + ':' + S.edges.length;
    if (S._localFor !== key) {
        const adj = new Map();
        const push = (a, b) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
        for (const e of S.edges) { push(e.source_id, e.target_id); push(e.target_id, e.source_id); }
        const set = new Set([S.local.rootId]);
        let frontier = [S.local.rootId];
        for (let d = 0; d < S.local.depth && frontier.length; d++) {
            const next = [];
            for (const id of frontier) {
                for (const m of (adj.get(id) || [])) {
                    if (!set.has(m)) { set.add(m); next.push(m); }
                }
            }
            frontier = next;
        }
        S._localFor = key;
        S._localSet = set;
    }
    return S._localSet;
}


export function setLocal(rootId, depth) {
    if (!S.byId.has(rootId)) return;
    S.local = { rootId, depth: Math.min(3, Math.max(1, depth || 1)) };
    S._localFor = null;
    updateLocalChip();
    refreshVisibility();
    fitView();
}


export function clearLocal() {
    if (!S.local) return;
    S.local = null;
    S._localFor = null;
    S._localSet = null;
    updateLocalChip();
    refreshVisibility();
    fitView();
}


// Plávajúci čip pod hlavičkou — indikátor režimu + prepínač hĺbky 1/2/3
let localChip = null;

function updateLocalChip() {
    if (!localChip) {
        localChip = document.createElement('div');
        localChip.id = 'local-chip';
        localChip.innerHTML = '<span class="lc-label"></span>'
            + '<span class="lc-depths">'
            + [1, 2, 3].map((d) =>
                '<button type="button" class="lc-depth" data-depth="' + d + '" aria-label="Hĺbka ' + d + '">' + d + '</button>'
            ).join('')
            + '</span>'
            + '<button type="button" class="lc-close" aria-label="Zavrieť lokálny graf">×</button>';
        document.body.appendChild(localChip);
        localChip.querySelectorAll('.lc-depth').forEach((b) => {
            b.onclick = () => { if (S.local) setLocal(S.local.rootId, +b.dataset.depth); };
        });
        localChip.querySelector('.lc-close').onclick = () => clearLocal();
    }
    if (!S.local) { localChip.classList.add('hidden'); return; }
    localChip.classList.remove('hidden');
    localChip.querySelector('.lc-label').textContent = 'Lokálny graf · hĺbka ' + S.local.depth;
    localChip.querySelectorAll('.lc-depth').forEach((b) =>
        b.classList.toggle('active', +b.dataset.depth === S.local.depth));
}
