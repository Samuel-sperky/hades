/* Chat slice. W0 carries only what today's chat uses; P6 extends it in W2. */

import { store } from '../store.js';

export const chat = {
    // E3: uzly priložené do kontextu chatu (perzistentné naprieč reloadmi)
    chatContext: new Set(),
};

try {
    const cc = JSON.parse(store.raw('chatContext') || '[]');
    if (Array.isArray(cc)) cc.forEach((id) => chat.chatContext.add(+id));
} catch (e) { /* poškodený kontext — prázdny */ }
