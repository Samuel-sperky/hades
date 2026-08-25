/* ===========================================================================
   Kopírovanie do schránky — jedna mechanika pre všetky plochy.

   Do 25. 8. 2026 bola tá istá mechanika DVAKRÁT: `chat/artifact.js` a
   `console/render.js` mali každý vlastné `copyButton()`, `flash()`,
   `toClipboard()`, `legacyCopy()`, `equipCopy()` a `equipCode()` — vrátane
   dvoch kópií textov a dvoch kópií 1 600 ms. Presne ten druh dvojice, ktorý
   audit 19. 8. 2026 našiel na šiestich miestach a ktorý sa vždy rozišiel.

   TRI VECI, KTORÉ TENTO MODUL DRŽÍ:

   1. **Do schránky ide SUROVÝ text, nikdy vykreslené HTML.** Zvýrazňovač aj
      markdown renderer pracujú nad UŽ escapovaným textom a vyrábajú
      `<span class="t-*">`; `pre.textContent` po zvýraznení preto nie je to isté
      ako pred ním (pri `diff` skladá `diffHtml()` riadky ako blokové `<span>`
      bez znakov nového riadka, takže celý diff by sa skopíroval na jeden
      riadok). `equipCode()` si preto surový text prečíta PRED `paint()` a drží
      ho v uzávere — poradie „prečítaj surové, potom zvýrazni" je invariant
      tohto modulu, nie detail implementácie.

   2. **Popisok je TEXT, nie ikona.** Material Symbols je v tomto projekte
      subset (215 glyfov zo 4271) a `content_copy` v ňom OVERENÝ NIE JE —
      nevykreslená ligatúra by sa ukázala ako slovo „content_copy". Tento modul
      preto nepridáva ani jednu ikonu; kým sa glyf neodmeria (šírka ≈ 1 em) a
      prípadne nezregeneruje subset, ikona sem nepatrí.

   3. **Je to LIST grafu — neimportuje nič z `chat/` ani z `console/`.** Import
      ktorejkoľvek plochy by z dvoch plôch urobil cyklus a z tohto modulu
      spoločnú závislosť, ktorá o oboch vie. Preto sem dve veci, ktoré sa medzi
      plochami LÍŠIA, chodia ako ARGUMENT:
        · `announce` — každá plocha má vlastnú `aria-live` oblasť
          (`#run-announce` na konzole, `#chat-announce` v `/chat`),
        · `paint` — zvýrazňovač má len `/chat` (`chat/highlight.js`); konzola
          bloky kódu nezvýrazňuje vôbec, takže tam `paint` chýba a blok zostane
          čistým textom presne ako dnes.
      Bez argumentu ani jedna z nich nespadne, len sa nestane — `announce` je
      voliteľné iba preto, aby chýbajúca oblasť nehodila výnimku, NIE preto, že
      by sa dalo hlásenie vynechať. Obe plochy ho posielajú.

   Exporty sú hoistované `export function` — pravidlo projektu; tento modul
   síce v cykle nie je, ale kód, ktorý ho volá, v ňom je.
   =========================================================================== */

/* Popisky a časovanie na jednom mieste, pretože práve tie sa v dvoch kópiách
   rozchádzajú prvé. `COPY_HOLD` je 1 600 ms: kratšie než sekunda sa pri pohľade
   do schránky stihne minúť. */
const COPY_IDLE = 'Kopírovať';
const COPY_DONE = 'Skopírované';
const COPY_FAIL = 'Nedá sa skopírovať';
const COPY_HOLD = 1600;

const copyTimers = new WeakMap();

/* Element s triedou a TEXTOM — úmyselne PRIVÁTNA štvorriadková pomôcka, nie
   tretia kópia exportovaného `el()`: `chat/render.js` ani `console/dom.js` sa
   sem importovať nesmú (bod 3 vyššie) a `shared/dom.js` nevzniká kvôli štyrom
   riadkom. Zhoduje sa s oboma `el()` znak po znaku v tom, na čom tu záleží:
   `textContent`, nikdy `innerHTML`. */
function node(tag, cls, text) {
    const out = document.createElement(tag);

    if (cls) out.className = cls;
    if (text !== undefined && text !== null) out.textContent = String(text);

    return out;
}

/**
 * Tlačidlo, ktoré skopíruje to, čo vráti `read()`.
 *
 * `name` je PRÍSTUPNÝ NÁZOV a musí povedať, čo presne kopíruje: v jednom toku
 * stojí vedľa seba tlačidlo odpovede aj tlačidlá jednotlivých blokov kódu a
 * „Kopírovať" trikrát je pre čítačku zoznam bez rozdielu.
 *
 * Je to `<button type="button">`, takže je dosiahnuteľné klávesnicou bez ďalšej
 * práce; prsteň fokusu nesie globálne `:focus-visible` v mind.css a vlastný sa
 * tu nepíše.
 *
 * @param {string} name prístupný názov (aj `title`)
 * @param {() => string} read surový text, ktorý sa má skopírovať
 * @param {(text: string) => void} [announce] hlásenie do `aria-live` plochy
 */
export function copyButton(name, read, announce) {
    const btn = node('button', 'copy-btn ghost', COPY_IDLE);

    btn.type = 'button';
    btn.setAttribute('aria-label', name);
    btn.title = name;

    btn.addEventListener('click', async () => {
        const ok = await toClipboard(read());

        flash(btn, ok ? COPY_DONE : COPY_FAIL, name, announce);
    });

    return btn;
}

/* Bez viditeľného potvrdenia človek nevie, či klik zabral — do schránky sa
   pozrieť nedá. Popisok sa vráti sám; `announce()` to povie aj čítačke, ktorej
   samotná zmena textu v tlačidle nehlási nič. Časovač je PER TLAČIDLO: jeden
   spoločný by pri druhom kliku zrušil obnovu prvého a tomu by popisok zostal na
   „Skopírované" navždy. */
function flash(btn, text, name, announce) {
    clearTimeout(copyTimers.get(btn));
    btn.textContent = text;
    btn.classList.toggle('is-done', text === COPY_DONE);
    announce?.(`${name}: ${text.toLowerCase()}.`);

    copyTimers.set(btn, setTimeout(() => {
        btn.textContent = COPY_IDLE;
        btn.classList.remove('is-done');
    }, COPY_HOLD));
}

/** `navigator.clipboard` padá bez bezpečného kontextu aj bez fokusu dokumentu,
    takže záložná cesta nie je teoretická — appka sa reálne otvára aj cez tunel. */
async function toClipboard(text) {
    const value = String(text ?? '');

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);

            return true;
        } catch {
            // Padáme na `execCommand` nižšie — odmietnuté povolenie nie je chyba.
        }
    }

    return legacyCopy(value);
}

function legacyCopy(value) {
    const back = document.activeElement;
    const ta = node('textarea', 'copy-fallback');

    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    document.body.append(ta);

    let ok = false;

    try {
        ta.select();
        ok = document.execCommand('copy');
    } catch {
        ok = false;
    }

    ta.remove();
    // Výber v odloženej textarea zoberie fokus. Bez vrátenia by klávesnica po
    // kopírovaní spadla na <body> a človek by sa musel do toku pretabovať znova.
    if (back instanceof HTMLElement) back.focus();

    return ok;
}

/**
 * Hotová odpoveď dostane tlačidlá: jedno na celú odpoveď, jedno na každý blok.
 *
 * Do schránky patrí SUROVÝ markdown, nie vykreslený text — odpoveď sa lepí do
 * zadania pre iného agenta a z `innerText` by z odrážok, nadpisov a blokov kódu
 * zostali holé riadky. Preto `read()`, ktoré dodá volajúci (surová podoba ťahu);
 * `innerText` je až záloha, keď surová podoba nie je (a prázdny reťazec je „nie
 * je" — tlačidlo, ktoré skopíruje nič, kým bublina text má, je chyba).
 *
 * Volať AŽ na dopísanú bublinu a PRED jej vložením do toku: tok je `aria-live`
 * s `aria-relevant="additions"`, takže tlačidlo pridané do už vloženej bubliny
 * by čítačka ohlásila ako nový obsah odpovede. Idempotentné — druhé volanie nič
 * nepridá.
 *
 * Selektory pokrývajú OBE názvoslovia: `.cm-who` / `.cm-bubble` je tok `/chat`,
 * `.who` / `.bubble` je tok konzoly. Je to jedna funkcia pre dva markupy, nie
 * dve funkcie — a je to dôvod, prečo tento kus môže žiť v `shared/`.
 */
export function equipCopy(box, read, announce, paint) {
    const who = box?.querySelector('.cm-who, .who');
    const bubble = box?.querySelector('.cm-bubble, .bubble');

    if (!who || !bubble || who.querySelector('.copy-btn')) return;

    who.append(copyButton('Kopírovať odpoveď', () => {
        const raw = read?.();

        return raw === undefined || raw === null || raw === '' ? bubble.innerText : raw;
    }, announce));
    equipCode(bubble, announce, paint);
}

/**
 * Každý blok kódu v `root` dostane hlavičku (jazyk + Kopírovať) a voliteľne
 * zvýraznenie.
 *
 * Obal a hlavička NAD blokom, nie tlačidlo v ňom: `pre.code` skroluje sám
 * (`overflow-x: auto`), takže tlačidlo vnútri by pri širokom kóde odišlo mimo
 * dohľadu, a nad kódom nemá čo prekryť. Hlavička zároveň ukáže `data-lang`,
 * ktorý `renderMarkdown` dávno zapisuje.
 *
 * `raw` sa čítá PRED `paint()` a je to invariant, nie detail (viď bod 1 v
 * hlavičke modulu). Bez `paint` sa blok nezvýrazní a `raw` je jeho text tak
 * ako ho zložil `renderMarkdown` — to je stav konzoly.
 */
export function equipCode(root, announce, paint) {
    root?.querySelectorAll('pre.code').forEach((pre) => {
        if (pre.parentElement?.classList.contains('code-wrap')) return;

        const lang = pre.dataset.lang || '';
        const raw = (pre.querySelector('code') ?? pre).textContent ?? '';
        const wrap = node('div', 'code-wrap');

        paint?.(pre, lang);
        pre.replaceWith(wrap);
        wrap.append(codeHead(lang, () => raw, announce), pre);
    });
}

/**
 * Hlavička bloku kódu. Meno jazyka vľavo, kopírovanie vpravo.
 *
 * `label` prepíše prístupný názov tlačidla — panel artefaktu kopíruje „zdroj",
 * „diff" a „kód", a všetky tri stoja v jednom dokumente vedľa seba.
 */
export function codeHead(lang, read, announce, label) {
    const head = node('div', 'code-head');

    if (lang) head.append(node('span', 'code-lang', lang));
    head.append(copyButton(label || (lang ? `Kopírovať kód (${lang})` : 'Kopírovať kód'), read, announce));

    return head;
}
