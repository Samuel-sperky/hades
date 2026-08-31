/* ---------- URL AKO POLOHA ČITATEĽA (rozhodnutie 27 + 31, 27. 8. 2026) ----------

   Toto je JEDINÉ miesto v repe, ktoré query string číta aj píše. Serializuje
   klient; server zostáva zdrojom pravdy pre počty, skupiny a krátenie textu.
   Invariant dvojitej plochy UI = MCP tým nepadá: do adresy ide KĽÚČ filtra, nie
   jeho vyhodnotenie — dopyt na server sa nemení.

   Modul NESMIE importovať nič z `mind/` (ani `state.js`). Kľúče potrebuje `/`,
   `/chat` aj `/console`, a jeden import by na `/chat` stiahol celý graf. Je to
   čistý modul nad `URLSearchParams`.

   Štyri pravidlá tvaru adresy, každé zaplatené meraním (manuál §10):

   1. DEFAULTY SA VYNECHÁVAJÚ. Čistý stav = adresa bez query stringu. Kľúč
      s default hodnotou sa pri najbližšom zápise zahodí.
   2. MNOŽINY SÚ OPAKOVANÝ KĽÚČ, nikdy oddeľovač. 6 z 3 712 reálnych značiek nesie
      slovenskú desatinnú čiarku (`0,5 g`, `CMR 8,33 SDR/kg`), takže `fg=0,5 g`
      s čiarkovým separátorom by sa obnovilo ako INÝ filter, ticho. Hodnoty sa radia
      (ten istý stav = tá istá adresa) a strop je 24 opakovaní na kľúč; nad stropom
      sa kľúč z adresy vynechá a stav zostane lokálny — nie zabalený.
   3. PORADIE KĽÚČOV JE PORADIE `DICT`, nie poradie zmien. Inak by ten istý stav dal
      dve rôzne adresy a `replaceState` by „menil" adresu bez zmeny stavu.
   4. STAVIA SA VÝHRADNE `URLSearchParams`om. Kľúč skupiny Denníka je
      `#bez-projektu` — ručne skladaný query string sa na `#` odsekne a celý zvyšok
      adresy padne do fragmentu.

   História (rozhodnutie 10): `push` = zmenil som, NA ČO sa pozerám (obrazovka,
   vlákno, vetva). `replace` = zmenil som, AKO sa na to pozerám (filtre, pohyb
   v grafe, panely). Zmenu, ktorú nevyvolal človek, robí vždy `replace`.

   JEDNO GESTO = JEDEN ZÁZNAM je vlastnosť tohto modulu, nie disciplíny volajúcich:
   zápisy sa zbierajú do jednej dávky a odosielajú sa raz na úlohu (`setTimeout 0`).
   Skok na uzol z palety teda môže volať `writeUrl` štyrikrát a v histórii je jeden
   záznam. Najsilnejší režim v dávke vyhráva (`push` > `replace`). */

/* Strop opakovaní jedného kľúča. 40 vybraných značiek dá ~900 znakov query;
   nad stropom je odkaz nezdieľateľný a zabalenie do base64 je zakázané. */
const MAX_REPEAT = 24;

/* Debounce zápisu. Filtre 220 ms, `mw` 200 ms — slider strieľa `oninput`
   desiatky ráz za sekundu a bez debounce by z jedného ťahu bolo 30 `replaceState`.
   Debouncuje TENTO modul; volajúci nedebouncuje (inak by to robili šiesti rôzne). */
const DEB_FILTER = 220;
const DEB_SLIDER = 200;

/* ---------- validátory ----------

   „Číslo, ktoré nie je číslo, je ako chýbajúce" — a to už pri parsovaní, nie
   náhodou v NaN. Každý validátor vracia KANONICKÝ string alebo null (= zahoď). */

function vInt(v) {
    const s = String(v).trim();
    if (!/^\d{1,9}$/.test(s)) return null;
    const n = parseInt(s, 10);
    return n > 0 ? String(n) : null;
}

function vText(v) {
    const s = String(v).trim();
    // Strop dĺžky je obrana proti adrese, ktorá sa nedá zdieľať; hodnoty nesú
    // diakritiku aj `#` (`#bez-projektu`), takže sa NEsanitizujú, len odmietajú.
    return s && s.length <= 160 ? s : null;
}

function vEnum(list) {
    return (v) => {
        const s = String(v).trim();
        return list.includes(s) ? s : null;
    };
}

function vFlag(v) {
    const s = String(v).trim();
    if (s === '1' || s === 'true') return '1';
    if (s === '0' || s === 'false') return '0';
    return null;
}

function vNum(min, max) {
    return (v) => {
        const s = String(v).trim();
        if (!/^\d{1,4}(\.\d{1,3})?$/.test(s)) return null;
        const n = parseFloat(s);
        if (!(n >= min && n <= max)) return null;
        // Kanonizácia: 2.50 aj 2.5 je ten istý stav, takže aj tá istá adresa.
        return String(n);
    };
}

function vStep(step, min, max) {
    return (v) => {
        const s = vInt(v);
        if (s == null) return null;
        const n = parseInt(s, 10);
        if (n < min || n > max || n % step !== 0) return null;
        return String(n);
    };
}

function vYear(v) {
    const s = String(v).trim();
    if (!/^\d{4}$/.test(s)) return null;
    const n = parseInt(s, 10);
    return n >= 1990 && n <= 2100 ? s : null;
}

function vDate(v) {
    const s = String(v).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function vUuid(v) {
    const s = String(v).trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}

function vSlug(v) {
    const s = String(v).trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,60}$/.test(s) ? s : null;
}

// Lokálny graf: `<rootId>.<depth>`, hĺbka 1–3. Jeden kľúč, pretože bez koreňa
// hĺbka nič neznamená a dva kľúče by dovolili polovičný stav.
function vLocal(v) {
    const s = String(v).trim();
    const m = /^(\d{1,9})\.([1-3])$/.exec(s);
    return m ? (parseInt(m[1], 10) > 0 ? String(parseInt(m[1], 10)) + '.' + m[2] : null) : null;
}

/* ---------- kanonický slovník — 37 kľúčov ----------

   Poradie riadkov = poradie kľúčov v adrese (manuál §10). `screen` je pole
   obrazovky, ktorá kľúč vlastní — podľa neho `clearScreenKeys()` maže filtre
   cudzích obrazoviek. `def` je default, ktorý sa vynecháva. */
const DICT = [
    // A · spoločná chrbtica
    { k: 's', kind: 'one', v: vSlug, def: 'dnes' },
    // `q` je zámerne SPOLOČNÉ (jediná výnimka z prefixov): na obrazovke je najviac
    // jedno voľné hľadanie a `knq`/`koq`/`roq` by z najčastejšieho odkazu spravili
    // najdlhší. Význam určuje `s`, preto je pri zmene obrazovky screen-scoped.
    { k: 'q', kind: 'one', v: vText, def: '', deb: DEB_FILTER, scoped: true },

    // B · zanorenie grafu. `level` NIE JE kľúč — implikuje ho najhlbší prítomný
    // z a/d/n, pretože clampNav() dopĺňa kontext nahor sám. Kamera do URL neide:
    // force layout je živý, takže tá istá kamera nad inak usadenou scénou rámuje
    // iné miesto siete — zapisovať ju by bola lož.
    { k: 'a', kind: 'one', v: vInt, def: null },
    { k: 'd', kind: 'one', v: vInt, def: null },
    { k: 'n', kind: 'one', v: vInt, def: null },
    // `sel` je iná vec než `n`: `n` filtruje scénu, `sel` otvára panel detailu.
    { k: 'sel', kind: 'one', v: vInt, def: null },

    // C · pohľad na graf
    { k: 'gv', kind: 'one', v: vEnum(['net', 'layers']), def: 'net' },
    { k: 'gs', kind: 'one', v: vEnum(['live', 'all']), def: 'live' },

    // D · filtre grafu. ft/fs/fa/fr držia SKRYTÉ hodnoty, `fg` je jediný POZITÍVNY
    // filter v rodine (VYBRANÉ značky) — kto to zamení, obráti význam odkazu.
    { k: 'ft', kind: 'set', v: vEnum(['memory', 'skill', 'project']), deb: DEB_FILTER },
    { k: 'fs', kind: 'set', v: vEnum(['session', 'skill', 'digest', 'manual']), deb: DEB_FILTER },
    { k: 'fa', kind: 'set', v: vInt, deb: DEB_FILTER },
    { k: 'fg', kind: 'set', v: vText, deb: DEB_FILTER },
    { k: 'fr', kind: 'set', v: vEnum(['part_of', 'uses', 'similarity', 'co_activation']), deb: DEB_FILTER },
    { k: 'mw', kind: 'one', v: vNum(0, 5), def: '0', deb: DEB_SLIDER },
    { k: 'sk', kind: 'one', v: vFlag, def: '0', deb: DEB_FILTER },
    { k: 'loc', kind: 'one', v: vLocal, def: null, deb: DEB_FILTER },

    // E · obrazovky dát (prefix = 2 znaky slugu obrazovky + os)
    { k: 'dep', kind: 'one', v: vText, def: null, screen: 'dennik', deb: DEB_FILTER },
    // Knižnica má zámernú asymetriu: `q` filtruje server, oblasť filtruje KLIENT
    // (server posiela limit=null). `kna` sa nesmie premietnuť do dopytu na server.
    { k: 'kna', kind: 'one', v: vSlug, def: null, screen: 'kniznica', deb: DEB_FILTER },
    // Otvorený playbook v pravom paneli. Trojička k 'roo'/'ruo'.
    { k: 'kno', kind: 'one', v: vInt, def: null, screen: 'kniznica', deb: DEB_FILTER },
    { k: 'kot', kind: 'one', v: vEnum(['core', 'skill', 'project', 'memory']), def: '', screen: 'kontrola', deb: DEB_FILTER },
    { k: 'koc', kind: 'one', v: vEnum(['overene', 'hypoteza', 'pasca']), def: '', screen: 'kontrola', deb: DEB_FILTER },
    { k: 'koa', kind: 'one', v: vSlug, def: '', screen: 'kontrola', deb: DEB_FILTER },
    { k: 'kol', kind: 'one', v: vStep(100, 100, 500), def: '100', screen: 'kontrola', deb: DEB_FILTER },
    { k: 'koo', kind: 'one', v: vInt, def: null, screen: 'kontrola', deb: DEB_FILTER },
    { k: 'roy', kind: 'one', v: vYear, def: null, screen: 'rozhodnutia', deb: DEB_FILTER },
    { k: 'roa', kind: 'one', v: vInt, def: null, screen: 'rozhodnutia', deb: DEB_FILTER },
    // Otvorené rozhodnutie v pravom paneli (G6). Dvojička k 'ruo' pre Runy —
    // kľúč je viazaný na obrazovku, takže pri prepnutí obrazovky zmizne sám a dva
    // panely sa v jednej adrese otvoriť nedajú.
    { k: 'roo', kind: 'one', v: vInt, def: null, screen: 'rozhodnutia', deb: DEB_FILTER },
    { k: 'rus', kind: 'one', v: vEnum(['running', 'waiting', 'failed', 'aborted', 'done']), def: null, screen: 'runy', deb: DEB_FILTER },
    { k: 'rum', kind: 'one', v: vText, def: null, screen: 'runy', deb: DEB_FILTER },
    { k: 'ruo', kind: 'one', v: vUuid, def: null, screen: 'runy', deb: DEB_FILTER },
    // Otvorená smernica sa adresuje MENOM, nie id: smernica je súbor
    // (`directives/<meno>.md`) a v DB riadok nemá, takže vSlug je jej presný tvar.
    { k: 'smo', kind: 'one', v: vSlug, def: null, screen: 'smernica', deb: DEB_FILTER },

    // Prečo pribudli 'kno', 'koo' a 'smo' naraz (31. 8. 2026): Knižnica, Kontrola
    // a Smernica dostali pravý panel v jednej vlne a všetky tri ho postavili
    // správne — panel sa otvoril, ale adresu nenesol. `writeUrl()` neznámy kľúč
    // TICHO ZAHODÍ (`if (!e) continue`), takže tri nezávislé merania hlásili to
    // isté: `location.search` = '?s=<obrazovka>' a kľúč panelu v nej chýba.
    // Chyba nebola v obrazovkách, ale v tom, že tento slovník nikto nedoplnil.

    // F · /chat. Vlákno nesie pathname `/chat/<uuid>`, nie kľúč.
    // `b` je ČÍTACIE: aktívna vetva je stav servera a jediná klientská cesta k nej
    // je mutácia (POST /activate), takže `b=` v adrese sa len číta do UI.
    { k: 'b', kind: 'one', v: vUuid, def: null },
    { k: 'pt', kind: 'one', v: vFlag, def: '1' },
    { k: 'pa', kind: 'one', v: vFlag, def: '0' },
    // `ar` je VYHRADENÉ a dnes neimplementovateľné: panel artefaktu sa plní
    // z argumentov živého volania nástroja a nič nenesie id, takže kľúč by po
    // obnove ukázal prázdny panel. Miesto v slovníku má, aby si ho nikto nezabral;
    // `reserved` znamená: neemituj, nezahadzuj, nevystavuj v readUrl().
    { k: 'ar', kind: 'one', v: vInt, def: null, reserved: true },
    { k: 'hr', kind: 'one', v: vEnum(['user', 'assistant']), def: null, deb: DEB_FILTER },
    { k: 'ha', kind: 'one', v: vDate, def: null, deb: DEB_FILTER },
    { k: 'hb', kind: 'one', v: vDate, def: null, deb: DEB_FILTER },
    { k: 'hn', kind: 'one', v: vUuid, def: null, deb: DEB_FILTER },
    { k: 'hp', kind: 'one', v: vUuid, def: null, deb: DEB_FILTER },
    { k: 'hl', kind: 'one', v: vStep(1, 1, 500), def: '30', deb: DEB_FILTER },
];

const BY_KEY = new Map(DICT.map((e) => [e.k, e]));

/* Rezervované mená, ktoré tento modul NEEMITUJE a NEZAHADZUJE: `token`
   (AuthenticateUi.php ich po odomknutí odstrihne redirectom sám a ostatné
   parametre zachová) a `k` (proxy `bin/hades-app.mjs`). Zásah do nich by len
   rozbil ten redirect. Sú tu menované preto, aby bolo vidieť, že to nie je
   opomenutie — technicky ich nesie tá istá cesta ako každý iný neznámy kľúč. */
export const PASSTHROUGH = ['token', 'k'];

/* `screen` je legacy alias `s` a vonkajší kontrakt dvoch nasadených spúšťačov
   (electron/main.js, bin/hades-app.mjs otvárajú `?screen=graf`). Prijíma sa NA
   ČÍTANIE, prvý zápis ho normalizuje na `s=` a odstráni. */
const LEGACY_SCREEN = 'screen';

/* ---------- čítanie ---------- */

function params() {
    return new URLSearchParams(location.search);
}

// Jedna hodnota kľúča z adresy, už validovaná a kanonická. null = nie je (alebo
// je neplatná, čo je podľa manuálu to isté).
export function urlValue(key) {
    const e = BY_KEY.get(key);
    if (!e || e.reserved) return null;
    const p = params();
    let raw = p.get(key);
    if (raw == null && key === 's') raw = p.get(LEGACY_SCREEN);
    if (raw == null) return null;
    return e.v(raw);
}

// Množina z adresy: getAll() + strop MAX_REPEAT. Nad stropom sa kľúč vynechá
// celý (prázdne pole), stav zostane lokálny — polovičná množina by bola horšia
// než žiadna, lebo odkaz by obnovil iný filter.
export function urlList(key) {
    const e = BY_KEY.get(key);
    if (!e || e.reserved) return [];
    const all = params().getAll(key);
    if (all.length > MAX_REPEAT) return [];
    const out = [];
    for (const raw of all) {
        const val = e.v(raw);
        if (val != null && !out.includes(val)) out.push(val);
    }
    out.sort();
    return out;
}

/* Celá adresa ako obyčajný objekt. Kľúč, ktorý v adrese nie je (alebo je
   neplatný), v objekte NIE JE — defaulty tu nedopisujeme, aby sa „nie je"
   a „je nastavené na default" dalo rozlíšiť. Hodnoty sú stringy (množiny polia
   stringov), pretože to je presne to, čo pôjde späť do adresy. */
export function readUrl() {
    const out = {};
    for (const e of DICT) {
        if (e.reserved) continue;
        if (e.kind === 'set') {
            const list = urlList(e.k);
            if (list.length) out[e.k] = list;
        } else {
            const v = urlValue(e.k);
            if (v != null) out[e.k] = v;
        }
    }
    return out;
}

/* Boot poradie je URL > localStorage > default V KÓDE (manuál §10). `localStorage`
   sa pýtame IBA keď kľúč v URL nie je. Uložená hodnota ide cez ten istý validátor
   ako adresa — poškodené úložisko nesmie mať väčšie práva než odkaz. */
export function bootValue(key, stored, fallback) {
    const e = BY_KEY.get(key);
    if (!e) return fallback;
    if (e.kind === 'set') {
        const fromUrl = urlList(key);
        if (fromUrl.length) return fromUrl;
        // Kľúč v adrese JE, ale nedal ani jednu platnú hodnotu. Sú to dva rôzne
        // prípady: nad stropom opakovaní stav zostáva LOKÁLNY (padáme na úložisko),
        // inak je to explicitný príkaz odkazu „bez filtra" (prázdna množina).
        if (params().has(key) && params().getAll(key).length <= MAX_REPEAT) return [];
        const list = [];
        if (Array.isArray(stored)) {
            for (const s of stored) {
                const val = e.v(s);
                if (val != null && !list.includes(val)) list.push(val);
            }
            list.sort();
            return list;
        }
        return Array.isArray(fallback) ? fallback : [];
    }
    const fromUrl = urlValue(key);
    if (fromUrl != null) return fromUrl;
    if (stored != null && stored !== '') {
        const val = e.v(stored);
        if (val != null) return val;
    }
    return fallback;
}

/* ---------- zápis ---------- */

let pending = null;          // Map key → hodnota | null (null = zmaž)
let pendingPush = false;
let timer = 0;
let applying = false;        // beží popstate → zápisy sa zahadzujú
let booted = false;          // prvý zápis po štarte nie je gesto človeka

// Normalizácia vstupu volajúceho na to, čo ide do adresy. Tolerantne: číslo,
// boolean, Set aj pole. Prázdno v každej podobe znamená „zmaž kľúč".
function normIn(e, val) {
    if (val == null || val === '' || val === false) return e.kind === 'set' ? [] : null;
    if (val === true) return '1';
    if (e.kind === 'set') {
        const arr = val instanceof Set ? Array.from(val) : (Array.isArray(val) ? val : [val]);
        const out = [];
        for (const x of arr) {
            if (x == null || x === '') continue;
            const v = e.v(x);
            if (v != null && !out.includes(v)) out.push(v);
        }
        out.sort();
        return out;
    }
    return e.v(val);
}

/* Zápis do adresy. `mode` je 'push' | 'replace'; kvôli dvom zneniam zadania sa
   prijíma aj objekt `{ history: 'push' }` — je to ten istý význam a odmietnuť
   jeden z tvarov by znamenalo, že polovica volajúcich ticho stratí režim.
   Default je 'replace': gesto sa hlási výslovne, aby sa história nezaplnila. */
export function writeUrl(patch, mode) {
    if (applying) return;                 // popstate: adresa je vstup, nie výstup
    const m = (mode && typeof mode === 'object') ? (mode.history || mode.mode) : mode;
    if (!patch || typeof patch !== 'object') return;
    if (!pending) pending = new Map();
    let deb = 0;
    for (const key of Object.keys(patch)) {
        const e = BY_KEY.get(key);
        if (!e) continue;                 // neznámy kľúč sa nezavádza adresou
        if (e.reserved) continue;         // `ar` — vyhradené, neemitovať
        pending.set(key, normIn(e, patch[key]));
        if (e.deb && e.deb > deb) deb = e.deb;
    }
    if (m === 'push') pendingPush = true;
    // Gesto (push) sa nedebouncuje — človek klikol a Späť to musí vidieť hneď.
    schedule(pendingPush ? 0 : deb);
}

function schedule(delay) {
    if (timer) clearTimeout(timer);
    // `setTimeout 0` je hranica dávky: všetky zápisy jednej úlohy (skok na uzol
    // mení obrazovku, zanorenie, vybraný uzol aj rozsah) sa zlejú do jedného
    // záznamu histórie. Debounce je trailing — ťah slidera skončí jedným zápisom.
    timer = setTimeout(flush, delay || 0);
}

/* Zmazanie kľúčov filtrov cudzích obrazoviek. Bez toho `?s=runy&roy=2026`
   prenesie rok z Rozhodnutí na Runy. Maže sa ATOMICKY s prepnutím obrazovky,
   teda v tej istej dávke — preto to nie je vlastný zápis, len patch nulami.

   Kľúče GRAFU (a, d, n, sel, gv, gs, ft, fs, fa, fg, fr, mw, sk, loc) sa ZÁMERNE nemažú: zanorenie je
   filter nad jednou scénou, nie stav obrazovky, a človek sa na Graf vracia do
   toho istého miesta siete (plátno mu ten stav drží aj v pamäti). Mazať ich by
   znamenalo, že odchod na Denník zabudne, kde v sieti bol. */
export function clearScreenKeys(nextScreen, mode) {
    const patch = {};
    for (const e of DICT) {
        if (e.reserved) continue;
        if (e.screen && e.screen !== nextScreen) patch[e.k] = null;
        else if (e.scoped) patch[e.k] = null;
    }
    writeUrl(patch, mode);
}

/* Poskladanie adresy a jeden zápis do histórie.

   Poradie je poradie DICT, hodnoty prejdú validátorom ešte raz (aj tie, ktoré
   v adrese už boli — inak by neplatná hodnota z odkazu prežila navždy) a všetko
   sa skladá výhradne URLSearchParams-om. Neznáme kľúče (vrátane `token` a `k`)
   sa prenesú nedotknuté; legacy `screen` sa zahodí, jeho hodnotu už nesie `s`. */
function flush() {
    timer = 0;
    const patch = pending;
    const push = pendingPush && booted;   // prvý zápis po štarte nie je gesto
    pending = null;
    pendingPush = false;
    booted = true;
    if (applying) return;

    const cur = params();
    const out = new URLSearchParams();
    const keys = [];

    for (const e of DICT) {
        if (e.reserved) {
            // Vyhradený kľúč sa neemituje, ale ani nezahadzuje.
            for (const raw of cur.getAll(e.k)) out.append(e.k, raw);
            continue;
        }
        let vals;
        if (patch && patch.has(e.k)) {
            const v = patch.get(e.k);
            vals = e.kind === 'set' ? v : (v == null ? [] : [v]);
        } else if (e.kind === 'set') {
            vals = urlList(e.k);
        } else {
            const v = urlValue(e.k);
            vals = v == null ? [] : [v];
        }
        if (e.kind === 'set') {
            if (!vals.length || vals.length > MAX_REPEAT) continue;
            for (const v of vals) out.append(e.k, v);
            keys.push(e.k);
        } else {
            const v = vals[0];
            if (v == null) continue;
            if (e.def != null && String(v) === String(e.def)) continue;   // default sa vynecháva
            out.append(e.k, v);
            keys.push(e.k);
        }
    }

    // Neznámy kľúč sa prenesie nedotknutý (v pôvodnom poradí, za známymi).
    for (const [key, val] of cur.entries()) {
        if (key === LEGACY_SCREEN || BY_KEY.has(key)) continue;
        out.append(key, val);
    }

    const qs = out.toString();
    const next = location.pathname + (qs ? '?' + qs : '') + location.hash;
    const now = location.pathname + location.search + location.hash;

    // Merací hák: harness musí čítať, čo modul naozaj serializoval, nie kópiu
    // formuly (po zmene kódu by kópia merala samú seba).
    try {
        const H = (window.HADES = window.HADES || {});
        H._urlKeys = keys;
        H._urlWrites = (H._urlWrites || 0) + (next === now ? 0 : 1);
    } catch (err) { /* window nie je náš problém */ }

    if (next === now) return;             // rovnaká adresa = žiadny záznam
    try {
        if (push) history.pushState(history.state, '', next);
        else history.replaceState(history.state, '', next);
    } catch (err) { /* história môže hodiť (sandbox) — navigácia sa tým nezhodí */ }
}

// Okamžité odoslanie čakajúcej dávky. Volá to meranie a boot; bežný kód nie —
// čakanie na hranicu úlohy je práve to, čo drží „jedno gesto = jeden záznam".
export function flushUrl() {
    if (timer) clearTimeout(timer);
    flush();
}

/* ---------- Späť / Dopredu ----------

   Bez tohto by tlačidlo Naspäť menilo adresu a nechalo appku stáť — teda by
   URL lhala. Aplikátory sa registrujú podľa mena (kto vlastní kľúč, ten ho
   aplikuje); zápisy počas aplikovania sa zahadzujú, inak by Späť pridalo nový
   záznam do histórie. */
const appliers = new Map();

export function registerUrlApply(name, fn) {
    if (typeof fn === 'function') appliers.set(name, fn);
}

export function applyUrlNow(reason) {
    const url = readUrl();
    applying = true;
    try {
        for (const fn of appliers.values()) {
            try { fn(url, { reason: reason || 'popstate' }); } catch (err) { /* jeden aplikátor nesmie zhodiť ostatné */ }
        }
        // Obrazovku vlastní `screens.js` (cudzí súbor). Keď si aplikátor
        // neregistroval, skúsime hák, ktorý appka vystavuje na window.
        if (!appliers.has('screen') && url.s) {
            const set = window.HADES && window.HADES.setScreen;
            if (typeof set === 'function') set(url.s);
        }
    } finally {
        applying = false;
        pending = null;
        pendingPush = false;
        if (timer) { clearTimeout(timer); timer = 0; }
    }
}

let wired = false;

/* Naviazanie na okno. Volá to `state.js` (jediný modul, ktorý importuje každý),
   aby modul nezostal mŕtvym kódom — presne to sa 25. 8. 2026 stalo siedmim
   hotovým modulom vlny, o ktorých PHP testy nepovedali nič. */
export function wireUrlState() {
    if (wired || typeof window === 'undefined') return;
    wired = true;
    window.addEventListener('popstate', () => applyUrlNow('popstate'));

    /* Zrkadlo obrazovky. `body[data-screen]` píše výhradne `setScreen()`
       (`screens.js`), takže je to jediný spoľahlivý signál „obrazovka sa zmenila"
       — a keďže query string smie písať len tento modul, zrkadlo patrí sem, nie
       tam. Zmena obrazovky je gesto → `push`, a v tej istej dávke sa atomicky
       mažú filtre cudzích obrazoviek.

       Prvá emisia po štarte je `replace` (`booted`): obnovenie uloženej voľby
       nie je gesto človeka a nesmie pridať záznam do histórie. */
    if (typeof MutationObserver === 'function' && document.body) {
        let last = null;
        let mirrored = false;
        const obs = new MutationObserver(() => {
            if (applying) return;
            const name = document.body.dataset.screen;
            if (!name) return;
            /* ZÁPIS TEJ ISTEJ HODNOTY JE TIEŽ MUTÁCIA. `setScreen()` nastavuje
               atribút bezpodmienečne a `setAttribute` s nezmenenou hodnotou observer
               spustí — zmerané: klik na už aktívny cieľ railu pridal záznam do
               histórie a atomicky zmazal filtre obrazovky, na ktorej človek stál.
               Preto sa porovnáva s poslednou ODRAZENOU hodnotou, nie s atribútom. */
            if (name === last) return;
            const first = !mirrored;
            last = name;
            mirrored = true;
            // Prvý odraz po štarte je obnovenie uloženej voľby, nie gesto človeka.
            clearScreenKeys(name, first ? 'replace' : 'push');
            writeUrl({ s: name }, first ? 'replace' : 'push');
        });
        obs.observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
    }
}
