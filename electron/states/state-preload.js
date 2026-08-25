'use strict';

/**
 * Hades — desktop shell (preload offline stavov).
 *
 * Zdieľaný preload pre dve interné stránky shellu:
 *   • `offline.html` — celá obrazovka „Hades nebeží",
 *   • `banner.html`  — nevtieravý pás „stratené spojenie".
 *
 * Obe sú Electron chróm, nie stránka appky. Bežia v izolovanom sandboxovanom
 * kontexte, takže do stránky ide len úzke, menované API cez `contextBridge` —
 * žiadny `ipcRenderer` naholo. Stránky nič nerozhodujú: hlásia jediný fakt
 * („skús znova", „som načítaná") a prekresľujú stav, ktorý im pošle main proces.
 *
 * UI token sem nechodí a chodiť nesmie — žije len v main procese (viď `main.js`).
 */

const { contextBridge, ipcRenderer } = require('electron');

const api = {
    /** Človek klikol „Skúsiť znova" — main proces spustí okamžitý pokus o pripojenie. */
    retry() {
        ipcRenderer.send('hades:state:retry');
    },

    /**
     * Po prerušenom behu: „Pokračovať" — nechaj stránku appky tak, ako je (rozpísaná
     * správa aj front správ zostanú), len zhasni prekrytie.
     */
    resume() {
        ipcRenderer.send('hades:state:resume');
    },

    /** Po prerušenom behu: „Načítať znovu" — vedomé zahodenie rozpísaného. */
    reload() {
        ipcRenderer.send('hades:state:reload');
    },

    /** Stránka je načítaná a pýta si prvý stav a tému (karta môže byť už zobrazená). */
    ready() {
        ipcRenderer.send('hades:state:ready');
    },

    /**
     * Odber stavu pripojenia: `{ phase, mode }`, kde `phase` je `connecting`
     * (skúšam), `waiting` (+ `nextAt`, odpočet do ďalšieho pokusu) alebo `ready`
     * (backend je späť a čaká sa na rozhodnutie človeka), a `mode` je `load`
     * (appka sa nenačítala) alebo `run` (backend spadol počas behu).
     */
    onStatus(handler) {
        ipcRenderer.on('hades:state:status', (_event, status) => handler(status));
    },

    /** Odber režimu pásu: `{ mode: 'ws' | 'run' }` — stránka podľa neho volí text. */
    onBanner(handler) {
        ipcRenderer.on('hades:state:banner', (_event, info) => handler(info));
    },

    /** Odber témy ('dark' | 'light') — appka ju mení, stavy ju len zrkadlia. */
    onTheme(handler) {
        ipcRenderer.on('hades:state:theme', (_event, theme) => handler(theme));
    },
};

contextBridge.exposeInMainWorld('hadesState', Object.freeze(api));
