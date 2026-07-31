import './support/dom-stubs.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderAgenti } from '../../resources/js/screens/agenti.js';

/* Obrazovka Agenti — živé command centre (W2).

   Render testy overujú, že karty z /api/agents vzniknú, sú zoskupené po
   kategóriách, nesú správne badge (autonómia/stav/deštruktívny/čoskoro), že
   placeholder sa nedá spustiť a že spustenie deštruktívneho agenta s vypnutou
   poistkou (423) UI len nenásilne oznámi. Markup sa načítava z reálneho blade,
   takže preklep v id položí test, nie až prehliadač. */

const MARKUP = readFileSync(
    resolve(process.cwd(), 'resources/views/partials/screens/agenti.blade.php'), 'utf8',
).replace(/\{\{--[\s\S]*?--\}\}/g, '');

const res = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

let routes = [];
function route(pattern, factory) { routes.unshift([pattern, factory]); }
function installFetch() {
    routes = [];
    global.fetch = vi.fn(async (url, init) => {
        const path = String(url);
        for (const [pattern, factory] of routes) if (pattern.test(path)) return factory(path, init);
        throw new Error('neošetrená cesta v teste: ' + path);
    });
}

const AGENTS_BODY = {
    agents: [
        {
            key: 'mind-ingest', command: 'mind:ingest', label: 'Ingest transcriptov',
            description: 'Zapíše záznamy do mozgu.', category: 'ingest', autonomy: 'autonomous',
            destructive: false, schedule: 'Každých 10 min', placeholder: false,
            latest_run: { id: 5, status: 'done', progress: 100, step: 'Hotovo', finished_at: '2026-07-31T10:00:00+02:00' },
            next_run: 'Každých 10 min',
        },
        {
            key: 'aura-embed', command: 'aura:embed', label: 'Embeddingy uzlov',
            description: 'Prepočíta embeddingy.', category: 'llm', autonomy: 'autonomous',
            destructive: false, schedule: 'Denne 04:35', placeholder: false,
            latest_run: { id: 6, status: 'running', progress: 50, step: 'Beží príkaz aura:embed', finished_at: null },
            next_run: 'Denne 04:35',
        },
        {
            key: 'aura-dry-run', command: 'aura:dry-run', label: 'Dry-run deštruktívnych jobov',
            description: 'Ukáže čo by joby zmazali. Nič nemení.', category: 'maintenance', autonomy: 'manual',
            destructive: false, schedule: 'Na požiadanie', placeholder: false,
            latest_run: null, next_run: 'Na požiadanie',
        },
        {
            key: 'mind-automerge', command: 'mind:automerge', label: 'Automatické zlúčenie',
            description: 'Zlúči takmer identické uzly.', category: 'maintenance', autonomy: 'assisted',
            destructive: true, schedule: 'Denne 04:45 (len s prepínačom)', placeholder: false,
            latest_run: null, next_run: 'Denne 04:45 (len s prepínačom)',
        },
        {
            key: 'workforce-research', command: null, label: 'Externý výskumník (koncept)',
            description: 'Placeholder pre externých agentov.', category: 'workforce', autonomy: 'manual',
            destructive: false, schedule: '—', placeholder: true,
            latest_run: null, next_run: '—',
        },
    ],
    summary: { total: 5, autonomous: 2, running: 1 },
    destructive_enabled: false,
};

const AGENTS = /^\/api\/agents(\?|$)/;
const RUN = /^\/api\/agents\/[^/]+\/run/;
const PAUSE = /^\/api\/agents\/[^/]+\/pause/;

beforeEach(() => {
    document.body.innerHTML = MARKUP + '<div id="toasts" aria-live="polite"></div>';
    installFetch();
    route(AGENTS, () => res(200, AGENTS_BODY));
});


describe('render — karty a zoskupenie', () => {
    beforeEach(async () => { await renderAgenti(); });

    it('vykreslí kartu pre každého agenta z API', () => {
        expect(document.querySelectorAll('.ag-card')).toHaveLength(5);
    });

    it('KPI pás nesie súhrn (total hero, running, autonomous)', () => {
        const hero = document.querySelector('#agenti-body .kpi-hero');
        expect(hero.textContent).toContain('Agentov v centre');
        expect(hero.querySelector('.kpi-val').textContent).toContain('5');
    });

    it('karty sú zoskupené po kategóriách v pevnom poradí', () => {
        const titles = [...document.querySelectorAll('.ag-cat-title')].map((t) => t.textContent.trim());
        // Údržba (2) → LLM (1) → Ingest (1) → Workforce (1); prázdne kategórie sa vynechajú.
        expect(titles.some((t) => t.includes('Údržba'))).toBe(true);
        expect(titles.some((t) => t.includes('LLM'))).toBe(true);
        expect(titles.some((t) => t.includes('Ingest'))).toBe(true);
        expect(titles.some((t) => t.includes('Workforce'))).toBe(true);
        expect(titles.indexOf(titles.find((t) => t.includes('Údržba'))))
            .toBeLessThan(titles.indexOf(titles.find((t) => t.includes('Ingest'))));
    });

    it('badge autonómie je po slovensky', () => {
        const card = document.querySelector('.ag-card[data-agent-key="mind-ingest"]');
        expect(card.textContent).toContain('Autonómne');
    });

    it('bežiaci agent má stav „Beží", progres a krok', () => {
        const card = document.querySelector('.ag-card[data-agent-key="aura-embed"]');
        expect(card.dataset.status).toBe('running');
        expect(card.querySelector('.ag-badge--status-running').textContent).toContain('Beží');
        expect(card.querySelector('.ag-progress-bar').style.width).toBe('50%');
        expect(card.querySelector('.ag-step').textContent).toContain('aura:embed');
    });

    it('hotový agent má stav „Hotovo" a nezobrazuje progres', () => {
        const card = document.querySelector('.ag-card[data-agent-key="mind-ingest"]');
        expect(card.querySelector('.ag-badge--status-done').textContent).toContain('Hotovo');
        expect(card.querySelector('.ag-progress')).toBeNull();
    });

    it('deštruktívny agent je vizuálne označený', () => {
        const card = document.querySelector('.ag-card[data-agent-key="mind-automerge"]');
        expect(card.classList.contains('ag-card--destructive')).toBe(true);
        expect(card.querySelector('.ag-badge--destructive')).not.toBeNull();
    });

    it('placeholder (workforce) má badge „Čoskoro" a Spustiť je disabled', () => {
        const card = document.querySelector('.ag-card[data-agent-key="workforce-research"]');
        expect(card.classList.contains('ag-card--placeholder')).toBe(true);
        expect(card.querySelector('.ag-badge--soon').textContent).toContain('Čoskoro');
        const runBtn = card.querySelector('.ag-btn[disabled]');
        expect(runBtn).not.toBeNull();
        expect(card.querySelector('[data-act="run"]')).toBeNull();
    });

    it('pri vypnutej poistke je nad kartami upozornenie', () => {
        expect(document.querySelector('.ag-safety')).not.toBeNull();
    });

    it('pause tlačidlo je viditeľné len keď agent beží', () => {
        const running = document.querySelector('.ag-card[data-agent-key="aura-embed"] [data-act="pause"]');
        const idle = document.querySelector('.ag-card[data-agent-key="mind-ingest"] [data-act="pause"]');
        expect(running.hasAttribute('hidden')).toBe(false);
        expect(idle.hasAttribute('hidden')).toBe(true);
    });
});


describe('ovládanie — spustenie', () => {
    it('spustenie bezpečného agenta pošle POST run a optimisticky prejde do „Čaká"', async () => {
        await renderAgenti();
        route(RUN, () => res(201, { run: { id: 9, status: 'queued', progress: 0, step: 'V rade' } }));
        const btn = document.querySelector('.ag-card[data-agent-key="aura-dry-run"] [data-act="run"]');
        await btn.onclick();
        const posted = global.fetch.mock.calls.find((c) => /\/api\/agents\/aura-dry-run\/run/.test(String(c[0])));
        expect(posted).toBeTruthy();
        expect(posted[1].method).toBe('POST');
        const card = document.querySelector('.ag-card[data-agent-key="aura-dry-run"]');
        expect(card.dataset.status).toBe('queued');
    });

    it('deštruktívny agent s vypnutou poistkou sa nespustí a UI to povie (423)', async () => {
        await renderAgenti();
        const btn = document.querySelector('.ag-card[data-agent-key="mind-automerge"] [data-act="run"]');
        await btn.onclick();
        // Poistka je vypnutá → UI ani nevolá API, len toast.
        const posted = global.fetch.mock.calls.find((c) => /\/mind-automerge\/run/.test(String(c[0])));
        expect(posted).toBeFalsy();
        expect(document.querySelector('#toasts .toast').textContent).toContain('vypnutý');
    });

    it('backend 423 (poistka zapnutá inde) sa premietne do nenásilnej hlášky', async () => {
        // Poistka zapnutá v payloade, ale backend aj tak vráti 423.
        route(AGENTS, () => res(200, { ...AGENTS_BODY, destructive_enabled: true }));
        await renderAgenti();
        vi.stubGlobal('confirm', () => true);
        route(RUN, () => res(423, { error: 'destructive_disabled', message: 'x' }));
        const btn = document.querySelector('.ag-card[data-agent-key="mind-automerge"] [data-act="run"]');
        await btn.onclick();
        expect(document.querySelector('#toasts .toast').textContent).toContain('poistka');
        vi.unstubAllGlobals();
    });
});


describe('ovládanie — pozastavenie', () => {
    it('pauza pošle POST pause a prepne stav na „Pozastavené"', async () => {
        await renderAgenti();
        route(PAUSE, () => res(200, { run: { id: 6, status: 'paused', step: 'Pozastavené' } }));
        const btn = document.querySelector('.ag-card[data-agent-key="aura-embed"] [data-act="pause"]');
        await btn.onclick();
        const posted = global.fetch.mock.calls.find((c) => /\/aura-embed\/pause/.test(String(c[0])));
        expect(posted).toBeTruthy();
        const card = document.querySelector('.ag-card[data-agent-key="aura-embed"]');
        expect(card.dataset.status).toBe('paused');
    });
});


describe('chybové a a11y stavy', () => {
    it('padnuté /api/agents vykreslí chybový stav s možnosťou skúsiť znova', async () => {
        route(AGENTS, () => res(500, { message: 'x' }));
        await renderAgenti();
        expect(document.querySelector('#agenti-body .empty-state')).not.toBeNull();
    });

    it('blade nesie stabilné id, ktoré JS hľadá', () => {
        for (const id of ['screen-agenti', 'agenti-body', 'agent-log', 'agent-log-body',
            'agent-log-title', 'agent-log-close']) {
            expect(document.getElementById(id), id).not.toBeNull();
        }
    });

    it('každé tlačidlo karty má prístupný názov', async () => {
        await renderAgenti();
        for (const b of document.querySelectorAll('.ag-card button')) {
            const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
            expect(name, b.outerHTML.slice(0, 80)).toBeTruthy();
        }
    });
});
