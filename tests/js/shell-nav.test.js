/* Navigácia — rail collapse (#54) + mobilný bottom nav a spodný list (#76, #78).
   Router a graf sú mimo rozsahu tohto testu, preto sú mockované; overuje sa
   samotná navigačná logika a persistencia. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

const setScreen = vi.fn();
vi.mock('../../resources/js/shell/router.js', () => ({ setScreen }));

const RAIL_HTML = `
    <nav id="rail">
        <div class="rail-top">
            <button id="brand-core"></button>
            <button id="rail-toggle" aria-expanded="false" aria-label="Rozbaliť navigáciu"></button>
        </div>
        <div class="rail-scroll">
            <div class="rail-group">
                <button class="dest" data-screen="dnes"></button>
                <button class="dest" data-screen="graf"></button>
                <button class="dest" data-screen="chat"></button>
            </div>
        </div>
        <div class="rail-group bottom">
            <button id="btn-settings" data-dock="settings"></button>
            <button id="btn-help"></button>
        </div>
    </nav>`;

const MOBILE_HTML = `
    <nav id="mobile-nav">
        <button class="mdest" data-screen="dnes"></button>
        <button class="mdest" data-screen="chat"></button>
        <button class="mdest" data-screen="dennik"></button>
        <button class="mdest" data-screen="kniznica"></button>
        <button class="mdest" id="mobile-more" aria-expanded="false"></button>
    </nav>
    <section id="mobile-graph-note"><button data-screen="dnes"></button></section>
    <div id="mobile-sheet" class="hidden">
        <div class="msheet-card">
            <button class="close" id="mobile-sheet-close"></button>
            <button class="msheet-item" data-screen="graf"></button>
            <button class="msheet-item" data-screen="rozhodnutia"></button>
            <button class="msheet-item" id="mobile-settings"></button>
            <button class="msheet-item" id="mobile-help"></button>
        </div>
    </div>`;

async function loadRail() {
    vi.resetModules();
    setScreen.mockClear();
    return import('../../resources/js/shell/rail.js');
}

async function loadMobile() {
    vi.resetModules();
    setScreen.mockClear();
    return import('../../resources/js/shell/mobile-nav.js');
}

describe('rail — collapse 72 ↔ 208 px (#54)', () => {
    beforeEach(() => {
        localStorage.clear();
        // rail.js siaha cez graph/camera.js na <canvas id="mind"> — helper P8 ho dodá
        installGraphDom(RAIL_HTML + MOBILE_HTML);
        delete document.documentElement.dataset.rail;
    });

    it('predvolený stav je zbalený (žiadny data-rail)', async () => {
        const { register, railExpanded } = await loadRail();
        register(document.body);
        expect(railExpanded()).toBe(false);
        expect(document.documentElement.dataset.rail).toBeUndefined();
    });

    it('klik na prepínač rozbalí, zapíše a nastaví aria', async () => {
        const { register } = await loadRail();
        register(document.body);
        document.getElementById('rail-toggle').click();

        expect(document.documentElement.dataset.rail).toBe('expanded');
        expect(localStorage.getItem('aura.rail.expanded')).toBe('1');
        const btn = document.getElementById('rail-toggle');
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        expect(btn.getAttribute('aria-label')).toBe('Zbaliť navigáciu');
    });

    it('druhý klik zbalí späť', async () => {
        const { register } = await loadRail();
        register(document.body);
        const btn = document.getElementById('rail-toggle');
        btn.click();
        btn.click();
        expect(document.documentElement.dataset.rail).toBeUndefined();
        expect(localStorage.getItem('aura.rail.expanded')).toBe('0');
        expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('uložený stav sa obnoví pri registrácii', async () => {
        localStorage.setItem('aura.rail.expanded', '1');
        const { register } = await loadRail();
        register(document.body);
        expect(document.documentElement.dataset.rail).toBe('expanded');
    });

    it('destinácie railu volajú setScreen s vlastným data-screen', async () => {
        const { register } = await loadRail();
        register(document.body);
        document.querySelector('#rail .dest[data-screen="graf"]').click();
        expect(setScreen).toHaveBeenCalledWith('graf');
    });
});

describe('mobilná navigácia (#76, #78)', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = MOBILE_HTML;
    });

    it('bottom nav volá setScreen', async () => {
        const { register } = await loadMobile();
        register(document.body);
        document.querySelector('#mobile-nav .mdest[data-screen="dennik"]').click();
        expect(setScreen).toHaveBeenCalledWith('dennik');
    });

    it('„Viac" otvorí a zavrie spodný list', async () => {
        const { register, mobileSheetOpen } = await loadMobile();
        register(document.body);
        const more = document.getElementById('mobile-more');

        more.click();
        expect(mobileSheetOpen()).toBe(true);
        expect(more.getAttribute('aria-expanded')).toBe('true');

        more.click();
        expect(mobileSheetOpen()).toBe(false);
        expect(more.getAttribute('aria-expanded')).toBe('false');
    });

    it('položka v spodnom liste naviguje a list zavrie', async () => {
        const { register, mobileSheetOpen } = await loadMobile();
        register(document.body);
        document.getElementById('mobile-more').click();
        document.querySelector('#mobile-sheet .msheet-item[data-screen="rozhodnutia"]').click();
        expect(setScreen).toHaveBeenCalledWith('rozhodnutia');
        expect(mobileSheetOpen()).toBe(false);
    });

    it('Nastavenia a Pomoc delegujú klik na tlačidlá v rely (jeden zdroj pravdy)', async () => {
        installGraphDom(RAIL_HTML + MOBILE_HTML);
        const settingsHit = vi.fn();
        const helpHit = vi.fn();
        document.getElementById('btn-settings').onclick = settingsHit;
        document.getElementById('btn-help').onclick = helpHit;

        const { register } = await loadMobile();
        register(document.body);
        document.getElementById('mobile-settings').click();
        expect(settingsHit).toHaveBeenCalled();
        document.getElementById('mobile-help').click();
        expect(helpHit).toHaveBeenCalled();
    });

    it('aktívny stav sa zosúladí a „Viac" svieti pri obrazovke mimo štvorice', async () => {
        const { register, syncMobileNav } = await loadMobile();
        register(document.body);

        syncMobileNav('chat');
        expect(document.querySelector('.mdest[data-screen="chat"]').classList.contains('active')).toBe(true);
        expect(document.getElementById('mobile-more').classList.contains('active')).toBe(false);

        syncMobileNav('rozhodnutia');
        expect(document.querySelector('.mdest[data-screen="chat"]').classList.contains('active')).toBe(false);
        expect(document.getElementById('mobile-more').classList.contains('active')).toBe(true);
        expect(document.querySelector('.msheet-item[data-screen="rozhodnutia"]').classList.contains('active')).toBe(true);
    });

    it('výzva „graf je desktop-only" ponúka skok na Dnes', async () => {
        const { register } = await loadMobile();
        register(document.body);
        document.querySelector('#mobile-graph-note [data-screen="dnes"]').click();
        expect(setScreen).toHaveBeenCalledWith('dnes');
    });

    it('bez mobilného markupu register() nič nezhodí', async () => {
        document.body.innerHTML = '<div></div>';
        const { register } = await loadMobile();
        expect(() => register(document.body)).not.toThrow();
    });
});
