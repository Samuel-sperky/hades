/* Filtre dopytu pre paletu (Ctrl+K).

   Do 20. 8. 2026 tu žila aj `renderSearch()` — 70 riadkov, ktoré kreslili výsledky
   do `#search-results`. Ten prvok v `mind.blade.php` NEEXISTUJE a jediným vstupom
   hľadania je paleta (`cmdk.js`), ktorá si odtiaľto berie len dve funkcie nižšie.
   Kód teda nikdy nebežal a bol pascou: kto by v ňom opravil chybu, opravil by nič.
   Zmazané aj s piatimi importmi, ktoré držal pri živote. */

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
