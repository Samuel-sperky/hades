import Pusher from 'pusher-js';
import { bus } from '../core/bus.js';
import { $ } from '../core/dom.js';
import { EV } from '../core/events.js';
import { blip } from '../core/sound.js';
import { S } from '../core/state/index.js';
import { refreshStats } from '../dock/stats.js';
import { renderStructure } from '../dock/structure.js';
import { anchorOf } from './anchors.js';
import { markAwake } from './awake.js';
import { refreshVisibility } from './filters.js';
import { reloadGraph } from './loader.js';
import { clearLocal } from './local.js';
import { neighborsOf } from './neighbors.js';
import { emitFlows, spawnPulse } from './pulses.js';
import { requestDraw } from './render/frame.js';
import { buildSim, kickSim } from './sim.js';
import { closeNodePanel } from '../node/node-panel.js';
import { renderJournal } from '../screens/journal.js';
import { dockOpen } from '../shell/dock.js';
import { updateHeaderMetrics } from '../shell/header.js';
import { markJournalSeen, setJournalDot } from '../shell/rail.js';
import { showToast } from '../shell/toasts.js';


/* ---------- websocket ---------- */

let wsWasConnected = false;
let wsDownNotified = false;


export function connectWs(ws) {
    // Bez konfigurácie WS (chýbajúci Reverb, degradovaný beh) appka funguje ďalej,
    // len bez živých pulzov — nikdy sa nesmie zabiť boot.
    if (!ws || !ws.key) return null;
    // Same-origin WS keď je appka servovaná cez proxy/tunel (https, alebo iný port
    // než priamy port appky) — Caddy routuje /app/* na Reverb, takže pulzy chodia aj
    // cez ngrok. Priamy lokálny prístup ostáva na ws.host/ws.port.
    //
    // Priamy port prichádza zo servera (ws.app_port), nie z literálu. Zadrôtované
    // '8080' predtým znamenalo, že presun appky na iný port ju vyhodnotil ako
    // tunelovanú a WebSocket išiel na port, kde Reverb nebeží — pulzy tichým
    // spôsobom prestali chodiť.
    const tls = location.protocol === 'https:';
    const directPort = String(ws.app_port || '8080');
    const proxied = tls || (location.port && location.port !== directPort);
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
        if (st.current === 'connected') {
            if (wsWasConnected && S.nodes.length) reloadGraph();
            if (wsDownNotified) showToast('Spojenie s vedomím obnovené', null, 'success');
            wsWasConnected = true;
            wsDownNotified = false;
            return;
        }
        // 'unavailable' = pusher-js medzitým sám skúša znova; 'failed' = transport chýba.
        // Hlásime raz za výpadok, nie pri každom pokuse, a nikdy pri prvom nábehu.
        if ((st.current === 'unavailable' || st.current === 'failed') && !wsDownNotified) {
            wsDownNotified = true;
            showToast('Živé pulzy sú odpojené — skúšam znova', null, 'warn');
        }
    });

    // Chyba spojenia nesmie vyletieť ako neodchytená výnimka (pusher-js ju inak
    // len hodí do konzoly) — reconnect si drží knižnica sama.
    pusher.connection.bind('error', () => { /* stav riešime v state_change */ });

    // Názov kanála príde z payloadu, keď ho backend začne posielať (premenovanie
    // 'mind' → 'aura' je koordinovaná zmena); dovtedy zostáva dnešný kanál.
    const channel = ws.channel || 'mind';
    pusher.subscribe(channel).bind('pulse', (msg) => handlePulse(msg.type, msg.data || {}));
    return pusher;
}


function coreNode() {
    return S.nodes.find((n) => n.type === 'core' && n.label === S.name) || S.nodes[0];
}


function handlePulse(type, data) {
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
        kickSim(0.5);
        spawnPulse(coreNode(), n, { speed: 1.4 });
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
        const from = neighborsOf(n)[0] || coreNode();
        spawnPulse(from, n, { speed: 1.6 });
        emitFlows(n, { tone: 'accent' }); // FÁZA ANIMÁCIE (Q10): tok po incidentných hranách
        kickSim(0.12);
        blip(440);
    }

    if (type === 'node.updated' && data.node) {
        const n = S.byId.get(data.node.id);
        if (n) Object.assign(n, data.node);
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
        kickSim(0.2);
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
                spawnPulse(coreNode(), n, { speed: 1.8, dim: 0.8 });
                emitFlows(n, { tone: 'accent', dim: 0.85, wait: 0.35 }); // vlna k susedom o skok ďalej
            }, i * 120);
        });
        blip(392, 0.5, 0.03);
        setTimeout(() => blip(523, 0.5, 0.03), 150);
    }

    if (type === 'chat') {
        const h = coreNode();
        if (h) h.flash = 1;
    }

    if (dockOpen === 'stats') refreshStats();
    // strom prekresli len keď nie je rozbalené riadkové menu (inak by zmizlo pod rukou);
    // markup stromu vlastní iný balík — chýbajúci #structure-tree nesmie zhodiť pulz
    if (dockOpen === 'structure' && /^(node|department)\./.test(type)) {
        const tree = $('structure-tree');
        if (tree && !tree.querySelector('.dept-actions')) renderStructure();
    }
    updateHeaderMetrics();
    refreshVisibility();   // a11y sumár + prázdny stav filtrov (uzol mohol prísť/odísť)
    bus.emit(EV.PULSE, { type, data }); // §4.4 — ostatné balíky reagujú bez zásahu do tohto súboru
    requestDraw(); // WS udalosť zmenila stav grafu → prekresli (pokrýva aj neanimované vetvy)
}
