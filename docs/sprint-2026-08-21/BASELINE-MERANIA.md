# Baseline meraní — 21. 8. 2026, HEAD 3747310

Zmerané orchestrátorom v prehliadači. **Implementační agenti prehliadač nedostávajú**
(Browser pane je jeden na session), takže toto je jediný zdroj čísel pre vlny 2 a 3.
Kto sa na tieto čísla odvoláva, nech sa odvolá na tento súbor, nie na vlastný odhad.

Harness: `uiproxy.js` na `127.0.0.1:8093` (identita overená: servuje `/js/mind/main.js`,
`/__whoami` = `hades-ui-proxy`). Meria sa proti živému Hadesovi na 8080.

---

## 1. Ikony — všetky použité sa naozaj kreslia

Metóda: šírka vykresleného glyfu v Material Symbols. Glyf = 1 em; nevykreslená
ligatúra padne na fallback a je násobne širšia. **Kalibrované na oboch stranách.**

| | šírka | význam |
|---|---|---|
| `hub` (známy kladný) | 18 px | v subsete |
| `terminal` (známy záporný) | 144 px | NIE je v subsete → kreslí sa ako text |

**Prvá verzia tohto odseku bola príliš úzka a nález návrhového agenta ju opravil.**
Zmeral som 16 ikon, ktoré boli v tom okamihu v DOM obrazovky Charón, a napísal
„všetkých 16 reálne použitých" — pritom v kóde je názvov okolo tridsiatich. Zmeranie
prítomnosti v DOM nie je zmeranie použitia v kóde. Doplnené meranie nad **41
kandidátmi** (všetko, čo grep našiel v `public/js`, `public/css`, `resources/views`,
plus 14 názvov, ktoré agent vymenoval ako neoverené):

**37 zo 41 je v subsete** (18 px = 1 em). Vrátane všetkých, na ktoré sa agent pýtal:
`psychology` `library_add` `wb_sunny` `center_focus_strong` `remove` `account_tree`
`assignment` `category` `fact_check` `gavel` `layers` `menu_book` `monitoring`
`receipt_long`.

Chýbajú štyri: `arrow_downward` (252 px), `terminal` (144 px), `inventory` (126 px),
`forum` (90 px). **Ani jedna z nich sa nekreslí** — overené grepom, všetky štyri sa
v repozitári objavujú výhradne v komentároch, ktoré vysvetľujú, že v subsete nie sú
(`mind.blade.php:143`, `console/tools.js:25`, `console.css:941`, `mind.css:4475`,
`console.blade.php:106`); `inventory` sa nepoužíva vôbec. Konzola preto používa
prevrátený `arrow_upward`.

Záver teda platí — **v appke sa dnes nekreslí ako text ani jedna ikona** — ale platí
z merania 41 názvov, nie 16.

Nová ikona = regenerácia subsetu (`pyftsubset --no-layout-closure`), nie „veď to
vyzerá podobne". Pre dok nad grafom to znamená: `iconFor()` sa preberá bez zmeny
názvov, a keby dok chcel vlastnú ikonu chatu, `forum` ani `chat` v subsete nie sú.

---

## 2. Dvojité deklarácie (`w4dup.js`, kategória A)

**Harness bol pokazený a opravil som ho.** Naivné `sel.split(',')` rozrezalo
`:is(button, a)` na dva selektory a vyrobilo kľúč, ktorý zdieľalo každé pravidlo
s tým istým prefixom → hlásil **12 neexistujúcich** dvojitých deklarácií v `mind.css`.
Opravená verzia delí zoznam len na čiarkach na nulovej hĺbke zanorenia. Kalibrácia
z oboch strán: na verzii pred vlnou 0 hlási nezmenené čísla, po vlne 0 je `mind.css`
späť na 0.

| Súbor | pred vlnou 0 | po vlne 0 (opravený harness) | stav |
|---|---|---|---|
| `public/css/mind.css` | A=0 | **A=0** | v poriadku |
| `public/css/console.css` | A=1 | **A=15** | ⚠️ REGRESIA, +14 |

### Čo tú regresiu spôsobilo a kto ju opravuje

Vlna 0 (commit `3747310`, zdedená rozpracovaná práca) pridala do `console.css`
na riadkoch 60–68 **zoskupený reset**:

```
.tr-open, .tr-act, #rail-toggle, .tc-head, .tc-more,
.pc-btn, #send, #stop, #to-bottom { background: transparent; border: 0; color: var(--text) }
```

Je to správny SMER opravy D1 (~200 z 818 riadkov `console.css` je chróm, ktorý
`mind.css` už dáva bare `button` selektorom), ale je nedokončený: každý z tých
deviatich selektorov má teraz základ na r. 68 a špecifickú hodnotu o 179–874 riadkov
nižšie, **pri rovnakej špecificite**. Funguje to len vďaka poradiu v zdroji. Kto
presunie reset nižšie, zhasne tlačidlá.

**Toto je povinný bod pre agenta D1 vo vlne 2.** Nie je to „nech to tak", pretože
akceptačné kritérium č. 5 kontraktu sa meria voči baseline **A=1**, nie A=15.

Konkrétne páry: `#to-bottom` (background, border), `#stop` (background, color),
`#send` (background, color), `.pc-btn` (border), `.tc-more` (border, color),
`#rail-toggle` (border), `.rail-retry` (border, color), `.tr-act` (border, color).
Pätnásty je pôvodný `.empty-state ## max-width` (baseline A=1, nie nový).

---

## 3. Kontrast

Merač: pozadie sa **skladá** od prvku nahor po prvú nepriehľadnú vrstvu a komponuje
zdola; farba textu sa berie **z elementu**, nie cez `elementFromPoint`; po prepnutí
`data-theme` sa meria **v ďalšom volaní**, nie v tom istom bloku.
**Kalibrácia: `body` = 15,88 : 1** na svetlej téme (dokumentovaná hodnota ~16:1).
Bez tejto kalibrácie sa ostatným číslam nedá veriť.

### 3a. Živé pády v DOM (svetlá téma, obrazovka Charón, prázdny stav)

| selektor | pomer | px | potreba |
|---|---|---|---|
| `.tr-open` | **1,13 : 1** | 13 | 4,5 |
| `.tr-act` | **2,91 : 1** | 18 | 4,5 |
| `#stop` | **4,38 : 1** | 14 | 4,5 |

`.tr-open` na 1,13:1 je ten istý druh chyby ako nález R5 (`a.ghost` = 1,87:1
s UA modrou): prvok, ktorý nemá pravidlo pre farbu textu na svetlej téme vôbec.

Nezmerané, pretože v prázdnom stave nie sú v DOM: `.tc-head` `.tc-more` `.pc-btn`
`.rail-retry` `.who-model` `.badge` `.chip` `.msg-user` `.msg-assistant` `a.ghost`
`.perm-card`. Vyžadujú živé vlákno (CPU inferencia ~8 tok/s) — doplní sa v bráne
kvality, kde beh aj tak musí prebehnúť.

### 3b. Tokenová matica: 18 textových × 8 povrchových = 144 párov

**53 párov padá pod AA, ale matica je NADMNOŽINA a NIE je akceptačné kritérium** —
`--on-accent` na `--panel` sa v UI nikdy nestretne (`--on-accent` je text na
akcentovej výplni). Kritérium zostáva „0 reálnych textových párov v DOM pod AA".

Čo z matice naozaj platí a je to práca pre vlnu 2 (nález R4):

| token | na `--panel` | na `--bg` | `-ink` variant |
|---|---|---|---|
| `--gold` | **3,12** | 2,86 | `--gold-text` 4,11+ |
| `--warn` | **3,19** | 2,92 | `--warn-ink` ✅ prechádza |
| `--success` | **4,27** | 3,92 | `--success-ink` ✅ prechádza |
| `--danger` | **4,38** | 4,02 | `--danger-ink` ✅ prechádza |

**Všetky štyri `-ink` varianty (`--accent-ink`, `--success-ink`, `--danger-ink`,
`--warn-ink`) prechádzajú na všetkých 8 povrchoch.** Základné hodnoty nie. R4 je
teda grep úloha: nájdi každé miesto, kde sa základná hodnota používa ako farba
**textu**, a prepni ju na `-ink`. Ako výplň (`background`) základná hodnota zostáva —
tam je `--on-accent` a ten je v poriadku.

`--brand-gold` (1,74–1,90) a `--on-accent` (1,00–1,31) v tabuľke chýbajú zámerne:
ani jeden nie je token pre text na papieri. `--brand-gold` je značkový znak,
`--on-accent` je text na akcente. Nepoužívať ich ako farbu textu na povrchu je
pravidlo, nie chyba, ktorú treba „opraviť" zmenou hodnoty.

---

## 4. Čo tento baseline NEHOVORÍ

- Nemeral som hustotu ani typografickú škálu (R6, R7, R10) — to sú merania nad
  populovaným DOM na viacerých obrazovkách a patria do vlny 2 s vlastným harnessom.
- Nemeral som `cssswap.js` inertnosť — to má zmysel až keď existuje zmena, ktorú
  treba dokázať ako inertnú.
- Screenshot neexistuje a existovať nebude: Browser pane v tomto prostredí
  nekompozituje rámce. Dôkaz je zmeraný DOM.
