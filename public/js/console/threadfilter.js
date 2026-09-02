/* ===========================================================================
   Charón — FILTER A ULOŽENÉ FILTRE nad zoznamom vlákien.

   MECHANIKA ULOŽENÝCH FILTROV JE ODTERAZ ZDIEĽANÁ (2. 9. 2026). Do 31. 8. 2026
   tu žila DRUHÁ KÓPIA (`FKEY` / `loadSaved` / `save` / `remove` + vlastná kresba
   `.rec-saved`), pretože importovať tie štyri funkcie z `mind/table.js` NEJDE —
   `table.js` ťahá `mind/util.js` a s ním celý graf vrátane d3, ktoré na
   `/console` nie je načítané. Medzitým ich paralelná session presunula do
   `public/js/shared/filters.js` (zámerne LEAF, jediný import je `icons.js`),
   takže druhá kópia už nemá dôvod existovať a je zmazaná. Kľúč
   `hades.filters.console-vlakna` sa NEMENIL — inak by ľuďom zmizli uložené
   filtre.

   Zostáva tu presne to, čo je konzolové: čo sa filtruje (`F`), sentinel pre
   „vlákno bez vlastného modelu", počty čipov a zápis do adresy.

   KRESBA JE POŽIČANÁ, nie napísaná: `.dtl-filter` (rad filtrov), `.chip` /
   `.chip.active` / `.chip-n` (prepínač) a `.rec-saved*` (uložené kombinácie) sú
   všetky v `mind.css`, ktorý sa na `/console` načítava prvý. Ani jeden riadok
   CSS tu nevzniká.

   ČO SA FILTRUJE A PREČO PRÁVE TO — zmerané na živých dátach 31. 8. 2026,
   preverené 2. 9. 2026 (`GET /api/console/threads`, 95 vlákien):
     · model:   3 hodnoty (67× bez modelu = predvolený, 26× qwen3:8b,
                2× qwen3-coder:30b) → filter má čo deliť, nasadený je
     · provider: 1 hodnota (95× ollama) → filter s jedinou hodnotou nefiltruje
                nič, NENASADENÝ
     · auto_accept: 1 z 95 → prepínač, ktorý zo zoznamu urobí jeden riadok,
                NENASADENÝ (a hodnota vlákna sa dá zmeniť v hlavičke, takže by
                filter ukazoval na stav, ktorý človek práve prepína)

   ULOŽENÉ FILTRE ŽIJÚ V `localStorage`, nie v DB — filter je pohľad na dáta, nie
   dáta. Menný priestor je ten istý slovník ako na `/` (Runy, Rozhodnutia,
   Denník), takže konzola si s nimi nevidí do filtrov.

   FILTER JE V ADRESE (2. 9. 2026). `q` je spoločný kľúč slovníka
   `mind/urlstate.js` (na ploche je najviac jedno voľné hľadanie — tu je to
   `#thread-find`), `cm` je konzolový model. `urlstate.js` je ZÁMERNE leaf modul
   nad `URLSearchParams` bez jediného importu, takže ho `/console` môže použiť
   rovnako ako `/chat` (`chat/threads.js`) — graf sa tým nestiahne. Zápis je
   `replace`: filter nie je navigácia (rozhodnutie 10).
   =========================================================================== */

import { el } from './dom.js';
import { loadSavedFilters, renderSavedFilters } from '../shared/filters.js';
import { urlValue, writeUrl } from '../mind/urlstate.js';

/** Menný priestor uložených filtrov. Kľúč je `hades.filters.` + toto. */
const NS = 'console-vlakna';

/* Značka pre „vlákno bez vlastného modelu". Prázdny reťazec sa nedá použiť — je
   to zároveň hodnota „bez filtra", a tie dva stavy hovoria opak. Sentinel začína
   znakom NUL (ten istý trik ako zástupné znaky v `shared/markdown.js`): meno
   modelu ho obsahovať nemôže, takže sa nedá „prehovoriť" cez dáta zo servera. */
const NO_MODEL = '\u0000default';

/* Do adresy NUL ísť nemôže (`URLSearchParams` ho zakóduje na `%00` a odkaz je
   neprečítateľný), takže v URL má sentinel vlastnú podobu. Vlnovka je bezpečná
   z toho istého dôvodu ako NUL v pamäti: meno ollama modelu má tvar
   `menovka[:tag]` a `~` v ňom nie je. */
const NO_MODEL_URL = '~default';

/* Stav filtra je JEDEN objekt a nie dve premenné: uložený filter musí vedieť
   obnoviť oboje naraz, a dva zdroje by dovolili polovičný stav, ktorý sa nedá
   uložiť ani pomenovať. */
const F = { q: '', model: '' };

export function threadFilter() {
    return F;
}

/* ---------- adresa ----------

   Do adresy ide KĽÚČ filtra, nie jeho vyhodnotenie: hľadanie je klientské nad
   už načítanými vláknami, takže dopyt na server sa nemení. Default (prázdno) sa
   vynecháva — čistý stav je `/console/<uuid>` bez query stringu. */

function pushFilterUrl() {
    writeUrl({
        q: F.q || null,
        cm: F.model === '' ? null : (F.model === NO_MODEL ? NO_MODEL_URL : F.model),
    });
}

/**
 * Boot: URL → stav. Volá sa RAZ pred prvým vykreslením zoznamu.
 *
 * Návratová hodnota je hodnota pre `#thread-find` — políčko je druhé zobrazenie
 * tej istej pravdy a bez nej by filter platil, ale políčko by tvrdilo niečo iné.
 * Nezapisuje sa nič: čo prišlo z odkazu, už v adrese je, a `replaceState` bez
 * zmeny hodnoty by len prepísal adresu sám sebou.
 */
export function applyThreadFilterFromUrl() {
    F.q = urlValue('q') || '';

    const model = urlValue('cm');
    F.model = model == null ? '' : (model === NO_MODEL_URL ? NO_MODEL : model);

    return F.q;
}

export function setThreadQuery(value) {
    F.q = String(value ?? '').trim();
    pushFilterUrl();
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
    pushFilterUrl();
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

/* MENO SI FILTER NESIE SÁM — natívny `prompt()` by bol jediné modálne okno
   v celej appke, a meno vymyslené z obsahu je presnejšie než meno napísané rukou
   o týždeň neskôr. Ten istý vzor a to isté zdôvodnenie ako `renderSavedFilters()`
   na `/`; odteraz je to naozaj tá istá funkcia. */
function currentFilter() {
    const bits = [];

    if (F.model === NO_MODEL) bits.push('predvolený model');
    else if (F.model !== '') bits.push(F.model);

    if (F.q !== '') bits.push(`„${F.q}"`);

    return { name: bits.join(' · '), state: { q: F.q, model: F.model } };
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
            pushFilterUrl();
            onChange?.();
        }));

        buckets.forEach(([key, count]) => {
            row.append(chip(key === NO_MODEL ? 'predvolený' : key, count, F.model === key, () => {
                // Klik na už zapnutý čip filter VYPÍNA — inak je jediná cesta späť
                // „Všetky", teda dva kliky za jedno prepnutie.
                F.model = F.model === key ? '' : key;
                pushFilterUrl();
                onChange?.();
            }));
        });

        container.append(row);
    }

    /* Lišta uložených filtrov je VLASTNÉ DIEŤA, nie ten istý prvok: zdieľaná
       `renderSavedFilters()` si svoj kontejner vyprázdňuje (a pri mazaní chipu
       sa do neho prekresľuje sama), takže spoločný prvok by pri prvom zmazaní
       zmietol rad čipov modelu nad ním.

       Kreslí sa len keď je čo kresliť: prázdna `.rec-saved` je flex kontejner
       s `gap`, teda prázdny riadok v 260 px paneli, o ktorý je zoznam nižší. */
    if (!loadSavedFilters(NS).length && !threadFilterActive()) return;

    const saved = el('div');
    container.append(saved);

    renderSavedFilters(saved, NS, {
        current: () => {
            const cur = currentFilter();

            return cur.name ? cur : null;
        },
        onApply: (state) => {
            F.q = String(state?.q ?? '');
            F.model = String(state?.model ?? '');
            // Textové pole je druhé zobrazenie tej istej hodnoty — bez tohto by
            // filter platil, ale políčko by tvrdilo niečo iné.
            const find = document.getElementById('thread-find');
            if (find) find.value = F.q;
            pushFilterUrl();
            onChange?.();
        },
    });
}

/* `hasFilterChips()` tu bolo do 2. 9. 2026 a je ZMAZANÉ, nie presunuté: jeho
   docblock tvrdil „používa to prázdny stav zoznamu", ale `filterEmptyNote()`
   v `main.js` si vetu skládá z `threadFilter()` a túto funkciu nevolal nikto
   (grep nad `public/js` a `resources/views` dal jediný zásah — jej vlastnú
   definíciu). Mŕtvy export s nepravdivým komentárom je horší než chýbajúci. */
