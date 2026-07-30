/* Obrazovka Knižnica — skilly zoskupené po oblastiach (/api/library).

   Anatómia: hlavička (blade) → .screen-toolbar s filtračným polom → sekcie
   oblastí. Filter má debounce 220 ms a zachováva posledný dopyt v poli, takže
   prázdny výsledok vie povedať „nič pre X", nie len „prázdno".

   Pozn.: pôvodne tu bol aj komentárový blok o obrazovke Smernica — zvyšok
   mechanického rozsekania monolitu vo W0. Smernica žije v screens/directive.js. */

import { apiGet } from '../core/api.js';
import { $, esc } from '../core/dom.js';
import { bindPackButtons, packBtn } from '../dock/pack.js';
import { openMdOverlay } from '../node/md-overlay.js';
import { listSkeletonHtml, renderApiError, renderEmptyState, sectionHtml } from './shared/anatomy.js';
import { certBadge } from './shared/cert.js';
import { originBadge } from './shared/origin-badge.js';


let libraryTimer = null;


// Meta riadok skillu — origin + istota (ikona) + značky.
function libMeta(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const chips = tags.slice(0, 5).map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    const cert = s.certainty ? certBadge(s.certainty, true) : '';
    return '<span class="lib-skill-meta">' + originBadge(s.origin) + cert + chips + '</span>';
}


function libSkillHtml(s) {
    return '<div class="li-wrap lib-wrap">'
        + '<button type="button" class="lib-skill" data-id="' + s.id + '" data-label="' + esc(s.label) + '"'
        + (s.path ? ' data-path="' + esc(s.path) + '"' : '') + '>'
        + '<span class="lib-skill-label">' + esc(s.label) + '</span>'
        + (s.snippet ? '<span class="lib-skill-snip">' + esc(s.snippet) + '</span>' : '')
        + libMeta(s)
        + '</button>'
        + packBtn(s.id, s.label) + '</div>';
}


function libAreaHtml(a) {
    const skills = a.skills || [];
    return sectionHtml(a.name,
        '<div class="lib-skills">' + skills.map(libSkillHtml).join('') + '</div>', {
            cls: 'lib-area',
            note: skills.length + ' skillov',
            lead: '<span class="lib-dot" style="background:' + esc(a.color || 'var(--muted)') + '"></span>',
        });
}


export async function renderLibrary() {
    const body = $('library-body');
    if (!body) return;
    const input = $('library-search');
    const q = ((input && input.value) || '').trim();
    body.innerHTML = listSkeletonHtml(4, '72px');

    let d;
    try {
        d = await apiGet('/api/library', { query: q ? { q } : null });
    } catch (e) {
        renderApiError(body, e, renderLibrary);
        return;
    }

    const areas = (d.areas || []).filter((a) => (a.skills || []).length);
    if (!areas.length) {
        if (q) {
            renderEmptyState(body, 'search_off', 'Nič sa nenašlo pre „' + q + '"',
                'Skús kratší výraz — filter hľadá v názve aj v úryvku skillu.',
                { id: 'lib-clear', label: 'Zrušiť filter', icon: 'close' });
            const clear = body.querySelector('#lib-clear');
            if (clear) clear.onclick = () => { if (input) input.value = ''; renderLibrary(); };
        } else {
            renderEmptyState(body, 'menu_book', 'Knižnica je prázdna',
                'Skilly sa do nej dostanú indexáciou .md mozgu (brain-sync) alebo z sessions.');
        }
        return;
    }

    body.innerHTML = areas.map(libAreaHtml).join('');
    body.querySelectorAll('.lib-skill[data-id]').forEach((el) => {
        el.onclick = () => openMdOverlay({ id: +el.dataset.id, label: el.dataset.label, path: el.dataset.path || null });
    });
    bindPackButtons(body);
}


/* Knižnica — filter skillov (debounce) */
export function register(root) {
    const inp = root.querySelector('#library-search');
    if (!inp) return;
    inp.oninput = () => {
        clearTimeout(libraryTimer);
        libraryTimer = setTimeout(renderLibrary, 220);
    };
}
