/* ===========================================================================
   Chat — strom agentov.

   ČO TENTO SÚBOR JE: prehľad orchestrácie. Rodičovský ťah, jeho podagenti, a
   u každého kroky, nástroje, tokeny, čas a náhľady toho, čo chcel zapísať.
   Jeden pás nad composerom, teda tam, kde človek stojí a kde sa rozhoduje.

   ČO NIE JE:

   · **Druhá karta povolenia.** Kartu brány vlastní `render.js`
     (`permissionCard()`), rozhodnutie odosiela `run.js` na vlákno, ktoré karta
     nesie v `data-thread` — pri zápise podagenta je to vlákno PODAGENTA. Tento
     modul na ňu iba UKAZUJE (`focusPending()`); druhá karta by znamenala dvoje
     tlačidiel Povoliť nad jedným `console_tool_calls` riadkom a človek by
     nevedel, ktoré z nich rozhoduje.
   · **Druhá kresba priebehu.** Rámce podagenta tečú do toku správ vnorene
     (`.cn` v `render.js`) a to sa nemení. Tu je AGREGÁT: koľko to stálo, kto na
     čom stojí, čo čaká na človeka. Tok je rozprávanie, strom je stav.
   · **Protokol.** O NDJSON, o tom, ktorý rámec ťah končí, ani o `/decide` tento
     modul nevie nič.

   ## Odkiaľ berie rámce

   Z jednej udalosti na `document`: `chat:frame` s `detail` = celý rámec, tak ako
   prišiel z prúdu. Vysiela ju `run.js` (presný diff je v odovzdávacej poznámke
   tejto koľaje) a je to broadcast, nie zmena chovania behu. `noteFrame()` je
   exportovaná, takže sa dá volať aj priamo — kto ju zavolá, na správnosť stromu
   nemá vplyv.

   Vnorené rámce dieťaťa prichádzajú zabalené (`{t:'agent', run, frame}`), takže
   sa dajú rozlíšiť od rámcov rodiča bez toho, aby o tom protokol musel niečo
   dodať. Presne preto je tá obálka v návrhu (`docs/sprint-2026-08-25/
   ROZHRANIE-SPAWN-AGENT.md` §3.2).

   ## Dva rôzne časy a ani jeden nie je chyba

   `runs.duration_ms` je **wall clock** a obsahuje aj minúty, kým sa človek
   rozhodoval o zápise; `tokens_per_second` je z **generovacieho** času
   (`evalDurationMs`). Sú to dva rôzne údaje, takže sú v UI vedľa seba, každý
   s vlastným menom („na hodinách" / „generovanie") — a tok/s sa z hodín
   NEPOČÍTA. Keby sa spojili do jedného čísla, vyšlo by, že model písal
   trojnásobne pomalšie, len preto, že si niekto odbehol na kávu.

   Všetko sú HOISTOVANÉ `export function` — modulový graf chatu má cyklus a
   `export const foo = () => {}` v cykle spadne na `ReferenceError`.
   =========================================================================== */

import { el, focusPending, num, pendingCard } from './render.js';
import { live } from './main.js';
import { argsSummary, diffHtml, iconFor, looksLikeDiff, writeTarget } from '../shared/gate.js';
import { costLabel, stopNote } from '../shared/runstate.js';
import { iconSvg } from '../shared/icons.js';

/** Stav stromu pre AKTUÁLNY ťah. História ťahov žije v toku správ, nie tu. */
const T = {
    /** Rodičovský ťah. */
    parent: null,
    /** Podagenti podľa uuid ich behu, v poradí vzniku. */
    kids: new Map(),
    /**
     * Zaparkoval tento ťah na rozhodnutí človeka?
     *
     * Rozhoduje o tom, či ďalší rámec `start` znamená NOVÝ ťah (a strom sa má
     * vyprázdniť), alebo pokračovanie toho istého ťahu z `/api/console/decide`.
     * Zaparkovaný ťah končí BEZ rámca `end`, takže bez tohto príznaku by
     * pokračovanie rodiča strom zmazalo presne v okamihu, keď je najviac
     * potrebný.
     */
    parked: false,
    /** Je pás rozbalený? Zapamätá sa v rámci stránky, nie v localStorage. */
    open: true,
};

/** Tiká sekundy „na hodinách", kým je čo tikať. */
let ticker = 0;

/** Prebehla inicializácia? `bootAgents()` je idempotentné. */
let booted = false;

/** Stavy, v ktorých beh ešte nedopovedal. */
const OPEN_STATES = ['running', 'waiting'];

const STATE_LABEL = {
    running: 'pracuje',
    waiting: 'čaká na tvoje rozhodnutie',
    done: 'hotovo',
    aborted: 'zastavené',
    failed: 'zlyhalo',
    max_steps: 'strop krokov',
};

/* ---------------------------------------------------------------------------
   UZLY
   --------------------------------------------------------------------------- */

function newNode(kind, data = {}) {
    return {
        kind,                       // 'parent' | 'child'
        run: String(data.run || ''),
        thread: String(data.thread || ''),
        /** id `spawn_agent` volania rodiča — kľúč, ktorým dieťa k rodičovi patrí. */
        call: data.call ?? null,
        task: String(data.task || ''),
        profile: String(data.profile || ''),
        maxSteps: Number(data.max_steps) || 0,
        status: 'running',
        steps: 0,
        tools: 0,
        tokensIn: 0,
        tokensOut: 0,
        tps: null,
        stopReason: '',
        /** Wall clock: začiatok, konec, a koľko z toho bolo čakanie na človeka. */
        t0: Date.now(),
        tEnd: 0,
        waitFrom: 0,
        waitMs: 0,
        /** Zápisy, o ktoré uzol žiadal: `{ name, args, preview, decided }`. */
        asks: [],
    };
}

function parentNode() {
    if (!T.parent) T.parent = newNode('parent');

    return T.parent;
}

function childNode(run) {
    const key = String(run || '');

    if (key === '') return null;

    if (!T.kids.has(key)) T.kids.set(key, newNode('child', { run: key }));

    return T.kids.get(key);
}

/** Stojí niektorý uzol otvorený? Kým áno, hodiny tikajú. */
function hasOpen() {
    if (T.parent && OPEN_STATES.includes(T.parent.status)) return true;

    for (const kid of T.kids.values()) {
        if (OPEN_STATES.includes(kid.status)) return true;
    }

    return false;
}

/** Uzol prestal čakať na človeka — čas čakania sa zaúčtuje a okno zavrie. */
function closeWait(node) {
    if (!node || node.waitFrom === 0) return;

    node.waitMs += Date.now() - node.waitFrom;
    node.waitFrom = 0;
}

function closeNode(node, status) {
    if (!node) return;

    closeWait(node);
    node.status = status;
    node.tEnd = Date.now();
}

/* ---------------------------------------------------------------------------
   RÁMCE
   --------------------------------------------------------------------------- */

/**
 * Jeden rámec z prúdu. Volá to `wireAgents()` z udalosti `chat:frame`.
 *
 * Neznámy typ rámca sa ticho ignoruje — protokol sa má dať rozširovať bez toho,
 * aby staršia plocha spadla.
 */
export function noteFrame(frame) {
    if (!frame || typeof frame !== 'object') return;

    if (frame.t === 'agent') {
        childFrame(frame.run, frame.frame || {});
        paintTree();

        return;
    }

    switch (frame.t) {
        case 'agent_start': {
            const node = childNode(frame.run);

            if (node) {
                node.thread = String(frame.thread || node.thread);
                node.call = frame.call ?? node.call;
                node.task = String(frame.task || '');
                node.profile = String(frame.profile || '');
                node.maxSteps = Number(frame.max_steps) || 0;
                node.t0 = Date.now();
            }

            // Rodič od tejto chvíle nepíše — čaká na dieťa. Nie je to čakanie na
            // človeka, takže sa neúčtuje ako `waitMs`.
            break;
        }

        case 'agent_wait': {
            const node = childNode(frame.run);

            if (node) {
                node.thread = String(frame.thread || node.thread);
                node.status = 'waiting';
                node.waitFrom = Date.now();
            }

            // Ťah rodiča tu KONČÍ, bez rámca `end`. Rodič tým takisto čaká na
            // človeka: jeho hodiny bežia a musí byť vidieť, prečo.
            parentNode().status = 'waiting';
            parentNode().waitFrom = Date.now();
            T.parked = true;

            setExpanded(true);
            live(`Podagent čaká na tvoje rozhodnutie o zápise${frame.name ? ` (${frame.name})` : ''}.`);
            break;
        }

        case 'agent_end': {
            const node = childNode(frame.run);

            if (node) {
                if (frame.steps) node.steps = Number(frame.steps) || node.steps;
                if (frame.tool_calls) node.tools = Number(frame.tool_calls) || node.tools;
                if (frame.tokens_in) node.tokensIn = Number(frame.tokens_in) || node.tokensIn;
                if (frame.tokens_out) node.tokensOut = Number(frame.tokens_out) || node.tokensOut;
                closeNode(node, String(frame.status || 'done'));
            }

            // Rodič pokračuje: dieťa dopovedalo a jeho zhrnutie ide do jeho
            // kontextu. Stav sa vracia na `running` až rámcom rodiča nižšie —
            // tu sa len zavrie čakanie, ak nejaké bolo.
            closeWait(parentNode());
            break;
        }

        case 'start': {
            // Nový ťah, alebo pokračovanie zaparkovaného? Rozhoduje `T.parked`
            // (viď jeho docblock) — nie prítomnosť uzlov, tá by pokračovanie
            // rodiča po dopovedaní dieťaťa vyhodnotila ako nový ťah.
            if (!T.parked) resetAgents();

            T.parked = false;

            const node = parentNode();

            closeWait(node);
            node.status = 'running';
            node.tEnd = 0;
            break;
        }

        case 'step':
            parentNode().steps = Math.max(parentNode().steps, Number(frame.n) || 0);
            break;

        case 'tool':
            parentNode().tools += 1;
            break;

        case 'permission':
            // Zápis RODIČA, nie podagenta. Do stromu patrí, pretože aj on drží
            // hodiny rodiča — ale karta a rozhodnutie sú `render.js` / `run.js`.
            parentNode().status = 'waiting';
            parentNode().waitFrom = Date.now();
            parentNode().asks.push(askOf(frame));
            T.parked = true;
            break;

        case 'end': {
            const node = parentNode();

            if (frame.tokens_in) node.tokensIn = Number(frame.tokens_in) || 0;
            if (frame.tokens_out) node.tokensOut = Number(frame.tokens_out) || 0;
            node.tps = Number(frame.tokens_per_second) || null;
            node.stopReason = String(frame.stop_reason || '');
            closeNode(node, frame.stop_reason === 'max_steps' ? 'max_steps' : 'done');
            T.parked = false;
            break;
        }

        case 'error':
            closeNode(parentNode(), 'failed');
            T.parked = false;
            break;

        default:
            break;
    }

    paintTree();
}

/** Rozbalený rámec dieťaťa. */
function childFrame(run, frame) {
    const node = childNode(run);

    if (!node) return;

    // Čokoľvek od dieťaťa znamená, že sa už nečaká na človeka.
    closeWait(node);
    closeWait(parentNode());

    switch (frame.t) {
        case 'step':
            node.steps = Math.max(node.steps, Number(frame.n) || 0);
            if (!node.maxSteps) node.maxSteps = Number(frame.of) || 0;
            node.status = 'running';
            break;

        case 'tool':
            node.tools += 1;
            node.status = 'running';
            break;

        case 'permission':
            // Náhľad zmeny sa berie TU: rámec `agent_wait`, ktorý príde za ním,
            // nesie len meno nástroja. Karta s tlačidlami je `render.js`.
            node.asks.push(askOf(frame));
            break;

        case 'end':
            if (frame.tokens_in) node.tokensIn = Number(frame.tokens_in) || node.tokensIn;
            if (frame.tokens_out) node.tokensOut = Number(frame.tokens_out) || node.tokensOut;
            // tok/s LEN z rámca; z hodín sa nepočítajú (viď hlavička súboru).
            node.tps = Number(frame.tokens_per_second) || node.tps;
            node.stopReason = String(frame.stop_reason || '');
            break;

        case 'error':
            node.status = 'failed';
            break;

        default:
            break;
    }
}

function askOf(frame) {
    return {
        id: frame.id ?? null,
        name: String(frame.name || ''),
        args: frame.arguments,
        preview: String(frame.preview ?? ''),
        decided: false,
    };
}

/* ---------------------------------------------------------------------------
   KRESBA

   Pás sedí v `#chat-main` medzi tokom a composerom: je to stav „čo sa práve
   deje", takže patrí k miestu, kde človek reaguje. `#chat-main` je flex column
   a tok má `flex: 1`, takže si pás vezme presne svoju výšku bez `position`
   a bez počítania.
   --------------------------------------------------------------------------- */

export function ensurePanel() {
    const main = document.getElementById('chat-main');

    if (!main) return null;

    let box = document.getElementById('chat-agents');

    if (!box) {
        box = el('section', 'cs-box');
        box.id = 'chat-agents';
        box.hidden = true;
        box.setAttribute('aria-label', 'Strom agentov');

        main.insertBefore(box, document.getElementById('chat-composer'));
    }

    return box;
}

/**
 * Prekreslí pás.
 *
 * Bez podagentov sa pás NEKRESLÍ: rodič sám nie je strom a hlavička behu už
 * o ňom hovorí (`setStats()`). Pás, ktorý stojí pri každom ťahu, by ukradol
 * riadok a nepridal informáciu.
 */
export function paintTree() {
    const box = ensurePanel();

    if (!box) return;

    if (T.kids.size === 0) {
        box.hidden = true;
        box.replaceChildren();
        stopTick();

        return;
    }

    box.hidden = false;
    box.replaceChildren();
    box.append(head());

    if (T.open) {
        const list = el('ul', 'cs-list');

        list.append(nodeRow(parentNode(), 0));
        T.kids.forEach((kid) => list.append(nodeRow(kid, 1)));
        box.append(list);
        box.append(legend());
    }

    if (hasOpen()) startTick();
    else stopTick();
}

function head() {
    const bar = el('div', 'cs-head');
    const btn = el('button', 'cs-toggle');

    btn.type = 'button';
    btn.setAttribute('aria-expanded', T.open ? 'true' : 'false');
    btn.setAttribute('aria-controls', 'chat-agents');
    btn.append(icon('tree'));
    btn.append(el('strong', 'cs-title', 'Strom agentov'));
    btn.append(el('span', 'cs-count', `${num(T.kids.size, 0)} ${plural(T.kids.size)}`));
    btn.addEventListener('click', () => { setExpanded(!T.open); });
    bar.append(btn);

    const waiting = firstWaiting();

    if (waiting && pendingCard()) bar.append(decideButton(waiting));

    return bar;
}

/**
 * Skratka k rozhodnutiu. NEROZHODUJE — presúva pozornosť na kartu brány, ktorá
 * jediná vie, na ktoré vlákno rozhodnutie patrí (pri podagentovi na jeho
 * vlastné). Dve miesta, z ktorých sa dá povoliť ten istý zápis, by boli dve
 * pravdy o jednej bráne.
 */
function decideButton(node) {
    const btn = el('button', 'cs-decide primary');

    btn.type = 'button';
    btn.append(el('span', null, 'Rozhodnúť o zápise'));
    btn.title = node.kind === 'child'
        ? 'Prejsť na kartu, ktorou zápis podagenta povolíš alebo zamietneš'
        : 'Prejsť na kartu, ktorou zápis povolíš alebo zamietneš';
    btn.addEventListener('click', () => { focusPending(); });

    return btn;
}

function firstWaiting() {
    for (const kid of T.kids.values()) {
        if (kid.status === 'waiting') return kid;
    }

    return T.parent && T.parent.status === 'waiting' ? T.parent : null;
}

/** Jeden uzol stromu. `depth` je odsadenie — strom je zoznam, nie SVG. */
function nodeRow(node, depth) {
    const row = el('li', `cs-node is-${node.status} ${depth > 0 ? 'is-child' : 'is-root'}`);

    row.dataset.depth = String(depth);
    if (node.run) row.dataset.run = node.run;

    const top = el('div', 'cs-top');

    top.append(icon(depth > 0 ? 'hub' : 'tree', 'cs-icon'));
    top.append(el('strong', 'cs-name', node.kind === 'parent' ? 'Rodič — tento ťah' : childName(node)));
    top.append(el('span', 'cs-state', STATE_LABEL[node.status] || node.status));
    row.append(top);

    if (node.task !== '') row.append(el('p', 'cs-task', node.task));

    const work = workLine(node);

    if (work !== '') row.append(el('p', 'cs-line', work));

    row.append(clockLine(node));

    const gen = costLabel({ tokens_in: node.tokensIn, tokens_out: node.tokensOut, tokens_per_second: node.tps }, num);

    if (gen !== '') {
        const line = el('p', 'cs-line');

        line.append(el('span', 'cs-lbl', 'generovanie'));
        line.append(el('span', 'cs-val', gen));
        row.append(line);
    }

    // Ako sa uzol skončil, keď sa neskončil riadne. Vetu skládá zdieľaný
    // `stopNote()` — ten istý slovník, akým to hlási tok správ, takže zrezaný
    // ťah nevyzerá po obnove stránky inak než pred ňou.
    if (node.tEnd && node.stopReason !== '') {
        const note = stopNote(node.stopReason);

        if (note !== '') row.append(el('p', 'cs-stop', note));
    }

    node.asks.forEach((ask) => row.append(askBlock(ask, node)));

    return row;
}

function childName(node) {
    const at = [...T.kids.keys()].indexOf(node.run);

    return `Podagent ${at + 1}${node.profile ? ` · profil ${node.profile}` : ''}`;
}

/** Kroky a nástroje. Strop krokov je vedľa nich, aby bolo vidieť, kam sa ide. */
function workLine(node) {
    const bits = [];

    if (node.steps) bits.push(node.maxSteps ? `kroky ${num(node.steps, 0)}/${num(node.maxSteps, 0)}` : `kroky ${num(node.steps, 0)}`);
    else if (node.maxSteps) bits.push(`strop ${num(node.maxSteps, 0)} kroky`);

    if (node.tools) bits.push(`nástroje ${num(node.tools, 0)}`);

    return bits.join(' · ');
}

/**
 * Hodiny. Menované ZÁMERNE inak než generovanie: obsahujú čas, kým čakalo dieťa
 * a kým sa rozhodoval človek. Keď tá časť nie je nulová, hovorí sa nahlas —
 * inak by uzol vyzeral pomalšie, než naozaj pracoval.
 */
function clockLine(node) {
    const line = el('p', 'cs-line');
    const end = node.tEnd || Date.now();
    const wait = node.waitMs + (node.waitFrom ? Date.now() - node.waitFrom : 0);

    line.append(el('span', 'cs-lbl', 'na hodinách'));
    line.append(el('span', 'cs-val', clock(Math.max(0, end - node.t0))));

    if (wait >= 1000) line.append(el('span', 'cs-sub', `z toho čakanie na teba ${clock(wait)}`));

    return line;
}

/**
 * Náhľad zápisu, o ktorý uzol žiadal.
 *
 * `<details>` a nie vlastný prepínač: 442 B diff (nameraný priemer náhľadu pri
 * bráne) sa vojde, ale zápis celého súboru nie — a natívne rozbalenie funguje
 * klávesnicou aj čítačkou bez jediného riadku JS.
 *
 * Diff sa zafarbuje zdieľaným `diffHtml()`, ktorý riadky ESCAPUJE — je to výstup
 * modelu, teda nedôveryhodný vstup. Vlastná kópia toho formátu tu nevzniká.
 */
function askBlock(ask, node) {
    const wrap = document.createElement('details');

    wrap.className = 'cs-ask';

    const summary = document.createElement('summary');

    summary.append(icon(iconFor(ask.name), 'cs-ask-icon'));
    summary.append(el('span', 'cs-ask-name', writeTarget(ask.name, ask.args, ask.preview)));
    summary.append(el('span', 'cs-ask-state', ask.decided
        ? 'rozhodnuté'
        : (node.status === 'waiting' ? 'čaká' : 'v behu')));
    wrap.append(summary);

    const preview = ask.preview.trim();
    const box = el('pre', 'cs-preview');

    if (preview !== '' && looksLikeDiff(preview)) {
        box.classList.add('diff');
        box.innerHTML = diffHtml(preview);
    } else if (preview !== '') {
        box.textContent = preview;
    } else {
        // Náhľad nie je (nástroj ho nevie zložiť) — argumenty sú horší, ale
        // pravdivý podklad. Prázdny blok by tvrdil, že sa nemenilo nič.
        box.textContent = argsSummary(ask.args) || 'Náhľad zmeny nie je k dispozícii.';
    }

    wrap.append(box);

    return wrap;
}

/**
 * Jedna veta, ktorá dvojicu časov vysvetlí. Stojí v páse a nie v dokumentácii,
 * pretože otázka „prečo tok/s nesedí s trvaním" vzniká práve tu.
 */
function legend() {
    return el(
        'p',
        'cs-legend',
        '„Na hodinách" je celý čas od začiatku po konec, teda aj čakanie na tvoje '
        + 'rozhodnutie. „Generovanie" je to, čo model naozaj napísal — preto sa tokeny '
        + 'za sekundu z hodín nedajú vypočítať.',
    );
}

export function setExpanded(on) {
    T.open = !!on;
    paintTree();
}

/** Vyprázdni strom. Nový ťah začína bez cudzích uzlov. */
export function resetAgents() {
    T.parent = null;
    T.kids = new Map();
    T.parked = false;
    paintTree();
}

/* ---------------------------------------------------------------------------
   DROBNOSTI
   --------------------------------------------------------------------------- */

function icon(name, cls) {
    const mark = iconSvg(name, cls ? { cls } : undefined);

    mark.setAttribute('aria-hidden', 'true');

    return mark;
}

/**
 * Čas na hodinách. Minúty od minúty: pri behu, ktorý čakal na človeka pol
 * hodiny, je „1 847 s" číslo, ktoré nikto nečíta.
 */
export function clock(ms) {
    const total = Math.round(Math.max(0, ms) / 1000);

    if (total < 60) return `${num(total, 0)} s`;

    const minutes = Math.floor(total / 60);
    const seconds = total % 60;

    return seconds === 0 ? `${num(minutes, 0)} min` : `${num(minutes, 0)} min ${num(seconds, 0)} s`;
}

function plural(count) {
    if (count === 1) return 'podagent';

    return count >= 2 && count <= 4 ? 'podagenti' : 'podagentov';
}

/* Sekundy tikajú LEN kým je čo tikať — inak by interval bežal nad zatvoreným
   pásom do konca session. Ten istý dôvod, z akého graf zastaví `rAF` mimo
   obrazovky Graf. */
function startTick() {
    if (ticker) return;

    ticker = setInterval(() => {
        if (!hasOpen()) {
            stopTick();

            return;
        }

        if (T.open) paintTree();
    }, 1000);
}

function stopTick() {
    if (!ticker) return;

    clearInterval(ticker);
    ticker = 0;
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

export function wireAgents() {
    // Jediný vstup rámcov. Keď hook v `run.js` nie je, pás sa nikdy nezobrazí —
    // to je čestný stav, nie chyba: strom bez rámcov by kreslil vymyslené uzly.
    document.addEventListener('chat:frame', (event) => { noteFrame(event.detail); });

    // Rozhodnutie človeka. Uzol prestane čakať a náhľad sa označí za rozhodnutý;
    // samotné rozhodnutie odosiela `run.js` (jedna cesta, `/api/console/decide`).
    document.addEventListener('chat:decide', (event) => {
        const thread = String(event.detail?.thread || '');
        const id = event.detail?.id ?? null;
        let node = null;

        for (const kid of T.kids.values()) {
            if (thread !== '' && kid.thread === thread) node = kid;
        }

        if (!node) node = T.parent;
        if (!node) return;

        closeWait(node);
        node.status = 'running';
        node.asks.forEach((ask) => {
            if (id === null || ask.id === id) ask.decided = true;
        });

        closeWait(parentNode());
        paintTree();
    });

    // Iné vlákno je iná konverzácia; strom aktuálneho ťahu doňho nepatrí.
    document.addEventListener('chat:thread', resetAgents);
    document.addEventListener('chat:new-thread', resetAgents);

    // Zastavený beh netiká. Stav uzlov sa NEPREPISUJE — čo dobehlo, dobehlo;
    // len sa zavrú hodiny, aby pás netvrdil, že sa ešte pracuje.
    document.addEventListener('chat:stop', () => {
        if (T.parent && T.parent.status === 'running') closeNode(T.parent, 'aborted');

        T.kids.forEach((kid) => {
            if (kid.status === 'running') closeNode(kid, 'aborted');
        });

        paintTree();
    });

    window.addEventListener('pagehide', stopTick);
}

export function bootAgents() {
    if (booted) return;

    booted = true;
    ensurePanel();
    wireAgents();
}

document.addEventListener('chat:ready', bootAgents);
