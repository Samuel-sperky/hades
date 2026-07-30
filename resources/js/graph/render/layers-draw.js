import { S } from '../../core/state/index.js';
import { T } from '../canvas-colors.js';
import { ctx } from '../canvas-el.js';
import { LAYER_META, LAYER_X } from '../layers.js';


function softRect(x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
    else ctx.fillRect(x, y, w, h);
}


// Pozadie Vrstiev: vodiace línie sub-stĺpcov + jemné farebné pásy oblastí za uzlami.
// Kreslí sa PRED hranami, nech pásy neprekrývajú spojenia. Číta hotovú geometriu
// z layerLayout (guides/bands v svetových jednotkách), takže pás sedí presne za blokom.
export function drawLayerBands(lay) {
    const invK = 1 / S.cam.k;

    // vodiace vertikálne línie sub-stĺpcov (jemná Aura ink)
    ctx.globalAlpha = 0.5 * S.dim;
    ctx.strokeStyle = 'rgba(' + T.edge + ',0.06)';
    ctx.lineWidth = 1 * invK;
    for (const g of lay.guides) {
        ctx.beginPath();
        ctx.moveTo(g.x, -g.half - 26 * invK);
        ctx.lineTo(g.x, g.half + 26 * invK);
        ctx.stroke();
    }

    // farebné pásy súvislých blokov rovnakej oblasti (jadro bez pásu)
    const bandW = 34 * invK;
    for (const b of lay.bands) {
        const pad = b.spacing * 0.42;
        ctx.globalAlpha = 0.07 * S.dim;
        ctx.fillStyle = b.color;
        softRect(b.x - bandW / 2, b.y0 - pad - (b.single ? 2 * invK : 0),
            bandW, (b.y1 - b.y0) + pad * 2 + (b.single ? 4 * invK : 0), 9 * invK);
    }
    ctx.globalAlpha = 1;
}


export function drawLayerScaffold(lay) {
    const headerY = -lay.maxHalf - 66;
    const invK = 1 / S.cam.k;

    ctx.textAlign = 'center';
    for (let i = 0; i < LAYER_X.length; i++) {
        const count = lay.cols[i] ? lay.cols[i].length : 0;
        ctx.globalAlpha = 0.6 * S.dim;
        ctx.fillStyle = T.inkSoft;
        ctx.font = '600 ' + (12.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].title.toUpperCase() + ' · ' + count, LAYER_X[i], headerY);

        ctx.globalAlpha = 0.5 * S.dim;
        ctx.fillStyle = T.muted;
        ctx.font = (10.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].sub, LAYER_X[i], headerY + 18 * invK);
    }
    ctx.globalAlpha = 1;
}
