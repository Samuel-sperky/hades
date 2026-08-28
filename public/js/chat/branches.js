/* ===========================================================================
   Chat — vetvy vlákna.

   Vetva vzniká tak, že človek upraví VLASTNÚ správu a nechá odpovedať znova.
   Pôvodná vetva zostáva celá, vrátane svojho pokračovania; nová dedí všetko
   pred upravenou správou. Presne to robí `console_branches` na serveri
   (`BranchController`), tento modul je jeho plocha.

   ČO TENTO SÚBOR NEROBÍ: nezapisuje správy. Odbočenie je `POST
   /api/console/threads/{uuid}/branches`, teda zápis do `console_branches` a
   prepnutie aktívnej vetvy — nič viac. Upravenú správu odošle bežný beh, tou
   istou udalosťou `chat:submit`, akou ju odosiela composer. Keby si vetvenie
   správu zapisovalo samo, bol by z neho druhý pisateľ do `console_messages`
   vedľa `AgentRunner`a, teda druhá cesta k modelu (kontrakt §4).

   NA KTOREJ VETVE ČLOVEK STOJÍ, MUSÍ BYŤ VIDNO. Bez toho je vetvenie horšie než
   žiadne: konverzácia sa tichom rozdvojí a človek nevie, ktorá polovica mu
   odpovedá. Preto je prepínač PÁS pod hlavičkou, nie plávajúca ponuka — je
   vidno vždy, keď vlákno má viac než jednu vetvu, a aktívna vetva na ňom nesie
   `aria-current="true"`.

   Rozhodnutie o názvoch: vetvy sa v DB nemenujú (nesú `uuid`, `root`,
   `forked_from_message_id`). „Hlavná" a „Vetva 2" sú teda SLOVÁ tejto plochy
   nad poradím, ktoré posiela server (`ORDER BY id`) — nie vymyslené dáta.
   Vymyslený názov by bol pekný a nikto by nevedel, čo znamená.

   Všetko sú HOISTOVANÉ `export function` — graf modulov chatu je cyklický.
   =========================================================================== */

import { el } from './render.js';
import { announce, live, streamHost } from './main.js';
import { loadThread } from './run.js';
import { api, errorLine, plural, whenLabel } from './threads.js';
/* Query string. `mind/urlstate.js` je jediné miesto v repe, ktoré ho číta aj
   píše (rozhodnutie 31), a je to čistý modul nad `URLSearchParams`. */
import { urlValue, writeUrl } from '../mind/urlstate.js';
import { iconSvg } from '../shared/icons.js';

/* ---------------------------------------------------------------------------
   STAV
   --------------------------------------------------------------------------- */

const B = {
    /** uuid otvoreného vlákna, alebo ''. */
    thread: '',
    /** Odpoveď `/branches`: { active, branches[] }. */
    data: null,
    /** Rozpracovaná editácia: id správy, od ktorej sa vetví. */
    editing: 0,

    /** Posledné hlásenie pásu (typicky 409 zo servera), alebo ''. */
    message: '',
};

/** Prebehla inicializácia? `bootBranches()` je idempotentné. */
let booted = false;

/* Sú listenery pripojené? `wireBranches()` sa volá DVAKRÁT: raz z `boot()`
   kostry a raz z `bootBranches()` (obe cesty existujú zámerne, poradie
   drôtovania nesmie rozhodovať). Bez tejto stráže mal každý listener dvojníka —
   zmerané: jedno `Naspäť` poslalo `POST /activate` DVA razy a každé načítanie
   vlákna dva razy `GET /branches`. Pri mutácii to nie je len zbytočný request:
   je to dvojitý zápis do `console_threads.active_branch_id`. */
let wired = false;

/** Debounce obnovy pásu — počty správ vo vetve sa hýbu po každom ťahu. */
let refreshTimer = 0;

/* ---------------------------------------------------------------------------
   PÁS VETIEV

   Vkladá sa do `#chat-main` medzi hlavičku a tok správ. Z JS a nie z blade
   preto, že `resources/views/chat.blade.php` drží iná koľaj tejto vlny; keď sa
   pás do šablóny presunie, tento blok zmizne a `paintBar()` zostane.

   `#chat-main` je flex column a tok má `flex: 1`, takže pás si vezme presne
   svoju výšku a tok sa o ňu zmenší — bez `position` a bez počítania.
   --------------------------------------------------------------------------- */

export function ensureBar() {
    const main = document.getElementById('chat-main');
    if (!main) return null;

    let bar = document.getElementById('chat-branchbar');

    if (!bar) {
        bar = el('div', 'cb-bar');
        bar.id = 'chat-branchbar';
        bar.hidden = true;
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Vetvy vlákna');

        main.insertBefore(bar, document.getElementById('chat-stream'));
    }

    return bar;
}

/**
 * Pás z aktuálneho stavu.
 *
 * Jedna vetva = žiadny pás. Vlákno, ktoré sa nikdy nerozdvojilo, nemá o čom
 * prepínať a `uuid` jedinej vetvy je údaj bez informácie (ten istý dôvod, z
 * akého ho vynecháva hlavička exportu v `ChatScreen::exportHead()`).
 */
export function paintBar() {
    const bar = ensureBar();
    if (!bar) return;

    const list = Array.isArray(B.data?.branches) ? B.data.branches : [];

    bar.replaceChildren();

    if (B.thread === '' || list.length < 2) {
        bar.hidden = true;

        return;
    }

    bar.hidden = false;
    bar.append(el('span', 'cb-lbl', 'Vetvy'));

    const active = list.find((branch) => branch.uuid === B.data.active) || null;

    list.forEach((branch, index) => bar.append(pill(branch, index, branch.uuid === B.data.active)));

    // Zmazať sa dá len vetva, na ktorej človek stojí, a nikdy korenná — s tou by
    // kaskáda vzala celú konverzáciu, čo je „zmazať vlákno" pod iným menom
    // (server to odmietne 422, ale tlačidlo, ktoré vždy zlyhá, je lož).
    if (active && !active.root) bar.append(dropButton(active));

    bar.append(barMessage());
}

function pill(branch, index, on) {
    const btn = el('button', 'cb-pill');

    btn.type = 'button';
    btn.append(el('span', 'cb-name', branchName(branch, index)));
    btn.append(el('span', 'cb-n', String(branch.messages ?? 0)));

    if (on) {
        btn.setAttribute('aria-current', 'true');
        btn.classList.add('on');
    }

    btn.title = pillTitle(branch, on);
    btn.addEventListener('click', () => {
        if (on) return;

        activate(branch.uuid);
    });

    return btn;
}

/** „Hlavná" / „Vetva 2" — poradie je zo servera, meno je slovo tejto plochy. */
export function branchName(branch, index) {
    return branch.root ? 'Hlavná' : `Vetva ${index + 1}`;
}

function pillTitle(branch, on) {
    const bits = [];
    const count = branch.messages ?? 0;

    bits.push(`${count} ${plural(count, 'správa', 'správy', 'správ')}`);

    // `forked_from_message_id` je posledná DEDENÁ správa. `0` znamená „nededí
    // nič", teda odbočenie pri prvej správe vlákna.
    if (!branch.root) {
        bits.push(branch.forked_from_message_id
            ? `odbočená za správou #${branch.forked_from_message_id}`
            : 'odbočená od začiatku vlákna');
    }

    if (branch.created_at) bits.push(`vznikla ${whenLabel(branch.created_at)}`);
    bits.push(on ? 'práve na nej stojíš' : 'klikni pre prepnutie');

    return bits.join(' · ');
}

/**
 * Hlásenie pásu. Vetvenie aj prepínanie server ODMIETNE, kým vo vlákne beží ťah
 * alebo čaká nedorozhodnutý zápis (409) — a to nie je chyba klienta, ale vec,
 * ktorú musí človek vidieť na tom istom mieste, kde klikol.
 */
function barMessage() {
    const note = el('p', 'cb-msg', B.message || '');

    note.id = 'chat-branch-msg';
    note.hidden = !B.message;
    // ZÁMERNE bez `role="status"`: ohlasovanie drží `live()` do jedného
    // zdieľaného regiónu (`#chat-live`). Dva `polite` regióny naplnené v tom
    // istom volaní si vetu prekričia — viď `say()`.

    return note;
}

/**
 * Jedna veta o vetvách — a hlási sa RAZ.
 *
 * Do 25. 8. 2026 tu bolo `role="status"` na `#chat-branch-msg` **a** zároveň
 * `live(text)` do zdieľaného `#chat-live`. Dva `polite` regióny naplnené v tom
 * istom volaní si hlásenia prekričia: čítačka ich zaradí do frontu za sebou a
 * človek dostane tú istú vetu dvakrát, alebo — pri rýchlom druhom hlásení —
 * ani raz. Text preto zostáva VIDITEĽNÝ v `#chat-branch-msg`, ale ten prvok už
 * nie je `role="status"` (viď `messageNode()`); ohlasuje sa výhradne cez `live()`.
 */
function say(text) {
    B.message = text || '';

    const note = document.getElementById('chat-branch-msg');

    if (note) {
        note.textContent = B.message;
        note.hidden = B.message === '';
    }

    if (text) live(text);
}

/** Zmazanie vetvy na dva kliky — ten istý vzor ako riadky v paneli vlákien. */
function dropButton(branch) {
    const btn = el('button', 'cb-drop', 'Zmazať vetvu');
    btn.type = 'button';

    let timer = 0;

    const disarm = () => {
        clearTimeout(timer);
        btn.classList.remove('armed');
        btn.textContent = 'Zmazať vetvu';
    };

    btn.addEventListener('click', async () => {
        if (!btn.classList.contains('armed')) {
            btn.classList.add('armed');
            btn.textContent = 'Naozaj? Správy vetvy zmiznú';
            timer = setTimeout(() => { if (btn.isConnected) disarm(); }, 3000);

            return;
        }

        disarm();

        const res = await api(`/api/console/branches/${branch.uuid}`, { method: 'DELETE' });

        if (!res.ok) {
            say(errorLine(res, 'Vetvu sa nepodarilo zmazať'));

            return;
        }

        say('');
        // Aktívnou sa na serveri stala rodičovská vetva, takže tok treba
        // prečítať znova — z DB, nie zo toho, čo má prehliadač na obrazovke.
        await loadThread(B.thread);
        live('Vetva je zmazaná.');
    });

    return btn;
}

/* ---------------------------------------------------------------------------
   PREPNUTIE
   --------------------------------------------------------------------------- */

/**
 * Prepnutie vetvy.
 *
 * AKTÍVNA VETVA JE STAV SERVERA (`console_threads.active_branch_id`), nie stav
 * adresy. Kľúč `b` je preto ČÍTACÍ: hovorí, na ktorej vetve čitateľ stojí, ale
 * sám nič neprepína. Jediná klientská cesta k prepnutiu je tento `POST`, teda
 * mutácia — a mutácia sa nesmie stať tým, že si niekto otvorí odkaz.
 *
 * Zápis do adresy je až PO potvrdení serverom a je to `pushState`: prepnutie
 * vetvy JE navigácia (rozhodnutie 10), takže `Naspäť` má vrátiť predchádzajúcu
 * vetvu. Preto tiež až po odpovedi — adresa nikdy nesmie tvrdiť vetvu, ktorú
 * server odmietol (409, kým vo vlákne beží ťah alebo čaká zápis).
 *
 * `record: false` je cesta z `popstate`: tam sa adresa už zmenila prehliadačom
 * a druhý záznam by z jedného `Naspäť` urobil dva.
 *
 * Rozsahy `from_message_id`–`to_message_id` v `runs` tým nie sú ohrozené: vetva
 * sa neprepisuje ani nevkládá do stredu, mení sa len to, KTORÉ správy sú
 * história — a to číta `AgentRunner::history()` cez `branchMessages()` zo DB.
 * Adresa o výbere správ nerozhoduje, len o polohe čitateľa.
 */
export async function activate(uuid, { record = true } = {}) {
    const res = await api(`/api/console/branches/${uuid}/activate`, { method: 'POST' });

    if (!res.ok) {
        say(errorLine(res, 'Vetvu sa nepodarilo prepnúť'));

        return;
    }

    say('');
    if (record) writeUrl({ b: uuid }, 'push');

    // Prepnutie vetvy nemení správy, mení to, ktoré z nich sú história — takže
    // sa vlákno načíta znova a tok sa poskládá zo serveru.
    await loadThread(B.thread);

    /* Fokus musí prežiť prekreslenie pásu. `loadThread()` vydá `chat:thread`,
       `paintBar()` postaví pás znova a prvok, ktorý fokus držal, prestane
       existovať — takže po prepnutí klávesnicou padol fokus na `<body>`. Je to tá
       istá trieda nálezu ako P3 (fokus po rozhodnutí o zápise) a lieči sa rovnako:
       vráť ho na tú vetvu, na ktorú človek prepol. Prepnutie myšou tým nič
       nestratí — prvok pod kurzorom je ten istý. */
    // Pilulka práve prepnutej vetvy je tá s `aria-current` — pás si ho nastavuje
    // sám v `pill()`, takže netreba pridávať druhý identifikátor na to isté.
    document.querySelector('#chat-branchbar .cb-pill[aria-current="true"]')?.focus();
    live('Prepnuté na inú vetvu konverzácie.');
}

/* ---------------------------------------------------------------------------
   NAČÍTANIE
   --------------------------------------------------------------------------- */

export async function loadBranches(uuid) {
    B.thread = String(uuid || '');

    if (B.thread === '') {
        B.data = null;
        paintBar();

        return;
    }

    const res = await api(`/api/console/threads/${B.thread}/branches`);

    if (!res.ok) {
        // Zoznam vetiev nie je nutný na to, aby sa dalo písať; pás preto
        // zmizne, ale hlásenie nezmizne bez slova — ide do `live()`.
        B.data = null;
        paintBar();
        live(errorLine(res, 'Vetvy vlákna sa nepodarilo načítať'));

        return;
    }

    B.data = res.data;
    paintBar();
    reconcileBranchUrl();
}

/**
 * Adresa proti serveru — a pravdu má server.
 *
 * `b` je čítací kľúč, takže pri načítaní stránky sa NEAKTIVUJE nič (nula
 * requestov na `/activate`). Keď adresa menuje inú vetvu, než ktorú má vlákno
 * aktívnu, adresa lže a **skráti sa**; neznáme uuid sa zahodí bez slova, existujúcu
 * vetvu človek dostane vysvetlenú, pretože si ju z odkazu zjavne vybral.
 *
 * Rozšíriť `b` na čítaciu serverovú cestu (zobraziť vetvu bez toho, aby sa stala
 * aktívnou) je rozhodnutie používateľa — dnes taká route neexistuje a jediná
 * cesta je mutácia.
 */
export function reconcileBranchUrl() {
    // `urlValue()` vracia `null`, keď kľúč v adrese nie je alebo je neplatný —
    // pre túto plochu je to to isté ako „nič": `''`.
    const wanted = urlValue('b') || '';
    const active = B.data?.active || '';

    if (wanted === '' || wanted === active) return;

    const known = (Array.isArray(B.data?.branches) ? B.data.branches : [])
        .some((branch) => branch.uuid === wanted);

    if (known) say('Odkaz ukazoval na inú vetvu. Zobrazená je tá, ktorá je vo vlákne aktívna.');

    writeUrl({ b: active || null }, 'replace');
}

/**
 * `Naspäť` / `Dopredu` medzi vetvami.
 *
 * `popstate` NIE JE načítanie stránky — je to navigačné gesto človeka, tej istej
 * triedy ako klik na pilulku. Preto sa tu prepnutie vykoná (a `record: false`,
 * lebo adresu už zmenil prehliadač). Bez toho by `Naspäť` po prepnutí vetvy
 * nevrátilo nič a záznam v histórii by bol dekorácia.
 *
 * Pri načítaní stránky sa táto cesta nezavolá: `popstate` vtedy nepríde.
 */
export function branchFromHistory() {
    const wanted = urlValue('b') || '';
    if (wanted === '' || B.thread === '' || !B.data) return;
    if (wanted === (B.data.active || '')) return;

    const known = (Array.isArray(B.data.branches) ? B.data.branches : [])
        .some((branch) => branch.uuid === wanted);

    if (known) activate(wanted, { record: false });
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (B.thread) loadBranches(B.thread); }, 600);
}

/* ---------------------------------------------------------------------------
   EDITÁCIA VLASTNEJ SPRÁVY

   Tlačidlo „Upraviť" sa pripája k bublinám `.cm-user`, ktoré kreslí
   `render.js`. Id správy sa berie z `data-mid`, keď ho bublina má; keď nie,
   páruje sa PORADÍM — `renderThreadBody()` prechádza `data.messages` v poradí
   a bubliny človeka pridáva presne v ňom, takže n-tá bublina `.cm-user` je
   n-tá správa `role === 'user'`.

   Je to väzba na cudzí modul a preto je napísaná nahlas: keď `pushUser()` raz
   dostane `data-mid`, táto vetva sama odpadne (prednosť má atribút). Diff, ktorý
   to urobí, je v odovzdávacej poznámke tejto vlny.

   Bublina, ktorá práve teraz odišla za behu, id ešte nemá a NEDOSTANE tlačidlo:
   vetviť sa dá od správy, ktorú server naozaj zapísal.
   --------------------------------------------------------------------------- */

export function attachEdit(data) {
    const stream = streamHost();
    if (!stream) return;

    const ids = (Array.isArray(data?.messages) ? data.messages : [])
        .filter((message) => message.role === 'user')
        .map((message) => message.id);

    [...stream.querySelectorAll('.cm-user')].forEach((box, index) => {
        const mid = Number(box.dataset.mid || ids[index] || 0);

        if (!Number.isFinite(mid) || mid <= 0) return;

        box.dataset.mid = String(mid);
        if (box.querySelector(':scope > .cb-edit')) return;

        const btn = el('button', 'cb-edit');
        btn.append(iconSvg('pencil'));

        btn.type = 'button';
        btn.title = 'Upraviť správu a odpovedať znovu';
        btn.setAttribute('aria-label', 'Upraviť správu a odpovedať znovu');
        btn.addEventListener('click', () => openEditor(box, mid));

        box.append(btn);
    });
}

/**
 * Editor namiesto bubliny. Pôvodná bublina sa SKRÝVA, nie prepisuje: keď človek
 * editáciu zruší, musí sa vrátiť presne to, čo napísal, a nie to, čo som z toho
 * poskládal späť.
 */
function openEditor(box, mid) {
    if (B.editing === mid) return;

    B.editing = mid;

    const bubble = box.querySelector('.cm-bubble');
    const button = box.querySelector(':scope > .cb-edit');
    const form = el('form', 'cb-form');
    const field = el('textarea', 'cb-ta');

    field.value = bubble?.textContent ?? '';
    field.rows = Math.min(12, Math.max(2, String(field.value).split('\n').length + 1));
    field.setAttribute('aria-label', 'Upravená správa');

    const row = el('div', 'cb-form-row');
    const send = el('button', 'cb-go', 'Odpovedať znovu');
    send.type = 'submit';

    const cancel = el('button', 'cb-cancel', 'Zrušiť');
    cancel.type = 'button';

    const note = el('p', 'cb-form-note', 'Pôvodná verzia zostane vo vlastnej vetve.');

    row.append(send, cancel);
    form.append(field, row, note);

    const close = () => {
        B.editing = 0;
        form.remove();
        if (bubble) bubble.hidden = false;
        if (button) button.hidden = false;
        button?.focus();
    };

    cancel.addEventListener('click', close);

    // Esc ruší LEN editor a nesmie prebublať na globálny Esc — ten zastavuje beh
    // a zamieta zaparkovaný zápis, čo je iná vec než „nechaj moju správu, ako bola".
    field.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();

            return;
        }

        // Enter posiela, Shift+Enter je nový riadok — to isté, čo composer.
        // `isComposing` je povinné: pri písaní s IME Enter potvrdzuje rozpísaný
        // znak a odoslanie by vetu rozstrieľalo.
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            form.requestSubmit();
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const text = field.value.trim();

        if (text === '') {
            note.textContent = 'Prázdna správa sa poslať nedá.';
            note.classList.add('is-err');

            return;
        }

        send.disabled = true;
        note.classList.remove('is-err');
        note.textContent = 'Zakladám vetvu…';

        const ok = await fork(mid, text);

        if (!ok) {
            send.disabled = false;
            note.textContent = B.message || 'Vetvu sa nepodarilo založiť.';
            note.classList.add('is-err');
        }
        // Pri úspechu sa tok prekreslil celý (`loadThread`), takže tento formulár
        // v DOM už nie je a zatvárať ho netreba.
    });

    if (bubble) bubble.hidden = true;
    if (button) button.hidden = true;
    box.append(form);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
}

/**
 * Odbočenie a nový ťah.
 *
 * Poradie je celý zmysel: najprv sa vetva založí a aktivuje na SERVERI, potom sa
 * vlákno prečíta znova (nová vetva dedí správy pred upravenou, tá upravená v nej
 * ešte nie je), a až potom ide zadanie bežnou cestou — udalosťou `chat:submit`,
 * teda tou istou, akou ho posiela composer. Bez tohto poradia by odpoveď pribudla
 * do starej vetvy a „pôvodná zostáva" by bola lož.
 */
async function fork(mid, text) {
    const res = await api(`/api/console/threads/${B.thread}/branches`, {
        method: 'POST',
        body: { message: mid },
    });

    if (!res.ok) {
        // 409 znamená „vlákno je zaneprázdnené" (beží ťah alebo čaká zápis) a
        // server posiela hotovú slovenskú vetu — nemá ju čo prepisovať klient.
        say(errorLine(res, 'Vetvu sa nepodarilo založiť'));

        return false;
    }

    say('');
    B.editing = 0;

    // `loadThread` dispatchne `chat:thread`, takže pás vetiev aj tlačidlá
    // „Upraviť" sa obnovia z toho listenera — druhé volanie `loadBranches()`
    // by bol ten istý dopyt dvakrát.
    await loadThread(B.thread);

    document.dispatchEvent(new CustomEvent('chat:submit', { detail: { text } }));
    announce('Nová vetva konverzácie. Odpoveď sa generuje znovu.');

    return true;
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

export function wireBranches() {
    if (wired) return;
    wired = true;

    // `chat:thread` prichádza po tom, čo `render.js` poskládal tok — takže
    // bubliny, ku ktorým sa tlačidlo pripája, už v DOM sú.
    document.addEventListener('chat:thread', (event) => {
        const data = event.detail || {};

        B.message = '';
        attachEdit(data);
        loadBranches(data.uuid || '');
    });

    // Počty správ vo vetve sa po každom ťahu menia; pás by inak tvrdil staré číslo.
    document.addEventListener('chat:thread-touched', scheduleRefresh);

    // Adresa bez uuid = žiadne vlákno na obrazovke. Bez tohto by pás visel nad
    // prázdnym stavom a nabízel prepínanie vetiev vlákna, ktoré nie je otvorené.
    window.addEventListener('popstate', () => {
        if (/^\/chat\/?$/.test(location.pathname)) {
            loadBranches('');

            return;
        }

        branchFromHistory();
    });
}

/** Idempotentné — na poradí drôtovania kostry nezávisí. */
export function bootBranches() {
    if (booted) return;
    booted = true;

    ensureBar();
    wireBranches();
}

/* Tá istá dvojica ciest ako v `threads.js`: `chat:ready`, keď plocha stojí, a
   makrotask ako záloha, keď sa modul načíta až po tej udalosti. */
document.addEventListener('chat:ready', bootBranches);
setTimeout(bootBranches, 0);
