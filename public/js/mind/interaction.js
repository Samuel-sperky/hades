import { emitFlows } from './anim.js';
import { localSet, nodeVisible } from './filters.js';
import { drawRadius } from './layout.js';
import { cancelConnect, closeNodePanel, createEdge, selectNode } from './panels.js';
import { graphActive, requestDraw, visibleInReplay } from './render.js';
import { clearFilter, goInto, goUp, holdSim } from './sim.js';
import { S, canvas } from './state.js';
import { $, esc, plainInline, typeName } from './util.js';

/* ---------- interakcia ---------- */

export function screenToWorld(px, py) {
    return {
        x: (px - S.w / 2 - S.cam.x) / S.cam.k,
        y: (py - S.h / 2 - S.cam.y) / S.cam.k,
    };
}

// Uzol pod kurzorom — hľadá len medzi uzlami aktuálnej úrovne (S.layout.pos).
// Prach má malý polomer, preto k nemu pridávame štedrý dosah (8 px v obrazovke).
export function pick(px, py) {
    const L = S.layout;
    if (!L) return null;
    const w = screenToWorld(px, py);
    const invK = 1 / S.cam.k;
    const loc = localSet();
    let best = null, bestD = Infinity;
    for (const [id, ent] of L.pos) {
        const n = S.byId.get(id);
        if (!n) continue;
        if (!visibleInReplay(n) || !nodeVisible(n, loc)) continue;
        const d = Math.hypot(n.x + (n._ox || 0) - w.x, n.y + (n._oy || 0) - w.y);
        if (d < drawRadius(n, ent, invK) + 8 * invK && d < bestD) { best = n; bestD = d; }
    }
    return best;
}

// Hub (oblasť / oddelenie) pod kurzorom — huby majú prednosť pred prachom pod nimi.
// Značky pásov (kind 'layer') sú len popisky, klik nimi prejde na uzly pod nimi.
export function pickHub(px, py) {
    const L = S.layout;
    if (!L) return null;
    const w = screenToWorld(px, py);
    const invK = 1 / S.cam.k;
    let best = null, bestD = Infinity;
    for (const h of L.hubs) {
        if (h.kind === 'layer' || h.dim < 0.5) continue;
        const d = Math.hypot(h.x - w.x, h.y - w.y);
        const r = Math.max(9 * invK, h.rw) + 6 * invK;
        if (d < r && d < bestD) { best = h; bestD = d; }
    }
    return best;
}

// Čo je pod kurzorom: hub > uzol > prázdno.
export function pickTarget(px, py) {
    const h = pickHub(px, py);
    if (h) return { type: h.kind === 'area' ? 'areaHub' : 'deptHub', id: h.id, hub: h };
    const n = pick(px, py);
    if (n) return { type: 'node', id: n.id, node: n };
    return null;
}

export function setupInput() {
    let dragging = false, moved = false, lx = 0, ly = 0;
    let lastHoverId = null;
    // VLNA GRAF A: uzly sa opäť dajú ťahať — pozície drží fyzika, takže fx/fy
    // uzol pripne a sieť sa okolo neho preleje. Ťahanie prázdna = pan plátna.
    let dragNode = null;

    // Pustí ťahaný uzol späť fyzike. Musí sa dať zavolať aj z ciest, kde mouseup
    // nikdy nepríde (pustenie mimo okna, kontextové menu, strata fokusu) — inak
    // uzol zostane pripnutý na fx/fy, holdSim drží alphaTarget a slučka beží
    // na 60 fps naveky.
    const releaseDrag = () => {
        if (dragNode) {
            dragNode.fx = null; dragNode.fy = null;
            dragNode = null;
            holdSim(false);
        }
        dragging = false;
        S._interacting = false;
        canvas.classList.remove('dragging');
    };

    // Telo gesta vytiahnuté z myšacích handlerov, aby ho vedel volať aj dotyk.
    // Prst a kurzor majú robiť to isté; keby to boli dve kópie, rozídu sa pri
    // prvej zmene ťahania a jedna z ciest ostane s odpojeným uzlom na fx/fy.
    const beginDragAt = (px, py) => {
        dragging = true; moved = false; lx = px; ly = py;
        S._interacting = true;
        canvas.style.cursor = '';
        dragNode = null;
        if (!S.connectFrom && !pickHub(px, py)) {
            const n = pick(px, py);
            if (n) {
                dragNode = n;
                n.fx = n.x; n.fy = n.y;
                holdSim(true);
            }
        }
        canvas.classList.add('dragging');
        requestDraw();
    };

    const moveDragTo = (px, py) => {
        const dx = px - lx, dy = py - ly;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (dragNode) {
            const w = screenToWorld(px, py);
            // fx/fy pre fyziku, x/y priamo — aby ťahanie fungovalo aj vtedy,
            // keď sa d3 nenačítalo a simulácia neexistuje
            dragNode.fx = w.x; dragNode.fy = w.y;
            dragNode.x = w.x; dragNode.y = w.y;
        } else {
            S.cam.x += dx; S.cam.y += dy;
            S._camTween = null;      // ručný pan preruší tween kamery
            S._fitOnSettle = false;  // ...aj automatické dorovnanie po usadení
        }
        lx = px; ly = py;
        requestDraw();
    };

    // Vyhodnotenie kliku/klepnutia bez posunu (výber, zanorenie, spájanie).
    const resolveClick = (px, py) => {
        const hit = pickTarget(px, py);
        if (S.connectFrom) {
            // connect mode: klik na iný uzol prepája, klik do prázdna ruší
            if (hit && hit.type === 'node' && hit.id !== S.connectFrom) createEdge(S.connectFrom, hit.id);
            else if (!hit) cancelConnect();
        } else if (hit) {
            // W2a: klik na hub/uzol ZANORÍ; detail uzla sa otvorí spolu s tým
            if (hit.type === 'node') selectNode(hit.node);
            goInto(hit);
        } else {
            // klik do prázdna → o úroveň von (a zavri detail)
            closeNodePanel();
            goUp();
        }
    };

    // Zoom ukotvený v danom bode obrazovky: svetový bod pod kurzorom (resp. pod
    // stredom pinch gesta) musí po zmene mierky ostať na tom istom pixeli, inak
    // scéna pod prstami uteká.
    const zoomAt = (px, py, factor) => {
        const before = screenToWorld(px, py);
        S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
        const after = screenToWorld(px, py);
        S.cam.x += (after.x - before.x) * S.cam.k;
        S.cam.y += (after.y - before.y) * S.cam.k;
        S._camTween = null;
        S._fitOnSettle = false;   // ručný zoom má prednosť pred dorovnaním po usadení
    };

    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;   // len ľavé tlačidlo — pravé/stredné inak štartovalo drag, ktorý sa nikdy neskončil
        beginDragAt(e.clientX, e.clientY);
    });

    canvas.addEventListener('mouseleave', () => { S.cursor.on = false; });

    // Záchytné body, kde mouseup nepríde: strata fokusu okna, zrušené gesto,
    // kontextové menu. Bez nich zostane uzol pripnutý a slučka beží naveky.
    window.addEventListener('blur', () => { if (dragging) { releaseDrag(); requestDraw(); } });
    canvas.addEventListener('pointercancel', () => { if (dragging) { releaseDrag(); requestDraw(); } });
    canvas.addEventListener('contextmenu', () => { if (dragging) { releaseDrag(); requestDraw(); } });

    window.addEventListener('mousemove', (e) => {
        // Listener je na window (kvôli panu aj mimo plátna), takže mimo Grafu by
        // pick() bežal nad 1027 uzlami a hover karta zamrznutého grafu by
        // vyskakovala nad kartami dashboardu.
        if (!graphActive()) { S.cursor.on = false; $('hover-card').classList.remove('show'); return; }
        S.cursor.sx = e.clientX; S.cursor.sy = e.clientY;
        S.cursor.on = !dragging;
        if (dragging) {
            moveDragTo(e.clientX, e.clientY);
        } else {
            const prevHover = S.hover;
            const hub = pickHub(e.clientX, e.clientY);
            S.hover = hub ? null : pick(e.clientX, e.clientY);
            S._hoverHub = hub || null;
            const hid = S.hover ? S.hover.id : null;
            if (hid !== lastHoverId) {
                if (S.hover) emitFlows(S.hover, { tone: 'accent', dim: 0.7, speed: 1.0 });
                lastHoverId = hid;
            }
            if (S.hover !== prevHover || !!hub !== !!S._hoverHubPrev) requestDraw();
            S._hoverHubPrev = !!hub;
            canvas.style.cursor = S.connectFrom ? 'crosshair' : ((hub || S.hover) ? 'pointer' : '');
            updateHoverCard(e, hub);
        }
    });

    window.addEventListener('mouseup', (e) => {
        const wasDragging = dragging, wasMoved = moved;
        releaseDrag();   // uvoľní uzol aj príznaky; klik vyhodnotíme z uložených hodnôt
        if (!graphActive()) return;   // klik mimo Grafu nesmie vyberať uzly
        if (wasDragging && !wasMoved) resolveClick(e.clientX, e.clientY);
        dragging = false;
        requestDraw();
    });

    // Dvojklik do prázdna zruší celý filter (rýchly reset zanorenia).
    canvas.addEventListener('dblclick', (e) => {
        if (pickTarget(e.clientX, e.clientY)) return;
        clearFilter();
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
        requestDraw();
    }, { passive: false });

    /* ---------- dotyk ----------

       PREČO touch* vedľa myši a nie prepis na Pointer Events: myšacia cesta nesie
       veci, ktoré dotyk nemá vôbec — hover kartu, `S.cursor` pre gravitáciu kurzora
       a tvar kurzora. V pointermove by sa aj tak muselo vetviť na `pointerType`,
       takže sľubovaná „jedna cesta pre oboje" by bola tá istá dvojkoľajnosť, len
       schovaná vnútri handlera — a zaplatená prepisom overaného ovládania myšou,
       ktoré je tu primárne. Spoločné je to podstatné (beginDragAt / moveDragTo /
       resolveClick / zoomAt), rozdielne ostáva rozdielne.

       Stav gesta sa ZDIEĽA s myšou (dragging, moved, dragNode, lx, ly): jedna ruka
       nerobí oboje naraz a vďaka tomu ťahaný uzol pustia aj existujúce záchytné
       body (pointercancel, contextmenu z dlhého podržania, blur). */
    let pinch = null;                 // predchádzajúci stav dvojprstového gesta
    let lastTapT = 0, lastTapX = 0, lastTapY = 0;

    const pinchOf = (touches) => {
        const a = touches[0], b = touches[1];
        return {
            d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
            cx: (a.clientX + b.clientX) / 2,
            cy: (a.clientY + b.clientY) / 2,
        };
    };

    canvas.addEventListener('touchstart', (e) => {
        if (!graphActive()) return;   // mimo Grafu plátno len presvitá pod obsahom — gesto patrí stránke
        e.preventDefault();           // ...a tu naopak potlačí scroll, dvojklep-zoom aj syntetické myšacie udalosti
        // Dotyk nemá hover; keby po prechode z myši ostal zapnutý, karta by visela
        // nad scénou a gravitácia kurzora by ťahala k poslednej polohe myši.
        S.cursor.on = false;
        $('hover-card').classList.remove('show');
        if (e.touches.length === 1) {
            pinch = null;
            beginDragAt(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length >= 2) {
            releaseDrag();            // druhý prst mení pan/ťahanie uzla na pinch
            pinch = pinchOf(e.touches);
            S._interacting = true;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (!graphActive()) return;
        e.preventDefault();
        if (pinch && e.touches.length >= 2) {
            const p = pinchOf(e.touches);
            zoomAt(p.cx, p.cy, p.d / pinch.d);
            // Stred gesta sa medzitým mohol posunúť — dvomi prstami sa má dať aj
            // panovať, inak zoom „drží" scénu na mieste a pôsobí zaseknuto.
            S.cam.x += p.cx - pinch.cx;
            S.cam.y += p.cy - pinch.cy;
            pinch = p;
            moved = true;
            requestDraw();
            return;
        }
        if (dragging && e.touches.length === 1) moveDragTo(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length >= 2) { pinch = pinchOf(e.touches); return; }
        if (e.touches.length === 1) {
            // Z pinchu ostal jeden prst → plynulo pokračuj panom. `moved` ostáva
            // true, aby sa koniec gesta nevyhodnotil ako klepnutie.
            pinch = null;
            lx = e.touches[0].clientX; ly = e.touches[0].clientY;
            dragging = true; moved = true;
            S._interacting = true;
            return;
        }
        const wasDragging = dragging, wasMoved = moved, wasPinch = !!pinch;
        const t = e.changedTouches[0];
        releaseDrag();
        pinch = null;
        if (!graphActive() || !t) { requestDraw(); return; }
        if (wasDragging && !wasMoved && !wasPinch) {
            const now = performance.now();
            const isDouble = now - lastTapT < 300
                && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 30;
            lastTapT = now; lastTapX = t.clientX; lastTapY = t.clientY;
            // Dvojklep = dvojklik: do prázdna zruší celý filter. Vlastná detekcia,
            // lebo preventDefault na touchstart syntetický dblclick nevygeneruje.
            if (isDouble && !pickTarget(t.clientX, t.clientY)) {
                lastTapT = 0;         // tretí klep nech neruší filter znova
                clearFilter();
            } else {
                resolveClick(t.clientX, t.clientY);
            }
        }
        requestDraw();
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
        pinch = null;
        releaseDrag();
        requestDraw();
    });

    // `touch-action` je v mind.css, viazané na body[data-screen="graf"] — musí byť
    // podmienené, lebo plátno je fixed pod obsahom a natvrdo vypnuté gestá by mimo
    // Grafu zabili scrollovanie stránky všade, kde sa prst trafí mimo textu.
    // Guard graphActive() v handleroch je na tom nezávislý a zostáva.
}

export function updateHoverCard(e, hub) {
    const card = $('hover-card');
    const n = S.hover;

    if (!n && !hub) {
        card.classList.remove('show');
        return;
    }

    if (hub) {
        const kind = hub.kind === 'area' ? 'oblasť' : 'oddelenie';
        card.innerHTML = '<div class="t">' + esc(hub.name) + '</div>'
            + '<div class="m">' + kind + ' · ' + hub.count + ' uzlov · klik zanorí</div>';
    } else {
        // ŠIESTA kópia mapy názvov typov bola práve tu — komentár pri TYPE_NAMES
        // v util.js síce interaction.js menoval, ale tento lokálny objekt prežil,
        // takže hover karta mala vlastný zdroj pravdy. Teraz ide cez typeName().
        const area = S.areas.get(n.area_id);
        const dept = S.departments.get(n.department_id);
        const meta = [typeName(n.type), area && area.name, dept && dept.name]
            .filter(Boolean)
            .map((v) => esc(String(v)))
            .join(' · ');
        // label je surový z databázy (nesie `backticky`) — rovnako ako v Denníku
        card.innerHTML = '<div class="t">' + esc(plainInline(n.label)) + '</div><div class="m">' + meta + '</div>';
    }
    card.classList.remove('hidden');
    card.classList.add('show');

    const pad = 14;
    const r = card.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
}
