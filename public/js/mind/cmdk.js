import { certBadge } from './certainty.js';
import { openNodeFromAnywhere, setScreen } from './screens.js';
/* doSync je hoistovaná `export async function` — cez cyklus sa v tomto grafe
   ťahajú len hoistované funkcie (viď pravidlo v CLAUDE.md), takže tento import
   je bezpečný aj keď dnes.js siaha späť na obrazovky. */
import { doSync } from './screens/dnes.js';
import { gotoDirective } from './screens/smernica.js';
import { showToast } from './toasts.js';
import { certTagMatch, parseQueryFilter } from './search.js';
import { $, emptyHtml, esc, plainInline, plainText, prettyProject, typeName } from './util.js';
import { iconMarkup } from '../shared/icons.js';

/* ---------- Cmd-K paleta (zjednotené hľadanie + navigácia) ---------- */

/* Paleta pozná VŠETKY destinácie railu. Do 24. 8. 2026 ich mala sedem z ôsmich —
   chýbali Runy (pribudli neskôr a na paletu sa zabudlo) aj Charón. Rozdiel bol tichý:
   paleta na „runy" nenašla nič a vyzeralo to, že obrazovka neexistuje.
   Poradie zrkadlí skupiny railu (TERAZ / ZÁZNAMY / ZNALOSTI), aby paleta a rail
   nehovorili o tej istej appke v dvoch rôznych poradiach. */
export const CMDK_NAV = [
    { screen: 'dnes', label: 'Dnes', icon: 'sun' },
    { screen: 'graf', label: 'Graf', icon: 'hub' },
    { screen: 'dennik', label: 'Denník', icon: 'receipt' },
    { screen: 'rozhodnutia', label: 'Rozhodnutia', icon: 'gavel' },
    { screen: 'runy', label: 'Runy', icon: 'bolt' },
    { screen: 'kniznica', label: 'Knižnica', icon: 'book' },
    { screen: 'kontrola', label: 'Kontrola', icon: 'check-list' },
    { screen: 'smernica', label: 'Smernica', icon: 'clipboard' },
    /* Charón NIE JE obrazovka grafu, ale samostatná plocha na vlastnej URL — preto
       `url` a nie `screen`, a klik robí `location.href`, nie `setScreen()`. Odchod zo
       stránky je zmena kontextu, takže to paleta priznáva podtitulom.
       Ikona `send` je tá istá ako v raile a je overená v subsete; `forum` v ňom NIE JE
       a nová ikona by znamenala regeneráciu subsetu. */
    /* Cieľ je `/chat` (plná appka Charóna od 25. 8. 2026), nie `/console`.
       Technická konzola si URL drží, ale primárna navigácia na ňu už neposiela —
       rovnako ako rail. Vlastnú položku nedostáva zámerne: súčasná ikonová sada nemá
       glyf pre konzolu (`terminal` v nej NIE JE, len v komentári icons.js) a nová
       ikona je zmena sady, nie položky palety. */
    { url: '/chat', label: 'Charón', icon: 'send', sub: 'Chat s vedomím — otvorí samostatnú plochu' },
];
export let cmdkTimer = null, cmdkSeq = 0;
// Beží vzdialené hľadanie? Enter to potrebuje vedieť: kým výsledky nie sú vonku,
// nesmie spadnúť na akciu — pretiekol by na Smernicu presne v tom okamihu, keď
// hľadaný uzol o 200 ms príde.
export let cmdkPending = false;
// Kam sa vráti fokus po zavretí palety. Bez toho spadol na <body>, takže Tab po
// zavretí začínal od začiatku dokumentu — a paletu otvára KLÁVESOVÁ skratka,
// čiže presne ten používateľ, ktorému to vadí najviac.
export let cmdkReturnFocus = null;

/* Keš posledných vlákien Charóna. Prečo keš a nie dopyt pri písaní: vlákna sú
   navigačné cieľe (ako destinácie railu), takže musia byť v palete OKAMŽITE — dopyt
   za debouncom by ich ukázal až po druhom znaku a pri prázdnom dopyte nikdy.
   Plní sa raz na otvorenie palety; zlyhanie je ticho prázdne pole, nie chyba:
   paleta má fungovať aj keď je Charón nedostupný. */
export let cmdkThreads = [];

async function loadCmdkThreads() {
    try {
        const res = await fetch('/api/console/threads');
        if (!res.ok) return;
        const data = await res.json();
        cmdkThreads = Array.isArray(data.threads) ? data.threads : [];
        // Paleta už môže byť otvorená a vykreslená bez vlákien — prekresli ju.
        if (cmdkOpen()) renderCmdk($('cmdk-input').value);
    } catch (e) { /* Charón nemusí byť dostupný */ }
}

export function openCmdk() {
    const overlay = $('cmdk');
    if (!cmdkOpen()) cmdkReturnFocus = document.activeElement;
    loadCmdkThreads();
    overlay.classList.remove('hidden');
    const input = $('cmdk-input');
    input.value = '';
    renderCmdk('');
    setTimeout(() => input.focus(), 30);
}
export function closeCmdk() {
    $('cmdk').classList.add('hidden');
    const back = cmdkReturnFocus;
    cmdkReturnFocus = null;
    // <body> nie je „kam sa vrátiť" — paletu často otvorí skratka v okamihu, keď nemá
    // fokus nič konkrétne, a vrátiť ho na body je to isté ako ho stratiť. Vtedy ho
    // dostane spúšťač palety, teda prvok, ktorý o nej hovorí.
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
    else { const t = $('cmdk-trigger'); if (t) t.focus(); }
}
export function cmdkOpen() { return !$('cmdk').classList.contains('hidden'); }

export function cmdkItems() {
    return [...$('cmdk-results').querySelectorAll('.cmdk-item')];
}

/* Šípky posúvajú SKUTOČNÝ fokus po položkách, nie vlastnú triedu „active":
   .cmdk-item:focus-visible má v CSS presne to podsvietenie, ktoré vlastná trieda
   potrebovala, a takto ho vidí aj čítač obrazovky (a Enter funguje nativne). */
export function cmdkMove(delta) {
    const items = cmdkItems();
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    const next = cur < 0
        ? (delta > 0 ? 0 : items.length - 1)
        : (cur + delta + items.length) % items.length;
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
}

/* Ktorú položku vezme Enter zo vstupu. **Poradie skupín v zozname sa NEMENÍ** —
   je to vizuálna hierarchia; mení sa len voľba. Prednosť má skutočný výsledok
   (uzol, playbook), potom destinácia railu, akcia je až posledná.
   Do 24. 8. 2026 tu bolo `cmdkItems()[0]`, a keďže zoznam sa skladá
   `nav → Akcia → #cmdk-remote`, pri dopyte, ktorý netrafí názov obrazovky, bola
   prvou položkou **vždy** „Vytvor smernicu": človek napísal text, stlačil Enter
   a namiesto výsledku skončil na Smernici (nález A2). */
export function cmdkEnterTarget() {
    const items = cmdkItems();
    const hit = items.find((el) => el.dataset.id !== undefined || el.dataset.pb !== undefined);
    if (hit) return hit;
    const dest = items.find((el) => el.dataset.nav !== undefined || el.dataset.url !== undefined);
    if (dest) return dest;
    // Akcia je fallback, ale nie „na slepo": kým hľadanie beží, ešte nevieme, či
    // výsledok nepríde. A keď dobehne naprázdno, akcia je jediná položka v palete,
    // takže Enter na nej je vedomá voľba, nie prekvapenie.
    if (cmdkPending) return null;
    return items.find((el) => el.dataset.action !== undefined) || null;
}

export function setupCmdk() {
    $('cmdk-trigger').onclick = openCmdk;
    const overlay = $('cmdk');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCmdk(); });
    const input = $('cmdk-input');
    input.addEventListener('input', () => renderCmdk(input.value));

    // Listener je na OVERLAY, nie na vstupe: keď fokus sedí na položke, vstup už
    // žiadny keydown nedostane a šípky by prestali fungovať po prvom stlačení.
    overlay.addEventListener('keydown', (e) => {
        /* Paleta je modálny dialóg, takže si klávesy berie ona — von pustíme len Esc
           (globálna kaskáda ju má zavrieť) a Tab. Bez tohto by po odšípkovaní na
           položku (BUTTON, nie INPUT) prešlo „d" strážcom v setupShortcuts a appka by
           pod otvorenou paletou preskočila na Denník. Ctrl+K si tiež berie window
           handler — ten stojí nad strážcom a zavrie paletu, čo je správne. */
        if (e.key !== 'Escape' && e.key !== 'Tab' && !((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K'))) {
            e.stopPropagation();
        }
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdkMove(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); cmdkMove(-1); return; }
        if (e.key === 'Enter') {
            // Na položke si Enter obslúži prehliadač sám (je to <button>) — to, na čom
            // človek stojí, má prednosť pred akýmkoľvek pravidlom nižšie.
            if (document.activeElement !== input) return;
            const target = cmdkEnterTarget();
            // Bez cieľa Enter zámerne nerobí NIČ (nie „vytvor smernicu" na slepo).
            if (target) { e.preventDefault(); target.click(); }
            return;
        }
        // Písanie po odšípkovaní musí ísť do dopytu, nie do prázdna. Hodnotu meníme
        // ručne — spoliehať sa na to, že sa znak „dodoručí" novo zaostrenému vstupu,
        // je závislé na prehliadači.
        if (document.activeElement === input) return;
        if (e.key === 'Backspace') {
            e.preventDefault();
            input.value = input.value.slice(0, -1);
            input.focus();
            renderCmdk(input.value);
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            input.value += e.key;
            input.focus();
            renderCmdk(input.value);
        }
    });
}

export function bindCmdkItems(root) {
    root.querySelectorAll('.cmdk-item[data-nav]').forEach((el) => {
        el.onclick = () => { closeCmdk(); setScreen(el.dataset.nav); };
    });
    /* Odchod na inú plochu (dnes len Charón). Hodnota pochádza z konštanty CMDK_NAV,
       nikdy z dopytu — do `location.href` sa nesmie dostať nič, čo napísal človek.
       Paletu zatvárame pred odchodom: keby navigáciu niečo zdržalo, otvorená paleta
       nad odchádzajúcou stránkou vyzerá ako zaseknutý klik. */
    root.querySelectorAll('.cmdk-item[data-url]').forEach((el) => {
        el.onclick = () => { closeCmdk(); location.href = el.dataset.url; };
    });
    root.querySelectorAll('.cmdk-item[data-id]').forEach((el) => {
        el.onclick = () => {
            closeCmdk();
            openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: el.dataset.type });
        };
    });
    root.querySelectorAll('.cmdk-item[data-pb]').forEach((el) => {
        el.onclick = () => {
            const holder = el.closest('#cmdk-remote');
            const books = (holder && holder._books) || [];
            const b = books[+el.dataset.pb];
            if (b && b.node_id != null) {
                closeCmdk();
                openNodeFromAnywhere({ id: b.node_id, label: b.title || b.path, type: 'skill' });
            }
        };
    });
    root.querySelectorAll('.cmdk-item[data-action="directive"]').forEach((el) => {
        el.onclick = () => {
            const q = ($('cmdk-input').value || '').trim();
            closeCmdk();
            gotoDirective(q);
        };
    });
    /* Otvorenie vlákna. `uuid` ide z odpovede servera, nikdy z dopytu, a napriek tomu
       sa validuje: do `location.href` nesmie ísť nič, čo nemá tvar uuid — keby sa raz
       zmenil tvar odpovede, nemá to skončiť presmerovaním niekam inam. */
    root.querySelectorAll('.cmdk-item[data-thread]').forEach((el) => {
        el.onclick = () => {
            const id = el.dataset.thread || '';
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
            closeCmdk();
            location.href = '/chat/' + id;
        };
    });
    /* Nové vlákno: vlákno zakladá SERVER a paleta ide na jeho uuid. Skratka na
       `/chat` bez uuid by nechala založenie na druhej ploche, takže by vznikli dve
       cesty k tomu istému a jedna z nich by sa raz rozišla. Pri zlyhaní sa paleta
       nezatvára a povie to — mlčky zavretá paleta vyzerá ako úspech. */
    root.querySelectorAll('.cmdk-item[data-action="new-thread"]').forEach((el) => {
        el.onclick = async () => {
            const done = await newCharonThread();
            if (done) closeCmdk();
        };
    });
    /* Synchronizácia beží cez doSync() z obrazovky Dnes — je to jediný zdroj pravdy
       pre POST /api/sync (vrátane 423 „už beží" a toastov). Druhá kópia tej logiky
       v palete je presne to, čo audit tejto appky opakovane našiel ako príčinu
       rozchodu dvoch plôch. Paletu zatvárame hneď: sync trvá a jeho výsledok hlási
       toast, nie otvorená paleta. */
    root.querySelectorAll('.cmdk-item[data-action="sync"]').forEach((el) => {
        el.onclick = () => { closeCmdk(); doSync(null); };
    });
}

async function newCharonThread() {
    try {
        const res = await fetch('/api/console/threads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': (document.querySelector('meta[name="csrf-token"]') || {}).content || '',
            },
            body: '{}',
        });
        const data = await res.json().catch(() => ({}));
        const id = data.uuid || (data.thread && data.thread.uuid);
        if (!res.ok || !id) { showToast('Vlákno sa nepodarilo založiť', null, 'error'); return false; }
        location.href = '/chat/' + id;
        return true;
    } catch (e) {
        showToast('Vlákno sa nepodarilo založiť', null, 'error');
        return false;
    }
}

/* Vlastná kópia mapy typov je zrušená — jediný zdroj je TYPE_NAMES v util.js,
   čítaný cez hoistovanú typeName(). Eager alias by tu bol pasca: const sa vyhodnotí
   pri načítaní modulu a util.js je súčasťou cyklov (importuje render.js aj sim.js),
   takže by mohol byť undefined. Pravidlo projektu je jasné — cez cyklus sa ťahajú
   HOISTOVANÉ funkcie, nie hodnoty. */
export const CMDK_TYPE_ICO = { core: 'core', skill: 'bolt', memory: 'chip', project: 'box' };
export function cmdkGroup(t) { return '<div class="cmdk-group">' + t + '</div>'; }

export function renderCmdk(q) {
    const query = (q || '').trim();
    const ql = query.toLowerCase();
    const wrap = $('cmdk-results');

    const nav = CMDK_NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql));
    let html = '';
    if (nav.length) {
        html += cmdkGroup('Prejsť na')
            + nav.map((n) => '<button type="button" class="cmdk-item" '
                + (n.url ? 'data-url="' + esc(n.url) + '"' : 'data-nav="' + n.screen + '"') + '>'
                + iconMarkup(n.icon)
                + '<span class="cmdk-text"><span class="cmdk-title">' + esc(n.label) + '</span>'
                + (n.sub ? '<span class="cmdk-sub">' + esc(n.sub) + '</span>' : '')
                + '</span></button>').join('');
    }
    /* AKCIE. Do 28. 8. 2026 tu bola jedna (smernica) a skupina sa volala „Akcia“.
       Paleta je odteraz jediný vstup na navigáciu AJ na akcie (kontrakt D3), takže
       skupina je množná a nesie tri.

       Filtruje sa podľa `keys` a nie podľa titulku: titulok „Vytvor smernicu“ by na
       dopyt „sync“ nenašiel nič, hoci akcia existuje. Kľúče sú synonymá, ktoré
       človek reálne napíše. */
    const actions = [
        { id: 'directive', icon: 'clipboard', keys: 'smernica direktiva prompt claude kontext',
            label: 'Vytvor smernicu', echo: true,
            sub: 'Poskladá kontext pre Claude Code' },
        { id: 'new-thread', icon: 'send', keys: 'vlakno charon chat nove konverzacia',
            label: 'Nové vlákno Charóna', sub: 'Otvorí čistú konverzáciu s vedomím' },
        { id: 'sync', icon: 'refresh', keys: 'synchronizovat sync pamat obnovit',
            label: 'Synchronizovať pamäť', sub: 'Načíta nové poznatky zo sessions' },
    /* Filtruje sa podľa `keys` a `label` — NIKDY podľa vykresleného titulku.
       Smernica si dopyt vpisuje do titulku (`echo`), takže titulok obsahuje dopyt
       vždy a podmienka nad ním by prepustila každú akciu na každé slovo: zmerané,
       na „sync" vychádzali dve akcie namiesto jednej. */
    ].filter((a) => !ql || a.keys.includes(ql) || a.label.toLowerCase().includes(ql));
    if (actions.length) {
        html += cmdkGroup('Akcie')
            + actions.map((a) => '<button type="button" class="cmdk-item" data-action="' + a.id + '">'
                + iconMarkup(a.icon)
                + '<span class="cmdk-text"><span class="cmdk-title">'
                + esc(a.label) + (a.echo ? (query ? ': ' + esc(query) : '…') : '') + '</span>'
                + '<span class="cmdk-sub">' + esc(a.sub) + '</span></span></button>').join('');
    }
    /* POSLEDNÉ VLÁKNA sa kreslia z KEŠE, teda okamžite a bez debouncu — sú to
       navigačné cieľe ako destinácie railu, nie výsledok hľadania. Keš plní
       openCmdk(); kým nie je, skupina sa nekreslí vôbec (prázdna skupina učí, že
       vlákna neexistujú). */
    const threads = cmdkThreads
        .filter((t) => !ql || (t.title || '').toLowerCase().includes(ql))
        .slice(0, 5);
    if (threads.length) {
        html += cmdkGroup('Posledné vlákna')
            + threads.map((t) => '<button type="button" class="cmdk-item" data-thread="' + esc(t.uuid) + '">'
                + iconMarkup('send')
                + '<span class="cmdk-text"><span class="cmdk-title">' + esc(plainInline(t.title || 'Nové vlákno')) + '</span>'
                + '<span class="cmdk-sub">' + esc(t.model || 'Charón') + '</span></span></button>').join('');
    }
    html += '<div id="cmdk-remote"></div>';
    wrap.innerHTML = html;
    bindCmdkItems(wrap);

    // vzdialené hľadanie — jeden zdroj pravdy: SK-aware /api/search (uzly + playbooky).
    // Debounce 180 ms, od 2 znakov; nav ostáva okamžitá.
    clearTimeout(cmdkTimer);
    const seq = ++cmdkSeq;
    if (query.length < 2) { cmdkPending = false; return; }
    cmdkPending = true;
    const remote = $('cmdk-remote');
    if (remote) remote.innerHTML = '<div class="cmdk-hint-row">Hľadanie…</div>';
    cmdkTimer = setTimeout(async () => {
        try {
            const data = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
            if (seq !== cmdkSeq) return;
            const box = $('cmdk-remote');
            if (!box) return;
            const nodes = data.nodes || [];
            const books = data.playbooks || [];
            let h = '';
            const pf = parseQueryFilter(query);
            const filtered = (pf.cert || pf.tag)
                ? nodes.filter((n) => certTagMatch(n, pf))
                : nodes;
            if (filtered.length) {
                h += cmdkGroup('Uzly')
                    + filtered.map((n) => '<button type="button" class="cmdk-item" data-id="' + n.id + '"'
                        + ' data-label="' + esc(n.label || '') + '" data-type="' + esc(n.type || 'skill') + '">'
                        + iconMarkup(CMDK_TYPE_ICO[n.type] || 'hub')
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(plainInline(prettyProject(n.label)))
                        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '') + '</span>'
                        + '<span class="cmdk-sub">' + (n.snippet ? esc(plainText(n.snippet)) : esc(typeName(n.type))) + '</span>'
                        + '</span></button>').join('');
            }
            if (books.length) {
                h += cmdkGroup('Playbooky')
                    + books.map((b, i) => '<button type="button" class="cmdk-item" data-pb="' + i + '">'
                        + iconMarkup('book')
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(plainInline(b.title || b.path || '')) + '</span>'
                        + (b.snippet ? '<span class="cmdk-sub">' + esc(plainText(b.snippet)) + '</span>' : '')
                        + '</span></button>').join('');
            }
            if (!filtered.length && !books.length) h = emptyHtml('magnifier-off', 'Nič sa nenašlo');
            box.innerHTML = h;
            box._books = books;
            bindCmdkItems(box);
        } catch (e) { /* offline nevadí */ }
        // Dopyt dobehol (aj keď naprázdno alebo do chyby) — Enter už smie padnúť na
        // akciu. Strážime `seq`: stará odpoveď nesmie odklepnúť čakanie novšieho dopytu.
        finally { if (seq === cmdkSeq) cmdkPending = false; }
    }, 180);
}
