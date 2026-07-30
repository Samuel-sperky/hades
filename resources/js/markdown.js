import { esc } from './core/dom.js';


/* ---------- markdown → HTML (zamknuté rozhranie #10) ----------

   Malý čistý renderer bez závislostí (appka musí fungovať offline). Zdroj sa
   najprv escapuje (esc), formátovanie sa aplikuje až na escapovaný text —
   žiadny HTML injection nie je možný. Odkazy majú navyše whitelist protokolu,
   takže `javascript:` sa nikdy nedostane do href.

   P6 doplnil oproti W0: tabuľky, odkazy, číslované listy, blockquote, `####`
   a tlačidlo Kopírovať pri code blockoch. Všetko je prepínateľné cez opts,
   aby dokument uzla a chatová bublina mohli mať iné chovanie. */

export const MD_DEFAULTS = {
    frontmatter: true,     // --- ... --- na začiatku → kompaktný meta riadok
    tables: true,          // GFM pipe tabuľky
    links: true,           // [text](url) + bare https:// odkazy
    orderedLists: true,    // 1. 2. 3.
    blockquote: true,      // > citát
    headingDepth: 4,       // # .. ####
    codeCopyButton: false, // tlačidlo Kopírovať nad ```blokom```
};

// Sentinel pre dočasné placeholdery inline formátovania. Zo zdroja sa vždy
// najprv odstráni, takže sa nemôže stretnúť s reálnym obsahom.
const HOLD = String.fromCharCode(0);

// Marker blockquote po escapovaní zdroja
const QUOTE_RE = /^\s*&gt;\s?/;

// Whitelist protokolov. `url` je už escapovaný text, takže úvodzovky sú &quot;
// a z atribútu sa vylomiť nedá; kontrolujeme len schému.
function safeUrl(url) {
    if (!url || url.includes(HOLD)) return null;
    if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
    if (/^[/#]/.test(url)) return url;
    return null;
}

function anchor(href, label) {
    return '<a class="md-link" href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
}

function inlineFmt(text, opts) {
    const holds = [];
    const hold = (html) => { holds.push(html); return HOLD + (holds.length - 1) + HOLD; };

    // Inline kód ide prvý — jeho obsah sa už ďalej neformátuje.
    let t = text.replace(/`([^`]+)`/g, (m, code) => hold('<code>' + code + '</code>'));

    if (opts.links) {
        t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
            const href = safeUrl(url);
            return href ? hold(anchor(href, label)) : m;
        });
        // Bare odkaz: koncová interpunkcia (a escapovaná entita) nepatrí do URL.
        t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, raw) => {
            const trimmed = raw.replace(/(?:[.,;:!?]|&(?:quot|gt|lt|amp|#39);)+$/, '');
            const href = safeUrl(trimmed);
            if (!href) return m;
            return pre + hold(anchor(href, trimmed)) + raw.slice(trimmed.length);
        });
    }

    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    return t.replace(new RegExp(HOLD + '(\\d+)' + HOLD, 'g'), (m, i) => holds[+i]);
}

function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// Oddeľovací riadok tabuľky: |---|:--:| — musí obsahovať aspoň jednu pomlčku
function isTableRule(line) {
    return typeof line === 'string' && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function alignOf(spec) {
    const s = spec.trim();
    if (s.startsWith(':') && s.endsWith(':')) return ' style="text-align:center"';
    if (s.endsWith(':')) return ' style="text-align:right"';
    return '';
}

function renderTable(head, rule, rows, opts) {
    const cols = cells(rule).map(alignOf);
    const th = cells(head).map((c, i) => '<th' + (cols[i] || '') + '>' + inlineFmt(c, opts) + '</th>').join('');
    const body = rows.map((r) => {
        const tds = cells(r).map((c, i) => '<td' + (cols[i] || '') + '>' + inlineFmt(c, opts) + '</td>').join('');
        return '<tr>' + tds + '</tr>';
    }).join('');
    return '<div class="md-tablewrap"><table class="md-table"><thead><tr>' + th + '</tr></thead>'
        + '<tbody>' + body + '</tbody></table></div>';
}

function renderFence(lines, opts) {
    const code = '<pre class="md-code"><code>' + lines.join('\n') + '</code></pre>';
    if (!opts.codeCopyButton) return code;
    return '<div class="md-codewrap">'
        + '<button type="button" class="md-copy ms" title="Kopírovať kód" aria-label="Kopírovať kód">content_copy</button>'
        + code + '</div>';
}

export function mdToHtml(src, opts = {}) {
    const o = { ...MD_DEFAULTS, ...opts };
    src = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split(HOLD).join('');

    let front = '';
    if (o.frontmatter) {
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
    }

    const lines = esc(src).split('\n');
    const depth = Math.min(6, Math.max(1, o.headingDepth));
    const headingRe = new RegExp('^\\s*(#{1,' + depth + '})\\s+(.*)$');
    let html = '';
    let list = null;   // 'ul' | 'ol' | null
    let paras = [];
    let i = 0;

    const flushPara = () => {
        if (paras.length) { html += '<p>' + inlineFmt(paras.join(' '), o) + '</p>'; paras = []; }
    };
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    const openList = (kind, cls) => {
        if (list !== kind) { closeList(); html += '<' + kind + ' class="' + cls + '">'; list = kind; }
    };

    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*```/.test(line)) {
            flushPara(); closeList();
            const buf = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
            i++; // preskoč uzatváraciu ohradu
            html += renderFence(buf, o);
            continue;
        }

        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            flushPara(); closeList();
            html += '<hr class="md-hr">';
            i++; continue;
        }

        if (o.tables && line.includes('|') && isTableRule(lines[i + 1])) {
            flushPara(); closeList();
            const head = line;
            const rule = lines[i + 1];
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { rows.push(lines[i]); i++; }
            html += renderTable(head, rule, rows, o);
            continue;
        }

        const h = line.match(headingRe);
        if (h) {
            flushPara(); closeList();
            const lvl = h[1].length;
            html += '<h' + lvl + ' class="md-h">' + inlineFmt(h[2].trim(), o) + '</h' + lvl + '>';
            i++; continue;
        }

        // Riadky sú už escapované, takže markerom citátu je `&gt;`, nie `>`.
        if (o.blockquote && QUOTE_RE.test(line)) {
            flushPara(); closeList();
            const buf = [];
            while (i < lines.length && QUOTE_RE.test(lines[i])) { buf.push(lines[i].replace(QUOTE_RE, '')); i++; }
            html += '<blockquote class="md-quote">' + buf
                .join('\n').split(/\n{2,}/).filter((p) => p.trim())
                .map((p) => '<p>' + inlineFmt(p.split('\n').join(' ').trim(), o) + '</p>').join('')
                + '</blockquote>';
            continue;
        }

        const ol = o.orderedLists ? line.match(/^\s*\d+[.)]\s+(.*)$/) : null;
        if (ol) {
            flushPara();
            openList('ol', 'md-list md-ol');
            html += '<li>' + inlineFmt(ol[1].trim(), o) + '</li>';
            i++; continue;
        }

        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) {
            flushPara();
            openList('ul', 'md-list');
            html += '<li>' + inlineFmt(li[1].trim(), o) + '</li>';
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
