import { CERT_META, certBadge } from '../certainty.js';
import { clearLocal } from '../filters.js';
import { setRailBadge } from '../rail.js';
import { openNodeDetail, openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { S } from '../state.js';
import { showToast, showUndoToast } from '../toasts.js';
import { $, busy, emptyHtml, esc, getJson, plainInline, plainText, renderEmpty, renderLoading, timeAgo, typeName } from '../util.js';

/* ---------- obrazovka Kontrola (/api/review/queue) — verify/review fronta ----------
   Fronta needs_review uzlov (.queue*), klávesnica j/k/Enter/v/r/Delete (len na
   tejto obrazovke, viď setupShortcuts). Akcie: Overiť (verify), Vyriešiť
   (resolve-review), Preskočiť (lokálne, s undo). Rail badge cez setRailBadge.

   FILTRE SÚ SERVEROVÉ a to je celý dôvod, prečo tu vôbec sú. Fronta má strop na
   jednu stránku (`KontrolaScreen::DEFAULT_LIMIT`), takže filtrovať načítanú
   stovku v prehliadači by znamenalo prehľadávať práve tú časť fronty, ktorú už
   aj tak vidno — a zvyšok by ostal neviditeľný ďalej. Osi filtra (`counts`,
   `areas`) počíta server nad CELOU frontou, nie nad stránkou, takže čipy hovoria
   o práci, ktorá čaká, nie o tej, ktorá sa zmestila. */

/* Strop jednej stránky. Musí sedieť s `KontrolaScreen::DEFAULT_LIMIT` — je to
   to isté číslo na dvoch stranách drôtu a nesie ho aj popisok „Načítať ďalších". */
const KONTROLA_PAGE = 100;

/* Tvrdý strop servera (`KontrolaScreen::MAX_LIMIT`). Nad ním sa `limit` orezáva,
   takže tlačidlo „Načítať ďalších" by od tohto miesta nespravilo nič — a tlačidlo,
   ktoré nič nespraví, je horšie než žiadne. Poznámka to preto povie slovom. */
const KONTROLA_MAX = 500;

export const kontrolaState = {
    items: [], idx: 0, total: 0,
    /* `total` je celá fronta (nesie ho rail a je zámerne nefiltrovaný),
       `matching` je počet uzlov vyhovujúcich filtru, `shown` je to, čo naozaj
       prišlo v poslednej odpovedi. Bez všetkých troch sa nedá povedať ani
       „zobrazených 100 zo 140", ani či má zmysel ponúkať ďalšiu stránku. */
    matching: 0, shown: 0, limit: KONTROLA_PAGE,
    counts: {}, areas: [],
    f: { type: '', certainty: '', area: '', q: '' },
};

// Poradové číslo dotazu — hľadanie je debouncované, ale nie serializované, takže
// pomalšia STARŠIA odpoveď dokáže prepísať novšiu (rovnaká pasca ako v Knižnici).
let kontrolaSeq = 0;
let kontrolaQTimer = null;

export function kontrolaFiltersActive() {
    const f = kontrolaState.f;
    return !!(f.type || f.certainty || f.area || f.q);
}

function kontrolaQuery() {
    const f = kontrolaState.f;
    const p = new URLSearchParams();
    if (f.type) p.set('type', f.type);
    if (f.certainty) p.set('certainty', f.certainty);
    if (f.area) p.set('area', f.area);
    if (f.q) p.set('q', f.q);
    p.set('limit', String(kontrolaState.limit));
    return '?' + p.toString();
}

/* `soft` = prekreslenie vyvolané filtrom alebo tlačidlom „Načítať ďalších".
   Toolbar vtedy ostáva stáť: je v ňom <input>, do ktorého sa práve píše, a
   načítavacia značka cez celé telo obrazovky by ho aj s kurzorom vyhodila. */
export async function renderKontrola(soft) {
    const body = $('kontrola-body');
    if (!body) return;
    const seq = ++kontrolaSeq;
    const list = $('kontrola-list');
    if (soft && list) renderLoading(list, 'Načítava sa fronta…');
    else renderLoading(body, 'Načítavam frontu…');
    try {
        const d = await getJson('/api/review/queue' + kontrolaQuery());
        if (seq !== kontrolaSeq) return;                // medzitým prišiel novší dotaz
        kontrolaState.items = d.queue || [];
        // `total` je serverové číslo a nesie ho rail. Fallback na `items.length`
        // tu bol tichá lož: fronta má strop 100, takže pri 140 čakajúcich uzloch
        // by rail hlásil 100. Server ho posiela vždy (App\Serializers\Screen\
        // KontrolaScreen) a je zámerne NEfiltrovaný.
        kontrolaState.total = d.total || 0;
        const c = d.counts || {};
        kontrolaState.counts = c;
        kontrolaState.areas = d.areas || [];
        // Fallback na `total` drží obrazovku funkčnú aj proti staršiemu serveru,
        // ktorý `matching` ešte nepozná — vtedy len nevie o skrytom zvyšku.
        kontrolaState.matching = c.matching != null ? c.matching : kontrolaState.total;
        kontrolaState.shown = c.shown != null ? c.shown : kontrolaState.items.length;
        if (d.limit) kontrolaState.limit = d.limit;
        // Zapnutý filter bez čipu je pasca — a pozná sa až z novej osi, teda tu.
        if (pruneKontrolaFilters()) { renderKontrola(true); return; }
        kontrolaState.idx = 0;
        // pri `soft` je fokus tam, kde ho človek nechal (čip alebo hľadanie) — nebrať ho
        rerenderKontrola(!soft && canTakeKontrolaFocus());
        // Hygiena sa dotiahne AŽ POTOM a raz za načítanie stránky: je to prechod
        // celou sieťou (uzly + hrany), nie dopyt, takže by inak fronta čakala na
        // niečo, čo s ňou nesúvisí. Filtrovanie fronty ju nespúšťa znovu.
        loadHygiena(false);
    } catch (e) {
        if (seq !== kontrolaSeq) return;
        // pri filtrovaní ostáva toolbar, inak by sa zlý filter nedal ani zrušiť
        renderEmpty((soft && $('kontrola-list')) || body,
            'cloud_off', 'Nepodarilo sa načítať frontu', 'Skús obnoviť stránku.');
    }
}

/* Prvé vykreslenie fronty označilo prvú položku vizuálne, ale fokus prehliadača tam
   nebol, kým človek nestlačil j/k — Tab preto začínal odznova od hlavičky a čítač
   obrazovky o výbere nevedel. Fokus si ale nemôžeme vziať vždy: `/api/review/queue`
   beží stovky ms a človek medzitým môže byť úplne inde (písať do hľadania, otvoriť
   paletu). Berieme ho len tam, kde oň nikto iný nestojí: prázdny fokus, tlačidlo
   railu, ktorým sa sem prišlo, alebo už niečo vnútri tejto obrazovky. */
function canTakeKontrolaFocus() {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return true;
    if (a.id === 'dest-kontrola') return true;
    return !!(a.closest && a.closest('#screen-kontrola'));
}

/* moveFocus=true — prekreslenie po AKCII (overiť / vyriešiť / preskočiť / zmazať).
   innerHTML vymení celý zoznam, takže fokus by inak zostal na <body> presne v tom
   okamihu, keď človek pokračuje v práci s frontou. */
export function rerenderKontrola(moveFocus) {
    const body = $('kontrola-body');
    if (!body) return;
    setRailBadge('kontrola', kontrolaState.total);
    ensureKontrolaShell(body);
    syncKontrolaFilter();
    // Musí to byť TU, nie za zoznamom: pri prázdnej fronte sa nižšie vracia
    // skoro, a sekcia hygieny by po prestavbe shellu zostala prázdna práve vtedy,
    // keď je jediné, čo obrazovka ešte má čo povedať.
    renderHygiena();
    const list = $('kontrola-list');
    const items = kontrolaState.items;
    if (!items.length) {
        // Prázdno POD filtrom je iná veta než prázdna fronta — a musí ísť do
        // zoznamu, nie cez celé telo: keby zmizol toolbar, filter, ktorý všetko
        // odrezal, by sa nedal zrušiť ničím okrem prechodu na inú obrazovku.
        list.innerHTML = kontrolaFiltersActive()
            ? emptyHtml('fact_check', 'Filtru nevyhovuje ani jeden uzol', 'Zruš filter a uvidíš celú frontu.')
            : emptyHtml('fact_check', 'Fronta na overenie je prázdna', 'Nové poznatky sem prídu po ďalšej session.');
        return;
    }
    kontrolaState.idx = Math.max(0, Math.min(kontrolaState.idx, items.length - 1));
    list.innerHTML = '<div class="queue">'
        + items.map((n, i) => queueItemHtml(n, i)).join('')
        + '</div>' + kontrolaHintsHtml();
    wireKontrola(list);
    if (moveFocus) markKontrolaSelected(true);
}

/* Toolbar a zoznam sú dva samostatné bloky, nie jeden innerHTML. Hľadanie je
   <input> a každé prekreslenie fronty (overiť, vyriešiť, preskočiť, nová
   odpoveď) by ho aj s kurzorom vymenilo za nový prázdny.

   Toolbar sa preto stavia len keď sa zmenia OSI. Tie počíta server nad celou
   frontou, nie nad filtrom (viď `KontrolaScreen::base()`), takže klikanie do
   filtra ani písanie do hľadania nimi nehýbe — a input prežije. */
let kontrolaAxisSig = null;

function kontrolaAxisSignature() {
    const c = kontrolaState.counts || {};
    return JSON.stringify([c.by_type || {}, c.by_certainty || {},
        kontrolaState.areas.map((a) => [a.slug, a.count])]);
}

function ensureKontrolaShell(body) {
    const sig = kontrolaAxisSignature();
    if ($('kontrola-list') && kontrolaAxisSig === sig) return;
    kontrolaAxisSig = sig;
    /* Hygiena je tretí blok tej istej obrazovky a stojí POD frontou: fronta je
       práca, hygiena je stav. `aria-live` je tu preto, že obsah dobehne sám
       (meranie beží sekundy) — bez neho by čítačka o výsledku nevedela.

       Odstup je INLINE a je to dočasné: `.kbd-hints` pod frontou má margin-top,
       ale nie margin-bottom, takže karta by sa nalepila na pás skratiek.
       Patrí to do `mind.css` ako `#kontrola-hygiene { margin-top: var(--gutter) }`
       — ten súbor v tejto vlne drží iný agent, tak nech je odstup vidieť tu
       a nech sa presunie jedným riadkom. */
    body.innerHTML = '<div id="kontrola-filter"></div><div id="kontrola-list"></div>'
        + '<div class="dash-card" id="kontrola-hygiene" style="margin-top:var(--gutter)"'
        + ' aria-live="polite"></div>';
    $('kontrola-filter').innerHTML = kontrolaFilterHtml();
    wireKontrolaFilter();
}

/* Filtračný čip hovorí tým istým jazykom ako v Denníku a v Rozhodnutiach:
   popisok + počet v .chip-n. Je to zámerne vlastná kópia trojriadkového helperu
   a nie import z `rozhodnutia.js` — cudzí súbor prepisuje iná vlna a väzba naň
   by kvôli trom riadkom rozbila obrazovku, ktorá s Rozhodnutiami nesúvisí. */
function kfChip(label, active, attrs, n) {
    // `aria-pressed` je povinné: bez neho nesie zapnutý filter LEN farba a čítačka
    // o ňom nevie nič. Vzor je `runy.js` (chip()) — ten istý atribút, nie druhý
    // mechanizmus. Aktívny stav sa dopĺňa aj v syncKontrolaFilter(), inak by sa
    // trieda a atribút po prekliku rozišli.
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '" ' + attrs + '>'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
}

// Len hodnoty, ktoré serializér naozaj prijíma — čip pre `bez istoty` by sa
// tváril ako filter a server by ho ticho zahodil (viď KontrolaScreen::active()).
const KF_TYPES = ['core', 'skill', 'project', 'memory'];
const KF_CERTS = ['overene', 'hypoteza', 'pasca'];

function kontrolaFilterHtml() {
    const f = kontrolaState.f;
    const c = kontrolaState.counts || {};
    const total = c.total != null ? c.total : kontrolaState.total;
    const rows = [];

    // Rad sa vypisuje len keď je z čoho vyberať — jediná hodnota nie je filter,
    // len šum (rovnaké pravidlo ako `years.length > 1` v Rozhodnutiach).
    const byType = c.by_type || {};
    const types = KF_TYPES.filter((t) => byType[t]);
    if (types.length > 1) {
        rows.push(kfChip('Všetky typy', !f.type, 'data-kf="type" data-val=""', total)
            + types.map((t) => kfChip(typeName(t), f.type === t,
                'data-kf="type" data-val="' + t + '"', byType[t])).join(''));
    }

    const byCert = c.by_certainty || {};
    const certs = KF_CERTS.filter((k) => byCert[k]);
    if (certs.length > 1) {
        rows.push(kfChip('Každá istota', !f.certainty, 'data-kf="certainty" data-val=""', total)
            + certs.map((k) => kfChip(CERT_META[k][1], f.certainty === k,
                'data-kf="certainty" data-val="' + k + '"', byCert[k])).join(''));
    }

    const areas = kontrolaState.areas || [];
    if (areas.length > 1) {
        rows.push(kfChip('Všetky oblasti', !f.area, 'data-kf="area" data-val=""', total)
            + areas.map((a) => kfChip(a.name, f.area === a.slug,
                'data-kf="area" data-val="' + esc(a.slug) + '"', a.count)).join(''));
    }

    /* Posledný rad je hľadanie + to, čo obrazovka o sebe priznáva: koľko z fronty
       je naozaj na nej a čím sa dá dotiahnuť zvyšok.

       Rozmery sú inline a obe čísla sú nutnosť: základný štýl vstupov je
       `width:100%`, takže bez `width:auto` pole vytlačí poznámku aj tlačidlo
       z riadku — a bez `flex-grow:0` (teda `flex:0 1`) narastie cez celý riadok
       a poznámku pritlačí na okraj obrazovky. `type="search"` zámerne NIE: dal by
       polu natívny modrý krížik, ktorý s akcentom nemá nič spoločné, a `#library-search`
       ho tiež nemá. */
    rows.push('<input id="kontrola-q" value="' + esc(f.q) + '"'
        + ' placeholder="Hľadať vo fronte…" autocomplete="off" aria-label="Hľadať vo fronte"'
        + ' maxlength="200">'
        + '<span class="chip-more" id="kontrola-note" aria-live="polite"></span>'
        + '<button type="button" id="kontrola-more" class="chip hidden"></button>');

    return rows.map((r) => '<div class="dtl-filter">' + r + '</div>').join('');
}

/* Čo sa mení bez prestavby toolbaru: aktívny čip, veta o strope a tlačidlo
   ďalšej stránky. Preto sú to triedy a textContent, nie nový innerHTML. */
function syncKontrolaFilter() {
    const wrap = $('kontrola-filter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-kf]').forEach((el) => {
        const on = (kontrolaState.f[el.dataset.kf] || '') === el.dataset.val;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const note = $('kontrola-note');
    if (note) note.textContent = kontrolaNoteText();
    const more = $('kontrola-more');
    if (more) {
        // Zvyšok počítame zo `shown` (čo prišlo zo servera), nie z `items.length`:
        // preskočenie je lokálne a zmenšuje zoznam bez toho, aby na serveri
        // pribudlo čo dotiahnuť.
        const rest = kontrolaState.matching - kontrolaState.shown;
        const capped = kontrolaState.shown >= KONTROLA_MAX;
        more.classList.toggle('hidden', rest <= 0 || capped);
        if (rest > 0 && !capped) more.textContent = 'Načítať ďalších ' + Math.min(KONTROLA_PAGE, rest);
    }
}

/* Filter, ktorý po novom načítaní nemá vo svojej osi čip, je pasca: rady sa
   vypisujú len keď je z čoho vyberať, takže po overení posledného uzla daného
   typu by filter ostal zapnutý BEZ čipu, ktorým sa zruší — a fronta by vyzerala
   trvalo prázdna. Rozhodnutia to isté robia v `pruneDecisionFilters`.
   Vracia true, keď sa niečo zhodilo a treba sa spýtať znova. */
function pruneKontrolaFilters() {
    const c = kontrolaState.counts || {};
    const f = kontrolaState.f;
    let changed = false;
    // podmienka MUSÍ byť tá istá ako v kontrolaFilterHtml (rad len pri > 1 voľbe)
    const drop = (key, options) => {
        if (f[key] && !(options.length > 1 && options.indexOf(f[key]) >= 0)) {
            f[key] = '';
            changed = true;
        }
    };
    drop('type', KF_TYPES.filter((t) => (c.by_type || {})[t]));
    drop('certainty', KF_CERTS.filter((k) => (c.by_certainty || {})[k]));
    drop('area', (kontrolaState.areas || []).map((a) => a.slug));
    return changed;
}

function kontrolaNoteText() {
    const shown = kontrolaState.items.length;
    const m = kontrolaState.matching;
    if (m > shown) {
        return 'Zobrazených ' + shown + ' zo ' + m
            + (kontrolaState.shown >= KONTROLA_MAX ? ' — ďalej už len filtrom' : '');
    }
    if (kontrolaFiltersActive()) return 'Filtru vyhovuje ' + shown + ' zo ' + kontrolaState.total;
    return '';
}

function wireKontrolaFilter() {
    const wrap = $('kontrola-filter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-kf]').forEach((el) => {
        el.onclick = () => {
            const key = el.dataset.kf;
            if ((kontrolaState.f[key] || '') === el.dataset.val) return;
            kontrolaState.f[key] = el.dataset.val;
            // nový filter = nová fronta, takže strop ide späť na prvú stránku
            kontrolaState.limit = KONTROLA_PAGE;
            renderKontrola(true);
        };
    });
    const q = $('kontrola-q');
    if (q) {
        q.oninput = () => {
            clearTimeout(kontrolaQTimer);
            // 220 ms ako v Knižnici — dopyt nesmie odísť na každý znak
            kontrolaQTimer = setTimeout(() => {
                const val = (q.value || '').trim();
                if (val === kontrolaState.f.q) return;
                kontrolaState.f.q = val;
                kontrolaState.limit = KONTROLA_PAGE;
                renderKontrola(true);
            }, 220);
        };
    }
    const more = $('kontrola-more');
    if (more) {
        more.onclick = () => { kontrolaState.limit += KONTROLA_PAGE; renderKontrola(true); };
    }
}

export function queueItemHtml(n, i) {
    // description je markdown (rovnaký zdroj ako snippety v Denníku a Knižnici), takže
    // bez plainText tu svietilo „**Čo:** …". Zlepenie riadkov robí plainText tiež,
    // pôvodné .replace(/\s+/g,' ') je v ňom obsiahnuté.
    const desc = plainText(n.description);
    return '<div class="queue-item' + (i === kontrolaState.idx ? ' selected' : '') + '"'
        + ' data-id="' + n.id + '" data-idx="' + i + '" tabindex="-1">'
        + '<div class="queue-body">'
        + '<div class="queue-meta">'
        + '<span>' + esc(typeName(n.type)) + '</span>'
        + originBadge(n.origin) + certBadge(n.certainty)
        + (n.created_at ? '<span>' + esc(timeAgo(n.created_at)) + '</span>' : '')
        + '</div>'
        + '<div class="queue-text"><strong>' + esc(plainInline(n.label)) + '</strong>'
        + (desc ? ' — ' + esc(desc) : '') + '</div>'
        + '</div>'
        + '<div class="queue-actions">'
        + '<button type="button" class="act-verify ms" data-act="verify" title="Overiť (v)" aria-label="Overiť">verified</button>'
        + '<button type="button" class="act-resolve ms" data-act="resolve" title="Vyriešiť (r)" aria-label="Vyriešiť">done_all</button>'
        + '<button type="button" class="act-skip ms" data-act="skip" title="Preskočiť" aria-label="Preskočiť">redo</button>'
        + '</div></div>';
}

export function kontrolaHintsHtml() {
    const kh = (keys, label) => '<span class="kh">'
        + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(label) + '</span>';
    return '<div class="kbd-hints">'
        + kh(['j', 'k'], 'posun')
        + kh(['Enter'], 'detail')
        + kh(['v'], 'overiť')
        + kh(['r'], 'vyriešiť')
        + kh(['Del'], 'zmazať uzol')
        + '</div>';
}

export function kontrolaNodeRef(id) {
    const n = kontrolaState.items.find((x) => x.id === id);
    return n ? { id: n.id, label: n.label, type: n.type, area_id: n.area_id } : { id };
}

export function kontrolaBtn(id, act) {
    return document.querySelector('#kontrola-body .queue-item[data-id="' + id + '"] .act-' + act);
}

export function wireKontrola(body) {
    body.querySelectorAll('.queue-item').forEach((item) => {
        const id = +item.dataset.id;
        const idx = +item.dataset.idx;
        item.addEventListener('mousedown', () => { kontrolaState.idx = idx; markKontrolaSelected(); });
        /* Fokus a `idx` musia byť jedna vec. Riadok nesie tri <button>-y s normálnym
           tabindexom, takže Tab-om sa dá stáť na tlačidlách tretej položky — kým `idx`
           ostával na nule, lebo ten sa menil len cez j/k a mousedown. Kláves `v` potom
           overil PRVÚ položku: ticho a na nesprávnom uzle. `focusin` bublá, takže jeden
           listener na riadku pokryje aj jeho tlačidlá; položky sa pri každom prekreslení
           tvoria nanovo, takže sa listenery nevrstvia. */
        item.addEventListener('focusin', () => {
            if (kontrolaState.idx === idx) return;
            kontrolaState.idx = idx;
            // bez `true`: fokus už je tam, kam ho človek dal — dorovnáva sa len výber
            markKontrolaSelected();
        });
        /* Detail sa otvára NA MIESTE (nález A4). Do 24. 8. 2026 tu bolo
           `openNodeFromAnywhere()`, teda `setScreen('graf')` — človek rozhodujúci
           frontu prišiel o obrazovku, o výber aj o klávesovú frontu, a to pri
           akcii, ktorú v rade robí desiatky krát. `openNodeDetail()` je ten istý
           idióm ako v Knižnici a v Denníku; skok na Graf je sekundárna akcia
           v pätičke overlayu. Hygiena nižšie zostáva na `openNodeFromAnywhere` —
           tam sa uzol OPRAVUJE (premenovanie, presun do oblasti), a to je panel
           v Grafe, nie čítačka markdownu. */
        const bodyEl = item.querySelector('.queue-body');
        if (bodyEl) bodyEl.onclick = () => { kontrolaState.idx = idx; openNodeDetail(kontrolaNodeRef(id)); };
        /* `Enter` musí robiť to isté, čo klik. `shortcuts.js:145` má pre `Enter`
           na tejto obrazovke `openNodeFromAnywhere()` a jeho listener je na
           window, takže bez zastavenia by klávesnica skákala na Graf a myš
           otvárala overlay — dve pravdy o jednej akcii. Zastavené je to tu,
           rovnakým chvatom, aký nižšie používa čip Hygieny. Keď sa `shortcuts.js`
           uvolní, má sa to zlúčiť s ním — akcia je jedna funkcia, takže sa
           nemôžu rozísť.

           Zastavuje sa Enter aj nad tlačidlami akcií, ale BEZ `preventDefault`:
           tam Enter patrí tlačidlu a doteraz ho `shortcuts.js` bral aj s
           `preventDefault()`, takže Enter nad „Overiť" neoveril — otvoril detail
           cudzou cestou. Natívna aktivácia tlačidla prežije stopPropagation. */
        item.onkeydown = (e) => {
            if (e.key !== 'Enter') return;
            e.stopPropagation();
            if (e.target !== item) return;
            e.preventDefault();
            kontrolaState.idx = idx;
            openNodeDetail(kontrolaNodeRef(id));
        };
        const v = item.querySelector('.act-verify');
        if (v) v.onclick = (e) => { e.stopPropagation(); kontrolaVerify(id); };
        const r = item.querySelector('.act-resolve');
        if (r) r.onclick = (e) => { e.stopPropagation(); kontrolaResolve(id); };
        const s = item.querySelector('.act-skip');
        if (s) s.onclick = (e) => { e.stopPropagation(); armKontrolaAction(s, id, 'skip'); };
    });
}

/* focus=true presunie aj skutočný fokus prehliadača na zvolenú položku (.queue-item
   má preto tabindex="-1"). Bez toho zostal fokus po každej akcii na <body>: klávesy
   j/k/v/r fungovali (listener je na window), ale čítač obrazovky ani prstenec fokusu
   nemali čo sledovať a Tab začínal odznova od hlavičky. */
export function markKontrolaSelected(focus) {
    const items = document.querySelectorAll('#kontrola-body .queue-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === kontrolaState.idx));
    const cur = items[kontrolaState.idx];
    if (!cur) return;
    if (focus) cur.focus({ preventScroll: true });
    cur.scrollIntoView({ block: 'nearest' });
}

export function kontrolaMove(delta) {
    if (!kontrolaState.items.length) return;
    const n = kontrolaState.items.length;
    kontrolaState.idx = (kontrolaState.idx + delta + n) % n;
    markKontrolaSelected(true);
}

/* Odober položku z fronty. `serverTotal` je nová dĺžka fronty, ako ju ohlásil
   server (`queue_total` v odpovedi na verify / resolve-review) — nie odhad.

   Predtým sa tu počítadlo v raile dopočítavalo (`total - 1`). To je správne len
   vtedy, keď je táto session jediný pisateľ; pri paralelnom `mind_learn` z inej
   AI alebo pri mutácii, ktorá zhodí viac než jeden uzol, rail lhal až do ďalšieho
   načítania obrazovky. Server to vie povedať presne za jednu `COUNT(*)`. */
export function removeKontrolaItem(id, serverTotal) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    kontrolaState.items.splice(i, 1);
    if (typeof serverTotal === 'number') kontrolaState.total = Math.max(0, serverTotal);
    /* Uzol opustil frontu naozaj, nielen tento zoznam — takže o jeden klesol aj
       počet vyhovujúcich filtru a o jeden je menej toho, čo by ešte prišlo. Bez
       filtra je `matching` z definície `total`, takže sa dorovná zo servera a
       nedopočítava sa. „−1" je tu dokázateľné z toho istého dôvodu ako pri
       mazaní: konkrétny uzol vypadne z fronty presne raz. */
    kontrolaState.matching = kontrolaFiltersActive()
        ? Math.max(kontrolaState.items.length, kontrolaState.matching - 1)
        : kontrolaState.total;
    kontrolaState.shown = Math.max(kontrolaState.items.length, kontrolaState.shown - 1);
    if (kontrolaState.idx > i) kontrolaState.idx--;
    rerenderKontrola(true);
}

export async function kontrolaVerify(id) {
    const btn = kontrolaBtn(id, 'verify') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/verify', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Overenie zlyhalo', null, 'error'); return; }
            removeKontrolaItem(id, j.queue_total);
            const warns = j.warnings || [];
            showToast(warns.length ? ('Overené — ' + warns[0]) : 'Overené', null, 'success');
        } catch (e) { showToast('Overenie zlyhalo', null, 'error'); }
    }, '…');
}

export async function kontrolaResolve(id) {
    const btn = kontrolaBtn(id, 'resolve') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/resolve-review', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Akcia zlyhala', null, 'error'); return; }
            removeKontrolaItem(id, j.queue_total);
            showToast('Vyriešené', null, 'success');
        } catch (e) { showToast('Akcia zlyhala', null, 'error'); }
    }, '…');
}

// Armed-inline (žiadny natívny confirm): 1. akcia ozbrojí tlačidlo, 2. potvrdí.
// kind='skip' (lokálne preskočenie + undo) alebo 'delete' (DELETE uzla).
export function disarmKontrolaBtn(btn) {
    clearTimeout(btn._disarm);
    btn.classList.remove('armed');
    btn.classList.add('ms');
    btn.textContent = 'redo';
    delete btn.dataset.armKind;
}

export function armKontrolaAction(btn, id, kind) {
    if (!btn) return;
    if (btn.classList.contains('armed') && btn.dataset.armKind === kind) {
        disarmKontrolaBtn(btn);
        if (kind === 'delete') kontrolaDelete(id); else kontrolaSkip(id);
        return;
    }
    document.querySelectorAll('#kontrola-body .act-skip.armed').forEach(disarmKontrolaBtn);
    btn.classList.add('armed');
    btn.classList.remove('ms');
    btn.dataset.armKind = kind;
    btn.textContent = kind === 'delete' ? 'Zmazať uzol?' : 'Preskočiť?';
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmKontrolaBtn(btn); }, 3000);
}

export function kontrolaSkip(id) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [removed] = kontrolaState.items.splice(i, 1);
    if (kontrolaState.idx > i || kontrolaState.idx >= kontrolaState.items.length) {
        kontrolaState.idx = Math.max(0, kontrolaState.idx - (kontrolaState.idx > i ? 1 : 0));
    }
    rerenderKontrola(true);
    // preskočenie je len lokálne (uzol ostáva v serverovej fronte) → total badge nemeníme
    showUndoToast('Preskočené', () => {
        kontrolaState.items.splice(Math.min(i, kontrolaState.items.length), 0, removed);
        kontrolaState.idx = i;
        rerenderKontrola(true);
    });
}

export async function kontrolaDelete(id) {
    const node = kontrolaState.items.find((n) => n.id === id);
    try {
        const res = await fetch('/api/nodes/' + id, { method: 'DELETE' });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            showToast(j.message || 'Nepodarilo sa zmazať', null, 'error');
            return;
        }
        // dorovnaj aj graf, ak je uzol načítaný (rovnako ako node-panel delete)
        if (node && S.byId.has(id)) {
            S.nodes = S.nodes.filter((m) => m.id !== id);
            S.edges = S.edges.filter((e) => e.source.id !== id && e.target.id !== id);
            S.byId.delete(id);
            if (S.local && S.local.rootId === id) clearLocal();
        }
        // JEDINÉ miesto, kde sa dĺžka fronty dopočítava. `DELETE /api/nodes/{id}`
        // je zdieľaný s grafom a o fronte kontroly nehovorí nič — a zmazaný uzol
        // z nej vypadne presne raz, takže „−1" je tu dokázateľné, nie odhad.
        removeKontrolaItem(id, Math.max(0, kontrolaState.total - 1));
        showToast('Uzol zmazaný', null, 'success');
    } catch (e) {
        showToast('Nepodarilo sa zmazať', null, 'error');
    }
}

/* ---------- sekcia Hygiena (/api/hygiene) — nález A3 ------------------------
   Odpad v pamäti videla doteraz LEN AI: `mind_hygiene` existoval, ale grep nad
   `public/js/mind/` a `mind.blade.php` nedal ani jeden zásah. Sekcia sedí na
   Kontrole zámerne — fronta na overenie a hygiena hovoria o tom istom: čo
   v pamäti čaká na rozhodnutie človeka. Novú obrazovku kontrakt zmrazil.

   DÁTA POČÍTA SERVER (App\Serializers\Screen\HygienaScreen — ten istý serializér
   kŕmi `mind_hygiene`, drží to `ScreenParityTest`). Tu sú len SLOVÁ a vizuál:
   slovenské popisky tried, veta o prahoch, „pred 3 min" a šírka baru.

   NIČ SA TU NEMAŽE. Recall odpad označí a zaradí za čisté uzly; oprava je
   premenovanie alebo presun uzla, takže klik na uzol vedie do jeho detailu —
   existujúcou cestou (`openNodeFromAnywhere`), nie novým zápisovým endpointom. */

/* Popisky tried odpadu. Sú tu, a nie v serializéri, podľa pravidla dvojitej
   plochy: počty a skupiny sú dáta, POPISKY sú slová. Plocha AI dostáva kľúč
   triedy (`raw-prompt`), nie slovenskú vetu — tá by v odpovedi pre model bola
   len šum. Kľúče musia sedieť s `MindHygiene::CLASSES`; neznámy kľúč sa vypíše
   ako je, aby nová trieda odpadu z UI radšej trčala než potichu zmizla. */
const HYG_NAMES = {
    'raw-prompt': 'Surová veta ako label',
    markdown: 'Markdown v labeli',
    'tag-sprawl': 'Rozlezené tagy',
    duplicate: 'Kandidát na duplicitu',
    slug: 'Strojový slug',
    oversized: 'Prerastený popis',
    misfiled: 'Zle zaradený uzol',
    stub: 'Uzol bez popisu',
    orphan: 'Sirota bez hrán',
};

/* `attempted` nie je to isté ako `loaded`: automatické načítanie sa smie stať
   RAZ, aj keď zlyhá. Bez toho by každá zmena filtra fronty spustila ďalší pokus
   o meranie celej siete — a pri nedostupnom endpointe by to bol útok na vlastný
   server, spustený klikaním do filtra. Opakovanie je vedomé, cez tlačidlo. */
export const hygienaState = { loading: false, loaded: false, attempted: false, error: false, data: null };

function hygName(key) {
    return HYG_NAMES[key] || String(key || '');
}

/* Meranie prechádza celú sieť, takže sa ťahá raz za načítanie stránky. `force`
   je tlačidlo „Zmerať znovu" — po overení alebo zmazaní uzlov je správa stará. */
export async function loadHygiena(force) {
    if (hygienaState.loading) return;
    if (hygienaState.attempted && !force) return;
    hygienaState.attempted = true;
    hygienaState.loading = true;
    hygienaState.error = false;
    renderHygiena();
    try {
        hygienaState.data = await getJson('/api/hygiene');
        hygienaState.loaded = true;
    } catch (e) {
        hygienaState.error = true;
    } finally {
        hygienaState.loading = false;
        renderHygiena();
    }
}

/* Posledný vykreslený obsah. `renderHygiena()` beží po KAŽDEJ akcii vo fronte
   (overiť, vyriešiť, preskočiť), ale správa o hygiene sa tým nemení — a keby sme
   do `aria-live` regiónu prepísali ten istý text, čítačka by ho po každom
   overení prečítala znova. Prázdny kontejner znamená, že shell sa práve
   prestavil, a vtedy sa kreslí vždy. */
let hygRendered = '';

export function renderHygiena() {
    const el = $('kontrola-hygiene');
    if (!el) return;
    const html = hygienaHtml();
    if (el.innerHTML !== '' && html === hygRendered) return;
    hygRendered = html;
    el.setAttribute('aria-busy', hygienaState.loading ? 'true' : 'false');
    el.innerHTML = html;
    wireHygiena(el);
}

function hygienaHtml() {
    const d = hygienaState.data;
    const head = '<div class="dash-head">'
        + '<span class="dash-title">Hygiena pamäti</span>'
        + '<button type="button" class="chip" id="hygiena-refresh"'
        + (hygienaState.loading ? ' disabled' : '')
        + '>' + (hygienaState.loaded || hygienaState.error ? 'Zmerať znovu' : 'Zmerať') + '</button>'
        + '</div>';

    if (hygienaState.loading) {
        return head + '<p class="dash-note">Meriam… prechádza sa celá sieť, chvíľu to trvá.</p>';
    }
    if (hygienaState.error) {
        return head + '<p class="dash-note">Hygienu sa nepodarilo zmerať.</p>';
    }
    if (!d) {
        return head + '<p class="dash-note">Ešte nezmerané.</p>';
    }

    const classes = d.classes || [];
    const rows = [hygSummaryHtml(d)];

    if (!classes.length) {
        rows.push('<p class="dash-note">Žiadny nález — v pamäti nie je čo čistiť.</p>');
        return head + rows.join('');
    }

    /* Bar nesie ZÁŤAŽ (váha × počet), nie počet: sto sirôt stojí AI menej než
       dvadsať useknutých promptov, ktoré číta ako poznatky. Serializér posiela
       `burden`, šírku v percentách počítame tu — to je vizuál, nie dáta. */
    const max = classes.reduce((m, c) => Math.max(m, c.burden || 0), 0) || 1;
    classes.forEach((c) => rows.push(hygClassHtml(c, max)));

    if ((d.worst || []).length) rows.push(hygWorstHtml(d.worst));
    rows.push('<p class="dash-note">Nič sa tu nemaže. Klikni na uzol a oprav ho '
        + 'v detaile — premenovaním alebo presunom do správnej oblasti.</p>');

    return head + rows.join('');
}

function hygSummaryHtml(d) {
    const t = d.thresholds || {};
    const bits = [(d.dirty_nodes || 0) + ' z ' + (d.nodes || 0) + ' uzlov má nález'];
    if (t.desc_chars) bits.push('popis nad ' + t.desc_chars + ' znakov');
    if (t.tag_cap) bits.push('tagov nad ' + t.tag_cap);
    if (d.generated_at) bits.push('zmerané pred ' + timeAgo(d.generated_at));
    return '<p class="dash-note">' + esc(bits.join(' · ')) + '</p>';
}

function hygClassHtml(c, max) {
    const w = Math.max(2, Math.round(100 * (c.burden || 0) / max));
    return '<div class="dbar">'
        + '<div class="dbar-head">'
        + '<span class="db-name">' + esc(hygName(c.class)) + '</span>'
        + '<span class="db-n">' + (c.count || 0) + ' · váha ' + (c.weight || 0) + '</span>'
        + '</div>'
        + '<div class="dbar-track"><div class="dbar-fill" style="width:' + w + '%"></div></div>'
        + hygChipsHtml(c.example_nodes || [], (n) => n.note)
        + '</div>';
}

function hygWorstHtml(worst) {
    return '<div class="dbar">'
        + '<div class="dbar-head"><span class="db-name">Najdrahšie uzly</span>'
        + '<span class="db-n">rozhodni prvé</span></div>'
        + hygChipsHtml(worst, (n) => (n.classes || []).map(hygName).join(' + '))
        + '</div>';
}

/* Rad uzlov ako čipy. `tail` je to, čo o uzle povie server: nález pri triede
   („12 tagov (strop recallu je 8)"), zoznam tried pri najdrahších. */
function hygChipsHtml(nodes, tail) {
    if (!nodes.length) return '';
    return '<div class="dtl-filter">' + nodes.map((n) => {
        const t = tail(n);
        /* Prázdne polia sa v titulku VYNECHÁVAJÚ, nedopĺňajú sa vetou. Riadok
           najdrahších uzlov nesie len id, label a triedy (tak ako plocha AI),
           takže „bez oblasti" by tam nebol nález, ale výmysel — a práve pri
           triede „zle zaradený uzol" by ten výmysel znel ako dôkaz. */
        const meta = [n.type ? typeName(n.type) : '', n.area || ''].filter(Boolean).join(' · ');
        /* Label sa NEČISTÍ cez plainInline, na rozdiel od fronty a Denníka:
           trieda „markdown v labeli" je práve o tom, že v labeli je „#" a „**".
           Odstrániť ich tu by znamenalo schovať presne ten nález, ktorý sekcia
           hlási — človek by videl čistý text a nechápal, čo má opravovať. */
        return '<button type="button" class="chip" data-hyg="' + n.id + '"'
            + (meta ? ' title="' + esc(meta) + '"' : '') + '>'
            + esc(n.label || ('#' + n.id))
            + (t ? '<span class="chip-n">' + esc(t) + '</span>' : '')
            + '</button>';
    }).join('') + '</div>';
}

/* Uzol pre detail. Ref sa skladá z už načítanej správy, nie z data atribútov:
   label môže obsahovať čokoľvek (to je celá pointa triedy „surová veta ako
   label") a prelievať ho cez HTML atribút a späť je cesta, na ktorej sa dá
   stratiť znak. */
function hygNodeRef(id) {
    const d = hygienaState.data;
    if (!d) return { id };
    const pools = (d.classes || []).map((c) => c.example_nodes || []).concat([d.worst || []]);
    for (const pool of pools) {
        const hit = pool.find((n) => n.id === id);
        if (hit) return { id: hit.id, label: hit.label, type: hit.type };
    }
    return { id };
}

function wireHygiena(el) {
    const refresh = el.querySelector('#hygiena-refresh');
    if (refresh) refresh.onclick = () => loadHygiena(true);
    el.querySelectorAll('[data-hyg]').forEach((btn) => {
        const id = +btn.dataset.hyg;
        btn.onclick = () => openNodeFromAnywhere(hygNodeRef(id));
        /* Enter na tomto čipe by inak zhltla klávesová fronta Kontroly:
           `shortcuts.js` počúva na window a pre `Enter` otvára VYBRANÝ uzol fronty,
           aj s `preventDefault()` — klik by sa nikdy neuskutočnil a otvoril by sa
           cudzí uzol. Listener je na window (bublanie), stačí ho zastaviť tu. */
        btn.onkeydown = (e) => {
            if (e.key === 'Enter') e.stopPropagation();
        };
    });
}
