import { bindPackButtons, packBtn } from '../pack.js';
import { openNodeFromAnywhere, setScreen } from '../screens.js';
import { setJournalProject } from './dennik.js';
import { showToast } from '../toasts.js';
import { mutedColor } from '../theme.js';
import { $, busy, emptyCardHtml, emptyHtml, esc, fmtNum, getJson, prettyLabel, renderEmpty, timeAgo } from '../util.js';

/* ---------- obrazovka Dnes (dashboard: /api/today + /api/dashboard) ---------- */

// Origin badge — brain (.md, zdroj pravdy) vs session (DB). §4.8 ikony menu_book/bolt.
// „brain" je názov z backendu; v UI má stáť slovo, ktoré appka používa inde —
// filter zdrojov v Nastaveniach volá tieto uzly „Playbooky". `data-origin` si
// SUROVÚ hodnotu ponecháva, lebo na ňu vešia štýly CSS.
const ORIGIN_LABEL = { brain: 'playbook', session: 'session' };
export function originBadge(origin) {
    const o = origin === 'brain' ? 'brain' : 'session';
    const icon = o === 'brain' ? 'menu_book' : 'bolt';
    return '<span class="origin" data-origin="' + o + '">'
        + '<span class="ms" aria-hidden="true">' + icon + '</span>' + ORIGIN_LABEL[o] + '</span>';
}

// Shimmer skeleton počas načítania dashboardu (loading stav). Kostra kopíruje
// hierarchiu hotovej obrazovky (hľadanie → hero → druhý rad → karty), aby sa
// rozloženie po dobehnutí dát neprelialo.
export function todaySkeleton() {
    const bar = (w, h) => '<div class="shimmer" style="width:' + w + ';height:' + h + ';border-radius:var(--r-md);"></div>';
    return '<div style="display:flex;flex-direction:column;gap:var(--gutter);">'
        + bar('100%', '46px')
        + bar('min(420px, 60%)', '84px')
        + '<div class="kpi-grid">' + [0, 0, 0, 0].map(() => bar('100%', '58px')).join('') + '</div>'
        + '<div class="dash-grid">' + bar('100%', '160px') + bar('100%', '160px') + '</div>'
        + '</div>';
}

export async function renderToday() {
    const body = $('dnes-body');
    if (!body) return;
    // Šírku rieši fluidná mriežka v CSS (#screens padding-inline + auto-fill grids),
    // nie inline max-width — inak dashboard nikdy nevyužije široké okno.
    body.innerHTML = todaySkeleton();

    /* JEDNO volanie na celú obrazovku. Do 20. 8. 2026 sa Dnes skládalo z dvoch
       (`/api/today` + `/api/dashboard`), takže obsah obrazovky nemal jeden zdroj —
       a MCP tool, ktorý je vždy jedno volanie, by si ho musel skládať po svojom.
       `DnesScreen` na serveri vracia oboje; `/api/dashboard` žije ďalej pre
       externý mirror. res.ok kontrolujeme explicitne: 500 s JSON telom by inak
       prešlo ako úspech a obrazovka by mlčky ukázala nuly namiesto chyby. */
    let d;
    try {
        d = await getJson('/api/today');
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať prehľad', 'Skús obnoviť stránku.');
        return;
    }
    // `dash` je ten istý objekt — agregáty sú v koreni odpovede pod tými istými
    // kľúčmi, aké mal /api/dashboard, takže dashboardHtml() sa nemenil.
    const dash = d.counts ? d : null;
    const wb = d.week_added || {};

    /* Veľké hľadacie pole je ODTIAĽ PREČ. Otvárelo presne tú istú Cmd-K paletu ako
       #cmdk-trigger v hlavičke, takže tá istá akcia mala dve rôzne podoby a jedna
       z nich žila len na jednej zo siedmich obrazoviek. Ostáva tá v hlavičke:
       je trvalá (rovnaké miesto všade), nesie ikonu, slovo „Hľadať" aj skratku
       Ctrl K, takže sa nič neučí horšie — a Dnes tým získalo najcennejší pás
       obrazovky nad hlavným číslom pre obsah, nie pre druhý vstup do hľadania.
       Bonus: pole bolo <button> maskovaný za textové pole, čo je malá lož. */
    let h = '';

    // ---- Dashboard agregáty (hero + KPI + charty + Sync) z /api/dashboard ----
    // Veta „tento týždeň pribudlo…" už nestojí samostatne nad mriežkou — je
    // podtitulom hlavného čísla, teda súčasťou hierarchie, nie ďalším riadkom.
    if (dash) h += dashboardHtml(dash, wb);
    else {
        // Keď padne LEN /api/dashboard, obrazovka predtým ticho zhodila hlavné číslo,
        // KPI rad aj všetky štyri karty a zostal jediný riadok o týždni — vyzeralo to
        // ako prázdne vedomie, nie ako chyba. Zvyšok (z /api/today) je platný, takže
        // sa nezahadzuje; chýbajúca časť to o sebe povie sama.
        h += weekLine(wb);
        h += emptyHtml('cloud_off', 'Súhrnné čísla sa nepodarilo načítať',
            'Zvyšok obrazovky je aktuálny — skús obnoviť stránku.');
    }

    // ---- Naposledy / záznamy / projekty (z /api/today) ----
    // Bez `.slice()`: strop drží server (DnesScreen.RECENT_SESSIONS). Kým bol tu,
    // posielalo sa osem a kreslilo šesť, takže AI videla dve session, ktoré na
    // obrazovke neboli — a to je celý mechanizmus, ktorým sa plochy rozchádzajú.
    /* Sekcie pri prázdnych dátach MIZLI celé (bez `else`), takže v tichý deň
       obrazovka pod dashboardom skončila uprostred ničoho — kým karty grafov
       prázdny stav majú. Tri sekcie hovoria to isté rovnako. */
    const sessions = d.recent_sessions || [];
    h += '<section class="today-sec"><h2>Naposledy si robil na…</h2>'
        + (sessions.length
            ? '<div class="today-grid">' + sessions.map((s) => todaySessionCard(s)).join('') + '</div>'
            : emptyCardHtml('Zatiaľ žiadna session'))
        + '</section>';

    const records = d.recent_records || [];
    h += '<section class="today-sec"><h2>Posledné záznamy</h2>'
        + (records.length
            ? '<div class="today-list">' + records.map((r) => todayRow('article', r)).join('') + '</div>'
            : emptyCardHtml('Zatiaľ žiadny záznam'))
        + '</section>';

    // `p.label` je zo servera: strojové názvy adresárov sú tam už zlúčené do jednej
    // skupiny „bez projektu". Kým to robil prehliadač (prettyProject), stálo v rade
    // vedľa seba niekoľko čipov s tým istým popiskom a rôznymi počtami.
    /* Čipy boli do 20. 8. 2026 obyčajné <span>, teda slepá ulička: Denník filtruje
       presne podľa `project`, ale prekliknúť sa naň nedalo. Teraz sú to tlačidlá,
       ktoré prepnú obrazovku a rovno nasadia filter. */
    const projects = d.top_projects || [];
    if (projects.length) {
        h += '<section class="today-sec"><h2>Aktívne projekty</h2><div class="today-chips">'
            + projects.map((p) => '<button type="button" class="today-chip" data-project="'
                + esc(p.project || '') + '">' + esc(p.label || p.project || '')
                + '<span class="n">' + (p.count || 0) + '</span></button>').join('')
            + '</div></section>';
    } else {
        h += '<section class="today-sec"><h2>Aktívne projekty</h2>'
            + emptyCardHtml('Zatiaľ žiadny projekt') + '</section>';
    }

    body.innerHTML = h;

    // Charty + Sync wiring — kontajnery sú už v DOM po nastavení innerHTML.
    if (dash) renderDashboardBlocks(dash);

    // Jediné číslo na obrazovke, s ktorým sa dá niečo urobiť, vedie na Kontrolu.
    const reviewBtn = $('hero-review');
    if (reviewBtn) reviewBtn.onclick = () => setScreen('kontrola');
    body.querySelectorAll('.today-item[data-id], .today-card-link[data-id]').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    /* Čip projektu = preklik do Denníka s nasadeným filtrom. Poradie je dôležité:
       najprv prepnúť obrazovku, potom filter — setJournalProject() rovno prekresľuje
       a na skrytej obrazovke by sa kreslilo do prázdna. */
    body.querySelectorAll('.today-chip[data-project]').forEach((chip) => {
        chip.onclick = () => {
            setScreen('dennik');
            setJournalProject(chip.dataset.project || null);
        };
    });

    bindPackButtons(body);
}

// Veta o týždni — podtitul hlavného čísla (a záložný riadok, keď /api/dashboard padne).
export function weekLine(wb) {
    const w = wb || {};
    return '<p class="today-line">Tento týždeň pribudlo <strong>' + esc(fmtNum(w.nodes ?? 0))
        + '</strong> ' + plural(w.nodes ?? 0, 'poznatok', 'poznatky', 'poznatkov')
        + ' v <strong>' + esc(fmtNum(w.sessions ?? 0)) + '</strong> '
        + plural(w.sessions ?? 0, 'zázname', 'záznamoch', 'záznamoch') + '.</p>';
}

/* Statický HTML dashboardu — hero + druhý rad KPI + grid kariet (charty dopĺňa
   charts.js do prázdnych kontajnerov).

   HIERARCHIA (predtým: šesť rovnako veľkých kariet, z ktorých žiadna nepovedala,
   čo je dôležité):
     1. HERO — jedno číslo, veľkosť uzlov vedomia, s vetou o tomto týždni pod ním.
     2. Druhý rad — spojenia, playbooky, záznamy, rozhodnutia (o krok menšie).
     3. Výzva na akciu — „na overenie" je jediné číslo, s ktorým sa dá niečo urobiť,
        takže nie je karta v rade, ale tlačidlo do Kontroly.
   Odpočty držia tri stupne škály (--fs-hero → --fs-kpi → --fs-caption). */
export function dashboardHtml(dash, wb) {
    const counts = dash.counts || {};
    const cert = dash.certainty || {};
    const num = (n) => esc(fmtNum(n ?? 0));
    const review = +(cert.needs_review || 0);

    const kpi = (val, label, suffix) =>
        '<div class="kpi-card"><div class="kpi-val">' + num(val)
        + (suffix ? '<span class="kpi-suffix">' + esc(suffix) + '</span>' : '')
        + '</div><div class="kpi-label">' + esc(label) + '</div></div>';

    let h = '<section class="today-hero">'
        + '<div class="hero-main">'
        + '<div class="hero-val">' + num(counts.nodes) + '<span class="hero-unit">'
        + plural(counts.nodes ?? 0, 'uzol', 'uzly', 'uzlov') + ' vo vedomí</span></div>'
        + weekLine(wb)
        + '</div>'
        + (review
            ? '<button type="button" id="hero-review" class="hero-action">'
              + '<span class="ms" aria-hidden="true">fact_check</span>'
              + '<span class="ha-val">' + num(review) + '</span>'
              + '<span class="ha-lbl">' + plural(review, 'poznatok', 'poznatky', 'poznatkov')
              + ' čaká na overenie</span></button>'
            : '<div class="hero-action is-clear"><span class="ms" aria-hidden="true">check_circle</span>'
              + '<span class="ha-lbl">Nič nečaká na overenie</span></div>')
        + '</section>';

    h += '<div class="kpi-grid">'
        + kpi(counts.edges, 'spojení')
        // „brain"/„session" boli jediné neslovenské popisky na dashboarde; appka tie
        // isté množiny inde nazýva Playbooky a Záznamy (viď filter zdrojov v blade).
        + kpi(counts.brain, 'playbookov')
        + kpi(counts.session, 'záznamov')
        + kpi(counts.decisions, 'rozhodnutí')
        + '</div>';

    h += '<div class="dash-grid">';

    // Heatmapa aktivity — cez 2 stĺpce; .heat sám skroluje horizontálne.
    h += '<div class="dash-card span-2"><div class="dash-head">'
        + '<span class="dash-title">Aktivita</span>'
        + '<span class="dash-note">' + num((dash.heatmap || {}).total) + ' aktivít za rok</span>'
        + '</div><div id="dash-heat"></div></div>';

    // Donut istoty + legenda (rozloženie rieši .dash-cert v CSS, nie inline štýly)
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Istota</span></div>'
        + '<div class="dash-cert">'
        + '<div id="dash-donut"></div>'
        + certLegend(cert)
        + '</div></div>';

    // Kumulatívny rast siete
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Rast siete</span>'
        + '<span class="dash-note">kumulatívne</span></div>'
        + '<div id="dash-growth"></div></div>';

    // Bary per oblasť
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Podľa oblasti</span></div>'
        + perAreaHtml(dash.per_area || []) + '</div>';

    // Sync karta
    h += syncCardHtml(dash);

    h += '</div>';
    return h;
}

// Legenda istoty — swatch + názov + počet; farby berie CSS z data-cert.
export function certLegend(cert) {
    const rows = [
        ['overene', 'overené', cert.overene],
        ['hypoteza', 'hypotéza', cert.hypoteza],
        ['pasca', 'pasca', cert.pasca],
        ['bez', 'bez značky', cert.bez],
    ];
    return '<div class="cert-legend">'
        + rows.map((r) =>
            '<div class="cl-row" data-cert="' + r[0] + '">'
            + '<span class="cl-sw"></span>'
            + '<span class="cl-name">' + esc(r[1]) + '</span>'
            + '<span class="cl-n">' + esc(String(r[2] ?? 0)) + '</span></div>').join('')
        + '</div>';
}

/* Bary per oblasť — farba oblasti cez inline --lobe (dedí sa na dot aj fill).

   `max` a percento ZOSTÁVAJÚ tu zámerne: nie je to údaj, ale šírka v pixeloch
   voči najvyššiemu baru. Čísla, ktoré bar podpisujú (`a.count`), prichádzajú zo
   servera a prehliadač ich neprepočítava — presun tejto škály na server by len
   presunul kresbu, nie pravdu. */
export function perAreaHtml(areas) {
    if (!areas.length) return emptyCardHtml('Zatiaľ žiadne oblasti');
    const max = Math.max.apply(null, areas.map((a) => +a.count || 0).concat([1]));
    return areas.map((a) => {
        const pct = Math.round(((+a.count || 0) / max) * 100);
        const color = a.color ? mutedColor(a.color) : 'var(--accent)';
        return '<div class="dbar" style="--lobe:' + esc(color) + ';">'
            + '<div class="dbar-head"><span class="db-dot"></span>'
            + '<span class="db-name">' + esc(a.name || a.slug || '') + '</span>'
            + '<span class="db-n">' + esc(String(a.count || 0)) + '</span></div>'
            + '<div class="dbar-track"><div class="dbar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('');
}

// Sync karta — stav (status-dot), štatistiky posledného behu, brain-write guard, „Sync teraz".
export function syncCardHtml(dash) {
    /* Stav rozhoduje server (`sync.state`), tu sa už len prekladá na slovo. Kým to
       robil prehliadač, mapoval `null` aj čokoľvek neznáme na „ok", takže vedomie,
       ktoré sa nikdy nesynchronizovalo, hlásilo „v poriadku". `none`/`unknown` CSS
       nepozná a `.status-dot` im dá sivú — čo je presne to, čo majú znamenať. */
    const sync = dash.sync || {};
    const status = sync.state || 'none';
    const statusLabel = {
        ok: 'v poriadku', partial: 'čiastočne', error: 'chyba', running: 'prebieha',
        none: 'nikdy nebežala', unknown: 'neznámy stav',
    }[status] || 'neznámy stav';
    // Jeden zdroj: koreňový kľúč. Server ho už zrovnal s tým v `sync`.
    const guardOn = !!dash.brain_write_enabled;

    const rowStyle = 'display:flex;align-items:center;gap:var(--sp-1);';
    const bits = [
        ['+' + (sync.created ?? 0), 'nových'],
        ['~' + (sync.updated ?? 0), 'zmien'],
        ['−' + (sync.deleted ?? 0), 'zmazaných'],
        ['»' + (sync.skipped ?? 0), 'preskočených'],
    ];
    const stats = '<div style="display:flex;flex-wrap:wrap;gap:var(--sp-1) var(--sp-2);'
        + 'font-family:var(--mono);font-size:var(--fs-small);color:var(--muted);">'
        + bits.map((b) => '<span><strong style="color:var(--text-secondary);">' + esc(b[0]) + '</strong> '
            + esc(b[1]) + '</span>').join('') + '</div>';

    return '<div class="dash-card"><div class="dash-head">'
        + '<span class="dash-title">Synchronizácia</span>'
        + '<span class="dash-note">' + (sync.finished_at ? esc(timeAgo(sync.finished_at)) : '—') + '</span>'
        + '</div>'
        + '<div style="' + rowStyle + 'font-size:var(--fs-small);color:var(--text-secondary);">'
        + '<span class="status-dot" data-status="' + status + '"></span><span>' + esc(statusLabel) + '</span></div>'
        + (sync.message ? '<p style="font-size:var(--fs-small);color:var(--muted);margin:0;">' + esc(sync.message) + '</p>' : '')
        + stats
        + '<div style="' + rowStyle + 'font-family:var(--mono);font-size:var(--fs-caption);color:var(--muted);">'
        + '<span class="ms" aria-hidden="true" style="font-size:var(--icon-sm);">' + (guardOn ? 'lock_open' : 'lock') + '</span>'
        + 'Zápis do playbookov: <strong style="color:var(--text-secondary);">' + (guardOn ? 'zapnutý' : 'vypnutý') + '</strong></div>'
        + '<button type="button" id="sync-now" class="primary" style="align-self:flex-start;display:inline-flex;align-items:center;gap:6px;">'
        + '<span class="ms" aria-hidden="true">sync</span> Synchronizovať</button>'
        + '</div>';
}

// Napojenie chartov (charts.js) a Sync tlačidla na existujúce DOM kontajnery.
export function renderDashboardBlocks(dash) {
    if (!window.HadesCharts) return;

    const heat = $('dash-heat');
    if (heat) {
        const weeks = (dash.heatmap || {}).weeks;
        if (Array.isArray(weeks) && weeks.length) HadesCharts.heatmap(heat, dash.heatmap);
        else heat.innerHTML = emptyCardHtml('Zatiaľ žiadna aktivita');
    }

    const donutEl = $('dash-donut');
    if (donutEl) {
        const c = dash.certainty || {};
        HadesCharts.donut(donutEl, [
            { cert: 'overene', value: c.overene || 0 },
            { cert: 'hypoteza', value: c.hypoteza || 0 },
            { cert: 'pasca', value: c.pasca || 0 },
            { cert: 'bez', value: c.bez || 0 },
        ], { total: c.total || 0, centerLabel: 'uzlov' });
    }

    const growth = $('dash-growth');
    if (growth) {
        const vals = (dash.growth || {}).values;
        if (Array.isArray(vals) && vals.length) HadesCharts.growthLine(growth, dash.growth);
        else growth.innerHTML = emptyCardHtml('Zatiaľ žiadny rast');
    }

    const syncBtn = $('sync-now');
    if (syncBtn) syncBtn.onclick = () => doSync(syncBtn);
}

// „Sync teraz" → POST /api/sync; 423 = lock (už beží). Po úspechu toast + refresh dashboardu.
export async function doSync(btn) {
    await busy(btn, async () => {
        let res;
        try {
            res = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
        } catch (e) {
            showToast('Synchronizácia zlyhala', null, 'error');
            return;
        }
        if (res.status === 423) { showToast('Synchronizácia už prebieha', null, 'warn'); return; }
        let j = {};
        try { j = await res.json(); } catch (e) { /* prázdna odpoveď */ }
        if (!res.ok) { showToast(j.message || j.error || 'Synchronizácia zlyhala', null, 'error'); return; }
        const st = j.stats || j.sync || j.run || j;
        showToast('Synchronizácia hotová: +' + (st.created ?? 0) + ' / ~' + (st.updated ?? 0), null, 'success');
        renderToday();
    }, 'Synchronizujem…');
}

// SK plurál 1 / 2-4 / 5+ (a 0)
export function plural(n, one, few, many) {
    n = Math.abs(+n) || 0;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
}

/* Popisky sessions chodia z databázy tak, ako ich zapísal Claude Code — vrátane
   strojových názvov dočasných adresárov („mystifying-mclaren-23750a — práca
   13.8.2026"). data-label zostáva SUROVÝ (je to identita uzla pre panel detailu a
   balík), mení sa len to, čo číta človek. */
/* `project_label` chodí zo servera (skupina projektu), `project` zostáva surové —
   je to identita záznamu a `prettyLabel` z neho odsekáva prefix v názve. */
export function todaySessionCard(s) {
    return '<div class="today-card-wrap">'
        + '<button type="button" class="today-card-link" data-id="' + s.id + '" data-label="' + esc(s.label || '') + '">'
        + '<span class="tcl-title">' + esc(prettyLabel(s.label, s.project)) + '</span>'
        + '<span class="tcl-meta">'
        + (s.project ? '<span class="tcl-proj">' + esc(s.project_label || '') + '</span>' : '')
        + (s.created_at ? '<span class="tcl-time">' + esc(timeAgo(s.created_at)) + '</span>' : '')
        + '</span></button>'
        + packBtn(s.id, s.label) + '</div>';
}

/* Riadok záznamu. Berie celý záznam zo servera, nie šesť rozbalených argumentov:
   `snippet` už prichádza bez markdownu (predtým ho tu čistil `plainText`, takže
   človek videl vetu a AI surové „**Čo:** …") a `project_label` je hotová skupina. */
export function todayRow(icon, r) {
    return '<div class="li-wrap">'
        + '<button type="button" class="today-item" data-id="' + r.id + '" data-label="' + esc(r.label || '') + '">'
        + '<span class="ms ti-ico" aria-hidden="true">' + icon + '</span>'
        + '<span class="ti-text"><span class="ti-title">' + esc(prettyLabel(r.label, r.project)) + '</span>'
        + (r.snippet ? '<span class="ti-snip">' + esc(r.snippet) + '</span>' : '')
        + '</span>'
        + (r.project ? '<span class="ti-tag">' + esc(r.project_label || '') + '</span>' : '')
        + (r.created_at ? '<span class="ti-time">' + esc(timeAgo(r.created_at)) + '</span>' : '')
        + '</button>'
        + packBtn(r.id, r.label) + '</div>';
}
