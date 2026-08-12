import { neighborsOf } from './anim.js';
import { draw, requestDraw } from './render.js';
// W2c: breadcrumb číta stav zo stavového stroja zanorenia. util.js ↔ sim.js je
// cyklický import — obidve strany preto exportujú HOISTOVANÉ `function`
// deklarácie (nie const arrow), inak by prvé volanie spadlo na ReferenceError.
import { currentPath, go } from './sim.js';
import { CORE_COLOR, S } from './state.js';
import { T, THEMES } from './theme.js';

export function setOpt(key, value) {
    S.opts[key] = value;
    localStorage.setItem('hades.opts', JSON.stringify(S.opts));
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
/* ---------- pomocníci ---------- */

export function now() { return Date.now(); }
export function rad(deg) { return (deg * Math.PI) / 180; }
export function ts(iso) { return iso ? new Date(iso).getTime() : 0; }

// Svetlejší/sytejší variant farby oblasti pre tmavý papier — hex→HSL→hex, cache
export const _darkColorCache = new Map();
export function darkAreaColor(hex) {
    const cached = _darkColorCache.get(hex);
    if (cached) return cached;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const num = parseInt(m[1], 16);
    const r = ((num >> 16) & 255) / 255, g = ((num >> 8) & 255) / 255, b = (num & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = 0, l = (max + min) / 2;
    if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    l = Math.max(l, 0.62);
    s = Math.min(s + 0.12, 0.9);
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toHex = (t) => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, '0');
    const out = '#' + toHex(h + 1 / 3) + toHex(h) + toHex(h - 1 / 3);
    _darkColorCache.set(hex, out);
    return out;
}

// Farba = oblasť vo VŠETKÝCH náhľadoch; typ vyjadruje tvar (drawShape)
export function nodeColor(n) {
    let hex;
    if (n.type === 'core') hex = CORE_COLOR;
    else {
        const area = S.areas.get(n.area_id);
        hex = area ? area.color : '#2f6d8f';
    }
    return T === THEMES.dark ? darkAreaColor(hex) : hex;
}

// Focus mód (priečinky): zaostrenie na oblasť / oddelenie
// Jediná cesta k zmene fokusu — synchronizuje breadcrumb, strom aj plátno.
export function setFocus(areaId, departmentId) {
    S.focus = { areaId: areaId || null, departmentId: departmentId || null };
    renderBreadcrumb();
    markTreeActive();
    draw();
}

// W2c: breadcrumb zvládne všetky ŠTYRI úrovne (Hades / oblasť / oddelenie / uzol).
// Zdrojom pravdy je currentPath().crumbs zo sim.js, nie S.focus (ten pozná len
// oblasť + oddelenie, takže na úrovni 'node' by posledný crumb chýbal).
// go() volá renderBreadcrumb() po každom prechode sám.
export function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const p = currentPath();
    syncUpButton(p);
    if (!bc) return;

    const crumbs = p.crumbs || [];
    if (crumbs.length < 2) {
        // sme na mape — cesta je len „Hades", takže radšej tichý podtitul
        bc.innerHTML = '<span class="crumb-idle">živé vedomie</span>';
        return;
    }

    bc.innerHTML = crumbs.map((c, i) => {
        const sep = i ? '<span class="sep">/</span>' : '';
        return sep + (i === crumbs.length - 1
            ? '<span class="current">' + esc(c.label) + '</span>'
            : '<button type="button" class="crumb" data-i="' + i + '">' + esc(c.label) + '</button>');
    }).join('');

    bc.querySelectorAll('.crumb[data-i]').forEach((b) => {
        const c = crumbs[+b.dataset.i];
        b.onclick = () => go({
            level: c.level,
            area: c.level === 'area' ? c.id : undefined,
            dept: c.level === 'dept' ? c.id : undefined,
            node: c.level === 'node' ? c.id : undefined,
        });
    });
}

// W2c: #btn-up nahradil mŕtvy #view-switch — na mape nie je kam ísť, tak sa skryje.
// Zároveň: prvý crumb je názov vedomia, takže pri zobrazenej ceste by statický
// #brand-name písal „Hades / Hades / …". Kým je cesta viditeľná, brand ustúpi jej.
function syncUpButton(p) {
    const deep = !!(p.crumbs && p.crumbs.length > 1);
    const up = document.getElementById('btn-up');
    if (up) {
        up.classList.toggle('hidden', p.level === 'map');
        const parent = deep ? p.crumbs[p.crumbs.length - 2].label : 'Hades';
        up.title = 'Späť na „' + parent + '" (Esc)';
    }
    const brand = document.getElementById('brand-name');
    if (brand) brand.classList.toggle('hidden', deep);
}

export function markTreeActive() {
    const tree = document.getElementById('structure-tree');
    if (!tree) return;
    tree.querySelectorAll('.tree-row').forEach((row) => {
        const aid = row.dataset.area ? +row.dataset.area : null;
        const did = row.dataset.dept ? +row.dataset.dept : null;
        const active = !!S.focus.areaId && aid === S.focus.areaId
            && (did ? did === S.focus.departmentId : !S.focus.departmentId);
        row.classList.toggle('active', active);
    });
}

export function updateHeaderMetrics() {
    const el = document.getElementById('header-metrics');
    if (el) el.textContent = S.nodes.length + ' uzlov · ' + S.edges.length + ' spojení';
}

// W2c: focusPass() zmazaný — jediným čitateľom boli nodeAlphaMul/edgeAlphaMul
// vo forces.js, ktoré nikto nevolal. Stmievanie ide výhradne cez ent.dim z layoutu.

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

export function markAwake() {
    S.awakeUntil = now() + S.awakeMinutes * 60000;
}

export function isAwake() {
    return now() < S.awakeUntil;
}
/* ---------- zvuk ---------- */

export function audioCtx() {
    if (!S.audio) {
        S.audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (S.audio.state === 'suspended') S.audio.resume();
    return S.audio;
}

export function blip(freq, dur = 0.35, vol = 0.05) {
    if (!S.sound) return;
    try {
        const ac = audioCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ac.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ac.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        osc.connect(gain).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + dur + 0.05);
    } catch (e) { /* zvuk nie je kritický */ }
}
/* ---------- stav (bdie / spí) ---------- */

export let lastStateUi = '';
export function updateStateUi() {
    const awake = isAwake();
    const key = awake ? 'awake' : 'asleep';
    if (key === lastStateUi) return;
    lastStateUi = key;
    const brand = document.getElementById('brand-core');
    brand.classList.toggle('awake', awake);
    brand.classList.toggle('asleep', !awake);
    brand.title = awake ? 'Hades — bdie' : 'Hades — spí';

    // stavový čip v hlavičke (bdie / spí)
    const chip = document.getElementById('status-chip');
    if (chip) {
        chip.classList.toggle('awake', awake);
        const txt = chip.querySelector('.txt');
        if (txt) txt.textContent = awake ? 'bdie' : 'spí';
    }
}
export function $(id) { return document.getElementById(id); }
export function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Async spätná väzba tlačidiel — disable + dočasný text počas behu
export async function busy(btn, fn, busyText) {
    if (btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = old; }
}

// Jednotný prázdny stav — jedna šablóna pre všetky sekcie
export function emptyHtml(icon, text) {
    return '<div class="empty"><span class="ms" aria-hidden="true">' + icon + '</span><p>' + esc(text) + '</p></div>';
}

export function renderEmpty(container, icon, text) {
    container.innerHTML = emptyHtml(icon, text);
}
export function timeAgo(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min';
    if (d < 86400) return Math.round(d / 3600) + ' h';
    if (d < 604800) return Math.round(d / 86400) + ' d';
    return new Date(iso).toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}
