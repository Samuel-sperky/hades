import { S } from '../core/state/index.js';


export const LAYER_X = [-560, -280, 0, 280, 560];

export const LAYER_META = [
    { title: 'Vstup', sub: 'Spomienky' },
    { title: 'Skrytá', sub: 'Skills → spomienky' },
    { title: 'Jadro', sub: 'Osobnosť' },
    { title: 'Skrytá', sub: 'Skills → projekty' },
    { title: 'Výstup', sub: 'Projekty' },
];


// Zaradenie uzla do stĺpca vrstvy. Prednosť má explicitné layer_role (ak backend
// pole doplní), inak fallback na type. Skills (99) sa ešte rozdelia podľa náklonu,
// neznámy typ (-1) padá do jadra. Graceful — žiadny uzol vo Vrstvách nezmizne.
function layerIndexOf(n) {
    switch (n.layer_role) {
        case 'input': return 0;
        case 'hidden_in': return 1;
        case 'core': return 2;
        case 'hidden_out': return 3;
        case 'output': return 4;
    }
    if (n.type === 'memory') return 0;
    if (n.type === 'core') return 2;
    if (n.type === 'project') return 4;
    if (n.type === 'skill') return 99; // rozdelí sa podľa náklonu väzieb
    return -1;                         // neznámy typ → jadro (fallback)
}


function areaKey(n) { return n.area_id == null ? -1 : n.area_id; }


// Počiatočné poradie v stĺpci: podľa oblasti (súvislé farebné pásy), potom label, id.
function cmpInitial(a, b) {
    const ka = areaKey(a), kb = areaKey(b);
    if (ka !== kb) return ka - kb;
    const la = (a.label || '').toLowerCase(), lb = (b.label || '').toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a.id - b.id;
}


// Deterministický layout stĺpcov Vrstvy s barycentrovým usporiadaním (menej kríženia)
// a zoskupením podľa oblasti. Výsledok sa cachuje (S._layerCache), prepočet len pri
// štrukturálnej zmene grafu (invalidácia v buildSim).
function computeLayerColumns() {
    // plná susednosť z reálnych hrán (objekty uzlov)
    const nbr = new Map();
    for (const n of S.nodes) nbr.set(n.id, []);
    for (const e of S.edges) {
        const s = e.source, t = e.target;
        if (!s || !t || !nbr.has(s.id) || !nbr.has(t.id)) continue;
        nbr.get(s.id).push(t);
        nbr.get(t.id).push(s);
    }

    // 1) priradenie stĺpca — skills podľa náklonu (spomienky = ľavá skrytá, jadro/projekty = pravá)
    const cols = [[], [], [], [], []];
    const colOf = new Map();
    for (const n of S.nodes) {
        let li = layerIndexOf(n);
        if (li === 99) {
            let left = 0, right = 0;
            for (const m of nbr.get(n.id)) {
                if (m.type === 'memory') left++;
                else if (m.type === 'core' || m.type === 'project') right++;
            }
            li = right > left ? 3 : (left > right ? 1 : (n.id % 2 ? 3 : 1));
        } else if (li < 0) {
            li = 2;
        }
        cols[li].push(n);
        colOf.set(n.id, li);
    }

    // 2) počiatočné poradie podľa oblasti
    const pos = new Map();
    for (const arr of cols) {
        arr.sort(cmpInitial);
        arr.forEach((n, i) => pos.set(n.id, i));
    }

    // 3) barycentrové sweepy (tam a späť) — poradie podľa mediánu susedov v susedných
    //    stĺpcoch; oblasť drží súvislé pásy, barycentrum triedi vnútri pásu aj poradie pásov
    for (let iter = 0; iter < 4; iter++) {
        const forward = iter % 2 === 0;
        for (let s = 0; s < cols.length; s++) {
            const li = forward ? s : cols.length - 1 - s;
            const arr = cols[li];
            if (arr.length < 2) continue;
            const bary = new Map();
            for (const n of arr) {
                let sum = 0, cnt = 0;
                for (const m of nbr.get(n.id)) {
                    if (colOf.get(m.id) === li) continue; // vnútrostĺpcové hrany nekrížia
                    sum += pos.get(m.id); cnt++;
                }
                bary.set(n.id, cnt ? sum / cnt : pos.get(n.id));
            }
            // poradie oblastí podľa ich priemerného barycentra (pásy zostanú súvislé)
            const aSum = new Map(), aCnt = new Map();
            for (const n of arr) {
                const k = areaKey(n);
                aSum.set(k, (aSum.get(k) || 0) + bary.get(n.id));
                aCnt.set(k, (aCnt.get(k) || 0) + 1);
            }
            const aRank = new Map();
            [...aSum.keys()]
                .sort((x, y) => (aSum.get(x) / aCnt.get(x)) - (aSum.get(y) / aCnt.get(y)) || x - y)
                .forEach((k, i) => aRank.set(k, i));
            arr.sort((a, b) => {
                const ra = aRank.get(areaKey(a)), rb = aRank.get(areaKey(b));
                if (ra !== rb) return ra - rb;
                const da = bary.get(a.id), db = bary.get(b.id);
                if (da !== db) return da - db;
                return a.id - b.id;
            });
            arr.forEach((n, i) => pos.set(n.id, i));
        }
    }

    return cols;
}


// Rozdelenie veľkej vrstvy do sub-stĺpcov: dlhý stĺpec (napr. ~70 skills) je inak
// ~3300 px vysoký a fitView kvôli nemu stlačí zoom pod prah labelov. Sub-stĺpce
// znížia výšku a udržia zoom v čitateľnom pásme. Max 3 sub-stĺpce vedľa LAYER_X.
const SUB_SPLIT_AT = 22; // stĺpec dlhší ako toto sa rozloží

const SUB_MAX = 4;       // najviac sub-stĺpcov na vrstvu (drží výšku pod prahom labelov)

const SUB_OFFSET = 62;   // vodorovný rozostup sub-stĺpcov (svetové jednotky)


// Plná geometria Vrstiev — poradie stĺpcov (barycentrum) + konkrétne pozície uzlov
// vrátane sub-stĺpcov, vodiace línie, farebné pásy oblastí a bbox pre fitView.
// Jediný zdroj pravdy: applyViewPins, drawLayerBands, drawLayerScaffold aj fitView
// čítajú z tohto výsledku, takže pin, pás aj rám vždy sedia. Cache invaliduje buildSim.
export function layerLayout() {
    const sig = S.nodes.length + '|' + S.edges.length;
    if (S._layerCache && S._layerCache.sig === sig) return S._layerCache;
    const cols = computeLayerColumns();
    const posOf = new Map();
    const guides = [];
    const bands = [];
    let maxHalf = 0, minX = Infinity, maxX = -Infinity;

    for (let li = 0; li < cols.length; li++) {
        const arr = cols[li];
        const len = arr.length;
        if (!len) continue;
        const subCount = Math.min(SUB_MAX, Math.max(1, Math.ceil(len / SUB_SPLIT_AT)));
        const perSub = Math.ceil(len / subCount);
        // rozostup podľa najväčšieho sub-stĺpca — uzly sa neprekrývajú, výška ostane rozumná
        const spacing = Math.max(48, Math.min(95, 1100 / Math.max(perSub, 1)));

        for (let s = 0; s < subCount; s++) {
            const start = s * perSub;
            const end = Math.min(len, start + perSub);
            const subLen = end - start;
            if (subLen <= 0) continue;
            const x = LAYER_X[li] + (s - (subCount - 1) / 2) * SUB_OFFSET;
            const half = (subLen - 1) / 2 * spacing;
            if (half > maxHalf) maxHalf = half;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            guides.push({ x, half });

            // pozície uzlov (column-major → zachová barycentrové zvislé poradie)
            for (let k = start; k < end; k++) {
                const y = (k - start - (subLen - 1) / 2) * spacing;
                posOf.set(arr[k].id, { x, y, li });
            }

            // farebné pásy súvislých blokov rovnakej oblasti v tomto sub-stĺpci
            let i = start;
            while (i < end) {
                const aid = arr[i].area_id;
                let j = i;
                while (j + 1 < end && arr[j + 1].area_id === aid) j++;
                const area = aid != null ? S.areas.get(aid) : null;
                if (area && area.color && arr[i].type !== 'core') {
                    const y0 = (i - start - (subLen - 1) / 2) * spacing;
                    const y1 = (j - start - (subLen - 1) / 2) * spacing;
                    bands.push({ x, y0, y1, color: area.color, single: j === i, spacing });
                }
                i = j + 1;
            }
        }
    }

    if (minX === Infinity) { minX = LAYER_X[0]; maxX = LAYER_X[LAYER_X.length - 1]; }
    const layout = { sig, cols, posOf, guides, bands, maxHalf, minX, maxX };
    S._layerCache = layout;
    return layout;
}
