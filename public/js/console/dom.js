/* Drobné DOM pomôcky konzoly.

   Vlastný súbor, aby si sedem modulov nepísalo sedemkrát svoje `const $ = …`.
   Všetko sú hoistované `export function` — pravidlo projektu, ktoré tu platí aj
   keď cyklus zatiaľ nie je: render.js a tools.js sa navzájom volajú. */

export function $(sel, root = document) {
    return root.querySelector(sel);
}

export function $$(sel, root = document) {
    return [...root.querySelectorAll(sel)];
}

/** Element s triedou a TEXTOM — textContent, nikdy innerHTML. */
export function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);

    return node;
}

/** Skrátenie na jeden riadok karty. Výpustka je znak, nie tri bodky. */
export function clip(text, max = 120) {
    const one = String(text ?? '').replace(/\s+/gu, ' ').trim();

    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Čísla po slovensky — desatinná čiarka, nie bodka. */
export function num(value, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';

    return value.toLocaleString('sk-SK', { maximumFractionDigits: digits });
}
