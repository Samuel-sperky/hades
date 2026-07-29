/**
 * Z JSON payloadu odvodí TVAR (kľúče + typy), nie hodnoty.
 *
 * Zmysel: `/api/v1/*` je zachovaný verzovaný kontrakt, ktorý zdieľa controllery
 * s internými `/api/*`. Refaktor 22 controllerov by mohol tichým spôsobom zmeniť
 * tvar odpovede. Hodnoty sa menia s dátami každých 10 minút (ingest), takže sa
 * porovnávať nedajú — tvar áno.
 *
 * Polia sa zlúčia do jedného reprezentanta (union kľúčov všetkých prvkov), aby
 * chýbajúci nullable kľúč v prvom prvku nespôsobil falošný rozdiel.
 *
 * Použitie: node derive-shapes.mjs   (v tests/snapshots/)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Objekty, ktorých KĽÚČE sú dáta, nie kontrakt — zbalia sa na "*".
 *
 * `mind_stats.by_area` má ako kľúče ID oblastí, `journal.projects` názvy projektov.
 * Bez zbalenia by tvar zakonzervoval konkrétne ID a názvy z produkčnej DB a test by
 * padal v každom inom prostredí.
 *
 * Zámerne NIE heuristika „všetky hodnoty majú rovnaký tvar" — tá by zbalila aj pevné
 * slovníky ako `by_type` (core/memory/project/skill) alebo `counts`, a tie kontrakt SÚ.
 */
const DICT_PATHS = new Set([
    'by_area',
    'projects',
]);

function shape(value, path = '') {
    if (value === null) return 'null';
    if (Array.isArray(value)) {
        if (value.length === 0) return ['empty'];
        // Union tvarov VŠETKÝCH prvkov, nie len prvého. Skalárne typy sa spájajú do
        // "null|string", aby nullable stĺpec (napr. edges.relation) nezávisel na tom,
        // aký bol posledný prvok v náhodnej dávke dát.
        const merged = {};       // zlúčené kľúče objektových prvkov
        let nested = null;       // prvky, ktoré sú samé polia (pole polí)
        const scalars = new Set(); // skalárne typy prvkov
        for (const item of value) {
            const s = shape(item, path + '[]');
            if (s && typeof s === 'object' && !Array.isArray(s)) {
                for (const [k, v] of Object.entries(s)) {
                    merged[k] = merged[k] === undefined ? v : unionType(merged[k], v);
                }
            } else if (Array.isArray(s)) {
                nested = nested === null ? s : unionType(nested, s);
            } else {
                scalars.add(s);
            }
        }
        if (Object.keys(merged).length) return [sortObject(merged)];
        if (nested !== null) return [nested];
        return [[...scalars].sort().join('|') || 'empty'];
    }
    if (typeof value === 'object') {
        const leaf = path.split('.').pop();
        if (DICT_PATHS.has(leaf)) {
            // slovník s dátovými kľúčmi — zachová sa len tvar hodnoty pod "*"
            const values = Object.values(value);
            if (values.length === 0) return { '*': 'empty' };
            let merged = shape(values[0], path + '.*');
            for (const v of values.slice(1)) merged = unionType(merged, shape(v, path + '.*'));
            return { '*': merged };
        }

        const out = {};
        for (const k of Object.keys(value)) {
            out[k] = shape(value[k], path === '' ? k : path + '.' + k);
        }
        return sortObject(out);
    }
    return typeof value; // string | number | boolean
}

function sortObject(o) {
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/** Spojí dva tvary toho istého kľúča. Skaláry do "null|string", objekty rekurzívne. */
function unionType(a, b) {
    if (JSON.stringify(a) === JSON.stringify(b)) return a;

    if (typeof a === 'string' && typeof b === 'string') {
        return [...new Set([...a.split('|'), ...b.split('|')])].sort().join('|');
    }

    // objekt vs objekt — zlúč kľúče
    if (a && b && typeof a === 'object' && !Array.isArray(a) && typeof b === 'object' && !Array.isArray(b)) {
        const out = { ...a };
        for (const [k, v] of Object.entries(b)) {
            out[k] = out[k] === undefined ? v : unionType(out[k], v);
        }
        return sortObject(out);
    }

    // objekt vs "null" (nullable vnorený objekt) — objekt vyhrá, nullabilitu drží marker
    if (a === 'null') return b;
    if (b === 'null') return a;

    return JSON.stringify(a) < JSON.stringify(b) ? a : b;
}

const files = readdirSync(here).filter((f) => f.endsWith('.json') && !f.endsWith('.shape.json'));
let written = 0;

for (const f of files) {
    const raw = readFileSync(join(here, f), 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        console.error(`PRESKOCENE (nevalidny JSON): ${f}`);
        continue;
    }
    const out = f.replace(/\.json$/, '.shape.json');
    writeFileSync(join(here, out), JSON.stringify(shape(parsed, ''), null, 2) + '\n', 'utf8');
    written++;
    console.log(`${out}`);
}

console.log(`\nOdvodenych tvarov: ${written}`);
