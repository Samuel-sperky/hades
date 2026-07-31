/* E-shop — čistá dátová vrstva obrazovky: formátovanie, normalizácia odpovedí
   `api/eshop/*` a jediná povolená cesta k vykresleniu peňažnej sumy.

   Prečo samostatný súbor: kontrakt §2 drží ≤ 400 LOC na súbor. Delenie je
   rovnaké ako pri `screens/today/**` a `screens/review/**` — obrazovka si drží
   vlastný podpriečinok, `screens/eshop.js` je už len zapojenie a orchestrácia.

   Kontrakt backendu (EshopController): `{ok, data, meta}` / `{ok, data:null,
   error:{code, message}}`. `data` býva ešte raz zabalené (`data.product`,
   `data.order`), preto `unwrap()` odlupuje viac vrstiev.

   POVINNÉ OBMEDZENIA z refactor-auraai/08b-SPERKY-API-SPEC-V2.md:
   R1  `currency` (ISO) je v zozname objednávok, v detaile aj v rozpade obratu,
       takže mena je AUTORITATÍVNA — žiadne hádanie z krajiny, žiadna značka
       „odhad". Mapovanie krajina→mena je zmazané (rozhodnutie 7); pokrývalo len
       SK/SI/HU/CZ, a keďže 27 % vzorky je RON alebo PLN, hádalo NESPRÁVNE.
   R2  Obrat sa vracia rozpadnutý po menách (`revenue[{currency,total,orders}]`).
       V tomto súbore preto NIE JE a nikdy nesmie byť funkcia, ktorá sčítava
       peňažné hodnoty ani prepočítava menu — súčet naprieč menami zostáva
       zakázaný (rozhodnutie 1), lebo HUF + EUR nedáva zmysel.
   R3  Suma sa NIKDY nevykreslí bez meny — `amountHtml()` je jediná cesta a vždy
       pripojí ISO kód, alebo prizná „mena neuvedená".
   R4  `attributes` sa vracia → varianty sa čítajú vrátane `quantity` (zásoba).
   R7  chýbajúca hodnota je „—", nikdy dopočítaná nula. */

import { esc } from '../../core/dom.js';

/** Priznanie k rozhodnutiu 1 — visí nad rozpadom obratu. */
export const REVENUE_NOTE = 'Každá mena má vlastný riadok. Sumy v rôznych menách sa '
    + 'nesčítavajú ani neprepočítavajú na jednu menu — súčet HUF a EUR by nič neznamenal.';

/** Priznanie k rozhodnutiu 8 — prečo je filter sumy zamknutý bez krajiny. */
export const TOTAL_MIN_NOTE = 'Filter sumy funguje len pri vybranej krajine: „nad 100" je '
    + 'v HUF drobné a v EUR veľká objednávka, takže naprieč menami by vyrobil zavádzajúce číslo.';


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

/** Počet z API, alebo „—". Nikdy nedopĺňa nulu (R7). */
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

/** `YYYY-MM-DD` v lokálnom čase (API berie dátumy vrátane oboch krajov). */
export function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** Okno N dní končiace dneškom → `{from, to}` pre `date_from` / `date_to`. */
export function windowRange(days, today = new Date()) {
    const to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const from = new Date(to);
    from.setDate(from.getDate() - (Math.max(1, num(days) || 1) - 1));
    return { from: ymd(from), to: ymd(to) };
}


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
   z API, alebo prizná „mena neuvedená". Symbol meny sa nepoužíva vôbec — pri
   piatich menách (EUR, HUF, RON, PLN, CZK) by „€" bol len ďalšia príležitosť
   pomýliť si menu; ISO kód je jednoznačný.

   `opts` je priamo normalizovaný objekt (objednávka / obrat / produkt / variant),
   takže volajúci nemá šancu zabudnúť menu podať. `opts.sign` pridá „+" pri
   kladnom čísle (príplatok variantu). */
export function amountHtml(value, opts = {}) {
    const n = num(value);
    if (n === null) return '<span class="es-amount es-amount--na">—</span>';

    const cur = upper(opts.currency);
    const sign = opts.sign && n > 0 ? '+' : '';
    return '<span class="es-amount">'
        + '<span class="es-sum tnum">' + esc(sign + fmtNum(n)) + '</span>'
        + (cur
            ? '<span class="es-cur">' + esc(cur) + '</span>'
            : '<span class="es-cur es-cur--unknown" title="API pri tejto hodnote menu neposlalo">'
              + 'mena neuvedená</span>')
        + '</span>';
}


/* ---------- normalizácia odpovedí ---------- */

/** Rozpad podľa krajín — LEN počty. Peniaze idú cez `revenue` (po menách),
    takže tu žiadna suma nie je a nemôže vzniknúť ani omylom. */
export function normalizeCountries(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([k, v]) => (
        v && typeof v === 'object' ? { country_iso: k, ...v } : { country_iso: k, orders: v }
    ));
    return list.filter(Boolean).map((c) => ({
        iso: upper(pick(c, ['country_iso', 'iso', 'code'])) || '—',
        name: pick(c, ['country', 'name']),
        orders: num(pick(c, ['orders', 'count', 'orders_count'])) || 0,
    })).sort((a, b) => b.orders - a.orders);
}

/** Obrat po menách (rozhodnutie 1). Riadky sa NEZLUČUJÚ a NESČÍTAVAJÚ — každý
    prichádza z API hotový a zostáva samostatný. Poradie: podľa počtu objednávok,
    pri rovnosti podľa ISO kódu, aby bolo vykreslenie deterministické. */
export function normalizeRevenue(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean).map((r) => ({
        currency: upper(pick(r, ['currency', 'currency_iso'])),
        total: num(pick(r, ['total', 'total_paid', 'sum'])),
        orders: num(pick(r, ['orders', 'count', 'orders_count'])),
    })).filter((r) => r.currency && r.total !== null)
        .sort((a, b) => (b.orders || 0) - (a.orders || 0) || a.currency.localeCompare(b.currency));
}

export function normalizeByDay(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => ({ date: pick(r, ['date']), orders: num(pick(r, ['orders', 'count'])) || 0 }))
        .filter((r) => r.date);
}

/** Súhrn: hlavné čísla sú POČTY, obrat je samostatná sekcia po menách. */
export function normalizeSummary(payload) {
    const d = unwrap(payload, ['summary', 'data', 'result']);
    const counts = objOf(d.orders).total_in_shop !== undefined || objOf(d.orders).today !== undefined
        ? objOf(d.orders)
        : (d.counts && typeof d.counts === 'object' ? d.counts : d);
    const win = objOf(d.window);

    return {
        ordersTotal: num(pick(counts, ['total_in_shop', 'total'])) ?? num(pick(d, ['orders_total', 'total_orders'])),
        ordersDay: num(pick(counts, ['today', 'day', 'orders_day'])),
        ordersWindow: num(pick(counts, ['in_window', 'week', 'last_7_days', 'orders_week'])),
        windowDays: num(pick(win, ['days'])),
        windowFrom: pick(win, ['from']),
        /* Backend zmenil `until` na `to` — čítame obidve, aby obrazovka fungovala
           pred aj po nasadení backendu. */
        windowUntil: pick(win, ['to', 'until']),
        productsTotal: num(pick(d, ['products_total', 'total_products'])),
        countries: normalizeCountries(pick(d, ['countries', 'by_country'])),
        revenue: normalizeRevenue(pick(d, ['revenue', 'by_currency'])),
        byDay: normalizeByDay(pick(d, ['by_day'])),
    };
}

/** Riadky objednávky. v2 posiela `products: [{id, qty}]`; starý tvar
    `product_ids: [id]` sa ešte znesie, len bez množstva. */
export function normalizeOrderProducts(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => p !== null && p !== undefined).map((p) => (
        typeof p === 'object'
            ? { id: pick(p, ['id', 'id_product']), qty: num(pick(p, ['qty', 'quantity'])) }
            : { id: p, qty: null }
    )).filter((p) => p.id !== null && p.id !== undefined);
}

export function normalizeOrder(o) {
    return {
        id: pick(o, ['id', 'id_order']),
        date: pick(o, ['date_add', 'date', 'created_at']),
        totalPaid: num(pick(o, ['total_paid', 'total'])),
        currency: pick(o, ['currency', 'currency_iso']),
        iso: upper(pick(o, ['country_iso', 'iso'])),
        country: pick(o, ['country', 'country_name']),
        products: normalizeOrderProducts(pick(o, ['products', 'product_ids'])),
    };
}

export function normalizeOrders(payload) {
    const d = unwrap(payload, ['data', 'result']);
    const raw = pick(d, ['orders', 'items', 'rows']) || (Array.isArray(d) ? d : []);
    const applied = objOf(pick(d, ['filters', 'applied_filters']));
    return {
        orders: (Array.isArray(raw) ? raw : []).filter(Boolean).map(normalizeOrder),
        page: num(pick(d, ['page'])) || 1,
        total: num(pick(d, ['total'])),
        /* Echo filtrov z API. Kým ho backend neposiela, je to prázdny objekt a
           UI netvrdí, že sa filtrovalo — len že sa o filter požiadalo. */
        filtered: Object.keys(applied).length > 0,
    };
}

/** Označenie variantu z `values`. API môže poslať pole textov, pole objektov
    (`{group, value}`) alebo jeden text — znesieme všetky tri. */
export function variantLabel(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(variantLabel).filter(Boolean).join(' · ');
    if (typeof v === 'object') {
        const parts = [pick(v, ['group', 'attribute', 'group_name', 'name']), pick(v, ['value', 'val'])]
            .filter(Boolean).map(String);
        return [...new Set(parts)].join(': ');
    }
    return String(v).trim();
}

/** Varianty produktu (R4). `quantity` je stav zásoby a je to najužitočnejšie
    pole — chýbajúce zostáva `null` („—"), nikdy sa nedopočíta na nulu, lebo
    „0 ks" znamená vypredané a to je iné tvrdenie než „nevieme". */
export function normalizeVariants(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter((a) => a && typeof a === 'object').map((a) => ({
        id: pick(a, ['id_product_attribute', 'id']),
        label: variantLabel(pick(a, ['values', 'value', 'name'])),
        priceImpact: num(pick(a, ['price_impact', 'priceImpact', 'impact'])),
        reference: pick(a, ['reference']),
        ean13: pick(a, ['ean13', 'ean']),
        quantity: num(pick(a, ['quantity', 'qty', 'stock'])),
        isDefault: pick(a, ['is_default']) === true || pick(a, ['is_default']) === 1,
    }));
}

export function normalizeProduct(payload) {
    const d = unwrap(payload, ['product', 'data', 'result']);
    if (pick(d, ['id']) === null) return null;
    const variants = normalizeVariants(pick(d, ['attributes', 'variants']));
    return {
        id: pick(d, ['id']),
        name: pick(d, ['name']) || '',
        price: num(pick(d, ['price'])),
        currency: pick(d, ['currency', 'currency_iso']),
        text: plain(pick(d, ['description_short']) || pick(d, ['description'])),
        hasVariants: pick(d, ['has_attributes']) === true || variants.length > 0,
        variants,
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
