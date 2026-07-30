/* Tiny synchronous pub/sub so modules never need to import each other just to
   notify. Event names come from core/events.js (closed catalogue). */

const handlers = new Map();

export const bus = {
    /** @returns {() => void} unsubscribe */
    on(event, fn) {
        let set = handlers.get(event);
        if (!set) { set = new Set(); handlers.set(event, set); }
        set.add(fn);
        return () => { set.delete(fn); };
    },
    once(event, fn) {
        const off = bus.on(event, (payload) => { off(); fn(payload); });
        return off;
    },
    emit(event, payload) {
        const set = handlers.get(event);
        if (!set || !set.size) return;
        for (const fn of [...set]) {
            try { fn(payload); } catch (e) { console.error('[aura:bus] ' + event, e); }
        }
    },
};
