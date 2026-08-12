/* ---------- sily (Obsidian forces) — zrušené vlnou W2c ----------

   d3 forceSimulation už neexistuje (S.sim = null, layout je deterministický v
   layout.js), takže slidery Odpudzovanie / Vzdialenosť spojení / Sila spojení /
   Gravitácia nič neovládali. Sú preto vyhodené z blade aj z controls.js a spolu
   s nimi forceDefault() (rozhodoval sa podľa zrušeného S.view === 'net') aj
   nodeAlphaMul() / edgeAlphaMul() (stmievanie si render/edges počítajú samy
   z ent.dim). S.forces / FORCE_DEFAULTS ostávajú v state.js ako mŕtvy, nikým
   nečítaný stav.

   syncForceSliders() zostáva ako no-op shim: volá ho sim.js (setView, buildSim),
   ktorý je hotový a v tejto vlne sa nesmie prepisovať. */

export function syncForceSliders() {
    /* žiadne input[data-force] v DOM — nič na synchronizáciu */
}
