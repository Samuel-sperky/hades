import { requestDraw } from '../graph/render/frame.js';


/* Ambient režim — plátno na celú obrazovku, nepretržitá slučka. */
export function register(root) {
    const btn = root.querySelector('#btn-ambient');
    if (btn) btn.onclick = () => {
        document.body.classList.add('ambient');
        requestDraw(); // ambient režim → rozbehni nepretržitú slučku
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    };

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) document.body.classList.remove('ambient');
    });
}
