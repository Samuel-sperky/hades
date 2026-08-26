# PATCH pre `public/css/mind.css` — jedno vloženie, pripravené naslepo

Stav: 26. 8. 2026, vetva `feat/hades-ux`, HEAD `c81fa63`.
`public/css/mind.css` drží **paralelná session** (git status ho hlási ako modified),
preto ho tento agent neotvoril na zápis. Dokument je tak napísaný, aby sa dal
aplikovať v jednom kroku bez ďalšieho merania.

Súbory, ktorých sa patch dotýka:

| súbor | krok | kto |
|---|---|---|
| `public/css/mind.css` | **KROK 1** — vloženie zdieľaného bloku | orchestrátor, po uvolnení súboru |
| `public/css/console.css` | **KROK 2** — zmazanie kópie + 1 selektor | orchestrátor, **až po kroku 1** |
| `public/css/chat.css` | **KROK 2** — zmazanie kópie | orchestrátor, **až po kroku 1** |
| `public/css/charon.css` | **KROK 3** (voliteľný) — tretia kópia | rozhodnutie, nie automat |

**Poradie je záväzné.** Krok 2 bez kroku 1 zhasne tlačidlá kopírovania na oboch
plochách. Krok 1 bez kroku 2 je takmer inertný (jedna zmeraná výnimka, §1.4).

**Paralelná session pracuje aj na JS strane kopírovania** — `public/js/chat/artifact.js`
a `public/js/console/render.js` sú necommitnuté a zaviera sa v nich „mŕtvy
`copyButton` v `artifact.js`" z backlogu. Overil som, že sa to tohto patchu
**netýka**: v diffe nie je ani jedna zmena názvu triedy. Emitentom zostáva
`shared/copy.js` (`copy-btn`, `code-wrap`, `code-head`, `copy-fallback`)
a `shared/markdown.js` (`pre.code`), takže selektory nižšie platia.
Necommitnuté sú aj `public/js/shared/agents.js` a `public/js/vendor/` (nové) —
s kopírovaním nesúvisia.

Referenčné dĺžky súborov v okamihu písania — ak nesúhlasia, čísla riadkov driftli
a treba ísť podľa **kotiev v texte**, nie podľa čísel:

```
mind.css     5182 riadkov
console.css  1397 riadkov   (1382 + 15 z opravy komentára, §4)
chat.css      861 riadkov
```

---

## 0. Čo sa naozaj zmeralo (nie dojem)

Zadanie tvrdilo, že `console.css` a `chat.css` nesú **znak po znaku ten istý**
blok. Diff to nepotvrdil. Postup: obe oblasti vybrané `sed`om, komentáre
odstránené, whitespace normalizovaný, `diff -u`.

Oblasť má **10 pravidiel** a **v 9 z nich sú deklarácie znak po znaku rovnaké**.
Jediný rozdiel v deklaráciách je `pre.code code`. Rozdiely v selektoroch sú štyri:
prefix `.bubble.md` u troch pravidiel konzoly a rodič riadka mena pri
`margin-left: auto`:

| pravidlo | `console.css` | `chat.css` | rozdiel |
|---|---|---|---|
| `pre.code` | `.bubble.md pre.code` | `pre.code` | len prefix plochy |
| `pre.code code` | `.bubble.md pre.code code` | `pre.code code` | prefix **+ 2 deklarácie** |
| `.code-wrap pre.code` | `.bubble.md .code-wrap pre.code` | `.code-wrap pre.code` | len prefix plochy |
| `.code-wrap` | zhodné | zhodné | — |
| `.code-head` | zhodné | zhodné | — |
| `.code-lang` | zhodné | zhodné | — |
| `.copy-btn` | zhodné | zhodné | — |
| `.copy-btn.is-done` | zhodné | zhodné | — |
| `.copy-fallback` | zhodné | zhodné | — |
| `margin-left: auto` | `.msg .who` + `.code-head` | `.code-head` + `.cm-who` | rodič plochy |

Dve deklarácie, ktoré má **len `chat.css`**, v `pre.code code`:

```css
display: block;
font-family: var(--mono);
```

- `font-family` **nie je rozdiel v chovaní.** Konzola ju dostáva z vlastného
  inline-kódového pravidla `.bubble.md code`, ktoré `font-family: var(--mono)`
  nastavuje tiež. Chat ju musí deklarovať, pretože jeho inline-kódové pravidlo je
  `:is(.cm-md, .md) code` a v bloku kódu ho reset prebíja. Zjednotená hodnota je
  rovnaká, takže obe plochy skončia na `var(--mono)`.
- `display: block` je **skutočne len v chate**. §1.4 hovorí, čo to spraví
  s konzolou po vložení.

Zadanie menovalo päť pravidiel (`.copy-btn`, `.copy-btn.is-done`, `.code-head`,
`.code-wrap`, `pre.code`). Duplikované sú **deviate** — nad zoznam pribudli
`pre.code code`, `.code-wrap pre.code`, `.code-lang` a `.copy-fallback`. Blok
nižšie ich nesie všetky; nechať dve z nich per-plochu by bola tretia kópia.

### Prečo to patrí do `mind.css`

Markup skladá **jeden** `renderMarkdown()` v `public/js/shared/markdown.js`:

```js
// markdown.js:169
return `<pre class="code"${lang}><code>${escapeHtml(...)}</code></pre>`;
```

a mechaniku nesie **jeden** `public/js/shared/copy.js` (`copy-btn`, `code-wrap`,
`code-head`, `copy-fallback`). Ten istý markup teda vzniká na **troch** plochách:
`/console` (`console/render.js`), `/chat` (`chat/artifact.js`) a **dok nad grafom**
(`mind/charon.js` importuje `renderMarkdown` zo `shared/markdown.js`, riadok 32).
`mind.css` sa načítava ako prvý na všetkých troch (`mind.blade.php:35`,
`chat.blade.php:61`, `console.blade.php:39`), takže je to jediné správne miesto.

---

## 1. KROK 1 — vložiť do `mind.css`

### 1.1 Kam

**Kotva (preferovaná):** hneď za koniec sekcie `.md-body` (markdownový prehliadač
grafu), teda **za** riadok

```css
.md-body .md-hr { border: none; border-top: 1px solid var(--line-soft); margin: var(--sp-2) 0; }
```

(dnes riadok 2240, nasleduje prázdny riadok a `#md-foot {`).

**Ak sa kotva nenájde, prilož blok na KONIEC súboru.** Je to bezpečné a nie je to
odhad — poloha na kaskádu nemá vplyv, pretože žiadny z nových názvov v `mind.css`
zatiaľ neexistuje (zmerané: `pre` ako bare selektor **0** pravidiel, `.code-*`
**0**, `.copy-*` **0**) a v konfliktoch, ktoré vzniknú s `console.css` a
`chat.css`, rozhoduje **špecificita, nie poradie** (§1.3).

Jedna vec, ktorú som overoval zvlášť, pretože by poradie zaviedla: `.copy-btn` je
`(0,1,0)` a v `mind.css` je `button.ghost, a.ghost` na `(0,1,1)`. Kolízia
**nevzniká** — `button.ghost` deklaruje `background`, `border`, `color`, kým
`.copy-btn` `min-height`, `padding`, `font-size`, `text-transform`,
`letter-spacing`. Prienik je prázdny. To, čo `.copy-btn` prebíjať MUSÍ, je bare
`button` (`min-height: var(--control-h)`, `padding`, `font-size`) na `(0,0,1)` —
trieda ho bije bez ohľadu na poradie. Ancestor-scoped `button` pravidlá
v `mind.css` (`#rail .rail-group`, `.row`, `.dept-actions`, `.dup-side`,
`.queue-actions`, `.empty.empty-network`) sa tlačidla kopírovania **netýkajú** —
ani jedno z tých okolí ho neobsahuje.

### 1.2 Presný blok

```css
/* ---------------------------------------------------------------------------
   BLOKY KÓDU A KOPÍROVANIE — jedna kresba pre všetky tri plochy

   Markup skladá jeden `renderMarkdown()` (`public/js/shared/markdown.js` emituje
   `<pre class="code"><code>`) a mechaniku jeden `public/js/shared/copy.js`
   (tlačidlo, potvrdenie, záložná cesta). Ten istý blok kódu preto stojí na
   `/console`, na `/chat` aj v doku nad grafom — a `mind.css` je jediný
   stylesheet, ktorý sa načítava na všetkých troch.

   Do 26. 8. 2026 tu nebolo nič a kresba žila DVAKRÁT (`console.css` ×
   `chat.css`). Zmerané diffom, nie odhadnuté: z desiatich pravidiel malo deväť
   deklarácie znak po znaku rovnaké a jediný rozdiel v deklaráciách bol
   `pre.code code`, kde chat navyše nesie `display: block` a `font-family`.

   Selektory sú ZÁMERNE bez prefixu plochy. Prefix `.bubble.md`, ktorý mala
   konzola, nenesie nič: ten istý blok stojí v bubline odpovede, v náhľade
   markdownového artefaktu aj v paneli artefaktu. Jediné, čo zostáva
   per-plochu, je rodič riadka mena pri `margin-left: auto` (viď nižšie).
   --------------------------------------------------------------------------- */

/* Odstup nesie `pre` (počas streamu je blok ešte neobalený) a po obalení ho
   preberá `.code-wrap`, aby `.md > *:last-child` (nulovanie posledného odstupu)
   trafilo prvok, ktorý je naozaj posledný. */
pre.code {
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
    /* Široký kód skroluje SÁM — telo stránky nesmie ísť do vodorovného skrolu. */
    overflow-x: auto;
}

/* Reset `code` vnútri bloku. Nie je nadbytočný: inline-kódové pravidlo plochy
   (`:is(.cm-md, .md) code` na /chat, `:is(.bubble.md, .msg.system) code` na
   /console) dáva každému `code` padding, pozadie a `.92em`, a to sa dedí aj do
   bloku. Špecificita `(0,1,2)` je tu podmienka, nie náhoda — musí prebiť to
   inline-kódové pravidlo, ktoré je na oboch plochách `(0,1,1)`. */
pre.code code {
    display: block;
    padding: 0;
    background: transparent;
    font-family: var(--mono);
    font-size: var(--fs-small);
    line-height: 1.5;
    white-space: pre;
}

.code-wrap { margin: 0 0 12px; }
.code-wrap pre.code { margin: 0; }

/* Hlavička bloku. Tlačidlo je NAD kódom, nie v ňom: `pre.code` skroluje sám,
   takže tlačidlo vnútri by pri širokom kóde odišlo mimo dohľadu — a nad kódom
   nemá čo prekryť. Hlavička zároveň ukáže `data-lang`, ktorý markdown renderer
   dávno zapisuje a nikto nečítal. */
.code-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
}

.code-lang {
    font-family: var(--mono);
    font-size: var(--fs-micro);
    color: var(--muted);
}

/* Vzhľad tlačidla nesie `.ghost` (bez rámu, `--muted`, hover na `--text`) —
   ďalšia varianta tlačidla tu nevzniká. Prepisuje sa len to, čo tlačidlo
   dostáva od okolia: 32 px z bare `button` je v riadku hlavičky priveľa
   a verzálka s trackingom sa dedí z riadka mena. Fokusový prsteň dáva
   globálne `:focus-visible` — vlastný tu zámerne nie je. */
.copy-btn {
    min-height: 24px;
    padding: 2px 8px;
    font-size: var(--fs-micro);
    text-transform: none;
    letter-spacing: 0;
}

/* Popisok stojí na opačnom konci riadka než meno a cena — tam ho oko hľadá a ani
   jeden z tých údajov sa pritom neposunie. Hlavička bloku kódu je zdieľaná;
   riadok mena má na každej ploche vlastný názov, takže jeho selektor zostáva
   v console.css (`.msg .who`) a chat.css (`.cm-who`). */
.code-head .copy-btn { margin-left: auto; }

/* Potvrdenie kopírovania — bez neho človek nevie, či klik zabral; do schránky sa
   pozrieť nedá. Ako dlho svieti, drží `COPY_HOLD` v `shared/copy.js`; číslo je
   pri tej konštante a NIE tu, aby sa nemalo s čím rozísť. */
.copy-btn.is-done { color: var(--success-ink); }

/* Záložná cesta kopírovania (`document.execCommand`) potrebuje SKUTOČNE vybraný
   text, takže textarea nesmie byť `display: none` ani `visibility: hidden` —
   odkladá sa mimo plochy a v DOM žije zlomok sekundy. */
.copy-fallback {
    position: fixed;
    top: 0;
    left: -9999px;
    opacity: 0;
}
```

### 1.3 Špecificity, o ktoré to celé stojí

Počítané ručne, `(id, class, type)`. `pre.code` má **dva** komponenty: typ `pre`
a triedu `.code` — na to sa dá naletieť.

| selektor | súbor | špecificita |
|---|---|---|
| `pre.code code` | mind.css (nový) | **(0,1,2)** |
| `:is(.cm-md, .md) code` | chat.css | (0,1,1) |
| `.bubble.md code`, `.msg.system code` | console.css **dnes** | **(0,2,1)** |
| `:is(.bubble.md, .msg.system) code` | console.css **po kroku 2** | (0,1,1) |
| `.bubble.md pre.code code` | console.css (maže sa) | (0,3,2) |

**Tu je pasca celého patchu.** `(0,2,1)` **bije** `(0,1,2)` — trieda váži viac než
typ. Keby sa v kroku 2 zmazalo z `console.css` len to, čo je duplikát, a inline-
kódové pravidlo zostalo na `.bubble.md code`, tak by po zmazaní vlastného
`(0,3,2)` pravidla konzoly **vyhralo inline-kódové pravidlo** a bloky kódu na
`/console` by dostali `padding: 1px 5px`, `background: var(--surface-subtle)`,
`font-size: .92em` a `border-radius: 5px`. To nie je teoretické — je to presne to,
čo dnes bráni ten `(0,3,2)` selektor.

Preto krok 2 nie je len mazanie: **musí zároveň znížiť špecificitu inline-
kódového pravidla konzoly na `:is(...)`**, presne tak, ako to už má `chat.css`.
Overené, že to nič neuvolní: jediné ďalšie pravidlo na `code` v `mind.css` je
`.md-body code` na `(0,1,1)` — remíza, ale `console.css` sa načítava druhý, takže
vyhráva, a `.md-body` na `/console` v DOM ani nie je. Bare `code` pravidlo
neexistuje v žiadnom z troch stylesheetov.

### 1.4 Je krok 1 sám inertný? Takmer — jedna zmeraná výnimka

- **`/chat`**: každé nové pravidlo je remíza (`pre.code` (0,1,1) : (0,1,1),
  `pre.code code` (0,1,2) : (0,1,2), ostatné (0,1,0) : (0,1,0)) a `chat.css` sa
  načítava druhý, takže vyhráva — s **identickými hodnotami**. Inertné.
- **`/console`**: vlastné pravidlá konzoly `(0,3,1)` a `(0,3,2)` prebíjajú nové
  `(0,1,1)` / `(0,1,2)`, ostatné sú remízy vo prospech `console.css`. **Výnimka:**
  `display: block` v `pre.code code` konzola nikde nedeklaruje, takže sa aplikuje
  z `mind.css`. `code` vnútri `pre.code` sa tým z inline stane blokovým prvkom.
  Vizuálne to má byť bez efektu — `.bubble.md pre.code code` mu dáva `padding: 0`
  a `background: transparent`, takže tam nie je čo prekresliť, a `white-space: pre`
  drží lámanie riadkov — **ale toto je jediné tvrdenie v dokumente, ktoré nie je
  odvodené z kaskády, iba z kresliaceho modelu. Pri preklikoch po kroku 1 sa treba
  pozrieť na blok kódu na `/console`.**
- **`/` (graf, dok Charóna)**: nie je inertné, viď §3.

---

## 2. KROK 2 — zmazať kópie (AŽ PO KROKU 1)

Čísla riadkov sú platné pre pracovný strom v okamihu písania. Oprava komentára
v `console.css` (§4) je na riadku 1169, teda **za** oblasťou kopírovania —
čísla 638–709 sú ňou nedotknuté (overené po zápise).

### 2.1 `public/css/console.css`

**(a) Zmazať riadky 638–709** — celá oblasť od `.bubble.md pre.code {` po
uzatvárajúcu `}` bloku `.copy-fallback`, vrátane komentárov medzi nimi.

Kotvy: prvý mazaný riadok je

```css
.bubble.md pre.code {
```

posledné mazané riadky sú

```css
.copy-fallback {
    position: fixed;
    top: 0;
    left: -9999px;
    opacity: 0;
}
```

Riadok 637 (prázdny) a 710 (prázdny) ponechať — po zmazaní zostane jeden prázdny
riadok medzi inline-kódovým pravidlom a `.help-list`.

**(b) Vrátiť jedno pravidlo per-plochu.** Na miesto zmazanej oblasti vložiť:

```css
/* Riadok mena a ceny je na každej ploche inak pomenovaný, takže tento jeden
   selektor zostáva tu; zvyšok kresby kopírovania je v mind.css. */
.msg .who .copy-btn { margin-left: auto; }
```

**(c) Znížiť špecificitu inline-kódového pravidla** (dôvod v §1.3 — bez tohto sa
bloky kódu na `/console` rozsypú). Riadky **628–636** dnes:

```css
.bubble.md code,
.msg.system code {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--surface-subtle);
    font-family: var(--mono);
    font-size: .92em;
    overflow-wrap: anywhere;
}
```

nahradiť za:

```css
/* `:is()` drží toto pravidlo na (0,1,1), aby ho reset bloku kódu z mind.css
   (`pre.code code`, (0,1,2)) prebil. Na `.bubble.md code` to bolo (0,2,1), teda
   SILNEJŠIE než reset — držalo to len vlastné pravidlo konzoly na (0,3,2), ktoré
   sa zmazalo ako duplikát. Ten istý tvar má chat.css. */
:is(.bubble.md, .msg.system) code {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--surface-subtle);
    font-family: var(--mono);
    font-size: .92em;
    overflow-wrap: anywhere;
}
```

> Vedľajší nález, **nerobiť v tomto patchi**: `border-radius: 5px` je raw px,
> zatiaľ čo CLAUDE.md hovorí „radius vždy cez `--r-sm`". Tá istá hodnota stojí aj
> v `chat.css:517`. Je to samostatná úloha na obe plochy naraz, nie vedľajší efekt
> tohto zjednotenia.

### 2.2 `public/css/chat.css`

**(a) Zmazať riadky 532–606** — od komentára nad `pre.code` po uzatvárajúcu `}`
bloku `.copy-fallback`.

Kotvy: prvý mazaný riadok je komentár

```css
/* Odstup nesie `pre` (počas streamu je blok ešte neobalený) a po obalení ho
```

posledné mazané riadky sú blok `.copy-fallback { … }` (rovnaký ako v console.css).

**(b) Ponechať sekčnú hlavičku, riadky 524–530** — je to nadpis sekcie
„BLOKY KÓDU, ZVÝRAZNENIE A KOPÍROVANIE", ktorá po patchi obsahuje už len
zvýrazňovanie syntaxe (od riadku 608). Odporúčam upraviť jej text, aby netvrdila,
čo v nej nie je:

```css
/* ---------------------------------------------------------------------------
   ZVÝRAZNENIE SYNTAXE

   Kresba bloku kódu a kopírovania je od 26. 8. 2026 v mind.css (jedna pre
   všetky tri plochy). Tu zostáva len paleta zvýrazňovača, ktorá je vlastná
   tejto ploche.
   --------------------------------------------------------------------------- */
```

**(c) Vrátiť jedno pravidlo per-plochu:**

```css
/* Riadok mena a ceny nad bublinou odpovede (`render.js`); zvyšok kresby
   kopírovania je v mind.css. */
.cm-who .copy-btn { margin-left: auto; }
```

**(d) Inline-kódové pravidlo `:is(.cm-md, .md) code` (riadok 515) NEMENIŤ** — už je
na `(0,1,1)`, teda presne tam, kde ho reset z `mind.css` prebije.

### 2.3 Čo po kroku 2 preklikať

Kopírovanie odpovede aj bloku kódu na `/chat` a `/console`: tlačidlo je vpravo
v riadku, po kliknutí zelené „Skopírované", blok kódu má rám, `--surface-2`
pozadie, mono font a **nemá** ružový/šedý inline-kódový podklad ani zaoblenie 5 px.
To posledné je presne to, čo by ohlásilo, že §2.1(c) sa vynechalo.

---

## 3. KROK 3 (voliteľný) — tretia kópia je v `charon.css`

**Krok 1 nie je na ploche grafu inertný a treba to vedieť pred vložením.** Dok
Charóna renderuje markdown tým istým `shared/markdown.js`, takže jeho bubliny
obsahujú `<pre class="code">`. `charon.css` má na to vlastnú kresbu pod
`.charon-md` (riadky 165–181) a načítava sa **za** `mind.css`
(`mind.blade.php:39`), takže v remízach vyhráva:

| vlastnosť | `.charon-md pre` (0,1,1) | nový `pre.code` (0,1,1) | kto vyhrá |
|---|---|---|---|
| `margin`, `padding`, `background`, `overflow-x` | deklaruje | deklaruje | charon.css (načítaný druhý) |
| `border` | **nedeklaruje** | `1px solid var(--border)` | **mind.css → dok dostane rám** |
| `border-radius` | `--r-sm` | `--r-md` | charon.css |

| vlastnosť | `.charon-md code` (0,1,1) / `.charon-md pre code` (0,1,2) | nový `pre.code code` (0,1,2) | kto vyhrá |
|---|---|---|---|
| `background`, `padding` | `.charon-md pre code` (0,1,2) | (0,1,2) | charon.css (načítaný druhý) |
| `font-size`, `line-height`, `font-family` | len `.charon-md code` (0,1,1) | (0,1,2) | **mind.css → dok zmení veľkosť a preklad riadkov** |
| `display: block` | nedeklaruje | deklaruje | **mind.css** |

Takže po kroku 1 dostanú bloky kódu v doku **1 px rám** a **`--fs-small` /
`line-height: 1.5`** namiesto `.88em / 1.4`. To sú tri drobné vizuálne zmeny na
ploche, ktorú patch nerieši.

Dve možnosti, obe legitímne, **rozhodnutie patrí človeku**:

- **(A) Prijať a dokončiť.** Zmazať z `charon.css` `.charon-md pre` a
  `.charon-md pre code` (riadky 172–181) a nechať dok čítať zdieľanú kresbu.
  Tretia kópia tým zanikne úplne. Cena: dok bude vyzerať ako `/chat` a `/console`,
  čo je pravdepodobne správne, ale je to zmena vzhľadu doku bez preklikov.
- **(B) Nechať dok na vlastnej kresbe.** Potom treba `.charon-md pre` doplniť
  `border: none` a `.charon-md pre code` `font: 400 .88em / 1.4 var(--mono)`, aby
  dok ostal presne tam, kde je dnes.

Kým sa nerozhodne, platí, že krok 1 dok mierne zmení. **Nie je to regresia
kontrastu ani layoutu**, len iný rám a o zlomok iná veľkosť písma.
`charon.css` nie je v mojich súboroch, takže som doň nezapisoval.

---

## 4. Mimo patchu, už hotové: `console.css` mal komentár, ktorý klamal

Nájdené pri overovaní P13 (§5). `console.css` nad blokom `#composer #prompt`
tvrdil v prítomnom čase:

> graf má na id `#prompt` svoju plávajúcu lištu chatu: `position: fixed`,
> `width: 320px` a — čo je horšie — `body:not(.chat-on) #prompt { display: none !important }`

**Zmerané: v `mind.css` také pravidlá NIE SÚ.** `#prompt` má v celom `mind.css`
dva zásahy a oba sú komentáre (riadky **1959 a 4735**; ten prvý hlási, že A9 mŕtvy chat nad
grafom zmazal); `.chat-on` má **nula** zásahov. Odišlo to s A9.

Komentár je **prepísaný** (jediná zmena, ktorú tento agent zapísal do
`console.css`): teraz pomenúva skutočného protivníka bloku, ktorým sú bare
pravidlá poľa v `mind.css` (`input:not([type="range"]), textarea` —
`width: 100%`, `--field-bg`, 1 px rám, `padding`; a `textarea` —
`min-height: 72px`, `resize: vertical`).

Zároveň priznáva **otvorený bod, ktorý som nezavrel**: šesť deklarácií v tom bloku
(`display: block !important`, `position: static`, `inset: auto`, `transform: none`,
`z-index: auto`, `transition: none`) bránilo výhradne tej zmazanej plávajúcej lište
a dnes nemá čo prebíjať. Dôkaz nie je úvaha — `#chat-prompt` v `chat.css` stojí na
tej istej bare kresbe z `mind.css` a **ani jednu z tých šiestich nepotrebuje**.
Odstránenie je samostatná zmena s preklikom `/console`, nie vedľajší efekt opravy
komentára, preto som deklarácie nechal.

---

## 5. P13 (prsteň composera) — OVERENÉ V ZDROJI

Zadanie: „označený hotový, ale merač ho nikdy nepotvrdil". Prečo merač zlyhal,
dnes vieme (Browser pane nekompozituje rámce). Nasleduje overenie z kaskády,
ktoré je pre túto vlastnosť dostatočné, pretože P13 nie je o farbe, ale o tom,
**ktorý prvok nesie prsteň a či sa pri fokuse nič nepohne**.

Pozor na jednu vec, ktorá v zadaní nesedí: `/chat` composer **nie je**
`.composer-row` ani `#composer`. To sú názvy `/console`. Na `/chat` sú to
`#chat-composer` a `.cc-row`.

### 5.1 Prsteň na `:focus-within` — ÁNO, na oboch plochách

`/console`, `public/css/console.css:1161–1164`:

```css
.composer-row:focus-within {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
}
```

`/chat`, `public/css/chat.css:407–410`:

```css
.cc-row:focus-within {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
}
```

Token `--focus-ring` je definovaný v `mind.css:166` (svetlá,
`0 0 0 3px rgba(109, 63, 181, .85)`) a `mind.css:705` (tmavá,
`rgba(196, 162, 245, .62)`) — teda ten istý prsteň, aký nesie globálne
`:focus-visible` v `mind.css:780`. Žiadna vlastná hodnota tu nevzniká.

### 5.2 Šírka rezervovaná v pokoji — ÁNO

`/console` `console.css:1148` a `/chat` `chat.css:403`, obe v pokojovom pravidle
riadku:

```css
box-shadow: 0 0 0 0 transparent;
transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
```

Composer pri fokuse **neposkočí**, a garancia je silnejšia než rezervácia:
`box-shadow` nie je v layoutovom toku, takže nikdy neposúva nič, ani keby v pokoji
deklarovaný nebol. Nulová šírka v pokoji je tu preto, aby mal `transition` odkiaľ
vyrásť a prsteň nepreblikol naraz — a presne tak to komentár v `console.css` aj
hovorí. Druhá zvažovaná cesta (`border-width: 1px → 2px`) by riadok o pixel
odsúvala; tá sa nepoužila. `--transition-fast` je definovaný v `mind.css:615`.

### 5.3 Dva indikátory naraz — NIE, prsteň na textarei je zhasnutý

Globálny prsteň by inak svietil na poli **aj** na riadku. Obe plochy ho na poli
rušia:

```css
#composer #prompt:focus-visible { box-shadow: none; }   /* console.css:1166 */
#chat-prompt:focus-visible      { box-shadow: none; }   /* chat.css:428    */
```

Špecificita rozhodne v ich prospech na oboch stranách:

| pravidlo | špecificita | prebíja |
|---|---|---|
| `#composer #prompt:focus-visible` | (2,1,0) | ✔ |
| `#chat-prompt:focus-visible` | (1,1,0) | ✔ |
| `:focus-visible` (mind.css:780) | (0,1,0) | — |
| `input:not([type="range"]):focus-visible, textarea:focus-visible` (mind.css:1532, tiež `box-shadow: var(--focus-ring)`) | (0,1,1) | — |

Ten druhý riadok tabuľky je dôvod, prečo tu nestačilo zrušiť len globálne
`:focus-visible`: `mind.css` dáva prsteň textarei **ešte raz**, cez bare pravidlo
poľa. Oba rušiče sú nad `(0,1,1)`, takže držia.

Na riadku tak zostane jeden indikátor zložený z dvoch vrstiev na **tom istom
prvku** (akcentový rám + prsteň), čo je zámer zapísaný v komentároch oboch
súborov: „Fokus nesie RIADOK, nie textarea vnútri."

Vedľajšia kontrola, že fokusový rám poľa nepresvitá: `textarea:focus` v
`mind.css:1537` nastavuje `border-color: var(--accent)`, ale pole má rám vypnutý
silnejšie — `#composer #prompt { border: 0 }` je (2,0,0) a `#chat-prompt { border: 0 }`
je (1,0,0), oba nad (0,1,1).

### 5.4 Markup existuje

Táto appka už dvakrát postavila správne CSS nad markupom, ktorý sa nenačítal,
takže:

```
resources/views/console.blade.php:115   <form id="composer" …>
resources/views/console.blade.php:122     <div class="composer-row">
resources/views/console.blade.php:130       <textarea id="prompt" …>

resources/views/chat.blade.php:192      <form id="chat-composer" …>
resources/views/chat.blade.php:200        <div class="cc-row">
resources/views/chat.blade.php:201          <textarea id="chat-prompt" …>
```

**Verdikt P13: OVERENÉ V ZDROJI** na oboch plochách. Prsteň je na riadku, je to
`--focus-ring`, v pokoji je rezervovaný nulovou šírkou, layout sa pri fokuse
nehýbe a druhý indikátor na textarei je zhasnutý pravidlom, ktoré prebíja **oba**
zdroje prsteňa v `mind.css`. Neoverené zostáva len to, čo zdroj povedať nevie:
namerané krytie a farba prsteňa na skutočnom pixeli.

---

## 6. Mŕtve CSS po zmazaní `chat.js` (nález D13) — v `mind.css` UŽ NIE JE

### 6.1 Premisa zadania neplatí

Zadanie: „`mind.css` má stále `.msg.me` a `.msg.hades` (grep: 2 zásahy)". Grep
naozaj vracia 2 zásahy — **ale oba sú komentáre, nie pravidlá**:

- `mind.css:142` — v `:root`, pri `--accent-rgb`:
  *„Popis »JS-facing: slider fill, msg.me, rings« tu bol do 24. 8. 2026 a bol
  nepravdivý: `.msg.me` odišlo s mŕtvym chat.js…"*
- `mind.css:1959` — hlavička sekcie:
  *„A9: mŕtvy chat nad grafom (#prompt / #prompt-form / #chat-log / .msg /
  .suggest-card) je preč…"*

Rovnako dopadli všetky ostatné triedy, ktoré mŕtvy `chat.js` emitoval. Vytiahol
som ich zo zmazaného súboru (`git show c0c3c36^:public/js/mind/chat.js`, 261
riadkov) a každú overil proti `mind.css`:

| trieda / id z mŕtveho `chat.js` | pravidlo v `mind.css` |
|---|---|
| `.msg-row`, `.sys`, `.sys--error`, `.thinking`, `.has-text` | 0 |
| `.sc-head`, `.sc-row`, `.sc-label`, `.sc-area`, `.sc-type`, `.sc-actions` | 0 |
| `.suggest-card` | 0 (len komentár 1960) |
| `#prompt`, `#prompt-form`, `#prompt-input`, `#chat-log`, `#chat-context` | 0 (len komentáre 1959, 4735) |
| `.ctx-chip`, `.ctx-label`, `.ctx-clear`, `.ctx-x` | **žijú a majú žiť** — dok Charóna (`charon.js renderContextChips`) |
| `.avatar` | **žije** — značkový znak |

**D13 je v `mind.css` uzavretý. Zoznam na zmazanie z tohto titulu je prázdny.**
A9 to upratal dôsledne; čo zostalo, sú komentáre, ktoré to zmazanie dokumentujú,
a tie majú hodnotu — vysvetľujú, prečo tu daný token či sekcia vyzerá, ako vyzerá.

### 6.2 Iné siroty, ktoré som pritom našel — a prečo väčšinu NEMAZAŤ

Keďže menovaný zoznam bol prázdny, prešiel som `mind.css` celý: 410 selektorových
názvov proti všetkému, čo môže emitovať markup (243 zdrojov v `public/js`,
`resources/views`, `app`, `electron` + tri ostatné stylesheety). Harness je
`scratchpad/orphan3.js`, **kalibrovaný z oboch strán** (živý `.ctx-chip` musí
vyjsť ako použitý, fiktívny `.zzz-dead-probe` ako sirota) a s odstránenými
komentármi v zdrojoch — bez toho `.tc-val` prežil len tým, že jeho názov stojí
v komentári `console/tools.js`.

Prvá verzia harnessu hlásila **410 sirôt zo 410**, teda všetko, a kalibrácia to
zachytila: regex som skladal `new RegExp("\\b" + …)` cez `node -e` v bashi, shell
zložil `\\b` na `\b` a JS to prečítal ako **backspace**. Bez kalibrácie by som bol
odovzdal zoznam na zmazanie celého súboru.

**Bezpečné siroty (0 emitentov v pracovnom strome aj v HEAD).** Sú to zvyšky
starého panelového hľadania a starej obrazovky Dnes, nie `chat.js`:

| názov | riadky v `mind.css` | čo to bolo |
|---|---|---|
| `#search-input`, `#search-results` | 1738, 1739 | staré hľadanie v paneli; `search.js:4` sám píše, že `#search-results` v blade **neexistuje** a `renderSearch()` bol zmazaný 20. 8. 2026 |
| `.search-item` (+ `.sub`) | 1741, 1750, 1751 | riadok výsledku toho hľadania |
| `.result-divider` (+ `::after`) | 1754, 1765 | mono oddeľovač skupín výsledkov |
| `.pb-item`, `.pb-text`, `.pb-title`, `.pb-snippet` | 1772, 1782–1785, 1791 | riadky smerníc vo výsledkoch |
| `#stats-totals` | 1700 | kontejner starého súhrnu štatistík |
| `#btn-journal .dot` | 2767 | bodka neprečítaného na tlačidle railu, ktoré už neexistuje |
| `#btn-duplicates` | 2950 | to isté pri duplikátoch (`#dup-list` na 2951 **žije**) |
| `.today-cards`, `.today-card`, `.tc-val`, `.tc-label` | 3390, 3398, 3401, 3405 — **a navyše 915, 922** | **stará** karta obrazovky Dnes; dnes ju kreslí `.today-grid` / `.today-card-wrap` / `.today-card-link` / `.tcl-*`. **Na 915 a 922 ide o ŠKRTNUTIE JEDNÉHO ČLENA zoskupeného selektora, nie o zmazanie pravidla** (rovnako ako pri `.stat-row`) — `.tc-val` tam stojí vedľa živých selektorov, takže zmazať celý blok by zhaslo aj ich. Zásahov je teda šesť, nie štyri. |

Pri tých dvoch `#btn-*` som overil, že id nevzniká skladaním (`'btn-' + kľúč`):
v `public/js` a `resources/views` existuje jedenásť `btn-*` id a `btn-journal`
ani `btn-duplicates` medzi nimi nie sú.

Poznámka k `.tc-val` / `.tc-label`: CLAUDE.md tvrdí, že si ich `mind.css` drží pre
tabulárne číslo karty Dnes. To už **neplatí** — karta, ktorá ich používala
(`.today-card`), je sama sirota. Sú to štyri pravidlá jednej mŕtvej rodiny.
Keď sa zmažú, treba upraviť aj ten odsek v CLAUDE.md a komentár v
`public/js/console/tools.js:29–30`, ktorý sa na ne odvoláva.

**NEMAZAŤ — patrí paralelnej session.** Tieto vyzerajú ako siroty len preto, že
emitent zmizol v **necommitnutom** `panels.js`. V HEAD ešte existuje:

| názov | riadky | emitent v HEAD |
|---|---|---|
| `.stat-row` | 1687, 1693, 1702, 1708 | `panels.js:606`, `panels.js:636` |
| `.kpi-card--block` | 3974 | `panels.js:580` |
| `.kpi-sub` | 4007 | `panels.js:582` |

`.kpi-grid--pair` (3957) nemá emitenta ani v HEAD — v `panels.js:578` je len
v komentári — ale leží v tom istom bloku, ktorý paralelná session prepisuje,
takže rozhodnutie o ňom patrí jej.

Pozor aj na to, že `.stat-row` nie je samostatné pravidlo: na riadkoch 1687 a 1693
stojí v **zoskupených** selektoroch spolu so živým `.legend-row` a `.badge`
(`.stat-row .swatch, .legend-row .swatch, .badge .swatch, .swatch`). Nie je to
mazanie pravidiel, ale editovanie zoznamov.

**NEMAZAŤ — pravidlo zámerne čaká na svojho volajúceho.** `.empty--hero`
(2532, 2545, 2553) vyšlo ako sirota a **je to tak správne**: `console.css:715–732`
popisuje, že prázdny stav konzoly má byť tretí prípad rodiny `.empty`, že triedu
skladá JS (`console/render.js:59`, `el('div', 'empty-state')`) a že prepnutie sa
**vedome odložilo**, pretože bez tej jednej riadky v JS by `.empty--hero` netrafilo
nič a prázdny stav konzoly by ostal bez kresby. Ten komentár menuje aj to, čo bude
treba pri prepnutí zmerať. Zmazať to pravidlo by znamenalo zahodiť pripravenú
polovicu premyslenej zmeny.

**NEMAZAŤ ako celok — zoskupený selektor.** `.tag--accent` (2685) stojí
v `.tag--accent, .tag.active { … }` a `.tag.active` je **živé**. Ak sa
`.tag--accent` odstraňuje, je to škrtnutie jedného člena zoznamu, nie zmazanie
pravidla. Tá istá pasca ako pri `.stat-row` (1687, 1693).

**FALOŠNÉ POPLACHY — v žiadnom prípade nemazať.** `.l3` (4038) a `.l4` (4039)
vyšli ako siroty, pretože sa trieda skladá **dynamicky**:

```js
// public/js/charts.js:293
const c = el('span', 'heat-cell' + (l ? ' l' + l : ''));
```

`.l1`–`.l4` sú všetky živé. Že prešli len `l1` a `l2`, je náhoda substringu — čiže
harness nedokáže vidieť dynamické názvy **vôbec** a jeho zoznam je preto **dolná
hranica**, nie úplný výčet. `.card--nested` (4533) tiež nemá emitenta, ale CLAUDE.md
ju popisuje ako **deklarovanú rolu** druhého papiera karty (rovnaká úvaha ako pri
`--accent-press`: diera v škále je horšia než nepoužitý stupeň) — nechať, alebo
rozhodnúť zvlášť, nie zmazať mimochodom.

---

## 7. Zhrnutie pre orchestrátora

1. **Vlož §1.2 do `mind.css`** (za `.md-body .md-hr`, alebo na konec — na kaskádu
   to nemá vplyv). Potom preklikni blok kódu na `/console`, kvôli §1.4.
2. **Potom** §2.1 a §2.2. Krok 2.1(c) (`:is()`) **nie je voliteľný** — bez neho sa
   bloky kódu na `/console` rozsypú.
3. **Rozhodni §3** — dok Charóna po kroku 1 dostane rám a inú veľkosť písma
   v blokoch kódu.
4. **D13 nemá čo zavrieť** (§6.1) — `.msg.me` aj `.msg.hades` sú komentáre, nie
   pravidlá. Ak sa má upratovať, §6.2 delí nálezy na **päť** kategórií a mazať sa
   smie **len z prvej** (bezpečné siroty: 20 pravidiel v 8 skupinách). Ostatné štyri sú: cudzia
   rozpracovaná práca, pravidlo čakajúce na volajúceho, zoskupený selektor so
   živým členom, a dynamicky skládané názvy.
5. `console.css` už nesie opravený komentár (§4) a jeden pomenovaný otvorený bod
   (šesť vestigiálnych deklarácií v `#composer #prompt`).
6. **P13 je overené v zdroji** (§5), vrátane toho, že `/chat` composer sa menuje
   `.cc-row`, nie `.composer-row`.
