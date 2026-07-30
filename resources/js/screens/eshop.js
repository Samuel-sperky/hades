/* Obrazovka E-shop — živé dáta zo SPERKY API (sperky-eshop.sk) cez `api/eshop/*`.

   Anatómia (vzor screens/library.js): page-head (blade) → toolbar → stav
   integrácie → KPI počty → objednávky po dňoch → rozpad podľa krajín →
   posledné objednávky → hľadanie produktu podľa id. Skeleton/empty/error stavy
   sú zo `shared/anatomy.js`, mena a normalizácia odpovedí z `eshop/data.js`
   (tam sú aj podrobne rozpísané nálezy N1–N7).

   Zhrnutie povinných obmedzení z refactor-auraai/08-SPERKY-API-SPEC.md:
     N1  hlavné číslo je POČET objednávok; obrat LEN po krajinách, s priznaním
         odhadnutej meny. ZAKÁZANÉ: súhrnné číslo obratu, prepočet na jednu menu.
         Preto sa tu nikde nesčítavajú sumy a každá suma ide cez `amountHtml()`.
     N2  varianty produktu sa nezobrazujú a ani nečítajú.
     N3  filtrovanie podľa dátumu neexistuje → denné počty berieme hotové zo
         `summary`; keď je sken neúplný, obrazovka to prizná (SCAN_NOTE).
     N4  objednávky sú zoradené podľa id ZOSTUPNE → strana 1 = najnovšie, preto
         stránkovanie hovorí „Novšie / Staršie".
     N6  HTTP status nie je zdroj pravdy — health vracia 200 aj keď je e-shop
         mimo, takže sa číta `ok` v tele.
     N7  všetky čísla vždy z API — chýbajúce je „—", nikdy dopočítaná nula.

   Keď je API nedostupné, obrazovka to povie a nespadne. */

import { apiGet } from '../core/api.js';
import { bus } from '../core/bus.js';
import { $, esc } from '../core/dom.js';
import { EV } from '../core/events.js';
import { fmtDecDate } from '../core/format.js';
import {
    kpiGridHtml, listSkeletonHtml, renderApiError, renderEmptyState, sectionHtml,
} from './shared/anatomy.js';
import {
    CURRENCY_NOTE, SCAN_NOTE, amountHtml, coveredDays, errCode, fmtCount, fmtDateTime,
    normalizeHealth, normalizeOrder, normalizeOrders, normalizeProduct, normalizeSummary,
    reasonForCode, unwrap,
} from './eshop/data.js';

const PER_PAGE = 20;


/* ---------- chybové stavy ---------- */

/* 501 nie je porucha, ale „backend ešte nie je zapojený". Vlastná hláška preto,
   že describeApiError() by pre 5xx povedal len „Server vrátil chybu". */
function renderProblem(host, err, retry) {
    if (!host) return;
    if (err && err.status === 501) {
        renderEmptyState(host, 'construction', 'Serverová časť integrácie ešte nie je hotová',
            'Endpoint odpovedal HTTP 501 (not implemented). Obrazovka je pripravená a naplní sa, '
            + 'keď backend dorazí.',
            retry ? { id: 'es-retry', label: 'Skúsiť znova', icon: 'refresh' } : null);
        const b = host.querySelector('.empty-act');
        if (b && retry) b.onclick = retry;
        return;
    }
    renderApiError(host, err, retry);
}


/* ---------- stav integrácie ---------- */

function statusLine(kind, icon, html) {
    return '<div class="es-status es-status--' + kind + '">'
        + '<span class="ms" aria-hidden="true">' + icon + '</span>'
        + '<span class="es-st-text">' + html + '</span></div>';
}

/* Nikdy nevypisuje text zo servera — len vety z uzavretej tabuľky v data.js. */
function downReason(err, h) {
    if (err && err.status === 501) return 'Serverová časť integrácie ešte nie je zapojená (HTTP 501).';
    if (h && !h.keyConfigured) {
        return 'Kľúč integrácie nie je nastavený, takže objednávky nie sú dostupné. '
            + 'Katalóg produktov funguje aj bez neho.';
    }
    if (h && h.products && !h.orders) {
        return 'Katalóg produktov odpovedá, objednávky nie — problém je na strane kľúča alebo limitu.';
    }
    return reasonForCode(errCode(err)) || reasonForCode(h && h.code) || reasonForCode(err && err.code)
        || 'Skontroluj, či je integrácia nakonfigurovaná a e-shop dostupný.';
}

function renderStatus(state, err, h) {
    const el = $('eshop-status');
    if (!el) return;
    if (state === 'wait') {
        el.innerHTML = statusLine('wait', 'sync', 'Zisťujem dostupnosť e-shopu…');
    } else if (state === 'ok') {
        el.innerHTML = statusLine('ok', 'cloud_done',
            '<strong>E-shop odpovedá.</strong> Dáta nižšie sú živé, nič sa neukladá lokálne.');
    } else {
        el.innerHTML = statusLine('down', 'cloud_off', '<strong>E-shop API neodpovedá.</strong> '
            + esc(downReason(err, h)) + ' Obrazovka beží ďalej, len bez živých čísel.');
    }
}

function stampChecked() {
    const el = $('eshop-checked');
    if (!el) return;
    el.textContent = 'overené ' + new Date().toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}


/* ---------- KPI, dni, krajiny ---------- */

/* Rodinný `.dbar` z charts.css (P10) — jeden riadok pre dni aj pre krajiny. */
function barRowHtml(label, valueText, value, max, extra) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return '<div class="dbar es-bar">'
        + '<div class="dbar-head"><span class="db-dot"></span>'
        + '<span class="db-name">' + esc(label) + '</span>'
        + '<span class="db-n tnum">' + esc(valueText) + '</span></div>'
        + '<div class="dbar-track"><div class="dbar-fill" style="width:' + pct + '%;"></div></div>'
        + (extra || '') + '</div>';
}

function renderKpi(s, h) {
    const el = $('eshop-kpi');
    if (!el) return;
    // Celkové počty vie povedať aj health (`totals`), keď scan súhrnu nedobehol.
    const total = s.ordersTotal ?? (h ? h.totalOrders : null);
    const products = s.productsTotal ?? (h ? h.totalProducts : null);
    const window = s.ordersWindow === null ? '—' : (s.complete ? '' : '≥ ') + fmtCount(s.ordersWindow);
    el.innerHTML = kpiGridHtml([
        { value: fmtCount(total), label: 'Objednávok v e-shope', hero: true },
        { value: fmtCount(s.ordersDay), label: 'Objednávky za dnes' },
        { value: window, label: 'Objednávky za ' + (s.windowDays ? s.windowDays + ' dní' : 'okno') },
        { value: fmtCount(products), label: 'Produktov v katalógu' },
    ]) + (s.complete ? '' : '<p class="es-note">' + esc(SCAN_NOTE) + '</p>');
}

function renderDays(s) {
    const el = $('eshop-days');
    if (!el) return;
    const rows = coveredDays(s);
    if (!rows.length) { el.innerHTML = ''; return; }
    const max = rows.reduce((m, r) => Math.max(m, r.orders), 0);
    el.innerHTML = sectionHtml('Objednávky po dňoch',
        '<div class="es-bars">'
        + rows.map((r) => barRowHtml(fmtDecDate(r.date), fmtCount(r.orders), r.orders, max)).join('')
        + '</div>',
        { note: s.complete ? 'počty z API' : 'dolná hranica' });
}

function renderCountries(s) {
    const el = $('eshop-countries');
    if (!el) return;
    if (!s.countries.length) {
        renderEmptyState(el, 'public', 'Rozpad podľa krajín tu ešte nie je',
            String(s.countriesNote || 'Krajina je len v detaile objednávky, preto ju súhrn '
                + 'nedopĺňa pri každom otvorení obrazovky.').slice(0, 240));
        return;
    }
    const max = s.countries.reduce((m, c) => Math.max(m, c.orders), 0);
    el.innerHTML = sectionHtml('Krajiny podľa počtu objednávok',
        '<p class="es-note es-note--warn">' + esc(CURRENCY_NOTE) + '</p>'
        + '<div class="es-bars">' + s.countries.map((c) => barRowHtml(
            c.name ? c.name + ' (' + c.iso + ')' : c.iso, fmtCount(c.orders), c.orders, max,
            c.amount === null ? '' : '<div class="es-country-sum">' + amountHtml(c.amount, c) + '</div>',
        )).join('') + '</div>',
        { note: s.countriesFrom && s.countriesFrom !== 'live' ? 'z ' + s.countriesFrom : 'zo vzorky' });
}


/* ---------- objednávky ---------- */

let ordersPage = 1;

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

function pagerHtml(page, total, count) {
    const next = total === null ? count === PER_PAGE : page * PER_PAGE < total;
    return '<div class="es-pager">'
        + pageBtn('eshop-prev', 'Novšie', 'Novšie objednávky', 'chevron_left', page > 1, true)
        + '<span class="es-page tnum">strana ' + page + '</span>'
        + pageBtn('eshop-next', 'Staršie', 'Staršie objednávky', 'chevron_right', next, false)
        + '</div>';
}

function renderOrdersEmpty(el) {
    const back = ordersPage > 1;
    el.innerHTML = sectionHtml('Posledné objednávky', '<div class="es-slot"></div>');
    renderEmptyState(el.querySelector('.es-slot'), 'receipt_long',
        back ? 'Na tejto strane už nič nie je' : 'Žiadne objednávky',
        back ? 'Vráť sa na novšie objednávky.' : 'API vrátilo prázdny zoznam.',
        back ? { id: 'eshop-back', label: 'Novšie', icon: 'chevron_left' } : null);
    const btn = el.querySelector('#eshop-back');
    if (btn) btn.onclick = () => renderOrders(ordersPage - 1);
}

export async function renderOrders(page) {
    const el = $('eshop-orders');
    if (!el) return;
    ordersPage = Math.max(1, page || 1);
    clearDetail();
    el.innerHTML = sectionHtml('Posledné objednávky',
        '<div class="es-slot">' + listSkeletonHtml(5, '44px') + '</div>');

    let payload;
    try {
        payload = await apiGet('/api/eshop/orders', { query: { page: ordersPage, per_page: PER_PAGE } });
    } catch (e) {
        renderProblem(el.querySelector('.es-slot'), e, () => renderOrders(ordersPage));
        return;
    }

    const d = normalizeOrders(payload);
    if (!d.orders.length) { renderOrdersEmpty(el); return; }

    el.innerHTML = sectionHtml('Posledné objednávky',
        '<div class="es-orders">' + d.orders.map(orderRowHtml).join('') + '</div>'
        + pagerHtml(ordersPage, d.total, d.orders.length),
        { note: d.total === null ? 'strana ' + ordersPage : fmtCount(d.total) + ' celkom' });

    el.querySelectorAll('.es-order[data-id]').forEach((b) => { b.onclick = () => toggleOrder(b); });
    const prev = el.querySelector('#eshop-prev');
    const next = el.querySelector('#eshop-next');
    if (prev) prev.onclick = () => renderOrders(ordersPage - 1);
    if (next) next.onclick = () => renderOrders(ordersPage + 1);
}

function clearDetail() {
    const el = $('eshop-order-detail');
    if (el) el.innerHTML = '';
}

function orderDetailHtml(o) {
    const ids = o.productIds.slice(0, 40);
    const place = o.country ? o.country + (o.iso ? ' (' + o.iso + ')' : '') : (o.iso || 'krajina neuvedená');
    return '<div class="es-detail">'
        + '<div class="es-d-head"><span class="es-d-id tnum">#' + esc(String(o.id)) + '</span>'
        + '<span class="es-d-date">' + esc(fmtDateTime(o.date)) + '</span></div>'
        + '<dl class="es-d-grid">'
        + '<dt>Krajina</dt><dd>' + esc(place) + '</dd>'
        + '<dt>Zaplatené</dt><dd>' + amountHtml(o.totalPaid, o) + '</dd>'
        + '<dt>Produkty</dt><dd>' + (ids.length
            ? '<span class="es-pids tnum">' + ids.map((x) => esc(String(x))).join(', ') + '</span>' : '—')
        + '</dd></dl>'
        + '<p class="es-note es-note--warn">' + esc(CURRENCY_NOTE) + '</p></div>';
}

async function toggleOrder(btn) {
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
        renderProblem(el, e, () => toggleOrder(btn));
        return;
    }
    const o = normalizeOrder(unwrap(payload, ['order', 'data', 'result']));
    el.innerHTML = orderDetailHtml(o.id === null ? { ...o, id } : o);
}


/* ---------- produkt podľa id (bez variantov — N2) ---------- */

function productHtml(p) {
    return '<article class="es-pcard">'
        + '<h3 class="es-p-name">' + esc(p.name || ('Produkt ' + p.id)) + '</h3>'
        + '<p class="es-p-meta"><span class="es-p-id tnum">ID ' + esc(String(p.id)) + '</span>'
        + '<span class="es-p-price">' + amountHtml(p.price, p) + '</span></p>'
        + (p.text ? '<p class="es-p-desc">' + esc(p.text.slice(0, 480)) + '</p>' : '')
        + '</article>';
}

export async function findProduct(rawId) {
    const el = $('eshop-product-result');
    if (!el) return;
    const id = Math.trunc(Number(rawId));
    if (!Number.isFinite(id) || id <= 0) {
        renderEmptyState(el, 'error_outline', 'Zadaj číselné ID produktu', 'Napríklad 22.');
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
        renderProblem(el, e, () => findProduct(id));
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


/* ---------- vykreslenie celej obrazovky ---------- */

let busyRender = false;

export async function renderEshop() {
    if (!$('eshop-status') && !$('eshop-kpi') && !$('eshop-orders')) return;
    if (busyRender) return;
    busyRender = true;
    try {
        renderStatus('wait');
        const kpi = $('eshop-kpi');
        const days = $('eshop-days');
        const countries = $('eshop-countries');
        if (kpi) kpi.innerHTML = listSkeletonHtml(1, '84px');
        if (days) days.innerHTML = '';
        if (countries) countries.innerHTML = listSkeletonHtml(3, '52px');

        const [healthRes, sumRes] = await Promise.allSettled([
            apiGet('/api/eshop/health', { retry: 0 }),
            apiGet('/api/eshop/summary'),
        ]);

        const h = healthRes.status === 'fulfilled' ? normalizeHealth(healthRes.value) : null;
        renderStatus(h && h.ok ? 'ok' : 'down', healthRes.reason, h);
        stampChecked();

        if (sumRes.status === 'fulfilled') {
            const s = normalizeSummary(sumRes.value);
            renderKpi(s, h);
            renderDays(s);
            renderCountries(s);
        } else {
            renderProblem(kpi, sumRes.reason, renderEshop);
            if (countries) countries.innerHTML = '';
        }
    } finally {
        busyRender = false;
    }
    await renderOrders(1);
}


let subscribed = false;

export function register(root) {
    const host = root && root.querySelector ? root.querySelector('#screen-eshop') : null;
    if (!host) return;

    const refresh = host.querySelector('#eshop-refresh');
    if (refresh) refresh.onclick = () => renderEshop();

    const form = host.querySelector('#eshop-product-form');
    const input = host.querySelector('#eshop-product-id');
    if (form) {
        form.onsubmit = (e) => {
            e.preventDefault();
            findProduct(input ? input.value : '');
        };
    }

    if (!subscribed) {
        subscribed = true;
        bus.on(EV.SCREEN_CHANGED, (p) => { if (p && p.to === 'eshop') renderEshop(); });
    }
}
