/* ===========================================================================
   Konzola vedomia — karty nástrojov a potvrdzovanie zápisov.

   Karta je zložená z hlavičky (ikona, meno, argumenty na jednom riadku, stav) a
   tela s výsledkom. Telo je zložené na pár riadkov: výsledok grepu má bežne
   stovky riadkov a plný výpis by pohltil celý tok. Rozbalenie je vždy jeden
   klik — skryté nesmie znamenať nedostupné.

   Rozhodnutie o povolení sa NEPOSIELA odtiaľto. Karta vypustí udalosť
   `console:decide` a run.js ju odchytí; keby si tools.js volalo run.js a run.js
   tools.js, mali by cyklus, ktorý by pri prvom `import` spadol na neinicializovaný
   modul. Udalosť je zároveň to isté rozhranie, aké už používa composer.
   =========================================================================== */

import { el, clip, num } from './dom.js';
import { escapeHtml } from './markdown.js';
import { pushBlock, scrollIfFollowing } from './render.js';

/* Koľko riadkov výsledku sa vidí bez rozbalenia. Šesť je jeden „odsek" — dosť
   na to, aby bolo vidno, či nástroj našiel to, čo mal. */
const PEEK_LINES = 6;

/* Ikony sú SUBSET Material Symbols. Každá tu menovaná je overená skriptom
   scratchpad/iconcheck.js — chýbajúca ligatúra sa vykreslí ako svoje meno
   („terminal"), čo je presne tá porucha, ktorú subset riešil. Keď pridáš nástroj
   s novou ikonou, over ju, inak radšej nechaj `bolt`. */
const ICONS = {
    grep: 'search',
    search: 'search',
    ripgrep: 'search',
    glob: 'search',
    read: 'description',
    read_file: 'description',
    cat: 'description',
    list: 'list',
    list_files: 'list',
    ls: 'list',
    tree: 'list',
    edit: 'edit',
    edit_file: 'edit',
    write: 'edit',
    write_file: 'edit',
    apply_patch: 'edit',
    mind_recall: 'memory',
    mind_read: 'memory',
    recall: 'memory',
    graph: 'hub',
    mind_learn: 'psychology',
    learn: 'psychology',
    remember: 'psychology',
    mind_decision: 'psychology',
    bash: 'code',
    shell: 'code',
    php: 'code',
    artisan: 'code',
    delete: 'delete',
    mind_delete: 'delete',
};

export function iconFor(name) {
    return ICONS[String(name || '').toLowerCase()] || 'bolt';
}

/** Argumenty na JEDEN riadok — to, čo o volaní naozaj rozhoduje, ide prvé. */
export function argsSummary(args) {
    if (!args || typeof args !== 'object') return '';

    const first = ['pattern', 'query', 'q', 'topic', 'label', 'path', 'file', 'id', 'node', 'command', 'area', 'glob'];
    const parts = [];

    first.forEach((key) => {
        const value = args[key];
        if (value !== undefined && value !== null && value !== '') parts.push(scalar(value));
    });

    if (parts.length === 0) {
        Object.entries(args).slice(0, 3).forEach(([key, value]) => parts.push(`${key}=${scalar(value)}`));
    }

    return clip(parts.join(' · '), 130);
}

function scalar(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return clip(JSON.stringify(value), 60);

    return String(value);
}

/* ---------- karta volania ---------- */

/**
 * Karta pre rámec `tool` — teda beh, ktorý PRÁVE začal. Vracia element, ktorý si
 * volajúci vloží do toku; výsledok doplní `markResult` podľa `data-id`.
 */
export function toolCard(frame) {
    const card = el('div', 'tool-call running');
    card.dataset.id = frame.id;
    if (frame.call_id) card.dataset.callId = frame.call_id;
    if (frame.write) card.classList.add('write');

    const head = el('button', 'tc-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');

    const mark = el('span', 'ms', iconFor(frame.name));
    mark.setAttribute('aria-hidden', 'true');

    head.append(el('span', 'tc-caret'));
    head.append(mark);
    head.append(el('span', 'tc-name', frame.name || 'nástroj'));
    head.append(el('span', 'tc-args', argsSummary(frame.arguments)));
    head.append(el('span', 'tc-state', 'beží…'));

    const body = el('div', 'tc-body hidden');

    head.addEventListener('click', () => toggleBody(card));

    card.append(head, body);

    return card;
}

/** Doplní výsledok do už nakreslenej karty (rámec `tool_result`). */
export function markResult(frame, root = document) {
    const call = {
        status: frame.status,
        result: frame.result,
        error: frame.error,
        duration_ms: frame.duration_ms,
    };

    const card = root.querySelector(`.tool-call[data-id="${frame.id}"]`);

    if (card) {
        fillResult(card, call);

        return card;
    }

    // Povolený (aj zamietnutý) zápis prichádza pod tým istým id, aké nesie karta
    // potvrdenia — rámec `tool` pre neho NIKDY nepríde, lebo namiesto neho prišlo
    // `permission`. Bez tejto vetvy sa výsledok jediného kroku, na ktorý človek
    // naozaj klikol, ticho zahodí.
    const perm = root.querySelector(`.perm-card[data-id="${frame.id}"]`);

    if (perm) {
        const made = toolCard({
            id: frame.id,
            name: perm.dataset.name,
            arguments: perm.hadesArgs,
            write: true,
        });

        perm.after(made);
        fillResult(made, call);

        return made;
    }

    // Ani karta, ani potvrdenie: rámec `tool` k tomuto id nikdy neprišiel (napr.
    // pri auto-povolení, kde backend nemusí mať dôvod ho poslať). Výsledok sa
    // vykreslí aj tak — bez mena nástroja je horší než s ním, ale ticho zahodený
    // je najhorší.
    const orphan = toolCard({ id: frame.id, name: frame.name || 'nástroj', arguments: frame.arguments });
    pushBlock(orphan);
    fillResult(orphan, call);

    return orphan;
}

/** Karta z histórie vlákna — rovnaký tvar, len stav je už známy. */
export function historyCard(call) {
    const card = toolCard({
        id: call.id,
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
        write: call.status === 'pending' || isWriteName(call.name),
    });

    if (call.status === 'pending') {
        card.classList.remove('running');
        card.classList.add('waiting');
        card.querySelector('.tc-state').textContent = 'čaká na rozhodnutie';

        return card;
    }

    // `running` v histórii znamená, že beh niekto zrezal uprostred (Stop, spadnutý
    // server). Nikto ho už nedokončí, takže sa nesmie tváriť ako bežiaci —
    // pulzujúci „beží…" nad mŕtvym volaním je lož.
    if (call.status === 'running') {
        card.classList.remove('running');
        card.classList.add('denied');
        card.querySelector('.tc-state').textContent = 'beh prerušený';

        return card;
    }

    fillResult(card, call);

    return card;
}

function isWriteName(name) {
    return /(^|_)(write|edit|apply|delete|learn|remember|decision|move|rename)/i.test(String(name || ''));
}

/* Stav volania má DVA slovníky: drôtový protokol posiela `status: "done"` /
   `"error"`, ale enum v `console_tool_calls` pozná `failed` (a `running`).
   Karta musí čítať oba, inak by zlyhaný nástroj z histórie vyzeral ako úspešný. */
function normalizeStatus(status) {
    return status === 'failed' ? 'error' : (status || 'done');
}

function fillResult(card, call) {
    const status = normalizeStatus(call.status);
    const state = card.querySelector('.tc-state');
    const body = card.querySelector('.tc-body');
    const head = card.querySelector('.tc-head');

    card.classList.remove('running', 'waiting');
    card.classList.add(status);
    if (status === 'error') card.classList.remove('done');

    const text = status === 'error' ? (call.error || call.result || 'Nástroj zlyhal.') : (call.result ?? '');
    const lines = String(text).split(/\r?\n/);
    const label = [];

    if (status === 'denied') label.push('zamietnuté');
    else if (status === 'error') label.push('chyba');
    else if (String(text).trim() === '') label.push('bez výstupu');
    else label.push(`${num(lines.length, 0)} ${plural(lines.length)}`);

    if (call.duration_ms) label.push(duration(call.duration_ms));
    state.textContent = label.join(' · ');

    body.innerHTML = '';

    if (String(text).trim() === '') {
        body.classList.add('hidden');
        head.setAttribute('aria-expanded', 'false');

        return;
    }

    const pre = el('pre', 'tc-result');

    if (looksLikeDiff(text)) {
        pre.classList.add('diff');
        pre.innerHTML = diffHtml(text);
    } else {
        pre.textContent = text;
    }

    // Zbaliť sa musí podľa toho, čo výsledok zaberie NA OBRAZOVKE, nie podľa
    // počtu riadkov v texte. `mind_recall` vracia celú odpoveď ako JEDEN dlhý
    // riadok JSON: logicky sú to dva riadky, teda pod prahom — ale `pre-wrap` +
    // `overflow-wrap: anywhere` ho zalomí na tri desiatky riadkov a nezbalený
    // vyplní celý viewport, takže odpoveď modelu vytlačí mimo obraz. A `-webkit-
    // line-clamp` zalomené riadky počíta, takže rezal správne — len sa naň
    // vôbec nedostalo. Prah v znakoch je odhad na šesť riadkov monospace.
    const long = lines.length > PEEK_LINES || String(text).length > PEEK_LINES * 90;

    if (long) pre.classList.add('clamped');
    body.append(pre);

    if (long) {
        const more = el('button', 'tc-more', 'rozbaliť');
        more.type = 'button';
        more.addEventListener('click', () => {
            const clamped = pre.classList.toggle('clamped');
            more.textContent = clamped ? 'rozbaliť' : 'zbaliť';
            scrollIfFollowing();
        });
        body.append(more);
    }

    // Výsledok sa ukáže zbalený na pár riadkov, nie skrytý za klikom: nástroj,
    // ktorý našiel niečo iné, než mal, sa musí dať zahliadnuť bez rozbaľovania.
    // Chyba sa navyše nesmie stratiť.
    body.classList.remove('hidden');
    head.setAttribute('aria-expanded', 'true');
    scrollIfFollowing();
}

/* Zápis do súboru trvá 42 ms a „0 s" o ňom nehovorí nič. Sekundy majú zmysel od
   chvíle, keď je čakanie viditeľné. */
function duration(ms) {
    return ms < 950 ? `${num(ms, 0)} ms` : `${num(ms / 1000)} s`;
}

function plural(count) {
    if (count === 1) return 'riadok';

    return count >= 2 && count <= 4 ? 'riadky' : 'riadkov';
}

function toggleBody(card) {
    const body = card.querySelector('.tc-body');
    const head = card.querySelector('.tc-head');

    if (!body.children.length) return;

    const hidden = body.classList.toggle('hidden');
    head.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    scrollIfFollowing();
}

/* ---------- diff ---------- */

export function looksLikeDiff(text) {
    const lines = String(text ?? '').split(/\r?\n/);

    return lines.some((line) => /^@@ /.test(line))
        || lines.some((line) => /^[+-]/.test(line) && !/^([+-]){3}/.test(line));
}

/** Zafarbené +/- riadky. Farby idú z tokenov certifikácie, žiadny raw hex. */
export function diffHtml(text) {
    return String(text ?? '').split(/\r?\n/).map((line) => {
        const cls = /^(\+\+\+|---|diff |index )/.test(line) ? 'df-meta'
            : /^@@/.test(line) ? 'df-hunk'
                : line.startsWith('+') ? 'df-add'
                    : line.startsWith('-') ? 'df-del' : 'df-ctx';

        return `<span class="dl ${cls}">${escapeHtml(line) || ' '}</span>`;
    }).join('');
}

/* ---------- potvrdenie zápisu ---------- */

/**
 * Srdce konzoly: zápis sa nestane, kým človek neklikne. Karta si berie fokus, aby
 * Enter/Esc fungovali bez toho, aby na ňu musel najprv mieriť myšou — pri modeli
 * na 9 tok/s je čakanie na povolenie najčastejší okamih celej práce.
 */
export function permissionCard(frame) {
    const card = el('div', 'perm-card');
    card.dataset.id = frame.id;
    card.dataset.name = frame.name || '';
    // Argumenty žijú ako vlastnosť elementu a nie v `data-` atribúte: výsledok
    // zápisu si z nich neskôr poskladá kartu, ale v DOM by to bol celý JSON
    // navyše pri každom potvrdení.
    card.hadesArgs = frame.arguments;
    card.tabIndex = -1;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `Povolenie pre nástroj ${frame.name}`);

    const head = el('div', 'pc-head');
    const mark = el('span', 'ms', iconFor(frame.name));
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark);
    head.append(el('strong', 'pc-name', frame.name || 'nástroj'));
    head.append(el('span', 'pc-args', argsSummary(frame.arguments)));
    card.append(head);

    card.append(el('p', 'pc-ask', 'Toto je zápis. Pustím ho?'));

    const preview = String(frame.preview ?? '');

    if (preview.trim() !== '') {
        const box = el('pre', 'pc-preview');

        if (looksLikeDiff(preview)) {
            box.classList.add('diff');
            box.innerHTML = diffHtml(preview);
        } else {
            box.textContent = preview;
        }

        card.append(box);
    } else if (frame.arguments) {
        const box = el('pre', 'pc-preview');
        box.textContent = JSON.stringify(frame.arguments, null, 2);
        card.append(box);
    }

    const actions = el('div', 'pc-actions');

    [
        ['allow', 'Povoliť', 'Enter', 'btn-primary'],
        ['allow_always', 'Povoliť vždy', '', 'btn-ghost'],
        ['deny', 'Zamietnuť', 'Esc', 'btn-danger'],
    ].forEach(([decision, label, key, cls]) => {
        const btn = el('button', `pc-btn ${cls}`);
        btn.type = 'button';
        btn.dataset.dec = decision;
        btn.append(el('span', null, label));
        if (key) btn.append(el('kbd', null, key));
        btn.addEventListener('click', () => decide(card, decision));
        actions.append(btn);
    });

    card.append(actions);

    card.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            // Zamietnutie je koncový stav, nie chyba — a Esc nesmie prebublať na
            // globálny handler, ktorý by ním zastavil celý beh.
            event.preventDefault();
            event.stopPropagation();
            decide(card, 'deny');

            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            // Keď je fokus na tlačidle, klik si vyvolá prehliadač sám — druhé
            // rozhodnutie by odoslalo dvakrát.
            if (event.target.closest('button')) return;

            event.preventDefault();
            event.stopPropagation();
            decide(card, 'allow');
        }
    });

    // Fokus po vložení do DOM; `requestAnimationFrame` preto, že element ešte
    // nemusí byť pripojený, keď kartu skladá renderThread.
    requestAnimationFrame(() => {
        if (card.isConnected && !card.classList.contains('decided')) card.focus();
    });

    return card;
}

const DECISION_LABEL = {
    allow: 'Povolené',
    allow_always: 'Povolené — a odteraz bez pýtania',
    deny: 'Zamietnuté',
};

function decide(card, decision) {
    if (card.classList.contains('decided')) return;

    card.classList.add('decided');
    card.classList.add(decision === 'deny' ? 'denied' : 'allowed');
    card.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });

    const done = el('p', 'pc-done', DECISION_LABEL[decision] || decision);
    card.querySelector('.pc-actions').replaceWith(done);

    document.dispatchEvent(new CustomEvent('console:decide', {
        detail: { id: Number(card.dataset.id), decision },
    }));
}

/** Karta, ktorá ešte čaká — používa ju globálny Esc aj kontrola pred odoslaním. */
export function pendingCard(root = document) {
    return root.querySelector('.perm-card:not(.decided)');
}

/** Rozhodne za čakajúcu kartu (globálny Esc mimo karty). */
export function decidePending(decision) {
    const card = pendingCard();
    if (!card) return false;

    decide(card, decision);

    return true;
}

/* ---------- bash a write_report ----------

   Dva nástroje, ktorým jeden riadok argumentov nestačí: pri `bash` nesie význam
   PRÍKAZ a jeho exit kód, pri `write_report` cesta k hotovému reportu.

   Kreslí sa to zvonku, tromi obálkami, a nie prepisom `toolCard()` / `fillResult()`
   / `permissionCard()` zámerne: ten istý súbor mení paralelne druhá vetva a každý
   hunk v ňom sa platí pri merge. Volajúci si obálku nasadí na návratovú hodnotu,
   takže je to jeden riadok na jedno miesto:

     pushBlock(toolExtras(toolCard(frame), frame));
     resultExtras(markResult(frame), frame);
     pushBlock(permissionExtras(permissionCard(frame), frame));
     pushBlock(toolExtras(historyCard(call), call));

   Každá obálka je idempotentná (`data-extras`, `data-extras-result`) a pri cudzom
   nástroji vráti kartu nedotknutú — poradie ani počet nasadení nič nezdvojí. */

const BASH_NAMES = new Set(['bash', 'shell']);
const REPORT_NAMES = new Set(['write_report']);

/* Ikona pre nástroj, ktorý v `ICONS` nie je. Doplniť ju TU a nie do mapy je
   rozhodnutie o merge: mapa je hunk, o ktorý sa bijú dve vetvy. `assignment`,
   `preview` aj `save` sú v subsete overené (`terminal`, `download` ani
   `open_in_new` v ňom NIE SÚ a vykreslili by sa ako svoje meno). */
const EXTRA_ICONS = { write_report: 'assignment' };

/** Doplní kartu volania: príkazový riadok pri `bash`, titulok pri `write_report`. */
export function toolExtras(card, frame) {
    if (!card || card.dataset.extras === 'done') return card;

    const name = toolName(card, frame);

    if (!BASH_NAMES.has(name) && !REPORT_NAMES.has(name)) return card;

    card.dataset.extras = 'done';

    const args = toolArgs(card, frame);
    const mark = card.querySelector('.tc-head .ms');

    if (EXTRA_ICONS[name] && mark && mark.textContent === 'bolt') mark.textContent = EXTRA_ICONS[name];

    const head = card.querySelector('.tc-head');
    const detail = BASH_NAMES.has(name) ? commandBlock(args) : reportBlock(args);

    // Blok ide MEDZI hlavičku a telo, nie do tela: `fillResult()` telo pred
    // vykreslením výsledku vymaže (`innerHTML = ''`), takže vnútri by ho zhltol
    // prvý výsledok. A príkaz má byť vidieť aj na zbalenej karte — je to identita
    // volania, nie detail výsledku.
    if (detail && head) head.after(detail);

    // Karta z histórie prichádza už s výsledkom, takže obálka na `markResult()`
    // sa jej nikdy nedotkne — čip a odkazy musí doplniť táto.
    if (card.querySelector('.tc-result')) resultExtras(card, frame);

    return card;
}

/** Doplní výsledok: exit čip a scrollovateľný výstup, resp. odkazy na report. */
export function resultExtras(card, frame) {
    if (!card || card.dataset.extrasResult === 'done') return card;

    const name = toolName(card, frame);

    if (!BASH_NAMES.has(name) && !REPORT_NAMES.has(name)) return card;

    card.dataset.extrasResult = 'done';
    toolExtras(card, frame);

    const pre = card.querySelector('.tc-result');

    if (BASH_NAMES.has(name)) {
        exitChip(card, pre, resultStatus(card, frame), frame);

        return card;
    }

    reportLinks(card.querySelector('.tc-body'), pre, frame);

    return card;
}

/**
 * Príkaz v karte potvrdenia. Je to JEDINÉ miesto, kde človek vidí, čo povoľuje,
 * takže sa nesmie skryť do vety — monospace riadok a nič medzi ním a rozhodnutím.
 */
export function permissionExtras(card, frame) {
    if (!card || card.dataset.extras === 'done') return card;
    if (!BASH_NAMES.has(toolName(card, frame))) return card;

    card.dataset.extras = 'done';

    const args = (frame?.arguments && typeof frame.arguments === 'object') ? frame.arguments : card.hadesArgs;
    const block = commandBlock(args);

    if (!block) return card;

    block.classList.add('pc-cmd');

    const preview = card.querySelector('.pc-preview');

    // Keď je v náhľade len JSON argumentov (nástroj vlastný `preview()` nedal),
    // je to tá istá informácia dvakrát a horšie čitateľná — príkazový riadok ho
    // nahradí. Poznám ho po tom, že sa znak po znak rovná tomu, čo doň vložila
    // `permissionCard()`; skutočný náhľad z backendu zostáva.
    if (preview && args && preview.textContent === JSON.stringify(args, null, 2)) {
        preview.replaceWith(block);

        return card;
    }

    if (preview) {
        preview.before(block);

        return card;
    }

    const actions = card.querySelector('.pc-actions');

    if (actions) actions.before(block);
    else card.append(block);

    return card;
}

/* Príkazový riadok s dolárom. Dolár je značka riadku, nie časť príkazu — preto
   `aria-hidden` (čítačka by diktovala „dolár") a `user-select: none` v CSS, aby
   sa skopírovaný riadok dal vložiť do shellu bez ručného mazania. */
function commandBlock(args) {
    const command = String(args?.command ?? '').trim();

    if (command === '') return null;

    const wrap = el('div', 'tc-cmd');
    const line = el('code', 'cmd-line');
    const sign = el('span', 'cmd-sign', '$');

    sign.setAttribute('aria-hidden', 'true');
    line.append(sign, el('span', 'cmd-text', command));
    wrap.append(line);

    const reason = String(args?.reason ?? '').trim();

    // Dôvod je podtitulok, nie druhý príkaz: kým príkaz hovorí ČO sa stane,
    // dôvod je jediné, čo o zmysle behu povie model — a pri povolení rozhoduje.
    if (reason !== '') wrap.append(el('p', 'cmd-why', reason));

    return wrap;
}

function reportBlock(args) {
    const title = String(args?.title ?? '').trim();
    const format = String(args?.format ?? '').trim();

    if (title === '' && format === '') return null;

    const wrap = el('div', 'tc-report');
    const row = el('div', 'rp-row');

    if (title !== '') row.append(el('strong', 'rp-title', clip(title, 120)));
    if (format !== '') row.append(el('span', 'rp-format', format));

    wrap.append(row);

    return wrap;
}

/**
 * Exit kód ako čip v hlavičke. Prvý riadok výstupu je `exit N` (kontrakt
 * nástroja) a v šiestich zbalených riadkoch by ho zjedol výpis — pritom je to
 * najdôležitejšie číslo celého behu.
 */
function exitChip(card, pre, status, frame) {
    const state = card.querySelector('.tc-state');
    let label = '';
    let cls = '';

    // Slová nie sú tie isté, aké má `.tc-state` („zamietnuté" / „chyba"): čip je
    // slot pre exit kód, takže hovorí, čo sa stalo S PRÍKAZOM — zamietnutý sa
    // nikdy nespustil, takže žiadny exit kód neexistuje ani neskôr.
    if (status === 'denied') {
        label = 'nespustené';
        cls = 'denied';
    } else if (status === 'error') {
        label = 'zlyhalo';
        cls = 'failed';
    }

    if (pre) {
        const text = resultText(pre, frame);
        const hit = /^exit (-?\d+)[^\n]*\r?\n?/.exec(text);

        // Shell výstup sa prekresľuje ako ČISTÝ text: `ls -l` začína riadky na
        // `-rw-r--r--`, takže `looksLikeDiff()` ho vyhodnotí ako diff a polovica
        // výpisu by dostala farbu zmazaného riadku.
        pre.classList.remove('diff');
        pre.classList.add('tc-out');

        // Scrollovateľná oblasť musí byť dosiahnuteľná bez myši — inak sa k
        // dlhému výstupu klávesnicou nedá dostať.
        pre.tabIndex = 0;
        pre.setAttribute('aria-label', 'Výstup príkazu');

        if (hit) {
            // Exit riadok určuje NÁPIS, stav behu farbu: `exit 137` pri timeoute
            // je stále to najkonkrétnejšie, čo sa dá o príkaze povedať.
            label = `exit ${hit[1]}`;
            if (cls === '') cls = Number(hit[1]) === 0 ? 'ok' : 'bad';
            pre.textContent = text.slice(hit[0].length);
        } else if (pre.textContent !== text) {
            pre.textContent = text;
        }
    }

    if (label === '' || !state) return;

    state.before(el('span', `tc-exit ${cls}`, label));
}

function reportLinks(body, pre, frame) {
    if (!body) return;

    const url = reportUrl(resultText(pre, frame));

    // Bez cesty sa karta NEROZBÍJA — len odkazy nie sú. Keď nástroj vrátil iný
    // text (odmietnutie, zlyhanie, zmenený tvar odpovede), odkaz na neexistujúci
    // report je horší než žiadny.
    if (!url) return;

    const links = el('div', 'rp-links');
    const open = reportLink(url, 'preview', 'Otvoriť report');

    // Nová karta zámerne: report je samostatný dokument a človek sa má vedieť
    // vrátiť do rozbehnutého vlákna. `noopener` preto, že bez neho má otvorená
    // stránka cez `window.opener` prístup do konzoly.
    open.target = '_blank';
    open.rel = 'noopener';

    links.append(open, reportLink(`${url}${url.includes('?') ? '&' : '?'}download=1`, 'save', 'Stiahnuť'));
    body.append(links);
}

function reportLink(href, icon, label) {
    const link = el('a', 'rp-link');
    const mark = el('span', 'ms', icon);

    link.href = href;
    mark.setAttribute('aria-hidden', 'true');
    link.append(mark, el('span', 'rp-label', label));

    return link;
}

/* Relatívna cesta zámerne: report servuje ten istý origin, takže absolútna URL
   z textu nástroja by len otvorila dvierka niekam inam. */
function reportUrl(text) {
    const hit = /\/console\/reports\/[0-9a-zA-Z-]{8,64}/.exec(String(text ?? ''));

    return hit ? hit[0] : null;
}

/**
 * Text výsledku. Z `pre` sa čítať NEDÁ, keď je vykreslený ako diff: `diffHtml()`
 * spája riadky do `<span>`ov bez `\n`, takže `textContent` vráti celý výpis
 * zliaty do jedného riadku a `exit 0` by sa v ňom nedalo nájsť.
 */
function resultText(pre, frame) {
    if (typeof frame?.result === 'string' && frame.result !== '') return frame.result;
    if (typeof frame?.error === 'string' && frame.error !== '') return frame.error;
    if (!pre) return '';
    if (!pre.classList.contains('diff')) return pre.textContent ?? '';

    return [...pre.querySelectorAll('.dl')].map((line) => line.textContent).join('\n');
}

/* Stav sa číta z rámca, a keď ho nemá (karta z histórie prešla `fillResult()`),
   z tried karty — `normalizeStatus()` už zlúčil `failed` na `error`. */
function resultStatus(card, frame) {
    if (frame?.status) return normalizeStatus(frame.status);
    if (card.classList.contains('denied')) return 'denied';
    if (card.classList.contains('error')) return 'error';

    return 'done';
}

function toolName(card, frame) {
    const raw = frame?.name
        || card?.dataset?.name
        || card?.querySelector('.tc-name')?.textContent
        || '';

    return String(raw).trim().toLowerCase();
}

/* Argumenty si karta odloží na seba: výsledok povoleného zápisu prichádza BEZ
   nich a jediné ďalšie miesto, kde ešte žijú, je karta potvrdenia s tým istým id. */
function toolArgs(card, frame) {
    if (frame?.arguments && typeof frame.arguments === 'object') {
        card.hadesArgs = frame.arguments;

        return frame.arguments;
    }

    if (card?.hadesArgs) return card.hadesArgs;

    const perm = card?.dataset?.id
        ? document.querySelector(`.perm-card[data-id="${card.dataset.id}"]`)
        : null;

    return perm?.hadesArgs || null;
}
