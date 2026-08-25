'use strict';

/**
 * Hades — desktop shell (preload hornej lišty).
 *
 * Lišta je samostatná WebContentsView (Electron chróm), nie stránka appky. Beží
 * v izolovanom, sandboxovanom kontexte — tak ako preload appky (`../preload.js`) —
 * takže do lišty ide len úzke, menované API cez `contextBridge`. Žiadny `ipcRenderer`
 * naholo, žiadny prístup k UI tokenu (ten žije len v main procese, viď `main.js`).
 *
 * Smer komunikácie:
 *   • lišta → main: navigácia appky (späť/vpred/obnoviť), prepnutie obrazovky
 *     (Graf/Chat/Charón) a systémové okno (minimalizovať/maximalizovať/zavrieť). Každý
 *     príkaz main proces overí proti vlastnej bielej listine.
 *   • main → lišta: stav (`state`) a téma (`theme`). Lišta z nich len prekresľuje;
 *     nič nerozhoduje.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Whitelist navigačných príkazov; main ho overuje ešte raz. */
const NAV = ['back', 'forward', 'reload'];
/** Whitelist obrazoviek, na ktoré lišta vie prepnúť appku. */
const SCREENS = ['graf', 'chat', 'charon'];
/** Whitelist systémových okenných príkazov. */
const WINDOW = ['minimize', 'maximize', 'close'];

const api = {
    /** Navigácia obsahu okna (appky). */
    nav(action) {
        if (NAV.includes(action)) {
            ipcRenderer.send('hades:chrome:nav', action);
        }
    },

    /** Prepnutie obrazovky appky (Graf / Chat / Charón). */
    screen(name) {
        if (SCREENS.includes(name)) {
            ipcRenderer.send('hades:chrome:screen', name);
        }
    },

    /** Systémové okenné príkazy. */
    window(action) {
        if (WINDOW.includes(action)) {
            ipcRenderer.send('hades:chrome:window', action);
        }
    },

    /** Lišta hlási main procesu, že je načítaná a chce prvý stav + tému. */
    ready() {
        ipcRenderer.send('hades:chrome:ready');
    },

    /** Odber stavu lišty (canGoBack/Forward, maximalizované, obrazovka, titulok). */
    onState(handler) {
        ipcRenderer.on('hades:chrome:state', (_e, state) => handler(state));
    },

    /** Odber témy ('dark' | 'light') — appka ju mení, lišta ju len zrkadlí. */
    onTheme(handler) {
        ipcRenderer.on('hades:chrome:theme', (_e, theme) => handler(theme));
    },
};

contextBridge.exposeInMainWorld('hadesChrome', Object.freeze(api));
