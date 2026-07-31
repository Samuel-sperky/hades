/* E-shop — zoznam objednávok, stránkovanie a detail.

   `currency` je v zozname objednávok AJ v detaile (v2), takže každá suma nesie
   ISO kód priamo z API — žiadny odhad z krajiny, žiadna značka „odhad".

   Detail vracia `products: [{id, qty}]` (predtým `product_ids: [id]`), takže
   pri každom riadku vieme aj množstvo.

   Radenie podľa `id` zostupne stále platí, preto stránkovanie hovorí
   „Novšie / Staršie" a nie „Ďalej / Späť". */

import { apiGet } from '../../core/api.js';
import { $, esc } from '../../core/dom.js';
import { listSkeletonHtml, renderApiError, renderEmptyState, sectionHtml } from '../shared/anatomy.js';
import {
    amountHtml, errCode, fmtCount, fmtDateTime, normalizeOrder, normalizeOrders, unwrap,
} from './data.js';
import { filterSummary, orderQuery } from './filters.js';

const PER_PAGE = 20;

let page = 1;
/* Vlastník chybového stavu sekcií — nastaví ho `eshop.js`, aby 501 vyzeralo
   rovnako v celej obrazovke. */
let problemRenderer = renderApiError;

export function setProblemRenderer(fn) { problemRenderer = fn || renderApiError; }

export const currentPage = () => page;


function orderRowHtml(o) {
    const id = String(o.id);
    return '<button type="button" class="es-order" data-id="' + esc(id) + '" aria-expanded="false"'
        + ' aria-label="Objednávka ' + esc(id) + ' — zobraziť detail">'
        + '<span class="es-o-id tnum">#' + esc(id) + '</span>'
        + '<span class="es-o-date">' + esc(fmtDateTime(o.date)) + '</span>'
        + '<span class="es-o-sum">' + amountHtml(o.totalPaid, o) + '</span>'
        + '<span class="ms es-o-chev" aria-hidden="true">chevron_right</span></button>';
}

function pageBtn(id, label, aria, icon, enabled, iconFirst) {
    const ico = '<span class="ms" aria-hidden="true">' + icon + '</span>';
    return '<button type="button" class="chip chip--action" id="' + id + '" aria-label="' + aria + '"'
        + (enabled ? '' : ' disabled') + '>' + (iconFirst ? ico + label : label + ico) + '</button>';
}

function pagerHtml(total, count) {
    const next = total === null ? count === PER_PAGE : page * PER_PAGE < total;
    return '<div class="es-pager">'
        + pageBtn('eshop-prev', 'Novšie', 'Novšie objednávky', 'chevron_left', page > 1, true)
        + '<span class="es-page tnum">strana ' + page + '</span>'
        + pageBtn('eshop-next', 'Staršie', 'Staršie objednávky', 'chevron_right', next, false)
        + '</div>';
}

function renderEmpty(el) {
    const back = page > 1;
    el.innerHTML = sectionHtml('Posledné objednávky', '<div class="es-slot"></div>',
        { note: filterSummary() });
    renderEmptyState(el.querySelector('.es-slot'), 'receipt_long',
        back ? 'Na tejto strane už nič nie je' : 'Vo vybranom okne nie sú objednávky',
        back ? 'Vráť sa na novšie objednávky.'
            : 'Skús širšie okno alebo zruš filter krajiny a sumy.',
        back ? { id: 'eshop-back', label: 'Novšie', icon: 'chevron_left' } : null);
    const btn = el.querySelector('#eshop-back');
    if (btn) btn.onclick = () => renderOrders(page - 1);
}


export async function renderOrders(wanted) {
    const el = $('eshop-orders');
    if (!el) return;
    page = Math.max(1, wanted || 1);
    clearDetail();
    el.innerHTML = sectionHtml('Posledné objednávky',
        '<div class="es-slot">' + listSkeletonHtml(5, '44px') + '</div>');

    let payload;
    try {
        payload = await apiGet('/api/eshop/orders', { query: orderQuery(page, PER_PAGE) });
    } catch (e) {
        problemRenderer(el.querySelector('.es-slot'), e, () => renderOrders(page));
        return;
    }

    const d = normalizeOrders(payload);
    if (!d.orders.length) { renderEmpty(el); return; }

    /* Poznámka hovorí, čo sa žiadalo; keď API filtre potvrdí echom (`filters`),
       prizná sa aj to, že sa naozaj filtrovalo. */
    const note = (d.total === null ? 'strana ' + page : fmtCount(d.total) + ' celkom')
        + ' · ' + filterSummary() + (d.filtered ? ' · filtrované' : '');
    el.innerHTML = sectionHtml('Posledné objednávky',
        '<div class="es-orders">' + d.orders.map(orderRowHtml).join('') + '</div>'
        + pagerHtml(d.total, d.orders.length), { note });

    el.querySelectorAll('.es-order[data-id]').forEach((b) => { b.onclick = () => toggleOrder(b); });
    const prev = el.querySelector('#eshop-prev');
    const next = el.querySelector('#eshop-next');
    if (prev) prev.onclick = () => renderOrders(page - 1);
    if (next) next.onclick = () => renderOrders(page + 1);
}


export function clearDetail() {
    const el = $('eshop-order-detail');
    if (el) el.innerHTML = '';
}

function productLine(p) {
    return '<span class="es-pid tnum">#' + esc(String(p.id))
        + (p.qty === null ? '' : ' × ' + esc(String(p.qty))) + '</span>';
}

function orderDetailHtml(o) {
    const items = o.products.slice(0, 40);
    const place = o.country ? o.country + (o.iso ? ' (' + o.iso + ')' : '') : (o.iso || 'krajina neuvedená');
    return '<div class="es-detail">'
        + '<div class="es-d-head"><span class="es-d-id tnum">#' + esc(String(o.id)) + '</span>'
        + '<span class="es-d-date">' + esc(fmtDateTime(o.date)) + '</span></div>'
        + '<dl class="es-d-grid">'
        + '<dt>Krajina</dt><dd>' + esc(place) + '</dd>'
        + '<dt>Zaplatené</dt><dd>' + amountHtml(o.totalPaid, o) + '</dd>'
        + '<dt>Produkty</dt><dd>' + (items.length
            ? '<span class="es-pids">' + items.map(productLine).join(' ') + '</span>' : '—')
        + '</dd></dl></div>';
}

export async function toggleOrder(btn) {
    const el = $('eshop-order-detail');
    if (!el) return;
    const id = btn.dataset.id;
    const wasOpen = btn.getAttribute('aria-expanded') === 'true';
    document.querySelectorAll('.es-order[aria-expanded="true"]')
        .forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (wasOpen) { el.innerHTML = ''; return; }
    btn.setAttribute('aria-expanded', 'true');
    el.innerHTML = listSkeletonHtml(1, '96px');

    let payload;
    try {
        payload = await apiGet('/api/eshop/orders/' + encodeURIComponent(id));
    } catch (e) {
        if (e && (e.status === 404 || errCode(e) === 'not_found')) {
            renderEmptyState(el, 'search_off', 'Objednávka ' + id + ' sa nenašla', 'E-shop ju nepozná.');
            return;
        }
        problemRenderer(el, e, () => toggleOrder(btn));
        return;
    }
    const o = normalizeOrder(unwrap(payload, ['order', 'data', 'result']));
    el.innerHTML = orderDetailHtml(o.id === null ? { ...o, id } : o);
}
