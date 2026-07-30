import { setView } from '../graph/view.js';


/* Náhľad siete — Mapa / Sieť / Vrstvy (data-view). */
export function register(root) {
    root.querySelectorAll('#view-switch button').forEach((b) => {
        b.onclick = () => setView(b.dataset.view);
    });
}
