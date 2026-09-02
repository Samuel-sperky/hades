/* ===========================================================================
   Chat — ULOŽENÉ FILTRE nad hľadaním v histórii.

   Posledná prázdna cela matice, ktorú `/chat` naozaj mal čím zaplniť. Osi
   existujú a majú hodnoty (zmerané 2. 9. 2026 na živých dátach,
   `GET /api/console/search`): rola (`user` / `assistant`), `od` a `do`.
   Dopyt „test" dal 10 zásahov v 10 vláknach, „hades" 7 v 3 — teda zásah, ktorý
   sa dá zúžiť, nie jednoriadkový zoznam, kde by filter nefiltroval nič.

   MECHANIKA JE POŽIČANÁ, NIE NAPÍSANÁ: `public/js/shared/filters.js`
   (`loadSavedFilters` / `saveFilter` / `removeFilter` / `renderSavedFilters`) je
   ten istý modul, ktorým ukládajú filtre Runy, Rozhodnutia, Denník aj vlákna
   konzoly. Menný priestor `hades.filters.chat-historia` je preto v tom istom
   slovníku a plochy si do filtrov nevidia. Druhá implementácia toho istého by
   bola štvrtá kópia — presne ten vzor, ktorý audit tejto appky opakovane našiel
   ako príčinu rozchodu dvoch ciest k jednej veci.

   KRESBA JE TIEŽ POŽIČANÁ: `.rec-saved`, `.rec-saved-chip`, `.rec-saved-apply`,
   `.rec-saved-del` a `.rec-saved-add` sú v `mind.css` (riadky 6569–6594), ktorý
   sa na `/chat` načítava PRVÝ (`chat.blade.php` má `mind.css` pred `chat.css`).
   Hostiteľský rad nesie `ct-facets` — má presne to, čo tento rad potrebuje
   (`display: flex`, `flex-wrap`, `gap`, `margin-bottom`, `padding-inline`),
   takže odsadenie od okraja panela je to isté ako u skupín zásahov vedľa.
   Ani jeden riadok CSS tu nevzniká a v `chat.css` nič nepribúda.

   ČO SA DO ULOŽENÉHO FILTRA ZÁMERNE NEBERIE — a je to rozhodnutie, nie
   opomenutie:

     · `q` (dopyt). Uložený filter je POHĽAD, nie otázka. Kombinácia „moje
       správy za august" má zmysel nad hocijakým dopytom; „moje správy za august
       o hadesovi" je jeden konkrétny dopyt, ktorý si človek napíše rýchlejšie,
       než ho vyberie zo zoznamu. Runy ani Rozhodnutia dopyt tiež neukládajú.
     · `hn` / `hp` (zúženie na vlákno alebo projekt). Sú to zúženia KONKRÉTNEHO
       zásahu a `onQuery()` ich pri novom dopyte zámerne ruší — uložiť ich by
       znamenalo vyrobiť filter, ktorý po nasadení nad iným dopytom vráti
       prázdno bez viditeľného dôvodu. Navyše by meno filtra muselo nesť názov
       vlákna, ktorý v tej chvíli nemusí byť načítaný.
     · `hl` (strop výsledkov). To je „koľko vidím", nie „čo vidím".

   Tri osi teda, a všetky tri sú nezávislé od dopytu. Meno si filter skladá SÁM
   z vlastného obsahu (`current()` v `shared/filters.js`) — natívny `prompt()`
   by bol jediné modálne okno v celej appke.

   Všetko sú HOISTOVANÉ `export function`: graf modulov chatu je cyklický
   (`main ↔ run ↔ render ↔ threads`) a tento modul do toho cyklu vstupuje
   importom z `threads.js`, ktorý si zároveň volá `renderChatSaved()`. Arrow
   v `const` by v cykle spadla na `ReferenceError`.
   =========================================================================== */

import { loadSavedFilters, renderSavedFilters } from '../shared/filters.js';
import { applySearchFilters, searchFilterState } from './threads.js';

/** Menný priestor v `localStorage`. Kľúč je `hades.filters.chat-historia`. */
const NS = 'chat-historia';

/* Slová pre rolu. Tá istá trojica ako v `filterBar()` — a je tu úmyselne DRUHÝ
   raz, nie importom: `filterBar()` skládá `<option>`y (hodnota + popis), tento
   stôl skládá MENO filtra a prázdna rola tu nemá popis vôbec (do mena filtra
   sa „Kdokoľvek" nepíše, lebo to nie je zúženie). Jeden stôl pre oboje by
   musel niesť dva rôzne texty pre tú istú hodnotu. */
const ROLE_WORD = { user: 'Moje správy', assistant: 'Odpovede Hadesa' };

/**
 * Vykreslí rad uložených filtrov do `container`.
 *
 * Volá to `filterBar()` v `threads.js` pri každom prekreslení panela, takže
 * funkcia musí byť bezpečná pri opakovaní — `renderSavedFilters()` si obsah
 * kontejnera prepisuje sama.
 */
export function renderChatSaved(container) {
    renderSavedFilters(container, NS, {
        onApply: (state) => applySearchFilters(state),
        current: () => currentFilter(),
    });
}

/** Je čo ukazovať? Kým nie je ani jeden uložený filter ani čo uložiť, rad sa nekreslí. */
export function hasChatSaved() {
    if (loadSavedFilters(NS).length) return true;

    return !!currentFilter();
}

/**
 * `{ name, state }` na uloženie, alebo `null` keď nie je čo uložiť.
 *
 * `null` znamená „žiadne zúženie", teda „všetko" — a to je stav BEZ filtra,
 * ktorý sa nedá pomenovať zmysluplne. `shared/filters.js` vtedy tlačidlo
 * „Uložiť" vôbec nekreslí.
 */
export function currentFilter() {
    const f = searchFilterState();
    const bits = [];

    if (ROLE_WORD[f.role]) bits.push(ROLE_WORD[f.role]);
    if (f.from) bits.push('od ' + dayLabel(f.from));
    if (f.to) bits.push('do ' + dayLabel(f.to));

    if (!bits.length) return null;

    return {
        name: bits.join(' · '),
        state: { role: f.role, from: f.from, to: f.to },
    };
}

/**
 * `2026-08-01` → `1. 8. 2026`.
 *
 * Formát dátumu je SLOVO, nie dáta (rozhodnutie 13), takže ho skládá prehliadač
 * a nie server. Neplatný vstup sa vracia nezmenený — do mena filtra sa tak
 * nedostane `Invalid Date`.
 */
export function dayLabel(iso) {
    const d = new Date(String(iso) + 'T00:00:00');

    if (Number.isNaN(d.getTime())) return String(iso);

    return d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
