// Vlastná sada inline SVG ikon — jeden modul pre všetky tri plochy (/, /console, /chat).
//
// PREČO vlastná sada a prečo celá naraz (rozhodnutie 19+21, manuál §7):
// kým je v hre font Material Symbols, každá NEprekreslená ikona sa vykreslí ako svoj
// ligatúrový názov („terminal" 144 px namiesto 18 px). Zmiešaná sada by teda nebola
// „polovica hotová", ale plocha, na ktorej sa striedajú kresby s textom. Preto sada
// vydáva všetkých 60 symbolov v jednom kroku.
//
// PREČO je modul v shared/: kresbu potrebujú tri plochy a druhá kópia by sa rozišla.
// Modul NEIMPORTUJE nič — ani z mind/, ani z chat/ — takže jeho načítanie nestiahne graf.
// Žiadny bundler, žiadna CDN: sú to čisté ES moduly, presne ako zvyšok public/js.
//
// PREČO hoistované `export function`: v tomto grafe sú cyklické importy nevyhnutné
// (render ↔ panels ↔ controls) a `export const foo = () => {}` nie je hoistovaná —
// pri cykle padne na „ReferenceError: Cannot access 'foo' before initialization".
// `export const ICONS` je DÁTO, nie funkcia; navyše tento modul nič neimportuje, takže
// je vždy plne vyhodnotený skôr, než sa rozbehne telo hocijakého importéra.

// PREČO tu NIE JE stupnica veľkostí: veľkosť ikony nesie `font-size` z KONTEXTOVÉHO
// selektora (`.toast .ic { font-size: var(--icon-sm) }` a ďalších ~26 pravidiel), pretože
// kresba má `width/height` v `em`. Do 31. 8. 2026 tu stálo `ICON_SIZES` + vetva
// `opts.size → ' ic--' + stupeň`: žiadny stylesheet triedu `.ic--*` nedefinoval a ani
// jedno z 39 volaní ju neposielalo, takže to bol mechanizmus, ktorý existoval len v tomto
// komentári. Odstránené, nie doimplementované — druhý spôsob, ako nastaviť tú istú vec,
// by len rozdelil pravdu o veľkosti medzi CSS a volajúceho. Kto potrebuje inú veľkosť,
// napíše kontextové pravidlo s tokenom `--icon-*`; rozmer napísaný do JS je pre CSSOM
// neviditeľný a žiadna asercia ho nenájde — presne tak vznikol inline `font-size: 10px`
// na osi grafu.

// Základné atribúty kresby (manuál §7 „Kresba vlastnej sady"). `width`/`height` sú v `em`,
// aby veľkosť nesol `font-size` z CSS — presne ako doteraz `.ms`, takže 26
// per-komponentných prepisov veľkosti prežije prechod bez zmeny.
const SVG_ATTRS = 'viewBox="0 0 24 24" width="1em" height="1em" fill="none" '
  + 'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

// ── Zdieľané fragmenty ──────────────────────────────────────────────────────────
// Kompozícia namiesto novej geometrie je ZÁVÄZNÁ (manuál §7) — inak sada prestane
// vyzerať ako sada. Tieto fragmenty sú tá kompozícia zapísaná raz.

// Prečiarknutie: celá uhlopriečka pre `cloud-off` a `eye-off` (báza je široká),
// krátke preškrtnutie len cez telo pre `magnifier-off` a `filter-off`.
const SLASH_FULL = '<path d="M 4.4 4.4 L 19.6 19.6"/>';
// Plus badge vpravo dole — „k tomuto pridaj" (link-plus, library-plus).
const PLUS_BADGE = '<path d="M 15.4 18.6 h 5.2 M 18 16 v 5.2"/>';

// Báza `filter` sa kreslí, hoci sada symbol `filter` NEVYDÁVA: manuál §7 to žiada
// výslovne, aby budúci stav „filter zapnutý" nebol nová geometria. Pridať ho ako
// 61. symbol bez prepisu manuálu je zakázané, preto žije ako fragment.
const FILTER_BASE = '<path d="M 4.6 5.8 h 14.8 l -5.9 6.9 v 6.1 l -3 -1.7 v -4.4 Z"/>';
// Báza `magnifier` a `eye` — obe majú vypnutý dvojstav, takže telo musí byť to isté.
const MAGNIFIER_BASE = '<circle cx="10.4" cy="10.4" r="6.2"/><path d="M 14.9 14.9 L 20.3 20.3"/>';
const EYE_BASE = '<path d="M 3.1 12 c 2.1 -3.9 5.2 -6.2 8.9 -6.2 3.7 0 6.8 2.3 8.9 6.2'
  + ' -2.1 3.9 -5.2 6.2 -8.9 6.2 -3.7 0 -6.8 -2.3 -8.9 -6.2 Z"/><circle cx="12" cy="12" r="3"/>';
// Kruh ako kontejner pre check / výkričník / prázdny prstenec — jeden polomer pre všetky,
// inak by odznaky v jednom riadku (istota: overené / hypotéza / bez istoty) tancovali.
const CIRCLE_LG = '<circle cx="12" cy="12" r="8.75"/>';
// Telo zámku je pri `lock` a `lock-open` to isté; mení sa len spona (manuál §7 dvojstav).
const LOCK_BODY = '<path d="M 5.9 10.7 h 12.2 a 1.5 1.5 0 0 1 1.5 1.5 v 6.6 a 1.5 1.5 0 0 1'
  + ' -1.5 1.5 H 5.9 a 1.5 1.5 0 0 1 -1.5 -1.5 v -6.6 a 1.5 1.5 0 0 1 1.5 -1.5 Z"/>'
  + '<path d="M 12 14.2 v 2.4"/>';

// ── Geometria 60 symbolov ───────────────────────────────────────────────────────
// Mriežka 24 × 24, kresba v poli 20 × 20 (2 px vzduch po okrajoch), hrúbka 1,75,
// `round` konce a spoje, `fill: none`, `currentColor`.
//
// Sada je VÝHRADNE obrysová a v celom systéme je jediný plný prvok: jadro (`core`).
// Toto pravidlo viaže ikony na znak a na plátno — uzly na plátne sú priehľadné prstence,
// nie plné disky, a jadro vedomia je jediný sýty plný prvok.
//
// Kde je kresba jednoduchšia než Material tvar, je to ZÁMER: ikony sa kreslia pri
// 16–22 px a pri tej veľkosti sa detail zlieva. Menovite: `trash` nemá dve vnútorné
// linky (pri 18 px splynú s obrysom nádoby), `sliders` má dva riadky namiesto troch,
// `check-list` má jednu linku namiesto dvoch.
export const ICONS = {
  // ── A · Navigácia a chróm (11) ──
  // Slnko je kruh + 8 lúčov. Vedome NIE je to isté ako `core` (prstenec s plným stredom):
  // manuál §7 rozhodol, že dve slnká sa zlievajú na znak jadra a `brightness_7` prestáva
  // byť slnkom. `sun` tak nesie jednu vec — destináciu Dnes.
  sun: '<circle cx="12" cy="12" r="4.2"/>'
    + '<path d="M 12 3.7 v 2.1 M 12 18.2 v 2.1 M 3.7 12 h 2.1 M 18.2 12 h 2.1'
    + ' M 6.13 6.13 L 7.97 7.97 M 17.87 6.13 L 16.03 7.97'
    + ' M 6.13 17.87 L 7.97 16.03 M 17.87 17.87 L 16.03 16.03"/>',
  // Uzol so tromi satelitmi. Linky majú medzeru pred krúžkami, aby sa pri 18 px nezliali.
  hub: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.6" r="2.1"/>'
    + '<circle cx="5.2" cy="17" r="2.1"/><circle cx="18.8" cy="17" r="2.1"/>'
    + '<path d="M 12 9.4 V 6.7 M 10.1 13.7 L 6.9 15.8 M 13.9 13.7 L 17.1 15.8"/>',
  receipt: '<path d="M 6.4 3.4 h 11.2 v 17.2 l -2.8 -1.8 -2.8 1.8 -2.8 -1.8 -2.8 1.8 Z"/>'
    + '<path d="M 9.4 8 h 5.2 M 9.4 11.6 h 5.2"/>',
  gavel: '<path d="M 12.9 4.8 L 19.2 11.1 L 16.6 13.7 L 10.3 7.4 Z"/>'
    + '<path d="M 12.1 9.2 L 6.4 14.9"/><path d="M 3.4 20.4 h 9.2"/>',
  bolt: '<path d="M 13.6 3 L 6.9 13.3 H 11.2 L 10.1 21 L 17.1 10.4 H 12.7 Z"/>',
  book: '<path d="M 12 6.6 v 13"/>'
    + '<path d="M 4 5.4 c 2.7 -0.6 5.4 -0.2 8 1.2 2.6 -1.4 5.3 -1.8 8 -1.2 v 12'
    + ' c -2.7 -0.6 -5.4 -0.2 -8 1.2 -2.6 -1.4 -5.3 -1.8 -8 -1.2 Z"/>',
  'check-list': '<path d="M 5.5 4.5 h 13 a 1.5 1.5 0 0 1 1.5 1.5 v 13 a 1.5 1.5 0 0 1'
    + ' -1.5 1.5 h -13 A 1.5 1.5 0 0 1 4 19 V 6 a 1.5 1.5 0 0 1 1.5 -1.5 Z"/>'
    + '<path d="M 7.8 9.6 h 8.4"/><path d="M 7.8 14.6 l 2.2 2.2 4.2 -4.6"/>',
  clipboard: '<path d="M 9.4 4.6 H 7.6 A 1.6 1.6 0 0 0 6 6.2 V 18.9 A 1.6 1.6 0 0 0 7.6 20.5'
    + ' h 8.8 a 1.6 1.6 0 0 0 1.6 -1.6 V 6.2 a 1.6 1.6 0 0 0 -1.6 -1.6 h -1.8"/>'
    + '<path d="M 9.9 3.1 h 4.2 a 0.9 0.9 0 0 1 0.9 0.9 v 1.8 a 0.9 0.9 0 0 1 -0.9 0.9 H 9.9'
    + ' a 0.9 0.9 0 0 1 -0.9 -0.9 V 4 a 0.9 0.9 0 0 1 0.9 -0.9 Z"/>'
    + '<path d="M 9 11.2 h 6 M 9 15 h 4"/>',
  // Odoslať je JEDEN tvar pre všetky tri plochy (manuál §7 semantická mapa): dnes je to
  // `arrow_upward` na /chat a /console, ale `send` v doku — dva tvary pre jeden význam.
  send: '<path d="M 20.6 3.4 L 3.4 10.2 L 10.9 13.1 L 13.8 20.6 Z"/>'
    + '<path d="M 20.6 3.4 L 10.9 13.1"/>',
  question: CIRCLE_LG
    + '<path d="M 9.7 9.6 a 2.4 2.4 0 0 1 4.7 0.8 c -0.25 1.3 -2.4 1.6 -2.4 3.2"/>'
    + '<path d="M 12 17.3 h 0.01"/>',
  sliders: '<path d="M 4 8 h 4.4 M 12.6 8 h 7.4"/><circle cx="10.5" cy="8" r="2.1"/>'
    + '<path d="M 4 16 h 7.4 M 15.6 16 h 4.4"/><circle cx="13.5" cy="16" r="2.1"/>',

  // ── B · Graf a plátno (7) ──
  tree: '<path d="M 9 3.5 h 6 v 4.5 H 9 Z"/><path d="M 3.4 16 h 6 v 4.5 H 3.4 Z"/>'
    + '<path d="M 14.6 16 h 6 v 4.5 H 14.6 Z"/>'
    + '<path d="M 12 8 V 12.2"/><path d="M 6.4 16 V 12.2 H 17.6 V 16"/>',
  shapes: '<path d="M 12 3.4 L 15.6 9.4 H 8.4 Z"/><circle cx="7" cy="16.4" r="3.4"/>'
    + '<path d="M 14 13.4 h 6.6 v 6.6 H 14 Z"/>',
  layers: '<path d="M 12 3.4 L 20.6 8 L 12 12.6 L 3.4 8 Z"/>'
    + '<path d="M 3.4 12 L 12 16.6 L 20.6 12"/><path d="M 3.4 16 L 12 20.6 L 20.6 16"/>',
  focus: '<path d="M 4 9 V 6 A 2 2 0 0 1 6 4 H 9"/><path d="M 15 4 H 18 A 2 2 0 0 1 20 6 V 9"/>'
    + '<path d="M 20 15 V 18 A 2 2 0 0 1 18 20 H 15"/><path d="M 9 20 H 6 A 2 2 0 0 1 4 18 V 15"/>'
    + '<circle cx="12" cy="12" r="2.6"/>',
  plus: '<path d="M 12 4.6 v 14.8 M 4.6 12 h 14.8"/>',
  // Oddialiť je `plus` bez svislice — jeden význam, jedna kresba (manuál §7).
  minus: '<path d="M 4.6 12 h 14.8"/>',
  ellipsis: '<path d="M 6.2 12 h 0.01 M 12 12 h 0.01 M 17.8 12 h 0.01"/>',

  // ── C · Akcie nad obsahom (12) ──
  magnifier: MAGNIFIER_BASE,
  // Prečiarknutie ide len cez šošovku, nie cez celú ikonu: uhlopriečka by splynula
  // s rukoväťou, ktorá má ten istý smer.
  'magnifier-off': MAGNIFIER_BASE + '<path d="M 6 14.8 L 14.8 6"/>',
  'filter-off': FILTER_BASE + '<path d="M 6 18.4 L 18.4 6"/>',
  x: '<path d="M 6 6 L 18 18 M 18 6 L 6 18"/>',
  pencil: '<path d="M 16.9 3.9 a 2.3 2.3 0 0 1 3.2 3.2 L 8.4 18.8 L 3.9 20.1 L 5.2 15.6 Z"/>'
    + '<path d="M 15.4 5.4 L 18.6 8.6"/>',
  // Báza pre check-circle, check-double a shield-check — tie ju majú zmenšenú, nie inú.
  check: '<path d="M 4.8 12.6 L 9.6 17.4 L 19.2 6.6"/>',
  save: '<path d="M 5.9 4.4 h 9.5 l 4.2 4.2 v 9.9 a 1.5 1.5 0 0 1 -1.5 1.5 H 5.9'
    + ' a 1.5 1.5 0 0 1 -1.5 -1.5 V 5.9 a 1.5 1.5 0 0 1 1.5 -1.5 Z"/>'
    + '<path d="M 8.4 4.4 v 3.6 h 5.2 V 4.4"/><path d="M 8.4 20 v -3.8 h 7.2 V 20"/>',
  copy: '<path d="M 8.6 8.6 V 5.6 a 2 2 0 0 1 2 -2 h 6.8 a 2 2 0 0 1 2 2 v 6.8'
    + ' a 2 2 0 0 1 -2 2 h -3"/>'
    + '<path d="M 4.6 10.4 h 8 a 2 2 0 0 1 2 2 v 6.8 a 2 2 0 0 1 -2 2 h -8 a 2 2 0 0 1 -2 -2'
    + ' v -6.8 a 2 2 0 0 1 2 -2 Z"/>',
  trash: '<path d="M 4.6 7 h 14.8"/>'
    + '<path d="M 9.6 7 V 5 c 0 -0.6 0.4 -1 1 -1 h 2.8 c 0.6 0 1 0.4 1 1 v 2"/>'
    + '<path d="M 6.4 7 l 0.9 12.2 c 0.1 0.9 0.8 1.6 1.7 1.6 h 6 c 0.9 0 1.6 -0.7 1.7 -1.6'
    + ' L 17.6 7"/>',
  link: '<path d="M 13.6 10.4 a 4 4 0 0 1 0 5.7 l -2 2 a 4 4 0 0 1 -5.7 -5.7 l 1.4 -1.4"/>'
    + '<path d="M 10.4 13.6 a 4 4 0 0 1 0 -5.7 l 2 -2 a 4 4 0 0 1 5.7 5.7 l -1.4 1.4"/>',
  // Návrh nového spojenia = tá istá reťaz, zmenšená, plus badge. Nie druhý tvar reťaze.
  'link-plus': '<path d="M 12.2 9.6 a 3.4 3.4 0 0 1 0 4.8 l -1.7 1.7 a 3.4 3.4 0 0 1 -4.8 -4.8'
    + ' l 1.2 -1.2"/>'
    + '<path d="M 9.8 12.2 a 3.4 3.4 0 0 1 0 -4.8 l 1.7 -1.7 a 3.4 3.4 0 0 1 4.8 4.8'
    + ' l -1.2 1.2"/>' + PLUS_BADGE,
  // Najhustejšia ikona appky (12 instancií na jednom zobrazení), preto zámerne najjednoduchšia
  // možná kresba: stoh riadkov + plus badge.
  'library-plus': '<path d="M 4.2 6.6 h 12.6 M 4.2 11.2 h 12.6 M 4.2 15.8 h 7"/>' + PLUS_BADGE,

  // ── D · Stav a výsledok (10) ──
  'check-circle': CIRCLE_LG + '<path d="M 8.1 12.3 l 2.7 2.7 5.1 -5.5"/>',
  'check-double': '<path d="M 2.9 12.7 l 3.4 3.4 6.5 -7.3"/><path d="M 9.8 16.1 l 1.9 1.9 8.1 -9.1"/>',
  'shield-check': '<path d="M 12 3.4 L 19 6 v 5.4 c 0 4.2 -2.9 7.4 -7 9.2 -4.1 -1.8 -7 -5 -7 -9.2'
    + ' V 6 Z"/><path d="M 9 12.1 l 2.1 2.1 4 -4.4"/>',
  flask: '<path d="M 9.4 3.4 h 5.2"/>'
    + '<path d="M 10.2 3.4 v 5.7 L 5.7 17.6 c -0.6 1.2 0.2 2.6 1.6 2.6 h 9.4'
    + ' c 1.4 0 2.2 -1.4 1.6 -2.6 L 13.8 9.1 V 3.4"/><path d="M 7.7 14.6 h 8.6"/>',
  'alert-triangle': '<path d="M 10.6 4.9 c 0.6 -1.1 2.2 -1.1 2.8 0 l 7.3 13.1'
    + ' c 0.6 1.1 -0.2 2.4 -1.4 2.4 H 4.7 c -1.2 0 -2 -1.3 -1.4 -2.4 Z"/>'
    + '<path d="M 12 10 v 3.6"/><path d="M 12 17.2 h 0.01"/>',
  'alert-circle': CIRCLE_LG + '<path d="M 12 7.6 v 4.8"/><path d="M 12 16.3 h 0.01"/>',
  'cloud-off': '<path d="M 5.5 18.4 h 11 c 2.3 0 4.1 -1.8 4.1 -4.1 0 -2.2 -1.7 -4 -3.9 -4.1'
    + ' C 15.9 7.9 13.4 6.2 10.7 6.6 8 7 6 9.4 6 12.2 c 0 0.2 0 0.4 0 0.6'
    + ' C 4.3 13.2 3.2 14.7 3.4 16.3 3.6 17.5 4.4 18.4 5.5 18.4 Z"/>' + SLASH_FULL,
  clock: CIRCLE_LG + '<path d="M 12 7.3 V 12 l 3.4 2.1"/>',
  // Neutrálny prstenec. Je to aj kresba, ktorú vydá `iconSvg()` pri neznámom mene —
  // ticho prázdny prvok je zakázaný.
  ring: CIRCLE_LG,
  // „Preskočiť", nie „zopakovať": `redo` hovorila niečo iné než jej aria-label (manuál §7).
  skip: '<path d="M 6 6.4 L 14.2 12 L 6 17.6 Z"/><path d="M 17.8 6.4 v 11.2"/>',

  // ── E · Dáta a typy uzlov (9) ──
  doc: '<path d="M 6 3.6 h 12 a 1.5 1.5 0 0 1 1.5 1.5 v 13.8 a 1.5 1.5 0 0 1 -1.5 1.5 H 6'
    + ' a 1.5 1.5 0 0 1 -1.5 -1.5 V 5.1 A 1.5 1.5 0 0 1 6 3.6 Z"/>'
    + '<path d="M 8.2 8.6 h 7.6 M 8.2 12 h 7.6 M 8.2 15.4 h 4.8"/>',
  calendar: '<path d="M 4.6 6.6 h 14.8 a 1.5 1.5 0 0 1 1.5 1.5 v 10.8 a 1.5 1.5 0 0 1 -1.5 1.5'
    + ' H 4.6 a 1.5 1.5 0 0 1 -1.5 -1.5 V 8.1 a 1.5 1.5 0 0 1 1.5 -1.5 Z"/>'
    + '<path d="M 3.1 11.2 h 17.8"/><path d="M 8.4 3.8 v 4 M 15.6 3.8 v 4"/>',
  'file-text': '<path d="M 14 3.6 H 7 a 1.5 1.5 0 0 0 -1.5 1.5 v 13.8 A 1.5 1.5 0 0 0 7 20.4'
    + ' h 10 a 1.5 1.5 0 0 0 1.5 -1.5 V 8.1 Z"/><path d="M 14 3.6 V 8.1 h 4.5"/>'
    + '<path d="M 8.6 12.6 h 6.8 M 8.6 16 h 4.4"/>',
  list: '<path d="M 8 7 h 12 M 8 12 h 12 M 8 17 h 12"/>'
    + '<path d="M 4.2 7 h 0.01 M 4.2 12 h 0.01 M 4.2 17 h 0.01"/>',
  chip: '<path d="M 5.4 5.4 h 13.2 v 13.2 H 5.4 Z"/><path d="M 9.2 9.2 h 5.6 v 5.6 H 9.2 Z"/>'
    + '<path d="M 9.4 2.8 v 2.6 M 14.6 2.8 v 2.6 M 9.4 18.6 v 2.6 M 14.6 18.6 v 2.6'
    + ' M 2.8 9.4 h 2.6 M 2.8 14.6 h 2.6 M 18.6 9.4 h 2.6 M 18.6 14.6 h 2.6"/>',
  'head-gear': '<path d="M 13.9 20.6 v -2.2 c 0 -0.8 0.6 -1.4 1.4 -1.4 h 1.2'
    + ' c 0.7 0 1.2 -0.7 1 -1.4 l -0.8 -2.4 1.3 -0.8 c 0.5 -0.3 0.6 -1 0.2 -1.4 l -2 -2.6'
    + ' C 15.6 5.1 12.4 3.4 9.4 3.9 C 5.6 4.5 3 7.9 3.4 11.7 c 0.2 2 1.3 3.8 2.9 5'
    + ' 0.5 0.4 0.8 1 0.8 1.6 v 2.3"/><circle cx="11" cy="11" r="2.3"/>'
    + '<path d="M 11 7.6 v 1.1 M 11 13.3 v 1.1 M 7.6 11 h 1.1 M 13.3 11 h 1.1"/>',
  box: '<path d="M 3.6 8.4 h 16.8 v 10.2 a 1.5 1.5 0 0 1 -1.5 1.5 H 5.1 a 1.5 1.5 0 0 1'
    + ' -1.5 -1.5 Z"/><path d="M 3.6 8.4 L 6.2 4.3 h 11.6 l 2.6 4.1"/>'
    + '<path d="M 9.6 12.4 h 4.8"/>',
  commit: '<circle cx="12" cy="12" r="3.6"/><path d="M 12 3.4 V 8.4"/><path d="M 12 15.6 V 20.6"/>',
  // JEDINÝ plný prvok v celej sade. Proporcia je tá istá ako v znaku a na plátne
  // (mini znak: prstenec r 36, jadro r 15 → 0,417; tu 8,6 × 0,417 = 3,58 ≈ 3,6),
  // takže UI začne o jadre hovoriť rovnako ako graf.
  core: '<circle cx="12" cy="12" r="8.6"/>'
    + '<circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',

  // ── F · Dvojstavy (6 kresieb v 3 pároch) ──
  eye: EYE_BASE,
  // Rovnaké telo + prečiarknutie: dvojstav musí byť rozpoznateľný ako jeden prvok
  // v dvoch stavoch, nie ako dve nesúvisiace kresby.
  'eye-off': EYE_BASE + SLASH_FULL,
  lock: LOCK_BODY + '<path d="M 8.2 10.7 V 7.9 a 3.8 3.8 0 0 1 7.6 0 v 2.8"/>',
  // Rovnaké telo, otvorená spona — druhá noha chýba a oblúk končí smerom nahor.
  'lock-open': LOCK_BODY + '<path d="M 8.6 10.7 V 8.4 a 3.8 3.8 0 0 1 7.5 -0.5"/>',
  play: '<path d="M 8.6 5.9 L 18.3 12 L 8.6 18.1 Z"/>',
  pause: '<path d="M 9.4 5.8 v 12.4 M 14.6 5.8 v 12.4"/>',

  // ── G · Smerové a ostatné (5) ──
  'arrow-up': '<path d="M 12 19.6 V 4.6"/><path d="M 5.8 10.8 L 12 4.6 L 18.2 10.8"/>',
  // Nová kresba: nahrádza `.ms.flip`, ktorá existovala výhradne preto, že `arrow_downward`
  // nebol v subsete. Obchádzka, ktorej komentár lže, je horšia než nová ikona.
  'arrow-down': '<path d="M 12 4.4 v 15"/><path d="M 18.2 13.2 L 12 19.4 L 5.8 13.2"/>',
  stop: '<path d="M 6.7 6.7 h 10.6 v 10.6 H 6.7 Z"/>',
  refresh: '<path d="M 17.4 6.6 A 7.6 7.6 0 1 1 10 4.7"/><path d="M 6.8 3.5 L 10 4.7 L 7.8 7.3"/>',
  // Zvislé tri bodky — prepínač akcií riadka. `ellipsis` (vodorovné) nesie inú vec
  // (ďalšie oddelenia v breadcrumbe), preto sú to dve kresby, nie jedna otočená.
  'dots-menu': '<path d="M 12 6.2 h 0.01 M 12 12 h 0.01 M 12 17.8 h 0.01"/>',
};

// Zoznam na overenie, že sa nepoužil názov, ktorý sada nemá. Poradie = poradie kresieb.
export const ICON_NAMES = Object.keys(ICONS);

// Neznámy názov NIE JE ticho prázdny prvok — ticho vynechaná ikona je presne ten defekt,
// ktorý má sada odstrániť, a nesmie sa zaviesť späť v inej podobe. Meno sa zapíše do
// `window.HADES._iconMiss`, aby ho merací harness našiel (a aby agent G vedel, či smie
// mazať subset). Pole je dedupované, aby sa v slučke renderu nenafúklo do nekonečna.
function noteMiss(name) {
  if (typeof window === 'undefined') return;
  const h = window.HADES || (window.HADES = {});
  const miss = h._iconMiss || (h._iconMiss = []);
  if (miss.indexOf(name) === -1) miss.push(name);
}

// Zloží atribút `class`. `cls` sa pridáva K `ic`, nikdy ju nenahrádza — trieda je `ic`,
// nikdy `ms`. Veľkosť sem nepatrí (viď poznámku o `ICON_SIZES` na začiatku súboru).
function classAttr(opts) {
  let cls = 'ic';
  if (opts && opts.cls) cls += ' ' + opts.cls;
  return cls;
}

// Escapuje `title` — je to text, ktorý môže prísť z dát (meno oblasti, meno vlákna),
// a markup sa skladá stringom.
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Prístupnosť: ikona je DEKORÁCIA vedľa textu, preto default je `aria-hidden="true"`
// a `focusable="false"` (bez neho je `<svg>` v starších enginoch v tab poradí).
// Keď volajúci pošle `title`, ikona stojí sama a nesie význam — vtedy sa `aria-hidden`
// vypne a nastupuje `role="img"` + `aria-label`. Dva režimy naraz by boli lož.
function ariaAttrs(opts) {
  if (opts && opts.title) {
    return 'role="img" aria-label="' + escAttr(opts.title) + '" focusable="false"';
  }
  return 'aria-hidden="true" focusable="false"';
}

// String pre template stringy (cesty 2, 3 a 7 zo manuálu §7).
export function iconMarkup(name, opts) {
  let body = ICONS[name];
  if (!body) {
    noteMiss(name);
    body = ICONS.ring;
  }
  return '<svg class="' + classAttr(opts) + '" ' + SVG_ATTRS + ' ' + ariaAttrs(opts) + '>'
    + body + '</svg>';
}

// `<svg>` element pre cestu 5 (`el`-builder v chat / console / charon).
// Skladá sa cez `<template>`, pretože HTML parser vnútri template správne vytvorí prvky
// v SVG namespace; `document.createElement('svg')` by vyrobil HTML prvok, ktorý sa nekreslí.
export function iconSvg(name, opts) {
  const markup = iconMarkup(name, opts);
  if (typeof document === 'undefined') return null;
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  return tpl.content.firstElementChild;
}

// Výmena kresby na existujúcom prvku — cesty 6 (`.textContent = 'lig'`) a 3 (toggle).
// TOTO je funkcia, ktorá zabraňuje tichému pádu: na `<svg>` prvku `textContent` nezobrazí
// NIČ a výnimku nevydá, takže `el.textContent = 'check'` by po odchode fontu ticho
// vyprázdnil tlačidlo. Musí fungovať aj na prvku, ktorý ikonu ešte nemá.
export function iconSwap(el, name, opts) {
  if (!el) return null;
  const svg = iconSvg(name, opts);
  if (!svg) return null;
  const old = el.querySelector(':scope > svg.ic') || el.querySelector('svg.ic');
  if (old) {
    old.replaceWith(svg);
    return svg;
  }
  // Prvok ikonu nemá: zahoď jeho vlastné TEXTOVÉ uzly (to je stará ligatúra alebo text
  // armed-confirm režimu) a vlož kresbu na začiatok. Elementové deti — typicky
  // `<span class="lbl">` v raile — zostávajú, inak by výmena ikony zmazala menovku.
  const kids = Array.prototype.slice.call(el.childNodes);
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].nodeType === 3) el.removeChild(kids[i]);
  }
  el.insertBefore(svg, el.firstChild);
  return svg;
}
