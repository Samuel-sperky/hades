import { bindPackButtons, packBtn } from '../pack.js';
import { openNodeFromAnywhere, setScreen } from '../screens.js';
import { setJournalProject } from './dennik.js';
import { showToast } from '../toasts.js';
import { mutedColor } from '../theme.js';
import { $, busy, deferSkeleton, emptyCardHtml, errorHtml, esc, fmtNum, getJson, prettyLabel, renderError, timeAgo } from '../util.js';
import { iconMarkup } from '../../shared/icons.js';

/* ---------- obrazovka Dnes (dashboard: /api/today + /api/dashboard) ---------- */

// Origin badge — brain (.md, zdroj pravdy) vs session (DB). §4.8 ikony menu_book/bolt.
// „brain" je názov z backendu; v UI má stáť slovo, ktoré appka používa inde —
// filter zdrojov v Nastaveniach volá tieto uzly „Playbooky". `data-origin` si
// SUROVÚ hodnotu ponecháva, lebo na ňu vešia štýly CSS.
const ORIGIN_LABEL = { brain: 'playbook', session: 'session' };
export function originBadge(origin) {
    const o = origin === 'brain' ? 'brain' : 'session';
    const icon = o === 'brain' ? 'book' : 'bolt';
    return '<span class="origin" data-origin="' + o + '">'
        + iconMarkup(icon) + '' + ORIGIN_LABEL[o] + '</span>';
}

export async function renderToday() {
    const body = $('dnes-body');
    if (!body) return;
    /* Skeleton v tvare obsahu (`shape: 'dashboard'` — hero → KPI mriežka → karty).
       Kostra si už rozmery NEPÍŠE: `todaySkeleton()` ich skládal ako inline atribút
       štýlu v JS, čo je pre CSSOM neviditeľné, takže žiadna asercia nad stylesheetom
       o tej kresbe nevedela. Dnes ich drží rodina `.skel*` v `mind.css`.

       Šírku rieši fluidná mriežka v CSS (#screens padding-inline + auto-fill grids),
       nie inline max-width — inak dashboard nikdy nevyužije široké okno.

       `deferSkeleton` kreslí až po 300 ms: `renderToday()` sa volá aj po
       synchronizácii, teda nad už vykreslenou obrazovkou, a blik kostry nad hotovým
       obsahom pôsobí pomalšie než ticho. */
    const cancelSkeleton = deferSkeleton(body, 'dashboard');

    /* JEDNO volanie na celú obrazovku. Do 20. 8. 2026 sa Dnes skládalo z dvoch
       (`/api/today` + `/api/dashboard`), takže obsah obrazovky nemal jeden zdroj —
       a MCP tool, ktorý je vždy jedno volanie, by si ho musel skládať po svojom.
       `DnesScreen` na serveri vracia oboje; `/api/dashboard` žije ďalej pre
       externý mirror. res.ok kontrolujeme explicitne: 500 s JSON telom by inak
       prešlo ako úspech a obrazovka by mlčky ukázala nuly namiesto chyby. */
    let d;
    try {
        d = await getJson('/api/today');
        cancelSkeleton();
    } catch (e) {
        cancelSkeleton();
        // Jeden chybový komponent: predmet vo vete + jedna akcia. `renderToday`
        // ako `retry` je bezpečné — číta `/api/today`, nie DOM, ktorý práve zmizol.
        renderError(body, 'prehľad', renderToday);
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
        /* `errorHtml`, nie `renderError`: skládame reťazec do zvyšku obrazovky,
           takže tu nie je kam napojiť listener — a tlačidlo „Skúsiť znova" bez
           listenera by bolo mŕtve. Vetu skládá helper, RADU si drží toto miesto:
           priznanie „Zvyšok obrazovky je aktuálny" je jediné svojho druhu v appke
           a zjednotenie chýb ho nesmie zošúchať na generické „Server neodpovedá". */
        h += weekLine(wb);
        h += errorHtml('súhrnné čísla', 'Zvyšok obrazovky je aktuálny — skús obnoviť stránku.');
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
        /* KOMPAKTNÝ ZOZNAM, nie mriežka kariet (kontrakt E1). Riadok nesie to isté,
           čo karta — názov, projekt, čas — ale zmestí sa ich šesť bez scrollu a
           oko ide po jednej osi. Používa sa `todayRow()`, teda TEN ISTÝ komponent
           ako „Posledné záznamy": dve rodiny riadkov na tej istej obrazovke boli
           presne to, čo pri kartách vzniklo. Session nemá `snippet`, takže riadok
           ho vynechá sám. */
        + (sessions.length
            ? '<div class="today-list">' + sessions.map((s) => todayRow('clock', s)).join('') + '</div>'
            : emptyCardHtml('Zatiaľ žiadna session'))
        + '</section>';

    const records = d.recent_records || [];
    h += '<section class="today-sec"><h2>Posledné záznamy</h2>'
        + (records.length
            ? '<div class="today-list">' + records.map((r) => todayRow('doc', r)).join('') + '</div>'
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
       a na skrytej obrazovke by sa kreslilo do prázdna.

       To isté poradie platí aj pre adresu, a je to JEDNO gesto = JEDEN záznam
       v histórii: `setScreen()` robí `pushState` (a zmetie kľúče filtrov cudzích
       obrazoviek), `setJournalProject()` hneď za ním dopíše `dep` cez `replace`.
       Výsledok je jediný nový záznam s `?s=dennik&dep=…`. Obrátené poradie by
       `dep` stratilo práve v tom zmetení. */
    body.querySelectorAll('.today-chip[data-project]').forEach((chip) => {
        chip.onclick = () => {
            setScreen('dennik');
            setJournalProject(chip.dataset.project || null);
        };
    });

    /* Fokus: otvorenie uzla, dve rozhodnutia a dva preskoky. `data-goto` je
       jeden atribút pre obe destinácie, aby sa nepridával druhý handler na to
       isté gesto. */
    body.querySelectorAll('.focus-open[data-id]').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    body.querySelectorAll('.focus-act[data-verify]').forEach((el) => {
        el.onclick = () => busy(el, () => focusDecide(el.closest('.focus-row'), el.dataset.verify, 'verify'), '…');
    });
    body.querySelectorAll('.focus-act[data-resolve]').forEach((el) => {
        el.onclick = () => busy(el, () => focusDecide(el.closest('.focus-row'), el.dataset.resolve, 'resolve'), '…');
    });
    body.querySelectorAll('[data-goto]').forEach((el) => {
        el.onclick = () => setScreen(el.dataset.goto);
    });

    bindPackButtons(body);
}

/* DNEŠNÝ FOKUS (kontrakt E5 + E6) — čo čaká na človeka, hneď pod hlavným číslom.
   Tri veci a každá mieri inam: poznatky na overenie sa dajú vyriešiť PRIAMO tu,
   zaparkované zápisy vedú do Charóna a otvorené behy na Runy.

   Keď nečaká nič, sekcia sa NEKRESLÍ vôbec. Prázdny stav by tu bol horší než
   ticho: „nič nečaká" už hlási hero (`.hero-action.is-clear`) a druhá veta o tom
   istom by z pokoja urobila oznam.

   Fronta sa nekrátí tu — server posiela tri (KontrolaScreen s limitom 3). */
function focusHtml(dash) {
    const f = (dash || {}).focus || {};
    const review = Array.isArray(f.review) ? f.review : [];
    const writes = +f.pending_writes || 0;
    const runs = +f.open_runs || 0;
    const more = Math.max(0, (+f.review_total || 0) - review.length);
    if (!review.length && !writes && !runs) return '';

    let h = '<section class="today-sec focus-sec"><h2>Čaká na teba</h2>';

    if (review.length) {
        h += '<div class="focus-list">';
        for (const r of review) {
            h += '<div class="focus-row" data-review-id="' + esc(r.id) + '">'
                + '<button type="button" class="focus-open" data-id="' + esc(r.id) + '"'
                + ' data-label="' + esc(r.label || '') + '">'
                + '<span class="focus-title">' + esc(prettyLabel(r.label, r.project)) + '</span>'
                + (r.area_name ? '<span class="focus-area">' + esc(r.area_name) + '</span>' : '')
                + '</button>'
                /* Dve akcie, obe cez existujúce endpointy Kontroly — Dnes si
                   nevymýšľa tretiu cestu k tej istej fronte. */
                + '<span class="focus-acts">'
                + '<button type="button" class="focus-act" data-verify="' + esc(r.id) + '">Overiť</button>'
                + '<button type="button" class="focus-act ghost" data-resolve="' + esc(r.id) + '">Vyriešiť</button>'
                + '</span></div>';
        }
        h += '</div>';
        if (more) {
            h += '<button type="button" class="focus-more" data-goto="kontrola">'
                + 'a ďalších ' + esc(fmtNum(more)) + ' v Kontrole</button>';
        }
    }

    if (writes || runs) {
        h += '<div class="focus-chips">';
        if (writes) {
            h += '<a class="focus-chip" href="/chat">' + iconMarkup('send')
                /* Zhoduje sa AJ SLOVESO, nie len podstatné meno: po slovensky je
                   „1 zápis čaká“, ale „2 zápisy čakajú“ a „5 zápisov čaká“.
                   plural() vracia tvar podľa toho istého pravidla, takže sa volá
                   dvakrát — raz na predmet, raz na sloveso. */
                + esc(fmtNum(writes)) + ' ' + plural(writes, 'zápis', 'zápisy', 'zápisov')
                + ' ' + plural(writes, 'čaká', 'čakajú', 'čaká') + ' na potvrdenie</a>';
        }
        if (runs) {
            h += '<button type="button" class="focus-chip" data-goto="runy">' + iconMarkup('bolt')
                + esc(fmtNum(runs)) + ' ' + plural(runs, 'otvorený beh', 'otvorené behy', 'otvorených behov')
                + '</button>';
        }
        h += '</div>';
    }

    return h + '</section>';
}

/* Inline rozhodnutie o poznatku (E5). Po úspechu riadok ODÍDE a číslo v hero
   klesne — a to je celé potvrdenie (politika J2: viditeľná zmena hlási sama).
   Zlyhanie hlási toast, pretože riadok zostane a dôvod treba prečítať. */
async function focusDecide(row, id, kind) {
    const url = kind === 'verify'
        ? '/api/nodes/' + encodeURIComponent(id) + '/verify'
        : '/api/nodes/' + encodeURIComponent(id) + '/resolve-review';
    let res;
    try {
        res = await fetch(url, { method: 'POST' });
    } catch (e) {
        showToast(kind === 'verify' ? 'Overenie zlyhalo' : 'Akcia zlyhala', null, 'error');
        return;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
        showToast(j.message || j.error || 'Akcia zlyhala', null, 'error');
        return;
    }
    row.remove();
    /* Hero číslo je JEDINÝ ďalší nositeľ tej istej fronty na tejto obrazovke,
       takže sa musí pohnúť s ňou — inak by karta hlásila štyri a zoznam dva.
       Server posiela nový počet v `queue_total`; keď ho nepošle, dopočítame −1,
       čo je pri jednej vyriešenej položke dokázateľné. */
    const heroVal = document.querySelector('#hero-review .ha-val');
    if (heroVal) {
        const next = Number.isFinite(+j.queue_total)
            ? +j.queue_total
            : Math.max(0, (parseInt(heroVal.textContent.replace(/\s/g, ''), 10) || 0) - 1);
        heroVal.textContent = fmtNum(next);
        if (next === 0) {
            const btn = $('hero-review');
            if (btn) btn.remove();
        }
    }
    // Sekcia bez riadkov a bez čipov už nemá čo hlásiť.
    const sec = document.querySelector('.focus-sec');
    if (sec && !sec.querySelector('.focus-row') && !sec.querySelector('.focus-chip')) sec.remove();
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

    /* KPI karta nesie ČÍSLO, DELTU a TVAR (kontrakt E4).
       Delta je prírastok za posledných 7 dní zo servera (`kpi_trend[key].week`),
       nie rozdiel dopočítaný v prehliadači — dopočet by potreboval stav z minulého
       načítania a ten nikde nie je.

       Znamienko je len PLUS alebo nič: tieto štyri metriky v Hadesovi neklesajú
       (uzly, hrany, playbooky a rozhodnutia sa pridávajú), takže `--trend-down`
       tu zámerne nepoužívam — červená pri metrike, ktorá nemôže spadnúť, by bola
       výstraha bez obsahu. Rola v palete existuje pre metriky, ktoré klesať vedia.

       Sparkline sa NEKRESLÍ TU: `dashboardHtml()` skladá string a SVG potrebuje
       živý prvok. Kontejner dostane `data-spark`, kresbu doplní
       `renderDashboardBlocks()` — tá istá deľba ako u heatmapy a donutu. */
    const kpi = (val, label, suffix, trendKey) => {
        const t = (dash.kpi_trend || {})[trendKey] || {};
        const week = +t.week || 0;
        return '<div class="kpi-card"><div class="kpi-val">' + num(val)
            + (suffix ? '<span class="kpi-suffix">' + esc(suffix) + '</span>' : '')
            + '</div><div class="kpi-label">' + esc(label) + '</div>'
            + (week > 0
                ? '<div class="kpi-delta" data-trend="up">+' + num(week)
                  + '<span class="kpi-delta-lbl"> za týždeň</span></div>'
                : '<div class="kpi-delta" data-trend="flat">bez zmeny'
                  + '<span class="kpi-delta-lbl"> za týždeň</span></div>')
            + (Array.isArray(t.points) && t.points.length > 1
                ? '<div class="kpi-spark" data-spark="' + esc(trendKey) + '"></div>'
                : '')
            + '</div>';
    };

    let h = '<section class="today-hero">'
        + '<div class="hero-main">'
        + '<div class="hero-val">' + num(counts.nodes) + '<span class="hero-unit">'
        + plural(counts.nodes ?? 0, 'uzol', 'uzly', 'uzlov') + ' vo vedomí</span></div>'
        + weekLine(wb)
        + '</div>'
        + (review
            ? '<button type="button" id="hero-review" class="hero-action">'
              + iconMarkup('check-list') + ''
              + '<span class="ha-val">' + num(review) + '</span>'
              + '<span class="ha-lbl">' + plural(review, 'poznatok', 'poznatky', 'poznatkov')
              + ' čaká na overenie</span></button>'
            : '<div class="hero-action is-clear">' + iconMarkup('check-circle')
              + '<span class="ha-lbl">Nič nečaká na overenie</span></div>')
        + '</section>';

    h += focusHtml(dash);

    h += '<div class="kpi-grid">'
        + kpi(counts.edges, 'spojení', null, 'edges')
        // „brain"/„session" boli jediné neslovenské popisky na dashboarde; appka tie
        // isté množiny inde nazýva Playbooky a Záznamy (viď filter zdrojov v blade).
        + kpi(counts.brain, 'playbookov', null, 'playbooks')
        + kpi(counts.session, 'záznamov', null, 'records')
        + kpi(counts.decisions, 'rozhodnutí', null, 'decisions')
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
    /* PERCENTO nesie legenda, nie donut (kontrakt E3). Malý segment sa z kresby
       prečítať nedá — hypotéza je 24 z 2 773, teda 0,9 % kruhu ≈ 3 stupne — a
       donut sa kvôli tomu deformovať NESMIE: minimálny viditeľný oblúk by z
       pomeru urobil lož. Číslo a podiel sú preto v legende a v tooltipe.

       Súčet sa počíta z tých istých štyroch riadkov, nie z `cert.total`:
       keby sa rozišli, percentá by nedali 100 a nikto by nevedel, ktorá
       hodnota je tá zlá. */
    const sum = rows.reduce((a, r) => a + (+r[2] || 0), 0);
    const pct = (v) => (sum > 0 ? ((+v || 0) / sum * 100).toFixed(1).replace('.', ',') : '0,0');
    return '<div class="cert-legend">'
        + rows.map((r) =>
            '<div class="cl-row" data-cert="' + r[0] + '">'
            + '<span class="cl-sw"></span>'
            + '<span class="cl-name">' + esc(r[1]) + '</span>'
            + '<span class="cl-pct">' + esc(pct(r[2])) + '&nbsp;%</span>'
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

    const bits = [
        ['+' + (sync.created ?? 0), 'nových'],
        ['~' + (sync.updated ?? 0), 'zmien'],
        ['−' + (sync.deleted ?? 0), 'zmazaných'],
        ['»' + (sync.skipped ?? 0), 'preskočených'],
    ];
    /* Vzhľad drží CSS (.sync-*), nie inline štýly. Bola to jediná karta na Dnes,
       ktorá si ho skládala v JS — zmena rozloženia by sa tu musela robiť v inom
       jazyku než vo zvyšku obrazovky. */
    const stats = '<div class="sync-stats">'
        + bits.map((b) => '<span><strong>' + esc(b[0]) + '</strong> ' + esc(b[1]) + '</span>').join('')
        + '</div>';

    return '<div class="dash-card"><div class="dash-head">'
        + '<span class="dash-title">Synchronizácia</span>'
        + '<span class="dash-note">' + (sync.finished_at ? esc(timeAgo(sync.finished_at)) : '—') + '</span>'
        + '</div>'
        + '<div class="sync-row sync-state">'
        + '<span class="status-dot" data-status="' + status + '"></span><span>' + esc(statusLabel) + '</span></div>'
        + (sync.message ? '<p class="sync-msg">' + esc(sync.message) + '</p>' : '')
        + stats
        + '<div class="sync-row sync-guard">'
        + iconMarkup((guardOn ? 'lock-open' : 'lock')) + ''
        + 'Zápis do playbookov: <strong>' + (guardOn ? 'zapnutý' : 'vypnutý') + '</strong></div>'
        + '<button type="button" id="sync-now" class="primary sync-btn">'
        + iconMarkup('refresh') + ' Synchronizovať</button>'
        + '</div>';
}

/* RAST SIETE — tri obdobia z JEDNÝCH dát (kontrakt F4).
   Hokejku nespôsobil graf, ale to, že kreslil KUMULÁCIU: pamäť vznikla za
   posledné dva mesiace, takže desať mesiacov leží na nule a potom sa zdvihne
   stena. Zmerané na živých dátach: 12 mesačných bodov 0,0,0,…,734,2775.

   Prepínač preto nemení len výrez, ale aj VELIČINU:
     · 30 d    denné prírastky z heatmapy (tie dáta už v odpovedi sú)
     · rok     mesačné prírastky (diff kumulácie)
     · všetko  kumulácia, teda pôvodný graf
   Prírastok je to, čo človek hľadá („čo sa deje"), kumulácia to, čo hlási
   veľkosť („kde sme"). Obe sú pravda, len odpovedajú na inú otázku.

   ČO PREPÍNAČ NEROBÍ — zmerané 28. 8. 2026 na živých dátach, aby to nikto
   nemusel skúšať znova: mesačný prírastok hokejku NEVYROVNÁ. Podiel maxima na
   súčte je 0,735 proti 0,791 pri kumulácii a bodov pod 2 % výšky je v oboch
   prípadoch 10 z 12. Dáta taký tvar naozaj majú — 2 041 uzlov pribudlo v jednom
   mesiaci. Čitateľnosť zlepšuje až 30-dňový pohľad (podiel maxima 0,264), a aj
   tam je 15 z 30 dní na nule. Keby to raz malo byť čitateľné aj v ročnom
   pohľade, je na to logaritmická os — nie ďalšia veličina.

   PREČO SA TO POČÍTA V PREHLIADAČI: nie sú to nové fakty, ale prevod už
   doručených čísel (CLAUDE.md: dátové veci na server, ale toto nie je nový
   údaj — je to tá istá rada inak zosumovaná). Nový endpoint by znamenal zmenu
   serializéra a registra parity za nulovú novú informáciu. */
function growthSeries(dash, period) {
    const g = dash.growth || {};
    const labels = Array.isArray(g.labels) ? g.labels : [];
    const values = Array.isArray(g.values) ? g.values.map((v) => +v || 0) : [];

    if (period === 'all') return { labels: labels, values: values };

    if (period === 'year') {
        // diff kumulácie; prvý bod nemá predchodcu, takže je sám sebe prírastkom
        const out = values.map((v, i) => (i ? Math.max(0, v - values[i - 1]) : v));
        return { labels: labels, values: out };
    }

    // 30 d — denné počty z heatmapy. Mriežka je pole týždňov po 7 dní (null =
    // deň mimo rozsahu), takže sa najprv sploští a až potom kráti.
    const weeks = (dash.heatmap || {}).weeks;
    if (!Array.isArray(weeks)) return null;
    const days = [];
    for (const w of weeks) {
        if (!Array.isArray(w)) continue;
        for (const d of w) if (d) days.push(d);
    }
    if (!days.length) return null;
    const last = days.slice(-30);
    return {
        labels: [last[0].date, last[last.length - 1].date],
        values: last.map((d) => +d.count || 0),
        dateLabels: true,
    };
}

const GROWTH_PERIODS = [
    { key: '30d', label: '30 d' },
    { key: 'year', label: 'rok' },
    { key: 'all', label: 'všetko' },
];
// Voľba prežije prekreslenie dashboardu, ale nie reload — je to pohľad na graf,
// nie nastavenie appky, takže do localStorage nepatrí.
let growthPeriod = 'year';

export function renderGrowth(container, dash) {
    const draw = () => {
        container.innerHTML = '';
        const series = growthSeries(dash, growthPeriod);
        if (!series || !series.values.length) {
            HadesCharts.emptyChart(container, 'Zatiaľ žiadny rast');
        } else {
            const box = document.createElement('div');
            container.appendChild(box);
            HadesCharts.growthLine(box, series);
        }
        // Prepínač sa kreslí ZNOVA po každom prekreslení, aby si držal stav
        // aktívneho obdobia bez druhého zdroja pravdy.
        container.appendChild(HadesCharts.periodSwitch(GROWTH_PERIODS, growthPeriod, (k) => {
            growthPeriod = k;
            draw();
        }));
    };
    draw();
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
        /* `label` posiela VOLAJÚCI, nie charts.js: slovník istoty je slovo a slová
           patria do prehliadača (rovnaké pravidlo ako pri `certLegend`). Bez neho
           tooltip vypisoval kľúč — „overene" namiesto „overené". */
        HadesCharts.donut(donutEl, [
            { cert: 'overene', label: 'overené', value: c.overene || 0 },
            { cert: 'hypoteza', label: 'hypotéza', value: c.hypoteza || 0 },
            { cert: 'pasca', label: 'pasca', value: c.pasca || 0 },
            { cert: 'bez', label: 'bez značky', value: c.bez || 0 },
        ], { total: c.total || 0, centerLabel: 'uzlov' });
    }

    const growth = $('dash-growth');
    if (growth) renderGrowth(growth, dash);

    /* Sparkline KPI kariet — kreslí sa až tu, nad živými prvkami (dashboardHtml
       skladá string). Trend je 'up' alebo 'flat' podľa toho, či za týždeň niečo
       pribudlo; hodnotu aj deltu nesie text karty, takže SVG je aria-hidden a
       čítačka ho preskočí. */
    for (const box of document.querySelectorAll('.kpi-spark[data-spark]')) {
        const t = (dash.kpi_trend || {})[box.dataset.spark] || {};
        if (!Array.isArray(t.points) || t.points.length < 2) continue;
        HadesCharts.sparkline(box, t.points, { trend: (+t.week || 0) > 0 ? 'up' : 'flat' });
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
    }, 'Synchronizuje sa…');
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

/* Riadok záznamu. Berie celý záznam zo servera, nie šesť rozbalených argumentov:
   `snippet` už prichádza bez markdownu (predtým ho tu čistil `plainText`, takže
   človek videl vetu a AI surové „**Čo:** …") a `project_label` je hotová skupina. */
export function todayRow(icon, r) {
    return '<div class="li-wrap">'
        + '<button type="button" class="today-item" data-id="' + r.id + '" data-label="' + esc(r.label || '') + '">'
        + iconMarkup(icon, { cls: 'ti-ico' }) + ''
        + '<span class="ti-text"><span class="ti-title">' + esc(prettyLabel(r.label, r.project)) + '</span>'
        + (r.snippet ? '<span class="ti-snip">' + esc(r.snippet) + '</span>' : '')
        + '</span>'
        + (r.project ? '<span class="ti-tag">' + esc(r.project_label || '') + '</span>' : '')
        + (r.created_at ? '<span class="ti-time">' + esc(timeAgo(r.created_at)) + '</span>' : '')
        + '</button>'
        + packBtn(r.id, r.label) + '</div>';
}
