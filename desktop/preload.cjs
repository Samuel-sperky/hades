/**
 * Preload most medzi stránkou konzoly a hlavným procesom.
 *
 * PREČO .cjs A NIE .mjs: `package.json` má `"type": "module"`, takže `.mjs` aj
 * `.js` sú tu ESM — a Electron ESM preload v SANDBOXOVANOM rendereri nepodporuje.
 * Pôvodná `preload.mjs` sa preto pri `sandbox: true` nikdy nenačítala, `announce-result`
 * sa nezaregistroval a nativ. notifikácia po dobehnutí agenta bola napísaná a mŕtva.
 * Prípona `.cjs` je tu jediné, čo drží sandbox zapnutý — a sandbox je dôvod, prečo je
 * toto okno bezpečné otvárať nad obsahom, ktorý spoluvytvára model.
 *
 * Beží v izolovanom kontexte: stránka na `ipcRenderer` nedosiahne, vidí len to, čo
 * jej `contextBridge` výslovne podá.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hades', {
  version: '1.0.0',
});

/**
 * Sleduje `#run-announce` — aria-live oblasť, do ktorej konzola píše vetu
 * „Odpoveď dokončená, N tokenov…".
 *
 * MutationObserver a nie polling: je to jediná zmena, na ktorú čakáme, a beh môže
 * trvať minúty (lokálny model na CPU). Polling by v tom okne len točil CPU, ktoré
 * potrebuje inferencia.
 */
function initAnnounceListener() {
  const announceElement = document.getElementById('run-announce');

  if (!announceElement) {
    return;
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        const text = announceElement.textContent?.trim();

        if (text && text.length > 0) {
          ipcRenderer.send('announce-result', text);
          break;
        }
      }
    }
  });

  observer.observe(announceElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnnounceListener);
} else {
  initAnnounceListener();
}
