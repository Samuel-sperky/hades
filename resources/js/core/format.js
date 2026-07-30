
/* ---------- pomocníci ---------- */

export const now = () => Date.now();

export const rad = (deg) => (deg * Math.PI) / 180;

export const ts = (iso) => (iso ? new Date(iso).getTime() : 0);


// Skrátenie labelu LEN pri kreslení (hover-card a panel používajú n.label v plnej dĺžke)
export function truncLabel(s) {
    const chars = Array.from(String(s)); // mb-safe (surrogate pairs)
    return chars.length > 24 ? chars.slice(0, 23).join('').trimEnd() + '…' : s;
}


// SK plurál 1 / 2-4 / 5+ (a 0)
export function plural(n, one, few, many) {
    n = Math.abs(+n) || 0;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
}


export function monthLabel(ym) {
    if (!ym) return 'Bez dátumu';
    const parts = ym.split('-');
    const dt = new Date(+parts[0], (+parts[1] || 1) - 1, 1);
    return dt.toLocaleDateString('sk', { month: 'long', year: 'numeric' });
}


export function fmtDecDate(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00').toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}


export function timeAgo(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min';
    if (d < 86400) return Math.round(d / 3600) + ' h';
    if (d < 604800) return Math.round(d / 86400) + ' d';
    return new Date(iso).toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}


// Denník — časová os zoskupená po dňoch, s filtrom podľa projektu
const SK_MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
    'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];


export function dayLabel(iso) {
    const d = new Date(iso);
    const t = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((midnight(t) - midnight(d)) / 86400000);
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    return d.getDate() + '. ' + SK_MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear();
}


export function timeHM(iso) {
    return new Date(iso).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}
