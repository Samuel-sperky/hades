import { mdToHtml } from '../md.js';
import { setScreen } from '../screens.js';
import { showToast } from '../toasts.js';
import { $, busy, deferSkeleton, emptyCardHtml, esc, getJson, inlineOk, loadingHtml, plainText, renderEmpty, renderError, renderFilterEmpty, renderLoading, timeAgo } from '../util.js';
// Ozbrojené potvrdenie (prvý klik sa spýta, druhý do 3 s maže) je JEDEN vzor pre
// celú appku, tak sa neduplikuje. Býva v rozhodnutiach len dočasne — patrí do
// util.js, ktorý táto vlna nevlastní.
import { armDelete } from './rozhodnutia.js';
/* `renderSavedFilters` je RE-EXPORT z `public/js/shared/filters.js` — jedna
   mechanika uložených filtrov pre všetky tri plochy; druhá kópia sa nepíše. */
import { ASC, DESC, moreRow, renderSavedFilters, renderTable, sortRows } from '../table.js';
import { closeRecPanel, onRecPanelClose, openRecPanel, recOpenId, updateRecPanel } from '../recpanel.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
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

   Uloženie zapíše directives/<slug>.md cez /api/directive/save.

   ULOŽENÉ SMERNICE SÚ TABUĽKA ZÁZNAMOV (od 31. 8. 2026), nie mriežka kariet:
   `table.js` + detail v `recpanel.js`, presne ako Runy a Rozhodnutia. Dôvod je
   ten istý ako tam — karta je dobrá na príbeh, ale uložená smernica je záznam
   (názov + súbor) a človek v nej hľadá jeden riadok, nie príbeh. Kartová mriežka
   navyše radila len tak, ako prišla zo servera, a nedala sa zoradiť podľa mena.

   STĹPEC „KEDY" UŽ JE (2. 9. 2026). Do 1. 9. 2026 tu stálo, že byť nemôže:
   `SmernicaScreen::saved()` si `mtime` prečítal, zoradil ním a potom ho z riadka
   `unset`-ol, takže z odpovede bolo poradie, ale nie hodnota — a dopočítať dátum
   v prehliadači sa nedá. Serializér odvtedy posiela `saved_at` (ISO 8601), takže
   stĺpec má z čoho žiť a DEFAULTNÉ RADENIE je odteraz priznané (`saved_at`,
   zostupne) namiesto `sortKey: null`. Je to to isté poradie, aké posiela server,
   ale `aria-sort` ho teraz hlási — tabuľka, ktorá je zoradená a tvári sa, že nie,
   je tichá lož.

   ČO TABUĽKA NEMÁ A PREČO: graf. Uložené smernice sú súbory v priečinku (dnes 1,
   zmerané) a jediný číselný rozmer, ktorý majú, je čas uloženia — „koľko súborov
   za deň" nad jednociferným priečinkom je šum, nie tvar. Kým nie sú desiatky,
   graf tu nie je opomenutie, ale rozhodnutie (ten istý dôvod ako pri Denníku).

   DVE FILTRAČNÉ OSI, presne tie, ktoré dáta majú: text (`q`, nadpis + cesta)
   a obdobie (`smp`, 7 / 30 dní podľa `saved_at`). Oboje filtruje KLIENT —
   `/api/directives` posiela celý priečinok jedným volaním, takže dopyt na server
   by za tú istú odpoveď zaplatil druhýkrát. Preto je aj priznanie počtu po filtri
   pravdivé: celok je známy, nie odhadnutý.

   Detail (celý markdown smernice) žije v PRAVOM PANELI a doťahuje ho
   `/api/directive/{name}` — dovtedy klik na kartu prepísal náhľad VEDĽA
   a zároveň mlčky siahol do schránky. Dve veci naraz na jeden klik: čítanie
   a zápis do schránky. Odteraz klik ČÍTA (panel) a obe akcie sú v paneli
   pomenované. */

export let directiveData = null;         // posledný /build výsledok { task, suggested, counts, markdown, selected_ids }
export const directiveSel = new Set();   // node_id zahrnuté v smernici (zaškrtnuté)
export let directiveTemplates = null;    // cache šablón (/api/directive/templates)
export let directiveMarkdown = '';       // markdown zo servera (na copy/save) — nikdy nie skladaný tu
export let directiveBuildSeq = 0;        // ochrana proti pretekaniu odpovedí
export let directivePreviewSeq = 0;      // to isté pre dopočet náhľadu k výberu
export let directiveSaved = [];          // posledný /api/directives (aby prepnutie režimu nešlo po sieť)
export let directiveManaging = false;    // režim „Upraviť zoznam" — až v ňom sa dá mazať

/* Koľko riadkov tabuľky sa kreslí naraz (G3). `/api/directives` posiela VŠETKY
   uložené smernice jedným volaním (glob nad priečinkom, žiadny limit), takže
   „Ďalších 50" je okno nad úplnými dátami a celkový počet je známy — a keďže
   filtruje klient nad tým istým poľom, je známy AJ PO FILTRI. Priznanie počtu
   preto nelže ani so zapnutým filtrom (v Runoch sa práve preto vynecháva:
   `/api/runs` posiela `counts` nad celou tabuľkou). */
const PAGE = 50;

/* Triedenie tabuľky. Default je `saved_at` zostupne — teda to isté poradie, aké
   posiela server, ale PRIZNANÉ v `aria-sort`. Kľúč sa píše do adresy (`smk`
   kľúč, `smd` smer, presne ako `ruk`/`rud` v Runoch), a default sa nepíše:
   `?s=smernica` znamená „najnovšie zhora". */
const DEF_SORT = { key: 'saved_at', dir: DESC };
export let directiveSort = { key: DEF_SORT.key, dir: DEF_SORT.dir };
export let directiveShown = PAGE;

/* Klávesový kurzor tabuľky (j/k, šípky). `idx` je index do PRÁVE KRESLENEJ
   stránky, nie do `directiveSaved` — filter aj „Ďalších 50" množinu menia
   a index do zdroja by po ich zmene ukazoval na iný riadok, než na ktorý sa
   človek pozerá. Trieda `.selected` nesie kurzor a `aria-current` otvorený
   panel: sú to dva rôzne stavy a `mind.css` ich kreslí zvlášť (0-3-0 vs 0-2-0).

   POZOR: klávesy vešia `shortcuts.js`, ktorý táto vlna NEVLASTNÍ — dnes je teda
   `dirMove()` API bez volajúceho, presne ako bol `smo` kľúč pred doplnením do
   `DICT`. Kód je celý; po pridaní šiestich riadkov do `shortcuts.js` (sú
   v hlásení) začne kurzor chodiť bez zmeny tu. */
export let directiveCursor = -1;

/* Markdown otvorenej smernice, podľa mena. Cache je zámerná: panel sa otvára
   klikom aj z adresy a druhé otvorenie toho istého riadka nemá platiť ďalší
   request. Prázdny reťazec sa NEUKLADÁ — po zlyhaní sa smie skúsiť znova. */
export const directiveDetails = new Map();

/* Adresný kľúč panelu (`smo`) je viazaný NA OBRAZOVKU, tak ako `ruo` pre Runy
   a `roo` pre Rozhodnutia — pri prepnutí obrazovky ho `urlstate.js` zahodí sám
   a dva panely sa v jednej adrese otvoriť nedajú.

   `smo` je v `DICT` od `2b0bb3e` (1. 9. 2026); dovtedy tu stálo, že kľúč chýba
   a adresa sa nezapíše. Zmerané po doplnení: klik na riadok dá
   `?s=smernica&smo=automatizacia-na-seo-agent`. */
const PANEL_URL_KEY = 'smo';

/* Filtre uložených smerníc. `q` je ZDIEĽANÝ kľúč adresy (jediná výnimka
   z dvojznakových prefixov — na obrazovke je najviac jedno voľné hľadanie),
   `smp` je obdobie v dňoch. Filtruje sa nad `directiveSaved`, teda nad tým, čo
   už v prehliadači je. */
export const directiveFilter = { q: '', per: null };

/* Obdobia. Hodnota je počet dní a je to zároveň hodnota v adrese — jeden zápis
   pre stav aj pre odkaz. `null` = všetky (default, do adresy sa nepíše). */
const DIR_PERIODS = [
    { v: null, label: 'Všetky' },
    { v: '7', label: '7 dní' },
    { v: '30', label: '30 dní' },
];

/* Boot z adresy. Číta sa LEN keď je v adrese naša obrazovka: `q` je zdieľané,
   takže bez tejto stráže by hľadanie z Knižnice naplnilo filter Smernice. */
const BOOT_MINE = readUrl().s === 'smernica';
const bootKey = (k) => (BOOT_MINE ? urlValue(k) : null) || null;

directiveFilter.q = bootKey('q') || '';
directiveFilter.per = DIR_PERIODS.some((p) => p.v === bootKey('smp')) ? bootKey('smp') : null;
/* Radenie z adresy. Kľúč sa overuje AJ TU, nie len v `DICT`: slovník je jeden
   zdroj pravdy pre tvar adresy, ale radiaci kľúč mimo stĺpcov by `sortRows`
   nechal bez `sortValue` a tabuľka by sa zoradila podľa neexistujúceho poľa,
   teda vôbec — a `aria-sort` by pritom tvrdil, že je zoradená. */
const DIR_SORTS = ['title', 'path', 'saved_at'];
if (DIR_SORTS.includes(bootKey('smk'))) directiveSort = { key: bootKey('smk'), dir: bootKey('smd') === 'asc' ? ASC : DESC };
else if (bootKey('smd') === 'asc') directiveSort = { key: DEF_SORT.key, dir: ASC };

/* Meno smernice, ktorá má byť otvorená, ale riadky ešte nie sú načítané (boot
   z adresy alebo Späť). Panel otvorí `renderDirectiveSaved()`, keď dáta prídu —
   otvárať detail z mena, ktoré v odpovedi nemusí byť, nemá čo ukázať. */
let dirPendingOpen = BOOT_MINE ? urlValue(PANEL_URL_KEY) : null;

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
        /* Filtračný rad a uložené filtre stoja NAD tabuľkou a MIMO `#dir-saved`:
           to je kontejner, ktorý sa prekresľuje (`innerHTML`) pri každom filtri,
           radení aj „Ďalších 50" — filter vnútri neho by si pri písaní zabíjal
           vlastný `<input>` a fokus by po prvom znaku spadol na `<body>`.
           `#dir-saved-filters` je z toho istého dôvodu vlastný obal: lišta
           uložených filtrov musí zostať dosiahnuteľná aj vtedy, keď filter nič
           nenašiel — práve tam ju človek potrebuje najviac. */
        + '<div class="dtl-filter" id="dir-filter"></div>'
        + '<div id="dir-saved-filters"></div>'
        /* Obal tabuľky je HOLÝ `<div>`: trieda `.dir-saved` je mriežka kariet
           (`grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))`) a
           `<table>` by v nej dostala 300 px stĺpec. Kresba tabuľky je `.rec-table`
           a je spoločná pre všetky tri obrazovky záznamov. */
        + '<div id="dir-saved"></div></section>';

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
        showToast('Náhľad sa nepodarilo prepočítať', null, 'error');
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

/* Kopírovanie plochu NEZMENÍ, takže potvrdenie ide INLINE k tlačidlu (J2).
   Zlyhanie zostáva toastom: nesie dôvod a musí prežiť prekreslenie náhľadu.
   Validácia („najprv poskladaj") je tiež inline — je to odpoveď na klik, ktorý
   sa práve stal, a patrí k tlačidlu, nie do rohu obrazovky. */
export async function copyDirective() {
    const btn = $('dir-copy');
    if (!directiveMarkdown) { inlineOk(btn, 'Najprv poskladaj smernicu', 'error'); return; }
    try { await navigator.clipboard.writeText(directiveMarkdown); inlineOk(btn, 'Skopírované'); }
    catch (e) { showToast('Kopírovanie sa nepodarilo', null, 'error'); }
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
        if (!res.ok) { showToast('Uloženie sa nepodarilo', null, 'error'); return; }
        const data = await res.json();
        showToast('Uložené: ' + (data.path || ''));
        loadDirectiveSaved();
    } catch (e) { showToast('Uloženie sa nepodarilo', null, 'error'); }
}

export async function loadDirectiveSaved() {
    const box = $('dir-saved');
    if (!box) return;
    /* Kostra v tvare obsahu (`table` = rad + hustejšie riadky), nie dýchajúci
       znak: tvar tabuľky sa predkresliť DÁ. Odklad 300 ms nesie `deferSkeleton`
       a ruší sa PRED zápisom obsahu — naplánovaná kresba by inak dosadla nad
       hotovú tabuľku. `/api/directives` skladá celú `SmernicaScreen`, takže to
       nie je čakanie na milisekundy. */
    const cancelSkeleton = deferSkeleton(box, 'table');
    try {
        const d = await getJson('/api/directives');
        cancelSkeleton();
        directiveSaved = d.directives || [];
        // Nové dáta = nové okno; inak by po zmazaní ostalo „prvých 50" z inej množiny.
        directiveShown = PAGE;
        // Zoznam sa mohol zmazaním vyprázdniť — režim, ktorý nemá čo upravovať,
        // sa musí sám vypnúť, inak ostane svietiť „Hotovo" nad prázdnom.
        if (!directiveSaved.length) directiveManaging = false;
        syncDirManageBtn();
        renderDirectiveSaved();
        /* FILTER SA MUSÍ DO ADRESY ZAPÍSAŤ ZNOVA a práve TU, nie v `renderDirective()`.
           `clearScreenKeys()` v `urlstate.js` maže pri prepnutí obrazovky všetky
           `scoped` kľúče — a `q` je zdieľané, teda `scoped`. Zmerané: `?s=smernica&q=gama`
           filter naozaj nasadilo, ale `location.search` zostalo `?s=smernica`, takže
           obnovenie stránky by ten istý odkaz už nenačítalo. Knižnica to robí rovnako
           (`writeUrl` po nasadení filtra).

           Prečo za `await`om: pri bootovaní beží `renderDirective()` VNÚTRI `applyUrl`,
           kde je `writeUrl` no-op — zápis odtiaľ by ticho zmizol (a zmizol: prvá
           verzia ho mala tam a `q` sa do adresy nevrátilo). Tu sme už po sieti, teda
           mimo toho okna; pri Späť/Dopredu je adresa správna už zo vstupu, takže
           idempotentný `replace` nemá čo pokaziť. */
        writeDirFilterUrl();
        writeDirSortUrl();
    } catch (e) {
        cancelSkeleton();
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

/* ---------- filtre uložených smerníc (dve osi) ----------

   JEDNA smernica nie je čo filtrovať, tak sa rad nekreslí — to isté pravidlo
   ako „jedna oblasť nie je filter, len šum" v Knižnici a Rozhodnutiach. Rad je
   `.dtl-filter`, čipy sú `.chip`: rovnaká kresba ako filtre Runov, Rozhodnutí
   a Kontroly, žiadny nový slovník. */
export function renderDirFilter() {
    const wrap = $('dir-filter');
    if (!wrap) return;
    if (directiveSaved.length < 2) { wrap.innerHTML = ''; return; }

    const q = directiveFilter.q || '';
    wrap.innerHTML =
        '<input type="search" id="dir-q" class="dir-find" autocomplete="off"'
        + ' placeholder="Hľadať v uložených…" aria-label="Hľadať v uložených smerniciach"'
        + ' value="' + esc(q) + '">'
        + DIR_PERIODS.map((p) => '<button type="button" class="chip'
            + ((directiveFilter.per || null) === p.v ? ' active' : '') + '"'
            + ' data-dir-per="' + (p.v == null ? '' : p.v) + '"'
            + ' aria-pressed="' + ((directiveFilter.per || null) === p.v ? 'true' : 'false') + '">'
            + esc(p.label) + '</button>').join('');

    const inp = $('dir-q');
    if (inp) {
        /* Písanie prekresľuje LEN tabuľku (`#dir-saved`), nie tento rad — inak by
           si `<input>` pri každom znaku zahodil sám seba a fokus by po prvom
           znaku spadol na `<body>`. Debounce nie je: dáta sú v prehliadači
           a zápis adresy debouncuje `urlstate.js` (DEB_FILTER). */
        inp.oninput = () => {
            directiveFilter.q = inp.value;
            directiveShown = PAGE;
            writeDirFilterUrl();
            renderDirTableOnly();
        };
    }
    wrap.querySelectorAll('[data-dir-per]').forEach((b) => {
        b.onclick = () => {
            const v = b.dataset.dirPer || null;
            /* Klik na aktívne obdobie ho VYPNE (rovnako ako čipy Runov): chip je
               prepínač a „Všetky" je jeho vypnutý stav. */
            directiveFilter.per = (directiveFilter.per || null) === v ? null : v;
            directiveShown = PAGE;
            writeDirFilterUrl();
            // Nasadenie filtra je viditeľná zmena plochy, takže sa NEHLÁSI.
            renderDirectiveSaved();
        };
    });
}

/* Text hľadá v NADPISE aj v CESTE — sú to práve tie dve veci, ktoré sú v tabuľke
   vidieť, a človek si pamätá raz jedno, raz druhé. `toLocaleLowerCase('sk')`,
   nie `toLowerCase()`: hľadanie „Č" musí trafiť „č" aj v slovenskom texte. */
export function dirFiltered() {
    const q = (directiveFilter.q || '').trim().toLocaleLowerCase('sk');
    const per = directiveFilter.per ? parseInt(directiveFilter.per, 10) : 0;
    const from = per ? Date.now() - per * 86400000 : 0;
    return directiveSaved.filter((it) => {
        if (q) {
            const hay = (dirSavedTitle(it) + ' ' + (it.path || '')).toLocaleLowerCase('sk');
            if (!hay.includes(q)) return false;
        }
        if (from) {
            /* Riadok bez `saved_at` (súbor, ktorému sa nedal prečítať `mtime`)
               filtru obdobia NEVYHOVUJE: „neviem kedy" nie je „bolo to nedávno". */
            const t = Date.parse(it.saved_at || '');
            if (!Number.isFinite(t) || t < from) return false;
        }
        return true;
    });
}

export function clearDirFilter() {
    directiveFilter.q = '';
    directiveFilter.per = null;
    directiveShown = PAGE;
    writeDirFilterUrl();
    renderDirectiveSaved();
}

/* Uložený filter (G2) — mechanika je JEDNA pre celú appku
   (`public/js/shared/filters.js`, re-export cez `table.js`). Meno si filter
   nesie SÁM, poskladané z vlastného obsahu („seo · 7 dní"): natívny `prompt()`
   by bol jediné modálne okno v celej appke a meno vymyslené z obsahu je
   presnejšie než meno napísané rukou o týždeň neskôr.

   Do stavu ide `q` a `per`, NIE radenie ani `directiveShown`: filter je to, čo
   z množiny vyberám; podľa čoho som ju zoradil a koľko som si dolistoval, je
   poloha v zozname. */
export function currentDirFilter() {
    const bits = [];
    const q = (directiveFilter.q || '').trim();
    if (q) bits.push(q);
    if (directiveFilter.per) {
        const p = DIR_PERIODS.find((x) => x.v === directiveFilter.per);
        bits.push(p ? p.label : directiveFilter.per + ' dní');
    }
    if (!bits.length) return null;
    return { name: bits.join(' · '), state: { q: q, per: directiveFilter.per } };
}

export function renderDirSavedFilters() {
    const host = $('dir-saved-filters');
    if (!host) return;
    /* Lišta ide s filtračným radom, nie zvlášť: pri jednej smernici sa rad nekreslí,
       takže uložený čip by ponúkal nasadenie filtra, ktorý nemá kde byť vidieť
       (zmerané: `#dir-filter` bol prázdny a čip „čerpanie · 7 dní" nad ním svietil).
       `localStorage` sa NEMAŽE — smernice môžu pribudnúť a filter je pohľad, nie dáta. */
    if (directiveSaved.length < 2) { host.innerHTML = ''; return; }
    renderSavedFilters(host, 'smernica', {
        onApply: (state) => {
            const s = state || {};
            directiveFilter.q = s.q || '';
            directiveFilter.per = s.per || null;
            directiveShown = PAGE;
            writeDirFilterUrl();
            renderDirectiveSaved();
        },
        current: currentDirFilter,
    });
}

/* Adresa: filter aj radenie sú POHĽAD na dáta, takže `replace` a nie `push` —
   Späť sa má vracať na obrazovku, nie prehrávať každý napísaný znak. Default sa
   nepíše (`null`), aby `?s=smernica` znamenalo „všetko, najnovšie zhora". */
function writeDirFilterUrl() {
    writeUrl({
        q: (directiveFilter.q || '').trim() || null,
        smp: directiveFilter.per || null,
    }, 'replace');
}

function writeDirSortUrl() {
    writeUrl({
        smk: directiveSort.key === DEF_SORT.key ? null : directiveSort.key,
        smd: directiveSort.dir === DESC ? null : 'asc',
    }, 'replace');
}

/* Prekreslenie zoznamu. `renderDirectiveSaved()` obnoví AJ filtračný rad,
   `renderDirTableOnly()` len tabuľku pod ním — a to je rozdiel, ktorý drží
   hľadanie: prekreslenie radu pri každom znaku by zahodilo `<input>`, do ktorého
   sa práve píše, a fokus by spadol na `<body>`. */
export function renderDirectiveSaved() {
    renderDirFilter();
    renderDirTableOnly();
}

export function renderDirTableOnly() {
    const box = $('dir-saved');
    if (!box) return;
    renderDirSavedFilters();
    /* Sekcia sa menuje „Uložené smernice" — prázdny stav ju nemá prehovoriť znova.
       `empty` z `renderTable()` sa tu zámerne nepoužíva: veta nesie, ČO s tým
       človek urobí, kým tabuľka vie povedať jednu krátku. */
    if (!directiveSaved.length) {
        box.innerHTML = emptyCardHtml('Zatiaľ žiadne — poskladanú smernicu môžeš uložiť a vrátiť sa k nej.');
        directiveCursor = -1;
        return;
    }

    const cols = dirSavedColumns();
    const rows = dirFiltered();

    /* Prázdno Z FILTRA je iná správa než „zatiaľ žiadne" a má vlastný predmet aj
       jedinú akciu. `.empty--filter` vlastnú kresbu zámerne NEMÁ (manuál §8) — líši
       sa vetou, a tá hovorí o SMERNICI, nie o „záznamoch": obrazovka vie, čo v nej
       človek hľadá. `renderFilterEmpty` sa smie ponúknuť len s filtrom, ktorý naozaj
       skrýva dáta — tu je to zaručené tým, že bez filtra je `rows` celé pole. */
    if (!rows.length) {
        renderFilterEmpty(
            box,
            'Filtru nevyhovuje ani jedna smernica',
            'Skús kratší výraz alebo dlhšie obdobie.',
            clearDirFilter,
            'Zruš filter',
        );
        directiveCursor = -1;
        return;
    }

    const sorted = sortRows(rows, directiveSort.key, directiveSort.dir, cols);
    const page = sorted.slice(0, directiveShown);
    renderTable(box, cols, {
        rows: page,
        sortKey: directiveSort.key,
        sortDir: directiveSort.dir,
        onSort: sortDirSaved,
        onOpen: openDirectivePanel,
        openId: recOpenId('smernica'),
        /* Identita riadka je slug súboru — ten istý klúč, akým sa smernica pýta
           servera (`/api/directive/{name}`) aj adresy. Druhý identifikátor by tu
           bol tretie meno pre jednu vec. */
        idKey: 'name',
        caption: 'Uložené smernice',
    });

    /* Celok je ZNÁMY aj po filtri: `/api/directives` posiela celý priečinok jedným
       volaním (glob bez limitu) a filtruje sa nad tým istým poľom v prehliadači,
       takže `rows.length` je počet vyhovujúcich smerníc, nie počet načítaných riadkov.
       Priznanie počtu tu teda nelže — keď by endpoint raz začal stránkovať, tento
       riadok sa musí prepočítať zo serverového počtu (a pri filtri MLČŤ, ako to
       robia Runy: tam server hlási `counts` nad celou tabuľkou). */
    moreRow(box, Math.min(page.length, rows.length), rows.length, () => {
        directiveShown += PAGE;
        renderDirTableOnly();
    });

    wireDirSavedTable(box);
    paintDirCursor();
    consumeDirPendingOpen();
}

/* Stĺpce sa skladajú funkciou, nie konštantou: kôš existuje len v režime
   „Upraviť zoznam" (ten istý dôvod ako v `decColumns()`).

   Dva dátové stĺpce, nie tri. `name` a `path` sú tá istá vec — `path` je vždy
   `directives/<name>.md`, takže tretí stĺpec by bol ten istý údaj druhýkrát.
   Vidieť má cestu (to je to, čo človek otvorí v editore); meno nesie riadok
   v `data-rec` a adresa. */
export function dirSavedColumns() {
    const cols = [
        {
            key: 'title', label: 'Smernica',
            /* Bez `width`: pri `table-layout: fixed` pripadne tomuto stĺpcu celý
               zvyšok šírky a je to hlavný identifikátor riadka. */
            cell: (it) => esc(dirSavedTitle(it)),
            /* Radí sa podľa TOHO, ČO JE VIDIEŤ (teda aj podľa `name`, keď je
               nadpis prázdny), a nečíselné radenie ide cez `localeCompare('sk')`
               v `sortRows` — bez toho by „Č" skončilo za „Z" presne na
               slovenských názvoch úloh. */
            sortValue: (it) => dirSavedTitle(it),
            // Nadpis je celý prvý riadok .md súboru, takže sa reže takmer vždy.
            titleFrom: (it) => dirSavedTitle(it),
        },
        {
            key: 'path', label: 'Súbor', width: '38%',
            /* `.dsi-path` je mono + tlmená — tá istá kresba, akou cestu k súboru
               kreslila karta pred prechodom na tabuľku. Nová trieda by bola druhé
               meno pre jednu rolu. */
            cell: (it) => '<span class="dsi-path">' + esc(it.path || '') + '</span>',
            sortValue: (it) => it.path || '',
            titleFrom: (it) => it.path || '',
        },
        {
            /* Šírka je v `rem`, nie v percentách: obsah cely nerastie (`timeAgo`
               dáva „5 d" alebo „23. júl"), takže percento by pri `table-layout:
               fixed` bralo hlavnému stúlpcu šírku podľa okna, nie podľa obsahu. */
            key: 'saved_at', label: 'Kedy', width: '6rem',
            cell: (it) => {
                const when = timeAgo(it.saved_at);
                if (!when) return '—';
                return '<span title="' + esc(dirSavedWhenTitle(it)) + '">' + esc(when) + '</span>';
            },
            /* SORTOVACÍ KľÚČ JE KANONICKÉ UTC ISO, nie surový reťazec zo servera.
               `saved_at` nesie OFFSET (`2026-07-23T13:04:22+00:00`), takže jeho
               abecedné poradie nie je chronologické, len sa tak tvári — dnes majú
               všetky riadky `+00:00`, ale súbor uložený v inom offsete by sa zoradil
               o hodinu vedľa. `kind: 'num'` stúlpec NIE JE (dátum nepatrí vpravo do
               mono), takže `sortRows` porovnáva cez `localeCompare` — a to je pre
               čísla správne len náhodou, kým majú rovnaký počet číslic. Pevná šírka
               a `Z` z `toISOString()` robia lexikografické poradie chronologickým.
               (Ten istý vzor ako `libAgeSort()` v Knižnici.) */
            sortValue: (it) => {
                const t = Date.parse(it.saved_at || '');
                return Number.isFinite(t) ? new Date(t).toISOString() : '';
            },
            // Cela hlási relatívny vek; presný dátum sa z neho zistiť nedá.
            titleFrom: (it) => dirSavedWhenTitle(it),
        },
    ];

    if (directiveManaging) {
        /* Otázka je „Zmazať?", nie „Naozaj zmazať?" ako na kartách: cela je
           `overflow: hidden` s výpustkou, takže dlhšia otázka by sa odsekla —
           a odseknuté potvrdenie je horšie než žiadne. Šírka je dorovnaná na
           OZBROJENÝ stav, nie na ikonu (rovnako ako v Rozhodnutiach). */
        cols.push({
            key: '_del', label: 'Zmazať', sortable: false, width: '6rem',
            cell: (it) => '<button type="button" class="danger dir-del" data-name="' + esc(it.name) + '"'
                + ' title="Zmazať smernicu" aria-label="Zmazať smernicu">'
                + iconMarkup('trash') + '</button>',
        });
    }
    return cols;
}

/* Nadpis smernice je prvý riadok .md súboru a môže byť prázdny (súbor bez
   nadpisu), takže sa padá na slug. Prázdna cela v hlavnom stĺpci by bola riadok
   bez identity. */
export function dirSavedTitle(it) {
    return (it && (it.title || '').trim()) || (it && it.name) || '';
}

/* Plný dátum do `title`. Cela hlási relatívny vek („5 d"), ktorý je na prehľad
   lepší, ale nedá sa z neho zistiť, KEDY to bolo — a pri smernici je presný
   dátum práve to, čo človek chce vedieť, keď sa rozhoduje, či je ešte platná.
   Slovo „Uložené" je tu, nie v serializéri: formát dátumu a popisok sú SLOVÁ. */
export function dirSavedWhenTitle(it) {
    const t = Date.parse((it && it.saved_at) || '');
    if (!Number.isFinite(t)) return '';
    return 'Uložené ' + new Date(t).toLocaleString('sk', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

/* ---------- klávesový kurzor (j/k) ----------

   Kresba `.rec-row.selected` je v `mind.css` už dnes (0-3-0, teda silnejšia než
   `:hover`) — nie je to nová kresba, len druhý volajúci tej istej.

   Kurzor sa nemá čo zachovať medzi prekresleniami: `renderTable()` stavia riadky
   nanovo a filter aj radenie menia, KTORÝ riadok je n-tý. Preto sa po prekreslení
   namieri iba to, čo ešte existuje (`paintDirCursor`), a index sa inak drží na -1
   = žiadny kurzor. */
function dirRows() {
    const box = $('dir-saved');
    return box ? box.querySelectorAll('.rec-row[data-rec]') : [];
}

export function paintDirCursor() {
    const rows = dirRows();
    if (directiveCursor >= rows.length) directiveCursor = rows.length ? rows.length - 1 : -1;
    rows.forEach((el, i) => el.classList.toggle('selected', i === directiveCursor));
    return rows;
}

/* Posun kurzora. Prvý stisk nasadí prvý riadok (nie druhý), pretože žiadny
   kurzor nie je pozícia -1, ale „pred zoznamom". Fokus ide S KURZOROM: `<tr>` má
   od `renderTable()` `tabIndex = 0`, takže bez toho by čítač obrazovky ani
   prstenec fokusu nemali čo sledovať a Tab by začínal odznova. */
export function dirMove(delta) {
    const rows = dirRows();
    if (!rows.length) return;
    directiveCursor = directiveCursor < 0
        ? (delta > 0 ? 0 : rows.length - 1)
        : (directiveCursor + delta + rows.length) % rows.length;
    paintDirCursor();
    const cur = rows[directiveCursor];
    if (!cur) return;
    cur.focus({ preventScroll: true });
    cur.scrollIntoView({ block: 'nearest' });
}

/* Riadok pod kurzorom ako dáta, nie ako DOM: `shortcuts.js` chce otvoriť panel,
   nie ťukať do tabuľky. */
export function dirCursorRow() {
    const rows = dirRows();
    const el = rows[directiveCursor];
    if (!el) return null;
    return directiveSaved.find((it) => it.name === el.dataset.rec) || null;
}

/* Klik na tú istú hlavičku obracia smer, klik na inú nasadí vzostupne: oba
   stĺpce sú text a „od A" je to, čo človek pri menách hľadá. Prekresľuje sa LEN
   tabuľka — triedenie nie je dopyt na server (priečinok prišiel naraz). */
export function sortDirSaved(key) {
    if (directiveSort.key === key) {
        directiveSort.dir = directiveSort.dir === ASC ? DESC : ASC;
    } else {
        directiveSort.key = key;
        directiveSort.dir = ASC;
    }
    /* Radenie IDE DO ADRESY (`smk`/`smd`) — je to pohľad na dáta, ktorý sa dá
       zdieľať, a `replace` preto, že sa nemení, NA ČO sa pozerám. */
    writeDirSortUrl();
    renderDirTableOnly();
    /* Prekreslenie zahodilo `<th>` aj s tlačidlom, na ktoré človek práve klikol,
       takže fokus by spadol na `<body>` a Tab by začínal od začiatku dokumentu. */
    const again = document.querySelector('#dir-saved .rec-sort[data-sort="' + key + '"]');
    if (again) again.focus();
}

/* Dokresba po tabuľke. Otvorenie riadka aj triedenie vešia `renderTable()`; sem
   patrí len kôš, ktorý o smerniciach vedieť musí. */
export function wireDirSavedTable(box) {
    box.querySelectorAll('.dir-del').forEach((btn) => {
        btn.onclick = (e) => {
            /* Riadok pod tlačidlom otvára panel (`renderTable` vešia `onclick` na
               `<tr>`), takže bez zastavenia by jediný klik mazal AJ otváral. */
            e.stopPropagation();
            armDelete(btn, 'Zmazať?', () => deleteDirective(btn, btn.dataset.name));
        };
        // To isté klávesnicou: `<tr>` má vlastnú obsluhu Enter/Space.
        btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };
    });
}

/* ---------- detail v pravom paneli (G6) ----------

   Panel nesie CELÝ markdown smernice, teda to, čo sa do riadka nezmestí ani
   náhodou. Doťahuje ho `/api/directive/{name}`, takže telo panelu sa píše
   DVAKRÁT: raz s dýchajúcim znakom, potom s obsahom (`updateRecPanel`). Akcie sa
   preto vešajú po každom zápise — telo je `innerHTML` a druhý zápis zahodí staré
   prvky aj s ich `onclick`om. */
export function openDirectivePanel(it) {
    if (!it) return;
    /* Druhý klik na otvorený riadok zatvára. Panel má vlastný krížik aj Esc,
       takže to nie je jediná cesta von — ale riadok nesie `aria-current="true"`,
       takže je to cesta, ktorú človek na tom mieste hľadá. */
    if (recOpenId('smernica') === it.name) {
        closeRecPanel();
        markDirRow(null);
        return;
    }

    const md = directiveDetails.get(it.name);
    openRecPanel({
        ns: 'smernica',
        id: it.name,
        urlKey: PANEL_URL_KEY,
        title: dirSavedTitle(it),
        html: dirPanelHtml(it, md),
    });
    wireDirPanel(it.name);
    markDirRow(it.name);
    watchDirPanelClose();
    if (md == null) loadDirectiveDetail(it.name);
}

export function dirPanelHtml(it, md) {
    /* Cesta A ČAS uloženia. Panel nesie celý záznam — to je podmienka, pod ktorou
       sa `col-saved_at` na mobile smie skryť („Nič sa nestráca", `mind.css`
       ≤768 px). Dátum je tu PLNÝ, nie relatívny: v tabuľke je „5 d" lepší na
       prehľad, v detaile chce človek vedieť, KEDY to bolo. */
    const when = dirSavedWhenTitle(it);
    const head = '<p><span class="tag muted">' + esc(it.path || '') + '</span>'
        + (when ? '<span class="tag muted">' + esc(when) + '</span>' : '') + '</p>';

    /* Načítavanie NIE JE prázdny stav. Dýchajúci znak, nie kostra: smernica má od
       piatich riadkov po sto, takže jej tvar sa predkresliť nedá. */
    if (md == null) return head + loadingHtml('Načítava sa smernica…');

    /* Tá istá sadzba ako náhľad vedľa (`.dir-preview.md-body`) — je to náhľad tej
       istej veci v užšom stĺpci. Bez `.md-body` by nadpisy markdownu ostali bez
       kresby: celý slovník `md.js` je scopovaný pod ňu.

       `.dir-panel-md` je HÁK PRE CSS, dnes bez jedinej deklarácie, a je tu preto,
       že prevzatá kresba nesie `max-height: 60vh; overflow-y: auto`. Zmerané
       v paneli 1440×900 na reálnej smernici: vnútorný box skroluje (540 z 4725 px),
       kým panel sám nie (`scrollHeight === clientHeight === 814`) — teda skrolovacia
       plocha vnútri skrolovacej plochy a 274 px výšky panelu nikto nevyužije.
       Oprava je jedno pravidlo v `mind.css` (viď hlásenie k CSS); trieda je
       pripravená, aby sa netrafil aj náhľad vľavo. */
    return head
        + '<div class="dir-preview dir-panel-md md-body">' + mdToHtml(md) + '</div>'
        + '<div class="run-actions">'
        + '<button type="button" class="ghost" data-dir-copy="1">Kopírovať</button>'
        + '<button type="button" class="ghost" data-dir-preview="1">Otvoriť v náhľade</button>'
        + '</div>';
}

/* Dve akcie, obe pomenované. Do 31. 8. 2026 ich robil JEDEN klik na kartu:
   prepísal náhľad a mlčky siahol do schránky. Kopírovanie plochu nemení, takže
   sa hlási INLINE pri tlačidle (J2); „Otvoriť v náhľade" plochu mení viditeľne,
   takže sa nehlási vôbec. */
export function wireDirPanel(name) {
    const box = $('rec-panel-body');
    if (!box) return;
    const copy = box.querySelector('[data-dir-copy]');
    if (copy) {
        copy.onclick = async () => {
            const md = directiveDetails.get(name);
            if (!md) { inlineOk(copy, 'Smernica sa nenačítala', 'error'); return; }
            try { await navigator.clipboard.writeText(md); inlineOk(copy, 'Skopírované'); }
            catch (e) { showToast('Kopírovanie sa nepodarilo', null, 'error'); }
        };
    }
    const pv = box.querySelector('[data-dir-preview]');
    if (pv) pv.onclick = () => openSavedDirective(name);
}

/* Dotiahnutie detailu je oddelené od `openDirectivePanel()`, pretože panel má
   DVA spúšťače: klik na riadok a `smo` z adresy. Zlyhanie je toast s variantom
   `error` — panel by inak zostal navždy pri dýchajúcom znaku. Prázdny markdown
   sa do cache NEUKLADÁ, takže ďalšie otvorenie to skúsi znova. */
export async function loadDirectiveDetail(name) {
    let md = '';
    try {
        const d = await getJson('/api/directive/' + encodeURIComponent(name));
        md = d && d.markdown ? d.markdown : '';
    } catch (e) {
        md = '';
    }
    if (md) directiveDetails.set(name, md);
    // Kým dopočet bežal, človek mohol panel zavrieť alebo otvoriť inú smernicu.
    if (recOpenId('smernica') !== name) return;
    if (!md) { showToast('Smernicu sa nepodarilo načítať', null, 'error'); return; }
    const row = directiveSaved.find((it) => it.name === name);
    if (!row) return;
    updateRecPanel(dirPanelHtml(row, md));
    wireDirPanel(name);
}

/* Zvýraznenie otvoreného riadka sa mení NA MIESTE, nie prekreslením tabuľky:
   `renderTable()` prepíše `innerHTML`, takže by kliknutý riadok zmizol z DOM —
   a `recpanel.js` si pri otvorení odložil `document.activeElement`, aby po
   zavretí vrátil fokus. Odpojený `<tr>` má `isConnected === false`, takže by sa
   fokus po Esc nevrátil nikam. */
export function markDirRow(name) {
    const box = $('dir-saved');
    if (!box) return;
    box.querySelectorAll('.rec-row[data-rec]').forEach((tr) => {
        const on = name != null && tr.dataset.rec === String(name);
        tr.classList.toggle('open', on);
        if (on) tr.setAttribute('aria-current', 'true');
        else tr.removeAttribute('aria-current');
    });
}

/* Panel sa zatvára TROMI cestami (krížik, Esc, `dropRecPanel()` pri prepnutí
   obrazovky) a o dvoch z nich táto obrazovka nevie nič. Preto sa počúva
   OHLÁSENIE zavretia, nie jeho dôsledok: `MutationObserver` nad triedou panelu
   by fungoval, ale sledoval by, či je panel VIDIEŤ, a štvrtú cestu k zavretiu by
   nezachytil. Registruje sa raz — `Map` podľa menného priestoru, takže druhá
   registrácia by prvú len prepísala. */
let dirCloseWatch = false;
function watchDirPanelClose() {
    if (dirCloseWatch) return;
    dirCloseWatch = true;
    onRecPanelClose('smernica', () => {
        // Prepnutie obrazovky panel tiež zatvára; vtedy tabuľka na obrazovke nie
        // je a jej prekreslenie by bolo práca do prázdna.
        if (document.body.dataset.screen !== 'smernica') return;
        markDirRow(null);
    });
}

/* Prianie z adresy sa spotrebuje AJ keď riadok neexistuje: druhý pokus by ho
   hľadal v tých istých dátach a `smo` by v adrese strašilo naveky. */
function consumeDirPendingOpen() {
    if (dirPendingOpen == null) return;
    const want = dirPendingOpen;
    dirPendingOpen = null;
    const it = directiveSaved.find((row) => row.name === want);
    if (it) { openDirectivePanel(it); return; }
    writeUrl({ [PANEL_URL_KEY]: null }, 'replace');
}

/* Späť / Dopredu: adresa je vstup. Beží počas `applying`, kedy je `writeUrl`
   no-op — otvorenie panelu si tým adresu neprepíše samo pod sebou. */
registerUrlApply('smernica', (url) => {
    if (url.s !== 'smernica') return;

    /* Filter a radenie z adresy. Prekresluje sa LEN keď sa niečo naozaj zmenilo:
       `applyUrl` beží pri každom `popstate`, teda aj keď sa menil iba `smo`, a
       prekreslenie tabuľky by vtedy zahodilo `<tr>`, ktorý si `recpanel.js`
       odložil ako `document.activeElement`. */
    const nq = url.q || '';
    const nper = DIR_PERIODS.some((pp) => pp.v === (url.smp || null)) ? (url.smp || null) : null;
    const nkey = DIR_SORTS.includes(url.smk) ? url.smk : DEF_SORT.key;
    const ndir = url.smd === 'asc' ? ASC : DESC;
    if (nq !== directiveFilter.q || nper !== directiveFilter.per
        || nkey !== directiveSort.key || ndir !== directiveSort.dir) {
        directiveFilter.q = nq;
        directiveFilter.per = nper;
        directiveSort = { key: nkey, dir: ndir };
        directiveShown = PAGE;
        renderDirectiveSaved();
    }

    const want = url[PANEL_URL_KEY] || null;
    const open = recOpenId('smernica');
    if (!want) {
        dirPendingOpen = null;
        if (open != null) { closeRecPanel(); markDirRow(null); }
        return;
    }
    if (open != null && String(open) === String(want)) return;
    const it = directiveSaved.find((row) => row.name === want);
    if (it) { openDirectivePanel(it); return; }
    dirPendingOpen = want;
});

export async function deleteDirective(btn, name) {
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/directive/' + encodeURIComponent(name), { method: 'DELETE' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || 'Nepodarilo sa zmazať', null, 'error'); return; }
            showToast('Smernica zmazaná');
            /* Riadok zmizne hneď, nie až po `/api/directives`. Ten endpoint skladá
               celú `SmernicaScreen` a trvá sekundy — namerané: zmazaná smernica
               ostala na obrazovke ešte 2,5 s po tom, čo súbor už na disku nebol,
               takže obrazovka klamala. Server zmazanie potvrdil, tak sa to smie
               povedať; načítanie za tým je len dorovnanie zvyšku. */
            /* Zmazaná smernica nesmie zostať otvorená v paneli: detail by
               ukazoval súbor, ktorý na disku už nie je, a `smo` v adrese by ho po
               obnovení stránky hľadal. Cache detailu ide s ňou — inak by ten istý
               slug po opätovnom uložení ukázal starý obsah. */
            if (recOpenId('smernica') === name) closeRecPanel();
            directiveDetails.delete(name);
            directiveSaved = directiveSaved.filter((it) => it.name !== name);
            if (!directiveSaved.length) directiveManaging = false;
            syncDirManageBtn();
            renderDirectiveSaved();
            loadDirectiveSaved();
        } catch (e) { showToast('Nepodarilo sa zmazať', null, 'error'); }
    }, 'Maže sa…');
}

/* Uložená smernica do NÁHĽADU (ľavý stĺpec obrazovky). Volá to jediné miesto —
   tlačidlo „Otvoriť v náhľade" v paneli detailu.

   DO SCHRÁNKY TU UŽ NESIAHA. Do 31. 8. 2026 robil klik na kartu obe veci naraz
   a o tej druhej nebolo ako vedieť; kopírovanie je odteraz samostatná akcia
   v paneli, ktorá sa priznáva inline. Markdown sa berie z cache panelu, keď ju
   má — je to ten istý súbor a druhý request by len zaplatil to isté. */
export async function openSavedDirective(name) {
    try {
        let md = directiveDetails.get(name);
        if (!md) {
            const d = await getJson('/api/directive/' + encodeURIComponent(name));
            md = d && d.markdown ? d.markdown : '';
            if (md) directiveDetails.set(name, md);
        }
        if (!md) { showToast('Smernica sa nenašla', null, 'error'); return; }
        // Uložená smernica prekrýva náhľad, takže rozbehnutý dopočet výberu už
        // nesmie dosadnúť po nej.
        directivePreviewSeq++;
        directiveMarkdown = md;
        const pv = $('dir-preview');
        // Plocha sa MENÍ viditeľne (náhľad sa prepíše), takže sa nehlási nič.
        if (pv) pv.innerHTML = mdToHtml(md);
    } catch (e) { showToast('Nepodarilo sa načítať', null, 'error'); }
}
