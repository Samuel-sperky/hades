/* E-shop — dátumové okno a filtre zoznamu objednávok.

   API v2 vie `date_from`, `date_to`, `country`, `total_min`, `total_max`
   (overené: `date_from=2026-07-30&date_to=2026-07-30` → `total=220`, bez filtra
   1 764 133), takže obrazovka ich smie vystaviť.

   POVINNÉ OBMEDZENIE (rozhodnutie 8): `total_min` je aktívny LEN vtedy, keď je
   vybraná krajina. Bez krajiny sa filtruje cez všetky meny naraz a „nad 100"
   potom znamená v HUF drobné a v EUR veľkú objednávku — výsledné číslo by nič
   neznamenalo. Preto je vstup `disabled` a hneď pod ním je napísané prečo. */

import { esc } from '../../core/dom.js';
import { TOTAL_MIN_NOTE, windowRange } from './data.js';

/** Ponuka okien. Popiska sa berie odtiaľto, hodnota `window.days` z API. */
export const WINDOWS = [7, 30, 90];

/** Živý stav filtrov obrazovky. Mutovateľný plain objekt (ako slices v core). */
export const filters = { days: WINDOWS[0], country: '', totalMin: null };

let countryList = [];

/** Zoznam krajín do ponuky. Berie sa z `summary.countries` — nič sa nehádá,
    takže kým rozpad nedorazí, ponuka je prázdna a filter sumy zostáva zamknutý. */
export function setCountries(list) {
    countryList = (list || []).filter((c) => c && c.iso && c.iso !== '—');
    if (filters.country && !countryList.some((c) => c.iso === filters.country)) {
        filters.country = '';
        filters.totalMin = null;
    }
}

/** Parametre pre `GET api/eshop/orders`. `total_min` sa pripojí len s krajinou. */
export function orderQuery(page, perPage) {
    const r = windowRange(filters.days);
    const q = { page, per_page: perPage, date_from: r.from, date_to: r.to };
    if (filters.country) {
        q.country = filters.country;
        if (filters.totalMin !== null) q.total_min = filters.totalMin;
    }
    return q;
}

/** Krátky popis aktívneho filtra do poznámky sekcie. */
export function filterSummary() {
    const r = windowRange(filters.days);
    const parts = [r.from + ' – ' + r.to];
    if (filters.country) parts.push(filters.country);
    if (filters.country && filters.totalMin !== null) parts.push('od ' + filters.totalMin);
    return parts.join(' · ');
}


/* ---------- prepínač okna ---------- */

export function renderWindow(host, onChange) {
    if (!host) return;
    host.innerHTML = WINDOWS.map((d) => (
        '<button type="button" class="chip chip--action es-win" data-days="' + d + '"'
        + ' aria-pressed="' + (filters.days === d ? 'true' : 'false') + '"'
        + ' aria-label="Zobraziť okno ' + d + ' dní">' + d + ' dní</button>'
    )).join('');
    host.querySelectorAll('.es-win').forEach((b) => {
        b.onclick = () => {
            const days = Number(b.dataset.days);
            if (days === filters.days) return;
            filters.days = days;
            renderWindow(host, onChange);
            if (onChange) onChange();
        };
    });
}


/* ---------- filtre zoznamu objednávok ---------- */

function countryOptions() {
    return '<option value="">Všetky krajiny</option>'
        + countryList.map((c) => (
            '<option value="' + esc(c.iso) + '"' + (filters.country === c.iso ? ' selected' : '') + '>'
            + esc(c.name ? c.name + ' (' + c.iso + ')' : c.iso) + '</option>'
        )).join('');
}

function whyText(locked, noCountries) {
    if (noCountries) {
        return 'Rozpad podľa krajín ešte nedorazil, takže ponuka krajín je prázdna a filter sumy '
            + 'zostáva zamknutý. ' + TOTAL_MIN_NOTE;
    }
    return locked ? TOTAL_MIN_NOTE
        : 'Filtruje objednávky vybranej krajiny — hodnota je v mene tých objednávok.';
}

export function renderFilters(host, onChange) {
    if (!host) return;
    const locked = !filters.country;
    const noCountries = countryList.length === 0;
    host.innerHTML = '<div class="es-frow">'
        + '<label class="es-flabel" for="eshop-country">Krajina</label>'
        + '<select class="es-fsel" id="eshop-country" aria-label="Filtrovať objednávky podľa krajiny"'
        + (noCountries ? ' disabled' : '') + '>' + countryOptions() + '</select>'
        + '<label class="es-flabel" for="eshop-total-min">Suma od</label>'
        + '<input class="es-finput" id="eshop-total-min" type="number" min="0" step="1"'
        + ' inputmode="numeric" aria-describedby="eshop-total-min-why"'
        + ' value="' + (filters.totalMin === null ? '' : esc(String(filters.totalMin))) + '"'
        + (locked ? ' disabled' : '') + '>'
        + '<button type="button" class="chip chip--action" id="eshop-filter-reset"'
        + ' aria-label="Zrušiť filtre objednávok">'
        + '<span class="ms" aria-hidden="true">filter_alt_off</span>Zrušiť</button>'
        + '</div>'
        + '<p class="es-note' + (locked ? ' es-note--lock' : '') + '" id="eshop-total-min-why">'
        + esc(whyText(locked, noCountries)) + '</p>';

    const sel = host.querySelector('#eshop-country');
    const min = host.querySelector('#eshop-total-min');
    const reset = host.querySelector('#eshop-filter-reset');

    if (sel) {
        sel.onchange = () => {
            filters.country = sel.value;
            if (!filters.country) filters.totalMin = null;
            renderFilters(host, onChange);
            if (onChange) onChange();
        };
    }
    if (min) {
        min.onchange = () => {
            if (!filters.country) return;          // dvojitá zámka k atribútu disabled
            const v = Math.trunc(Number(min.value));
            filters.totalMin = min.value === '' || !Number.isFinite(v) || v < 0 ? null : v;
            if (onChange) onChange();
        };
    }
    if (reset) {
        reset.onclick = () => {
            filters.country = '';
            filters.totalMin = null;
            renderFilters(host, onChange);
            if (onChange) onChange();
        };
    }
}
