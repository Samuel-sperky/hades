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
import { renderMarkdown } from '../shared/markdown.js';
import { writeAsk } from '../shared/gate.js';
import { equipCopy as sharedEquipCopy } from '../shared/copy.js';
import { costLabel, runNote } from '../shared/runstate.js';
import { historyCard, permissionCard } from './tools.js';

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
    answerText.set(box, String(text ?? ''));
    // Tlačidlá PRED vložením do toku: `#stream` je `aria-live` s
    // `aria-relevant="additions"`, takže tlačidlo pridané do už vloženej
    // bubliny by čítačka ohlásila ako nový obsah.
    equipCopy(box);

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

/* ---------- kopírovanie odpovede a kódu ---------- */

/* Do schránky patrí SUROVÝ markdown, nie vykreslený text: odpoveď sa lepí do
   zadania pre iného agenta a z `innerText` by z odrážok, nadpisov a blokov kódu
   zostali holé riadky. Drží sa mimo DOM (WeakMap, nie `dataset`) — celá odpoveď
   v atribúte sú kilobajty v strome a druhá kópia tej istej pravdy. */
const answerText = new WeakMap();

/**
 * Hotová odpoveď dostane tlačidlá: jedno na celú odpoveď, jedno na každý blok
 * kódu. Idempotentné — bublinu môže spečatiť aj `closeBubble()`, aj `endTurn()`.
 *
 * MECHANIKA ŽIJE V `shared/copy.js` (tlačidlo, potvrdenie na 1 600 ms, záložná
 * cesta bez `navigator.clipboard`, hlavička bloku kódu s `data-lang`). Do
 * 25. 8. 2026 tu stála druhá kópia toho istého kusu, ktorý má aj `/chat` — a
 * dve kópie jedného obsahu sú presne to, na čom sa plochy tejto appky už raz
 * rozišli. Popisok zostáva TEXT, nie ikona: `content_copy` v subsete Material
 * Symbols overený nie je a nevykreslená ligatúra by sa ukázala ako slovo.
 *
 * Zdieľaný modul o konzole nevie (je to list grafu), takže mu tu podávame dve
 * veci, ktoré sa medzi plochami líšia:
 *   · `announce` — konzola hlási do `#run-announce`,
 *   · `paint` NEDOSTÁVA, pretože konzola bloky kódu nezvýrazňuje; blok zostáva
 *     čistým textom tak, ako ho zložil `renderMarkdown`.
 */
function equipCopy(box) {
    sharedEquipCopy(box, () => answerText.get(box), announce);
}

/* Dopísaná bublina ťahu. Až tu, nie pri vzniku: počas streamu sa bublina
   prekresľuje raz za rámec, takže tlačidlo by kopírovalo polovicu odpovede a
   `equipCode()` v `shared/copy.js` by obaľovalo blok kódu, ktorý ešte nemá
   koniec. */
function sealBubble() {
    const bubble = C.turn?.bubble;

    if (!bubble) return;

    const box = bubble.closest('.msg.assistant');

    if (!box) return;

    answerText.set(box, C.turn.raw);
    equipCopy(box);
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
    sealBubble();
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
    // Ešte za `aria-busy="true"`, teda kým čítačka tok nesleduje — tlačidlo
    // Kopírovať nie je nový obsah odpovede.
    sealBubble();
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
        // Zaparkovaný ZÁPIS dostane KARTU POTVRDENIA, nie kartu nástroja. Bez tejto
        // výnimky sa kreslil dvakrát: raz ako „čaká na rozhodnutie" a hneď pod ním
        // ako prompt s tlačidlami, čo vyzeralo ako dva čakajúce zápisy.
        //
        // Zaparkovaný ČÍTACÍ tool (`spawn_agent`) kartu nástroja naopak DOSTANE:
        // brána sa preň nekreslí (`restoreAwaiting()` nižšie), takže bez nej by
        // z toku zmizol krok, ktorý beh práve drží.
        if (data.awaiting && call.id === data.awaiting && isWriteTool(call.name)) return;

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

        if (pending) restoreAwaiting(pending, data.awaiting_agent);
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

/**
 * Zaparkované rozhodnutie po obnove stránky.
 *
 * Dva prípady a rozdiel medzi nimi je vecný, nie kozmetický:
 *
 *  · zápisový tool → karta brány s náhľadom, presne ako za živého behu;
 *  · čítací tool (v praxi `spawn_agent`) → BRÁNA sa nad ním NEKRESLÍ (kartu nástroja
 *    dostane, viď filter v `renderThreadBody()`). Do 26. 8. 2026 sa brána kreslila
 *    a bola to lož v troch smeroch naraz: `announce(writeAsk(pending))` ohlásil
 *    čítací tool ako zápis, „Povoliť vždy" na nej by `allow_always` poslalo na
 *    vlákno RODIČA a vypnulo bránu zápisov celej konverzácie, a „Povoliť" by
 *    `spawn_agent` (idempotentný na svoj `ConsoleToolCall`) len znova zaparkovalo.
 *    Na človeka čaká zápis PODAGENTA, na JEHO vlákne — `awaiting` v payloade je
 *    `pendingToolCall()` tohto vlákna, teda `spawn_agent` call rodiča.
 *
 *    Odkiaľ sa berie to správne vlákno: server od 25. 8. 2026 posiela aditívny kľúč
 *    `awaiting_agent` (tvar tool callu plus `thread` a `run` dieťaťa), takže karta sa
 *    kreslí NAD NÍM a `/decide` ide na vlákno dieťaťa. Keď kľúč chýba — starší
 *    payload alebo podbeh, ktorý sa medzitým dorozhodol — tok o tom povie vetu.
 *    Predstierať rozhodnutie, ktoré by dopadlo inam, je horšie než ho nemať.
 *
 * Vzor je `public/js/chat/render.js`, funkcia `restoreAwaiting()` — tie dve plochy
 * musia po F5 nakresliť to isté.
 */
function restoreAwaiting(call, parked) {
    if (!isWriteTool(call.name)) {
        /* Zaparkovaný zápis DIEŤAŤA. Kartu tu ZÁMERNE NEKRESLÍME — vlastní ju
           `run.js:restoreAgentWait()`, ktorý na tú istú udalosť robí strictne viac:
           otvorí rámec podagenta, napíše vetu, a hlavne prepíše `C.awaiting` na
           call DIEŤAŤA. Bez toho prepisu zostane v `C.awaiting` to, čo tam vložil
           `main.js` — teda `spawn_agent` call RODIČA — a globálne Esc aj kontrola
           pred odoslaním by potom hovorili o cudzom volaní.

           Poradie je dané a nie je to náhoda: `main.js` kreslí tok PRIAMO a až
           potom posiela `console:thread`, takže táto funkcia beží PRVÁ. Keby sme
           kartu nakreslili tu, `restoreAgentWait()` by ju našiel (je idempotentný
           na `data-id`) a odišiel by — a s ním by zmizol rámec, veta aj oprava
           stavu. Presne to bol nález review z 26. 8. 2026. */
        if (parked && parked.id != null && parked.thread) return;

        pushNotice('Beh čaká na rozhodnutie o zápise podagenta. Otvor jeho podbeh na obrazovke Runy — '
            + 'v tomto vlákne sa o ňom rozhodnúť nedá.');
        announce('Beh čaká na rozhodnutie o zápise podagenta.');

        return;
    }

    appendBlock(permissionCard(call));
    // Otvorené vlákno so zaparkovaným zápisom je to isté rozhodnutie ako za živého
    // behu, len prišlo po obnove stránky — a čítačka o ňom dovtedy nedostala ani slovo.
    announce(writeAsk(call));
}

/* Zapisuje tento nástroj? Odpoveď je SERVEROVÁ: `#console-tools` v `console.blade.php`
   nesie `{name, write}` z `ToolRegistry::isWrite()` (skládá ho jedna funkcia
   v `routes/web.php` pre `/console` aj `/chat`). Regulárny výraz nad menom by bol
   druhá pravda o tom, čo zapisuje, a rozišiel by sa pri prvom novom toole. `/chat`
   to má cez `toolList()` v `chat/main.js`; tu sa blok čítá na mieste, pretože
   `console/main.js` ho nevystavuje a `console/slash.js` si ho drží privátne.

   Zoznam sa čítá RAZ — je to statický blok stránky, nie stav behu.

   Meno, ktoré v zozname NIE JE, sa za zápis nepočíta, a presne touto cestou sem
   chodí `spawn_agent`: v kánone `ToolRegistry::TOOLS` je, ale blok sa skládá
   z DEFAULT PROFILU (`hades.console.profile`, default `full`) a ten ho nemá. Keby
   default bol `orchestrator`, v zozname by bol — s `write: false`, teda s tou istou
   odpoveďou. Cena tej voľby je pomenovaná: keby sa blok nedal prečítať vôbec, dostal
   by zaparkovaný zápis vetu namiesto brány. Fail-closed je tu zámer — opačná voľba
   by na `spawn_agent` calle rodiča ponúkla „Povoliť vždy", teda vypnutie brány
   zápisov celej konverzácie. */
let writeFlags = null;

export function isWriteTool(name) {
    if (writeFlags === null) {
        writeFlags = new Map();

        try {
            const list = JSON.parse(document.getElementById('console-tools')?.textContent || '[]');

            if (Array.isArray(list)) list.forEach((tool) => writeFlags.set(String(tool?.name), !!tool?.write));
        } catch {
            // Nečitateľný blok necháva mapu prázdnu — rozhodne fail-closed, viď vyššie.
        }
    }

    return writeFlags.get(String(name || '')) === true;
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
