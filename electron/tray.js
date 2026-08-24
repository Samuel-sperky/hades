'use strict';

/**
 * Hades — desktop shell (systémový tray).
 *
 * Tray je hlavne kvôli jednej veci: notifikácii „beh čaká na potvrdenie zápisu".
 * Charón beží dvojfázovo — zápisový tool zaparkuje a turn skončí BEZ rámca `end`
 * (viď CLAUDE.md, Charón). Keď je človek mimo okna, dnes o tom nevie. Tray to
 * oznámi a klik na notifikáciu vráti okno na to vlákno (okno naň už je nastavené,
 * len ho treba vytiahnuť dopredu).
 *
 * Do notifikácie NEIDE obsah zápisu — to je výstup modelu a ostáva v okne. Hlási
 * sa len, že beh čaká, a na ktorý nástroj.
 *
 * Menu: Otvoriť · Graf · Charón · Spustiť pri prihlásení (prepínač) · Ukončiť.
 * Auto-start je DEFAULTNE VYPNUTÝ — nikdy sa nezapína sám; iba človek ho prepne
 * a Electron si to uloží cez `app.setLoginItemSettings`. Stav sa číta späť z OS,
 * takže prepínač vždy zrkadlí skutočnosť, nie doménu tu.
 *
 * Preklad názvov zápisových nástrojov je len pre notifikáciu (UI text slovensky).
 */

const { app, Tray, Menu, Notification, nativeImage } = require('electron');

/** Známe zápisové nástroje Charóna → čo notifikácia povie, „na čo" beh čaká. */
const TOOL_LABEL = {
    mind_learn: 'zápis do pamäte',
    mind_forget: 'vymazanie z pamäte',
    file_write: 'zápis do súboru',
    file_edit: 'úpravu súboru',
};

/** Z názvu nástroja urob vetu bez obsahu zápisu; neznámy nástroj ostane vecný. */
function bodyFor(name) {
    const label = TOOL_LABEL[name];

    if (label) {
        return `Charón čaká na ${label}. Otvor okno a rozhodni.`;
    }

    return 'Charón čaká na potvrdenie zápisu. Otvor okno a rozhodni.';
}

/**
 * @param {object} deps
 * @param {string} deps.iconPath        Cesta k ikone tray (rovnaká ako ikona okna).
 * @param {string} [deps.version]        Verzia appky (z package.json) — ukáže sa v menu.
 * @param {() => void} deps.onOpen       Vytiahni a zaostri okno (Otvoriť / klik na tray / klik na notifikáciu).
 * @param {(screen: string) => void} deps.onScreen  Prepni obrazovku appky ('graf' | 'charon').
 * @param {() => void} deps.onQuit       Ukonči appku.
 */
function createTray(deps) {
    const { iconPath, version, onOpen, onScreen, onQuit } = deps;

    const tray = new Tray(nativeImage.createFromPath(iconPath));

    function buildMenu() {
        // Stav auto-startu sa číta z OS pri každom otvorení menu — prepínač tak
        // zrkadlí skutočnosť, aj keď ju zmenil niekto iný.
        const openAtLogin = app.getLoginItemSettings().openAtLogin;

        return Menu.buildFromTemplate([
            // Verzia je len informatívna (disabled) — človek vidí, čo mu beží.
            { label: version ? `Hades ${version}` : 'Hades', enabled: false },
            { type: 'separator' },
            { label: 'Otvoriť', click: onOpen },
            { type: 'separator' },
            { label: 'Graf', click: () => onScreen('graf') },
            { label: 'Charón', click: () => onScreen('charon') },
            { type: 'separator' },
            {
                label: 'Spustiť pri prihlásení',
                type: 'checkbox',
                checked: openAtLogin,
                click: (item) => {
                    app.setLoginItemSettings({ openAtLogin: item.checked });
                },
            },
            { type: 'separator' },
            { label: 'Ukončiť', click: onQuit },
        ]);
    }

    tray.setToolTip(version ? `Hades ${version} — vedomie` : 'Hades — vedomie');
    tray.setContextMenu(buildMenu());

    // Ľavý klik na Windows nezobrazí kontextové menu — nech aspoň vytiahne okno.
    tray.on('click', () => onOpen());

    return {
        /**
         * Notifikácia „beh čaká na potvrdenie zápisu". Volá sa LEN pri prechode do
         * čakania (main proces posiela jednu udalosť na id karty), nie pri každom rámci.
         */
        notifyPendingWrite(payload) {
            if (!Notification.isSupported()) {
                return;
            }

            const notification = new Notification({
                title: 'Hades — beh čaká na potvrdenie',
                body: bodyFor(payload && payload.name),
                icon: iconPath,
            });

            notification.on('click', () => onOpen());
            notification.show();
        },

        destroy() {
            tray.destroy();
        },
    };
}

module.exports = { createTray };
