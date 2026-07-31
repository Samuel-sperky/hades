/* Prehliadačové stuby, ktoré jsdom nedodáva a čítajú sa PRI IMPORTE modulov.
   Importuj tento súbor AKO PRVÝ v teste — ES moduly sa vyhodnocujú v poradí
   importov, takže stuby existujú skôr, než sa vyhodnotí reťaz importov
   testovaného modulu.

   Prečo canvas: screens/agenti.js → shell/toasts.js → graph/camera.js →
   graph/canvas-el.js, ktorý na top-leveli robí
   `document.getElementById('mind').getContext('2d')`. Bez <canvas id="mind"> a
   bez getContext stubu by import spadol ešte pred prvým testom. Rovnaký prístup
   ako support/graph-dom.js, len sa spúšťa na top-leveli. */

// matchMedia (core/motion.js)
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (q) => ({
        media: q, matches: false,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {},
    });
}

// canvas 2D kontext (graph/canvas-el.js)
const CTX_RESULT = { addColorStop() {}, width: 10, data: [] };
if (typeof window !== 'undefined' && window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = function getContext() {
        const target = {};
        return new Proxy(target, {
            get(t, prop) {
                if (prop === 'canvas') return document.getElementById('mind');
                if (!(prop in t)) t[prop] = () => CTX_RESULT;
                return t[prop];
            },
            set() { return true; },
        });
    };
}
if (typeof globalThis !== 'undefined' && !globalThis.Path2D) {
    globalThis.Path2D = function Path2D() { return new Proxy({}, { get: () => () => {} }); };
}

// #mind musí existovať v čase importu canvas-el.js.
if (typeof document !== 'undefined' && !document.getElementById('mind')) {
    const c = document.createElement('canvas');
    c.id = 'mind';
    document.body.appendChild(c);
}
