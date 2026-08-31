/* ===========================================================================
   Chat — PALETA Ctrl+K

   ČO TO JE: jeden vstup na navigáciu a akcie tejto plochy. Ekvivalent palety
   grafu (`public/js/mind/cmdk.js`), nie jej import — `cmdk.js` na svojom vrchole
   ťahá `screens.js`, `sim.js`, `render.js`, `panels.js` a `theme.js`, teda celé
   plátno s d3.

   PALETA JE JEDNA CESTA VNÚTRI, NIE DRUHÉ MENU. Každá položka VOLÁ to, čo už
   existuje — `chat:new-thread` (tú istú udalosť ako tlačidlo v paneli),
   `setPanel()`, `toggleRead()`, `toggleProject()`. Ani jedna položka nemá vlastnú
   implementáciu toho, čo robí; keby mala, plocha by mala dve cesty k tej istej
   veci a jedna z nich by sa raz rozišla (presne to našiel audit tejto appky
   19. 8. 2026 na šiestich miestach).

   PREČO PALETA NEHĽADÁ V HISTÓRII SAMA — a je to rozhodnutie, nie diera:
   `/chat` UŽ MÁ hľadanie v histórii, a je to plnohodnotná implementácia
   v `threads.js` — debounce, `AbortController` proti prehádzaným odpovediam,
   filtre (rola, dátum, vlákno, projekt), fasety, počty a „Zobraziť viac", všetko
   napojené na adresu cez kľúče `q`/`hr`/`ha`/`hb`/`hn`/`hp`. Druhý zoznam
   výsledkov v palete by bol druhá implementácia toho istého dopytu — a paleta
   grafu si vlastné hľadanie píše len preto, že tam žiadne iné nie je.

   Paleta preto dopyt PREDÁVA panelu: naplní `#chat-search` a vydá `input`, teda
   ide tou istou jednou cestou ako človek, ktorý do toho poľa píše
   (`#chat-search` → `chat:search` → `onQuery()`). Čo paleta filtruje sama, sú
   NÁZVY vlákien a projektov z už načítanej keše — to nie je hľadanie v histórii,
   ale navigácia podľa mena, a nejde na server vôbec.

   KRESBA JE ZDARMA A JE TO ZMERANÉ. Overlay má tie isté id a triedy ako paleta
   grafu (`#cmdk`, `#cmdk-card`, `.cmdk-input-row`, `#cmdk-input`, `#cmdk-results`,
   `.cmdk-group`, `.cmdk-item`, `.cmdk-text`, `.cmdk-title`, `.cmdk-sub`,
   `.cmdk-hint-row`) a `mind.css` sa na `/chat` načítava — takže tento modul
   nepotrebuje ani riadok nového CSS. Markup sa skládá v JS a nie v blade,
   pretože `chat.blade.php` tento sprint nevlastní; id sú v dokumente unikátne
   (zmerané: `/chat` malo `#cmdk` nula-krát).

   Všetko sú HOISTOVANÉ `export function` (cyklus `palette → render → main`).
   =========================================================================== */

import { el } from './render.js';
import { live, panelState, setPanel } from './main.js';
import { readOn, toggleRead } from './read.js';
import { projectsSnapshot, threadsSnapshot, toggleProject } from './threads.js';
import { filterBlock } from './empty.js';
import { iconSvg } from '../shared/icons.js';

/** Koľko vlákien paleta ukáže. Päť ako v palete grafu — je to skratka, nie zoznam. */
const THREAD_LIMIT = 5;

/** Koľko projektov. Menej než vlákien: projekt je zložka, nie cieľ čítania. */
const PROJECT_LIMIT = 4;

/**
 * Kam sa vráti fokus po zavretí.
 *
 * Bez toho spadne na `<body>`, takže Tab po zavretí začína od začiatku dokumentu
 * — a paletu otvára KLÁVESOVÁ skratka, čiže presne ten používateľ, ktorému to
 * vadí najviac. Tá istá úvaha (a tá istá pasca) ako v `mind/cmdk.js`.
 */
let returnFocus = null;

/** Sú listenery pripojené? `wirePalette()` je idempotentné. */
let wired = false;

/* ---------------------------------------------------------------------------
   SLOVÁ
   --------------------------------------------------------------------------- */

/**
 * Titulok na jeden riadok.
 *
 * Názov vlákna skládá model z prvej správy, takže v ňom môže byť nový riadok
 * alebo dva medzery za sebou — a `.cmdk-title` je `nowrap` s výpustkou, takže by
 * sa zalomenie prejavilo len ako záhadná diera. Markdown sa NEODSTRAŇUJE
 * zámerne: panel vlákien kreslí ten istý názov tiež surový (`ct-ttl`), a paleta,
 * ktorá by z názvu odobrala backticky, by ukázala iný text než zoznam vedľa nej.
 */
export function oneLine(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Tvar uuid. Do `location.href` nesmie ísť nič, čo ten tvar nemá. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------------------------------------------------------------------------
   OVERLAY
   --------------------------------------------------------------------------- */

/** @returns {HTMLElement|null} */
export function paletteBox() {
    return document.getElementById('cmdk');
}

export function paletteInput() {
    return document.getElementById('cmdk-input');
}

export function paletteResults() {
    return document.getElementById('cmdk-results');
}

export function paletteOpen() {
    const box = paletteBox();

    return !!box && !box.classList.contains('hidden');
}

/**
 * Postaví overlay, ak ešte nie je. Idempotentné.
 *
 * `role="dialog"` + `aria-modal="true"` je tu podmienka, nie ozdoba: paleta leží
 * nad celou plochou a bez toho by čítačka obrazovky ponúkala zoznam vlákien pod
 * ňou ako keby bol dosiahnuteľný.
 */
export function ensurePalette() {
    const found = paletteBox();
    if (found) return found;

    const box = el('div', 'hidden');

    box.id = 'cmdk';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Paleta príkazov');

    const card = el('div');
    card.id = 'cmdk-card';

    const row = el('div', 'cmdk-input-row');
    const input = document.createElement('input');

    input.id = 'cmdk-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = 'Vlákna, projekty, akcie…';
    input.setAttribute('aria-label', 'Hľadať v palete');

    row.append(iconSvg('magnifier'), input, el('kbd', null, 'Esc'));

    const results = el('div');
    results.id = 'cmdk-results';

    card.append(row, results);
    box.append(card);
    document.body.append(box);

    return box;
}

export function openPalette() {
    const box = ensurePalette();

    if (!paletteOpen()) returnFocus = document.activeElement;

    box.classList.remove('hidden');
    const input = paletteInput();
    input.value = '';
    renderPalette('');

    /* Fokus o rámec neskôr: prvok, ktorý práve prestal byť `display: none`, ho
       v niektorých prehliadačoch prijme až po vykreslení. Tá istá 30 ms pauza
       ako v palete grafu. */
    setTimeout(() => input.focus(), 30);
}

export function closePalette() {
    paletteBox()?.classList.add('hidden');

    const back = returnFocus;
    returnFocus = null;

    /* `<body>` nie je „kam sa vrátiť" — paletu často otvorí skratka v okamihu,
       keď nemá fokus nič konkrétne. Vtedy ho dostane spúšťač palety, teda prvok,
       ktorý o nej hovorí. */
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
    else document.getElementById('cmdk-trigger')?.focus();
}

export function togglePalette() {
    if (paletteOpen()) closePalette();
    else openPalette();
}

/* ---------------------------------------------------------------------------
   POLOŽKY
   --------------------------------------------------------------------------- */

export function paletteItems() {
    return [...(paletteResults()?.querySelectorAll('.cmdk-item') || [])];
}

/**
 * Šípky posúvajú SKUTOČNÝ fokus po položkách, nie vlastnú triedu „active":
 * `.cmdk-item:focus-visible` má v mind.css presne to podsvietenie, ktoré by
 * vlastná trieda potrebovala, takto ho vidí aj čítačka obrazovky a Enter
 * funguje nativne.
 */
export function paletteMove(delta) {
    const items = paletteItems();
    if (!items.length) return;

    const cur = items.indexOf(document.activeElement);
    const next = cur < 0
        ? (delta > 0 ? 0 : items.length - 1)
        : (cur + delta + items.length) % items.length;

    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
}

/**
 * Ktorú položku vezme Enter zo vstupu.
 *
 * Poradie skupín v zozname sa NEMENÍ (je to vizuálna hierarchia); mení sa len
 * voľba. Prednosť má NAVIGAČNÝ cieľ (vlákno, projekt, iná plocha), akcia je až
 * posledná — inak by pri dopyte, ktorý netrafí žiadny názov, bola prvou položkou
 * vždy tá istá akcia a Enter by človeka poslal inam, než sa pozerá (nález A2 na
 * palete grafu, zaplatený 24. 8. 2026).
 *
 * @returns {HTMLElement|null}
 */
export function paletteEnterTarget() {
    const items = paletteItems();

    return items.find((node) => node.dataset.kind === 'nav')
        || items.find((node) => node.dataset.kind === 'action')
        || null;
}

/**
 * Jedna položka.
 *
 * `kind` je `'nav'` (mení kontext) alebo `'action'` (robí niečo na mieste) a
 * čítá ho `paletteEnterTarget()`. Klik ide priamo na funkciu — dataset je
 * v palete grafu nutnosť, pretože tam sa markup skládá reťazcom a listener sa
 * pripája druhým prechodom; tu sa prvok stavia, takže closure je jedna cesta
 * menej.
 */
export function paletteItem({ icon, title, sub, kind, run }) {
    const btn = el('button', 'cmdk-item');

    btn.type = 'button';
    btn.dataset.kind = kind || 'action';
    btn.append(iconSvg(icon));

    const text = el('span', 'cmdk-text');

    text.append(el('span', 'cmdk-title', title));
    if (sub) text.append(el('span', 'cmdk-sub', sub));
    btn.append(text);

    btn.addEventListener('click', () => run());

    return btn;
}

export function paletteGroup(label) {
    return el('div', 'cmdk-group', label);
}

/* ---------------------------------------------------------------------------
   OBSAH

   Zdroje sú tri a ani jeden nie je nový fetch:
     · konstanta plôch (dve adresy),
     · stav plochy (`panelState`, `readOn`) pre akcie,
     · keš `threads.js`, ktorú načítal `bootThreads()` pri starte.
   --------------------------------------------------------------------------- */

/**
 * Iné plochy Hadesa.
 *
 * `url` a nie „obrazovka": odchod zo stránky je zmena kontextu, takže to paleta
 * priznáva podtitulom. Hodnoty sú KONSTANTA — do `location.href` sa nesmie
 * dostať nič, čo napísal človek.
 */
export const PALETTE_PLACES = [
    { url: '/', icon: 'hub', label: 'Vedomie', sub: 'Graf, Dnes, Denník, Knižnica — opustí chat' },
    { url: '/console', icon: 'sliders', label: 'Technická konzola', sub: 'Ten istý beh, technická plocha' },
];

/** Zhoda podľa dopytu. Bez dopytu prechádza všetko. */
function hit(query, ...fields) {
    if (!query) return true;

    return fields.some((f) => String(f ?? '').toLowerCase().includes(query));
}

/**
 * Akcie plochy.
 *
 * Každá `run` VOLÁ existujúcu cestu. `keys` sú synonymá, ktoré človek reálne
 * napíše — filtruje sa podľa nich a podľa `label`, NIKDY podľa vykresleného
 * titulku: titulok „Hľadať v histórii: <dopyt>" obsahuje dopyt vždy, takže
 * podmienka nad ním by prepustila každú akciu na každé slovo (zmerané na palete
 * grafu: na „sync" vychádzali dve akcie namiesto jednej).
 */
export function paletteActions(query) {
    const list = [
        {
            keys: 'vlakno nove konverzacia zaciatok',
            icon: 'plus',
            label: 'Nové vlákno',
            sub: 'Ctrl+N — čistá konverzácia s vedomím',
            run: () => {
                closePalette();
                document.dispatchEvent(new CustomEvent('chat:new-thread'));
            },
        },
        {
            keys: 'citaci rezim citanie sadzba proza velkost pismo',
            icon: readOn() ? 'eye-off' : 'eye',
            label: readOn() ? 'Vypnúť čítací režim' : 'Zapnúť čítací režim',
            sub: 'Odpovede v sadzbe čítačky — 16 px, miera 72 znakov',
            run: () => {
                closePalette();
                toggleRead();
            },
        },
        {
            keys: 'vlakna panel zoznam historia',
            icon: 'list',
            label: panelState('threads') ? 'Zavrieť zoznam vlákien' : 'Otvoriť zoznam vlákien',
            sub: 'Ctrl+B',
            run: () => {
                closePalette();
                setPanel('threads', !panelState('threads'));
            },
        },
        {
            keys: 'artefakt panel nahlad subor',
            icon: 'layers',
            label: panelState('artifact') ? 'Zavrieť panel artefaktu' : 'Otvoriť panel artefaktu',
            sub: 'Ctrl+J',
            run: () => {
                closePalette();
                setPanel('artifact', !panelState('artifact'));
            },
        },
    ];

    /* Hľadanie v histórii je akcia s ECHOM dopytu a je POSLEDNÁ zámerne: je to
       jediná položka, ktorá dopyt nespotrebuje ako filter, ale ako obsah. Ponúka
       sa len keď je čo predať — prázdny dopyt by otvoril panel a nič nenašiel. */
    if (query.length >= 2) {
        list.push({
            /* `echo: true` znamená „táto položka dopyt NEFILTRUJE, nesie ho".
               Bez toho by paleta nikdy nemala prázdny stav: jej `keys` sú samotný
               dopyt, takže by sa zhodovala vždy — zmerané 31. 8. 2026, dopyt
               „xyzzyqqq" vrátil jednu položku namiesto prázdna, a `.empty--filter`
               tým bol mŕtvy kód. Vidieť ju treba (hľadanie v správach je presne
               to, čo človek pri nezhode chce), ale za nález sa počítať nesmie. */
            echo: true,
            keys: query,
            icon: 'magnifier',
            label: `Hľadať v histórii: ${query}`,
            sub: 'Otvorí zoznam vlákien s filtrami a počtami',
            run: () => handOverSearch(query),
        });
    }

    return list.filter((a) => hit(query, a.keys, a.label));
}

/**
 * Predá dopyt panelu — TOU ISTOU cestou, akou ide písanie do poľa.
 *
 * `#chat-search` → `input` → `chat:search` → `onQuery()` v `threads.js`. Volať
 * `onQuery()` priamo by bola druhá cesta a pole by zostalo prázdne, teda plocha
 * by hľadala niečo, čo v nej nie je napísané.
 *
 * Panel musí byť otvorený, inak by výsledky pribudli do zatvoreného stĺpca —
 * a pod 900 px je panel prekryv, takže `setPanel` zavrie artefakt sám.
 */
export function handOverSearch(query) {
    closePalette();
    if (!panelState('threads')) setPanel('threads', true);

    const field = document.getElementById('chat-search');
    if (!field) return;

    field.value = query;
    field.dispatchEvent(new Event('input', { bubbles: true }));

    /* Pod 900 px je panel prekryv nad konverzáciou a fokus v jeho poli je to
       jediné, čo drží gesto pohromade. Na širokom okne tiež — dopyt sa spravidla
       hneď dopisuje. */
    field.focus();
    live(`Hľadanie v histórii: ${query}`);
}

/** Otvorenie vlákna. `uuid` ide z odpovede servera, a napriek tomu sa validuje. */
export function openThreadByUuid(uuid) {
    const id = String(uuid || '');
    if (!UUID.test(id)) return;

    closePalette();
    location.href = `/chat/${id}`;
}

/**
 * Skládá celý zoznam.
 *
 * Poradie skupín je hierarchia a nemení sa: akcie (čo tu teraz môžem urobiť) →
 * vlákna → projekty → iné plochy (odchod je najďalej). Prázdna skupina sa
 * NEKRESLÍ — učila by, že tie veci neexistujú.
 */
export function renderPalette(raw) {
    const wrap = paletteResults();
    if (!wrap) return;

    const query = oneLine(raw).toLowerCase();
    const frag = document.createDocumentFragment();
    let count = 0;

    const actions = paletteActions(query);
    if (actions.length) {
        frag.append(paletteGroup('Akcie'));
        actions.forEach((a) => {
            frag.append(paletteItem({ icon: a.icon, title: a.label, sub: a.sub, kind: 'action', run: a.run }));
            // Položka s echom dopytu sa nepočíta — viď `echo` v `paletteActions()`.
            if (!a.echo) count++;
        });
    }

    const threads = threadsSnapshot()
        .filter((t) => hit(query, t.title, t.model))
        .slice(0, THREAD_LIMIT);

    if (threads.length) {
        frag.append(paletteGroup('Vlákna'));
        threads.forEach((t) => {
            frag.append(paletteItem({
                icon: 'send',
                title: oneLine(t.title) || 'Nové vlákno',
                sub: t.model || 'Charón',
                kind: 'nav',
                run: () => openThreadByUuid(t.uuid),
            }));
            count++;
        });
    }

    const projects = projectsSnapshot()
        .filter((p) => !p.archived && hit(query, p.name))
        .slice(0, PROJECT_LIMIT);

    if (projects.length) {
        frag.append(paletteGroup('Projekty'));
        projects.forEach((p) => {
            frag.append(paletteItem({
                icon: 'box',
                title: oneLine(p.name),
                sub: `${p.threads ?? 0} vlákien`,
                kind: 'nav',
                run: () => {
                    closePalette();
                    if (!panelState('threads')) setPanel('threads', true);
                    toggleProject(p.uuid);
                },
            }));
            count++;
        });
    }

    const places = PALETTE_PLACES.filter((p) => hit(query, p.label, p.sub));
    if (places.length) {
        frag.append(paletteGroup('Prejsť na'));
        places.forEach((p) => {
            frag.append(paletteItem({
                icon: p.icon,
                title: p.label,
                sub: p.sub,
                kind: 'nav',
                run: () => {
                    /* Paletu zatvárame PRED odchodom: keby navigáciu niečo
                       zdržalo, otvorená paleta nad odchádzajúcou stránkou vyzerá
                       ako zaseknutý klik. */
                    closePalette();
                    location.href = p.url;
                },
            }));
            count++;
        });
    }

    /* Prázdno je stav zo slovníka, nie riadok textu. Príčinou je VŽDY dopyt
       (bez dopytu prechádzajú akcie aj plochy, takže `count` nula byť nemôže) —
       preto `.empty--filter` a jedna akcia, ktorá ten dopyt naozaj zruší.

       Nad týmto stavom pritom STOJÍ položka „Hľadať v histórii: <dopyt>", takže
       veta nesmie tvrdiť, že sa nedá nič urobiť — hovorí, čo sa nenašlo, a
       ukazuje na to, čo ešte zostáva. */
    if (count === 0) {
        frag.append(filterBlock(
            'Žiadne vlákno, projekt ani akcia',
            'V samotných správach hľadá položka nad týmto textom.',
            () => {
                const input = paletteInput();
                if (!input) return;

                input.value = '';
                input.focus();
                renderPalette('');
            },
            'Zruš dopyt',
        ));
    }

    wrap.replaceChildren(frag);
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

/**
 * Spúšťač v hlavičke.
 *
 * Id `cmdk-trigger` je to isté ako v grafe, a je to zámer: `mind.css` mu dáva
 * kresbu (papier, rám, `kbd` s nepriehľadným pozadím, hover) a to je presne ten
 * prvok, ktorý na oboch plochách hovorí to isté. Pod 768 px si mind.css sám
 * skryje menovku aj klávesu.
 *
 * Idempotentné.
 */
export function wirePaletteTrigger() {
    const right = document.querySelector('#chat-header .ch-right');
    const found = document.getElementById('cmdk-trigger');

    if (!right || found) return found;

    const btn = el('button');

    btn.id = 'cmdk-trigger';
    btn.type = 'button';
    btn.title = 'Paleta príkazov (Ctrl+K)';
    btn.setAttribute('aria-label', 'Paleta príkazov');
    btn.append(iconSvg('magnifier'), el('span', 'cmdk-hint', 'Hľadať'), el('kbd', null, 'Ctrl K'));
    btn.addEventListener('click', () => openPalette());

    /* Prvý prvok `.ch-right`: paleta je vstup do celej plochy, nie vlastnosť
       ťahu ako profil a model, a nie prepínač panela ako artefakt. */
    right.insertBefore(btn, right.firstChild);

    return btn;
}

/**
 * Klávesy palety.
 *
 * Listener je na OVERLAY, nie na vstupe: keď fokus sedí na položke (BUTTON), vstup
 * už žiadny keydown nedostane a šípky by prestali fungovať po prvom stlačení.
 *
 * `stopPropagation` na VŠETKO okrem `Tab` je tu podmienka, nie opatrnosť.
 * `wireShortcuts()` v `main.js` visí na `document` a berie `Ctrl+B` / `Ctrl+J` /
 * `Ctrl+N` bez toho, aby sa pýtal, či je nad plochou modál — pod otvorenou
 * paletou by teda `Ctrl+B` zavrel panel, ktorý paleta práve ponúka otvoriť.
 * A `Esc` je horší prípad: ten istý handler by pri bežiacom ťahu ZASTAVIL BEH
 * namiesto zavretia palety. Tab necháme prejsť, aby ostal natívny cyklus fokusu.
 */
export function wirePaletteKeys(box) {
    box.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') e.stopPropagation();

        const input = paletteInput();

        if (e.key === 'Escape') {
            e.preventDefault();
            closePalette();

            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            closePalette();

            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            paletteMove(1);

            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            paletteMove(-1);

            return;
        }
        if (e.key === 'Enter') {
            /* Na položke si Enter obslúži prehliadač sám (je to `<button>`) — to,
               na čom človek stojí, má prednosť pred akýmkoľvek pravidlom nižšie. */
            if (document.activeElement !== input) return;

            const target = paletteEnterTarget();
            // Bez cieľa Enter zámerne nerobí NIČ.
            if (target) {
                e.preventDefault();
                target.click();
            }

            return;
        }

        /* Písanie po odšípkovaní musí ísť do dopytu, nie do prázdna. Hodnotu
           meníme ručne — spoliehať sa na to, že sa znak „doručí" novo zaostrenému
           vstupu, je závislé na prehliadači. */
        if (document.activeElement === input) return;
        if (e.key === 'Backspace') {
            e.preventDefault();
            input.value = input.value.slice(0, -1);
            input.focus();
            renderPalette(input.value);

            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            input.value += e.key;
            input.focus();
            renderPalette(input.value);
        }
    });
}

export function wirePalette() {
    if (wired) return;
    wired = true;

    const box = ensurePalette();

    /* Klik do scrimu zatvára. Cieľ musí byť overlay SAMOTNÝ — klik do karty ho
       má nechať otvorený. */
    box.addEventListener('click', (e) => {
        if (e.target === box) closePalette();
    });

    paletteInput()?.addEventListener('input', (e) => renderPalette(e.currentTarget.value));
    wirePaletteKeys(box);
    wirePaletteTrigger();

    /* Ctrl+K na dokumente. Bez stráže „práve píšem": paleta je jediná vec, ktorú
       má tá skratka robiť, a človek ju otvára najčastejšie práve z rozpísanej
       správy. Prehliadač si Ctrl+K berie na hľadanie v niektorých buildoch,
       preto `preventDefault`. */
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        if (e.key !== 'k' && e.key !== 'K') return;

        e.preventDefault();
        togglePalette();
    });

    /* Keš vlákien sa naplní až po `bootThreads()`. Keď dobehne, otvorená paleta
       sa má prekresliť — inak by ukazovala „Nič sa nenašlo" nad zoznamom, ktorý
       o sekundu existuje. Udalosť vydáva `threads.js`. */
    document.addEventListener('chat:threads-loaded', () => {
        if (paletteOpen()) renderPalette(paletteInput()?.value || '');
    });
}

/** Overlay existuje od bootu, aby prvé `Ctrl+K` nestálo za stavbu DOM. */
export function bootPalette() {
    ensurePalette();

    if (paletteOpen()) renderPalette(paletteInput()?.value || '');
}
