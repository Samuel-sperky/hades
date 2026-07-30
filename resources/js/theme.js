/* Light/dark theme: data-theme attribute + canvas palette + persistence. */

import { store } from './core/store.js';
import { setCanvasTheme } from './graph/canvas-colors.js';
import { invalidateCertColors } from './graph/render/cert-colors.js';
import { draw } from './graph/render/draw.js';

export function setTheme(name) {
    setCanvasTheme(name);
    document.documentElement.dataset.theme = (name === 'dark' ? 'dark' : 'light');
    store.setRaw('theme', name);
    invalidateCertColors();
}

/** Tmavý režim — prepínač v nastaveniach, synchronizovaný s data-theme */
export function register(root) {
    const themeBtn = root.querySelector('#theme-toggle');
    if (!themeBtn) return;
    const syncThemeBtn = () => themeBtn.setAttribute('aria-checked',
        document.documentElement.dataset.theme === 'dark' ? 'true' : 'false');
    syncThemeBtn();
    themeBtn.onclick = () => {
        setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        syncThemeBtn();
        draw();
    };
}
