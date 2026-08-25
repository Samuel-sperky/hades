'use strict';

/**
 * Hades — desktop shell (systémový tray).
 *
 * Tray je hlavne kvôli dvom veciam, ktoré okno nedokáže povedať, keď je človek inde:
 *
 *   1. **„Beh čaká na potvrdenie zápisu."** Charón beží dvojfázovo — zápisový tool
 *      zaparkuje a turn skončí BEZ rámca `end` (viď CLAUDE.md, Charón). Bez tejto
 *      notifikácie o tom človek mimo okna nevie a beh čaká, kým sa vráti.
 *   2. **„Beh dobehol."** Ťah na CPU trvá minúty; kto medzitým odišiel, nemá ako
 *      vedieť, že už je hotovo. Fakt o dobehnutí prichádza zo siete (`runwatch.js`),
 *      rozhoduje o ňom `main.js`.
 *
 * **Do notifikácií NEIDE obsah odpovede ani zápisu.** Je to výstup modelu a ostáva
 * v okne — notifikácie na Windows sa navyše ukladajú do centra oznámení, takže by
 * tam text ležal ďalej. Hlási sa len holý fakt: beh čaká / dobehol / spadol,
 * pri čakaní ešte na aký nástroj, pri dobehnutí ako dlho bežal.
 *
 * Menu: Otvoriť · Nový chat · Graf/Chat/Charón · prepínače (skratka, Docker,
 * notifikácia, spustenie pri prihlásení) · Nastavenia · Ukončiť. Každý prepínač
 * zrkadlí SKUTOČNÝ stav (OS, resp. `settings.json`), nie to, čo si tu niekto myslí:
 * po každom prepnutí sa menu postaví znovu z prečítaných hodnôt.
 *
 * Auto-start pri prihlásení aj spúšťanie Dockeru sú DEFAULTNE VYPNUTÉ a tray ich
 * nikdy nezapína sám.
 */

const { app, Tray, Menu, Notification, nativeImage } = require('electron');

/**
 * Známe zápisové nástroje Charóna → čo notifikácia povie, „na čo" beh čaká.
 *
 * Mená musia sedeť s `ToolRegistry::PROFILES`. Do 25. 8. 2026 tu boli tri, ktoré
 * v appke neexistujú (`mind_forget`, `file_write`, `file_edit`), takže tie tri
 * zápisy padali na vecný fallback — notifikácia fungovala, len nikdy nepovedala,
 * o čo ide. Skutočná šestica je nižšie; keď pribudne zápisový tool, pribudne
 * riadok aj tu.
 */
const TOOL_LABEL = {
    mind_learn: 'zápis do pamäte',
    mind_rename: 'premenovanie uzla',
    mind_move: 'presun uzla',
    mind_delete: 'vymazanie z pamäte',
    write_file: 'zápis do súboru',
    edit_file: 'úpravu súboru',
};

/** Z názvu nástroja urob vetu bez obsahu zápisu; neznámy nástroj ostane vecný. */
function bodyFor(name) {
    const label = TOOL_LABEL[name];

    if (label) {
        return `Charón čaká na ${label}. Otvor okno a rozhodni.`;
    }

    return 'Charón čaká na potvrdenie zápisu. Otvor okno a rozhodni.';
}

/** Trvanie behu ľudsky. Je to wall clock shellu, nie generovací čas modelu. */
function humanDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);

    if (total < 60) {
        return `${Math.max(1, Math.round(total))} s`;
    }

    const minutes = Math.floor(total / 60);
    const seconds = Math.round(total % 60);

    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** Popis skratky do menu — vrátane priznania, keď ju drží niekto iný. */
function shortcutLabel(status, wanted) {
    if (status && status.failure === 'taken') {
        return `Globálna skratka (${wanted}) — drží ju iná appka`;
    }

    if (status && status.failure === 'invalid') {
        return `Globálna skratka (${wanted}) — nečitateľná`;
    }

    return `Globálna skratka (${wanted})`;
}

/**
 * @param {object} deps
 * @param {string} deps.iconPath        Cesta k ikone tray (rovnaká ako ikona okna).
 * @param {string} [deps.version]       Verzia appky (z package.json) — ukáže sa v menu.
 * @param {() => void} deps.onOpen      Vytiahni a zaostri okno (Otvoriť / klik na tray / klik na notifikáciu).
 * @param {() => void} deps.onQuickChat Vytiahni okno a otvor chat s fokusom v composeri.
 * @param {(screen: string) => void} deps.onScreen  Prepni obrazovku appky ('graf' | 'chat' | 'charon').
 * @param {() => object} deps.getSettings           Aktuálne nastavenia shellu (`settings.js`).
 * @param {() => object} deps.getShortcutStatus     Čo je z akcelerátora naozaj zaregistrované.
 * @param {(on: boolean) => unknown} deps.onToggleShortcut  Zapni/vypni globálnu skratku.
 * @param {(on: boolean) => unknown} deps.onToggleDocker    Zapni/vypni spúšťanie Dockeru pri starte.
 * @param {() => unknown} deps.onRunDocker                  Spusti Docker teraz (so súhlasom).
 * @param {(on: boolean) => unknown} deps.onToggleRunNotify Zapni/vypni notifikáciu o dobehnutí.
 * @param {() => unknown} deps.onOpenSettings               Otvor `settings.json` v systémovom editore.
 * @param {() => void} deps.onQuit      Ukonči appku.
 */
function createTray(deps) {
    const {
        iconPath,
        version,
        onOpen,
        onQuickChat,
        onScreen,
        getSettings,
        getShortcutStatus,
        onToggleShortcut,
        onToggleDocker,
        onRunDocker,
        onToggleRunNotify,
        onOpenSettings,
        onQuit,
    } = deps;

    const tray = new Tray(nativeImage.createFromPath(iconPath));

    /** Po každej zmene stavu postav menu znovu — hodnoty sa čítajú, nie pamätajú. */
    function refresh() {
        tray.setContextMenu(buildMenu());
    }

    /** Prepínač: zavolaj akciu, počkaj na skutočný výsledok a prekresli menu z faktov. */
    function toggling(action, value) {
        Promise.resolve(action(value)).then(refresh, refresh);
    }

    function buildMenu() {
        // Stav auto-startu sa číta z OS pri každom POSTAVENÍ menu — teda pri štarte
        // a po každom prepnutí. Nie pri každom otvorení menu: `setContextMenu` drží
        // jednu hotovú instanciu a Electron nemá udalosť „menu sa práve otvára",
        // ktorú by sa dalo na Windows spoľahlivo predbehnúť. Dôsledok: keď
        // openAtLogin prestaví niekto mimo Hadesa (Nastavenia Windows), prepínač to
        // dobehne až po reštarte appky.
        const openAtLogin = app.getLoginItemSettings().openAtLogin;
        const settings = getSettings();
        const status = getShortcutStatus();

        return Menu.buildFromTemplate([
            // Verzia je len informatívna (disabled) — človek vidí, čo mu beží.
            { label: version ? `Hades ${version}` : 'Hades', enabled: false },
            { type: 'separator' },
            { label: 'Otvoriť', click: onOpen },
            {
                // Nie „Nový chat": keď appka v chate už je, skratka len zaostrí composer
                // (načítanie by zahodilo rozpísanú správu). Menu má hovoriť to, čo sa deje.
                label: 'Rýchly vstup do chatu',
                // Skratka sa v menu ukáže len keď naozaj platí — inak by menu sľubovalo
                // klávesu, ktorá nič nerobí. `registerAccelerator: false`, pretože je to
                // GLOBÁLNA skratka (`globalShortcut`), nie akcelerátor tohto menu.
                accelerator: status && status.accelerator ? status.accelerator : undefined,
                registerAccelerator: false,
                click: onQuickChat,
            },
            { type: 'separator' },
            { label: 'Graf', click: () => onScreen('graf') },
            { label: 'Chat', click: () => onScreen('chat') },
            { label: 'Charón', click: () => onScreen('charon') },
            { type: 'separator' },
            {
                label: shortcutLabel(status, settings.shortcut.accelerator),
                type: 'checkbox',
                checked: Boolean(status && status.accelerator),
                click: (item) => toggling(onToggleShortcut, item.checked),
            },
            {
                label: 'Notifikácia o dobehnutí behu',
                type: 'checkbox',
                checked: settings.notify.runFinished,
                click: (item) => toggling(onToggleRunNotify, item.checked),
            },
            { type: 'separator' },
            {
                label: 'Spustiť Docker pri starte appky',
                type: 'checkbox',
                checked: settings.docker.enabled,
                click: (item) => toggling(onToggleDocker, item.checked),
            },
            { label: 'Spustiť Docker teraz…', click: () => toggling(onRunDocker, undefined) },
            { type: 'separator' },
            {
                label: 'Spustiť Hades pri prihlásení',
                type: 'checkbox',
                checked: openAtLogin,
                click: (item) => {
                    app.setLoginItemSettings({ openAtLogin: item.checked });
                    // Postav menu znovu, aby zaškrtnutie prišlo z OS, nie z kliku:
                    // keby OS nastavenie odmietol, prepínač to prizná.
                    refresh();
                },
            },
            { label: 'Nastavenia (settings.json)', click: () => toggling(onOpenSettings, undefined) },
            { type: 'separator' },
            { label: 'Ukončiť', click: onQuit },
        ]);
    }

    tray.setToolTip(version ? `Hades ${version} — vedomie` : 'Hades — vedomie');
    refresh();

    // Ľavý klik na Windows nezobrazí kontextové menu — nech aspoň vytiahne okno.
    tray.on('click', () => onOpen());

    /** Jedna notifikácia, jeden fakt. Klik vždy vytiahne okno. */
    function show(title, body) {
        if (!Notification.isSupported()) {
            return;
        }

        const notification = new Notification({ title, body, icon: iconPath });

        notification.on('click', () => onOpen());
        notification.show();
    }

    return {
        /** Prekresli menu z aktuálnych nastavení (volá `main.js` po zmene zvonka). */
        refresh,

        /**
         * Notifikácia „beh čaká na potvrdenie zápisu". Volá sa LEN pri prechode do
         * čakania (main proces posiela jednu udalosť na id karty), nie pri každom rámci.
         */
        notifyPendingWrite(payload) {
            show('Hades — beh čaká na potvrdenie', bodyFor(payload && payload.name));
        },

        /**
         * Notifikácia „beh dobehol". Bez obsahu odpovede — len ako dlho bežal.
         * O tom, či sa vôbec pošle (zaparkovaný ťah, zaostrené okno, vypnuté
         * v nastaveniach), rozhoduje `main.js`.
         */
        notifyRunFinished(payload) {
            const ms = payload && payload.ms;

            show(
                'Hades — beh dobehol',
                ms ? `Ťah trval ${humanDuration(ms)}. Odpoveď je v okne.` : 'Odpoveď je v okne.',
            );
        },

        /** Notifikácia „beh sa prerušil". Dôvod, nie výstup modelu. */
        notifyRunFailed(payload) {
            const reason = payload && payload.reason;

            if (reason === 'http') {
                const status = payload && payload.status ? ` (HTTP ${payload.status})` : '';

                show('Hades — beh neprešiel', `Server beh odmietol${status}. Podrobnosti sú v okne.`);

                return;
            }

            show(
                'Hades — beh sa prerušil',
                'Spojenie so serverom spadlo počas behu. Rozpísaná odpoveď sa nedokončí.',
            );
        },

        destroy() {
            tray.destroy();
        },
    };
}

module.exports = { createTray, humanDuration };
