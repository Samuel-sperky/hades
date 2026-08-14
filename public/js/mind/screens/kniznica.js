import { certBadge } from '../certainty.js';
import { openMdOverlay } from '../md.js';
import { bindPackButtons, packBtn } from '../pack.js';
import { originBadge } from './dnes.js';
import { mutedColor } from '../theme.js';
import { $, esc, plainText, renderEmpty, renderLoading } from '../util.js';

/* ---------- obrazovka Knižnica (/api/library) ---------- */


// F4: meta riadok skillu v Knižnici — origin + cert (icon) + značky (chipy).
export function libMeta(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const chips = tags.slice(0, 5).map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    const cert = s.certainty ? certBadge(s.certainty, true) : '';
    const parts = originBadge(s.origin) + cert + chips;
    return '<span class="lib-skill-meta" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">'
        + parts + '</span>';
}

// Poradové číslo dotazu — filtrovanie je debouncované (controls.js, 220 ms), ale
// nie serializované, takže pomalšia STARŠIA odpoveď dokáže prepísať novšiu a v
// zozname zostane výsledok pre predchádzajúci výraz. Guard zahodí všetko, čo už
// nie je posledný dotaz.
let librarySeq = 0;

export async function renderLibrary() {
    const body = $('library-body');
    if (!body) return;
    const seq = ++librarySeq;
    const q = ($('library-search').value || '').trim();
    // Načítavaciu značku ukazujeme LEN keď nie je čo zachovať. Pri filtrovaní
    // zoznam necháme stáť a iba ho ztlmíme — inak obrazovka pri každom stlačení
    // klávesy zablikala naprázdno (a s výraznejšou značkou to bije ešte viac).
    const hasList = !!body.querySelector('.lib-area');
    if (hasList) body.classList.add('is-stale');
    else renderLoading(body, 'Načítavam knižnicu…');
    try {
        const url = '/api/library' + (q ? ('?q=' + encodeURIComponent(q)) : '');
        const d = await (await fetch(url)).json();
        if (seq !== librarySeq) return;                 // medzitým prišiel novší dotaz
        body.classList.remove('is-stale');
        const areas = d.areas || [];
        if (!areas.length) {
            renderEmpty(body, 'menu_book',
                q ? 'Nič sa nenašlo' : 'Knižnica je prázdna',
                q ? 'Skús kratší výraz.' : 'Playbooky sa tu objavia, keď ich Hades dostane.');
            return;
        }
        body.innerHTML = areas.map((a) =>
            '<section class="lib-area"><h2>'
            + '<span class="lib-dot" style="background:' + esc(a.color ? mutedColor(a.color) : 'var(--muted)') + '"></span>'
            + esc(a.name) + '<span class="lib-count">' + (a.skills ? a.skills.length : 0) + '</span></h2>'
            + '<div class="lib-skills">'
            + (a.skills || []).map((s) =>
                '<div class="li-wrap lib-wrap">'
                + '<button type="button" class="lib-skill" data-id="' + s.id + '" data-label="' + esc(s.label) + '"'
                + (s.path ? ' data-path="' + esc(s.path) + '"' : '') + '>'
                + '<span class="lib-skill-label">' + esc(s.label) + '</span>'
                // popis playbooku je markdown — v náhľade z neho chceme len text
                + (s.snippet ? '<span class="lib-skill-snip">' + esc(plainText(s.snippet)) + '</span>' : '')
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
        if (seq !== librarySeq) return;
        body.classList.remove('is-stale');
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať knižnicu', 'Skús obnoviť stránku.');
    }
}
