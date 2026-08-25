/* ===========================================================================
   Chat — diktovanie.

   ČO TENTO SÚBOR JE: prehliadačové rozpoznávanie reči (Web Speech API) ako druhý
   vstup do poľa správy. Nič viac — text sa iba vloží do `#chat-prompt` a odošle
   ho človek, tak ako keby ho napísal.

   ## Kam ide zvuk a čo o tom smiem tvrdiť

   Kontrakt §3 hovorí „prehliadačové Web Speech API — **nič do cloudu**". Presne
   to platí pre TENTO kód a je to overiteľné: modul neposiela ani jeden bajt na
   žiadny endpoint (žiadny `fetch`, žiadny SDK, žiadny kľúč, žiadny cudzí origin
   v CSP), zvuk sa nikde neukladá a Hades ho nikdy nevidí.

   Čo tvrdiť NESMIEM: že rozpoznávanie samo je lokálne. `SpeechRecognition` je
   implementácia PREHLIADAČA a v Chrome je to jeho serverová služba — presne
   preto existuje chybový kód `network` a preto je nižšie preložený vetou, ktorá
   to hovorí nahlas. Kto potrebuje diktovanie bez siete, má diktovanie
   operačného systému; to píše do poľa ako klávesnica a tento modul preň nie je
   potrebný.

   ## Keď API nie je, tlačidlo nie je

   Ovládač, ktorý nič nerobí, je horší než chýbajúci: človek si myslí, že
   diktovanie appka má, a hľadá chybu u seba. Preto `wireVoice()` pri chýbajúcom
   API skončí a v DOM nezostane nič.

   ## Ikona

   Tlačidlo NEMÁ Material ikonu. `mic` nie je v subsete (215 glyfov) overený a
   nevykreslená ligatúra sa zobrazí ako slovo „mic" — to je porucha, pre ktorú
   subset vznikol. Kým sa `mic` nedomerí (šírka glyfu ≈ 1 em), nesie stav bodka
   z CSS a slovo; tá bodka je ten istý jazyk, akým tok správ hovorí čakanie
   (`.cm-dot`).

   Všetko sú HOISTOVANÉ `export function` — modulový graf chatu má cyklus a
   `export const foo = () => {}` v cykle spadne na `ReferenceError`.
   =========================================================================== */

import { el } from './render.js';
import { autoGrowPrompt, live } from './main.js';

/** Stav diktovania. */
const V = {
    /** Instancia `SpeechRecognition`, alebo null. */
    rec: null,
    /** Beží diktovanie? */
    on: false,
    /** Hodnota poľa v okamihu zapnutia — text človeka sa neprepisuje. */
    base: '',
    /** Pozícia kurzora v okamihu zapnutia; diktované ide sem. */
    at: 0,
    /** Dopovedané úseky (`isFinal`), teda to, čo v poli zostane. */
    committed: '',
    /** Rozpracovaný úsek — v poli je vidieť, ale ešte sa môže zmeniť. */
    interim: '',
    /** Píše práve do poľa tento modul? Chráni pred vlastným `input` handlerom. */
    writing: false,
};

/** Prebehla inicializácia? `bootVoice()` je idempotentné. */
let booted = false;

/**
 * Vety k chybovým kódom Web Speech API.
 *
 * `network` je tu preložený tak, ako to naozaj je (viď hlavička súboru): keby
 * hláška povedala len „chyba siete", človek by hľadal chybu v Hadesovi, ktorý
 * s rozpoznávaním nemá nič.
 */
const ERROR_NOTE = {
    'not-allowed': 'Prehliadač nedal prístup k mikrofónu. Povoľ ho v adresnom riadku a skús znova.',
    'service-not-allowed': 'Prehliadač rozpoznávanie reči nepovolil.',
    'audio-capture': 'Mikrofón sa nenašiel.',
    'no-speech': 'Nič som nezachytil.',
    aborted: '',
    network: 'Rozpoznávanie reči je nedostupné — robí ho prehliadač a bez siete nefunguje.',
};

/** Kódy, po ktorých sa nemá skúšať znova — inak by sa hláška opakovala v cykle. */
const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network'];

/* ---------------------------------------------------------------------------
   API PREHLIADAČA
   --------------------------------------------------------------------------- */

/** @returns {Function|null} konštruktor rozpoznávania, alebo null. */
export function speechApi() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Je diktovanie k dispozícii? Používa to aj `bootVoice()` na rozhodnutie o DOM. */
export function voiceAvailable() {
    return speechApi() !== null;
}

/* ---------------------------------------------------------------------------
   POLE SPRÁVY

   Vlastník poľa je človek. Diktovanie doňho píše len medzi svojím zapnutím a
   vypnutím, a len na to miesto, kde stál kurzor — nikdy neprepíše, čo tam bolo.
   --------------------------------------------------------------------------- */

function promptField() {
    return document.getElementById('chat-prompt');
}

/**
 * Prepíše pole z aktuálneho stavu diktovania.
 *
 * Skládá sa vždy celé zo `base` + diktované + zvyšok: prírastkové dopisovanie by
 * pri opravenom rozpracovanom úseku (engine ho posiela znova a inak) nechalo
 * v poli oba tvary.
 */
function paintPrompt() {
    const field = promptField();

    if (!field) return;

    const spoken = V.committed + V.interim;
    const head = V.base.slice(0, V.at);
    const tail = V.base.slice(V.at);
    // Medzera medzi napísaným a nadiktovaným — bez nej sa slová zlepia.
    const glue = spoken !== '' && head !== '' && !/\s$/u.test(head) ? ' ' : '';

    V.writing = true;
    field.value = head + glue + spoken + tail;

    const caret = (head + glue + spoken).length;

    field.setSelectionRange(caret, caret);
    V.writing = false;

    autoGrowPrompt();
}

/* ---------------------------------------------------------------------------
   DIKTOVANIE
   --------------------------------------------------------------------------- */

export function startDictation() {
    const Api = speechApi();
    const field = promptField();

    if (!Api || !field || V.on) return;

    const rec = new Api();

    // `sk-SK` z atribútu dokumentu, nie natvrdo: `chat.blade.php` má `lang="sk"`
    // a keby sa plocha niekedy prekladala, jazyk diktovania sa má hýbať s ňou.
    rec.lang = (document.documentElement.lang || 'sk').startsWith('sk')
        ? 'sk-SK'
        : document.documentElement.lang;
    // Bez `continuous` engine skončí po prvej vete a človek by musel klikať po
    // každom nádychu.
    rec.continuous = true;
    // Rozpracovaný úsek je jediný dôkaz, že sa niečo deje — pri diktovaní dlhého
    // zadania by inak pole zostalo prázdne aj desiatky sekúnd.
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
        let interim = '';

        // Od `resultIndex`, nie od nuly: `continuous` engine drží v `results` celú
        // session a prechod od nuly by dopovedané úseky pripísal druhý raz.
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = String(result[0]?.transcript ?? '');

            if (result.isFinal) V.committed += (V.committed === '' ? '' : ' ') + text.trim();
            else interim += text;
        }

        V.interim = interim.trim();
        paintPrompt();
    };

    rec.onerror = (event) => {
        const code = String(event?.error || '');
        const note = ERROR_NOTE[code] ?? `Diktovanie zlyhalo (${code}).`;

        if (note !== '') live(note);

        // Po fatálnej chybe sa diktovanie vypína celé: `onend` by ho inak
        // naštartoval znova a hláška by sa opakovala každú sekundu.
        if (FATAL.includes(code)) stopDictation({ quiet: true });
    };

    rec.onend = () => {
        // Chrome prúd sám zavrie po chvíli ticha. Kým človek diktovanie
        // nevypol, pokračuje sa — inak by sa uprostred zadania prestalo
        // nahrávať bez toho, aby to čokoľvek povedalo.
        if (!V.on) return;

        // Rozpracovaný úsek sa pri prerušení stráca, takže sa dopovie ako hotový;
        // zahodiť ho by znamenalo, že sa nadiktovaná veta stratí bez slova.
        commitInterim();

        try {
            rec.start();
        } catch {
            // Engine sa nedal naštartovať znova (býva to na Androide). Diktovanie
            // sa vypne čestne, namiesto toho, aby tlačidlo tvrdilo, že nahráva.
            stopDictation();
        }
    };

    V.rec = rec;
    V.on = true;
    V.base = field.value;
    V.at = Number.isFinite(field.selectionStart) ? field.selectionStart : field.value.length;
    V.committed = '';
    V.interim = '';

    try {
        rec.start();
    } catch {
        V.on = false;
        V.rec = null;
        live('Diktovanie sa nepodarilo zapnúť.');
        paintButton();

        return;
    }

    paintButton();
    live('Nahrávam. Hovor; ďalším klikom diktovanie vypneš.');
}

/**
 * Vypne diktovanie. Text v poli ZOSTÁVA — je to text človeka, nie stav modulu.
 *
 * @param {{quiet?: boolean}} [options]  `quiet` nehlási nič (hlásil už dôvod)
 */
export function stopDictation({ quiet = false } = {}) {
    if (!V.on) return;

    const rec = V.rec;

    V.on = false;
    V.rec = null;

    if (rec) {
        // `onend` sa už nemá rozbehnúť znova; handlery sa odopnú pred `stop()`.
        rec.onend = null;
        rec.onresult = null;
        rec.onerror = null;

        try {
            rec.stop();
        } catch {
            // Prúd už zavretý — nie je čo zastavovať.
        }
    }

    commitInterim();
    paintButton();

    if (!quiet) live('Diktovanie vypnuté.');
}

export function toggleDictation() {
    if (V.on) stopDictation();
    else startDictation();
}

/** Rozpracovaný úsek sa stane hotovým — inak by pri vypnutí z poľa zmizol. */
function commitInterim() {
    if (V.interim === '') return;

    V.committed += (V.committed === '' ? '' : ' ') + V.interim;
    V.interim = '';
    paintPrompt();
}

/* ---------------------------------------------------------------------------
   TLAČIDLO
   --------------------------------------------------------------------------- */

export function ensureButton() {
    const row = document.querySelector('#chat-composer .cc-row');

    if (!row || !voiceAvailable() || document.getElementById('chat-voice')) return null;

    const btn = el('button', 'cv-btn');

    btn.type = 'button';
    btn.id = 'chat-voice';
    btn.setAttribute('aria-pressed', 'false');

    const dot = el('span', 'cv-dot');

    dot.setAttribute('aria-hidden', 'true');
    btn.append(dot);
    btn.append(el('span', 'cv-lbl', 'Diktovať'));
    btn.addEventListener('click', toggleDictation);

    // Pred Poslať: diktovanie je vstup do správy, takže patrí k poľu, nie za
    // akciu, ktorá správu odosiela.
    row.insertBefore(btn, document.getElementById('chat-send'));
    paintButton();

    return btn;
}

/**
 * Stav tlačidla.
 *
 * Trojica trieda + `aria-pressed` + text sa nastavuje na JEDNOM mieste, aby sa
 * kresba, prístupné meno a slovo na tlačidle nemohli rozísť. Stav nahrávania
 * hovorí navyše `live()` (`#chat-live`, `aria-live="polite"`) — pulzujúca bodka
 * je pre čítačku nič.
 */
export function paintButton() {
    const btn = document.getElementById('chat-voice');

    if (!btn) return;

    btn.classList.toggle('is-on', V.on);
    btn.setAttribute('aria-pressed', V.on ? 'true' : 'false');
    btn.title = V.on ? 'Vypnúť diktovanie' : 'Diktovať do správy';
    btn.setAttribute('aria-label', V.on ? 'Nahrávam — vypnúť diktovanie' : 'Diktovať do správy');

    const label = btn.querySelector('.cv-lbl');

    if (label) label.textContent = V.on ? 'Nahrávam' : 'Diktovať';
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

export function wireVoice() {
    // Bez API sa nedrôtuje nič a v DOM nezostane ani tlačidlo (viď hlavička).
    if (!voiceAvailable()) return;

    ensureButton();

    // Človek začal písať → pole je jeho a diktovanie skončí. Bez tohto pravidla
    // by sa dva pisatelia bili o jednu hodnotu: `paintPrompt()` skládá pole z
    // `V.base`, ktorý by po ručnej úprave už neplatil, a napísané by zmizlo.
    document.getElementById('chat-prompt')?.addEventListener('input', () => {
        if (V.on && !V.writing) stopDictation();
    });

    // Správa odišla — diktovať do prázdneho poľa ďalej nemá zmysel a človek by
    // si to všimol až vetou, ktorá tam nemá čo robiť.
    document.addEventListener('chat:submit', () => { stopDictation({ quiet: true }); });

    // Prepnutie vlákna vymení obsah poľa pod rukami; `V.base` by prestal platiť.
    document.addEventListener('chat:thread', () => { stopDictation({ quiet: true }); });

    // Odchod zo stránky drží mikrofón otvorený, kým prehliadač kartu nezruší.
    window.addEventListener('pagehide', () => { stopDictation({ quiet: true }); });
}

export function bootVoice() {
    if (booted) return;

    booted = true;
    wireVoice();
}

document.addEventListener('chat:ready', bootVoice);
