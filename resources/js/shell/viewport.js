/* Virtuálna klávesnica na mobile — rozhodnutie #76, akceptačné kritérium 3.

   Problém: composer chatu (#prompt) je position:fixed. iOS aj starší Android viažu
   fixed elementy na layout viewport, ktorý sa otvorením klávesnice nezmenší —
   composer teda zostane pod klávesnicou a používateľ nevidí, čo píše.

   Riešenie: visualViewport API dá skutočnú viditeľnú výšku. Rozdiel oproti
   window.innerHeight je výška klávesnice; publikujeme ju ako --kb-inset a mobile.css
   z nej počíta --mobile-bottom (spodná rezerva pre #screens, #prompt, #dock).
   CSS samo o sebe túto hodnotu zistiť nedokáže — dvh sa pri klávesnici nemení.

   Modul je bezpečný aj na desktope: --kb-inset sa používa výhradne v bloku
   @media (max-width: 640px), takže nad 640 px nemá žiadny efekt. */

/* Prah v px. Kolaps adresného riadka na iOS ubere ~60–90 px a NIE je klávesnica;
   klávesnica má reálne 250+ px. 120 px je bezpečne medzi nimi. */
export const KB_MIN_INSET = 120;


/** Výška klávesnice z aktuálneho stavu visualViewportu (0 = zatvorená). */
export function keyboardInset(vv, layoutHeight) {
    if (!vv) return 0;
    const inset = Math.round(layoutHeight - vv.height - (vv.offsetTop || 0));
    return inset >= KB_MIN_INSET ? inset : 0;
}


/** Zapíše stav do DOM: --kb-inset na :root a body.kb-open ako CSS prepínač. */
export function applyKeyboardInset(inset) {
    const open = inset > 0;
    document.body.classList.toggle('kb-open', open);
    document.documentElement.style.setProperty('--kb-inset', inset + 'px');
    return open;
}


export function register() {
    const vv = window.visualViewport;
    // Bez visualViewport (staré prehliadače) zostane --kb-inset na CSS defaulte 0px
    // a chat sa chová ako doteraz — degradácia, nie chyba.
    if (!vv) return;

    const sync = () => applyKeyboardInset(keyboardInset(vv, window.innerHeight));

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
}
