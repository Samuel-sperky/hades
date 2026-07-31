/* Deterministický PRNG pre radiálnu MAPU mysle.

   Layout musí byť STABILNÝ medzi návštevami (rozhodnutie W1 §2): tá istá myseľ
   → tie isté pozície. Preto sa jitter a rozmiestnenie počítajú zo seedu, ktorý
   je odvodený z ID uzlov/oddelení/oblastí, nie z náhody ani z d3-force.

   mulberry32: rýchly, dobre rozložený 32-bit generátor. `seededRand(seed)` vráti
   funkciu vracajúcu čísla 0..1; opakované volania s tým istým seedom dajú tú istú
   postupnosť. */

export function seededRand(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}


/* Jedno stabilné číslo 0..1 z celočíselného seedu (bez stavu). */
export function hash01(seed) {
    return seededRand(seed)();
}
