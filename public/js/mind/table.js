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
     · `savedFilters()` — uložené kombinácie filtrov (G2)

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
        h += '<th scope="col"'
            + (c.kind === 'num' ? ' class="num"' : '')
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
            h += '<td' + (c.kind === 'num' ? ' class="num"' : '') + title + '>'
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
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            };
        });
    }
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
   ULOŽENÉ FILTRE (G2)

   Žijú v `localStorage` a NIE v databáze, a je to rozhodnutie: filter je
   pohľad na dáta, nie dáta. Do DB by pribudla tabuľka, migrácia a druhá plocha
   pre AI, ktorá o cudzích pohľadoch nemá čo vedieť.

   Kľúč je `hades.filters.<ns>` — menný priestor je obrazovka, takže Runy a
   Rozhodnutia si nevidia do filtrov. Uloženie je bezpečné aj keď je úložisko
   zamknuté (privátne okno): funkcie vtedy len nič neurobia, appka beží ďalej.
   --------------------------------------------------------------------------- */

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
 * Vykreslí lištu uložených filtrov. `onApply(state)` nasadí, `onSave()` vráti
 * aktuálny stav na uloženie (alebo `null`, keď nie je čo uložiť).
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
