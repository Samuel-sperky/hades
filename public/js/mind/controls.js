import { reloadGraph } from './api.js';
import { closeDock, dockOpen, openDock } from './dock.js';
import { clearLocal, persistFilter, persistRelFilter } from './filters.js';
import { closeMdOverlay, openMdOverlay } from './md.js';
import { closeCreateMode, closeNodePanel, createMode, createNode, fillDeptOptions, fillMoveSelects, openCreateNode, selectNode } from './panels.js';
import { draw, fitView, requestDraw, zoomBy } from './render.js';
import { setScreen } from './screens.js';
import { renderLibrary } from './screens/kniznica.js';
import { toggleHelp } from './shortcuts.js';
import { buildSim, goUp, kickSim, setView, syncViewButtons } from './sim.js';
import { OPT_DEFAULTS, S, canvas } from './state.js';
import { renderStructure } from './structure.js';
import { setupCertTagFilter } from './tagfilter.js';
import { setTheme } from './theme.js';
import { showToast } from './toasts.js';
import { $, applyOpts, blip, busy, setOpt, syncSlider } from './util.js';
import { iconSwap } from '../shared/icons.js';

// Knižnica — debounce timer filtra (jediné použitie je handler nižšie v setupControls).
export let libraryTimer = null;

/* ---------- HUSTOTA ZOBRAZENIA (data-density) ----------

   Tri škály jednej osi: `comfortable` → `cozy` (predvolená) → `compact`.
   Rozmerové tokeny pre každú z nich sú v mind.css (:root a dva bloky
   :root[data-density=...]); tu je len stampovanie atribútu a perzistencia.

   Prečo je `cozy` reprezentovaná NEPRÍTOMNOSŤOU atribútu: predvolená škála má
   byť to, čo dá `:root` bez akejkoľvek podmienky — inak by existovali dve
   miesta, kde je napísané, ako appka vyzerá bez voľby, a jedno z nich by
   zastaralo. Ukladá sa napriek tomu, aby sa vedomá voľba „cozy" odlíšila od
   „nikdy som nevyberal".

   Pozor na pravidlo cyklických importov tohto grafu: funkcie sa exportujú ako
   hoistované `export function`, nikdy ako `export const foo = () => {}`. */
export const DENSITIES = ['comfortable', 'cozy', 'compact'];

// Vzor initialTheme() z theme.js — počiatočný stav sa ČÍTA, neháda sa.
export function initialDensity() {
    const v = localStorage.getItem('hades.density');
    return DENSITIES.includes(v) ? v : 'cozy';
}

export function setDensity(name) {
    const d = DENSITIES.includes(name) ? name : 'cozy';
    const root = document.documentElement;
    if (d === 'cozy') delete root.dataset.density;
    else root.dataset.density = d;
    localStorage.setItem('hades.density', d);
    syncDensityButtons(d);
}

export function syncDensityButtons(name) {
    const d = name || (document.documentElement.dataset.density || 'cozy');
    document.querySelectorAll('#density .dens').forEach((b) => {
        b.setAttribute('aria-checked', b.dataset.density === d ? 'true' : 'false');
    });
}

export function applyInitialDensity() {
    const d = initialDensity();
    if (d === 'cozy') delete document.documentElement.dataset.density;
    else document.documentElement.dataset.density = d;
}

/* Stamp sa robí pri VYHODNOTENÍ modulu, nie v setupControls(): setupControls
   beží až po načítaní grafu z /api/mind, takže prvé rámce obrazoviek by sa
   nakreslili v inej hustote než uložená voľba. controls.js je jeden z prvých
   modulov, ktoré main.js importuje, čiže je to najskorší bod, ktorý má tento
   súbor k dispozícii — a je to skôr než setTheme(initialTheme()) v init().
   Dotýka sa len documentElement a localStorage, žiadneho importovaného
   bindingu, takže to je bezpečné aj v cykle importov. */
applyInitialDensity();

/* ---------- W2c: pomenované predvoľby zobrazenia ----------

   Panel Nastavení mal 30+ slidrov a prepínačov naraz — hlavný zdroj dojmu
   „chaotické a neusporiadané". Predvoľba nastaví celú sadu jedným klikom;
   jednotlivé ovládače ostávajú v zbalenej sekcii „Pokročilé".

   Predvoľba pokrýva len vzhľad + pohyb + hustotu siete (S.opts, S.minWeight,
   S.skeleton). ZÁMERNE nesiaha na tému, zvuk, chat, rozsah grafu ani na filtre
   typov/zdrojov/vzťahov/značiek — to sú rozhodnutia používateľa o obsahu,
   nie o tom, ako sieť vyzerá.

   Aktívna predvoľba sa NEUKLADÁ; zisťuje sa spätne porovnaním hodnôt
   (detectPreset). Ručný pohyb sliderom tak označenie zruší sám a vrátenie
   hodnoty späť ho zase obnoví — bez tretieho zdroja pravdy.

   Predvoľby ZÁMERNE neinzerujú `glow` ani `sizeByDegree` — obe hodnoty boli mŕtve
   (nečítal ich žiadny renderovací modul) a zmizli spolu so svojimi ovládačmi. */
export const PRESET_LABELS = { clean: 'Čisté', live: 'Živé', dense: 'Husté', ambient: 'Ambient' };

export const PRESETS = {
    // Čisté — minimum pohybu a spojení: len kostra, tvrdý filter váhy, tiché pozadie.
    clean: {
        life: 0, anim: 0.15, bg: 0.4, edgeAlpha: 0.35,
        labelAlpha: 1, labelSize: 1, nodeScale: 1, panelAlpha: 1,
        edgeSoftHover: true, minWeight: 2, skeleton: true,
    },
    // Živé — predvolený stav appky (= OPT_DEFAULTS + predvolený minWeight/skeleton).
    // minWeight 0 = celá sieť; musí sedieť s defaultom v state.js, inak by čerstvý
    // profil hlásil „vlastné nastavenie" namiesto „Živé".
    live: {
        life: 0.5, anim: 0.5, bg: 1, edgeAlpha: 1,
        labelAlpha: 1, labelSize: 1, nodeScale: 1, panelAlpha: 0.92,
        edgeSoftHover: true, minWeight: 0, skeleton: false,
    },
    // Husté — viac spojení a popiskov: bez filtra váhy, hrany svietia stále,
    // uzly menšie (aby sa popisky zmestili).
    dense: {
        life: 0.35, anim: 0.4, bg: 0.7, edgeAlpha: 1.3,
        labelAlpha: 1.4, labelSize: 1.1, nodeScale: 0.85, panelAlpha: 0.92,
        edgeSoftHover: false, minWeight: 0, skeleton: false,
    },
    // Ambient — na pozeranie na celú obrazovku: maximum života a svetla,
    // popisky stlmené (šum z 1000 textov), uzly väčšie a viditeľné z diaľky.
    ambient: {
        life: 1, anim: 1, bg: 1.5, edgeAlpha: 1.15,
        labelAlpha: 0.35, labelSize: 1, nodeScale: 1.25, panelAlpha: 0.75,
        edgeSoftHover: false, minWeight: 1, skeleton: false,
    },
};

function presetValue(key) {
    if (key === 'minWeight') return S.minWeight;
    if (key === 'skeleton') return S.skeleton;
    return S.opts[key];
}

// Ktorá predvoľba presne zodpovedá aktuálnym hodnotám? null = „vlastné".
export function detectPreset() {
    for (const name of Object.keys(PRESETS)) {
        const p = PRESETS[name];
        let hit = true;
        for (const k of Object.keys(p)) {
            const cur = presetValue(k);
            const ok = typeof p[k] === 'number' ? Math.abs(cur - p[k]) < 1e-6 : cur === p[k];
            if (!ok) { hit = false; break; }
        }
        if (hit) return name;
    }
    return null;
}

export function markPresetActive() {
    const name = detectPreset();
    document.querySelectorAll('#presets .preset').forEach((b) => {
        const on = b.dataset.preset === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const st = $('preset-state');
    if (st) st.textContent = name ? 'aktívna: ' + PRESET_LABELS[name] : 'vlastné nastavenie';
    return name;
}

export function setupControls() {
    // FÁZA SHELL: hlavná navigácia — 4 pomenované obrazovky
    document.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.onclick = () => setScreen(b.dataset.screen);
    });

    // VLNA GRAF A: prepínač pohľadu (Sieť / Vrstvy). Zanorenie je filter nad
    // jednou scénou, pohľad mení fyzikálne rozloženie — to sú dve rôzne veci,
    // preto dva prepínače v hlavičke a nie ďalšia úroveň v breadcrumbe.
    const vNet = $('btn-view-net'), vLay = $('btn-view-layers');
    if (vNet) vNet.onclick = () => setView('net');
    if (vLay) vLay.onclick = () => setView('layers');
    syncViewButtons();

    // graph-tools (v hlavičke, viditeľné len na Grafe) + systém (rail)
    $('btn-structure').onclick = () => openDock('structure');
    // A10: Prehľad prestal byť sekciou doku — skratka vedie priamo na obrazovku Dnes,
    // teda na ten istý zdroj (/api/dashboard) v plnej šírke. Nie cez openDock('dnes'):
    // dok o obrazovkách nerozhoduje, tu je destinácia známa.
    $('btn-today').onclick = () => setScreen('dnes');
    $('btn-legend').onclick = () => openDock('legend');
    $('btn-help').onclick = () => toggleHelp(true);
    $('btn-settings').onclick = () => openDock('settings');
    $('dock-close').onclick = closeDock;

    // Knižnica — filter skillov (debounce)
    $('library-search').oninput = () => {
        clearTimeout(libraryTimer);
        libraryTimer = setTimeout(renderLibrary, 220);
    };

    $('zoom-in').onclick = () => zoomBy(1.3);
    $('zoom-out').onclick = () => zoomBy(1 / 1.3);
    $('zoom-reset').onclick = () => fitView();
    $('brand-core').onclick = () => fitView();

    // W2c: #btn-up nahradil mŕtvy #view-switch. Viditeľnosť (skryté na mape) rieši
    // syncUpButton() v renderBreadcrumb(), ktorý go() volá po každom prechode.
    const upBtn = $('btn-up');
    if (upBtn) upBtn.onclick = () => goUp();

    // Prepínače v Pokročilom, ktoré nie sú <input> — predvoľba ich musí dorovnať.
    const syncers = [];
    const syncAdvancedUi = () => { for (const f of syncers) f(); };

    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        inp.oninput = () => {
            syncSlider(inp);
            setOpt(inp.dataset.opt, parseFloat(inp.value));
            markPresetActive(); // ručný pohyb sliderom → „vlastné"
        };
    });

    // Filtre typov a zdrojov — checked = viditeľné; S.filter drží skryté hodnoty
    document.querySelectorAll('input[data-ftype], input[data-fsource]').forEach((inp) => {
        const key = inp.dataset.ftype ? 'types' : 'sources';
        const val = inp.dataset.ftype || inp.dataset.fsource;
        inp.checked = !S.filter[key].has(val);
        inp.onchange = () => {
            if (inp.checked) S.filter[key].delete(val);
            else S.filter[key].add(val);
            persistFilter();
            draw();
        };
    });

    // F4: prepínač Značky istoty + dynamický filter podľa značiek (injektované do #sec-settings)
    setupCertTagFilter();

    // Filter kategórií vzťahov — checked = viditeľné; S.filter.relations drží skryté kategórie
    document.querySelectorAll('input[data-frel]').forEach((inp) => {
        const val = inp.dataset.frel;
        inp.checked = !S.filter.relations.has(val);
        inp.onchange = () => {
            if (inp.checked) S.filter.relations.delete(val);
            else S.filter.relations.add(val);
            persistRelFilter();
            draw();
        };
    });

    // Soft-hover — spojenia sú v pokoji jemné, rozsvietia sa pri hover/fokuse uzla
    const shBtn = $('softhover-toggle');
    const syncShBtn = () => shBtn.setAttribute('aria-checked', S.opts.edgeSoftHover ? 'true' : 'false');
    syncers.push(syncShBtn);
    syncShBtn();
    shBtn.onclick = () => { setOpt('edgeSoftHover', !S.opts.edgeSoftHover); syncShBtn(); markPresetActive(); draw(); };

    // Kostra — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    const skBtn = $('skeleton-toggle');
    const syncSkBtn = () => skBtn.setAttribute('aria-checked', S.skeleton ? 'true' : 'false');
    syncers.push(syncSkBtn);
    syncSkBtn();
    skBtn.onclick = () => {
        S.skeleton = !S.skeleton;
        localStorage.setItem('hades.skeleton', S.skeleton ? '1' : '0');
        syncSkBtn();
        markPresetActive();
        draw();
        // Bez hlásenia (J2): syncSkBtn() prepíše stav prepínača a draw() plochu.
    };

    // A7 + FÁZA HRANY: min. váha spojení — samostatný stav (nie data-opt), surová hodnota v odpočte
    const mw = $('minweight-slider');
    if (mw) {
        const syncMw = () => {
            mw.style.setProperty('--pct', (parseFloat(mw.value) / 5) * 100 + '%');
            const out = mw.closest('label.slider').querySelector('output');
            if (out) out.textContent = parseFloat(mw.value).toFixed(1);
        };
        syncers.push(() => { mw.value = S.minWeight; syncMw(); });
        mw.value = S.minWeight;
        syncMw();
        mw.oninput = () => {
            S.minWeight = parseFloat(mw.value);
            localStorage.setItem('hades.minWeight3', String(S.minWeight));
            syncMw();
            markPresetActive();
            draw();
        };
    }

    // W2c: slidery síl (Odpudzovanie / Vzdialenosť / Sila spojení / Gravitácia) aj
    // „Obnoviť sily" sú zmazané — d3 simulácia neexistuje, nič neovládali.
    // VLNA CHRÓM: rovnako zmizol prepínač „Veľkosť podľa spojení" (#sizedeg-toggle)
    // a slider „Žiara" (data-opt="glow") — nodeRadius() škáluje podľa stupňa vždy
    // a alfu obrysov nesie paleta témy, takže ani jedna hodnota nič neriadila.

    $('opts-reset').onclick = () => {
        S.opts = Object.assign({}, OPT_DEFAULTS);
        localStorage.setItem('hades.opts', JSON.stringify(S.opts));
        applyOpts();
        syncAdvancedUi(); // reset vráti edgeSoftHover — prepínač dorovnať
        markPresetActive();
        buildSim();       // nodeScale sa vrátil na 1 → collide si musí prepočítať polomery
        kickSim();
        draw();
        showToast('Predvolené obnovené');
    };

    // Predvoľby — jeden klik nastaví celú sadu ovládačov nižšie
    document.querySelectorAll('#presets .preset').forEach((b) => {
        b.onclick = () => {
            const p = PRESETS[b.dataset.preset];
            if (!p) return;
            for (const k of Object.keys(p)) {
                if (k === 'minWeight') S.minWeight = p[k];
                else if (k === 'skeleton') S.skeleton = p[k];
                else S.opts[k] = p[k];
            }
            localStorage.setItem('hades.opts', JSON.stringify(S.opts));
            localStorage.setItem('hades.minWeight3', String(S.minWeight));
            localStorage.setItem('hades.skeleton', S.skeleton ? '1' : '0');
            applyOpts();       // slidery data-opt + --panel-alpha
            syncAdvancedUi();  // prepínače, ktoré nie sú <input>
            markPresetActive();
            buildSim();        // predvoľba mení nodeScale → collide polomery nanovo
            kickSim();
            draw();
            showToast('Predvoľba: ' + PRESET_LABELS[b.dataset.preset]);
        };
    });
    markPresetActive();

    // Tmavý režim — prepínač v nastaveniach, synchronizovaný s data-theme
    const themeBtn = $('theme-toggle');
    const syncThemeBtn = () => themeBtn.setAttribute('aria-checked',
        document.documentElement.dataset.theme === 'dark' ? 'true' : 'false');
    syncThemeBtn();
    themeBtn.onclick = () => {
        setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        syncThemeBtn();
        draw();
    };

    /* Hustota — segmentovaný ovládač. Atribút je už nastampovaný pri
       vyhodnotení modulu (applyInitialDensity), tu sa len dosynchronizujú
       tlačidlá a pripojí sa klik. Prekreslenie plátna netreba: hustota mení
       rozmery DOM obrazoviek, nie tokeny, ktoré číta render.
       Šípky vľavo/vpravo sú v radiogroup očakávané — bez nich by ovládač
       vyzeral ako rádiá a ovládal sa ako tri nezávislé tlačidlá. */
    const densBtns = Array.from(document.querySelectorAll('#density .dens'));
    if (densBtns.length) {
        syncDensityButtons();
        densBtns.forEach((b, i) => {
            b.onclick = () => setDensity(b.dataset.density);
            b.onkeydown = (e) => {
                const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = densBtns[(i + step + densBtns.length) % densBtns.length];
                setDensity(next.dataset.density);
                next.focus();
            };
        });
    }

    // A9: prepínač „Chat s Hadesom" je preč — mŕtvy chat nad grafom nahradil dok
    // Charóna (otvára sa tlačidlom #charon-toggle a klávesou C, bez prepínača v
    // Nastaveniach — kontrakt R-2/§1b). Trieda `chat-on` sa už nikde nenastavuje.

    // Zvuk — prepínač v nastaveniach
    const soundBtn = $('btn-sound');
    soundBtn.setAttribute('aria-checked', S.sound ? 'true' : 'false');
    soundBtn.onclick = () => {
        S.sound = !S.sound;
        localStorage.setItem('hades.sound', S.sound ? 'on' : 'off');
        soundBtn.setAttribute('aria-checked', S.sound ? 'true' : 'false');
        if (S.sound) blip(523);
    };

    $('btn-ambient').onclick = () => {
        document.body.classList.add('ambient');
        requestDraw(); // ambient režim → rozbehni nepretržitú slučku
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    };

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) document.body.classList.remove('ambient');
    });

    $('node-close').onclick = closeNodePanel;

    // C4: dokument uzla — overlay s vyrenderovaným markdownom
    $('node-md').onclick = () => { if (S.selected) openMdOverlay(S.selected); };
    $('md-close').onclick = closeMdOverlay;
    $('md-overlay').addEventListener('click', (e) => {
        if (e.target === $('md-overlay')) closeMdOverlay();
    });
    // Pätička čítačky (md-pack / md-copypath) sa naväzuje v setupPack().

    // Ručné prepájanie — klik na 'link' zapne connect mode, cieľ sa vyberá klikom na plátne
    $('node-connect').onclick = () => {
        if (!S.selected) return;
        S.connectFrom = S.selected.id;
        canvas.classList.add('linking');
        showToast('Klikni na cieľový uzol — Esc zruší');
    };

    $('btn-new-node').onclick = openCreateNode;

    $('node-edit').onclick = () => {
        if (!S.selected) return;
        closeCreateMode(); // edit mód — select typu patrí len vytváraniu
        $('edit-label').value = S.selected.label;
        $('edit-desc').value = S.selected.description || '';
        fillMoveSelects(S.selected);
        $('node-view').classList.add('hidden');
        $('node-form').classList.remove('hidden');
    };

    $('edit-area').onchange = () => fillDeptOptions(+$('edit-area').value || null, null);

    $('edit-cancel').onclick = () => {
        if (createMode) {
            closeCreateMode();
            if (S.selected) selectNode(S.selected); // návrat na detail predtým zvoleného uzla
            else closeNodePanel();
            return;
        }
        $('node-form').classList.add('hidden');
        $('node-view').classList.remove('hidden');
    };

    $('edit-save').onclick = () => busy($('edit-save'), async () => {
        if (createMode) { await createNode(); return; }
        if (!S.selected) return;
        try {
            const res = await fetch('/api/nodes/' + S.selected.id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: $('edit-label').value.trim(),
                    description: $('edit-desc').value.trim() || null,
                    area_id: $('edit-area').value ? +$('edit-area').value : null,
                    department_id: $('edit-dept').value ? +$('edit-dept').value : null,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                Object.assign(S.selected, data.node);
                selectNode(S.selected);
                await reloadGraph();
                if (dockOpen === 'structure') renderStructure();
                draw();
                // Bez hlásenia (J2): reloadGraph() + draw() prekreslia uzol s novým menom
                // a zaradením, takže zmena JE potvrdenie.
            } else {
                showToast('Uloženie sa nepodarilo', null, 'error');
            }
        } catch (e) {
            showToast('Uloženie sa nepodarilo', null, 'error');
        }
    }, 'Ukladá sa…');

    // Mazanie uzla — arm pattern namiesto confirm(): prvý klik ozbrojí, druhý do 3 s maže
    const nodeDel = $('node-delete');
    const disarmNodeDelete = () => {
        clearTimeout(nodeDel._disarm);
        nodeDel.classList.remove('armed');
        /* `iconSwap` zahodi vlastne TEXTOVE uzly prvku a vlozi kresbu. Priame
           `textContent = 'trash'` by na <svg> nezobrazilo NIC a vynimku by nevydalo -
           tlacidlo by po odchode fontu ticho ostalo prazdne. */
        iconSwap(nodeDel, 'trash', { title: 'Zmazať uzol' });
    };
    $('node-close').addEventListener('click', disarmNodeDelete);
    nodeDel.onclick = async () => {
        if (!S.selected) return;
        if (!nodeDel.classList.contains('armed')) {
            nodeDel.classList.add('armed');
            // Ozbrojeny stav nesie text, nie kresbu - preto sa kresba odstranuje.
            const ic = nodeDel.querySelector('svg.ic');
            if (ic) ic.remove();
            nodeDel.textContent = 'Naozaj zmazať?';
            nodeDel._disarm = setTimeout(() => { if (nodeDel.isConnected) disarmNodeDelete(); }, 3000);
            return;
        }
        clearTimeout(nodeDel._disarm);
        const node = S.selected;
        await busy(nodeDel, async () => {
            try {
                const res = await fetch('/api/nodes/' + node.id, { method: 'DELETE' });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showToast(data.message || 'Nepodarilo sa zmazať', null, 'error');
                    return;
                }
                // lokálne odstránenie — pulse node.deleted je idempotentný, duplicitu toleruje
                S.nodes = S.nodes.filter((m) => m.id !== node.id);
                S.edges = S.edges.filter((e) => e.source.id !== node.id && e.target.id !== node.id);
                S.byId.delete(node.id);
                if (S.local && S.local.rootId === node.id) clearLocal();
                S._localFor = null;
                closeNodePanel();
                buildSim();
                kickSim();
                draw();
                showToast('Uzol zmazaný');
            } catch (e) {
                showToast('Nepodarilo sa zmazať', null, 'error');
            }
        }, 'Maže sa…');
        disarmNodeDelete();
    };
}
