import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { T, invalidateCanvasColors, setCanvasTheme } from '../../resources/js/graph/canvas-colors.js';

/* §7.4 — canvas paleta sa čita z CSS tokenov. Táto sada je PARITNÝ test: hodnoty musia
   zostať bit-za-bit tie isté ako pôvodný THEMES literál z W0 (rozhodnutie „farebné
   hodnoty Aura palety sa nemenia"). */

// Pôvodný W0 literál — referencia, proti ktorej sa meria. Needituje sa.
const W0 = {
    light: { paper: '#f8f4f7', ink: '#101d1b', inkSoft: '#2d3a38', muted: '#566964', labelHalo: 'rgba(248,244,247,0.92)', edge: '45,58,56', gridColor: '3,121,126', accent: '3,121,126', outline: 'rgba(16,29,27,0.35)', gridAlpha: 0.05, nodeFloor: 0.30, edgeFloor: 0.20 },
    dark: { paper: '#0e1413', ink: '#eaf3f1', inkSoft: '#c3d1ce', muted: '#8a9b98', labelHalo: 'rgba(14,20,19,0.92)', edge: '195,209,206', gridColor: '5,188,196', accent: '5,188,196', outline: 'rgba(234,243,241,0.30)', gridAlpha: 0.09, nodeFloor: 0.35, edgeFloor: 0.25 },
};

// tokens.css / dark.css / graph/canvas.css v podobe, v akej ich vidí getComputedStyle
const TOKENS = {
    light: {
        '--bg-rgb': '248, 244, 247', '--text': '#101d1b', '--text-secondary': '#2d3a38',
        '--muted': '#566964', '--accent-rgb': '3, 121, 126',
        '--canvas-grid-alpha': '0.05', '--canvas-node-floor': '0.30',
        '--canvas-edge-floor': '0.20', '--canvas-halo-alpha': '0.92',
        '--canvas-outline-alpha': '0.35',
    },
    dark: {
        '--bg-rgb': '14, 20, 19', '--text': '#eaf3f1', '--text-secondary': '#c3d1ce',
        '--muted': '#8a9b98', '--accent-rgb': '5, 188, 196',
        '--canvas-grid-alpha': '0.09', '--canvas-node-floor': '0.35',
        '--canvas-edge-floor': '0.25', '--canvas-halo-alpha': '0.92',
        '--canvas-outline-alpha': '0.30',
    },
};

function applyTokens(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    for (const [k, v] of Object.entries(TOKENS[theme])) root.style.setProperty(k, v);
    setCanvasTheme(theme);
}

// rgba(r,g,b,0.30) a rgba(r,g,b,0.3) je pre canvas tá istá farba — porovnávame po normalizácii alfy
function normAlpha(v) {
    return typeof v === 'string'
        ? v.replace(/rgba\(([^)]*),\s*([\d.]+)\)/, (_m, rgb, a) => 'rgba(' + rgb + ',' + parseFloat(a) + ')')
        : v;
}

function norm(obj) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, normAlpha(v)]));
}

function snapshot() {
    return norm({
        paper: T.paper, ink: T.ink, inkSoft: T.inkSoft, muted: T.muted,
        labelHalo: T.labelHalo, edge: T.edge, gridColor: T.gridColor, accent: T.accent,
        outline: T.outline, gridAlpha: T.gridAlpha, nodeFloor: T.nodeFloor, edgeFloor: T.edgeFloor,
    });
}

beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    invalidateCanvasColors();
});

afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
    invalidateCanvasColors();
});

describe('canvas paleta z CSS tokenov', () => {
    it('light téma sedí na W0 hodnoty', () => {
        applyTokens('light');
        expect(snapshot()).toEqual(norm(W0.light));
        expect(T.dark).toBe(false);
    });

    it('dark téma sedí na W0 hodnoty', () => {
        applyTokens('dark');
        expect(snapshot()).toEqual(norm(W0.dark));
        expect(T.dark).toBe(true);
    });

    it('bez CSS (jsdom / chýbajúci build) padá na light fallback, nie na prázdne hodnoty', () => {
        expect(snapshot()).toEqual(norm(W0.light));
    });

    it('bez CSS s data-theme=dark padá na dark fallback', () => {
        document.documentElement.dataset.theme = 'dark';
        invalidateCanvasColors();
        expect(snapshot()).toEqual(norm(W0.dark));
    });

    it('setCanvasTheme prepne paletu bez ohľadu na poradie voči data-theme', () => {
        applyTokens('light');
        expect(T.paper).toBe(W0.light.paper);

        // theme.js volá setCanvasTheme PRED nastavením data-theme — lenivé čítanie to znesie
        setCanvasTheme('dark');
        const root = document.documentElement;
        root.dataset.theme = 'dark';
        for (const [k, v] of Object.entries(TOKENS.dark)) root.style.setProperty(k, v);
        expect(T.paper).toBe(W0.dark.paper);
        expect(T.dark).toBe(true);
    });

    it('prepíše sa aj na hodnoty, ktoré nie sú z Aury (tokeny sú zdroj pravdy)', () => {
        applyTokens('light');
        document.documentElement.style.setProperty('--text', '#123456');
        invalidateCanvasColors();
        expect(T.ink).toBe('#123456');
        expect(T.edge).toBe(W0.light.edge); // --text-secondary sa nezmenil
    });

    it('rgb()/rgba() aj skrátený hex sa normalizujú na triplet', () => {
        applyTokens('dark');
        document.documentElement.style.setProperty('--text-secondary', 'rgb(1, 2, 3)');
        document.documentElement.style.setProperty('--accent-rgb', '#fff');
        invalidateCanvasColors();
        expect(T.edge).toBe('1,2,3');
        expect(T.inkSoft).toBe('#010203');
        expect(T.accent).toBe('255,255,255');
    });
});
