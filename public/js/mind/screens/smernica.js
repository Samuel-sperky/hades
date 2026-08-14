import { mdToHtml } from '../md.js';
import { setScreen } from '../screens.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyHtml, esc, plainText, renderEmpty, renderLoading } from '../util.js';

/* ---------- obrazovka Smernica (/api/directive/*) ----------
   Prompt builder: úloha → Hades poskladá KDE ČO NÁJDE (skilly, projekty,
   fakty, pravidlá). Návrh je editovateľný checklist; náhľad smernice sa
   prestavuje klientsky z vybraných položiek (aby unchecked ostalo unchecked).
   Uloženie zapíše directives/<slug>.md cez /api/directive/save. */

export let directiveData = null;         // posledný /build výsledok { task, suggested }
export const directiveSel = new Set();   // node_id zahrnuté v smernici (zaškrtnuté)
export let directiveTemplates = null;    // cache šablón (/api/directive/templates)
export let directiveMarkdown = '';       // aktuálny markdown náhľadu (na copy/save)
export let directiveBuildSeq = 0;        // ochrana proti pretekaniu odpovedí

export const DIR_SECTIONS = [
    { key: 'skills', title: 'Skilly', icon: 'bolt' },
    { key: 'projects', title: 'Projekty', icon: 'inventory_2' },
    { key: 'facts', title: 'Fakty', icon: 'psychology' },
    { key: 'rules', title: 'Pravidlá', icon: 'gavel' },
];

export function renderDirective(prefillTask) {
    const body = $('directive-body');
    if (!body) return;
    body.innerHTML =
        '<div class="dir-templates" id="dir-templates"></div>'
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
        + '<section class="dir-saved-sec"><h2>Uložené smernice</h2><div class="dir-saved" id="dir-saved"></div></section>';

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
        renderDirectivePreview();
    } else {
        renderEmpty($('dir-suggest'), 'assignment', 'Vyber šablónu alebo napíš úlohu');
        renderDirectivePreview();
    }

    if (prefillTask) runDirectiveBuild(prefillTask);
}

// Skok na obrazovku Smernica s predvyplneným dopytom (z Cmd-K akcie).
export function gotoDirective(task) {
    setScreen('smernica');
    const inp = $('dir-task');
    if (inp) inp.value = task || '';
    if (task) runDirectiveBuild(task);
}

export async function loadDirectiveTemplates() {
    const box = $('dir-templates');
    if (!box) return;
    try {
        if (!directiveTemplates) {
            const d = await (await fetch('/api/directive/templates')).json();
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

export async function runDirectiveBuild(task) {
    task = (task || '').trim();
    const suggest = $('dir-suggest');
    if (task === '') { showToast('Napíš úlohu alebo vyber šablónu'); return; }
    if (suggest) renderLoading(suggest, 'Skladám kontext…');
    const seq = ++directiveBuildSeq;
    try {
        const res = await fetch('/api/directive/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task }),
        });
        const data = await res.json();
        if (seq !== directiveBuildSeq) return;
        directiveData = { task: data.task || task, suggested: data.suggested || {} };
        directiveSel.clear();
        for (const sec of DIR_SECTIONS) {
            for (const it of (directiveData.suggested[sec.key] || [])) directiveSel.add(+it.id);
        }
        renderDirectiveSuggest();
        renderDirectivePreview();
    } catch (e) {
        if (seq === directiveBuildSeq && suggest) renderEmpty(suggest, 'cloud_off', 'Nepodarilo sa poskladať smernicu', 'Skús to znova.');
    }
}

export function renderDirectiveSuggest() {
    const wrap = $('dir-suggest');
    if (!wrap || !directiveData) return;
    const sug = directiveData.suggested || {};
    const total = DIR_SECTIONS.reduce((n, s) => n + ((sug[s.key] || []).length), 0);
    if (!total) { renderEmpty(wrap, 'search_off', 'Nič relevantné sa nenašlo', 'Opíš úlohu inými slovami.'); return; }

    let h = '';
    for (const sec of DIR_SECTIONS) {
        const items = sug[sec.key] || [];
        if (!items.length) continue;
        h += '<div class="dir-group"><div class="dir-group-head">'
            + '<span class="ms" aria-hidden="true">' + sec.icon + '</span>' + esc(sec.title)
            + '<span class="dir-group-n">' + items.length + '</span></div>'
            + items.map((it) => dirItem(sec.key, it)).join('')
            + '</div>';
    }
    wrap.innerHTML = h;

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

export function dirItem(key, it) {
    const id = +it.id;
    const on = directiveSel.has(id);
    let sub = '';
    if (key === 'skills' && it.path) sub = '<code class="dir-path">' + esc(it.path) + '</code>';
    else if (key === 'projects' && it.info) sub = '<span class="dir-sub">' + esc(it.info) + '</span>';
    // Náhľad položky = obyčajný text; markdown zostáva len vo VÝSTUPE smernice
    // (dirOneLine nižšie), ktorý číta Claude Code, nie človek na obrazovke.
    else if (it.snippet) sub = '<span class="dir-sub">' + esc(plainText(it.snippet)) + '</span>';

    let badge = '';
    if (key === 'skills') {
        badge = it.verified
            ? '<span class="dir-badge ok">overené</span>'
            : '<span class="dir-badge warn">neoverené</span>';
    }

    return '<label class="check dir-check' + (on ? '' : ' off') + '">'
        + '<input type="checkbox" data-id="' + id + '"' + (on ? ' checked' : '') + '>'
        + '<span class="box" aria-hidden="true"></span>'
        + '<span class="dir-item-text"><span class="dir-item-label">' + esc(it.label || '') + badge + '</span>'
        + sub + '</span></label>';
}

export function renderDirectivePreview() {
    const pv = $('dir-preview');
    if (!pv) return;
    if (!directiveData) {
        directiveMarkdown = '';
        pv.innerHTML = emptyHtml('description', 'Napíš úlohu a poskladaj smernicu');
        return;
    }
    directiveMarkdown = buildDirectiveMarkdown();
    pv.innerHTML = mdToHtml(directiveMarkdown);
}

// Klientsky rebuild markdownu z vybraných položiek — zrkadlí DirectiveController::buildMarkdown.
export function buildDirectiveMarkdown() {
    const task = (directiveData.task || '').trim();
    const taskLine = task !== '' ? task : 'Nešpecifikovaná úloha';
    const skills = dirSelected('skills');
    const projects = dirSelected('projects');
    const facts = dirSelected('facts');
    const rules = dirSelected('rules');
    const verified = skills.filter((s) => s.verified && s.path);

    const L = [];
    L.push('# Smernica: ' + taskLine, '');
    L.push('## Kontext');
    L.push(dirContextSentence(task, verified, projects), '');

    if (verified.length) {
        L.push('## Použi tieto skilly');
        for (const s of verified) L.push('- ' + s.label + ' — `' + s.path + '`');
        L.push('');
    }
    if (projects.length) {
        L.push('## Súvisiace projekty');
        for (const p of projects) {
            const info = String(p.info || '').trim();
            L.push('- ' + p.label + (info !== '' ? ': ' + info : ''));
        }
        L.push('');
    }
    if (facts.length) {
        L.push('## Kľúčové fakty');
        for (const f of facts) {
            const s = dirOneLine(f.snippet);
            L.push('- ' + f.label + (s !== '' ? ': ' + s : ''));
        }
        L.push('');
    }
    if (rules.length) {
        L.push('## Pravidlá a preferencie');
        for (const r of rules) {
            const s = dirOneLine(r.snippet);
            L.push('- ' + r.label + (s !== '' ? ': ' + s : ''));
        }
        L.push('');
    }

    const where = [];
    for (const s of verified) where.push('- ' + s.label + ' → `' + s.path + '`');
    for (const p of projects) {
        const info = String(p.info || '').trim();
        if (info !== '') where.push('- ' + p.label + ' → ' + info);
    }
    if (where.length) { L.push('## Kde nájdeš'); for (const w of where) L.push(w); L.push(''); }

    return L.join('\n').replace(/\n+$/, '') + '\n';
}

export function dirSelected(key) {
    return (directiveData.suggested[key] || []).filter((it) => directiveSel.has(+it.id));
}

export function dirContextSentence(task, verified, projects) {
    const subject = task !== '' ? '„' + task + '"' : 'túto úlohu';
    const parts = [];
    if (verified.length) parts.push(verified.length + '× skill');
    if (projects.length) parts.push(projects.length + '× projekt');
    const have = parts.length ? ' Zahŕňa ' + parts.join(' a ') + '.' : '';
    return 'Táto smernica hovorí, kde v Hadese nájdeš relevantné znalosti pre '
        + subject + '.' + have + ' Použi uvedené zdroje ako kontext skôr, než začneš.';
}

export function dirOneLine(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 160 ? t.slice(0, 160) + '…' : t;
}

export async function copyDirective() {
    if (!directiveMarkdown) { showToast('Najprv poskladaj smernicu'); return; }
    try { await navigator.clipboard.writeText(directiveMarkdown); showToast('Smernica skopírovaná'); }
    catch (e) { showToast('Kopírovanie zlyhalo'); }
}

export async function saveDirective() {
    if (!directiveMarkdown || !directiveData) { showToast('Najprv poskladaj smernicu'); return; }
    const name = (directiveData.task || '').trim() || 'smernica';
    try {
        const res = await fetch('/api/directive/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, markdown: directiveMarkdown }),
        });
        if (!res.ok) { showToast('Uloženie zlyhalo'); return; }
        const data = await res.json();
        showToast('Uložené: ' + (data.path || ''));
        loadDirectiveSaved();
    } catch (e) { showToast('Uloženie zlyhalo'); }
}

export async function loadDirectiveSaved() {
    const box = $('dir-saved');
    if (!box) return;
    try {
        const d = await (await fetch('/api/directives')).json();
        const items = d.directives || [];
        if (!items.length) { renderEmpty(box, 'folder_open', 'Zatiaľ žiadne uložené smernice', 'Poskladanú smernicu môžeš uložiť a vrátiť sa k nej.'); return; }
        box.innerHTML = items.map((it) =>
            '<button type="button" class="dir-saved-item" data-name="' + esc(it.name) + '">'
            + '<span class="ms" aria-hidden="true">description</span>'
            + '<span class="dsi-text"><span class="dsi-title">' + esc(it.title || it.name) + '</span>'
            + '<span class="dsi-path">' + esc(it.path) + '</span></span></button>'
        ).join('');
        box.querySelectorAll('.dir-saved-item').forEach((b) => {
            b.onclick = () => openSavedDirective(b.dataset.name);
        });
    } catch (e) { renderEmpty(box, 'cloud_off', 'Nepodarilo sa načítať uložené smernice', 'Skús obnoviť stránku.'); }
}

export async function openSavedDirective(name) {
    try {
        const d = await (await fetch('/api/directive/' + encodeURIComponent(name))).json();
        if (!d || !d.markdown) { showToast('Smernica sa nenašla'); return; }
        directiveMarkdown = d.markdown;
        const pv = $('dir-preview');
        if (pv) pv.innerHTML = mdToHtml(d.markdown);
        try { await navigator.clipboard.writeText(d.markdown); showToast('Smernica skopírovaná'); }
        catch (e) { showToast('Smernica otvorená'); }
    } catch (e) { showToast('Nepodarilo sa načítať'); }
}
