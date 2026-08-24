import { closeMdOverlay, mdLabel, mdNodeId, openMdOverlay } from './md.js';
import { setGraphScope } from './pack.js';
import { showToast } from './toasts.js';
import { closeNodePanel, selectNode } from './panels.js';
import { markJournalSeen } from './rail.js';
import { focusNode, requestDraw, scheduleFrame } from './render.js';
import { renderJournal } from './screens/dennik.js';
import { renderToday } from './screens/dnes.js';
import { renderLibrary } from './screens/kniznica.js';
import { renderKontrola } from './screens/kontrola.js';
import { renderDecisions } from './screens/rozhodnutia.js';
import { renderDirective } from './screens/smernica.js';
import { renderRuns } from './screens/runy.js';
import { S } from './state.js';
import { $, esc, renderBreadcrumb } from './util.js';

/* ---------- FÁZA SHELL: obrazovky Dnes / Denník / Graf / Knižnica ---------- */

/* Poradie zrkadlí skupiny railu (TERAZ / ZÁZNAMY / ZNALOSTI) a `CMDK_NAV`, aby sa
   tie tri zoznamy dali čítať vedľa seba. Funkčne je to len množina: `SCREENS` slúži
   na test príslušnosti a uložená obrazovka je v `localStorage['hades.screen']`
   NÁZOV, nie index — preskladanie poradia teda uloženú voľbu nepokazí. */
export const SCREENS = ['dnes', 'graf', 'dennik', 'rozhodnutia', 'runy', 'kniznica', 'kontrola', 'smernica'];
export const SCREEN_LABELS = { dnes: 'Dnes', graf: 'Graf', dennik: 'Denník', rozhodnutia: 'Rozhodnutia', runy: 'Runy', kniznica: 'Knižnica', kontrola: 'Kontrola', smernica: 'Smernica' };

export function setScreen(name) {
    if (!SCREENS.includes(name)) name = 'dnes';
    const changed = S.screen !== name;
    S.screen = name;
    localStorage.setItem('hades.screen', name);
    document.body.dataset.screen = name;

    document.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.classList.toggle('active', b.dataset.screen === name);
    });
    document.querySelectorAll('#screens .screen').forEach((s) => {
        s.classList.toggle('active', s.id === 'screen-' + name);
    });

    renderScreenBreadcrumb(name);

    if (name === 'graf') {
        // plátno je hotové z kola 1 — len prebuď slučku (dirty + scheduleFrame)
        requestDraw();
        scheduleFrame();
    } else if (name === 'dnes') {
        renderToday();
    } else if (name === 'dennik') {
        renderJournal();
        markJournalSeen();
    } else if (name === 'kniznica') {
        renderLibrary();
    } else if (name === 'rozhodnutia') {
        renderDecisions();
    } else if (name === 'runy') {
        renderRuns();
    } else if (name === 'kontrola') {
        renderKontrola();
    } else if (name === 'smernica') {
        renderDirective();
    }
    if (changed && name !== 'graf') closeNodePanel();
}

export function renderScreenBreadcrumb(name) {
    if (name === 'graf') { renderBreadcrumb(); return; }
    const bc = $('breadcrumb');
    if (bc) bc.innerHTML = '<span class="current">' + esc(SCREEN_LABELS[name]) + '</span>';
}

/* ---------- detail uzla NA MIESTE (nález A4) ----------

   Do 24. 8. 2026 mala appka tri idiómy detailu na štyroch obrazovkách. Denník
   (`screens/dennik.js`) a Kontrola (`screens/kontrola.js`) volali
   `openNodeFromAnywhere()`, ktorý robí `setScreen('graf')` BEZPODMIENEČNE —
   klik na záznam teda vyhodil človeka z obrazovky, na ktorej pracoval, a cesta
   späť bola railom. Knižnica pritom už mala ten správny: `openMdOverlay()`
   a zostane, kde si.

   Toto je ten jeden idióm. Overlay je čítačka toho, čo uzol naozaj hovorí
   (`/api/nodes/{id}/markdown` = zdrojový .md, a keď ho uzol nemá, celý popis —
   viď `NodeMarkdownResolver`), takže na rozhodnutie „overiť / vyriešiť" aj na
   prečítanie záznamu stačí. Skok na Graf zostáva, ale ako SEKUNDÁRNA akcia
   v pätičke overlayu; `openNodeFromAnywhere()` je ďalej cesta pre hľadanie,
   paletu a Hygienu, kde človek chce naozaj vidieť uzol v sieti.

   Druhý overlay sa nezakladá a fokusová mechanika sa nekopíruje: `md.js` si už
   pamätá spúšťač (`mdReturnFocus`), fokus dáva na `#md-close` a `Esc` rieši
   kaskáda v `shortcuts.js`. */

/* Posledný ref, ktorý prišiel z obrazovky. Držíme ho, aby skok do Grafu dostal
   celý odľahčený uzol ({id,label,type,area_id}) a panel nemusel hádať typ.
   Zdrojom pravdy o tom, čo je NA obrazovke, je ale `mdNodeId` (živá väzba
   z `md.js`): keď overlay medzitým otvoril niekto iný — Knižnica ho otvára
   priamo — ref nesedí a berie sa to, čo človek naozaj vidí. */
let mdRef = null;
let mdWired = false;

export function openNodeDetail(ref) {
    if (!ref || ref.id == null) return;
    const id = +ref.id;
    mdRef = { ...ref, id };
    ensureMdDetailWiring();
    openMdOverlay({ id, label: ref.label || '', path: ref.path || null });
}

function mdDetailRef() {
    if (mdNodeId == null) return null;
    if (mdRef && mdRef.id === mdNodeId) return mdRef;
    return { id: mdNodeId, label: mdLabel || '' };
}

/* Pätičkové tlačidlo a modálny strážca klávesnice. Naväzuje sa raz a lenivo
   (nie na úrovni modulu): graf modulov má cykly a bočný efekt pri vyhodnocovaní
   by závisel od poradia importov v `main.js`. */
function ensureMdDetailWiring() {
    if (mdWired) return;
    mdWired = true;

    const foot = $('md-foot');
    if (foot && !$('md-graph')) {
        /* Sekundárna akcia = `.ghost` (primárna `.primary` je „Do balíka").
           Text, nie ikona: `account_tree` v subsete je, ale pätička je textová
           a nová ikona = regenerácia subsetu. Fokusový prsteň nesie globálne
           `:focus-visible` v `mind.css` — per-komponentný sa nepridáva. */
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost';
        btn.id = 'md-graph';
        btn.textContent = 'Zobraziť v grafe';
        // Zavrieť PRV než skočíme: closeMdOverlay() vráti fokus na spúšťač
        // a openNodeFromAnywhere() hneď za ním prepne obrazovku, takže sa
        // vrátený fokus nikde nezasekne.
        btn.onclick = () => {
            const ref = mdDetailRef();
            closeMdOverlay();
            if (ref) openNodeFromAnywhere(ref);
        };
        foot.insertBefore(btn, $('md-pack'));
    }

    /* Overlay je `aria-modal="true"`, ale klávesové skratky obrazoviek o ňom
       nevedeli — a to je nové riziko práve teraz, keď sa detail otvára NA
       Kontrole: jej blok v `shortcuts.js` berie j/k/v/r/Delete kdekoľvek na
       obrazovke, takže `v` by ticho overil uzol za scrimom.

       Zachytávacia fáza na window beží pred bublinovým listenerom
       `shortcuts.js`, takže propagáciu zastavíme tu. `preventDefault` NIE:
       šípky, medzerník a PageDown musia ďalej skrolovať dokument a Enter
       na tlačidle pätičky ho musí ďalej aktivovať (stopPropagation default
       akciu nezabíja). `Escape` prepúšťame — kaskádu má `shortcuts.js`
       a druhá cesta k zavretiu by bola druhý mechanizmus. Modifikátory tiež,
       aby `Ctrl+K` fungoval.

       Zastavuje sa len to, čo patrí overlayu (alebo nemá fokus nikde): paleta
       otvorená nad ním má vlastný `<input>` a listenery NA prvku, takže
       zastavená propagácia by jej vzala písanie aj šípky. */
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return;
        const ov = $('md-overlay');
        if (!ov || ov.classList.contains('hidden')) return;
        const t = e.target;
        const own = !t || t === document.body || t === document.documentElement || ov.contains(t);
        if (own) e.stopPropagation();
    }, true);
}

/* Poradie preklikov a rozbehnuté rozšírenie rozsahu pre openNodeFromAnywhere().
   Deklarované PRED funkciou zámerne: `let` v dočasnej mŕtvej zóne by pri cyklickom
   importe, kde by niekto zavolal openNodeFromAnywhere() ešte počas vyhodnocovania
   modulov, spadlo na ReferenceError. V tomto grafe modulov cykly sú. */
let openSeq = 0;
let scopeWidening = null;

// SKOK NA GRAF: uzol sa má vidieť v sieti → prepni obrazovku a otvor detail.
// Volajú to Dnes, Cmd-K, Hygiena a pätička overlayu („Zobraziť v grafe"); Denník
// a Kontrola idú cez openNodeDetail() vyššie a obrazovku neopúšťajú (A4).
// ref môže byť plný načítaný uzol, alebo odľahčený {id,label,type,area_id} z hľadania/knižnice.
//
// Graf beží v scope=live, takže na plátne je len časť siete. Do 20. 8. 2026 sa pri
// uzle mimo rozsahu otvoril detail, ale kamera sa nepohla a NIČ to nepovedalo —
// človek videl panel a na plátne uzol nikde. Hľadanie tým prestávalo hľadať.
// Teraz sa pohľad rozšíri na celú sieť, uzol sa zaostrí a rozšírenie sa ohlási:
// je to zmena trvalého nastavenia, takže o nej musí byť vidieť.
export function openNodeFromAnywhere(ref) {
    if (!ref || ref.id == null) return;
    const id = +ref.id;
    const seq = ++openSeq;
    const loaded = S.byId.get(id);
    setScreen('graf');
    if (loaded) {
        focusFound(loaded);
        return;
    }

    // detail hneď (selectNode si dotiahne /api/nodes/{id}), aby obrazovka nebola prázdna
    selectNode({
        id,
        label: ref.label || '',
        type: ref.type || 'skill',
        description: '',
        strength: ref.strength || 1,
        area_id: ref.area_id != null ? ref.area_id : null,
    });

    /* Rozšírenie rozsahu je async a dovtedy sa toho môže stať dosť: človek klikne
       na iný uzol, alebo odíde na inú obrazovku. Bez strážcu by staršia odpoveď
       dobehla ako posledná a strhla panel späť na predošlý uzol — prípadne ho
       otvorila na obrazovke, kde detail uzla nemá čo robiť (#node-panel nie je
       vnorený v .screen, takže ho prepnutie obrazovky samo neskryje).
       Je to ten istý vzor ako `reloadSeq` v api.js. */
    const widened = S.graphScope !== 'all';
    if (!widened && !scopeWidening) return; // širšie sa už ísť nedá a nič nebeží

    // druhý preklik nespúšťa druhé rozšírenie, pripojí sa na to bežiace
    const wait = widened
        ? (scopeWidening = setGraphScope('all').finally(() => { scopeWidening = null; }))
        : scopeWidening;

    wait.then(() => {
        if (seq !== openSeq) return;      // medzitým prišiel novší preklik
        if (S.screen !== 'graf') return;  // človek medzitým odišiel inam
        const now = S.byId.get(id);
        if (!now) return; // uzol nie je ani v celej sieti (zmazaný medzitým) — detail stačí
        if (widened) showToast('Graf rozšírený na celú knižnicu — uzol bol mimo živého pohľadu');
        focusFound(now);
    });
}


/** Zaostrenie na nájdený uzol: priblíž, doleť, otvor detail. */
function focusFound(node) {
    S.cam.k = Math.max(S.cam.k, 1.1);
    focusNode(node);
    selectNode(node);
}
