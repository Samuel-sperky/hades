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

import { C } from './state.js';
import { $, el, num } from './dom.js';
import { clearView, pushSystem } from './render.js';
import { newThread } from './main.js';
import { setModel } from './models.js';
import { iconSvg } from '../shared/icons.js';

/* Čo tu SMIE byť: príkaz, ktorý naozaj niečo urobí. Príkaz, ktorý sa len tvári,
   je horší než chýbajúci — presne to bol `/model` bez argumentu, ktorý argument
   zahodil a len dal fokus na `<select>`.

   `arg` s hviezdičkou (`argOptional`) znamená „argument môže byť, ale bez neho
   má príkaz iné zmysluplné chovanie" — `/model` bez argumentu vypíše, na čom
   vlákno beží, s argumentom model prepne. */
const CMDS = [
    {
        cmd: '/recall',
        arg: '<dopyt>',
        icon: 'chip',
        help: 'Prehľadaj pamäť Hadesa',
        expand: (arg) => `Prehľadaj pamäť a zhrň, čo o tejto téme vieš: ${arg}`,
    },
    {
        cmd: '/read',
        arg: '<id alebo názov>',
        icon: 'file-text',
        help: 'Prečítaj jeden uzol celý',
        expand: (arg) => `Prečítaj uzol ${arg} z pamäte a vypíš jeho popis, tagy a spojenia.`,
    },
    {
        cmd: '/model',
        arg: '<model>',
        argOptional: true,
        icon: 'chip',
        help: 'Prepni model vlákna',
        local: switchModel,
    },
    { cmd: '/tools', arg: '', icon: 'bolt', help: 'Čo beh naozaj vie zavolať', local: showTools },
    { cmd: '/cost', arg: '', icon: 'chip', help: 'Spotreba tohto vlákna', local: showCost },
    { cmd: '/clear', arg: '', icon: 'x', help: 'Vyčisti zobrazenie (história zostáva)', local: clearView },
    { cmd: '/new', arg: '', icon: 'plus', help: 'Nové vlákno', local: () => { newThread(); } },
    { cmd: '/help', arg: '', icon: 'question', help: 'Čo konzola vie', local: showHelp },
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
        if (exact && (exact.arg === '' || exact.argOptional || firstArg(typed) !== '')) return;

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
        // `id` je jediné, čím sa dá možnosť pomenovať v `aria-activedescendant`.
        // Bez neho bola paleta `listbox`, ktorý nikto nevlastní: pohyb kurzora
        // prepínal `aria-selected`, ale čítačka nemala ako vedieť, na čom stojí.
        item.id = `sp-${entry.cmd.replace(/[^\w-]/g, '')}`;

        const mark = iconSvg(entry.icon);
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
    $('#prompt')?.setAttribute('aria-expanded', 'true');
    paintCursor($$items());
}

function paintCursor(items) {
    // Vybraná položka má JEDEN nosič. Dovtedy tu bola aj trieda `.on` a CSS
    // viselo na nej, takže tá istá pravda bola zapísaná dvakrát a dala sa
    // rozviazať. `aria-selected` je pre `role="option"` povinné aj tak, takže
    // ostalo ono a `console.css` číta priamo atribút — `.on` bola len farba.
    items.forEach((item, i) => {
        item.setAttribute('aria-selected', i === cursor ? 'true' : 'false');
    });

    // Fokus zostáva na textarei (to je správne — píše sa do nej), takže kurzor
    // v palete nesie výhradne `aria-activedescendant`.
    const prompt = $('#prompt');
    const active = items[cursor];

    if (prompt && active) prompt.setAttribute('aria-activedescendant', active.id);
}

export function closePalette() {
    const box = $('#slash-palette');
    if (!box) return;

    box.classList.add('hidden');
    box.innerHTML = '';
    cursor = 0;

    const prompt = $('#prompt');

    if (prompt) {
        prompt.setAttribute('aria-expanded', 'false');
        // Atribút sa MAŽE, nenastavuje na prázdno: `aria-activedescendant=""`
        // je pre časť čítačiek platná hodnota ukazujúca na nič a hlásia ju.
        prompt.removeAttribute('aria-activedescendant');
    }
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

    if (entry.arg && !entry.argOptional && arg === '') {
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
        // Argument sa lokálnemu príkazu POSIELA. Dovtedy sa zahadzoval, takže
        // `/model qwen3:8b` nič neprepol — a to je práve ten „ovládač, ktorý nič
        // nerobí", ktorý je horší než chýbajúci.
        entry.local(arg);

        return;
    }

    document.dispatchEvent(new CustomEvent('console:send', { detail: { text: entry.expand(arg) } }));
}

function escapeArg(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `/model` bez argumentu povie, na čom vlákno beží; `/model <id>` model PREPNE.
 * Prepnutie robí `models.js` cez `PATCH /api/console/threads/{uuid}` — ten istý
 * okruh, aký použije prepínač v hlavičke, takže druhá cesta k tomu istému stavu
 * nevzniká.
 */
async function switchModel(arg) {
    const wanted = String(arg ?? '').trim();
    const running = C.thread?.model || C.defaultModel || '';

    if (wanted === '') {
        const list = C.models.length
            ? `<p>K dispozícii: ${C.models.map((m) => `<code>${escapeArg(m.id)}</code>`).join(', ')}.</p>`
            : '<p>Zoznam modelov konzola nedostala — beží na tom, čo je v konfigurácii.</p>';

        pushSystem('Model', `<p>Vlákno beží na <code>${escapeArg(running || 'predvolenom modeli')}</code>.</p>${list}
            <p>Prepneš ho príkazom <code>/model &lt;model&gt;</code> alebo prepínačom v hlavičke.</p>`);

        return;
    }

    const done = await setModel(wanted);

    if (!done.ok) {
        pushSystem('Model', `<p>${escapeArg(done.reason)}</p>`);

        return;
    }

    pushSystem('Model', `<p>Vlákno beží od tejto chvíle na <code>${escapeArg(done.model)}</code>.</p>`);
}

/**
 * Nástroje behu. Zoznam nesie HTML (`#console-tools`, plní ho ToolRegistry),
 * nie tento súbor — inak by pri pridaní toolu paleta tvrdila starú pravdu.
 * Slovenská veta ku každému je UI text a žije tu; tool bez vety sa aj tak
 * vypíše, len bez popisu. Anglické popisy z registra sú písané pre model
 * a do rozhrania nepatria.
 */
const TOOL_NOTE = {
    mind_recall: 'nájde v pamäti uzly k téme',
    mind_read: 'prečíta jeden uzol celý',
    mind_overview: 'vypíše štruktúru pamäte (oblasti, typy, počty)',
    grep: 'hľadá v súboroch projektu regulárnym výrazom',
    glob: 'vypíše súbory podľa vzoru cesty',
    read_file: 'prečíta súbor projektu s číslami riadkov',
    mind_learn: 'zapíše nový poznatok do pamäte',
    mind_rename: 'premenuje uzol (oprava odpadového labelu)',
    mind_move: 'presune uzol do inej oblasti',
    mind_delete: 'zmaže uzol z pamäte',
    edit_file: 'prepíše presný úsek v jednom súbore',
    write_file: 'založí súbor alebo prepíše celý jeho obsah',
};

function consoleTools() {
    try {
        const raw = document.getElementById('console-tools')?.textContent || '[]';
        const list = JSON.parse(raw);

        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function showTools() {
    const tools = consoleTools();

    if (tools.length === 0) {
        pushSystem('Nástroje', '<p>Zoznam nástrojov sa nepodarilo prečítať zo stránky. Obnov ju.</p>');

        return;
    }

    const rows = tools.map((t) => {
        const note = TOOL_NOTE[t.name] || '';
        const gate = t.write ? ' <em>— zápis, pýta sa pred vykonaním</em>' : '';

        return `<li><code>${escapeArg(t.name)}</code>${note ? ` — ${note}` : ''}${gate}</li>`;
    }).join('');

    const writes = tools.filter((t) => t.write).length;

    pushSystem('Nástroje', `
        <p>Beh má ${tools.length} nástrojov; ${writes} z nich zapisuje a každý taký
        zápis ti Charón ukáže dopredu a čaká na Povoliť.</p>
        <ul class="help-list">${rows}</ul>
        <p class="help-keys">Shell tool tu zámerne nie je — appka je verejne tunelovaná.</p>`);
}

/**
 * Spotreba vlákna. Čísla sa NEPOČÍTAJÚ na klientovi: `usage` v payloade vlákna
 * je súčet nad logom behov (`runs`), teda ten istý zdroj, z ktorého číta
 * obrazovka Runy. Dve kópie tej istej agregácie by sa rozišli.
 */
function showCost() {
    const usage = C.thread?.usage;

    if (!usage || !usage.runs) {
        pushSystem('Spotreba', '<p>V tomto vlákne ešte nebežal ani jeden ťah, takže nič nestálo.</p>');

        return;
    }

    const seconds = usage.duration_ms ? `${num(usage.duration_ms / 1000, 1)} s` : 'neznámy čas';

    pushSystem('Spotreba', `
        <p>${num(usage.runs, 0)} ${plural(usage.runs)} · ${num(usage.tokens_in, 0)} tokenov na vstupe ·
        ${num(usage.tokens_out, 0)} na výstupe · ${num(usage.steps, 0)} krokov · ${seconds} behu.</p>
        <p class="help-keys">Čísla sú z logu behov, nie z obrazovky — po obnove stránky platia ďalej.</p>`);
}

function plural(count) {
    if (count === 1) return 'beh';

    return count >= 2 && count <= 4 ? 'behy' : 'behov';
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
