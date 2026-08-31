import { requestDraw } from './render.js';
import { S, reducedMotionActive } from './state.js';
import { $, now, syncSlider, ts } from './util.js';
import { iconSwap } from '../shared/icons.js';

/* ---------- časová os ---------- */

export function updateTimelineLabel() {
    const label = $('tl-label');
    if (!S.replay.on || S.replay.t >= 1) {
        label.textContent = 'teraz';
        return;
    }
    const t = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    label.textContent = new Date(t).toLocaleDateString('sk', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function stopReplay() {
    S.replay.playing = false;
    S.replay.on = false;
    S.replay.t = 1;
    $('tl-range').value = 1000;
    syncSlider($('tl-range'));
    iconSwap($('tl-play'), 'play');
    updateTimelineLabel();
}

export function setupTimeline() {
    const range = $('tl-range');

    syncSlider(range);
    range.addEventListener('input', () => {
        syncSlider(range);
        S.replay.t = +range.value / 1000;
        S.replay.on = S.replay.t < 1;
        S.replay.playing = false;
        iconSwap($('tl-play'), 'play');
        updateTimelineLabel();
        requestDraw(); // scrub časovej osi → prekresli
    });

    $('tl-play').addEventListener('click', () => {
        if (S.replay.playing) { stopReplay(); requestDraw(); return; }
        if (reducedMotionActive()) { stopReplay(); requestDraw(); return; } // bez animácie — rovno koncový stav
        S.replay.on = true;
        S.replay.playing = true;
        S.replay.t = 0;
        iconSwap($('tl-play'), 'pause');
        requestDraw(); // spusti prehrávanie → zobuď slučku (replay.playing drží slučku živú)
    });
}

export function computeReplayBounds() {
    const times = S.nodes.filter((n) => n.type !== 'core').map((n) => ts(n.created_at)).filter(Boolean);
    S.replay.tMin = times.length ? Math.min(...times) - 3600000 : now() - 86400000;
    S.replay.tMax = now();
}
