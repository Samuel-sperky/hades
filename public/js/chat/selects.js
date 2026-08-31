/* ===========================================================================
   Chat — NATÍVNE `<select>` DOSTÁVAJÚ NA ČO SA DÁ CHYTIŤ

   MERANIE, PRE KTORÉ TENTO SÚBOR EXISTUJE (31. 8. 2026, bežiaca `/chat`):
   97 natívnych ovládačov malo `appearance: auto`, `background: rgb(255,255,255)`
   — teda BIELE na tmavej téme —, `border-radius: 0` a `font-size: 13.3333px`,
   čo je default prehliadača, nie stupeň škály. Rozpis: 94× `select.ct-move-sel`
   (presun vlákna do projektu), `#chat-model`, `#chat-profile` a
   `textarea#chat-prompt`.

   ČO Z TOHO JE CSS A ČO NIE:
   Papier, rám, radius a veľkosť písma sú kresba a patria do `chat.css` — tento
   modul ich nepíše a nesmie napísať (žiadny inline štýl, žiadne CSS v JS).
   Čo kresba SAMA nedokáže, je ŠTRUKTÚRA:

     · `select { appearance: none }` zmaže natívnu striešku a `select::after`
       sa nevykreslí (nahradzované prvky pseudo-obsah nemajú). Striešku teda
       musí niesť SUSED, a ten musí niekde vzniknúť.
     · Nakresliť ju `background-image` s data-URI SVG znamená napísať farbu
       natvrdo do pravidla — to je raw hex mimo `:root` (zakázané) a hlavne
       farba, ktorá sa pri prepnutí témy nezmení.

   Preto obálka: `<span class="csel">` okolo `<select>` a v nej
   `<span class="csel-caret">` s ikonou zo sady. Ikona je inline SVG na
   `currentColor`, takže striešku farbí téma a nie kópia hodnoty.

   `<textarea id="chat-prompt">` obálku NEDOSTÁVA a nemá ju dostať: nemá čo
   rozbaľovať, takže mu chýba len kresba (`chat.css` má naň `.cc-row` a
   `#chat-prompt`, viď report).

   PREFIX `.csel-` je nový a je overený ako voľný: `cn-` už nesie karta podagenta
   v `render.js`, `cf-` prílohy, `cs-` strom podagentov, `cb-` vetvy, `cv-` hlas,
   `ct-` vlákna, `ca-` artefakt, `cp-` panely, `cc-` composer, `ch-` hlavička,
   `cm-` správu a `ce-` prázdny stav. Tri prefixy pre tri významy sú v tomto repe
   zaužívané; kolízia je to, čo nie je.

   Všetko sú HOISTOVANÉ `export function`.
   =========================================================================== */

import { iconSvg } from '../shared/icons.js';

/** Trieda obálky. Značka „už obliekané" je zároveň hák pre kresbu. */
const WRAP_CLASS = 'csel';

/**
 * Oblečie jeden `<select>` do obálky so strieškou.
 *
 * IDEMPOTENTNÉ a musí byť: `#chat-model` plní `bootModelSelect()` z `run.js`
 * asynchrónne a panel vlákien sa prekresľuje pri každej zmene, takže druhé
 * volanie nad tým istým prvkom je bežný stav, nie chyba. Bez stráže by vznikla
 * obálka v obálke a strieška dvakrát.
 *
 * `aria-hidden` na strieške je povinné: je to kresba stavu, ktorý čítačka
 * obrazovky pozná z `<select>` samotného, a bez toho by ohlásila navyše prvok
 * bez menovky.
 *
 * @param {HTMLSelectElement|null} select
 * @returns {HTMLElement|null} obálka, alebo `null` keď nebolo čo obliekať
 */
export function dressSelect(select) {
    if (!select) return null;

    const parent = select.parentElement;
    if (!parent) return null;
    if (parent.classList.contains(WRAP_CLASS)) return parent;

    const wrap = document.createElement('span');

    wrap.className = WRAP_CLASS;
    parent.insertBefore(wrap, select);
    wrap.append(select);

    const caret = document.createElement('span');

    caret.className = 'csel-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.append(iconSvg('arrow-down'));
    wrap.append(caret);

    return wrap;
}

/**
 * Oblečie každý `<select>` v podstrome, ktorý ešte obálku nemá.
 *
 * Panel vlákien si svoje `select`y stavia sám a volá `dressSelect()` priamo pri
 * stavaní — táto funkcia je pre statický markup z blade a pre prípady, keď sa
 * niekde objaví `<select>`, o ktorom tento modul nevie.
 *
 * @returns {number} koľko prvkov sa naozaj obliekalo (0 = všetko už bolo)
 */
export function dressSelectsIn(root) {
    const scope = root || document;
    let done = 0;

    scope.querySelectorAll('select').forEach((select) => {
        if (select.parentElement?.classList.contains(WRAP_CLASS)) return;
        if (dressSelect(select)) done++;
    });

    return done;
}

/**
 * Statické ovládače hlavičky.
 *
 * Volá sa z `boot()` a je idempotentné, takže sa dá zavolať aj po tom, čo
 * `bootModelSelect()` doplní `<option>`y — obliekanie je o obálke, nie o obsahu.
 *
 * @returns {number} koľko prvkov dostalo obálku
 */
export function bootSelects() {
    return dressSelectsIn(document.getElementById('chat-header'));
}
