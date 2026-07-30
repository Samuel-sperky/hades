import { describe, expect, it } from 'vitest';

import { ApiError } from '../../../resources/js/core/api.js';
import {
    describeApiError,
    emptyStateHtml,
    kpiCardHtml,
    kpiGridHtml,
    sectionHtml,
} from '../../../resources/js/screens/shared/anatomy.js';
import { certBadge } from '../../../resources/js/screens/shared/cert.js';
import { originBadge } from '../../../resources/js/screens/shared/origin-badge.js';
import { recentActivity } from '../../../resources/js/screens/today/kpi.js';

/* Stavebné bloky anatómie obrazoviek. Držia dve veci, ktoré sa inak tichým
   regresom rozbijú: escapovanie vstupu a to, že prázdny vstup nevyrobí prázdnu
   mriežku (bod 5 zadania — každá obrazovka má zmysluplný prázdny stav). */

describe('kpiGridHtml', () => {
    it('prázdny vstup nevykreslí mriežku', () => {
        expect(kpiGridHtml([])).toBe('');
        expect(kpiGridHtml(null)).toBe('');
        expect(kpiGridHtml([null, undefined])).toBe('');
    });

    it('hero karta dostane triedu kpi-hero', () => {
        expect(kpiCardHtml({ value: 1, label: 'x', hero: true })).toContain('kpi-hero');
        expect(kpiCardHtml({ value: 1, label: 'x' })).not.toContain('kpi-hero');
    });

    it('hodnoty aj popisky sú escapované', () => {
        const h = kpiCardHtml({ value: '<b>1</b>', label: '<i>x</i>', suffix: '&' });
        expect(h).not.toContain('<b>');
        expect(h).not.toContain('<i>');
        expect(h).toContain('&amp;');
    });

    it('chýbajúca hodnota je nula, nie undefined', () => {
        expect(kpiCardHtml({ label: 'x' })).toContain('>0<');
    });

    it('data-cert prejde na kartu (kvôli klikateľnej „na overenie")', () => {
        expect(kpiCardHtml({ value: 5, label: 'na overenie', cert: 'pending' }))
            .toContain('data-cert="pending"');
    });
});


describe('sectionHtml', () => {
    it('používa rodinné .section-head / .section-title z P9', () => {
        const h = sectionHtml('Titul', '<p>telo</p>');
        expect(h).toContain('class="section-head"');
        expect(h).toContain('class="section-title"');
    });

    it('escapuje titul, ale lead vkladá ako HTML', () => {
        const h = sectionHtml('<script>x</script>', '', { lead: '<span class="lib-dot"></span>' });
        expect(h).not.toContain('<script>');
        expect(h).toContain('<span class="lib-dot"></span>');
    });

    it('note sa vykreslí len keď je zadaný', () => {
        expect(sectionHtml('T', '')).not.toContain('sec-note');
        expect(sectionHtml('T', '', { note: '3 skillov' })).toContain('3 skillov');
    });
});


describe('emptyStateHtml', () => {
    it('nesie nadpis aj vysvetlenie', () => {
        const h = emptyStateHtml('gavel', 'Nič tu nie je', 'Skús toto');
        expect(h).toContain('es-title');
        expect(h).toContain('es-hint');
        expect(h).toContain('gavel');
    });

    it('bez akcie nevykreslí tlačidlo', () => {
        expect(emptyStateHtml('x', 'T', null)).not.toContain('empty-act');
        expect(emptyStateHtml('x', 'T', null, { id: 'go', label: 'Ísť' })).toContain('id="go"');
    });

    it('escapuje text', () => {
        expect(emptyStateHtml('x', '<b>T</b>')).not.toContain('<b>');
    });
});


describe('describeApiError', () => {
    it('každý kód z rozhrania #1 má SK hlášku', () => {
        const codes = ['unauthorized', 'rate_limited', 'unavailable', 'timeout',
            'aborted', 'offline', 'server', 'bad_request'];
        for (const code of codes) {
            const d = describeApiError(new ApiError({ code }));
            expect(d.title, code).toBeTruthy();
            expect(d.icon, code).toBeTruthy();
        }
    });

    it('neznámy alebo chýbajúci kód padne na serverovú hlášku', () => {
        expect(describeApiError(new ApiError({ code: 'nieco' })).title)
            .toBe(describeApiError(new ApiError({ code: 'server' })).title);
        expect(describeApiError(null).title).toBeTruthy();
    });
});


describe('badge helpery', () => {
    it('certBadge padne na „bez" pri neznámej istote', () => {
        expect(certBadge('nezmysel')).toContain('data-cert="bez"');
        expect(certBadge('pasca')).toContain('data-cert="pasca"');
    });

    it('iconOnly variant nevypisuje text, ale má title', () => {
        const h = certBadge('overene', true);
        expect(h).toContain('cert--icon');
        expect(h).toContain('title="Overené"');
        expect(h).not.toContain('>Overené<');
    });

    it('originBadge pozná len brain a session', () => {
        expect(originBadge('brain')).toContain('data-origin="brain"');
        expect(originBadge('cokolvek')).toContain('data-origin="session"');
    });
});


describe('recentActivity', () => {
    const heatmap = {
        weeks: [
            [null, { date: '2026-07-01', count: 3 }, null, null, null, null, null],
            [{ date: '2026-07-08', count: 1 }, { date: '2026-07-09', count: 0 }, null, null, null, null, null],
        ],
    };

    it('sploští týždne, vyhodí prázdne bunky a zoradí podľa dátumu', () => {
        expect(recentActivity(heatmap)).toEqual([3, 1, 0]);
    });

    it('drží posledných N dní', () => {
        expect(recentActivity(heatmap, 2)).toEqual([1, 0]);
    });

    it('znesie prázdny alebo chýbajúci payload', () => {
        expect(recentActivity({})).toEqual([]);
        expect(recentActivity(null)).toEqual([]);
    });
});
