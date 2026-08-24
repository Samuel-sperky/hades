import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { S } from '../state.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyHtml, esc, getJson, plainBlock, plainInline, renderEmpty, renderLoading } from '../util.js';

/* ---------- obrazovka Rozhodnutia (/api/decisions) — časová os ----------
   Časová os rozhodnutí zoskupená po mesiacoch (.dtl*), filtre obdobie/oblasť
   (reuse .chip v .dtl-filter), detail/expand dôvodu klikom na kartu, manuálne
   pridanie → POST /api/decisions a mazanie → DELETE /api/decisions/{id}.

   DÁTA SÚ SERVEROVÉ. Obrazovka si nič nedopočítava: os rokov (`years`), os
   oblastí (`areas`), počty (`counts`), názov oblasti riadku (`area`) aj mesiac
   pre hlavičku bloku (`month`) prichádzajú z `App\Serializers\Screen\
   RozhodnutiaScreen` — tej istej triedy, z ktorej čerpá MCP. Predtým sa roky
   aj počty počítali tu z načítaných riadkov a názov oblasti sa bral z GRAFOVÉHO
   payloadu (`S.areas`), takže človek videl oblasť, AI to isté rozhodnutie bez
   nej, a bez načítaného grafu svietilo „#7". Nedávaj to sem späť.

   FILTRUJE SERVER. Do 20. 8. 2026 sa `/api/decisions` volalo BEZ parametrov a
   rok, oblasť aj hľadanie sa preosievali tu, nad jedným fetchom — hoci serializér
   `q`/`area`/`year`/`origin` vie odjakživa. Nad stropom 500 riadkov by to prestalo
   byť pravda: filter by hľadal v prvej stránke a tváril sa, že hľadal vo všetkom.
   Preto každá zmena filtra znamená nový dopyt (`decisionsQuery()`).

   Osi (`years`, `areas`, `counts`) sú v serializéri zámerne GLOBÁLNE — filter ich
   nemení. Preto sa lišta prekresľuje len raz a pri filtrovaní sa mení iba zoznam
   (`#dec-list`): inak by pod prstami mizli práve tie čipy, ktorými sa filter ruší. */

export const decisionsState = {
    all: [], years: [], areas: [], counts: {},
    year: null, areaId: null, q: '',
    adding: false, managing: false,
    seq: 0, qTimer: null,
};

/* Dopyt na server z aktuálneho filtra. Jediné miesto, kde sa filter prekladá na
   URL — dve kópie by znamenali, že prvé načítanie a filtrovanie hľadajú inak. */
export function decisionsQuery() {
    const p = new URLSearchParams();
    if (decisionsState.year !== null) p.set('year', decisionsState.year);
    if (decisionsState.areaId !== null) p.set('area', String(decisionsState.areaId));
    const q = decisionsState.q.trim();
    if (q) p.set('q', q);
    const s = p.toString();
    return '/api/decisions' + (s ? '?' + s : '');
}

function applyDecisionsPayload(d) {
    decisionsState.all = d.decisions || [];
    decisionsState.years = d.years || [];
    decisionsState.areas = d.areas || [];
    decisionsState.counts = d.counts || {};
}

export async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    renderLoading(body, 'Načítavajú sa rozhodnutia…');
    const seq = ++decisionsState.seq;
    try {
        const d = await getJson(decisionsQuery());
        if (seq !== decisionsState.seq) return;
        applyDecisionsPayload(d);
        pruneDecisionFilters();
        renderDecisionsView();
    } catch (e) {
        if (seq !== decisionsState.seq) return;
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať rozhodnutia', 'Skús obnoviť stránku.');
    }
}

/* Zmena filtra prekresľuje LEN zoznam. Lišta (čipy, hľadanie, tlačidlá) stojí:
   `renderLoading` nad celým telom by pri každom písmene zhodil aj pole, do
   ktorého sa práve píše — a s ním fokus aj kurzor. Starý zoznam ostáva na
   obrazovke, kým nepríde nový; Knižnica to isté rieši triedou `is-stale`, tá je
   ale naviazaná na `#library-body`. */
export async function refreshDecisionList() {
    if (!$('dec-list')) { renderDecisions(); return; }
    const seq = ++decisionsState.seq;
    try {
        const d = await getJson(decisionsQuery());
        if (seq !== decisionsState.seq) return;
        applyDecisionsPayload(d);
        renderDecisionsList();
    } catch (e) {
        if (seq !== decisionsState.seq) return;
        showToast('Rozhodnutia sa nepodarilo načítať', null, 'error');
    }
}

/* Filter, ktorý po znovunačítaní nemá ani jeden záznam, je pasca: rady čipov sa
   vypisujú len keď je z čoho vyberať (years.length > 1), takže po uložení
   rozhodnutia v inom roku mohla obrazovka ostať prázdna BEZ čipu, ktorým sa filter
   zruší. Denník to isté robí pri projektoch (journalProject sa vynuluje) — tu to
   dosiaľ sľuboval len komentár. */
export function pruneDecisionFilters() {
    if (decisionsState.year !== null
        && !decisionsState.years.some((y) => String(y.year) === decisionsState.year)) {
        decisionsState.year = null;
    }
    if (decisionsState.areaId !== null
        && !decisionsState.areas.some((a) => a.id === decisionsState.areaId)) {
        decisionsState.areaId = null;
    }
}

/* Filtračný čip hovorí tým istým jazykom ako v Denníku: popisok + počet v
   .chip-n. Predtým tu čipy počty nemali, takže dve obrazovky mali dva rôzne
   filtračné idiomy — a človek nevedel, či sa filtrom niečo vôbec ukáže. */
export function decChip(label, active, attrs, n) {
    // `aria-pressed` je povinné: bez neho nesie zapnutý filter LEN farba. Vzor je
    // `runy.js` (chip()). Dopĺňa sa aj v syncDecChips(), inak by sa trieda
    // a atribút po prekliku rozišli.
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '" ' + attrs + '>'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
}

export function renderDecisionsView() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    // Os období aj os oblastí prichádzajú zo servera už zoradené a s počtami nad
    // CELÝM korpusom. Počítať ich tu z `all` znamenalo, že nad stropom 500 by čip
    // hlásil iné číslo než realita — a AI by o osi nevedela nič.
    const years = decisionsState.years;
    const areas = decisionsState.areas;
    const total = decisionsState.counts.total != null ? decisionsState.counts.total : decisionsState.all.length;

    /* Akcia „Pridať rozhodnutie" stála na SAMOSTATNOM riadku nad filtrami, takže
       medzi podtitulom a čipmi zostal celý prázdny pás — Denník aj Knižnica dávajú
       pod hlavičku hneď ovládanie. Tlačidlá preto idú do TOHO ISTÉHO riadku ako
       posledný rad filtrov (vpravo, margin-left:auto v .dec-toolbar-row) a vlastný
       pás si vyžiadajú len vtedy, keď filtre nie sú (jeden rok, jedna oblasť). */
    const addBtn = '<button type="button" id="dec-add-toggle" class="chip">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.adding ? 'close' : 'add') + '</span>'
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button>';

    /* Mazanie je za režimom, nie pri každej karte. Časová os má stovky záznamov a
       stovka košov vedľa nich je šum, ktorý na obrazovke o pamäti nemá čo robiť —
       a zároveň je nechcený klik o kúsok bližšie. Režim je prvý z dvoch krokov,
       druhý je ozbrojené potvrdenie na samotnom tlačidle. */
    const manageBtn = '<button type="button" id="dec-manage" class="chip' + (decisionsState.managing ? ' active' : '') + '">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.managing ? 'check' : 'edit') + '</span>'
        + (decisionsState.managing ? 'Hotovo' : 'Upraviť zoznam') + '</button>';

    /* Hľadanie má vlastný rad, nie miesto medzi čipmi: vstupy majú v tejto appke
       `width: 100%`, takže v rade čipov by ich vytlačilo na ďalší riadok — a
       dorovnať to inline štýlom si tento blok zakázal (viď komentár pri
       `.dec-toolbar` v mind.css). Celý rad je zároveň to, ako vyzerá filtračné
       pole v Knižnici (`#library-search`), takže obe obrazovky hovoria rovnako. */
    const searchRow = total > 0
        ? '<div class="dtl-filter">'
            + '<input id="dec-search" type="search" value="' + esc(decisionsState.q) + '"'
            + ' placeholder="Hľadať v texte a dôvodoch…" autocomplete="off" aria-label="Hľadať v rozhodnutiach">'
            + '</div>'
        : '';   // v prázdnej pamäti nie je v čom hľadať

    const tools = addBtn + (total > 0 ? manageBtn : '');

    // Filtre obdobie / oblasť — s počtami, ako v Denníku. Roky idú chronologicky
    // (je to os, nie množina), oblasti podľa počtu zhora; obe poradia určuje
    // server, aby ich AI videla tak, ako človek.
    const rows = [];
    if (years.length > 1) {
        rows.push(decChip('Celé obdobie', decisionsState.year === null, 'data-year=""', total)
            + years.map((y) => decChip(String(y.year), decisionsState.year === String(y.year),
                'data-year="' + y.year + '"', y.count)).join(''));
    }
    if (areas.length > 1) {
        rows.push(decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""', total)
            + areas.map((a) => decChip(a.name, decisionsState.areaId === a.id,
                'data-area="' + a.id + '"', a.count)).join(''));
    }

    let h = searchRow;
    rows.forEach((chips, i) => {
        const last = i === rows.length - 1;
        h += '<div class="dtl-filter' + (last ? ' dec-toolbar-row' : '') + '">'
            + chips + (last ? tools : '') + '</div>';
    });
    if (!rows.length) h += '<div class="dec-toolbar">' + tools + '</div>';
    if (decisionsState.adding) h += decAddFormHtml();

    body.innerHTML = h + '<div id="dec-list"></div>';
    renderDecisionsList();
    wireDecisions(body);
}

/* Zoznam v samostatnom kontajneri — mení sa pri každom filtri, lišta nad ním nie. */
export function renderDecisionsList() {
    const list = $('dec-list');
    if (!list) return;
    const rows = decisionsState.all;
    // Prázdno má dve rôzne príčiny a nesmú znieť rovnako. `rows` je od 20. 8. 2026
    // už PREFILTROVANÝ serverom, takže „máme vôbec nejaké rozhodnutia?" povie len
    // globálny `counts.total`.
    const anyAtAll = (decisionsState.counts.total || 0) > 0;
    const filtered = decisionsState.year !== null || decisionsState.areaId !== null || decisionsState.q.trim() !== '';

    if (!rows.length) {
        list.innerHTML = emptyHtml('gavel',
            anyAtAll && filtered ? 'Žiadne rozhodnutia pre tento filter' : 'Zatiaľ žiadne rozhodnutia',
            anyAtAll && filtered ? 'Zruš filter a uvidíš celú os.' : 'Objavia sa, keď Hades zaznamená prvé rozhodnutie.');
    } else {
        list.innerHTML = decisionsTimelineHtml(rows);
    }
    wireDecisionList(list);
}

export function decAddFormHtml() {
    // Tu `S.areas` ZOSTÁVA a je to zámer: formulár potrebuje VŠETKY oblasti, aj
    // tie, ktoré ešte žiadne rozhodnutie nemajú. Serverová os `areas` nesie len
    // oblasti s rozhodnutím, pretože to je filtračná os obrazovky, nie zoznam
    // oblastí vedomia. Sú to dve rôzne veci, nie dva zdroje tej istej.
    const areaOpts = '<option value="">— oblasť (voliteľné) —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    const today = new Date().toISOString().slice(0, 10);
    return '<div class="dec-add">'
        + '<input id="dec-text" placeholder="Čo si rozhodol?" autocomplete="off" maxlength="5000" aria-label="Text rozhodnutia">'
        + '<textarea id="dec-reason" rows="2" placeholder="Dôvod (voliteľné)" maxlength="5000" aria-label="Dôvod"></textarea>'
        + '<div class="dec-add-row">'
        + '<select id="dec-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '<input id="dec-date" type="date" value="' + today + '" aria-label="Dátum">'
        + '<button type="button" id="dec-save" class="primary">Uložiť</button>'
        + '</div></div>';
}

export function decisionsTimelineHtml(list) {
    // Poradie je serverové (`decided_on` zhora, pri rovnakom dni `id` zhora) —
    // filter ho zachováva, takže vlastný `sort()` tu bol len druhá kópia pravidla.
    // Mesiac ostáva hlavičkou nad blokom; rozhodnutia vnútri mesiaca tečú do
    // viacstĺpcového bloku (.dtl-group), aby široké okno nesla obsah a nie prázdno.
    // Multi-column (nie grid): text v kartách je rôzne dlhý, tak sa stĺpce doplnia
    // bez ragged riadkov a časová os beží chronologicky DOLE po každom stĺpci.
    let out = '<div class="dtl">';
    let curMonth = null;
    for (const dec of list) {
        const ym = dec.month || '';
        if (ym !== curMonth) {
            if (curMonth !== null) out += '</div>';
            curMonth = ym;
            out += '<div class="dtl-month">' + esc(monthLabel(ym)) + '</div><div class="dtl-group">';
        }
        out += decisionCardHtml(dec);
    }
    if (curMonth !== null) out += '</div>';
    return out + '</div>';
}

export function monthLabel(ym) {
    if (!ym) return 'Bez dátumu';
    const parts = ym.split('-');
    const dt = new Date(+parts[0], (+parts[1] || 1) - 1, 1);
    return dt.toLocaleDateString('sk', { month: 'long', year: 'numeric' });
}

/* Deň a mesiac stačia, kým je os jednoročná. Keď korpus siaha cez viac rokov (a
   pri filtri „Celé obdobie" sa práve tak aj vypisuje), je „14. aug" na karte
   dvojznačné — hlavička mesiaca je nad celým viacstĺpcovým blokom, takže rok pri
   karte v treťom stĺpci nemá odkiaľ prečítať. `withYear` je preto default z osi
   rokov, nie z počtu vykreslených riadkov. */
export function fmtDecDate(iso, withYear) {
    if (!iso) return '—';
    const year = withYear == null ? decisionsState.years.length > 1 : !!withYear;
    const opts = year
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short' };
    return new Date(iso + 'T00:00:00').toLocaleDateString('sk', opts);
}

export function decisionCardHtml(dec) {
    // Názov oblasti dáva SERVER (kľúč `area`). Predtým sa čítal z grafového
    // payloadu, takže obrazovka závisela od toho, či je graf načítaný, a AI
    // dostávala to isté rozhodnutie bez oblasti.
    const area = dec.area || null;
    const hasReason = !!(dec.reason && String(dec.reason).trim());
    // Text aj dôvod chodia z mind_decision tak, ako ich zapísal Claude Code — a nesú
    // `backticky` okolo identifikátorov (zmerané na 4 zo 41 živých rozhodnutí).
    // plainInline pre jednoriadkový text, plainBlock pre dôvod (má white-space: pre-wrap,
    // takže odseky sú v ňom nositeľom štruktúry).
    // Kôš je SÚRODENEC karty, nie jej dieťa: .dtl-card je <button> a tlačidlo
    // vnútri tlačidla je neplatné HTML aj slepá ulička pre klávesnicu.
    const del = decisionsState.managing
        ? '<button type="button" class="danger ms dec-del" data-id="' + dec.id + '"'
            + ' title="Zmazať rozhodnutie" aria-label="Zmazať rozhodnutie">delete</button>'
        : '';
    return '<div class="dtl-item">'
        + '<span class="dtl-dot" data-origin="' + (dec.origin === 'brain' ? 'brain' : 'session') + '" aria-hidden="true"></span>'
        + '<button type="button" class="dtl-card" data-id="' + dec.id + '"'
        + (dec.node_id != null ? ' data-node="' + dec.node_id + '"' : '')
        + (hasReason ? ' data-reason="1" aria-expanded="false"' : '') + '>'
        + '<div class="dtl-head"><span class="dtl-date">' + esc(fmtDecDate(dec.decided_on)) + '</span>'
        + '<span class="dtl-text">' + esc(plainInline(dec.text)) + '</span></div>'
        + (hasReason ? '<div class="dtl-reason hidden">' + esc(plainBlock(dec.reason)) + '</div>' : '')
        + '<div class="dtl-meta">' + originBadge(dec.origin)
        + (area ? '<span class="tag">' + esc(area) + '</span>' : '')
        + (dec.node_id != null ? '<span class="tag muted">uzol #' + dec.node_id + '</span>' : '')
        // Šípka je JEDINÝ indikátor toho, či je dôvod rozbalený — statické „▾" na
        // rozbalenej karte tvrdilo, že sa dá rozbaliť ešte raz.
        + (hasReason ? '<span class="tag muted dtl-reason-chip">dôvod ▾</span>' : '')
        + '</div></button>' + del + '</div>';
}

/* ---------- ozbrojené mazanie ----------
   Prvý klik sa spýta, druhý do 3 s maže. Ten istý vzor ako `#node-delete`
   (controls.js) a `.act-skip` (kontrola.js); natívny `confirm()` sa v tejto
   appke nepoužíva, lebo vytrhne človeka z obrazovky a nedá sa ním zobraziť, ČO
   sa maže.

   Je to `export`, lebo ten istý vzor potrebuje aj obrazovka Smernica. Správne
   miesto je `util.js` medzi ostatnými UI primitívami — ten ale vlastní iná
   session, tak zatiaľ býva tu (obrazovky sa v tomto grafe bežne importujú
   navzájom, napr. `originBadge` z dnes.js). */
export function armDelete(btn, question, onConfirm) {
    if (!btn) return;
    if (btn.dataset.armed === '1') {
        disarmDelete(btn);
        onConfirm();
        return;
    }
    // Ozbrojené smie byť naraz jediné tlačidlo: dve otvorené otázky vedľa seba
    // znamenajú, že druhý klik potvrdí niečo iné, než na čo sa človek pýtal.
    document.querySelectorAll('button[data-armed="1"]').forEach(disarmDelete);
    btn.dataset.armed = '1';
    btn.dataset.armIcon = btn.textContent;
    btn.classList.remove('ms');
    btn.classList.add('armed');
    btn.textContent = question;
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmDelete(btn); }, 3000);
}

export function disarmDelete(btn) {
    if (!btn) return;
    clearTimeout(btn._disarm);
    btn.dataset.armed = '0';
    btn.classList.remove('armed');
    btn.classList.add('ms');
    btn.textContent = btn.dataset.armIcon || 'delete';
}

export function wireDecisions(body) {
    const toggle = $('dec-add-toggle');
    if (toggle) toggle.onclick = () => { decisionsState.adding = !decisionsState.adding; renderDecisionsView(); if (decisionsState.adding) { const t = $('dec-text'); if (t) t.focus(); } };

    const manage = $('dec-manage');
    if (manage) manage.onclick = () => { decisionsState.managing = !decisionsState.managing; renderDecisionsView(); };

    const saveBtn = $('dec-save');
    if (saveBtn) saveBtn.onclick = () => saveDecision(saveBtn);

    /* Hľadanie ide na server, tak sa nesmie pýtať na každé písmeno. 250 ms je
       kratšie než rozmyslenie ďalšieho znaku a dlhšie než rýchle písanie;
       `decisionsState.seq` navyše zahodí odpoveď, ktorú predbehla novšia. */
    const search = $('dec-search');
    if (search) {
        search.oninput = () => {
            decisionsState.q = search.value || '';
            clearTimeout(decisionsState.qTimer);
            decisionsState.qTimer = setTimeout(refreshDecisionList, 250);
        };
        search.onkeydown = (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(decisionsState.qTimer);
            refreshDecisionList();
        };
    }

    body.querySelectorAll('.dtl-filter [data-year]').forEach((c) => {
        c.onclick = () => {
            decisionsState.year = c.dataset.year || null;
            syncDecChips(body, 'year');
            refreshDecisionList();
        };
    });
    body.querySelectorAll('.dtl-filter [data-area]').forEach((c) => {
        c.onclick = () => {
            decisionsState.areaId = c.dataset.area ? +c.dataset.area : null;
            syncDecChips(body, 'area');
            refreshDecisionList();
        };
    });
}

/* Aktívny čip sa prekliká hneď, dáta dobehnú o request neskôr. Prekresliť kvôli
   tomu celú lištu nejde — bolo by v nej pole hľadania, do ktorého sa práve píše. */
export function syncDecChips(body, kind) {
    const attr = kind === 'year' ? 'data-year' : 'data-area';
    const want = kind === 'year'
        ? (decisionsState.year === null ? '' : decisionsState.year)
        : (decisionsState.areaId === null ? '' : String(decisionsState.areaId));
    body.querySelectorAll('.dtl-filter [' + attr + ']').forEach((c) => {
        const on = (c.getAttribute(attr) || '') === want;
        c.classList.toggle('active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

export function wireDecisionList(list) {
    list.querySelectorAll('.dtl-card').forEach((card) => {
        card.onclick = () => {
            const reason = card.querySelector('.dtl-reason');
            if (card.dataset.reason && reason) {
                const open = reason.classList.toggle('hidden') === false;
                card.setAttribute('aria-expanded', open ? 'true' : 'false');
                const chip = card.querySelector('.dtl-reason-chip');
                if (chip) chip.textContent = open ? 'dôvod ▴' : 'dôvod ▾';
            } else if (card.dataset.node) {
                openNodeFromAnywhere({ id: +card.dataset.node });
            }
        };
    });

    list.querySelectorAll('.dec-del').forEach((btn) => {
        btn.onclick = (e) => {
            e.stopPropagation();
            armDelete(btn, 'Naozaj zmazať?', () => deleteDecision(btn, +btn.dataset.id));
        };
    });
}

export async function deleteDecision(btn, id) {
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/decisions/' + id, { method: 'DELETE' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(j.message || 'Nepodarilo sa zmazať', null, 'error');
                return;
            }
            /* Markdown zrkadlo zostáva na disku — kontrolér ho zámerne nereže
               (vyrezať riadok zo súboru v mozgu je nevratný zásah). Keď rozhodnutie
               zrkadlo malo, treba to povedať, inak sa človek dozvie o zvyšku až
               pri ďalšom čítaní súboru. */
            showToast(j.source_file
                ? 'Rozhodnutie zmazané — zápis v ' + j.source_file + ' zostáva'
                : 'Rozhodnutie zmazané', null, 'success');
            // Počty aj osi sa mazaním menia, takže tu ide celé načítanie, nie zoznam.
            renderDecisions();
        } catch (e) {
            showToast('Nepodarilo sa zmazať', null, 'error');
        }
    }, 'Maže sa…');
}

export async function saveDecision(btn) {
    const text = ($('dec-text').value || '').trim();
    if (!text) { showToast('Napíš text rozhodnutia'); $('dec-text').focus(); return; }
    const reason = ($('dec-reason').value || '').trim();
    const areaVal = $('dec-area').value;
    const dateVal = $('dec-date').value;
    const payload = { text };
    if (reason) payload.reason = reason;
    if (areaVal) payload.area = areaVal;
    if (dateVal) payload.decided_on = dateVal;

    await busy(btn, async () => {
        try {
            const res = await fetch('/api/decisions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(j.message || j.error || 'Uloženie sa nepodarilo', null, 'error');
                return;
            }
            decisionsState.adding = false;
            showToast('Rozhodnutie uložené', null, 'success');
            renderDecisions();
        } catch (e) {
            showToast('Uloženie sa nepodarilo', null, 'error');
        }
    }, 'Ukladá sa…');
}
