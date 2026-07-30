/* CLOSED catalogue of bus event names. A new event means an entry here plus a
   line in CLAUDE.md — reviewed by the integrator, never added ad hoc. */

export const EV = {
    SCREEN_CHANGED:  'screen:changed',          // { from, to }
    THEME_CHANGED:   'theme:changed',           // { theme: 'light'|'dark' }
    GRAPH_LOADED:    'graph:loaded',            // { nodes, edges }
    GRAPH_DIRTY:     'graph:dirty',             // —  (requestDraw)
    GRAPH_FORCES:    'graph:forces-changed',
    GRAPH_FILTERS:   'graph:filters-changed',
    GRAPH_HIGHLIGHT: 'graph:highlight',         // { nodeIds, pulseFromCore }
    GRAPH_SCOPE:     'graph:scope-changed',     // { scope: 'live'|'all' }
    NODE_SELECTED:   'node:selected',           // { id }
    NODE_CREATED:    'node:created',            // { node }
    NODE_UPDATED:    'node:updated',
    NODE_DELETED:    'node:deleted',            // { id }
    EDGE_CREATED:    'edge:created',
    EDGE_DELETED:    'edge:deleted',
    PULSE:           'pulse',                   // { type, data }  (from graph/ws.js)
    CHAT_OPENED:     'chat:opened',
    CHAT_MODE:       'chat:mode-changed',       // { mode: 'quickbar'|'overlay'|'screen' }
    CHAT_CITED:      'chat:cited',              // { nodeIds }
    TOAST:           'toast:show',              // { text, kind, undo? }
    DOCK_OPENED:     'dock:opened',             // { section }
    JOURNAL_UNREAD:  'journal:unread',          // { count }
};
