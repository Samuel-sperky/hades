import { describe, it, expect } from 'vitest';
import { plural, truncLabel, timeAgo, dayLabel, timeHM, monthLabel, ts, rad } from '../../resources/js/core/format.js';

describe('core/format.js', () => {
    it('picks the Slovak plural form', () => {
        expect(plural(1, 'poznatok', 'poznatky', 'poznatkov')).toBe('poznatok');
        expect(plural(3, 'poznatok', 'poznatky', 'poznatkov')).toBe('poznatky');
        expect(plural(11, 'poznatok', 'poznatky', 'poznatkov')).toBe('poznatkov');
        expect(plural(0, 'poznatok', 'poznatky', 'poznatkov')).toBe('poznatkov');
    });

    it('truncates canvas labels at 24 characters', () => {
        expect(truncLabel('krátky')).toBe('krátky');
        const long = truncLabel('a'.repeat(40));
        expect(long.endsWith('…')).toBe(true);
        expect(Array.from(long).length).toBe(24);
    });

    it('keeps multibyte labels intact', () => {
        expect(truncLabel('ľščťžýáíé')).toBe('ľščťžýáíé');
    });

    it('formats relative time in Slovak units', () => {
        const iso = (ms) => new Date(Date.now() - ms).toISOString();
        expect(timeAgo(iso(60_000))).toBe('1 min');
        expect(timeAgo(iso(7_200_000))).toBe('2 h');
        expect(timeAgo(iso(3 * 86_400_000))).toBe('3 d');
        expect(timeAgo(null)).toBe('');
    });

    it('labels today and yesterday', () => {
        expect(dayLabel(new Date().toISOString())).toBe('Dnes');
        expect(dayLabel(new Date(Date.now() - 86_400_000).toISOString())).toBe('Včera');
        expect(dayLabel('2026-03-14T10:00:00')).toBe('14. marca 2026');
    });

    it('formats hh:mm and month labels', () => {
        expect(timeHM('2026-03-14T09:05:00')).toMatch(/^\d{2}:\d{2}$/);
        expect(monthLabel('2026-03')).toContain('2026');
        expect(monthLabel(null)).toBe('Bez dátumu');
    });

    it('ts and rad are pure', () => {
        expect(ts(null)).toBe(0);
        expect(ts('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'));
        expect(rad(180)).toBeCloseTo(Math.PI);
    });
});
