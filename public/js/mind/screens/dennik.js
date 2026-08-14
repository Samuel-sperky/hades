import { bindPackButtons, packBtn } from '../pack.js';
import { openNodeFromAnywhere } from '../screens.js';
import { $, esc, renderEmpty, renderLoading, ts } from '../util.js';

// Denník — časová os zoskupená po dňoch, s filtrom podľa projektu
export const SK_MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
    'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];

export let journalRecords = [];
export let journalProject = null;
// Projektov je bežne ~28 — všetky naraz sa lámu na dva riadky chipov nad obsahom.
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

export async function renderJournal() {
    const list = $('journal-list');
    renderLoading(list, 'Načítavam denník…');
    try {
        const data = await (await fetch('/api/journal')).json();
        journalRecords = data.records || [];
        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        renderEmpty(list, 'cloud_off', 'Nepodarilo sa načítať denník', 'Skús obnoviť stránku.');
    }
}

export function renderJournalFilter() {
    const wrap = $('journal-filter');
    // Poradie podľa počtu záznamov — v zbalenom rade tak ostanú tie, ktoré sa reálne
    // používajú, nie tie, čo prišli v dátach prvé.
    const counts = new Map();
    for (const r of journalRecords) {
        if (!r.project) continue;
        counts.set(r.project, (counts.get(r.project) || 0) + 1);
    }
    const projects = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'sk'));
    if (journalProject && !projects.includes(journalProject)) journalProject = null;
    if (!projects.length) { wrap.innerHTML = ''; return; }

    const hiddenCount = Math.max(0, projects.length - JOURNAL_CHIPS_TOP);
    // aktívny filter musí byť vždy vidieť, aj keď je mimo najčastejších
    if (journalProject && projects.indexOf(journalProject) >= JOURNAL_CHIPS_TOP) journalChipsOpen = true;
    const shown = journalChipsOpen ? projects : projects.slice(0, JOURNAL_CHIPS_TOP);

    wrap.innerHTML = '<button type="button" class="chip' + (journalProject ? '' : ' active') + '" data-project="">Všetky</button>'
        + shown.map((p) =>
            '<button type="button" class="chip' + (journalProject === p ? ' active' : '') + '" data-project="' + esc(p) + '">'
            + esc(p) + '<span class="chip-n">' + counts.get(p) + '</span></button>'
        ).join('')
        + (hiddenCount ? '<button type="button" class="chip chip-more" id="journal-chips-more">'
            + (journalChipsOpen ? 'menej' : '+' + hiddenCount + ' viac') + '</button>' : '');

    const more = $('journal-chips-more');
    if (more) more.onclick = () => { journalChipsOpen = !journalChipsOpen; renderJournalFilter(); };

    wrap.querySelectorAll('.chip[data-project]').forEach((chip) => {
        chip.onclick = () => {
            journalProject = chip.dataset.project || null;
            renderJournalFilter();
            renderJournalList();
        };
    });
}

export function renderJournalList() {
    const list = $('journal-list');

    if (!journalRecords.length) {
        renderEmpty(list, 'receipt_long', 'Zatiaľ žiadne záznamy', 'Pribudnú, keď si Hades zapamätá prvý poznatok.');
        return;
    }

    const records = journalProject
        ? journalRecords.filter((r) => r.project === journalProject)
        : journalRecords;

    if (!records.length) {
        renderEmpty(list, 'filter_alt_off', 'Žiadne záznamy pre tento projekt', 'Zruš filter a uvidíš celý denník.');
        return;
    }

    const sorted = [...records].sort((a, b) => ts(b.created_at) - ts(a.created_at));

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
        if (r.project && !titleHasProject) badges.push('<span class="tag">' + esc(r.project) + '</span>');
        if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
        if (r.commits && r.commits.length) {
            const c = r.commits.length;
            const word = c === 1 ? 'commit' : (c >= 2 && c <= 4 ? 'commity' : 'commitov');
            badges.push('<span class="tag muted">' + c + ' ' + word + '</span>');
        }
        // Značky žijú v hlavičke riadku (nie pod ňou) — na širokom okne tak riadok
        // využije šírku: názov vľavo, značky + čas vpravo, namiesto prázdneho stredu.
        html += '<div class="li-wrap rec-wrap">'
            + '<button type="button" class="record" data-id="' + r.id + '" data-label="' + esc(r.label) + '">'
            + '<div class="record-head"><span class="ms rec-ico" aria-hidden="true">' + (isDigest ? 'calendar_month' : 'article') + '</span>'
            + '<span class="record-title">' + esc(r.label) + '</span>'
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
