'use strict';

/**
 * Hades — desktop shell (globálna klávesová skratka).
 *
 * Jedna skratka, jedna úloha: vytiahnuť okno a byť rovno v chate s kurzorom
 * v composeri (kontrakt §3 bod 1). Zmysel je ten istý ako u tray notifikácie —
 * Hades má byť po ruke aj vtedy, keď okno nie je vidieť.
 *
 * ─── Čo sa tu drží ──────────────────────────────────────────────────────────
 *
 *  • **Dá sa vypnúť.** `settings.json` → `shortcut.enabled`; tray má prepínač.
 *  • **Registruje sa a ODREGISTRUJE.** `globalShortcut` je systémový prostriedok:
 *    kým appka drží `Ctrl+Shift+H`, nikto iný ho nedostane. Odhlásenie preto
 *    nevisí na tom, či sa korektne zavrelo okno — `main.js` volá `unregister()`
 *    v `will-quit`, a Electron pri ukončení procesu uvolní zvyšok sám.
 *  • **Obsadená skratka nie je pád.** `register()` vracia `false`, keď akcelerátor
 *    drží iná appka, a na neplatný text hodí výnimku. Oboje sa tu prežúva na
 *    stav, ktorý tray vie ukázať — appka kvôli skratke nezhasne.
 */

const { globalShortcut } = require('electron');

/**
 * Vyzerá to vôbec ako akcelerátor?
 *
 * `globalShortcut.register` totiž na `Ctrl+Shift+` **nehodí výnimku** — namerané
 * v Electrone 43.4.1: vypíše varovanie „doesn't contain a valid key" a vráti
 * `false`, teda presne to isté ako obsadená skratka. Bez tejto kontroly by tray
 * o preklepe v `settings.json` tvrdil, že skratku „drží iná appka".
 *
 * Kontrola je zámerne hrubá — od formátu Electronu sa nedá odvodiť úplná gramatika
 * a nemá zmysel ju tu duplikovať. Stačí to, čo rozlíši preklep od obsadenia: žiadny
 * prázdny diel, teda ani chýbajúca klávesa na konci.
 */
function looksLikeAccelerator(text) {
    const parts = text.split('+');

    return parts.length > 0 && parts.every((part) => part.trim() !== '');
}

/**
 * @param {object} deps
 * @param {() => string} deps.getAccelerator  Akcelerátor z nastavení.
 * @param {() => boolean} deps.isEnabled      Má byť skratka aktívna?
 * @param {() => void} deps.onTrigger         Čo skratka urobí (vytiahnuť okno + chat).
 */
function createShortcut(deps) {
    const { getAccelerator, isEnabled, onTrigger } = deps;

    /** Akcelerátor, ktorý je NAOZAJ zaregistrovaný (nie ten želaný). */
    let active = null;

    /** Prečo to nejde, keď to nejde: 'taken' (drží ju iná appka) | 'invalid' (nečitateľný text). */
    let failure = null;

    function unregister() {
        if (active === null) {
            return;
        }

        try {
            globalShortcut.unregister(active);
        } catch {
            // Neplatný akcelerátor sa ani zaregistrovať nedal — niet čo uvolniť.
        }

        active = null;
    }

    /** Dorovná skutočnosť podľa nastavení. Idempotentné — dá sa volať po každej zmene. */
    function apply() {
        const wanted = isEnabled() ? String(getAccelerator() || '').trim() : '';

        if (wanted === (active || '')) {
            if (wanted !== '') {
                failure = null;
            }

            return status();
        }

        unregister();
        failure = null;

        if (wanted === '') {
            return status();
        }

        if (!looksLikeAccelerator(wanted)) {
            failure = 'invalid';

            return status();
        }

        let ok = false;

        try {
            ok = globalShortcut.register(wanted, onTrigger);
        } catch {
            failure = 'invalid';

            return status();
        }

        if (ok) {
            active = wanted;
        } else {
            failure = 'taken';
        }

        return status();
    }

    function status() {
        return { accelerator: active, failure };
    }

    return { apply, unregister, status };
}

module.exports = { createShortcut };
