/* P8 — časová os (prehrávanie rastu siete).
   W0 ju odovzdal ako mŕtvy kód bez markupu (§7.5); P8 dorobil markup, takže
   register() ju musí zadrôtovať — a bez markupu nesmie nič zhodiť. */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

const TL_MARKUP = '<div id="timeline" class="hidden">'
    + '<button id="tl-play" class="ms" type="button" aria-pressed="false">play_arrow</button>'
    + '<input id="tl-range" type="range" min="0" max="1000" step="1" value="1000">'
    + '<span id="tl-label">teraz</span>'
    + '</div>';

async function freshTimeline(html) {
    vi.resetModules();
    installGraphDom(html);
    const timeline = await import('../../resources/js/graph/timeline.js');
    const { S } = await import('../../resources/js/core/state/index.js');
    S.w = 1200; S.h = 800;
    return { timeline, S };
}

describe('graph/timeline.js — visibleInReplay', () => {
    let timeline, S;

    beforeAll(async () => { ({ timeline, S } = await freshTimeline(TL_MARKUP)); });

    beforeEach(() => {
        S.replay = { on: false, t: 1, playing: false, tMin: 0, tMax: 0 };
    });

    it('shows everything while the replay is off', () => {
        expect(timeline.visibleInReplay({ type: 'skill', created_at: '2026-07-01 10:00:00' })).toBe(true);
    });

    it('hides nodes born after the cutoff, never the core', () => {
        S.replay = { on: true, t: 0.5, playing: false, tMin: 0, tMax: 1000 };
        expect(timeline.visibleInReplay({ type: 'skill', created_at: new Date(400).toISOString() })).toBe(true);
        expect(timeline.visibleInReplay({ type: 'skill', created_at: new Date(900).toISOString() })).toBe(false);
        expect(timeline.visibleInReplay({ type: 'core', created_at: new Date(900).toISOString() })).toBe(true);
    });

    it('computes the replay bounds from the non-core nodes', () => {
        const t = Date.parse('2026-02-01T10:00:00Z');
        S.nodes = [
            { type: 'core', created_at: '2020-01-01 00:00:00' },
            { type: 'skill', created_at: '2026-02-01T10:00:00Z' },
        ];
        timeline.computeReplayBounds();
        expect(S.replay.tMin).toBe(t - 3600000);   // hodinová rezerva pred prvým uzlom
        expect(S.replay.tMax).toBeGreaterThan(S.replay.tMin);
    });
});

describe('graph/timeline.js — register', () => {
    it('wires the slider and the play button and reveals the container', async () => {
        const { timeline, S } = await freshTimeline(TL_MARKUP);
        S.replay = { on: false, t: 1, playing: false, tMin: 0, tMax: 1000 };

        timeline.register(document.body);
        expect(document.getElementById('timeline').classList.contains('hidden')).toBe(false);

        const range = document.getElementById('tl-range');
        range.value = '400';
        range.dispatchEvent(new window.Event('input', { bubbles: true }));
        expect(S.replay.t).toBe(0.4);
        expect(S.replay.on).toBe(true);
        expect(document.getElementById('tl-label').textContent).not.toBe('teraz');

        document.getElementById('tl-play').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(S.replay.playing).toBe(true);
        expect(S.replay.t).toBe(0);
        expect(document.getElementById('tl-play').textContent).toBe('pause');

        document.getElementById('tl-play').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(S.replay.playing).toBe(false);
        expect(S.replay.on).toBe(false);
        expect(S.replay.t).toBe(1);
        expect(document.getElementById('tl-range').value).toBe('1000');
        expect(document.getElementById('tl-label').textContent).toBe('teraz');
    });

    it('is a no-op without markup — no crash, replay stays off', async () => {
        const { timeline, S } = await freshTimeline('');
        S.replay = { on: false, t: 1, playing: false, tMin: 0, tMax: 1000 };

        expect(() => timeline.register(document.body)).not.toThrow();
        expect(timeline.setupTimeline()).toBe(false);
        expect(() => timeline.stopReplay()).not.toThrow();
        expect(() => timeline.updateTimelineLabel()).not.toThrow();
        expect(S.replay.playing).toBe(false);
    });

    it('does not wire twice (a second register must not double the play click)', async () => {
        const { timeline, S } = await freshTimeline(TL_MARKUP);
        S.replay = { on: false, t: 1, playing: false, tMin: 0, tMax: 1000 };

        timeline.register(document.body);
        timeline.register(document.body);

        document.getElementById('tl-play').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(S.replay.playing).toBe(true);   // pri dvojitom drôtovaní by sa hneď zastavilo
    });
});
