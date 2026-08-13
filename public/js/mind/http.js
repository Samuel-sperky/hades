import { showToast } from './toasts.js';

/* ---------- CSRF + hlásenie zamknutého okruhu ----------

   Od 13. 8. 2026 sú interné /api/* za UI guardom a ValidateCsrfToken
   (§3.5 docs/BEZPECNOST.md), takže každý zápis musí priniesť token z <meta>.
   Obaľujeme fetch raz namiesto toho, aby ho ručne pripájalo ~40 volaní.
   401/419 = zamknuté alebo vypršaná session; bez tejto hlášky by dashboard len
   ticho prestal reagovať a vyzeralo by to ako rozbitý backend.

   Pôvodne to bolo na začiatku monolitického mind.js. Po rozsekaní na moduly to
   musí zavolať main.js ako PRVÉ v init() — skôr, než ktorýkoľvek modul fetchne. */
export function installFetchGuard() {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const nativeFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
        const opts = { ...(init || {}) };
        const method = String(opts.method || (input && input.method) || 'GET').toUpperCase();
        const url = String(typeof input === 'string' ? input : (input && input.url) || '');
        const sameOrigin = url.startsWith('/') || url.startsWith(location.origin);

        if (csrf && sameOrigin && method !== 'GET' && method !== 'HEAD') {
            // Headers, nie spread — časť volaní posiela plain objekt, ale spread nad
            // instanciou Headers by hlavičky ticho zahodil.
            const headers = new Headers(opts.headers || (input && input.headers) || {});
            headers.set('X-CSRF-TOKEN', csrf);
            opts.headers = headers;
        }

        return nativeFetch(input, opts).then((res) => {
            if (res.status === 401) showToast('Hades je zamknutý — odomkni ho tokenom (?token=…)');
            else if (res.status === 419) showToast('Session vypršala — obnov stránku (F5)');

            return res;
        });
    };
}
