import { reloadGraph } from './api.js';
import { mdLabel, mdNodeId, mdPath, syncMdFoot } from './md.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $, busy, emptyCardHtml, esc } from './util.js';

export function persistPack() {
    localStorage.setItem('hades.pack', JSON.stringify([...S.pack].map(([id, label]) => ({ id, label }))));
}
export function packHas(id) { return S.pack.has(+id); }
export function togglePack(id, label) {
    id = +id;
    if (S.pack.has(id)) S.pack.delete(id); else S.pack.set(id, label || ('#' + id));
    persistPack();
    updatePackUi();
    return S.pack.has(id);
}
export function addToPack(id, label) {
    id = +id;
    if (S.pack.has(id)) return false;
    S.pack.set(id, label || ('#' + id));
    persistPack();
    updatePackUi();
    return true;
}

// HTML pack-toggle tlačidla pre riadky zoznamov (Dnes / Denník / Knižnica).
// Konštantná ikona, aktívny stav farbí .in-pack (žiadny reflow pri prepnutí).
export function packBtn(id, label) {
    const on = packHas(id);
    return '<button type="button" class="pack-btn ms' + (on ? ' in-pack' : '') + '"'
        + ' data-pack-id="' + esc(String(id)) + '" data-pack-label="' + esc(label || '') + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
        + ' title="' + (on ? 'V balíku — klikni pre odobratie' : 'Do balíka') + '">library_add</button>';
}

// Naviaž pack-toggle tlačidlá v podstrome (stopPropagation, aby klik neotvoril aj riadok).
export function bindPackButtons(root) {
    root.querySelectorAll('.pack-btn[data-pack-id]').forEach((b) => {
        b.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const on = togglePack(b.dataset.packId, b.dataset.packLabel);
            showToast(on ? 'Pridané do balíka' : 'Odobraté z balíka');
        };
    });
}

// Zosúlaď celé pack UI so stavom S.pack — počet v hlavičke, všetky tlačidlá, detail, zásuvka.
/** Prepínač rozsahu drží stav vlákna aj vizuál — inak by tvrdil niečo iné než graf. */
export function syncScopeToggle() {
    const btn = $('scope-toggle');
    if (btn) btn.setAttribute('aria-checked', S.graphScope === 'all' ? 'true' : 'false');
}

/**
 * Prepne rozsah grafu, uloží ho a načíta sieť nanovo.
 *
 * Vydelené z onclicku, lebo rozsah teraz prepína aj hľadanie: keď človek otvorí
 * uzol, ktorý v aktuálnom pohľade nie je, pohľad sa musí rozšíriť — a musí to
 * spraviť CEZ TOTO, aby sa prepínač nerozišiel so skutočným stavom. Presne taký
 * rozchod (stav vypnutý, políčko tvrdí zapnutý) sme opravovali v Charónovi.
 *
 * @returns {Promise<void>} dobehne, keď je sieť načítaná
 */
export function setGraphScope(next) {
    S.graphScope = next === 'all' ? 'all' : 'live';
    localStorage.setItem('hades.graphScope', S.graphScope);
    syncScopeToggle();
    return reloadGraph();
}

export function updatePackUi() {
    const n = S.pack.size;
    const trig = $('pack-trigger');
    if (trig) {
        trig.classList.toggle('hidden', n === 0);
        const c = $('pack-count');
        if (c) c.textContent = String(n);
    }
    document.querySelectorAll('.pack-btn[data-pack-id]').forEach((b) => {
        const on = packHas(b.dataset.packId);
        b.classList.toggle('in-pack', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.title = on ? 'V balíku — klikni pre odobratie' : 'Do balíka';
    });
    const npk = $('node-pack');
    if (npk) {
        const on = S.selected ? packHas(S.selected.id) : false;
        npk.classList.toggle('in-pack', on);
        npk.setAttribute('aria-pressed', on ? 'true' : 'false');
        npk.title = on ? 'V balíku — klikni pre odobratie' : 'Do balíka';
    }
    if (packDrawerOpen()) renderPackList();
}

/* ---------- zásuvka balíka (export pre Claude Code) ---------- */

export function packDrawerOpen() {
    const d = $('pack-drawer');
    return d ? !d.classList.contains('hidden') : false;
}

// Fokus si zásuvka berie a vracia rovnako ako čítačka (md.js) a pomocník —
// bez toho spadol po zavretí na <body> a Tab začínal od začiatku dokumentu.
export let packReturnFocus = null;

export function openPackDrawer() {
    const d = $('pack-drawer');
    if (!d) return;
    if (!packDrawerOpen()) packReturnFocus = document.activeElement;
    d.classList.remove('hidden');
    renderPackList();
    const close = $('pack-close');
    if (close) close.focus();
}
export function closePackDrawer() {
    const d = $('pack-drawer');
    if (d) d.classList.add('hidden');
    const back = packReturnFocus;
    packReturnFocus = null;
    // <body> nie je „kam sa vrátiť" (viď closeCmdk) — vtedy fokus dostane spúšťač,
    // a keď ten medzitým zmizol (balík sa vyprázdnil), ostane tam, kde je.
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
    else { const t = $('pack-trigger'); if (t && !t.classList.contains('hidden')) t.focus(); }
}

export function renderPackList() {
    const list = $('pack-list');
    if (!list) return;
    // Zásuvka sa menuje „Balík pre Claude Code" a hneď pod nadpisom vysvetľuje, na čo
    // je — 28px ikona s vetou pod ňou to isté zopakuje po tretie. Jeden tichý riadok.
    if (!S.pack.size) { list.innerHTML = emptyCardHtml('Balík je prázdny'); return; }
    list.innerHTML = [...S.pack].map(([id, label]) =>
        '<div class="pack-row">'
        + '<span class="pack-row-label" title="' + esc(label) + '">' + esc(label) + '</span>'
        + '<button type="button" class="ghost ms pack-row-del" data-id="' + id
        + '" title="Odobrať" aria-label="Odobrať z balíka">close</button>'
        + '</div>'
    ).join('');
    list.querySelectorAll('.pack-row-del').forEach((b) => {
        b.onclick = () => { togglePack(b.dataset.id); };
    });
}

// Strop 50 je serverová validácia (/api/context/pack), nie rozmar — ale doteraz
// sa nad ním mlčky odrezalo a používateľ skopíroval balík bez uzlov, o ktorých
// si myslel, že v ňom sú. Pri exporte kontextu pre AI je tiché orezanie to
// najhoršie, čo sa môže stať.
export const PACK_LIMIT = 50;

export async function copyPack() {
    if (!S.pack.size) { showToast('Balík je prázdny'); return; }
    const ids = [...S.pack.keys()].slice(0, PACK_LIMIT);
    const cut = S.pack.size - ids.length;
    try {
        const res = await fetch('/api/context/pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_ids: ids }),
        });
        if (!res.ok) { showToast('Kopírovanie sa nepodarilo'); return; }
        const data = await res.json();
        await navigator.clipboard.writeText(data.markdown || '');
        showToast(cut > 0
            ? 'Skopírované ' + ids.length + ' z ' + S.pack.size + ' — strop balíka je ' + PACK_LIMIT
            : 'Skopírované pre Claude Code');
    } catch (e) {
        showToast('Kopírovanie sa nepodarilo');
    }
}

// Naviazanie všetkých pack ovládačov + prepínača rozsahu grafu. Volá sa raz z init().
export function setupPack() {
    const trig = $('pack-trigger');
    if (trig) trig.onclick = openPackDrawer;
    const pc = $('pack-close');
    if (pc) pc.onclick = closePackDrawer;
    const copyBtn = $('pack-copy');
    if (copyBtn) copyBtn.onclick = () => busy(copyBtn, copyPack, 'Kopírujem…');
    const clearBtn = $('pack-clear');
    if (clearBtn) clearBtn.onclick = () => {
        S.pack.clear();
        persistPack();
        updatePackUi();
        showToast('Balík vyprázdnený');
    };

    // Detail uzla — Do balíka
    const npk = $('node-pack');
    if (npk) npk.onclick = () => {
        if (!S.selected) return;
        togglePack(S.selected.id, S.selected.label);
    };

    // Čítačka — Do balíka + Kopírovať cestu
    const mpk = $('md-pack');
    if (mpk) mpk.onclick = () => {
        if (mdNodeId == null) return;
        togglePack(mdNodeId, mdLabel);
        syncMdFoot();
    };
    const mcp = $('md-copypath');
    if (mcp) mcp.onclick = async () => {
        if (!mdPath) return;
        try { await navigator.clipboard.writeText(mdPath); showToast('Cesta skopírovaná'); }
        catch (e) { showToast('Kopírovanie sa nepodarilo'); }
    };

    // Prepínač rozsahu grafu — 'live' (default) vs 'all' (celá knižnica v grafe)
    const scopeBtn = $('scope-toggle');
    if (scopeBtn) {
        syncScopeToggle();
        scopeBtn.onclick = () => {
            setGraphScope(S.graphScope === 'all' ? 'live' : 'all');
        };
    }

    updatePackUi();
}
