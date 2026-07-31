/* Virtuálna klávesnica na mobile (#76, akceptačné kritérium 3).

   Testuje sa čistá logika shell/viewport.js: prevod stavu visualViewportu na
   --kb-inset a prepínač body.kb-open. Samotné CSS (--mobile-bottom) je vizuálna
   vrstva a overuje sa v prehliadači, nie tu. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    KB_MIN_INSET,
    applyKeyboardInset,
    keyboardInset,
    register,
} from '../../resources/js/shell/viewport.js';

/** Minimálny mock visualViewportu. */
const vv = (height, offsetTop = 0) => ({ height, offsetTop });

describe('keyboardInset', () => {
    it('zatvorená klávesnica → 0', () => {
        expect(keyboardInset(vv(844), 844)).toBe(0);
    });

    it('otvorená klávesnica → jej výška', () => {
        // layout 844, viditeľných 500 → klávesnica 344 px
        expect(keyboardInset(vv(500), 844)).toBe(344);
    });

    it('kolaps adresného riadka pod prahom sa neberie ako klávesnica', () => {
        // 90 px je typický iOS URL bar, nie klávesnica
        expect(keyboardInset(vv(754), 844)).toBe(0);
        expect(KB_MIN_INSET).toBeGreaterThan(90);
    });

    it('presne na prahu sa už počíta', () => {
        expect(keyboardInset(vv(844 - KB_MIN_INSET), 844)).toBe(KB_MIN_INSET);
    });

    it('offsetTop (odscrollovaný visual viewport) sa odpočíta', () => {
        expect(keyboardInset(vv(500, 44), 844)).toBe(300);
    });

    it('bez visualViewportu vracia 0', () => {
        expect(keyboardInset(null, 844)).toBe(0);
    });
});

describe('applyKeyboardInset', () => {
    beforeEach(() => {
        document.body.className = '';
        document.documentElement.style.removeProperty('--kb-inset');
    });

    it('otvorená klávesnica nastaví body.kb-open aj --kb-inset', () => {
        expect(applyKeyboardInset(320)).toBe(true);
        expect(document.body.classList.contains('kb-open')).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('320px');
    });

    it('nula triedu odoberie a inset vynuluje', () => {
        applyKeyboardInset(320);
        expect(applyKeyboardInset(0)).toBe(false);
        expect(document.body.classList.contains('kb-open')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('0px');
    });
});

describe('register', () => {
    beforeEach(() => {
        document.body.className = '';
        document.documentElement.style.removeProperty('--kb-inset');
    });

    it('bez visualViewportu nespadne a nič nenastaví', () => {
        const orig = window.visualViewport;
        delete window.visualViewport;
        expect(() => register()).not.toThrow();
        expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('');
        if (orig) window.visualViewport = orig;
    });

    it('naviaže resize/scroll a zosynchronizuje sa hneď', () => {
        const listeners = {};
        const fake = {
            height: 500,
            offsetTop: 0,
            addEventListener: vi.fn((ev, fn) => { listeners[ev] = fn; }),
        };
        const orig = window.visualViewport;
        window.visualViewport = fake;
        window.innerHeight = 844;

        register();

        expect(fake.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
        expect(fake.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
        // úvodný sync: 844 - 500 = 344
        expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('344px');
        expect(document.body.classList.contains('kb-open')).toBe(true);

        // klávesnica sa zatvorí → listener to musí premietnuť
        fake.height = 844;
        listeners.resize();
        expect(document.body.classList.contains('kb-open')).toBe(false);

        if (orig) window.visualViewport = orig; else delete window.visualViewport;
    });
});
