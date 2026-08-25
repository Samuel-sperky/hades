/* ===========================================================================
   Minimálny markdown pre odpovede modelu.

   Prečo vlastných 120 riadkov a nie balík: výstup modelu je NEDÔVERYHODNÝ vstup
   a jediné bezpečné poradie je „escapuj všetko, potom povoľ menovaný zoznam".
   Marked/markdown-it robia opak (parsujú a povoľujú HTML), takže by sa do toku
   dostal `<img onerror=…>` z uzla, ktorý si model prečítal z pamäte. Navyše by
   to bol build step, ktorý tento projekt nemá.

   Povolené je presne: ```plot```, `inline`, **tučné**, *kurzíva*, odrážky
   (aj VNORENÉ), číslované zoznamy, nadpisy a odkazy s http(s)/relatívnou
   schémou. Všetko ostatné zostáva textom.

   Vnorené zoznamy pribudli 25. 8. 2026 a je to jediná funkcia, ktorú do tohto
   renderera priniesla vlna vizuálov — pretože je to jediná, ktorú meranie
   naozaj našlo: odsadená odrážka je v **3 z 36** (8,3 %) reálnych odpovedí
   modelu, teda častejšie než ktorákoľvek vizuálna funkcia z celého auditu
   (oplotený blok kódu 0/36, diagram 0/36, tabuľka 0/36). Dovtedy `^\s{0,3}`
   spracovalo odsadenú odrážku ako plochú položku a hierarchia odpovede sa
   v UI stratila. Zmena je ADITÍVNA — plochý zoznam vyzerá presne ako predtým —
   ale mení VŠETKY TRI plochy naraz: plnú konzolu, dok Charóna nad grafom aj
   `/chat`. To je zámer tohto modulu, nie vedľajší účinok.

   Zdieľaný modul (public/js/shared/) — plnú konzolu aj dok Charóna nad grafom
   obsluhuje TEN ISTÝ renderer. NEUNIFIKOVAŤ s public/js/mind/md.js (`mdToHtml`)
   ani s `mdToHtml` v public/js/mind/util.js: sú to iné úlohy (dokument uzla,
   náhľad v 300 px paneli) a zlúčenie troch rendererov je samostatná úloha.
   Modul NIČ neimportuje, takže nie je súčasťou žiadneho cyklu.
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
    /* ZÁSOBNÍK otvorených zoznamov, nie jedna premenná — a to je celý rozdiel
       medzi plochým a vnoreným zoznamom. Každý prvok je `{ tag, indent, items }`
       a `indent` je počet medzier, ktorými riadok začínal. */
    const lists = [];
    let para = [];

    /**
     * Zavrie všetky zoznamy hlbšie než `toIndent`. Bez argumentu zavrie všetky.
     *
     * Hotový vnorený zoznam sa pripája DOVNÚTRA poslednej položky rodiča, nie za
     * ňu: `<ul><li>a<ul>…</ul></li></ul>`. Za položkou by to bol súrodenec a
     * prehliadač by ho odsadil rovnako, takže by hierarchia opäť zmizla —
     * a zoznam by mal navyše `<ul>` priamo v `<ul>`, čo je neplatné HTML.
     */
    function closeLists(toIndent = -1) {
        while (lists.length > 0 && lists[lists.length - 1].indent > toIndent) {
            const done = lists.pop();
            const html = `<${done.tag}>${done.items.map((i) => `<li>${i}</li>`).join('')}</${done.tag}>`;
            const parent = lists[lists.length - 1];

            if (parent) parent.items[parent.items.length - 1] += html;
            else out.push(html);
        }
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
            closeLists();
            closePara();
            out.push(codeBlock(blocks[Number(fence[1])]));
            continue;
        }

        if (line.trim() === '') {
            closeLists();
            closePara();
            continue;
        }

        const head = line.match(/^(#{1,6})\s+(.*)$/);

        if (head) {
            closeLists();
            closePara();
            // h3/h4 a nie h1/h2: h1 je titulok vlákna, h2 patrí prázdnemu stavu —
            // odpoveď modelu nesmie prepísať štruktúru dokumentu pod sebou.
            out.push(`<h${head[1].length <= 2 ? 3 : 4}>${inline(head[2])}</h${head[1].length <= 2 ? 3 : 4}>`);
            continue;
        }

        /* Jeden vzor pre odrážku aj číslovanú položku: rozhoduje o tom istom
           (otvoriť/zavrieť/vnoriť) a dva vzory sa pri vnorení rozišli.
           Odsadenie už NIE JE zhora ohraničené na 3 medzery — práve to robilo
           z odsadenej odrážky plochú položku. Odsadený blok kódu tento renderer
           zámerne nepozná (0 z 36 nameraných odpovedí ho malo), takže o žiadnu
           inú interpretáciu štyroch medzier tu nesúťažíme. */
        const item = line.match(/^([ \t]*)(?:([-*+])|\d+[.)])\s+(.*)$/);

        if (item) {
            // Tab sa počíta ako štyri medzery — inak by zoznam odsadený tabom
            // a zoznam odsadený medzerami skončili na rôznych úrovniach.
            const indent = item[1].replace(/\t/gu, '    ').length;
            const tag = item[2] ? 'ul' : 'ol';

            closePara();
            closeLists(indent);

            const top = lists[lists.length - 1];

            // Hlbšie odsadenie = nový vnorený zoznam. Zmena typu na TEJ ISTEJ
            // úrovni zavrie starý a otvorí nový (odrážky a čísla sú dva zoznamy,
            // nie jeden s dvoma tvarmi).
            if (!top || indent > top.indent) lists.push({ tag, indent, items: [] });
            else if (top.tag !== tag) {
                closeLists(indent - 1);
                lists.push({ tag, indent, items: [] });
            }

            lists[lists.length - 1].items.push(inline(item[3]));
            continue;
        }

        closeLists();
        para.push(inline(line));
    }

    closeLists();
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
