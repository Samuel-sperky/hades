'use strict';

/**
 * Hades — desktop shell (nastavenia shellu).
 *
 * Jediný súbor `settings.json` v `app.getPath('userData')`. Drží tri veci, ktoré
 * musí vedieť prežiť reštart appky: globálnu skratku, voliteľné spustenie Dockeru
 * a notifikáciu o dobehnutí behu.
 *
 * ─── Prečo nie `.env` a prečo nie `localStorage` ────────────────────────────
 *
 * `.env` patrí appke (Laravel) a je zdrojom UI tokenu — shell doňho nikdy nepíše.
 * `localStorage` patrí rendereru, a práve tam tieto nastavenia byť NESMÚ: keby
 * príkaz na spustenie Dockeru žil v rendereri, stránka (teda aj výstup modelu,
 * ktorý sa v nej zobrazuje) by mala cestu k tomu, čo sa spustí na stroji. Tento
 * súbor preto čítá a píše VÝHRADNE main proces; renderer o ňom nevie a nemá naň
 * most (`preload.js` žiadne API pre nastavenia nevystavuje).
 *
 * Dôveryhodnosť vstupu: `settings.json` je na tej istej úrovni ako `.env` —
 * upravuje ho človek na svojom stroji. Aj tak sa **validuje kľúč po kľúči** a čo
 * nie je v defaultoch, to sa zahodí: poškodený alebo dopísaný súbor nesmie do
 * shellu prepašovať nič, čo tu nie je menované. Príkaz Dockeru je preto POLE
 * argumentov, nikdy jeden string — spúšťa sa bez shellu (`docker.js`), takže nie
 * je čo interpretovať.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/**
 * Defaulty. Zároveň je to schéma: `sanitize()` prepustí len tieto kľúče a len
 * v týchto typoch.
 *
 * `docker.enabled` je ZÁMERNE `false` — kontrakt §3 bod 4. Shell nikdy nespustí
 * nič sám a bez súhlasu človeka; tento prepínač zapína len to, že sa PONÚKNE.
 */
function defaults() {
    return {
        shortcut: {
            enabled: true,
            // Ctrl+Shift+H — H ako Hades. Vyvolá okno a rýchly vstup do chatu.
            accelerator: 'Control+Shift+H',
        },
        docker: {
            enabled: false,
            command: ['docker', 'compose', 'up', '-d'],
            // Prázdne = koreň projektu odvodený z `HADES_ROOT`/`.env` (viď `main.js`).
            cwd: '',
            // Pýtať sa pri každom starte. Vypína to len človek v potvrdzovacom dialógu.
            askEveryTime: true,
        },
        notify: {
            // „Beh dobehol" — notifikácia bez obsahu odpovede (kontrakt §3 bod 2).
            runFinished: true,
            // Notifikovať len keď okno nie je zaostrené: kto beh sleduje, nepotrebuje bublinu.
            onlyWhenUnfocused: true,
        },
    };
}

/** Cesta k súboru. `userData` je per-user a mimo balíka appky (asar je len na čítanie). */
function settingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function asBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

/**
 * Akcelerátor: nedôverujeme mu ako textu, ale ani ho tu neparsujeme — Electron má
 * vlastný formát a `globalShortcut.register` na neplatný hodí výnimku, ktorú
 * `shortcut.js` odchytí. Tu stačí, že je to neprázdny jednoriadkový string
 * rozumnej dĺžky.
 */
function asAccelerator(value, fallback) {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();

    return trimmed !== '' && trimmed.length <= 64 && !/[\r\n\0]/.test(trimmed) ? trimmed : fallback;
}

/**
 * Príkaz: pole neprázdnych stringov bez riadiacich znakov. Prvá položka je program,
 * zvyšok argumenty — presne v tvare, v akom to prevezme `spawn` bez shellu.
 * Čokoľvek iné (string, prázdne pole, číslo v poli) padne na default.
 */
function asCommand(value, fallback) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
        return fallback;
    }

    const parts = value.map((part) => (typeof part === 'string' ? part.trim() : ''));

    if (parts.some((part) => part === '' || part.length > 512 || /[\r\n\0]/.test(part))) {
        return fallback;
    }

    return parts;
}

/** Cesta k adresáru; prázdna hodnota je legitímna (znamená „odvoď koreň projektu"). */
function asDir(value, fallback) {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();

    return trimmed.length <= 4096 && !/[\r\n\0]/.test(trimmed) ? trimmed : fallback;
}

/** Z ľubovoľného vstupu vyrob platné nastavenia. Neznáme kľúče sa zahadzujú. */
function sanitize(raw) {
    const base = defaults();

    if (!raw || typeof raw !== 'object') {
        return base;
    }

    const shortcut = raw.shortcut && typeof raw.shortcut === 'object' ? raw.shortcut : {};
    const docker = raw.docker && typeof raw.docker === 'object' ? raw.docker : {};
    const notify = raw.notify && typeof raw.notify === 'object' ? raw.notify : {};

    return {
        shortcut: {
            enabled: asBool(shortcut.enabled, base.shortcut.enabled),
            accelerator: asAccelerator(shortcut.accelerator, base.shortcut.accelerator),
        },
        docker: {
            enabled: asBool(docker.enabled, base.docker.enabled),
            command: asCommand(docker.command, base.docker.command),
            cwd: asDir(docker.cwd, base.docker.cwd),
            askEveryTime: asBool(docker.askEveryTime, base.docker.askEveryTime),
        },
        notify: {
            runFinished: asBool(notify.runFinished, base.notify.runFinished),
            onlyWhenUnfocused: asBool(notify.onlyWhenUnfocused, base.notify.onlyWhenUnfocused),
        },
    };
}

/** Načítané nastavenia. Držané v module, aby sa súbor nečítal pri každom kliknutí. */
let cache = null;

/**
 * Nastavenia zo súboru (chýbajúci alebo pokazený súbor = defaulty, bez hlášky —
 * nastavenia nie sú dôvod, aby okno nenabehlo).
 */
function loadSettings() {
    if (cache) {
        return cache;
    }

    let raw = null;

    try {
        raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    } catch {
        raw = null;
    }

    cache = sanitize(raw);

    return cache;
}

/**
 * Zapíše zmenu (plochý merge po sekciách) a vráti nový stav.
 *
 * Písanie je „tmp + rename", aby pád uprostred nezanechal polovičný JSON, ktorý
 * by pri ďalšom štarte tichom prepadol na defaulty (teda by človeku zmizli
 * nastavenia). Chyba zápisu sa NEZHASÍ appku — hodnota zostane aspoň v pamäti
 * do konca behu.
 */
function updateSettings(patch) {
    const current = loadSettings();
    const merged = sanitize({
        shortcut: { ...current.shortcut, ...(patch && patch.shortcut) },
        docker: { ...current.docker, ...(patch && patch.docker) },
        notify: { ...current.notify, ...(patch && patch.notify) },
    });

    cache = merged;

    const file = settingsPath();
    const tmp = `${file}.tmp`;

    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 4)}\n`, 'utf8');
        fs.renameSync(tmp, file);
    } catch {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            // dočasný súbor sa nepodarilo uklidiť — nič viac sa s tým robiť nedá
        }
    }

    return merged;
}

/**
 * Vytvorí súbor s defaultmi, ak ešte neexistuje. Volá to tray pred otvorením
 * súboru v editore — bez toho by človek dostal „súbor neexistuje" namiesto
 * zoznamu toho, čo sa dá nastaviť.
 */
function ensureSettingsFile() {
    const file = settingsPath();

    if (!fs.existsSync(file)) {
        updateSettings({});
    }

    return file;
}

module.exports = { defaults, sanitize, loadSettings, updateSettings, settingsPath, ensureSettingsFile };
