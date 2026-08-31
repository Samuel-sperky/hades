/* ===========================================================================
   Chat — SLOVNÍK PRÁZDNYCH STAVOV

   Jedno meno pre prázdny stav v celej appke. Kresba je `.empty` a jej
   modifikátory v `public/css/mind.css` (blok „EMPTY STATE", ~2769) a **mind.css
   sa na `/chat` načítava prvý** (zmerané 31. 8. 2026: 844 pravidiel z mind.css
   proti 97 z chat.css, `.empty` pochádza z mind.css). Tento modul preto žiadnu
   kresbu neprináša a ŽIADNU nesmie priniesť — skládá len markup, ktorý tá kresba
   už pozná.

   PREČO DRUHÁ IMPLEMENTÁCIA MARKUPU A NIE IMPORT:
   `mind/util.js` má `emptyHtml()` / `renderError()` / `renderFilterEmpty()`, ale
   na svojom vrchole importuje `anim.js`, `edges.js`, `filters.js`, `render.js`,
   `sim.js`, `state.js` a `theme.js` — teda celý graf. Jeden import odtiaľ by na
   `/chat` stiahol plátno, force simuláciu aj d3 (`mind/urlstate.js` je zámerne
   bez importov práve preto). Tá istá úvaha ako `el()` v `render.js`: chat je iná
   plocha a nemá dôvod načítať moduly grafu, aby vedel vyrobiť `<p>`.

   Dôsledok, ktorý treba poznať: TRIEDY sú kontrakt, tento súbor je len jeden
   z dvoch jeho čitateľov. Keď sa slovník zmení, mení sa `mind/util.js` **aj**
   tento modul — a keby `mind/util.js` niekedy prešiel do `public/js/shared/`,
   tento modul sa má zmazať, nie prepísať.

   ROZDIEL PROTI `mind/util.js`: tam sa skládá STRING (`innerHTML`), tu ELEMENT.
   Panel vlákien sa kreslí `replaceChildren()` z fragmentov, takže reťazec by sa
   musel obaliť len preto, aby sa hneď rozparsoval — a `esc()` by bol tretia kópia
   escapovania na ploche, ktorá už dvakrát zaplatila za `innerHTML` nad textom
   modelu. Element nesie text cez `textContent`, teda escapovanie nepotrebuje.

   ŠTYRI ROLE, NIČ MEDZI NIMI (manuál §8, rozhodnutia 14 a 16):

     `.empty`           dáta neexistujú (ešte). Učí: čo to je · prečo je prázdne.
     `.empty--error`    PLOCHA sa nenačítala. Nesie PREDMET a JEDNU akciu.
     `.empty--filter`   dáta existujú, filter/hľadanie ich skrylo. Jedna akcia:
                        zruš to zúženie. Vlastnú kresbu ZÁMERNE nemá — líši sa
                        textom a akciou, nie farbou (manuál §8).
     `.empty--hero`     prázdna PLOCHA so zoznamom schopností.

   `.empty--hero` tu ZÁMERNE NIE JE a nie je to opomenutie. Jediná hero plocha
   `/chat` je statický `#chat-empty` v `resources/views/chat.blade.php`, ktorý
   kreslia ID pravidlá `#chat-empty` / `#chat-empty h2` / `#chat-empty p`
   v `chat.css` (1-0-0, teda nad každým `.empty--hero`). Pridať mu tie triedy
   z JS by ho prepnulo z `display: block` na flex a `align-items: flex-start`
   z `--hero` by rozhodilo znak — kým sa tie ID pravidlá neuvoľnia, je to
   regresia, nie parita. Presun je zapísaný v reporte ako potreba CSS.
   Prázdny `heroBlock()` by tu bol mŕtvy kód, čo je presne to, čo si táto plocha
   25. 8. 2026 zaplatila siedmimi nenačítanými modulmi.

   V CHYBE JE SERIF ZAKÁZANÝ (manuál §8) a drží to `.empty .title` v mind.css
   (`font-family: var(--font)`). Tento modul preto nesmie chybe nikdy dopísať
   `.hero-val` ani `.screen-head` — to sú dve role, ktoré serif majú.

   Všetko sú HOISTOVANÉ `export function`: graf modulov chatu je cyklický
   (`empty → render → main`) a `export const foo = () => {}` v cykle spadne na
   `ReferenceError: Cannot access 'foo' before initialization`.
   =========================================================================== */

import { el } from './render.js';
import { iconSvg } from '../shared/icons.js';

/* Hint chyby je JEDEN reťazec a je tu, nie u volajúceho. Jedenásť chybových
   ciest na ploche grafu si vetu skládalo samo a rozišli sa — dôvod, prečo
   `mind/util.js` má `ERROR_HINT` konstantu, platí aj tu. */
const ERROR_HINT = 'Server neodpovedá — skús to znova.';

/**
 * Jedna akcia stavu. `.empty-act` je jediné tlačidlo, ktoré prázdny stav smie
 * mať — a keď `on` nie je funkcia, NEVYKRESLÍ SA. Mŕtve „Skúsiť znova" je
 * horšie než žiadne (ten istý dôvod ako `errorHtml()` bez akcie v `mind/util.js`).
 *
 * @param {{label: string, on: Function}|null} action
 * @returns {HTMLButtonElement|null}
 */
export function emptyAction(action) {
    if (!action || typeof action.on !== 'function') return null;

    const btn = el('button', 'empty-act', action.label || 'Skúsiť znova');

    btn.type = 'button';
    btn.addEventListener('click', action.on);

    return btn;
}

/**
 * Základ. Volá sa cez `emptyBlock` / `errorBlock` / `filterBlock`, priamo len
 * keď potrebuješ modifikátor, ktorý tie tri nepokrývajú.
 *
 * `title` je PREDMET stavu a ide do `.empty .title` (Geist, `--text`); `text` je
 * konstatovanie a `hint` je „čo s tým" o stupeň tichšie. Poradie v DOM je
 * ikona → titulok → text → hint → akcia, presne ako v `mind/util.js`, aby
 * čítačka obrazovky na oboch plochách čítala tú istú vetu v tom istom poradí.
 *
 * @param {{mod?: string, icon: string, title?: string, text?: string,
 *          hint?: string, action?: object}} spec
 * @returns {HTMLElement}
 */
export function emptyState(spec) {
    const box = el('div', spec.mod ? `empty ${spec.mod}` : 'empty');

    box.append(iconSvg(spec.icon || 'ring'));
    if (spec.title) box.append(el('p', 'title', spec.title));
    if (spec.text) box.append(el('p', null, spec.text));
    if (spec.hint) box.append(el('p', 'hint', spec.hint));

    const act = emptyAction(spec.action);
    if (act) box.append(act);

    return box;
}

/**
 * Dáta neexistujú. Ikona je vec, ktorá chýba — nie univerzálna „prázdna"
 * značka: `box` pre projekty, `send` pre vlákna, `magnifier` pre hľadanie.
 *
 * @param {string} icon  meno zo sady `public/js/shared/icons.js`
 */
export function emptyBlock(icon, text, hint, action) {
    return emptyState({ icon, text, hint, action });
}

/**
 * PLOCHA sa nenačítala.
 *
 * Vetu skládá HELPER, nie volajúci: `subject` je predmet v 4. páde a bez slova
 * „nepodarilo" („vlákna", „projekty", „históriu", „vlákno"), helper z neho
 * vyrobí „Vlákna sa nepodarilo načítať". Presne ten istý tvar ako
 * `errorMarkup()` v `mind/util.js` — keby si vetu skládal každý volajúci, na
 * tejto ploche vznikne to isté, čo na grafe: dve cesty, ktoré nepovedia ani
 * predmet.
 *
 * Ikona `cloud-off` je GRAFIKA s prahom 3:1 (`.empty--error .ic` jej v mind.css
 * dáva plný `--danger` a `opacity: 1`); text ide vždy cez `--text` / `--muted`.
 *
 * @param {string} subject  predmet v 4. páde, bez „nepodarilo"
 * @param {Function|null} retry  keď nie je funkcia, tlačidlo sa nevykreslí
 */
export function errorBlock(subject, retry, hint) {
    const s = String(subject || '').trim();
    const title = `${s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Obsah'} sa nepodarilo načítať`;

    return emptyState({
        mod: 'empty--error',
        icon: 'cloud-off',
        title,
        hint: hint || ERROR_HINT,
        action: typeof retry === 'function' ? { label: 'Skúsiť znova', on: retry } : null,
    });
}

/**
 * Dáta existujú, zúženie ich skrylo.
 *
 * `label` je nepovinný, pretože „zruš hľadanie" a „zruš filter" sú pre človeka
 * dve rôzne veci a príčinu pozná volajúci, nie helper.
 *
 * Akcia sa smie ponúknuť LEN keď to zúženie naozaj existuje a naozaj skrýva
 * dáta — tlačidlo, ktoré nič nezruší, je horšie než žiadne.
 */
export function filterBlock(text, hint, clear, label) {
    return emptyState({
        mod: 'empty--filter',
        icon: 'filter-off',
        text,
        hint,
        action: typeof clear === 'function' ? { label: label || 'Zruš zúženie', on: clear } : null,
    });
}

/** Vloží stav do kontejnera namiesto jeho obsahu. */
export function renderState(container, node) {
    if (!container || !node) return null;

    container.replaceChildren(node);

    return node;
}
