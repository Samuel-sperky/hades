/* Obrazovka E-shop — živé dáta zo SPERKY API (sperky-eshop.sk) cez `api/eshop/*`.

   Anatómia (vzor screens/library.js): page-head (blade) → toolbar + prepínač
   okna → stav integrácie → KPI počty → obrat po menách → objednávky po dňoch →
   krajiny → filtre + posledné objednávky → hľadanie produktu podľa id.
   Skeleton/empty/error stavy sú zo `shared/anatomy.js`; render jednotlivých
   sekcií žije v `eshop/{summary,orders,product,filters}.js`, dátová vrstva
   v `eshop/data.js` (tam sú rozpísané aj obmedzenia z v2 špecifikácie).

   Zhrnutie povinných obmedzení z refactor-auraai/08b-SPERKY-API-SPEC-V2.md:
     R1  `currency` (ISO) je v zozname aj v detaile → mena je autoritatívna,
         mapovanie krajina→mena aj značka „odhad" sú zmazané (rozhodnutie 7).
     R2  Obrat je samostatná sekcia s jedným riadkom na menu (rozhodnutie 1).
         HLAVNÉ KPI ZOSTÁVAJÚ POČTY. ZAKÁZANÉ: jedno číslo, ktoré sčíta sumy
         v rôznych menách, a akýkoľvek prepočet na EUR.
     R3  `date_from` / `date_to` / `country` / `total_min` fungujú → okno je
         v UI (7 / 30 / 90 dní), filter sumy len s krajinou (rozhodnutie 8).
     R4  `attributes` sa vracia → varianty vrátane zásoby (rozhodnutie 4).
     R6  HTTP status nie je zdroj pravdy — health vracia 200 aj keď je e-shop
         mimo, takže sa číta `ok` v tele.
     R7  všetky čísla vždy z API — chýbajúce je „—", nikdy dopočítaná nula.

   Keď je API nedostupné, obrazovka to povie a nespadne. */

import { apiGet } from '../core/api.js';
import { bus } from '../core/bus.js';
import { $, esc } from '../core/dom.js';
import { EV } from '../core/events.js';
import { listSkeletonHtml, renderApiError, renderEmptyState } from './shared/anatomy.js';
import { errCode, normalizeHealth, normalizeSummary, reasonForCode } from './eshop/data.js';
import { filters, renderFilters, renderWindow, setCountries } from './eshop/filters.js';
import { renderCountries, renderDays, renderKpi, renderRevenue } from './eshop/summary.js';
import * as orders from './eshop/orders.js';
import * as product from './eshop/product.js';

export { findProduct } from './eshop/product.js';
export { renderOrders } from './eshop/orders.js';


/* ---------- chybové stavy ---------- */

/* 501 nie je porucha, ale „backend ešte nie je zapojený". Vlastná hláška preto,
   že describeApiError() by pre 5xx povedal len „Server vrátil chybu". */
export function renderProblem(host, err, retry) {
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

orders.setProblemRenderer(renderProblem);
product.setProblemRenderer(renderProblem);


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


/* ---------- vykreslenie celej obrazovky ---------- */

let busyRender = false;

export async function renderEshop() {
    if (!$('eshop-status') && !$('eshop-kpi') && !$('eshop-orders')) return;
    if (busyRender) return;
    busyRender = true;
    const kpi = $('eshop-kpi');
    const revenue = $('eshop-revenue');
    const days = $('eshop-days');
    const countries = $('eshop-countries');
    try {
        renderStatus('wait');
        renderWindow($('eshop-window'), () => renderEshop());
        if (kpi) kpi.innerHTML = listSkeletonHtml(1, '84px');
        if (revenue) revenue.innerHTML = listSkeletonHtml(2, '30px');
        if (days) days.innerHTML = '';
        if (countries) countries.innerHTML = '';

        const [healthRes, sumRes] = await Promise.allSettled([
            apiGet('/api/eshop/health', { retry: 0 }),
            apiGet('/api/eshop/summary', { query: { days: filters.days } }),
        ]);

        const h = healthRes.status === 'fulfilled' ? normalizeHealth(healthRes.value) : null;
        renderStatus(h && h.ok ? 'ok' : 'down', healthRes.reason, h);
        stampChecked();

        if (sumRes.status === 'fulfilled') {
            const s = normalizeSummary(sumRes.value);
            setCountries(s.countries);
            renderKpi(kpi, s, h);
            renderRevenue(revenue, s);
            renderDays(days, s);
            renderCountries(countries, s);
        } else {
            renderProblem(kpi, sumRes.reason, renderEshop);
            if (revenue) revenue.innerHTML = '';
            setCountries([]);
        }
        renderFilters($('eshop-filters'), () => orders.renderOrders(1));
    } finally {
        busyRender = false;
    }
    await orders.renderOrders(1);
}


let subscribed = false;

export function register(root) {
    const host = root && root.querySelector ? root.querySelector('#screen-eshop') : null;
    if (!host) return;

    const refresh = host.querySelector('#eshop-refresh');
    if (refresh) refresh.onclick = () => renderEshop();

    renderWindow(host.querySelector('#eshop-window'), () => renderEshop());
    renderFilters(host.querySelector('#eshop-filters'), () => orders.renderOrders(1));

    const form = host.querySelector('#eshop-product-form');
    const input = host.querySelector('#eshop-product-id');
    if (form) {
        form.onsubmit = (e) => {
            e.preventDefault();
            product.findProduct(input ? input.value : '');
        };
    }

    if (!subscribed) {
        subscribed = true;
        bus.on(EV.SCREEN_CHANGED, (p) => { if (p && p.to === 'eshop') renderEshop(); });
    }
}
