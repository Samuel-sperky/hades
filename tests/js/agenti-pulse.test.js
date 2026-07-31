import './support/dom-stubs.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    applyPulse, autonomyMeta, groupByCategory, pulseToState, renderAgenti, statusMeta,
} from '../../resources/js/screens/agenti.js';

/* Živý pulz → karta. Overuje mapovanie AgentPulse (type+data) na stav karty a
   že applyPulse skutočne premietne progres/stav/krok do DOM danej karty. */

const MARKUP = readFileSync(
    resolve(process.cwd(), 'resources/views/partials/screens/agenti.blade.php'), 'utf8',
).replace(/\{\{--[\s\S]*?--\}\}/g, '');

const res = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
let routes = [];
function route(pattern, factory) { routes.unshift([pattern, factory]); }
function installFetch() {
    routes = [];
    global.fetch = vi.fn(async (url, init) => {
        const path = String(url);
        for (const [pattern, factory] of routes) if (pattern.test(path)) return factory(path, init);
        throw new Error('neošetrená cesta: ' + path);
    });
}

const AGENTS_BODY = {
    agents: [
        {
            key: 'aura-dry-run', command: 'aura:dry-run', label: 'Dry-run', description: 'Nič nemení.',
            category: 'maintenance', autonomy: 'manual', destructive: false, schedule: 'Na požiadanie',
            placeholder: false, latest_run: null, next_run: 'Na požiadanie',
        },
    ],
    summary: { total: 1, autonomous: 0, running: 0 },
    destructive_enabled: false,
};


describe('pulseToState — mapovanie typov pulzu na stav', () => {
    it('run.started → beží', () => {
        expect(pulseToState('run.started').status).toBe('running');
    });
    it('run.progress prenesie progres aj krok', () => {
        const s = pulseToState('run.progress', { progress: 73, step: 'Beží príkaz X' });
        expect(s).toEqual({ status: 'running', progress: 73, step: 'Beží príkaz X' });
    });
    it('run.done → hotovo na 100 %', () => {
        expect(pulseToState('run.done')).toMatchObject({ status: 'done', progress: 100 });
    });
    it('run.failed → chyba a nesie správu', () => {
        expect(pulseToState('run.failed', { message: 'Kód 1' }))
            .toMatchObject({ status: 'failed', message: 'Kód 1' });
    });
    it('run.paused → pozastavené', () => {
        expect(pulseToState('run.paused').status).toBe('paused');
    });
    it('run.log nemení stav karty', () => {
        expect(pulseToState('run.log', { lines: ['a'] })).toBeNull();
    });
    it('neznámy typ je null', () => {
        expect(pulseToState('run.whatever')).toBeNull();
    });
});


describe('SK slovníky', () => {
    it('autonómia', () => {
        expect(autonomyMeta('manual').label).toBe('Manuálne');
        expect(autonomyMeta('assisted').label).toBe('Asistované');
        expect(autonomyMeta('autonomous').label).toBe('Autonómne');
    });
    it('stav', () => {
        expect(statusMeta('running').label).toBe('Beží');
        expect(statusMeta('done').label).toBe('Hotovo');
        expect(statusMeta('failed').label).toBe('Chyba');
        expect(statusMeta(null)).toBeNull();
    });
});


describe('groupByCategory', () => {
    it('zoskupí v pevnom poradí a vynechá prázdne', () => {
        const g = groupByCategory([
            { category: 'ingest' }, { category: 'maintenance' }, { category: 'ingest' },
        ]);
        expect(g.map((x) => x.key)).toEqual(['maintenance', 'ingest']);
        expect(g[1].agents).toHaveLength(2);
    });
});


describe('applyPulse — živá aktualizácia karty', () => {
    beforeEach(async () => {
        document.body.innerHTML = MARKUP + '<div id="toasts"></div>';
        installFetch();
        route(/^\/api\/agents(\?|$)/, () => res(200, AGENTS_BODY));
        await renderAgenti();
    });

    it('run.started prepne kartu do stavu beží', () => {
        applyPulse('aura-dry-run', 'run.started', { run_id: 3 });
        const card = document.querySelector('.ag-card[data-agent-key="aura-dry-run"]');
        expect(card.dataset.status).toBe('running');
        expect(card.querySelector('.ag-badge--status-running')).not.toBeNull();
    });

    it('run.progress posunie progres bar a krok', () => {
        applyPulse('aura-dry-run', 'run.started', {});
        applyPulse('aura-dry-run', 'run.progress', { progress: 60, step: 'Beží príkaz aura:dry-run' });
        const card = document.querySelector('.ag-card[data-agent-key="aura-dry-run"]');
        expect(card.querySelector('.ag-progress-bar').style.width).toBe('60%');
        expect(card.querySelector('.ag-step').textContent).toContain('aura:dry-run');
    });

    it('run.done ukončí kartu do stavu hotovo', () => {
        applyPulse('aura-dry-run', 'run.started', {});
        applyPulse('aura-dry-run', 'run.done', { progress: 100 });
        const card = document.querySelector('.ag-card[data-agent-key="aura-dry-run"]');
        expect(card.dataset.status).toBe('done');
        expect(card.querySelector('.ag-badge--status-done')).not.toBeNull();
    });

    it('run.failed premietne chybu', () => {
        applyPulse('aura-dry-run', 'run.failed', { message: 'Kód 1' });
        const card = document.querySelector('.ag-card[data-agent-key="aura-dry-run"]');
        expect(card.dataset.status).toBe('failed');
    });

    it('pulz pre neznámeho agenta nič nezhodí', () => {
        expect(() => applyPulse('neznamy', 'run.started', {})).not.toThrow();
    });

    it('run.log bez otvoreného logu je bezpečný no-op', () => {
        expect(() => applyPulse('aura-dry-run', 'run.log', { lines: ['riadok'] })).not.toThrow();
    });

    it('otvorený log agenta priebežne pridáva riadky z run.log', async () => {
        route(/^\/api\/agents\/aura-dry-run\/runs/, () => res(200, { runs: [{ id: 7, status: 'running' }] }));
        route(/^\/api\/agent-runs\/7/, () => res(200, { run: { id: 7, log: 'prvý riadok' } }));
        const logBtn = document.querySelector('.ag-card[data-agent-key="aura-dry-run"] [data-act="log"]');
        await logBtn.onclick();
        await vi.waitFor(() => {
            expect(document.querySelector('#agent-log-body .ag-log-pre').textContent).toContain('prvý riadok');
        });
        applyPulse('aura-dry-run', 'run.log', { lines: ['druhý riadok', 'tretí riadok'] });
        const pre = document.querySelector('#agent-log-body .ag-log-pre');
        expect(pre.textContent).toContain('druhý riadok');
        expect(pre.textContent).toContain('tretí riadok');
    });
});
