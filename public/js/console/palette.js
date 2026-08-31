/* ===========================================================================
   Charón — PALETA (Ctrl+K).

   Parita s `/`: tá istá kresba (`#cmdk`, `#cmdk-card`, `.cmdk-input-row`,
   `.cmdk-group`, `.cmdk-item`, `.cmdk-text`, `.cmdk-title`, `.cmdk-sub`,
   `.cmdk-hint-row`, `#cmdk-trigger` — všetko v `mind.css`, ktorý sa na
   `/console` načítava prvý), to isté ovládanie (Ctrl+K otvára, šípky posúvajú
   SKUTOČNÝ fokus, Esc zatvára) a to isté poradie skupín. Markup skladá JS,
   pretože `console.blade.php` tento agent nevlastní; ID sú zámerne tie isté ako
   v `mind.blade.php`, kresba na nich visí a kolízia tu nevzniká.

   Čo paleta na tejto ploche nesie a `/` nie:

   1. VLÁKNA sa otvárajú NA MIESTE (`openThread`), nie cez `location.href`.
      Konzola je ich domovská plocha — odchod na `/chat` by z paritnej skratky
      urobil presmerovanie na inú appku.

   2. BEHY sú jediná vec, ktorú `/console` nemá vôbec: log behov je obrazovka
      Runy na `/`. Riadok behu preto NA PLOCHU ODCHÁDZA (`/?s=runy&ruo=<uuid>`)
      a priznáva to podtitulom — presne ako riadok „Charón" v palete grafu,
      ktorý je tam jediný `url` a tiež hovorí, že otvorí samostatnú plochu.
      Adresa sa skládá z kľúčov `urlstate.js` (`s` = obrazovka, `ruo` = otvorený
      beh), takže odkaz padne rovno do detailu behu.

   3. PROFIL NÁSTROJOV sa dá prepnúť, ale VÝHRADNE pre ĎALŠÍ BEH. Nie je to
      pohodlie, je to hranica brány: `POST /api/console/run` profil prijíma
      (`in:memory,files,graph,full,orchestrator`) a perzistuje ho na vlákno,
      kým `POST /api/console/decide` ho má `prohibited` — inak by sa sada toolov
      dala vymeniť MEDZI vyžiadaním povolenia a jeho vykonaním. Paleta preto
      píše len do `C.profile`, ktorý čítá `sendTurn()`; do rozhodnutia sa profil
      nedostane ani omylom, pretože `resumeDecision()` telo skládá inde a tento
      modul naň nesiaha.

   Čo paleta ZÁMERNE nenesie: slash príkazy. Tie majú vlastnú paletu na `/`
   klávese (`slash.js`, `#slash-palette`) a druhá cesta k tým istým príkazom by
   znamenala dva zoznamy, ktoré sa rozídu pri prvom pridanom príkaze.
   =========================================================================== */

import { C } from './state.js';
import { $, $$, el, num } from './dom.js';
import { request } from './http.js';
import { announce, clearView, pushNotice } from './render.js';
import { emptyBox, errorBox } from './empty.js';
import { iconSvg } from '../shared/icons.js';
import { newThread, openThread } from './main.js';

/* ---------- destinácie a profily ---------- */

/* Odchod na inú plochu. Hodnoty sú KONŠTANTY, nikdy nič z dopytu — do
   `location.href` sa nesmie dostať text, ktorý napísal človek. */
const DEST = [
    { url: '/', icon: 'hub', label: 'Graf', keys: 'graf plocha vedomie mind',
        sub: 'Vedomie Hadesa — otvorí samostatnú plochu' },
    { url: '/?s=runy', icon: 'bolt', label: 'Runy', keys: 'runy behy log cena',
        sub: 'Log behov — otvorí samostatnú plochu' },
    { url: '/chat', icon: 'send', label: 'Charón (chat)', keys: 'chat charon konverzacia vlakna',
        sub: 'Plná appka Charóna — otvorí samostatnú plochu' },
];

/* Profily sú KÓPIA MIEN z `ToolRegistry::PROFILES`, nie zdroj pravdy — server
   neznámy profil ODMIETNE (nie je fallback na `full`), takže preklep tu skončí
   ako 422 a nie ako beh s cudzou sadou toolov. Popisky sú skrátené vety
   z komentárov tej konštanty; keď sa profil zmení tam, patrí zmena aj sem. */
const PROFILES = [
    { id: 'memory', label: 'Pamäť', sub: '7 toolov — pamäť bez súborov projektu' },
    { id: 'files', label: 'Súbory', sub: '6 toolov — grep, glob, čítanie, zápis + recall' },
    { id: 'graph', label: 'Graf', sub: '5 toolov — čítanie pamäte, navigácia, mind_learn' },
    { id: 'full', label: 'Plná konzola', sub: '12 toolov — pamäť aj súbory (predvolený)' },
    { id: 'orchestrator', label: 'Orchestrátor', sub: '2 tooly — recall + spawn_agent, žiadny zápis' },
];

/* ---------- stav ---------- */

let overlay = null;
let paletteReturnFocus = null;

/* Behy sa načítajú RAZ na otvorenie palety a držia sa v keši do ďalšieho
   otvorenia. `null` = ešte sa nenačítali, `[]` = načítali a nič tam nie je,
   `false` = zlyhalo (to je stav s vlastným predmetom chyby, nie prázdno). */
let runs = null;

export function paletteOpen() {
    return !!overlay && !overlay.classList.contains('hidden');
}

/* ---------- kresba ---------- */

function buildOverlay() {
    if (overlay) return overlay;

    overlay = el('div', 'hidden');
    overlay.id = 'cmdk';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Paleta');

    const card = el('div');
    card.id = 'cmdk-card';

    const row = el('div', 'cmdk-input-row');
    const mark = iconSvg('magnifier');
    if (mark) { mark.setAttribute('aria-hidden', 'true'); row.append(mark); }

    const input = el('input');
    input.id = 'cmdk-input';
    // `text`, nie `search`: `input[type=search]` si v niektorých prehliadačoch
    // pridá vlastný krížik, a paleta na `/` je tiež `text` — dve plochy nemajú
    // mať v tom istom komponente dva rôzne natívne ovládacie prvky.
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = 'Vlákna, behy, profil nástrojov…';
    input.setAttribute('aria-label', 'Hľadať v palete');
    row.append(input, el('kbd', null, 'Esc'));

    const results = el('div');
    results.id = 'cmdk-results';

    card.append(row, results);
    overlay.append(card);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closePalette(); });
    input.addEventListener('input', () => paintPalette(input.value));

    /* Listener je na OVERLAY, nie na vstupe: keď fokus sedí na položke, vstup už
       žiadny keydown nedostane a šípky by prestali fungovať po prvom stlačení.
       Ten istý dôvod a to isté riešenie ako `setupCmdk()` v `mind/cmdk.js`. */
    overlay.addEventListener('keydown', (event) => onPaletteKey(event, input));

    document.body.append(overlay);

    return overlay;
}

function group(label) {
    return el('div', 'cmdk-group', label);
}

/** Jedna položka. `data` sú dátové atribúty, ktoré rozhodujú o akcii. */
function item(icon, title, sub, data, current) {
    const btn = el('button', 'cmdk-item');
    btn.type = 'button';

    Object.entries(data || {}).forEach(([k, v]) => { btn.dataset[k] = v; });

    const mark = iconSvg(icon);
    if (mark) { mark.setAttribute('aria-hidden', 'true'); btn.append(mark); }

    const text = el('span', 'cmdk-text');
    text.append(el('span', 'cmdk-title', title));
    if (sub) text.append(el('span', 'cmdk-sub', sub));
    btn.append(text);

    /* Aktívna voľba sa hlási `aria-current`, nie vlastnou triedou: kresba pre
       „aktívnu položku palety" v `mind.css` neexistuje a vyrobiť si ju tu by
       bola druhá kresba komponentu, ktorý má jednu. Rozdiel teda nesie SLOVO
       v podtitule (to vidí oko) a `aria-current` (to vidí čítačka). */
    if (current) btn.setAttribute('aria-current', 'true');

    return btn;
}

/** Porovnanie bez diakritiky — kto hľadá „zaznam", má nájsť aj „záznam". */
function fold(text) {
    return String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function paintPalette(query) {
    const box = buildOverlay();
    const results = $('#cmdk-results', box);
    const q = fold(String(query || '').trim());

    results.innerHTML = '';

    let drawn = 0;

    // ── Prejsť na ────────────────────────────────────────────────────────────
    const dest = DEST.filter((d) => !q || fold(d.label).includes(q) || fold(d.keys).includes(q));

    if (dest.length) {
        results.append(group('Prejsť na'));
        dest.forEach((d) => {
            results.append(item(d.icon, d.label, d.sub, { url: d.url }));
            drawn++;
        });
    }

    // ── Akcie ────────────────────────────────────────────────────────────────
    /* Filtruje sa podľa `keys`, NIE podľa vykresleného titulku — ten istý nález
       ako na `/`: „vyčistiť" v titulku a „clear" v dopyte sa nikdy nestretnú. */
    const actions = [
        { id: 'new-thread', icon: 'plus', label: 'Nové vlákno', keys: 'nove vlakno thread konverzacia ctrl+n',
            sub: 'Založí čisté vlákno (Ctrl+N)' },
        { id: 'clear-view', icon: 'trash', label: 'Vyčistiť zobrazenie', keys: 'vycistit clear zobrazenie tok',
            sub: 'Tok sa vyprázdni, história vlákna v pamäti zostáva' },
    ].filter((a) => !q || fold(a.label).includes(q) || fold(a.keys).includes(q));

    if (actions.length) {
        results.append(group('Akcie'));
        actions.forEach((a) => {
            results.append(item(a.icon, a.label, a.sub, { action: a.id }));
            drawn++;
        });
    }

    // ── Profil nástrojov ─────────────────────────────────────────────────────
    const profiles = PROFILES.filter((p) => !q
        || fold(p.label).includes(q) || p.id.includes(q) || 'profil nastroje tools'.includes(q));

    if (profiles.length) {
        results.append(group('Profil nástrojov · pre ďalší beh'));
        profiles.forEach((p) => {
            const on = C.profile === p.id;
            /* Keď profil nikto neprepol, klient NEVIE, ktorý je aktívny: rámec
               `start` profil nenesie a payload vlákna ho tiež nemá (server ho
               berie z `hades.console.profile`). Tvrdiť „predvolený je full" by
               bola lož pri inom `HADES_CONSOLE_PROFILE`, takže sa aktívna voľba
               vyznačí len vtedy, keď ju spravil človek TU. */
            results.append(item('head-gear', p.label,
                on ? `${p.sub} · nasadený pre ďalší beh` : p.sub,
                { profile: p.id }, on));
            drawn++;
        });
    }

    // ── Vlákna ───────────────────────────────────────────────────────────────
    /* Z KEŠE `C.threads`, teda okamžite a bez dopytu: zoznam už načítal
       `loadThreads()` pri štarte a `/api/console/threads` beží na tom istom PHP
       workeri ako beh, takže druhý okruh by paletu počas ťahu zdržal o sekundy. */
    const threads = (C.threads || [])
        .filter((t) => !q || fold(t.title || 'Nové vlákno').includes(q))
        .slice(0, 8);

    if (threads.length) {
        results.append(group('Vlákna'));
        threads.forEach((t) => {
            const when = t.last_message_at
                ? new Date(t.last_message_at).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric' })
                : 'nezačaté';

            results.append(item('send', t.title || 'Nové vlákno',
                `${t.model || 'predvolený model'} · ${when}`,
                { thread: t.uuid }, C.thread?.uuid === t.uuid));
            drawn++;
        });
    }

    // ── Behy ─────────────────────────────────────────────────────────────────
    if (runs === false) {
        results.append(group('Behy'));
        // Predmet chyby je vlastný („behy"), nie „Nastala chyba" — a nesie JEDNU
        // akciu, ktorá naozaj niečo robí (znovu načíta a prekreslí paletu).
        results.append(errorBox('behy', () => { runs = null; loadRuns(); }));
        drawn++;
    } else if (Array.isArray(runs)) {
        const hits = runs
            .filter((r) => !q || fold(r.prompt).includes(q) || fold(r.thread_title).includes(q)
                || fold(r.model).includes(q) || fold(r.status).includes(q))
            .slice(0, 6);

        if (hits.length) {
            results.append(group('Behy'));
            hits.forEach((r) => {
                const bits = [statusWord(r.status)];
                if (r.model) bits.push(r.model);
                if (r.tokens_out) bits.push(`${num(r.tokens_out, 0)} tok`);
                bits.push('otvorí obrazovku Runy');

                results.append(item('bolt', r.prompt || r.thread_title || 'Beh bez zadania',
                    bits.join(' · '), { run: r.uuid }));
                drawn++;
            });
        }
    }

    // ── nič ──────────────────────────────────────────────────────────────────
    if (!drawn) {
        /* Prázdno z FILTRA, nie z neexistencie dát — `.empty--filter` je značka
           toho stavu a vlastnú kresbu zámerne nemá (manuál §8: prázdny stav si
           nevymýšľa novú farbu). Líši sa textom a svojou jednou akciou. */
        results.append(emptyBox({
            mod: 'filter',
            icon: 'magnifier-off',
            title: 'Dopytu nezodpovedá nič',
            hint: `Hľadané „${String(query || '').trim()}" nesedí na vlákno, beh, profil ani plochu.`,
            action: {
                label: 'Zrušiť dopyt',
                on: () => {
                    const input = $('#cmdk-input', box);
                    input.value = '';
                    paintPalette('');
                    input.focus();
                },
            },
        }));
    }

    bindItems(results);
}

/* Slovo o stave behu. Vlastná kópia a nie import z `mind/screens/runy.js`:
   ten modul ťahá celý graf (util.js → render.js → sim.js → d3), teda by
   načítanie palety stiahlo plátno na plochu, ktorá plátno nemá. */
function statusWord(status) {
    const map = {
        running: 'beží', waiting: 'čaká na rozhodnutie', done: 'hotový',
        failed: 'zlyhal', aborted: 'prerušený',
    };

    return map[status] || String(status || '');
}

/* ---------- akcie položiek ---------- */

function bindItems(root) {
    $$('.cmdk-item[data-url]', root).forEach((btn) => {
        btn.addEventListener('click', () => {
            // Paletu zatvárame PRED odchodom: keby navigáciu niečo zdržalo,
            // otvorená paleta nad odchádzajúcou stránkou vyzerá ako zaseknutý klik.
            closePalette();
            location.href = btn.dataset.url;
        });
    });

    $$('.cmdk-item[data-thread]', root).forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.thread || '';

            // Tvar sa validuje, hoci uuid ide z odpovede servera: keby sa raz
            // zmenil tvar odpovede, nemá to skončiť otvorením niečoho iného.
            if (!isUuid(id)) return;

            closePalette();
            document.body.classList.remove('rail-open');
            openThread(id);
        });
    });

    $$('.cmdk-item[data-run]', root).forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.run || '';
            if (!isUuid(id)) return;

            closePalette();
            location.href = `/?s=runy&ruo=${id}`;
        });
    });

    $$('.cmdk-item[data-profile]', root).forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.profile || '';
            const profile = PROFILES.find((p) => p.id === id);
            if (!profile) return;

            C.profile = id;
            closePalette();

            /* Prepnutie profilu NEMÁ viditeľnú zmenu plochy (hlavička profil
               nezobrazuje — nemá preň kresbu a druhú by tu tento agent nepísal),
               takže sa hlási. Kanálom konzoly je tok správ, nie toast: `/console`
               toasty nemá a `http.js` už týmto kanálom hlási zamknutý okruh. */
            pushNotice(`Ďalší beh pôjde s profilom nástrojov „${profile.label}" (${id}). `
                + 'Rozhodnutia o čakajúcich zápisoch to nemení — o profile sa rozhoduje pri spustení behu.');
            announce(`Profil nástrojov ${profile.label} je nasadený pre ďalší beh.`);
        });
    });

    $$('.cmdk-item[data-action]', root).forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.action;

            closePalette();

            if (id === 'new-thread') await newThread();
            // `/clear` má jediný zdroj pravdy v `render.js`; paleta ho volá, nekopíruje.
            if (id === 'clear-view') clearView();
        });
    });
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));
}

/* ---------- behy ---------- */

/* `request()` a nie `json()`: `json()` každú neúspešnú odpoveď ohlási do toku
   správ, a človek by pri otvorení palety čítal „Požiadavka zlyhala (HTTP 500)"
   za skupinu, ktorá je nepovinná výbava. Chybu nesie prázdny stav v palete —
   presne tam, kde ju človek hľadá. Ten istý dôvod ako v `models.js`. */
async function loadRuns() {
    try {
        const res = await request('/api/runs?limit=40');

        if (!res.ok) { runs = false; repaintIfOpen(); return; }

        const data = await res.json();

        runs = Array.isArray(data?.items) ? data.items : [];
    } catch {
        runs = false;
    }

    repaintIfOpen();
}

function repaintIfOpen() {
    if (paletteOpen()) paintPalette($('#cmdk-input', overlay)?.value || '');
}

/* ---------- otvorenie a zatvorenie ---------- */

export function openPalette() {
    const box = buildOverlay();

    if (!paletteOpen()) paletteReturnFocus = document.activeElement;

    // Behy sa ťahajú len raz za život stránky, nie pri každom otvorení: log rastie
    // po ťahoch a paleta má byť okamžitá. `runs = null` (chyba → „Skúsiť znova")
    // je jediná cesta k opakovanému dopytu.
    if (runs === null) { runs = []; loadRuns(); }

    const input = $('#cmdk-input', box);
    input.value = '';
    paintPalette('');
    box.classList.remove('hidden');
    // Fokus o rámec neskôr: `display: none → flex` a `focus()` v tom istom
    // synchronnom bloku niektoré prehliadače zahodia.
    setTimeout(() => input.focus(), 30);
}

export function closePalette() {
    if (!overlay) return;

    overlay.classList.add('hidden');

    const back = paletteReturnFocus;
    paletteReturnFocus = null;

    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
    else $('#cmdk-trigger')?.focus();
}

/* ---------- klávesnica ---------- */

function items() {
    return $$('.cmdk-item', $('#cmdk-results', overlay));
}

/** Šípky posúvajú SKUTOČNÝ fokus, nie vlastnú triedu — `.cmdk-item:focus-visible`
    má v `mind.css` presne to podsvietenie, ktoré by vlastná trieda potrebovala,
    a takto ho vidí aj čítačka (a Enter funguje nativne). */
function move(delta) {
    const list = items();
    if (!list.length) return;

    const cur = list.indexOf(document.activeElement);
    const next = cur < 0
        ? (delta > 0 ? 0 : list.length - 1)
        : (cur + delta + list.length) % list.length;

    list[next].focus();
    list[next].scrollIntoView({ block: 'nearest' });
}

/**
 * Ktorú položku vezme Enter zo vstupu.
 *
 * BEZ DOPYTU NEROBÍ NIČ. Na `/` padne Enter na prvú destináciu, ale tam je prvou
 * destináciou obrazovka tej istej appky; tu je to `/` alebo `/chat`, teda ODCHOD
 * zo stránky s rozpísanou správou v composeri. Enter naslepo, ktorý opustí
 * plochu, je horší než Enter, ktorý nerobí nič — a šípky aj klik fungujú.
 *
 * S dopytom má prednosť skutočný nález (vlákno, beh) pred destináciou a akcia je
 * posledná; ten istý poriadok ako `cmdkEnterTarget()` na `/`, kde ho vynútil
 * nález A2 (človek napísal text a Enter ho poslal na Smernicu).
 */
function enterTarget(query) {
    if (String(query || '').trim() === '') return null;

    const list = items();

    return list.find((n) => n.dataset.thread !== undefined || n.dataset.run !== undefined)
        || list.find((n) => n.dataset.url !== undefined)
        || list.find((n) => n.dataset.action !== undefined || n.dataset.profile !== undefined)
        || null;
}

function onPaletteKey(event, input) {
    /* Esc ani Ctrl+K sem NECHODIA — obe berie capture listener na dokumente
       (`wirePalette()`), pretože musia fungovať aj vtedy, keď fokus v palete
       nesedí. Tab necháme prehliadaču.

       Zvyšok si paleta berie: je to modálny dialóg a bez `stopPropagation()` by
       písmená dobehli na composer aj na globálne skratky pod ňou. */
    if (event.key === 'Tab') return;

    event.stopPropagation();

    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }

    if (event.key === 'Enter') {
        // Na položke si Enter obslúži prehliadač sám (je to <button>) — to, na čom
        // človek stojí, má prednosť pred akýmkoľvek pravidlom.
        if (document.activeElement !== input) return;

        const target = enterTarget(input.value);

        if (target) { event.preventDefault(); target.click(); }

        return;
    }

    // Písanie po odšípkovaní musí ísť do dopytu, nie do prázdna.
    if (document.activeElement === input) return;

    if (event.key === 'Backspace') {
        event.preventDefault();
        input.value = input.value.slice(0, -1);
        input.focus();
        paintPalette(input.value);

        return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        input.value += event.key;
        input.focus();
        paintPalette(input.value);
    }
}

/* ---------- spúšťač a zapojenie ---------- */

/* Tlačidlo do hlavičky. Bez neho by paletu poznal len ten, kto vie o Ctrl+K —
   a `title` na klávesovej skratke sa na dotyku nezobrazí nikdy. Kresbu nesie
   `#cmdk-trigger` v `mind.css`; `.cmdk-hint` a `kbd` v ňom pod 900 px sama
   skryje (media query tam už je), takže na úzkom okne zostane ikona. */
function mountTrigger() {
    const right = document.querySelector('.ch-right');

    if (!right || $('#cmdk-trigger')) return;

    const btn = el('button');
    btn.id = 'cmdk-trigger';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Paleta (Ctrl+K)');

    const mark = iconSvg('magnifier');
    if (mark) { mark.setAttribute('aria-hidden', 'true'); btn.append(mark); }

    btn.append(el('span', 'cmdk-hint', 'Paleta'), el('kbd', null, 'Ctrl K'));
    btn.addEventListener('click', openPalette);

    right.prepend(btn);
}

/* Nápoveda pod composerom. Skratka, ktorá nie je nikde napísaná, neexistuje —
   a `.hint-keys` je presne ten obal, ktorý sa pod 900 px skrýva sám, takže sa
   pripísaním nič nerozbije. */
function mountHint() {
    const keys = $$('#composer-hint .hint-keys').at(-1);

    if (!keys || keys.dataset.cmdk === '1') return;

    keys.dataset.cmdk = '1';
    keys.append(document.createTextNode(' · '), el('kbd', null, 'Ctrl'),
        document.createTextNode('+'), el('kbd', null, 'K'), document.createTextNode(' paleta'));
}

export function wirePalette() {
    mountTrigger();
    mountHint();

    /* CAPTURE fáza na dokumente, a to je PODMIENKA, nie štýl:

       · `#prompt` má vlastný keydown (slash.js), takže Ctrl+K z rozpísanej
         správy by sa k palete v bublinovej fáze nemusel dostať;
       · globálne Esc v `run.js` visí na dokumente v bublinovej fáze a beh ním
         ZASTAVUJE. Keby Esc zatváralo paletu až tam, jedno stlačenie by malo dva
         následky a jeden z nich je nevratný — text, ktorý model ešte nevydal,
         už nepríde. Preto sa Esc nad otvorenou paletou zoberie tu a zastaví.

       `preventDefault` na Ctrl+K berie prehliadaču jeho vlastnú skratku
       (v niektorých skok do adresného riadka, resp. hľadanie). */
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
            event.preventDefault();
            event.stopPropagation();

            if (paletteOpen()) closePalette();
            else openPalette();

            return;
        }

        if (event.key === 'Escape' && paletteOpen()) {
            event.preventDefault();
            event.stopPropagation();
            closePalette();
        }
    }, true);
}
