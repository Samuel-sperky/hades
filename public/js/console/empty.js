/* ===========================================================================
   Charón — SLOVNÍK PRÁZDNYCH STAVOV A CHÝB (parita s `/`).

   Prečo tento súbor vôbec je: konzola mala do 31. 8. 2026 na prázdno a chybu
   TRI vlastné slovníky (`.rail-empty`, `.rail-error` + `.rail-retry`, a holý
   `.rail-msg` pri prázdnom hľadaní), pričom `mind.css` — jediný stylesheet,
   ktorý sa načítava na `/`, `/console` aj `/chat` — nesie od 28. 8. 2026
   spoločný komponent `.empty` s modifikátormi `.empty--error` a `.empty--filter`
   a s JEDNOU akciou `.empty-act`. Príkaz manuálu (§8) je „chyba pomenuje
   PREDMET", a to je presne to, čo tri vety konzoly nerobili: „Zoznam vlákien sa
   nepodarilo načítať" tu bola jediná z nich.

   ŽIADNA NOVÁ KRESBA. Každá trieda použitá nižšie už v `mind.css` existuje
   (`.empty`, `.empty .ic`, `.empty .title`, `.empty .hint`, `.empty--error .ic`,
   `.empty .empty-act`). `.empty--filter` je ZÁMERNE bez vlastnej kresby — je to
   značka stavu, nie druhá farba (viď komentár pri nej v `mind.css`), takže sa
   od základu líši textom a svojou jednou akciou.

   Vetu SKLÁDA HELPER, nie volajúci — ten istý dôvod ako v `mind/util.js`:
   jedenásť chybových ciest na `/` si vetu skládalo samo a rozišli sa. `subject`
   je predmet v 4. páde bez slova „nepodarilo": „zoznam vlákien", „behy".

   DOM, nie reťazec HTML: konzola stavia obsah cez `el()` (`textContent`, nikdy
   `innerHTML`), pretože do prázdneho stavu tu tečie aj text, ktorý napísal
   človek (dopyt v hľadaní) a raz aj text od modelu. `emptyHtml()` z grafu sa
   sem preto nedá požičať — vracia string a escapuje si sám.
   =========================================================================== */

import { el } from './dom.js';
import { iconSvg } from '../shared/icons.js';

/* Druhý riadok chyby. Jedna veta pre všetky call-site — keď sa raz zmení dôvod,
   mení sa na jednom mieste. Tá istá veta ako `ERROR_HINT` v `mind/util.js`. */
const ERROR_HINT = 'Server neodpovedá — skús to znova.';

/**
 * Prázdny stav. `spec`:
 *   icon    meno zo sady (`shared/icons.js`) — kresba, nie text
 *   title   PREDMET stavu; vykreslí sa ako `.title` (Geist, --fs-title)
 *   text    konštatovanie (`.empty p`)
 *   hint    druhý riadok „čo s tým" (`.empty .hint`)
 *   action  { label, on } — JEDNA akcia; viac ich komponent nemá
 *   mod     doplnkový modifikátor: 'error' | 'filter'
 *
 * Poradie prvkov je dané kresbou v `mind.css` (ikona → titulok → text → hint →
 * akcia) a nie je voliteľné: `.empty` je flex kolóna, takže poradie v DOM je
 * poradie na obrazovke.
 */
export function emptyBox(spec) {
    const s = spec || {};
    const box = el('div', 'empty' + (s.mod === 'error' ? ' empty--error' : '')
        + (s.mod === 'filter' ? ' empty--filter' : ''));

    if (s.icon) {
        const mark = iconSvg(s.icon);
        // Ikona je kresba, nie obsah — čítačka ju hlásiť nemá, vetu nesie text pod ňou.
        if (mark) { mark.setAttribute('aria-hidden', 'true'); box.append(mark); }
    }

    if (s.title) box.append(el('p', 'title', s.title));
    if (s.text) box.append(el('p', null, s.text));
    if (s.hint) box.append(el('p', 'hint', s.hint));

    if (s.action?.label && typeof s.action.on === 'function') {
        const act = el('button', 'empty-act', s.action.label);
        act.type = 'button';
        act.addEventListener('click', s.action.on);
        box.append(act);
    }

    return box;
}

/**
 * Chyba plochy. `subject` je predmet v 4. páde („zoznam vlákien"), z ktorého sa
 * skládá veta „Zoznam vlákien sa nepodarilo načítať".
 *
 * `retry` je funkcia, typicky tá istá, v ktorej fetch spadol; MUSÍ čítať stav
 * z modulu, nie z DOM — DOM, ktorý ju vyvolal, práve zmizol. Bez `retry` sa
 * tlačidlo nevykreslí: mŕtve „Skúsiť znova" je horšie než žiadne.
 *
 * Ikona je vždy `cloud-off` a je to grafika s prahom 3:1 (`.empty--error .ic`
 * jej dáva plný `--danger`), nie text — text chyby ide cez `--text` / `--muted`.
 */
export function errorBox(subject, retry, hint) {
    const s = String(subject || '').trim();
    const title = (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Obsah') + ' sa nepodarilo načítať';

    return emptyBox({
        mod: 'error',
        icon: 'cloud-off',
        title,
        hint: hint || ERROR_HINT,
        action: typeof retry === 'function' ? { label: 'Skúsiť znova', on: retry } : null,
    });
}
