/**
 * Regeneračný skript pre vendorovaný ikonový font Material Symbols Rounded.
 *
 * Spúšťa sa RUČNE, len keď treba font obnoviť (nová verzia ikon). Nie je
 * súčasťou `npm run build` — výsledný .woff2 je commitnutý v repozitári.
 *
 * Postup:
 *   docker compose exec -T app npm install --no-save material-symbols subset-font
 *   docker compose exec -T app node resources/fonts/subset-material-symbols.mjs
 *   (potom balíčky netreba, `material-symbols` má v node_modules 5,3 MB)
 *
 * Prečo subset: pôvodný variabilný font má 5 348 KB, pretože nesie deltas pre
 * 4 osi (FILL, wght, GRAD, opsz). Appka používa len FILL 0, GRAD 0, opsz 24 a
 * wght 300–400 (reset.css `.ms` = 400, components/empty.css = 300). Zapečením
 * nepoužitých osí spadne font na ~315 KB pri zachovaní všetkých ikon.
 *
 * Rozsah znakov je celá abeceda + číslice + podtržník, takže ostávajú DOSTUPNÉ
 * VŠETKY ikony (ligatúry sa skladajú z názvu ikony). Preto netreba udržiavať
 * zoznam použitých ikon — pridanie novej ikony v blade/JS funguje bez zmeny
 * fontu.
 */
import subsetFont from 'subset-font';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'node_modules/material-symbols/material-symbols-rounded.woff2';
const TARGET = 'resources/fonts/material-symbols-rounded-subset.woff2';

// Znaky, z ktorých sa skladajú názvy ikon (ligatúry) — pokrýva všetky ikony.
const LIGATURE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789_ ';

const source = readFileSync(SOURCE);
const subset = await subsetFont(source, LIGATURE_ALPHABET, {
    targetFormat: 'woff2',
    variationAxes: {
        FILL: { min: 0, max: 0, default: 0 },
        GRAD: { min: 0, max: 0, default: 0 },
        opsz: { min: 24, max: 24, default: 24 },
        wght: { min: 300, max: 400, default: 400 },
    },
});

writeFileSync(TARGET, subset);
console.log(
    `${TARGET}: ${source.length} B → ${subset.length} B ` +
        `(${(source.length / subset.length).toFixed(1)}× menej)`,
);
