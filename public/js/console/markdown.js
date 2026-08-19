/* ===========================================================================
   Minimálny markdown pre odpovede modelu.

   Prečo vlastných 120 riadkov a nie balík: výstup modelu je NEDÔVERYHODNÝ vstup
   a jediné bezpečné poradie je „escapuj všetko, potom povoľ menovaný zoznam".
   Marked/markdown-it robia opak (parsujú a povoľujú HTML), takže by sa do toku
   dostal `<img onerror=…>` z uzla, ktorý si model prečítal z pamäte. Navyše by
   to bol build step, ktorý tento projekt nemá.

   Povolené je presne: ```plot```, `inline`, **tučné**, *kurzíva*, odrážky,
   číslované zoznamy, nadpisy a odkazy s http(s)/relatívnou schémou. Všetko
   ostatné zostáva textom.
   =========================================================================== */

// Zástupné znaky sú NUL — v texte od modelu sa nevyskytnú a nezasahujú do
// žiadneho markdown pravidla, takže sa nedajú „prehovoriť" cez vstup.
const CODE_MARK = '\x00c';
const SPAN_MARK = '\x00i';
const CODE_LINE = /^\x00c(\d+)\x00c$/;

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Markdown → HTML. Vstup je vždy escapovaný PRV, než sa povolí prvá značka. */
export function renderMarkdown(src) {
    const blocks = [];

    // Nezavretý plot je počas streamu NORMÁLNY stav, nie chyba: kým dobehne
    // koncové ```, chceme už kresliť blok kódu a nie tri surové spätné apostrofy
    // v odseku. Preto `(?:```|$)`.
    const body = String(src ?? '').replace(
        /```([\w+.#-]*)[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g,
        (_m, lang, code) => {
            blocks.push({ lang, code });

            return `${CODE_MARK}${blocks.length - 1}${CODE_MARK}`;
        },
    );

    const out = [];
    let list = null;
    let para = [];

    function closeList() {
        if (!list) return;

        out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
        list = null;
    }

    function closePara() {
        if (para.length === 0) return;

        out.push(`<p>${para.join('<br>')}</p>`);
        para = [];
    }

    for (const raw of body.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/u, '');
        const fence = line.match(CODE_LINE);

        if (fence) {
            closeList();
            closePara();
            out.push(codeBlock(blocks[Number(fence[1])]));
            continue;
        }

        if (line.trim() === '') {
            closeList();
            closePara();
            continue;
        }

        const head = line.match(/^(#{1,6})\s+(.*)$/);

        if (head) {
            closeList();
            closePara();
            // h3/h4 a nie h1/h2: h1 je titulok vlákna, h2 patrí prázdnemu stavu —
            // odpoveď modelu nesmie prepísať štruktúru dokumentu pod sebou.
            out.push(`<h${head[1].length <= 2 ? 3 : 4}>${inline(head[2])}</h${head[1].length <= 2 ? 3 : 4}>`);
            continue;
        }

        const bullet = line.match(/^\s{0,3}[-*+]\s+(.*)$/);
        const number = line.match(/^\s{0,3}\d+[.)]\s+(.*)$/);

        if (bullet || number) {
            const tag = bullet ? 'ul' : 'ol';
            closePara();
            if (list && list.tag !== tag) closeList();
            if (!list) list = { tag, items: [] };
            list.items.push(inline((bullet || number)[1]));
            continue;
        }

        closeList();
        para.push(inline(line));
    }

    closeList();
    closePara();

    return out.join('');
}

function codeBlock(block) {
    if (!block) return '';

    const lang = block.lang ? ` data-lang="${escapeHtml(block.lang)}"` : '';

    return `<pre class="code"${lang}><code>${escapeHtml(block.code.replace(/\n$/, ''))}</code></pre>`;
}

/** Inline pravidlá nad UŽ escapovaným textom. */
function inline(text) {
    const spans = [];

    // `kód` sa vyberie prvý a vráti sa posledný — inak by **tučné** a odkazy
    // vlezli aj dovnútra kódu, kde má byť text presne taký, aký prišiel.
    let s = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code) => {
        spans.push(code);

        return `${SPAN_MARK}${spans.length - 1}${SPAN_MARK}`;
    });

    s = s.replace(/\*\*(?=\S)([^*]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*(?=\S)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, href) => {
        // Menovaný zoznam schém: `javascript:`, `data:` ani `vbscript:` sa do
        // href nedostanú, aj keď ich model navrhne. Zvyšok zostáva textom.
        if (!/^(https?:\/\/|\/)/.test(href)) return whole;

        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    return s.replace(/\x00i(\d+)\x00i/g, (_m, i) => `<code>${spans[Number(i)]}</code>`);
}
