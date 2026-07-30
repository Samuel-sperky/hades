import { S } from '../core/state/index.js';
import { markTreeActive } from '../dock/structure.js';
import { neighborsOf } from './neighbors.js';
import { draw } from './render/draw.js';
import { renderBreadcrumb } from '../shell/breadcrumb.js';


// Focus mód (priečinky): zaostrenie na oblasť / oddelenie
// Jediná cesta k zmene fokusu — synchronizuje breadcrumb, strom aj plátno.
export function setFocus(areaId, departmentId) {
    S.focus = { areaId: areaId || null, departmentId: departmentId || null };
    renderBreadcrumb();
    markTreeActive();
    draw();
}


export function focusPass(n) {
    if (!S.focus.areaId) return true;
    if (n.type === 'core') return true;
    if (n.area_id !== S.focus.areaId) return false;
    if (S.focus.departmentId && n.department_id !== S.focus.departmentId) return false;
    return true;
}


// Zvýraznená množina pri hover/select — cache podľa kotvového uzla
export function highlightSet() {
    const anchor = S.hover || S.selected;
    if (!anchor) { S._hlFor = null; S._hlSet = null; return null; }
    if (S._hlFor !== anchor) {
        const set = new Set([anchor.id]);
        for (const m of neighborsOf(anchor)) set.add(m.id);
        S._hlFor = anchor;
        S._hlSet = set;
    }
    return S._hlSet;
}


// Vrstvová cesta (len náhľad Vrstvy): 2-skokové rozšírenie okolo kotvy, ktoré sleduje
// tok VON cez vrstvy — vstup→skryté→jadro/výstup. Priame hrany kotvy + druhé hrany,
// ktoré sa od vrstvy kotvy vzďaľujú (napr. spomienka→skill→projekt). Slúži hlavnému
// účelu Vrstiev: vidieť, ako spomienka aktivuje skill a ten projekt. Cache na kotvu
// ako highlightSet; S._lpNodes = id uzlov na ceste (nech ostanú čitateľné, nie stlmené).
export function layerPathSet(anchor) {
    if (!anchor || anchor._li == null) { S._lpFor = null; S._lpEdges = null; S._lpNodes = null; return null; }
    if (S._lpFor === anchor && S._lpEdges) return S._lpEdges;
    const a0 = anchor._li;
    const edges = new Set();
    const nodes = new Set([anchor.id]);
    // 1) priame hrany kotvy
    for (const e of S.edges) {
        if (e.source.id === anchor.id) { edges.add(e); nodes.add(e.target.id); }
        else if (e.target.id === anchor.id) { edges.add(e); nodes.add(e.source.id); }
    }
    // 2) druhý skok — pokračovanie toku VON od vrstvy kotvy (menej vizuálneho šumu než plné 2-hop).
    // hop1 zmrazí prvý okruh, aby sa cesta nerozliala do tretieho skoku počas pridávania.
    const hop1 = new Set(nodes);
    for (const e of S.edges) {
        const s = e.source, t = e.target;
        if (s._li == null || t._li == null) continue;
        let via = null, far = null;
        if (hop1.has(s.id) && s.id !== anchor.id && !hop1.has(t.id)) { via = s; far = t; }
        else if (hop1.has(t.id) && t.id !== anchor.id && !hop1.has(s.id)) { via = t; far = s; }
        if (!via) continue;
        if (Math.abs(far._li - a0) > Math.abs(via._li - a0)) { edges.add(e); nodes.add(far.id); }
    }
    S._lpFor = anchor;
    S._lpEdges = edges;
    S._lpNodes = nodes;
    return edges;
}
