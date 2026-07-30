import { S } from '../../core/state/index.js';
import { T } from '../canvas-colors.js';
import { ctx } from '../canvas-el.js';
import { CERT_RING, certColors } from './cert-colors.js';


// FÁZA DE-CLUTTER: uzol = biela/papierová výplň + farebný prstenec vo farbe oblasti (vzdušné,
// nie plná farebná placka). Jadro ostáva zlaté a výrazné (plná zlatá výplň + zlatý prstenec).
// Typ uzla sa rozlíši JEMNE cez hrúbku/štýl prstenca, NIE plnou farbou: spomienka tenký prstenec,
// skill hrubší (plný disk, žiadna donut diera), projekt prstenec + tiché vonkajšie echo.
export function drawShape(n, x, y, r, color, simple) {
    const k = S.cam.k;

    if (simple) {
        // FÁZA RENDER PIPELINE: oddialené (k<0.5) — plný farebný disk (papierový prstenec by zanikol)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        return;
    }

    const a = ctx.globalAlpha;

    if (n.type === 'core') {
        // jadro ostáva výrazné — plná zlatá výplň + zlatý sústredný prstenec
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = a * 0.4;
        ctx.lineWidth = Math.max(1, 1.1 / k);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.55, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
        return;
    }

    // papierová výplň — telo uzla splynie s papierom, ostane čistý farebný prstenec
    ctx.fillStyle = T.paper;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();

    // farebný prstenec (obrys) — hrúbka podľa typu; kreslený dovnútra, nech r ostáva polomer uzla
    const lw = n.type === 'skill' ? 2.4 / k : 1.6 / k;
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r - lw * 0.5), 0, 7);
    ctx.stroke();

    if (n.type === 'project') {
        // tiché vonkajšie echo — odlíši projekt (bez plnej farby)
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 1.1 / k;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5 / k, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    }

    // FÁZA CERTAINTY (F4, §4.6): značky istoty + brain-origin rim — LEN nad zoom prahom
    // k>0.8 (v hustom oddialenom grafe by pridávali šum). Subtílne, dvojkanálové, CVD-safe.
    if (k > 0.8) {
        const cc = certColors();

        // brain-origin uzly: jemný vnútorný rim (--border-strong) — ľudsky-písané „mozgy"
        // sa nenápadne odlíšia od session uzlov (nezávisí od prepínača istoty).
        if (n.origin === 'brain') {
            ctx.globalAlpha = a * 0.45;
            ctx.lineWidth = 1 / k;
            ctx.strokeStyle = cc.borderStrong;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, r - lw - 1.2 / k), 0, 7);
            ctx.stroke();
            ctx.globalAlpha = a;
        }

        // certainty prstenec za uzlom — prepínateľný („Značky istoty", default ON)
        const mode = S.certRings ? CERT_RING[n.certainty] : null;
        if (mode) {
            const rr = r + 3.2 / k;
            const col = cc[n.certainty];
            ctx.save();
            ctx.globalAlpha = a * 0.8;
            ctx.lineWidth = 1.6 / k;
            ctx.strokeStyle = col;
            if (mode === 'dashed') ctx.setLineDash([3 / k, 2.4 / k]);
            ctx.beginPath();
            ctx.arc(x, y, rr, 0, 7);
            ctx.stroke();
            if (mode === 'pip') {
                // výstražný pip navrchu prstenca — druhý (tvarový) kanál pre pascu
                ctx.setLineDash([]);
                ctx.globalAlpha = a;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(x, y - rr, 1.9 / k, 0, 7);
                ctx.fill();
            }
            ctx.restore();
        }
    }
}
