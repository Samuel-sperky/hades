// Témy — kontrakt pre canvas literály (idú cez T.*)
// nodeFloor/edgeFloor: spodná hranica tlmenia (hover × focus), gridAlpha: sila mriežky
export const THEMES = {
    light: { paper:'#f8f4f7', ink:'#101d1b', inkSoft:'#2d3a38', muted:'#566964', labelHalo:'rgba(248,244,247,0.92)', edge:'45,58,56', gridColor:'3,121,126', accent:'3,121,126', outline:'rgba(16,29,27,0.35)', gridAlpha:0.05, nodeFloor:0.30, edgeFloor:0.20 },
    dark:  { paper:'#0e1413', ink:'#eaf3f1', inkSoft:'#c3d1ce', muted:'#8a9b98', labelHalo:'rgba(14,20,19,0.92)', edge:'195,209,206', gridColor:'5,188,196', accent:'5,188,196', outline:'rgba(234,243,241,0.30)', gridAlpha:0.09, nodeFloor:0.35, edgeFloor:0.25 },
};
export let T = THEMES.dark;
// Tmavá je default — štartovú tému číta main.js cez initialTheme().
export function initialTheme(){ return localStorage.getItem('hades.theme') || 'dark'; }
export function setTheme(name){ T = THEMES[name] || THEMES.dark; document.documentElement.dataset.theme = (name === 'light' ? 'light' : 'dark'); localStorage.setItem('hades.theme', name); invalidateCertColors(); }
// Farby istoty z --cert-* + --border-strong (theme-aware) — čítané raz cez getComputedStyle
// a cache-nuté; setTheme cache invaliduje, aby prstence sadli na light/dark paletu.
export let _certColorCache = null;
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
