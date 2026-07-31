import { bus } from '../core/bus.js';
import { EV } from '../core/events.js';
import { SCREENS } from '../core/screens.js';
import { setScreen } from './router.js';

/* 3-pill prepínač pilierov MAP / DASHBOARDS / CHART (#mode-switch).

   Každé tlačidlo nesie data-mode = názov cieľovej obrazovky. Ak obrazovka v
   SCREENS neexistuje (CHART = 'chart', dodá W3), tlačidlo sa zablokuje a označí
   „čoskoro" — kontrakt: markup ostáva, W3 ho aktivuje len pridaním obrazovky.

   Viditeľnosť celého prepínača rieši CSS (body[data-screen] rodina graf/agenti/
   chart); JS len prepína aktívny stav a klik. */

const FAMILY = ['graf', 'agenti', 'chart'];

export function register(root) {
    const sw = root && root.querySelector ? root.querySelector('#mode-switch') : null;
    if (!sw) return;

    const buttons = [...sw.querySelectorAll('button[data-mode]')];
    for (const btn of buttons) {
        const mode = btn.dataset.mode;
        const exists = SCREENS.includes(mode);
        if (!exists) {
            btn.disabled = true;
            btn.classList.add('coming-soon');
            btn.title = 'Čoskoro';
            continue;
        }
        btn.onclick = () => setScreen(mode);
    }

    const syncActive = (screen) => {
        for (const btn of buttons) {
            btn.classList.toggle('active', btn.dataset.mode === screen);
        }
        // Poistka k CSS: skry mimo rodiny aj cez atribút (a11y — hidden nefokusuje).
        sw.hidden = !FAMILY.includes(screen);
    };

    bus.on(EV.SCREEN_CHANGED, (p) => { if (p && p.to) syncActive(p.to); });
    syncActive(document.body.dataset.screen || '');
}
