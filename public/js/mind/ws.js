import { emitFlows, neighborsOf, spawnPulse } from './anim.js';
import { reloadGraph } from './api.js';
import { dockOpen } from './dock.js';
import { clearLocal } from './filters.js';
import { anchorOf } from './layout.js';
import { closeNodePanel } from './panels.js';
import { markJournalSeen, setJournalDot } from './rail.js';
import { requestDraw } from './render.js';
import { renderJournal } from './screens/dennik.js';
import { buildSim, kickSim } from './sim.js';
import { S } from './state.js';
import { renderStructure } from './structure.js';
import { showToast } from './toasts.js';
import { $, blip, markAwake, updateHeaderMetrics } from './util.js';

/* ---------- websocket ---------- */

export let wsWasConnected = false;

export function connectWs(ws) {
    // Same-origin WS keď je appka servovaná cez proxy/tunel (https, alebo iný port
    // než priamy 8080) — Caddy routuje /app/* na Reverb, takže pulzy chodia aj cez
    // ngrok. Priamy lokálny 127.0.0.1:8080 ostáva na ws.host/ws.port (localhost:8081).
    const tls = location.protocol === 'https:';
    const proxied = tls || (location.port && location.port !== '8080');
    const host = proxied ? location.hostname : ws.host;
    const port = proxied
        ? (location.port ? Number(location.port) : (tls ? 443 : 80))
        : ws.port;

    const pusher = new Pusher(ws.key, {
        wsHost: host,
        wsPort: port,
        wssPort: port,
        forceTLS: tls,
        enabledTransports: tls ? ['wss', 'ws'] : ['ws'],
        cluster: 'mt1',
        disableStats: true,
    });

    // po výpadku spojenia mohli pulzy vypadnúť — pri REconnecte dotiahni stav grafu
    pusher.connection.bind('state_change', (st) => {
        if (st.current !== 'connected') return;
        if (wsWasConnected && S.nodes.length) reloadGraph();
        wsWasConnected = true;
    });

    pusher.subscribe('mind').bind('pulse', (msg) => handlePulse(msg.type, msg.data || {}));
}

export function hadesNode() {
    return S.nodes.find((n) => n.type === 'core' && n.label === S.name) || S.nodes[0];
}

export function handlePulse(type, data) {
    markAwake();

    if (type === 'node.created' && data.node) {
        if (S.byId.has(data.node.id)) return;
        const n = { ...data.node };
        const a = anchorOf(n);
        n.x = a.x + (Math.random() - 0.5) * 40;
        n.y = a.y + (Math.random() - 0.5) * 40;
        n.flash = 1;
        n._born = S._clock; // FÁZA ANIMÁCIE (Q13): časovač zrodu — polomer 0→plný + prstenec
        S.nodes.push(n);
        S.byId.set(n.id, n);
        buildSim();
        kickSim();
        spawnPulse(hadesNode(), n, { speed: 1.4 });
        emitFlows(n, { tone: 'accent', speed: 1.1 }); // tok po nových hranách uzla
        blip(520);
        showToast('Naučil som sa: ' + n.label, n.id);
        if (n.source === 'session') {
            if (S.screen === 'dennik') { renderJournal(); markJournalSeen(); }
            else setJournalDot(true);
        }
    }

    if (type === 'node.activated') {
        const n = S.byId.get(data.node_id);
        if (!n) return;
        n.strength = data.strength;
        n.flash = 1;
        const from = neighborsOf(n)[0] || hadesNode();
        spawnPulse(from, n, { speed: 1.6 });
        emitFlows(n, { tone: 'accent' }); // FÁZA ANIMÁCIE (Q10): tok po incidentných hranách
        kickSim();
        blip(440);
    }

    if (type === 'node.updated' && data.node) {
        const n = S.byId.get(data.node.id);
        if (n) {
            // Object.assign sám nestačí: keď sa uzol presunie (mind_move) alebo zmení
            // typ, zmenila sa jeho KOTVA a jeho miesto vo filtri — a to sú veci, ktoré
            // si layout aj anchors cachujú. Podpis layoutu pritom závisí len od počtov,
            // takže po presune zostal uzol vizuálne v starej oblasti (staré dim/kind)
            // až do najbližšieho reloadu. Prestavbu platíme LEN pri štrukturálnej zmene,
            // premenovanie a nový popis sú aj naďalej lacné.
            const sig = (m) => [m.area_id, m.department_id, m.type, m.source].join('|');
            const before = sig(n);
            Object.assign(n, data.node);
            if (sig(n) !== before) {
                S._anchors = null;   // pod-kotvy oddelení sa počítajú z obsadenosti
                S._localFor = null;  // BFS cache lokálneho grafu
                buildSim();          // computeLayout(true) + nové kotvy + dousadenie
                kickSim();
            }
        }
    }

    if (type === 'node.deleted') {
        const n = S.byId.get(data.node_id);
        if (!n) return;
        S.nodes = S.nodes.filter((m) => m.id !== n.id);
        S.edges = S.edges.filter((e) => e.source.id !== n.id && e.target.id !== n.id);
        S.byId.delete(n.id);
        if (S.selected === n) closeNodePanel();
        if (S.local && S.local.rootId === n.id) clearLocal();
        S._localFor = null; // hrany sa zmenili — BFS cache neplatí
        buildSim();
    }

    if (type === 'edge.created' && data.edge) {
        const src = S.byId.get(data.edge.source_id);
        const tgt = S.byId.get(data.edge.target_id);
        if (!src || !tgt) return;
        if (S.edges.some((e) => e.id === data.edge.id)) return;
        S.edges.push({ ...data.edge, source: src, target: tgt });
        buildSim();
        kickSim();
        spawnPulse(src, tgt, { speed: 1.2 });
        blip(660, 0.25, 0.035);
    }

    if (type === 'edge.deleted') {
        const i = S.edges.findIndex((e) => e.id === data.id);
        if (i !== -1) {
            S.edges.splice(i, 1);
            S._localFor = null;
            buildSim();
        }
    }

    if (type === 'edge.strengthened') {
        const e = S.edges.find((x) => x.id === data.edge_id);
        if (e) {
            e.weight = data.weight;
            spawnPulse(e.source, e.target, { speed: 1.5 });
        }
    }

    if (type === 'department.created' && data.department) {
        S.departments.set(data.department.id, data.department);
        buildSim();
    }

    if (type === 'recall' && Array.isArray(data.node_ids)) {
        // FÁZA ANIMÁCIE (Q11): postupné rozliatie od nájdených uzlov k susedom — graph-walk vlna.
        // Pulz z jadra na uzol, po jeho dobehnutí sa z uzla rozbehnú toky k susedom (staggered).
        data.node_ids.forEach((id, i) => {
            const n = S.byId.get(id);
            if (!n) return;
            setTimeout(() => {
                spawnPulse(hadesNode(), n, { speed: 1.8, dim: 0.8 });
                emitFlows(n, { tone: 'accent', dim: 0.85, wait: 0.35 }); // vlna k susedom o skok ďalej
            }, i * 120);
        });
        blip(392, 0.5, 0.03);
        setTimeout(() => blip(523, 0.5, 0.03), 150);
    }

    if (type === 'chat') {
        const h = hadesNode();
        if (h) h.flash = 1;
    }

    if (dockOpen === 'structure' && /^(node|department)\./.test(type)
        && !$('structure-tree').querySelector('.dept-actions')) renderStructure();
    updateHeaderMetrics();
    requestDraw(); // WS udalosť zmenila stav grafu → prekresli (pokrýva aj neanimované vetvy)
}
