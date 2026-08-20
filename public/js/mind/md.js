import { packHas } from './pack.js';
import { $, emptyHtml, esc, loadingHtml } from './util.js';

/* ---------- dokument uzla (markdown preview) ---------- */

// Malý čistý markdown → HTML renderer. Zdroj sa najprv escapuje (esc), formátovanie
// sa aplikuje až na escapovaný text — žiadny HTML injection nie je možný.
export function mdToHtml(src) {
    src = String(src).replace(/\r\n?/g, '\n');

    // Frontmatter (--- ... ---) na začiatku → kompaktný tlmený meta riadok
    let front = '';
    const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
        const items = fm[1].split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const i = l.indexOf(':');
            if (i === -1) return esc(l);
            return '<strong>' + esc(l.slice(0, i).trim()) + '</strong> ' + esc(l.slice(i + 1).trim());
        });
        front = '<div class="md-front">' + items.join('<span class="md-front-sep">·</span>') + '</div>';
        src = src.slice(fm[0].length);
    }

    const inline = (t) => t
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    const lines = esc(src).split('\n');
    let html = '';
    let listOpen = false;
    let paras = [];
    let i = 0;

    const flushPara = () => {
        if (paras.length) { html += '<p>' + inline(paras.join(' ')) + '</p>'; paras = []; }
    };
    const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };

    while (i < lines.length) {
        const line = lines[i];

        const fence = line.match(/^\s*```/);
        if (fence) {
            flushPara(); closeList();
            const buf = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
            i++; // preskoč uzatváraciu ohradu
            html += '<pre class="md-code"><code>' + buf.join('\n') + '</code></pre>';
            continue;
        }

        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            flushPara(); closeList();
            html += '<hr class="md-hr">';
            i++; continue;
        }

        const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
        if (h) {
            flushPara(); closeList();
            const lvl = h[1].length;
            html += '<h' + lvl + ' class="md-h">' + inline(h[2].trim()) + '</h' + lvl + '>';
            i++; continue;
        }

        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) {
            flushPara();
            if (!listOpen) { html += '<ul class="md-list">'; listOpen = true; }
            html += '<li>' + inline(li[1].trim()) + '</li>';
            i++; continue;
        }

        if (/^\s*$/.test(line)) {
            flushPara(); closeList();
            i++; continue;
        }

        closeList();
        paras.push(line.trim());
        i++;
    }
    flushPara(); closeList();
    return front + html;
}

export let mdReturnFocus = null;
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
    $('md-body').innerHTML = loadingHtml('Načítava sa dokument…');
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
