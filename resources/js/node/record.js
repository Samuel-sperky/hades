import { $, esc } from '../core/dom.js';


// Detail záznamu (session / digest / archive) v paneli uzla — stavia sa z node.meta
const RECORD_SOURCES = ['session', 'digest', 'archive'];


export function renderNodeRecord(node) {
    const wrap = $('node-record');
    wrap.innerHTML = '';
    const meta = node && node.meta;
    if (!meta || !RECORD_SOURCES.includes(node.source)) return;

    const clip = (s, max) => {
        s = String(s);
        return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
    };

    let html = '';

    if (Array.isArray(meta.prompts) && meta.prompts.length) {
        html += '<h3>Prompty</h3><ol class="rec-prompts">'
            + meta.prompts.map((p) => '<li>' + esc(clip(p, 140)) + '</li>').join('')
            + '</ol>';
    }

    if (Array.isArray(meta.files) && meta.files.length) {
        html += '<h3>Súbory</h3><div class="rec-files">'
            + meta.files.slice(0, 10).map((f) => {
                const s = String(f);
                const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
                const dir = i >= 0 ? s.slice(0, i + 1) : '';
                const base = i >= 0 ? s.slice(i + 1) : s;
                return '<span class="meta-chip" title="' + esc(s) + '">'
                    + (dir ? '<span class="dir">' + esc(dir) + '</span>' : '')
                    + '<strong>' + esc(base) + '</strong></span>';
            }).join('')
            + '</div>';
    }

    if (Array.isArray(meta.commits) && meta.commits.length) {
        html += '<h3>Commity</h3>'
            + meta.commits.map((c) => {
                const label = typeof c === 'string' ? c : (c && (c.message || c.hash)) || '';
                return '<div class="rec-commit"><span class="ms" aria-hidden="true">commit</span>'
                    + '<span>' + esc(clip(label, 160)) + '</span></div>';
            }).join('');
    }

    // meta.tools je objekt {name: count}; pole necháme ako fallback starších záznamov
    let toolChips = '';
    if (Array.isArray(meta.tools)) {
        toolChips = meta.tools.map((t) => '<span class="meta-chip">' + esc(t) + '</span>').join('');
    } else if (meta.tools && typeof meta.tools === 'object') {
        toolChips = Object.entries(meta.tools).map(([name, count]) =>
            '<span class="meta-chip"><strong>' + esc(name) + '</strong>&nbsp;×' + esc(String(count)) + '</span>'
        ).join('');
    }
    if (toolChips) {
        html += '<h3>Nástroje</h3><div class="rec-tools">' + toolChips + '</div>';
    }

    if (meta.final) {
        html += '<h3>Záver</h3><p class="rec-final">' + esc(clip(meta.final, 400)) + '</p>';
    }

    wrap.innerHTML = html;
}
