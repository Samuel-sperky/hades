import { S } from '../core/state/index.js';
import { areaAnchor } from './anchors.js';
import { panBy, screenToWorld, zoomAt } from './camera.js';
import { canvas } from './canvas-el.js';
import { visibleCounts } from './filters.js';
import { setFocus } from './focus.js';
import { hideHoverCard, updateHoverCard } from './hover-card.js';
import { pick } from './pick.js';
import { emitFlows } from './pulses.js';
import { requestDraw } from './render/frame.js';
import { cancelConnect, createEdge } from '../node/edge-admin.js';
import { closeNodePanel, selectNode } from '../node/node-panel.js';
import { isMapActive } from './map/active.js';


/* ---------- vstupná vrstva plátna ----------

   Jedna cesta pre myš aj pero: Pointer Events + pointer capture. Capture drží
   ťahanie na plátne aj keď kurzor vyjde z okna — predtým visel `mousemove` na
   window a pustenie tlačidla mimo okna nechalo `dragging` navždy zapnuté
   (uzol sa potom „lepil" na kurzor).

   Dotyk sa zámerne ignoruje (rozhodnutie #76/#77: graf je desktop-only, žiadne
   touch gestá). Ignorovanie je aktívne, nie náhodné — bez neho by syntetické
   mouse-* udalosti z tapu robili na mobile polovičné ťahanie. */

const PAN_STEP = 60;   // klávesový posun kamery v px
const DRAG_SLOP = 4;   // px, kým sa ťahanie ešte považuje za klik


function isMouseLike(e) {
    return e.pointerType !== 'touch';
}


export function setupInput() {
    let dragging = false, moved = false, lx = 0, ly = 0;
    let dragNode = null;  // Obsidian-style grab & fling — ťahanie uzla v mape/sieti
    let pointerId = null;
    let lastHoverId = null; // FÁZA ANIMÁCIE: hover na NOVÝ uzol spustí tok po jeho hranách

    // Uvoľnenie ťahaného uzla — spoločné pre pustenie tlačidla aj pre stratu pointera
    const releaseDragNode = () => {
        if (!dragNode) return;
        // FÁZA RENDER PIPELINE: po pustení uzla sa vráť na alphaTarget 0 — sim dobehne a zastane
        if (S.sim) S.sim.alphaTarget(0);
        if (dragNode.type === 'core' && dragNode.label === S.name) {
            dragNode.fx = 0; dragNode.fy = 0; // hlavné jadro ostáva prišpendlené v strede
        } else {
            // uvoľnenie: sieť — uzol si nechá rýchlosť (fling); mapa — kotvy ho pritiahnu domov
            dragNode.fx = null; dragNode.fy = null;
        }
        dragNode = null;
    };

    const endInteraction = () => {
        dragging = false;
        pointerId = null;
        S._interacting = false; // koniec drag/pan → idle dýchanie sa môže vrátiť
        canvas.classList.remove('dragging');
        canvas.classList.remove('grabbing');
    };

    canvas.addEventListener('pointerdown', (e) => {
        if (isMapActive()) return; // W1: mapa má vlastný input (graph/map/input.js)
        if (!isMouseLike(e) || e.button !== 0) return;
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
        pointerId = e.pointerId;
        S._interacting = true; // pauza idle dýchania počas drag/pan
        dragNode = null;
        canvas.style.cursor = ''; // inline kurzor by prebil .grabbing/.dragging z CSS
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer už zmizol */ }
        if (S.view !== 'layers' && !S.connectFrom) { // pri prepájaní je klik čistý výber cieľa
            const n = pick(e.clientX, e.clientY);
            if (n) {
                dragNode = n;
                n.fx = n.x; n.fy = n.y;
                if (S.sim) S.sim.alphaTarget(0.3).restart();
            }
        }
        canvas.classList.add(dragNode ? 'grabbing' : 'dragging');
        requestDraw(); // začiatok interakcie → zobuď slučku
    });

    // FÁZA ANIMÁCIE (Living): kurzor pre gravitáciu/parallax uzlov. Aktívny len keď NIE je drag/pan
    // (počas ťahania sa gravitácia uvoľní). Odchod z plátna ju uvoľní a schová hover kartu.
    canvas.addEventListener('pointerleave', () => {
        if (isMapActive()) return;
        if (dragging) return; // capture: pointer smie opustiť plátno a ťahanie beží ďalej
        S.cursor.on = false;
        S.hover = null;
        lastHoverId = null;
        hideHoverCard();
        requestDraw();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (isMapActive()) return;
        if (!isMouseLike(e)) return;
        if (dragging && e.pointerId !== pointerId) return;
        S.cursor.sx = e.clientX; S.cursor.sy = e.clientY;
        S.cursor.on = !dragging;
        if (dragging) {
            const dx = e.clientX - lx, dy = e.clientY - ly;
            if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) moved = true;
            if (dragNode) {
                const w = screenToWorld(e.clientX, e.clientY);
                dragNode.fx = w.x;
                dragNode.fy = w.y;
            } else {
                S.cam.x += dx; S.cam.y += dy;
            }
            lx = e.clientX; ly = e.clientY;
            requestDraw(); // kamera/ťahaný uzol sa pohli → prekresli
        } else {
            const prevHover = S.hover;
            S.hover = pick(e.clientX, e.clientY);
            // FÁZA ANIMÁCIE (Q10): tok len pri prechode na nový uzol, nie na každý pohyb myšou
            const hid = S.hover ? S.hover.id : null;
            if (hid !== lastHoverId) {
                if (S.hover) emitFlows(S.hover, { tone: 'accent', dim: 0.7, speed: 1.0 });
                lastHoverId = hid;
            }
            if (S.hover !== prevHover) requestDraw(); // zmena hoveru → prekresli zvýraznenie
            // nad uzlom 'grab' (mapa/sieť — dá sa ťahať), vrstvy len klik → pointer
            canvas.style.cursor = S.connectFrom
                ? 'crosshair'
                : (S.hover ? (S.view === 'layers' ? 'pointer' : 'grab') : '');
            updateHoverCard(e);
        }
    });

    canvas.addEventListener('pointerup', (e) => {
        if (isMapActive()) return;
        if (!isMouseLike(e) || (pointerId !== null && e.pointerId !== pointerId)) return;
        const wasDragging = dragging, wasMoved = moved;
        releaseDragNode();
        endInteraction();
        if (wasDragging && !wasMoved) {
            const n = pick(e.clientX, e.clientY);
            if (S.connectFrom) {
                // connect mode: klik na iný uzol prepája, klik do prázdna ruší
                if (n && n.id !== S.connectFrom) createEdge(S.connectFrom, n.id);
                else if (!n) cancelConnect();
            } else if (n) selectNode(n);
            else closeNodePanel();
        }
        requestDraw(); // koniec interakcie / zmena výberu → prekresli (a dobehni usadenie sim)
    });

    // Stratený pointer (Esc počas ťahania, prepnutie okna, odpojené zariadenie):
    // interakcia musí skončiť rovnako čisto ako pri pustení tlačidla — bez tohto
    // ostal uzol prilepený na kurzore.
    const abort = () => {
        if (!dragging) return;
        releaseDragNode();
        endInteraction();
        requestDraw();
    };
    canvas.addEventListener('pointercancel', abort);
    canvas.addEventListener('lostpointercapture', abort);

    // Dvojklik pri kotve oblasti (do 260 world-jednotiek) prepína focus mód
    canvas.addEventListener('dblclick', (e) => {
        if (isMapActive()) return;
        const w = screenToWorld(e.clientX, e.clientY);
        let best = null, bestD = 260;
        for (const area of S.areas.values()) {
            const a = areaAnchor(area);
            const d = Math.hypot(a.x - w.x, a.y - w.y);
            if (d < bestD) { best = area; bestD = d; }
        }
        if (best) setFocus(S.focus.areaId === best.id ? null : best.id, null);
    });

    canvas.addEventListener('wheel', (e) => {
        if (isMapActive()) return; // mapa má vlastný wheel handler
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
    }, { passive: false });

    // A11Y MINIMUM: plátno sa dá zaostriť a posúvať/priblížiť z klávesnice.
    // Navigácia MEDZI uzlami je zámerne mimo rozsahu (samostatný balík) —
    // tu ide o to, aby sa používateľ klávesnice vôbec dostal ku kamere.
    canvas.addEventListener('keydown', (e) => {
        if (isMapActive()) return; // mapa má vlastné klávesy (šípky = súrodenci)
        const step = e.shiftKey ? PAN_STEP * 3 : PAN_STEP;
        switch (e.key) {
            case 'ArrowLeft': panBy(step, 0); break;
            case 'ArrowRight': panBy(-step, 0); break;
            case 'ArrowUp': panBy(0, step); break;
            case 'ArrowDown': panBy(0, -step); break;
            default: return;
        }
        e.preventDefault(); // strelky by inak skrolovali stránku pod plátnom
    });
}


/* ---------- textová alternatíva plátna (rozhodnutie #79) ---------- */

// Skrytý sumár pre čítač obrazovky. Inline štýl namiesto CSS triedy: element
// vzniká v JS a nesmie závisieť od cudzieho @import v app.css.
const SR_ONLY = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;'
    + 'overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;';

let summaryEl = null;


function summaryText() {
    const { total, nonCore } = visibleCounts();
    if (!S.nodes.length) return 'Sieť sa ešte nenačítala.';
    const parts = [
        'Sieť vedomia ' + (S.name || 'AuraAI') + '.',
        S.nodes.length + ' uzlov, ' + S.edges.length + ' spojení, ' + S.areas.size + ' oblastí, '
            + S.departments.size + ' oddelení.',
        'Zobrazených ' + total + ' uzlov.',
    ];
    if (S.local) parts.push('Aktívny lokálny graf, hĺbka ' + S.local.depth + '.');
    if (nonCore === 0 && S.nodes.length > 1) parts.push('Filtre skryli celú sieť okrem jadra.');
    // Vybraný uzol sa tu zámerne neuvádza — výber sa mení aj mimo tohto modulu
    // (skratky, paleta) a nesprávny sumár je pre čítač horší než žiadny.
    return parts.join(' ');
}


/* Prekreslí textový sumár grafu. Volá sa po načítaní, po WS pulze, po zmene
   filtrov a po zmene výberu — čítač obrazovky tak vie, čo je na plátne. */
export function updateGraphSummary() {
    if (!canvas) return;
    if (!summaryEl) {
        summaryEl = document.getElementById('graph-summary');
        if (!summaryEl) {
            summaryEl = document.createElement('p');
            summaryEl.id = 'graph-summary';
            summaryEl.setAttribute('style', SR_ONLY);
            canvas.insertAdjacentElement('afterend', summaryEl);
        }
    }
    // aria-label zostáva krátky a stabilný, detaily nesie popis (aria-describedby) —
    // inak by čítač prečítal to isté dvakrát.
    const text = summaryText();
    if (summaryEl.textContent !== text) summaryEl.textContent = text;
}


// role="img" + aria-label + skrytý sumár + fokusovateľné plátno. Atribúty sa
// nastavujú z JS, aby markup plátna (cudzí partial) nemusel nikto otvárať.
function setupCanvasA11y() {
    if (!canvas) return;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Sieť vedomia — vizualizácia grafu');
    updateGraphSummary();
    canvas.setAttribute('aria-describedby', 'graph-summary');
}


export function register(root) {
    if (!canvas) return; // bez plátna sa nedrôtuje nič (appka bez grafu musí prežiť)
    setupCanvasA11y();
    setupInput(root);
}
