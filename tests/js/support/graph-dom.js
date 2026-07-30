/* P8 — testovacie prostredie pre moduly grafu.

   Moduly grafu si pri importe berú <canvas id="mind"> a jeho 2D kontext
   (graph/canvas-el.js), a core/motion.js sa pýta matchMedia. jsdom ani jedno
   nedodá, takže markup aj obe API musia stáť PRED dynamickým importom.

   Kontext je proxy: každé volanie vráti ten istý objekt, ktorý zvládne byť
   gradientom (addColorStop) aj výsledkom measureText (width). Vďaka tomu test
   neprestane platiť, keď render pipeline (cudzí balík) pridá ďalšiu ctx metódu. */

const CTX_RESULT = { addColorStop() {}, width: 10, data: [] };

function fakeCtx() {
    const target = {};
    return new Proxy(target, {
        get(t, prop) {
            if (prop === 'canvas') return document.getElementById('mind');
            if (!(prop in t)) t[prop] = () => CTX_RESULT;
            return t[prop];
        },
        set() { return true; },   // ctx.fillStyle = … a spol.
    });
}

// Path2D používa render pipeline pri kreslení hrán; jsdom ho nemá vôbec.
function fakePath2D() {
    return new Proxy({}, { get: () => () => {} });
}

/** Postaví minimálne DOM prostredie grafu. Volaj v beforeAll pred importom modulov. */
export function installGraphDom(extraHtml = '') {
    if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    }
    if (!globalThis.Path2D) globalThis.Path2D = fakePath2D;
    window.HTMLCanvasElement.prototype.getContext = fakeCtx;
    document.body.innerHTML = '<canvas id="mind"></canvas><div id="toasts"></div>' + extraHtml;
}
