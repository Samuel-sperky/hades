/* ===========================================================================
   Charón — ČÍTACÍ REŽIM odpovede modelu.

   Čo to je: odpoveď, ktorá sa dá čítať ako dokument — jedna miera (72ch), 16 px
   sadzba, prokládka 1,7 —, nie ako replika v toku. `/` to má od 28. 8. 2026 pre
   dokument uzla (`#md-overlay` / `#md-card` / `.md-body` v `mind.css`) a je to
   presne ten istý problém: odpoveď Charóna má na širokom okne riadok cez celý
   `--stream-w` a v bubline sadzbu chrómu (14 px / 1,45), takže dlhá odpoveď
   sa v nej nečíta, iba prezerá.

   DRUHÁ KRESBA TU NEVZNIKÁ — a je to overené, nie predpokladané: `mind.css` sa
   na `/console` načítava PRVÝ (`console.blade.php` má dva `<link>`y, mind.css
   pred console.css), takže `#md-overlay`, `#md-card`, `.dock-head`, `.md-body`,
   `#md-foot`, `.close`, `.ghost` aj `.primary` sú tu k dispozícii bez jedného
   riadka CSS. Markup skladá JS, pretože `console.blade.php` tento agent
   nevlastní; ID sú ZÁMERNE tie isté ako v `mind.blade.php` (kresba visí na
   `#md-overlay` a `#md-card`, nie na triedach) a kolízia nevzniká — markup grafu
   na tejto ploche neexistuje.

   PREKLAD TRIED je nutný a je to jediné miesto, kde sa dve plochy naozaj líšia:
   čítačka v `mind.css` kreslí nadpisy ako `.md-body h3.md-h` a zoznamy ako
   `.md-body .md-list`, pretože na `/` ich skládá `mind/md.js` (`mdToHtml`).
   Konzola ide cez `shared/markdown.js`, ktorý emituje HOLÉ `<h3>`/`<h4>`/`<ul>`
   — a ten modul je zdieľaný s `/chat`, takže sa v ňom trieda pridať nedá bez
   zmeny oboch ostatných plôch. Preklad preto robí `dressForReading()` NAD KÓPIOU
   vykresleného HTML. Blok kódu preklad NEPOTREBUJE: `pre.code` má v `mind.css`
   vlastné pravidlo bez prefixu plochy.
   =========================================================================== */

import { $, el } from './dom.js';
import { renderMarkdown } from '../shared/markdown.js';
import { copyButton, equipCode } from '../shared/copy.js';
import { iconSvg } from '../shared/icons.js';
import { emptyBox } from './empty.js';
import { announce } from './render.js';

/* Kam sa vráti fokus po zavretí. Ten istý dôvod ako v palete grafu: čítačku
   otvára tlačidlo v riadku mena konkrétnej odpovede a vrátiť fokus na <body>
   znamená, že Tab po zavretí začne od začiatku dokumentu. */
let readerReturnFocus = null;

/* Overlay sa stavia RAZ a potom sa len skrýva. Prekresľovať ho pri každom
   otvorení by znamenalo, že `#md-close` je pri každom otvorení iný prvok —
   a `readerReturnFocus` by ukazoval na uzol, ktorý už nie je v dokumente. */
let overlay = null;

export function readerOpen() {
    return !!overlay && !overlay.classList.contains('hidden');
}

function buildOverlay() {
    if (overlay) return overlay;

    overlay = el('div', 'hidden');
    overlay.id = 'md-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'md-title');

    const card = el('div');
    card.id = 'md-card';

    const head = el('div', 'dock-head');
    const title = el('h2');
    title.id = 'md-title';
    const close = el('button', 'close');
    close.id = 'md-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Zavrieť');
    const x = iconSvg('x');
    if (x) { x.setAttribute('aria-hidden', 'true'); close.append(x); }
    close.addEventListener('click', closeReader);
    head.append(title, close);

    const body = el('div', 'md-body');
    body.id = 'md-body';
    // Čítačka je plocha na ČÍTANIE, takže si berie fokus aj bez tlačidla —
    // inak sa dlhá odpoveď nedá skrolovať klávesnicou.
    body.tabIndex = 0;

    const foot = el('div');
    foot.id = 'md-foot';

    card.append(head, body, foot);
    overlay.append(card);

    // Klik na scrim zatvára, klik do karty nie. Ten istý vzor ako paleta grafu.
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeReader(); });

    document.body.append(overlay);

    return overlay;
}

/**
 * Preklad tried pre čítačku. Beží nad UŽ VYKRESLENÝM a escapovaným HTML
 * (`renderMarkdown` escapuje ako prvé), takže tu sa nič nedôveryhodné neparsuje
 * — mení sa len `class` na existujúcich prvkoch.
 *
 * `h3` → `.md-h` dostane rodinu, váhu a tracking titulku prózy; `h4` tú istú
 * kresbu bez veľkostného stupňa, presne ako `####` na `/`.
 */
function dressForReading(root) {
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => h.classList.add('md-h'));
    root.querySelectorAll('ul, ol').forEach((l) => l.classList.add('md-list'));
    /* `.md-hr` sa tu NEPREKLADÁ, a nie je to opomenutie: `shared/markdown.js`
       vodorovnú linku nepozná vôbec (`---` mu vyjde ako odstavec — zmerané),
       takže pravidlo pre ňu by bolo kód, ktorý predstiera, že niečo obsluhuje.

       Nadpisy sú v čítačke konzoly VŠETKY na jednom stupni (16 px, váha 660):
       `shared/markdown.js` mapuje `#`/`##` na `h3` a `###`+ na `h4` — zámerne,
       aby odpoveď modelu neprepísala štruktúru dokumentu pod sebou —, takže
       `.md-body h1.md-h` / `h2.md-h` (dva vyššie stupne) tu nemá čo trafiť.
       Rovnaké to je na `/` pri `###`. Zmeniť to znamená zmeniť zdieľaný renderer,
       teda aj `/chat` a dok nad grafom; to nie je zmena čítacieho režimu. */
}

/**
 * Otvorí odpoveď v čítacom režime.
 *
 * `raw` je SUROVÝ markdown odpovede — ten istý reťazec, ktorý ide do schránky.
 * Čítačka ho vykreslí znova a nie `cloneNode` bubliny: bublina má v sebe už
 * hlavičky blokov kódu z `equipCode()`, takže by sa naklonovali aj tlačidlá
 * a kopírovali by cez `read()`, ktorý patrí inému prvku.
 */
export function openReader(title, raw) {
    const box = buildOverlay();
    const text = String(raw ?? '');

    $('#md-title', box).textContent = title || 'Odpoveď Charóna';

    const body = $('#md-body', box);
    body.innerHTML = '';

    if (text.trim() === '') {
        // Prázdna odpoveď je stav plochy, nie chyba behu — preto slovník
        // prázdnych stavov a jedna akcia, nie chybová bublina.
        body.append(emptyBox({
            icon: 'file-text',
            title: 'Odpoveď je prázdna',
            hint: 'Ťah skončil bez textu — v toku je nad ním karta nástroja, ktorý bežal.',
            action: { label: 'Zavrieť', on: closeReader },
        }));
    } else {
        const doc = el('div');
        doc.innerHTML = renderMarkdown(text);
        dressForReading(doc);
        // Bloky kódu dostanú tú istú hlavičku ako v toku — mechanika je jedna
        // (`shared/copy.js`), takže sa tu nekopíruje nič, len sa volá.
        equipCode(doc, announce);
        // Deti idú do `.md-body` PRIAMO: miera 72ch visí na `.md-body > *`,
        // takže obal by ju zobral na seba a próza vnútri by tiekla naplno.
        body.append(...doc.childNodes);
    }

    const foot = $('#md-foot', box);
    foot.innerHTML = '';

    if (text.trim() !== '') {
        const copy = copyButton('Kopírovať odpoveď', () => text, announce);
        /* `copyButton()` vydáva `copy-btn ghost`. V pätičke ostáva `.ghost`
           (papier tlačidla) a `.copy-btn` sa ODOBERÁ: tá trieda nesie mikro
           sadzbu riadka mena (24 px, --fs-micro), čo je v pätičke karty
           tlačidlo, na ktoré sa nedá kliknúť prstom. */
        copy.classList.remove('copy-btn');
        foot.append(copy);
    }

    readerReturnFocus = document.activeElement;
    box.classList.remove('hidden');
    $('#md-close', box).focus();
    announce('Čítací režim je otvorený.');
}

export function closeReader() {
    if (!overlay) return;

    overlay.classList.add('hidden');

    const back = readerReturnFocus;
    readerReturnFocus = null;

    // <body> nie je „kam sa vrátiť": tlačidlo, ktoré čítačku otvorilo, môže byť
    // po prekreslení bubliny odpojené, a vtedy je fokus na composeri to jediné
    // rozumné miesto — človek pokračuje písaním.
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
    else $('#prompt')?.focus();
}

/**
 * Tlačidlo „Čítať" v riadku mena odpovede.
 *
 * Kresbu nesie `.copy-btn` — v `mind.css` je to JEDINÁ kresba „malé tlačidlo
 * v riadku mena" a jej komentár to hovorí výslovne („ďalšia varianta tlačidla tu
 * nevzniká"). Meno tej triedy o akcii lže, preto nesie prvok aj rolovú triedu
 * `.read-btn`, ktorá dnes žiadnu kresbu NEMÁ (ten istý vzor ako `.empty--filter`
 * — značka stavu bez vlastnej farby). Keď sa selektor v `mind.css` rozšíri na
 * `:is(.copy-btn, .read-btn)`, `.copy-btn` odtiaľto odíde.
 *
 * Pridáva sa AŽ PO `equipCopy()` zo `shared/copy.js`: ten sa proti dvojitému
 * nasadeniu chráni práve prítomnosťou `.copy-btn` v riadku mena, takže tlačidlo
 * vložené pred ním by kopírovanie ticho zrušilo.
 */
export function equipReader(box, read) {
    const who = box?.querySelector('.who');

    if (!who || who.querySelector('.read-btn')) return;

    const btn = el('button', 'copy-btn read-btn', 'Čítať');
    btn.type = 'button';
    btn.title = 'Otvoriť odpoveď v čítacom režime';
    btn.addEventListener('click', () => {
        const model = who.querySelector('.who-model')?.textContent || '';

        openReader(model ? `Odpoveď · ${model}` : 'Odpoveď Charóna', read?.());
    });

    who.append(btn);
}

/** Esc a klávesová obsluha čítačky. Volá sa raz z `main.js`. */
export function wireReader() {
    /* Listener je v CAPTURE fáze na dokumente, a to je podmienka, nie štýl:
       globálne Esc v `run.js` visí na dokumente v bublinovej fáze a ZASTAVUJE
       BEH. Keby čítačka čakala, kým k nej Esc dobubluje, zavrela by sa a zároveň
       by zabila rozbehnutý ťah — teda jedno stlačenie s dvoma následkami, z toho
       jeden nevratný (text, ktorý model ešte nevydal, už nepríde). */
    document.addEventListener('keydown', (event) => {
        if (!readerOpen()) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeReader();
        }
    }, true);
}
