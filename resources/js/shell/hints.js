import { $ } from '../core/dom.js';
import { store } from '../core/store.js';


const HINTS = [
    { pos: { left: '104px', top: '120px' }, text: 'Vľavo prepínaš obrazovky — Dnes, Denník, Graf a Knižnica. Hades sa otvorí na Dnes.' },
    { pos: { left: '50%', top: '76px', transform: 'translateX(-50%)' }, text: 'Hore vpravo je hľadanie (Ctrl K alebo /). Nájde uzly, playbooky aj obrazovky.' },
    { pos: { left: '50%', top: '40%', transform: 'translateX(-50%)' }, text: 'Na obrazovke Graf klik na uzol otvorí detail. Dvojklik na oblasť ju zaostrí — Esc zaostrenie zruší.' },
    { pos: { left: '104px', bottom: '24px' }, text: 'Dole vľavo nájdeš Nastavenia (tmavý režim, sieť, chat) a Pomocníka.' },
];


export function setupHints() {
    if (store.raw('hints') === 'done') return;
    const el = $('hint');
    let i = 0;

    const finish = () => {
        el.classList.add('hidden');
        store.setRaw('hints', 'done');
    };

    const show = () => {
        if (i >= HINTS.length) { finish(); return; }
        const h = HINTS[i];
        $('hint-text').textContent = h.text;
        const step = $('hint-step');
        if (step) step.textContent = (i + 1) + ' / ' + HINTS.length;
        $('hint-next').textContent = i === HINTS.length - 1 ? 'Hotovo' : 'Ďalej';
        el.style.left = ''; el.style.top = ''; el.style.bottom = ''; el.style.transform = '';
        Object.assign(el.style, h.pos);
        el.classList.remove('hidden');
    };

    $('hint-next').onclick = () => { i++; show(); };
    const skip = $('hint-skip');
    if (skip) skip.onclick = finish;
    show();
}


export function register(root) {
    setupHints(root);
}
