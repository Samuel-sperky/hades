import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { bus } from '../../resources/js/core/bus.js';
import { EV } from '../../resources/js/core/events.js';
import { findProduct, register, renderEshop } from '../../resources/js/screens/eshop.js';
import {
    amountHtml, fmtCount, normalizeCountries, normalizeHealth, normalizeOrder, normalizeOrders,
    normalizeProduct, normalizeRevenue, normalizeSummary, normalizeVariants, variantLabel,
    windowRange,
} from '../../resources/js/screens/eshop/data.js';
import { filters, orderQuery } from '../../resources/js/screens/eshop/filters.js';

/* Obrazovka E-shop (balík P11, agent SPERKY-FE).

   Najdôležitejšie testy tohto súboru NIE SÚ o vykreslení, ale o obmedzeniach
   z refactor-auraai/08b-SPERKY-API-SPEC-V2.md (overené proti živej produkcii):

   R1  `currency` (ISO) je v zozname AJ v detaile → mena je AUTORITATÍVNA.
       Mapovanie krajina→mena je zmazané: pokrývalo SK/SI/HU/CZ, ale 27 % vzorky
       je RON alebo PLN, takže hádalo nesprávne. Značka „odhad" preto zmizla —
       bola nepravdivá. Suma sa však NIKDY nesmie zobraziť bez meny.
   R2  Obrat sa vracia po menách (EUR 40 · HUF 26 · RON 20 · PLN 7 · CZK 7).
       Vykreslí sa jeden riadok na menu; SÚČET NAPRIEČ MENAMI SA NEVYKRESLÍ
       NIKDE — to je brána tohto súboru. Keby ju niekto zmazal, ďalšia vlna nájde
       obrazovku, ktorá lže o peniazoch.
   R3  `date_from`/`date_to`/`country`/`total_min` fungujú → okno je v UI a filter
       sumy je aktívny LEN s krajinou (rozhodnutie 8).
   R4  `attributes` sa vracia → varianty vrátane `quantity`; vypredaný variant
       musí byť odlíšený.
   R6  HTTP 200 s `ok:false` je chyba → indikátor musí ukázať nedostupnosť.
   R7  chýbajúce číslo je „—", nikdy dopočítaná nula.

   Telá odpovedí sú odpísané z reálneho EshopController-a (obálka `{ok,data,meta}`,
   `orders.total_in_shop`), nie vymyslené. Markup sa načítava z reálneho blade
   súboru, takže preklep v `id` položí test a nie až prehliadač. */

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
let calls = [];

/* Neskorší zápis prebíja skorší, aby si test vedel prepísať jednu cestu
   z happyPath() bez toho, aby ju celú prestavoval. */
function route(pattern, factory) { routes.unshift([pattern, factory]); }

function installFetch() {
    routes = [];
    calls = [];
    global.fetch = vi.fn(async (url) => {
        const path = String(url);
        calls.push(path);
        for (const [pattern, factory] of routes) if (pattern.test(path)) return factory(path);
        throw new Error('neošetrená cesta v teste: ' + path);
    });
}

const called = (re) => calls.filter((c) => re.test(c));

const HEALTH = /^\/api\/eshop\/health/;
const SUMMARY = /^\/api\/eshop\/summary/;
const ORDER = /^\/api\/eshop\/orders\/\d+/;
const ORDERS = /^\/api\/eshop\/orders(\?|$)/;
const PRODUCT = /^\/api\/eshop\/products\/\d+/;

const ok = (data) => ({ ok: true, data, meta: { cached: false, source: 'sperky' } });
const failBody = (code, message) => ({ ok: false, data: null, error: { code, message } });

const HEALTH_BODY = ok({
    ok: true, orders: true, products: true, error: null, latency_ms: 825,
    checked_at: '2026-07-31T15:14:48+02:00',
    totals: { orders: 1764137, products: 41018 }, key_configured: true,
});

/* Presne to rozdelenie, ktoré sa nameralo na vzorke 100 objednávok. */
const COUNTRIES = [
    { country_iso: 'SK', country: 'Slovensko', orders: 61 },
    { country_iso: 'HU', country: 'Maďarsko', orders: 22 },
    { country_iso: 'CZ', country: 'Česká republika', orders: 17 },
];

/* Sumy sú zvolené tak, aby ich súčet (235 500) bol v DOM nezameniteľný —
   keby ho niekto vykreslil, test „nikde jeden obrat" ho nájde. */
const REVENUE = [
    { currency: 'EUR', total: 1000, orders: 40 },
    { currency: 'HUF', total: 200000, orders: 26 },
    { currency: 'RON', total: 30000, orders: 20 },
    { currency: 'PLN', total: 4000, orders: 7 },
    { currency: 'CZK', total: 500, orders: 7 },
];
/* PLN a CZK majú v reálnej vzorke rovnaký počet (7), takže o poradí rozhoduje
   ISO kód — CZK je pred PLN. Poradie musí byť deterministické, inak by sa
   sekcia obratu pri každom načítaní preskládala. */
const REV_ORDER = ['EUR', 'HUF', 'RON', 'CZK', 'PLN'];
const CROSS_SUM = 235500;

const SUMMARY_BODY = ok({
    generated_at: '2026-07-31T15:14:50+02:00',
    window: { days: 7, from: '2026-07-25', until: '2026-08-01' },
    orders: { in_window: 1010, today: 126, total_in_shop: 1764137 },
    by_day: [
        { date: '2026-07-29', orders: 224 },
        { date: '2026-07-30', orders: 220 },
        { date: '2026-07-31', orders: 126 },
    ],
    countries: COUNTRIES,
    revenue: REVENUE,
    products_total: 41018,
});

const ORDERS_BODY = ok({
    orders: [
        { id: 1764146, date_add: '2026-07-31 15:11:14', total_paid: 73.9, currency: 'EUR' },
        { id: 1764145, date_add: '2026-07-31 14:52:25', total_paid: 20965, currency: 'HUF' },
    ],
    page: 1, per_page: 20, total: 1764137, count: 2, sorted_by: 'id_desc',
});

const ORDER_BODY = ok({
    order: {
        id: 1764146, date_add: '2026-07-31 15:11:14', total_paid: 20965, currency: 'HUF',
        country: 'Maďarsko', country_iso: 'HU',
        products: [{ id: 30582, qty: 2 }, { id: 22, qty: 1 }],
    },
});

/* Produkt 49 — 12 variantov, index 3 je vypredaný (quantity 0). */
const VARIANTS = Array.from({ length: 12 }, (_, i) => ({
    id_product_attribute: 500 + i,
    values: [{ group: 'Veľkosť', value: (48 + i * 2) + ' cm' }],
    price_impact: i === 0 ? 0 : i * 1.5,
    reference: 'REF-' + (500 + i),
    ean13: '85900000' + (1000 + i),
    quantity: i === 3 ? 0 : 10 + i,
    is_default: i === 0,
}));

const PRODUCT_BODY = ok({
    product: {
        id: 49, name: 'Retiazka z chirurgickej ocele', price: 12.9, currency: 'EUR',
        description: '<h3>Dlhý popis</h3>', description_short: '<p>Ocelová <b>retiazka</b></p>',
        has_attributes: true, attributes: VARIANTS,
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
    filters.days = 7;
    filters.country = '';
    filters.totalMin = null;
});


/* ================= čisté helpery ================= */

describe('mena je autoritatívna z API (R1)', () => {
    it('suma nesie ISO kód z API a NIKDY značku „odhad"', () => {
        const h = amountHtml(20965, { currency: 'huf' });
        expect(h).toContain('HUF');
        expect(h).not.toContain('odhad');
        expect(h).not.toContain('es-est');
    });

    it('krajina menu NEURČUJE — RON a PLN by staré mapovanie uhádlo nesprávne', () => {
        for (const iso of ['RO', 'PL', 'HU', 'CZ', 'SK']) {
            const h = amountHtml(500, { iso });
            expect(h).toContain('mena neuvedená');
            expect(h).not.toMatch(/EUR|HUF|CZK|RON|PLN/);
        }
    });

    it('bez meny to prizná, nedomýšľa EUR', () => {
        const h = amountHtml(999);
        expect(h).toContain('mena neuvedená');
        expect(h).not.toContain('EUR');
    });

    it('chýbajúca suma je „—", nie nula (R7)', () => {
        expect(amountHtml(null)).toContain('—');
        expect(amountHtml(null)).not.toContain('0');
        expect(amountHtml(undefined)).toContain('es-amount--na');
    });

    it('nikdy nevykreslí symbol meny — pri piatich menách je ISO jednoznačné', () => {
        for (const c of ['EUR', 'HUF', 'CZK', 'RON', 'PLN']) {
            expect(amountHtml(1, { currency: c })).not.toMatch(/€|Ft|Kč|zł|lei/);
        }
    });

    it('príplatok variantu má znak + a stále menu', () => {
        const h = amountHtml(1.5, { currency: 'EUR', sign: true });
        expect(h).toContain('+1,5');
        expect(h).toContain('EUR');
        expect(amountHtml(-2, { currency: 'EUR', sign: true })).toContain('-2');
    });
});


describe('fmtCount (R7)', () => {
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
        expect(s.ordersTotal).toBe(1764137);
        expect(s.ordersDay).toBe(126);
        expect(s.ordersWindow).toBe(1010);
        expect(s.windowDays).toBe(7);
        expect(s.windowFrom).toBe('2026-07-25');
        expect(s.countries.map((c) => c.iso)).toEqual(['SK', 'HU', 'CZ']);
    });

    it('konec okna berie `to` aj starší `until`', () => {
        expect(normalizeSummary(ok({ window: { days: 7, from: 'a', to: 'b' } })).windowUntil).toBe('b');
        expect(normalizeSummary(ok({ window: { days: 7, from: 'a', until: 'c' } })).windowUntil).toBe('c');
    });

    it('súhrn NEOBSAHUJE žiadne pole s obratom naprieč menami', () => {
        const s = normalizeSummary({ ok: true, data: { ...SUMMARY_BODY.data, revenue_total: CROSS_SUM } });
        expect(Object.keys(s)).toEqual(['ordersTotal', 'ordersDay', 'ordersWindow', 'windowDays',
            'windowFrom', 'windowUntil', 'productsTotal', 'countries', 'revenue', 'byDay']);
        expect(JSON.stringify(s)).not.toContain(String(CROSS_SUM));
    });

    it('obrat po menách zoradí podľa počtu objednávok, pri rovnosti podľa ISO', () => {
        const r = normalizeRevenue(REVENUE);
        expect(r.map((x) => x.currency)).toEqual(REV_ORDER);
        expect(r.every((x) => x.currency && x.total !== null)).toBe(true);
        // dvakrát to isté vstupné pole musí dať to isté poradie
        expect(normalizeRevenue([...REVENUE].reverse()).map((x) => x.currency)).toEqual(REV_ORDER);
    });

    it('riadok obratu bez meny sa zahodí — peniaze bez meny nemajú význam', () => {
        expect(normalizeRevenue([{ total: 999 }, { currency: 'EUR', total: 1 }]))
            .toEqual([{ currency: 'EUR', total: 1, orders: null }]);
        expect(normalizeRevenue(null)).toEqual([]);
        expect(normalizeRevenue(undefined)).toEqual([]);
    });

    it('krajiny sú LEN počty — žiadna suma sa k nim nepripája', () => {
        const c = normalizeCountries([{ country_iso: 'SK', orders: 3, total_paid: 250, currency: 'EUR' }]);
        expect(Object.keys(c[0])).toEqual(['iso', 'name', 'orders']);
        expect(JSON.stringify(c)).not.toContain('250');
    });

    it('krajiny prijme aj ako mapu iso → počet', () => {
        expect(normalizeCountries({ SK: 3, HU: 9 }).map((c) => [c.iso, c.orders]))
            .toEqual([['HU', 9], ['SK', 3]]);
    });

    it('znesie plochý tvar aj chýbajúce polia', () => {
        expect(normalizeSummary({ counts: { total: 5 } }).ordersTotal).toBe(5);
        expect(normalizeSummary({}).ordersTotal).toBeNull();
        expect(normalizeSummary(null).countries).toEqual([]);
        expect(normalizeSummary(null).revenue).toEqual([]);
        expect(normalizeSummary(null).byDay).toEqual([]);
    });

    it('objednávka nesie menu z API a products [{id, qty}]', () => {
        const o = normalizeOrder(ORDER_BODY.data.order);
        expect(o.currency).toBe('HUF');
        expect(o.products).toEqual([{ id: 30582, qty: 2 }, { id: 22, qty: 1 }]);
    });

    it('starý tvar product_ids sa ešte znesie, len bez množstva', () => {
        expect(normalizeOrder({ id: 1, product_ids: [22, 23] }).products)
            .toEqual([{ id: 22, qty: null }, { id: 23, qty: null }]);
    });

    it('objednávky znesú obálku, plochý zoznam aj prázdno', () => {
        expect(normalizeOrders(ORDERS_BODY).orders).toHaveLength(2);
        expect(normalizeOrders(ORDERS_BODY).total).toBe(1764137);
        expect(normalizeOrders(ORDERS_BODY).filtered).toBe(false);
        expect(normalizeOrders({ data: [{ id: 1 }] }).orders[0].id).toBe(1);
        expect(normalizeOrders(null).orders).toEqual([]);
        expect(normalizeOrders({}).page).toBe(1);
    });

    it('echo filtrov z API sa prizná, kým nedorazí netvrdí nič', () => {
        expect(normalizeOrders(ok({ orders: [{ id: 1 }], filters: { country: 'SK' } })).filtered).toBe(true);
    });

    it('varianty sa čítajú vrátane zásoby (R4)', () => {
        const v = normalizeVariants(VARIANTS);
        expect(v).toHaveLength(12);
        expect(v[0].label).toBe('Veľkosť: 48 cm');
        expect(v[0].isDefault).toBe(true);
        expect(v[3].quantity).toBe(0);
        expect(v[1].priceImpact).toBe(1.5);
        expect(v[1].reference).toBe('REF-501');
        expect(v[1].ean13).toBe('859000001001');
    });

    it('chýbajúca zásoba je null („—"), nie dopočítaná nula (R7)', () => {
        expect(normalizeVariants([{ id: 1 }])[0].quantity).toBeNull();
        expect(normalizeVariants(null)).toEqual([]);
    });

    it('označenie variantu znesie pole textov, pole objektov aj jeden text', () => {
        expect(variantLabel(['M', 'zlatá'])).toBe('M · zlatá');
        expect(variantLabel({ group: 'Farba', value: 'zlatá' })).toBe('Farba: zlatá');
        expect(variantLabel({ name: 'M' })).toBe('M');
        expect(variantLabel('M')).toBe('M');
        expect(variantLabel(null)).toBe('');
    });

    it('produkt sa vylúpne z dvojitej obálky a prizná varianty', () => {
        const p = normalizeProduct(PRODUCT_BODY);
        expect(p.id).toBe(49);
        expect(p.currency).toBe('EUR');
        expect(p.hasVariants).toBe(true);
        expect(p.variants).toHaveLength(12);
    });

    it('produkt bez variantov ich nepredstiera', () => {
        const p = normalizeProduct({ id: 22, name: 'X', price: 1 });
        expect(p.hasVariants).toBe(false);
        expect(p.variants).toEqual([]);
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


describe('dátumové okno (R3)', () => {
    it('okno N dní končí dneškom a je vrátane oboch krajov', () => {
        const r = windowRange(7, new Date(2026, 6, 31));
        expect(r).toEqual({ from: '2026-07-25', to: '2026-07-31' });
        expect(windowRange(1, new Date(2026, 6, 31))).toEqual({ from: '2026-07-31', to: '2026-07-31' });
        expect(windowRange(90, new Date(2026, 6, 31)).from).toBe('2026-05-03');
    });

    it('total_min sa do dotazu dostane LEN s krajinou (rozhodnutie 8)', () => {
        filters.totalMin = 100;
        expect(orderQuery(1, 20).total_min).toBeUndefined();
        expect(orderQuery(1, 20).country).toBeUndefined();
        filters.country = 'SK';
        expect(orderQuery(1, 20).total_min).toBe(100);
        expect(orderQuery(1, 20).country).toBe('SK');
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

    it('hlavné číslo je POČET objednávok, nie obrat', () => {
        const hero = document.querySelector('#eshop-kpi .kpi-hero');
        expect(hero.textContent).toContain('Objednávok v e-shope');
        expect(hero.querySelector('.kpi-val').textContent.replace(/\s/g, '')).toContain('1764137');
        expect(hero.querySelector('.es-amount')).toBeNull();
    });

    it('KPI pás nesie len počty — žiadna KPI karta neobsahuje peňažnú sumu', () => {
        const cards = [...document.querySelectorAll('#eshop-kpi .kpi-card')];
        expect(cards).toHaveLength(4);
        expect(cards.some((c) => c.querySelector('.es-amount'))).toBe(false);
        const t = document.querySelector('#eshop-kpi').textContent;
        expect(t).not.toMatch(/obrat/i);
        expect(t).not.toMatch(/EUR|HUF|RON|PLN|CZK/);
    });

    it('okno má popisku z API (window.days), nie z prepínača', () => {
        expect(document.querySelector('#eshop-kpi').textContent).toContain('Objednávky za 7 dní');
        expect(document.querySelector('#eshop-kpi').textContent).not.toContain('≥');
    });

    it('obrat po menách sa vykreslí — jeden riadok na každú z piatich mien', () => {
        const rows = [...document.querySelectorAll('#eshop-revenue .es-rev-row')];
        expect(rows).toHaveLength(5);
        expect(rows.map((r) => r.dataset.currency)).toEqual(REV_ORDER);
        expect(document.querySelector('#eshop-revenue .section-title').textContent)
            .toContain('Obrat po menách');
    });

    it('každý riadok obratu nesie svoju menu a počet objednávok', () => {
        const rows = [...document.querySelectorAll('#eshop-revenue .es-rev-row')];
        expect(rows[0].querySelector('.es-cur').textContent).toBe('EUR');
        expect(rows[0].querySelector('.es-sum').textContent.replace(/\s/g, '')).toBe('1000');
        expect(rows[0].querySelector('.es-rev-orders').textContent).toContain('40');
        expect(rows[1].querySelector('.es-cur').textContent).toBe('HUF');
        expect(rows[1].querySelector('.es-sum').textContent.replace(/\s/g, '')).toBe('200000');
    });

    it('nad obratom je pravidlo, že sa meny nesčítavajú ani neprepočítavajú', () => {
        const note = document.querySelector('#eshop-revenue .es-note--rule');
        expect(note.textContent).toContain('nesčítavajú');
        expect(note.textContent).toContain('neprepočítavajú');
    });

    it('objednávky po dňoch sú počty, bez súm', () => {
        const rows = [...document.querySelectorAll('#eshop-days .es-bar')];
        expect(rows).toHaveLength(3);
        expect(rows[2].querySelector('.db-n').textContent).toBe('126');
        expect(document.querySelector('#eshop-days .es-amount')).toBeNull();
    });

    it('krajiny sú presné počty — bez slova „vzorka" a bez sumy', () => {
        const rows = [...document.querySelectorAll('#eshop-countries .es-bar')];
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector('.db-name').textContent).toBe('Slovensko (SK)');
        expect(rows[0].querySelector('.db-n').textContent).toBe('61');
        const t = document.querySelector('#eshop-countries').textContent;
        expect(t).not.toMatch(/vzork/i);
        expect(t).not.toMatch(/odhad/i);
        expect(t).not.toMatch(/request/i);
        expect(document.querySelector('#eshop-countries .es-amount')).toBeNull();
    });

    it('posledné objednávky nesú id, dátum a sumu s menou z API', () => {
        const rows = [...document.querySelectorAll('#eshop-orders .es-order')];
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.es-o-id').textContent).toBe('#1764146');
        expect(rows[0].querySelector('.es-o-date').textContent).toContain('2026');
        expect(rows[0].querySelector('.es-cur').textContent).toBe('EUR');
        expect(rows[1].querySelector('.es-cur').textContent).toBe('HUF');
        expect(document.querySelectorAll('#eshop-orders .es-est')).toHaveLength(0);
    });

    it('zoznam objednávok sa žiada s dátumovým oknom', () => {
        const r = windowRange(7);
        const q = called(ORDERS)[0];
        expect(q).toContain('date_from=' + r.from);
        expect(q).toContain('date_to=' + r.to);
        expect(q).not.toContain('total_min');
    });

    it('stránkovanie ide od najnovších', () => {
        expect(document.querySelector('#eshop-prev').disabled).toBe(true);
        expect(document.querySelector('#eshop-next').disabled).toBe(false);
        const t = document.querySelector('#eshop-orders').textContent;
        expect(t).toContain('Novšie');
        expect(t).toContain('Staršie');
    });

    it('detail objednávky doplní krajinu, menu z API a množstvá', async () => {
        const row = document.querySelector('#eshop-orders .es-order');
        await row.onclick();
        const det = document.querySelector('#eshop-order-detail .es-detail');
        expect(row.getAttribute('aria-expanded')).toBe('true');
        expect(det.textContent).toContain('Maďarsko (HU)');
        expect(det.querySelector('.es-cur').textContent).toBe('HUF');
        expect(det.querySelector('.es-est')).toBeNull();
        expect([...det.querySelectorAll('.es-pid')].map((e) => e.textContent))
            .toEqual(['#30582 × 2', '#22 × 1']);
    });

    it('druhý klik detail zavrie', async () => {
        const row = document.querySelector('#eshop-orders .es-order');
        await row.onclick();
        await row.onclick();
        expect(document.querySelector('#eshop-order-detail').innerHTML).toBe('');
        expect(row.getAttribute('aria-expanded')).toBe('false');
    });
});


/* ================= brána: žiadny súčet naprieč menami ================= */

describe('SÚČET NAPRIEČ MENAMI SA NEVYKRESLÍ NIKDE', () => {
    beforeEach(async () => {
        happyPath();
        await renderEshop();
        await findProduct(49);
    });

    it('súčet piatich mien (235 500) nie je v DOM v žiadnom formáte', () => {
        expect(tight()).not.toContain(String(CROSS_SUM));
        expect(bodyText()).not.toContain('235 500');
        expect(bodyText()).not.toContain('235500');
    });

    it('nikde nie je súhrnný obrat ani symbol meny ani prepočet', () => {
        expect(bodyText()).not.toMatch(/€/);
        expect(bodyText()).not.toMatch(/celkov[ýá]\s+obrat/i);
        expect(bodyText()).not.toMatch(/obrat\s+celkom/i);
        expect(bodyText()).not.toMatch(/súhrnn[ýá]\s+obrat/i);
        expect(bodyText()).not.toMatch(/prepočítan/i);
    });

    it('každá vykreslená suma má menu — žiadne osamotené peňažné číslo', () => {
        const amounts = [...document.querySelectorAll('.es-amount:not(.es-amount--na)')];
        expect(amounts.length).toBeGreaterThan(5);
        for (const a of amounts) expect(a.querySelector('.es-cur')).not.toBeNull();
    });

    it('päť mien zostane piatimi menami — nikdy sa nezlúčia do jednej', () => {
        const codes = [...document.querySelectorAll('#eshop-revenue .es-cur')].map((e) => e.textContent);
        expect(codes).toEqual(REV_ORDER);
        expect(new Set(codes).size).toBe(5);
    });

    it('sekcia obratu má presne 5 peňažných hodnôt — žiadna navyše (súčtová)', () => {
        expect(document.querySelectorAll('#eshop-revenue .es-amount').length).toBe(5);
    });

    it('značka „odhad" zmizla z celej obrazovky — bola nepravdivá', () => {
        expect(document.querySelectorAll('.es-est')).toHaveLength(0);
        expect(bodyText()).not.toMatch(/odhad/i);
        expect(bodyText()).not.toMatch(/odvoden[áé]\s+z\s+krajiny/i);
    });
});


describe('zdrojový kód obrazovky', () => {
    /* Komentáre sa odstraňujú — o obmedzeniach sa v nich písať MUSÍ, porušením
       kontraktu je až kód. Rovnaký prístup ako css-tokens.test.js. */
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const FILES = [
        'resources/js/screens/eshop.js',
        'resources/js/screens/eshop/data.js',
        'resources/js/screens/eshop/filters.js',
        'resources/js/screens/eshop/summary.js',
        'resources/js/screens/eshop/orders.js',
        'resources/js/screens/eshop/product.js',
    ];
    const src = FILES.map((p) => stripComments(readFileSync(resolve(process.cwd(), p), 'utf8')));
    const cssRaw = readFileSync(resolve(process.cwd(), 'resources/css/screens/eshop.css'), 'utf8');
    const css = stripComments(cssRaw);

    it('nepoužíva symbol meny (vždy len ISO kód)', () => {
        for (const s of src) expect(s).not.toContain('€');
    });

    it('neobsahuje kurzový prepočet', () => {
        for (const s of src) expect(s).not.toMatch(/exchange|kurz|toEur|convertTo/i);
    });

    it('mapovanie krajina→mena je zmazané (rozhodnutie 7)', () => {
        for (const s of src) {
            expect(s).not.toMatch(/CURRENCY_BY_COUNTRY|currencyForCountry|currency_is_estimate|currencyEstimate/);
        }
    });

    it('peňažná hodnota má jediné miesto vykreslenia — amountHtml()', () => {
        expect(src.join('\n').split('es-sum').length - 1).toBe(1);
    });

    it('CSS už nedefinuje značku odhadu a tabuľka variantov roluje sama', () => {
        // Komentár o zmazanej triede zostať SMIE, pravidlo nie.
        expect(css).not.toContain('.es-est');
        expect(css).toMatch(/\.es-var-wrap\s*\{[^}]*overflow:\s*auto/);
        expect(css).toContain('--accent-text');
    });

    it('CSS nemá raw hex — farby idú len cez tokeny (kontrakt §4.8)', () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/rgba?\(\s*\d/);
    });
});


/* ================= varianty ================= */

describe('varianty produktu (R4)', () => {
    beforeEach(async () => {
        happyPath();
        await findProduct(49);
    });

    it('vypíše všetkých 12 variantov s hlavičkou vrátane zásoby', () => {
        const rows = [...document.querySelectorAll('#eshop-product-result .es-var-row')];
        expect(rows).toHaveLength(12);
        const heads = [...document.querySelectorAll('#eshop-product-result .es-var thead th')]
            .map((h) => h.textContent);
        expect(heads).toEqual(['Variant', 'Príplatok', 'Referencia', 'EAN13', 'Zásoba']);
    });

    it('riadok nesie hodnotu, príplatok s menou, referenciu, EAN13 a zásobu', () => {
        const r = document.querySelectorAll('#eshop-product-result .es-var-row')[1];
        expect(r.querySelector('.es-var-label').textContent).toContain('Veľkosť: 50 cm');
        expect(r.querySelector('.es-var-impact .es-cur').textContent).toBe('EUR');
        expect(r.querySelector('.es-var-impact .es-sum').textContent).toContain('+1,5');
        expect(r.querySelector('.es-var-ref').textContent).toBe('REF-501');
        expect(r.querySelector('.es-var-ean').textContent).toBe('859000001001');
        expect(r.querySelector('.es-var-qty').textContent).toContain('11');
        expect(r.querySelector('.es-stock--in')).not.toBeNull();
    });

    it('vypredaný variant je odlíšený triedou AJ slovom, nie iba farbou', () => {
        const rows = [...document.querySelectorAll('#eshop-product-result .es-var-row')];
        expect(rows[3].classList.contains('es-var-row--out')).toBe(true);
        expect(rows[3].querySelector('.es-stock--out')).not.toBeNull();
        expect(rows[3].textContent).toContain('vypredané');
        expect(rows.filter((r) => r.classList.contains('es-var-row--out'))).toHaveLength(1);
        expect(document.querySelector('.es-var-count').textContent).toContain('1 vypredaných');
    });

    it('predvolený variant je označený', () => {
        const rows = [...document.querySelectorAll('#eshop-product-result .es-var-row')];
        expect(rows[0].querySelector('.es-var-def').textContent).toBe('predvolený');
        expect(rows[0].querySelector('.es-var-noimpact').textContent).toBe('bez príplatku');
    });

    it('dlhý zoznam roluje vo vlastnom kontejneri a je dosiahnuteľný klávesnicou', () => {
        const wrap = document.querySelector('#eshop-product-result .es-var-wrap');
        expect(wrap).not.toBeNull();
        expect(wrap.getAttribute('tabindex')).toBe('0');
        expect(wrap.getAttribute('aria-label')).toBe('Varianty produktu');
        expect(wrap.querySelector('.es-var')).not.toBeNull();
    });

    it('produkt bez variantov tabuľku nevykreslí', async () => {
        route(PRODUCT, () => res(200, ok({ product: { id: 22, name: 'X', price: 1, currency: 'EUR' } })));
        await findProduct(22);
        expect(document.querySelector('#eshop-product-result .es-var')).toBeNull();
        expect(document.querySelector('#eshop-product-result .es-p-name')).not.toBeNull();
    });

    it('has_attributes bez attributes to prizná, netvári sa, že varianty nie sú', async () => {
        route(PRODUCT, () => res(200, ok({
            product: { id: 49, name: 'X', price: 1, currency: 'EUR', has_attributes: true, attributes: [] },
        })));
        await findProduct(49);
        expect(document.querySelector('#eshop-product-result .es-note--rule').textContent)
            .toContain('nevrátilo');
    });

    it('príplatok bez meny produktu to prizná, nedomýšľa EUR', async () => {
        route(PRODUCT, () => res(200, ok({
            product: {
                id: 49, name: 'X', price: 1, has_attributes: true,
                attributes: [{ id_product_attribute: 1, values: ['M'], price_impact: 3, quantity: 5 }],
            },
        })));
        await findProduct(49);
        expect(document.querySelector('.es-var-impact .es-cur--unknown')).not.toBeNull();
    });
});


/* ================= filtre v UI ================= */

describe('prepínač okna a filtre (R3, rozhodnutie 8)', () => {
    beforeEach(async () => {
        happyPath();
        await renderEshop();
    });

    it('okno má tri možnosti a 7 dní je stlačené', () => {
        const btns = [...document.querySelectorAll('#eshop-window .es-win')];
        expect(btns.map((b) => b.textContent)).toEqual(['7 dní', '30 dní', '90 dní']);
        expect(btns.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    });

    it('prepnutie na 90 dní pošle nové okno do summary aj do objednávok', async () => {
        calls.length = 0;
        document.querySelectorAll('#eshop-window .es-win')[2].onclick();
        await vi.waitFor(() => { expect(called(ORDERS).length).toBeGreaterThan(0); });
        expect(called(SUMMARY)[0]).toContain('days=90');
        expect(called(ORDERS)[0]).toContain('date_from=' + windowRange(90).from);
        expect(document.querySelectorAll('#eshop-window .es-win')[2].getAttribute('aria-pressed'))
            .toBe('true');
    });

    it('filter sumy je bez krajiny ZABLOKOVANÝ a povie prečo', () => {
        const min = document.querySelector('#eshop-total-min');
        expect(min.disabled).toBe(true);
        const why = document.querySelector('#eshop-total-min-why');
        expect(why.textContent).toContain('len pri vybranej krajine');
        expect(why.textContent).toContain('HUF');
        expect(min.getAttribute('aria-describedby')).toBe('eshop-total-min-why');
    });

    it('po výbere krajiny sa filter sumy odomkne a dostane do dotazu', async () => {
        const sel = document.querySelector('#eshop-country');
        expect([...sel.options].map((o) => o.value)).toEqual(['', 'SK', 'HU', 'CZ']);
        sel.value = 'SK';
        sel.onchange();
        await vi.waitFor(() => { expect(document.querySelector('#eshop-total-min').disabled).toBe(false); });

        calls.length = 0;
        const min = document.querySelector('#eshop-total-min');
        min.value = '100';
        min.onchange();
        await vi.waitFor(() => { expect(called(ORDERS).length).toBeGreaterThan(0); });
        expect(called(ORDERS)[0]).toContain('country=SK');
        expect(called(ORDERS)[0]).toContain('total_min=100');
    });

    it('zrušenie krajiny zruší aj sumu — filter sumy nikdy neprežije krajinu', async () => {
        const sel = document.querySelector('#eshop-country');
        sel.value = 'SK';
        sel.onchange();
        await vi.waitFor(() => { expect(document.querySelector('#eshop-total-min').disabled).toBe(false); });
        const min = document.querySelector('#eshop-total-min');
        min.value = '100';
        min.onchange();

        document.querySelector('#eshop-filter-reset').onclick();
        expect(filters.country).toBe('');
        expect(filters.totalMin).toBeNull();
        expect(document.querySelector('#eshop-total-min').disabled).toBe(true);
    });

    it('bez rozpadu krajín je ponuka aj filter sumy zamknutý a vysvetlený', async () => {
        route(SUMMARY, () => res(200, ok({ ...SUMMARY_BODY.data, countries: [] })));
        await renderEshop();
        expect(document.querySelector('#eshop-country').disabled).toBe(true);
        expect(document.querySelector('#eshop-total-min').disabled).toBe(true);
        expect(document.querySelector('#eshop-total-min-why').textContent)
            .toContain('ponuka krajín je prázdna');
    });
});


/* ================= prázdne stavy ================= */

describe('prázdne stavy', () => {
    it('prázdny zoznam objednávok navrhne širšie okno', async () => {
        happyPath();
        route(ORDERS, () => res(200, ok({ page: 1, total: 0, orders: [] })));
        await renderEshop();
        expect(document.querySelector('#eshop-orders .empty-state').textContent)
            .toContain('Vo vybranom okne nie sú objednávky');
        expect(document.querySelectorAll('#eshop-orders .es-order')).toHaveLength(0);
    });

    it('chýbajúci obrat nevykreslí prázdnu sekciu ani nulu', async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({ ...SUMMARY_BODY.data, revenue: [] })));
        await renderEshop();
        expect(document.querySelector('#eshop-revenue').innerHTML).toBe('');
        expect(document.querySelector('#eshop-kpi .kpi-hero')).not.toBeNull();
    });

    it('chýbajúci rozpad krajín sekciu nevykreslí (žiadna veta o vzorke)', async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({ ...SUMMARY_BODY.data, countries: [] })));
        await renderEshop();
        expect(document.querySelector('#eshop-countries').innerHTML).toBe('');
        expect(bodyText()).not.toMatch(/vzork/i);
    });

    it('chýbajúce počty sú „—", nie vymyslené nuly (R7)', async () => {
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
    it('starý tvar odpovede (bez revenue, s countries_meta) obrazovku nepoloží', async () => {
        happyPath();
        route(SUMMARY, () => res(200, ok({
            window: { days: 7, from: '2026-07-25', until: '2026-08-01' },
            orders: { in_window: 800, today: 126, complete: false, total_in_shop: 1764137 },
            by_day: [{ date: '2026-07-31', orders: 126 }],
            countries: [],
            countries_meta: { basis: 'sample', sample_size: 0, currency_is_estimate: true },
            months: [],
        })));
        await renderEshop();
        expect(document.querySelector('#eshop-kpi .kpi-hero').textContent).toContain('Objednávok');
        expect(document.querySelector('#eshop-revenue').innerHTML).toBe('');
        expect(document.querySelectorAll('#eshop-orders .es-order')).toHaveLength(2);
        expect(bodyText()).not.toMatch(/odhad/i);
    });

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

    it('HTTP 200 s ok:false je nedostupnosť (R6)', async () => {
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

    it('padnutý súhrn nezhodí zoznam objednávok ani filtre', async () => {
        happyPath();
        route(SUMMARY, () => res(503, failBody('unavailable', 'x')));
        await renderEshop();
        expect(document.querySelectorAll('#eshop-orders .es-order')).toHaveLength(2);
        expect(document.querySelector('#eshop-kpi .empty-state')).not.toBeNull();
        expect(document.querySelector('#eshop-total-min').disabled).toBe(true);
    });

    it('neexistujúci produkt je doménový stav, nie výnimka', async () => {
        happyPath();
        route(PRODUCT, () => res(404, failBody('not_found', 'Produkt sa nenašiel.')));
        await findProduct(999999);
        expect(document.querySelector('#eshop-product-result .empty-state').textContent)
            .toContain('neexistuje');
    });

    it('nečíselný vstup nevolá API', async () => {
        happyPath();
        await findProduct('abc');
        expect(global.fetch).not.toHaveBeenCalled();
        expect(document.querySelector('#eshop-product-result').textContent)
            .toContain('Zadaj číselné ID');
    });

    it('HTML v popise a vo variante sa nevykreslí ako značky (XSS)', async () => {
        happyPath();
        route(PRODUCT, () => res(200, ok({
            product: {
                id: 5, name: '<img src=x onerror=alert(1)>', price: 1, currency: 'EUR',
                description_short: '<script>alert(2)</script>zlý popis',
                has_attributes: true,
                attributes: [{
                    id_product_attribute: 1, values: ['<img src=y onerror=alert(3)>'],
                    reference: '<b>ref</b>', quantity: 1, price_impact: 0,
                }],
            },
        })));
        await findProduct(5);
        const host = document.querySelector('#eshop-product-result');
        expect(host.querySelector('img')).toBeNull();
        expect(host.querySelector('script')).toBeNull();
        expect(host.querySelector('.es-var-label b')).toBeNull();
        expect(host.textContent).toContain('zlý popis');
    });
});


/* ================= zapojenie a a11y ================= */

describe('register a a11y', () => {
    it('formulár produktu volá hľadanie a nereloaduje stránku', async () => {
        happyPath();
        register(document.body);
        document.querySelector('#eshop-product-id').value = '49';
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
        for (const id of ['screen-eshop', 'eshop-status', 'eshop-window', 'eshop-kpi', 'eshop-revenue',
            'eshop-days', 'eshop-countries', 'eshop-filters', 'eshop-orders', 'eshop-order-detail',
            'eshop-product-form', 'eshop-product-id', 'eshop-product-result', 'eshop-refresh',
            'eshop-checked']) {
            expect(document.getElementById(id), id).not.toBeNull();
        }
    });

    it('stav a výsledky hľadania sú aria-live oblasti', () => {
        expect(document.getElementById('eshop-status').getAttribute('aria-live')).toBe('polite');
        expect(document.getElementById('eshop-product-result').getAttribute('aria-live')).toBe('polite');
        expect(document.getElementById('eshop-order-detail').getAttribute('aria-live')).toBe('polite');
    });

    it('vstupy majú label a nadpisy idú h1 → h2 → h3 → h4', async () => {
        expect(document.querySelector('label[for="eshop-product-id"]')).not.toBeNull();
        expect(document.querySelectorAll('#screen-eshop h1')).toHaveLength(1);
        happyPath();
        await renderEshop();
        await findProduct(49);
        expect(document.querySelector('label[for="eshop-country"]')).not.toBeNull();
        expect(document.querySelector('label[for="eshop-total-min"]')).not.toBeNull();
        expect(document.querySelectorAll('#screen-eshop h2').length).toBeGreaterThanOrEqual(4);
        expect(document.querySelector('#eshop-product-result h3')).not.toBeNull();
        expect(document.querySelector('#eshop-product-result h4')).not.toBeNull();
    });

    it('každý ovládací prvok má prístupný názov a je dosiahnuteľný klávesnicou', async () => {
        happyPath();
        await renderEshop();
        const controls = [...document.querySelectorAll(
            '#screen-eshop button, #screen-eshop input, #screen-eshop select',
        )];
        expect(controls.length).toBeGreaterThan(8);
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
