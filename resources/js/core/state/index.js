/* Composed application state.

   The five slices below are the real owners of the data (one per W2 package).
   `S` is a façade that projects every slice key onto a single object so that the
   ~1 900 existing `S.foo` call sites keep working untouched — W0 moves code, it
   does not rewrite it. Reads and writes go straight through to the owning slice,
   so `S.nodes === graph.nodes` at all times. */

import { graph } from './graph.js';
import { ui } from './ui.js';
import { filters } from './filters.js';
import { chat } from './chat.js';
import { perf } from './perf.js';

export { graph, ui, filters, chat, perf };

export const S = {};

function project(slice) {
    for (const key of Object.keys(slice)) {
        if (Object.prototype.hasOwnProperty.call(S, key)) {
            throw new Error('state slice key collision: ' + key);
        }
        Object.defineProperty(S, key, {
            get: () => slice[key],
            set: (v) => { slice[key] = v; },
            enumerable: true,
            configurable: true,
        });
    }
}

project(graph);
project(ui);
project(filters);
project(chat);
project(perf);

/** Ask the rAF loop for one more frame without importing the render module. */
export function markDirty() { perf._dirty = true; }
