import Pusher from 'pusher-js';

/* ---------- realtime (druhý Pusher pre nemapové kanály) ----------

   graph/ws.js drží vlastný Pusher pre kanál 'mind' (mapové pulzy). Tento modul
   je samostatný, tenký klient pre OSTATNÉ kanály (dnes 'agents' — DASHBOARDS).
   Zámerne NEZdieľa spojenie s graph/ws.js: ten je zamknutý (W1) a jeho pripojenie
   sa deje v boot poradí; miešať doňho cudzie kanály by porušilo jeho kontrakt.

   Rovnaká same-origin logika ako graph/ws.js: keď je appka tunelovaná (https alebo
   iný port než priamy port appky), WebSocket ide cez proxy na location.host, inak
   priamo na ws.host/ws.port. `app_port` prichádza zo servera, nie z literálu.

   API:
     initRealtime(ws)              — raz pri boote; uloží config, spojenie je lenivé
     subscribe(channel, event, cb) — vráti unsubscribe(); prežije init aj re-init
     _reset()                      — len pre testy */

let pusher = null;
let wsConfig = null;
/** @type {Map<string, {event:string, cb:Function, channel:any, handler:Function}[]>} */
const subs = new Map();


/** Uloží WS config a (ak treba) otvorí spojenie. Bez configu je no-op — appka
    beží ďalej bez živých pulzov, presne ako graph/ws.js. */
export function initRealtime(ws) {
    wsConfig = ws && ws.key ? ws : null;
    if (!wsConfig) return null;
    ensurePusher();
    // Ak sa niekto stihol prihlásiť pred initom, dopoj jeho kanály teraz.
    for (const [channel, list] of subs) {
        for (const s of list) if (!s.channel) attach(channel, s);
    }
    return pusher;
}


function ensurePusher() {
    if (pusher || !wsConfig) return pusher;
    const ws = wsConfig;
    const tls = location.protocol === 'https:';
    const directPort = String(ws.app_port || '8080');
    const proxied = tls || (location.port && location.port !== directPort);
    const host = proxied ? location.hostname : ws.host;
    const port = proxied
        ? (location.port ? Number(location.port) : (tls ? 443 : 80))
        : ws.port;

    pusher = new Pusher(ws.key, {
        wsHost: host,
        wsPort: port,
        wssPort: port,
        forceTLS: tls,
        enabledTransports: tls ? ['wss', 'ws'] : ['ws'],
        cluster: 'mt1',
        disableStats: true,
    });
    // Chyby spojenia si rieši knižnica sama (reconnect); nepusti neodchytenú výnimku.
    pusher.connection.bind('error', () => { /* no-op */ });
    return pusher;
}


function attach(channel, sub) {
    const ch = pusher.subscribe(channel);
    sub.channel = ch;
    ch.bind(sub.event, sub.handler);
}


/** Prihlási callback na (channel, event). Vráti funkciu na odhlásenie.
    Funguje aj keď realtime ešte nebol inicializovaný — dopojí sa v initRealtime. */
export function subscribe(channel, event, cb) {
    const handler = (msg) => cb(msg || {});
    const sub = { event, cb, channel: null, handler };
    if (!subs.has(channel)) subs.set(channel, []);
    subs.get(channel).push(sub);

    if (ensurePusher()) attach(channel, sub);

    return function unsubscribe() {
        const list = subs.get(channel);
        if (!list) return;
        const i = list.indexOf(sub);
        if (i !== -1) list.splice(i, 1);
        if (sub.channel) sub.channel.unbind(sub.event, sub.handler);
        if (list.length === 0) {
            subs.delete(channel);
            if (pusher) pusher.unsubscribe(channel);
        }
    };
}


/** Len pre testy — zabudni spojenie aj prihlásenia. */
export function _reset() {
    if (pusher && pusher.disconnect) { try { pusher.disconnect(); } catch (e) { /* noop */ } }
    pusher = null;
    wsConfig = null;
    subs.clear();
}
