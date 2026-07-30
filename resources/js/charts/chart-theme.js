/* AuraAI — jediný zdroj farieb pre grafy.

   Kontrakt (P10, akceptačné kritérium „charts/* používa výhradne --chart-*"):
   v tomto priečinku NESMIE byť ani jedna farebná literálka. Každá farba je
   reťaz CSS custom properties: preferovaný Aura token → rodinný token dneška →
   posledná záchrana `currentColor`. Reťaz existuje preto, že `--chart-1..8`
   dopĺňa P9 — kým nepridá, grafy si vezmú dnešný `--cert-*` / `--accent`
   a vyzerajú presne ako pred refaktorom. Test tests/js/charts/chart-theme.test.js
   padne, keď sa tu objaví hex, rgb() alebo hsl().

   Farby sa čítajú z `:root` cez getComputedStyle, takže grafy sú theme-aware
   zadarmo — ale LEN v momente kreslenia. Prekreslenie pri prepnutí témy rieši
   charts/index.js (observer nad data-theme). */

/** Prečíta prvú neprázdnu CSS custom property z reťaze. */
export function cssVarChain(names, fallback = 'currentColor') {
    const root = getComputedStyle(document.documentElement);
    for (const name of names) {
        const v = root.getPropertyValue(name);
        if (v && v.trim()) return v.trim();
    }
    return fallback;
}


/* Reťaze tokenov. Prvý je Aura cieľ (P9 tokens.css), ďalšie sú záchranná sieť.

   Mapovanie istoty je z UX plánu, vlna 2: overené `--chart-2` (teal),
   hypotéza `--chart-7` (amber), pasca `--chart-4` (coral).

   VEDOMÁ ODCHÝLKA od plánu pri „bez značky": plán navrhoval `--chart-3`
   (periwinkle). 614 zo 684 uzlov je bez značky, takže by 90 % donutu bola
   plnohodnotná farebná kategória — ABSENCIA značky sa nesmie kresliť ako
   kategória. Ostáva tichý `--cert-none`. `--chart-none` je prvý v reťazi,
   aby P9 mohol pridať oficiálny „neutral" token bez zmeny JS. */
const CHAINS = {
    'cert-overene':  ['--chart-2', '--cert-overene'],
    'cert-hypoteza': ['--chart-7', '--cert-hypoteza'],
    'cert-pasca':    ['--chart-4', '--cert-pasca'],
    'cert-none':     ['--chart-none', '--cert-none', '--muted'],
    // línia rastu — zlatá rodinná akcentová (`--chart-gold` = `--chart-1`)
    growth:          ['--chart-gold', '--gold', '--accent'],
    // neutrálne
    track:           ['--track', '--border'],
    axis:            ['--muted', '--text-secondary'],
    accent:          ['--chart-accent', '--accent'],
};


/** Farba segmentu istoty; neznámy/prázdny kľúč = „bez značky". */
export function certColor(key) {
    const k = (key === 'bez' || key === 'none' || !key) ? 'none' : key;
    const chain = CHAINS['cert-' + k];
    return cssVarChain(chain || CHAINS['cert-none']);
}


/** Farba pomenovanej roly grafu (growth / track / axis / accent). */
export function chartColor(role) {
    return cssVarChain(CHAINS[role] || CHAINS.accent);
}


/** Rola má definovanú reťaz — používa drift test. */
export function chartRoles() {
    return Object.keys(CHAINS);
}


/** Zdroj pravdy pre drift test: každá reťaz musí byť neprázdna a smerovať
    len na CSS custom properties (`--*`). */
export function chartChains() {
    return { ...CHAINS };
}
