# Hades (AI-mind) — poznámky pre Claude Code

Laravel + MariaDB + Redis + Reverb v Dockeri. MCP server `hades` na
http://localhost:8080/mcp, vizualizácia na http://localhost:8080.

## Frontend

Vizualizácia **nemá build step**. `resources/views/mind.blade.php` je statické HTML
a načítava `public/js/mind/main.js` ako `<script type="module">`. Vite v projekte je,
ale `mind.js` sa cez neho nikdy nepúšťal — needituj `vite.config.js` kvôli grafu.

`public/js/mind/` je **31 natívnych ES modulov** (do 8/2026 to bol jeden IIFE
s 5933 riadkami). Kľúčové:

| Modul | Zodpovednosť |
|---|---|
| `state.js` | zdieľaný objekt `S` — jediný zdroj pravdy, všetci ho importujú |
| `layout.js` | `computeLayout()` — deterministické rozloženie pre aktuálnu úroveň, `viewInsets()` / `camInsets()` |
| `sim.js` | stavový stroj `go({level, area, dept, node})`, `currentPath()`, `goUp()` |
| `render.js` | kreslenie canvasu, `fitCam()`, `graphActive()`, `publishNavApi()` |
| `edges.js` | hrany a agregované stuhy medzi oblasťami |
| `controls.js` | ovládanie + presety nastavení |
| `screens/*.js` | jednotlivé obrazovky (Dnes, Denník, Knižnica, …) |

**Cyklické importy sú v tomto grafe nevyhnutné** (`render` ↔ `panels` ↔ `controls`).
Preto: **exportuj funkcie ako hoistované `export function`, nikdy ako
`export const foo = () => {}`** — arrow v `const` nie je hoistovaná a pri cykle spadne
na `ReferenceError: Cannot access 'foo' before initialization`.

### Graf

**Jedna veľká scéna, dva pohľady, zanorenie je len filter.**

- `S.gview` = `'net'` (organický oblak) alebo `'layers'` (vodorovné pásy podľa
  `layer_role`: vstup → skryté → jadro → výstup). Prepínače `#btn-view-net` /
  `#btn-view-layers` v hlavičke, kláves `V`. **Pohľady NIE SÚ zrušené** —
  `setView()` je živý kód, nie shim.
- `go({level, area, dept, node})` v `sim.js` **nemení pozície ani nevymieňa scénu**.
  Je to filter: fokusová skupina zostane plná, zvyšok stmavne na `DIM_CTX` (0,34).
  `L.pos` preto obsahuje **vždy všetkých ~1065 uzlov**, na každej úrovni.
  `Esc` zruší filter, `#btn-up` ide o úroveň von.

**d3 `forceSimulation` JE späť** (od `a4497ff`) a pozície sú organické, nie
deterministické. Determinizmus bola moja vlastná podmienka z augusta 2026, ktorú
používateľ nikdy nežiadal a ktorá zabila živý dojem siete — nezavádzaj ju znova.
Ťahanie uzlov funguje (`fx/fy` + `holdSim`).

**Simuláciu tiká vlastná rAF pumpa** (`pump()` v `sim.js`), nie d3 timer — ten beží
na `requestAnimationFrame` a rozbil by pravidlo „mimo Grafu sa nekreslí". Mimo Grafu
pumpa **netiká na rAF, ale dosadá ticho** cez `setTimeout` (10 ms dávka / 50 ms):
bez toho by alpha nikdy neklesla, timer sa preplanoval navždy a každý WS zrod uzla
by zaplatil studený burst ~150 ms na zablokovanom vlákne.

**Ako scéna vyplní viewport bez determinizmu:** gravitácia je **anizotropná** — v Y
je `ar^squashPow`-krát silnejšia (`PHYS.squashPow = 2`). V rovnováhe má oblak pomer
strán ≈ pomer viewportu, takže fit sadne na obe osi naraz. Bez toho by sa force
layout usadil do kruhu a na 16:9 pokryl ~55 % šírky. `normalizeAspect()` to po
usadení dotiahne. Okraje sa čítajú z CSS tokenov (`--rail-w`, `--header-h`,
`--panel-w`, `--edge`) — nezadrôtuj ich znova do JS.

**Vizuálna sémantika** (jeden význam na kanál): farba = oblasť, tvar = typ.
Uzly sú **priehľadné prstence**, nie plné disky — priehľadnosť nesie *diera*, nie
nízka alfa, takže sa prekrývajúce uzly dajú čítať a každý drží kontrast (obrys má
podlahu `RING_LW = 1,5` px v obraznovkových px; pri 1,1 px zoberie antialiasing
viac než polovicu kontrastu). Spomienka = jeden prstenec, skill = dva súosé,
projekt = prstenec s plným stredom, **jadro = jediný sýty plný prvok** (zlato).
Legenda v `panels.js` musí hovoriť ten istý jazyk — plné disky tam učili zle.

**Farby oblastí sa utlmujú v OKLCh** (`mutedColor()` v `theme.js`): zrezaná chroma
a **jednotná cieľová svetlosť** pre všetky oblasti, takže oko ich číta ako jednu
tichú vrstvu a rozlišuje len tónom. Podlaha kontrastu (3,15:1 voči papieru) je
súčasťou funkcie, nie kozmetika. Každý swatch oblasti v DOM (legenda, štatistiky,
strom, Knižnica, Dnes) musí ísť cez `mutedColor()`, inak UI hovorí inou farbou než
plátno. V HSL to nerob — z gold by bola špinavo hnedá.

**Hrany sú hlavný nosič dojmu, nie dekorácia.** Kreslia sa všetky (~2882) ako
vlásková textúra; hustota nesie štruktúru. `S.minWeight` default je **0** (bolo 1,0
a skrývalo 791 hrán). Jednotlivá hrana zámerne nedosahuje 3:1 — pri 2000 vláskach
to je nezlučiteľné s „jemnou sieťou"; význam nesie hustota a pri hoveri ide hrana
na akcent, kde prah **spĺňa**.

Mimo obrazovky Graf sa `requestAnimationFrame` **zastaví** (`graphActive()`).
Keď pridávaš window listener, ktorý siaha na graf, daj mu `graphActive()` strážcu —
inak beží nad 1000+ uzlami na obrazovkách, kde graf nikoho nezaujíma.

### Fonty

**Self-hosted v `public/fonts/`, Google Fonts CDN je zámerne preč.** Pri jeho
nedostupnosti sa každá ikona vykreslila ako svoj ligatúrový názov („wb_sunny", „hub")
v serif fallbacku a rail sa rozpadol. `@font-face` bloky sú na začiatku `mind.css`,
Geist / Geist Mono / Playfair sú variabilné (jedna os `wght`), preto `font-weight`
deklaruje rozsah. `latin-ext` nesie slovenskú diakritiku, načíta sa vždy.

Material Symbols je **subset** (215 glyfov zo 4271, 132 kB namiesto 3 MB), vyrobený
`pyftsubset --no-layout-closure` — bez toho flagu ligatúrová uzávera vtiahne všetky
ikony späť. **Keď pridáš NOVÚ ikonu, subset ju nemá a vykreslí sa ako text —
regeneruj.** Overiť sa to dá skriptom v scratchpade (`iconrender.js`): meria šírku
textu v Material Symbols, vykreslený glyf zaberá jednu em, nevykreslená ligatúra
padne na fallback a je násobne širšia. Ligatúry v subsete žijú v GSUB lookupe
**typu 7 (Extension)** — bez rozbalenia `ExtSubTable` vyzerá font, akoby ligatúry
nemal žiadne.

`font-display: block` pre ikony (nie `swap`): krátky prázdny priestor je lepší než
blik surových ligatúrových názvov, čo je presne tá porucha, ktorú tu riešime.

### CSS

`public/css/mind.css`, ~3700 riadkov. Pravidlo: **žiadny raw hex/rgba mimo `:root`**,
všetko cez tokeny. Svetlá paleta je v `:root`, tmavá v `:root[data-theme="dark"]`.
**Tmavá je default** (`initialTheme()` v `theme.js`).

Presvitanie utlčeného grafu pod obsahom je **len na tmavej téme** — na svetlej
ostáva plátno mimo Grafu skryté, pretože pod poloprehľadnými chipmi tam kontrast
textu závisel od obsahu grafu.

**Kánon akcentu: teal je interaktívny, zlatá je značková.** Teal (`--accent`) nesie
hover, fokus, aktívny stav a primárne akcie. Zlatá (`--gold`) je vyhradená značke
a jadru vedomia — jadro je na plátne jediný sýty plný prvok a je zlaté. Keby zlatá
nesla aj interaktívny stav, ten jeden vyhradený význam by sa rozdrobil. Menované
výnimky (a nič nad ne nepridávaj): `#brand-core` je síce `<button>`, ale zlatá tam
nesie identitu a všetky jeho stavy sú teal; `.avatar` a `.empty-loading .load-mark`
sú značkový znak. `--cert-hypoteza` je na tmavej téme tá istá hodnota ako
`--brand-gold` — je to tretia, semantická rola a presun na `--warn` (70° vs 79°)
by kolíziu len zhoršil, preto zostáva.

Dvojité deklarácie (~46 dvojíc „selektor + vlastnosť" s inou hodnotou) boli
**zaplatené v `c1a3a96`** a dnes je ich **0**. Čo v súbore ostáva, je zámerné:
4 dvojice `--card-pad` (základ + varianta, 17 riadkov od seba) a 15 legitímnych
prepisov (media queries, rovnako pomenované kroky rôznych `@keyframes`). Detektor
je `w4dup.js` v scratchpade.

**Keď meníš CSS, over, že zmena je inertná, výmenou stylesheetu nad TÝM ISTÝM DOM**
(`w8/cssswap.js`) — nie dvoma načítaniami stránky, Hades je živý a medzi nimi sa
naučí uzly. Ten harness sa **musí kalibrovať A/B/A/B s dosadnutím** (dva rámce
+ 250 ms po výmene) a počítať len to, čo je stabilné v oboch: jeho prvá verzia
hlásila 96 110 „stabilných" rozdielov, ktoré boli len rozbehnuté prechody.

## Konzola vedomia

Samostatné rozhranie na `/console` (vlákno na `/console/<uuid>`), nie obrazovka v raile grafu.
Frontend je opäť **natívne ES moduly bez build stepu** (`public/js/console/*`), backend je
`app/Services/Console/`. Model beží lokálne (Ollama, CPU ~9 tok/s) alebo na Anthropicu, keď je
v `.env` kľúč — prepínač v hlavičke berie len **dostupných** poskytovateľov a chýbajúceho
pomenuje aj s premennou, ktorá mu chýba (`missingProviders()` v `models.js`).

**Protokol behu je NDJSON, nie SSE**, a to zámerne: `EventSource` nevie poslať CSRF hlavičku,
takže by endpoint musel opustiť chránený okruh. Dve pravidlá, na ktorých stojí klient aj TUI:
ťah končí **presne jedným** rámcom `end` alebo `error`, a rámec `permission` ťah ukončí **bez
`end`** — beh je zaparkovaný a dostreamuje ho `/decide`. Neznámy typ rámca sa **musí ticho
ignorovať**, inak sa protokol nedá rozširovať.

### Tooly a povolenia

Register je `ToolRegistry::TOOLS` a jeho **poradie nie je abeceda**: slabý model siaha po tom,
čo je vyššie, takže čítanie je vpredu a `bash` je úplne posledný. `isWrite() === true` znamená
„beh sa zaparkuje a čaká na človeka"; neznámy tool je zápisový (fail-closed).

`bash` beží v **klietke** (`CommandCage`): najprv gramatika (reťazenie, presmerovanie a
substitúcia sú odmietnuté — `ls; rm -rf x` je „ls plus čokoľvek"), potom `deny` nad celým
príkazom, potom **biely zoznam** nad každým segmentom rúry zvlášť. Zoznamy sú v
`config/hades.php` → `hades.console.bash`. Biely, nie čierny: čierny sa obíde čímkoľvek, na čo
autor nepomyslel.

**„Povoliť vždy" sa pri shelle zúži na vzor príkazu, nie na celé vlákno.** Pôvodne
`allow_always` zapínalo `auto_accept`, takže jedno kliknutie pri `php artisan test` by v tom
vlákne povolilo aj `mind_delete`. Tool, ktorý je na plošné povolenie priširoký, implementuje
`NarrowsAllowance` a povolenie sa uloží do `console_threads.allowances` len na jeho kľúč.
Marker interface a nie metóda v `ConsoleTool`: fake tooly v `ConsoleRunTest` implementujú
kontrakt priamo, takže nová metóda by ich rozbila.

`write_report` píše HTML do `storage/app/reports/<uuid>.html` a servuje ho
`/console/reports/<uuid>` za `auth.ui`. Obsah píše **model** a stránka žije v tom istom
origine ako session, takže obrana je **dvojitá**: sanitizácia pri zápise (DOMDocument, nie
regex — `Str::markdown()` blokový `<script>` zaescapuje, ale `<div onclick>` prepustí) a CSP
pri servovaní, ktorá nepustí žiadny skript.

### Dva okruhy, a ten rozdiel je zámer

| Okruh | Kto | Ochrana | Tooly |
|---|---|---|---|
| `/api/console/*` | prehliadač | `auth.ui` + session + CSRF | plný register |
| `/api/console/cli/*` | terminál, desktop | `auth.console`, **loopback-only**, bez session/CSRF | plný register |
| `/api/console/headless` | skript, MCP, scheduler | `auth.console` | **len čítacie** |

`auth.console` odmieta všetko, čo prišlo cez proxy (`X-Forwarded-*`), a **to je jeho podstata**:
Caddy na verejnej ceste hlavičku s UI tokenom do requestov vkladá, takže bez tej kontroly by
bol ngrok tunel plne autentizovaný vstup **bez CSRF** k tooolom, čo spúšťajú príkazy.
`ConsoleGuardTest` prechádza router a nepustí routu konzoly, ktorá nie je ani v jednom okruhu
— ani programovú routu, ktorá by si niesla session.

Headless má register **len na čítanie** a nie je to opatrnosť: zápis ťah zaparkuje a čaká na
človeka, ktorý v skriptovanom behu nie je, takže vlákno by zostalo trvalo zablokované.

### Klienti

`bin/hades/` je terminálový klient — **žiadna npm závislosť**, čisté Node ESM. `hades` je
interaktívny, `hades run "…"` jeden ťah, `hades run "…" --json` ide cez headless a na stdout
vypíše **iba JSON** (dá sa to piecť do `jq`), `hades doctor` povie, odkiaľ vzal adresu a token
(token nikdy nevypisuje). Token hľadá: env → `~/.hades/config.json` → **`.env` projektu**
(stúpa nahor po priečinok s `artisan` aj `.env`) — tretia cesta je hlavná, aby ho používateľ
nemusel kopírovať do druhého súboru.

Dve pasce, ktoré tam už sú vyriešené a netreba na ne naletieť znova: `readline` prepne stdin na
utf8, takže klávesy prichádzajú ako **string, nie Buffer** (porovnanie `chunk[0] === 27` by
netrafilo nikdy a „Esc zamietne" by bolo napísané a mŕtve), a `readline.pause()` zastaví aj
podkladový stream, takže pripojenie druhého `data` listenera ho **nerozbehne** — stdin musí mať
v každom okamihu presne jedného vlastníka.

`desktop/` je Electron obal nad `/console`, nie druhá appka. Token vkladá **ako hlavičku
scopovanú na jeden origin**, nie do URL — v URL by prežil v histórii okna a v access logu.

### Plánované behy

`console_schedules` + `php artisan mind:console-schedules` (v scheduleri každú minútu,
`withoutOverlapping`). Rozvrh vytvorený programovo je **vždy vypnutý** — rozvrh, ktorý sa sám
rozbehne každú minútu, je spálené CPU, o ktorom človek nevie. Zapína sa `--enable=<uuid>`.

## Overenie UI

Docker servuje repo z jeho koreňa, takže **worktree na 8080 neuvidíš**. Postup,
ktorý funguje (prehliadače v tomto prostredí blokujú `file://` aj `localhost`):
headless Chrome cez `puppeteer-core` (`C:\Program Files\Google\Chrome\Application\chrome.exe`,
node na `C:\Program Files\nodejs\node.exe`). Pre worktree si postav malý statický
server, ktorý servuje `public/` a `/api` proxuje na 8080.

Onboarding karta sa vypína `localStorage.setItem('hades.hints2', 'done')` **pred**
loadom (`evaluateOnNewDocument`) — klik na `#hint-skip` po loade ju nespoľahlivo skryje
a prekryje každý screenshot.

**Harness si vždy skalibruj na známom stave.** Merač kreslenia obaľoval `ctx.clearRect()`,
ktorý render nepoužíva, takže vracal vždy 0 a kritérium „rAF stojí mimo Grafu"
vyzeralo splnené bez toho, aby čokoľvek meralo. Obaľuj `window.requestAnimationFrame`.
Pri kontraste neber farbu textu cez `elementFromPoint` — vracia iný element, a tým
cudziu farbu (dávalo to falošné 1,01:1 na bielom texte na tealovej výplni).

Ďalšie tri pasce toho istého druhu, na každú z nich sa dá naletieť:

- **Nečakaj fixný čas, čakaj na obsah.** `/api/journal` a `/api/dashboard` bežia 3–4 s.
  Pri kratšom spánku sa nasnímkuje loading skeleton a *všetky* obrazovky vyzerajú
  prázdne. Čakaj na `waitForFunction`, kým v `.screen.active` nie sú položky.
- **Nepíš merací skript ako kópiu formuly z kódu.** Po zmene kódu bude merať svoju
  starú kópiu a hlásiť nezmenené čísla. Nechaj render vystaviť výsledok na `S`
  (napr. `S._labelBoxes`) a čítaj ten.
- **Hades je živý.** Medzi dvoma načítaniami sa naučí nové uzly a Denníku narastie
  celý nový deň, takže „pred a po" screenshoty sa líšia aj bez tvojej zmeny. Pri
  porovnávaní CSS prepni stylesheet nad tým istým DOM v tom istom okamihu.

## Testy

`docker compose exec app php artisan test` — 228 testov, všetko PHP (backend, MCP,
API). Frontend testy nie sú; UI sa overuje prekliknutím v prehliadači.

**Vo worktree tá istá sada netestuje worktree.** `vendor` je symlink na hlavný
checkout, Composer si z jeho polohy počíta `$baseDir` a autoloader je optimalizovaný
(classmap), takže `App\` aj `Tests\` ukazujú na **hlavnú vetvu** — nová metóda hlási
„Call to undefined method" a zelená sada nehovorí o tvojej zmene nič. Vo worktree
preto:

```
docker compose exec -w /var/www/html/.claude/worktrees/<vetva> app \
  php vendor/bin/phpunit -c tests/phpunit.worktree.xml
```

`tests/worktree-autoload.php` prepíše classmap aj PSR-4 na worktree (cesty v classmape
nie sú normalizované — na tom prvá verzia tichom padla). DB je `hades_test`; názov
**musí** končiť na `_test`, `Tests\TestCase` to overuje a inak beh odmietne.

**Prepísaný autoloader je len POLOVICA opravy.** Aplikácia sa aj tak bootovala z hlavného
checkoutu: `Illuminate\Foundation\Testing\TestCase::createApplication()` robí
`require Application::inferBasePath().'/bootstrap/app.php'` a `inferBasePath()` odvodí koreň
z polohy autoloadera — teda z vendor symlinku, teda z **hlavnej vetvy**. Config, views, routy
ani migrácie preto neboli tvoje. Prejaví sa to tak, že sada je zelená alebo červená podľa
toho, čo práve robí **iná session**: 19. 8. 2026 padol `ConsoleGuardTest` na
`assertSee('Konzola vedomia')`, hoci ten titulok vo worktree je — prepísala ho druhá vetva
u seba. Tá istá slepota skryla celý `hades.console.bash` blok z configu.
`worktree-autoload.php` preto nastaví `$_ENV['APP_BASE_PATH']` na worktree.

**Dve sessions naraz nesmú testovať tú istú DB.** `RefreshDatabase` tabuľky zahadzuje, takže
dva paralelné behy nad tou istou scratch DB si truncujú tabuľky pod sebou a padne to ako
chyba kódu. Config je preto jeden (`tests/phpunit.klient.xml`) a **databáza sa berie
z prostredia**: `<env>` má atribút `force` defaultne `false`, takže premenná, ktorá už
v prostredí je, **vyhrá** nad hodnotou v XML:

```
docker exec -e DB_DATABASE=hades_klient2_test -w /var/www/html/.claude/worktrees/<vetva> \
  hades-app-1 php vendor/bin/phpunit -c tests/phpunit.klient.xml
```

Overené spustením (20. 8. 2026, PHPUnit 12): s `-e DB_DATABASE=hades_klient_probe` sada
padla poistkou na meno DB — teda premenná dorazila k aplikácii a XML ju neprepísalo. Meno
**musí** končiť na `_test`, inak `Tests\TestCase` beh odmietne. Novú DB zakladá root (appka
`CREATE DATABASE` nemá): `docker exec hades-mariadb-1 …`.

Testy CLI klienta sú v Node: `cd bin/hades && node --test --test-timeout=20000` (55 testov).
`node --test bin/hades/test/` na Node 24 vo Windows **nefunguje** — argument-priečinok
vyhodnotí ako súbor; buď glob, alebo `node --test` bez argumentu z `bin/hades`.

## Pasca: overuj IDENTITU preview servera

Harness beží na `127.0.0.1:8091` (predtým 8099 — ten zabral kontejner
`zapis_porady_app`). Keď preview server zhasne, port prevezme **cudzia appka** a
harness potom meria ju: `verify.js` vráti „VERDICT: OK", `rvsweep.js` nahlási
neexistujúcu kontrastnú regresiu a `a3-check.js` sa nedočká `window.HADES`.
Naletel som na to.

**Pred každým meraním over, že server je náš:**

```
curl -s http://127.0.0.1:8091/ | grep -o 'src="/js/[^"]*"'
```

Musí vypísať `/js/mind/main.js`. Ak vypíše niečo iné (alebo hlavička odpovede
obsahuje `X-Powered-By: PHP`), meriaš cudziu appku a všetky čísla sú bezcenné.

## MCP — odpoveď je pre AI, nie pre človeka

`mind_recall` konzumuje Claude Code, takže tvar odpovede je súčasťou kontraktu:

- `relevance` (0–1) je podiel konceptov dopytu, ktoré uzol trafil, plus tretinová
  váha zhody v **labeli**. Bez tej druhej časti dostalo dvanásť uzlov rovnakých 0,5.
- Uzol s `via` **nie je priamy zásah** — pritiahla ho hrana od toho suseda a má
  polovičnú relevanciu. Susedia sa radia podľa relevancie, nie sily: AI kráti
  kontext zdola.
- `related` sú labely najsilnejších spojení. Prednosť majú uzly už v odpovedi
  (ich label je raz zaplatený).
- **Prázdne polia sa neposielajú** a význam vynechania je v popise nástroja
  (`origin` chýba = `session`, `verified` chýba = neoverené). Nepridávaj polia
  s `null` — je to 20 B za nulovú informáciu na každom uzle.
- `mind_read` vracia jeden uzol celý (popis, všetky tagy, cesta k .md, spojenia).
  Práve to `description_truncated: true` sľubuje.
- `noiseOf()` v `MindService` klasifikuje odpad (`markdown` / `raw-prompt` / `slug` /
  `stub`). Recall ho **označí a zaradí za čisté uzly, nemaže** — skrytý odpad sa
  nikdy neopraví. Smernica (prompt) ho zahodí úplne.

Zmeny tu drž **aditívne** — `mind_recall` volajú živé sessions. `recall()` vracia
`Collection<Node>` pre ChatController; metadáta pre AI pridáva `recallWithMeta()`.

Od 19. 8. 2026 sú v `/mcp` aj tooly, ktorými **iná AI ovláda konzolu**: `console_run` (jeden ťah
agenta, read-only tooly, vracia `thread`, ktorým sa dá pokračovať), `console_threads`,
`console_result` a `console_schedules`. Sú to jediné mind tooly, ktoré niečo *spúšťajú*, takže
majú vlastný strop a `console_result` nevracia rolu `system` — tá istá smernica na každom vlákne
by v jednom čítaní bola väčšia než celá konverzácia.
