import { mdToHtml } from '../md.js';
import { setScreen } from '../screens.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyCardHtml, esc, getJson, plainText, renderEmpty, renderError, renderLoading } from '../util.js';
// Ozbrojené potvrdenie (prvý klik sa spýta, druhý do 3 s maže) je JEDEN vzor pre
// celú appku, tak sa neduplikuje. Býva v rozhodnutiach len dočasne — patrí do
// util.js, ktorý táto vlna nevlastní.
import { armDelete } from './rozhodnutia.js';
import { iconMarkup } from '../../shared/icons.js';

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
export let directiveSaved = [];          // posledný /api/directives (aby prepnutie režimu nešlo po sieť)
export let directiveManaging = false;    // režim „Upraviť zoznam" — až v ňom sa dá mazať

export const DIR_SECTIONS = [
    { key: 'skills', title: 'Skilly', icon: 'bolt' },
    // Pasca (certainty=pasca) má vlastnú sekciu: „neopakuj túto chybu" je pre
    // Claude Code najsilnejší poznatok v smernici a medzi skillmi sa strácal.
    { key: 'pitfalls', title: 'Pasce', icon: 'alert-triangle' },
    { key: 'projects', title: 'Projekty', icon: 'box' },
    { key: 'facts', title: 'Fakty', icon: 'head-gear' },
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
        + '<button type="button" id="dir-copy" class="ghost" title="Kopírovať smernicu" aria-label="Kopírovať smernicu">' + iconMarkup('copy') + '</button>'
        + '<button type="button" id="dir-save" class="ghost" title="Uložiť ako .md" aria-label="Uložiť ako .md">' + iconMarkup('save') + '</button>'
        + '</div></div>'
        + '<div class="dir-preview md-body" id="dir-preview"></div>'
        + '</div></div>'
        /* Prepínač režimu, nie kôš pri každom riadku: mazanie súboru na disku je
           nevratné, tak stojí za dvoma krokmi — zapnúť režim a potom potvrdiť
           ozbrojené tlačidlo. Kým je zoznam prázdny, prepínač nemá čo prepínať
           (triedu `hidden` mu dáva syncDirManageBtn). */
        + '<section class="dir-saved-sec"><h2>Uložené smernice</h2>'
        + '<button type="button" id="dir-manage" class="chip hidden">'
        + iconMarkup('pencil') + 'Upraviť zoznam</button>'
        + '<div class="dir-saved" id="dir-saved"></div></section>';

    const taskInput = $('dir-task');
    const buildBtn = $('dir-build');
    // Popisok počas behu je NEOSOBNÝ (docs/BRAND-HADES.md §1), rovnako ako hlásenie
    // pod ním („Skladá sa kontext…") — dve slovesá pre tú istú prácu, jeden hlas.
    if (buildBtn) buildBtn.onclick = () => busy(buildBtn, () => runDirectiveBuild(taskInput ? taskInput.value : ''), 'Skladá sa…');
    if (taskInput) taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runDirectiveBuild(taskInput.value); }
    });
    const copyBtn = $('dir-copy');
    if (copyBtn) copyBtn.onclick = copyDirective;
    const saveBtn = $('dir-save');
    if (saveBtn) saveBtn.onclick = saveDirective;
    const manageBtn = $('dir-manage');
    if (manageBtn) manageBtn.onclick = () => { directiveManaging = !directiveManaging; syncDirManageBtn(); renderDirectiveSaved(); };

    // Režim mazania neprežíva odchod z obrazovky: vrátiť sa na Smernicu a nájsť
    // pri každej položke ozbrojený kôš je prekvapenie, nie pokračovanie.
    directiveManaging = false;

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
        renderEmpty($('dir-suggest'), 'clipboard', 'Vyber šablónu alebo napíš úlohu');
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
            + iconMarkup('bolt') + '' + esc(t.name) + '</button>'
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
    /* Dýchajúci znak ZOSTÁVA (nie skeleton): koľko sekcií a položiek návrh vydá,
       sa dozvieme až z odpovede, takže tvar sa nedá predkresliť. Text je neosobný. */
    if (suggest) renderLoading(suggest, 'Skladá sa kontext…');
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
        /* Retry si drží ÚLOHU, nie pole: `task` je už normalizovaný reťazec z
           tohto behu, takže „Skúsiť znova" zopakuje presne to zadanie, ktoré
           padlo — aj keď človek medzitým do `#dir-task` napísal niečo iné. */
        if (seq === directiveBuildSeq && suggest) renderError(suggest, 'smernicu', () => runDirectiveBuild(task));
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
    if (!total) { renderEmpty(wrap, 'magnifier-off', 'Nič relevantné sa nenašlo', 'Opíš úlohu inými slovami.'); return; }

    let h = '';
    for (const sec of DIR_SECTIONS) {
        const items = sug[sec.key] || [];
        if (!items.length) continue;
        h += '<div class="dir-group"><div class="dir-group-head">'
            + iconMarkup(sec.icon) + '' + esc(sec.title)
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
        pv.innerHTML = emptyCardHtml('Napíš úlohu a poskladaj smernicu');
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
    catch (e) { showToast('Kopírovanie sa nepodarilo'); }
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
        if (!res.ok) { showToast('Uloženie sa nepodarilo'); return; }
        const data = await res.json();
        showToast('Uložené: ' + (data.path || ''));
        loadDirectiveSaved();
    } catch (e) { showToast('Uloženie sa nepodarilo'); }
}

export async function loadDirectiveSaved() {
    const box = $('dir-saved');
    if (!box) return;
    try {
        const d = await getJson('/api/directives');
        directiveSaved = d.directives || [];
        // Zoznam sa mohol zmazaním vyprázdniť — režim, ktorý nemá čo upravovať,
        // sa musí sám vypnúť, inak ostane svietiť „Hotovo" nad prázdnom.
        if (!directiveSaved.length) directiveManaging = false;
        syncDirManageBtn();
        renderDirectiveSaved();
    } catch (e) {
        /* Chyba sa tu do 27. 8. 2026 kreslila ako PRÁZDNO (tichý riadok karty) —
           nelhala, ale nepriznávala sa: „nič tu nie je" a „nepodarilo sa načítať"
           vyzerali rovnako, hoci sú to dve rôzne správy.

           `loadDirectiveSaved` je bezpečný retry: `#dir-saved` prežije (mení sa len
           jeho `innerHTML`) a funkcia si ho nájde znova. */
        renderError(box, 'uložené smernice', loadDirectiveSaved);
    }
}

/* Prepínač režimu hovorí, v akom stave zoznam JE — preto sa mení aj popisok, aj
   ikona. Skrytý je, kým nie je čo mazať. */
export function syncDirManageBtn() {
    const btn = $('dir-manage');
    if (!btn) return;
    // `.hidden` a nie atribút `hidden`: `.chip` má `display: inline-block`, čo
    // pravidlo prehliadača pre [hidden] prebije — tlačidlo by ostalo svietiť.
    btn.classList.toggle('hidden', !directiveSaved.length);
    btn.classList.toggle('active', directiveManaging);
    btn.innerHTML = iconMarkup((directiveManaging ? 'check' : 'pencil')) + ''
        + (directiveManaging ? 'Hotovo' : 'Upraviť zoznam');
}

export function renderDirectiveSaved() {
    const box = $('dir-saved');
    if (!box) return;
    // Sekcia sa menuje „Uložené smernice" — prázdny stav ju nemá prehovoriť znova.
    if (!directiveSaved.length) {
        box.innerHTML = emptyCardHtml('Zatiaľ žiadne — poskladanú smernicu môžeš uložiť a vrátiť sa k nej.');
        return;
    }

    /* Dve podoby toho istého riadku, a je to zámer. Mimo režimu je riadok jedno
       <button>, ktoré smernicu otvorí. V režime je to <div> s vlastným tlačidlom
       koša — tlačidlo vnútri tlačidla je neplatné HTML a pre klávesnicu slepá
       ulička, takže sa riadok na ten čas prestane klikať celý. */
    box.innerHTML = directiveSaved.map((it) => {
        const inner = iconMarkup('file-text') + ''
            + '<span class="dsi-text"><span class="dsi-title">' + esc(it.title || it.name) + '</span>'
            + '<span class="dsi-path">' + esc(it.path) + '</span></span>';
        if (!directiveManaging) {
            return '<button type="button" class="dir-saved-item" data-name="' + esc(it.name) + '">'
                + inner + '</button>';
        }
        return '<div class="dir-saved-item">' + inner
            + '<button type="button" class="danger dir-del" data-name="' + esc(it.name) + '"'
            + ' title="Zmazať smernicu" aria-label="Zmazať smernicu">'
            + iconMarkup('trash') + '</button>'
            + '</div>';
    }).join('');

    box.querySelectorAll('button.dir-saved-item').forEach((b) => {
        b.onclick = () => openSavedDirective(b.dataset.name);
    });
    box.querySelectorAll('.dir-del').forEach((b) => {
        b.onclick = () => armDelete(b, 'Naozaj zmazať?', () => deleteDirective(b, b.dataset.name));
    });
}

export async function deleteDirective(btn, name) {
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/directive/' + encodeURIComponent(name), { method: 'DELETE' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || 'Nepodarilo sa zmazať'); return; }
            showToast('Smernica zmazaná');
            /* Riadok zmizne hneď, nie až po `/api/directives`. Ten endpoint skladá
               celú `SmernicaScreen` a trvá sekundy — namerané: zmazaná smernica
               ostala na obrazovke ešte 2,5 s po tom, čo súbor už na disku nebol,
               takže obrazovka klamala. Server zmazanie potvrdil, tak sa to smie
               povedať; načítanie za tým je len dorovnanie zvyšku. */
            directiveSaved = directiveSaved.filter((it) => it.name !== name);
            if (!directiveSaved.length) directiveManaging = false;
            syncDirManageBtn();
            renderDirectiveSaved();
            loadDirectiveSaved();
        } catch (e) { showToast('Nepodarilo sa zmazať'); }
    }, 'Maže sa…');
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
