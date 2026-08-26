/* ===========================================================================
   Charón — karty nástrojov a potvrdzovanie zápisov.

   Karta je zložená z hlavičky (ikona, meno, argumenty na jednom riadku, stav) a
   tela s výsledkom. Telo je zložené na pár riadkov: výsledok grepu má bežne
   stovky riadkov a plný výpis by pohltil celý tok. Rozbalenie je vždy jeden
   klik — skryté nesmie znamenať nedostupné.

   Rozhodnutie o povolení sa NEPOSIELA odtiaľto. Karta vypustí udalosť
   `console:decide` a run.js ju odchytí; keby si tools.js volalo run.js a run.js
   tools.js, mali by cyklus, ktorý by pri prvom `import` spadol na neinicializovaný
   modul. Udalosť je zároveň to isté rozhranie, aké už používa composer.

   Detail udalosti nesie `{ id, decision, thread, agent }`. `thread` je vlákno,
   ktorému rozhodnutie patrí, a pri zápise PODAGENTA je to jeho vlastné vlákno —
   nie to, ktoré má klient otvorené. `agent` hovorí, že karta je karta dieťaťa,
   takže sa rozhodnutie nesmie tichom stiahnuť na otvorené vlákno.
   =========================================================================== */

import { el, num } from './dom.js';
import { isWriteTool, pushBlock, scrollIfFollowing } from './render.js';
import { argsSummary, decisionLabel, diffHtml, iconFor, looksLikeDiff, writeTarget } from '../shared/gate.js';

/* Slovník a formát brány (ikona, argumenty na riadok, diff, ľudský popis zápisu)
   žijú v public/js/shared/gate.js — dok Charóna nad grafom hovorí tú istú reč.
   Tu zostáva len skladanie DOM kariet nad triedami console.css.

   Časti karty nesú prefix `.tool-` (po `.tool-call`), nie `.tc-`: ten istý
   prefix znamenal v mind.css tabulárne číslo karty Dnes (`.tc-val`,
   `.tc-label`) a kolízia bola len otázka času. Dôvod je zapísaný v
   console.css, sekcia „karta nástroja". */

/* Koľko riadkov výsledku sa vidí bez rozbalenia. Šesť je jeden „odsek" — dosť
   na to, aby bolo vidno, či nástroj našiel to, čo mal. */
const PEEK_LINES = 6;

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

    const head = el('button', 'tool-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');

    const mark = el('span', 'ms', iconFor(frame.name));
    mark.setAttribute('aria-hidden', 'true');

    head.append(el('span', 'tool-caret'));
    head.append(mark);
    head.append(el('span', 'tool-name', frame.name || 'nástroj'));
    head.append(el('span', 'tool-args', argsSummary(frame.arguments)));
    head.append(el('span', 'tool-state', 'beží…'));

    const body = el('div', 'tool-body hidden');

    head.addEventListener('click', () => toggleBody(card));

    card.append(head, body);

    return card;
}

/**
 * Doplní výsledok do už nakreslenej karty (rámec `tool_result`).
 *
 * `root` je element, v ktorom sa karta hľadá — pri rámcoch PODAGENTA je to jeho
 * rámec v toku (`.agent-body`), nie `document`. Osirotený výsledok potom pribudne
 * DO NEHO a nie do toku rodiča: krok dieťaťa nakreslený medzi krokmi rodiča by
 * znamenal, že človek nevie, komu povoľuje zápis.
 */
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

    if (root instanceof Element) root.append(orphan);
    else pushBlock(orphan);

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
        card.classList.remove('running');
        card.classList.add('waiting');
        card.querySelector('.tool-state').textContent = 'čaká na rozhodnutie';

        return card;
    }

    // `running` v histórii znamená, že beh niekto zrezal uprostred (Stop, spadnutý
    // server). Nikto ho už nedokončí, takže sa nesmie tváriť ako bežiaci —
    // pulzujúci „beží…" nad mŕtvym volaním je lož.
    if (call.status === 'running') {
        card.classList.remove('running');
        card.classList.add('denied');
        card.querySelector('.tool-state').textContent = 'beh prerušený';

        return card;
    }

    fillResult(card, call);

    return card;
}

/* `isWriteName()` — regex nad MENOM nástroja — tu bol do 26. 8. 2026. Zanikol,
   pretože to bola DRUHÁ pravda o tom, čo zapisuje: server ju posiela v bloku
   `#console-tools` (`ToolRegistry::isWrite()`), a regex by sa pri prvom novom
   toole rozišiel — read-only nástroj s menom typu `apply_patch` by označil za
   zápis. `isWriteTool()` v `render.js` číta ten blok; dnes dávajú obe cesty na
   každom z dvanástich toolov tú istú odpoveď, takže presun nič nemení. */

/* Stav volania má DVA slovníky: drôtový protokol posiela `status: "done"` /
   `"error"`, ale enum v `console_tool_calls` pozná `failed` (a `running`).
   Karta musí čítať oba, inak by zlyhaný nástroj z histórie vyzeral ako úspešný. */
function normalizeStatus(status) {
    return status === 'failed' ? 'error' : (status || 'done');
}

function fillResult(card, call) {
    const status = normalizeStatus(call.status);
    const state = card.querySelector('.tool-state');
    const body = card.querySelector('.tool-body');
    const head = card.querySelector('.tool-head');

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

    const pre = el('pre', 'tool-result');

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
        const more = el('button', 'tool-more', 'rozbaliť');
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
    const body = card.querySelector('.tool-body');
    const head = card.querySelector('.tool-head');

    if (!body.children.length) return;

    const hidden = body.classList.toggle('hidden');
    head.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    scrollIfFollowing();
}

/* ---------- potvrdenie zápisu ---------- */

/**
 * Srdce konzoly: zápis sa nestane, kým človek neklikne. Karta si berie fokus, aby
 * Enter/Esc fungovali bez toho, aby na ňu musel najprv mieriť myšou — pri modeli
 * na 9 tok/s je čakanie na povolenie najčastejší okamih celej práce.
 *
 * `agent` je `{ thread }` PODAGENTA, alebo `null` pri zápise tohto vlákna. Nesie
 * ho karta a nie stav behu, aby sa rozhodnutie nedalo poslať inam len preto, že
 * medzitým prišiel ďalší rámec: `/decide` ide na `data-thread`, teda pri zápise
 * podagenta na JEHO vlákno. Bez vlákna karta zostane označená ako karta dieťaťa
 * (`is-agent`) a rozhodnutie sa neodošle — `run.js` ho odmietne s vetou, prečo.
 * Tichý fallback na otvorené vlákno by povolil cudzí zápis.
 */
export function permissionCard(frame, agent = null) {
    const card = el('div', 'perm-card');
    card.dataset.id = frame.id;
    card.dataset.name = frame.name || '';

    const forAgent = agent !== null;

    if (forAgent) {
        card.classList.add('is-agent');
        if (agent.thread) card.dataset.thread = String(agent.thread);
    }

    // Argumenty žijú ako vlastnosť elementu a nie v `data-` atribúte: výsledok
    // zápisu si z nich neskôr poskladá kartu, ale v DOM by to bol celý JSON
    // navyše pri každom potvrdení.
    card.hadesArgs = frame.arguments;
    // Náhľad si tiež necháme na elemente: pri rozhodnutí z neho vieme poskladať
    // ľudské ohlásenie výsledku, keď argumenty nenesú label ani cestu.
    card.hadesPreview = frame.preview;
    card.tabIndex = -1;
    card.setAttribute('role', 'group');
    // Prístupné meno karty hovorí, ČO a KAM sa zapíše — nie technické meno
    // nástroja („mind_learn"), ktoré čítačke o obsahu rozhodnutia nepovie nič.
    card.setAttribute('aria-label', `${writeTarget(frame.name, frame.arguments, frame.preview)} — čaká na povolenie`);

    const head = el('div', 'pc-head');
    const mark = el('span', 'ms', iconFor(frame.name));
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark);
    head.append(el('strong', 'pc-name', frame.name || 'nástroj'));
    head.append(el('span', 'pc-args', argsSummary(frame.arguments)));
    card.append(head);

    card.append(el('p', 'pc-ask', forAgent
        ? 'Toto chce zapísať podagent. Pustím ho?'
        : 'Toto je zápis. Pustím ho?'));

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

    /* „Povoliť vždy" NEDOSTANE karta podagenta. `decision=allow_always` vypína
       bránu na vlákne, ktorému rozhodnutie patrí — pri podagentovi na JEHO vlákne,
       takže by od tej chvíle šli všetky ďalšie zápisy toho podbehu bez pýtania a
       bez diffu. `Subagent::start()` `auto_accept` z rodiča zámerne NEDEDÍ a
       `AgentRunner` ho vo vlákne podagenta ignoruje (aj `PATCH` na vlákno
       podagenta ho zahodí), takže tlačidlo by sľubovalo, čo sa nestane. Navyše
       „vždy" čítá človek vo význame „moja konverzácia", nie „každý ďalší zápis
       úlohy, ktorú vymyslel model". Vzor je `public/js/chat/render.js`. */
    [
        // Varianty sa menujú tak, ako ich definuje `mind.css` (`button.primary` /
        // `.ghost` / `.danger`). Do 21. 8. 2026 tu boli `btn-*`, ktoré nedefinuje
        // ani jeden stylesheet, takže najdôležitejší ovládač appky mal vzhľad
        // neutrálneho tlačidla. `console.css` na `.pc-btn.primary` už počítal.
        ['allow', 'Povoliť', 'Enter', 'primary'],
        ['allow_always', 'Povoliť vždy', '', 'ghost'],
        ['deny', 'Zamietnuť', 'Esc', 'danger'],
    ].filter(([decision]) => !(forAgent && decision === 'allow_always')).forEach(([decision, label, key, cls]) => {
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

function decide(card, decision) {
    if (card.classList.contains('decided')) return;

    // Fokus je v tejto chvíli na tlačidle vnútri `.pc-actions`, ktoré o riadok
    // nižšie zaniká — bez zásahu by spadol na <body> a klávesnica by začínala od
    // začiatku stránky. Zapamätáme si to a vrátime fokus na kartu (má
    // tabindex="-1"), ale len ak tu naozaj bol: globálny Esc rozhoduje aj spoza
    // composera a tomu fokus brať netreba. Vzor je runy.js:117.
    const hadFocus = card.contains(document.activeElement);

    card.classList.add('decided');
    card.classList.add(decision === 'deny' ? 'denied' : 'allowed');
    card.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });

    const done = el('p', 'pc-done', decisionLabel(decision) || decision);
    card.querySelector('.pc-actions').replaceWith(done);

    if (hadFocus) card.focus();

    // Výsledok rozhodnutia nesmie zostať nedopovedaný. Ide do #console-live
    // a hovorí ĽUDSKY, čo sa (ne)zapísalo — nie meno nástroja. Ako sa po
    // zamietnutí skončí BEH, ohlási run-end cesta cez runstate; tu sa to
    // druhýkrát nepíše.
    liveAnnounce(`${decisionLabel(decision) || decision}. ${writeTarget(card.dataset.name, card.hadesArgs, card.hadesPreview)}.`);

    // `thread` a `agent` nesie karta, nie stav behu: pri zápise PODAGENTA ide
    // `/decide` na jeho vlákno a `run.js` sa nesmie spoliehať na to, že `C.awaiting`
    // ešte drží ten istý ťah.
    document.dispatchEvent(new CustomEvent('console:decide', {
        detail: {
            id: Number(card.dataset.id),
            decision,
            thread: card.dataset.thread || null,
            agent: card.classList.contains('is-agent'),
        },
    }));
}

/* Výsledok rozhodnutia píše do #console-live — samostatnej aria-live oblasti,
   ktorú do console.blade.php pridáva iný agent tejto vlny. Kým tam nie je,
   ohlásenie ticho vypadne (radšej nič než pád na neexistujúcom prvku). */
function liveAnnounce(text) {
    const live = document.getElementById('console-live');
    if (live) live.textContent = text;
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
