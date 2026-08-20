/* ===========================================================================
   Charón — slash príkazy.

   Všetkých šesť je KLIENTSKÁ skratka. Buď urobia lokálnu vec (prepnutie modelu,
   vyčistenie zobrazenia, nové vlákno, pomoc), alebo sa rozpíšu na normálnu
   správu, ktorá ide tou istou rúrou ako čokoľvek napísané rukou. Žiadny príkaz
   si nevymýšľa endpoint — backend o palete nevie a nemá dôvod vedieť.

   Rozpísaná správa sa v toku zobrazí TAK, AKO BOLA ODOSLANÁ, nie ako `/recall x`.
   Keby konzola zobrazila skratku a poslala niečo iné, človek by pri čítaní
   histórie nevedel, čo model naozaj dostal.
   =========================================================================== */

import { $, el } from './dom.js';
import { clearView, pushSystem } from './render.js';
import { newThread } from './main.js';

const CMDS = [
    {
        cmd: '/recall',
        arg: '<dopyt>',
        icon: 'memory',
        help: 'Prehľadaj pamäť Hadesa',
        expand: (arg) => `Prehľadaj pamäť a zhrň, čo o tejto téme vieš: ${arg}`,
    },
    {
        cmd: '/read',
        arg: '<id alebo názov>',
        icon: 'description',
        help: 'Prečítaj jeden uzol celý',
        expand: (arg) => `Prečítaj uzol ${arg} z pamäte a vypíš jeho popis, tagy a spojenia.`,
    },
    { cmd: '/model', arg: '', icon: 'memory', help: 'Prepni model v hlavičke', local: focusModel },
    { cmd: '/clear', arg: '', icon: 'close', help: 'Vyčisti zobrazenie (história zostáva)', local: clearView },
    { cmd: '/new', arg: '', icon: 'add', help: 'Nové vlákno', local: () => { newThread(); } },
    { cmd: '/help', arg: '', icon: 'help', help: 'Čo konzola vie', local: showHelp },
];

let cursor = 0;

export function paletteOpen() {
    return $('#slash-palette')?.classList.contains('hidden') === false;
}

export function wireSlash() {
    const prompt = $('#prompt');
    if (!prompt) return;

    prompt.addEventListener('input', () => refresh());
    prompt.addEventListener('blur', () => {
        // Klik do palety spôsobí blur skôr, než dobehne `click` — preto oneskorenie.
        setTimeout(closePalette, 120);
    });

    // Capture na document a nie listener na textarea: composer si na tej istej
    // textarea drží Enter → odoslanie. Pri dvoch listeneroch na TOM ISTOM elemente
    // rozhoduje poradie registrácie, čo je krehké. Capture na document beží
    // spoľahlivo prv a `stopPropagation` odoslanie zruší.
    document.addEventListener('keydown', onKey, true);
}

function onKey(event) {
    if (!paletteOpen() || event.target !== $('#prompt')) return;

    const items = $$items();
    if (items.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        cursor = (cursor + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        paintCursor(items);

        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePalette();

        return;
    }

    if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        complete(items[cursor].dataset.cmd);

        return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
        const typed = $('#prompt').value.trim();
        const exact = find(typed);

        // Hotový príkaz (aj s argumentom) sa vykoná; nedopísaný sa najprv doplní,
        // aby Enter nikdy neposlal modelu polovicu skratky.
        if (exact && (exact.arg === '' || firstArg(typed) !== '')) return;

        event.preventDefault();
        event.stopPropagation();
        complete(items[cursor].dataset.cmd);
    }
}

function $$items() {
    return [...($('#slash-palette')?.querySelectorAll('.sp-item') || [])];
}

function refresh() {
    const value = $('#prompt').value;

    // Paleta žije len kým je príkaz na prvom riadku — `/` v ceste v druhom
    // odseku nie je príkaz.
    if (!value.startsWith('/') || value.includes('\n')) {
        closePalette();

        return;
    }

    const head = value.split(/\s+/u)[0].toLowerCase();
    const matches = CMDS.filter((c) => c.cmd.startsWith(head) || head === '/');

    if (matches.length === 0) {
        closePalette();

        return;
    }

    openPalette(matches);
}

function openPalette(matches) {
    const box = $('#slash-palette');
    if (!box) return;

    box.innerHTML = '';
    cursor = 0;

    matches.forEach((entry) => {
        const item = el('div', 'sp-item');
        item.dataset.cmd = entry.cmd;
        item.setAttribute('role', 'option');

        const mark = el('span', 'ms', entry.icon);
        mark.setAttribute('aria-hidden', 'true');

        item.append(mark);
        item.append(el('span', 'sp-cmd', entry.cmd));
        if (entry.arg) item.append(el('span', 'sp-arg', entry.arg));
        item.append(el('span', 'sp-help', entry.help));

        item.addEventListener('mousedown', (event) => {
            // mousedown a nie click: click by prišiel po blure, ktorý paletu zavrie.
            event.preventDefault();
            complete(entry.cmd);
        });

        box.append(item);
    });

    box.classList.remove('hidden');
    paintCursor($$items());
}

function paintCursor(items) {
    items.forEach((item, i) => {
        item.classList.toggle('on', i === cursor);
        item.setAttribute('aria-selected', i === cursor ? 'true' : 'false');
    });
}

export function closePalette() {
    const box = $('#slash-palette');
    if (!box) return;

    box.classList.add('hidden');
    box.innerHTML = '';
    cursor = 0;
}

/**
 * Doplní príkaz do textarey a NEVYKONÁ ho. Tab ani klik do palety nesmú nič
 * spustiť: vykonanie patrí výhradne Enteru, aby sa dalo ešte rozmyslieť.
 */
function complete(cmd) {
    const prompt = $('#prompt');
    const entry = CMDS.find((c) => c.cmd === cmd);
    if (!prompt || !entry) return;

    prompt.value = entry.arg ? `${cmd} ` : cmd;
    prompt.focus();
    prompt.dispatchEvent(new Event('input'));
}

function firstArg(text) {
    return String(text).split(/\s+/u).slice(1).join(' ').trim();
}

function find(text) {
    const head = String(text).split(/\s+/u)[0].toLowerCase();

    return CMDS.find((c) => c.cmd === head) || null;
}

/**
 * Skúsi text vykonať ako príkaz. Vracia true, ak ho paleta prevzala.
 * Neznámy `/nieco` sa NEPREVEZME — cesta ako `/var/log/x` je legitímna správa a
 * hádzať na ňu „neznámy príkaz" by bolo horšie než ju poslať.
 */
export function tryRunCommand(text) {
    const entry = find(text);
    if (!entry) return false;

    const arg = firstArg(text);

    if (entry.arg && arg === '') {
        pushSystem('Príkaz', `<p><code>${entry.cmd}</code> potrebuje argument: <code>${entry.cmd} ${escapeArg(entry.arg)}</code></p>`);

        return true;
    }

    closePalette();
    $('#prompt').value = '';
    runEntry(entry, arg);

    return true;
}

function runEntry(entry, arg) {
    if (entry.local) {
        entry.local();

        return;
    }

    document.dispatchEvent(new CustomEvent('console:send', { detail: { text: entry.expand(arg) } }));
}

function escapeArg(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function focusModel() {
    const select = $('#model-select');

    if (!select || select.options.length <= 1) {
        pushSystem('Model', '<p>Iný model nie je k dispozícii — konzola beží na tom, čo je stiahnuté v Ollame.</p>');

        return;
    }

    select.focus();
    pushSystem('Model', '<p>Prepínač modelu je v hlavičke a má fokus — vyber šípkami.</p>');
}

function showHelp() {
    const rows = CMDS.map((c) => `<li><code>${c.cmd}${c.arg ? ` ${escapeArg(c.arg)}` : ''}</code> — ${c.help}</li>`).join('');

    pushSystem('Pomoc', `
        <p>Konzola je Hades s rukami: hľadá v pamäti, prehľadáva projekt cez ripgrep,
        číta súbory a zápisy ti pred vykonaním ukáže ako diff.</p>
        <ul class="help-list">${rows}</ul>
        <p class="help-keys">
            <kbd>Enter</kbd> pošle · <kbd>Shift</kbd>+<kbd>Enter</kbd> nový riadok ·
            <kbd>Esc</kbd> zastaví beh alebo zamietne zápis ·
            <kbd>Ctrl</kbd>+<kbd>N</kbd> nové vlákno
        </p>`);
}
