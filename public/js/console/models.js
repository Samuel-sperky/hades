/* ===========================================================================
   Charón — prepínač modelu.

   Zoznam si konzola VYPÝTA na `/api/console/models`, ale nespoľahne sa na to, že
   endpoint existuje: patrí inej vlne a klient nemá dôvod padnúť, keď ešte nie je
   hotový. Ak odpoveď nedá zoznam, prepínač ukáže model vlákna a zhasne — lepšie
   než prázdny select, ktorý vyzerá ako porucha.

   Preto sa tu volá `request()` a nie `json()`: `json()` každú neúspešnú odpoveď
   ohlási do toku správ a človek by pri každom otvorení konzoly čítal
   „Požiadavka zlyhala (HTTP 404)" za niečo, čo je len nepovinná výbava.
   =========================================================================== */

import { C } from './state.js';
import { $, el } from './dom.js';
import { request, json } from './http.js';

export async function wireModels() {
    const select = $('#model-select');
    if (!select) return;

    select.addEventListener('change', () => saveModel(select));

    C.models = await probe();
    paintModels();
}

async function probe() {
    try {
        const res = await request('/api/console/models');
        if (!res.ok) return [];

        const data = await res.json();

        // Default z configu si držíme zvlášť. Vlákno bez modelu beží na ňom, a
        // bez tejto informácie by prepínač nemal čo označiť — prehliadač by
        // vybral PRVÚ položku zoznamu a tvrdil, že vlákno beží na nej. Na tomto
        // stroji je prvá `qwen3-coder:30b`, ktorý tu prvý token nevydá ani za
        // 300 s, takže ten omyl nie je kozmetický.
        if (data && typeof data === 'object' && data.default?.model) C.defaultModel = data.default.model;

        return normalize(data);
    } catch {
        return [];
    }
}

/** Zoznam môže prísť ako polia mien, objektov alebo mapa provider → modely. */
function normalize(data) {
    if (Array.isArray(data)) return data.map(one).filter(Boolean);
    if (!data || typeof data !== 'object') return [];

    if (Array.isArray(data.models)) return data.models.map(one).filter(Boolean);

    const out = [];

    Object.entries(data).forEach(([provider, list]) => {
        if (!Array.isArray(list)) return;
        list.forEach((entry) => {
            const item = one(entry);
            if (item) out.push({ ...item, provider: item.provider || provider });
        });
    });

    return out;
}

function one(entry) {
    if (typeof entry === 'string') return { id: entry, label: entry, provider: '' };
    if (!entry || typeof entry !== 'object') return null;

    const id = entry.id || entry.model || entry.name;
    if (!id) return null;

    return { id, label: entry.label || entry.name || id, provider: entry.provider || '' };
}

/** Prekreslí prepínač podľa zoznamu a modelu aktuálneho vlákna. */
export function paintModels() {
    const select = $('#model-select');
    if (!select) return;

    // Vlákno bez vlastného modelu beží na defaulte z configu — a prepínač musí
    // ukázať práve ten, nie prvú položku zoznamu.
    const current = C.thread?.model || C.defaultModel || '';
    select.innerHTML = '';

    if (C.models.length === 0) {
        const option = el('option', null, current || 'predvolený model');
        option.value = current;
        select.append(option);
        select.disabled = true;
        select.title = current
            ? `Model vlákna: ${current}. Zoznam modelov konzola nedostala.`
            : 'Konzola beží na predvolenom modeli z konfigurácie.';

        return;
    }

    select.disabled = false;
    select.title = '';

    // Model vlákna nemusí byť v zozname (stiahnutý model mohol zmiznúť) — do
    // ponuky sa aj tak pridá, inak by prepínač tvrdil, že vlákno beží na inom.
    const items = [...C.models];
    if (current && !items.some((m) => m.id === current)) items.unshift({ id: current, label: `${current} (mimo zoznam)`, provider: '' });

    items.forEach((model) => {
        const option = el('option', null, model.provider ? `${model.label} · ${model.provider}` : model.label);
        option.value = model.id;
        if (model.provider) option.dataset.provider = model.provider;
        if (model.id === current) option.selected = true;
        select.append(option);
    });
}

/**
 * Prepne model vlákna podľa mena (slash `/model <id>`).
 *
 * Vracia dôvod zlyhania, nie boolean: paleta z neho skládá vetu do toku a
 * „nepodarilo sa" bez dôvodu je pri modeli, ktorý na stroji nie je stiahnutý,
 * horšie než nič. Zhoda je tolerantná — človek napíše `qwen3` a myslí
 * `qwen3:8b`, ale iba ak je taký jediný; pri dvoch kandidátoch sa NEHÁDA.
 */
export async function setModel(wanted) {
    const want = String(wanted ?? '').trim().toLowerCase();
    if (want === '') return { ok: false, reason: 'Chýba meno modelu.' };

    const exact = C.models.find((m) => m.id.toLowerCase() === want);
    const near = C.models.filter((m) => m.id.toLowerCase().startsWith(want));
    const pick = exact || (near.length === 1 ? near[0] : null);

    if (!pick) {
        const known = C.models.map((m) => m.id).join(', ') || 'zoznam modelov konzola nedostala';

        return {
            ok: false,
            reason: near.length > 1
                ? `Meno „${wanted}" sedí na viac modelov: ${near.map((m) => m.id).join(', ')}.`
                : `Model „${wanted}" tu nie je. K dispozícii: ${known}.`,
        };
    }

    if (!C.thread) return { ok: false, reason: 'Vlákno ešte neexistuje — najprv pošli správu.' };

    const body = { model: pick.id };
    if (pick.provider) body.provider = pick.provider;

    const data = await json(`/api/console/threads/${C.thread.uuid}`, { method: 'PATCH', body });

    if (!data) return { ok: false, reason: 'Prepnutie modelu sa neuložilo.' };

    C.thread.model = data.model;
    if (data.provider) C.thread.provider = data.provider;
    paintModels();

    return { ok: true, model: data.model };
}

async function saveModel(select) {
    if (!C.thread) return;

    const option = select.selectedOptions[0];
    const body = { model: select.value };
    if (option?.dataset.provider) body.provider = option.dataset.provider;

    const data = await json(`/api/console/threads/${C.thread.uuid}`, { method: 'PATCH', body });

    // Pri neúspechu sa prepínač vráti na to, čo vlákno naozaj má — tichá zmena,
    // ktorá sa neuložila, by pri ďalšom ťahu bežala na inom modeli, než ukazuje.
    if (data?.model !== undefined) C.thread.model = data.model;
    paintModels();
}
