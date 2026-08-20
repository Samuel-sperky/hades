import { bindPackButtons, packBtn } from '../pack.js';
import { openNodeFromAnywhere } from '../screens.js';
import { $, esc, getJson, prettyLabel, renderEmpty, renderLoading } from '../util.js';

// Denník — časová os zoskupená po dňoch, s filtrom podľa projektu
export const SK_MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
    'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];

export let journalRecords = [];
// Skupiny projektov a celkový počet chodia zo SERVERA (DennikScreen). Do 20. 8. 2026
// si ich obrazovka počítala z 50 načítaných záznamov, takže čip tvrdil iné číslo než
// server — a AI, ktorá čítala serverové počty, tretie. Počítanie je údaj, nie kresba.
export let journalGroups = [];
export let journalTotal = 0;
export let journalProject = null;
// Projektov je bežne ~23 — všetky naraz sa lámu na dva riadky chipov nad obsahom.
// Preto zbalený rad: najčastejšie projekty + „viac".
export let journalChipsOpen = false;
export const JOURNAL_CHIPS_TOP = 8;

export function dayLabel(iso) {
    const d = new Date(iso);
    const t = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((midnight(t) - midnight(d)) / 86400000);
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    return d.getDate() + '. ' + SK_MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear();
}

export function timeHM(iso) {
    return new Date(iso).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}

/* Filtruje SERVER, nie prehliadač. Kľúč skupiny („#bez-projektu") ide ako query
   parameter, takže počet na čipe a počet záznamov po kliknutí je to isté číslo —
   kým sa filtrovalo nad oknom 50 záznamov, čip sľuboval 22 a zoznam dal 9. */
export async function renderJournal() {
    const list = $('journal-list');
    renderLoading(list, 'Načítavam denník…');
    try {
        const q = journalProject ? '?project=' + encodeURIComponent(journalProject) : '';
        const data = await getJson('/api/journal' + q);
        journalRecords = data.records || [];
        journalGroups = data.project_groups || [];
        journalTotal = data.total || 0;

        // Aktívny filter, ktorý v skupinách zo servera už nie je (posledný záznam
        // projektu sa premenoval), by zamkol prázdnu obrazovku — zruš ho a načítaj
        // znova. Druhýkrát sa to stať nemôže, filter je vtedy prázdny.
        if (journalProject && !journalGroups.some((g) => g.key === journalProject)) {
            journalProject = null;
            return renderJournal();
        }

        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        renderEmpty(list, 'cloud_off', 'Nepodarilo sa načítať denník', 'Skús obnoviť stránku.');
    }
}

/* Skupinu „bez projektu" tvorí server ({@see App\Support\ProjectGroup}): sessions
   z dočasných adresárov majú v dátach každá svoj strojový názov („mystifying-
   mclaren-23750a") a kým ich zlučoval prehliadač, človek videl jednu skupinu, ale
   AI dvanásť uzlov so strojovými menami. Sentinel je tu už len na porovnanie. */
export const JOURNAL_NO_PROJECT = '#bez-projektu';

export function renderJournalFilter() {
    const wrap = $('journal-filter');
    // Poradie aj počty sú zo servera (podľa počtu záznamov v CELOM denníku), takže
    // v zbalenom rade ostanú tie projekty, ktoré sa reálne používajú.
    const groups = journalGroups;
    if (!groups.length) { wrap.innerHTML = ''; return; }

    const hiddenCount = Math.max(0, groups.length - JOURNAL_CHIPS_TOP);
    // aktívny filter musí byť vždy vidieť, aj keď je mimo najčastejších
    if (journalProject && groups.findIndex((g) => g.key === journalProject) >= JOURNAL_CHIPS_TOP) journalChipsOpen = true;
    const shown = journalChipsOpen ? groups : groups.slice(0, JOURNAL_CHIPS_TOP);

    wrap.innerHTML = '<button type="button" class="chip' + (journalProject ? '' : ' active') + '" data-project="">'
        + 'Všetky<span class="chip-n">' + journalTotal + '</span></button>'
        + shown.map((g) =>
            // data-project nesie KĽÚČ skupiny (filtruje sa ním), popisok ľudský text
            '<button type="button" class="chip' + (journalProject === g.key ? ' active' : '') + '" data-project="' + esc(g.key) + '">'
            + esc(g.label) + '<span class="chip-n">' + g.count + '</span></button>'
        ).join('')
        + (hiddenCount ? '<button type="button" class="chip chip-more" id="journal-chips-more">'
            + (journalChipsOpen ? 'menej' : '+' + hiddenCount + ' viac') + '</button>' : '');

    const more = $('journal-chips-more');
    if (more) more.onclick = () => { journalChipsOpen = !journalChipsOpen; renderJournalFilter(); };

    wrap.querySelectorAll('.chip[data-project]').forEach((chip) => {
        chip.onclick = () => {
            journalProject = chip.dataset.project || null;
            renderJournal();
        };
    });
}

export function renderJournalList() {
    const list = $('journal-list');

    if (!journalRecords.length) {
        if (journalProject) renderEmpty(list, 'filter_alt_off', 'Žiadne záznamy pre tento projekt', 'Zruš filter a uvidíš celý denník.');
        else renderEmpty(list, 'receipt_long', 'Zatiaľ žiadne záznamy', 'Pribudnú, keď si Hades zapamätá prvý poznatok.');
        return;
    }

    // Filtruje a radí server; obrazovka záznamy len zoskupí po dňoch.
    const sorted = journalRecords;

    // Dni sú štruktúra (zostávajú v jednom stĺpci pod sebou); záznamy VNÚTRI dňa
    // idú do fluidnej mriežky (.rec-grid), takže na širokom okne sa šírka vyplní
    // obsahom a nie prázdnom medzi názvom a meta.
    let html = '', lastDay = null;
    for (const r of sorted) {
        const day = dayLabel(r.created_at);
        if (day !== lastDay) {
            if (lastDay !== null) html += '</div>';
            html += '<div class="day-head">' + esc(day) + '</div><div class="rec-grid">';
            lastDay = day;
        }
        const isDigest = r.source === 'digest';
        const badges = [];
        // Titulok často začína názvom projektu („AI-mind — práca 12.8.2026"), takže
        // chip s projektom by ten istý reťazec zopakoval a v stĺpci by zbytočne
        // zjedol šírku (a názov by sa preto skrátil). V takom prípade chip vynecháme.
        const titleHasProject = r.project && r.label
            && r.label.toLowerCase().startsWith(String(r.project).toLowerCase());
        if (r.project && !titleHasProject) badges.push('<span class="tag">' + esc(r.project_label || '') + '</span>');
        if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
        // `commit_count` dáva server (rovnako ako `file_count`); prehliadač si ho
        // dopočítaval z pola, ktoré na obrazovke nikto nevidí.
        if (r.commit_count) {
            const c = r.commit_count;
            const word = c === 1 ? 'commit' : (c >= 2 && c <= 4 ? 'commity' : 'commitov');
            badges.push('<span class="tag muted">' + c + ' ' + word + '</span>');
        }
        // Značky žijú v hlavičke riadku (nie pod ňou) — na širokom okne tak riadok
        // využije šírku: názov vľavo, značky + čas vpravo, namiesto prázdneho stredu.
        html += '<div class="li-wrap rec-wrap">'
            + '<button type="button" class="record" data-id="' + r.id + '" data-label="' + esc(r.label) + '">'
            + '<div class="record-head"><span class="ms rec-ico" aria-hidden="true">' + (isDigest ? 'calendar_month' : 'article') + '</span>'
            + '<span class="record-title">' + esc(prettyLabel(r.label, r.project)) + '</span>'
            + (badges.length ? '<span class="record-tags">' + badges.join('') + '</span>' : '')
            + '<span class="record-time">' + timeHM(r.created_at) + '</span></div>'
            + '</button>'
            + packBtn(r.id, r.label) + '</div>';
    }
    if (lastDay !== null) html += '</div>';
    list.innerHTML = html;

    list.querySelectorAll('.record').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    bindPackButtons(list);
}
