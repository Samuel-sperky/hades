/* ===========================================================================
   Zvýrazňovanie kódu — deväť vlastných tabuliek, žiadna knižnica.

   ROZHODLO MERANIE (`docs/sprint-2026-08-25/MERANIE-VIZUALY.md` §2b, §4a, §5b),
   nie preferencia:
   · highlight.js 11.12.0 NEMÁ ESM ani browser build — `lib/core.js` končí
     `module.exports`, `es/core.js` sú štyri riadky Node obalu nad tým istým CJS
     a v balíku nie je ani jeden `.min.js`. Bez bundlera (kontrakt §4) sa
     self-hostovať nedá inak než forkom 74 kB cudzieho kódu.
   · shiki 4.4.3 je ESM, ale každý dist entry importuje bare `@shikijs/*`: import
     map s 8+ mapovaniami, `onig.wasm` 456 kB (155 kB gzip), balík jazykov
     8,65 MB / 725 súborov. Je navrhnutý pre bundler.
   · táto tabuľka: 1,8 kB gzip a 0,006 ms na typický blok, proti 0,206 ms
     a ~60 kB gzip highlight.js. Pri ~8 tok/s rozhoduje tá gzip tridsaťtrojka,
     nie čas.

   PORADIE JE OBRANA, NIE ŠTÝL. `highlight()` escapuje PRVÉ a až do escapovaného
   textu vkladá `<span class="t-*">`. Preto je verejná funkcia jedna a berie
   SUROVÝ text: „zvýrazni už escapovaný text" sa nedá zavolať v zlom poradí, keď
   taká funkcia neexistuje. Obrátené poradie by zhodilo celú obranu
   `shared/markdown.js` („escapuj všetko, potom povoľ menovaný zoznam") a
   prepustilo `<img onerror=…>` z uzla, ktorý si model prečítal z pamäte.

   Gramatík je DEVÄŤ (php, js, ts, python, sql, sh, css, json, html); `diff` je
   desiaty jazyk, ale tabuľku nemá — kreslí ho `diffHtml()` zo `shared/gate.js`,
   teda tá istá jediná implementácia, akou brána zápisov farbí náhľad diffu.
   Druhé farbenie diffu by bola druhá pravda o tom, čo je pridaný riadok.

   MERMAID SA NEROBÍ a je to nameraný záver, nie lenivosť: **0 z 36** reálnych
   odpovedí modelu obsahovalo oplotený blok (a 0 z 37 správ človeka o diagram
   žiadalo), kým samotné načítanie mermaidu stojí **195 kB gzip / 19 súborov**
   (s flowchartom a dagre 261 kB / 29 súborov s hashovanými menami, ktoré sa pri
   každom `npm update` zmenia). ```mermaid preto zostáva blokom kódu s hlavičkou
   jazyka a tlačidlom Kopírovať — gramatiku tu nemá, takže `normalizeLang()`
   vráti `''` a blok sa vykreslí ako čistý escapovaný text. Nie je to regresia,
   je to zachovanie stavu, ktorý nikomu nechýbal.

   SPÚŠŤAČ NA PREHODNOTENIE, aby to nebolo „nikdy" zo zvyku: keď sa ```mermaid
   objaví v **≥ 5 % odpovedí asistenta** (dnes 0 %), postaví sa vlastný renderer
   podmnožiny `flowchart TD/LR` — nameraný prototyp 2,0 kB gzip / 98 riadkov,
   1 793 B SVG za 0,008 ms — a nie mermaid. Dotaz, ktorým sa tá frekvencia
   overí, je v MERANIE-VIZUALY §6.

   Modul importuje len dva leafy zo `shared/` (žiadny cyklus), ale exporty sú aj
   tak HOISTOVANÉ `export function` — graf modulov chatu cyklus má a arrow
   v `const` v ňom padá na `ReferenceError`.
   =========================================================================== */

import { escapeHtml } from '../shared/markdown.js';
import { diffHtml } from '../shared/gate.js';

/* Nad týmto počtom znakov sa nezvýrazňuje. Nie je to o čase — 44 kB CSS stojí
   0,19 ms, takže aj 200 kB je pol milisekundy. Je to o tom, že najväčší reálny
   vstup, aký sa v tejto appke nameral, je 58,8 kB (výsledok `read_file` nad
   `McpController.php`), a čokoľvek rádovo vyššie je náhodou alebo binárkou —
   tam je čistý text lepší než tisíce spanov v strome. */
const MAX_CHARS = 200000;

/* ---------------------------------------------------------------------------
   STAVEBNÉ KAMENE

   POZOR: všetky vzory bežia nad UŽ ESCAPOVANÝM textom, takže `"` je `&quot;`,
   `<` je `&lt;` a `>` je `&gt;`. Vzor `/"[^"]*"/` by na escapovanom vstupe
   nenašiel ani jeden reťazec — to je najčastejšia chyba pri úprave tohto súboru.
   `'` a `&#39;` sa nescapujú (`escapeHtml` apostrof nerieši), takže jednoduchý
   reťazec je stále `'…'`.

   Žiadny vzor nesmie mať ZACHYTÁVAJÚCU skupinu: `paint()` mapuje index skupiny
   na triedu, takže jedna `(…)` vnútri by posunula všetky triedy o jednu.
   Vždy `(?:…)`.

   Reťazce zámerne nesmú prejsť koniec riadka (`[^\\\n]`): nezavretý apostrof
   v kóde je bežný a bez tej hranice by zožral celý zvyšok súboru. Ceny je, že
   nezavretý reťazec sa nezvýrazní vôbec — čo je lepšie než zvýrazniť všetko.
   --------------------------------------------------------------------------- */

const S_DQ = /&quot;(?:\\[\s\S]|(?!&quot;)[^\\\n])*(?:&quot;|$)/;
const S_SQ = /'(?:\\[\s\S]|[^'\\\n])*(?:'|$)/;
/* Šablónový literál JE viacriadkový, tam je hranica riadka nesprávna. */
const S_TPL = /`(?:\\[\s\S]|[^`\\])*(?:`|$)/;
const S_PY3D = /&quot;&quot;&quot;[\s\S]*?(?:&quot;&quot;&quot;|$)/;
const S_PY3S = /'''[\s\S]*?(?:'''|$)/;

const C_LINE = /\/\/[^\n]*/;
const C_HASH = /#[^\n]*/;
const C_SQL = /--[^\n]*/;
/* Bez príznaku `m`, a to je podmienka: s ním by `$` znamenalo koniec RIADKA a
   lenivé `[\s\S]*?` by každý blokový komentár zrezalo na prvom riadku. */
const C_BLOCK = /\/\*[\s\S]*?(?:\*\/|$)/;
const C_HTML = /&lt;!--[\s\S]*?(?:--&gt;|$)/;

const NUM = /\b(?:0x[\dA-Fa-f]+|\d+(?:\.\d+)?)\b/;
const V_PHP = /\$\w+/;
const V_SH = /\$(?:\{\w+\}|\w+)/;
const V_PY = /@\w+/;
/* Identifikátor v spätných apostrofoch (`nodes`.`id`) — na rozdiel od šablóny
   v JS nesmie prejsť riadok, inak by nepárny apostrof zožral zvyšok dotazu. */
const ID_SQL = /`[^`\n]*`/;

/* Kľúčové slová. Zoznamy sú zámerne krátke — pokrývajú jazyky, ktoré §1c
   MERANIA nameral ako reálnu prácu tejto appky (`html`, `css`, `md`, `php`,
   `js`), nie 386 jazykov highlight.js. */
const KW_PHP = /\b(?:abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|do|echo|else(?:if)?|empty|enum|extends|final|finally|fn|for(?:each)?|function|global|if|implements|include(?:_once)?|instanceof|interface|isset|list|match|namespace|new|or|print|private|protected|public|readonly|require(?:_once)?|return|static|switch|throw|trait|try|unset|use|var|while|yield|true|false|null|self|parent|this)\b/;
const KW_JS = /\b(?:async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|true|false|null|undefined|NaN)\b/;
const KW_TS = /\b(?:abstract|any|as|asserts|bigint|boolean|declare|enum|implements|infer|interface|is|keyof|namespace|never|number|object|private|protected|public|readonly|satisfies|string|symbol|type|unknown)\b/;
const KW_PY = /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None|self)\b/;
const KW_SQL = /\b(?:select|from|where|insert|into|values|update|set|delete|create|alter|drop|truncate|table|index|view|join|inner|left|right|outer|cross|on|as|and|or|not|null|is|in|like|between|group|order|by|having|limit|offset|distinct|union|all|primary|foreign|key|references|unique|default|auto_increment|collate|case|when|then|else|end|exists|asc|desc|with|using|count|sum|avg|min|max|begin|commit|rollback|engine|charset|int|bigint|varchar|text|json|datetime|timestamp|decimal|boolean)\b/;
const KW_SH = /\b(?:if|then|elif|else|fi|for|in|do|done|while|until|case|esac|function|return|break|continue|export|local|readonly|source|shift|exit|set|unset|echo|printf|read|cd|trap)\b/;
const KW_JSON = /\b(?:true|false|null)\b/;

/* CSS. Vlastnosť sa pozná podľa toho, že za ňou je dvojbodka a pred ňou hranica
   deklarácie — preto sa `[;{\n]` konzumuje do spanu. Bez tej hranice by sa
   `div:hover` čítalo ako vlastnosť `div`; s ňou to platí len pre selektor, ktorý
   začína holým slovom na začiatku riadka, čo je pomenovaná diera, nie prekvapenie. */
const CSS_AT = /@[-\w]+/;
const CSS_VAR = /--[-\w]+/;
const CSS_PROP = /[;{\n][ \t]*[-a-z]{2,}(?=[ \t]*:)/;
const CSS_BANG = /!important\b/;
const CSS_HEX = /#[\dA-Fa-f]{3,8}\b/;
const CSS_NUM = /\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|fr|s|ms|deg|ch)?\b/;

/* HTML. Meno tagu nesie triedu kľúčového slova a atribút triedu premennej —
   dve role, ktoré už v palete existujú, namiesto dvoch nových farieb. Grammar
   nevie o JS vnútri `<script>`; je to pomenovaná diera. */
const HTML_TAG = /&lt;\/?[a-z][\w:-]*|&lt;!doctype/;
const HTML_ATTR = /[-\w:]+(?=\s*=)/;

/* ---------------------------------------------------------------------------
   TABUĽKY

   Poradie pravidiel rozhoduje LEN pri rovnakej počiatočnej pozícii (regex ide
   zľava doprava), preto komentáre a reťazce stoja prvé: `// nie je kľúčové slovo`
   aj `'const'` sa tým vyriešia samy.

   `i: true` má gramatika jazyka, ktorý je NAOZAJ case-insensitive. Pri SQL je to
   oprava nameranej chyby prototypu: bez príznaku sa `SELECT id FROM nodes`
   nezvýraznilo (kým `select` áno), teda presne ten tvar, akým sa SQL v tomto
   projekte píše. PHP je case-insensitive v kľúčových slovách takisto, HTML
   v menách tagov a CSS v menách vlastností.
   --------------------------------------------------------------------------- */
const GRAMMARS = {
    php: { i: true, r: [['c', C_BLOCK], ['c', C_LINE], ['c', C_HASH], ['s', S_DQ], ['s', S_SQ], ['v', V_PHP], ['k', KW_PHP], ['n', NUM]] },
    js: { i: false, r: [['c', C_BLOCK], ['c', C_LINE], ['s', S_TPL], ['s', S_DQ], ['s', S_SQ], ['k', KW_JS], ['n', NUM]] },
    ts: { i: false, r: [['c', C_BLOCK], ['c', C_LINE], ['s', S_TPL], ['s', S_DQ], ['s', S_SQ], ['k', KW_JS], ['k', KW_TS], ['n', NUM]] },
    python: { i: false, r: [['s', S_PY3D], ['s', S_PY3S], ['c', C_HASH], ['s', S_DQ], ['s', S_SQ], ['v', V_PY], ['k', KW_PY], ['n', NUM]] },
    sql: { i: true, r: [['c', C_SQL], ['c', C_BLOCK], ['s', S_SQ], ['s', S_DQ], ['v', ID_SQL], ['k', KW_SQL], ['n', NUM]] },
    sh: { i: false, r: [['c', C_HASH], ['s', S_DQ], ['s', S_SQ], ['v', V_SH], ['k', KW_SH], ['n', NUM]] },
    css: { i: true, r: [['c', C_BLOCK], ['s', S_DQ], ['s', S_SQ], ['k', CSS_AT], ['v', CSS_VAR], ['v', CSS_PROP], ['k', CSS_BANG], ['n', CSS_HEX], ['n', CSS_NUM]] },
    json: { i: false, r: [['v', /&quot;(?:\\[\s\S]|(?!&quot;)[^\\\n])*&quot;(?=\s*:)/], ['s', S_DQ], ['k', KW_JSON], ['n', /-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b/]] },
    html: { i: true, r: [['c', C_HTML], ['k', HTML_TAG], ['v', HTML_ATTR], ['s', S_DQ], ['s', S_SQ]] },
};

/* Aliasy — mená, ktorými model a prípony súborov ten istý jazyk naozaj volajú.
   `svg`, `blade` a `vue` idú na html ZÁMERNE: je to len zobrazenie zdroja ako
   textu, nie vykreslenie (SVG od modelu sa nikdy nevykresľuje — viď artifact.js). */
const ALIAS = {
    javascript: 'js', mjs: 'js', cjs: 'js', jsx: 'js', node: 'js',
    typescript: 'ts', tsx: 'ts',
    py: 'python', python3: 'python',
    bash: 'sh', shell: 'sh', zsh: 'sh',
    mysql: 'sql', mariadb: 'sql',
    jsonc: 'json',
    htm: 'html', xml: 'html', svg: 'html', blade: 'html', vue: 'html',
    scss: 'css', less: 'css',
    patch: 'diff',
};

/* Skompilovaný regex na jazyk. Lenivo: v jednej odpovedi bývajú jeden-dva
   jazyky, kompilovať všetkých deväť pri načítaní modulu by bola práca za nič. */
const CACHE = new Map();

/**
 * Kanonické meno gramatiky, alebo `''` keď ju nemáme.
 *
 * `''` je platná odpoveď a znamená „vykresli ako čistý text" — presne to sa deje
 * s ```mermaid, ```yaml aj ```markdown.
 */
export function normalizeLang(lang) {
    const key = String(lang ?? '').trim().toLowerCase();
    const name = ALIAS[key] ?? key;

    return name === 'diff' || Object.hasOwn(GRAMMARS, name) ? name : '';
}

/** Jazyk podľa prípony cesty. `path` je cesta k súboru, nie meno jazyka. */
export function langFromPath(path) {
    return normalizeLang(String(path ?? '').toLowerCase().match(/\.([a-z\d]+)$/)?.[1] ?? '');
}

/**
 * SUROVÝ kód → bezpečné HTML.
 *
 * Escapuje ako PRVÚ vec a až potom vkladá `<span class="t-*">`. Preto sa dá
 * volať aj na neznámy jazyk (vráti len escapovaný text) a preto je to jediná
 * cesta, ktorou má kód od modelu vstúpiť do DOM.
 *
 * `diff` je zvláštny prípad: farbí ho `diffHtml()` zo `shared/gate.js`, ktorý
 * escapuje sám a vydá riadky ako `<span class="dl df-…">`. Obal `.diff` je tu
 * povinný — bez neho CSS pravidlá (`.diff .dl`) nemajú na čo sadnúť.
 */
export function highlight(code, lang) {
    const raw = String(code ?? '');
    const name = normalizeLang(lang);

    if (name === 'diff') return `<span class="diff">${diffHtml(raw)}</span>`;

    const escaped = escapeHtml(raw);

    return name === '' || raw.length > MAX_CHARS ? escaped : paint(escaped, name);
}

function compiled(name) {
    if (!CACHE.has(name)) {
        const g = GRAMMARS[name];

        CACHE.set(name, new RegExp(g.r.map(([, re]) => `(${re.source})`).join('|'), g.i ? 'gi' : 'g'));
    }

    return CACHE.get(name);
}

/* Jeden prechod jedným zloženým regexom. Jeden prechod je tu podstatný, nie
   optimalizácia: pri viacerých prechodoch by druhý videl už vložené `<span
   class="t-k">` a farbil by atribúty vlastného výstupu. */
function paint(escaped, name) {
    const rules = GRAMMARS[name].r;

    return escaped.replace(compiled(name), (whole, ...rest) => {
        // `rest` má na konci offset a celý vstup — zaujímajú nás len skupiny.
        const hit = rest.slice(0, rules.length).findIndex((v) => v !== undefined);

        return hit < 0 ? whole : `<span class="t-${rules[hit][0]}">${whole}</span>`;
    });
}
