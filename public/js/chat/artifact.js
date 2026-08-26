/* ===========================================================================
   Panel artefaktu, zvýraznené bloky kódu a kopírovanie.

   ČO JE V TEJTO APPKE ARTEFAKT — a je to nameraný nález, nie názor:
   **súbor zapísaný cez `write_file`**, nie blok kódu v odpovedi. Model v tejto
   appke nenapísal ani jeden oplotený blok (0 z 36 odpovedí), ale napísal
   2× 9,5 kB HTML report so `<style>` a `<table>` a jeden 1,8 kB markdown plán.
   Tretia reálna náplň panela je **náhľad pri bráne zápisov**: 7 kusov,
   priemer 442 B diffu. Panel preto kreslí presne tieto tri veci a nie diagramy
   (MERANIE-VIZUALY §1c, §5d).

   NÁHĽAD HTML JE `<iframe sandbox>`, NIKDY `innerHTML`. Je to výstup modelu,
   teda ten istý nedôveryhodný vstup, pre ktorý existuje `shared/markdown.js`.
   Dôvod každého jedného chýbajúceho flagu je pri `htmlFrame()` nižšie.
   SVG od modelu sa nevykresľuje vôbec — SVG smie v tejto appke zostaviť len náš
   vlastný kód (`sigilMark()`, značka v blade), nikdy nie parser cudzieho textu.

   MERMAID SA NEROBÍ. Dôvod, čísla a spúšťač na prehodnotenie sú v hlavičke
   `./highlight.js`, aby stáli tam, kde by grammar diagramu vznikla. Sem patrí
   len dôsledok: ```mermaid je obyčajný blok kódu s hlavičkou jazyka a Kopírovať.

   KOPÍROVANIE ŽIJE V `public/js/shared/copy.js` — jedna mechanika pre `/chat`
   aj pre konzolu, vrátane textov a 1 600 ms držania potvrdenia. Do 25. 8. 2026
   tu stála druhá kópia toho istého; presun sa dal urobiť až vo vlne, ktorá
   smela zapísať aj do `console/render.js`.
   Tomuto modulu zostali tri veci, ktoré sú naozaj jeho: `paintPre()` (zvýrazňovač
   má len `/chat`), `codeBlock()` (blok kódu bez markdownu, pre panel artefaktu)
   a naviazanie zdieľanej mechaniky na `announce()` tejto plochy.

   Exporty sú HOISTOVANÉ `export function` — modul je v cykle
   `main → run → render → artifact → main` a arrow v `const` v ňom padne na
   `ReferenceError: Cannot access 'foo' before initialization`.
   =========================================================================== */

import { renderMarkdown } from '../shared/markdown.js';
import { looksLikeDiff } from '../shared/gate.js';
import {
    codeHead,
    equipCode as sharedEquipCode,
    equipCopy as sharedEquipCopy,
} from '../shared/copy.js';
import { highlight, langFromPath, normalizeLang } from './highlight.js';
import { announce, artifactHost, openArtifact } from './main.js';
/* `el()` sa berie z `./render.js` a nie sa píše znova: je to tá istá funkcia
   (element s triedou a TEXTOM, nikdy `innerHTML`) a druhá kópia v tom istom
   adresári je presne to, čo audit 19. 8. 2026 našiel na šiestich miestach.
   Cyklus `render ↔ artifact` je tým reálny — preto sú tu všetky exporty
   hoistované a `el()` sa volá až vnútri funkcií, nikdy na vrchole modulu. */
import { el } from './render.js';

/* Poradové číslo panela — id záložiek musia byť v dokumente jedinečné, aby
   `aria-controls` a `aria-labelledby` ukazovali na to, čo naozaj myslia. */
let seq = 0;

/* ---------------------------------------------------------------------------
   DROBNÉ POMÔCKY
   --------------------------------------------------------------------------- */

/** Meno súboru z cesty. Oddeľovač môže byť oboje — cesty chodia z Windows aj z Dockera. */
export function fileName(path) {
    return String(path ?? '').split(/[\\/]/).pop() || '';
}

/**
 * Veľkosť v bajtoch, nie v znakoch.
 *
 * `TextEncoder` je tu podstatný: 9,5 kB report s diakritikou má viac bajtov než
 * znakov a číslo v hlavičke panela má hovoriť to, čo naozaj išlo na disk.
 * Desatinná čiarka, nie bodka — je to slovenské UI.
 */
export function sizeLabel(text) {
    const n = new TextEncoder().encode(String(text ?? '')).length;

    return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1).replace('.', ',')} kB`;
}

/* ---------------------------------------------------------------------------
   KOPÍROVANIE
   --------------------------------------------------------------------------- */

/* Zdieľaná mechanika naviazaná na TÚTO plochu. `shared/copy.js` nesmie vedieť
   o `chat/` ani o `console/` (bol by z toho cyklus medzi plochami), takže dve
   veci, ktoré sa medzi plochami líšia, mu tu podávame ako argument:
   `announce()` (táto plocha hlási do `#chat-announce`) a `paintPre` (zvýrazňovač
   má len `/chat`). Tie dve obálky nižšie sú presne toto naviazanie a nič viac —
   texty, časovanie ani markup tu už nie sú.

   `announce` sa podáva PRI VOLANÍ, nie pri načítaní modulu: modul je v cykle
   `main → run → render → artifact → main` a naviazanie na vrchole súboru by
   čítalo import v okamihu, keď `main.js` ešte nemusí byť vyhodnotený.

   TRETIA OBÁLKA TU BOLA A JE ZMAZANÁ (26. 8. 2026): `copyButton(name, read)`,
   ktorá zo zdieľanej funkcie dopĺňala jediný argument `announce`. Po presune
   mechaniky do `shared/copy.js` jej zostali dva volajúci — `codeHead()` a
   `equipCopy()` — a oba odišli do toho istého zdieľaného modulu, takže v repe
   nemala ani jedného. Nezostala tu ako „naviazaná plocha" (na rozdiel od
   `equipCopy()` nižšie, ktorá dopisuje CHÝBAJÚCE spečatenie bubliny a viaže aj
   zvýrazňovač): jednoargumentová obálka nie je naviazanie, ale synonymum, a dva
   exportované vstupy do jedného tlačidla sú presne tá dvojkoľajnosť, ktorou sa
   plochy tejto appky už raz rozišli. Budúci volajúci si vezme
   `copyButton(name, read, announce)` zo `shared/copy.js` priamo. */

/**
 * Hotová odpoveď dostane tlačidlá: jedno na celú odpoveď, jedno na každý blok.
 *
 * Volať AŽ na dopísanú bublinu a PRED jej vložením do toku: `#chat-stream` je
 * `aria-live` s `aria-relevant="additions"`, takže tlačidlo pridané do už
 * vloženej bubliny by čítačka ohlásila ako nový obsah odpovede.
 *
 * Tok `/chat` túto funkciu zatiaľ nevolá — `./render.js` bubliny nespečaťuje,
 * takže tlačidlá dnes dostávajú len bloky kódu v paneli artefaktu. Export tu
 * stojí ako naviazaná plocha pre chvíľu, kedy sa spečatenie dopíše; zapnúť ho
 * je zmena chovania `/chat`, teda vlastná úloha, nie vedľajší účinok presunu.
 */
export function equipCopy(box, read) {
    sharedEquipCopy(box, read, announce, paintPre);
}

/**
 * Každý blok kódu v `root` dostane hlavičku (jazyk + Kopírovať) a zvýraznenie.
 *
 * Zvýrazňovač sem chodí ako `paint`: `shared/copy.js` prečíta surový text bloku
 * PRED ním a drží ho v uzávere. Bez toho poradia by `diff` skončil v schránke
 * na jednom riadku — `diffHtml()` skládá riadky ako blokové `<span>` bez znakov
 * nového riadka, takže `pre.textContent` po zvýraznení nie je pôvodný text.
 */
export function equipCode(root) {
    sharedEquipCode(root, announce, paintPre);
}

/**
 * Zvýrazní jeden `<pre class="code">` na mieste.
 *
 * Číta SUROVÝ text z DOM (`textContent`, teda po dekódovaní entít) a nechá
 * `highlight()`, aby ho escapoval znova — poradie „escapuj, potom zvýrazni"
 * tak drží aj tu. Neznámy jazyk (```mermaid, ```yaml) sa nechá čistým textom.
 */
export function paintPre(pre, lang) {
    const code = pre?.querySelector('code') ?? pre;

    if (!code || normalizeLang(lang) === '') return;

    code.innerHTML = highlight(code.textContent ?? '', lang);
}

/** Hotový blok kódu z textu — pre panel artefaktu, kde markdown neprechádza. */
export function codeBlock(code, lang, label) {
    const text = String(code ?? '');
    const wrap = el('div', 'code-wrap');
    const pre = el('pre', 'code');
    const inner = el('code');

    // `highlight()` escapuje ako prvú vec, takže sem nevstúpi neescapovaný text
    // ani pre neznámy jazyk. Je to jediná cesta, ktorou má kód od modelu ísť.
    inner.innerHTML = highlight(text, lang);
    if (lang) pre.dataset.lang = lang;
    pre.append(inner);
    wrap.append(codeHead(lang, () => text, announce, label), pre);

    return wrap;
}

/* ---------------------------------------------------------------------------
   PANEL ARTEFAKTU
   --------------------------------------------------------------------------- */

/** Ktoré prípony majú náhľad. Zvyšok je zdroj, a je to úplná odpoveď, nie diera. */
function previewKind(path) {
    const lang = String(path ?? '').toLowerCase().match(/\.([a-z\d]+)$/)?.[1] ?? '';

    if (lang === 'html' || lang === 'htm') return 'html';
    if (lang === 'md' || lang === 'markdown') return 'md';

    return '';
}

/**
 * Náhľad HTML od modelu v úplne odstrihnutom iframe.
 *
 * `sandbox=""` (prázdny, teda VŠETKY obmedzenia) je tu bezpečnostná hranica,
 * nie opatrnosť. Čo každý NEDANÝ flag drží:
 *   · `allow-scripts` — bez neho sa nespustí ani jeden `<script>`, ani
 *     `onerror=`, ani `onload=`. Toto HTML nikto nečítal; je to výstup modelu,
 *     ktorý si predtým čítal súbory projektu aj pamäť.
 *   · `allow-same-origin` — dokument dostane JEDINEČNÝ nepriehľadný origin,
 *     takže nemá prístup k našim cookies, `localStorage` ani k `/api/*` so
 *     session. `allow-scripts` + `allow-same-origin` naraz by bola plná XSS na
 *     našom origine, preto nie je ani jedno.
 *   · `allow-forms` — `<form action="https://…">` by pri jednom kliknutí odniesol
 *     obsah polí von.
 *   · `allow-popups`, `allow-top-navigation` — náhľad nemá odviesť človeka
 *     z appky ani otvárať okná.
 *   · `allow-modals`, `allow-pointer-lock`, `allow-downloads` — bez skriptov sa
 *     nemajú ako spustiť, ale vymenované sú, aby sa flag nedopísal „veď to nič".
 *
 * ČO SANDBOX NEDRŽÍ a treba to vedieť: `<img src="https://…">` alebo
 * `@import` sa načíta, takže dokument môže poslať jeden request von (sledovací
 * pixel). `referrerpolicy="no-referrer"` mu k tomu aspoň nedá URL Hadesa.
 * Zablokovať to úplne by chcelo CSP hlavičku, ktorú `srcdoc` nemá odkiaľ dostať
 * — vlastné `<meta>` by sa muselo vlepiť do CUDZIEHO dokumentu, čo je krehké
 * a pri chybe by vyzeralo ako obrana, ktorá tam nie je. Toto je pomenovaná
 * hranica, nie zabudnutá.
 *
 * Atribúty sa nastavujú PRED vložením do dokumentu — dokument v `srcdoc` sa
 * načítava po vložení a `sandbox` dopísaný po ňom by prišiel neskoro.
 */
function htmlFrame(text, path) {
    const frame = el('iframe', 'ca-frame');

    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('title', `Náhľad ${fileName(path) || 'HTML'}`);
    frame.srcdoc = String(text ?? '');

    return frame;
}

/** Náhľad markdownu — cez ten istý `renderMarkdown`, ktorý escapuje tok správ. */
function mdPane(text) {
    const box = el('div', 'ca-md md');

    box.innerHTML = renderMarkdown(String(text ?? ''));
    equipCode(box);

    return box;
}

/** Riadok s cestou, veľkosťou a stiahnutím. Cesta je TEXT, nikdy HTML. */
function metaRow(path, text) {
    const row = el('div', 'ca-meta');

    row.append(el('span', 'ca-path', path || '—'));
    if (text !== undefined) row.append(el('span', 'ca-size', sizeLabel(text)));
    if (text !== undefined) row.append(downloadButton(path, text));

    return row;
}

/**
 * Stiahnutie artefaktu.
 *
 * MIME je vždy `text/plain`, aj pri HTML: s `text/html` by prehliadač mohol
 * súbor otvoriť namiesto uloženia a náhľad by sa tým dostal MIMO sandboxu, teda
 * na náš origin. Atribút `download` je druhá polovica tej istej poistky.
 */
function downloadButton(path, text) {
    const name = fileName(path) || 'artefakt.txt';
    const btn = el('button', 'ca-dl ghost', 'Stiahnuť');

    btn.type = 'button';
    btn.setAttribute('aria-label', `Stiahnuť ${name}`);
    btn.title = `Stiahnuť ${name}`;

    btn.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([String(text ?? '')], { type: 'text/plain;charset=utf-8' }));
        const link = el('a');

        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
        // Odvolanie až po odchode zo zásobníka — Safari inak stiahne prázdno.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        announce(`Súbor ${name} sa ukládá.`);
    });

    return btn;
}

/**
 * Záložky Náhľad / Zdroj.
 *
 * Vzor `tablist` a nie dve tlačidlá: sú to dva pohľady na JEDEN artefakt, nie
 * dve akcie. Roving `tabindex` (aktívna 0, ostatné -1) so šípkami je súčasťou
 * toho vzoru — bez neho by klávesnica prechádzala záložky Tabom a `role="tab"`
 * by bol sľub v ARIA atribúte.
 *
 * @param {Array<{label: string, build: () => Node}>} items
 */
function tabs(items) {
    const box = el('div', 'ca-tabs-box');
    const list = el('div', 'ca-tabs');
    const n = ++seq;
    const btns = [];
    const panes = [];

    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Zobrazenie artefaktu');

    items.forEach((item, i) => {
        const tab = el('button', 'ca-tab', item.label);
        const pane = el('div', 'ca-pane');

        tab.type = 'button';
        tab.id = `ca-tab-${n}-${i}`;
        tab.setAttribute('role', 'tab');
        pane.id = `ca-pane-${n}-${i}`;
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', tab.id);
        // Panel sám fokusovateľný: keď v ňom nie je nič fokusovateľné (náhľad
        // markdownu), inak by sa jeho obsah klávesnicou nedal doskrolovať.
        pane.tabIndex = 0;
        tab.setAttribute('aria-controls', pane.id);
        pane.append(item.build());

        list.append(tab);
        btns.push(tab);
        panes.push(pane);
    });

    function select(i, focus = false) {
        btns.forEach((tab, j) => {
            const on = j === i;

            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            tab.tabIndex = on ? 0 : -1;
            panes[j].hidden = !on;
        });
        if (focus) btns[i].focus();
    }

    list.addEventListener('click', (e) => {
        const i = btns.indexOf(e.target.closest('.ca-tab'));

        if (i >= 0) select(i);
    });

    list.addEventListener('keydown', (e) => {
        const at = btns.indexOf(document.activeElement);

        if (at < 0) return;

        const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        let next;

        if (step !== undefined) next = (at + step + btns.length) % btns.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = btns.length - 1;
        else return;

        e.preventDefault();
        select(next, true);
    });

    select(0);
    box.append(list, ...panes);

    return box;
}

/** Vysvetľujúca veta v paneli — napríklad prečo sa SVG nekreslí. */
function note(text) {
    return el('p', 'ca-note', text);
}

/**
 * Súbor, ktorý model zapísal (`write_file`), do panela.
 *
 * Titulok panela je MENO súboru, nie celá cesta: hlavička je úzka a cesta v nej
 * skončí výpustkou. Celá cesta stojí v riadku pod ňou, kde sa dá prečítať.
 */
export function showFile(path, content) {
    const body = openArtifact(fileName(path) || 'Artefakt');

    if (!body) return null;

    const text = String(content ?? '');
    const lang = langFromPath(path);
    const kind = previewKind(path);
    const art = el('div', 'ca-art');

    art.append(metaRow(path, text));

    const source = () => codeBlock(text, lang, `Kopírovať zdroj (${fileName(path) || 'artefakt'})`);

    if (kind === 'html') {
        art.append(tabs([
            { label: 'Náhľad', build: () => htmlFrame(text, path) },
            { label: 'Zdroj', build: source },
        ]));
    } else if (kind === 'md') {
        art.append(tabs([
            { label: 'Náhľad', build: () => mdPane(text) },
            { label: 'Zdroj', build: source },
        ]));
    } else {
        art.append(source());
        // SVG od modelu sa NEVYKRESĽUJE. Nie je to opomenutie: `<svg>` nesie
        // `<script>` aj `onload` a v našom dokumente by to bol spustený kód, kým
        // v iframe by to bol náhľad, ktorý nikto nežiadal (0 z 36 odpovedí).
        if (/\.svg$/i.test(String(path ?? ''))) {
            art.append(note('SVG sa tu zámerne nevykresľuje — zobrazený je zdroj. '
                + 'Obrázok skládá len vlastný kód appky, nikdy text od modelu.'));
        }
    }

    body.replaceChildren(art);
    announce(`Artefakt ${fileName(path)} je v paneli.`);

    return art;
}

/**
 * Náhľad zápisu pri bráne (diff, priemerne 442 B).
 *
 * Farby riadkov nesie `diffHtml()` zo `shared/gate.js` — tá istá jediná
 * implementácia, akou farbí diff karta potvrdenia. Panel je tu druhé MIESTO,
 * nie druhá pravda: pri dlhom diffe je karta v toku úzka a hlavičky súborov sa
 * v nej stratia.
 */
export function showDiff(path, diff) {
    const body = openArtifact(fileName(path) ? `Zmena ${fileName(path)}` : 'Zmena');

    if (!body) return null;

    const text = String(diff ?? '');
    const art = el('div', 'ca-art');

    art.append(metaRow(path, text));
    art.append(codeBlock(text, 'diff', 'Kopírovať diff'));
    body.replaceChildren(art);
    announce(`Náhľad zmeny ${fileName(path)} je v paneli.`);

    return art;
}

/** Blok kódu do panela (výsledok `read_file`, ```blok z odpovede). */
export function showCode(title, code, lang) {
    const body = openArtifact(title || 'Kód');

    if (!body) return null;

    const text = String(code ?? '');
    const art = el('div', 'ca-art');

    art.append(metaRow(title || '', text));
    art.append(codeBlock(text, lang, 'Kopírovať kód'));
    body.replaceChildren(art);

    return art;
}

/** Panel vyprázdni. Nezatvára ho — zatvorenie je gesto človeka, nie behu. */
export function clearArtifact() {
    artifactHost()?.replaceChildren();
}

/**
 * Volanie nástroja → panel, ak z neho artefakt naozaj je.
 *
 * Poradie je nameraná realita, nie hierarchia dôležitosti: `write_file` nesie
 * celý obsah v argumentoch (2× 9,5 kB HTML, 1,8 kB md), kým `edit_file` nesie
 * len diff v náhľade. Čítacie nástroje panel NEOTVÁRAJÚ — panel by sa otvoril
 * pri každom `grep`e a zjedol tretinu šírky.
 *
 * @returns {boolean} nakreslil sa artefakt?
 */
export function artifactFromTool(call) {
    const name = String(call?.name ?? '').toLowerCase();
    const args = call?.arguments ?? {};
    const path = String(args.path ?? args.file ?? '');
    const preview = String(call?.preview ?? '');

    if (/(write|create)/.test(name) && typeof args.content === 'string') {
        showFile(path, args.content);

        return true;
    }

    if (preview !== '' && /(edit|patch|write|apply)/.test(name)) {
        if (looksLikeDiff(preview)) showDiff(path, preview);
        else showCode(fileName(path) || 'Náhľad zmeny', preview, langFromPath(path));

        return true;
    }

    return false;
}

/**
 * Jediná niť medzi behom a panelom.
 *
 * Beh (`run.js`, `render.js`) nemá do panela kresliť sám — pošle udalosť a
 * nevie, čo sa z nej stane. Je to ten istý vzor, akým kostra hlási `chat:*`:
 * plocha ohlási zámer, vykonávateľ je jeden a je tu.
 *
 * `chat:artifact` s `detail`:
 *   · `{ tool }` — celé volanie nástroja (rozhodne `artifactFromTool()`),
 *   · `{ path, content }` — zapísaný súbor,
 *   · `{ path, diff }` — náhľad pri bráne,
 *   · `{ title, code, lang }` — blok kódu.
 */
export function wireArtifact() {
    document.addEventListener('chat:artifact', (e) => {
        const d = e.detail || {};

        if (d.tool) artifactFromTool(d.tool);
        else if (typeof d.diff === 'string') showDiff(d.path, d.diff);
        else if (typeof d.content === 'string') showFile(d.path, d.content);
        else if (typeof d.code === 'string') showCode(d.title, d.code, d.lang);
    });
}
