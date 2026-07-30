import { $, busy, emptyHtml, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { updatePackUi } from '../dock/pack.js';
import { focusNode } from '../graph/camera.js';
import { nodeColor } from '../graph/colors.js';
import { clearLocal, setLocal } from '../graph/local.js';
import { draw } from '../graph/render/draw.js';
import { requestDraw } from '../graph/render/frame.js';
import { buildSim, kickSim } from '../graph/sim.js';
import { closeCreateMode, setCreateMode } from './create-node.js';
import { deleteEdge } from './edge-admin.js';
import { renderNodeRecord } from './record.js';
import { renderSuggestions } from './suggestions.js';
import { renderNodeBadges } from '../screens/shared/cert.js';
import { showToast } from '../shell/toasts.js';


export async function selectNode(n) {
    // aktívny lokálny graf sa preväzuje na novo zvolený uzol (Obsidian re-root)
    if (S.local && S.local.rootId !== n.id) setLocal(n.id, S.local.depth);
    closeCreateMode(); // výber uzla vždy vracia panel do detailného režimu
    S.selected = n;
    requestDraw(); // nový výber → prekresli zvýraznenie (slučka mohla spať)
    updatePackUi(); // node-pack tlačidlo odzrkadlí stav balíka pre tento uzol
    $('node-panel').classList.remove('hidden');
    $('node-form').classList.add('hidden');
    $('node-view').classList.remove('hidden');
    $('node-type-label').textContent = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' }[n.type] || n.type;
    const nc = nodeColor(n); // farba oblasti — typ hovorí tvar, nie farba
    $('node-swatch').style.background = nc;
    $('node-panel').style.setProperty('--node-c', nc);
    $('node-label').textContent = n.label;
    $('node-desc').textContent = n.description || '';
    $('node-meta').textContent = 'sila ' + (n.strength || 1).toFixed(0);
    renderNodeBadges(n); // F4: origin + cert + značky

    $('node-neighbors').innerHTML = '';
    $('node-history').innerHTML = '';
    $('node-record').innerHTML = '';
    $('node-suggestions').innerHTML = '';
    $('node-md').classList.add('hidden'); // dokument sa odhalí až po načítaní meta

    renderSuggestions(n); // A8: algoritmické návrhy prepojení (vlastný fetch)

    try {
        const res = await fetch('/api/nodes/' + n.id);
        const data = await res.json();
        renderNodeRecord(data.node);

        // C4: tlačidlo dokumentu len ak uzol má markdown zdroj (summary_path / path)
        const nm = data.node.meta || {};
        $('node-md').classList.toggle('hidden', !(nm.summary_path || nm.path));
        const meta = [];
        if (data.node.area_name) meta.push(data.node.area_name);
        if (data.node.department_name) meta.push(data.node.department_name);
        meta.push('sila ' + data.node.strength.toFixed(0));
        $('node-meta').textContent = meta.join(' · ');

        // riadok suseda: chip (navigácia) + × (zrušenie spojenia) — edge id z S.edges podľa páru
        $('node-neighbors').innerHTML = data.neighbors.map((m) => {
            const edge = S.edges.find((x) =>
                (x.source_id === n.id && x.target_id === m.id)
                || (x.source_id === m.id && x.target_id === n.id));
            return '<div class="nb-row">'
                + '<button type="button" class="chip" data-id="' + m.id + '">' + esc(m.label) + '</button>'
                + (edge
                    ? '<button type="button" class="ghost ms nb-del" data-edge="' + edge.id
                        + '" title="Zrušiť spojenie" aria-label="Zrušiť spojenie">close</button>'
                    : '')
                + '</div>';
        }).join('') || emptyHtml('hub', 'Bez spojení');

        $('node-neighbors').querySelectorAll('.chip').forEach((chip) => {
            chip.onclick = () => {
                const target = S.byId.get(+chip.dataset.id);
                if (target) { selectNode(target); focusNode(target); }
            };
        });

        $('node-neighbors').querySelectorAll('.nb-del').forEach((btn) => {
            btn.onclick = () => busy(btn, () => deleteEdge(+btn.dataset.edge));
        });

        $('node-history').innerHTML = data.activations.map((a) => {
            const kinds = { learn: 'naučené', activate: 'aktivované', merge: 'zlúčené', recall: 'spomenuté', seed: 'zasiate' };
            return '<div class="hist">' + (kinds[a.kind] || a.kind) + ' · ' + new Date(a.created_at).toLocaleString('sk') + '</div>';
        }).join('') || emptyHtml('history', 'Zatiaľ žiadna aktivita');
    } catch (e) { /* offline detail nevadí */ }
}


export function closeNodePanel() {
    S.selected = null;
    setCreateMode(false);
    $('edit-type-row').classList.add('hidden');
    $('node-panel').classList.add('hidden');
    requestDraw(); // zrušený výber → prekresli (zmizne zvýraznenie)
}


/* Panel detailu uzla — zatvorenie a mazanie (arm pattern namiesto confirm()). */
export function register(root) {
    const nodeClose = root.querySelector('#node-close');
    if (nodeClose) nodeClose.onclick = closeNodePanel;

    // Mazanie uzla — arm pattern: prvý klik ozbrojí, druhý do 3 s maže
    const nodeDel = root.querySelector('#node-delete');
    if (!nodeDel) return;
    const disarmNodeDelete = () => {
        clearTimeout(nodeDel._disarm);
        nodeDel.classList.remove('armed');
        nodeDel.classList.add('ms');
        nodeDel.textContent = 'delete';
    };
    if (nodeClose) nodeClose.addEventListener('click', disarmNodeDelete);
    nodeDel.onclick = async () => {
        if (!S.selected) return;
        if (!nodeDel.classList.contains('armed')) {
            nodeDel.classList.add('armed');
            nodeDel.classList.remove('ms');
            nodeDel.textContent = 'Naozaj zmazať?';
            nodeDel._disarm = setTimeout(() => { if (nodeDel.isConnected) disarmNodeDelete(); }, 3000);
            return;
        }
        clearTimeout(nodeDel._disarm);
        const node = S.selected;
        await busy(nodeDel, async () => {
            try {
                const res = await fetch('/api/nodes/' + node.id, { method: 'DELETE' });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showToast(data.message || 'Nepodarilo sa zmazať');
                    return;
                }
                // lokálne odstránenie — pulse node.deleted je idempotentný, duplicitu toleruje
                S.nodes = S.nodes.filter((m) => m.id !== node.id);
                S.edges = S.edges.filter((e) => e.source.id !== node.id && e.target.id !== node.id);
                S.byId.delete(node.id);
                if (S.local && S.local.rootId === node.id) clearLocal();
                S._localFor = null;
                closeNodePanel();
                buildSim();
                kickSim(0.3);
                draw();
                showToast('Uzol zmazaný');
            } catch (e) {
                showToast('Nepodarilo sa zmazať');
            }
        }, 'Mažem…');
        disarmNodeDelete();
    };
}
