/* ===========================================================================
   Charón — transport NDJSON prúdu behu.

   Čistý transport, bez jediného DOM dotyku: číta prúd rámcov (newline-delimited
   JSON, jeden objekt na riadok) a vracia ich volajúcemu. Nič neimportuje, takže
   sa nemôže stať súčasťou žiadneho cyklu — presne ako to má runstate.js.

   Zdieľajú ho plná konzola (public/js/console/) aj dok Charóna nad grafom, aby
   NDJSON stream nemal dve kópie. Hlásenie chýb a kreslenie patrí volajúcemu:
   tento modul nevie, či beží nad tokom správ konzoly alebo nad plátnom grafu.
   =========================================================================== */

/**
 * Rozparsuje jeden riadok NDJSON. Prázdny riadok vráti `null` (nie je to rámec).
 * Inak vráti `{ frame }` pri platnom JSON, alebo `{ error }` s vetou pre človeka.
 *
 * Nečitateľný riadok NEUKONČÍ ťah — protokol ho zakazuje, ale keby prišiel,
 * stratiť zvyšok odpovede kvôli jednému rámcu by bola horšia chyba. Hlásenie
 * si vyberá volajúci; tu sa len pomenuje.
 */
export function parseNdjsonLine(line) {
    const text = String(line ?? '').trim();
    if (text === '') return null;

    try {
        return { frame: JSON.parse(text) };
    } catch {
        return { error: 'Nečitateľný rámec z behu (preskočený).' };
    }
}

/**
 * Číta prúd až do konca a pre každý neprázdny riadok zavolá `onFrame(parsed)`,
 * kde `parsed` je `{ frame }` alebo `{ error }` z `parseNdjsonLine`. Vracia
 * `true`, keď niektorý `onFrame` vrátil truthy (koncový rámec end/error/permission).
 *
 * Buffer je tu povinný z dvoch dôvodov a oba sú overiteľné:
 *   1. jeden JSON objekt sa MÔŽE rozdeliť medzi dva chunky, takže naivné
 *      `split('\n')` nad jedným chunkom by na hranici hodilo SyntaxError;
 *   2. `TextDecoder` s `{ stream: true }` drží aj rozdelený viacbajtový znak —
 *      bez toho by sa slovenská diakritika na hranici chunku rozsypala na „�".
 */
export async function readNdjson(reader, onFrame) {
    const decoder = new TextDecoder();
    let buffer = '';
    let closed = false;

    function feed(line) {
        const parsed = parseNdjsonLine(line);
        if (parsed === null) return;
        if (onFrame(parsed)) closed = true;
    }

    for (;;) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let cut = buffer.indexOf('\n');

        while (cut >= 0) {
            const line = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 1);
            feed(line);
            cut = buffer.indexOf('\n');
        }
    }

    // Posledný riadok nemusí mať koncový newline — a decoder treba dorovnať.
    buffer += decoder.decode();
    feed(buffer);

    return closed;
}

/**
 * Hľadá prvý rámec `t === 'error'` v NDJSON tele a vráti jeho `message`, inak
 * `fallback`. Backend aj pri 422 posiela TEN ISTÝ NDJSON rámec `error` (viď
 * RunController::refuse) a jeho text hovorí, čo sa naozaj stalo. `res.text()`
 * a status si rieši volajúci — tento modul dostane už hotový text.
 */
export function firstErrorMessage(text, fallback) {
    // Telo je NDJSON ako celý zvyšok protokolu — rámcov môže byť aj viac,
    // hľadá sa prvý `error`.
    for (const line of String(text ?? '').split('\n')) {
        const raw = line.trim();
        if (raw === '') continue;

        let frame;

        try {
            frame = JSON.parse(raw);
        } catch {
            continue;
        }

        if (frame?.t === 'error' && frame.message) return String(frame.message);
    }

    return fallback;
}
