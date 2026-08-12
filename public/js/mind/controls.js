import { reloadGraph } from './api.js';
import { closeDock, dockOpen, openDock } from './dock.js';
import { clearLocal, persistFilter, persistRelFilter } from './filters.js';
import { syncForceSliders } from './forces.js';
import { closeMdOverlay, openMdOverlay } from './md.js';
import { closeCreateMode, closeNodePanel, createMode, createNode, fillDeptOptions, fillMoveSelects, openCreateNode, selectNode } from './panels.js';
import { draw, fitView, makeStars, requestDraw, zoomBy } from './render.js';
import { setScreen } from './screens.js';
import { renderLibrary } from './screens/kniznica.js';
import { toggleHelp } from './shortcuts.js';
import { buildSim, kickSim, setView } from './sim.js';
import { FORCE_DEFAULTS, OPT_DEFAULTS, S, canvas } from './state.js';
import { renderStructure } from './structure.js';
import { setupCertTagFilter } from './tagfilter.js';
import { setTheme } from './theme.js';
import { showToast } from './toasts.js';
import { $, applyOpts, blip, busy, setOpt, syncSlider } from './util.js';

// Knižnica — debounce timer filtra (jediné použitie je handler nižšie v setupControls).
export let libraryTimer = null;

export function setupControls() {
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.onclick = () => setView(b.dataset.view);
    });

    // FÁZA SHELL: hlavná navigácia — 4 pomenované obrazovky
    document.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.onclick = () => setScreen(b.dataset.screen);
    });

    // graph-tools (v hlavičke, viditeľné len na Grafe) + systém (rail)
    $('btn-structure').onclick = () => openDock('structure');
    $('btn-stats').onclick = () => openDock('stats');
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

    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        inp.oninput = () => { syncSlider(inp); setOpt(inp.dataset.opt, parseFloat(inp.value)); };
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
    syncShBtn();
    shBtn.onclick = () => { setOpt('edgeSoftHover', !S.opts.edgeSoftHover); syncShBtn(); draw(); };

    // Kostra — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    const skBtn = $('skeleton-toggle');
    const syncSkBtn = () => skBtn.setAttribute('aria-checked', S.skeleton ? 'true' : 'false');
    syncSkBtn();
    skBtn.onclick = () => {
        S.skeleton = !S.skeleton;
        localStorage.setItem('hades.skeleton', S.skeleton ? '1' : '0');
        syncSkBtn();
        draw();
        showToast(S.skeleton ? 'Kostra zapnutá' : 'Kostra vypnutá');
    };

    // A7 + FÁZA HRANY: min. váha spojení — samostatný stav (nie data-opt), surová hodnota v odpočte
    const mw = $('minweight-slider');
    if (mw) {
        const syncMw = () => {
            mw.style.setProperty('--pct', (parseFloat(mw.value) / 5) * 100 + '%');
            const out = mw.closest('label.slider').querySelector('output');
            if (out) out.textContent = parseFloat(mw.value).toFixed(1);
        };
        mw.value = S.minWeight;
        syncMw();
        mw.oninput = () => {
            S.minWeight = parseFloat(mw.value);
            localStorage.setItem('hades.minWeight2', String(S.minWeight));
            syncMw();
            draw();
        };
    }

    // Slidery síl — okamžitý zápis do S.forces + rebuild simulácie
    document.querySelectorAll('input[data-force]').forEach((inp) => {
        inp.oninput = () => {
            syncSlider(inp);
            S.forces[inp.dataset.force] = parseFloat(inp.value);
            localStorage.setItem('hades.forces', JSON.stringify(S.forces));
            buildSim();
            kickSim(0.4);
            draw();
        };
    });

    $('forces-reset').onclick = () => {
        S.forces = Object.assign({}, FORCE_DEFAULTS);
        localStorage.removeItem('hades.forces');
        buildSim();
        kickSim(0.4);
        draw();
        syncForceSliders();
        showToast('Sily obnovené');
    };

    // Veľkosť podľa spojení (Obsidian size by degree) — rebuild kvôli collide polomerom
    const degBtn = $('sizedeg-toggle');
    const syncDegBtn = () => degBtn.setAttribute('aria-checked', S.opts.sizeByDegree ? 'true' : 'false');
    syncDegBtn();
    degBtn.onclick = () => {
        setOpt('sizeByDegree', !S.opts.sizeByDegree);
        syncDegBtn();
        buildSim();
        kickSim(0.3);
        draw();
    };

    $('opts-reset').onclick = () => {
        S.opts = Object.assign({}, OPT_DEFAULTS);
        localStorage.setItem('hades.opts', JSON.stringify(S.opts));
        makeStars();
        applyOpts();
        syncDegBtn(); // reset vráti aj sizeByDegree — prepínač a collide polomery dorovnať
        syncShBtn();  // reset vráti edgeSoftHover na TRUE — prepínač dorovnať
        buildSim();
        kickSim(0.3);
        draw();
        showToast('Predvolené obnovené');
    };

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

    // FÁZA SHELL: chat je schovaný (nefunguje bez API kľúča) — prepínač ho vráti
    const chatBtn = $('chat-toggle');
    const chatOn = localStorage.getItem('hades.chat') === '1';
    document.body.classList.toggle('chat-on', chatOn);
    chatBtn.setAttribute('aria-checked', chatOn ? 'true' : 'false');
    chatBtn.onclick = () => {
        const on = !document.body.classList.contains('chat-on');
        document.body.classList.toggle('chat-on', on);
        localStorage.setItem('hades.chat', on ? '1' : '0');
        chatBtn.setAttribute('aria-checked', on ? 'true' : 'false');
    };

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
                showToast('Uložené');
            } else {
                showToast('Uloženie sa nepodarilo');
            }
        } catch (e) {
            showToast('Uloženie sa nepodarilo');
        }
    }, 'Ukladám…');

    // Mazanie uzla — arm pattern namiesto confirm(): prvý klik ozbrojí, druhý do 3 s maže
    const nodeDel = $('node-delete');
    const disarmNodeDelete = () => {
        clearTimeout(nodeDel._disarm);
        nodeDel.classList.remove('armed');
        nodeDel.classList.add('ms');
        nodeDel.textContent = 'delete';
    };
    $('node-close').addEventListener('click', disarmNodeDelete);
    nodeDel.onclick = async () => {
        if (!S.selected) return;
        if (!nodeDel.classList.contains('armed')) {
            nodeDel.classList.add('armed');
            nodeDel.classList.remove('ms');
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
                    showToast(data.message || 'Nepodarilo sa zmazať');
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
                kickSim(0.3);
                draw();
                showToast('Uzol zmazaný');
            } catch (e) {
                showToast('Nepodarilo sa zmazať');
            }
        }, 'Mažem…');
        disarmNodeDelete();
    };
}
