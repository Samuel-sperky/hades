'use strict';

/**
 * Hades — desktop shell (voliteľné spustenie Dockeru).
 *
 * Appka beží v Dockeri, takže po reštarte stroja je prvý dojem z Hadesa obrazovka
 * „Vedomie sa nepodarilo prebudiť" a príkaz, ktorý si má človek prepísať do
 * konzoly. Toto je ten príkaz — ale spustený až vtedy, keď to človek povie.
 *
 * ─── Štyri podmienky, ktoré sa tu držia (kontrakt §3 bod 4) ─────────────────
 *
 *  1. **Nič sa nespustí bez súhlasu.** Súhlas je klik v dialógu, nie nastavenie
 *     v súbore. Prepínač „spúšťať pri starte" iba znamená, že sa Hades PONÚKNE.
 *  2. **Prepínač je defaultne vypnutý** (`settings.js` → `docker.enabled: false`).
 *  3. **Vždy je vidieť, čo presne sa spúšťa.** Dialóg vypíše celý príkaz aj
 *     adresár. Keď si človek vypne pýtanie sa (`askEveryTime: false`), príkaz
 *     povie notifikácia — nikdy sa nespustí nič, o čom sa nedozvie.
 *  4. **Príkaz je konfigurovateľný, nie zadrôtovaný** — pole argumentov v
 *     `settings.json`. Default `docker compose up -d` je len default.
 *
 * ─── Prečo `spawn` bez shellu ───────────────────────────────────────────────
 *
 * `shell: false` a príkaz ako POLE: žiadne `&&`, žiadne presmerovanie, žiadne
 * rozbaľovanie premenných — spustí sa presne jeden program s presne týmito
 * argumentmi. To je aj dôvod, prečo `settings.js` odmietne príkaz zadaný ako
 * jeden string.
 *
 * A aby v tom nikto nevidel dieru v kontrakte: **toto nie je shell tool pre
 * model** (kontrakt §4). Cesta k spusteniu vedie výhradne z tray menu alebo zo
 * štartu appky, oboje cez dialóg pre človeka. Renderer na to nemá most (`preload.js`
 * žiadne API nevystavuje), takže výstup modelu sa sem nedostane ani nepriamo.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { dialog, Notification } = require('electron');

const { loadSettings, updateSettings, settingsPath } = require('./settings');

/** Beží práve pokus o spustenie? Dva naraz nemajú zmysel a `compose` by si zavadzal. */
let starting = false;

/** Príkaz ako jeden čitateľný riadok — do dialógu a do notifikácie, nie do shellu. */
function commandLine(command) {
    return command.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}

/** Adresár, v ktorom sa príkaz spustí: z nastavení, inak odvodený koreň projektu. */
function resolveCwd(settings, fallbackDir) {
    const fromSettings = (settings.docker.cwd || '').trim();
    const dir = fromSettings !== '' ? fromSettings : (fallbackDir || '');

    return dir !== '' && fs.existsSync(dir) ? dir : null;
}

/** Krátka notifikácia bez obsahu — len fakt a príkaz, ktorý ho vyvolal. */
function notify(iconPath, title, body) {
    if (!Notification.isSupported()) {
        return;
    }

    new Notification({ title, body, icon: iconPath }).show();
}

/**
 * Spustí príkaz. Nekontroluje súhlas — ten patrí volajúcemu (`offerDockerStart`,
 * `runDockerNow`); táto funkcia je len ruka.
 *
 * Výstup sa ZÁMERNE nezbiera (`stdio: 'ignore'`): `docker compose` píše na stderr
 * aj pri úspechu a shell nemá kam ten text zobraziť tak, aby to nebolo horšie než
 * nič. Fakt, ktorý sa dá povedať čestne, je návratový kód.
 */
function spawnDocker(deps, settings, cwd) {
    const { iconPath } = deps;
    const command = settings.docker.command;
    const line = commandLine(command);

    starting = true;

    let child;

    try {
        child = spawn(command[0], command.slice(1), {
            cwd,
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
        });
    } catch (error) {
        starting = false;
        notify(iconPath, 'Hades — Docker sa nespustil', `${line}\n${error && error.message ? error.message : ''}`.trim());

        return;
    }

    child.on('error', (error) => {
        starting = false;
        notify(
            iconPath,
            'Hades — Docker sa nespustil',
            `${line}\n${error && error.code === 'ENOENT' ? 'Program sa nenašiel.' : (error.message || '')}`.trim(),
        );
    });

    child.on('exit', (code) => {
        starting = false;

        if (code === 0) {
            notify(iconPath, 'Hades — Docker spustený', `${line}\nVedomie sa už môže prebudiť.`);

            return;
        }

        notify(iconPath, 'Hades — Docker skončil s chybou', `${line}\nNávratový kód ${code}.`);
    });
}

/**
 * Dialóg so súhlasom. Vracia `true`, keď sa má spustiť.
 *
 * `defaultId` je ZÁMERNE „Nespúšťať": Enter na dialógu, ktorý človek nečítal, nemá
 * spustiť proces. Zaškrtávacie pole je ponuka prestať sa pýtať — platí len keď
 * človek klikne „Spustiť", nikdy pri odmietnutí.
 */
async function askConsent(win, settings, cwd, title) {
    const line = commandLine(settings.docker.command);

    const { response, checkboxChecked } = await dialog.showMessageBox(win || null, {
        type: 'question',
        title: 'Hades — Docker',
        message: title,
        detail: `Spustí sa presne toto:\n\n${line}\n\nv adresári:\n${cwd}`,
        buttons: ['Spustiť', 'Nespúšťať'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        checkboxLabel: 'Už sa nepýtať — spúšťaj pri starte automaticky',
        checkboxChecked: false,
    });

    if (response !== 0) {
        return false;
    }

    if (checkboxChecked) {
        updateSettings({ docker: { askEveryTime: false } });
    }

    return true;
}

/**
 * Štart appky: keď je prepínač zapnutý, ponúkni (alebo pri vypnutom pýtaní priamo
 * spusti a povedz notifikáciou, čo sa spustilo). Vypnutý prepínač = ticho, žiadny
 * dialóg, žiadna notifikácia.
 */
async function offerDockerStart(deps) {
    const settings = loadSettings();

    if (!settings.docker.enabled || starting) {
        return;
    }

    const cwd = resolveCwd(settings, deps.projectDir);

    if (cwd === null) {
        notify(
            deps.iconPath,
            'Hades — Docker sa nespustil',
            `Neviem, v akom adresári. Doplň "docker.cwd" v ${settingsPath()}.`,
        );

        return;
    }

    if (settings.docker.askEveryTime) {
        const yes = await askConsent(deps.win, settings, cwd, 'Spustiť Docker a prebudiť vedomie?');

        if (!yes) {
            return;
        }
    } else {
        // Pýtanie sa človek vypol, ale „čo presne sa spúšťa" mu aj tak povieme.
        notify(deps.iconPath, 'Hades — spúšťam Docker', `${commandLine(settings.docker.command)}\nv ${cwd}`);
    }

    spawnDocker(deps, settings, cwd);
}

/** Tray → „Spustiť Docker teraz". Súhlas sa pýta VŽDY, aj keď je pýtanie vypnuté. */
async function runDockerNow(deps) {
    const settings = loadSettings();

    if (starting) {
        // Ticho by tu bola pasca: `docker compose up` bez `-d` beží na popredí, kým
        // ho niekto nezastaví, a druhé kliknutie by potom nerobilo NIČ bez slova
        // vysvetlenia. Meno tohto stavu je „už sa spúšťa", nie „nefunguje to".
        notify(deps.iconPath, 'Hades — Docker sa už spúšťa', commandLine(settings.docker.command));

        return;
    }

    const cwd = resolveCwd(settings, deps.projectDir);

    if (cwd === null) {
        notify(
            deps.iconPath,
            'Hades — Docker sa nespustil',
            `Neviem, v akom adresári. Doplň "docker.cwd" v ${settingsPath()}.`,
        );

        return;
    }

    if (await askConsent(deps.win, settings, cwd, 'Spustiť Docker teraz?')) {
        spawnDocker(deps, settings, cwd);
    }
}

/**
 * Tray → prepnutie „Spustiť Docker pri starte appky".
 *
 * Zapnutie prejde dialógom s celým príkazom: prepínač v menu je pre človeka
 * jednoklik a nesmie byť jediné miesto, kde sa dozvie, čo si tým pustí do stroja.
 * Vypnutie sa nepýta na nič. Vracia stav, ktorý naozaj platí.
 */
async function toggleDockerStart(deps, wanted) {
    const settings = loadSettings();

    if (!wanted) {
        updateSettings({ docker: { enabled: false } });

        return false;
    }

    const cwd = resolveCwd(settings, deps.projectDir) || '(neznámy adresár — doplň docker.cwd)';
    const line = commandLine(settings.docker.command);

    const { response } = await dialog.showMessageBox(deps.win || null, {
        type: 'question',
        title: 'Hades — Docker',
        message: 'Spúšťať Docker pri starte Hadesa?',
        detail: `Pri každom starte sa Hades spýta a po tvojom potvrdení spustí:\n\n${line}\n\n`
            + `v adresári:\n${cwd}\n\nPríkaz sa dá zmeniť v ${settingsPath()}.`,
        buttons: ['Zapnúť', 'Zrušiť'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    });

    if (response !== 0) {
        return false;
    }

    // Zapnutie vždy obnoví aj pýtanie sa: kto si ho raz vypol, nech to urobí znovu
    // vedome, nie ako tichý vedľajší efekt starého nastavenia.
    updateSettings({ docker: { enabled: true, askEveryTime: true } });

    return true;
}

module.exports = { offerDockerStart, runDockerNow, toggleDockerStart, commandLine };
