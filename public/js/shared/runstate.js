/* ===========================================================================
   Charón — slovník stavu behu.

   Jedno miesto, ktoré vie preložiť „ako sa beh skončil" a „čo stál" na vetu pre
   človeka. Vlastný modul zámerne: to isté hlásenie musí povedať ŽIVÝ beh
   (rámec `end` v run.js), OBNOVENÉ vlákno (log behov v render.js) aj dok Charóna
   nad grafom. Keby si každý z nich držal vlastnú kópiu textov a vlastnú definíciu
   „riadneho konca", ťah zrezaný stropom krokov by po obnove stránky vyzeral inak
   než pred ňou — presne ten rozpor, kvôli ktorému tento modul vznikol.

   Zdieľaný modul (public/js/shared/) — presunutý z public/js/console/ vo vlne 4,
   obsah nezmenený. Modul NIČ neimportuje, takže nie je súčasťou cyklu.
   =========================================================================== */

/**
 * Dôvody, po ktorých je odpoveď naozaj celá. Všetko ostatné, čo môže v rámci
 * `end` prísť, znamená zrezaný ťah: `max_steps` posiela AgentRunner po dosiahnutí
 * stropu kôl, `max_tokens` hlási model, ktorý minul okno, a Ollama si vyhradzuje
 * právo poslať vlastný `done_reason`, ktorý sa prekladom nestratí.
 */
const CLEAN_STOP = ['end_turn', 'stop_sequence'];

const STOP_NOTE = {
    max_steps: 'Beh narazil na strop krokov — úloha mohla zostať nedokončená. Pokračovať sa dá ďalšou správou.',
    max_tokens: 'Model minul okno odpovede — text je zrezaný, nie dokončený. Pokračovať sa dá ďalšou správou.',
};

export function cleanStop(reason) {
    return CLEAN_STOP.includes(String(reason || 'end_turn'));
}

/** Veta k dôvodu ukončenia. Prázdny reťazec = beh skončil riadne a netreba nič. */
export function stopNote(reason) {
    if (cleanStop(reason)) return '';

    const stop = String(reason || '');

    return STOP_NOTE[stop] || `Beh sa skončil neriadne (${stop}) — úloha mohla zostať nedokončená.`;
}

/**
 * Veta k ZAZNAMENANÉMU behu (riadok z `runs`). Stav je tu dôležitejší než dôvod:
 * beh zastavený človekom nemá `stop_reason` vôbec, a beh, ktorý zostal visieť
 * v `running`, nemá ani jedno — a práve o tých dvoch by tok správ po obnove
 * stránky mlčal.
 */
export function runNote(run) {
    if (!run) return '';

    switch (run.status) {
        case 'aborted':
            return 'Beh bol zastavený — čo prišlo, zostáva. Úloha mohla zostať nedokončená.';

        case 'failed':
            return run.error ? `Beh zlyhal: ${run.error}` : 'Beh zlyhal.';

        case 'running':
            // Zametač (`RunRecorder::reapStale`) ho ešte nezavrel, ale nikto ho
            // už nedostreamuje: prúd patril requestu, ktorý neexistuje.
            return 'Beh zostal nedokončený — appka sa prerušila uprostred ťahu.';

        // `waiting` je legitímny stav: karta povolenia stojí v toku a hovorí zaň.
        case 'waiting':
            return '';

        default:
            return stopNote(run.stop_reason);
    }
}

/** Cena ťahu jedným reťazcom. Tvorí sa raz, aby hlavička a bublina hovorili to isté. */
export function costLabel(cost, num) {
    if (!cost) return '';

    const bits = [];

    if (cost.tokens_out) {
        bits.push(cost.tokens_in
            ? `${num(cost.tokens_in, 0)}↑ ${num(cost.tokens_out, 0)}↓ tok`
            : `${num(cost.tokens_out, 0)} tok`);
    }

    if (cost.tokens_per_second) bits.push(`${num(cost.tokens_per_second)} tok/s`);

    return bits.join(' · ');
}
