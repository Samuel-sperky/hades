/* Prepínač: je radiálna MAPA aktívnym renderom obrazovky 'graf'?

   W1: mapa NAHRÁDZA starý d3-force graf ako domovská obrazovka, takže je zapnutá
   vždy, keď je aktívna obrazovka 'graf'. Starý input (graph/input.js) aj stará
   render vetva (render/frame.js) sa podľa tohto flagu vypnú, aby sa dve slučky
   ani dve sady pointer handlerov nebili. Súbor je zámerne bez ťažkých importov,
   aby ho mohol importovať aj graph/input.js bez cyklu. */

import { S } from '../../core/state/index.js';

let enabled = true;

export function isMapActive() { return enabled && S.screen === 'graf'; }

export function setMapEnabled(v) { enabled = !!v; }
