'use strict';

/**
 * Hades — desktop shell (správca offline stavov).
 *
 * Namiesto chybovej stránky Chrome ukáže vlastné obrazovky značky Hades a stará sa
 * o pripojenie na pozadí. Celá logika žije tu; `main.js` ju len napojí (vytvorí
 * správcu, volá `relayout()` pri resize a `setTheme()` pri zmene témy).
 *
 * Dve nezávislé stránky (obe Electron chróm, vlastný sandboxovaný preload):
 *
 *   1. `offline.html` — CELÁ obrazovka „Hades nebeži". Zobrazí sa, keď sa appka
 *      nedokáže načítať (`did-fail-load` na vlastnom origine) alebo keď backend
 *      spadne počas behu. Automaticky skúša pripojiť s narastajúcim odstupom;
 *      keď HTTP backend (8080) nabehne, znovu načíta graf a obrazovka zmizne.
 *
 *   2. `banner.html` — NEVTIERAVÝ pás „stratené spojenie", nie modál. Sleduje sa
 *      ním živé spojenie (Reverb WebSocket, TCP 8081). Keď listener zmizne, pás
 *      sa ukáže; keď sa vráti, zmizne. Beží len počas toho, čo je appka viditeľná.
 *
 * Detekcia je z main procesu a NEZASAHUJE do rendereru ani do preloadu appky:
 *   • HTTP backend — `http.get` na vlastný origin; akákoľvek odpoveď (aj 401 za
 *     `auth.ui`) znamená „server žije", len odmietnuté/odklepnuté spojenie je pád,
 *   • Reverb — `net.connect` na 127.0.0.1:8081; nadviazané TCP spojenie stačí ako
 *     dôkaz, že listener beží (obsah handshaku nepotrebujeme).
 */

const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { WebContentsView, ipcMain } = require('electron');

/** Výška pásu „stratené spojenie" v DIP. */
const BANNER_H = 30;

/** Odstupy automatických pokusov o HTTP backend (ms), posledný sa opakuje. */
const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

/** Ako často sa kontroluje živé spojenie (Reverb) počas behu appky (ms). */
const WS_POLL_MS = 5000;

/** Timeouty jednotlivých sond (ms) — krátke, aby stav reagoval, nie čakal. */
const HTTP_PROBE_TIMEOUT = 2500;
const WS_PROBE_TIMEOUT = 1500;

/** Akákoľvek HTTP odpoveď = server žije. Len chyba/timeout = backend nebeži. */
function probeHttp(origin) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (up) => {
            if (!done) {
                done = true;
                resolve(up);
            }
        };

        const req = http.get(origin, (res) => {
            res.destroy();
            finish(true);
        });

        req.setTimeout(HTTP_PROBE_TIMEOUT, () => {
            req.destroy();
            finish(false);
        });

        req.on('error', () => finish(false));
    });
}

/** Nadviazané TCP spojenie na Reverb port = listener žije. */
function probeWs(port) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (up) => {
            if (!done) {
                done = true;
                socket.destroy();
                resolve(up);
            }
        };

        const socket = net.connect({ host: '127.0.0.1', port });

        socket.setTimeout(WS_PROBE_TIMEOUT);
        socket.on('connect', () => finish(true));
        socket.on('timeout', () => finish(false));
        socket.on('error', () => finish(false));
    });
}

/**
 * @param {object} deps
 * @param {import('electron').BrowserWindow} deps.win        Okno appky.
 * @param {import('electron').WebContentsView} deps.appView  Obsahová view (appka).
 * @param {() => void} deps.liftChrome  Vráti lištu (barView) navrch z-poradia.
 * @param {number} deps.chromeHeight    Výška hornej lišty (appka začína pod ňou).
 * @param {string} deps.origin          Vlastný origin backendu (napr. http://127.0.0.1:8080).
 * @param {string} deps.startUrl        URL grafu — kam sa appka vráti po nábehu.
 * @param {number} deps.wsPort          Port Reverb WebSocketu (8081).
 * @param {() => string} deps.getTheme  Aktuálna téma appky ('dark' | 'light').
 */
function createStateManager(deps) {
    const { win, appView, liftChrome, chromeHeight, origin, startUrl, wsPort, getTheme } = deps;

    const preload = path.join(__dirname, 'state-preload.js');

    let stateView = null;
    let bannerView = null;
    let offlineShown = false;
    let bannerShown = false;

    let backoffStep = 0;
    let retryTimer = null;
    let lastStatus = { phase: 'connecting' };

    let wsTimer = null;
    let wsUp = true;

    // Držané kvôli odhláseniu v `destroy()` — inak by pri obnove okna stackovali.
    let onRetry = null;
    let onReady = null;

    /** Spoločné bezpečné webPreferences pre interné stránky shellu. */
    function statePrefs() {
        return {
            preload,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
        };
    }

    function makeView(file) {
        const view = new WebContentsView({ webPreferences: statePrefs() });

        view.webContents.loadFile(path.join(__dirname, file));

        return view;
    }

    /** Rozmery oboch stavových views. Volá `main.js` z `layoutViews()`. */
    function relayout() {
        if (!win || win.isDestroyed()) {
            return;
        }

        const [w, h] = win.getContentSize();

        if (stateView) {
            stateView.setBounds({ x: 0, y: chromeHeight, width: w, height: Math.max(0, h - chromeHeight) });
        }

        if (bannerView) {
            bannerView.setBounds({ x: 0, y: chromeHeight, width: w, height: BANNER_H });
        }
    }

    /** Pošle stránke aktuálnu tému (stránka je samostatná view, `localStorage` appky nevidí). */
    function pushTheme(wc) {
        if (wc && !wc.isDestroyed()) {
            wc.send('hades:state:theme', getTheme() === 'light' ? 'light' : 'dark');
        }
    }

    /** `main.js` volá pri každej zmene témy appky. */
    function setTheme() {
        if (stateView) {
            pushTheme(stateView.webContents);
        }

        if (bannerView) {
            pushTheme(bannerView.webContents);
        }
    }

    function sendStatus(status) {
        lastStatus = status;

        if (stateView && !stateView.webContents.isDestroyed()) {
            stateView.webContents.send('hades:state:status', status);
        }
    }

    /* ── Offline obrazovka „Hades nebeži" ──────────────────────────────────── */

    function showOffline() {
        if (offlineShown) {
            return;
        }

        offlineShown = true;
        stopWsMonitor();

        if (!stateView) {
            stateView = makeView('offline.html');
        }

        win.contentView.addChildView(stateView);
        liftChrome();
        relayout();

        backoffStep = 0;
        scheduleRetry(0);
    }

    function hideOffline() {
        if (!offlineShown) {
            return;
        }

        offlineShown = false;

        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        if (stateView) {
            win.contentView.removeChildView(stateView);
        }
    }

    /** Naplánuje pokus o odstup `delay` (ms). */
    function scheduleRetry(delay) {
        if (retryTimer !== null) {
            clearTimeout(retryTimer);
        }

        sendStatus({ phase: 'waiting', nextAt: Date.now() + delay });

        retryTimer = setTimeout(attempt, delay);
    }

    /** Naplánuje ďalší pokus s narastajúcim odstupom (posledný stupeň sa opakuje). */
    function resumeBackoff() {
        const delay = BACKOFF[Math.min(backoffStep, BACKOFF.length - 1)];
        backoffStep += 1;
        scheduleRetry(delay);
    }

    /** Jeden pokus o backend; úspech → skús načítať graf, pád → ďalší odstup. */
    async function attempt() {
        if (!offlineShown) {
            return;
        }

        sendStatus({ phase: 'connecting' });

        const up = await probeHttp(origin);

        if (!offlineShown) {
            return;
        }

        if (up) {
            // Backend odpovedá — skús načítať appku. Obrazovka zmizne až po úspešnom
            // `did-finish-load`; ak load napriek tomu padne, `did-fail-load` obnoví
            // backoff (viď `attach`). Preto sa tu nič neplánuje.
            recover();

            return;
        }

        resumeBackoff();
    }

    /** Backend nabehol — znovu načítaj graf. Obrazovka zmizne až po úspešnom load. */
    function recover() {
        sendStatus({ phase: 'connecting' });

        if (appView && !appView.webContents.isDestroyed()) {
            appView.webContents.loadURL(startUrl);
        }
    }

    /** Okamžitý pokus z tlačidla „Skúsiť znova". */
    function manualRetry() {
        if (!offlineShown) {
            return;
        }

        // Zruš naplánovaný automatický pokus, nech nebežia dva naraz.
        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        backoffStep = 0;
        attempt();
    }

    /* ── Pás „stratené spojenie" (Reverb) ──────────────────────────────────── */

    function showBanner() {
        if (bannerShown || offlineShown) {
            return;
        }

        bannerShown = true;

        if (!bannerView) {
            bannerView = makeView('banner.html');
        }

        win.contentView.addChildView(bannerView);
        liftChrome();
        relayout();
        pushTheme(bannerView.webContents);
    }

    function hideBanner() {
        if (!bannerShown) {
            return;
        }

        bannerShown = false;

        if (bannerView) {
            win.contentView.removeChildView(bannerView);
        }
    }

    function startWsMonitor() {
        stopWsMonitor();
        wsUp = true;

        const check = async () => {
            const up = await probeWs(wsPort);

            if (up && !wsUp) {
                wsUp = true;
                hideBanner();
            } else if (!up && wsUp) {
                wsUp = false;
                showBanner();
            }
        };

        wsTimer = setInterval(check, WS_POLL_MS);
        check();
    }

    function stopWsMonitor() {
        if (wsTimer !== null) {
            clearInterval(wsTimer);
            wsTimer = null;
        }

        hideBanner();
    }

    /* ── Napojenie na appku ────────────────────────────────────────────────── */

    function attach() {
        const wc = appView.webContents;

        // Pád načítania appky na vlastnom origine (backend nebeži alebo spadol).
        // `-3` (ABORTED) je bežné pri preklikoch/redirectoch, nie výpadok — ignoruj.
        wc.on('did-fail-load', (_event, errorCode, _desc, validatedURL, isMainFrame) => {
            if (!isMainFrame || errorCode === -3) {
                return;
            }

            if (!(isOwnOrigin(validatedURL) || validatedURL === '' || validatedURL === startUrl)) {
                return;
            }

            if (offlineShown) {
                // Padol pokus o obnovu (backend odpovedal na sondu, ale načítanie
                // zlyhalo) — pokračuj v backoffe namiesto zaseknutia.
                resumeBackoff();
            } else {
                showOffline();
            }
        });

        // Appka sa úspešne načítala — schovaj offline a začni sledovať živé spojenie.
        wc.on('did-finish-load', () => {
            if (isOwnOrigin(wc.getURL())) {
                hideOffline();
                startWsMonitor();
            }
        });

        onRetry = (event) => {
            if (stateView && event.sender === stateView.webContents) {
                manualRetry();
            }
        };

        onReady = (event) => {
            pushTheme(event.sender);

            if (stateView && event.sender === stateView.webContents) {
                event.sender.send('hades:state:status', lastStatus);
            }
        };

        ipcMain.on('hades:state:retry', onRetry);
        ipcMain.on('hades:state:ready', onReady);
    }

    function isOwnOrigin(url) {
        try {
            return new URL(url).origin === origin;
        } catch {
            return false;
        }
    }

    function destroy() {
        stopWsMonitor();

        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }

        if (onRetry) {
            ipcMain.removeListener('hades:state:retry', onRetry);
            onRetry = null;
        }

        if (onReady) {
            ipcMain.removeListener('hades:state:ready', onReady);
            onReady = null;
        }

        stateView = null;
        bannerView = null;
    }

    return { attach, relayout, setTheme, destroy };
}

module.exports = { createStateManager, BANNER_H };
