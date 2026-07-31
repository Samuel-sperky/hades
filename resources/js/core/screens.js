/* ZAMKNUTÉ ROZHRANIE — jediný zdroj pravdy o obrazovkách (rozhranie #16).

   Pred W2 bol whitelist duplikovaný na troch miestach (shell/router.js,
   core/state/ui.js, shell/cmdk.js) a pridanie obrazovky znamenalo tri editácie
   v troch cudzích súboroch. Tu je raz; kto pridáva obrazovku, pridá riadok TU
   (cez integrátora) a inak sa drží vlastných súborov.

   Poradie určuje poradie destinácií v raili aj v Cmd-K palete.

   Konvencie, na ktoré sa spolieha router:
     - sekcia obrazovky v DOM má id `screen-<name>`
     - destinácia v raili má `data-screen="<name>"`
     - po prepnutí sa emituje bus event `screen:changed` s { from, to } */

/** @typedef {'dnes'|'dennik'|'graf'|'agenti'|'kniznica'|'chat'|'eshop'|'rozhodnutia'|'kontrola'|'smernica'} ScreenName */

/** @type {ScreenName[]} */
export const SCREENS = [
    'dnes',
    'dennik',
    'graf',
    'agenti',
    'kniznica',
    'chat',
    'eshop',
    'rozhodnutia',
    'kontrola',
    'smernica',
];

/** SK popisky pre breadcrumb, rail a Cmd-K. */
export const SCREEN_LABELS = {
    dnes: 'Dnes',
    dennik: 'Denník',
    graf: 'Graf',
    agenti: 'Agenti',
    kniznica: 'Knižnica',
    chat: 'Chat',
    eshop: 'E-shop',
    rozhodnutia: 'Rozhodnutia',
    kontrola: 'Kontrola',
    smernica: 'Smernica',
};

/** Material Symbols ikona destinácie (rail, Cmd-K). */
export const SCREEN_ICONS = {
    dnes: 'wb_sunny',
    dennik: 'receipt_long',
    graf: 'hub',
    agenti: 'smart_toy',
    kniznica: 'menu_book',
    chat: 'forum',
    eshop: 'storefront',
    rozhodnutia: 'gavel',
    kontrola: 'fact_check',
    smernica: 'assignment',
};

// W1: MAPA (radiálna konštelácia mysle) je domovská obrazovka — príchod do appky
// ukáže mapu. Obrazovka 'graf' hostí nový mapový render (graph/map/*).
export const DEFAULT_SCREEN = 'graf';

/** Vráti platný názov obrazovky; neznámy vstup padne na DEFAULT_SCREEN. */
export function normalizeScreen(name) {
    return SCREENS.includes(name) ? name : DEFAULT_SCREEN;
}
