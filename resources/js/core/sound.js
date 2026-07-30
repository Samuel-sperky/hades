import { S } from './state/index.js';


/* ---------- zvuk ---------- */

function audioCtx() {
    if (!S.audio) {
        S.audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (S.audio.state === 'suspended') S.audio.resume();
    return S.audio;
}


export function blip(freq, dur = 0.35, vol = 0.05) {
    if (!S.sound) return;
    try {
        const ac = audioCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ac.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ac.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        osc.connect(gain).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + dur + 0.05);
    } catch (e) { /* zvuk nie je kritický */ }
}
