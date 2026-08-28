import { ts } from './util.js';
import { iconSwap } from '../shared/icons.js';

// Rail badge — jeden generický indikátor na destinácii v ľavom rely.
// Boolean → teal bodka (.dot, neprečítané, napr. Denník); číslo → číselný pill
// (.count, napr. fronta Kontroly). Spätne kompatibilné so setJournalDot.
export function setRailBadge(screen, count) {
    const btn = document.querySelector('#rail .dest[data-screen="' + screen + '"]');
    if (!btn) return;

    // Boolean režim — bodka neprečítaného
    if (count === true || count === false) {
        let dot = btn.querySelector('.dot');
        if (count && !dot) {
            dot = document.createElement('span');
            dot.className = 'dot';
            dot.setAttribute('aria-hidden', 'true');
            btn.appendChild(dot);
        }
        if (!count && dot) dot.remove();
        return;
    }

    // Číselný režim — pill (skryje sa cez CSS pri data-count="0")
    const n = Math.max(0, +count || 0);
    let pill = btn.querySelector('.count');
    if (n > 0 && !pill) {
        pill = document.createElement('span');
        pill.className = 'count';
        pill.setAttribute('aria-hidden', 'true');
        btn.appendChild(pill);
    }
    if (pill) {
        pill.dataset.count = String(n);
        pill.textContent = n > 99 ? '99+' : String(n);
    }
}

// Denník — neprečítané záznamy (teal bodka na destinácii Denník). Tenký wrapper.
export function setJournalDot(show) {
    setRailBadge('dennik', !!show);
}

export function markJournalSeen() {
    localStorage.setItem('hades.journal.lastSeen', new Date().toISOString());
    setJournalDot(false);
}

export function checkJournalUnread() {
    fetch('/api/journal').then((r) => r.json()).then((d) => {
        let latest = 0;
        for (const r of d.records || []) latest = Math.max(latest, ts(r.created_at));
        const seen = ts(localStorage.getItem('hades.journal.lastSeen'));
        if (latest && latest > seen) setJournalDot(true);
    }).catch(() => { /* offline check nevadí */ });
}

/* ---------- šírka railu (rozhodnutie 17) ----------

   Stav je `wide` / `slim` a default je `wide`. Atribút sa nasadzuje PRED prvým
   rámcom (`main.js` volá `initialRail()` hneď vedľa `setTheme()`), inak by rail
   blikol zo 208 px na 80 px po dobehnutí modulu.

   Úložisko sa číta v `try/catch`: v súkromnom okne alebo pri zakázaných dátach
   stránky `localStorage` VYHODÍ výnimku, a prepínač tvaru navigácie nesmie byť
   dôvod, prečo sa appka nespustí.

   Smer nesie KRESBA, nie transformácia — `arrow-up` v rozbalenom, `arrow-down`
   v zbalenom stave. Rotácia by pri tichej verzii `prefers-reduced-motion`
   zamrzla v polovici, a `.ms.flip`, ktorá to kedysi robila, odišla s fontom. */
export function railState() {
    try {
        return localStorage.getItem('hades.rail') === 'slim' ? 'slim' : 'wide';
    } catch (err) {
        return 'wide';
    }
}

/* Pod 900 px sa rail kreslí ZBALENÝ bez ohľadu na uloženú voľbu: rozhodnutie 18
   hovorí, že na 768–900 px nesmie nič prekrývať, a zmerané je, že široký rail
   tam vojde do obsahu o 96 px. Nie je to CSS `@media`, pretože zbalený vzhľad
   nesie ~40 selektorov prefixnutých `body[data-rail="slim"]` — druhá kópia tej
   sady pod media query by sa pri prvej zmene rozišla.

   VOĽBA ČLOVEKA SA TÝM NEPREPISUJE. `hades.rail` drží, čo si vybral; atribút
   drží, čo sa dá nakresliť. Po rozšírení okna sa jeho voľba vráti sama. */
const NARROW = '(max-width: 900px)';

function narrow() {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia(NARROW).matches;
}

export function applyRail(state, persist) {
    const wanted = state === 'slim' ? 'slim' : 'wide';
    const next = narrow() ? 'slim' : wanted;
    document.body.dataset.rail = next;
    if (persist !== false) {
        try { localStorage.setItem('hades.rail', wanted); } catch (err) { /* úložisko nie je podmienka behu */ }
    }
    const btn = document.getElementById('rail-collapse');
    if (btn) {
        iconSwap(btn, next === 'slim' ? 'arrow-down' : 'arrow-up');
        btn.setAttribute('aria-expanded', next === 'wide' ? 'true' : 'false');
        const label = next === 'wide' ? 'Zbaliť navigáciu' : 'Rozbaliť navigáciu';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }
    return next;
}

export function initialRail() {
    const applied = applyRail(railState(), false);
    /* Zmena šírky okna musí vrátiť uloženú voľbu, keď sa okno zase roztiahne —
       preto listener, nie jednorazové vyhodnotenie pri štarte. */
    if (typeof window !== 'undefined') {
        /* Dva zdroje tej istej udalosti zámerne: `matchMedia` je ten správny
           a lacný, ale v emulovanom viewporte (merací harness) `change` NEPRÍDE —
           zmerané 28. 8. 2026: okno 1400 px, `matches` už `false`, rail zostal
           zbalený. `resize` fire-uje vždy; obe cesty končia v tej istej funkcii
           a tá je idempotentná, takže dvojité zavolanie nič nestojí. */
        if (window.matchMedia) {
            window.matchMedia(NARROW).addEventListener('change', () => applyRail(railState(), false));
        }
        window.addEventListener('resize', () => {
            const want = narrow() ? 'slim' : railState();
            if (document.body.dataset.rail !== want) applyRail(railState(), false);
        });
    }
    return applied;
}

/* „Viac" v spodnej lište (pod 768 px). Otvára PALETU, nie druhé menu: paleta už
   pozná všetkých deväť destinácií, akcie aj posledné vlákna, takže vlastný
   rozbaľovač by bol druhá kópia toho zoznamu — a tá by sa raz rozišla, presne
   ako sa rozišla paleta s railom v auguste (chýbali jej Runy a Charón).
   Import je LÍNY (vnútri handleru): cmdk.js siaha na screens.js aj dnes.js,
   takže eager import na vrchole rail.js by pridal hranu do cyklu, ktorý sa
   načítava skôr než obrazovky. */
export function wireRailMore() {
    const btn = document.getElementById('rail-more');
    if (!btn) return false;
    btn.addEventListener('click', async () => {
        const { openCmdk } = await import('./cmdk.js');
        openCmdk();
    });
    return true;
}

export function wireRailCollapse() {
    const btn = document.getElementById('rail-collapse');
    if (!btn) return false;
    btn.addEventListener('click', () => {
        /* Prepína sa ULOŽENÁ voľba, nie nakreslený stav: pod 900 px je nakreslený
           vždy `slim`, takže čítanie atribútu by tam prepínač zamklo. */
        applyRail(railState() === 'slim' ? 'wide' : 'slim');
    });
    return true;
}
