/* ===========================================================================
   Konzola vedomia — composer (písanie a odoslanie).

   Enter posiela, Shift+Enter zalomí. Textarea rastie s obsahom do stropu, potom
   začne skrolovať — dlhá úloha sa má dať prečítať pred odoslaním, ale nesmie
   zjesť celý tok správ.

   Odoslanie ide udalosťou `console:send`, nie priamym volaním run.js: composer
   nemá vedieť nič o behu a slash paleta môže tú istú udalosť vypustiť za seba.
   =========================================================================== */

import { C } from './state.js';
import { $ } from './dom.js';
import { tryRunCommand } from './slash.js';

/* Strop výšky. V CSS je `max-height: 40vh`, tu sa počíta to isté číslo, aby
   inline `height` nikdy nepresiahlo to, čo dovolí CSS — inak by sa textarea
   nafúkla „nasucho" a vnútorný skroll by sa nikdy nezapol. */
function capPx() {
    return Math.round(window.innerHeight * 0.4);
}

export function wireComposer() {
    const prompt = $('#prompt');
    const form = $('#composer');
    if (!prompt || !form) return;

    autoGrow(prompt);

    prompt.addEventListener('input', () => {
        autoGrow(prompt);
        paintSend();
    });

    prompt.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;

        // Tu sa NESMIE testovať, či je paleta otvorená. Paleta si Enter berie sama
        // len vtedy, keď má čo dopĺňať — a vtedy propagáciu zastaví, takže sem
        // vôbec nedorazí. Hotový príkaz (`/help`) ju otvorenú NECHÁVA a Enter
        // pustí sem naschvál; s podmienkou `if (paletteOpen()) return` sa taký
        // príkaz nedal odoslať vôbec.
        event.preventDefault();
        submit();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submit();
    });

    $('#stop')?.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('console:stop'));
    });

    window.addEventListener('resize', () => autoGrow(prompt));
    paintSend();
}

function submit() {
    const prompt = $('#prompt');
    const text = prompt.value.trim();
    if (text === '') return;

    // Slash príkaz je klientská skratka: buď urobí lokálnu vec, alebo sa rozpíše
    // na normálnu správu. Nový endpoint si nevyžaduje ani jeden z nich.
    if (tryRunCommand(text)) {
        autoGrow(prompt);
        paintSend();

        return;
    }

    document.dispatchEvent(new CustomEvent('console:send', { detail: { text } }));
    paintSend();
}

export function autoGrow(node) {
    if (!node) return;

    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, capPx())}px`;
}

/** Send je zhasnutý, kým sa konzola štartuje, kým nie je čo poslať a kým čaká na rozhodnutie. */
export function paintSend() {
    const prompt = $('#prompt');
    const send = $('#send');
    if (!prompt || !send) return;

    send.disabled = C.booting || prompt.value.trim() === '' || !!C.awaiting;
}
