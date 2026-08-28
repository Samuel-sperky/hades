/* ===========================================================================
   Chat — kreslenie toku behu.

   ČO TENTO SÚBOR JE: view. Bubliny, karty nástrojov, karta brány zápisov, rámec
   podagenta, poradie zadaní, obnova vlákna z payloadu servera.

   ČO NIE JE: protokol. Nevie o NDJSON, o `/api/console/run` ani o tom, ktorý
   rámec ťah končí. To všetko drží `run.js` nad zdieľaným
   `public/js/shared/runclient.js`. Tu sa len kreslí to, čo mu prišlo.

   Tok je PLOCHÝ zoznam blokov v poradí, v akom veci naozaj nastali:
   `.cm-user` → `.cm-assistant` → `.ct` (karta nástroja) → ďalšia `.cm-assistant`
   → `.cg` (brána). Karta nástroja preto zavrie rozpracovanú bublinu a text po
   nástroji začne novú — inak by odpoveď po grepe stála PRED kartou grepu.

   Jediná výnimka z plochosti je podagent: jeho rámce prichádzajú zabalené
   (`{t:'agent', run, frame}`) a kreslia sa do vnoreného `.cn`, nie do koreňa
   toku. Preto `host()` a `activeTurn()` — dve funkcie namiesto priameho
   `streamHost()`, aby sa nedalo zabudnúť, do ktorej úrovne blok patrí.

   Markdown ide výhradne cez zdieľaný `../shared/markdown.js`; slovník brány
   (ikona, argumenty na riadok, diff, ľudský popis zápisu) cez
   `../shared/gate.js`; vety o konci behu cez `../shared/runstate.js`. Druhá
   kópia ani jedného z nich tu nevzniká — to bola presne tá chyba, ktorú audit
   19. 8. 2026 našiel na šiestich miestach.

   TRIEDY. `chat.css` zatiaľ nesie len layout plochy, takže názvoslovie toku
   zavádza tento modul a drží sa prefixov, ktoré tam už sú (`cp-` panel, `ch-`
   hlavička, `cc-` composer, `ca-` artefakt, `ce-` prázdny stav):
     `.cm`  správa   · `.cm-user` `.cm-assistant` `.cm-system` `.cm-error`
     `.ct`  nástroj  · stavy `.is-running` `.is-done` `.is-error` `.is-denied`
     `.cg`  brána    · stavy `.is-decided` `.is-allowed` `.is-denied`
     `.cn`  podagent
     `.cq`  poradie zadaní
   Diff a bloky kódu používajú tie isté triedy ako konzola (`.diff .dl .df-*`,
   `pre.code`), pretože ich skládajú tie isté zdieľané moduly.

   Všetko sú HOISTOVANÉ `export function` — `render.js` ↔ `main.js` ↔ `run.js` sú
   v cykle a `export const foo = () => {}` v cykle spadne na `ReferenceError`.
   =========================================================================== */

import { renderMarkdown } from '../shared/markdown.js';
// Trojtvarové skloňovanie žije v `threads.js` a je exportované. Alias, aby sa
// nepomiešalo s lokálnym `plural()`, ktorý skloňuje RIADKY diffu.
import { plural as plural3 } from './threads.js';
import {
    argsSummary, decisionLabel, diffHtml, iconFor, looksLikeDiff, writeAsk, writeTarget,
} from '../shared/gate.js';
import { costLabel, runNote, stopNote } from '../shared/runstate.js';
import { iconSvg } from '../shared/icons.js';
import {
    announce, clearEmpty, isFollowing, live, scrollToBottom, streamHost, toolList,
} from './main.js';

/* Koľko riadkov výsledku sa vidí bez rozbalenia. Šesť je jeden „odsek" — dosť
   na to, aby bolo vidno, či nástroj našiel to, čo mal. */
const PEEK_LINES = 6;

/** Rozpracovaná bublina TOP-LEVEL ťahu. */
let turn = null;

/** Otvorený podagent: `{ run, thread, box, body, foot, turn }`, alebo null. */
let agent = null;

/** Bublina „odpoveď sa pripravuje" — drží spodok toku, kým nepríde prvý token. */
let waitNode = null;

/** Obnova vlákna pridáva desiatky blokov naraz; vtedy sa nedoskroluje po každom. */
let restoring = 0;

/* Statický prázdny stav z blade. `clearEmpty()` ho z DOM odpojí, takže si tu
   držíme REFERENCIU — nové prázdne vlákno ho potrebuje vrátiť a druhá kópia
   toho markupu v JS by bola druhý zdroj pravdy o tom, čo chat vie. */
let emptyNode = null;

/** Mapa `meno nástroja → zapisuje?`, zo zoznamu, ktorý do HTML skládá server. */
let writeFlags = null;

/* Vlákna podagentov podľa uuid ich behu. `/decide` sa posiela na vlákno
   PODAGENTA, nie na to, ktoré má klient otvorené — a rámec `permission` dieťaťa
   uuid vlákna nenesie (nesie ho `agent_start` a `agent_wait`). Bez tejto mapy by
   karta brány dieťaťa nevedela, kam rozhodnutie patrí. */
const agentThreads = new Map();

/* ---------------------------------------------------------------------------
   DROBNÉ POMÔCKY

   Vlastné a nie import z `../console/dom.js`: chat je iná plocha a nemá dôvod
   načítať moduly konzoly, aby vedel vyrobiť `<span>`.
   --------------------------------------------------------------------------- */

/** Element s triedou a TEXTOM — `textContent`, nikdy `innerHTML`. */
export function el(tag, cls, text) {
    const node = document.createElement(tag);

    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);

    return node;
}

/** Čísla po slovensky — desatinná čiarka, nie bodka. */
export function num(value, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';

    return value.toLocaleString('sk-SK', { maximumFractionDigits: digits });
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

/** Zapisuje tento nástroj? Zoznam je statický fakt o behu z `toolList()`. */
export function isWriteTool(name) {
    if (writeFlags === null) {
        writeFlags = new Map(toolList().map((t) => [String(t.name), !!t.write]));
    }

    return writeFlags.get(String(name || '')) === true;
}

/* ---------------------------------------------------------------------------
   KAM SA KRESLÍ
   --------------------------------------------------------------------------- */

/** Kontejner aktuálnej úrovne: telo otvoreného podagenta, inak koreň toku. */
export function host() {
    return agent ? agent.body : streamHost();
}

/** Rozpracovaná bublina aktuálnej úrovne. */
function activeTurn() {
    return agent ? agent.turn : turn;
}

function setActiveTurn(value) {
    if (agent) agent.turn = value;
    else turn = value;
}

/** Doskroluje LEN ak človek stojí na spodku — inak by mu tok trhal čítanie. */
export function scrollIfFollowing() {
    if (!restoring && isFollowing()) scrollToBottom();
}

/**
 * Blok do toku. Prázdny stav sa pri prvom bloku odpojí, ale REFERENCIA na neho
 * zostáva — prázdne vlákno ho vráti cez `showEmpty()`.
 */
function appendBlock(node) {
    const box = host();
    if (!box) return node;

    keepEmpty();
    clearEmpty();

    // Bublina čakania drží spodok toku: čokoľvek pribudne počas nej (karta
    // nástroja, hlásenie) ide PRED ňu, inak by signál „ešte sa pracuje" skončil
    // uprostred histórie a pod ním by stálo ticho.
    if (waitNode?.isConnected && waitNode.parentElement === box) box.insertBefore(node, waitNode);
    else box.append(node);

    scrollIfFollowing();

    return node;
}

function keepEmpty() {
    emptyNode ??= document.getElementById('chat-empty');

    return emptyNode;
}

/** Vráti statický prázdny stav do toku (nové alebo prázdne vlákno). */
export function showEmpty() {
    const stream = streamHost();
    const node = keepEmpty();

    if (stream && node && !node.isConnected) stream.prepend(node);
}

/**
 * Vyprázdni tok pred obnovou vlákna.
 *
 * Prázdny stav sa ZÁMERNE nemaže — je to markup z blade a jediný, ktorý plocha
 * má. `aria-busy` sem nepatrí: vlastní ho `setRunning()` v `main.js` a dvaja
 * vlastníci jedného atribútu sa rozídu.
 */
export function resetStream() {
    const stream = streamHost();
    if (!stream) return;

    keepEmpty();
    [...stream.children].forEach((node) => {
        if (node !== emptyNode) node.remove();
    });

    turn = null;
    agent = null;
    waitNode = null;
    agentThreads.clear();
}

/* ---------------------------------------------------------------------------
   BUBLINY
   --------------------------------------------------------------------------- */

export function pushBlock(node) {
    return appendBlock(node);
}

export function pushUser(text) {
    const box = el('div', 'cm cm-user');

    box.append(el('span', 'cm-who', 'Ty'));
    box.append(el('div', 'cm-bubble', text));

    return appendBlock(box);
}

export function pushNotice(text) {
    const box = el('div', 'cm cm-system');

    box.append(el('span', 'cm-who', 'Hades'));
    box.append(el('div', 'cm-bubble', text));

    return appendBlock(box);
}

export function pushError(text) {
    const box = el('div', 'cm cm-error');

    // Bez ikony zámerne: Material Symbols je tu subset (215 glyfov zo 4271) a
    // nevykreslená ligatúra sa ukáže ako svoje meno. Slovo „Chyba" nesie ten istý
    // význam a nezávisí od regenerácie fontu.
    box.append(el('span', 'cm-who', 'Chyba'));
    box.append(el('div', 'cm-bubble', text));

    return appendBlock(box);
}

/** Hotová odpoveď (obnova histórie) — markdown naraz, bez streamovania. */
export function pushAssistant(text, meta = {}) {
    const box = assistantShell(meta);

    box.querySelector('.cm-bubble').innerHTML = renderMarkdown(text ?? '');

    return appendBlock(box);
}

function assistantShell(meta = {}) {
    const box = el('div', 'cm cm-assistant');
    const mid = meta.message_id ?? meta.id;

    if (mid) box.dataset.mid = mid;

    const who = el('span', 'cm-who');
    who.append(el('span', null, 'Hades'));
    if (meta.model) who.append(el('span', 'cm-model', meta.model));

    // Cena odpovede zostáva PRI ODPOVEDI: `#chat-run-stats` v hlavičke ju drží
    // len do ďalšieho ťahu, takže po obnove stránky by sa hodinu stará odpoveď
    // nedala oceniť vôbec — hoci `console_messages` tie čísla nesie.
    const cost = costLabel({
        tokens_out: meta.tokens_out,
        tokens_per_second: meta.tokens_per_second,
    }, num);

    if (cost !== '') who.append(el('span', 'cm-cost', cost));

    box.append(who);
    box.append(el('div', 'cm-bubble cm-md'));

    return box;
}

/* ---------------------------------------------------------------------------
   ČAKANIE NA PRVÝ TOKEN

   Model beží na CPU (~8 tok/s) a prvý token môže prísť po 25 s. Bublina stojí
   presne tam, kde odpoveď vzápätí pribudne, a zmizne s prvým znakom.
   --------------------------------------------------------------------------- */

export function waitStart() {
    const box = host();
    if (!box || waitNode?.isConnected) return;

    keepEmpty();
    clearEmpty();

    const node = el('div', 'cm cm-assistant cm-wait');
    // Tok je `aria-live` oblasť; pulzujúce bodky nemajú čo hlásiť a jednu vetu
    // o behu povie `#chat-announce`.
    node.setAttribute('aria-hidden', 'true');

    const who = el('span', 'cm-who');
    who.append(el('span', null, 'Hades'));

    const bubble = el('div', 'cm-bubble');
    const dots = el('span', 'cm-dots');

    for (let i = 0; i < 3; i++) dots.append(el('span', 'cm-dot'));
    bubble.append(dots, el('span', 'cm-wait-note', 'Odpoveď sa pripravuje…'));

    node.append(who, bubble);
    box.append(node);
    waitNode = node;
    scrollIfFollowing();
}

export function waitStop() {
    waitNode?.remove();
    waitNode = null;
}

/* ---------------------------------------------------------------------------
   STREAMOVANÁ ODPOVEĎ
   --------------------------------------------------------------------------- */

/** Otvorí ťah. Bublina vznikne až s prvým textom — nástroj môže prísť skôr. */
export function beginTurn(meta = {}) {
    setActiveTurn({
        raw: '',
        bubble: null,
        mid: meta.message_id ?? null,
        model: meta.model || '',
        head: false,
    });

    waitStart();
}

export function appendDelta(text) {
    if (!activeTurn()) beginTurn({});

    const t = activeTurn();

    // Prvý znak je koniec čakania. Až tu, nie pri `start`: rámec `start` prichádza
    // okamžite, kým model ešte ani nezačal generovať.
    waitStop();

    if (!t.bubble) {
        const box = appendBlock(assistantShell({
            message_id: t.mid,
            model: t.head ? '' : t.model,
        }));

        t.head = true;
        t.bubble = box.querySelector('.cm-bubble');
        t.raw = '';
    }

    t.raw += String(text ?? '');
    schedulePaint();
}

let painting = 0;

/* Markdown sa prekresľuje raz za rámec, nie raz za token: pri 8 tok/s je to to
   isté číslo, ale pri dobehnutí zabufferovaného prúdu by jeden chunk inak
   vyvolal stovky prekreslení. Celá bublina naraz a nie prírastkovo preto, že
   markdown prírastkový NIE JE — dve odrážky, ktoré prídu po sebe, patria do
   jedného `<ul>`. */
function schedulePaint() {
    if (painting) return;

    painting = requestAnimationFrame(() => {
        painting = 0;
        paintTurn();
    });
}

function paintTurn() {
    const t = activeTurn();
    if (!t?.bubble) return;

    t.bubble.innerHTML = renderMarkdown(t.raw);
    scrollIfFollowing();
}

/** Zatvorí bublinu ťahu — text po nástroji začne novú. */
export function closeBubble() {
    const t = activeTurn();
    if (!t) return;

    paintTurn();
    t.bubble = null;
    t.raw = '';
}

/**
 * Dokreslí ťah. Prekreslenie je tu SYNCHRÓNNE a nie cez rAF: na skrytej karte
 * sa rAF nespustí a posledná dávka textu by v bubline nikdy nepribudla.
 */
export function endTurn() {
    if (painting) {
        cancelAnimationFrame(painting);
        painting = 0;
    }

    waitStop();
    paintTurn();
    setActiveTurn(null);
}

/** Koľko znakov už v rozpracovanej bubline je — pre riadok stavu v hlavičke. */
export function turnChars() {
    return activeTurn()?.raw?.length ?? 0;
}

/* ---------------------------------------------------------------------------
   KARTY NÁSTROJOV
   --------------------------------------------------------------------------- */

/** Karta pre rámec `tool` — volanie, ktoré práve začalo. */
export function toolCard(frame) {
    const card = el('div', 'ct is-running');

    card.dataset.id = frame.id;
    if (frame.call_id) card.dataset.callId = frame.call_id;
    if (frame.write) card.classList.add('is-write');

    const head = el('button', 'ct-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');

    const mark = iconSvg(iconFor(frame.name), { cls: 'ct-icon' });
    mark.setAttribute('aria-hidden', 'true');

    head.append(el('span', 'ct-caret'));
    head.append(mark);
    head.append(el('span', 'ct-name', frame.name || 'nástroj'));
    head.append(el('span', 'ct-args', argsSummary(frame.arguments)));
    head.append(el('span', 'ct-state', 'beží…'));

    head.addEventListener('click', () => toggleBody(card));

    card.append(head, el('div', 'ct-body hidden'));

    return card;
}

/**
 * Doplní výsledok do už nakreslenej karty (rámec `tool_result`).
 *
 * `name` podáva volajúci z rámca `tool` — klient behu si mená drží sám, takže sa
 * meno nemusí dohľadávať v DOM podľa `data-id`.
 */
export function markResult(frame, name) {
    const call = {
        status: frame.status,
        result: frame.result,
        error: frame.error,
        duration_ms: frame.duration_ms,
    };

    const box = host() || document;
    const card = box.querySelector(`.ct[data-id="${frame.id}"]`);

    if (card) {
        fillResult(card, call);

        return card;
    }

    // Povolený (aj zamietnutý) zápis prichádza pod tým istým id, aké nesie karta
    // brány — rámec `tool` pre neho NIKDY nepríde, lebo namiesto neho prišlo
    // `permission`. Bez tejto vetvy sa výsledok jediného kroku, na ktorý človek
    // naozaj klikol, ticho zahodí.
    const gate = box.querySelector(`.cg[data-id="${frame.id}"]`);

    if (gate) {
        const made = toolCard({
            id: frame.id,
            name: gate.dataset.name,
            arguments: gate.hadesArgs,
            write: true,
        });

        gate.after(made);
        fillResult(made, call);

        return made;
    }

    // Ani karta, ani brána: rámec `tool` k tomuto id neprišiel (napr. pri
    // vypnutej bráne). Výsledok sa vykreslí aj tak — bez mena nástroja je horší
    // než s ním, ale ticho zahodený je najhorší.
    const orphan = appendBlock(toolCard({
        id: frame.id,
        name: name || frame.name || 'nástroj',
        arguments: frame.arguments,
    }));

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
        write: call.status === 'pending' || isWriteTool(call.name),
    });

    if (call.status === 'pending') {
        card.classList.remove('is-running');
        card.classList.add('is-waiting');
        card.querySelector('.ct-state').textContent = 'čaká na rozhodnutie';

        return card;
    }

    // `running` v histórii znamená, že beh niekto zrezal uprostred (Stop, spadnutý
    // server). Nikto ho už nedokončí, takže sa nesmie tváriť ako bežiaci —
    // pulzujúce „beží…" nad mŕtvym volaním je lož.
    if (call.status === 'running') {
        card.classList.remove('is-running');
        card.classList.add('is-denied');
        card.querySelector('.ct-state').textContent = 'beh prerušený';

        return card;
    }

    fillResult(card, call);

    return card;
}

/* Stav volania má DVA slovníky: drôtový protokol posiela `status: "done"` /
   `"error"`, ale enum v `console_tool_calls` pozná `failed` (a `running`). Karta
   musí čítať oba, inak by zlyhaný nástroj z histórie vyzeral ako úspešný. */
function normalizeStatus(status) {
    return status === 'failed' ? 'error' : (status || 'done');
}

function fillResult(card, call) {
    const status = normalizeStatus(call.status);
    const state = card.querySelector('.ct-state');
    const body = card.querySelector('.ct-body');
    const head = card.querySelector('.ct-head');

    card.classList.remove('is-running', 'is-waiting');
    card.classList.add(`is-${status}`);

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

    const pre = el('pre', 'ct-result');

    if (looksLikeDiff(text)) {
        pre.classList.add('diff');
        pre.innerHTML = diffHtml(text);
    } else {
        pre.textContent = text;
    }

    // Zbaliť sa musí podľa toho, čo výsledok zaberie NA OBRAZOVKE, nie podľa
    // počtu riadkov v texte: `mind_recall` vracia celú odpoveď ako JEDEN dlhý
    // riadok JSON — logicky dva riadky, teda pod prahom, ale zalomený vyplní
    // celý viewport a odpoveď modelu vytlačí mimo obraz. Prah v znakoch je odhad
    // na šesť riadkov monospace.
    const long = lines.length > PEEK_LINES || String(text).length > PEEK_LINES * 90;

    if (long) pre.classList.add('clamped');
    body.append(pre);

    if (long) {
        const more = el('button', 'ct-more', 'rozbaliť');
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
    body.classList.remove('hidden');
    head.setAttribute('aria-expanded', 'true');
    scrollIfFollowing();
}

function toggleBody(card) {
    const body = card.querySelector('.ct-body');
    const head = card.querySelector('.ct-head');

    if (!body.children.length) return;

    const hidden = body.classList.toggle('hidden');
    head.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    scrollIfFollowing();
}

/* ---------------------------------------------------------------------------
   DVOJFÁZOVÁ BRÁNA ZÁPISOV

   Srdce appky: zápis sa nestane, kým človek neklikne. Rozhodnutie sa odtiaľto
   NEPOSIELA — karta vypustí `chat:decide` a `run.js` ho odchytí. Keby si render
   volal run a run render, mali by cyklus, ktorý pri prvom `import` spadne na
   neinicializovaný modul.
   --------------------------------------------------------------------------- */

/**
 * Karta brány. `thread` je vlákno, na ktoré rozhodnutie patrí — pri zápise
 * PODAGENTA je to jeho vlastné vlákno, nie to, ktoré má klient otvorené. Nesie
 * ho karta a nie iba stav behu, aby sa rozhodnutie nedalo poslať inam len preto,
 * že medzitým prišiel ďalší rámec.
 */
export function permissionCard(frame, thread) {
    const card = el('div', 'cg');

    card.dataset.id = frame.id;
    card.dataset.name = frame.name || '';
    if (thread) card.dataset.thread = thread;

    // Argumenty a náhľad žijú ako vlastnosti elementu, nie v `data-` atribúte:
    // výsledok zápisu si z nich neskôr poskladá kartu, ale v DOM by to bol celý
    // JSON navyše pri každom potvrdení.
    card.hadesArgs = frame.arguments;
    card.hadesPreview = frame.preview;

    card.tabIndex = -1;
    card.setAttribute('role', 'group');
    // Prístupné meno hovorí, ČO a KAM sa zapíše — nie technické meno nástroja
    // („mind_learn"), ktoré čítačke o obsahu rozhodnutia nepovie nič.
    card.setAttribute('aria-label', `${writeTarget(frame.name, frame.arguments, frame.preview)} — čaká na povolenie`);

    const head = el('div', 'cg-head');
    const mark = iconSvg(iconFor(frame.name), { cls: 'cg-icon' });
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark);
    head.append(el('strong', 'cg-name', frame.name || 'nástroj'));
    head.append(el('span', 'cg-args', argsSummary(frame.arguments)));
    card.append(head);

    card.append(el('p', 'cg-ask', thread && agentThreadRun(thread)
        ? 'Toto chce zapísať podagent. Pustím ho?'
        : 'Toto je zápis. Pustím ho?'));

    card.append(previewBox(frame));

    const actions = el('div', 'cg-actions');

    /* „Povoliť vždy" NEDOSTANE karta podagenta. `decision=allow_always` nastaví
       `auto_accept` na vlákne, ktorému rozhodnutie patrí — a pri podagentovi je to
       JEHO vlákno, takže od tej chvíle by šli všetky ďalšie zápisy toho podbehu bez
       pýtania a bez diffu (profil `files` znamená `write_file`/`edit_file` kdekoľvek
       pod `files_root`, až po strop krokov).

       Presne tomu sa `Subagent::start()` vyhýba tým, že `auto_accept` zámerne
       NEDEDÍ z rodiča: zadanie podagenta nepísal človek, ale model. Ponúknuť tu
       blanket grant by tú obranu zrušilo z druhej strany. Navyše „vždy" čítá človek
       vo význame, aký má na konzole — „moja konverzácia" — nie „každý ďalší zápis
       úlohy, ktorú vymyslel model". */
    const forSubagent = !!(thread && agentThreadRun(thread));

    [
        // Varianty sa menujú tak, ako ich definuje `mind.css` (`button.primary` /
        // `.ghost` / `.danger`) — najdôležitejší ovládač appky nesmie mať vzhľad
        // neutrálneho tlačidla.
        ['allow', 'Povoliť', 'Enter', 'primary'],
        ['allow_always', 'Povoliť vždy', '', 'ghost'],
        ['deny', 'Zamietnuť', 'Esc', 'danger'],
    ].filter(([decision]) => !(forSubagent && decision === 'allow_always')).forEach(([decision, label, key, cls]) => {
        const btn = el('button', `cg-btn ${cls}`);
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
    // nemusí byť pripojený, keď kartu skladá obnova vlákna.
    requestAnimationFrame(() => {
        if (card.isConnected && !card.classList.contains('is-decided')) card.focus();
    });

    return card;
}

/** Náhľad zmeny: unified diff, alebo before/after, alebo aspoň argumenty. */
function previewBox(frame) {
    const preview = String(frame.preview ?? '');
    const box = el('pre', 'cg-preview');

    if (preview.trim() !== '') {
        if (looksLikeDiff(preview)) {
            box.classList.add('diff');
            box.innerHTML = diffHtml(preview);
        } else {
            box.textContent = preview;
        }

        return box;
    }

    // Náhľad chýba (nástroj ho nevie zložiť). Argumenty sú horší, ale pravdivý
    // podklad pre rozhodnutie — prázdna karta by nútila povoliť naslepo.
    box.textContent = frame.arguments ? JSON.stringify(frame.arguments, null, 2) : 'Náhľad zmeny nie je k dispozícii.';

    return box;
}

function decide(card, decision) {
    if (card.classList.contains('is-decided')) return;

    // Fokus je v tejto chvíli na tlačidle vnútri `.cg-actions`, ktoré o riadok
    // nižšie zaniká — bez zásahu by spadol na <body> a klávesnica by začínala od
    // začiatku stránky. Vracia sa len ak tu naozaj bol: globálny Esc rozhoduje aj
    // spoza composera a tomu fokus brať netreba. (Nález P3.)
    const hadFocus = card.contains(document.activeElement);

    card.classList.add('is-decided');
    card.classList.add(decision === 'deny' ? 'is-denied' : 'is-allowed');
    card.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });

    card.querySelector('.cg-actions').replaceWith(el('p', 'cg-done', decisionLabel(decision) || decision));

    if (hadFocus) card.focus();

    // Výsledok rozhodnutia nesmie zostať nedopovedaný a hovorí ĽUDSKY, čo sa
    // (ne)zapísalo — nie meno nástroja. Ide do `live()` (stav plochy); ako sa
    // skončí BEH, povie `announce()` jednou vetou a druhýkrát sa to nepíše.
    live(`${decisionLabel(decision) || decision}. ${writeTarget(card.dataset.name, card.hadesArgs, card.hadesPreview)}.`);

    document.dispatchEvent(new CustomEvent('chat:decide', {
        detail: {
            id: Number(card.dataset.id),
            decision,
            thread: card.dataset.thread || null,
        },
    }));
}

/** Karta, ktorá ešte čaká — používa ju globálny Esc aj kontrola pred odoslaním. */
export function pendingCard() {
    return document.querySelector('.cg:not(.is-decided)');
}

/** Rozhodne za čakajúcu kartu (globálny Esc mimo karty). */
export function decidePending(decision) {
    const card = pendingCard();
    if (!card) return false;

    decide(card, decision);

    return true;
}

/** Sústredí pozornosť na čakajúcu kartu (odoslanie počas zaparkovaného zápisu). */
export function focusPending() {
    pendingCard()?.focus();
}

/* ---------------------------------------------------------------------------
   PODAGENT

   Rámce dieťaťa prichádzajú zabalené (`{t:'agent', run, frame}`), takže sa
   kreslia do vnoreného rámca a NIE do koreňa toku: bez toho by kroky podagenta
   vyzerali ako kroky rodiča a človek by nevedel, komu povoľuje zápis.
   --------------------------------------------------------------------------- */

/** Ktorý beh podagenta má toto vlákno? (Pre vetu na karte brány.) */
function agentThreadRun(thread) {
    for (const [run, uuid] of agentThreads) {
        if (uuid === thread) return run;
    }

    return null;
}

/** Vlákno podagenta podľa uuid jeho behu — `/decide` sa posiela naň. */
export function agentThreadOf(run) {
    return agentThreads.get(String(run || '')) || null;
}

/**
 * Otvorí rámec podagenta (rámec `agent_start`).
 *
 * Hĺbka je presne 1 (`orchestrator` nie je medzi profilmi dieťaťa), takže
 * vnorený podagent nevzniká a jeden otvorený rámec naraz stačí. Keby sa niekedy
 * vnorenie povolilo, toto je miesto, ktoré potrebuje zásobník.
 */
export function openAgent(frame) {
    closeAgentBox();

    if (frame.thread) agentThreads.set(String(frame.run), String(frame.thread));

    const box = el('section', 'cn');
    box.dataset.run = frame.run || '';

    const head = el('div', 'cn-head');
    const mark = iconSvg('hub', { cls: 'cn-icon' });
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark);
    head.append(el('strong', 'cn-title', 'Podagent'));

    const bits = [];
    if (frame.profile) bits.push(`profil ${frame.profile}`);
    // Slovenčina má tri tvary, nie dva: „strop 6 kroky" bolo zle pri každom
    // strope okrem 2–4. Trojtvarový `plural()` je v `threads.js` a je zdieľaný —
    // štvrtá privátna kópia by sa raz rozišla.
    if (frame.max_steps) bits.push(`strop ${frame.max_steps} ${plural3(frame.max_steps, 'krok', 'kroky', 'krokov')}`);
    if (bits.length) head.append(el('span', 'cn-meta', bits.join(' · ')));

    box.append(head);
    if (frame.task) box.append(el('p', 'cn-task', frame.task));

    const body = el('div', 'cn-body');
    box.append(body);

    // Rámec ide do toku RODIČA, teda pred nastavením `agent` — inak by sa
    // vnoril do seba.
    appendBlock(box);

    agent = { run: String(frame.run || ''), box, body, turn: null };

    return box;
}

/**
 * Rámec podagenta existuje, aj keď `agent_start` neprišiel.
 *
 * Prečo to treba: keď dieťa zaparkuje na zápise, ťah skončí a obnova ide cez
 * `POST /api/console/decide` na vlákno podagenta. V tom prúde prídu jeho ďalšie
 * rámce zabalené, ale `agent_start` už nie — vznikol v predošlom requeste. Bez
 * tejto vetvy by dopoveď dieťaťa tiekla do toku rodiča.
 */
export function ensureAgent(run) {
    const key = String(run || '');

    if (agent && agent.run === key) return agent.box;

    return openAgent({ run: key, thread: agentThreads.get(key) || null });
}

/** Uzavrie rámec podagenta a doplní jeho cenu (rámec `agent_end`). */
export function closeAgent(frame) {
    ensureAgent(frame.run);

    const bits = [];

    if (frame.steps) bits.push(`${num(frame.steps, 0)} ${plural3(frame.steps, 'krok', 'kroky', 'krokov')}`);
    if (frame.tool_calls) bits.push(`${num(frame.tool_calls, 0)} nástrojov`);

    const cost = costLabel({ tokens_in: frame.tokens_in, tokens_out: frame.tokens_out }, num);
    if (cost !== '') bits.push(cost);

    // Stav sa hlási len keď NIE JE `done`: „hotovo" je normálny konec a nemá čo
    // dodať, kým `aborted`/`failed` je informácia, ktorá inak vypadne.
    if (frame.status && frame.status !== 'done') bits.push(`stav ${frame.status}`);

    const box = agent?.box;

    if (box) {
        box.classList.add('is-closed');
        box.append(el('p', 'cn-foot', bits.length ? bits.join(' · ') : 'Podagent dokončil.'));
    }

    closeAgentBox();
}

/**
 * Podagent zaparkoval na zápise (rámec `agent_wait`) — ťah rodiča tu KONČÍ, bez
 * rámca `end`. Rámec podagenta zostáva otvorený až po rozhodnutí: dopoveď dieťaťa
 * príde v tom istom rámci, nie pod ním.
 */
export function markAgentWait(frame) {
    if (frame.thread) agentThreads.set(String(frame.run), String(frame.thread));

    ensureAgent(frame.run);
    closeBubble();

    if (agent?.box) agent.box.classList.add('is-waiting');
}

/** Zavrie kreslenie do rámca podagenta; samotný rámec zostáva v toku. */
function closeAgentBox() {
    if (!agent) return;

    endTurn();
    agent = null;
}

/* ---------------------------------------------------------------------------
   PORADIE ZADANÍ (front v `runclient.js`)

   Zaradená správa musí byť VIDITEĽNÁ a ZRUŠITEĽNÁ. Poradie stojí pri composeri
   a nie v toku: v toku by odskrolovalo z dohľadu presne vtedy, keď model píše —
   teda keď ho človek potrebuje vidieť.
   --------------------------------------------------------------------------- */

export function renderQueue(items, held) {
    const list = queueList();
    if (!list) return;

    list.innerHTML = '';

    const rows = Array.isArray(items) ? items : [];

    list.hidden = rows.length === 0;
    if (rows.length === 0) return;

    rows.forEach((item, at) => {
        const row = el('li', 'cq-item');

        row.append(el('span', 'cq-pos', `${at + 1}.`));
        row.append(el('span', 'cq-text', item.body?.message ?? ''));
        row.append(el('span', 'cq-state', held ? 'čaká v poradí' : 'odchádza…'));

        const drop = el('button', 'cq-cancel ghost', 'Zrušiť');
        drop.type = 'button';
        drop.setAttribute('aria-label', `Zrušiť ${at + 1}. správu v poradí`);
        drop.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('chat:queue-cancel', { detail: { id: item.id } }));
        });

        row.append(drop);
        list.append(row);
    });
}

/* Zoznam vzniká pri prvej zaradenej správe a žije v composeri — plocha bez
   frontu tak nemá v DOM ani prázdny `<ul>`. */
function queueList() {
    const form = document.getElementById('chat-composer');
    if (!form) return null;

    let list = document.getElementById('chat-queue');

    if (!list) {
        list = el('ul', 'cq');
        list.id = 'chat-queue';
        list.hidden = true;
        list.setAttribute('aria-label', 'Správy v poradí');
        form.prepend(list);
    }

    return list;
}

/* ---------------------------------------------------------------------------
   COMPOSER A STAV BEHU
   --------------------------------------------------------------------------- */

/** Vyprázdni pole správy a vráti mu jednoriadkovú výšku. */
export function clearPrompt() {
    const prompt = document.getElementById('chat-prompt');
    if (!prompt) return;

    prompt.value = '';
    prompt.style.height = 'auto';
}

export function focusPrompt() {
    document.getElementById('chat-prompt')?.focus();
}

/**
 * Beh je ZAPARKOVANÝ na rozhodnutí človeka.
 *
 * Poslať sa ZÁMERNE nevypína. Napísaná správa sa zaradí do poradia a odíde až po
 * rozhodnutí — to drží front v `runclient.js` (`state.awaiting` ho zastaví), nie
 * vypnuté tlačidlo. Vypnutím by človek stratil aj možnosť napísať si ďalší krok
 * dopredu, čo je pri modeli na ~8 tok/s to najprirodzenejšie, čo počas čakania
 * robí. Trieda je len signál pre kresbu; brána je inde.
 */
export function setParked(parked) {
    document.getElementById('chat-composer')?.classList.toggle('is-parked', !!parked);
}

/* ---------------------------------------------------------------------------
   OBNOVA VLÁKNA

   História je v DB a je jediný zdroj pravdy: obnovené vlákno musí vyzerať presne
   ako to, ktoré človek videl pred obnovou stránky. localStorage sa tu nečíta ani
   nezapisuje — klient, ktorý si históriu pamätá sám, si vie podstrčiť výsledok
   toolu, ktorý nikdy nenastal.
   --------------------------------------------------------------------------- */

export function renderThread(data) {
    const stream = streamHost();
    if (!stream) return;

    restoring++;
    try {
        renderThreadBody(data);
    } finally {
        restoring--;
    }

    scrollToBottom();
}

function renderThreadBody(data) {
    resetStream();

    const calls = Array.isArray(data.tool_calls) ? data.tool_calls : [];
    const awaiting = calls.find((call) => call.id === data.awaiting) || null;
    const byMessage = new Map();

    calls.forEach((call) => {
        // Zaparkovaný zápis dostane KARTU BRÁNY, nie kartu nástroja. Bez tejto
        // výnimky sa kreslí dvakrát: raz ako „čaká na rozhodnutie" a hneď pod ním
        // ako brána s tlačidlami, čo vyzerá ako dva čakajúce zápisy.
        if (awaiting && call.id === awaiting.id && isWriteTool(call.name)) return;

        const key = call.message_id ?? 0;
        if (!byMessage.has(key)) byMessage.set(key, []);
        byMessage.get(key).push(call);
    });

    // Log behov tohto vlákna. Beh sa v toku ohlási na svojej POSLEDNEJ správe —
    // vtedy je pod ním presne to, čoho sa hlásenie týka.
    const closers = new Map();

    (data.runs || []).forEach((run) => {
        const note = runNote(run);
        if (note !== '' && run.to_message_id) closers.set(run.to_message_id, note);
    });

    (data.messages || []).forEach((msg) => {
        if (msg.role === 'user') {
            pushUser(msg.content);
        } else if (msg.role === 'assistant' && (msg.content || '').trim() !== '') {
            // Ťah, ktorý bol len volaním nástroja, nemá text a prázdna bublina by
            // v toku vyzerala ako stratená odpoveď.
            pushAssistant(msg.content, msg);
        }
        // role 'tool' sa nekreslí ako bublina — výsledok sedí na karte volania.
        // role 'system' sem NEPRÍDE, server ju už neposiela.

        (byMessage.get(msg.id) || []).forEach((call) => appendBlock(historyCard(call)));
        byMessage.delete(msg.id);

        // Dôvod ukončenia až PO kartách nástrojov toho istého ťahu — inak by veta
        // „beh narazil na strop krokov" stála nad krokmi, ktoré urobil.
        const note = closers.get(msg.id);

        if (note) {
            pushNotice(note);
            closers.delete(msg.id);
        }
    });

    closers.forEach((note) => pushNotice(note));
    [...byMessage.values()].flat().forEach((call) => appendBlock(historyCard(call)));

    restoreAwaiting(awaiting, data.uuid, data.awaiting_agent);

    if (!hasBlocks()) showEmpty();
}

function hasBlocks() {
    const stream = streamHost();

    return !!stream && [...stream.children].some((node) => node !== emptyNode);
}

/**
 * Zaparkovaný zápis po obnove stránky.
 *
 * Dva prípady a rozdiel medzi nimi je vecný, nie kozmetický:
 *
 *  · zápisový tool → brána s náhľadom, presne ako za živého behu;
 *  · `spawn_agent` → karta rodiča sa NEKRESLÍ. Je to čítací tool a rozhodnutie oň
 *    nepatrí: `allow` na ňom podagenta znova zaparkuje (tool je idempotentný na
 *    svoj call) a `deny` jeho podbeh zruší. Na človeka čaká zápis PODAGENTA, na
 *    JEHO vlákne — a `awaiting` v payloade je `pendingToolCall()` TOHTO vlákna,
 *    teda `spawn_agent` call rodiča, s ktorým sa nedá urobiť nič.
 *
 *    Server to od 25. 8. 2026 dopĺňa aditívnym kľúčom `awaiting_agent` (tvar tool
 *    callu plus `thread` a `run` dieťaťa), takže karta sa kreslí NAD NÍM a
 *    `/decide` ide na vlákno dieťaťa. Keď ten kľúč chýba — starší payload alebo
 *    podbeh, ktorý sa medzitým dorozhodol — tok o tom aspoň nemlčí namiesto toho,
 *    aby predstieral rozhodnutie, ktoré by dopadlo inam.
 */
function restoreAwaiting(call, thread, parked) {
    if (!call) return;

    if (!isWriteTool(call.name)) {
        // Zaparkovaný zápis DIEŤAŤA: karta patrí jemu a na jeho vlákno.
        if (parked && parked.id != null && parked.thread) {
            appendBlock(permissionCard(parked, parked.thread));
            announce(writeAsk(parked));

            return;
        }

        pushNotice('Beh čaká na rozhodnutie o zápise podagenta. Otvor jeho podbeh na obrazovke Runy — '
            + 'v tomto vlákne sa o ňom rozhodnúť nedá.');
        announce('Beh čaká na rozhodnutie o zápise podagenta.');

        return;
    }

    appendBlock(permissionCard(call, thread));
    // Otvorené vlákno so zaparkovaným zápisom je to isté rozhodnutie ako za
    // živého behu, len prišlo po obnove stránky — a čítačka o ňom dovtedy
    // nedostala ani slovo.
    announce(`${writeTarget(call.name, call.arguments, call.preview)}. Enter povolí, Esc zamietne.`);
}

/**
 * Veta o tom, ako sa ťah skončil. Text NIE JE tu, ale v `../shared/runstate.js`:
 * tú istú vetu musí po obnove stránky povedať aj log behov, a dve kópie by sa
 * rozišli.
 */
export function noteStop(reason) {
    const note = stopNote(reason);
    if (note === '') return;

    // Bublina sa uzavrie sama až v dobehu; bez tohto by poznámka pristála
    // doprostred rozpísaného odseku modelu.
    closeBubble();
    pushNotice(note);
}
