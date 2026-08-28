import { reloadGraph } from './api.js';
import { attachToContext, contextHas, refreshContextButtons } from './charon.js';
import { mdLabel, mdNodeId, mdPath, syncMdFoot } from './md.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $, esc } from './util.js';
import { iconMarkup } from '../shared/icons.js';

/* ---------- „Do balíka" = priloženie do kontextu doku Charóna (A8, R-6) ----------

   NEVRATNÁ ZMENA VÝZNAMU (kontrakt R-6, používateľ schválil): tlačidlá „Do
   balíka" (packBtn) na obrazovkách Dnes / Denník / Knižnica a v čítačke už
   NEKOPÍRUJÚ do schránky. Plnia jediný spoločný kontext „daj Claude Code" —
   kontext doku Charóna (S.charonCtx, vlastní ho charon.js). Bývalý „Balík pre
   Claude Code" (S.pack, jeho zásuvka a export cez /api/context/pack) zanikol;
   von sa poznatok dostane rozhovorom s Charónom nad tým istým kontextom.

   Modul zostal (WONTFIX #4 auditu zakazoval mazať packBtn) ako TENKÝ ADAPTÉR:
   packBtn kreslí to isté tlačidlo, bindPackButtons ho naviaže na kontext doku.
   Stav členstva aj popisky sú jeden zdroj pravdy v charon.js (contextHas /
   attachToContext / refreshContextButtons). Exporty sú hoistované `export
   function` — graf modulov má cykly (panels → pack → charon → …).

   Prepínač rozsahu grafu (#scope-toggle) je tu tiež, hoci s balíkom nesúvisí —
   býval vedľa neho a importuje ho screens.js pri rozšírení pohľadu. */

// packHas ostáva ako meno pre md.js (syncMdFoot číta členstvo) — delegát na
// jeden zdroj pravdy v charon.js.
export function packHas(id) { return contextHas(id); }

// HTML pack-toggle tlačidla pre riadky zoznamov (Dnes / Denník / Knižnica).
// Konštantná ikona, aktívny stav farbí .in-pack (žiadny reflow pri prepnutí).
// Trieda .pack-btn a jej štýly v mind.css ostávajú; mení sa len význam (kontext).
export function packBtn(id, label) {
    const on = packHas(id);
    return '<button type="button" class="pack-btn' + (on ? ' in-pack' : '') + '"'
        + ' data-pack-id="' + esc(String(id)) + '" data-pack-label="' + esc(label || '') + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
        + ' title="' + (on ? 'V rozhovore — klikni pre odobratie' : 'Priložiť do rozhovoru') + '">'
        + iconMarkup('library-plus') + '</button>';
}

// Naviaž pack-toggle tlačidlá v podstrome (stopPropagation, aby klik neotvoril aj
// riadok). attachToContext prepne členstvo a pri pridaní otvorí zavretý dok.
export function bindPackButtons(root) {
    root.querySelectorAll('.pack-btn[data-pack-id]').forEach((b) => {
        b.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const r = attachToContext(b.dataset.packId, b.dataset.packLabel);
            if (r.full) showToast('Kontext má strop 8 uzlov — najprv niektorý odober');
            else showToast(r.on ? 'Priložené do rozhovoru' : 'Odobraté z rozhovoru');
        };
    });
}

// Volá ju panels.js pri výbere uzla — zosúladí #node-charon aj .pack-btn so
// stavom kontextu. Meno ostáva (panels.js ho importuje), telo delegát na charon.js.
export function updatePackUi() {
    refreshContextButtons();
}

/* ---------- prepínač rozsahu grafu (nesúvisí s balíkom) ---------- */

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

// Naviazanie čítačky (#md-pack) a prepínača rozsahu grafu. Volá sa raz z init().
export function setupPack() {
    // Čítačka dokumentu — „Do balíka" priloží uzol dokumentu do kontextu doku.
    const mpk = $('md-pack');
    if (mpk) mpk.onclick = () => {
        if (mdNodeId == null) return;
        attachToContext(mdNodeId, mdLabel);
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
}
