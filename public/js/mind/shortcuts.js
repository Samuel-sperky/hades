import { closeCmdk, cmdkOpen, openCmdk } from './cmdk.js';
import { toggleCharon } from './charon.js';
import { closeDock, dockOpen, openDock } from './dock.js';
import { clearLocal, setLocal } from './filters.js';
import { closeMdOverlay } from './md.js';
import { cancelConnect, closeNodePanel, openCreateNode } from './panels.js';
import { fitView, zoomBy } from './render.js';
import { openNodeDetail, openNodeFromAnywhere, setScreen } from './screens.js';
import { armKontrolaAction, disarmKontrolaBtn, kontrolaBtn, kontrolaMove, kontrolaNodeRef, kontrolaResolve, kontrolaState, kontrolaVerify } from './screens/kontrola.js';
import { clearFilter, currentPath, go, goUp, largestAreaId, largestDeptId, setView } from './sim.js';
import { S } from './state.js';
import { moveTableCursor } from './table.js';
import { showToast } from './toasts.js';
import { $ } from './util.js';

export const SHORTCUTS = [
    ['Ctrl K / F / /', 'Hľadať (paleta)'],
    // Šípky v palete existovali len ako Enter na prvej položke; odkedy posúvajú
    // fokus po výsledkoch, patrí to aj do pomocníka — inak je to skrytá funkcia.
    ['↑ / ↓ / Enter', 'Pohyb v palete a potvrdenie'],
    /* Kurzor v zoznamoch inzeruje pomocník, inak je to skrytá funkcia — a je to
       JEDEN riadok pre všetky zoznamy, pretože je to jedna klávesa s jedným
       významom (Kontrola a Denník ho majú len nad iným druhom položky).

       Riadok MENUJE obrazovky, nie druhy položiek. Dovtedy tu stálo „tabuľky,
       fronta, Denník", čo nútilo čitateľa hádať, ktorá obrazovka tabuľku má —
       teda pomocník na otázku „kde to funguje?" neodpovedal. Zoznam je zmeraný,
       nie odvodený zo zadania: dispatch `j` s fokusom nikde (2. 9. 2026) pohol
       kurzorom na Denníku, Knižnici, Kontrole, Runách, Rozhodnutiach a Smernici;
       na Dnes a na Grafe sa nepohlo nič. Sú to štyri rôzne dispatchery
       (`kontrolaMove` v bloku nižšie, `moveTableCursor` nad `.screen.active
       .rec-table`, vlastný listener `dennik.js` a kurzor `kniznica.js` scope-nutý
       na `#library-list`), takže nová obrazovka so zoznamom sa tu NEOBJAVÍ sama.
       Nepridávaj sem obrazovku, kým na nej klávesu nezmeriaš: pomocník, ktorý
       inzeruje klávesu nerobiacu nič, je horší než chýbajúci riadok.

       Šípky sú v riadku preto, že ich berie všetky štyri dispatchery
       (`case 'ArrowDown'` / `e.key === 'ArrowDown'`), nie preto, že by to bolo
       pravdepodobné — bez nich by riadok o polovici klávesnice mlčal. */
    ['j / k / ↑ / ↓', 'Pohyb v zozname (Denník, Knižnica, Kontrola, Runy, Rozhodnutia, Smernica)'],
    ['1 / 2 / 3 / 4', 'Filter: celá sieť / oblasť / oddelenie / uzol'],
    ['V', 'Pohľad: Sieť ↔ Vrstvy (na Grafe)'],
    ['C', 'Charón — rozhovor nad grafom'],
    /* Enter NEMÁ jeden význam a pomocník to musí priznať. Na šiestich
       obrazovkách so zoznamom otvára detail položky pod kurzorom — Kontrola cez
       `openNodeDetail()` vo svojom bloku nižšie, Denník vlastným listenerom,
       tabuľky riadkovým `onkeydown` z `renderTable()` (ktorému tento súbor
       zámerne zastavuje propagáciu, aby jeden stisk nezameral aj uzol v grafe).
       Zameranie uzla je dnes to, čo z Enteru zostane až NA Grafe, takže je to
       menovaná výnimka v zátvorke — rovnaký zápis, aký už nesie riadok `R`. */
    ['Enter', 'Detail položky pod kurzorom (na Grafe: zamerať zvolený uzol)'],
    ['Esc', 'Zrušiť filter'],
    ['Backspace', 'O úroveň von'],
    ['D', 'Denník'],
    ['R', 'Štruktúra (na Kontrole: vyriešiť položku)'],
    ['S', 'Prehľad'],
    ['L', 'Legenda'],
    ['G', 'Lokálny graf zvoleného uzla'],
    ['N', 'Nový uzol'],
    ['+ / −', 'Zoom'],
    ['0', 'Vycentrovať'],
    ['?', 'Tento pomocník'],
];

export const MOUSE_HINTS = [
    ['ťahanie plátna', 'Posun scény'],
    ['ťahanie uzla', 'Prehodenie uzla (sieť sa preleje)'],
    ['koliesko', 'Zoom'],
    ['klik na uzol', 'Detail + zúženie filtra'],
    ['klik do prázdna', 'O úroveň von'],
    ['dvojklik do prázdna', 'Zrušiť celý filter naraz'],
];

/* VLNA GRAF A: klávesy 1–4 zužujú FILTER nad jednou scénou. go({level}) doplní
   chýbajúci kontext z S.nav; keď ho nemá odkiaľ vziať (napr. „2" bez zvolenej
   oblasti), clampNav by úroveň zhodil na mapu a kláves by ticho nerobil nič —
   preto tu doplníme najväčšiu oblasť / oddelenie. setView() sa už NEpoužíva,
   ten dnes prepína pohľad (Sieť / Vrstvy), nie úroveň. */
function goLevel(level) {
    if (level === 'node') {
        if (S.selected) return go({ level: 'node', node: S.selected.id });
        // Bez vybraného uzla clampNav úroveň zhodí a kláves by ticho nerobil nič,
        // hoci ho pomocník inzeruje — povedzme to používateľovi.
        showToast('Najprv vyber uzol (klik alebo Ctrl+K)');
        return currentPath();
    }
    if (level === 'map') return go({ level: 'map' });
    if (level === 'area') {
        const a = S.nav.area != null ? S.nav.area : largestAreaId();
        if (a == null) return currentPath();
        return go({ level: 'area', area: a });
    }
    const area = S.nav.area != null ? S.nav.area : largestAreaId();
    const d = S.nav.dept != null ? S.nav.dept : largestDeptId(area);
    if (d == null) return currentPath();
    return go({ level: 'dept', dept: d });
}

/* Kedy klávesy NEPATRIA zoznamu. Je to ten istý slovník, aký si napísal Denník
   (`journalKeysBlocked()` v `dennik.js`) — vedome, nie z nevedomosti: presunúť
   ho do `util.js` by bol zásah do súboru, ktorý nie je môj, a druhá kópia
   PREDIKÁTU je menšie zlo než rozdielne pravidlá na dvoch zoznamoch. Návrh na
   zlúčenie je v reporte.

   Pole a `contenteditable` tu chýbajú zámerne: tie odfiltroval strážca
   `INPUT|TEXTAREA|SELECT` v dispatchi ešte nad týmto miestom.

   1. otvorený modál — paleta, pomocník aj čítačka markdownu majú vlastnú
      klávesnicu; zmerané, že práve tie tri (a nič iné) nesú
      `[role="dialog"][aria-modal="true"]`. Pravý panel medzi ne NEPATRÍ, takže
      tabuľka sa dá prechádzať aj s otvoreným detailom — a detail sa prekresľuje
      s kurzorom.
   2. fokus vnútri panelu — panel si drží Esc a tab-cyklus, takže `j` v ňom
      nesmie hýbať zoznamom za ním. */
function listKeysBlocked() {
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.hidden)')) return true;
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    return !!(a.closest && a.closest('#node-panel, #rec-panel'));
}

export let helpReturnFocus = null;

export function toggleHelp(show) {
    const el = $('help-overlay');
    const target = show === undefined ? el.classList.contains('hidden') : show;
    el.classList.toggle('hidden', !target);
    if (target && !$('help-body').children.length) {
        const row = ([k, d]) => {
            const caps = k.split(/\s*\/\s*/).map((x) => '<kbd>' + x + '</kbd>').join('<span class="sep">/</span>');
            return '<div class="key-row"><span class="label">' + d + '</span><span>' + caps + '</span></div>';
        };
        $('help-body').innerHTML = SHORTCUTS.map(row).join('')
            + '<h3>Myš</h3>'
            + MOUSE_HINTS.map(row).join('');
    }
    if (target) {
        helpReturnFocus = document.activeElement;
        $('help-close').focus();
    } else if (helpReturnFocus) {
        helpReturnFocus.focus();
        helpReturnFocus = null;
    }
}

export function setupShortcuts() {
    $('help-close').onclick = () => toggleHelp(false);
    $('help-overlay').addEventListener('click', (e) => {
        if (e.target === $('help-overlay')) toggleHelp(false);
    });

    window.addEventListener('keydown', (e) => {
        // FÁZA SHELL: Cmd/Ctrl+K → globálna paleta (hľadanie + navigácia), toggle
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            if (cmdkOpen()) closeCmdk(); else openCmdk();
            return;
        }

        if (e.key === 'Escape') {
            // kaskáda — jeden Esc zavrie vždy len najvrchnejšiu vrstvu
            if (cmdkOpen()) { closeCmdk(); return; }
            if (S.connectFrom) { cancelConnect(); showToast('Prepájanie zrušené'); return; }
            if (S.screen === 'kontrola') {
                const armed = document.querySelector('#kontrola-body .act-skip.armed');
                if (armed) { disarmKontrolaBtn(armed); return; }
            }
            if (document.body.classList.contains('ambient')) {
                document.body.classList.remove('ambient');
                return;
            }
            if (!$('md-overlay').classList.contains('hidden')) { closeMdOverlay(); return; }
            if (!$('help-overlay').classList.contains('hidden')) { toggleHelp(false); return; }
            const deptRow = document.querySelector('#structure-tree .dept-actions');
            if (deptRow) { deptRow.remove(); return; }
            if (!$('node-panel').classList.contains('hidden')) { closeNodePanel(); return; }
            if (dockOpen) { closeDock(); return; }
            if (S.local) { clearLocal(); return; }
            // VLNA GRAF A: posledný stupienok kaskády = ZRUŠ FILTER. Scéna je jedna,
            // takže niet kam „vyskakovať" — Esc len vráti celú sieť do plnej sily.
            // Postupné vynáranie po jednej úrovni má #btn-up a Backspace.
            clearFilter();
            return;
        }

        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;

        // Obrazovka Kontrola — klávesová fronta (skratky NEstrieľajú mimo nej)
        if (S.screen === 'kontrola' && kontrolaState.items.length) {
            const cur = kontrolaState.items[kontrolaState.idx];
            let handled = true;
            switch (e.key) {
                case 'j': case 'ArrowDown': kontrolaMove(1); break;
                case 'k': case 'ArrowUp': kontrolaMove(-1); break;
                // A4: detail sa otvára NA MIESTE, teda tou istou funkciou, akou ho
                // otvára klik (`openNodeDetail`). Do 24. 8. 2026 tu bolo
                // `openNodeFromAnywhere()`, ktoré bezpodmienečne prepne na Graf —
                // takže myš otvárala overlay a klávesnica vyhadzovala z obrazovky.
                // Riadkový `onkeydown` v kontrola.js zostáva ako zábrana proti
                // dvojitej aktivácii, už nie ako oprava rozdielu.
                case 'Enter': if (cur) openNodeDetail(kontrolaNodeRef(cur.id)); break;
                case 'v': case 'V': if (cur) kontrolaVerify(cur.id); break;
                case 'r': case 'R': if (cur) kontrolaResolve(cur.id); break;
                case 'Delete': case 'Backspace': if (cur) armKontrolaAction(kontrolaBtn(cur.id, 'skip'), cur.id, 'delete'); break;
                default: handled = false;
            }
            if (handled) { e.preventDefault(); return; }
        }

        /* KLÁVESOVÝ KURZOR TABULIEK — j/k a ↑/↓ nad Runami, Rozhodnutiami,
           Knižnicou a Smernicou.

           Stojí AŽ TU zámerne: Kontrola má vlastnú frontu s vlastnou sémantikou
           (`v`/`r`/`Del` nad položkou pod kurzorom) a jej blok vyššie skončí
           `return`-om, takže sem sa pri nej nikdy nedostaneme a jej kurzor
           zostáva ten, čo bol. Denník má vlastný listener v `dennik.js`, ktorý
           beží pred týmto a strieľa `stopImmediatePropagation()` — jeho karty
           nie sú riadky tabuľky.

           Kontejner sa hľadá ako `.screen.active .rec-table`, nie podľa id
           obrazovky: mapovací stôl „obrazovka → id tabuľky" by bol piaty zoznam,
           ktorý sa pri novej tabuľke zabudne doplniť, a chyba by bola tichá
           (klávesa by nerobila nič). Zmerané: každá z tých obrazoviek má v
           aktívnom `.screen` presne jednu `.rec-table`. */
        if (!listKeysBlocked()) {
            const t = document.querySelector('.screen.active .rec-table');
            if (t && (e.key === 'j' || e.key === 'ArrowDown')) {
                if (moveTableCursor(t, 1)) { e.preventDefault(); return; }
            }
            if (t && (e.key === 'k' || e.key === 'ArrowUp')) {
                if (moveTableCursor(t, -1)) { e.preventDefault(); return; }
            }
        }

        /* JEDEN ENTER = JEDNA AKCIA. Riadok tabuľky si Enter obsluhuje sám
           (`renderTable()` mu vešia `onkeydown`, ktorý otvorí panel) a ten
           handler propagáciu nezastavuje — takže bez tejto zábrany prešiel ten
           istý stisk aj do `case 'Enter'` nižšie a zameral uzol v grafe.
           Zmerané pred zmenou na Runách: jeden Enter na riadku otvoril panel
           A prepol filter grafu na `level: 'node'`, čím dopísal `n=1` do
           adresy. Doteraz sa na riadok dalo stáť len Tab-om, takže to bola
           spiaca chyba; s kurzorom je fokus na riadku bežný stav. */
        if (e.key === 'Enter' && e.target && typeof e.target.closest === 'function'
            && e.target.closest('.rec-row[data-rec]')) return;

        // SK klávesnica: fyzické kódy číslic fungujú nezávisle od rozloženia
        switch (e.code) {
            case 'Digit1': goLevel('map'); return;
            case 'Digit2': goLevel('area'); return;
            case 'Digit3': goLevel('dept'); return;
            case 'Digit4': goLevel('node'); return;
            case 'Digit0': fitView(); return;
            case 'NumpadAdd': zoomBy(1.3); return;
            case 'NumpadSubtract': zoomBy(1 / 1.3); return;
        }

        switch (e.key) {
            case '1': goLevel('map'); break;
            case '2': goLevel('area'); break;
            case '3': goLevel('dept'); break;
            case '4': goLevel('node'); break;
            // Backspace / Enter až tu — nad inputmi ich odfiltroval strážca vyššie
            // a obrazovka Kontrola si ich zoberie skôr (jej blok je nad týmto).
            case 'Backspace': e.preventDefault(); goUp(); break;
            case 'Enter': if (S.selected) go({ level: 'node', node: S.selected.id }); break;
            case '/': case 'f': case 'F': e.preventDefault(); openCmdk(); break;
            case 'r': case 'R': openDock('structure'); break;
            // A10: dok „Prehľad" duplikoval obrazovku Dnes, tak zanikol. `S` teda
            // otvára Dnes priamo — `openDock('stats')` by šlo cez alias v dock.js,
            // čo je zbytočná okľuka cez sekciu, ktorá už neexistuje.
            case 's': case 'S': setScreen('dnes'); break;
            case 'd': case 'D': setScreen('dennik'); break;
            case 'l': case 'L': openDock('legend'); break;
            case 'g': case 'G':
                // lokálny graf zvoleného uzla — toggle; hĺbka sa zachováva
                if (S.selected) {
                    if (S.local && S.local.rootId === S.selected.id) clearLocal();
                    else setLocal(S.selected.id, S.local ? S.local.depth : 1);
                }
                break;
            case 'n': case 'N': openCreateNode(); break;
            // Pohľad grafu má zmysel len na Grafe. Mimo neho V prestavovalo fyziku
            // celej siete (zmerané 143 ms zaseknutého vlákna) bez akejkoľvek spätnej
            // väzby — obrazovka sa nezmenila, takže sa to javilo ako zaseknutie appky.
            case 'v': case 'V':
                if (S.screen !== 'graf') { showToast('Pohľad prepneš na obrazovke Graf'); break; }
                setView(S.gview === 'layers' ? 'net' : 'layers');
                break;
            // C otvára/zatvára dok Charóna nad grafom (kontrakt R-2/§1b: dok sa
            // otvára klávesou a tlačidlom, bez prepínača v Nastaveniach). Nahradil
            // mŕtvy chat, ktorý C otváral len keď bola zapnutá trieda `chat-on`.
            case 'c': case 'C':
                e.preventDefault();
                toggleCharon();
                break;
            case '+': case '=': zoomBy(1.3); break;
            case '-': zoomBy(1 / 1.3); break;
            case '0': fitView(); break;
            case '?': toggleHelp(); break;
        }
    });
}

