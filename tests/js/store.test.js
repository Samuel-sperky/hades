import { describe, it, expect, beforeEach } from 'vitest';
import { store, NS, LEGACY_MAP } from '../../resources/js/core/store.js';

describe('core/store.js — namespace + legacy shim', () => {
    beforeEach(() => localStorage.clear());

    it('writes and reads namespaced raw values', () => {
        store.setRaw('theme', 'dark');
        expect(localStorage.getItem('aura.theme')).toBe('dark');
        expect(store.raw('theme')).toBe('dark');
        expect(NS).toBe('aura.');
    });

    it('returns the fallback for a missing key', () => {
        expect(store.raw('nope', 'x')).toBe('x');
        expect(store.raw('nope')).toBe(null);
        expect(store.get('nope', 42)).toBe(42);
    });

    it('round-trips JSON values', () => {
        store.set('opts', { glow: 1, anim: 0.5 });
        expect(store.get('opts', {})).toEqual({ glow: 1, anim: 0.5 });
    });

    it('falls back to the default on corrupted JSON instead of throwing', () => {
        localStorage.setItem('aura.opts', '{not json');
        expect(store.get('opts', { glow: 1 })).toEqual({ glow: 1 });
    });

    it('migrates every legacy Hades key exactly once', () => {
        localStorage.setItem('hades.theme', 'dark');
        localStorage.setItem('hades.minWeight2', '2.5');
        localStorage.setItem('hades.hints2', 'done');
        expect(store.migrateLegacy()).toBe(3);
        expect(localStorage.getItem('aura.theme')).toBe('dark');
        expect(localStorage.getItem('aura.minWeight')).toBe('2.5');
        expect(localStorage.getItem('aura.hints')).toBe('done');
        // old keys stay as the rollback safety net
        expect(localStorage.getItem('hades.theme')).toBe('dark');
        // idempotent
        expect(store.migrateLegacy()).toBe(0);
    });

    it('never lets a legacy value overwrite a newer one', () => {
        localStorage.setItem('hades.theme', 'dark');
        localStorage.setItem('aura.theme', 'light');
        store.migrateLegacy();
        expect(localStorage.getItem('aura.theme')).toBe('light');
    });

    it('reads through to the legacy key when the new one is absent', () => {
        localStorage.setItem('aura.__migrated', '1');   // migration already done
        localStorage.setItem('hades.view', 'layers');
        expect(store.raw('view')).toBe('layers');
        store.setRaw('view', 'net');                    // writes go to the new key only
        expect(localStorage.getItem('aura.view')).toBe('net');
        expect(localStorage.getItem('hades.view')).toBe('layers');
    });

    it('covers all 17 documented preferences', () => {
        expect(Object.keys(LEGACY_MAP)).toHaveLength(17);
        for (const [from, to] of Object.entries(LEGACY_MAP)) {
            expect(from.startsWith('hades.')).toBe(true);
            expect(to.startsWith('aura.')).toBe(true);
        }
    });

    it('del removes the namespaced key', () => {
        store.setRaw('forces', '{}');
        store.del('forces');
        expect(localStorage.getItem('aura.forces')).toBe(null);
    });
});
