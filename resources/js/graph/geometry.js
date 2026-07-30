import { S } from '../core/state/index.js';


export function nodeRadius(n) {
    let base;
    if (n.type === 'core') {
        base = n.label === S.name ? 24 : 14;
    } else {
        // FÁZA DE-CLUTTER: veľkosť = stupeň uzla (počet spojení), nie mŕtva strength.
        // Striezla škála: huby mierne väčšie, okrajové malé. S.degree sa počíta v buildSim.
        const deg = S.degree.get(n.id) || 0;
        base = Math.min(15, 5.5 + 2.4 * Math.log2(1 + deg));
    }
    return base * (S.opts ? S.opts.nodeScale : 1);
}
