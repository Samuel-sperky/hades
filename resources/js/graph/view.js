import { REDUCED_MOTION } from '../core/motion.js';
import { S } from '../core/state/index.js';
import { store } from '../core/store.js';
import { animLevel } from './animation.js';
import { fitView } from './camera.js';
import { draw } from './render/draw.js';
import { buildSim, kickSim } from './sim.js';
import { syncForceSliders } from '../shell/settings.js';


export function setView(view) {
    const prev = S.view;
    // FÁZA ANIMÁCIE (Q12): morph len pri skutočnej zmene náhľadu; prvé načítanie a REDUCED_MOTION/anim=0 skáču
    const animate = prev !== view && S.nodes.length > 0 && !REDUCED_MOTION && animLevel() > 0;
    const from = animate ? new Map(S.nodes.map(n => [n.id, { x: n.x, y: n.y }])) : null;

    S.view = view;
    store.setRaw('view', view);
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === view);
    });
    buildSim();
    kickSim(0.6);
    // mapa/sieť: pár tikov, nech bbox sedí na usadených pozíciách; vrstvy sú deterministické (fx/fy)
    if (S.sim && view !== 'layers') S.sim.tick(30);
    syncForceSliders(); // efektívne predvolené sily sa menia s náhľadom

    if (!animate) { fitView(); return; }

    // cieľové pozície: layers sú pripnuté (fx/fy) a neťikajú sa, mapa/sieť sú usadené v n.x/n.y
    const to = new Map(S.nodes.map(n => [n.id, {
        x: n.fx != null ? n.fx : n.x,
        y: n.fy != null ? n.fy : n.y,
    }]));
    // dočasne posaď uzly na cieľ, nech fitView zaráta kameru na cieľový layout
    for (const n of S.nodes) { const b = to.get(n.id); if (b) { n.x = b.x; n.y = b.y; } }
    fitView(); // zaráta kameru na cieľ (a raz vykreslí cieľové pozície)
    S.sim.stop(); // počas morphu nesmie sim prepisovať pozície
    for (const n of S.nodes) { const f = from.get(n.id); if (f) { n.x = f.x; n.y = f.y; } }
    S._morph = { from, to, t: 0, dur: 0.6 };
    draw(); // prekresli na štartové pozície, nech nebliká cieľ pred prvým rAF framom
}
