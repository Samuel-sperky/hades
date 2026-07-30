/* Render-loop / animation slice — the dirty-flag rAF pipeline lives off these. */

export const perf = {
    // FÁZA ANIMÁCIE: stav animačnej vrstvy
    _flows: [],           // putujúce svetlobody po hranách (event-driven): { from,to,e,t,speed,tone,dim,wait }
    _morph: null,         // prechod náhľadov: { from:Map, to:Map, t, dur }
    _clock: 0,            // monotónny animačný čas (s) — fáza pre dýchanie / sínusovky (mrzne pri skrytom tabe)
    _anim: 0,             // efektívna intenzita animácií tento frame (animLevel(), vrátane ambient boostu)
    _interacting: false,  // drag/pan prebieha → dýchanie sa pozastaví
    _labelShown: null,    // FÁZA DE-CLUTTER: id uzlov s viditeľným popiskom minulý frame (stabilita)
    // FÁZA ANIMÁCIE (Living): ambientný „život" — spojitá jemná slučka na Grafe.
    _life: 0,             // efektívna intenzita ambientného života tento frame (lifeLevel(), 0 = pokoj)
    _lifeTier: 0,         // auto-strop: 0 = plný, 1 = redukovaný (bez driftu), 2 = len event-driven
    _drawMs: 4,           // EMA nákladu draw() (ms) — podklad pre auto-strop (nižší = viac hlavy)
    _lastAmbient: 0,      // čas posledného ambientného framu (ms) — cap ~30 FPS pre život
    _nextSynapse: 3,      // _clock, kedy vyšle ďalšiu spontánnu synapsiu („myseľ premýšľa")
    cursor: { sx: 0, sy: 0, on: false, a: 0 }, // kurzor pre gravitáciu/parallax (screen + aktivácia 0..1)
    _vp: null,            // svetové hranice viewportu minulý frame — cieľ pre spontánne synapsie
    // FÁZA RENDER PIPELINE: dirty-flag rAF slučka — v pokoji 0 prekreslení (tichý CPU).
    _dirty: true,         // jednorazová požiadavka na prekreslenie (hover, kamera, dáta, filter)
    _settleFrames: 0,     // dobeh po animácii (flash/zrod dohasne, potom sa slučka zastaví)
};
