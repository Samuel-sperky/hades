import { mdToHtml } from '../md.js';
import { setScreen } from '../screens.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyCardHtml, esc, getJson, plainText, renderEmpty, renderLoading } from '../util.js';

/* ---------- obrazovka Smernica (/api/directive/*) ----------
   Prompt builder: úloha → Hades poskladá KDE ČO NÁJDE (skilly, projekty,
   fakty, pravidlá). Návrh je editovateľný checklist.

   MARKDOWN SKLADÁ SERVER. Táto obrazovka ho len zobrazuje. Do 20. 8. 2026 si ho
   prehliadač skladal sám (zrkadlo `DirectiveController::buildMarkdown`) a texty
   sa reálne rozišli: na troch úlohách 15–23 z ~45 riadkov, lebo PHP kráti na
   `...` a JS krátil na `…`. Človek si teda kopíroval iný prompt, než aký by
   dostala AI. Keď človek položku odškrtne, výber ide na server ako
   `include_ids` — nedopočítava sa tu.

   Uloženie zapíše directives/<slug>.md cez /api/directive/save. */

export let directiveData = null;         // posledný /build výsledok { task, suggested, counts, markdown, selected_ids }
export const directiveSel = new Set();   // node_id zahrnuté v smernici (zaškrtnuté)
export let directiveTemplates = null;    // cache šablón (/api/directive/templates)
export let directiveMarkdown = '';       // markdown zo servera (na copy/save) — nikdy nie skladaný tu
export let directiveBuildSeq = 0;        // ochrana proti pretekaniu odpovedí
export let directivePreviewSeq = 0;      // to isté pre dopočet náhľadu k výberu

export const DIR_SECTIONS = [
    { key: 'skills', title: 'Skilly', icon: 'bolt' },
    // Pasca (certainty=pasca) má vlastnú sekciu: „neopakuj túto chybu" je pre
    // Claude Code najsilnejší poznatok v smernici a medzi skillmi sa strácal.
    { key: 'pitfalls', title: 'Pasce', icon: 'warning' },
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

    /* Obrazovka sa pri každom vstupe prekresľuje od nuly, takže napísaná úloha zmizla
       len tým, že si človek odskočil na Graf a vrátil sa — hoci vedľa stále svietil
       návrh poskladaný PRESNE z tejto úlohy. Vstup preto dopĺňame z posledného
       /build (directiveData.task), keď nepríde prefill. */
    if (taskInput) {
        if (prefillTask != null) taskInput.value = prefillTask;
        else if (directiveData && directiveData.task) taskInput.value = directiveData.task;
    }

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
            const d = await getJson('/api/directive/templates');
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
        // Bez kontroly res.ok skončila serverová chyba (500 s JSON telom) ako „Nič
        // relevantné sa nenašlo" — čo je nepravda, a človek potom preformuloval úlohu,
        // hoci problém bol na serveri.
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (seq !== directiveBuildSeq) return;
        directiveData = {
            task: data.task || task,
            suggested: data.suggested || {},
            counts: data.counts || {},
            // hotový markdown pre PLNÝ výber — presne ten, ktorý dostane AI
            markdown: data.markdown || '',
        };
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
    // Počty hlási server (`counts`), nedopočítavajú sa tu — inak by obrazovka
    // a AI vedeli o návrhu iné číslo, presne ako to robil Denník nad 50 riadkami.
    const counts = directiveData.counts || {};
    const total = counts.total || 0;
    if (!total) { renderEmpty(wrap, 'search_off', 'Nič relevantné sa nenašlo', 'Opíš úlohu inými slovami.'); return; }

    let h = '';
    for (const sec of DIR_SECTIONS) {
        const items = sug[sec.key] || [];
        if (!items.length) continue;
        h += '<div class="dir-group"><div class="dir-group-head">'
            + '<span class="ms" aria-hidden="true">' + sec.icon + '</span>' + esc(sec.title)
            + '<span class="dir-group-n">' + (counts[sec.key] ?? items.length) + '</span></div>'
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
    if ((key === 'skills' || key === 'pitfalls') && it.path) sub = '<code class="dir-path">' + esc(it.path) + '</code>';
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

export async function renderDirectivePreview() {
    const pv = $('dir-preview');
    if (!pv) return;
    const seq = ++directivePreviewSeq;
    if (!directiveData) {
        directiveMarkdown = '';
        // Nad kartou stojí nadpis „Náhľad smernice", takže 28px ikona pod ním hovorí
        // to isté druhýkrát — ostáva jeden tichý riadok (emptyCardHtml).
        pv.innerHTML = emptyCardHtml('Napíš úlohu a poskladaj smernicu');
        return;
    }

    const md = await directiveMarkdownForSelection();
    // Odškrtávanie je rýchlejšie než sieť; staršia odpoveď nesmie prepísať novší výber.
    if (seq !== directivePreviewSeq || md === null) return;
    directiveMarkdown = md;
    const box = $('dir-preview');
    if (box) box.innerHTML = mdToHtml(md);
}

/* Markdown pre AKTUÁLNY výber. Skladá ho server — tu sa len rozhoduje, či
   stačí ten, ktorý už prišiel s /build (plný výber), alebo treba dopočet
   pre podmnožinu. Vráti null, keď sa dopočet nepodaril: starý náhľad je
   pravdivejší než náhľad poskladaný v prehliadači. */
export async function directiveMarkdownForSelection() {
    const all = dirAllIds();
    const sel = all.filter((id) => directiveSel.has(id));

    if (sel.length === all.length) return directiveData.markdown || '';

    try {
        const res = await fetch('/api/directive/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: directiveData.task || '', include_ids: sel }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return data.markdown || '';
    } catch (e) {
        showToast('Náhľad sa nepodarilo prepočítať');
        return null;
    }
}

// Všetky id, ktoré server v návrhu poslal — v poradí sekcií.
export function dirAllIds() {
    const out = [];
    for (const sec of DIR_SECTIONS) {
        for (const it of (directiveData.suggested[sec.key] || [])) out.push(+it.id);
    }
    return out;
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
        const d = await getJson('/api/directives');
        const items = d.directives || [];
        // Sekcia sa menuje „Uložené smernice" — prázdny stav ju nemá prehovoriť znova.
        if (!items.length) { box.innerHTML = emptyCardHtml('Zatiaľ žiadne — poskladanú smernicu môžeš uložiť a vrátiť sa k nej.'); return; }
        box.innerHTML = items.map((it) =>
            '<button type="button" class="dir-saved-item" data-name="' + esc(it.name) + '">'
            + '<span class="ms" aria-hidden="true">description</span>'
            + '<span class="dsi-text"><span class="dsi-title">' + esc(it.title || it.name) + '</span>'
            + '<span class="dsi-path">' + esc(it.path) + '</span></span></button>'
        ).join('');
        box.querySelectorAll('.dir-saved-item').forEach((b) => {
            b.onclick = () => openSavedDirective(b.dataset.name);
        });
    } catch (e) { box.innerHTML = emptyCardHtml('Uložené smernice sa nepodarilo načítať.'); }
}

export async function openSavedDirective(name) {
    try {
        const d = await getJson('/api/directive/' + encodeURIComponent(name));
        if (!d || !d.markdown) { showToast('Smernica sa nenašla'); return; }
        // Uložená smernica prekrýva náhľad, takže rozbehnutý dopočet výberu už
        // nesmie dosadnúť po nej.
        directivePreviewSeq++;
        directiveMarkdown = d.markdown;
        const pv = $('dir-preview');
        if (pv) pv.innerHTML = mdToHtml(d.markdown);
        try { await navigator.clipboard.writeText(d.markdown); showToast('Smernica skopírovaná'); }
        catch (e) { showToast('Smernica otvorená'); }
    } catch (e) { showToast('Nepodarilo sa načítať'); }
}
