import { $, esc, renderEmpty } from '../core/dom.js';
import { bindPackButtons, packBtn } from '../dock/pack.js';
import { openMdOverlay } from '../node/md-overlay.js';
import { certBadge } from './shared/cert.js';
import { originBadge } from './shared/origin-badge.js';


/* ---------- obrazovka Knižnica (/api/library) ---------- */

let libraryTimer = null;


// F4: meta riadok skillu v Knižnici — origin + cert (icon) + značky (chipy).
function libMeta(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const chips = tags.slice(0, 5).map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    const cert = s.certainty ? certBadge(s.certainty, true) : '';
    const parts = originBadge(s.origin) + cert + chips;
    return '<span class="lib-skill-meta" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">'
        + parts + '</span>';
}


export async function renderLibrary() {
    const body = $('library-body');
    if (!body) return;
    renderEmpty(body, 'hourglass_empty', 'Načítavam…');
    const q = ($('library-search').value || '').trim();
    try {
        const url = '/api/library' + (q ? ('?q=' + encodeURIComponent(q)) : '');
        const d = await (await fetch(url)).json();
        const areas = d.areas || [];
        if (!areas.length) {
            renderEmpty(body, 'menu_book', q ? 'Nič sa nenašlo' : 'Prázdna knižnica');
            return;
        }
        body.innerHTML = areas.map((a) =>
            '<section class="lib-area"><h2>'
            + '<span class="lib-dot" style="background:' + esc(a.color || 'var(--muted)') + '"></span>'
            + esc(a.name) + '<span class="lib-count">' + (a.skills ? a.skills.length : 0) + '</span></h2>'
            + '<div class="lib-skills">'
            + (a.skills || []).map((s) =>
                '<div class="li-wrap lib-wrap">'
                + '<button type="button" class="lib-skill" data-id="' + s.id + '" data-label="' + esc(s.label) + '"'
                + (s.path ? ' data-path="' + esc(s.path) + '"' : '') + '>'
                + '<span class="lib-skill-label">' + esc(s.label) + '</span>'
                + (s.snippet ? '<span class="lib-skill-snip">' + esc(s.snippet) + '</span>' : '')
                + libMeta(s)
                + '</button>'
                + packBtn(s.id, s.label) + '</div>').join('')
            + '</div></section>'
        ).join('');
        body.querySelectorAll('.lib-skill[data-id]').forEach((el) => {
            el.onclick = () => openMdOverlay({ id: +el.dataset.id, label: el.dataset.label, path: el.dataset.path || null });
        });
        bindPackButtons(body);
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

/* ---------- obrazovka Smernica (/api/directive/*) ----------
   Prompt builder: úloha → Hades poskladá KDE ČO NÁJDE (skilly, projekty,
   fakty, pravidlá). Návrh je editovateľný checklist; náhľad smernice sa
   prestavuje klientsky z vybraných položiek (aby unchecked ostalo unchecked).
   Uloženie zapíše directives/<slug>.md cez /api/directive/save. */


/* Knižnica — filter skillov (debounce) */
export function register(root) {
    const inp = root.querySelector('#library-search');
    if (!inp) return;
    inp.oninput = () => {
        clearTimeout(libraryTimer);
        libraryTimer = setTimeout(renderLibrary, 220);
    };
}
