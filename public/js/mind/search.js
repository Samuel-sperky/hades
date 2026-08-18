import { certBadge } from './certainty.js';
import { selectNode } from './panels.js';
import { focusNode } from './render.js';
import { originBadge } from './screens/dnes.js';
import { S } from './state.js';
import { $, emptyHtml, esc, plainText, prettyProject, typeName } from './util.js';

export let searchTimer = null;
export let searchSeq = 0;

export function renderSearch(q) {
    // F4: voliteľný cert:/tag: prefix — pf.text ide do fulltextu, cert/tag filtruje lokálne
    const pf = parseQueryFilter(q);
    const query = pf.text.toLowerCase();
    const hasCertTag = !!(pf.cert || pf.tag);
    const wrap = $('search-results');

    // Lokálne uzly — okamžité výsledky bez čakania na server
    const matches = (!query && !hasCertTag) ? [] : S.nodes
        .filter((n) => !query || (n.label + ' ' + (n.description || '')).toLowerCase().includes(query))
        .filter((n) => certTagMatch(n, pf))
        .sort((a, b) => (b.strength || 0) - (a.strength || 0))
        .slice(0, 8);

    const local = matches.map((n) =>
        '<button type="button" class="search-item" data-id="' + n.id + '"><span>' + esc(prettyProject(n.label))
        + '</span><span class="sub">' + esc(typeName(n.type))
        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '')
        + ' ' + originBadge(n.origin) + '</span></button>'
    ).join('');

    wrap.innerHTML = (local || ((query || hasCertTag) ? emptyHtml('search_off', 'Nič sa nenašlo') : ''))
        + '<div id="search-playbooks"></div>';

    wrap.querySelectorAll('.search-item').forEach((el) => {
        el.onclick = () => {
            const n = S.byId.get(+el.dataset.id);
            if (!n) return;
            S.cam.k = Math.max(S.cam.k, 1.1);
            focusNode(n);
            selectNode(n);
        };
    });

    // Fulltext (playbooky) — debounce 250 ms, od 2 znakov
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    if (query.length < 2) return;
    searchTimer = setTimeout(async () => {
        try {
            const data = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
            if (seq !== searchSeq) return;
            const pb = $('search-playbooks');
            if (!pb) return;
            const books = data.playbooks || [];
            if (!books.length) return;
            const empty = wrap.querySelector('.empty');
            if (empty) empty.remove();
            pb.innerHTML = '<div class="result-divider">Playbooky</div>'
                + books.map((b, i) =>
                    '<button type="button" class="pb-item" data-i="' + i + '">'
                    + '<span class="ms" aria-hidden="true">menu_book</span>'
                    + '<span class="pb-text"><span class="pb-title">' + esc(b.title || b.path || '') + '</span>'
                    + (b.snippet ? '<span class="pb-snippet">' + esc(plainText(b.snippet)) + '</span>' : '')
                    + '</span></button>'
                ).join('');
            pb.querySelectorAll('.pb-item').forEach((el) => {
                el.onclick = () => {
                    const b = books[+el.dataset.i];
                    const n = b && b.node_id ? S.byId.get(+b.node_id) : null;
                    if (!n) return;
                    S.cam.k = Math.max(S.cam.k, 1.1);
                    focusNode(n);
                    selectNode(n);
                };
            });
        } catch (e) { /* fulltext offline nevadí */ }
    }, 250);
}
// Voliteľný cert:/tag: prefix vo vyhľadávaní — „cert:overene", „tag:docker".
// Vráti { text, cert, tag }; cert 'bez'/'none' → null certainty.
export function parseQueryFilter(q) {
    const out = { text: String(q || ''), cert: null, tag: null };
    out.text = out.text.replace(/\b(cert|tag):(\S+)/gi, (m, k, v) => {
        if (k.toLowerCase() === 'cert') out.cert = v.toLowerCase();
        else out.tag = v.toLowerCase();
        return '';
    }).trim();
    return out;
}

// Zhoda uzla na voliteľný cert:/tag: filter (client-side, nad S.nodes).
export function certTagMatch(n, pf) {
    if (pf.cert) {
        const want = (pf.cert === 'bez' || pf.cert === 'none') ? null : pf.cert;
        if ((n.certainty || null) !== want) return false;
    }
    if (pf.tag) {
        const tags = Array.isArray(n.tags) ? n.tags : [];
        if (!tags.some((t) => String(t).toLowerCase().includes(pf.tag))) return false;
    }
    return true;
}
