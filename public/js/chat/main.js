/* ===========================================================================
   Chat — bootstrap plochy.

   Natívne ES moduly bez build stepu, rovnako ako graf a konzola (vite sa v tomto
   projekte na frontend nikdy nepúšťal, kontrakt §2c: žiadny bundler nad
   `public/js`, žiadna CDN závislosť).

   ČO TENTO SÚBOR JE: layout. Panely, ich šírky a perzistencia, prepínanie,
   zalomenie na úzkom okne, skratky, rast composera, sledovanie spodku toku,
   oznamy pre čítačku.

   ČO TENTO SÚBOR NIE JE A NESMIE SA STAŤ: beh. Neposiela ani jeden fetch,
   nepozná NDJSON, nepozná dvojfázovú bránu zápisov. Beh drží `./run.js` nad
   `public/js/shared/runclient.js` (`/api/console/run`, `/api/console/decide`) —
   tam, kam ide konzola aj dok nad grafom. Tri vstupy, jeden beh; tretia cesta
   k modelu je chyba, nie funkcia. Jediná niť medzi nimi je `wireRun()` v `boot()`.

   Rozhranie pre beh je preto ZÁMERNE dvojaké:
     · exportované funkcie (nižšie) — čo sa dá volať,
     · udalosti na `document` (`chat:*`) — čo plocha hlási. Kostra len oznamuje
       zámer človeka; vykonáva ho `run.js`, takže sa beh nedá omylom zadrôtovať
       sem.

   Všetko sú HOISTOVANÉ `export function`. Nie je to štýl, je to podmienka:
   graf modulov chatu bude mať cyklus (render ↔ artefakt ↔ táto plocha) rovnako
   ako ho má graf a konzola, a `export const foo = () => {}` v cykle spadne na
   `ReferenceError: Cannot access 'foo' before initialization`.
   =========================================================================== */

/* Jediný import behu. Cyklus `main → run → render → main` je tým reálny a je to
   presne ten prípad, pre ktorý je hoistovanie vyššie povinné: `render.js` na
   svojom vrchole importuje tento modul, ktorý sa v tej chvíli ešte vyhodnocuje. */
import { bootModelSelect, wireRun } from './run.js';
/* Zvyšok plochy. Do 25. 8. 2026 tu bol len `run.js` a ostatných sedem modulov
   vlny 3 sa na stránku NENAČÍTALO VÔBEC — blade má jediný `<script type="module">`
   a ten vedie sem, takže modul bez importu odtiaľto je mŕtvy kód. Nález finálneho
   review, označený ako KRITICKÝ, a bol na ňom celý zvyšok vlny. Keď pridáš ďalší
   modul chatu, pridaj mu import a `wire*()` v `boot()` — inak sa nespustí. */
import { wireArtifact } from './artifact.js';
import { bootThreads, wireThreadsPanel } from './threads.js';
import { bootBranches, wireBranches } from './branches.js';
import { bootAttach, wireDrop, wirePaste } from './attach.js';
import { bootVoice, wireVoice } from './voice.js';
import { bootAgents, wireAgents } from './agents.js';
/* Vlna parity s `/` (31. 8. 2026). Tie isté tri veci, čo si graf zaplatil:
   čítací režim, paleta Ctrl+K a slovník prázdnych stavov. `empty.js` sem
   NEPATRÍ — nemá čo drôtovať, importujú ho tí, čo prázdny stav kreslia
   (`threads.js`, `palette.js`), a import bez `wire*` by tu vyzeral ako
   zabudnutá inicializácia. `selects.js` obliekacie obálky natívnych ovládačov;
   `bootSelects()` musí byť idempotentné, pretože `bootModelSelect()` dopĺňa
   `<option>`y až po fetchi. */
import { bootRead, wireRead } from './read.js';
import { bootPalette, wirePalette } from './palette.js';
import { bootSelects } from './selects.js';
/* Query string. `mind/urlstate.js` je JEDINÉ miesto v repe, ktoré ho číta aj
   píše (rozhodnutie 31), a je to zámerne čistý modul nad `URLSearchParams` bez
   jediného importu z `mind/` — inak by `/chat` jedným importom stiahol celý graf.
   Debounce filtrov drží on sám; odtiaľto sa nedebouncuje. */
import { bootValue, writeUrl } from '../mind/urlstate.js';

/* Kľúče v localStorage. Prefix `hades.chat.` zámerne — `hades.theme` je
   zdieľaná s grafom a konzolou (jedna téma pre celú appku), všetko ostatné je
   vlastnosť tejto plochy a nesmie prepísať nastavenie konzoly. */
const KEY = {
    threads: 'hades.chat.threads',
    artifact: 'hades.chat.artifact',
    threadsW: 'hades.chat.threadsW',
    artifactW: 'hades.chat.artifactW',
};

/* Krátke URL kľúče panelov zo kanonického slovníka (`docs/BRAND-HADES.md` §10).
   Defaulty sa v adrese VYNECHÁVAJÚ, takže slovník každého kľúča je jednohodnotový:
   `pt=0` znamená „zoznam vlákien zatvorený" (default je otvorený) a `pa=1`
   znamená „panel artefaktu otvorený" (default je zatvorený). Preto sa hodnota
   `1` pre `pt` a `0` pre `pa` nikdy nezapíše — bola by to default hodnota.

   ŠÍRKY PANELOV DO URL NEIDÚ. Šírka je vlastnosť monitora, nie obsahu: odkaz
   poslaný na iný stroj by na ňom prepísal rozloženie, ktoré si tam človek vybral. */
const URL_KEY = { threads: 'pt', artifact: 'pa' };

/* ---------------------------------------------------------------------------
   PREFERENCIE

   `localStorage` v prehliadači vie hodiť aj pri čítaní (privátne okno so
   zakázanými cookies, plná kvóta), a plocha, ktorá kvôli nedostupnej preferencii
   nenaběhne vôbec, je horšia než plocha s defaultom. Preto tieto dve obálky.
   --------------------------------------------------------------------------- */

/** @returns {string|null} uložená preferencia, alebo `null` keď nie je čitateľná */
export function readPref(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function writePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* Nedostupné úložisko nie je chyba plochy — stav zostane len v tejto karte. */
    }
}

/* Rozsahy šírok. Dolná hranica je čitateľnosť (pod 200 px sa titulok vlákna
   zreže na nič), horná je to, aby panel nezjedol konverzáciu. Strop 40 % okna
   je nad nimi ešte raz: na 1024 px by 420 px panela plus 640 px artefaktu
   nezostalo na text vôbec. */
const LIMIT = {
    threads: { min: 200, max: 420, def: 268 },
    artifact: { min: 280, max: 640, def: 380 },
};

/* Zalomenie na prekryv. Tá istá hodnota je literálom v `chat.css` — CSS premenné
   v `@media` nefungujú, takže dve miesta sú nevyhnutné. Keď ju meníš, prepíš
   obe, inak sa plocha zlomí na dvoch rôznych šírkach. */
const NARROW = '(max-width: 900px)';

/** Beží ťah? Drží to len kvôli tomu, čo Esc urobí — beh sám patrí vlne 3. */
let running = false;

/** Sleduje tok spodok? Prepína sa LEN pri skutočnom skrolovaní človekom. */
let following = true;

/* ---------------------------------------------------------------------------
   TÉMA
   --------------------------------------------------------------------------- */

/** Tmavá je default, rovnako ako v grafe a konzole — tému nesie ten istý kľúč. */
export function applyTheme() {
    const name = readPref('hades.theme') || 'dark';
    document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
}

/* ---------------------------------------------------------------------------
   PANELY

   Stav je JEDEN: `document.body.dataset.threads` / `.artifact` s hodnotou
   `'on'` / `'off'`. Z neho vychádza šírka stĺpca (CSS), `hidden` atribút panela
   a `aria-expanded` prepínača — všetko v `applyPanel()`, aby sa tie tri veci
   nemohli rozísť.

   `hidden` je tu podmienka prístupnosti, nie kozmetika: nulová šírka stĺpca sám
   fokus nezruší a klávesnica by chodila po neviditeľnom paneli.
   --------------------------------------------------------------------------- */

/** @returns {boolean} je panel otvorený? */
export function panelState(name) {
    return document.body.dataset[name] === 'on';
}

/** Zapíše stav panela do DOM. Jediné miesto, kde sa tie tri veci nastavujú. */
export function applyPanel(name, on) {
    const panel = document.getElementById(name === 'threads' ? 'chat-threads' : 'chat-artifact');
    const toggle = document.getElementById(name === 'threads' ? 'chat-threads-toggle' : 'chat-artifact-toggle');

    document.body.dataset[name] = on ? 'on' : 'off';
    if (panel) panel.hidden = !on;
    if (toggle) toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
}

/**
 * Otvorí/zatvorí panel a stav si zapamätá.
 *
 * Na úzkom okne sa stav ZÁMERNE neukládá: prekryv je jednorazové gesto („pozri
 * do histórie a zatvor"), nie nastavenie plochy. Keby sa ukládal, človek by si
 * po otočení telefónu otvoril prekryv, ktorý si nikdy nevybral.
 *
 * Na úzkom okne je otvorený najviac JEDEN panel — dva prekryvy nad sebou by sa
 * delili o ten istý scrim a jeden by bol nedosiahnuteľný.
 *
 * NA ŠIROKOM OKNE SA STAV ZAPÍŠE OBOJE: preferencia do `localStorage` (platí pre
 * ďalšie otvorenia plochy) a kľúč do adresy (platí pre TENTO odkaz). Sú to dve
 * rôzne roly, nie duplikát — odkaz `?pt=0&pa=1` má u kolegu ukázať to isté
 * rozloženie, aj keď má vlastnú preferenciu.
 *
 * Zápis do adresy je `replaceState`, pretože otvorenie panela NIE JE navigácia:
 * `Naspäť` má vrátiť predchádzajúce vlákno alebo vetvu, nie zavrieť panel
 * (rozhodnutie 10).
 */
export function setPanel(name, on, { remember = true } = {}) {
    applyPanel(name, on);

    if (narrow()) {
        if (on) applyPanel(name === 'threads' ? 'artifact' : 'threads', false);
    } else if (remember) {
        writePref(KEY[name], on ? 'on' : 'off');
        writeUrl({ [URL_KEY[name]]: panelUrlValue(name, on) }, 'replace');
    }

    live(`${name === 'threads' ? 'Zoznam vlákien' : 'Panel artefaktu'} ${on ? 'otvorený' : 'zatvorený'}.`);
    document.dispatchEvent(new CustomEvent('chat:panels', {
        detail: { threads: panelState('threads'), artifact: panelState('artifact') },
    }));
}

export function togglePanel(name) {
    setPanel(name, !panelState(name));
}

/**
 * Stav panela v jazyku adresy — alebo `null`, keď je to default a kľúč do adresy
 * nepatrí. Jediné miesto, kde sa `on/off` prekládá na slovník §10; obe strany
 * (zápis aj boot) idú cezeň, takže sa nemôžu rozísť.
 *
 * @returns {string|null}
 */
export function panelUrlValue(name, on) {
    if (name === 'threads') return on ? null : '0';

    return on ? '1' : null;
}

/**
 * Aktuálne rozloženie panelov späť do adresy, bez záznamu v histórii.
 *
 * Existuje pre jediný prípad: navigácia, ktorá prepíše celú adresu a query
 * string tým zahodí (`history.pushState({}, '', '/chat')` pri zmazaní otvoreného
 * vlákna). Bez toho by adresa po takom skoku tvrdila default rozloženie, hoci
 * panely na obrazovke zostali tak, ako si ich človek nechal — a absencia kľúča
 * `pt` znamená „otvorený", teda by to bola lož, nie len chýbajúci údaj.
 *
 * Pod 900 px sa nezapisuje nič: tam je panel prekryv a jeho stav nie je
 * nastavenie plochy.
 */
export function syncPanelsToUrl() {
    if (narrow()) return;

    writeUrl({
        pt: panelUrlValue('threads', panelState('threads')),
        pa: panelUrlValue('artifact', panelState('artifact')),
    }, 'replace');
}

/**
 * Počiatočný stav panela: **URL > preferencia > default**.
 *
 * Dvojvrstvový default je tu podstata, nie pohodlie. Keď kľúč v adrese CHÝBA,
 * platí to, čo si človek na tomto stroji vybral. Keď kľúč v adrese JE, je to
 * explicitný príkaz odkazu a preferenciu prebije — inak by odkaz na rozbalený
 * artefakt u človeka s vlastným nastavením ukázal niečo iné, než čo mu poslali.
 *
 * Preferencia sa do `bootValue()` podáva preložená do jazyka adresy, aby
 * porovnávalo jeden slovník a nie dva.
 */
export function bootPanel(name) {
    const stored = readPref(KEY[name]);
    const key = URL_KEY[name];
    const value = bootValue(
        key,
        stored === null ? null : panelUrlValue(name, stored === 'on'),
        null,
    );

    return name === 'threads' ? value !== '0' : value === '1';
}

/** Aktuálna šírka panela v px — číta sa z CSS premennej, nie z vlastnej kópie. */
export function panelWidth(name) {
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(name === 'threads' ? '--chat-threads-w' : '--chat-artifact-w');

    return clampWidth(name, parseInt(raw, 10));
}

/**
 * Zapíše šírku panela.
 *
 * Premenná ide INLINE na `:root`, nie na `#chat-app`: zatvorený stav ju
 * prepisuje pravidlom `body[data-…="off"] #chat-app { --chat-…-w: 0px }` a
 * inline štýl na tom istom elemente by ho prebil špecificitou, takže by sa
 * panel nezatvoril. Sú to dve rôzne miesta zámerne.
 */
export function setPanelWidth(name, px, { remember = true } = {}) {
    const w = clampWidth(name, px);

    document.documentElement.style.setProperty(
        name === 'threads' ? '--chat-threads-w' : '--chat-artifact-w', `${w}px`,
    );
    if (remember) writePref(KEY[`${name}W`], String(w));

    const grip = document.getElementById(name === 'threads' ? 'chat-threads-grip' : 'chat-artifact-grip');
    if (grip) {
        grip.setAttribute('aria-valuenow', String(w));
        grip.setAttribute('aria-valuemin', String(LIMIT[name].min));
        grip.setAttribute('aria-valuemax', String(maxWidth(name)));
    }

    return w;
}

/* ---------------------------------------------------------------------------
   ARTEFAKT — jediný vstup do panela

   Vlna 3 nemá do panela kresliť priamo. `artifactHost()` je jediný kontejner,
   ktorý má meniť; hlavičku a otváranie drží kostra. Keď panel niekedy vymeníme
   za inú kresbu, mení sa jedno miesto, nie šitie po celej ploche.
   --------------------------------------------------------------------------- */

/** @returns {HTMLElement|null} prázdny kontejner pre obsah artefaktu */
export function artifactHost() {
    return document.getElementById('chat-artifact-body');
}

/** Titulok panela. Text, nikdy HTML. */
export function setArtifactTitle(text) {
    const node = document.getElementById('chat-artifact-title');
    if (node) node.textContent = String(text ?? 'Artefakt');
}

/** Otvorí panel a vráti kontejner, do ktorého sa kreslí. */
export function openArtifact(title) {
    if (title !== undefined) setArtifactTitle(title);
    setPanel('artifact', true);

    return artifactHost();
}

export function closeArtifact() {
    setPanel('artifact', false);
}

/* ---------------------------------------------------------------------------
   OZNAMY PRE ČÍTAČKU

   Dva `polite` regióny sú v DOM zámerne rozdelené podľa toho, čo hlásia:
   `#chat-announce` jednu vetu o behu (dobehol, žiada rozhodnutie),
   `#chat-live` stav plochy (panel, šírka). Do jedného by sa prekričali.
   --------------------------------------------------------------------------- */

export function announce(text) {
    const node = document.getElementById('chat-announce');
    if (node) node.textContent = String(text ?? '');
}

export function live(text) {
    const node = document.getElementById('chat-live');
    if (node) node.textContent = String(text ?? '');
}

/* ---------------------------------------------------------------------------
   FAKTY ZO STRÁNKY
   --------------------------------------------------------------------------- */

/** uuid vlákna z URL, alebo '' pre nové. Meno metaznačky je zdieľané s konzolou. */
export function threadFromUrl() {
    return document.querySelector('meta[name="console-thread"]')?.content || '';
}

/**
 * Nástroje, ktoré beh naozaj má. Zoznam skládá `ToolRegistry` do HTML
 * (`routes/web.php`) — je to statický fakt o behu, nie endpoint.
 *
 * @returns {Array<{name: string, write: boolean}>}
 */
export function toolList() {
    try {
        const raw = document.getElementById('console-tools')?.textContent || '[]';
        const parsed = JSON.parse(raw);

        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Titulok vlákna v hlavičke a v karte prehliadača naraz.
 *
 * FALLBACK JE „Charón", nie „Chat", a je to oprava zmeraného rozchodu:
 * `chat.blade.php` má `<title>Hades — Charón</title>` aj `og:title` s tým istým
 * menom, ale táto funkcia mala `|| 'Chat'`, takže pri prázdnom vlákne PREPÍSALA
 * hlavičku aj kartu prehliadača na staré meno plochy. Náhľad odkazu teda hovoril
 * jedno a stránka po dobehnutí JS druhé. Blade si na to nechal poznámku
 * s tým, že opravu musí urobiť tento súbor — tu je.
 *
 * „Charón" je meno pre človeka; identifikátory (`console_*`, `/console`,
 * `hades.console.*`) sa zámerne nepremenúvajú.
 */
export function setTitle(text) {
    const title = String(text ?? '').trim() || 'Charón';
    const node = document.getElementById('chat-title');

    if (node) node.textContent = title;
    document.title = `Hades — ${title}`;
}

/* ---------------------------------------------------------------------------
   TOK SPRÁV A COMPOSER
   --------------------------------------------------------------------------- */

/** Kontejner toku. Vlna 3 doňho kreslí bubliny, karty nástrojov a diffy. */
export function streamHost() {
    return document.getElementById('chat-stream');
}

/** Zhasne statický prázdny stav. Idempotentné — druhé volanie nič nerobí. */
export function clearEmpty() {
    document.getElementById('chat-empty')?.remove();
}

export function scrollToBottom() {
    const stream = streamHost();
    if (!stream) return;

    stream.scrollTop = stream.scrollHeight;
    following = true;
    paintJump();
}

/** Sleduje človek spodok? Vlna 3 sa má pýtať PRED každým auto-skrolom. */
export function isFollowing() {
    return following;
}

/**
 * Výška composera podľa obsahu.
 *
 * Strop je v CSS (`max-height: 40vh`) a `overflow-y: auto`, takže dlhý text
 * skroluje vnútri poľa namiesto toho, aby vytlačil tok správy z obrazovky.
 */
export function autoGrowPrompt() {
    const prompt = document.getElementById('chat-prompt');
    if (!prompt) return;

    prompt.style.height = 'auto';
    prompt.style.height = `${prompt.scrollHeight}px`;
}

/**
 * Prepne plochu do stavu „beží ťah".
 *
 * Kostra tým NEBEŽÍ — mení len to, čo sa dá vidieť: Poslať/Zastaviť a
 * `aria-busy` na toku, aby čítačka nehlásila každý prílet tokenu (pri ~8 tok/s
 * osemkrát za sekundu).
 */
export function setRunning(on) {
    running = !!on;

    document.getElementById('chat-send')?.classList.toggle('hidden', running);
    document.getElementById('chat-stop')?.classList.toggle('hidden', !running);
    streamHost()?.setAttribute('aria-busy', running ? 'true' : 'false');
}

/** Text vedľa hlavičky (sekundy, krok, tokeny). Plní vlna 3. */
export function setStats(text) {
    const node = document.getElementById('chat-run-stats');
    if (node) node.textContent = String(text ?? '');
}

/* ---------------------------------------------------------------------------
   VNÚTRO — pomôcky, ktoré nie sú rozhraním pre vlnu 3

   Sú exportované aj tak: modul bez cyklu sa testuje ťažšie a skryté funkcie sa
   v tomto projekte vždy skončili druhou kópiou niekde inde.
   --------------------------------------------------------------------------- */

export function narrow() {
    return window.matchMedia(NARROW).matches;
}

export function maxWidth(name) {
    // 40 % okna je strop nad pevným maximom, nie namiesto neho.
    return Math.min(LIMIT[name].max, Math.round(window.innerWidth * 0.4));
}

export function clampWidth(name, px) {
    const n = Number.isFinite(px) ? px : LIMIT[name].def;

    return Math.min(Math.max(Math.round(n), LIMIT[name].min), Math.max(maxWidth(name), LIMIT[name].min));
}

/** Uložená šírka, alebo default. Nečitateľná hodnota padá na default, nie na NaN. */
export function storedWidth(name) {
    return clampWidth(name, parseInt(readPref(KEY[`${name}W`]) ?? '', 10));
}

/** Gombík „na spodok" sa ukazuje LEN keď tok prestal sledovať konec. */
export function paintJump() {
    document.getElementById('chat-to-bottom')?.classList.toggle('hidden', following);
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

export function wirePanels() {
    document.getElementById('chat-threads-toggle')
        ?.addEventListener('click', () => togglePanel('threads'));
    document.getElementById('chat-artifact-toggle')
        ?.addEventListener('click', () => togglePanel('artifact'));
    document.getElementById('chat-artifact-close')
        ?.addEventListener('click', () => closeArtifact());

    // Klik do scrimu zatvára prekryv. Scrim je `body::after`, takže kliknutie doňho
    // má za cieľ `body` — nie je to trik, je to jediný element, ktorý tam je.
    document.addEventListener('click', (e) => {
        if (!narrow() || e.target !== document.body) return;

        if (panelState('threads')) setPanel('threads', false);
        if (panelState('artifact')) setPanel('artifact', false);
    });

    // Prechod medzi širokým a úzkym oknom. Prekryv sa pri rozšírení nezachová:
    // stav prekryvu nie je nastavenie plochy (viď setPanel).
    window.matchMedia(NARROW).addEventListener('change', () => applyStoredPanels());

    // Strop 40 % okna sa mení s oknom, takže šírky treba prepočítať.
    //
    // Prepočítava sa z ULOŽENEJ hodnoty, nie z aktuálnej: keby sa zúžená šírka
    // brala ako nový vstup, každé zmenšenie okna by ju zrezalo natrvalo a po
    // rozšírení by sa panel nevrátil. `remember: false` drží v localStorage to,
    // čo si človek naozaj vybral, nie to, čo mu dovolilo okno.
    window.addEventListener('resize', () => {
        setPanelWidth('threads', storedWidth('threads'), { remember: false });
        setPanelWidth('artifact', storedWidth('artifact'), { remember: false });
    });
}

/**
 * Ťahadlá šírky — myš/dotyk aj klávesnica.
 *
 * `setPointerCapture` je tu podmienka, nie pohodlie: bez neho gesto skončí,
 * len čo kurzor prebehne nad tok správ (iný element), a panel zostane v pol
 * ceste. Ukládá sa až na `pointerup` — počas ťahania by to bol zápis do
 * localStorage na každý pohyb myši.
 */
export function wireGrips() {
    [['threads', 'chat-threads-grip'], ['artifact', 'chat-artifact-grip']].forEach(([name, id]) => {
        const grip = document.getElementById(id);
        if (!grip) return;

        setPanelWidth(name, storedWidth(name), { remember: false });

        let dragging = false;

        grip.addEventListener('pointerdown', (e) => {
            dragging = true;
            grip.setPointerCapture(e.pointerId);
            document.body.classList.add('cp-dragging');
            e.preventDefault();
        });

        grip.addEventListener('pointermove', (e) => {
            if (!dragging) return;

            // Zoznam vlákien rastie doprava, artefakt doľava — preto sa jedna
            // šírka číta od ľavej hrany okna a druhá od pravej.
            const px = name === 'threads' ? e.clientX : window.innerWidth - e.clientX;
            setPanelWidth(name, px, { remember: false });
        });

        const end = (e) => {
            if (!dragging) return;

            dragging = false;
            grip.releasePointerCapture?.(e.pointerId);
            document.body.classList.remove('cp-dragging');
            const w = setPanelWidth(name, panelWidth(name));
            live(`Šírka ${name === 'threads' ? 'zoznamu vlákien' : 'panela artefaktu'}: ${w} pixelov.`);
        };

        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);

        // Klávesnica. Šípka je krok var(--sp-2) = 16 px, Home/End sú hranice —
        // myš nie je jediný vstup a `role="separator"` bez klávesovej obsluhy je
        // len sľub v ARIA atribúte.
        grip.addEventListener('keydown', (e) => {
            // Zoznam vlákien rastie doprava, artefakt doľava, takže tá istá šípka
            // znamená pre každý panel opačné znamienko. Bez `dir` by ArrowRight
            // na artefakte panel zväčšoval, hoci sa hrana hýbe od obsahu.
            const dir = name === 'threads' ? 1 : -1;
            const delta = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
            let next;

            if (delta !== undefined) next = panelWidth(name) + delta * dir;
            else if (e.key === 'Home') next = LIMIT[name].min;
            else if (e.key === 'End') next = maxWidth(name);
            else return;

            e.preventDefault();
            const w = setPanelWidth(name, next);
            live(`Šírka: ${w} pixelov.`);
        });
    });
}

/**
 * Composer. Odoslanie sa TU nevykonáva — kostra len ohlási zámer udalosťou
 * `chat:submit`. Kto ju vykoná, rozhoduje vlna 3, takže sa beh nedá omylom
 * zadrôtovať do bootstrapu plochy.
 */
export function wireComposer() {
    const form = document.getElementById('chat-composer');
    const prompt = document.getElementById('chat-prompt');

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = (prompt?.value ?? '').trim();
        if (text === '') return;

        document.dispatchEvent(new CustomEvent('chat:submit', { detail: { text } }));
    });

    prompt?.addEventListener('input', autoGrowPrompt);

    // Enter pošle, Shift+Enter nový riadok. `isComposing` je tu povinné: pri
    // písaní s IME (diakritika cez mŕtve klávesy, CJK) Enter potvrdzuje
    // rozpísaný znak a odoslanie by rozstrieľalo vetu na polovicu.
    prompt?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;

        e.preventDefault();
        form?.requestSubmit();
    });

    document.getElementById('chat-stop')?.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('chat:stop'));
    });

    document.getElementById('chat-to-bottom')?.addEventListener('click', scrollToBottom);

    // Sledovanie spodku. Prah 80 px, nie 0: pri streamovaní sa `scrollHeight`
    // mení medzi rámcami a presná rovnosť by gombík rozsvietila na každom tokene.
    streamHost()?.addEventListener('scroll', (e) => {
        const s = e.currentTarget;
        following = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
        paintJump();
    });
}

export function wireThreads() {
    document.getElementById('chat-new')?.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('chat:new-thread'));
    });

    document.getElementById('chat-search')?.addEventListener('input', (e) => {
        document.dispatchEvent(new CustomEvent('chat:search', {
            detail: { query: e.currentTarget.value },
        }));
    });
}

/**
 * Skratky. Držané na `document`, ale VŽDY s kontrolou, či človek práve nepíše —
 * inak by `Ctrl+B` v texte otvoril panel namiesto toho, čo očakáva.
 *
 * Esc má dva významy a poradie je zámerné: zastaviť beh je nevratnejšie než
 * zatvoriť panel, takže keď beží ťah, Esc patrí jemu.
 */
export function wireShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (running) {
                document.dispatchEvent(new CustomEvent('chat:stop'));

                return;
            }
            if (narrow() && panelState('threads')) setPanel('threads', false);
            else if (narrow() && panelState('artifact')) setPanel('artifact', false);

            return;
        }

        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

        const key = e.key.toLowerCase();

        if (key === 'n') {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent('chat:new-thread'));
        } else if (key === 'b') {
            e.preventDefault();
            togglePanel('threads');
        } else if (key === 'j') {
            e.preventDefault();
            togglePanel('artifact');
        }
    });
}

/**
 * Počiatočný stav panelov.
 *
 * Na úzkom okne oba zatvorené, bez ohľadu na uložené AJ na adresu — prekryv nad
 * textom pri otvorení stránky je horší než jeden klik, a stav prekryvu nie je
 * nastavenie plochy (viď `setPanel`). Preto sa pod 900 px `pt`/`pa` ani nečíta,
 * ani nezapisuje: kľúč by tvrdil o rozložení niečo, čo na tej šírke neplatí.
 *
 * Na širokom okne rozhoduje `bootPanel()`: URL > preferencia > default. Default
 * je „zoznam áno, artefakt nie", pretože artefakt je pri otvorení prázdny
 * a prázdny panel by ukradol tretinu šírky za nič.
 */
export function applyStoredPanels() {
    if (narrow()) {
        applyPanel('threads', false);
        applyPanel('artifact', false);

        return;
    }

    applyPanel('threads', bootPanel('threads'));
    applyPanel('artifact', bootPanel('artifact'));
}

export function boot() {
    applyTheme();
    applyStoredPanels();
    wirePanels();
    wireGrips();
    wireComposer();
    wireThreads();
    wireShortcuts();
    autoGrowPrompt();
    paintJump();

    // Beh sa drôtuje PRED ohlásením `chat:ready`, inak by si tú udalosť nemal kto
    // odchytiť: `run.js` na nej otvára vlákno z URL. Esc si drôtuje sám a v
    // ZÁCHYTNEJ fáze, teda pred `wireShortcuts()` vyššie — nad zaparkovaným
    // zápisom patrí Esc rozhodnutiu, nie zatváraniu panela.
    wireRun();

    /* Zvyšok plochy sa drôtuje TU, teda ešte pred `chat:ready`: každý z týchto
       modulov sa na tú udalosť vesí (vlákna z URL, vetvy vlákna, panel príloh),
       takže po nej by ju už nemal kto odchytiť. `wire*` len naväzuje listenery,
       `boot*` dopĺňa počiatočný stav — preto sú to dva kroky a nie jeden. */
    wireArtifact();
    wireThreadsPanel();
    wireBranches();
    wireDrop();
    wirePaste();
    wireVoice();
    wireAgents();
    /* Čítací režim sa drôtuje PRED `bootThreads()` a `wireRun()` vyššie už beží:
       `wireRead()` len postaví prepínač v hlavičke, ale `bootRead()` nižšie
       dorovnáva UŽ VYKRESLENÉ bubliny — a tie na novom vlákne ešte nie sú, kým
       ich `loadThread()` neprinesie. Nové bubliny si triedu berú z `mdClass()`
       samé, takže poradie tu rozhoduje len o prepínači.

       Paleta sa drôtuje TU a nie v `wireShortcuts()`: jej Ctrl+K je na
       `document` rovnako ako ostatné skratky, ale kľúčové je, že overlay si
       keydown ZASTAVUJE (`stopPropagation`) — bez toho by `Ctrl+B` pod otvorenou
       paletou prepol panel a `Esc` pri bežiacom ťahu zastavil beh namiesto
       zavretia palety. */
    wireRead();
    wirePalette();

    bootThreads();
    bootBranches();
    bootModelSelect();
    bootAttach();
    bootVoice();
    bootAgents();
    bootRead();
    bootPalette();
    bootSelects();

    // Plocha je pripravená. Beh sa vesí na túto udalosť a nie na
    // `DOMContentLoaded` — vtedy ešte nie sú nastavené panely ani šírky, takže
    // by prvé meranie výšky toku prečítalo layout, ktorý o milisekundu neplatí.
    document.dispatchEvent(new CustomEvent('chat:ready', {
        detail: { thread: threadFromUrl(), tools: toolList() },
    }));
}

/* Modul sa načítava ako `type="module"`, teda odložene — DOM je hotový. Druhá
   podmienka je poistka pre prípad, že sa skript niekedy presunie do <head>. */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
