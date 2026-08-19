import { contextBridge, ipcRenderer } from 'electron';

/**
 * Proces počúva #run-announce a odosiela text do hlavného procesu
 * Preload beží v isolated context — ipcRenderer môžeme použiť
 */

contextBridge.exposeInMainWorld('hades', {
  version: '1.0.0'
});

/**
 * Keď sa DOM pripraví, nájdi #run-announce a počúvaj zmeny
 */
function initAnnounceListener() {
  const announceElement = document.getElementById('run-announce');

  if (announceElement) {
    // MutationObserver na obsah prvku
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          const text = announceElement.textContent?.trim();
          if (text && text.length > 0) {
            // Odosiela do hlavného procesu — vyvola 'announce-result' listener v main.mjs
            ipcRenderer.send('announce-result', text);
            break;
          }
        }
      }
    });

    observer.observe(announceElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

// Inicializuj, keď je DOM pripravený
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnnounceListener);
} else {
  initAnnounceListener();
}
