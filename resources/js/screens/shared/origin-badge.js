/* Origin badge — brain (.md, zdroj pravdy) vs session (DB). §4.8 ikony
   menu_book / bolt. Zdieľajú ho Knižnica, Rozhodnutia, Kontrola, node panel (P9)
   aj Cmd-K (P9). Nadpis o obrazovke Dnes, ktorý tu zostal po rozsekaní
   monolitu vo W0, je odstránený — patril inému súboru. */
export function originBadge(origin) {
    const o = origin === 'brain' ? 'brain' : 'session';
    const icon = o === 'brain' ? 'menu_book' : 'bolt';
    return '<span class="origin" data-origin="' + o + '">'
        + '<span class="ms" aria-hidden="true">' + icon + '</span>' + o + '</span>';
}
