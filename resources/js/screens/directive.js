/* Obrazovka Smernica — prompt builder pre Claude Code.

   Tok: úloha (alebo šablóna) → /api/directive/build poskladá návrh (skilly,
   projekty, fakty, pravidlá) → editovateľný checklist → náhľad markdownu sa
   prestavuje KLIENTSKY z vybraných položiek → kopírovať / uložiť ako .md.

   Anatómia: .screen-toolbar (šablóny) → vstup úlohy → dva stĺpce (návrh |
   náhľad) → sekcia uložených smerníc. Šírku dáva `.screen--wide` v blade.
   Sekcia „Kde nájdeš" je v P10 zrušená (viď directive/markdown-builder.js).

   Verejné rozhranie: renderDirective (router.js), gotoDirective (cmdk.js). */

import { apiGet, apiSend } from '../core/api.js';
import { $, busy, esc } from '../core/dom.js';
import { mdToHtml } from '../markdown.js';
import { emptyStateHtml, renderEmptyState } from './shared/anatomy.js';
import { buildDirectiveMarkdown } from './directive/markdown-builder.js';
import { DIR_SECTIONS, pickSelected, suggestHtml, suggestTotal } from './directive/suggest.js';
import { setScreen } from '../shell/router.js';
import { showToast } from '../shell/toasts.js';


let directiveData = null;         // posledný /build výsledok { task, suggested }

const directiveSel = new Set();   // node_id zahrnuté v smernici (zaškrtnuté)

let directiveTemplates = null;    // cache šablón (/api/directive/templates)

let directiveMarkdown = '';       // aktuálny markdown náhľadu (na copy/save)

let directiveBuildSeq = 0;        // ochrana proti pretekaniu odpovedí


function shellHtml() {
    return '<div class="page-stack">'
        + '<div class="screen-toolbar dir-templates" id="dir-templates"></div>'
        + '<div class="dir-input-row">'
        + '<input id="dir-task" class="dir-task" placeholder="Na čom pracuješ? Napíš úlohu…" autocomplete="off" aria-label="Úloha">'
        + '<button type="button" id="dir-build" class="primary">Poskladať</button>'
        + '</div>'
        + '<div class="dir-cols">'
        + '<div class="dir-suggest" id="dir-suggest"></div>'
        + '<div class="dir-preview-wrap">'
        + '<div class="dir-preview-head"><h2>Náhľad smernice</h2>'
        + '<div class="dir-actions">'
        + '<button type="button" id="dir-copy" class="ghost ms" title="Kopírovať smernicu" aria-label="Kopírovať smernicu">content_copy</button>'
        + '<button type="button" id="dir-save" class="ghost ms" title="Uložiť ako .md" aria-label="Uložiť ako .md">save</button>'
        + '</div></div>'
        + '<div class="dir-preview md-body" id="dir-preview"></div>'
        + '</div></div>'
        + '<section class="screen-sec dir-saved-sec"><div class="sec-head"><h2>Uložené smernice</h2></div>'
        + '<div class="dir-saved" id="dir-saved"></div></section>'
        + '</div>';
}


export function renderDirective(prefillTask) {
    const body = $('directive-body');
    if (!body) return;
    body.innerHTML = shellHtml();

    const taskInput = $('dir-task');
    const buildBtn = $('dir-build');
    if (buildBtn) buildBtn.onclick = () => busy(buildBtn, () => runDirectiveBuild(taskInput ? taskInput.value : ''), 'Skladám…');
    if (taskInput) taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runDirectiveBuild(taskInput.value); }
    });
    const copyBtn = $('dir-copy');
    if (copyBtn) copyBtn.onclick = copyDirective;
    const saveBtn = $('dir-save');
    if (saveBtn) saveBtn.onclick = saveDirective;

    loadDirectiveTemplates();
    loadDirectiveSaved();

    if (prefillTask != null && taskInput) taskInput.value = prefillTask;

    if (directiveData) {
        renderDirectiveSuggest();
    } else {
        renderEmptyState($('dir-suggest'), 'assignment', 'Zatiaľ nič nie je poskladané',
            'Vyber šablónu vyššie alebo napíš úlohu — AuraAI nájde relevantné skilly, projekty a pravidlá.');
    }
    renderDirectivePreview();

    if (prefillTask) runDirectiveBuild(prefillTask);
}


/** Skok na obrazovku Smernica s predvyplneným dopytom (z Cmd-K akcie). */
export function gotoDirective(task) {
    setScreen('smernica');
    const inp = $('dir-task');
    if (inp) inp.value = task || '';
    if (task) runDirectiveBuild(task);
}


async function loadDirectiveTemplates() {
    const box = $('dir-templates');
    if (!box) return;
    try {
        if (!directiveTemplates) {
            const d = await apiGet('/api/directive/templates');
            directiveTemplates = d.templates || [];
        }
        box.innerHTML = directiveTemplates.map((t, i) =>
            '<button type="button" class="dir-tpl" data-i="' + i + '" title="' + esc(t.hint || '') + '">'
            + '<span class="ms" aria-hidden="true">bolt</span>' + esc(t.name) + '</button>'
        ).join('');
        box.querySelectorAll('.dir-tpl').forEach((b) => {
            b.onclick = () => {
                const t = directiveTemplates[+b.dataset.i];
                if (!t) return;
                const inp = $('dir-task');
                if (inp) inp.value = t.task || '';
                runDirectiveBuild(t.task || '');
            };
        });
    } catch (e) { box.innerHTML = ''; }
}


async function runDirectiveBuild(task) {
    task = (task || '').trim();
    const suggest = $('dir-suggest');
    if (task === '') { showToast('Napíš úlohu alebo vyber šablónu'); return; }
    if (suggest) {
        suggest.innerHTML = '<div class="empty"><span class="ms" aria-hidden="true">hourglass_empty</span>'
            + '<p>Skladám…</p></div>';
    }
    const seq = ++directiveBuildSeq;
    let data;
    try {
        data = await apiSend('POST', '/api/directive/build', { task });
    } catch (e) {
        if (seq === directiveBuildSeq && suggest) {
            renderEmptyState(suggest, 'cloud_off', 'Nepodarilo sa poskladať',
                'Server neodpovedal. Skús to znova — rozpísaná úloha zostáva v poli.');
        }
        return;
    }
    if (seq !== directiveBuildSeq) return;

    directiveData = { task: data.task || task, suggested: data.suggested || {} };
    directiveSel.clear();
    for (const sec of DIR_SECTIONS) {
        for (const it of (directiveData.suggested[sec.key] || [])) directiveSel.add(+it.id);
    }
    renderDirectiveSuggest();
    renderDirectivePreview();
}


function renderDirectiveSuggest() {
    const wrap = $('dir-suggest');
    if (!wrap || !directiveData) return;
    if (!suggestTotal(directiveData.suggested)) {
        renderEmptyState(wrap, 'search_off', 'Nič relevantné sa nenašlo',
            'Skús úlohu formulovať inak alebo konkrétnejšie — hľadá sa v skilloch, projektoch a pravidlách.');
        return;
    }
    wrap.innerHTML = suggestHtml(directiveData.suggested, directiveSel);

    wrap.querySelectorAll('.dir-check input[type="checkbox"]').forEach((cb) => {
        cb.onchange = () => {
            const id = +cb.dataset.id;
            if (cb.checked) directiveSel.add(id); else directiveSel.delete(id);
            const lab = cb.closest('.dir-check');
            if (lab) lab.classList.toggle('off', !cb.checked);
            renderDirectivePreview();
        };
    });
}


function renderDirectivePreview() {
    const pv = $('dir-preview');
    if (!pv) return;
    if (!directiveData) {
        directiveMarkdown = '';
        pv.innerHTML = emptyStateHtml('description', 'Náhľad je prázdny',
            'Poskladaj smernicu a tu sa objaví markdown, ktorý vložíš Claude Code.');
        return;
    }
    directiveMarkdown = buildDirectiveMarkdown(
        directiveData.task,
        pickSelected(directiveData.suggested, directiveSel),
    );
    pv.innerHTML = mdToHtml(directiveMarkdown);
}


async function copyDirective() {
    if (!directiveMarkdown) { showToast('Najprv poskladaj smernicu'); return; }
    try { await navigator.clipboard.writeText(directiveMarkdown); showToast('Smernica skopírovaná'); }
    catch (e) { showToast('Kopírovanie zlyhalo'); }
}


async function saveDirective() {
    if (!directiveMarkdown || !directiveData) { showToast('Najprv poskladaj smernicu'); return; }
    const name = (directiveData.task || '').trim() || 'smernica';
    try {
        const data = await apiSend('POST', '/api/directive/save', { name, markdown: directiveMarkdown });
        showToast('Uložené: ' + ((data && data.path) || ''));
        loadDirectiveSaved();
    } catch (e) { showToast('Uloženie zlyhalo', null, 'error'); }
}


async function loadDirectiveSaved() {
    const box = $('dir-saved');
    if (!box) return;
    try {
        const d = await apiGet('/api/directives');
        const items = d.directives || [];
        if (!items.length) {
            renderEmptyState(box, 'folder_open', 'Zatiaľ žiadne uložené smernice',
                'Uložením vznikne directives/<slug>.md, ktoré vieš kedykoľvek znovu otvoriť.');
            return;
        }
        box.innerHTML = items.map((it) =>
            '<button type="button" class="dir-saved-item" data-name="' + esc(it.name) + '">'
            + '<span class="ms" aria-hidden="true">description</span>'
            + '<span class="dsi-text"><span class="dsi-title">' + esc(it.title || it.name) + '</span>'
            + '<span class="dsi-path">' + esc(it.path) + '</span></span></button>'
        ).join('');
        box.querySelectorAll('.dir-saved-item').forEach((b) => {
            b.onclick = () => openSavedDirective(b.dataset.name);
        });
    } catch (e) {
        renderEmptyState(box, 'cloud_off', 'Uložené smernice sa nenačítali', null);
    }
}


async function openSavedDirective(name) {
    let d;
    try {
        d = await apiGet('/api/directive/' + encodeURIComponent(name));
    } catch (e) { showToast('Nepodarilo sa načítať', null, 'error'); return; }
    if (!d || !d.markdown) { showToast('Smernica sa nenašla'); return; }
    directiveMarkdown = d.markdown;
    const pv = $('dir-preview');
    if (pv) pv.innerHTML = mdToHtml(d.markdown);
    try { await navigator.clipboard.writeText(d.markdown); showToast('Smernica skopírovaná'); }
    catch (e) { showToast('Smernica otvorená'); }
}
