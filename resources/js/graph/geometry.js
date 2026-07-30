import { S } from '../core/state/index.js';


/* ---------- hub uzol ---------- */

// Hub („AuraAI") je jediný uzol pripnutý na (0,0), s najväčším polomerom a s pevnou
// väzbou v drag/pulz logike. Identifikácia bola na 6 miestach porovnaním
// `n.type === 'core' && n.label === S.name` — po rebrandingu Hades → AuraAI to drží
// len preto, že migrácia premenovala aj core uzol v DB (overené: label 'AuraAI',
// config('auraai.name') = 'AuraAI'). Aby ďalší rename graf nerozsypal, je tu jediné
// miesto s fallbackom: keď žiadny core uzol nesedí na S.name, hubom je core uzol
// s najnižším id (jadro je uzol #1). Graf tak nikdy nezostane bez stredu.

let _hubFor = null;   // { nodes, name } — pre ktorý stav je _hub platný
let _hub = null;

/** Hub uzol grafu, alebo null pri prázdnom grafe. Memoizované (číta ho každý frame). */
export function hubNode() {
    if (_hubFor && _hubFor.nodes === S.nodes && _hubFor.name === S.name
        && _hub && S.byId.get(_hub.id) === _hub) return _hub;

    let match = null, lowest = null;
    for (const n of S.nodes) {
        if (n.type !== 'core') continue;
        if (n.label === S.name) { match = n; break; }
        if (!lowest || n.id < lowest.id) lowest = n;
    }
    _hub = match || lowest;
    _hubFor = { nodes: S.nodes, name: S.name };
    return _hub;
}


export function isHub(n) {
    if (!n || n.type !== 'core') return false;
    return n === hubNode();
}


/* ---------- polomer ---------- */

export function nodeRadius(n) {
    let base;
    if (n.type === 'core') {
        base = isHub(n) ? 24 : 14;
    } else {
        // FÁZA DE-CLUTTER: veľkosť = stupeň uzla (počet spojení), nie mŕtva strength.
        // Striezla škála: huby mierne väčšie, okrajové malé. S.degree sa počíta v buildSim.
        const deg = S.degree.get(n.id) || 0;
        base = Math.min(15, 5.5 + 2.4 * Math.log2(1 + deg));
    }
    return base * (S.opts ? S.opts.nodeScale : 1);
}
