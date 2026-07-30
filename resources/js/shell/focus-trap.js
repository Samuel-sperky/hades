/* Focus trap pre modaly — rozhodnutie #80.

   Jeden malý modul pre všetky dialógy shellu (Cmd-K, Pomocník, Markdown náhľad,
   mobilný spodný list). Rieši tri veci, ktoré doteraz nikto nerobil:
     1. Tab a Shift+Tab cyklia len vnútri dialógu.
     2. Pri otvorení ide fókus na prvý ovládací prvok (alebo na zadaný element).
     3. Pri zatvorení sa fókus VRÁTI tam, odkiaľ dialóg vyšiel.

   Escape kaskádu si každý dialóg drží po svojom (shell/shortcuts.js) — tento
   modul ju zámerne nepreberá, aby sa poradie zatvárania nezmenilo. */

const SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Viditeľné zaostritelné prvky vnútri kontejnera, v DOM poradí. */
function focusables(container) {
    return [...container.querySelectorAll(SELECTOR)]
        .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);
}

/**
 * Uzavri fókus do kontejnera.
 * @param {HTMLElement} container
 * @param {{ initial?: HTMLElement|null }} [opts]
 * @returns {() => void} release — vráti fókus a odpojí listener
 */
export function trapFocus(container, opts = {}) {
    if (!container) return () => {};
    const previous = document.activeElement;

    const onKeydown = (e) => {
        if (e.key !== 'Tab') return;
        const items = focusables(container);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && (active === first || !container.contains(active))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (active === last || !container.contains(active))) {
            e.preventDefault();
            first.focus();
        }
    };

    container.addEventListener('keydown', onKeydown);

    // Fókus až po vykreslení — element schovaný cez .hidden sa nedá zaostriť.
    const target = opts.initial || focusables(container)[0] || null;
    if (target) setTimeout(() => target.focus(), 20);

    return () => {
        container.removeEventListener('keydown', onKeydown);
        if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
            previous.focus();
        }
    };
}
