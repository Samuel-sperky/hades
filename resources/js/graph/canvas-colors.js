/* Canvas colour contract — every literal the 2D context draws with goes through T.
   TODO(P7): read these from CSS custom properties instead of duplicating them here. */

// Témy — kontrakt pre canvas literály (idú cez T.*)
// nodeFloor/edgeFloor: spodná hranica tlmenia (hover × focus), gridAlpha: sila mriežky
export const THEMES = {
    light: { paper:'#f8f4f7', ink:'#101d1b', inkSoft:'#2d3a38', muted:'#566964', labelHalo:'rgba(248,244,247,0.92)', edge:'45,58,56', gridColor:'3,121,126', accent:'3,121,126', outline:'rgba(16,29,27,0.35)', gridAlpha:0.05, nodeFloor:0.30, edgeFloor:0.20 },
    dark:  { paper:'#0e1413', ink:'#eaf3f1', inkSoft:'#c3d1ce', muted:'#8a9b98', labelHalo:'rgba(14,20,19,0.92)', edge:'195,209,206', gridColor:'5,188,196', accent:'5,188,196', outline:'rgba(234,243,241,0.30)', gridAlpha:0.09, nodeFloor:0.35, edgeFloor:0.25 },
};

export let T = THEMES.light;

/** Swap the active canvas palette. Called only from theme.js. */
export function setCanvasTheme(name) {
    T = THEMES[name] || THEMES.light;
}
