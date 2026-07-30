import { $, emptyHtml } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { packHas } from '../dock/pack.js';
import { mdToHtml } from '../markdown.js';


let mdReturnFocus = null;

export let mdNodeId = null;

export let mdLabel = null;

export let mdPath = null;


export function closeMdOverlay() {
    $('md-overlay').classList.add('hidden');
    if (mdReturnFocus) { mdReturnFocus.focus(); mdReturnFocus = null; }
}


// Markdown čítačka (skill / summary). node = { id, label, path? }.
// Pätička ponúka Do balíka a Kopírovať cestu (ak je cesta známa).
export async function openMdOverlay(node) {
    const overlay = $('md-overlay');
    mdNodeId = node.id;
    mdLabel = node.label || '';
    mdPath = node.path || null;
    $('md-title').textContent = mdLabel;
    $('md-body').innerHTML = emptyHtml('hourglass_empty', 'Načítavam…');
    syncMdFoot();
    mdReturnFocus = document.activeElement;
    overlay.classList.remove('hidden');
    $('md-close').focus();
    try {
        const res = await fetch('/api/nodes/' + node.id + '/markdown');
        const data = await res.json();
        if (mdNodeId !== node.id) return; // medzitým otvorený iný dokument
        $('md-body').innerHTML = mdToHtml(data.markdown || '');
    } catch (e) {
        if (mdNodeId === node.id) $('md-body').innerHTML = emptyHtml('cloud_off', 'Dokument sa nepodarilo načítať');
    }
}


// Stav pätičky čítačky — pack tlačidlo podľa balíka, cesta len ak je známa
export function syncMdFoot() {
    const pk = $('md-pack');
    if (pk) {
        const on = mdNodeId != null && packHas(mdNodeId);
        pk.classList.toggle('in-pack', on);
        pk.textContent = on ? 'V balíku' : 'Do balíka';
    }
    const cp = $('md-copypath');
    if (cp) cp.classList.toggle('hidden', !mdPath);
}


/* C4: dokument uzla — overlay s vyrenderovaným markdownom.
   Pätička čítačky (md-pack / md-copypath) sa naväzuje v dock/pack.js. */
export function register(root) {
    const mdBtn = root.querySelector('#node-md');
    if (mdBtn) mdBtn.onclick = () => { if (S.selected) openMdOverlay(S.selected); };
    const close = root.querySelector('#md-close');
    if (close) close.onclick = closeMdOverlay;
    const overlay = root.querySelector('#md-overlay');
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeMdOverlay();
    });
}
