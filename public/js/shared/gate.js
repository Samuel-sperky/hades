/* ===========================================================================
   Charón — slovník a formát dvojfázovej brány zápisov.

   To, čo musí dok Charóna nad grafom povedať a nakresliť ROVNAKO ako plná
   konzola: ikona nástroja, argumenty na jeden riadok, zafarbený diff a — čo je
   najdôležitejšie — ľudské ohlásenie ZÁPISU (nie mena nástroja), na ktoré
   používateľ pri bráne reaguje.

   Zdieľaný modul (public/js/shared/) — importuje len `escapeHtml` zo susedného
   shared/markdown.js (leaf, bez cyklu). Skladanie DOM kariet sem NEPATRÍ:
   `toolCard()`, `permissionCard()`, `historyCard()`, `markResult()`,
   `fillResult()`, `decide()` skladajú markup s triedami console.css a zostávajú
   v public/js/console/tools.js; dok si postaví vlastné karty nad mind.css. Toto
   je slovník, nie view — otázka CSS, nie JS.
   =========================================================================== */

import { escapeHtml } from './markdown.js';

/* Skrátenie na jeden riadok karty. Výpustka je znak, nie tri bodky. Súkromná
   kópia (4 riadky) drží tento modul bez závislosti na DOM utile ktorejkoľvek
   z dvoch stránok — gate.js je leaf ako ndjson.js. */
function clip(text, max = 120) {
    const one = String(text ?? '').replace(/\s+/gu, ' ').trim();

    return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/* Ikony sú SUBSET Material Symbols. Každá tu menovaná je overená — chýbajúca
   ligatúra sa vykreslí ako svoje meno („terminal"), čo je presne tá porucha,
   ktorú subset riešil. Keď pridáš nástroj s novou ikonou, over ju, inak radšej
   nechaj `bolt`. */
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

/* ---------- slovník rozhodnutia ---------- */

const DECISION_LABEL = {
    allow: 'Povolené',
    allow_always: 'Povolené — a odteraz bez pýtania',
    deny: 'Zamietnuté',
};

/** Ľudský štítok rozhodnutia; `undefined` pre neznáme (volajúci si dá fallback). */
export function decisionLabel(decision) {
    return DECISION_LABEL[decision];
}

/* Čo čítačka povie, keď brána zápisov požiada o rozhodnutie.

   Do 20. 8. 2026 povedala len „Nástroj mind_learn čaká na povolenie." — teda
   MENO NÁSTROJA a ani slovo o tom, čo sa má zapísať. Meno pritom odznelo aj tak
   dvakrát (raz z vety, raz z `aria-label` karty, ktorá si berie fokus), kým
   obsah, o ktorom sa rozhoduje, v AX strome celý JE. Karta pribúda ešte pod
   `aria-busy="true"`, takže `role="log"` ju sám neohlási: táto jedna veta je
   jediný kanál, ktorý o zápise povie. */
export function writeAsk(frame) {
    return `${writeTarget(frame.name, frame.arguments, frame.preview)}. Enter povolí, Esc zamietne.`;
}

/* Ľudský popis zápisu: ČO a KAM. Meno nástroja je technické („mind_learn",
   „apply_patch") a čítačke o obsahu rozhodnutia nepovie nič — preto ho
   prekladáme na sloveso a doplníme tým, na čom rozhoduje človek: labelom uzla,
   resp. cestou k súboru. Detail číta z argumentov; keď tam nie je, siahne na
   prvý riadok náhľadu (u pamäťových zápisov typ a názov uzla, u súborových
   cestu). Jedno miesto pre prístupné meno karty, žiadosť aj výsledok — aby
   všetky tri hovorili jedným hlasom. */
export function writeTarget(name, args, preview) {
    const key = String(name || '').toLowerCase();
    const detail = argsSummary(args) || firstLine(preview);

    let action = 'Zápis';
    if (/(^|_)(learn|remember)/.test(key)) action = 'Uloženie do pamäte';
    else if (/(^|_)decision/.test(key)) action = 'Zápis rozhodnutia do pamäte';
    else if (/(^|_)delete/.test(key)) action = 'Vymazanie z pamäte';
    else if (/(^|_)(write|edit|apply|move|rename)/.test(key)) action = 'Zápis do súboru';

    return detail !== '' ? `${action}: ${detail}` : action;
}

function firstLine(text) {
    return clip(String(text ?? '').split(/\r?\n/).find((line) => line.trim() !== '') || '', 90);
}
