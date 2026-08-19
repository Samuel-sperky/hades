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
  `L.pos` preto obsahuje **vždy všetky uzly** (19. 8. 2026: 2675), na každej úrovni.
  Default `graphScope` je ale `live`, takže bez prepnutia na `all` sa kreslí ~1095.
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

**Hrany sú hlavný nosič dojmu, nie dekorácia.** Kreslia sa všetky (19. 8. 2026: 8271) ako
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
regeneruj.** Overené 19. 8. 2026 skriptom `iconcheck.js` (glyf = 1 em ≈ 18 px,
nevykreslená ligatúra padne na fallback a je násobne širšia): v subsete SÚ `hub`,
`add`, `memory`, `arrow_upward`, `stop`, `check`, `close`, `delete`, `edit`, `bolt`,
`list`; **NIE SÚ** `terminal` (144 px, teda text) ani `arrow_downward` — konzola preto
používa `arrow_upward` prevrátenú v CSS. Overiť sa to dá skriptom v scratchpade (`iconrender.js`): meria šírku
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

## Konzola vedomia (`/console`)

Samostatné rozhranie (nie obrazovka v raile grafu): agentová smyčka s 12 nástrojmi
nad vlastnou pamäťou a nad súbormi projektu. Vlákna majú vlastnú URL
(`/console/<uuid>`). Vzniklo 19. 8. 2026.

**Beh je dvojfázový a to je jeho podstata.** Čítacie tooly bežia hneď; každý
zápisový tool zaparkuje ako `pending` s náhľadom (unified diff, resp. before/after)
a čaká na kliknutie človeka. Turn tým **skončí bez `end` rámca** a beh sa obnoví až
z `/api/console/decide`. Nie je to slušnosť voči používateľovi, ale nutnosť:
blokujúce čakanie by držalo jedného z ôsmich PHP workerov a lokálny model si
zaparkovaný zápis **naozaj skúsil pretlačiť** — po zamietnutí `mind_learn` ho zavolal
znova s iným labelom, hoci to systémový prompt zakazuje. Brána teda nesie váhu, nie
je to dvojitá poistka.

**História vlákna je len v DB** (`console_messages`). Skladá sa odtiaľ, nikdy z toho,
čo poslal prehliadač — inak by si klient vedel podstrčiť tool výsledok, ktorý nikdy
nenastal. Test to overuje podstrčenou históriou.

**Protokol je NDJSON, nie SSE**, a to zámerne: `EventSource` nevie poslať CSRF
hlavičku, takže SSE endpoint by musel vypadnúť z guardovaného okruhu (§8.11
`docs/BEZPECNOST.md`). `fetch` + `ReadableStream` zvládne CSRF aj `abort`. Rámce
nesie kľúč `t`: `start`, `delta`, `step`, `tool`, `tool_result`, `permission`, `end`,
`error`. **JSON objekt sa môže rozdeliť medzi dva chunky** — parser preto drží buffer.

**`think` je vypnuté** (`hades.console.think`). Qwen3 je hybridný a reasoning posiela
v `message.thinking`, ktoré parser zahodí: namerané 231 z 309 tokenov do koša a 25 s
ticha pred prvým znakom, kým ten istý správny tool call s `think=false` stál
34 tokenov. Pri ~8 tok/s na CPU to nie je optimalizácia, ale podmienka použiteľnosti.

**Model beží lokálne** (Ollama). Na stroji nie je použiteľná GPU — AMD Radeon iGPU,
ktorú Docker na Windows do kontejnera nepustí — takže inferencia je CPU-only a
default je `qwen3:8b` (~8–9 tok/s). `qwen3-coder:30b` je stiahnutý, ale **nedal prvý
token ani za 300 s**: 18,6 GB modelu sa nevojde do Docker VM (~22,9 GiB, WSL2 default
= polovica hosta) a swapuje. Ollama server na porte 11434 **patrí inému projektu**
(`auraai-ollama-1`); Hadesova vlastná služba `ollama` v compose je profilová
(`--profile ollama`, port 11435), aby sa nebili o tú istú RAM.

**Cesty sa odmietajú, nesanitizujú** (`Tools/PathGuard`). Sanitizovaná cesta ticho
zapíše niekam inam, čo je horšie než chyba. Mimo `hades.console.files_root`, `.env`,
`.git`, `vendor`, `node_modules` a čokoľvek so bodkou na začiatku názvu je zakázané
na čítanie aj zápis, symlinky sa rozbaľujú a kontroluje sa cieľ. **Bash/shell tool
zámerne neexistuje** — appka je verejne tunelovaná cez ngrok.

**Kontextový strop je reálne blízko.** Definície 12 nástrojov sú ~2,6k tokenov
v každom requeste, obyčajný ťah ~3k, ťah ktorý prečíta `CLAUDE.md` ~15k pri
`num_ctx` 16384. Trinásty nástroj alebo druhé čítanie celého súboru narazí.

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

`docker compose exec app php artisan test` — 326 testov, všetko PHP (backend, MCP,
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

- **`semantic: true`** znamená zásah cez vektor, nie cez slovo — v uzle teda slová
  z dopytu **nie sú** a nemá zmysel ich tam hľadať.

Zmeny tu drž **aditívne** — `mind_recall` volajú živé sessions. `recall()` vracia
`Collection<Node>` pre ChatController; metadáta pre AI pridáva `recallWithMeta()`.

### Recall je hybridný (od 19. 8. 2026)

Kľúčová vetva (FULLTEXT/LIKE + skóre tagov) a vektorová vetva (bge-m3, 1024D,
`node_embeddings`, kosínus v PHP nad BLOB float32) sa **fúzujú cez RRF**, nevyberá sa
jedna. Namerané na 28 reálnych dopytoch (`mind:recall-bench`): pass@3 71,4 % → 100 %,
MRR 0,680 → 0,845, 11 win / 17 same / 0 loss, +213 ms na dopyt (123 ms vektorizácia
dopytu + ~84 ms sken a fúzia).

**Odkiaľ zdvih naozaj pochádza** — dôležité, aby sa nezdôvodňoval nesprávne:
všetkých 14 čisto semantických zásahov skončilo na miestach 6–12 a **ani jeden nebol
tou správnou odpoveďou**. Zdvih robí (a) rozšírenie kandidátov za hranicu keyword
top-12 a (b) RRF preradenie, ktoré zlomí dominanciu „tučných" uzlov: uzol [793] bol
v keyword vetve #1 pre tri nesúvisiace dopyty, v hybride pre žiadny.

Keď je `hades.embeddings.enabled` false, model nedostupný alebo korpus prázdny,
recall sa chová **presne ako predtým** (short-circuit na `COUNT(*)`). To je tvrdý
požiadavok, nie optimalizácia: `mind_recall` volajú živé sessions a spadnutý model
nesmie spôsobiť, že pamäť vyzerá prázdna.

MariaDB 11.4 natívny `VECTOR` nemá (až 11.7+), preto BLOB + brute-force nad ~2700
uzlami. Pri raste rádovo vyššie treba prehodnotiť, nie skôr.

`config/hades.php` → `embeddings.*` (model, batch, `rrf_k`, `candidates`,
`min_similarity`). Backfill: `php artisan mind:embed --stale` (inkrementálny podľa
`source_hash`, prerušiteľný, opakovanie dorobí zvyšok).
