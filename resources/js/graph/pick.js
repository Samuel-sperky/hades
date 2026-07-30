import { S } from '../core/state/index.js';
import { screenToWorld } from './camera.js';
import { nodeVisible } from './filters.js';
import { nodeRadius } from './geometry.js';
import { localSet } from './local.js';
import { visibleInReplay } from './timeline.js';


export function pick(px, py) {
    const w = screenToWorld(px, py);
    const loc = localSet();
    let best = null, bestD = Infinity;
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        if (!nodeVisible(n, loc)) continue;
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d < nodeRadius(n) + 8 / S.cam.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
}
