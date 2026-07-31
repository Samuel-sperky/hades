/* E-shop — karta produktu vrátane VARIANTOV (rozhodnutie 4).

   `has_attributes` a `attributes` sa v v2 vracajú: produkt 49 má 12 variantov,
   každý s `values`, `price_impact`, `reference`, `ean13`, `quantity`, `is_default`.

   Zásoba (`quantity`) je najužitočnejšie pole, preto:
     - má vlastný stĺpec a je posledná, teda najlepšie čitateľná hodnota,
     - vypredaný variant (`quantity <= 0`) je odlíšený triedou `.es-var-row--out`
       a slovom „vypredané" — nie iba farbou (farba sama nie je informácia),
     - chýbajúca zásoba je „—", nikdy dopočítaná nula.

   Dlhší zoznam: tabuľka žije vo vlastnom `.es-var-wrap` s `overflow:auto`, takže
   12 (a viac) riadkov roluje v kontejneri a telo stránky sa nikdy nerozťahuje
   do vodorovného rolovania. */

import { apiGet } from '../../core/api.js';
import { $, esc } from '../../core/dom.js';
import { listSkeletonHtml, renderApiError, renderEmptyState } from '../shared/anatomy.js';
import { amountHtml, errCode, normalizeProduct } from './data.js';

let problemRenderer = renderApiError;

export function setProblemRenderer(fn) { problemRenderer = fn || renderApiError; }


/** Stav zásoby. Text nesie informáciu aj bez farby (a11y). */
function stockHtml(q) {
    if (q === null) return '<span class="es-stock es-stock--na">—</span>';
    const cls = q <= 0 ? 'es-stock es-stock--out' : 'es-stock es-stock--in';
    const label = q <= 0 ? 'vypredané' : 'na sklade';
    return '<span class="' + cls + '"><span class="es-stock-n tnum">' + esc(String(q))
        + '</span> ks · ' + label + '</span>';
}

function variantRowHtml(v, currency) {
    const out = v.quantity !== null && v.quantity <= 0;
    return '<tr class="es-var-row' + (out ? ' es-var-row--out' : '') + '">'
        + '<th scope="row" class="es-var-label">' + esc(v.label || ('Variant ' + (v.id ?? '—')))
        + (v.isDefault ? '<span class="es-var-def">predvolený</span>' : '') + '</th>'
        + '<td class="es-var-impact">'
        + (v.priceImpact === 0 ? '<span class="es-var-noimpact">bez príplatku</span>'
            : amountHtml(v.priceImpact, { currency, sign: true })) + '</td>'
        + '<td class="es-var-ref tnum">' + esc(v.reference || '—') + '</td>'
        + '<td class="es-var-ean tnum">' + esc(v.ean13 || '—') + '</td>'
        + '<td class="es-var-qty">' + stockHtml(v.quantity) + '</td>'
        + '</tr>';
}

function variantsHtml(p) {
    if (!p.hasVariants) return '';
    if (!p.variants.length) {
        return '<p class="es-note es-note--rule">Produkt má varianty, ale API ich pri tomto '
            + 'dotaze nevrátilo.</p>';
    }
    const out = p.variants.filter((v) => v.quantity !== null && v.quantity <= 0).length;
    return '<div class="es-var-head">'
        + '<h4 class="es-var-title">Varianty</h4>'
        + '<span class="es-var-count tnum">' + p.variants.length
        + (out ? ' · ' + out + ' vypredaných' : '') + '</span></div>'
        + '<div class="es-var-wrap" tabindex="0" role="region" aria-label="Varianty produktu">'
        + '<table class="es-var"><thead><tr>'
        + '<th scope="col">Variant</th><th scope="col">Príplatok</th>'
        + '<th scope="col">Referencia</th><th scope="col">EAN13</th>'
        + '<th scope="col">Zásoba</th></tr></thead><tbody>'
        + p.variants.map((v) => variantRowHtml(v, p.currency)).join('')
        + '</tbody></table></div>';
}

function productHtml(p) {
    return '<article class="es-pcard">'
        + '<h3 class="es-p-name">' + esc(p.name || ('Produkt ' + p.id)) + '</h3>'
        + '<p class="es-p-meta"><span class="es-p-id tnum">ID ' + esc(String(p.id)) + '</span>'
        + '<span class="es-p-price">' + amountHtml(p.price, p) + '</span></p>'
        + (p.text ? '<p class="es-p-desc">' + esc(p.text.slice(0, 480)) + '</p>' : '')
        + variantsHtml(p)
        + '</article>';
}


export async function findProduct(rawId) {
    const el = $('eshop-product-result');
    if (!el) return;
    const id = Math.trunc(Number(rawId));
    if (!Number.isFinite(id) || id <= 0) {
        renderEmptyState(el, 'error_outline', 'Zadaj číselné ID produktu', 'Napríklad 49.');
        return;
    }
    el.innerHTML = listSkeletonHtml(2, '30px');

    let payload;
    try {
        payload = await apiGet('/api/eshop/products/' + id);
    } catch (e) {
        if (e && (e.status === 404 || errCode(e) === 'not_found')) {
            renderEmptyState(el, 'search_off', 'Produkt ' + id + ' neexistuje', 'E-shop ho nepozná.');
            return;
        }
        problemRenderer(el, e, () => findProduct(id));
        return;
    }

    const p = normalizeProduct(payload);
    if (!p) {
        renderEmptyState(el, 'search_off', 'Produkt ' + id + ' neexistuje',
            'Odpoveď neobsahovala detail produktu.');
        return;
    }
    el.innerHTML = productHtml(p);
}
