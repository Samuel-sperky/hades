/* Focus trap v modaloch (rozhodnutie #80) — zmena logiky, teda test.
   Overuje sa cyklenie Tab/Shift+Tab vnútri dialógu, počiatočný fókus a návrat
   fókusu na spúšťač po zatvorení. */

import { beforeEach, describe, expect, it } from 'vitest';
import { trapFocus } from '../../resources/js/shell/focus-trap.js';

/** jsdom nemá layout — offsetWidth je vždy 0, takže ho pre test doplníme. */
function makeVisible(root) {
    root.querySelectorAll('button, input, a[href]').forEach((el) => {
        Object.defineProperty(el, 'offsetWidth', { value: 10, configurable: true });
        Object.defineProperty(el, 'offsetHeight', { value: 10, configurable: true });
    });
}

function tab(el, shift = false) {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev;
}

describe('focus-trap', () => {
    let opener, dialog, first, mid, last;

    beforeEach(() => {
        document.body.innerHTML = `
            <button id="opener">Otvor</button>
            <div id="dlg">
                <button id="a">A</button>
                <input id="b">
                <button id="c">C</button>
            </div>`;
        opener = document.getElementById('opener');
        dialog = document.getElementById('dlg');
        first = document.getElementById('a');
        mid = document.getElementById('b');
        last = document.getElementById('c');
        makeVisible(document.body);
        opener.focus();
    });

    it('pri otvorení dá fókus na prvý prvok dialógu', async () => {
        trapFocus(dialog);
        await new Promise((r) => setTimeout(r, 30));
        expect(document.activeElement).toBe(first);
    });

    it('rešpektuje zadaný initial element', async () => {
        trapFocus(dialog, { initial: last });
        await new Promise((r) => setTimeout(r, 30));
        expect(document.activeElement).toBe(last);
    });

    it('Tab na poslednom prvku sa vráti na prvý', () => {
        trapFocus(dialog);
        last.focus();
        const ev = tab(last);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
    });

    it('Shift+Tab na prvom prvku skočí na posledný', () => {
        trapFocus(dialog);
        first.focus();
        const ev = tab(first, true);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
    });

    it('Tab v strede dialógu nechá prehliadač robiť svoje', () => {
        trapFocus(dialog);
        mid.focus();
        const ev = tab(mid);
        expect(ev.defaultPrevented).toBe(false);
    });

    it('release vráti fókus na spúšťač', () => {
        const release = trapFocus(dialog);
        first.focus();
        release();
        expect(document.activeElement).toBe(opener);
    });

    it('po release už Tab necyklí (listener je odpojený)', () => {
        const release = trapFocus(dialog);
        release();
        last.focus();
        const ev = tab(last);
        expect(ev.defaultPrevented).toBe(false);
    });

    it('chýbajúci kontejner nič nezhodí', () => {
        expect(() => trapFocus(null)()).not.toThrow();
    });
});
