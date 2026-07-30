import { blip } from '../core/sound.js';
import { S } from '../core/state/index.js';
import { FORCE_DEFAULTS, OPT_DEFAULTS } from '../core/state/ui.js';
import { store } from '../core/store.js';
import { draw } from '../graph/render/draw.js';
import { requestDraw } from '../graph/render/frame.js';
import { buildSim, forceDefault, kickSim } from '../graph/sim.js';
import { showToast } from './toasts.js';


export function setOpt(key, value) {
    S.opts[key] = value;
    store.setRaw('opts', JSON.stringify(S.opts));
    applyOpts();
    requestDraw(); // zmena nastavenia vzhľadu → prekresli (slučka mohla spať)
}


export function syncSlider(inp) {
    const min = parseFloat(inp.min || 0);
    const max = parseFloat(inp.max || 100);
    const val = parseFloat(inp.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 100;
    inp.style.setProperty('--pct', pct + '%');

    // číselný odpočet vedľa slidera — alfy ako percento, mierky ako násobok
    const wrap = inp.closest('label.slider');
    const out = wrap && wrap.querySelector('output');
    if (out) {
        const opt = inp.dataset.opt;
        const force = inp.dataset.force;
        if (force) {
            // sily: multiplikátory ako ×N.N, absolútne hodnoty (charge/distance) surové číslo
            out.textContent = (force === 'linkStrength' || force === 'gravity')
                ? '×' + val.toFixed(1)
                : String(Math.round(val));
        } else {
            out.textContent = (opt === 'nodeScale' || opt === 'labelSize')
                ? '×' + val.toFixed(2)
                : Math.round(val * 100) + ' %';
        }
    }
}


export function applyOpts() {
    document.documentElement.style.setProperty('--panel-alpha', S.opts.panelAlpha);
    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        const v = S.opts[inp.dataset.opt];
        if (v !== undefined && parseFloat(inp.value) !== v) inp.value = v;
        syncSlider(inp);
    });
}


// Slidery síl ukazujú override, alebo efektívnu predvolenú hodnotu aktuálneho náhľadu
export function syncForceSliders() {
    document.querySelectorAll('input[data-force]').forEach((inp) => {
        const k = inp.dataset.force;
        const v = S.forces[k] != null ? S.forces[k] : forceDefault(k);
        inp.value = v;
        syncSlider(inp);
    });
}


/* Nastavenia — slidery vzhľadu (data-opt), sily (data-force), prepínače a resety. */
export function register(root) {
    root.querySelectorAll('input[data-opt]').forEach((inp) => {
        inp.oninput = () => { syncSlider(inp); setOpt(inp.dataset.opt, parseFloat(inp.value)); };
    });

    // Soft-hover — spojenia sú v pokoji jemné, rozsvietia sa pri hover/fokuse uzla
    const shBtn = root.querySelector('#softhover-toggle');
    const syncShBtn = () => shBtn.setAttribute('aria-checked', S.opts.edgeSoftHover ? 'true' : 'false');
    syncShBtn();
    shBtn.onclick = () => { setOpt('edgeSoftHover', !S.opts.edgeSoftHover); syncShBtn(); draw(); };

    // Slidery síl — okamžitý zápis do S.forces + rebuild simulácie
    root.querySelectorAll('input[data-force]').forEach((inp) => {
        inp.oninput = () => {
            syncSlider(inp);
            S.forces[inp.dataset.force] = parseFloat(inp.value);
            store.setRaw('forces', JSON.stringify(S.forces));
            buildSim();
            kickSim(0.4);
            draw();
        };
    });

    root.querySelector('#forces-reset').onclick = () => {
        S.forces = Object.assign({}, FORCE_DEFAULTS);
        store.del('forces');
        buildSim();
        kickSim(0.4);
        draw();
        syncForceSliders();
        showToast('Sily obnovené');
    };

    // Veľkosť podľa spojení (Obsidian size by degree) — rebuild kvôli collide polomerom
    const degBtn = root.querySelector('#sizedeg-toggle');
    const syncDegBtn = () => degBtn.setAttribute('aria-checked', S.opts.sizeByDegree ? 'true' : 'false');
    syncDegBtn();
    degBtn.onclick = () => {
        setOpt('sizeByDegree', !S.opts.sizeByDegree);
        syncDegBtn();
        buildSim();
        kickSim(0.3);
        draw();
    };

    root.querySelector('#opts-reset').onclick = () => {
        S.opts = Object.assign({}, OPT_DEFAULTS);
        store.setRaw('opts', JSON.stringify(S.opts));
        applyOpts();
        syncDegBtn(); // reset vráti aj sizeByDegree — prepínač a collide polomery dorovnať
        syncShBtn();  // reset vráti edgeSoftHover na TRUE — prepínač dorovnať
        buildSim();
        kickSim(0.3);
        draw();
        showToast('Predvolené obnovené');
    };

    // Zvuk — prepínač v nastaveniach
    const soundBtn = root.querySelector('#btn-sound');
    soundBtn.setAttribute('aria-checked', S.sound ? 'true' : 'false');
    soundBtn.onclick = () => {
        S.sound = !S.sound;
        store.setRaw('sound', S.sound ? 'on' : 'off');
        soundBtn.setAttribute('aria-checked', S.sound ? 'true' : 'false');
        if (S.sound) blip(523);
    };
}
