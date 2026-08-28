/* ===========================================================================
   Charón — slovník podagentov (`spawn_agent`).

   Čo o podbehu POVIE každá plocha rovnako: ohlásenia do čítačky, veta o chýbajúcom
   náhľade, meta zlomok („profil x · kroky 2/6") a argumenty karty brány poskladané
   z rámca `agent_wait`. Vzniklo vo vlne 4, keď sekcia podagentov stála dvakrát —
   raz v `public/js/console/run.js`, raz v `public/js/mind/charon.js` — a obe kópie
   mali tie isté texty aj tú istú chybu.

   Čo tu ZÁMERNE NIE JE: kreslenie. Konzola je technická plocha a nesie celý
   priebeh dieťaťa vo vlastnom rámci (`.agent-run`), dok nad grafom je 320–440 px
   úzky pás nad plátnom a nesie len pás + kartu brány, `/chat` má plný strom
   s hodinami. Jedna kresba pre všetky tri by bola horšia než tri kresby — toto je
   slovník, nie view. Tá istá hranica ako v `shared/gate.js`.

   Modul je LEAF: neimportuje nič — ani zo `shared/`, ani z `console/`, `chat/`,
   `mind/`. Plochy sa cez zdieľaný slovník nesmú dostať do cyklu. Preto sa
   formátovač čísel (`num`) podáva ako argument, presne ako v `costLabel()`.

   Exporty sú hoistované `export function` (graf modulov má cykly a arrow v
   `const` by pri cykle spadla na ReferenceError). Texty sú súkromné konštanty
   a von idú funkciami — ten istý dôvod.
   =========================================================================== */

/* Náhľad, ktorý neprišiel, sa MUSÍ priznať. Rámec `agent_wait` nesie meno nástroja
   a `child_call`, ale nie diff: karta poskladaná z neho by inak nútila povoliť
   zápis naslepo bez toho, aby bolo vidieť, že chýba. Rozhodnutie bez diffu je
   horšie než pekná karta, ale lepšie než beh, ktorý čaká navždy. */
const NO_PREVIEW = 'Náhľad zmeny nie je k dispozícii — prišlo len ohlásenie, že podagent zaparkoval na zápise.';

const AGENT_FAILED = 'Podagent zlyhal.';

/* „Hotovo" je normálny konec a nemá čo dodať; táto veta je fallback pre podbeh,
   ktorý neposlal ani cenu, ani neriadny stav — inak by pás skončil prázdnym
   odstavcom a vyzeral ako porucha. */
const AGENT_DONE = 'Podagent dokončil.';

/** Ohlásenie štartu podbehu do čítačky (rámec `agent_start`). */
export function agentStartAnnounce(frame) {
    return `Podagent začal pracovať s profilom ${frame?.profile || 'bez profilu'}.`;
}

/**
 * Ohlásenie zaparkovaného zápisu dieťaťa (rámec `agent_wait`).
 *
 * Meno nástroja je v zátvorke a nie v hlavnej vete: rozhoduje sa o ZÁPISE, ktorý
 * karta popíše vetou z `writeAsk()`, a technické meno je tu len ako spojka medzi
 * ohlásením a kartou.
 */
export function agentWaitAnnounce(frame) {
    const name = frame?.name ? ` (${frame.name})` : '';

    return `Podagent čaká na tvoje rozhodnutie o zápise${name}.`;
}

/** Veta k rámcu `error` dieťaťa. Správa modelu má prednosť, fallback je náš. */
export function agentErrorText(frame) {
    return frame?.message || AGENT_FAILED;
}

/**
 * Meta zlomok pásu/rámca podbehu.
 *
 * Kroky sú VŽDY zlomok („kroky 0/4"), nie „strop 4 kroky": slovenčina má tri
 * tvary a číslo pred slovom sa musí skloňovať — „strop 6 kroky" bolo zlé pre
 * každý strop okrem 2–4. Zlomok skloňovanie nepotrebuje a navyše hovorí aj to,
 * kam sa ide.
 *
 * `tools` je nepovinné: konzola nástroje dieťaťa počíta (kreslí ich karty), dok
 * nad grafom nie — a bez nich zlomok o nich mlčí, nehlási nulu.
 *
 * `num` je formátovač čísel volajúcej plochy (`num(value, digits)`), nie import —
 * viď hlavička modulu.
 */
export function agentMetaText(entry, num) {
    const bits = [];

    if (entry.profile) bits.push(`profil ${entry.profile}`);
    if (entry.of) bits.push(`kroky ${num(entry.steps, 0)}/${num(entry.of, 0)}`);
    else if (entry.steps) bits.push(`kroky ${num(entry.steps, 0)}`);
    if (entry.tools) bits.push(`nástroje ${num(entry.tools, 0)}`);

    return bits.join(' · ');
}

/**
 * Pata podbehu (rámec `agent_end`): cena a stav.
 *
 * `cost` je HOTOVÝ reťazec z `costLabel()` — modul si ho neskladá sám, aby
 * nemusel importovať `shared/runstate.js` a zostal leaf. Stav sa hlási len keď
 * NIE JE `done`: „hotovo" je normálny konec, kým `aborted`/`failed` je informácia,
 * ktorá by inak vypadla.
 */
export function agentFootText(cost, status) {
    const bits = [];

    if (cost) bits.push(cost);
    if (status && status !== 'done') bits.push(`stav ${status}`);

    return bits.length ? bits.join(' · ') : AGENT_DONE;
}

/**
 * Argumenty karty brány poskladané z rámca `agent_wait`.
 *
 * Použije sa len vtedy, keď karta ešte nestojí — vnorený rámec `permission`
 * (s náhľadom) zvyčajne príde tesne pred `agent_wait`. Bez `child_call` vracia
 * `null`: karta bez id volania sa nedá rozhodnúť, `/decide` by nemal čo poslať.
 *
 * `arguments: null` je zámerné — tento rámec ich nenesie a karta si ich nesmie
 * domyslieť. Náhľad je priznanie, že diff chýba (viď `NO_PREVIEW`).
 */
export function agentWaitCard(frame) {
    const id = frame?.child_call;

    if (id == null) return null;

    return {
        id,
        name: frame.name || '',
        arguments: null,
        preview: NO_PREVIEW,
    };
}
