import { describe, it, expect } from 'vitest';
import { parseQueryFilter, certTagMatch } from '../../resources/js/core/query-filter.js';

describe('core/query-filter.js', () => {
    it('returns the plain text when no prefix is used', () => {
        expect(parseQueryFilter('docker compose')).toEqual({ text: 'docker compose', cert: null, tag: null });
    });

    it('extracts cert: and tag: prefixes and strips them from the text', () => {
        expect(parseQueryFilter('cert:overene docker')).toEqual({ text: 'docker', cert: 'overene', tag: null });
        expect(parseQueryFilter('tag:Docker vite')).toEqual({ text: 'vite', cert: null, tag: 'docker' });
        expect(parseQueryFilter('CERT:Pasca tag:CI x')).toEqual({ text: 'x', cert: 'pasca', tag: 'ci' });
    });

    it('handles empty input', () => {
        expect(parseQueryFilter('')).toEqual({ text: '', cert: null, tag: null });
        expect(parseQueryFilter(null)).toEqual({ text: '', cert: null, tag: null });
    });

    it('matches certainty exactly', () => {
        const pf = parseQueryFilter('cert:overene');
        expect(certTagMatch({ certainty: 'overene' }, pf)).toBe(true);
        expect(certTagMatch({ certainty: 'hypoteza' }, pf)).toBe(false);
    });

    it('treats cert:bez and cert:none as "no certainty"', () => {
        expect(certTagMatch({ certainty: null }, parseQueryFilter('cert:bez'))).toBe(true);
        expect(certTagMatch({ certainty: null }, parseQueryFilter('cert:none'))).toBe(true);
        expect(certTagMatch({ certainty: 'overene' }, parseQueryFilter('cert:bez'))).toBe(false);
    });

    it('matches tags case-insensitively as a substring', () => {
        const pf = parseQueryFilter('tag:dock');
        expect(certTagMatch({ tags: ['Docker'] }, pf)).toBe(true);
        expect(certTagMatch({ tags: ['vite'] }, pf)).toBe(false);
        expect(certTagMatch({}, pf)).toBe(false);
    });

    it('passes everything through when the filter is empty', () => {
        expect(certTagMatch({ certainty: null, tags: [] }, parseQueryFilter('text'))).toBe(true);
    });
});
