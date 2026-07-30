/* Anatómia obrazovky — zdieľané stavebné bloky pre všetkých 7 obrazoviek.

   Aura anatómia (docs/UX-PLAN-AURA-PARITA.md §G4): `.page-stack` (vertikálny flow
   s `--section-gap`) → `.eyebrow` + `h1` → `.kpi-grid` → `.card` sekcie.
   Triedy `.page-stack`, `.eyebrow`, `.kpi-*` implementuje P9 v `components/**`;
   `screens/screen-base.css` (P10) drží nízkospecifický základ, aby anatómia
   fungovala aj kým P9 svoje komponenty nedodá — P9 ho neskorším @importom prebije.

   Prečo tu a nie v core/dom.js: `core/**` je zamknuté zdieľané rozhranie (§3.1).
   `emptyHtml()` z core vie len ikonu + text; obrazovky potrebujú prázdny stav
   s nadpisom, vysvetlením a akciou. */

import { esc } from '../../core/dom.js';

/* ---------- sekcie ---------- */

/** Sekcia s hlavičkou. Používa rodinné `.section-head` / `.section-title` z P9.
    `note` je tichý mono doplnok vpravo, `lead` je hotový HTML pred nadpisom
    (napr. farebná bodka oblasti v Knižnici). */
export function sectionHtml(title, bodyHtml, opts = {}) {
    const note = opts.note ? '<span class="sec-note">' + esc(opts.note) + '</span>' : '';
    const cls = 'screen-sec' + (opts.cls ? ' ' + opts.cls : '');
    const id = opts.id ? ' id="' + opts.id + '"' : '';
    return '<section class="' + cls + '"' + id + '>'
        + '<div class="section-head"><h2 class="section-title">'
        + (opts.lead || '') + esc(title) + '</h2>' + note + '</div>'
        + bodyHtml + '</section>';
}


/** Rad drobných akcií / filtrov nad obsahom. */
export function toolbarHtml(innerHtml, opts = {}) {
    const cls = 'screen-toolbar' + (opts.cls ? ' ' + opts.cls : '');
    return '<div class="' + cls + '">' + innerHtml + '</div>';
}


/* ---------- KPI ---------- */

/** Jedna KPI karta. `items` prvok: {value, label, suffix?, hero?, cert?, spark?} */
export function kpiCardHtml(item) {
    const cls = 'kpi-card' + (item.hero ? ' kpi-hero' : '');
    const cert = item.cert ? ' data-cert="' + esc(item.cert) + '"' : '';
    const suffix = item.suffix ? '<span class="kpi-suffix">' + esc(item.suffix) + '</span>' : '';
    const spark = item.spark ? '<div class="kpi-spark" id="' + esc(item.spark) + '"></div>' : '';
    return '<div class="' + cls + '"' + cert + '>'
        + '<div class="kpi-val tnum">' + esc(String(item.value ?? 0)) + suffix + '</div>'
        + '<div class="kpi-label">' + esc(item.label) + '</div>'
        + spark + '</div>';
}


/** KPI pás. Prázdny vstup nevykreslí nič (žiadna prázdna mriežka). */
export function kpiGridHtml(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return '';
    return '<div class="kpi-grid">' + list.map(kpiCardHtml).join('') + '</div>';
}


/* ---------- prázdne a chybové stavy ---------- */

/** Zmysluplný prázdny stav: ikona + veta + vysvetlenie + (voliteľná) akcia.
    `action` = {id, label, icon} — obrazovka si tlačidlo sama nadrôtuje. */
export function emptyStateHtml(icon, title, hint, action) {
    const btn = action
        ? '<button type="button" class="primary empty-act" id="' + esc(action.id) + '">'
        + (action.icon ? '<span class="ms" aria-hidden="true">' + esc(action.icon) + '</span>' : '')
        + esc(action.label) + '</button>'
        : '';
    return '<div class="empty empty-state">'
        + '<span class="ms" aria-hidden="true">' + esc(icon) + '</span>'
        + '<p class="es-title">' + esc(title) + '</p>'
        + (hint ? '<p class="es-hint">' + esc(hint) + '</p>' : '')
        + btn + '</div>';
}


export function renderEmptyState(container, icon, title, hint, action) {
    if (!container) return;
    container.innerHTML = emptyStateHtml(icon, title, hint, action);
}


/** SK hláška pre ApiError. Kód je zamknutý v `core/api.js` (rozhranie #1) —
    tabuľka nižšie je jediné miesto, kde ho obrazovky prekladajú. */
const API_MSG = {
    unauthorized: ['lock', 'Prístup zamietnutý', 'Server odmietol požiadavku (401/403).'],
    rate_limited: ['hourglass_top', 'Príliš mnoho požiadaviek', 'Skús to o chvíľu znova.'],
    unavailable:  ['cloud_off', 'Služba je nedostupná', 'Server sa práve nedá zastihnúť (503).'],
    timeout:      ['timer_off', 'Odpoveď neprišla načas', 'Server odpovedá pomaly — skús znova.'],
    aborted:      ['block', 'Požiadavka zrušená', null],
    offline:      ['wifi_off', 'Si offline', 'AuraAI beží lokálne — skontroluj, či je stack spustený.'],
    server:       ['cloud_off', 'Nepodarilo sa načítať', 'Server vrátil chybu.'],
    bad_request:  ['error_outline', 'Neplatná požiadavka', 'Skontroluj vstup a skús znova.'],
};

/** @returns {{icon:string, title:string, hint:?string}} */
export function describeApiError(err) {
    const meta = API_MSG[err && err.code] || API_MSG.server;
    return { icon: meta[0], title: meta[1], hint: meta[2] };
}


/** Chybový stav obrazovky s tlačidlom „Skúsiť znova". */
export function renderApiError(container, err, retry) {
    if (!container) return;
    const d = describeApiError(err);
    container.innerHTML = emptyStateHtml(d.icon, d.title, d.hint,
        retry ? { id: 'retry-' + Math.random().toString(36).slice(2, 8), label: 'Skúsiť znova', icon: 'refresh' } : null);
    const btn = container.querySelector('.empty-act');
    if (btn && retry) btn.onclick = retry;
}


/* ---------- skeleton ---------- */

/** Shimmer blok danej šírky/výšky. */
export function barHtml(w, h) {
    return '<div class="shimmer" style="width:' + w + ';height:' + h + ';border-radius:var(--r-md);"></div>';
}


/** Skeleton zoznamu — `rows` riadkov rovnakej výšky. */
export function listSkeletonHtml(rows, h = '44px') {
    return '<div class="skel-stack">'
        + Array.from({ length: rows }, () => barHtml('100%', h)).join('')
        + '</div>';
}
