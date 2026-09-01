/* ===========================================================================
   ULOŽENÉ FILTRE — jedna mechanika pre všetky tri plochy
   ===========================================================================
   Presunuté 31. 8. 2026 z `public/js/mind/table.js`, kde to vzniklo pre Runy
   a Rozhodnutia. Dôvod presunu je zmeraný, nie estetický: konzola si tú istú
   mechaniku napísala druhýkrát, pretože importovať ju z `mind/table.js` NEJDE —
   `table.js` ťahá `mind/util.js`, a ten `anim.js` + `edges.js` + `filters.js` +
   `render.js` + `sim.js` + `state.js` + `theme.js`, teda celý graf vrátane d3,
   ktoré na `/console` ani `/chat` nie je načítané. To je ten istý dôvod, pre
   ktorý má konzola vlastný `http.js`.

   OBA VOLAJÚCI SÚ UŽ TU. `mind/table.js` mechaniku re-exportuje pre `/`,
   `console/threadfilter.js` ju importuje priamo od 1. 9. 2026 — dovtedy tam
   stála jej kópia, ktorá sa stihla rozísť (`iconSvg` proti `iconMarkup`, vlastné
   skladanie mena) pri spoločnom kľúči `hades.filters.*`. Kto pridá tretiu plochu,
   importuje ODTIAĽTO; kópia s tým istým kľúčom je tichý rozchod, nie nezávislosť.

   Tento súbor je preto ZÁMERNE LEAF: jediný import je `icons.js` (tiež leaf).
   Nepridávaj sem nič z `mind/**` — prvý taký import vráti d3 na obe plochy,
   kde nie je, a mechanika sa napíše tretíkrát.

   Filtre žijú v `localStorage` a NIE v databáze, a je to rozhodnutie: filter je
   pohľad na dáta, nie dáta. Do DB by pribudla tabuľka, migrácia a druhá plocha
   pre AI, ktorá o cudzích pohľadoch nemá čo vedieť.

   Kľúč je `hades.filters.<ns>` — menný priestor je obrazovka, takže Runy,
   Rozhodnutia, Denník a vlákna konzoly si nevidia do filtrov. Kľúč sa pri
   presune NEMENIL, inak by ľuďom zmizli uložené filtre.

   Uloženie je bezpečné aj keď je úložisko zamknuté (privátne okno alebo
   prehliadač so zablokovanými dátami stránky): funkcie vtedy len nič neurobia
   a appka beží ďalej. Preto je `try/catch` na KAŽDOM čítaní aj zápise — samotný
   prístup k `localStorage` môže hodiť výnimku, nie len `JSON.parse`.
   =========================================================================== */

import { iconMarkup } from './icons.js';

const FKEY = (ns) => 'hades.filters.' + ns;

export function loadSavedFilters(ns) {
    try {
        const raw = localStorage.getItem(FKEY(ns));
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}

/** Uloží pod menom; rovnaké meno PREPÍŠE (dva „posledný týždeň" sú pasca). */
export function saveFilter(ns, name, state) {
    const list = loadSavedFilters(ns).filter((f) => f.name !== name);
    list.push({ name: name, state: state });
    try { localStorage.setItem(FKEY(ns), JSON.stringify(list.slice(-12))); } catch (e) { /* nevadí */ }
    return list;
}

export function removeFilter(ns, name) {
    const list = loadSavedFilters(ns).filter((f) => f.name !== name);
    try { localStorage.setItem(FKEY(ns), JSON.stringify(list)); } catch (e) { /* nevadí */ }
    return list;
}

/**
 * Vykreslí lištu uložených filtrov. `onApply(state)` nasadí, `current()` vráti
 * `{ name, state }` na uloženie (alebo `null`, keď nie je čo uložiť).
 *
 * Kresba ide cez `createElement` + `textContent`, nie cez HTML string: meno
 * filtra si skládá volajúci z obsahu filtra a môže v ňom byť čokoľvek.
 */
export function renderSavedFilters(container, ns, opts) {
    if (!container) return;
    const o = opts || {};
    const list = loadSavedFilters(ns);
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'rec-saved';

    for (const f of list) {
        const chip = document.createElement('span');
        chip.className = 'rec-saved-chip';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rec-saved-apply';
        b.textContent = f.name;
        b.onclick = () => o.onApply && o.onApply(f.state);
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'rec-saved-del';
        x.setAttribute('aria-label', 'Zmazať filter ' + f.name);
        x.innerHTML = iconMarkup('x');
        x.onclick = () => {
            removeFilter(ns, f.name);
            renderSavedFilters(container, ns, o);
        };
        chip.appendChild(b);
        chip.appendChild(x);
        wrap.appendChild(chip);
    }

    /* Tlačidlo „Uložiť filter" je vidieť LEN keď je čo uložiť. Bez toho by
       ponúkalo uloženie prázdneho filtra, teda „všetko" — čo je stav bez filtra
       a uložiť sa nedá zmysluplne.

       MENO SI FILTER NESIE SÁM, nedáva ho dialóg. `current()` vracia
       `{ name, state }`, kde meno je poskladané z aktívnych filtrov („beží ·
       qwen3:8b"). Natívny `prompt()` by bol jediné modálne okno v celej appke,
       na dotyku je nepríjemný a v niektorých prehliadačoch sa dá zablokovať —
       a hlavne: meno vymyslené z obsahu je presnejšie než meno napísané rukou
       o týždeň neskôr. Rovnaké meno prepíše staré, takže „uložiť" je
       idempotentné. */
    const cur = o.current && o.current();
    if (cur && cur.name) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'rec-saved-add';
        const exists = list.some((f) => f.name === cur.name);
        add.textContent = exists ? 'Filter je uložený' : 'Uložiť: ' + cur.name;
        add.disabled = exists;
        add.onclick = () => {
            saveFilter(ns, cur.name, cur.state);
            renderSavedFilters(container, ns, o);
        };
        wrap.appendChild(add);
    }

    container.appendChild(wrap);
}
