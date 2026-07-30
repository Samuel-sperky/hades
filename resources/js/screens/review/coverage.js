/* Pokrytie istoty — čisté funkcie, bez DOM. Testované v tests/js/screens/.

   PREČO TO EXISTUJE: obrazovka Kontrola bola pred P10 iba fronta `needs_review`.
   Ten príznak nastavuje backend a v reálnych dátach ho nesie 5 uzlov zo 684 —
   obrazovka teda 99 % času vyzerala rozbito, hoci vrstva istoty funguje
   (64 overených, 6 pascí). Kontrola preto ukazuje POKRYTIE a druhú frontu
   „bez istoty", aby sa tých 614 neoznačených uzlov dalo vôbec dosiahnuť.
   Rozhodnutie 132/49: značku nikdy nedopĺňa model, len človek. */

/** Uzly, ktoré má zmysel triediť: bez značky istoty a nie jadro siete. */
export function triageCandidates(nodes, limit = 60) {
    return (Array.isArray(nodes) ? nodes : [])
        .filter((n) => n && !n.certainty && n.type !== 'core')
        .sort((a, b) => (+b.strength || 0) - (+a.strength || 0) || (+b.id || 0) - (+a.id || 0))
        .slice(0, limit);
}


/** Zhrnutie bloku `certainty` z /api/dashboard na čísla pre KPI pás. */
export function coverage(cert) {
    const c = cert || {};
    const total = +c.total || 0;
    const bez = +c.bez || 0;
    const marked = Math.max(0, total - bez);
    return {
        total,
        bez,
        marked,
        overene: +c.overene || 0,
        hypoteza: +c.hypoteza || 0,
        pasca: +c.pasca || 0,
        needsReview: +c.needs_review || 0,
        pct: total ? Math.round((marked / total) * 100) : 0,
    };
}


/** Presun jedného uzla z „bez značky" do konkrétnej istoty (optimistický update
    po úspešnom verify, aby sa pokrytie hýbalo hneď a nie až po refreshi). */
export function applyMark(cert, mark) {
    const next = { ...(cert || {}) };
    if ((+next.bez || 0) > 0) next.bez = (+next.bez || 0) - 1;
    if (mark === 'overene' || mark === 'hypoteza' || mark === 'pasca') {
        next[mark] = (+next[mark] || 0) + 1;
    }
    return next;
}


/** Zníženie počtu položiek vo fronte na overenie (nikdy pod nulu). */
export function decNeedsReview(cert) {
    const next = { ...(cert || {}) };
    next.needs_review = Math.max(0, (+next.needs_review || 0) - 1);
    return next;
}


/** Oblasti zoradené podľa najhoršieho pokrytia — kde má triedenie najväčší efekt. */
export function areaCoverage(perArea) {
    return (Array.isArray(perArea) ? perArea : [])
        .map((a) => {
            const count = +a.count || 0;
            const bez = +a.bez || 0;
            return {
                name: a.name || a.slug || '',
                color: a.color || null,
                count,
                bez,
                pct: count ? Math.round(((count - bez) / count) * 100) : 0,
            };
        })
        .sort((x, y) => x.pct - y.pct || y.count - x.count);
}
