import { persistFilter } from './filters.js';
import { draw } from './render.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $, esc } from './util.js';

/* ---------- F4: prepínač Značky istoty + filter podľa značiek ----------
   Blade patrí F1, preto obidve UI injektujem z JS do existujúceho #sec-settings.
   Prepínač riadi S.certRings (canvas prstence); filter značiek plní S.filter.tags
   dynamickými checkboxami z /api/tags (pozitívny filter, perzistuje v hades.filter). */
export function setupCertTagFilter() {
    const sec = $('sec-settings');
    if (!sec) return;

    // prepínač „Značky istoty" — za prepínačom „Len kostra"
    if (!$('certrings-toggle')) {
        const skRow = $('skeleton-toggle') ? $('skeleton-toggle').closest('.switch-row') : null;
        const row = document.createElement('div');
        row.className = 'switch-row';
        row.innerHTML = '<span id="certrings-label">Značky istoty</span>'
            + '<button id="certrings-toggle" class="switch" type="button" role="switch" aria-checked="'
            + (S.certRings ? 'true' : 'false') + '" aria-labelledby="certrings-label"></button>';
        if (skRow) skRow.insertAdjacentElement('afterend', row); else sec.appendChild(row);
        const btn = $('certrings-toggle');
        btn.onclick = () => {
            S.certRings = !S.certRings;
            localStorage.setItem('hades.certRings', S.certRings ? '1' : '0');
            btn.setAttribute('aria-checked', S.certRings ? 'true' : 'false');
            draw();
            showToast(S.certRings ? 'Značky istoty zapnuté' : 'Značky istoty vypnuté');
        };
    }

    // filter podľa značiek — kontajner pred prepínačom „Spojenia len pri hovere"
    if (!$('filter-tags')) {
        const cap = document.createElement('div');
        cap.className = 'check-cap';
        cap.id = 'filter-tags-cap';
        cap.textContent = 'Značky';
        const box = document.createElement('div');
        box.id = 'filter-tags';
        const shRow = $('softhover-toggle') ? $('softhover-toggle').closest('.switch-row') : null;
        if (shRow) { shRow.insertAdjacentElement('beforebegin', box); box.insertAdjacentElement('beforebegin', cap); }
        else { sec.appendChild(cap); sec.appendChild(box); }
    }
    loadTagFilter();
}

export async function loadTagFilter() {
    const box = $('filter-tags');
    const cap = $('filter-tags-cap');
    if (!box) return;
    let tags = [];
    try {
        const d = await (await fetch('/api/tags')).json();
        tags = d.tags || [];
    } catch (e) { /* offline — bez značiek */ }

    if (!tags.length) {
        // žiadne značky → sekcia sa nezobrazí (žiadny prázdny caption)
        box.style.display = 'none';
        if (cap) cap.style.display = 'none';
        return;
    }
    box.style.display = '';
    if (cap) cap.style.display = '';

    box.innerHTML = tags.map((t) =>
        '<label class="check"><input type="checkbox" data-ftag="' + esc(t.name) + '"'
        + (S.filter.tags.has(t.name) ? ' checked' : '') + '>'
        + '<span class="box" aria-hidden="true"></span>'
        + '<span>' + esc(t.name) + (t.count != null ? ' <span class="tag-n">' + t.count + '</span>' : '') + '</span></label>'
    ).join('');

    box.querySelectorAll('input[data-ftag]').forEach((inp) => {
        inp.onchange = () => {
            const val = inp.dataset.ftag;
            if (inp.checked) S.filter.tags.add(val); else S.filter.tags.delete(val);
            persistFilter();
            draw();
        };
    });
}
