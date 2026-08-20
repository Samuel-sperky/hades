#!/usr/bin/env node
/**
 * Hades ako lokálna appka — jedno okno, rovno graf, bez prihlasovania.
 *
 * Spustí sa dvojklikom na `bin/hades.cmd`. Otvorí Chrome v `--app` režime (žiadne
 * taby, žiadny adresný riadok) na vlastnom profile, takže to vyzerá a chová sa ako
 * program, nie ako stránka.
 *
 * ── PREČO TO NIE JE „appka bez ochrany" ──────────────────────────────────────
 *
 * `auth.ui` sa NERUŠÍ a appka pod ňou beží celá. Zmizlo len prihlasovanie ČLOVEKA:
 * token si prečíta tento launcher z `.env` a pridáva ho ako hlavičku
 * `X-Hades-Ui-Token`, presne ako to v produkcii robí Caddy. „Bez hesla" a „bez
 * ochrany" nie je to isté.
 *
 * To by ale samo o sebe otvorilo dvere každému procesu na tomto stroji, kým je okno
 * otvorené — a práve tomu má `auth.ui` brániť (viď komentár v
 * `app/Http/Middleware/AuthenticateUi.php`: per-page token pred lokálnym procesom
 * nechráni, lebo si spraví `GET /` a vyparsuje ho). Preto:
 *
 *  1. Proxy poslúcha VÝHRADNE na 127.0.0.1.
 *  2. Každé spustenie má vlastné jednorazové tajomstvo (`k`). Prvý request ho musí
 *     priniesť v query; proxy naň vymení cookie a odtiaľ ho vyžaduje. Cudzí lokálny
 *     proces nemá ani jedno, takže dostane 403 — nie appku.
 *  3. Kontroluje sa hlavička `Host`. Bez toho by cudzia stránka mohla nechať svoju
 *     domenu preložiť na 127.0.0.1 a hovoriť s proxy z prehliadača (DNS rebinding).
 *  4. Tajomstvo je náhodné na beh a NIE JE to token Hadesa — ten okno nikdy neuvidí.
 *  5. Proxy končí spolu s oknom. Žiadny démon, ktorý by prežil zavretie.
 *
 * Token sa nikdy nevypisuje — ani do konzoly, ani do URL, ani do access logu.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = { host: '127.0.0.1', port: Number(process.env.HADES_PORT || 8080) };

/** Obrazovka, na ktorej sa okno otvorí. Graf je to, čo chce človek vidieť prvé. */
const SCREEN = process.env.HADES_SCREEN || 'graf';

/** Kandidáti na Chrome. Edge je záloha — `--app` režim má tiež. */
const BROWSERS = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
];

function uiToken() {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.startsWith('HADES_UI_TOKEN='));

    if (!line) {
        throw new Error('HADES_UI_TOKEN nie je v .env — appka sa bez neho neodomkne.');
    }

    return line.slice('HADES_UI_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
}

function findBrowser() {
    const found = BROWSERS.find((p) => p && fs.existsSync(p));

    if (!found) {
        throw new Error('Nenašiel som Chrome ani Edge. Nastav cestu v HADES_BROWSER.');
    }

    return process.env.HADES_BROWSER || found;
}

/** Voľný port na loopbacku. Nula = nech ho vyberie OS; nič sa nezadrôtováva. */
function listenOnFreePort(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

const TOKEN = uiToken();
const KEY = crypto.randomBytes(16).toString('hex');
const COOKIE = 'hades_app';

let announced = false;

const server = http.createServer((req, res) => {
    // Sonda pre druhé spustenie. Je PRED kontrolou kľúča, ale neprezrádza nič —
    // odpovedá prázdnym 204 a hovorí len to, že na tomto porte žije náš launcher.
    if (req.url === '/__alive') {
        res.writeHead(204).end();

        return;
    }

    // (3) Host musí byť loopback. Cudzia doména preložená na 127.0.0.1 sem nemá čo hovoriť.
    const host = (req.headers.host || '').split(':')[0];

    if (host !== '127.0.0.1' && host !== 'localhost') {
        res.writeHead(403).end('forbidden host');

        return;
    }

    // (2) Jednorazové tajomstvo: v query pri prvom requeste, potom v cookie.
    const url = new URL(req.url, 'http://127.0.0.1');
    const viaQuery = url.searchParams.get('k') === KEY;
    const viaCookie = (req.headers.cookie || '').split(';').some((c) => c.trim() === `${COOKIE}=${KEY}`);

    if (!viaQuery && !viaCookie) {
        res.writeHead(403).end('forbidden');

        return;
    }

    // `k` sa z URL odstrihne, aby nezostalo v histórii okna ani v access logu appky.
    url.searchParams.delete('k');

    const headers = { ...req.headers, host: `${UPSTREAM.host}:${UPSTREAM.port}` };
    headers['x-hades-ui-token'] = TOKEN;
    headers['accept-encoding'] = 'identity';   // aby sa telo nemuselo rozbaľovať

    const upstream = http.request({
        ...UPSTREAM,
        method: req.method,
        path: url.pathname + (url.search || ''),
        headers,
    }, (up) => {
        // Jedna veta pri prvom prejdenom requeste. Bez nej sa nedá odlíšiť „okno sa
        // pripojilo" od „Hades nebeží a okno je prázdne" — a launcher, ktorý o tom
        // mlčí, núti človeka hádať.
        if (!announced) {
            announced = true;
            console.log(`Okno sa pripojilo (HTTP ${up.statusCode}).`);
        }

        const out = { ...up.headers };

        if (viaQuery) {
            // HttpOnly: stránka sa k tajomstvu nedostane ani vlastným skriptom.
            out['set-cookie'] = [`${COOKIE}=${KEY}; Path=/; HttpOnly; SameSite=Strict`];
        }

        res.writeHead(up.statusCode, out);
        up.pipe(res);
    });

    upstream.on('error', (e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Hades nebeží na ${UPSTREAM.host}:${UPSTREAM.port}.\n\n${e.message}\n`);
    });

    req.pipe(upstream);
});

const profile = path.join(os.tmpdir(), 'hades-app-profile');
const LOCK = path.join(os.tmpdir(), 'hades-app.lock');

/**
 * Beží už okno Hadesa?
 *
 * Toto NIE JE kozmetika. Chrome pri druhom spustení nad tým istým profilom prácu
 * odovzdá už bežiacej instancii a sám sa okamžite ukončí — a keďže launcher končí
 * spolu so svojím potomkom, zhasol by proxy pod oknom, ktoré zostane otvorené.
 * Namerané: druhé spustenie skončilo s kódom 0 a okno sa nikdy nepripojilo.
 * Druhá instancia sa preto nespúšťa vôbec.
 */
async function alreadyRunning() {
    if (!fs.existsSync(LOCK)) {
        return false;
    }

    const known = Number(fs.readFileSync(LOCK, 'utf8').trim());

    if (!known) {
        return false;
    }

    return new Promise((resolve) => {
        const probe = http.get({ host: '127.0.0.1', port: known, path: '/__alive', timeout: 700 }, (r) => {
            resolve(r.statusCode === 204);
            r.resume();
        });

        probe.on('error', () => resolve(false));
        probe.on('timeout', () => { probe.destroy(); resolve(false); });
    });
}

if (await alreadyRunning()) {
    console.log('Hades už beží ako appka — nájdi si jeho okno.');
    process.exit(0);
}

const port = await listenOnFreePort(server);
fs.writeFileSync(LOCK, String(port));
const browser = findBrowser();

const child = spawn(browser, [
    `--app=http://127.0.0.1:${port}/?screen=${encodeURIComponent(SCREEN)}&k=${KEY}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Okno appky nemá byť ovplyvnené tým, čo má človek otvorené v bežnom Chrome.
    '--new-window',
], { detached: false, stdio: 'ignore' });

console.log(`Hades beží ako appka na 127.0.0.1:${port} (obrazovka: ${SCREEN}).`);
console.log('Zavretím okna sa ukončí aj tento launcher.');

/** Zámok musí zmiznúť za každých okolností, inak sa appka už nikdy nespustí. */
function shutdown() {
    try {
        fs.unlinkSync(LOCK);
    } catch {
        // zámok už niekto uklidil
    }

    server.close();
    process.exit(0);
}

// (5) Proxy nesmie prežiť okno — inak by odomknutá cesta zostala otvorená.
child.on('exit', shutdown);

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        try {
            child.kill();
        } finally {
            shutdown();
        }
    });
}
