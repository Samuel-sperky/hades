/**
 * Hades — desktop shell (main proces).
 *
 * Jedno okno, otvorí sa rovno v grafe, prihlásenie sa nepýta. Vizualizácia sa
 * nemení: shell je len rám okolo tej istej webovej appky na 127.0.0.1:8080.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  PREČO TENTO SHELL NEPOTREBUJE PROXY — a prosím, nevracaj ju sem
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Appka je za `auth.ui` (`app/Http/Middleware/AuthenticateUi.php`). Aby okno
 * nemuselo prosiť o prihlásenie, musí niekto pripojiť hlavičku
 * `X-Hades-Ui-Token` — presne to, čo na verejnej ceste robí Caddy.
 *
 * Predchádzajúca cesta (`bin/hades-app.mjs`, zostáva ako záloha bez inštalácie)
 * otvára obyčajný Chrome v režime `--app`. Chrome sa nedá požiadať, aby k
 * requestom pridal hlavičku, takže launcher musí postaviť **lokálny HTTP
 * proxy** a hlavičku vložiť tam. Tým ale otvorí dvere, ktoré appka predtým
 * nemala: na loopbacku začne bežať odomknutá cesta do celej pamäte, ku ktorej
 * sa dostane každý proces na stroji. Preto ju ten launcher musí brániť — a je
 * to celá stavba: jednorazové tajomstvo v query, HttpOnly cookie, kontrola
 * hlavičky `Host` proti DNS rebindingu, väzba výhradne na 127.0.0.1, zámok na
 * porte, ukončenie proxy spolu s oknom. Päť obranných mechanizmov okolo dvery,
 * ktorú si appka sama otvorila.
 *
 * Electron tú dveru **vôbec neotvorí**. `session.webRequest.onBeforeSendHeaders`
 * pridá tú istú hlavičku priamo v sieťovej vrstve okna, takže:
 *
 *   • nevzniká žiadny server → nie je čo brániť, nie je čo obchádzať,
 *   • cudzí proces na stroji nemá kam zaklopať (žiadny port),
 *   • DNS rebinding nemá cieľ,
 *   • token existuje len v main procese; renderer ho nikdy neuvidí (viď nižšie).
 *
 * Toto NIE JE pohodlie ani „modernejší stack". Je to jediný dôvod, prečo vlna
 * s Electronom vôbec vznikla (kontrakt `KONTRAKT-UX-APPKA-CHAT-2026-08-21.md`
 * §2 a akceptačné kritérium č. 10). Keby niekto shell „zjednodušil" späť na
 * spúšťanie prehliadača s proxy, vráti sa aj tých päť obranných mechanizmov —
 * a s nimi útočná plocha, ktorú tento súbor odstraňuje.
 *
 * ─── Bezpečnostné hranice, ktoré tu držia (nemeň bez prehliadky) ────────────
 *
 *  1. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
 *  2. UI token žije LEN tu. Nikdy nejde do rendereru, do `window`, do DOM,
 *     do konzoly ani do logu. Preload o ňom nevie.
 *  3. Hlavička sa pripája len na požiadavky na **vlastný origin**; na čokoľvek
 *     cudzie sa naopak z hlavičiek odstráni.
 *  4. `webSecurity` zostáva zapnuté. Navigácia je uzamknutá na vlastný origin
 *     (`will-navigate`), nové okná sa neotvárajú (`setWindowOpenHandler`) a
 *     externé odkazy idú do systémového prehliadača.
 *  5. Žiadne oprávnenia prehliadača (kamera, mikrofón, poloha, notifikácie zo
 *     stránky) — `setPermissionRequestHandler` odmieta všetko.
 *
 * Appka je verejne tunelovaná cez ngrok, takže „veď je to lokálne" tu neplatí.
 *
 * ─── Prečo je v `electron/` vlastný `package.json` ──────────────────────────
 *
 * Koreňový `package.json` má `"type": "module"`, ale **sandboxovaný preload
 * nesmie byť ESM** (limit Electronu). `electron/package.json` s
 * `"type": "commonjs"` prepne len tento adresár na CJS, takže preload môže
 * zostať `preload.js` a `sandbox: true` platí. Frontend Hadesa sa tým
 * nedotýka — ten build step nedostáva a nedostane.
 */
'use strict';

const { app, BrowserWindow, WebContentsView, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createStateManager } = require('./states/manager');
const { createTray } = require('./tray');

/** Koreň projektu (o úroveň vyššie než tento adresár) — kvôli `.env`. */
const ROOT = path.resolve(__dirname, '..');

/** Kam sa okno pripája. Prepísateľné cez `HADES_PORT`, tak ako v `bin/hades-app.mjs`. */
const PORT = Number(process.env.HADES_PORT || 8080);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** Obrazovka, na ktorej sa okno otvorí. Graf je to, čo chce človek vidieť prvé. */
const SCREEN = process.env.HADES_SCREEN || 'graf';
const START_URL = `${ORIGIN}/?screen=${encodeURIComponent(SCREEN)}`;

/** Reverb WebSocket (živé spojenie). Prepísateľné cez `HADES_WS_PORT`, default 8081. */
const WS_PORT = Number(process.env.HADES_WS_PORT || 8081);

/** Hlavička, ktorou `auth.ui` prijíma odomknutie (rovnaká, akú vkladá Caddy). */
const TOKEN_HEADER = 'X-Hades-Ui-Token';

/** Značkové tmavé pozadie (`docs/BRAND-HADES.md` §3) — bez neho okno blikne bielym. */
const BRAND_INK = '#0e1413';

/** Povolené navigačné príkazy z rendereru. Whitelist, nie prepínač v správe. */
const NAV_ACTIONS = new Set(['back', 'forward', 'reload']);

/* ── Okenný chróm (vlastná horná lišta) ──────────────────────────────────────
   V --app režime niet adresného riadka, takže sa bez klávesnice nedá ísť späť ani
   prepnúť Graf/Charón. Frameless okno preto nesie vlastnú tenkú lištu ako
   samostatnú WebContentsView (Electron chróm, nie stránka appky). Appka žije vo
   VLASTNEJ WebContentsView pod lištou — inak by 40 px lišty prekrylo `#app-header`
   (breadcrumb, stav, prepínače pohľadu). Bezpečnostný model sa tým nemení: tie isté
   navigačné strážcovia sú prenesené na obsahovú view (rovnaká logika, iný cieľ),
   injekcia tokenu aj oprávnenia sú na úrovni session a pokrývajú obe views. */

/** Výška lišty v DIP. */
const CHROME_H = 40;

/** Identita v taskbare — bez nej Windows appku zoskupuje pod „Node". */
const APP_USER_MODEL_ID = 'sk.sperky.hades';

/** Ikona okna aj appky (mini sigil, 16–256 px). */
const APP_ICON = path.join(__dirname, 'assets', 'hades.ico');

/** Systémové okenné príkazy z lišty. Whitelist, overený v main. */
const WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'close']);

/** Obrazovka → URL na vlastnom origine. Lišta smie prepnúť len na tieto. */
const SCREEN_URL = {
    graf: `${ORIGIN}/?screen=graf`,
    charon: `${ORIGIN}/console`,
};

/** Obrazovka → titulok podľa značky (`docs/BRAND-HADES.md` §7). */
const SCREEN_TITLE = {
    graf: 'Hades — Vedomie',
    charon: 'Hades — Charón',
};

/** Z URL appky odvodí, ktorá obrazovka je aktívna (kvôli zvýrazneniu v lište). */
function screenOf(url) {
    try {
        return new URL(url).pathname.startsWith('/console') ? 'charon' : 'graf';
    } catch {
        return 'graf';
    }
}

/**
 * UI token: z prostredia, inak z `.env` v koreni projektu.
 *
 * Parsuje sa ručne, aby shell nemal ani jednu závislosť navyše. Hodnota sa
 * nikam nevypisuje — ani pri chybe. Chybová hláška hovorí o mene premennej,
 * nikdy o jej obsahu.
 */
function readUiToken() {
    const fromEnv = (process.env.HADES_UI_TOKEN || '').trim();

    if (fromEnv !== '') {
        return fromEnv;
    }

    let raw;

    try {
        raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    } catch {
        return null;
    }

    const line = raw.split(/\r?\n/).find((l) => l.startsWith('HADES_UI_TOKEN='));

    if (!line) {
        return null;
    }

    const value = line.slice('HADES_UI_TOKEN='.length).trim().replace(/^["']|["']$/g, '');

    return value === '' ? null : value;
}

/**
 * Verzia appky z `package.json` v koreni — tá istá, akú do balíka zapíše
 * electron-builder. Číta sa priamo (nie `app.getVersion()`), aby číslo sedelo
 * rovnako v dev behu (`npm run app`) aj v zabalenej appke, kde je `package.json`
 * v asar koreni. Fallback na `app.getVersion()`, keby súbor chýbal.
 */
function readVersion() {
    try {
        const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
        const value = JSON.parse(raw).version;

        return typeof value === 'string' && value !== '' ? value : app.getVersion();
    } catch {
        return app.getVersion();
    }
}

/** Patrí táto adresa našej appke? Porovnáva sa celý origin vrátane portu. */
function isOwnOrigin(url) {
    try {
        return new URL(url).origin === ORIGIN;
    } catch {
        return false;
    }
}

/**
 * Injekcia tokenu do sieťovej vrstvy okna.
 *
 * Filter sa NEZADÁVA cez `urls` vzory: Chromium match patterny neriešia port
 * spoľahlivo a vzor bez portu by hlavičku pustil aj na iné lokálne služby (na
 * stroji beží Ollama, Reverb a ďalšie appky na loopbacku). Origin sa preto
 * kontroluje v kóde — presne, vrátane portu.
 */
function installTokenInjection(token) {
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };

        if (isOwnOrigin(details.url)) {
            headers[TOKEN_HEADER] = token;
        } else {
            // Cudzí origin hlavičku neuvidí. Mazanie je paranoja (renderer token
            // nepozná), ale je zadarmo a robí kritérium overiteľným: na cudzej
            // požiadavke hlavička neexistuje za žiadnych okolností.
            for (const name of Object.keys(headers)) {
                if (name.toLowerCase() === TOKEN_HEADER.toLowerCase()) {
                    delete headers[name];
                }
            }
        }

        callback({ requestHeaders: headers });
    });
}

/**
 * Minimálne menu. Nie kozmetika: bez menu by na Windows zmizli akcelerátory
 * `Ctrl+R` a `F12`, takže by sa okno nedalo prekresliť ani diagnostikovať.
 * `autoHideMenuBar` ho drží skryté, kým človek nestlačí Alt — appka nemá
 * vyzerať ako prehliadač.
 */
function installMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: 'Hades',
            submenu: [
                { role: 'reload', label: 'Obnoviť' },
                { role: 'toggleDevTools', label: 'Nástroje pre vývojárov' },
                { type: 'separator' },
                { role: 'quit', label: 'Zavrieť Hades' },
            ],
        },
        {
            label: 'Úpravy',
            submenu: [
                { role: 'undo', label: 'Vrátiť' },
                { role: 'redo', label: 'Znovu' },
                { type: 'separator' },
                { role: 'cut', label: 'Vystrihnúť' },
                { role: 'copy', label: 'Kopírovať' },
                { role: 'paste', label: 'Vložiť' },
                { role: 'selectAll', label: 'Vybrať všetko' },
            ],
        },
    ]));
}

/** Jediné okno appky. Držané v module, aby ho `second-instance` našlo. */
let win = null;

/** Obsahová view (appka) a view lišty. Držané v module kvôli IPC z lišty. */
let appView = null;
let barView = null;

/** Správca offline stavov (obrazovka „nebeži", pás straty spojenia). Per okno. */
let stateManager = null;

/** Systémový tray. Vzniká raz pri štarte, žije celý beh appky. */
let tray = null;

/** Ktorá obrazovka je aktívna — pre zvýraznenie v lište a titulok. */
let currentScreen = SCREEN;

/** Posledná známa téma appky ('dark' | 'light'). Značka má tmavú ako default. */
let currentTheme = 'dark';

/**
 * Rozloženie oboch views: lišta hore (`CHROME_H`), appka pod ňou. Volané pri
 * každom resize aj zmene stavu okna, aby appka nikdy nepretiekla pod lištu.
 */
function layoutViews() {
    if (!win) {
        return;
    }

    const [w, h] = win.getContentSize();

    if (barView) {
        barView.setBounds({ x: 0, y: 0, width: w, height: CHROME_H });
    }

    if (appView) {
        appView.setBounds({ x: 0, y: CHROME_H, width: w, height: Math.max(0, h - CHROME_H) });
    }

    if (stateManager) {
        stateManager.relayout();
    }
}

/** Aktuálny stav pre lištu: čo sa dá prekliknúť, kde som, či je okno maximalizované. */
function sendChromeState() {
    if (!barView || barView.webContents.isDestroyed()) {
        return;
    }

    const wc = appView && !appView.webContents.isDestroyed() ? appView.webContents : null;

    barView.webContents.send('hades:chrome:state', {
        title: SCREEN_TITLE[currentScreen] || 'Hades',
        screen: currentScreen,
        canGoBack: wc ? wc.navigationHistory.canGoBack() : false,
        canGoForward: wc ? wc.navigationHistory.canGoForward() : false,
        maximized: win ? win.isMaximized() : false,
    });
}

/**
 * Navigačné strážcovia appky. Tá istá logika, akú mal pôvodne `win.webContents`
 * (agent 1) — appka sa presunula do obsahovej view, tak sa strážcovia presunuli
 * s ňou. Bezpečnostná hranica (4) sa nemení, len jej cieľ.
 */
function installContentGuards(wc) {
    // (4) Navigácia von z vlastného originu sa nedeje. Odkaz na internet otvorí
    // systémový prehliadač — v okne appky nemá čo robiť.
    wc.on('will-navigate', (event, url) => {
        if (isOwnOrigin(url)) {
            return;
        }

        event.preventDefault();
        openExternal(url);
    });

    wc.setWindowOpenHandler(({ url }) => {
        // Ani vlastný origin nedostane druhé okno — appka je jednookenná.
        if (!isOwnOrigin(url)) {
            openExternal(url);
        }

        return { action: 'deny' };
    });

    // Presmerovanie na cudzí origin uprostred requestu (redirect) je tá istá
    // hranica ako klik na odkaz.
    wc.on('will-redirect', (event, url) => {
        if (!isOwnOrigin(url)) {
            event.preventDefault();
        }
    });
}

/**
 * Zrkadlenie témy do lišty. Lišta je samostatná view a nevidí `localStorage`
 * appky, tému preto sleduje priamo v DOM appky (`data-theme`) a hlási ju cez
 * unikátne prefixovaný log, ktorý main zachytí a pošle lište. Robí sa to zvonka
 * (`executeJavaScript`), nie zásahom do stránky ani do preloadu appky — appka aj
 * jej preload zostávajú nedotknuté (pozorovateľ len ČÍTA `data-theme`).
 */
function installThemeBridge(wc) {
    const inject = () => {
        wc.executeJavaScript(`(function(){
            if (window.__hadesThemeWatch) { return; }
            window.__hadesThemeWatch = true;
            var root = document.documentElement;
            function theme(){ return root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
            var last = null;
            function report(){ var t = theme(); if (t !== last) { last = t; console.info('__HADES_THEME__ ' + t); } }
            new MutationObserver(report).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
            try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report); } catch (e) {}
            report();
        })();`).catch(() => {});
    };

    wc.on('dom-ready', inject);

    wc.on('console-message', (_event, _level, message) => {
        if (typeof message === 'string' && message.startsWith('__HADES_THEME__ ')) {
            currentTheme = message.slice('__HADES_THEME__ '.length).trim() === 'light' ? 'light' : 'dark';

            if (barView && !barView.webContents.isDestroyed()) {
                barView.webContents.send('hades:chrome:theme', currentTheme);
            }

            if (stateManager) {
                stateManager.setTheme();
            }
        }
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: BRAND_INK,
        title: SCREEN_TITLE[currentScreen] || 'Hades — Vedomie',
        icon: APP_ICON,
        // Frameless: OS lišta zmizne a nahrádza ju vlastná lišta (`barView`).
        frame: false,
        autoHideMenuBar: true,
        // Okno sa ukáže až keď appka nakreslila — inak blikne prázdnym rámom.
        show: false,
    });

    // Lišta (Electron chróm) — vlastný sandboxovaný preload, načítaná z disku.
    barView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'chrome', 'topbar-preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });

    // Obsah (appka) — TIE ISTÉ webPreferences, aké mala pôvodne `win`: rovnaký
    // preload, tie isté hranice. Bezpečnosť sa nemení, len sa presúva tam, kde
    // teraz žije appka.
    appView = new WebContentsView({
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            // Vizualizácia nič z toho nepotrebuje a každé z nich je plocha.
            webviewTag: false,
            nodeIntegrationInSubFrames: false,
            spellcheck: false,
        },
    });

    win.contentView.addChildView(appView);
    win.contentView.addChildView(barView);
    layoutViews();

    installContentGuards(appView.webContents);
    installThemeBridge(appView.webContents);

    // Offline stavy: keď sa appka nenačíta, ukáž vlastnú obrazovku značky namiesto
    // chyby Chrome a skúšaj pripojiť na pozadí. Správca si stráži vlastné views;
    // main mu len dorovnáva rozmery (`layoutViews`) a tému (`installThemeBridge`).
    stateManager = createStateManager({
        win,
        appView,
        // Lišta musí ostať navrch nad stavovými views — po ich pridaní ju vytiahni späť.
        liftChrome: () => { if (win && barView) { win.contentView.addChildView(barView); } },
        chromeHeight: CHROME_H,
        origin: ORIGIN,
        startUrl: START_URL,
        wsPort: WS_PORT,
        getTheme: () => currentTheme,
    });
    stateManager.attach();

    // Okno sa ukáže, keď appka nakreslila alebo zlyhala; poistka na 4 s, aby okno
    // neostalo skryté, ak by nenastalo ani jedno.
    let shown = false;
    const reveal = () => {
        if (!shown && win) {
            shown = true;
            win.show();
        }
    };

    appView.webContents.once('dom-ready', reveal);
    appView.webContents.once('did-fail-load', reveal);
    setTimeout(reveal, 4000);

    // Stav lišty držíme aktuálny pri každej navigácii appky.
    const refresh = () => {
        if (!appView || appView.webContents.isDestroyed()) {
            return;
        }

        currentScreen = screenOf(appView.webContents.getURL() || START_URL);
        win.setTitle(SCREEN_TITLE[currentScreen] || 'Hades');
        sendChromeState();
    };

    appView.webContents.on('did-navigate', refresh);
    appView.webContents.on('did-navigate-in-page', refresh);

    win.on('resize', layoutViews);
    win.on('maximize', () => { layoutViews(); sendChromeState(); });
    win.on('unmaximize', () => { layoutViews(); sendChromeState(); });
    win.on('enter-full-screen', () => { layoutViews(); sendChromeState(); });
    win.on('leave-full-screen', () => { layoutViews(); sendChromeState(); });

    win.on('closed', () => {
        if (stateManager) {
            stateManager.destroy();
            stateManager = null;
        }

        win = null;
        appView = null;
        barView = null;
    });

    barView.webContents.loadFile(path.join(__dirname, 'chrome', 'topbar.html'));
    appView.webContents.loadURL(START_URL);
}

/** Externé odkazy: len http(s). `file:` ani vlastné schémy nie. */
function openExternal(url) {
    try {
        const parsed = new URL(url);

        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            shell.openExternal(url);
        }
    } catch {
        // nečitateľná adresa — nikam sa nechodí
    }
}

/* ── IPC z rendereru ─────────────────────────────────────────────────────────
   Renderer nemá `ipcRenderer` naholo (viď `preload.js`). Sem prichádzajú len
   tieto dve správy a obe sa validujú, akoby prišli od cudzieho. */

ipcMain.on('hades:nav', (event, action) => {
    if (!NAV_ACTIONS.has(action)) {
        return;
    }

    const wc = event.sender;

    if (action === 'reload') {
        wc.reload();
    } else if (action === 'back') {
        wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack();
    } else if (action === 'forward') {
        wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward();
    }
});

/**
 * „Beh čaká na potvrdenie zápisu." Preload to vyčíta z DOM a posiela sem;
 * spotrebuje to agent od tray notifikácií. Main tu zatiaľ len drží stav a
 * vypustí `app` udalosť, aby sa tray dal pripojiť bez zmeny tohto súboru.
 */
const pendingWrites = new Map();

ipcMain.on('hades:pending-write', (event, payload) => {
    const id = String(payload?.id ?? '');
    const name = String(payload?.name ?? '');

    if (id === '') {
        return;
    }

    pendingWrites.set(id, { id, name, at: Date.now() });
    app.emit('hades:pending-write', { id, name, count: pendingWrites.size });
});

ipcMain.on('hades:pending-write-cleared', (event, payload) => {
    const id = String(payload?.id ?? '');

    if (!pendingWrites.delete(id)) {
        return;
    }

    app.emit('hades:pending-write-cleared', { id, count: pendingWrites.size });
});

/* ── IPC z lišty (okenný chróm) ──────────────────────────────────────────────
   Príkazy prichádzajú z view lišty (`barView`), nie z appky — jej preload
   `hadesChrome` neexistuje. Každý príkaz je proti bielej listine a smeruje výhradne
   na vlastnú appku alebo na vlastné okno; nič nejde von. Overuje sa aj odosielateľ
   (obrana do hĺbky), hoci appka toto API aj tak nemá. */

function fromBar(event) {
    return barView && !barView.webContents.isDestroyed() && event.sender === barView.webContents;
}

ipcMain.on('hades:chrome:nav', (event, action) => {
    if (!fromBar(event) || !NAV_ACTIONS.has(action) || !appView || appView.webContents.isDestroyed()) {
        return;
    }

    const wc = appView.webContents;

    if (action === 'reload') {
        wc.reload();
    } else if (action === 'back') {
        wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack();
    } else if (action === 'forward') {
        wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward();
    }
});

ipcMain.on('hades:chrome:screen', (event, name) => {
    if (!fromBar(event) || !appView || appView.webContents.isDestroyed()) {
        return;
    }

    const url = SCREEN_URL[name];

    if (url) {
        appView.webContents.loadURL(url);
    }
});

ipcMain.on('hades:chrome:window', (event, action) => {
    if (!fromBar(event) || !WINDOW_ACTIONS.has(action) || !win) {
        return;
    }

    if (action === 'minimize') {
        win.minimize();
    } else if (action === 'maximize') {
        win.isMaximized() ? win.unmaximize() : win.maximize();
    } else if (action === 'close') {
        win.close();
    }
});

ipcMain.on('hades:chrome:ready', (event) => {
    if (!fromBar(event)) {
        return;
    }

    sendChromeState();
    barView.webContents.send('hades:chrome:theme', currentTheme);
});

/* ── Tray: vytiahnutie okna a prepnutie obrazovky ────────────────────────────
   Tie isté akcie, aké má lišta, len spustené z tray menu / notifikácie. Cieľom je
   vždy vlastné okno a vlastná appka; nič nejde von. */

/** Vytiahni a zaostri okno (Otvoriť, klik na tray, klik na notifikáciu). */
function showWindow() {
    if (!win) {
        createWindow();

        return;
    }

    if (win.isMinimized()) {
        win.restore();
    }

    win.show();
    win.focus();
}

/** Prepni obrazovku appky z tray menu; najprv vytiahni okno. */
function trayScreen(name) {
    showWindow();

    const url = SCREEN_URL[name];

    if (url && appView && !appView.webContents.isDestroyed()) {
        appView.webContents.loadURL(url);
    }
}

/* ── Životný cyklus ──────────────────────────────────────────────────────── */

/**
 * (1) Single instance.
 *
 * V Electrone problém starého launchera nevzniká (nie je proxy, ktorý by sa dal
 * zhasnúť pod cudzím oknom), ale zámok patrí dovnútra aj tak: druhé spustenie
 * má zaostriť to, čo už beží, nie otvoriť druhé vedomie. Dnešný
 * `bin/hades-app.mjs` na tomto zakopol — Chrome pri zdieľanom profile predal
 * riadenie bežiacej instancii a hneď skončil, čím launcher zabil proxy pod
 * oknom, ktoré zostalo otvorené.
 */
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // Identita v taskbare: bez explicitného AppUserModelId Windows appku zoskupuje
    // pod „Node.js" a ikona z `BrowserWindow.icon` sa v hlavičke skupiny nezobrazí.
    app.setAppUserModelId(APP_USER_MODEL_ID);

    app.on('second-instance', () => {
        if (!win) {
            return;
        }

        if (win.isMinimized()) {
            win.restore();
        }

        win.focus();
    });

    app.whenReady().then(() => {
        const token = readUiToken();

        if (!token) {
            dialog.showErrorBox(
                'Hades sa nedá odomknúť',
                'V .env chýba HADES_UI_TOKEN, takže okno by skončilo na prihlasovaní.\n\n'
                + 'Doplň ho do .env v koreni projektu a spusti Hades znovu.',
            );
            app.quit();

            return;
        }

        installTokenInjection(token);
        installMenu();

        // (5) Stránka nedostane žiadne oprávnenie prehliadača. Nič z toho
        // vizualizácia ani Charón nepotrebujú.
        session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
        session.defaultSession.setPermissionCheckHandler(() => false);

        createWindow();

        // Tray: hlavne kvôli notifikácii „beh čaká na potvrdenie zápisu". Auto-start
        // je defaultne vypnutý — tray ho nikdy nezapína sám (viď `tray.js`).
        tray = createTray({
            iconPath: APP_ICON,
            version: readVersion(),
            onOpen: showWindow,
            onScreen: trayScreen,
            onQuit: () => app.quit(),
        });

        // Main proces už drží stav zaparkovaných zápisov (`hades:pending-write`);
        // tu sa naň napojí len notifikácia. Vypúšťa sa raz pri prechode do čakania,
        // nie pri každom rámci, takže notifikácia nebliká.
        app.on('hades:pending-write', (info) => {
            if (tray) {
                tray.notifyPendingWrite(info);
            }
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => app.quit());
}
