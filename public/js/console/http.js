/* CSRF + hlásenie zamknutého okruhu pre konzolu.

   Prečo vlastná kópia a nie import z /js/mind/http.js: ten modul ťahá toasts.js
   a cez neho ďalšie moduly grafu. Konzola je iná stránka a nemá dôvod načítať
   graf, aby vedela poslať fetch. Rozdiel proti grafu je zámerný: konzola nemá
   toasty, hlásenie ide do toku správ, kde ho používateľ naozaj číta.

   Interné /api/* sedia za UI guardom a ValidateCsrfToken (§3.3 docs/BEZPECNOST.md),
   takže každý non-GET request musí priniesť token z <meta>. */

const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

let onLocked = () => {};

/** Konzola si sem zavesí vykreslenie chyby do toku správ. */
export function setLockedHandler(fn) {
    onLocked = typeof fn === 'function' ? fn : onLocked;
}

/**
 * Fetch s CSRF hlavičkou. Vracia Response — stream behu si telo číta sám,
 * preto sa tu odpoveď zámerne neparsuje na JSON.
 */
export async function request(url, { method = 'GET', body, signal } = {}) {
    const headers = new Headers();

    if (method !== 'GET' && method !== 'HEAD') {
        headers.set('X-CSRF-TOKEN', csrf());
        if (body !== undefined) headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, {
        method,
        headers,
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) onLocked('Hades je zamknutý — odomkni ho tokenom (?token=…).');
    else if (res.status === 419) onLocked('Session vypršala — obnov stránku (F5).');

    return res;
}

/** Ten istý request, ale rovno ako JSON. Pri chybe vráti null a ohlási ju. */
export async function json(url, opts) {
    try {
        const res = await request(url, opts);

        if (!res.ok) {
            // Telo chyby je pre človeka, nie pre parser — 500 vracia HTML.
            onLocked(`Požiadavka zlyhala (HTTP ${res.status}).`);

            return null;
        }

        return await res.json();
    } catch (e) {
        // Prerušenie behu tlačidlom Stop nie je chyba, ktorú treba hlásiť.
        if (e?.name !== 'AbortError') onLocked('Sieťová chyba — Hades neodpovedal.');

        return null;
    }
}
