/* ===========================================================================
   Charón — FILTER nad zoznamom vlákien.

   ULOŽENÉ FILTRE TU UŽ NEŽIJÚ. Mechanika (`loadSavedFilters` / `saveFilter` /
   `removeFilter` / `renderSavedFilters`) je v `public/js/shared/filters.js`
   a tento súbor ju IMPORTUJE. Do 1. 9. 2026 tu stála jej druhá kópia a hlavička
   sľubovala, že „tento súbor potom zmizne" — nezmizol a zmiznúť nemal: po
   odčítaní zdieľanej mechaniky tu zostáva to, čo je naozaj len konzolové — stav
   filtra, predikát vlákna a rad čipov podľa modelu.

   Kópie sa medzitým stihli rozísť (`iconSvg` tu, `iconMarkup` tam, vlastné
   `currentName()`), hoci obe písali do toho istého kľúča `hades.filters.*` —
   presne tá pasca, kvôli ktorej `shared/` vzniklo. Tretia kópia sa sem už písať
   nemá: `shared/filters.js` je zámerne LEAF (jediný import je `icons.js`), takže
   jeho načítanie NESTIAHNE graf ani d3. To bola jediná vecná námietka proti
   importu — a platila len pre `mind/table.js`, ktorý naozaj ťahá `mind/util.js`
   a s ním `anim.js`, `edges.js`, `filters.js`, `render.js`, `sim.js`, `state.js`
   a `theme.js`, teda celý graf. Ten istý dôvod, pre ktorý má konzola vlastný
   `http.js` a nie `mind/http.js`.

   KRESBA JE POŽIČANÁ, nie napísaná: `.dtl-filter` (rad filtrov), `.chip` /
   `.chip.active` / `.chip-n` (prepínač) a `.rec-saved*` (uložené kombinácie) sú
   všetky v `mind.css`, ktorý sa na `/console` načítava prvý. Ani jeden riadok
   CSS tu nevzniká.

   ČO SA FILTRUJE A PREČO PRÁVE TO — zmerané na živých dátach 31. 8. 2026
   (`GET /api/console/threads`, 94 vlákien):
     · model:   3 hodnoty (66× bez modelu = predvolený, 26× qwen3:8b,
                2× qwen3-coder:30b) → filter má čo deliť, nasadený je
     · provider: 1 hodnota (94× ollama) → filter s jedinou hodnotou nefiltruje
                nič, NENASADENÝ
     · auto_accept: 1 z 94 → prepínač, ktorý zo zoznamu urobí jeden riadok,
                NENASADENÝ (a hodnota vlákna sa dá zmeniť v hlavičke, takže by
                filter ukazoval na stav, ktorý človek práve prepína)

   ULOŽENÉ FILTRE ŽIJÚ V `localStorage`, nie v DB — filter je pohľad na dáta, nie
   dáta. Menný priestor `console-vlakna` dáva kľúč `hades.filters.console-vlakna`,
   ten istý slovník ako na `/` (Runy a Rozhodnutia), takže konzola si s nimi
   nevidí do filtrov. Pri presune sa NEMENIL, inak by ľuďom zmizli uložené filtre.
   =========================================================================== */

import { el } from './dom.js';
import { renderSavedFilters } from '../shared/filters.js';

/* Menný priestor, nie celý kľúč — prefix `hades.filters.` skladá `shared/filters.js`. */
const FNS = 'console-vlakna';

/* Značka pre „vlákno bez vlastného modelu". Prázdny reťazec sa nedá použiť — je
   to zároveň hodnota „bez filtra", a tie dva stavy hovoria opak. Sentinel začína
   znakom NUL (ten istý trik ako zástupné znaky v `shared/markdown.js`): meno
   modelu ho obsahovať nemôže, takže sa nedá „prehovoriť" cez dáta zo servera. */
const NO_MODEL = '\u0000default';

/* Stav filtra je JEDEN objekt a nie dve premenné: uložený filter musí vedieť
   obnoviť oboje naraz, a dva zdroje by dovolili polovičný stav, ktorý sa nedá
   uložiť ani pomenovať. */
const F = { q: '', model: '' };

export function threadFilter() {
    return F;
}

export function setThreadQuery(value) {
    F.q = String(value ?? '').trim();
}

/** Porovnanie bez diakritiky — kto hľadá „zaznam", má nájsť aj „záznam". */
function fold(text) {
    return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** Prejde vlákno filtrom? Jedno miesto pravdy pre zoznam aj pre počty čipov. */
export function threadPass(t) {
    if (F.q !== '' && !fold(t.title || 'Nové vlákno').includes(fold(F.q))) return false;

    if (F.model === '') return true;
    if (F.model === NO_MODEL) return !t.model;

    return t.model === F.model;
}

/** Je vôbec niečo zapnuté? Rozhoduje o tom, či sa dá filter uložiť. */
export function threadFilterActive() {
    return F.q !== '' || F.model !== '';
}

export function clearThreadFilter() {
    F.q = '';
    F.model = '';
}

/* MENO SI FILTER NESIE SÁM — natívny `prompt()` by bol jediné modálne okno
   v celej appke, a meno vymyslené z obsahu je presnejšie než meno napísané rukou
   o týždeň neskôr. Toto je presne ten `current()`, ktorý `renderSavedFilters()`
   pýta: vracia `{ name, state }`, alebo `null`, keď nie je čo uložiť. Skladanie
   mena zostáva konzolové, lebo pozná svoje polia (model + hľadanie); zdieľaná je
   len mechanika okolo neho. */
function currentSave() {
    if (!threadFilterActive()) return null;

    const bits = [];

    if (F.model === NO_MODEL) bits.push('predvolený model');
    else if (F.model !== '') bits.push(F.model);

    if (F.q !== '') bits.push(`„${F.q}"`);

    return { name: bits.join(' · '), state: { q: F.q, model: F.model } };
}

/* ---------- kresba ---------- */

function modelBuckets(threads) {
    const counts = new Map();

    (threads || []).forEach((t) => {
        const key = t.model || NO_MODEL;
        counts.set(key, (counts.get(key) || 0) + 1);
    });

    // Najčastejší model prvý — poradie podľa počtu a nie podľa abecedy, pretože
    // čip, ktorý trafí dve vlákna z devädesiatich, nemá stáť pred tým, ktorý
    // trafí polovicu zoznamu.
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function chip(label, count, active, on) {
    const btn = el('button', 'chip' + (active ? ' active' : ''), label);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');

    if (count != null) btn.append(el('span', 'chip-n', String(count)));

    btn.addEventListener('click', on);

    return btn;
}

/**
 * Vykreslí rad filtrov aj lištu uložených kombinácií do `container`.
 * `onChange` je prekreslenie zoznamu — filter sám o riadkoch nič nevie.
 *
 * Čipy modelov sa kreslia LEN keď je z čoho vybrať: pri jedinej hodnote by
 * prepínač nefiltroval nič a v 260 px paneli by zbytočne zabral riadok, o ktorý
 * je zoznam vlákien nižší.
 */
export function renderThreadFilters(container, threads, onChange) {
    if (!container) return;

    container.innerHTML = '';

    const buckets = modelBuckets(threads);

    if (buckets.length > 1) {
        const row = el('div', 'dtl-filter');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Filter podľa modelu');

        row.append(chip('Všetky', (threads || []).length, F.model === '', () => {
            F.model = '';
            onChange?.();
        }));

        buckets.forEach(([key, count]) => {
            row.append(chip(key === NO_MODEL ? 'predvolený' : key, count, F.model === key, () => {
                // Klik na už zapnutý čip filter VYPÍNA — inak je jediná cesta späť
                // „Všetky", teda dva kliky za jedno prepnutie.
                F.model = F.model === key ? '' : key;
                onChange?.();
            }));
        });

        container.append(row);
    }

    /* Uložené filtre dostávajú VLASTNÝ obal, a nie je to kozmetika:
       `renderSavedFilters()` si svoj kontejner pri každom prekreslení (po uložení
       aj po zmazaní) vyprázdni. Keby dostal `container`, zmazal by pri tom rad
       čipov nad sebou a po prvom zmazaní filtra by z panela zmizol prepínač
       modelov. Prázdny `div` je pre kresbu neviditeľný: `.rec-saved` je `flex`
       bez marginu, takže lišta bez obsahu nezaberá ani pixel a spodnú medzeru
       drží `.dtl-filter`. */
    const savedHost = el('div');
    container.append(savedHost);

    renderSavedFilters(savedHost, FNS, {
        onApply(state) {
            F.q = String(state?.q ?? '');
            F.model = String(state?.model ?? '');
            // Textové pole je druhé zobrazenie tej istej hodnoty — bez tohto by
            // filter platil, ale políčko by tvrdilo niečo iné.
            const find = document.getElementById('thread-find');
            if (find) find.value = F.q;
            onChange?.();
        },
        current: currentSave,
    });
}
