
// FÁZA CERTAINTY (F4, §4.6): mapovanie istoty → štýl prstenca (CVD-safe double-encoding).
// overené = plný prstenec, hypotéza = čiarkovaný, pasca = plný + výstražný pip.
// bez/null → žiadny prstenec. Hue istotu NEkóduje (kolízia s farbou oblasti/typu).
export const CERT_RING = { overene: 'solid', hypoteza: 'dashed', pasca: 'pip' };


// Farby istoty z --cert-* + --border-strong (theme-aware) — čítané raz cez getComputedStyle
// a cache-nuté; setTheme cache invaliduje, aby prstence sadli na light/dark paletu.
let _certColorCache = null;

export function certColors() {
    if (_certColorCache) return _certColorCache;
    const cs = getComputedStyle(document.documentElement);
    const get = (v, fb) => ((cs.getPropertyValue(v) || '').trim() || fb);
    _certColorCache = {
        overene: get('--cert-overene', '#1f7a4d'),
        hypoteza: get('--cert-hypoteza', '#8f5a12'),
        pasca: get('--cert-pasca', '#c0392f'),
        borderStrong: get('--border-strong', '#d9ced6'),
    };
    return _certColorCache;
}

export function invalidateCertColors() { _certColorCache = null; }
