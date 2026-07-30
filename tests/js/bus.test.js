import { describe, it, expect, vi } from 'vitest';
import { bus } from '../../resources/js/core/bus.js';
import { EV } from '../../resources/js/core/events.js';

describe('core/bus.js', () => {
    it('delivers a payload to every subscriber', () => {
        const a = vi.fn(); const b = vi.fn();
        const offA = bus.on('t:1', a); const offB = bus.on('t:1', b);
        bus.emit('t:1', { x: 1 });
        expect(a).toHaveBeenCalledWith({ x: 1 });
        expect(b).toHaveBeenCalledWith({ x: 1 });
        offA(); offB();
    });

    it('unsubscribes via the returned function', () => {
        const fn = vi.fn();
        bus.on('t:2', fn)();
        bus.emit('t:2');
        expect(fn).not.toHaveBeenCalled();
    });

    it('once fires exactly one time', () => {
        const fn = vi.fn();
        bus.once('t:3', fn);
        bus.emit('t:3'); bus.emit('t:3');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('emitting an unknown event is a no-op', () => {
        expect(() => bus.emit('t:nobody')).not.toThrow();
    });

    it('one throwing handler does not stop the others', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const good = vi.fn();
        const offBad = bus.on('t:4', () => { throw new Error('boom'); });
        const offGood = bus.on('t:4', good);
        bus.emit('t:4');
        expect(good).toHaveBeenCalled();
        expect(err).toHaveBeenCalled();
        offBad(); offGood(); err.mockRestore();
    });

    it('event catalogue is frozen in shape', () => {
        expect(EV.SCREEN_CHANGED).toBe('screen:changed');
        expect(EV.GRAPH_LOADED).toBe('graph:loaded');
        expect(Object.keys(EV).length).toBe(21);
    });
});
