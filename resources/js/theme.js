/* Téma: preferencia (light | dark | system) → data-theme na :root + paleta canvasu.
   Rozhodnutie #64: „Systém" je tretia možnosť. Rieši sa TU, nie v CSS — inak by
   dark.css musel duplikovať ~80 tokenov v @media (prefers-color-scheme: dark).
   Do localStorage ide preferencia (aj 'system'), na :root vždy rozložená hodnota. */

import { store } from './core/store.js';
import { setCanvasTheme } from './graph/canvas-colors.js';
import { invalidateCertColors } from './graph/render/cert-colors.js';
import { draw } from './graph/render/draw.js';

/** Poradie v segmentovanom prepínači aj v klávesovej rotácii. */
export const THEMES = ['light', 'dark', 'system'];

const THEME_LABELS = { light: 'Svetlá', dark: 'Tmavá', system: 'Systém' };

const darkQuery = () => (typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null);

/** Preferencia z localStorage; neznáma hodnota degraduje na 'light' (dnešný default). */
export function themePref() {
    const v = store.raw('theme');
    return THEMES.includes(v) ? v : 'light';
}

/** Preferencia → konkrétna téma, ktorá sa stampne na :root. */
export function resolveTheme(pref) {
    if (pref === 'dark') return 'dark';
    if (pref === 'system') {
        const q = darkQuery();
        return q && q.matches ? 'dark' : 'light';
    }
    return 'light';
}

/** Aplikuj rozloženú tému bez zápisu preferencie (používa OS listener). */
function applyResolved(resolved) {
    setCanvasTheme(resolved);
    document.documentElement.dataset.theme = resolved;
    invalidateCertColors();
}

/**
 * Nastav tému. Prijíma 'light' | 'dark' | 'system'.
 * Signatúra zostáva pôvodná (setTheme(name)) — app.js ani window.AURA sa nemenia.
 */
export function setTheme(name) {
    const pref = THEMES.includes(name) ? name : 'light';
    applyResolved(resolveTheme(pref));
    store.setRaw('theme', pref);
}

/* OS téma sa môže zmeniť za behu; pri preferencii 'system' to musíme dobehnúť.
   Listener sa registruje raz pri importe modulu, nie v register() — nezávisí od DOM. */
(() => {
    const q = darkQuery();
    if (!q || typeof q.addEventListener !== 'function') return;
    q.addEventListener('change', () => {
        if (themePref() !== 'system') return;
        applyResolved(resolveTheme('system'));
        draw();
    });
})();

/**
 * Vzhľad → Téma. Segmentovaný prepínač (Svetlá / Tmavá / Systém).
 * Spätná kompatibilita: keď v markupe existuje starý #theme-toggle (role="switch"),
 * modul ho drôtuje ako dvojstavový prepínač — smoke test naň kliká.
 */
export function register(root) {
    const seg = root.querySelector('#theme-seg');
    if (seg) {
        const btns = [...seg.querySelectorAll('button[data-theme-pref]')];
        const sync = () => {
            const pref = themePref();
            btns.forEach((b) => {
                const on = b.dataset.themePref === pref;
                b.classList.toggle('active', on);
                b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        };
        sync();
        btns.forEach((b) => {
            b.onclick = () => {
                setTheme(b.dataset.themePref);
                sync();
                syncLegacyToggle(root);
                draw();
            };
        });
    }

    // Starý dvojstavový prepínač — zostáva funkčný, kým naň mieria testy.
    const themeBtn = root.querySelector('#theme-toggle');
    if (!themeBtn) return;
    syncLegacyToggle(root);
    themeBtn.onclick = () => {
        setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        syncLegacyToggle(root);
        if (seg) seg.querySelectorAll('button[data-theme-pref]').forEach((b) => {
            const on = b.dataset.themePref === themePref();
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        draw();
    };
}

function syncLegacyToggle(root) {
    const btn = root.querySelector('#theme-toggle');
    if (!btn) return;
    btn.setAttribute('aria-checked',
        document.documentElement.dataset.theme === 'dark' ? 'true' : 'false');
}

export { THEME_LABELS };
