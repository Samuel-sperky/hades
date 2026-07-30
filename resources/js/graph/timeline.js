import { $ } from '../core/dom.js';
import { now, ts } from '../core/format.js';
import { REDUCED_MOTION } from '../core/motion.js';
import { S } from '../core/state/index.js';
import { requestDraw } from './render/frame.js';
import { syncSlider } from '../shell/settings.js';


export function visibleInReplay(n) {
    if (!S.replay.on) return true;
    const cutoff = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    return n.type === 'core' || ts(n.created_at) <= cutoff;
}


/* ---------- časová os ----------

   W0 odovzdal tento modul ako mŕtvy kód (§7.5): `setupTimeline` nemal volajúceho
   a `#tl-range` markup neexistoval ani v pôvodnom monolite. Rozhodnutie P8:
   DOROBIŤ, nie zmazať. Dôvody:
     · replay je jediný spotrebiteľ `visibleInReplay`, ktorý je už zadrôtovaný
       v pick.js, camera.js aj v render pipeline (P7) — mazanie by znamenalo
       zásah do cudzieho balíka,
     · CSS (`graph/timeline.css`, `components/slider.css`) je hotové a je
       v @import zozname app.css, ktorý vlastní integrátor,
     · chýbal len markup — 8 riadkov v partiale, ktorý P8 vlastní.
   Markup je skrytý, kým ho `register()` nezadrôtuje: keď integrátor nepridá
   `registerTimeline(root)` do app.js, časová os sa nezobrazí a nič sa nerozbije. */

export function updateTimelineLabel() {
    const label = $('tl-label');
    if (!label) return;
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
    const range = $('tl-range');
    if (range) { range.value = 1000; syncSlider(range); }
    setPlayIcon(false);
    updateTimelineLabel();
}


function setPlayIcon(playing) {
    const btn = $('tl-play');
    if (!btn) return;
    btn.textContent = playing ? 'pause' : 'play_arrow';
    btn.setAttribute('aria-label', playing ? 'Zastaviť prehrávanie rastu siete' : 'Prehrať rast siete');
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
}


let wired = false;

export function setupTimeline() {
    if (wired) return true;   // idempotentne — dvojité zadrôtovanie by zdvojilo klik na play
    const range = $('tl-range');
    const play = $('tl-play');
    if (!range || !play) return false; // markup nie je v layoute — modul mlčí
    wired = true;

    syncSlider(range);
    updateTimelineLabel();
    range.addEventListener('input', () => {
        syncSlider(range);
        S.replay.t = +range.value / 1000;
        S.replay.on = S.replay.t < 1;
        S.replay.playing = false;
        setPlayIcon(false);
        updateTimelineLabel();
        requestDraw(); // scrub časovej osi → prekresli
    });

    play.addEventListener('click', () => {
        if (S.replay.playing) { stopReplay(); requestDraw(); return; }
        if (REDUCED_MOTION) { stopReplay(); requestDraw(); return; } // bez animácie — rovno koncový stav
        S.replay.on = true;
        S.replay.playing = true;
        S.replay.t = 0;
        setPlayIcon(true);
        requestDraw(); // spusti prehrávanie → zobuď slučku (replay.playing drží slučku živú)
    });

    return true;
}


export function computeReplayBounds() {
    const times = S.nodes.filter((n) => n.type !== 'core').map((n) => ts(n.created_at)).filter(Boolean);
    S.replay.tMin = times.length ? Math.min(...times) - 3600000 : now() - 86400000;
    S.replay.tMax = now();
}


/* Časová os — prehrávanie rastu siete. Kontejner je skrytý, kým sa nezadrôtuje. */
export function register(root) {
    if (!setupTimeline()) return;
    const wrap = $('timeline');
    if (wrap) wrap.classList.remove('hidden');
}
