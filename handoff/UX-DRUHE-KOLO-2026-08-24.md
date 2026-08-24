# Handoff — druhé kolo UX šprintu, 20 agentov (24. 8. 2026)

Kontrakt: [KONTRAKT-UX-APPKA-CHAT-2026-08-21.md](../KONTRAKT-UX-APPKA-CHAT-2026-08-21.md) §8 ·
prvé kolo: [UX-APPKA-CHAT-2026-08-24.md](UX-APPKA-CHAT-2026-08-24.md) ·
triáž a baseline: `docs/sprint-2026-08-21/`. Vetva `feat/hades-ux`.

## Čo je hotové

Dve vlny po 10 agentoch zavreli **22 nálezov**: D3, D4, D7, D8, D9, D11, D12, D15, D16,
D20, D21, D22, R6, R7, R10, A2, A3, A4, A10, A12, A19, P6 — plus reálne overenie Electronu.

**Testy:** sqlite 475 passed / 45 skipped / 0 failed. MariaDB
(`ScreenParity|HybridRecall|RecallBench|ConsoleTools|McpTools`) 116 testov, 0 padnutých,
0 preskočených. Dvojité deklarácie `mind.css` A=0 B=1, `console.css` A=0.

## Čo si treba pamätať, keď na tom budeš pokračovať

**Rozdelenie práce medzi agentov ide podľa SÚBOROV, nie podľa témy.** `public/css/mind.css`
a `resources/views/mind.blade.php` sú horúce — v každom okamihu do nich smie písať jeden
agent. Koľaje bežia paralelne len keď nemajú spoločný súbor; vnútri koľaje sekvenčne
(sekvenčný agent vidí nezacommitovanú prácu predchodcu a to je správne). Dve témy, ktoré
sa oba dotýkajú horúceho súboru, musia ísť v samostatných vlnách. Uložené v Hadesovi ako
`Orchestracia agentov: partitioning podla horucich suborov` (uzol 2767).

**Základ povrchu karty je `--panel` z funkčného dôvodu, nie estetického.** Je to jediný
povrch nesúci sklo (`--panel-alpha` sa píše inline na `:root` zo slidera), takže karta
prepnutá na `--surface-2` ticho prestane reagovať na slider priehľadnosti. A `--surface-2`
je na **tmavej** téme svetlejšia než `--panel`, takže „sunken" je preň nesprávne slovo.
Druhý papier je odteraz deklarovaná rola `.card--nested`, nie náhoda.

**`.lib-skill-meta` reže čipy (`nowrap` + `overflow: hidden`), a rez sa MUSÍ priznať.**
`data-more` sčítava klientsky rez **aj** serverový `tags_more` — inak by karta hlásila
menšie číslo než realita. Keď na tom budeš robiť, to sčítanie nerozdeľuj.

**`refreshStats()` v `panels.js` je mŕtvy kód, ale zámerne ponechaný.** Stráži sa sám
(`if (!$('stats-cards')) return`) a nesie komentár o oživení. Jeho DOM zmazal nález A10
a `DOCK_ALIAS = { stats: 'dnes' }` v `dock.js` preposiela starých volajúcich. Nemaž to
bez rozhodnutia, či sa panel Štatistiky niekedy vráti.

**Hygiena a `mind_hygiene` čítajú JEDEN serializér** (`app/Serializers/Screen/HygienaScreen.php`),
ktorý volá existujúci klasifikátor — neprepisuje ho. Nová obrazovka nevznikla (kontrakt
počet zmrazil), je to sekcia na Kontrole. Riadok v `ScreenParityTest::registry()` si zvyšok
vynúti sám.

**Electron je overený reálnym behom**, nie len staticky: boot proti dvom falošným loopback
serverom a zvlášť ako zabalená `Hades.exe`. Zmerané, že token ide na vlastný origin a **nie**
na cudzí, že sandboxovaný CJS preload sa načíta z asaru pod koreňovým `type: module`, a že
`.perm-card` dorazí do main procesu ako `hades:pending-write`. Detaily v `electron/README.md`.

## Pasca, na ktorú som naletel štyrikrát

**Merač v Browser pane má tri poruchy a všetky vyzerajú ako chyba kódu.** (1) CSSOM prechod
cez `document.styleSheets` vracia **prázdne polia**, hoci `cssRules.length` hlási správny
počet. (2) computed style vie **zamrznúť** — injektovaná `!important` kópia toho istého
pravidla sa neprejaví, kým `matches(':focus-within')` vracia `true`, čo porušuje cascade,
takže chyba je v pane. (3) funkcia vracajúca Promise vráti `{}` — pane ju neawaituje, treba
merať v **dvoch** volaniach. Preto: nikdy netvrď regresiu z jedného merania, kalibruj na
známom stave (`body` ~16:1, `hub` = 1 em) a pri rozpore ver zdroju. Uložené v Hadesovi
(uzol 2768).

## Otvorené body

- **A5** — hľadanie v Rozhodnutiach.
- **A15 / A17 / A18** — systémová smernica ako správa po obnove, „Povoliť vždy" v hlavičke,
  front správ počas behu.
- **D13** — väčšinou zanikol so zmazaním `chat.js`; overiť, či zvyšok slovníka `.msg` ešte
  niekde koliduje.
- **R6(c) zvyšok** — filtračný pás na obrazovkách bez súrodenca (Rozhodnutia, Runy, Kontrola)
  potrebuje obal v JS, nielen CSS. *(Bežal ako samostatný spawn_task.)*
- **Prekročenie výšky railu** — 11 destinácií + 3 eyebrow labely je pri viewporte pod
  ~600 px tesné a `#rail` nemá `overflow-y`. Zmerané: rail 562 px pri viewporte 594 px.
- **P13** — prsteň composera; CSS správne v zdroji aj CSSOM, merač vracia zamrznutý
  computed style. Re-verifikovať na čistom loade alebo reálnou klávesnicou.
- **`electron-builder` audit** — 11 high + 1 critical (`tar`) v jeho build-time toolchaine.
  Do balíka nejde nič z toho (ALLOW-list = `electron/**`), vyčistenie žiada breaking bump
  a ten je vyhradený na pokyn.

## Hades

MCP klient v tejto session odpadol, ale **server bežal** — obišiel som to volaním
`http://localhost:8080/mcp` priamo s tokenom z `.env` (hodnota sa nikde nevypisuje).
Uložené: uzly **2745** (pasca s limitom), **2746** (projekt šprintu), **2747** (profily +
ContextBlock), **2767** (orchestrácia agentov), **2768** (pasca merača) a rozhodnutie **51**
(prečo dva workflowy po sebe, nie jeden na 20 agentov).
