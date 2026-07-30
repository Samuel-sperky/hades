/* P8 — WS vrstva (Reverb pulzy).
   Testuje sa to, čo sa dá zlomiť bez povšimnutia: chýbajúca konfigurácia,
   názov kanála, dotiahnutie grafu po reconnecte a preposlanie pulzu na bus. */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

const instances = [];

vi.mock('pusher-js', () => ({
    default: class FakePusher {
        constructor(key, opts) {
            this.key = key;
            this.opts = opts;
            this.channels = new Map();
            this.handlers = new Map();
            this.connection = {
                bind: (ev, fn) => {
                    const list = this.handlers.get(ev) || [];
                    list.push(fn);
                    this.handlers.set(ev, list);
                },
            };
            instances.push(this);
        }

        subscribe(name) {
            const events = new Map();
            const ch = { name, bind: (ev, fn) => { events.set(ev, fn); return ch; }, events };
            this.channels.set(name, ch);
            return ch;
        }

        state(current) { (this.handlers.get('state_change') || []).forEach((fn) => fn({ current })); }

        pulse(type, data) {
            const ch = [...this.channels.values()][0];
            ch.events.get('pulse')({ type, data });
        }
    },
}));

let ws, S, bus, EV;

beforeAll(async () => {
    installGraphDom('<div id="header-metrics"></div>');
    ws = await import('../../resources/js/graph/ws.js');
    ({ S } = await import('../../resources/js/core/state/index.js'));
    ({ bus } = await import('../../resources/js/core/bus.js'));
    ({ EV } = await import('../../resources/js/core/events.js'));
});

beforeEach(() => {
    instances.length = 0;
    S.nodes = [];
    S.edges = [];
    S.byId = new Map();
    S.screen = 'dnes';       // slučka kreslenia mimo Grafu zaparkuje
    S.sound = false;
    document.querySelectorAll('#toasts .toast').forEach((el) => el.remove());
});

const cfg = { key: 'test-key', host: 'localhost', port: 8083, app_port: String(window.location.port || '') };

describe('graph/ws.js — connectWs', () => {
    it('does nothing without a ws config (app must survive a missing Reverb)', () => {
        expect(ws.connectWs(null)).toBe(null);
        expect(ws.connectWs({})).toBe(null);
        expect(instances.length).toBe(0);
    });

    it('subscribes to the mind channel by default and to ws.channel when the server sends one', () => {
        ws.connectWs(cfg);
        expect([...instances[0].channels.keys()]).toEqual(['mind']);

        ws.connectWs({ ...cfg, channel: 'aura' });
        expect([...instances[1].channels.keys()]).toEqual(['aura']);
    });

    it('warns once on a dropped connection and confirms the recovery', () => {
        const p = ws.connectWs(cfg);
        p.state('connected');                       // prvé pripojenie — bez hlásenia
        expect(document.querySelectorAll('#toasts .toast').length).toBe(0);

        p.state('unavailable');
        p.state('unavailable');                     // druhý pokus už nehlási znova
        const toasts = [...document.querySelectorAll('#toasts .toast')];
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toContain('odpojené');

        p.state('connected');
        expect(document.querySelectorAll('#toasts .toast').length).toBe(2);
        expect([...document.querySelectorAll('#toasts .toast')].pop().textContent).toContain('obnovené');
    });

    it('forwards every pulse to the bus (§4.4) and refreshes the header metrics', () => {
        const seen = [];
        const off = bus.on(EV.PULSE, (p) => seen.push(p));
        const p = ws.connectWs(cfg);

        p.pulse('edge.deleted', { id: 999999 });    // neznáma hrana — čistá no-op vetva

        expect(seen).toEqual([{ type: 'edge.deleted', data: { id: 999999 } }]);
        expect(document.getElementById('header-metrics').textContent).toContain('uzlov');
        expect(document.getElementById('graph-summary')).not.toBe(null);
        off();
    });

    it('keeps a missing #structure-tree from killing the pulse', () => {
        const p = ws.connectWs(cfg);
        expect(document.getElementById('structure-tree')).toBe(null);
        expect(() => p.pulse('node.updated', { node: { id: 1, label: 'x' } })).not.toThrow();
    });
});
