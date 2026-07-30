/* Kontrakt čitateľnosti plátna — jediné miesto, kde žijú zoom prahy renderu.

   draw() sa pod istou hladinou zoomu prepína do „lacného" režimu (uzly = plné
   disky bez prstencov, popisky vyfadované). Auto-fit ale zoom počítal len z bbox
   uzlov, takže pri 200+ uzloch skončil POD týmito prahmi a graf bol nečitateľný
   (merané k = 0.49, pri neznámom viewporte dokonca k = 0.14 = spodná zátka).

   Rozhodnutie 74 (05-KONTRAKT.md): default zoom po auto-fite ≈ 0.6. Preto tu
   žije aj podlaha K_FIT_MIN a dopočet kamery — fit rám radšej „preteče" za okraj
   obrazovky, než by ukázal celok, z ktorého sa nič neprečíta. Oddialiť sa dá
   kolieskom / zoom-out, hub uzol zostáva v strede. */

import { S } from '../../core/state/index.js';


// Tvrdé hranice kamery (zhodné so zoomBy/fitView v graph/camera.js).
export const K_MIN = 0.14;

export const K_MAX = 3.2;


// Pod týmto zoomom kreslí draw() uzly ako lacné plné disky (bez prstencov a detailu).
export const K_DETAIL = 0.5;


// Zoom fade rampa popiskov (Obsidian): pod FROM nie sú vidieť, nad TO sú plné.
export const K_LABEL_FADE_FROM = 0.42;

export const K_LABEL_FADE_TO = 0.64;


// Čitateľné minimum po auto-fite. Nad K_DETAIL (uzly majú prstence) a nad
// polovicou rampy popiskov (zoomFade ≈ 0.82) — rozhodnutie 74 hovorí ≈ 0.6.
export const K_FIT_MIN = 0.6;


// Strop auto-fitu (malý graf sa nenafúkne do makra) — zhodné s pôvodným fitView.
export const K_FIT_MAX = 1.6;


/** Zoom fade popiskov pre daný zoom (0..1). */
export function labelFade(k) {
    return Math.min(1, Math.max(0, (k - K_LABEL_FADE_FROM) / (K_LABEL_FADE_TO - K_LABEL_FADE_FROM)));
}


/**
 * Zoom, ktorý obsiahne bbox bw × bh vo viewporte vw × vh s okrajom pad.
 * Vracia vždy čitateľnú hodnotu: K_FIT_MIN … K_FIT_MAX.
 * Neznámy / degenerovaný viewport (vw|vh ≤ 0 pred prvým layoutom, skrytý tab)
 * nesmie skončiť na spodnej zátke K_MIN — vtedy vraciame priamo K_FIT_MIN.
 */
export function fitZoom(bw, bh, vw, vh, pad = 90) {
    if (!(vw > 0) || !(vh > 0)) return K_FIT_MIN;
    const w = Math.max(bw, 1);
    const h = Math.max(bh, 1);
    const k = Math.min((vw - 2 * pad) / w, (vh - 2 * pad) / h);
    if (!Number.isFinite(k)) return K_FIT_MIN;
    return Math.min(K_FIT_MAX, Math.max(K_FIT_MIN, k));
}


/**
 * Zdvihne S.cam.k na čitateľné minimum a dopočíta posun, aby stred záberu
 * zostal ten istý (cam.x = -cx·k → prepočet je len škálovanie).
 * Vracia true, keď kameru zmenila.
 */
export function applyReadableZoom() {
    const k0 = S.cam.k;
    if (!(k0 > 0) || k0 >= K_FIT_MIN) return false;
    const s = K_FIT_MIN / k0;
    S.cam.k = K_FIT_MIN;
    S.cam.x *= s;
    S.cam.y *= s;
    return true;
}
