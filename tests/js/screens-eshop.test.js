import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bus } from '../../resources/js/core/bus.js';
import { EV } from '../../resources/js/core/events.js';
import { findProduct, register, renderEshop } from '../../resources/js/screens/eshop.js';
import {
    amountHtml, coveredDays, currencyForCountry, fmtCount, normalizeCountries, normalizeHealth,
    normalizeOrders, normalizeProduct, normalizeSummary,
} from '../../resources/js/screens/eshop/data.js';

/* Obrazovka E-shop (balík P11, agent SPERKY-FE).

   Najdôležitejšie testy tohto súboru NIE SÚ o vykreslení, ale o nálezoch z
   overenia proti živej produkcii (refactor-auraai/08-SPERKY-API-SPEC.md):

   N1  `total_paid` je v mene objednávky, ale API menu nevracia → obrazovka nesmie
       nikde ukázať jedno súhrnné číslo obratu ani prepočet na EUR, a pri každej
       sume musí byť vidieť menu + to, že je odhadnutá. Testy „nikde jeden obrat"
       a „mena pri každej sume" sú brána; keby ich niekto zmazal, vlna 3 nájde
       obrazovku, ktorá lže o peniazoch.
   N2  varianty produktu API nevracia → nesmú sa zobraziť, ani keď ich odpoveď
       (v rozpore s realitou) obsahuje.
   N3/N5  okno sa skenuje so stropom requestov → neúplný sken sa musí priznať,
       nesmie sa tváriť ako presné číslo.
   N6  HTTP 200 s `ok:false` je chyba → indikátor musí ukázať nedostupnosť.
   N7  chýbajúce číslo je „—", nikdy dopočítaná nula.

   Telá odpovedí sú odpísané z reálneho EshopController-a (obálka `{ok,data,meta}`,
   `currency_estimate` + `currency_is_estimate`, `orders.total_in_shop`), nie
   vymyslené. Markup sa načítava z reálneho blade súboru, takže preklep v `id`
   položí test a nie až prehliadač. */

const MARKUP = readFileSync(
    resolve(process.cwd(), 'resources/views/partials/screens/eshop.blade.php'), 'utf8',
).replace(/\{\{--[\s\S]*?--\}\}/g, '');

/* ---------- fake fetch nad zamknutým core/api.js ---------- */

const res = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

let routes = [];

/* Neskorší zápis prebíja skorší, aby si test vedel prepísať jednu cestu
   z happyPath() bez toho, aby ju celú prestavoval. */
function route(pattern, factory) { routes.unshift([pattern, factory]); }

function installFetch() {
    routes = [];
    global.fetch = vi.fn(async (url) => {
        const path = String(url);
        for (const [pattern, factory] of routes) if (pattern.test(path)) return factory(path);
        throw new Error('neošetrená cesta v teste: ' + path);
    });
}

const HEALTH = /^\/api\/eshop\/health/;
const SUMMARY = /^\/api\/eshop\/summary/;
const ORDER = /^\/api\/eshop\/orders\/\d+/;
const ORDERS = /^\/api\/eshop\/orders(\?|$)/;
const PRODUCT = /^\/api\/eshop\/products\/\d+/;

const ok = (data) => ({ ok: true, data, meta: { cached: false, source: 'sperky' } });
const failBody = (code, message) => ({ ok: false, data: null, error: { code, message } });

const HEALTH_BODY = ok({
    ok: true, orders: true, products: true, error: null, latency_ms: 825,
    checked_at: '2026-07-30T15:14:48+02:00',
    totals: { orders: 1763914, products: 41018 }, key_configured: true,
});

/* Sumy sú zvolené tak, aby ich súčet (23 250) bol v DOM nezameniteľný —
   keby ho niekto vykreslil, test „nikde jeden obrat" ho nájde. */
const COUNTRIES = [
    { country_iso: 'SK', country: 'Slovensko', orders: 61, total_paid: 250, currency_estimate: 'EUR', currency_is_estimate: true },
    { country_iso: 'HU', country: 'Maďarsko', orders: 22, total_paid: 20000, currency_estimate: 'HUF', currency_is_estimate: true },
    { country_iso: 'CZ', country: 'Česká republika', orders: 17, total_paid: 3000, currency_estimate: 'CZK', currency_is_estimate: true },
];

const SUMMARY_BODY = ok({
    generated_at: '2026-07-30T15:14:50+02:00',
    window: { days: 7, from: '2026-07-24', until: '2026-07-31' },
    orders: { in_window: 800, today: 123, complete: true, total_in_shop: 1763914 },
    by_day: [
        { date: '2026-07-28', orders: 220 },
        { date: '2026-07-29', orders: 224 },
        { date: '2026-07-30', orders: 123 },
    ],
    countries: COUNTRIES,
    countries_meta: { basis: 'sample', sample_size: 100, currency_is_estimate: true, note: 'Rozpad je zo vzorky detailov.' },
    months: [],
    live: { available: true, stopped_by: null },
    scan: { stopped_by: null, complete: true, requests: 8 },
});

const ORDERS_BODY = ok({
    orders: [
        { id: 1763927, date_add: '2026-07-30 15:11:14', total_paid: 1169, total_paid_raw: '1169' },
        { id: 1763926, date_add: '2026-07-30 14:52:25', total_paid: 33.4, total_paid_raw: '33.4' },
    ],
    page: 1, per_page: 20, total: 1763914, count: 2, sorted_by: 'id_desc',
});

const ORDER_BODY = ok({
    order: {
        id: 1763927, date_add: '2026-07-30 15:11:14', total_paid: 1169,
        country: 'Maďarsko', country_iso: 'HU',
        currency_estimate: 'HUF', currency_is_estimate: true, product_ids: [22, 23],
    },
});

const PRODUCT_BODY = ok({
    product: {
        id: 22, name: 'Náramok z chirurgickej ocele', price: 20.666667,
        description: '<h3>Dlhý popis</h3>', description_short: '<p>Ocelový <b>náramok</b></p>',
    },
});

function happyPath() {
    route(HEALTH, () => res(200, HEALTH_BODY));
    route(SUMMARY, () => res(200, SUMMARY_BODY));
    route(ORDER, () => res(200, ORDER_BODY));
    route(ORDERS, () => res(200, ORDERS_BODY));
    route(PRODUCT, () => res(200, PRODUCT_BODY));
}

const bodyText = () => document.body.textContent || '';
const tight = () => bodyText().replace(/\s/g, '');

beforeEach(() => {
    document.body.innerHTML = MARKUP;
    installFetch();
});


/* ================= čisté helpery ================= */

describe('mena (nález N1)', () => {
    it('odhaduje menu z krajiny podľa zmeranej vzorky', () => {
        expect(currencyForCountry('HU')).toBe('HUF');
        expect(currencyForCountry('cz')).toBe('CZK');
        expect(currencyForCountry('SK')).toBe('EUR');
        expect(currencyForCountry('SI')).toBe('EUR');
    });

    it('neznámu krajinu NEHÁDA', () => {
        expect(currencyForCountry('DE')).toBeNull();
        expect(currencyForCountry('')).toBeNull();
        expect(currencyForCountry(null)).toBeNull();
    });

    it('suma vždy nesie menu a pri odhade aj značku „odhad"', () => {
        const hu = amountHtml(11215, { iso: 'HU' });
        expect(hu).toContain('HUF');
        expect(hu).toContain('odhad');
        expect(hu).not.toContain('EUR');
    });

    it('mena z API bez príznaku odhadu sa neznačí ako odhad', () => {
        const h = amountHtml(14.85, { currency: 'eur' });
        expect(h).toContain('EUR');
        expect(h).not.toContain('odhad');
    });

    it('currency_is_estimate prebíja pole currency — odhad zostáva odhadom', () => {
        const c = normalizeCountries([{ country_iso: 'SK', orders: 1, total_paid: 5, currency: 'EUR', currency_is_estimate: true }]);
        expect(c[0].currency).toBeNull();
        expect(c[0].currencyEstimate).toBe('EUR');
        expect(amountHtml(5, c[0])).toContain('odhad');
    });

    it('bez krajiny a bez meny to prizná, nedomýšľa EUR', () => {
        const h = amountHtml(999);
        expect(h).toContain('mena neuvedená');
        expect(h).not.toContain('EUR');
    });

    it('chýbajúca suma je „—", nie nula (nález N7)', () => {
        expect(amountHtml(null)).toContain('—');
        expect(amountHtml(null)).not.toContain('0');
        expect(amountHtml(undefined)).toContain('es-amount--na');
    });

    it('nikdy nevykreslí symbol meny — ten by zamlčal odhad', () => {
        for (const h of [amountHtml(1, { iso: 'SK' }), amountHtml(1, { iso: 'HU' }), amountHtml(1)]) {
            expect(h).not.toContain('€');
        }
    });
});


describe('fmtCount (nález N7)', () => {
    it('chýbajúce číslo je „—", nie nula', () => {
        expect(fmtCount(null)).toBe('—');
        expect(fmtCount(undefined)).toBe('—');
        expect(fmtCount('')).toBe('—');
        expect(fmtCount(0)).not.toBe('—');
    });
});


describe('normalizácia odpovedí', () => {
    it('súhrn vytiahne počty z obálky {ok,data} a orders.total_in_shop', () => {
        const s = normalizeSummary(SUMMARY_BODY);
        expect(s.ordersTotal).toBe(1763914);
        expect(s.ordersDay).toBe(123);
        expect(s.ordersWindow).toBe(800);
        expect(s.windowDays).toBe(7);
        expect(s.complete).toBe(true);
        expect(s.countries.map((c) => c.iso)).toEqual(['SK', 'HU', 'CZ']);
    });

    it('súhrn NEOBSAHUJE žiadne agregované pole obratu', () => {
        const s = normalizeSummary({ ok: true, data: { ...SUMMARY_BODY.data, revenue_total: 999999 } });
        expect(Object.keys(s)).toEqual(['ordersTotal', 'ordersDay', 'ordersWindow', 'windowDays',
            'complete', 'productsTotal', 'countries', 'countriesFrom', 'countriesNote', 'byDay']);
        expect(JSON.stringify(s)).not.toContain('999999');
    });

    it('neúplný sken je označený', () => {
        const s = normalizeSummary(ok({ orders: { in_window: 800, today: 12, complete: false, total_in_shop: 9 } }));
        expect(s.complete).toBe(false);
    });

    it('znesie plochý tvar aj chýbajúce polia', () => {
        expect(normalizeSummary({ counts: { total: 5 } }).ordersTotal).toBe(5);
        expect(normalizeSummary({}).ordersTotal).toBeNull();
        expect(normalizeSummary(null).countries).toEqual([]);
        expect(normalizeSummary(null).byDay).toEqual([]);
    });

    it('krajiny prijme aj ako mapu iso → počet', () => {
        expect(normalizeCountries({ SK: 3, HU: 9 }).map((c) => [c.iso, c.orders]))
            .toEqual([['HU', 9], ['SK', 3]]);
    });

    it('keď živé krajiny chýbajú, vezme ich z mesačného súhrnu', () => {
        const s = normalizeSummary(ok({
            countries: [],
            countries_meta: { note: 'nič' },
            months: [{ month: '2026-06', label: 'E-shop jún 2026', countries: COUNTRIES }],
        }));
        expect(s.countries).toHaveLength(3);
        expect(s.countriesFrom).toBe('E-shop jún 2026');
        expect(s.countries[0].currencyEstimate).toBe('EUR');
    });

    it('objednávky znesie obálku, plochý zoznam aj prázdno', () => {
        expect(normalizeOrders(ORDERS_BODY).orders).toHaveLength(2);
        expect(normalizeOrders(ORDERS_BODY).total).toBe(1763914);
        expect(normalizeOrders({ data: [{ id: 1 }] }).orders[0].id).toBe(1);
        expect(normalizeOrders(null).orders).toEqual([]);
        expect(normalizeOrders({}).page).toBe(1);
    });

    it('produkt sa vylúpne z dvojitej obálky data.product', () => {
        expect(normalizeProduct(PRODUCT_BODY).id).toBe(22);
        expect(normalizeProduct(PRODUCT_BODY).price).toBe(20.666667);
    });

    it('produkt NEČÍTA attributes ani has_attributes (nález N2)', () => {
        const p = normalizeProduct({
            id: 22, name: 'X', price: 1, has_attributes: true,
            attributes: [{ id: 1, name: 'Veľkosť' }],
        });
        expect(Object.keys(p)).toEqual(['id', 'name', 'price', 'currency', 'currencyEstimate', 'text']);
        expect(JSON.stringify(p)).not.toContain('Veľkosť');
    });

    it('popis produktu je zbavený HTML značiek', () => {
        expect(normalizeProduct({ id: 1, description_short: '<p>a <b>b</b></p>' }).text).toBe('a b');
    });

    it('odpoveď bez id nie je produkt', () => {
        expect(normalizeProduct(failBody('not_found', 'Produkt sa nenašiel.'))).toBeNull();
        expect(normalizeProduct(null)).toBeNull();
    });

    it('health hlási objednávky a katalóg oddelene', () => {
        const h = normalizeHealth(HEALTH_BODY);
        expect(h.ok).toBe(true);
        expect(h.totalProducts).toBe(41018);
        const down = normalizeHealth(ok({ ok: false, orders: false, products: true, error: 'forbidden', key_configured: false }));
        expect(down.ok).toBe(false);
        expect(down.products).toBe(true);
        expect(down.keyConfigured).toBe(false);
        expect(down.code).toBe('forbidden');
    });
});


/* ================= vykreslenie: úspešná odpoveď ================= */

describe('render — úspešná odpoveď', () => {
    beforeEach(async () => {
        happyPath();
        await renderEshop();
    });

    it('indikátor dostupnosti povie, že e-shop odpovedá', () => {
        const st = document.querySelector('#eshop-status .es-status');
        expect(st.classList.contains('es-status--ok')).toBe(true);
        expect(st.textContent).toContain('E-shop odpovedá');
    });

    it('hlavné číslo je POČET objednávok, nie obrat (nález N1)', () => {
        const hero = document.querySelector('#eshop-kpi .kpi-hero');
        expect(hero.textContent).toContain('Objednávok v e-shope');
        expect(hero.querySelector('.kpi-val').textContent.replace(/\s/g, '')).toContain('1763914');
        expect(hero.querySelector('.es-amount')).toBeNull();
    });

    it('KPI pás nesie len počty — žiadna KPI karta neobsahuje sumu', () => {
        const cards = [...document.querySelectorAll('#eshop-kpi .kpi-card')];
        expect(cards).toHaveLength(4);
        expect(cards.some((c) => c.querySelector('.es-amount'))).toBe(false);
        expect(document.querySelector('#eshop-kpi').textContent).not.toMatch(/obrat/i);
    });

    it('okno má popisku z API (days), nie zo konštanty (nález N7)', () => {
        expect(document.querySelector('#eshop-kpi').textContent).toContain('Objednávky za 7 dní');
    });

    it('objednávky po dňoch sú počty, bez súm', () => {
        const rows = [...document.querySelectorAll('#eshop-days .es-bar')];
        expect(rows).toHaveLength(3);
        expect(rows[2].querySelector('.db-n').textContent).toBe('123');
        expect(document.querySelector('#eshop-days .es-amount')).toBeNull();
    });

    it('rozpad podľa krajín je podľa počtu objednávok', () => {
        const rows = [...document.querySelectorAll('#eshop-countries .es-bar')];
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector('.db-name').textContent).toBe('Slovensko (SK)');
        expect(rows[0].querySelector('.db-n').textContent).toBe('61');
    });

    it('každá krajinová suma nesie odhadnutú menu podľa country_iso', () => {
        const sums = [...document.querySelectorAll('#eshop-countries .es-country-sum')];
        expect(sums.map((s) => s.querySelector('.es-cur').textContent)).toEqual(['EUR', 'HUF', 'CZK']);
        expect(sums.every((s) => s.querySelector('.es-est'))).toBe(true);
    });

    it('sumy sú presne z API — žiadny prepočet na jednu menu', () => {
        const sums = [...document.querySelectorAll('#eshop-countries .es-country-sum .es-sum')];
        expect(sums.map((s) => s.textContent.replace(/\s/g, ''))).toEqual(['250', '20000', '3000']);
    });

    it('nad rozpadom je priznanie, že mena je odhad', () => {
        const note = document.querySelector('#eshop-countries .es-note--warn');
        expect(note.textContent).toContain('API menu nevracia');
        expect(note.textContent).toContain('neprepočítavame');
    });

    it('posledné objednávky nesú id, dátum a sumu', () => {
        const rows = [...document.querySelectorAll('#eshop-orders .es-order')];
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.es-o-id').textContent).toBe('#1763927');
        expect(rows[0].querySelector('.es-o-date').textContent).toContain('2026');
        expect(rows[0].querySelector('.es-amount')).not.toBeNull();
    });

    it('zoznam objednávok bez country_iso priznáva neznámu menu, nedomýšľa EUR', () => {
        for (const r of document.querySelectorAll('#eshop-orders .es-order')) {
            expect(r.querySelector('.es-cur--unknown')).not.toBeNull();
            expect(r.textContent).toContain('mena neuvedená');
        }
    });

    it('stránkovanie ide od najnovších (nález N4)', () => {
        expect(document.querySelector('#eshop-prev').disabled).toBe(true);
        expect(document.querySelector('#eshop-next').disabled).toBe(false);
        const t = document.querySelector('#eshop-orders').textContent;
        expect(t).toContain('Novšie');
        expect(t).toContain('Staršie');
    });

    it('detail objednávky doplní krajinu a odhadnutú menu', async () => {
        const row = document.querySelector('#eshop-orders .es-order');
        await row.onclick();
        const det = document.querySelector('#eshop-order-detail .es-detail');
        expect(row.getAttribute('aria-expanded')).toBe('true');
        expect(det.textContent).toContain('Maďarsko (HU)');
        expect(det.querySelector('.es-cur').textContent).toBe('HUF');
        expect(det.querySelector('.es-est')).not.toBeNull();
        expect(det.querySelector('.es-pids').textContent).toBe('22, 23');
    });

    it('druhý klik detail zavrie', async () => {
        const row = document.querySelector('#eshop-orders .es-order');
        await row.onclick();
        await row.onclick();
        expect(document.querySelector('#eshop-order-detail').innerHTML).toBe('');
        expect(row.getAttribute('aria-expanded')).toBe('false');
    });
});


/* ================= N1: nikde jeden súhrnný obrat ================= */

describe('nález N1 — obrazovka nikde nezobrazí jeden súhrnný obrat', () => {
    beforeEach(async () => {
        happyPath();
        await renderEshop();
    });

    it('súčet krajinových súm (23 250) sa v DOM nevyskytuje', () => {
        expect(tight()).not.toContain('23250');
        expect(bodyText()).not.toContain('23 250');
    });

    it('nikde nie je slovo „obrat" ako jedno číslo ani symbol €', () => {
        expect(bodyText()).not.toContain('€');
        expect(bodyText()).not.toMatch(/celkov[ýá]\s+obrat/i);
        expect(bodyText()).not.toMatch(/obrat\s+celkom/i);
        expect(bodyText()).not.toMatch(/prepočítan/i);
    });

    it('každá vykreslená suma má menu — žiadne osamotené peňažné číslo', () => {
        const amounts = [...document.querySelectorAll('.es-amount:not(.es-amount--na)')];
        expect(amounts.length).toBeGreaterThan(0);
        for (const a of amounts) expect(a.querySelector('.es-cur')).not.toBeNull();
    });

    it('počet peňažných hodnôt = 3 krajiny + 2 objednávky, žiadna navyše', () => {
        expect(document.querySelectorAll('.es-amount').length).toBe(5);
    });

    it('miešané meny sa nikdy nezlúčia do jednej', () => {
        const codes = [...document.querySelectorAll('#eshop-countries .es-cur')].map((e) => e.textContent);
        expect(new Set(codes).size).toBe(3);
    });
});


describe('nález N1/N2 — zdrojový kód obrazovky', () => {
    /* Komentáre sa odstraňujú — o nálezoch sa v nich písať MUSÍ, porušením
       kontraktu je až kód. Rovnaký prístup ako css-tokens.test.js. */
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const src = ['resources/js/screens/eshop.js', 'resources/js/screens/eshop/data.js']
        .map((p) => stripComments(readFileSync(resolve(process.cwd(), p), 'utf8')));

    it('nepoužíva symbol meny (vždy len ISO kód)', () => {
        for (const s of src) expect(s).not.toContain('€');
    });

    it('nečíta attributes ani has_attributes (nález N2)', () => {
        for (const s of src) expect(s).not.toMatch(/attributes/);
    });

    it('neobsahuje kurzový prepočet', () => {
        for (const s of src) expect(s).not.toMatch(/exchange|kurz|toEur|convertTo/i);
    });

    it('peňažná hodnota má jediné miesto vykreslenia — amountHtml()', () => {
        expect(src.join('\n').split('es-sum').length - 1).toBe(1);
    });
});


/* ================= neúplný sken (nálezy N3/N5) ================= */

describe('neúplný sken sa prizná', () => {
    beforeEach(async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({
            ...SUMMARY_BODY.data,
            orders: { in_window: 800, today: 123, complete: false, total_in_shop: 1763914 },
            scan: { stopped_by: 'max_requests', complete: false, requests: 8 },
        })));
        await renderEshop();
    });

    it('počet za okno je označený ako dolná hranica', () => {
        expect(document.querySelector('#eshop-kpi').textContent).toContain('≥');
    });

    it('pod KPI je vysvetlenie, že sken sa zastavil na strope', () => {
        expect(document.querySelector('#eshop-kpi .es-note').textContent).toContain('dolná hranica');
    });

    it('sekcia dní to zopakuje v poznámke', () => {
        expect(document.querySelector('#eshop-days .sec-note').textContent).toBe('dolná hranica');
    });

    it('celkový počet v e-shope zostáva presný — je priamo z API', () => {
        expect(document.querySelector('#eshop-kpi .kpi-hero').textContent).not.toContain('≥');
    });
});


describe('coveredDays — nescanovaný deň nie je nula', () => {
    const rows = [
        { date: '2026-07-24', orders: 0 },
        { date: '2026-07-25', orders: 0 },
        { date: '2026-07-26', orders: 231 },
        { date: '2026-07-27', orders: 0 },
        { date: '2026-07-28', orders: 220 },
    ];

    it('pri úplnom skene sú nuly skutočné a zostávajú', () => {
        expect(coveredDays({ byDay: rows, complete: true })).toHaveLength(5);
    });

    it('pri neúplnom skene zahodí len úvodné (najstaršie) nuly', () => {
        const out = coveredDays({ byDay: rows, complete: false });
        expect(out.map((r) => r.date)).toEqual(['2026-07-26', '2026-07-27', '2026-07-28']);
    });

    it('keď sken nenašiel nič, sekcia sa nevykreslí', () => {
        expect(coveredDays({ byDay: [{ date: 'x', orders: 0 }], complete: false })).toEqual([]);
        expect(coveredDays(null)).toEqual([]);
    });

    it('v DOM sa nevykreslia dni, ku ktorým sken nedošiel', async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({
            ...SUMMARY_BODY.data,
            orders: { in_window: 800, today: 123, complete: false, total_in_shop: 1763914 },
            by_day: [{ date: '2026-07-24', orders: 0 }, { date: '2026-07-29', orders: 224 }],
        })));
        await renderEshop();
        const bars = [...document.querySelectorAll('#eshop-days .es-bar')];
        expect(bars).toHaveLength(1);
        expect(bars[0].querySelector('.db-n').textContent).toBe('224');
    });
});


/* ================= prázdne stavy ================= */

describe('prázdne stavy', () => {
    it('prázdny zoznam objednávok má zmysluplný prázdny stav', async () => {
        happyPath();
        route(ORDERS, () => res(200, ok({ page: 1, total: 0, orders: [] })));
        await renderEshop();
        expect(document.querySelector('#eshop-orders .empty-state').textContent)
            .toContain('Žiadne objednávky');
        expect(document.querySelectorAll('#eshop-orders .es-order')).toHaveLength(0);
    });

    it('chýbajúci rozpad krajín vysvetlí, prečo tam nie je', async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({
            ...SUMMARY_BODY.data, countries: [],
            countries_meta: { note: 'Rozpad podľa krajín je v mesačných súhrnoch.' },
        })));
        await renderEshop();
        expect(document.querySelector('#eshop-countries .empty-state').textContent)
            .toContain('mesačných súhrnoch');
        expect(document.querySelector('#eshop-kpi .kpi-hero')).not.toBeNull();
    });

    it('chýbajúce počty sú „—", nie vymyslené nuly (nález N7)', async () => {
        happyPath();
        route(HEALTH, () => res(200, ok({ ok: true, orders: true, products: true, key_configured: true })));
        route(SUMMARY, () => res(200, ok({ countries: [] })));
        await renderEshop();
        const vals = [...document.querySelectorAll('#eshop-kpi .kpi-val')].map((v) => v.textContent);
        expect(vals.every((v) => v.includes('—'))).toBe(true);
    });

    it('prázdne by_day nevykreslí prázdnu sekciu', async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({ ...SUMMARY_BODY.data, by_day: [] })));
        await renderEshop();
        expect(document.querySelector('#eshop-days').innerHTML).toBe('');
    });
});


/* ================= chybové stavy ================= */

describe('chybové stavy — appka nespadne a povie to', () => {
    it('501 (backend ešte nie je hotový) povie stav aj v sekciách', async () => {
        route(HEALTH, () => res(501, failBody('not_implemented', 'x')));
        route(SUMMARY, () => res(501, failBody('not_implemented', 'x')));
        route(ORDERS, () => res(501, failBody('not_implemented', 'x')));
        await renderEshop();

        const st = document.querySelector('#eshop-status .es-status');
        expect(st.classList.contains('es-status--down')).toBe(true);
        expect(st.textContent).toContain('501');
        expect(st.textContent).toContain('Obrazovka beží ďalej');
        expect(document.querySelector('#eshop-kpi .empty-state').textContent)
            .toContain('Serverová časť integrácie');
        expect(document.querySelector('#eshop-orders .empty-state')).not.toBeNull();
        expect(document.querySelector('#screen-eshop')).not.toBeNull();
    });

    it('500 vykreslí chybový stav s možnosťou skúsiť znova', async () => {
        route(HEALTH, () => res(500, failBody('server', 'x')));
        route(SUMMARY, () => res(500, failBody('server', 'x')));
        route(ORDERS, () => res(500, failBody('server', 'x')));
        await renderEshop();
        expect(document.querySelector('#eshop-status .es-status--down')).not.toBeNull();
        expect(document.querySelector('#eshop-orders .empty-act')).not.toBeNull();
    });

    it('HTTP 200 s ok:false je nedostupnosť (nález N6)', async () => {
        happyPath();
        route(HEALTH, () => res(200, ok({
            ok: false, orders: false, products: true, error: 'forbidden', key_configured: true,
        })));
        await renderEshop();
        const st = document.querySelector('#eshop-status .es-status');
        expect(st.classList.contains('es-status--down')).toBe(true);
        expect(st.textContent).toContain('Katalóg produktov odpovedá, objednávky nie');
        // Súhrn dorazil, takže čísla sú aj tak vykreslené — obrazovka nie je prázdna.
        expect(document.querySelector('#eshop-kpi .kpi-hero')).not.toBeNull();
    });

    it('nenastavený kľúč integrácie je vysvetlený, nie zamlčaný', async () => {
        happyPath();
        route(HEALTH, () => res(200, ok({
            ok: false, orders: false, products: true, error: 'unconfigured', key_configured: false,
        })));
        await renderEshop();
        const st = document.querySelector('#eshop-status').textContent;
        expect(st).toContain('Kľúč integrácie nie je nastavený');
        expect(st).toContain('Katalóg produktov funguje aj bez neho');
    });

    it('neznámy text chyby zo servera sa do UI nedostane', async () => {
        happyPath();
        route(HEALTH, () => res(200, ok({ ok: false, error: 'niECo-veLmi-taJne-123', key_configured: true })));
        await renderEshop();
        expect(bodyText()).not.toContain('niECo-veLmi-taJne-123');
        expect(document.querySelector('#eshop-status').textContent).toContain('Skontroluj');
    });

    it('padnutý súhrn nezhodí zoznam objednávok', async () => {
        happyPath();
        route(SUMMARY, () => res(503, failBody('unavailable', 'x')));
        await renderEshop();
        expect(document.querySelectorAll('#eshop-orders .es-order')).toHaveLength(2);
        expect(document.querySelector('#eshop-kpi .empty-state')).not.toBeNull();
    });
});


/* ================= produkt podľa id ================= */

describe('produkt podľa id', () => {
    beforeEach(() => { happyPath(); });

    it('vykreslí názov, cenu a popis', async () => {
        await findProduct('22');
        const card = document.querySelector('#eshop-product-result .es-pcard');
        expect(card.querySelector('.es-p-name').textContent).toBe('Náramok z chirurgickej ocele');
        expect(card.querySelector('.es-p-desc').textContent).toBe('Ocelový náramok');
        expect(card.querySelector('.es-p-id').textContent).toBe('ID 22');
        expect(card.querySelector('.es-p-price .es-sum').textContent).toContain('20,67');
    });

    it('NEZOBRAZÍ varianty, ani keď ich odpoveď obsahuje (nález N2)', async () => {
        route(PRODUCT, () => res(200, ok({
            product: {
                id: 22, name: 'Náramok', price: 12.5, has_attributes: true,
                attributes: [{ id: 7, name: 'Veľkosť', value: 'M' }],
            },
        })));
        await findProduct(22);
        const html = document.querySelector('#eshop-product-result').innerHTML;
        expect(html).not.toContain('Veľkosť');
        expect(html).not.toMatch(/variant/i);
        expect(html).not.toContain('attributes');
        expect(document.querySelector('#eshop-product-result .es-p-name')).not.toBeNull();
    });

    it('cena bez meny v odpovedi to prizná', async () => {
        await findProduct(22);
        expect(document.querySelector('.es-p-price .es-cur--unknown')).not.toBeNull();
    });

    it('neexistujúce id je doménový stav, nie výnimka', async () => {
        route(PRODUCT, () => res(404, failBody('not_found', 'Produkt sa nenašiel.')));
        await findProduct(999999);
        expect(document.querySelector('#eshop-product-result .empty-state').textContent)
            .toContain('neexistuje');
    });

    it('nečíselný vstup nevolá API', async () => {
        await findProduct('abc');
        expect(global.fetch).not.toHaveBeenCalled();
        expect(document.querySelector('#eshop-product-result').textContent)
            .toContain('Zadaj číselné ID');
    });

    it('HTML v popise sa nevykreslí ako značky (XSS)', async () => {
        route(PRODUCT, () => res(200, ok({
            product: {
                id: 5, name: '<img src=x onerror=alert(1)>', price: 1,
                description_short: '<script>alert(2)</script>zlý popis',
            },
        })));
        await findProduct(5);
        const host = document.querySelector('#eshop-product-result');
        expect(host.querySelector('img')).toBeNull();
        expect(host.querySelector('script')).toBeNull();
        expect(host.textContent).toContain('zlý popis');
    });
});


/* ================= zapojenie a a11y ================= */

describe('register a a11y', () => {
    it('formulár produktu volá hľadanie a nereloaduje stránku', async () => {
        happyPath();
        register(document.body);
        document.querySelector('#eshop-product-id').value = '22';
        const ev = new window.Event('submit', { cancelable: true });
        document.querySelector('#eshop-product-form').dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        await vi.waitFor(() => {
            expect(document.querySelector('#eshop-product-result .es-pcard')).not.toBeNull();
        });
    });

    it('prepnutie na obrazovku e-shop ju vykreslí (bus, bez importu routera)', async () => {
        happyPath();
        register(document.body);
        bus.emit(EV.SCREEN_CHANGED, { from: 'dnes', to: 'eshop' });
        await vi.waitFor(() => {
            expect(document.querySelector('#eshop-orders .es-order')).not.toBeNull();
        });
        expect(document.querySelector('#eshop-status .es-status--ok')).not.toBeNull();
    });

    it('register bez markupu obrazovky nespadne', () => {
        document.body.innerHTML = '<div></div>';
        expect(() => register(document.body)).not.toThrow();
    });

    it('blade nesie stabilné id, ktoré JS hľadá', () => {
        for (const id of ['screen-eshop', 'eshop-status', 'eshop-kpi', 'eshop-days', 'eshop-countries',
            'eshop-orders', 'eshop-order-detail', 'eshop-product-form', 'eshop-product-id',
            'eshop-product-result', 'eshop-refresh', 'eshop-checked']) {
            expect(document.getElementById(id), id).not.toBeNull();
        }
    });

    it('stav a výsledky hľadania sú aria-live oblasti', () => {
        expect(document.getElementById('eshop-status').getAttribute('aria-live')).toBe('polite');
        expect(document.getElementById('eshop-product-result').getAttribute('aria-live')).toBe('polite');
        expect(document.getElementById('eshop-order-detail').getAttribute('aria-live')).toBe('polite');
    });

    it('vstup má priradený label a nadpisy idú h1 → h2 → h3', async () => {
        expect(document.querySelector('label[for="eshop-product-id"]')).not.toBeNull();
        expect(document.querySelectorAll('#screen-eshop h1')).toHaveLength(1);
        happyPath();
        await renderEshop();
        await findProduct(22);
        expect(document.querySelectorAll('#screen-eshop h2').length).toBeGreaterThanOrEqual(3);
        expect(document.querySelector('#eshop-product-result h3')).not.toBeNull();
    });

    it('každý ovládací prvok má prístupný názov a je dosiahnuteľný klávesnicou', async () => {
        happyPath();
        await renderEshop();
        const controls = [...document.querySelectorAll('#screen-eshop button, #screen-eshop input')];
        expect(controls.length).toBeGreaterThan(5);
        for (const c of controls) {
            const name = c.getAttribute('aria-label') || c.textContent.trim()
                || (c.id && document.querySelector('label[for="' + c.id + '"]') ? 'label' : '');
            expect(name, c.outerHTML.slice(0, 90)).toBeTruthy();
            expect(c.getAttribute('tabindex')).not.toBe('-1');
        }
    });

    it('riadky objednávok sú tlačidlá s aria-expanded', async () => {
        happyPath();
        await renderEshop();
        for (const r of document.querySelectorAll('#eshop-orders .es-order')) {
            expect(r.tagName).toBe('BUTTON');
            expect(r.getAttribute('aria-expanded')).toBe('false');
        }
    });
});
