# Kontrakt — UX/UI, desktop appka, chat nad grafom, dokončenie auditu

Dátum: 21. 8. 2026 · vetva `feat/hades-ux` (bez worktree, dôvod v §7)
Východiskový stav: **448 passed, 45 skipped, 0 failed** (`php artisan test`, odmerané
pred začiatkom, vrátane nezacommitovanej rozpracovanej vlny).

## 0. Cieľ

Dohrať štyri rozbehnuté veci naraz, pretože sa dotýkajú tých istých súborov a robiť
ich po sebe by znamenalo trikrát otvárať `mind.css` a `console.css`:

1. **UX/UI** — dokončiť vlnu B (duplikáty graf × konzola, density prepínač) a odpracovať
   zvyšok piatich auditov: čitateľnosť (R1–R11), prístupnosť (P1–P13), dizajn systém
   (D1–D23), IA a toky (zvyšok A1–A21).
2. **Desktop appka a jej dizajn** — z Chrome `--app` okna bez identity urobiť skutočnú
   appku s vlastným shellom, ikonou, stavmi a inštalátorom.
3. **Chat nad grafom** — mŕtvy `chat.js` nahradiť dokom Charóna nad plátnom a rozšíriť
   funkcie behu profilmi nástrojov.
4. **Podokončovať zvyšok** — nálezy, ktoré audity vymenovali a nikto ich ešte nezavrel.

## 1. Odsúhlasené rozhodnutia (dávka 1, 21. 8. 2026)

| # | Rozhodnutie | Dôvod |
|---|---|---|
| R-1 | **Chat nad grafom = dok Charóna nad plátnom.** Ten istý backend, tá istá dvojfázová brána zápisov. Vybrané uzly idú do promptu ako kontext (prevezme sa mechanizmus `chatContext` čipov). Chat vie navigovať graf. | Nález A9: dnes je to druhá konverzačná plocha, ktorá po zapnutí odpovie „doplň API kľúč". Dve konverzačné cesty k tomu istému vedomiu sa rozídu — presne tá chyba, ktorú vlna E opravovala na šiestich miestach. |
| R-2 | **Profily nástrojov.** Beh dostane len tie tooly, ktoré k úlohe treba (`memory`, `files`, `graph`, `full`). Dok nad grafom beží na malom profile, plná konzola na veľkom. | 12 toolov = ~2,6k tokenov v každom requeste; pri `num_ctx` 16384 trinásty narazí na strop. Bez profilov sa „rozšíriť funkcie" nedá spraviť vôbec. |
| R-3 | **Desktop appka: natívny shell.** Odporúčam **Electron**, nie Tauri — viď §2. | Používateľ zvolil natívny shell (tray, notifikácie, inštalátor, vlastný title bar). |
| R-4 | **Rozsah: všetko okrem vedomých výnimiek.** Nálezy, ktoré si audity samé označili v sekciách „Čo vedome NEROBIŤ", sa nerobia a v reporte sa vymenujú. | 30–35 agentov je práve na tento rozsah. |

## 1b. Rozhodnutia dávky 2 (21. 8. 2026, po vlne 1)

| # | Rozhodnutie | Poznámka |
|---|---|---|
| R-5 | **Strop spendu 3,5 M tokenov.** Pri priblížení sa stropu beh zastaví a nahlási, čo je hotové. | Vlna 1 spotrebovala 818k proti odhadu 180k, pretože štyria agenti čítali ten istý 160 kB auditný korpus. Náprava: od vlny 2 agenti čítajú `docs/sprint-2026-08-21/TRIAZ-*.md` a majú `docs/audit/*` zakázané. |
| R-6 | **A8 sa zlučuje ÚPLNE.** `S.pack` (Balík pre Claude Code) a kontext doku splynú do jedného mechanizmu. | **NEVRATNÁ ZMENA VÝZNAMU OVLÁDAČA.** `packBtn()` na obrazovkách Dnes, Denník a Knižnica dnes kopíruje balík do schránky; po zlúčení bude plniť kontext chatu. Upozornil som na to a používateľ to schválil vedome. |

### Rozhodnutia, ktoré som spravil sám (reverzibilné, kontrakt ich nekryl)

Osem otvorených otázok z `ROZHRANIE-PROFILY-A-DOK.md`:

1. **CSS doku: variant A.** Nový `public/css/charon.css`, načítaný oboma stránkami.
   Tretia kópia `.charon-*` pravidiel v `mind.css` by bola presne tá duplicita, ktorú
   táto vlna platí. Vlastníctvo sa rieši poradím: vlna 4 beží **po** vlne 2, takže
   `console.css` je vtedy už usadený.
2. **Dok NEDOSTANE prepínač v Nastaveniach.** `#chat-toggle` existoval len preto, že
   chat bez API kľúča nefungoval. Dok beží lokálne; prepínač „vypni funkčnú vec" je
   len ďalší ovládač. Otvára sa klávesou a tlačidlom.
3. **Žiadny `graph_filter`.** Len `graph_focus`. Profil `graph` tým zostáva na 1246
   tokenov. Filtrovanie typov a `minWeight` je samostatná úloha, nie súčasť tohto šprintu.
4. **Runy dostanú stĺpec `tool_profile`**, nie štvrtý filter.
5. **`SystemPrompt` BUDE poznať profil.** Dnes tvrdí „jediná cesta k pamäti aj
   súborom sú tvoje tooly", čo je v profile `graph` lož — model môže sľúbiť čítanie
   súboru, ktorý nemá čím prečítať. Prompt, ktorý sľubuje neexistujúcu schopnosť, je
   tá istá chyba ako prázdny stav, ktorý sľuboval „vidí pamäť aj súbory".
6. **Ikony sú zmerané** a odpoveď je v `BASELINE-MERANIA.md §1`: 37 zo 41 je
   v subsete, štyri chýbajúce sa nikde nekreslia. Dok preberá `iconFor()` bez zmien.
7. **Rozdelenie vlny 4 na štyroch agentov** podľa návrhu, so vynútenou sekvenčnosťou:
   agent 4 (mazanie mŕtvej cesty) nesmie začať, kým agent 3 nedoloží zmerané
   kritériá §5/7 a §5/9. Najprv dok funguje, potom sa maže `chat.js`.
8. **Profily:** `memory` 1529 · `files` 1304 · `graph` 1246 · `full` 2541 tokenov.
   Všetky pod dnešným stropom ~2,6k, takže kritérium č. 8 je dosiahnuteľné.

## 1c. Prerušenie týždenným limitom a konsolidácia (24. 8. 2026)

Vlny 3 (prístupnosť) a 5 (Electron) narazili uprostred behu na týždenný limit
používania. **Agenti stihli zapísať súbory na disk, ale ich záverečný výstup limit
zabil** — workflow ich označil ako error, hoci Edit volania prešli. Zachránené a
overené: P7 (aria-pressed na 4 obrazovkách), P11 (#auto-accept cieľ, zmerané 32×144),
P13 (prsteň composera — CSS správne v zdroji aj CSSOM, computed style ale zamrznutý
v headless pane; re-verifikáciu robí brána kvality), a kompletný `electron/main.js`.

Po limite používateľ zdvihol strop na 5 M a požiadal dokončiť zvyšok **10–15 agentmi**
namiesto pôvodných 23. Nový plán (dve workflow, 12 agentov):

- **Workflow A (7)** — Electron dokončenie (preload+core → chróm+identita →
  stavy+tray → balenie+security) ‖ prístupnosť (plátno P1/P9 · mind.css P10 +
  skip-link P2 · konzola P3/P4). Dve koľaje bez spoločného súboru.
- **Workflow B (5)** — chat nad grafom: profily+GraphFocusTool → zdieľané JS moduly →
  dok charon.js/charon.css → zmazanie mŕtveho chat.js + úplné zlúčenie A8 → review.

Hades MCP je počas tohto behu odpojený; pokračujem bez neho (pravidlo CLAUDE.md).
Vetva `feat/hades-ux` je zatiaľ len lokálna, na origin nie je pushnutá.

## 2. Electron vs. Tauri — rozhodnutie s dôvodom

Vyberám **Electron** a je to reverzibilné (shell je aditívny, `bin/hades.cmd` zostáva).

- **Zmizne loopback proxy, a s ňou celá jej útočná plocha.** Dnešný `hades-app.mjs`
  musí postaviť lokálny HTTP server, aby vedel pridať hlavičku `X-Hades-Ui-Token` —
  a potom ho musí brániť pred každým procesom na stroji (per-launch tajomstvo,
  HttpOnly cookie, kontrola `Host` proti DNS rebindingu). Electron pridá tú istú
  hlavičku v `session.webRequest.onBeforeSendHeaders`, teda **vôbec žiadny server
  nevzniká**. Token sa nedostane ani do rendereru.
- **Žiadny nový toolchain.** Node 24 a npm 11 na stroji sú, `package.json` existuje.
  Tauri by si vyžiadal Rust + MSVC build tools.
- Cena: binárka ~200 MB a build step pre shell. Frontend Hadesa **build step
  nedostáva** — pravidlo z CLAUDE.md („vizualizácia nemá build step") platí ďalej,
  Electron balí len okno, nie `public/js`.

Ak chceš namiesto toho Tauri, povedz to pri schválení — mení sa tým vlna 5, nič iné.

## 3. Rozsah — čo ÁNO

### UX/UI
- **Vlna B do konca:** zlúčiť duplikáty medzi `mind.css` a `console.css` (D1–D9, D11,
  D12, D22), `.metric-*` × `.kpi-*`, tri prázdne stavy, štyri `kbd`, `.sr-only`
  a `:focus-visible`, prefix `.tc-` v dvoch významoch, kolízie tried a id (D8).
- **Density prepínač** (`data-density`: pohodlné / cozy / kompaktné) + density tokeny.
- **Čitateľnosť:** R1 (vymenené role serifu voči manuálu značky — najvyššia priorita),
  R2 + R3 (`font-variant-numeric` a `line-height` nedosiahnu dátové riadky — tvrdenie
  v CLAUDE.md je dnes nepravdivé), R4 + R5 (7 párov pod AA na svetlej téme, `a.ghost`
  na 1,87:1 s UA modrou), R6 + R10 (hustota, chróm), R7 (85,6 % textu pod 13 px),
  R8 + R9 (riadková dĺžka, `820px` päťkrát natvrdo), R11.
- **Prístupnosť P1–P13** celá: reduced-motion na plátne, skip link a klávesnica ku
  composeru, fokus po rozhodnutí, karta povolenia hlási ZÁPIS a jeho výsledok, čipy
  hlásia zapnutý filter, zásahové ciele 34×20 → norma, prístupná alternatíva plátna.
- **IA a toky:** A2–A8, A10–A15, A17, A18 (front správ počas behu), kopírovanie
  odpovede a kódu, viditeľné skratky.
- **Mŕtve tokeny** (D19, D20) a alfa komponovaná z natvrdo zapísaných hodnôt (D15, D16).

### Desktop appka
- Electron shell: jedno okno, single-instance, injekcia UI tokenu bez proxy.
- Dizajn: vlastná ikona a identita v taskbare (zdroj `docs/BRAND-HADES.md`), vlastná
  horná lišta s in-app navigáciou (späť / vpred / graf / Charón / vlákna) namiesto
  chýbajúceho adresného riadka, konzistentná s tmavou aj svetlou témou.
- Stavy: **„Hades nebeží"** obrazovka s návodom namiesto Chrome chyby, stav pri strate
  WebSocketu, reconnect.
- Systém: tray, notifikácia **„beh čaká na potvrdenie zápisu"** (dnes o tom človek
  mimo okna nevie), voliteľný auto-start.
- Balenie: `electron-builder`, inštalátor, verzia, `npm audit`.
- `bin/hades.cmd` + `bin/hades-app.mjs` **zostávajú** ako záložná cesta bez inštalácie.

### Chat nad grafom
- Dok nad plátnom napojený na existujúci `/api/console/run` — **zdieľaný modul, nie
  druhá kópia** streamu. Dvojfázová brána zápisov platí v doku rovnako.
- Vybrané uzly grafu → kontext promptu; odpoveď vie graf zafiltrovať a zaostriť.
- **Profily nástrojov** v `ToolRegistry` + test, že profil nezdvihne definície nad strop.
- Mŕtva cesta ide von: `chat.js`, `ChatController` na Anthropic, prepínač
  v Nastaveniach, a s ňou nález A8 (tri paralelné mechanizmy na „daj kontext Claude Code").

## 4. Rozsah — čo NIE

- **Nemeniť farebné hodnoty palety.** Amethyst je dorozhodnutý, zlatá je značková.
  Kánon akcentu z CLAUDE.md sa nedotýka.
- **Determinizmus grafového rozloženia nezavádzať** — bola to moja vlastná podmienka
  z augusta, ktorá zabila živý dojem siete.
- **Nemigrovať na lucide ikony ani na React.** Material Symbols subset zostáva; nová
  ikona = regenerácia subsetu, nie výmena rodiny.
- **Nezjednocovať `.badge` a `.chip`** (D10 to výslovne zakazuje — nie je to duplicita).
- **Nezdvíhať `num_ctx`** ani nemeniť default model. CPU-only inferencia to neunesie.
- **Nezavádzať bash/shell tool** do Charóna. Appka je verejne tunelovaná cez ngrok.
- **Neredigovať `mind_runs`** cez `SecretScanner` — rozbilo by to paritu plochy AI.
- Všetko, čo audity vymenovali v sekciách „Čo vedome NEROBIŤ".

## 5. Akceptačné kritériá

1. `docker compose exec app php artisan test` — **zelené, ≥ 448 passed**, 0 failed.
2. `phpunit.mariadb.xml --filter="HybridRecall|RecallBench|ConsoleTools|McpTools"` —
   **0 skipped, 0 failed** (recall a nástroje Charóna sa menia, sqlite ich preskočí).
3. `ScreenParityTest` zelený **vrátane štvrtej vrstvy**, ktorá dokazuje vlastnú citlivosť.
4. **Kontrastná matrica** nad finálnou paletou: 0 textových párov pod AA na oboch
   témach. Merané zloženým pozadím, po dosadnutí témy, s kalibráciou na `body` (~16:1).
5. **Žiadna nová dvojitá deklarácia** v `mind.css` ani `console.css` (baseline A=0
   v oboch, merané `w4dup.js`).
6. **CSS zmeny inertné tam, kde majú byť** — dokázané výmenou stylesheetu nad tým
   istým DOM (`cssswap.js`), nie dvoma načítaniami stránky.
7. **rAF stojí mimo obrazovky Graf** aj po pridaní doku (merané obalením
   `window.requestAnimationFrame`, nie `clearRect`).
8. **Definície nástrojov na profil** ≤ dnešných ~2,6k tokenov; test to vynúti číslom.
9. **Dvojfázová brána platí aj v doku**: zápisový tool zaparkuje, turn skončí bez
   rámca `end`, beh sa obnoví len z `/api/console/decide`.
10. Electron: `nodeIntegration: false`, `contextIsolation: true`, token nikdy
    v renderer procese, žiadny lokálny HTTP server, bezpečnostná prehliadka v reporte.
11. Ikony: každá nová ikona overená **meraním šírky vykresleného glyfu** (glyf ≈ 18 px,
    nevykreslená ligatúra je násobne širšia), nie čítaním GSUB.
12. Dôkaz o UI je **zmeraný DOM a computed style**, nie screenshot — Browser pane
    v tomto prostredí nekompozituje rámce.

## 6. Riziká

| Riziko | Ako ho držím |
|---|---|
| R1 (role serifu) mení dojem značky | Manuál `docs/BRAND-HADES.md` je zdroj pravdy; oprava zarovnáva CSS k manuálu, nie naopak. |
| Typografická škála a density sa dotknú každej obrazovky | Každá vlna končí `cssswap.js` dôkazom inertnosti + kontrastnou matricou. |
| Odstránenie `chat.js` (398 r.) má väzby v `panels.js` | Najprv dok funguje, potom sa maže. Nie naopak. |
| Electron = nová závislosť a inštalátor | `npm audit` v bráne kvality, samostatná bezpečnostná prehliadka, `bin/hades.cmd` zostáva. |
| Dve session v jednom pracovnom adresári | Pred každým commitom `git diff --cached --name-only`, po commite `git show --stat`. `git stash` nepoužívam vôbec. |
| Merací harness klame | Každý harness sa kalibruje na známom kladnom aj zápornom stave; identita preview servera sa overuje pred každým meraním. |
| Rozsah narastie | Pri > 30 % nad odhad sa beh zastaví a povie to. |

## 7. Prečo bez worktree

Docker servuje repo z jeho koreňa, takže **worktree na 8080 neuvidíš** — a tento
šprint je z väčšej časti UI, ktoré sa musí merať v prehliadači. Vo worktree navyše
`vendor` symlink cez optimalizovaný classmap pustí testy nad hlavným checkoutom.
Pracujem preto na `feat/hades-ux` v hlavnom adresári a riziko cudzej session držím
kontrolou indexu pred každým commitom.

## 8. Výsledok

*(dopĺňa sa po dokončení šprintu)*
