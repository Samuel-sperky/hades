/* MAPA — zapojenie do appky: jeden rAF (zdieľaný s render/frame.js), DOM šípky,
   hash routing, breadcrumb a stavový stroj.

   frame.js volá mapStep() namiesto starej draw() vetvy, keď je mapa aktívna
   (map/active.js). mapStep sám kreslí a povie slučke, či má bežať ďalej —
   mapa je dirty-driven (žiadny ambient), takže CPU spí, keď sa nič nehýbe. */

import { bus } from '../../core/bus.js';
import { EV } from '../../core/events.js';
import { S } from '../../core/state/index.js';
import { zoomBy } from '../camera.js';
import { isMapActive } from './active.js';
import { stepMapCam } from './camera.js';
import { setupMapInput } from './input.js';
import { invalidateMapLayout } from './layout.js';
import { drawMap } from './render.js';
import { introActive, startIntro } from './intro.js';
import { stepRotation } from './rotation.js';
import {
    applyHash, bindArrows, initMapState, reaimCamera, renderMapBreadcrumb,
} from './state.js';


let started = false; // mapa už raz inicializovaná (na prvom vstupe do 'graf')


/** Krok slučky mapy. Vráti true, kým prebieha animácia (kamera/rotácia/intro). */
export function mapStep() {
    const camA = stepMapCam();
    const rotA = stepRotation();
    const introBefore = introActive();
    if (camA || rotA || introBefore || S._dirty) {
        drawMap();
        S._dirty = false;
    }
    const introAfter = introActive();
    if (introBefore && !introAfter) S._dirty = true; // dokresli finálny záber intra
    return camA || rotA || introAfter || S._dirty;
}


/** Prvý vstup do mapy — obnov stav z hashu / štart + intro. */
function ensureStarted() {
    if (started) return;
    started = true;
    initMapState();
    startIntro();
}


function createArrows() {
    if (document.getElementById('map-arrows')) return;
    const wrap = document.createElement('div');
    wrap.id = 'map-arrows';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'map-arrow prev';
    prev.textContent = '‹';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'map-arrow next';
    next.textContent = '›';
    wrap.append(prev, next);
    document.body.appendChild(wrap);
    bindArrows(prev, next);
}


/* Prepoj zdieľané ovládače kamery na mapu (data-zoom, #brand-core). Beží PO
   graph/camera.js::register (poradie boot v app.js), takže mapa vyhráva. */
function rebindCameraControls(root) {
    root.querySelectorAll('[data-zoom]').forEach((el) => {
        const kind = el.dataset.zoom;
        if (kind === 'in') el.onclick = () => { if (isMapActive()) zoomBy(1.3); };
        else if (kind === 'out') el.onclick = () => { if (isMapActive()) zoomBy(1 / 1.3); };
        else if (kind === 'reset') el.onclick = () => { if (isMapActive()) reaimCamera(true); };
    });
    const core = root.querySelector('#brand-core');
    if (core) core.onclick = () => reaimCamera(true); // W1: graf = mapa, centruj mapu
}


export function register(root) {
    createArrows();
    setupMapInput();
    rebindCameraControls(root);

    // hash routing — back button aj deep-link. Reaguje len na 'graf' a #mapa.
    const onHash = () => {
        if (!isMapActive()) return;
        if (!/^#mapa/i.test(location.hash)) return;
        applyHash({ animate: true });
    };
    window.addEventListener('popstate', onHash);
    window.addEventListener('hashchange', onHash);

    // prepočítaj cieľ kamery pri zmene rozmeru (frame.js už volá requestDraw)
    window.addEventListener('resize', () => { if (isMapActive()) reaimCamera(false); });

    // pri každom vstupe na obrazovku 'graf' obnov breadcrumb (router ho prepísal)
    bus.on(EV.SCREEN_CHANGED, ({ to }) => {
        if (to === 'graf') { ensureStarted(); renderMapBreadcrumb(); }
    });

    // reload grafu (WS/scope) → prepočítaj layout, kým sme na mape
    bus.on(EV.GRAPH_LOADED, () => { invalidateMapLayout(); });
}
