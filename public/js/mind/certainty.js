import { originBadge } from './screens/dnes.js';
import { $, esc } from './util.js';
import { iconMarkup } from '../shared/icons.js';

/* ---------- certainty badge (.cert) — zdieľaný helper (F3; F4 ho reuse-uje) ----
   §4.5/§4.8: data-cert="overene|hypoteza|pasca|bez|pending"; ikony
   verified/science/warning/radio_button_unchecked/pending. iconOnly = .cert--icon. */
/* POZOR: `pending` NIE JE úroveň istoty. Backend pozná len overene / hypoteza /
   pasca (MindService::certainty_levels) a `bez` je „bez značky". `pending` je čisto
   UI odznak pre `needs_review` — a hovoril „Neštruktúrované", čo je iný pojem než
   ten, ktorý appka používa všade inde („čaká na overenie": hero na Dnes, podtitul
   Kontroly, texty toastov). Kľúč zostáva, je to CSS hook (data-cert="pending");
   mení sa iba to, čo číta človek v tooltipe. */
export const CERT_META = {
    overene: ['shield-check', 'Overené'],
    hypoteza: ['flask', 'Hypotéza'],
    pasca: ['alert-triangle', 'Pasca'],
    pending: ['clock', 'Čaká na overenie'],
    bez: ['ring', 'Bez istoty'],
};

export function certBadge(cert, iconOnly) {
    const key = CERT_META[cert] ? cert : 'bez';
    const meta = CERT_META[key];
    return '<span class="cert' + (iconOnly ? ' cert--icon' : '') + '" data-cert="' + key + '"'
        + (iconOnly ? ' title="' + esc(meta[1]) + '"' : '') + '>'
        + iconMarkup(meta[0])
        + (iconOnly ? '' : esc(meta[1])) + '</span>';
}

// F4: badge riadok v detaile uzla — origin + cert + needs_review + značky (chipy).
// Injektovaný do #node-view za #node-type (blade patrí F1). n má polia z toApi().
export function renderNodeBadges(n) {
    const view = $('node-view');
    if (!view) return;
    let row = $('node-badges');
    if (!row) {
        row = document.createElement('div');
        row.id = 'node-badges';
        /* Kresba je v CSS (`#node-badges`), nie tu. Rozmer a rozloženie napísané
           v JS je pre CSSOM NEVIDITEĽNÉ a žiadna asercia ho nenájde — presne tak
           v tomto projekte vznikol inline `font-size: 10px` na osi grafu (viď
           komentár pri .chart-axis v mind.css). Element sa tu len vytvorí a
           pomenuje. */
        const anchor = $('node-type');
        if (anchor) anchor.insertAdjacentElement('afterend', row);
        else view.insertBefore(row, view.firstChild);
    }
    const tags = Array.isArray(n.tags) ? n.tags : [];
    const chips = tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    row.innerHTML = originBadge(n.origin)
        + (n.certainty ? certBadge(n.certainty) : '')
        + (n.needs_review ? certBadge('pending', true) : '')
        + chips;
}
