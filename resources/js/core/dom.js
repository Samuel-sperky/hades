
/* ---------- panely ---------- */

export const $ = (id) => document.getElementById(id);


export function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


// Async spätná väzba tlačidiel — disable + dočasný text počas behu
export async function busy(btn, fn, busyText) {
    if (btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = old; }
}


// Jednotný prázdny stav — jedna šablóna pre všetky sekcie
export function emptyHtml(icon, text) {
    return '<div class="empty"><span class="ms" aria-hidden="true">' + icon + '</span><p>' + esc(text) + '</p></div>';
}


export function renderEmpty(container, icon, text) {
    container.innerHTML = emptyHtml(icon, text);
}


// Chybový hero cez plátno — vedomie sa nepodarilo načítať
export function renderInitError() {
    const el = document.createElement('div');
    el.className = 'empty empty-network';
    el.innerHTML = '<span class="ms" aria-hidden="true">cloud_off</span>'
        + '<h4 class="title">Vedomie sa nepodarilo prebudiť</h4>'
        + '<p class="hint">Server neodpovedá — skontroluj, či Hades beží.</p>'
        + '<button type="button" class="primary" id="retry-init">Skúsiť znova</button>';
    document.body.appendChild(el);
    el.querySelector('#retry-init').onclick = () => location.reload();
}
