/* Namespaced localStorage access + one-shot legacy migration (hades.* -> aura.*).
   Every persisted preference in the app goes through this module. */

export const NS = 'aura.';

/* Legacy Hades key -> new AuraAI key. The versioned suffixes ("2") are dropped:
   the value is carried over unchanged, only the key name is new. */
export const LEGACY_MAP = {
    'hades.theme':            'aura.theme',
    'hades.view':             'aura.view',
    'hades.screen':           'aura.screen',
    'hades.sound':            'aura.sound',
    'hades.opts':             'aura.opts',
    'hades.forces':           'aura.forces',
    'hades.filter':           'aura.filter',
    'hades.relfilter':        'aura.relfilter',
    'hades.minWeight2':       'aura.minWeight',
    'hades.skeleton':         'aura.skeleton',
    'hades.certRings':        'aura.certRings',
    'hades.graphScope':       'aura.graphScope',
    'hades.pack':             'aura.pack',
    'hades.chat':             'aura.chat',
    'hades.chatContext':      'aura.chatContext',
    'hades.hints2':           'aura.hints',
    'hades.journal.lastSeen': 'aura.journal.lastSeen',
};

/* Reverse lookup for the read-through fallback (new key -> legacy key). */
const LEGACY_OF = {};
for (const [from, to] of Object.entries(LEGACY_MAP)) LEGACY_OF[to] = from;

function readRaw(key) {
    const full = NS + key;
    try {
        const v = localStorage.getItem(full);
        if (v !== null) return v;
        const legacy = LEGACY_OF[full];
        return legacy ? localStorage.getItem(legacy) : null;
    } catch (e) {
        return null;
    }
}

export const store = {
    /** JSON value; corrupted payload falls back instead of throwing. */
    get(key, fallback) {
        const v = readRaw(key);
        if (v === null) return fallback;
        try { return JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { /* quota */ }
    },
    del(key) {
        try { localStorage.removeItem(NS + key); } catch (e) { /* ignore */ }
    },
    /** Raw string, no JSON parse (theme, screen, view, flags…). */
    raw(key, fallback = null) {
        const v = readRaw(key);
        return v === null ? fallback : v;
    },
    setRaw(key, value) {
        try { localStorage.setItem(NS + key, String(value)); } catch (e) { /* quota */ }
    },
    /** Copies Hades preferences to the aura.* namespace. Idempotent, runs once.
        Old keys are intentionally kept as a rollback safety net. */
    migrateLegacy() {
        try {
            if (localStorage.getItem(NS + '__migrated')) return 0;
            let moved = 0;
            for (const [from, to] of Object.entries(LEGACY_MAP)) {
                if (localStorage.getItem(to) !== null) continue;   // new value wins
                const v = localStorage.getItem(from);
                if (v === null) continue;
                try { localStorage.setItem(to, v); moved++; } catch (e) { /* quota — continue */ }
            }
            localStorage.setItem(NS + '__migrated', String(Date.now()));
            if (moved) console.info('[aura] migrated ' + moved + ' legacy preferences');
            return moved;
        } catch (e) {
            return 0;
        }
    },
};
