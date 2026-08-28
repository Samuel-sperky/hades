/* ===========================================================================
   Chat — prílohy.

   ČO TENTO SÚBOR JE: vstupná časť composera pre súbory. Tlačidlo, ťahanie do
   plochy, vloženie zo schránky, čipy rozpracovaných príloh s náhľadom obrázku
   a stavom textu PDF, odobranie.

   ČO NIE JE: druhá cesta k modelu. Prílohy majú vlastný okruh
   (`/api/console/threads/{uuid}/attachments`, `/api/console/attachments/{uuid}`)
   a vlastnú hlásku pod vstupom; beh ide výhradne cez `run.js` nad zdieľaným
   `public/js/shared/runclient.js` (kontrakt §4). Preto je tu vlastný `api()` —
   nie preto, aby existoval druhý transport, ale preto, že `request()` v `run.js`
   telo serializuje na JSON (upload je `multipart/form-data`) a chyby hlási do
   TOKU správ, kým chyba priloženia patrí pod vstup, kde človek práve stojí.

   ## Serverová pravda a čo z nej UI len opakuje

   Hranicu drží `app/Services/Console/Attachments.php` a
   `AttachmentController`: typ sa zisťuje na serveri (`finfo`), whitelist je
   tam, stropy sú tam. Tento modul **nič z toho nerozhoduje** — len to hovorí
   DOPREDU, aby človek nedostal odmietnutie po tridsiatich sekundách nahrávania
   10 MB súboru. Kontrola pred odoslaním je preto rada, nie brána: keď
   `File.type` prehliadač nevyplní (bežné pri `.md`), súbor sa pošle a rozhodne
   server.

   Čísla sa čítajú z `#console-attachments` (skládá ho blade zo služby). Keď ten
   blok v HTML nie je, platia defaulty nižšie — sú to hodnoty, ktoré má služba
   dnes v konštantách, a keď sa rozídu, hovorí server. Preto sú tu s menom
   `FALLBACK`, nie `LIMITS`.

   ## Vlákno vzniká pred prvým uploadom

   Prílohy sú per-vlákno (`console_attachments.thread_id`), takže na `/chat` bez
   uuid treba vlákno založiť. Robí to `ensureThread()` z `run.js` — tá istá
   funkcia, akou si ho pred prvým ťahom zakladá odoslanie správy. Druhá cesta
   k zakladaniu vlákna by dala dve vlákna na jedno gesto.

   Všetko sú HOISTOVANÉ `export function` — graf modulov chatu má cyklus
   (`main → run → render → main`) a `export const foo = () => {}` v cykle spadne
   na `ReferenceError: Cannot access 'foo' before initialization`.
   =========================================================================== */

import { el, num } from './render.js';
import { autoGrowPrompt, live } from './main.js';
import { ensureThread } from './run.js';
import { iconSvg } from '../shared/icons.js';

/**
 * Stropy a typy, keď ich server do HTML nedal.
 *
 * Zrkadlia dnešné konštanty `Attachments` (`MAX_BYTES`, `MAX_PER_THREAD`,
 * `MIMES`). Nie je to druhá pravda: keď sa čísla rozídu, odmietne server a jeho
 * veta sa vypíše pod vstupom. Tieto hodnoty rozhodujú len o tom, čo UI povie
 * skôr, než sa niečo pošle.
 */
const FALLBACK = {
    max_bytes: 10 * 1024 * 1024,
    max_per_thread: 20,
    mimes: {
        'text/plain': 'txt',
        'text/markdown': 'md',
        'text/csv': 'csv',
        'application/json': 'json',
        'application/pdf': 'pdf',
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/gif': 'gif',
        'image/webp': 'webp',
    },
};

/** Stav plochy príloh. Vrecko, nie premenné rozsypané po súbore. */
const A = {
    /** uuid otvoreného vlákna, alebo ''. */
    thread: '',
    /** Rozpracované prílohy (`message_id === null`) v poradí vzniku. */
    items: [],
    /** Koľko príloh má vlákno CELKOM — strop na serveri počítá aj odoslané. */
    total: 0,
    /** Práve nahrávané súbory: `{ id, name, size }`. */
    uploading: [],
    /** Posledná hláška pod vstupom (chyba alebo odmietnutie). */
    note: '',
    /** Odišla správa a čipy čakajú na potvrdenie zo servera? */
    sending: false,
};

/** Rozparsované `#console-attachments`, alebo null, kým sa nečítalo. */
let limitCache = null;

/** Poradové číslo rozpracovaného uploadu — čip potrebuje stabilný kľúč. */
let uploadSeq = 0;

/** `objectURL` náhľadov podľa uuid prílohy. Uvolňujú sa, keď čip zmizne. */
const previews = new Map();

/** Prebehla inicializácia? `bootAttach()` je idempotentné. */
let booted = false;

/** Hĺbka `dragenter`/`dragleave` — bez počítadla zháša overlay prvé vnorené dieťa. */
let dragDepth = 0;

/* ---------------------------------------------------------------------------
   STROPY A TYPY
   --------------------------------------------------------------------------- */

/**
 * Stropy zo servera. Číta sa raz — je to statický fakt o hranici, nie endpoint,
 * takže druhý request by bol okruh za nič (ten istý dôvod ako `#console-tools`).
 *
 * @returns {{max_bytes: number, max_per_thread: number, mimes: Object<string, string>}}
 */
export function limits() {
    if (limitCache) return limitCache;

    let raw = {};

    try {
        raw = JSON.parse(document.getElementById('console-attachments')?.textContent || '{}');
    } catch {
        raw = {};
    }

    const mimes = raw && typeof raw.mimes === 'object' && raw.mimes !== null && Object.keys(raw.mimes).length > 0
        ? raw.mimes
        : FALLBACK.mimes;

    limitCache = {
        max_bytes: positive(raw?.max_bytes, FALLBACK.max_bytes),
        max_per_thread: positive(raw?.max_per_thread, FALLBACK.max_per_thread),
        mimes,
    };

    return limitCache;
}

function positive(value, fallback) {
    const n = Number(value);

    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/**
 * Veta o stropoch. JEDNA funkcia pre tlačidlo, pre riadok v páse aj pre overlay
 * ťahania — tri kópie tej istej vety by sa rozišli pri prvej zmene configu.
 */
export function limitsHint() {
    const l = limits();

    return `Do ${humanBytes(l.max_bytes)} na súbor · najviac ${l.max_per_thread} na vlákno · obrázky, PDF a text`;
}

/**
 * `accept` pre dialóg súborov — z tých istých typov, aké prijme server.
 *
 * Prípony sú tam vedľa typov zámerne: `text/markdown` samo o sebe niektoré
 * dialógy `.md` nezobrazia, takže by človek videl prázdny priečinok pri súbore,
 * ktorý by hranica prijala. Prázdna prípona sa vynechá — `accept=".,"` by
 * dialóg pokazil.
 */
function acceptList() {
    const mimes = limits().mimes;
    const extensions = Object.values(mimes)
        .map((ext) => String(ext || '').trim())
        .filter((ext) => ext !== '')
        .map((ext) => `.${ext}`);

    return Object.keys(mimes).concat(extensions).join(',');
}

/**
 * Rada pred odoslaním. Vracia vetu, keď súbor odmietam TU, inak `''`.
 *
 * Typ sa kontroluje len keď ho prehliadač vyplnil. `.md` a `.csv` mávajú
 * `File.type` prázdny a odmietnuť ich tu by znamenalo, že UI je striktnejšie než
 * hranica — teda že sa človek nedostane k súboru, ktorý by server prijal.
 */
export function precheck(file) {
    const l = limits();
    const pending = A.total + A.uploading.length;

    if (pending >= l.max_per_thread) {
        return `Vlákno už má ${l.max_per_thread} príloh — to je strop. Niektorú najprv odober.`;
    }

    if (file.size === 0) {
        return `„${file.name}" je prázdny — nie je čo priložiť.`;
    }

    if (file.size > l.max_bytes) {
        return `„${file.name}" má ${humanBytes(file.size)}; strop je ${humanBytes(l.max_bytes)}.`;
    }

    const type = String(file.type || '').toLowerCase();

    if (type !== '' && !Object.prototype.hasOwnProperty.call(l.mimes, type)) {
        return `„${file.name}" je typ ${type}. Prijímajú sa obrázky, PDF a textové súbory.`;
    }

    return '';
}

/* ---------------------------------------------------------------------------
   HTTP

   Vlastný okruh príloh, nie druhá cesta k behu (viď hlavička súboru).
   --------------------------------------------------------------------------- */

function csrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

/**
 * Jeden request okruhu príloh.
 *
 * `Content-Type` sa pri `FormData` NENASTAVUJE: boundary doňho dopĺňa
 * prehliadač a keby sme hlavičku napísali sami, PHP by v tele nenašlo ani jedno
 * pole. Odpoveď sa parsuje obranne — 413 z PHP/webservera a 500 vracajú HTML.
 *
 * @returns {Promise<{ok: boolean, data: any, message: string}>}
 */
async function api(url, { method = 'GET', body } = {}) {
    const headers = new Headers();

    if (method !== 'GET' && method !== 'HEAD') headers.set('X-CSRF-TOKEN', csrf());

    let res;

    try {
        res = await fetch(url, { method, headers, body });
    } catch {
        return { ok: false, data: null, message: 'Sieťová chyba — Hades neodpovedal.' };
    }

    let data = null;

    try {
        data = await res.json();
    } catch {
        data = null;
    }

    if (res.ok) return { ok: true, data, message: '' };

    return { ok: false, data, message: refusal(data, res.status) };
}

/**
 * Veta k odmietnutiu. Prednosť má text zo servera — je písaný pre človeka
 * (`AttachmentController::MESSAGES`, výnimky z `Attachments`) a je to jediná
 * hláška, ktorú UI pod vstupom vypíše.
 */
function refusal(data, status) {
    const fromServer = data?.message || data?.errors?.file?.[0] || '';

    if (typeof fromServer === 'string' && fromServer !== '') return fromServer;

    if (status === 401) return 'Hades je zamknutý — odomkni ho tokenom (?token=…).';
    if (status === 419) return 'Session vypršala — obnov stránku (F5).';
    // 413 nepríde z Laravelu, ale z webservera pred ním, takže telo nie je JSON.
    if (status === 413) return `Súbor je väčší, než dovolí server. Strop je ${humanBytes(limits().max_bytes)}.`;

    return `Priloženie zlyhalo (HTTP ${status}).`;
}

/* ---------------------------------------------------------------------------
   NAHRÁVANIE
   --------------------------------------------------------------------------- */

/**
 * Priloží súbory. Jeden po druhom, nie paralelne: chyba tak zostane priradená
 * ku konkrétnemu súboru a strop počtu sa počítá nad tým, čo už naozaj prešlo.
 */
export async function addFiles(files) {
    const list = Array.from(files || []).filter((file) => file instanceof File);

    if (list.length === 0) return;

    setNote('');

    const thread = await ensureThread();

    if (!thread) {
        setNote('Vlákno sa nepodarilo založiť — príloha neodišla.');

        return;
    }

    if (thread.uuid !== A.thread) {
        // Vlákno vzniklo až týmto gestom; pás patrí jemu.
        A.thread = thread.uuid;
        A.items = [];
        A.total = 0;
    }

    for (const file of list) {
        const refused = precheck(file);

        if (refused !== '') {
            setNote(refused);
            live(refused);

            continue;
        }

        // `await` v cykle je tu zámer, nie prehliadnutie — viď docblock.
        await uploadOne(file);
    }
}

async function uploadOne(file) {
    const ghost = { id: ++uploadSeq, name: file.name, size: file.size };

    A.uploading.push(ghost);
    paintBar();

    const form = new FormData();
    form.append('file', file);

    const out = await api(`/api/console/threads/${A.thread}/attachments`, { method: 'POST', body: form });

    A.uploading = A.uploading.filter((row) => row.id !== ghost.id);

    if (!out.ok) {
        setNote(out.message);
        live(out.message);
        paintBar();

        return;
    }

    const item = out.data;

    A.items.push(item);
    A.total += 1;

    // Náhľad obrázku z LOKÁLNEHO súboru, nie z `item.url`: bajty sú tie isté
    // a request navyše by príloha nepotrebovala. Po obnove stránky sa čipy
    // skládajú z `item.url` — vtedy File neexistuje.
    if (item?.is_image && previews.get(item.uuid) === undefined) {
        previews.set(item.uuid, URL.createObjectURL(file));
    }

    paintBar();
    live(`Priložené: ${item?.name || file.name}.`);
}

/**
 * Odobranie zo vstupu.
 *
 * Server dovolí zmazať len rozpracovanú prílohu (`message_id === null`) —
 * príloha odoslanej správy je súčasťou histórie a história sa v tomto projekte
 * neprepisuje. Jeho 422 sa vypíše pod vstupom, nie preto, že by sa čakalo, ale
 * preto, že pravdu o tom drží server.
 */
export async function removeAttachment(uuid) {
    const key = String(uuid || '');

    if (key === '') return;

    const out = await api(`/api/console/attachments/${key}`, { method: 'DELETE' });

    if (!out.ok) {
        setNote(out.message);
        live(out.message);

        return;
    }

    dropPreview(key);
    A.items = A.items.filter((item) => item.uuid !== key);
    A.total = Math.max(0, A.total - 1);

    setNote('');
    paintBar();
    live('Príloha odobraná.');
}

/**
 * Prílohy vlákna zo servera. Zdroj pravdy je DB — po obnove stránky sa čipy
 * skládajú odtiaľ, nikdy z localStorage.
 */
export async function loadDrafts(uuid) {
    const key = String(uuid || '');
    const switched = key !== A.thread;

    A.thread = key;
    A.items = [];
    A.total = 0;
    A.sending = false;

    // Rozbehnutý upload a jeho náhľad prežijú obnovu TOHO ISTÉHO vlákna: jeho
    // čip hovorí „nahrávam" a zhasnúť ho v polovici by tvrdilo, že sa priloženie
    // stratilo. Pri prepnutí vlákna to naopak zmizne celé.
    if (switched) {
        A.uploading = [];
        clearPreviews();
    }

    if (key === '') {
        paintBar();

        return;
    }

    // Značka, proti ktorej sa odpoveď overí. Bez nej vzniká závod, ktorý sa
    // NAOZAJ deje: prvé priloženie na `/chat` bez uuid založí vlákno, jeho
    // `chat:thread` spustí tento fetch, a keď sa odpoveď vráti PO uploade, jej
    // (vtedy ešte prázdny) zoznam by práve priložený čip zmazal.
    const seq = uploadSeq;
    const out = await api(`/api/console/threads/${key}/attachments`);

    // Vlákno sa medzitým prepnulo, alebo medzitým začal upload — lokálny stav je
    // v oboch prípadoch novší než táto odpoveď.
    if (!out.ok || A.thread !== key || uploadSeq !== seq) {
        paintBar();

        return;
    }

    const all = Array.isArray(out.data?.attachments) ? out.data.attachments : [];

    A.total = all.length;
    A.items = all.filter((item) => item?.message_id === null || item?.message_id === undefined);

    // Náhľady, ktoré už nemá kto zobraziť (príloha odišla so správou), sa
    // uvolnia — inak by ich bajty držala stránka do zavretia karty.
    const alive = new Set(A.items.map((item) => String(item?.uuid || '')));

    [...previews.keys()].forEach((seen) => {
        if (!alive.has(seen)) dropPreview(seen);
    });

    paintBar();
}

/**
 * uuid rozpracovaných príloh — to, čo má odísť so správou.
 *
 * Väzbu robí server (`Attachments::bindDrafts()`), takže klient posiela IBA
 * uuid: keby posielal obsah alebo text, dal by sa modelu podstrčiť súbor, ktorý
 * nikto nenahral. Hook, ktorý to pripojí do tela `/api/console/run`, je popísaný
 * v odovzdávacej poznámke tejto koľaje.
 *
 * @returns {Array<string>}
 */
export function draftUuids() {
    return A.items.map((item) => String(item?.uuid || '')).filter((uuid) => uuid !== '');
}

/* ---------------------------------------------------------------------------
   KRESBA

   Pás žije v composeri (nad riadkom vstupu) a v DOM je len vtedy, keď má čo
   ukázať — plocha bez príloh tak nemá ani prázdny kontejner.
   --------------------------------------------------------------------------- */

export function ensureBar() {
    const form = document.getElementById('chat-composer');

    if (!form) return null;

    let bar = document.getElementById('chat-attachments');

    if (!bar) {
        bar = el('div', 'cf-bar');
        bar.id = 'chat-attachments';
        bar.hidden = true;
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Prílohy správy');

        // Pred riadok vstupu, nie na začiatok formulára: na začiatku už stojí
        // poradie zadaní (`#chat-queue`, render.js) a pás príloh patrí bližšie
        // k poľu, do ktorého človek píše.
        form.insertBefore(bar, form.querySelector('.cc-row'));
    }

    return bar;
}

export function paintBar() {
    const bar = ensureBar();

    if (!bar) return;

    bar.replaceChildren();

    const rows = A.items.length + A.uploading.length;

    if (rows === 0 && A.note === '') {
        bar.hidden = true;

        return;
    }

    bar.hidden = false;

    if (rows > 0) {
        const list = el('ul', 'cf-list');

        A.items.forEach((item) => list.append(chip(item)));
        A.uploading.forEach((ghost) => list.append(ghostChip(ghost)));

        bar.append(list);
        bar.append(el('p', 'cf-hint', `${limitsHint()} · text z príloh dostane model v prompte.`));
    }

    if (A.note !== '') {
        const note = el('p', 'cf-note', A.note);
        // Chyba priloženia je stav vstupu, nie beh — nesie ju `role="status"`,
        // aby ju čítačka povedala bez toho, aby prekričala oznam o behu.
        note.setAttribute('role', 'status');
        bar.append(note);
    }
}

/** Čip hotovej prílohy. */
function chip(item) {
    const row = el('li', `cf-item${A.sending ? ' is-sending' : ''}`);

    row.dataset.uuid = item.uuid || '';
    row.append(thumb(item));

    const body = el('div', 'cf-body');

    body.append(el('span', 'cf-name', item.name || 'príloha'));
    body.append(el('span', 'cf-meta', metaLine(item)));
    row.append(body);

    const drop = el('button', 'cf-drop');

    drop.type = 'button';
    drop.title = 'Odobrať prílohu';
    drop.setAttribute('aria-label', `Odobrať prílohu ${item.name || ''}`.trim());
    drop.append(icon('close'));
    drop.addEventListener('click', () => { removeAttachment(item.uuid); });
    row.append(drop);

    return row;
}

/** Čip súboru, ktorý sa práve nahráva. */
function ghostChip(ghost) {
    const row = el('li', 'cf-item is-loading');

    row.append(icon('pending', 'cf-icon'));

    const body = el('div', 'cf-body');

    body.append(el('span', 'cf-name', ghost.name));
    body.append(el('span', 'cf-meta', `${humanBytes(ghost.size)} · nahrávam…`));
    row.append(body);

    return row;
}

/**
 * Náhľad. Obrázok ako obrázok, ostatné ikonou.
 *
 * `description` je ikona zo subsetu overená používaním (`shared/gate.js`).
 * `attach_file`, `image` ani `picture_as_pdf` v subsete overené NIE SÚ, takže by
 * sa vykreslili ako svoj ligatúrový názov — presne tá porucha, pre ktorú subset
 * existuje.
 */
function thumb(item) {
    if (!item?.is_image) return icon('file-text', 'cf-icon');

    const src = previews.get(item.uuid) || item.url || '';

    if (src === '') return icon('file-text', 'cf-icon');

    const img = document.createElement('img');

    img.className = 'cf-thumb';
    img.src = src;
    img.alt = `Náhľad prílohy ${item.name || ''}`.trim();
    img.loading = 'lazy';
    img.decoding = 'async';

    return img;
}

/** Druhý riadok čipu: veľkosť a stav textu. */
function metaLine(item) {
    const bits = [humanBytes(Number(item?.size_bytes) || 0)];

    if (A.sending) bits.push('odchádza so správou…');

    const state = textStateLabel(item);

    if (state !== '') bits.push(state);

    return bits.join(' · ');
}

/**
 * Stav vytiahnutého textu — tri hodnoty, ktoré schéma dovoľuje rozlíšiť
 * (`ConsoleAttachment::textState()`), a ani jedna sa nehádá.
 *
 * Obrázok text nemá a ani ho mať nemá (OCR nie je v rozsahu), takže sa o ňom
 * nepíše nič — „text sa nenašiel" by pri fotke znelo ako chyba.
 */
export function textStateLabel(item) {
    if (item?.is_image) return '';

    switch (String(item?.text_state || '')) {
        case 'ready':
            return 'text vytiahnutý';

        case 'no_text':
            // Toto je informácia, ktorú človek potrebuje PRED tým, než sa modelu
            // opýtá na obsah skenovaného PDF.
            return 'text sa nepodarilo vytiahnuť — model ho neuvidí';

        case 'pending':
            return 'text sa ešte nečítal';

        default:
            return '';
    }
}

function icon(name, cls) {
    const mark = iconSvg(name, cls ? { cls } : undefined);

    mark.setAttribute('aria-hidden', 'true');

    return mark;
}

/** Hláška pod vstupom. Prázdna ju zháša. */
export function setNote(text) {
    A.note = String(text ?? '');
    paintBar();
}

export function humanBytes(bytes) {
    const n = Number(bytes) || 0;

    if (n >= 1024 * 1024) return `${num(n / (1024 * 1024))} MB`;

    return `${num(Math.max(1, Math.round(n / 1024)), 0)} kB`;
}

function dropPreview(uuid) {
    const url = previews.get(uuid);

    if (url) URL.revokeObjectURL(url);

    previews.delete(uuid);
}

function clearPreviews() {
    previews.forEach((url) => URL.revokeObjectURL(url));
    previews.clear();
}

/* ---------------------------------------------------------------------------
   OVLÁDAČE
   --------------------------------------------------------------------------- */

/**
 * Tlačidlo a skrytý `<input type="file">` v riadku vstupu.
 *
 * Z JS a nie z blade preto, že `resources/views/chat.blade.php` drží iná koľaj
 * tejto vlny. Keď sa markup do šablóny presune, zmizne táto funkcia a `paintBar()`
 * zostane — to je celý dôvod, prečo je vloženie oddelené od kreslenia.
 */
export function ensureButton() {
    const row = document.querySelector('#chat-composer .cc-row');

    if (!row || document.getElementById('chat-attach')) return;

    const input = document.createElement('input');

    input.type = 'file';
    input.id = 'chat-attach-input';
    input.multiple = true;
    input.accept = acceptList();
    input.hidden = true;
    input.addEventListener('change', () => {
        addFiles(input.files);
        // Reset, inak sa ten istý súbor druhýkrát nevyberie (`change` nepríde).
        input.value = '';
    });

    const btn = el('button', 'cf-btn');

    btn.type = 'button';
    btn.id = 'chat-attach';
    // Strop je v prístupnom mene, nie iba v `title`: na dotyku sa `title`
    // nezobrazí nikdy a odmietnutie po nahraní 10 MB je horšie než veta dopredu.
    btn.title = `Priložiť súbor — ${limitsHint()}`;
    btn.setAttribute('aria-label', `Priložiť súbor. ${limitsHint()}.`);
    btn.append(icon('file-text'));
    btn.addEventListener('click', () => { input.click(); });

    // Naľavo od poľa, teda pred textareu: je to vstup do správy, nie akcia nad
    // ňou (tie sedia vpravo pri Poslať).
    row.prepend(btn);
    row.append(input);
}

/**
 * Ťahanie súborov do plochy.
 *
 * Počúva `#chat-main` a nie `document`: ťahanie nad zoznamom vlákien alebo nad
 * panelom artefaktu neznamená „priložiť do tejto správy". `dragenter`/`dragleave`
 * sa počítajú, pretože prechod nad vnorený element vydá `dragleave` na rodičovi
 * a bez počítadla by overlay zhasol nad prvým odsekom textu.
 */
export function wireDrop() {
    const main = document.getElementById('chat-main');

    if (!main) return;

    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

    main.addEventListener('dragenter', (event) => {
        if (!hasFiles(event)) return;

        event.preventDefault();
        dragDepth += 1;
        main.classList.add('is-dropping');
    });

    main.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;

        // Bez `preventDefault` na `dragover` prehliadač drop nepustí vôbec.
        event.preventDefault();

        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });

    main.addEventListener('dragleave', (event) => {
        if (!hasFiles(event)) return;

        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) main.classList.remove('is-dropping');
    });

    main.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;

        // Bez tohto prehliadač obrázok OTVORÍ a plocha chatu zmizne.
        event.preventDefault();
        dragDepth = 0;
        main.classList.remove('is-dropping');
        addFiles(event.dataTransfer?.files);
    });

    // Overlay hovorí stropy, nie len „pusti sem" — je to tretie miesto tej istej
    // vety a všetky tri ju berú z `limitsHint()`.
    main.dataset.dropHint = `Pusti súbory sem · ${limitsHint()}`;
}

/**
 * Vloženie zo schránky. Screenshot je najčastejšia príloha, akú človek má, a
 * `Ctrl+V` je jediné gesto, ktorým sa dá vložiť — z buffera schránky súbor
 * dialógom nevyberie.
 */
export function wirePaste() {
    document.getElementById('chat-prompt')?.addEventListener('paste', (event) => {
        const files = Array.from(event.clipboardData?.files || []);

        if (files.length === 0) return;

        // Text v schránke sa nepreberá — keby boli v schránke oboje, vloží sa
        // súbor aj text, a to je to, čo človek čaká.
        event.preventDefault();
        addFiles(files);
        autoGrowPrompt();
    });
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

export function bootAttach() {
    if (booted) return;

    booted = true;

    ensureButton();
    wireDrop();
    wirePaste();

    // Vlákno z URL. `chat:ready` nesie uuid; `run.js` doňho o chvíľu pošle celý
    // payload udalosťou `chat:thread`, ale prílohy sú vlastný okruh a nemá zmysel
    // na to čakať.
    loadDrafts(document.querySelector('meta[name="console-thread"]')?.content || '');

    document.addEventListener('chat:thread', (event) => {
        const uuid = String(event.detail?.uuid || '');

        if (uuid !== A.thread) loadDrafts(uuid);
    });

    // Správa odišla. Čipy zostávajú a len zmenia stav: väzbu robí server a kým
    // ju nepotvrdí, tvrdiť „príloha odišla" by bola lož — a keby hook, ktorý uuid
    // do behu pripojí, chýbal, človek to takto uvidí namiesto toho, aby príloha
    // ticho zmizla.
    document.addEventListener('chat:submit', () => {
        if (A.items.length === 0) return;

        A.sending = true;
        paintBar();
    });

    // Ťah dobehol — server už väzbu urobil, takže sa pás skládá znova z DB.
    // Priradené prílohy z neho vypadnú, neodoslané v ňom zostanú.
    document.addEventListener('chat:thread-touched', (event) => {
        const uuid = String(event.detail?.thread || A.thread);

        if (uuid === A.thread) loadDrafts(uuid);
    });

    // Objekt URL náhľadov prežíva len dokument; bez uvolnenia by pri desiatkach
    // obrázkov držala stránka ich bajty až do zavretia karty.
    window.addEventListener('pagehide', clearPreviews);
}

document.addEventListener('chat:ready', bootAttach);
