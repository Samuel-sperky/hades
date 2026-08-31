import { persistFilter } from './filters.js';
import { draw } from './render.js';
import { S } from './state.js';
import { $, esc, fmtNum } from './util.js';

/* ---------- F4: prepínač Značky istoty + filter podľa značiek ----------
   Blade patrí F1, preto obidve UI injektujem z JS do existujúceho #sec-settings.
   Prepínač riadi S.certRings (canvas prstence); filter značiek plní S.filter.tags
   dynamickými checkboxami z /api/tags (pozitívny filter, perzistuje v hades.filter).

   POZOR: /api/tags vracia 3 679 značiek (2 260 z nich má count 1). Kým sa vypisovali
   všetky, filter mal 18 395 DOM prvkov, 607 kB HTML a nedal sa použiť — vybrať jednu
   značku znamenalo skrolovať tisícmi zaškrtávacích políčok. Zbalenie sekcie na tom
   nič nemení, prvky v DOM zostanú.

   Riešenie je ten istý idióm, aký už používa filtračný rad Denníka: NAJČASTEJŠIE
   + hľadanie. Konkrétne:
     - bez dopytu vidno TAG_TOP najčastejších (count = užitočný signál, /api/tags
       ich už vracia zoradené zhora),
     - hľadanie prehľadá všetkých 3 679 a vypíše najviac TAG_MAX zhôd,
     - VYBRANÉ značky sú v zozname vždy (aj keď sú mimo najčastejších a mimo dopytu),
       inak by sa aktívny filter nedal odškrtnúť,
     - tichý riadok pod zoznamom povie, koľko značiek sa nezobrazuje. */

export const TAG_TOP = 12;          // najčastejšie značky bez dopytu
export const TAG_MAX = 40;          // strop zhôd pri hľadaní
export const TAGS_TTL = 60000;      // ako dlho je zoznam značiek svieži (brain-sync pridáva nové)

export let tagsCache = null;        // [{ id, name, count }] — zoradené podľa count zhora
export let tagsAt = 0;
export let tagQuery = '';

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
            /* Bez hlásenia (J2): prepínač si sám nastaví aria-checked a plátno
               sa prekreslí, takže stav je vidieť na ovládači aj na uzloch. Toast
               hlásil to isté, čo prvok pod kurzorom. */
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
        // Hľadanie + zoznam + tichý riadok. Vstup stojí MIMO #filter-tags-list,
        // aby ho prekreslenie zoznamu (pri každom písmene) nezahodilo s fokusom.
        // .preset-state nesie „tichý mono riadok v nastaveniach" (ten istý hlas ako
        // „aktívna: Živé" nad predvoľbami). .check-cap by tu bol zle: je uppercase,
        // takže z vety by kričala kapitálka.
        box.innerHTML = '<input id="filter-tags-search" type="search" autocomplete="off"'
            + ' placeholder="Hľadať značku…" aria-label="Hľadať značku">'
            + '<div id="filter-tags-sel"></div>'
            + '<div id="filter-tags-list"></div>'
            + '<p id="filter-tags-note" class="preset-state"></p>';
        const shRow = $('softhover-toggle') ? $('softhover-toggle').closest('.switch-row') : null;
        if (shRow) { shRow.insertAdjacentElement('beforebegin', box); box.insertAdjacentElement('beforebegin', cap); }
        else { sec.appendChild(cap); sec.appendChild(box); }

        const inp = $('filter-tags-search');
        inp.oninput = () => { tagQuery = inp.value; renderTagFilter(); };
        /* Esc v hľadaní zmaže dopyt a NEprebublá do globálnej kaskády — inak prvý Esc
           zavrel celý panel a človek stratil aj to, čo si vyfiltroval. Keď je dopyt
           už prázdny, Esc naopak prebublať MUSÍ: inak sa panel z tohto vstupu nedá
           zavrieť vôbec a klávesnica sa v ňom zasekne. */
        inp.onkeydown = (e) => {
            if (e.key !== 'Escape' || inp.value === '') return;
            e.stopPropagation();
            inp.value = '';
            tagQuery = '';
            renderTagFilter();
        };
    }
    loadTagFilter();
}

export async function loadTagFilter() {
    const box = $('filter-tags');
    if (!box) return;

    // Sekcia sa otvára aj viackrát za session (dock.js) — 152 kB /api/tags pri každom
    // otvorení je zbytočné. Cache s TTL: nové značky z brain-syncu sa aj tak objavia.
    if (!tagsCache || Date.now() - tagsAt > TAGS_TTL) {
        try {
            const d = await (await fetch('/api/tags')).json();
            tagsCache = Array.isArray(d.tags) ? d.tags : [];
            tagsAt = Date.now();
        } catch (e) {
            // offline — čo je v cache, to zobrazíme; bez cache sa sekcia skryje
        }
    }
    renderTagFilter();
}

// Riadok jednej značky. count == null = značku už /api/tags nepozná (zmizla z dát),
// takže počet nemá — ale odškrtnúť sa dá, čo je celý zmysel jej zobrazenia.
export function tagRowHtml(name, count) {
    return '<label class="check"><input type="checkbox" data-ftag="' + esc(name) + '"'
        + (S.filter.tags.has(name) ? ' checked' : '') + '>'
        + '<span class="box" aria-hidden="true"></span>'
        + '<span>' + esc(name)
        + (count != null ? '<span class="chip-n">' + esc(fmtNum(count)) + '</span>' : '')
        + '</span></label>';
}

export function renderTagFilter() {
    const box = $('filter-tags');
    const cap = $('filter-tags-cap');
    if (!box) return;
    const tags = tagsCache || [];

    // žiadne značky (a nič vybrané) → sekcia sa nezobrazí, žiadny prázdny caption
    if (!tags.length && !S.filter.tags.size) {
        box.style.display = 'none';
        if (cap) cap.style.display = 'none';
        return;
    }
    box.style.display = '';
    if (cap) cap.style.display = '';

    const byName = new Map(tags.map((t) => [t.name, t]));
    const q = tagQuery.trim().toLowerCase();

    // 1) vybrané značky — vždy vidieť, inak sa filter nedá zrušiť
    const selected = [...S.filter.tags];
    const selHtml = selected.map((name) => {
        const t = byName.get(name);
        return tagRowHtml(name, t ? t.count : null);
    }).join('');
    const selBox = $('filter-tags-sel');
    if (selBox) {
        selBox.innerHTML = selected.length
            ? selHtml + '<button type="button" id="filter-tags-clear" class="chip">'
              + 'Zrušiť výber (' + selected.length + ')</button>'
            : '';
    }

    // 2) ponuka — bez dopytu najčastejšie, s dopytom zhody (obe bez už vybraných)
    const pool = q ? tags.filter((t) => String(t.name).toLowerCase().includes(q)) : tags;
    const rest = pool.filter((t) => !S.filter.tags.has(t.name));
    const shown = rest.slice(0, q ? TAG_MAX : TAG_TOP);
    const list = $('filter-tags-list');
    if (list) list.innerHTML = shown.map((t) => tagRowHtml(t.name, t.count)).join('');

    /* 3) tichý riadok — hovorí LEN keď je čo dodať: koľko značiek sa nezobrazuje,
       alebo že sa nezhoduje žiadna. Keď je vidieť celý výsledok, riadok mlčí —
       „9 zhôd" nad deviatimi viditeľnými riadkami je šum (a v slovenčine navyše
       potrebuje tri tvary čísla pre nulovú informáciu). */
    const note = $('filter-tags-note');
    if (note) {
        const hidden = rest.length - shown.length;
        if (q && rest.length === 0) note.textContent = 'Žiadna značka sa nezhoduje';
        else if (hidden <= 0) note.textContent = '';
        else if (q) note.textContent = 'prvých ' + shown.length + ' z ' + fmtNum(rest.length) + ' — spresni hľadanie';
        else note.textContent = 'najčastejších ' + shown.length + ' z ' + fmtNum(tags.length) + ' — ostatné nájdeš hľadaním';
    }

    wireTagFilter(box);
}

export function wireTagFilter(box) {
    box.querySelectorAll('input[data-ftag]').forEach((inp) => {
        inp.onchange = () => {
            const val = inp.dataset.ftag;
            if (inp.checked) S.filter.tags.add(val); else S.filter.tags.delete(val);
            persistFilter();
            renderTagFilter();   // vybraná značka sa presunie nahor (a naopak)
            // Prekreslenie vymení DOM aj pod fokusom — bez tohto by po zaškrtnutí
            // klávesnicou fokus spadol na <body> a ďalší Tab začínal od začiatku
            // panela. Keď značka zo zoznamu vypadla (odškrtnutá a mimo najčastejších),
            // fokus preberá hľadanie, teda najbližšie zmysluplné miesto.
            const again = box.querySelector('input[data-ftag="' + CSS.escape(val) + '"]');
            const fallback = $('filter-tags-search');
            if (again) again.focus(); else if (fallback) fallback.focus();
            draw();
        };
    });
    const clear = $('filter-tags-clear');
    if (clear) clear.onclick = () => {
        S.filter.tags.clear();
        persistFilter();
        renderTagFilter();
        draw();
    };
}
