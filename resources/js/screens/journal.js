/* Obrazovka Denník — časová os záznamov zoskupená po dňoch, filter podľa projektu.

   Anatómia: hlavička (blade) → .screen-toolbar s čipmi projektov → zoznam.
   Prázdne stavy sú tri rôzne (nič v denníku / nič pre filter / chyba načítania),
   pretože každý z nich znamená pre používateľa iný ďalší krok. */

import { apiGet } from '../core/api.js';
import { $, esc } from '../core/dom.js';
import { dayLabel, timeHM, ts } from '../core/format.js';
import { bindPackButtons, packBtn } from '../dock/pack.js';
import { emptyStateHtml, listSkeletonHtml, renderApiError, renderEmptyState } from './shared/anatomy.js';
import { openNodeFromAnywhere } from '../shell/router.js';


let journalRecords = [];

let journalProject = null;


export async function renderJournal() {
    const list = $('journal-list');
    if (!list) return;
    list.innerHTML = listSkeletonHtml(6, '58px');
    try {
        const data = await apiGet('/api/journal');
        journalRecords = data.records || [];
        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        const wrap = $('journal-filter');
        if (wrap) wrap.innerHTML = '';
        renderApiError(list, e, renderJournal);
    }
}


function renderJournalFilter() {
    const wrap = $('journal-filter');
    if (!wrap) return;
    const projects = [...new Set(journalRecords.map((r) => r.project).filter(Boolean))];
    if (journalProject && !projects.includes(journalProject)) journalProject = null;
    if (!projects.length) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = '<button type="button" class="chip' + (journalProject ? '' : ' active') + '" data-project="">Všetky</button>'
        + projects.map((p) =>
            '<button type="button" class="chip' + (journalProject === p ? ' active' : '') + '" data-project="' + esc(p) + '">' + esc(p) + '</button>'
        ).join('')
        + '<span class="toolbar-note tnum">' + journalRecords.length + ' záznamov</span>';

    wrap.querySelectorAll('.chip').forEach((chip) => {
        chip.onclick = () => {
            journalProject = chip.dataset.project || null;
            renderJournalFilter();
            renderJournalList();
        };
    });
}


function renderJournalList() {
    const list = $('journal-list');
    if (!list) return;

    if (!journalRecords.length) {
        renderEmptyState(list, 'receipt_long', 'Denník je prázdny',
            'Záznamy vznikajú z Claude Code sessions pri ingeste — nič sa nezapisuje ručne.');
        return;
    }

    const records = journalProject
        ? journalRecords.filter((r) => r.project === journalProject)
        : journalRecords;

    if (!records.length) {
        list.innerHTML = emptyStateHtml('filter_alt_off', 'Pre tento projekt nič nie je',
            'Vyber iný projekt alebo klikni na „Všetky".');
        return;
    }

    const sorted = [...records].sort((a, b) => ts(b.created_at) - ts(a.created_at));

    let html = '', lastDay = null;
    for (const r of sorted) {
        const day = dayLabel(r.created_at);
        if (day !== lastDay) {
            html += '<div class="day-head">' + esc(day) + '</div>';
            lastDay = day;
        }
        html += journalRowHtml(r);
    }
    list.innerHTML = html;

    list.querySelectorAll('.record').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    bindPackButtons(list);
}


function journalRowHtml(r) {
    const isDigest = r.source === 'digest';
    const badges = [];
    if (r.project) badges.push('<span class="tag">' + esc(r.project) + '</span>');
    if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
    if (r.commits && r.commits.length) {
        const c = r.commits.length;
        const word = c === 1 ? 'commit' : (c >= 2 && c <= 4 ? 'commity' : 'commitov');
        badges.push('<span class="tag muted">' + c + ' ' + word + '</span>');
    }
    return '<div class="li-wrap rec-wrap">'
        + '<button type="button" class="record" data-id="' + r.id + '" data-label="' + esc(r.label) + '">'
        + '<div class="record-head"><span class="ms rec-ico" aria-hidden="true">' + (isDigest ? 'calendar_month' : 'article') + '</span>'
        + '<span class="record-title">' + esc(r.label) + '</span>'
        + '<span class="record-time tnum">' + timeHM(r.created_at) + '</span></div>'
        + (badges.length ? '<div class="record-tags">' + badges.join('') + '</div>' : '')
        + '</button>'
        + packBtn(r.id, r.label) + '</div>';
}
