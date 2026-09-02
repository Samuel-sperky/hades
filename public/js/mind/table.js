/* ===========================================================================
   TABUĽKA ZÁZNAMOV — jeden jazyk pre Runy a Rozhodnutia
   ===========================================================================
   Kontrakt 28. 8. 2026, G1–G4. Do tejto vlny appka **žiadnu tabuľku nemala**
   (jediný `<table>` v repe bola textová alternatíva heatmapy), takže obe
   obrazovky kreslili karty — a karta je dobrá na príbeh, nie na porovnávanie
   piatich čísel v rade.

   Čo tu je a prečo práve tu:
     · `renderTable()` — kresba, triedenie a výber riadka
     · `moreRow()` — „ďalších N" (G3: nie stránkovanie, nie infinite scroll)
     · re-export uložených filtrov (G2) — mechanika žije v `shared/filters.js`

   Denník tabuľku NEDOSTÁVA a je to rozhodnutie: je to naratívna os dňa, kde
   dôležité je *čo sa stalo*, nie porovnanie stĺpcov. Karty tam zostávajú.

   PRÍSTUPNOSŤ je dôvod, prečo je to `<table>` a nie mriežka `<div>`ov:
   čítačka musí vedieť ohlásiť „stĺpec Stav, riadok 3". Triedi sa tlačidlom
   v `<th>` a stav triedenia nesie `aria-sort` na tom `<th>` — nie vlastná
   trieda, aby stav existoval raz a bol aj v strome prístupnosti.
   =========================================================================== */

import { esc } from './util.js';
import { iconMarkup } from '../shared/icons.js';

/* Smer triedenia: `1` = vzostupne, `-1` = zostupne. Nie 'asc'/'desc' — smer sa
   používa ako násobiteľ v komparátore a preklad reťazca na číslo by bol tretie
   miesto, kde sa dá pomýliť. */
export const ASC = 1;
export const DESC = -1;

/**
 * Vykreslí tabuľku do kontejnera.
 *
 * `columns`: [{ key, label, kind?, sortable?, width?, cell?, titleFrom? }]
 *   kind `num` zarovná vpravo a nasadí mono + tabulárne číslice (stĺpce čísel
 *   musia stáť pod sebou, inak sa nedajú porovnať očami).
 *   `cell(row)` vracia HTML jednej celly; keď chýba, berie sa `row[key]`.
 *   `titleFrom(row)` vracia PLNÝ text pre `title` na `<td>`.
 *
 * PREČO `titleFrom` a nie dopisovanie `title` po kresbe: cely sa režú
 * (`text-overflow: ellipsis`), a **rez, ktorý sa nepriznáva, je lož** — celý
 * text musí byť dosiahnuteľný. Volajúci si ho dovtedy musel dopísať ťahom po
 * hotovej tabuľke, čo je druhý prechod nad tým istým DOM a ľahko sa zabudne
 * pri novom stĺpci. Deklarácia pri stĺpci sa zabudnúť nedá.
 *
 * `opts`: { rows, sortKey, sortDir, onSort(key), onOpen(row), openId, idKey,
 *           empty, caption }
 */
export function renderTable(container, columns, opts) {
    if (!container) return;
    const o = opts || {};
    const rows = Array.isArray(o.rows) ? o.rows : [];
    const idKey = o.idKey || 'id';

    if (!rows.length) {
        container.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'rec-empty';
        box.textContent = o.empty || 'Zatiaľ žiadne záznamy';
        container.appendChild(box);
        return;
    }

    let h = '<table class="rec-table">';
    /* `<caption>` je pre čítačku, nie pre oko (CSS ho odsúva mimo obraz):
       tabuľka bez mena je v zozname orientačných bodov „tabuľka, 6 stĺpcov"
       a nič viac. */
    if (o.caption) h += '<caption>' + esc(o.caption) + '</caption>';
    h += '<thead><tr>';
    for (const c of columns) {
        const active = o.sortKey === c.key;
        const aria = active ? (o.sortDir === DESC ? 'descending' : 'ascending') : 'none';
        /* Trieda stĺpca (`col-<key>`) je na `<th>` aj `<td>`, aby sa stĺpec dal
           adresovať z CSS bez `:nth-child` — poradie stĺpcov sa mení podľa
           obrazovky a index by bol väzba, ktorá sa ticho rozíde. Na mobile ju
           používa mediálne pravidlo, ktoré najmenej nosné stĺpce skryje. */
        h += '<th scope="col" class="col-' + esc(c.key) + (c.kind === 'num' ? ' num' : '') + '"'
            + (c.sortable === false ? '' : ' aria-sort="' + aria + '"')
            + (c.width ? ' style="width:' + c.width + '"' : '') + '>';
        if (c.sortable === false) {
            h += esc(c.label);
        } else {
            /* Ikona smeru sa kreslí len na AKTÍVNOM stĺpci. Šípka na každom
               stĺpci vyzerá ako stav, ktorý neexistuje. */
            h += '<button type="button" class="rec-sort" data-sort="' + esc(c.key) + '">'
                + esc(c.label)
                + (active ? iconMarkup(o.sortDir === DESC ? 'arrow-down' : 'arrow-up', { cls: 'rec-sort-ico' }) : '')
                + '</button>';
        }
        h += '</th>';
    }
    h += '</tr></thead><tbody>';

    for (const r of rows) {
        const id = r[idKey];
        const open = o.openId != null && String(o.openId) === String(id);
        h += '<tr class="rec-row' + (open ? ' open' : '') + '" data-rec="' + esc(id) + '"'
            + (open ? ' aria-current="true"' : '') + '>';
        for (const c of columns) {
            /* `title` sa nekreslí, keď je prázdny alebo keď sa rovná obsahu cely:
               atribút, ktorý zopakuje to, čo je vidieť, len pridá tooltip bez
               informácie — a na dotyku ho aj tak nikto neuvidí. */
            let title = '';
            if (typeof c.titleFrom === 'function') {
                const t = c.titleFrom(r);
                if (t != null && String(t) !== '') title = ' title="' + esc(String(t)) + '"';
            }
            h += '<td class="col-' + esc(c.key) + (c.kind === 'num' ? ' num' : '') + '"' + title + '>'
                + (c.cell ? c.cell(r) : esc(r[c.key] == null ? '' : String(r[c.key])))
                + '</td>';
        }
        h += '</tr>';
    }
    h += '</tbody></table>';
    container.innerHTML = h;

    if (typeof o.onSort === 'function') {
        container.querySelectorAll('.rec-sort[data-sort]').forEach((b) => {
            b.onclick = () => o.onSort(b.dataset.sort);
        });
    }
    /* Otvorenie detailu je klik na RIADOK, nie na tlačidlo v ňom. Riadok preto
       dostáva `tabindex` a obsluhu Enter/Space ručne — `<tr>` nie je tlačidlo a
       zabaliť celý riadok do `<button>` sa v tabuľke nedá bez toho, aby sa
       rozpadli stĺpce. To je zámerná výmena: štruktúra tabuľky je pre čítačku
       cennejšia než natívna klávesová obsluha jedného gesta. */
    if (typeof o.onOpen === 'function') {
        container.querySelectorAll('.rec-row[data-rec]').forEach((tr) => {
            tr.tabIndex = 0;
            const open = () => {
                const row = rows.find((x) => String(x[idKey]) === tr.dataset.rec);
                if (row) o.onOpen(row);
            };
            tr.onclick = open;
            tr.onkeydown = (e) => {
                /* SÚ TO SKRATKY RIADKA, NIE TABUĽKY. Bez `e.target !== tr` sa
                   `preventDefault()` vypálil na každom Enteri/medzerníku, ktorý
                   sa v riadku stal — teda aj na `<button>` v cele, ktorému tým
                   zhltol klávesovú aktiváciu a namiesto jeho akcie otvoril
                   panel. Kontrola aj Rozhodnutia to obchádzali `stopPropagation`
                   na každom tlačidle; obchádzka funguje, ale zabudne sa pri
                   novom tlačidle a chyba je tichá. Strážca je tu, aby ju
                   obrazovky nemuseli písať.
                   `e.target !== tr` (nie `!tr.contains(...)`): keď je fokus na
                   riadku, cieľom JE riadok; čokoľvek iné je prvok v ňom. */
                if (e.target !== tr) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            };
        });
    }
}

/* ---------------------------------------------------------------------------
   KLÁVESOVÝ KURZOR — j/k a strelky nad riadkami tabuľky

   Kresba `.rec-row.selected` v `mind.css` (0-3-0, silnejšia než `:hover`) tu
   bola už predtým; nová je len tretia a štvrtá obrazovka, ktorá ju používa.

   KURZOR JE STAV V DOM, NIE PREMENNÁ. Index v module by bol druhý zdroj pravdy
   nad tým istým riadkom a musel by sa dorovnávať po každom prekreslení,
   filtrovaní a triedení — presne to sa už raz stalo dvakrát nezávisle
   (`kontrolaState.idx` + `paintKontrolaCursor()`, `directiveCursor` +
   `paintDirCursor()`). Čítanie polohy z `.selected` sa rozísť nemôže: keď
   `renderTable()` prepíše `innerHTML`, kurzor zmizne S riadkami a ďalší stisk
   začne od začiatku — čo je poctivé, lebo filter aj radenie menia, KTORÝ riadok
   je n-tý.

   POSUN NEPREKRESĽUJE. Prepne triedu na dvoch riadkoch a posunie fokus. Keby
   posun šiel cez `renderTable()`, odložený `document.activeElement`
   v `recpanel.js` by bol po prekreslení odpojený (`isConnected === false`)
   a Esc by fokus nevrátil nikam.

   FOKUS IDE S KURZOROM, pretože `<tr>` má od `renderTable()` `tabIndex = 0`:
   bez toho by čítačka nemala čo ohlásiť, prstenec fokusu by stál inde než
   podfarbenie a Enter by musel mať druhú obsluhu (takto ho obslúži riadkový
   `onkeydown` vyššie v tomto súbore).
   --------------------------------------------------------------------------- */

/** Riadky tabuľky v `root` (element tabuľky alebo jej kontejner). */
export function tableRows(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('.rec-row[data-rec]'));
}

/** Riadok pod kurzorom, alebo `null`. */
export function tableCursorRow(root) {
    return tableRows(root).find((r) => r.classList.contains('selected')) || null;
}

/**
 * Posunie kurzor o `delta` riadkov a vráti nový riadok (alebo `null`).
 *
 * Prvý stisk nasadí PRVÝ riadok pri `delta > 0` a posledný pri `delta < 0`:
 * „žiadny kurzor" nie je nulová pozícia, ale „pred zoznamom". Posun je
 * cyklický — rovnako ako vo fronte Kontroly, aby dlhá tabuľka nemala tichý
 * konec.
 */
export function moveTableCursor(root, delta) {
    const rows = tableRows(root);
    if (!rows.length) return null;
    const at = rows.findIndex((r) => r.classList.contains('selected'));
    const next = at < 0
        ? (delta > 0 ? 0 : rows.length - 1)
        : (at + delta + rows.length) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('selected', i === next));
    const cur = rows[next];
    cur.focus({ preventScroll: true });
    cur.scrollIntoView({ block: 'nearest' });
    return cur;
}

/**
 * Zoradí riadky. Neporovnáva „naslepo": stĺpec `num` sa porovnáva ČÍSELNE
 * a ostatné cez `localeCompare` so slovenským locale — bez toho by „Č" skončilo
 * za „Z" a zoradenie by vyzeralo pokazene presne na slovenských popiskoch.
 *
 * Radenie je STABILNÉ (druhotný kľúč je pôvodné poradie), takže dva rovnaké
 * stavy si medzi sebou držia poradie zo servera, teda podľa času.
 */
export function sortRows(rows, key, dir, columns) {
    if (!key) return rows.slice();
    const col = (columns || []).find((c) => c.key === key) || {};
    const num = col.kind === 'num';
    const val = (r) => (typeof col.sortValue === 'function' ? col.sortValue(r) : r[key]);
    return rows
        .map((r, i) => [r, i])
        .sort((a, b) => {
            const x = val(a[0]), y = val(b[0]);
            // Prázdne hodnoty idú VŽDY na konec, nezávisle od smeru: „nič" nie je
            // najmenšia hodnota, je to chýbajúca hodnota.
            const ex = x == null || x === '';
            const ey = y == null || y === '';
            if (ex && ey) return a[1] - b[1];
            if (ex) return 1;
            if (ey) return -1;
            const c = num
                ? (+x || 0) - (+y || 0)
                : String(x).localeCompare(String(y), 'sk');
            return c !== 0 ? c * dir : a[1] - b[1];
        })
        .map((p) => p[0]);
}

/**
 * „Ďalších N" (G3). Nie stránkovanie a nie infinite scroll: tlačidlo je
 * predvídateľné, nerozbíja adresu a nechá footer dosiahnuteľný.
 *
 * Keď je vidieť všetko, kreslí sa **priznanie počtu**, nie prázdno — zoznam,
 * ktorý mlčky skončil, vyzerá ako zoznam, ktorý sa nedopočítal.
 */
export function moreRow(container, shown, total, onMore) {
    if (!container) return;
    const wrap = document.createElement('div');
    wrap.className = 'rec-more';
    if (shown < total) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rec-more-btn';
        b.textContent = 'Ďalších ' + Math.min(50, total - shown);
        b.onclick = () => onMore();
        wrap.appendChild(b);
        const n = document.createElement('span');
        n.className = 'rec-more-n';
        n.textContent = shown + ' z ' + total;
        wrap.appendChild(n);
    } else {
        const n = document.createElement('span');
        n.className = 'rec-more-n';
        n.textContent = total === 1 ? '1 záznam' : 'všetkých ' + total;
        wrap.appendChild(n);
    }
    container.appendChild(wrap);
}

/* ---------------------------------------------------------------------------
   ULOŽENÉ FILTRE (G2) — MECHANIKA JE ODTERAZ V `public/js/shared/filters.js`

   Presunuté 31. 8. 2026, pretože konzola si tie isté štyri funkcie napísala
   druhýkrát (`public/js/console/threadfilter.js`): importovať ich odtiaľto
   nemôže, `table.js` ťahá `mind/util.js` a s ním celý graf vrátane d3, ktoré
   na `/console` ani `/chat` nie je načítané.

   Tu zostáva len RE-EXPORT, a to zámerne: `screens/runy.js`,
   `screens/rozhodnutia.js` a `screens/dennik.js` importujú `renderSavedFilters`
   z `../table.js`, takže presun bez re-exportu by bol zmena v troch cudzích
   súboroch za nulový funkčný zisk. Re-export je ŽIVÁ VÄZBA na to isté
   binding, nie kópia — druhá implementácia tým nevzniká.

   Nový volajúci na `/` môže siahnuť priamo do `shared/filters.js`; volajúci
   mimo `/` MUSÍ, inak si stiahne graf.
   --------------------------------------------------------------------------- */

export { loadSavedFilters, removeFilter, renderSavedFilters, saveFilter } from '../shared/filters.js';
