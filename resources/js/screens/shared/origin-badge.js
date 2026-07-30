
/* ---------- obrazovka Dnes (dashboard: /api/today + /api/dashboard) ---------- */

// Origin badge — brain (.md, zdroj pravdy) vs session (DB). §4.8 ikony menu_book/bolt.
export function originBadge(origin) {
    const o = origin === 'brain' ? 'brain' : 'session';
    const icon = o === 'brain' ? 'menu_book' : 'bolt';
    return '<span class="origin" data-origin="' + o + '">'
        + '<span class="ms" aria-hidden="true">' + icon + '</span>' + o + '</span>';
}
