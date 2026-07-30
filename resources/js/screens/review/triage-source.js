/* Zdroj kandidátov pre frontu „bez istoty".

   PREFEROVANÁ CESTA: `GET /api/knowledge?certainty=bez` — presne to isté, čo už
   vie `KnowledgeController::index` (filter `bez` tam existuje), len bez Bearer
   tokenu, ako ostatné interné SPA endpointy. Jednoriadkový patch do routes/api.php
   vlastní P4 a je v reporte P10.

   DETERMINISTICKÝ FALLBACK (funguje dnes, bez patchu): `GET /api/mind?scope=all`
   vracia `certainty` na každom uzle, takže kandidátov vieme vytriediť klientsky.
   Payload je ~684 uzlov a načíta sa len keď používateľ tú frontu naozaj otvorí.

   Železné pravidlo 10: keď padne aj to, obrazovka ukáže zmysluplný stav, nie chybu. */

import { apiGet } from '../../core/api.js';
import { triageCandidates } from './coverage.js';

/** @returns {Promise<{items: Array, source: 'knowledge'|'graph'}>} */
export async function loadUnmarked(limit = 60) {
    try {
        const d = await apiGet('/api/knowledge', {
            retry: 0,
            query: { certainty: 'bez', limit },
        });
        const items = d.items || d.data || d.nodes || [];
        if (Array.isArray(items)) return { items, source: 'knowledge' };
    } catch (e) {
        // endpoint ešte nie je verejný pre SPA — ide sa cez graf
    }

    const d = await apiGet('/api/mind', { query: { scope: 'all' } });
    return { items: triageCandidates(d.nodes || [], limit), source: 'graph' };
}
