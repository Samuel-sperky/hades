/* ===========================================================================
   Charón — kreslenie toku správ.

   Tok je PLOCHÝ zoznam blokov v poradí, v akom veci naozaj nastali:
   `.msg.user` → `.msg.assistant` → `.tool-call` → ďalšia `.msg.assistant` →
   `.perm-card`. Karta toolu preto zavrie rozpracovanú bublinu (C.turn.bubble =
   null) a text po nástroji začne novú. Keby všetok text ťahu tiekol do jednej
   bubliny, poradie by klamalo: odpoveď po grepe by stála PRED kartou grepu.

   render.js ↔ tools.js sa volajú navzájom (karta si žiada doskrolovanie, tok si
   žiada kartu). Preto sú tu všetky exporty hoistované `export function`.
   =========================================================================== */

import { C } from './state.js';
import { $, el, num } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { historyCard, permissionCard, writeAsk } from './tools.js';
import { costLabel, runNote } from './runstate.js';

/* Koľko pixelov nad spodkom sa ešte považuje za „stojím na spodku". Menej než
   riadok textu by follow vypínalo pri doskrolovaní o pol riadka. */
const FOLLOW_SLACK = 64;

export function streamEl() {
    return $('#stream');
}

/** Znak Hadesa — tá istá geometria ako favicon a rail (public/brand/hades-sigil-mini.svg).
    Prázdny stav je prvá plocha, ktorú človek v Charónovi vidí, a jediná, kde je
    miesto na značku; hlavička ju nesie len ako 24 px odkaz do grafu. */
function sigilMark() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'empty-sigil');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('class', 'bc-ring');
    ring.setAttribute('cx', '12'); ring.setAttribute('cy', '12'); ring.setAttribute('r', '8.64');
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'var(--accent)');
    ring.setAttribute('stroke-width', '2.16');
    const core = document.createElementNS(NS, 'circle');
    core.setAttribute('class', 'bc-core');
    core.setAttribute('cx', '12'); core.setAttribute('cy', '12'); core.setAttribute('r', '3.6');
    core.setAttribute('fill', 'var(--brand-gold)');
    svg.append(ring, core);
    return svg;
}

/** Prázdny stav — hovorí, ČO konzola vie. Je to prvá vec, ktorú človek vidí. */
export function renderEmpty() {
    const stream = streamEl();
    if (!stream) return;

    stream.innerHTML = '';
    waitNode = null;

    const box = el('div', 'empty-state');
    box.append(sigilMark());
    box.append(el('h2', null, 'Charón'));
    box.append(el('p', null,
        'Napíš úlohu. Charón vidí celú pamäť Hadesa aj súbory projektu — '
        + 'a čo chce zmeniť, ukáže dopredu.'));

    const list = el('ul', 'empty-can');

    [
        ['memory', 'Hľadá v pamäti — uzly, hrany, oblasti, rozhodnutia.'],
        ['search', 'Prehľadáva projekt cez ripgrep a číta súbory.'],
        ['edit', 'Zápisy do súborov aj do pamäte najprv ukáže ako diff a čaká na Povoliť.'],
        ['bolt', 'Príkazy: /recall, /read, /model, /tools, /cost, /clear, /new, /help.'],
    ].forEach(([icon, text]) => {
        const li = el('li');
        const mark = el('span', 'ms', icon);
        mark.setAttribute('aria-hidden', 'true');
        li.append(mark, el('span', null, text));
        list.append(li);
    });

    box.append(list);
    stream.append(box);
}

/** Skrolovanie: tok sleduje spodok, kým človek neodíde nahor. */
export function wireStream() {
    const stream = streamEl();
    if (!stream) return;

    // Rast obsahu skrolovaciu udalosť NEVYVOLÁ (mení sa scrollHeight, nie
    // scrollTop), takže sem sa dostane len skutočné skrolovanie človekom — a
    // follow sa nemá ako vypnúť samo pri prílete tokenu.
    stream.addEventListener('scroll', () => {
        C.follow = distanceFromBottom(stream) <= FOLLOW_SLACK;
        paintJump();
    }, { passive: true });

    $('#to-bottom')?.addEventListener('click', () => {
        C.follow = true;
        jumpToBottom();
        paintJump();
    });
}

export function distanceFromBottom(node) {
    return node.scrollHeight - node.scrollTop - node.clientHeight;
}

export function jumpToBottom() {
    const stream = streamEl();
    if (stream) stream.scrollTop = stream.scrollHeight;
}

/** Doskroluje LEN ak človek stojí na spodku. Inak by mu tok trhal čítanie. */
export function scrollIfFollowing() {
    if (C.follow) jumpToBottom();
    paintJump();
}

export function paintJump() {
    const btn = $('#to-bottom');
    const stream = streamEl();
    if (!btn || !stream) return;

    btn.classList.toggle('hidden', C.follow || distanceFromBottom(stream) < FOLLOW_SLACK);
}

/* Obnova vlákna pridáva desiatky blokov naraz. Keby každý dostal zrod, história
   by sa pri otvorení rozhýbala celá — pohyb má hlásiť „toto práve pribudlo",
   nie „toto tu je". Preto sa počas renderThread() zrod potlačí. */
let restoring = 0;

/* Bublina čakania na prvý token (viď `waitStart()` nižšie). Deklarácia stojí tu,
   nad `appendBlock()`, ktorý ju číta — moduly konzoly sú v cykle a `let` nie je
   hoistovaný. */
let waitNode = null;

/** Prvé pridanie po prázdnom stave musí prázdny stav odstrániť. */
function appendBlock(node) {
    const stream = streamEl();
    if (!stream) return node;

    stream.querySelector('.empty-state')?.remove();
    if (!restoring) node.classList.add('is-new');

    // Bublina čakania drží spodok toku: čokoľvek pribudne počas nej (karta
    // nástroja, hlásenie) ide PRED ňu, inak by sa signál „ešte sa pracuje"
    // ocitol uprostred histórie a pod ním by stálo ticho.
    if (waitNode?.isConnected) stream.insertBefore(node, waitNode);
    else stream.append(node);

    scrollIfFollowing();

    return node;
}

/* ---------- čakanie na prvý token ---------- */

/* Lokálny model beží na CPU (~8 tok/s) a prvý token môže prísť po 25 s. Jediný
   signál bol dovtedy `#run-stats` v pravom hornom rohu hlavičky — teda ďaleko od
   miesta, kam sa človek pozerá, keď čaká na odpoveď. Bublina stojí presne tam,
   kde odpoveď vzápätí pribudne, a zmizne s prvým znakom. */
export function waitStart() {
    const stream = streamEl();
    if (!stream || waitNode?.isConnected) return;

    stream.querySelector('.empty-state')?.remove();

    const box = el('div', 'msg assistant thinking');
    // Tok je `aria-live` oblasť; pulzujúce bodky nemajú čo hlásiť a `#run-announce`
    // hovorí za ne celou vetou.
    box.setAttribute('aria-hidden', 'true');

    const who = el('span', 'who');
    who.append(el('span', null, 'Charón'));

    const bubble = el('div', 'bubble');
    const dots = el('span', 'think-dots');
    for (let i = 0; i < 3; i++) dots.append(el('span', 'think-dot'));
    bubble.append(dots, el('span', 'think-note', 'Odpoveď sa pripravuje…'));

    box.append(who, bubble);
    stream.append(box);
    waitNode = box;
    scrollIfFollowing();
}

export function waitStop() {
    waitNode?.remove();
    waitNode = null;
}

/** Hotový blok (karta nástroja, potvrdenie) do toku — poradie je chronológia. */
export function pushBlock(node) {
    return appendBlock(node);
}

export function pushUser(text) {
    const box = el('div', 'msg user');
    box.append(el('span', 'who', 'Ty'));
    box.append(el('div', 'bubble', text));

    return appendBlock(box);
}

/** Hotová odpoveď (obnova histórie) — markdown naraz, bez streamovania. */
export function pushAssistant(text, meta = {}) {
    const box = assistantShell(meta);
    box.querySelector('.bubble').innerHTML = renderMarkdown(text ?? '');

    return appendBlock(box);
}

export function pushSystem(title, html) {
    const box = el('div', 'msg system');
    box.append(el('span', 'who', title));
    const bubble = el('div', 'bubble');
    // HTML je náš vlastný (pomoc, hlásenia okruhu), nikdy nie výstup modelu.
    bubble.innerHTML = html;
    box.append(bubble);

    return appendBlock(box);
}

export function pushNotice(text) {
    const box = el('div', 'msg system');
    box.append(el('span', 'who', 'Charón'));
    box.append(el('div', 'bubble', text));

    return appendBlock(box);
}

export function pushError(text) {
    const box = el('div', 'msg error');
    const who = el('span', 'who');
    const mark = el('span', 'ms', 'error');
    mark.setAttribute('aria-hidden', 'true');
    who.append(mark, el('span', null, 'Chyba'));
    box.append(who);
    box.append(el('div', 'bubble', text));

    return appendBlock(box);
}

function assistantShell(meta = {}) {
    const box = el('div', 'msg assistant');
    const mid = meta.id ?? meta.message_id;
    if (mid) box.dataset.mid = mid;

    const who = el('span', 'who');
    who.append(el('span', null, 'Charón'));
    if (meta.model) who.append(el('span', 'who-model', meta.model));

    // Cena odpovede zostáva PRI ODPOVEDI. `#run-stats` v hlavičke ju drží len
    // do ďalšieho ťahu a po obnove stránky bola prázdna, takže sa hodinu stará
    // odpoveď nedala oceniť vôbec — hoci `console_messages` tie čísla nesie.
    const cost = costLabel({
        tokens_out: meta.tokens_out,
        tokens_per_second: meta.tokens_per_second,
    }, num);

    if (cost !== '') who.append(el('span', 'who-cost', cost));

    box.append(who);
    box.append(el('div', 'bubble md'));

    return box;
}

/* ---------- streamovaná odpoveď ---------- */

/** Otvorí ťah. Bublina vznikne až s prvým textom — nástroj môže prísť skôr. */
export function beginTurn(meta = {}) {
    C.turn = {
        raw: '',
        bubble: null,
        mid: meta.message_id ?? null,
        model: meta.model || '',
        head: false,
    };

    // Kým sa odpoveď skladá, čítačka nemá čo hlásiť: bez aria-busy by predčítala
    // každý prílet tokenu, teda pri 9 tok/s deväťkrát za sekundu.
    streamEl()?.setAttribute('aria-busy', 'true');

    // Ticho medzi `start` a prvým tokenom je na tomto stroji desiatky sekúnd —
    // od tejto chvíle je vidieť, že sa niečo deje.
    waitStart();
}

export function appendDelta(text) {
    if (!C.turn) beginTurn({});

    // Prvý znak je koniec čakania. Až tu, nie pri `start`: rámec `start` prichádza
    // okamžite, kým model ešte ani nezačal generovať.
    waitStop();

    if (!C.turn.bubble) {
        const box = appendBlock(assistantShell({
            message_id: C.turn.mid,
            model: C.turn.head ? '' : C.turn.model,
        }));
        C.turn.head = true;
        C.turn.bubble = box.querySelector('.bubble');
        C.turn.raw = '';
    }

    C.turn.raw += String(text ?? '');
    schedulePaint();
}

let painting = 0;

/* Markdown sa prekresľuje raz za rámec, nie raz za token: pri 9 tok/s je to to
   isté číslo, ale pri dobehnutí zabufferovaného prúdu by jeden chunk inak
   vyvolal stovky prekreslení. Celá bublina naraz a nie prírastkovo preto, že
   markdown prírastkový NIE JE — dve odrážky, ktoré prídu po sebe, patria do
   jedného <ul>. Cena je, že prekreslenie zruší označenie textu v bubline; pri
   dopísanej odpovedi sa už neprekresľuje, takže sa dá kopírovať. */
function schedulePaint() {
    if (painting) return;

    painting = requestAnimationFrame(() => {
        painting = 0;
        paintTurn();
    });
}

function paintTurn() {
    if (!C.turn?.bubble) return;

    C.turn.bubble.innerHTML = renderMarkdown(C.turn.raw);
    scrollIfFollowing();
}

/** Zatvorí bublinu ťahu — text po nástroji začne novú. */
export function closeBubble() {
    if (!C.turn) return;

    paintTurn();
    C.turn.bubble = null;
    C.turn.raw = '';
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

    // Ťah sa skončil (aj zaparkovaním na povolení) — čakať už nie je na čo.
    waitStop();
    paintTurn();
    streamEl()?.setAttribute('aria-busy', 'false');
    C.turn = null;
}

/* ---------- obnova celého vlákna ---------- */

/**
 * Prekreslí vlákno z payloadu ThreadControllera — vrátane kariet toolov a
 * čakajúceho potvrdenia. História v DB je jediný zdroj pravdy, takže obnovené
 * vlákno musí vyzerať presne ako to, ktoré človek videl pred obnovou stránky.
 */
export function renderThread(data) {
    const stream = streamEl();
    if (!stream) return;

    restoring++;
    try {
        renderThreadBody(stream, data);
    } finally {
        restoring--;
    }
}

function renderThreadBody(stream, data) {
    stream.innerHTML = '';
    waitNode = null;
    C.turn = null;
    C.awaiting = null;
    stream.setAttribute('aria-busy', 'false');

    const byMessage = new Map();

    (data.tool_calls || []).forEach((call) => {
        // Zaparkovaný zápis dostane KARTU POTVRDENIA, nie kartu nástroja. Bez tejto
        // výnimky sa kreslil dvakrát: raz ako „čaká na rozhodnutie" a hneď pod ním
        // ako prompt s tlačidlami, čo vyzeralo ako dva čakajúce zápisy.
        if (data.awaiting && call.id === data.awaiting) return;

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
        } else if (msg.role === 'assistant') {
            // Ťah, ktorý bol len volaním nástroja, nemá text a prázdna bublina
            // by v toku vyzerala ako stratená odpoveď.
            if ((msg.content || '').trim() !== '') pushAssistant(msg.content, msg);
        }
        // role 'tool' sa nekreslí ako bublina — výsledok sedí na karte volania.
        // role 'system' sem NEPRÍDE: `ThreadController::payload()` ju už
        // neposiela. Bola to konfigurácia behu, nie krok konverzácie, a tok ju
        // vypisoval ako 1 370-znakovú bublinu Charóna.

        (byMessage.get(msg.id) || []).forEach((call) => appendBlock(historyCard(call)));
        byMessage.delete(msg.id);

        // Dôvod ukončenia až PO kartách nástrojov toho istého ťahu — inak by
        // veta „beh narazil na strop krokov" stála nad krokmi, ktoré urobil.
        const note = closers.get(msg.id);
        if (note) {
            pushNotice(note);
            closers.delete(msg.id);
        }
    });

    // Beh, ktorého poslednú správu tok nevykreslil (ťah bez textu, zmazaná
    // správa) — hlásenie sa nesmie stratiť, patrí na koniec.
    closers.forEach((note) => pushNotice(note));

    // Volania bez správy (zaparkovaný zápis pred zápisom hlavičky) idú na konec.
    [...byMessage.values()].flat().forEach((call) => appendBlock(historyCard(call)));

    if (data.awaiting) {
        const pending = (data.tool_calls || []).find((call) => call.id === data.awaiting);

        if (pending) {
            appendBlock(permissionCard(pending));
            // Otvorené vlákno so zaparkovaným zápisom je to isté rozhodnutie ako
            // za živého behu, len prišlo po obnove stránky — a čítačka o ňom
            // dovtedy nedostala ani slovo.
            announce(writeAsk(pending));
        }
    }

    // Hlavička po obnove hovorí cenu POSLEDNÉHO ZAZNAMENANÉHO behu, nie nulu.
    // Číslo sa neprepočítava z bublín — berie sa z logu behov, ktorý je preň
    // jediný zdroj (`runs`, agregované v RunRecorder::aggregate()).
    C.stats = lastRunCost(data.runs);
    C.step = null;

    if (!stream.children.length) renderEmpty();

    C.follow = true;
    jumpToBottom();
    paintJump();
}

/** /clear — vyčistí ZOBRAZENIE. História vlákna v DB zostáva nedotknutá. */
export function clearView() {
    renderEmpty();
    pushNotice('Zobrazenie je vyčistené. História vlákna zostáva v pamäti — obnov stránku a je späť.');
}

/**
 * Cena posledného behu, ktorý v logu naozaj niečo stál. Ide sa od konca, nie od
 * `runs.at(-1)`: posledný riadok môže byť práve založený beh bez tokenov a
 * hlavička by po obnove stránky zhasla, hoci predchádzajúci ťah cenu má.
 */
function lastRunCost(runs) {
    const list = Array.isArray(runs) ? runs : [];

    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.tokens_out) return list[i];
    }

    return null;
}

/** Riadok stavu behu. Pri 9 tok/s je pohyb v ňom jediný dôkaz, že sa niečo deje. */
export function paintStats() {
    const out = $('#run-stats');
    if (!out) return;

    const bits = [];

    if (C.awaiting) bits.push('čaká na rozhodnutie');
    else if (C.running) bits.push(`${Math.max(0, Math.round((Date.now() - C.t0) / 1000))} s`);

    if (C.step) bits.push(`krok ${C.step.n}/${C.step.of}`);
    if (C.running && C.turn?.raw) bits.push(`${num(C.turn.raw.length, 0)} znakov`);

    // Cena sa skládá tým istým `costLabel()` ako bublina odpovede — hlavička
    // a tok nesmú hovoriť to isté číslo dvoma tvarmi.
    if (!C.running) {
        const cost = costLabel(C.stats, num);
        if (cost !== '') bits.push(cost);
    }

    out.textContent = bits.join(' · ');
}

/** Jedno hlásenie pre čítačku, keď je ťah hotový — nie tikanie každú sekundu. */
export function announce(text) {
    const live = $('#run-announce');
    if (live) live.textContent = text;
}
