/* E-shop — čistá dátová vrstva obrazovky: mena, formátovanie, normalizácia
   odpovedí `api/eshop/*` a jediná povolená cesta k vykresleniu peňažnej sumy.

   Prečo samostatný súbor: kontrakt §2 drží ≤ 400 LOC na súbor. Delenie je
   rovnaké ako pri `screens/today/**` a `screens/review/**` — obrazovka si drží
   vlastný podpriečinok, `screens/eshop.js` je už len render a zapojenie.

   Kontrakt backendu (EshopController): `{ok, data, meta}` / `{ok, data:null,
   error:{code, message}}`. `data` býva ešte raz zabalené (`data.product`,
   `data.order`), preto `unwrap()` odlupuje viac vrstiev.

   POVINNÉ OBMEDZENIA z refactor-auraai/08-SPERKY-API-SPEC.md:
   N1  `total_paid` je v mene objednávky, ale API menu NEVRACIA. HU=HUF, CZ=CZK,
       SK/SI=EUR. Súčet naprieč objednávkami je preto nezmyselné číslo.
       → tu NIE JE a nikdy nesmie byť funkcia, ktorá sčítava sumy alebo
         prepočítava menu; `amountHtml()` povinne vypíše ISO kód a značku „odhad"
       → keď backend prizná `currency_is_estimate`, mena sa berie ako ODHAD aj
         vtedy, keď prišla v poli `currency`
   N2  `has_attributes` ani `attributes` sa z odpovede NEČÍTAJÚ — API ich nevracia
   N7  chýbajúca hodnota je „—", nikdy dopočítaná nula ani konštanta */

import { esc } from '../../core/dom.js';

/** Priznanie k nálezu N1 — visí nad každým rozpadom súm a v každom tooltipe. */
export const CURRENCY_NOTE = 'Sumy sú v mene objednávky. API menu nevracia, preto je '
    + 'odhadnutá z krajiny — nesčítavame ich a neprepočítavame na jednu menu.';

/** Priznanie k nálezu N3/N5 — okno sa skenuje, sken sa môže zastaviť na strope. */
export const SCAN_NOTE = 'Okno sa počíta prechodom zoznamu od najnovšej objednávky a sken sa '
    + 'zastavil na strope požiadaviek — počty za okno a po dňoch sú dolná hranica, nie presné čísla. '
    + 'Dni, ku ktorým sken nedošiel, sa nezobrazujú: nula by predstierala, že v nich nič nebolo.';

/* Heuristika, nie pravda. Zdroj pravdy je backend (config/sperky.php): keď pošle
   `currency_estimate`, použije sa jeho hodnota, ale stále ako odhad. */
const CURRENCY_BY_COUNTRY = { SK: 'EUR', SI: 'EUR', HU: 'HUF', CZ: 'CZK' };

/** @returns {?string} ISO kód meny odhadnutý z krajiny, alebo null. */
export function currencyForCountry(iso) {
    return CURRENCY_BY_COUNTRY[String(iso || '').trim().toUpperCase()] || null;
}


/* ---------- drobní pomocníci ---------- */

export const num = (v) => (
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
);

const upper = (v) => (v ? String(v).trim().toUpperCase() : null);

/** Prvá neprázdna hodnota z kandidátnych kľúčov (`false` je hodnota, nie prázdno). */
export function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    return null;
}

const objOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Odlúpi obal `{ok,data:{…}}` aj druhú vrstvu (`data.product`, `data.order`). */
export function unwrap(payload, keys) {
    let cur = payload;
    for (let depth = 0; depth < 3; depth += 1) {
        if (!cur || typeof cur !== 'object') return {};
        let next = null;
        for (const k of keys) if (cur[k] && typeof cur[k] === 'object') { next = cur[k]; break; }
        if (!next) return cur;
        cur = next;
    }
    return cur;
}

const fmtNum = (n) => new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 2 }).format(n);

/** Počet z API, alebo „—". Nikdy nedopĺňa nulu (nález N7). */
export function fmtCount(v) {
    const n = num(v);
    return n === null ? '—' : fmtNum(n);
}

export function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toLocaleDateString('sk', { day: 'numeric', month: 'short', year: 'numeric' })
        + ' ' + d.toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}

/** PrestaShop vracia popisy ako HTML — zbavíme ich značiek, escapuje volajúci. */
export const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();


/* ---------- chybové kódy backendu ----------
   Uzavretý zoznam z EshopController + kódy z `core/api.js` (rozhranie #1).

   BEZPEČNOSŤ: `error.message` z odpovede sa NIKDY nevypisuje. UI vykreslí len
   vetu z tejto tabuľky, takže nech backend do odpovede napíše čokoľvek, do DOM
   to neprebublá — kľúč k SPERKY API sa nesmie dostať ani do DOM, ani do logu. */
const CODE_SK = {
    forbidden: 'E-shop odmietol kľúč integrácie (forbidden).',
    unauthorized: 'Server odmietol požiadavku — chýba alebo neplatí konfigurácia integrácie.',
    unconfigured: 'Integrácia nie je nakonfigurovaná.',
    rate_limited: 'Prekročený limit požiadaviek — skús to o chvíľu.',
    timeout: 'E-shop neodpovedal načas.',
    unavailable: 'E-shop je práve nedostupný.',
    server: 'E-shop vrátil chybu servera.',
    malformed: 'E-shop vrátil odpoveď, ktorú sa nedá prečítať.',
    bad_route: 'Neplatná cesta na API e-shopu.',
    bad_request: 'Neplatná požiadavka na API e-shopu.',
    no_id: 'Požiadavke chýba id.',
    not_found: 'Záznam sa nenašiel.',
    not_implemented: 'Serverová časť integrácie ešte nie je zapojená.',
    offline: 'Si offline — skontroluj, či beží lokálny stack.',
    unexpected: 'Neočakávaná chyba integrácie.',
};

/** Strojový kód chyby z tela odpovede backendu (`{ok:false, error:{code}}`). */
export function errCode(err) {
    const e = err && err.body && err.body.error;
    return e && e.code ? String(e.code) : null;
}

/** @returns {?string} SK veta pre známy kód, inak null (nikdy text zo servera). */
export function reasonForCode(code) {
    return code ? (CODE_SK[String(code).trim().toLowerCase()] || null) : null;
}


/* ---------- suma (jediná cesta, ktorou sa smie vykresliť peňažná hodnota) ----------
   Kontrakt tejto funkcie: NIKDY nevykreslí len číslo. Vždy pripojí ISO kód meny
   (alebo „mena neuvedená") a pri odhade aj značku „odhad". Symbol meny sa
   nepoužíva vôbec — „€" by zamlčal, že ide o odhad z krajiny.

   `opts` je priamo normalizovaný objekt (objednávka / krajina / produkt), takže
   volajúci nemá šancu zabudnúť menu podať. */
export function amountHtml(value, opts = {}) {
    const n = num(value);
    if (n === null) return '<span class="es-amount es-amount--na">—</span>';

    const exact = upper(opts.currency);
    const guess = exact ? null : (upper(opts.currencyEstimate) || currencyForCountry(opts.iso));
    const cur = exact || guess;

    let h = '<span class="es-amount"><span class="es-sum tnum">' + esc(fmtNum(n)) + '</span>';
    h += cur
        ? '<span class="es-cur">' + esc(cur) + '</span>'
        : '<span class="es-cur es-cur--unknown" title="API menu nevracia">mena neuvedená</span>';
    if (guess) h += '<span class="es-est" title="' + esc(CURRENCY_NOTE) + '">odhad</span>';
    return h + '</span>';
}

/* Mena je autoritatívna len vtedy, keď backend NEPRIZNÁVA odhad. `currency_is_estimate`
   preto prebíja pole `currency` — inak by sa odhad vykreslil ako fakt (nález N1). */
function currencyOf(src, forceEstimate) {
    const estimate = forceEstimate || pick(src, ['currency_is_estimate']) === true;
    const given = pick(src, ['currency', 'currency_iso']);
    return {
        currency: estimate ? null : given,
        currencyEstimate: pick(src, ['currency_estimate']) || (estimate ? given : null),
    };
}


/* ---------- normalizácia odpovedí ---------- */

export function normalizeCountries(raw, forceEstimate = false) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([k, v]) => (
        v && typeof v === 'object' ? { country_iso: k, ...v } : { country_iso: k, orders: v }
    ));
    return list.filter(Boolean).map((c) => ({
        iso: upper(pick(c, ['country_iso', 'iso', 'code'])) || '—',
        name: pick(c, ['country', 'name']),
        orders: num(pick(c, ['orders', 'count', 'orders_count'])) || 0,
        amount: num(pick(c, ['total_paid', 'amount', 'sum'])),
        ...currencyOf(c, forceEstimate),
    })).sort((a, b) => b.orders - a.orders);
}

export function normalizeByDay(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({ date: pick(r, ['date']), orders: num(pick(r, ['orders', 'count'])) || 0 }))
        .filter((r) => r.date);
}

/** Dni, ktoré sken naozaj pokryl.

    Backend vypĺňa celé okno a nescanované dni majú `orders: 0`. Pri neúplnom
    skene to ale nie je „nula objednávok", ale „sken tam nedošiel" — a nula by
    o biznise lhala. Sken ide od najnovšej objednávky dozadu (nález N4), takže
    neznáme sú práve úvodné (najstaršie) nuly a tie sa zahodia. */
export function coveredDays(summary) {
    const rows = (summary && summary.byDay) || [];
    if (!rows.length || (summary && summary.complete)) return rows;
    const first = rows.findIndex((r) => r.orders > 0);
    return first < 0 ? [] : rows.slice(first);
}

/** Súhrn: iba POČTY ako hlavné čísla (N1) — žiadny agregovaný obrat.
    Keď živý rozpad krajín chýba (`sample_details=0`), berie sa z najnovšieho
    mesačného súhrnu v pamäti — je to jediné miesto, kde krajiny vôbec sú. */
export function normalizeSummary(payload) {
    const d = unwrap(payload, ['summary', 'data', 'result']);
    const counts = objOf(d.orders).total_in_shop !== undefined || objOf(d.orders).today !== undefined
        ? objOf(d.orders)
        : (d.counts && typeof d.counts === 'object' ? d.counts : d);
    const meta = objOf(d.countries_meta);
    const live = normalizeCountries(pick(d, ['countries', 'by_country']), meta.currency_is_estimate === true);
    const months = Array.isArray(d.months) ? d.months : [];
    const month = live.length ? null
        : months.find((m) => Array.isArray(m && m.countries) && m.countries.length) || null;

    return {
        ordersTotal: num(pick(counts, ['total_in_shop', 'total'])) ?? num(pick(d, ['orders_total', 'total_orders'])),
        ordersDay: num(pick(counts, ['today', 'day', 'orders_day'])),
        ordersWindow: num(pick(counts, ['in_window', 'week', 'last_7_days', 'orders_week'])),
        windowDays: num(pick(objOf(d.window), ['days'])),
        complete: pick(counts, ['complete']) !== false,
        productsTotal: num(pick(d, ['products_total', 'total_products'])),
        countries: live.length ? live : normalizeCountries(month && month.countries, true),
        countriesFrom: live.length ? 'live' : (month ? (month.label || month.month || null) : null),
        countriesNote: pick(month ? objOf(month.countries_meta) : meta, ['note']),
        byDay: normalizeByDay(pick(d, ['by_day'])),
    };
}

export function normalizeOrder(o) {
    const ids = pick(o, ['product_ids', 'products']);
    return {
        id: pick(o, ['id', 'id_order']),
        date: pick(o, ['date_add', 'date', 'created_at']),
        totalPaid: num(pick(o, ['total_paid', 'total'])),
        iso: upper(pick(o, ['country_iso', 'iso'])),
        country: pick(o, ['country', 'country_name']),
        ...currencyOf(o, false),
        productIds: Array.isArray(ids) ? ids : [],
    };
}

export function normalizeOrders(payload) {
    const d = unwrap(payload, ['data', 'result']);
    const raw = pick(d, ['orders', 'items', 'rows']) || (Array.isArray(d) ? d : []);
    return {
        orders: (Array.isArray(raw) ? raw : []).filter(Boolean).map(normalizeOrder),
        page: num(pick(d, ['page'])) || 1,
        total: num(pick(d, ['total'])),
    };
}

/** Detail produktu. `attributes` / `has_attributes` sa ZÁMERNE nečítajú (N2). */
export function normalizeProduct(payload) {
    const d = unwrap(payload, ['product', 'data', 'result']);
    if (pick(d, ['id']) === null) return null;
    return {
        id: pick(d, ['id']),
        name: pick(d, ['name']) || '',
        price: num(pick(d, ['price'])),
        ...currencyOf(d, false),
        text: plain(pick(d, ['description_short']) || pick(d, ['description'])),
    };
}

/** Indikátor dostupnosti. `orders` a `products` sú hlásené oddelene — chýbajúci
    kľúč zhodí objednávky aj pri zdravom katalógu a obrazovka to má povedať presne. */
export function normalizeHealth(payload) {
    const d = unwrap(payload, ['data', 'result']);
    const totals = objOf(d.totals);
    return {
        ok: d.ok === true || d.available === true || d.healthy === true,
        orders: d.orders === true,
        products: d.products === true,
        keyConfigured: d.key_configured !== false,
        code: pick(d, ['error', 'code']),
        totalOrders: num(pick(totals, ['orders'])),
        totalProducts: num(pick(totals, ['products'])),
    };
}
