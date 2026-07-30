import { apiGet } from '../core/api.js';
import { $, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { store } from '../core/store.js';
import { persistFilter, refreshVisibility } from './filters.js';
import { apiErrorText } from './loader.js';
import { draw } from './render/draw.js';
import { showToast } from '../shell/toasts.js';

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
            store.setRaw('certRings', S.certRings ? '1' : '0');
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
        const d = await apiGet('/api/tags');
        tags = (d && d.tags) || [];
    } catch (e) {
        // 401/429/500 už nevyzerá ako „žiadne značky" — sekcia sa skryje a povie prečo
        const msg = apiErrorText(e);
        if (msg) showToast(msg, null, 'warn');
    }

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
            refreshVisibility();
            draw();
        };
    });
}


/* F4: prepínač Značky istoty + dynamický filter podľa značiek (injektované do #sec-settings) */
export function register(root) {
    setupCertTagFilter(root);
}
