/* Tenká vrstva hash routingu pre MAPU.

   Formát:
     #mapa
     #mapa/<area-slug>
     #mapa/<area-slug>/<dept-slug>
     #mapa/<area-slug>/<dept-slug>/<node-id>

   Čisté funkcie parse/format — stavový stroj (map/state.js) ich používa a sám
   drôtuje window 'hashchange' / 'popstate'. Appka dnes hash nemá, takže toto je
   jediné miesto, ktoré ho pozná. */


/** Zostav hash z aktuálneho stavu + rozlíšených objektov oblasti/oddelenia. */
export function formatHash(state, area, dept) {
    let h = '#mapa';
    if ((state.level === 'area' || state.level === 'dept' || state.level === 'node') && area) {
        h += '/' + area.slug;
        if ((state.level === 'dept' || state.level === 'node') && dept) {
            h += '/' + dept.slug;
            if (state.level === 'node' && state.nodeId != null) h += '/' + state.nodeId;
        }
    }
    return h;
}


/** Rozparsuj hash na { level, area, dept, node } proti danému layoutu. */
export function parseHash(hash, layout) {
    const raw = String(hash || '').replace(/^#/, '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length || parts[0].toLowerCase() !== 'mapa') return { level: 'map' };

    const areaSlug = parts[1];
    const deptSlug = parts[2];
    const nodeRaw = parts[3];
    if (!areaSlug) return { level: 'map' };

    const area = [...layout.areas].find((a) => a.slug === areaSlug);
    if (!area) return { level: 'map' };
    if (!deptSlug) return { level: 'area', area: area.id };

    const dept = area.depts.find((d) => d.slug === deptSlug);
    if (!dept) return { level: 'area', area: area.id };
    if (!nodeRaw) return { level: 'dept', dept: dept.id };

    const nodeId = Number(nodeRaw);
    const leaf = dept.leaves.find((l) => l.id === nodeId);
    if (!leaf) return { level: 'dept', dept: dept.id };
    return { level: 'node', node: leaf.id };
}
