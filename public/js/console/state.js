/* ===========================================================================
   Charón — zdieľaný stav.

   Vlastný súbor a nie objekt v main.js zámerne: render.js, run.js, tools.js aj
   slash.js ho všetky potrebujú a main.js ich všetky importuje. Keby stav sedel
   v main.js, každý modul by mal cyklus späť naň — a `C` je `export const`
   objekt, teda NIE je hoistovaný. Prvý modul, ktorý by ho čítal pri
   vyhodnocovaní vlastného tela, by spadol na „Cannot access 'C' before
   initialization". Takto je graf importov: main → {render, run, tools, slash} →
   state, a cyklus môže vzniknúť len medzi funkciami, kde ho hoisting znesie.

   main.js `C` naďalej re-exportuje, aby jeho verejné meno zostalo v platnosti.
   =========================================================================== */

export const C = {
    thread: null,        // celý payload z ThreadController::show
    threads: [],         // riadky pre bočný panel
    models: [],          // čo je reálne stiahnuté (ak backend zoznam vie dať)
    defaultModel: '',    // model z configu — na ňom beží vlákno, ktoré si vlastný nevybralo

    // Kým init nedobehne, konzola neprijíma ťahy: vlákna a zoznam modelov ešte
    // len tečú a `openThread()` na konci štartu prekresľuje celý tok. Bez tejto
    // brány sa dala odoslať správa, ktorú init o 100 ms zmazal zo obrazovky —
    // bublina zostala odpojená od dokumentu a odpoveď sa skladala do prázdna.
    booting: true,

    // Odchádza práve ťah? Zapne sa PRED založením vlákna a prvým fetchom, teda
    // skôr než `running` — presne v tom okne, v ktorom by `newThread()` dobehnuté
    // z kliku na „Nové vlákno" vyprázdnilo tok aj s už napísanou otázkou.
    sending: false,
    running: false,      // beží ťah agenta?
    abort: null,         // AbortController aktuálneho behu
    awaiting: null,      // { id, name } — beh zaparkovaný na rozhodnutí človeka

    // Rozpracovaná odpoveď. `bubble` sa počas ťahu strieda: každá karta toolu
    // ju zavrie, aby text po nástroji začal novú bublinu a poradie v toku bolo
    // naozaj chronologické, nie zliate do jedného odseku.
    turn: null,          // { raw, bubble, mid, model, t0 }

    step: null,          // { n, of } z rámca "step"
    stats: null,         // { tokens_in, tokens_out, tps } z rámca "end"
    t0: 0,               // začiatok ťahu pre počítadlo sekúnd

    // Sleduje tok spodok? Prepína sa LEN pri skutočnom skrolovaní človekom.
    follow: true,
};
