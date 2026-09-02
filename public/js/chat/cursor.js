/* ===========================================================================
   Chat — KLÁVESOVÝ KURZOR nad zoznamom vlákien a zásahov.

   Prečo tento súbor existuje: v matici schopností bola `klávesový kurzor`
   zatiaľ vyplnená na JEDINEJ obrazovke celej appky (Kontrola na `/`,
   `mind/shortcuts.js`). Rozhodnutia, Runy, Knižnica ani `/chat` ho nemali —
   všade sa dalo po riadkoch chodiť len tabulátorom, teda cez KAŽDÝ ovládač
   riadka, nie po riadkoch. Panel `/chat` má 95 vlákien (zmerané 2. 9. 2026,
   `GET /api/console/threads`), takže cesta tabulátorom je merateľne dlhá.

   ČO TENTO MODUL JE: presúvanie FOKUSU. Nič viac. Riadky sú `<button>`
   (`.ct-open` u vlákna aj zložky, `.ct-hit` u zásahu hľadania), takže
   „kurzor" je natívny fokus a jeho kresbu nesie JEDEN globálny
   `:focus-visible` prsteň z `mind.css`. Preto tu nevzniká ani trieda, ani
   riadok CSS — a `chat.css` tento agent nevlastní.

   ČO TENTO MODUL NIE JE: druhá cesta k otvoreniu vlákna. `Enter` a `Space`
   nechávame prehliadaču — na `<button>` s fokusom vydajú `click`, teda presne
   ten listener, ktorý si riadok pripojil sám. Vlastná obsluha `Enter` by bola
   druhá cesta k tej istej akcii a rozišla by sa pri prvej zmene riadka.

   SKRATKY BEZ MODIFIKÁTORA A PREČO NEVADIA PÍSANIU: `j` a `k` sa čítajú LEN
   vtedy, keď má fokus riadok. Kým je kurzor v composeri, v poli hľadania alebo
   v poli dátumu, listener nerobí nič — písmeno je vtedy text, nie príkaz. Preto
   je vetvenie podľa `activeElement`, nie podľa `document.body`.

   S MODIFIKÁTOROM SA NEROBÍ NIČ: `Ctrl+J` prepína panel artefaktu
   (`wireShortcuts()` v `main.js`), `Ctrl+B` zoznam vlákien. Keby sme
   modifikátor ignorovali, kurzor by tie dve skratky prebil.

   PREKRESLENIE PANELA FOKUS ZABIJE. `paint()` v `threads.js` prepisuje obsah
   `#chat-thread-list` (`replaceChildren`), takže riadok s fokusom prestane
   existovať — a panel sa prekresľuje aj sám (obnova zoznamu 500 ms po zmene
   vlákna). Preto `restoreCursor()`, ktorý `paint()` volá vedľa
   `focusRename(host)`: je to OHLÁSENÝ krok, nie `MutationObserver` nad
   dôsledkom. Sledovanie dôsledku funguje, kým nepribudne štvrtá cesta
   k prekresleniu — tú istú lekciu zaplatil `recpanel.js` na `/`.

   Vracať fokus sa smie LEN vtedy, keď ho prekreslenie naozaj zahodilo, teda keď
   je `activeElement` telo dokumentu. Bez tej podmienky by obnova zoznamu počas
   písania správy vytrhla kurzor z composera do panela.

   Všetko sú HOISTOVANÉ `export function` — graf modulov chatu je cyklický a
   arrow v `const` v ňom spadne na `ReferenceError`.
   =========================================================================== */

/** Riadky panela v poradí, v akom sú na obrazovke. `.ct-open` je vlákno aj zložka. */
const ROW_SELECTOR = '.ct-open, .ct-hit';

/* Posledná známa poloha kurzora. Drží sa DVOJMO zámerne: `uuid` je totožnosť
   (riadok prežije prekreslenie aj vtedy, keď sa zoznam preradí, lebo posledná
   správa zmenila poradie), `index` je záloha pre zásahy hľadania, ktoré vlastné
   `data-uuid` nenesú (útržok je správa, nie vlákno). */
let markUuid = '';
let markIndex = -1;

let wired = false;

/** Panel vlákien. Keď na ploche nie je, modul je ticho no-op. */
export function cursorPanel() {
    return document.getElementById('chat-threads');
}

export function cursorHost() {
    return document.getElementById('chat-thread-list');
}

/** Pole hľadania — vstupný bod do zoznamu a miesto, kam sa vracia `k` z prvého riadka. */
export function cursorField() {
    return document.getElementById('chat-search');
}

/**
 * Riadky, po ktorých sa dá chodiť.
 *
 * `offsetParent === null` odfiltruje všetko skryté (zatvorená ponuka akcií,
 * zatvorený panel) — kurzor, ktorý zastane na neviditeľnom riadku, vyzerá ako
 * zamrznutý. `.ct-open` v zatvorenej zložke v DOM ani nie je, tá sa dokresľuje
 * až po rozbalení.
 *
 * @returns {Array<HTMLElement>}
 */
export function cursorRows() {
    const host = cursorHost();
    if (!host) return [];

    return Array.from(host.querySelectorAll(ROW_SELECTOR)).filter((row) => row.offsetParent !== null);
}

/** Totožnosť riadka pre prežitie prekreslenia. Zásah hľadania ju nemá. */
function rowUuid(row) {
    return row?.closest('.ct-row, .ct-proj')?.dataset.uuid || '';
}

/** Zapamätá polohu a presunie fokus. Jediné miesto, kde sa kurzor hýbe. */
export function focusRow(row, index) {
    if (!row) return;

    markUuid = rowUuid(row);
    markIndex = index;
    row.focus();
}

/**
 * Vráti fokus na riadok po prekreslení panela.
 *
 * Volá to `paint()` v `threads.js`. Podmienka `activeElement === body` je
 * jadro veci — bez nej by táto funkcia kradla fokus z composera pri každej
 * automatickej obnove zoznamu.
 */
export function restoreCursor() {
    if (markIndex < 0) return;

    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return;

    const rows = cursorRows();
    if (!rows.length) return;

    /* Totožnosť má prednosť pred poradím: keď sa zoznam medzitým preradil,
       človek chce zostať na svojom vlákne, nie na svojom riadku. */
    const byUuid = markUuid ? rows.findIndex((row) => rowUuid(row) === markUuid) : -1;
    const index = byUuid >= 0 ? byUuid : Math.min(markIndex, rows.length - 1);

    focusRow(rows[index], index);
}

/** Zabudne polohu — po zrušení hľadania alebo odchode z panela nemá čo obnovovať. */
export function dropCursor() {
    markUuid = '';
    markIndex = -1;
}

/**
 * Jeden listener na panel.
 *
 * Nie na `document`: skratky plochy (`Esc`, `Ctrl+*`) drží `wireShortcuts()`
 * v `main.js` a druhý globálny listener na tie isté klávesy by bol práve ten
 * rozchod, ktorý sa nedá zmerať, kým sa neprejaví. Panel si číta len to, čo sa
 * stalo v ňom.
 */
export function wireCursor() {
    if (wired) return;
    wired = true;

    const panel = cursorPanel();
    if (!panel) return;

    panel.addEventListener('keydown', onKey);

    /* Odchod z panela zabúda polohu, ale AŽ keď fokus naozaj skončil mimo —
       `relatedTarget` vnútri panela je presun medzi riadkami, nie odchod. */
    panel.addEventListener('focusout', (event) => {
        const to = event.relatedTarget;

        if (to && panel.contains(to)) return;
        if (!to) return; // fokus zahodilo prekreslenie; polohu drž, `restoreCursor()` ju použije
        dropCursor();
    });
}

function onKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;

    const rows = cursorRows();
    if (!rows.length) return;

    const field = cursorField();
    const active = document.activeElement;

    /* Z POLE HĽADANIA do zoznamu. Len šípka dolu a len z tohto jedného poľa:
       v poli dátumu (`input[type=date]`) šípky menia hodnotu a prebiť ich by
       znamenalo, že sa dátum nedá nastaviť klávesnicou. */
    if (active === field) {
        if (event.key !== 'ArrowDown') return;

        event.preventDefault();
        focusRow(rows[0], 0);

        return;
    }

    const at = rows.indexOf(active);
    if (at < 0) return;

    const key = event.key;

    if (key === 'ArrowDown' || key === 'j') {
        event.preventDefault();
        const next = Math.min(rows.length - 1, at + 1);
        focusRow(rows[next], next);

        return;
    }

    if (key === 'ArrowUp' || key === 'k') {
        event.preventDefault();

        /* Z prvého riadka späť do poľa hľadania. Zoznam a jeho pole sú jedna
           vec — kurzor, ktorý na hornom okraji narazí do steny, núti človeka
           siahnuť po myši práve tam, kde chce písať. */
        if (at === 0 && field) {
            dropCursor();
            field.focus();

            return;
        }

        const prev = Math.max(0, at - 1);
        focusRow(rows[prev], prev);

        return;
    }

    if (key === 'Home') {
        event.preventDefault();
        focusRow(rows[0], 0);

        return;
    }

    if (key === 'End') {
        event.preventDefault();
        focusRow(rows[rows.length - 1], rows.length - 1);
    }
}

/* `Esc` TU ZÁMERNE NIE JE, hoci „späť do poľa hľadania" by sa naň hodil.
   Escape je na tejto ploche už obsadený TROMA vrstvami: `run.js` ho číta
   v ZÁCHYTNEJ fáze nad zaparkovaným zápisom (dvojfázová brána), `main.js` ním
   zastavuje bežiaci ťah a na úzkom okne zatvára prekryv panela. Štvrtý čitateľ
   by musel vedieť, či práve beží ťah — a to je stav, ktorý tento modul nemá
   a mať nemá. Cesta von zo zoznamu preto vedie klávesou `k` z prvého riadka,
   ktorá nie je obsadená ničím. */
