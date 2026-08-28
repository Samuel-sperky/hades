import { fitView } from './render.js';
import { S } from './state.js';
import { writeUrl } from './urlstate.js';

/* ---------- filtre grafu do URL ----------

   `persistFilter()` a `persistRelFilter()` sú JEDINÉ dve miesta, cez ktoré prechádza
   každá zmena filtra siete — volá ich panel nastavení (`controls.js`), legenda
   oblastí (`panels.js`) aj rad značiek (`tagfilter.js`). Preto zápis do adresy
   patrí sem a nie k trom volajúcim: tri kópie by znamenali tri príležitosti, ako
   na jednu zabudnúť.

   Množiny idú do URL ako OPAKOVANÝ kľúč (nikdy separátor: značka môže obsahovať
   čiarku aj medzeru — „0,5 g" je jedna značka, nie dve) a hodnoty sa RADIA, aby
   ten istý filter dal vždy tú istú adresu. Radenie je tu, nie v `urlstate.js`,
   len defenzívne — dvojité zoradenie nikoho nebolí, chýbajúce áno.

   `ft`/`fs`/`fa`/`fr` nesú SKRYTÉ hodnoty (tak ako `S.filter`), `fg` VYBRANÉ. Je to
   asymetria stavu, nie kľúčov, a slovník §6 ju priznáva pri každom riadku. */
function sortedList(set, numeric) {
    const out = [...set].map(String);
    out.sort(numeric ? ((a, b) => (+a) - (+b)) : undefined);
    return out;
}

export function persistRelFilter() {
    localStorage.setItem('hades.relfilter', JSON.stringify([...S.filter.relations]));
    writeUrl({ fr: sortedList(S.filter.relations) }, 'replace');
}
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
    /* Lokálny graf je JEDEN kľúč pre dve hodnoty (`<rootId>.<depth>`), pretože bez
       koreňa hĺbka nič neznamená a naopak — dva kľúče by dovolili polovičný stav,
       ktorý sa nedá vykresliť. Bodka ako oddeľovač je bezpečná: obe hodnoty sú
       celé čísla. Strop 1–3 drží riadok vyššie, nie čitateľ adresy. */
    writeUrl({ loc: S.local.rootId + '.' + S.local.depth }, 'replace');
    updateLocalChip();
    fitView();
}

export function clearLocal() {
    if (!S.local) return;
    S.local = null;
    S._localFor = null;
    S._localSet = null;
    writeUrl({ loc: null }, 'replace');
    updateLocalChip();
    fitView();
}

// Plávajúci čip pod hlavičkou — indikátor režimu + prepínač hĺbky 1/2/3
export let localChip = null;
export function updateLocalChip() {
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

/* ---------- filtre siete (typy / zdroje / oblasti) ---------- */

// Zdrojový kôš uzla pre filter: session / skill (playbook) / digest+archive / ručné
export function sourceBucket(n) {
    if (n.source === 'session') return 'session';
    if (n.source === 'skill') return 'skill';
    if (n.source === 'digest' || n.source === 'archive') return 'digest';
    if (!n.source) return 'manual';
    return null;
}

// Jadro sa nikdy nefiltruje; skryté typy/zdroje/oblasti uzol vyradia z kreslenia
export function filterPass(n) {
    if (n.type === 'core') return true;
    if (S.filter.types.has(n.type)) return false;
    const b = sourceBucket(n);
    if (b && S.filter.sources.has(b)) return false;
    if (n.area_id && S.filter.areas.has(n.area_id)) return false;
    // pozitívny filter značiek: aktívny len keď je niečo vybrané; uzol musí niesť
    // aspoň jednu vybranú značku (uzly bez značiek pri aktívnom filtri vypadnú)
    if (S.filter.tags.size > 0) {
        const tags = n.tags;
        if (!Array.isArray(tags) || !tags.some((t) => S.filter.tags.has(t))) return false;
    }
    return true;
}

// Jediná brána viditeľnosti: aktívny lokálny graf vyhráva (BFS už množinu obmedzil)
export function nodeVisible(n, loc) {
    if (loc) return loc.has(n.id);
    return filterPass(n);
}

export function persistFilter() {
    localStorage.setItem('hades.filter', JSON.stringify({
        types: [...S.filter.types],
        sources: [...S.filter.sources],
        areas: [...S.filter.areas],
        tags: [...S.filter.tags],
    }));
    writeUrl({
        ft: sortedList(S.filter.types),
        fs: sortedList(S.filter.sources),
        fa: sortedList(S.filter.areas, true),
        fg: sortedList(S.filter.tags),
    }, 'replace');
}
