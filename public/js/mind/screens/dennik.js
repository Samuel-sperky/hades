import { bindPackButtons, packBtn } from '../pack.js';
import { openNodeDetail } from '../screens.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
import { $, deferSkeleton, esc, getJson, prettyLabel, renderEmpty, renderError, renderFilterEmpty } from '../util.js';

// Denník — časová os zoskupená po dňoch, s filtrom podľa projektu
export const SK_MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
    'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];

export let journalRecords = [];
// Skupiny projektov a celkový počet chodia zo SERVERA (DennikScreen). Do 20. 8. 2026
// si ich obrazovka počítala z 50 načítaných záznamov, takže čip tvrdil iné číslo než
// server — a AI, ktorá čítala serverové počty, tretie. Počítanie je údaj, nie kresba.
export let journalGroups = [];
export let journalTotal = 0;
/* Filter projektu žije v URL pod kľúčom `dep` (slovník §6). Číta sa TU, pri
   načítaní modulu — teda ešte pred prvým renderom, aby odkaz otvoril Denník už
   s nasadeným filtrom a nie až o jedno prekreslenie neskôr.

   Podmienka `BOOT_MINE` nie je opatrnosť, ale konzistencia s tým, čo pri zmene
   obrazovky robí `setScreen()`: kľúče filtrov cudzích obrazoviek maže. Keby sme
   `dep` z odkazu na inú obrazovku prevzali, filter by ostal zapnutý napriek tomu,
   že v adrese už nie je — a človek by hľadal čip, ktorý nikde nesvieti. */
const BOOT_MINE = readUrl().s === 'dennik';
export let journalProject = (BOOT_MINE ? urlValue('dep') : null) || null;

/* Späť / Dopredu. Bez tohto by tlačidlo Naspäť zmenilo adresu a nechalo filter
   stáť — teda by URL lhala, čo je presne to, proti čomu celá vlna vznikla.
   Prekresľujeme len keď je Denník naozaj na obrazovke; inak stačí stav a kreslenie
   si vyžiada `setScreen()`. Obrazovku čítame z `body[data-screen]`, nie z `S` —
   nie je dôvod pre jeden atribút importovať celý stav grafu. */
registerUrlApply('dennik', (url) => {
    if (url.s !== 'dennik') return;
    const next = url.dep || null;
    if (next === journalProject) return;
    journalProject = next;
    if (document.body.dataset.screen === 'dennik') renderJournal();
});
// Projektov je bežne ~23 — všetky naraz sa lámu na dva riadky chipov nad obsahom.
// Preto zbalený rad: najčastejšie projekty + „viac".
export let journalChipsOpen = false;
export const JOURNAL_CHIPS_TOP = 8;

export function dayLabel(iso) {
    const d = new Date(iso);
    const t = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((midnight(t) - midnight(d)) / 86400000);
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    return d.getDate() + '. ' + SK_MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear();
}

export function timeHM(iso) {
    return new Date(iso).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}

/* Filtruje SERVER, nie prehliadač. Kľúč skupiny („#bez-projektu") ide ako query
   parameter, takže počet na čipe a počet záznamov po kliknutí je to isté číslo —
   kým sa filtrovalo nad oknom 50 záznamov, čip sľuboval 22 a zoznam dal 9. */
export async function renderJournal() {
    const list = $('journal-list');
    /* SKELETON, nie dýchajúci znak: `/api/journal` beží 3–4 s a plní zoznam, teda
       obsah so známym tvarom (kľúč dňa + záznamy). Do 27. 8. 2026 tu bol dýchajúci
       znak — pri najpomalšom endpointe appky práve ten stav, ktorý najviac
       potreboval predkresliť rozloženie. */
    const cancelSkeleton = deferSkeleton(list, 'list');
    try {
        const q = journalProject ? '?project=' + encodeURIComponent(journalProject) : '';
        const data = await getJson('/api/journal' + q);
        cancelSkeleton();
        journalRecords = data.records || [];
        journalGroups = data.project_groups || [];
        journalTotal = data.total || 0;

        // Aktívny filter, ktorý v skupinách zo servera už nie je (posledný záznam
        // projektu sa premenoval), by zamkol prázdnu obrazovku — zruš ho a načítaj
        // znova. Druhýkrát sa to stať nemôže, filter je vtedy prázdny.
        if (journalProject && !journalGroups.some((g) => g.key === journalProject)) {
            journalProject = null;
            return renderJournal();
        }

        /* Do adresy ide OREZANÁ pravda, nie to, čo si človek prial: filter, ktorý
           v skupinách zo servera nie je, sme práve zhodili o pár riadkov vyššie,
           takže až tu je `journalProject` platná skupina. Poradie je záväzné —
           URL → stav → dopyt → prune → replaceState.

           `replace`, nikdy `push` (rozhodnutie 10): tlačidlo Späť patrí
           obrazovkám a vláknam, nie klikaniu do radu čipov. */
        writeUrl({ dep: journalProject }, 'replace');

        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        cancelSkeleton();
        renderError(list, 'denník', renderJournal);
    }
}

/* Skupinu „bez projektu" tvorí server ({@see App\Support\ProjectGroup}): sessions
   z dočasných adresárov majú v dátach každá svoj strojový názov („mystifying-
   mclaren-23750a") a kým ich zlučoval prehliadač, človek videl jednu skupinu, ale
   AI dvanásť uzlov so strojovými menami. Sentinel je tu už len na porovnanie. */
export const JOURNAL_NO_PROJECT = '#bez-projektu';

export function renderJournalFilter() {
    const wrap = $('journal-filter');
    // Poradie aj počty sú zo servera (podľa počtu záznamov v CELOM denníku), takže
    // v zbalenom rade ostanú tie projekty, ktoré sa reálne používajú.
    const groups = journalGroups;
    if (!groups.length) { wrap.innerHTML = ''; return; }

    const hiddenCount = Math.max(0, groups.length - JOURNAL_CHIPS_TOP);
    // aktívny filter musí byť vždy vidieť, aj keď je mimo najčastejších
    if (journalProject && groups.findIndex((g) => g.key === journalProject) >= JOURNAL_CHIPS_TOP) journalChipsOpen = true;
    const shown = journalChipsOpen ? groups : groups.slice(0, JOURNAL_CHIPS_TOP);

    /* `aria-pressed` je povinné: čip je prepínač a bez neho nesie zapnutý filter
       LEN farba, takže čítačka o filtri nevie nič. Vzor je `runy.js` (chip()) —
       ten istý atribút, nie druhý mechanizmus. `.chip-more` ho NEMÁ: rozbaľovač
       nie je filter a svoj stav hovorí popiskom („+3 viac" / „menej"). */
    wrap.innerHTML = '<button type="button" class="chip' + (journalProject ? '' : ' active') + '"'
        + ' aria-pressed="' + (journalProject ? 'false' : 'true') + '" data-project="">'
        + 'Všetky<span class="chip-n">' + journalTotal + '</span></button>'
        + shown.map((g) =>
            // data-project nesie KĽÚČ skupiny (filtruje sa ním), popisok ľudský text
            '<button type="button" class="chip' + (journalProject === g.key ? ' active' : '') + '"'
            + ' aria-pressed="' + (journalProject === g.key ? 'true' : 'false') + '"'
            + ' data-project="' + esc(g.key) + '">'
            + esc(g.label) + '<span class="chip-n">' + g.count + '</span></button>'
        ).join('')
        + (hiddenCount ? '<button type="button" class="chip chip-more" id="journal-chips-more">'
            + (journalChipsOpen ? 'menej' : '+' + hiddenCount + ' viac') + '</button>' : '');

    const more = $('journal-chips-more');
    if (more) more.onclick = () => { journalChipsOpen = !journalChipsOpen; renderJournalFilter(); };

    wrap.querySelectorAll('.chip[data-project]').forEach((chip) => {
        chip.onclick = () => {
            /* Aktívny stav sa nasadzuje HNEĎ, nie až po odpovedi servera.
               renderJournalFilter() čipy prekresľuje až vnútri renderJournal(),
               teda po fetchi (3–4 s pri plnom denníku) — dovtedy kliknutý čip
               vyzeral neaktívne a klik pôsobil, akoby nezabral. */
            wrap.querySelectorAll('.chip[data-project]').forEach((c) => {
                c.classList.remove('active');
                c.setAttribute('aria-pressed', 'false');
            });
            chip.classList.add('active');
            chip.setAttribute('aria-pressed', 'true');
            setJournalProject(chip.dataset.project || null);
        };
    });
}

/**
 * Nastaví filter projektu a prekreslí denník.
 *
 * Existuje preto, že `journalProject` je `export let` — cudzí modul doň nevie
 * priradiť (ESM väzby sú pre importéra len na čítanie). Volá to obrazovka Dnes,
 * keď človek klikne na čip projektu.
 */
export function setJournalProject(key) {
    journalProject = key || null;
    /* Adresa sa mení HNEĎ, nie až po odpovedi servera. `/api/journal` beží 3–4 s
       a zápis až v `renderJournal()` by znamenal, že odkaz skopírovaný v tej
       medzere nesie predošlý filter. Druhý zápis po prune to potom už len
       potvrdí, prípadne opraví na orezanú pravdu — oba sú `replace`, takže do
       histórie nepribúda nič.

       Kľúč skupiny môže byť `#bez-projektu`. Preto to stavia `urlstate.js`
       výhradne cez `URLSearchParams`: konkatenácia by `#` nechala odseknúť
       zvyšok adresy do fragmentu. */
    writeUrl({ dep: journalProject }, 'replace');
    renderJournal();
}

export function renderJournalList() {
    const list = $('journal-list');

    if (!journalRecords.length) {
        /* Dve rôzne správy, dva rôzne stavy. „Filter to skryl" má vlastnú rolu
           (`.empty--filter`) a JEDNU akciu, ktorá filter naozaj zruší.

           Tlačidlo je tu legitímne, nie ozdobné: filter, ktorý v skupinách zo
           servera už nie je, zhodila `renderJournal()` vyššie a načítala znovu —
           takže ak sme sa dostali sem, `journalProject` je PLATNÁ skupina, ktorá
           dáta naozaj skrýva. */
        if (journalProject) {
            renderFilterEmpty(list, 'Žiadne záznamy pre tento projekt',
                'Zruš filter a uvidíš celý denník.', () => setJournalProject(null));
        } else {
            renderEmpty(list, 'receipt', 'Zatiaľ žiadne záznamy',
                'Pribudnú, keď si Hades zapamätá prvý poznatok.');
        }
        return;
    }

    // Filtruje a radí server; obrazovka záznamy len zoskupí po dňoch.
    const sorted = journalRecords;

    // Dni sú štruktúra (zostávajú v jednom stĺpci pod sebou); záznamy VNÚTRI dňa
    // idú do fluidnej mriežky (.rec-grid), takže na širokom okne sa šírka vyplní
    // obsahom a nie prázdnom medzi názvom a meta.
    let html = '', lastDay = null;
    for (const r of sorted) {
        const day = dayLabel(r.created_at);
        if (day !== lastDay) {
            if (lastDay !== null) html += '</div>';
            /* „+N poznatkov" v hlavičke dňa (nález A4, tretí bod) tu ZÁMERNE NIE
               JE, a je to trvalý stav, nie rozpracovanosť. `DennikScreen` per-dňové
               počty neposiela — má `total`, `filtered_total` a `project_groups`,
               nič po dňoch. Dopočítať ich z načítaných záznamov je presne chyba M6:
               okno je `limit` 50, takže najstarší deň v okne je odrezaný a hlavička
               by sľubovala číslo, ktoré zoznam nedá.

               Číslo je ÚDAJ, nie kresba, takže podmienka je jasná: kým ho
               `DennikScreen` nepošle (`days[]` s počtom nad celým dňom, nie nad
               oknom), hlavička dňa nesie len dátum. Radšej nič než lož. */
            html += '<div class="day-head">' + esc(day) + '</div><div class="rec-grid">';
            lastDay = day;
        }
        const isDigest = r.source === 'digest';
        const badges = [];
        // Titulok často začína názvom projektu („AI-mind — práca 12.8.2026"), takže
        // chip s projektom by ten istý reťazec zopakoval a v stĺpci by zbytočne
        // zjedol šírku (a názov by sa preto skrátil). V takom prípade chip vynecháme.
        const titleHasProject = r.project && r.label
            && r.label.toLowerCase().startsWith(String(r.project).toLowerCase());
        if (r.project && !titleHasProject) badges.push('<span class="tag">' + esc(r.project_label || '') + '</span>');
        if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
        // `commit_count` dáva server (rovnako ako `file_count`); prehliadač si ho
        // dopočítaval z pola, ktoré na obrazovke nikto nevidí.
        if (r.commit_count) {
            const c = r.commit_count;
            const word = c === 1 ? 'commit' : (c >= 2 && c <= 4 ? 'commity' : 'commitov');
            badges.push('<span class="tag muted">' + c + ' ' + word + '</span>');
        }
        // Značky žijú v hlavičke riadku (nie pod ňou) — na širokom okne tak riadok
        // využije šírku: názov vľavo, značky + čas vpravo, namiesto prázdneho stredu.
        html += '<div class="li-wrap rec-wrap">'
            + '<button type="button" class="record" data-id="' + r.id + '" data-label="' + esc(r.label) + '">'
            + '<div class="record-head">' + iconMarkup(isDigest ? 'calendar' : 'doc', { cls: 'rec-ico' })
            + '<span class="record-title">' + esc(prettyLabel(r.label, r.project)) + '</span>'
            + (badges.length ? '<span class="record-tags">' + badges.join('') + '</span>' : '')
            + '<span class="record-time">' + timeHM(r.created_at) + '</span></div>'
            + '</button>'
            + packBtn(r.id, r.label) + '</div>';
    }
    if (lastDay !== null) html += '</div>';
    list.innerHTML = html;

    /* Detail sa otvára NA MIESTE (nález A4). Do 24. 8. 2026 tu bolo
       `openNodeFromAnywhere()`, ktoré robí `setScreen('graf')` bezpodmienečne —
       klik na záznam teda vyhodil človeka z Denníka a cesta späť bola railom.
       `openNodeDetail()` je ten istý idióm, aký má Knižnica (čítačka markdownu),
       a skok na Graf zostal ako sekundárna akcia v pätičke overlayu. */
    list.querySelectorAll('.record').forEach((el) => {
        el.onclick = () => openNodeDetail({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    bindPackButtons(list);
}
