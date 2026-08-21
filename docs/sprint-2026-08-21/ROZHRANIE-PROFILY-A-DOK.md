# Kontrakt rozhrania — profily nástrojov a dok Charóna nad grafom

Dátum: 21. 8. 2026 · vetva `feat/hades-ux` · HEAD `3747310`
Kontrakt šprintu: `KONTRAKT-UX-APPKA-CHAT-2026-08-21.md` (R-1, R-2, §3 „Chat nad grafom",
§4 „čo NIE", §5 kritériá 7, 8, 9)
Triáž: `docs/sprint-2026-08-21/TRIAZ-A-P.md` (A8, A9 = **in scope wave 4**)

Toto je **návrh, nie implementácia**. V repozitári sa týmto dokumentom nezmenil ani
jeden riadok produkčného kódu. Všetky čísla nižšie sú **zmerané** na tomto HEADe
(postup merania je pri každom čísle), nie odhadnuté.

Na tento súbor sa naväzujú štyria implementační agenti vlny 4. Preto je napísaný ako
kontrakt: názvy tried, metód, súborov, tvar rámcov, tvar testov a čísla, na ktorých
testy padajú. Kde je rozhodnutie nevratné alebo mimo mojej kompetencie, je v §9
otvorených bodov, nie zamlčané.

---

## 0. Zhrnutie na jednu obrazovku

| Vec | Rozhodnutie |
|---|---|
| Kánon toolov | `ToolRegistry::TOOLS` = **13** tried (12 dnešných + nový `GraphFocusTool`) |
| Profily | `ToolRegistry::PROFILES` = `memory`, `files`, `graph`, `full`; **`full` je podmnožina `TOOLS`, nie celý `TOOLS`** |
| Zmerané ceny definícií | memory **1 529** tok · files **1 304** tok · graph **1 246** tok · full **2 541** tok (dnešný stav = 2 541) |
| Výber profilu | klient smie požiadať v `POST /api/console/run`; default z `config('hades.console.profile')` = `full`; **neznámy profil sa ODMIETNE (422), nesanitizuje** |
| `/api/console/decide` | profil **neprijíma vôbec** (`prohibited`), čítá ho z `console_threads.tool_profile` |
| `AgentRunner.php` | **nezmenený, ani jeden riadok** — profil sa nastaví na singletone `ToolRegistry` pred `$runner->run()` |
| Log behov | `runs.tool_profile` + `console_threads.tool_profile`, obe v UI aj v `fieldsForAi()` |
| Dok | `public/js/mind/charon.js` + `#charon` (NIE `#dock`, ten je obsadený) |
| Zdieľaný kód | `public/js/shared/{ndjson,runclient,runstate,gate,markdown}.js` — päť modulov, všetko `export function` |
| rAF | dok **nesmie použiť `requestAnimationFrame` nikdy**; prekresľovanie markdownu ide `setTimeout(…, 33)` |
| Poradie mazania | dok funguje a je zmeraný → **potom** `chat.js` (261 r., nie 398 — audit má zastaralé číslo) |

---

# ČASŤ 1 — PROFILY NÁSTROJOV

## 1.1 Prečo vôbec (a čo NIE je dôvod)

Definície 12 toolov stoja v každom requeste **2 541 tokenov**. Zmerané teraz, na živom
kontejneri:

```
docker compose exec -T app php artisan tinker --execute='
$r = new App\Services\Console\ToolRegistry();
$j = json_encode($r->definitions(), JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
printf("chars=%d tok=%.0f\n", mb_strlen($j), mb_strlen($j)/4);'
→ chars=10163 tok=2541
```

Rozpis po tooloch (JSON znaky celej definície vrátane `name`/`description`/`input_schema`):

| tool | znaky | ≈ tok | z toho popis | z toho schéma |
|---|---:|---:|---:|---:|
| `mind_recall` | 1166 | 292 | 746 | 365 |
| `mind_read` | 700 | 175 | 400 | 247 |
| `mind_overview` | 419 | 105 | 315 | 47 |
| `grep` | 976 | 244 | 575 | 349 |
| `glob` | 664 | 166 | 347 | 263 |
| `read_file` | 805 | 201 | 444 | 306 |
| `mind_learn` | 1726 | 432 | 741 | 927 |
| `mind_rename` | 656 | 164 | 322 | 279 |
| `mind_move` | 731 | 183 | 315 | 363 |
| `mind_delete` | 708 | 177 | 375 | 278 |
| `edit_file` | 898 | 224 | 464 | 381 |
| `write_file` | 701 | 175 | 422 | 225 |
| **súčet** | **10150** | **2538** | | |
| pole (`[`, `]`, 11 čiarok) | +13 | +3 | | |

**Dôvod profilov nie je len strop `num_ctx`.** Strop je merateľná časť; druhá, väčšia
je, že slabý model si z dvanástich toolov vyberá horšie než z piatich. Dôkaz z tohto
projektu: `SystemPrompt` docblock (`app/Services/Console/SystemPrompt.php:23–34`) hovorí,
že výpis štruktúry pamäte pri strope 8 zabral **427 z 729 tokenov smernice** — a bol
skrátený nie kvôli stropu, ale preto, že model z dlhšieho zoznamu volil horšie. Profil
je ten istý pohyb o úroveň vyššie.

Dôvod, ktorý **NIE JE** platný: „zdvihneme `num_ctx`". Kontrakt §4 to zakazuje a CPU-only
inferencia to neunesie.

## 1.2 Členstvo — ktorý tool do ktorého profilu a prečo

`PROFILES` je **konštanta v kóde, nie config.** Zdôvodnenie s zubami: členstvo rozhoduje
o tom, ktoré **zápisové** tooly v behu vôbec existujú. To je bezpečnostne tvarovaný
zoznam a patrí vedľa `TOOLS`, kde ho `ConsoleToolsTest` vie pripnúť menovite — nie do
`.env`, kde ho netestuje nikto a preklep by ticho odobral (alebo pridal) zápisový tool.
Do configu ide **len meno defaultného profilu**.

```php
/** @var array<string, array<int, class-string<ConsoleTool>>> */
public const PROFILES = [
    // Pamäť bez súborov. Práca typu „usporiadaj vedomie": recall, čítanie, učenie,
    // premenovanie, presun, mazanie. Súborové tooly tu nie sú, pretože kurátorstvo
    // pamäte sa súborov projektu nedotýka — a `read_file`/`PathGuard` je najväčšia
    // riziková plocha, ktorú netreba vystavovať behu, ktorý ju nepotrebuje.
    'memory' => [
        MindRecallTool::class, MindReadTool::class, MindOverviewTool::class,
        MindLearnTool::class, MindRenameTool::class, MindMoveTool::class, MindDeleteTool::class,
    ],

    // Súbory + JEDEN čítací tool pamäte. `mind_recall` tu JE zámerne: smernica
    // (`SystemPrompt::build()`) modelu prikazuje „nič si nedomýšľaj, zisti to toolom",
    // a konvencie tohto projektu žijú v pamäti. Profil bez recallu by model nútil
    // buď si ich vymyslieť, alebo odmietnuť odpovedať. Cena je 292 tokenov.
    'files' => [
        MindRecallTool::class,
        GrepTool::class, GlobTool::class, ReadFileTool::class,
        EditFileTool::class, WriteFileTool::class,
    ],

    // Dok nad plátnom. Čítanie pamäte + navigácia grafu + `mind_learn`.
    // `mind_learn` tu MUSÍ byť: bez zápisového toolu by sa dvojfázová brána v doku
    // nedala ani spustiť, teda ani overiť (kritérium §5/9), a „zapamätaj si toto"
    // nad vybraným uzlom je presne to, čo mŕtva `renderSuggestCard()` v `chat.js`
    // robila mimo brány, cez `POST /api/nodes`.
    // Súborové tooly tu NIE SÚ: dok je nad grafom, nie nad repozitárom.
    'graph' => [
        MindRecallTool::class, MindReadTool::class, MindOverviewTool::class,
        GraphFocusTool::class,
        MindLearnTool::class,
    ],

    // Plná konzola (/console). Dnešná dvanástka, znak po znaku.
    // `graph_focus` tu NIE JE — pozri §1.3.
    'full' => [
        MindRecallTool::class, MindReadTool::class, MindOverviewTool::class,
        GrepTool::class, GlobTool::class, ReadFileTool::class,
        MindLearnTool::class, MindRenameTool::class, MindMoveTool::class,
        MindDeleteTool::class, EditFileTool::class, WriteFileTool::class,
    ],
];
```

Poradie v každom profile drží pravidlo z `ToolRegistry`ho docblocku
(`app/Services/Console/ToolRegistry.php:35–37`): **čítanie vpredu, zápis vzadu**, pretože
slabý model siaha na to, čo je vyššie. `graph_focus` je čítací a stojí pred `mind_learn`.

### Zmerané ceny profilov

| profil | tooly | znaky | ≈ tokenov (znaky/4) | strop v teste |
|---|---:|---:|---:|---:|
| `memory` | 7 | 6114 | **1 529** | 1 600 |
| `files` | 6 | 5217 | **1 304** | 1 400 |
| `graph` | 5 | 4982 | **1 246** | 1 350 |
| `full` | 12 | 10163 | **2 541** | 2 600 |

Znaky profilu = súčet znakov definícií + (počet toolov + 1) za `[`, `]` a čiarky.
Overiteľné súčtom z tabuľky v §1.1 plus 965 znakov za `graph_focus` (§1.3).

## 1.3 `graph_focus` — trinásty tool, ktorý nie je v `full`

**Zmerané:** 965 znakov = **241 tokenov**. (Presná definícia je v §2.4; merané tým istým
`json_encode(..., JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)`.)

Prečo NIE v `full`:

1. **Vecný dôvod.** Efekt `graph_focus` je klientský — filter nad plátnom. `/console` je
   samostatná plocha **bez plátna**. Tool by tam uzol vyriešil a klient by ho nemal kam
   zaostriť: model by hlásil úspech nad akciou, ktorá sa nestala. Dostupnosť toolu má
   sledovať plochu, ktorá jeho efekt vie vykonať.
2. **Číselný dôvod.** `full` + `graph_focus` = 2 541 + 241 = **2 782 tok**, teda nad
   kritériom §5/8 („≤ dnešných ~2,6k"). Keby sa `graph_focus` do `full` pridal, kritérium
   by bolo nesplniteľné bez skracovania popisov iných toolov — teda bez zhoršenia toho,
   čo popisy robia.

**Dôsledok, ktorý sa nesmie prehliadnuť: `PROFILES['full'] ≠ TOOLS`.** `TOOLS` je kánon
toho, čo **existuje** (13); `PROFILES` je kánon toho, čo sa **vystavuje**. Dva existujúce
testy sa preto musia opraviť — presne a nič viac (§1.9).

## 1.4 Kde sa profil vyberá a kto rozhoduje pri neznámom

**Oboje, ale nie rovnocenne.**

- **Config = default.** `config/hades.php` → `console.profile`:
  ```php
  // Ktorý profil nástrojov dostane beh, keď si klient žiadny nevyžiada.
  // `full` je dnešná dvanástka, teda default je BEZ zmeny chovania konzoly.
  'profile' => env('HADES_CONSOLE_PROFILE', 'full'),
  ```
  Členstvo profilov v configu **nie je** (§1.2).
- **Klient = požiadavka na `/run`.** `POST /api/console/run` prijme voliteľné pole
  `profile`. Validácia sa skladá z `ToolRegistry::PROFILES` kľúčov, presne tak, ako sa
  dnes skladá zoznam poskytovateľov z `$providers->names()`
  (`app/Http/Controllers/Console/RunController.php:77`):
  ```php
  'profile' => 'sometimes|nullable|string|in:'.implode(',', array_keys(ToolRegistry::PROFILES)),
  ```
  a hláška do `RunController::MESSAGES`:
  ```php
  'profile.in' => 'Taký profil nástrojov tu nie je.',
  'profile.string' => 'Meno profilu nástrojov nemá platný tvar.',
  ```

**Neznámy profil sa ODMIETNE.** Nie fallback na `full`, nie fallback na config, nie
„najbližší podobný". Duch je ten istý ako v `Tools/PathGuard` — *cesty sa odmietajú,
nesanitizujú*, pretože sanitizovaná cesta ticho zapíše niekam inam. Tu je to úplne
symetrické:

- fallback na `full` = beh dostane **viac** toolov (vrátane zápisových), než volajúci
  žiadal — teda tichý únik oprávnenia;
- fallback na `memory`/config = beh dostane **menej**, model povie „taký nástroj nemám"
  a človek bude hľadať chybu v modeli, nie v preklepe;
- odmietnutie = jediná možnosť, ktorá **nevie zalhať**.

Odmietnutie ide cez už existujúci `RunController::refuse()` — teda **422 s NDJSON rámcom
`error`**, ten istý tvar ako každé iné odmietnutie behu
(`app/Http/Controllers/Console/RunController.php:253–264`). Klient nemá druhú cestu na
spracovanie a `run.js` ten text už vypisuje (`refusalText()`, `run.js:218–247`).

**Dôležité: pri odmietnutí nesmie vzniknúť riadok v `runs`.** Validácia beží PRED
`$recorder->openExclusive()` (dnes je tak zoradený aj celý `run()`), takže to platí samo
— ale test to musí pripnúť, inak by preklep v profile plnil log fantómovými behmi.

## 1.5 Ako sa profil dostane do behu bez zásahu do `AgentRunner`

`AgentRunner::drive()` si definície berie z injektovaného registra
(`app/Services/Console/AgentRunner.php:195`: `$tools = $this->registry->definitions();`).
Register dostáva konštruktorom (`AgentRunner.php:73`). Preto:

1. **`ToolRegistry` sa zaregistruje ako singleton** v `app/Providers/AppServiceProvider.php`:
   ```php
   $this->app->singleton(ToolRegistry::class);
   ```
   Bez toho by `RunController` a `AgentRunner` dostali **dva rôzne objekty** a nastavenie
   profilu na jednom by na druhý nemalo vplyv — chyba, ktorá by sa neprejavila chybou,
   ale tým, že profil nefunguje a nikto nevie prečo.

   Existujúce testy, ktoré si register podstrkávajú
   (`tests/Feature/ConsoleRunTest.php:525`, `tests/Feature/RunLogTest.php:583`,
   `$this->app->instance(ToolRegistry::class, new ToolRegistry([...]))`), so singletonom
   fungujú bez zmeny — `instance()` prebije binding.

   Poznámka o životnosti: `useProfile()` je stav **v rámci jedného requestu**; kontejner
   sa medzi requestami stavia nanovo. Projekt nebeží na Octane, takže presah nie je možný.
   Keby niekto Octane pridal, tento riadok je prvé, čo sa musí prehodnotiť — patrí to do
   docblocku.

2. **`RunController::run()`** nastaví profil pred spustením behu:
   ```php
   $profile = $data['profile'] ?? (string) config('hades.console.profile', 'full');
   $tools->useProfile($profile);      // ToolRegistry injektovaný do metódy
   $thread->tool_profile = $profile;  // AgentRunner::run() vlákno aj tak ukládá
   ```
   `$thread->save()` už robí `AgentRunner::run()` (`AgentRunner.php:99`), takže sa
   perzistuje bez ďalšieho zápisu a **bez zmeny `AgentRunner`u**. To je zámerne to isté
   miesto, kde už dnes „prilepený" atribút prežije — `rememberChoice()` píše `provider`
   a `model` na tú istú instanciu.

3. **`RunController::decide()`** profil **z requestu neprijíma**:
   ```php
   // O profile sa rozhoduje pri spustení behu. Keby ho `/decide` prijalo, dal by sa
   // zaparkovaný `write_file` dorozhodnúť v profile, ktorý ho nemá (alebo naopak) —
   // teda vymeniť sadu toolov medzi vyžiadaním povolenia a jeho vykonaním.
   'profile' => 'prohibited',
   ```
   s hláškou `'profile.prohibited' => 'O profile nástrojov sa rozhoduje pri spustení behu.'`,
   a profil sa čítá z vlákna:
   ```php
   $tools->useProfile((string) ($thread->tool_profile ?: config('hades.console.profile', 'full')));
   ```

**`AgentRunner.php` sa v celom diffe profilov NEMENÍ.** Je to tá istá disciplína, ktorú
si vynútil `RunRecorder` (`app/Services/Console/RunRecorder.php:13–18`) a ktorá sa ukázala
ako lepší návrh, nie len ako ústupok.

## 1.6 `ToolRegistry` — tvar zmeny

Filtrovanie musí zasiahnuť **advertising aj vykonanie**. Keby profil filtroval len
`definitions()`, model, ktorý si `write_file` pamätá z histórie toho istého vlákna
(história sa skladá z DB a nesie staré `tool_calls`), by ho zavolal a tool by sa
**vykonal** — profil by bol kozmetika.

```php
class ToolRegistry
{
    public const TOOLS = [ /* 13 tried: dnešných 12 + GraphFocusTool */ ];
    public const PROFILES = [ /* §1.2 */ ];

    /** @var array<string, ConsoleTool> celý kánon, meno → tool */
    protected array $all = [];
    /** @var array<string, ConsoleTool> aktívna podmnožina podľa profilu */
    protected array $tools = [];
    protected ?string $profile = null;
    /** Bol register postavený z kánonu, alebo mu sadu podstrčil test? */
    protected bool $canon;

    public function __construct(?array $tools = null)
    {
        $this->canon = $tools === null;
        foreach ($tools ?? array_map(fn (string $c) => app($c), self::TOOLS) as $tool) {
            $this->all[$tool->name()] = $tool;
        }
        $this->tools = $this->all;
        if ($this->canon) {
            $this->useProfile((string) config('hades.console.profile', 'full'));
        }
    }

    /**
     * @throws \InvalidArgumentException neznámy profil — ODMIETNUTIE, nie fallback
     */
    public function useProfile(string $profile): void
    {
        if (! isset(self::PROFILES[$profile])) {
            throw new \InvalidArgumentException(
                "Unknown tool profile `{$profile}`. Available: ".implode(', ', array_keys(self::PROFILES)).'.'
            );
        }

        $this->profile = $profile;

        // Podstrčená sada (testy fake toolov) sa NEFILTRUJE. Filtrovanie kánonom by ju
        // vyprázdnilo a ConsoleRunTest by ostal zelený bez toho, aby čokoľvek merel —
        // presne tá pasca, na ktorú tento projekt raz naletel (ScreenParityTest, 4. vrstva).
        if (! $this->canon) {
            return;
        }

        $keep = self::PROFILES[$profile];
        $this->tools = array_filter($this->all, fn (ConsoleTool $t) => in_array($t::class, $keep, true));
    }

    public function activeProfile(): ?string { return $this->profile; }

    /** Celý kánon bez ohľadu na profil — pre testy tvaru a pre /console HTML? NIE, viď §1.9. */
    public function allNames(): array { return array_keys($this->all); }
}
```

`definitions()`, `names()`, `has()`, `get()`, `isWrite()`, `preview()`, `call()` čítajú
`$this->tools` — teda **aktívnu podmnožinu**. Nič iné sa v nich nemení.

### Prečo je to fail-closed už dnešnou štruktúrou

Keď model zavolá tool mimo profilu, `AgentRunner::drain()` vyhodnotí
(`AgentRunner.php:348`):
```php
$write = $this->registry->has($call->name) && $this->registry->isWrite($call->name);
```
`has()` = `false` → `$write = false` → **ťah sa nezaparkuje** (správne: nie je čo
povoľovať) → `executeCall()` → `registry->call()` → `get()` hodí `ToolRefusal` →
`ToolResult::refused('Unknown tool `write_file`. Available tools: …')`. Nič sa nezapíše,
model dostane zoznam toho, čo má, a pokračuje. Toto chovanie je **existujúce a testované**
(`tests/Feature/ConsoleRunTest.php:132` `test_unknown_tool_is_refused_instead_of_asking_for_permission`)
— profil ho len rozšíri na tooly, ktoré existujú, ale nie sú vystavené.

## 1.7 Zápis profilu do logu behov

Aby log vedel povedať, **s čím** beh bežal:

**Migrácia** `database/migrations/2026_08_21_000001_add_tool_profile_to_console_threads_and_runs.php`:
```php
Schema::table('console_threads', fn (Blueprint $t) => $t->string('tool_profile', 32)->nullable()->after('model'));
Schema::table('runs',            fn (Blueprint $t) => $t->string('tool_profile', 32)->nullable()->after('model'));
```
`nullable` a **nie** `default('full')`: `null` znamená „beh z čias pred profilmi" a to je
pravdivá informácia, kým `'full'` by o starých behoch tvrdil niečo, čo nikto nezaznamenal.
`string(32)`, nie `enum` — z toho istého dôvodu, aký je napísaný pri `runs.source`
(`database/migrations/2026_08_19_000003_create_runs_table.php`): enum by si vyžiadal
migráciu na každý nový profil.

**Modely:**
- `app/Models/ConsoleThread.php:18` → do `$fillable` pridať `'tool_profile'`.
- `app/Models/Run.php:31–35` → do `$fillable` pridať `'tool_profile'`.

**`RunRecorder::open()`** (`app/Services/Console/RunRecorder.php:78–87`) — jeden riadok
vedľa `provider`/`model`, presne tou istou cestou z `$options`:
```php
'tool_profile' => $options['profile'] ?? $thread->tool_profile,
```
a `RunController` pridá `'profile' => $profile` do `$options` (`RunController.php:99`).
`RunRecorder::resume()` profil neprepisuje — segment druhého ťahu beží na tom istom
profile, čo je práve to, čo §1.4 vynucuje.

**Dvojitá plocha (UI = MCP).** Pravidlo z CLAUDE.md („dátové veci na server") platí:
`tool_profile` je dáta, nie slovo.
- `app/Serializers/Screen/RunsScreen.php` → `row()` pridá `'tool_profile' => $run->tool_profile`,
  a `fieldsForAi()` (`:80–89`) pridá `'items[].tool_profile'`.
- `app/Serializers/Screen/RunDetailScreen.php` → to isté, `fieldsForAi()` (`:54–64`)
  pridá `'tool_profile'`.
- **Do `fieldsForAi()` to patrí**, nie len do UI: „s akými nástrojmi tento beh bežal" je
  presne tá otázka, na ktorú má `mind_runs` odpovedať. Bez toho by sa plochy rozišli
  v údaji, ktorý vysvetľuje, prečo beh niečo nedokázal.
- `ScreenParityTest::registry()` **netreba menieť** — `runy` aj `run-detail` v ňom už sú.
  Test si paritu vynúti sám; ak sa `fieldsForAi()` zabudne, padne.
- `public/js/mind/screens/runy.js` — `tool_profile` do riadku behu (vedľa `.run-model`,
  `runy.js:212`) ako `<span class="run-profile">`. Filter podľa profilu **nerobiť** —
  `data()` už má filtre `status`/`model`/`source` a štvrtý filter je nová funkcia bez
  vyžiadania; patrí to do §9 otvorených bodov.

## 1.8 Test kritéria §5/8 — čo presne meria a na akom čísle padne

`tests/Feature/ConsoleToolsTest.php`, nová sekcia **9. profily nástrojov**:

```php
/**
 * Kritérium §5/8 kontraktu: definície na profil nesmú prerásť dnešných ~2,6k tokenov.
 *
 * Meria sa PRESNE to, čo ide do requestu: `json_encode(definitions())` s tými istými
 * flagmi, aké používa jazyková vrstva, delené 4. Nie počet toolov, nie dĺžka popisov
 * — tie sa dajú obísť. Znaky, nie bajty: popisy sú anglické, ale nesú `—`, ktorý má
 * 3 bajty a jeden token, takže `strlen()` by profil zbytočne obviňovala.
 *
 * Stropy nie sú jedno globálne číslo. Každý profil má vlastný, pretože globálny strop
 * 2600 by dovolil, aby `graph` (1246) narástol na dvojnásobok bez toho, aby to test
 * zbadal — a práve `graph` beží v doku vedľa plátna, kde je kontext najdrahší.
 */
public function test_tool_definitions_stay_inside_the_budget_of_every_profile(): void
{
    $caps = ['memory' => 1600, 'files' => 1400, 'graph' => 1350, 'full' => 2600];

    // Nový profil bez stropu neprejde — inak by sa strop dal obísť tým, že
    // sa tool pridá do profilu, o ktorom tento test nevie.
    $this->assertSame(array_keys(ToolRegistry::PROFILES), array_keys($caps));

    foreach ($caps as $profile => $cap) {
        $registry = app(ToolRegistry::class);
        $registry->useProfile($profile);

        $json = json_encode(
            $registry->definitions(),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );

        $tokens = (int) ceil(mb_strlen((string) $json) / 4);

        $this->assertLessThanOrEqual($cap, $tokens, "profil {$profile}: {$tokens} tok > {$cap}");
    }
}
```

**Zmerané hodnoty a čísla, na ktorých test padá:**

| profil | dnes | strop | padne od |
|---|---:|---:|---:|
| `memory` | 1 529 | 1 600 | 1 601 tok = 6 401 znakov |
| `files` | 1 304 | 1 400 | 1 401 tok = 5 601 znakov |
| `graph` | 1 246 | 1 350 | 1 351 tok = 5 401 znakov |
| `full` | 2 541 | 2 600 | 2 601 tok = 10 401 znakov |

Rezerva vo `full` je **237 znakov**, teda približne jedna stredná `description` veta
alebo jedna nová vlastnosť schémy. To je zámerne úzke: kontrakt hovorí „≤ dnešných
~2,6k", nie „nech je kam rásť".

**Povinná kalibrácia (bez nej test nič nedokazuje).** Implementačný agent MUSÍ ukázať,
že test padá, a v reporte to napísať:

1. **Známy záporný prípad:** do `MindRecallTool::description()` dočasne pripojiť 300
   znakov výplne → `full` vyskočí na **2 616 tok** a test padne s hláškou
   `profil full: 2616 tok > 2600`. Vrátiť.
2. **Známy kladný prípad:** bez zmeny prejde a hodnoty sedia s tabuľkou vyššie.

Ak agent kalibráciu nespustí, číslo v teste je nedokázané tvrdenie — presne to, čo
CLAUDE.md pri harnessoch zakazuje („Harness si vždy skalibruj na známom stave").

## 1.9 Dve existujúce asercie, ktoré sa MUSIA opraviť (a nič viac)

Pretože `PROFILES['full'] ≠ TOOLS` (§1.3), dva testy dnes merajú aktívnu podmnožinu tam,
kde majú merať kánon. Opraviť ich treba **smerom ku kánonu**, nie oslabením:

1. `tests/Feature/ConsoleToolsTest.php:104` `test_read_tools_run_without_asking_and_write_tools_do_not`
   — používa `$this->registry()` = `app(ToolRegistry::class)`, ktorý má aktívny default
   profil `full`, teda **bez `graph_focus`**. `isWrite('graph_focus')` by vrátil `true`
   (fail-closed pre neznáme meno) a test by padol na správnom mieste zo zlého dôvodu.
   Riešenie: pridať do triedy pomocníka
   ```php
   /** Register BEZ profilového filtra — kánon všetkých 13 toolov. */
   private function canon(): ToolRegistry
   {
       return new ToolRegistry(array_map(fn (string $c) => app($c), ToolRegistry::TOOLS));
   }
   ```
   a tento jeden test postaviť na `canon()`. Zoznam čítacích toolov sa rozšíri o
   `'graph_focus'`, zápisových nie, a pripnutý `assertSame([...])` (`:120`) o `graph_focus`.
2. `tests/Feature/ConsoleToolsTest.php:672` `test_registry_exposes_definitions_in_the_shape_the_llm_layer_expects`
   — `assertCount(count(ToolRegistry::TOOLS), $definitions)` bude 13 vs 12. Tvar je
   vlastnosť **každého** toolu, nie profilu → postaviť ho tiež na `canon()`.
3. `tests/Feature/ConsoleToolsTest.php:721` `test_read_tools_have_no_preview` — pridať
   `'graph_focus'` do zoznamu a postaviť na `canon()`.

**Čo sa NEMENÍ:** `routes/web.php:22–29` (`$console` closure vypisuje `$tools->names()`
do HTML pre prázdny stav konzoly). Default profil je `full`, takže `/console` vypíše tú
istú dvanástku ako dnes, `graph_focus` sa tam neobjaví, a to je správne — konzola ho
vykonať nevie. **Keby niekto zmenil `HADES_CONSOLE_PROFILE`, prázdny stav konzoly by
hovoril pravdu automaticky** (register je jediný zdroj členstva). Je to vlastnosť, nie
náhoda; napísať to do komentára.

## 1.10 Bezpečnosť — ako testy dokážu, že profil NIE JE obchádzka brány

Toto je časť, ktorú si prečíta bezpečnostná prehliadka. Testy patria do
`tests/Feature/ConsoleToolsTest.php` (toolová vrstva) a `tests/Feature/ConsoleRunTest.php`
(smyčka a endpointy), aby sedeli tam, kde je zvyšok tej istej ochrany.

| # | Test | Čo dokazuje | Padá keď |
|---|---|---|---|
| **B1** | `test_a_tool_outside_the_profile_is_refused_and_writes_nothing` — `useProfile('memory')`, potom `call('write_file', ['path'=>'x.txt','content'=>'y'])` → `ToolResult::failed === true`, text obsahuje `Unknown tool`, **a `File::exists($root.'/x.txt') === false`** | Profil filtruje **vykonanie**, nie len ponuku | Filtruje sa len `definitions()` |
| **B2** | `test_profile_never_turns_a_write_tool_into_a_read_tool` — pre KAŽDÝ profil a každý jeho tool: `isWrite($name)` sa rovná `$tool->isWrite()` | Profil nemení stranu toolu | Niekto by „optimalizoval" bránu pre malý profil |
| **B3** | `test_every_write_tool_in_every_profile_still_has_a_preview` — pre každý zápisový tool v každom profile `preview()` vráti neprázdny string (alebo `ToolRefusal` s dôvodom), nie `null` | Brána má čo človeku ukázať v každom profile | Nový profil pustí zápisový tool bez náhľadu |
| **B4** | `test_unknown_profile_is_refused_not_substituted` — `useProfile('bash')` hodí `InvalidArgumentException`; `POST /api/console/run` s `profile=bash` → **422**, telo je NDJSON rámec `error`, **a `Run::count() === 0`** | Odmietnutie, nie sanitizácia; a žiadny fantómový beh v logu | Fallback na `full`/config |
| **B5** | `test_decide_refuses_a_profile_in_the_request` — beh zaparkuje na `write_file` v `full`; `POST /api/console/decide` s `profile=graph` → **422**, **a tool call zostáva `pending`** | Sada toolov sa nedá vymeniť medzi vyžiadaním povolenia a jeho vykonaním | `/decide` by `profile` prijal |
| **B6** | `test_a_parked_write_resumes_on_the_profile_the_run_started_with` — `/run` s `profile=full` zaparkuje `write_file`; `/decide` (bez `profile`) ho **vykoná** | Profil pre obnovu sa čítá zo servera (`console_threads.tool_profile`), nie z klienta | Profil by sa pri obnove stratil a povolený zápis by sa zmenil na odmietnutie |
| **B7** | `test_the_graph_profile_still_parks_a_write` — fake beh s `profile=graph` a `mind_learn` → prúd obsahuje rámec `permission` a **NEobsahuje `end`** | Kritérium §5/9 pre profil doku | Malý profil by bránu obišiel |
| **B8** | `test_full_profile_is_exactly_todays_twelve` — `assertSame` pripnutý zoznam 12 mien | `full` nemôže tichom narásť ani sa zmenšiť | Niekto pridá 13. tool do `full` |
| **B9** | `test_every_profile_is_a_subset_of_the_canon` a `test_every_tool_belongs_to_at_least_one_profile` — `⊆ TOOLS` a `⋃ PROFILES == TOOLS` | Profil nemôže prepašovať triedu mimo kánonu (ktorú `test_read_tools…` nekontroluje), a žiadny tool nemôže existovať nedosiahnuteľný a neotestovaný | Profil s cudzou triedou / osirelý tool |

**Zhrnutie bezpečnostného argumentu jednou vetou:** profil **iba odoberá** — nikdy
nepridáva tool, nikdy neprepína `isWrite()`, nikdy neobchádza `preview()`, a jediné
miesto, kde sa mení, je `POST /run` pred založením behu. Zápis bez kliknutia človeka
teda nemôže vzniknúť **ani v tom najmenšom profile**, a B1 + B7 to merajú z oboch strán
(tool mimo profilu sa nevykoná; tool v profile sa zaparkuje).

**Čo sa NEROBÍ (kontrakt §4):** žiadny `bash`/`shell` tool v žiadnom profile. B9
(`⋃ PROFILES == TOOLS`) to nevynúti sama — vynucuje to `TOOLS` a `ConsoleToolsTest`
menovitý zoznam. Napísať do docblocku `PROFILES`, aby to bolo pri tom zozname vidieť.

---

# ČASŤ 2 — DOK CHARÓNA NAD GRAFOM

## 2.0 Východiskový stav — čo je naozaj v kóde (a čo audit hlási zle)

| Tvrdenie auditu / zadania | Zmerané dnes |
|---|---|
| `chat.js` má 398 riadkov | **261 riadkov** (10 561 B). Číslo 398 je z `docs/audit/03-ia-flows.md:276` a je zastaralé; nespoliehať sa naň pri odhade práce. |
| `panels.js` má väzby na `#chat-context` | **Nemá žiadne.** `grep -n "chat\|ctx\|context" public/js/mind/panels.js` vráti len `getContext('2d')` (`:607`). Väzby boli odstránené skôr. |
| Kontext chatu má v UI producenta | **Nemá.** `addToChatContext()` (`chat.js:27`) nevolá **nikto**. `S.chatContext` sa dnes plní **iba** z `localStorage` (`chat.js:18–21`), takže mechanizmus je z polovice mŕtvy: čipy sa vedia zobraziť a odobrať, ale pridať sa nedá. |

**Skutočné väzby `chat.js` na zvyšok grafu sú presne dve:**
- `public/js/mind/main.js:7` → `import { setupPrompt } from './chat.js';`, volané na `main.js:79`
- `public/js/mind/shortcuts.js:4` → `import { collapsePrompt } from './chat.js';`, volané na `shortcuts.js:129`

To je celý „graf väzieb". Riziko z kontraktu §6 („odstránenie `chat.js` má väzby
v `panels.js`") je teda **menšie, než kontrakt predpokladá** — ale poradie z §6 platí
ďalej, pretože riziko nie je v importoch, ale v tom, že by sa zmazala jediná
konverzačná plocha nad grafom pred tým, než ju druhá nahradí.

## 2.1 Zdieľané moduly — čo sa extrahuje, kam, a čo NIE

Nový priečinok **`public/js/shared/`**. Pravidlo z CLAUDE.md platí v ňom bez výnimky:
**všetko sa exportuje ako hoistovaná `export function`, nikdy `export const foo = () => {}`.**
Cykly v tomto grafe sú nevyhnutné a arrow v `const` pri cykle spadne na
`ReferenceError: Cannot access 'foo' before initialization`.

### `public/js/shared/ndjson.js` (nový, ~70 r., **nič neimportuje**)

Prenesené z `public/js/console/run.js` — čistý transport, bez jediného DOM dotyku:

| nová funkcia | zdroj | pozn. |
|---|---|---|
| `export async function readNdjson(reader, onFrame)` | `run.js:257–284` (`consume()`) | drží `buffer` (objekt sa môže rozdeliť medzi chunky) aj `TextDecoder({stream:true})` (rozdelený viacbajtový znak). Vracia `true`, keď niektorý `onFrame` vrátil truthy. |
| `export function parseNdjsonLine(line)` | `run.js:287–304` (`handleLine()`) | vracia `{ frame }` alebo `{ error: 'Nečitateľný rámec z behu (preskočený).' }` — **bez** `pushError()`, hlásenie patrí volajúcemu |
| `export function firstErrorMessage(text, fallback)` | `run.js:229–246` (telo `refusalText()`) | hľadá prvý rámec `t === 'error'` v NDJSON tele; `res.text()` a status si rieši volajúci |

Prečo bez importov: modul sa tým nemôže stať súčasťou žiadneho cyklu, presne ako to má
dnes `public/js/console/runstate.js` (`runstate.js:57`).

### `public/js/shared/runstate.js` (**presun** `public/js/console/runstate.js`, obsah nezmenený)

`cleanStop()`, `stopNote()`, `runNote()`, `costLabel()`. Dôvod presunu: dok musí povedať
tie isté vety ako konzola aj ako log behov, a tretia kópia „ako sa beh skončil" je presne
ten rozpor, kvôli ktorému tento modul vznikol (`runstate.js:47–58`).

Importujúci na prepnutie: `public/js/console/run.js:26`, `public/js/console/render.js`
(`runNote`, `costLabel`). **Presun, nie shim** — `console/runstate.js` sa zmaže; súbor,
ktorý len re-exportuje, by bol štvrtá kópia adresára.

### `public/js/shared/runclient.js` (nový, ~200 r.)

Jediná implementácia dvojfázového protokolu. Nahrádza z `console/run.js` funkcie
`stream()` (`:146–208`), `refusalText()` (`:218–247`), `consume()`, `handleLine()`,
`dispatch()` (`:311–317`), `route()` (`:319–395`).

```js
/**
 * Klient jedného behu. Vracia objekt uzáverov, nie triedu — a `createRunClient`
 * je hoistovaná `export function`, takže sa smie objaviť v cykle.
 *
 * `state` je vrecko stavu, ktoré si drží volajúci (konzola má `C`, dok má `D`).
 * Kľúče sú súčasťou kontraktu: running, sending, abort, awaiting, step, stats, t0.
 * Prečo nie stav v module: dok a konzola sú dve inštancie tej istej mechaniky, nie
 * dve kópie — a modulový stav by z nich urobil singleton.
 *
 * `view` sú spätné volania; každé smie chýbať.
 */
export function createRunClient({ request, state, view }) { … }
```

Vracia:
| metóda | robí |
|---|---|
| `startRun(body)` | `POST /api/console/run` + prúd |
| `resumeDecision(body)` | `POST /api/console/decide` + prúd |
| `stop()` | `state.abort.abort()` (`run.js:136–142`) |

`view` (mená sedia na rámce protokolu):
`onStart(frame)`, `onDelta(text)`, `onStep(frame)`, `onTool(frame)`,
`onToolResult(frame, name)`, `onPermission(frame)`, `onEnd(frame)`, `onError(text)`,
`onNotice(text)`, `onThreadState(frame)`, `onRunningChange(on, parked)`, `onSettled()`.

**Jedno vylepšenie proti dnešku, ktoré potrebuje dok:** klient si drží
`Map<id, name>` z rámcov `tool` a do `onToolResult` posiela **aj meno nástroja**. Dnes
`tool_result` meno nenesie a `tools.js:125` ho dohľadáva v DOM-e podľa `data-id`
(`markResult()`), s tromi vetvami vrátane „orphan" (`tools.js:161–170`). Dok potrebuje
meno na rozhodnutie „toto je výsledok `graph_focus`, aplikuj ho na plátno" a čítať ho
z DOM by bola tretia cesta k tej istej informácii.

**Čo do `runclient.js` NEPATRÍ** (a musí zostať vo view vrstve každej plochy):
`$('#prompt')`, `$('#send')`, `$('#stop')`, `$('#composer')` zo `setRunning()`
(`run.js:459–476`) a `sendTurn()` (`run.js:79–84`). Sú to konkrétne id konkrétnej
stránky — a `#prompt` je v tomto repozitári **obsadené dvakrát v dvoch významoch**:
`resources/views/console.blade.php:119` je `<textarea>`, `resources/views/mind.blade.php:432`
je `<div>` obal celej lišty. Zdieľaný modul, ktorý by na `#prompt` siahol, by na jednej
z dvoch stránok robil niečo iné.

### `public/js/shared/gate.js` (nový, ~120 r.)

Slovník dvojfázovej brány — to, čo musí dok povedať **rovnako** ako konzola:

| funkcia | zdroj |
|---|---|
| `export function writeAsk(frame)` | `console/tools.js:443–456` — veta, ktorá hlási ZÁPIS, nie nástroj (P-nález) |
| `export function decisionLabel(decision)` | `console/tools.js:429–441` (`DECISION_LABEL`) |
| `export function argsSummary(args)` + `scalar()` | `console/tools.js:65–94` |
| `export function looksLikeDiff(text)` | `console/tools.js:313–319` |
| `export function diffHtml(text)` | `console/tools.js:321–337` |
| `export function iconFor(name)` + `ICONS` | `console/tools.js:27–63` |

**Čo v `gate.js` NIE JE:** `toolCard()`, `permissionCard()`, `historyCard()`,
`markResult()`, `fillResult()`, `decide()` (`console/tools.js:96–508`). Tie skladajú DOM
s triedami `console.css` a dok je na `mind.css`. Pozri §2.7 — je to otázka CSS, nie JS.

### `public/js/shared/markdown.js` (**presun** `public/js/console/markdown.js`, obsah nezmenený)

`escapeHtml()`, `renderMarkdown()`. Dok musí vykresliť odpoveď modelu (bloky kódu,
odrážky) a tento renderer je na to napísaný.

**Neunifikovať s `public/js/mind/md.js` (`mdToHtml`) ani s `mdToHtml` v
`public/js/mind/util.js:392`.** Sú to iné úlohy — dokument uzla a náhľad v 300 px paneli
— a zlúčenie troch rendererov je samostatná úloha mimo tohto šprintu. Napísať to do
hlavičky súboru, aby to niekto „pri tom" neurobil.

### Čo sa NEEXTRAHUJE, hoci to vyzerá ako duplikát

- **`public/js/console/http.js` × `public/js/mind/http.js`.** Nie sú to dve kópie jednej
  veci: `mind/http.js` je **globálny obal `window.fetch`** (`installFetchGuard()`,
  volaný ako prvý v `main.js`), `console/http.js` je **explicitný `request()`** s
  hlásením do toku správ. Rozdiel je zdôvodnený v `console/http.js:132–140`. Dok teda
  nepotrebuje ani jeden nový modul: na stránke grafu je `installFetchGuard()` už
  nasadený, takže dok si `request` pre `createRunClient` postaví ako 6-riadkový obal nad
  `fetch` (CSRF pridá guard) a hlásenie 401/419 pošle do svojho toku.
- **`console/render.js` celý.** Je to view vrstva pre `#stream` a `console.css`.

## 2.2 Dok — súbory, id, prefix

**`#dock` je obsadené.** `resources/views/mind.blade.php:221` je `<aside id="dock">`
(bočný panel Legenda / Štatistiky, `public/js/mind/dock.js`, `openDock('legend')`).
Meno „dok" v kontrakte je slovo pre človeka; identifikátor musí byť iný.

| vec | názov | dôvod |
|---|---|---|
| modul | `public/js/mind/charon.js` | plocha sa menuje Charón (CLAUDE.md: meno pre človeka, technické veci zostávajú `console.*`) — tu je to ale **nový** artefakt, takže smie nesť meno |
| obal | `#charon` | `#dock` obsadené |
| tok správ | `#charon-stream` | |
| composer | `#charon-form`, `#charon-input`, `#charon-send`, `#charon-stop` | `#prompt` / `#send` / `#stop` obsadené na `/console` |
| čipy kontextu | `#charon-ctx` | `#chat-context` zmizne s `chat.js` |
| hlásenie pre čítačku | `#charon-announce` (`.sr-only`, `aria-live="polite"`) | |
| prepínač v hlavičke | `#charon-toggle` | |
| CSS prefix | **`.charon-`** | `.ch-` je obsadené (`console.css:370, 398, 1062`), `.tc-` je obsadené **v dvoch významoch** (`console.css` = tool call, 19×; `mind.css:553, 3043, 3047` = `.tc-val`/`.tc-label`, tabulárne číslo). Keby dok priniesol do `mind.css` markup s `.tc-*`, `.tc-label` by mu prefarbil názov nástroja. |

## 2.3 Kontext vybraných uzlov — mechanizmus a strop

### Producent (dnes chýba, treba ho vytvoriť)

1. **Panel uzla.** `resources/views/mind.blade.php:388–394` (`.row.node-actions`) — nové
   tlačidlo vedľa `#node-pack`:
   ```html
   <button id="node-charon" class="ghost ms" title="Priložiť do rozhovoru"
           aria-label="Priložiť do rozhovoru" aria-pressed="false">hub</button>
   ```
   Ikona **`hub`** — zmeraná ako prítomná v subsete (18 px,
   `docs/sprint-2026-08-21/BASELINE-MERANIA.md` §1). **Nepoužiť `forum`** (zmerané 100 px
   = v subsete NIE JE) ani inú novú ikonu bez regenerácie subsetu.
2. **Balík pre Claude Code.** Dok dostane jedno tlačidlo „Priložiť balík (N)", ktoré
   skopíruje `S.pack` (`public/js/mind/pack.js`) do kontextu doku. `packBtn()` sa
   **nemaže** (`docs/audit/03-ia-flows.md` §NEROBIŤ bod 4) a `S.pack` zostáva vlastný
   stav — dok ho **čítá ako ponuku**, nezlučuje sa s ním. Tým sa A8 zmenší z troch
   paralelných mechanizmov na dva prepojené, bez toho, aby sa čokoľvek zmazalo.

### Stav a čipy

`S.charonCtx = new Set()` v `public/js/mind/state.js` (vedľa `S.pack`), perzistencia
`localStorage['hades.charonCtx']` — presne mechanika `chat.js:16–37`, len pod novým
kľúčom. Starý kľúč `hades.chatContext` **nemigrovať**: dnes ho nemal ako niekto naplniť
(§2.0), takže by sa migrovala prázdna množina.

Čipy: HTML zostáva `.ctx-chip` / `.ctx-label` / `.ctx-x` / `.ctx-clear`
(`public/css/mind.css:1710–1763`) — CSS je hotové a dobré, mení sa len selektor obalu
`#chat-context` → `#charon-ctx` (`mind.css:1712`, `:1723`). Mŕtve id sa preskočia a
vyčistia z úložiska, ako to robí `renderContextChips()` (`chat.js:44–48`).

### Čo presne ide modelu a aký je strop

**Kontext sa skladá NA SERVERI.** Klient posiela iba id. Dôvod je ten istý, prečo sa
história skladá z DB a nie z requestu
(`database/migrations/2026_08_19_000001_create_console_tables.php`, docblock): keby text
kontextu skladal prehliadač, dal by sa modelu podstrčiť popis uzla, ktorý v pamäti nie je
— a tento model má zápisové tooly.

**Nová služba `app/Services/Console/ContextBlock.php`** (nie metóda na kontroléri; bude ju
volať `RunController` a bude sa testovať bez requestu). Prevezme dobré časti
`ChatController::buildContext()` (`app/Http/Controllers/ChatController.php:98–140`) a
zahodí to, čo je pre CPU model priveľa.

| vec | `ChatController` dnes | `ContextBlock` (návrh) | prečo |
|---|---:|---:|---|
| max uzlov | 20 | **8** | |
| celkový strop | 6 000 znakov | **2 400 znakov** | |
| popis na uzol | celý | **300 znakov** | to isté číslo ako `hades.recall_desc_chars` |
| telo `.md` súboru | 1 500 znakov na uzol | **nič** | model si súbor vie prečítať `read_file`om, keď ho profil má; v profile `graph` ho zámerne nemá |
| priznané skrátenie | nie | **áno**, `… (kontext skrátený: 8 z 14 uzlov)` | model, ktorý nevie, že mu niečo chýba, si to domyslí (`BaseTool::cap()`, `BaseTool.php:198–216`) |

**Číselné zdôvodnenie stropu 2 400 znakov.** Všetko nižšie je zmerané teraz, nie
odhadnuté.

| položka | zmerané | ≈ tok |
|---|---:|---:|
| definície profilu `graph` | 4 982 znakov (§1.2) | **1 246** |
| smernica (`SystemPrompt::build()` na živých dátach, `DEPT_CAP = 6`) | 1 370 znakov | **342–457** |
| navrhovaný kontext | 2 400 znakov | **600** |
| **fixná časť jedného kola** | | **~2 200 – 2 300** |

```
docker compose exec -T app php artisan tinker --execute='
$p = app(App\Services\Console\SystemPrompt::class)->build();
printf("chars=%d\n", mb_strlen($p));'   → chars=1370
```
Pri smernici je uvedený **rozsah**, nie jedno číslo: je po slovensky a znaky/4 je pre
slovenčinu optimistické, takže konzervatívna hranica je znaky/3 (457). Pri definíciách
toolov (anglické) znaky/4 platí. **Pozn.: číslo 729 tokenov v `SystemPrompt.php:29` je
z merania pri `DEPT_CAP = 8`, teda z doby pred skrátením — necitovať ho ako dnešný stav.**

Kontext teda zdvihne fixnú časť kola na ~2 200–2 300 tok, a smyčka má strop 12 kôl
(`hades.console.max_steps`). Pri `num_ctx` 16 384, ktoré sa podľa kontraktu §4 **nesmie
zdvihnúť**, zostane na históriu a generovanie ~14k. Pri pôvodných 6 000 znakoch
`ChatController`u (1 500 tok) by fixná časť kola bola ~3 100–3 200 tok, teda o ~40 % viac
za informáciu, ktorú si model vie dotiahnuť `mind_read`om, keď ju naozaj potrebuje.

**Konfigurácia** (aby sa dali čísla ladiť bez zásahu do kódu, ale nedali sa rozísť):
```php
// config/hades.php → console
'context' => [
    'nodes' => (int) env('HADES_CONSOLE_CTX_NODES', 8),
    'chars' => (int) env('HADES_CONSOLE_CTX_CHARS', 2400),
    'desc_chars' => (int) env('HADES_CONSOLE_CTX_DESC', 300),
],
```
Validátor v `RunController` **musí strop čítať z configu**, nie mať vlastnú konštantu:
```php
'context_node_ids' => 'sometimes|array|max:'.(int) config('hades.console.context.nodes', 8),
'context_node_ids.*' => 'integer',
```
inak sa dve čísla rozídu a jedno z nich bude ticho platiť.

### Kam kontext v behu pristane

`RunController::run()` pošle **dva rôzne stringy**, čo je dnes už možné bez zásahu do
`AgentRunner`u (`RunController.php:108` a `:114–120` berú `$data['message']` každé
samostatne):

| adresát | text | prečo |
|---|---|---|
| `$runner->run($thread, $withContext, …)` | blok kontextu + `\n\n` + vlastná otázka človeka | uloží sa do `console_messages.content`, takže **história je verná tomu, čo model naozaj videl** |
| `$recorder->openExclusive($thread, $data['message'], …)` | **len** otázka človeka | `runs.prompt` je zadanie, ktoré „Spustiť znovu" vracia; kontext je aktuálny výber, nie súčasť zadania |

Blok začína pevným oddeľovačom, aby ho UI vedelo zložiť a aby sa nedal zameniť s textom
človeka:
```
[kontext z grafu — 3 uzly]
### Ripgrep v konzole
…
[/kontext]
```

## 2.4 Navigačné tooly grafu

### Rešpekt k tomu, čo `go()` naozaj je

`go({level, area, dept, node})` (`public/js/mind/sim.js:456–478`) **nemení pozície ani
nevymieňa scénu** — je to filter: fokusová skupina zostane plná, zvyšok stmavne na
`DIM_CTX` (0,34). `L.pos` obsahuje vždy všetky uzly. Návrh sa tomu podriaďuje úplne:
tool **nič nepresúva, nič nevytvára, nič nemaže**, a `Esc` filter zruší
(`shortcuts.js:135` → `clearFilter()`).

### Jeden tool, nie dva

`GraphFocusTool` (`app/Services/Console/Tools/GraphFocusTool.php`), meno **`graph_focus`**.

Druhý tool (`graph_filter` — vypínanie typov, oblastí, `minWeight`) **nenavrhujem**:
duplikoval by existujúce prepínače v UI a v profile `graph` je každý ďalší tool cena, na
ktorú sa strop 1 350 tok nastavil úmyselne úzko. Je to v §9 ako otvorený bod, nie ako
práca.

```php
public function name(): string { return 'graph_focus'; }
public function isWrite(): bool { return false; }   // BaseTool default, uvedené pre čitateľa
public function preview(array $args): ?string { return null; }
```

**Popis (finálny, zmeraný — 525 znakov):**
> Focus the user's graph on one node, one area or one department. Focusing is a FILTER
> over one scene: the chosen group stays lit, the rest dims. Nothing is moved, created or
> deleted, and the user clears it with Esc. Use it whenever the user asks to see, show or
> point at something in the graph — after mind_recall gave you the id. Give `node` (id
> from mind_recall), or `area` / `department` by exact name from mind_overview, or `reset`
> to show the whole mind again. Returns what was focused; say it back in one short
> sentence.

**Schéma (plochá, štyri skalárne vlastnosti, `required: []`):**

| vlastnosť | typ | popis |
|---|---|---|
| `node` | `integer` | Node id from mind_recall to focus on. |
| `area` | `string` | Exact area name from mind_overview. |
| `department` | `string` | Exact department name from mind_overview. |
| `reset` | `boolean` | true = clear the filter and show the whole graph. |

**Cena: 965 znakov = 241 tokenov.** Profil: **iba `graph`** (§1.3).

**Výsledok** — `ToolResult::json()`, a jeho tvar je kontrakt medzi PHP a `charon.js`:
```json
{"focused":"node","label":"Ripgrep v konzole","nav":{"level":"node","area":12,"dept":45,"node":1234}}
{"focused":"area","label":"Vývoj / kód","nav":{"level":"area","area":12,"dept":null,"node":null}}
{"focused":"all","nav":{"level":"map","area":null,"dept":null,"node":null}}
```
`nav` je **presne argument `go()`**, takže klient nič neprekladá (`go(res.nav)`).
Zdvojenie informácie (`focused`/`label` pre model, `nav` pre klienta) stojí ~30 tokenov
na volanie a je to lacnejšie než druhá cesta k tej istej informácii.

**Riešenie cieľa a odmietnutia — ten istý duch ako `PathGuard`: odmietnuť, nehádať.**
- `node` / label → existujúci trait `ResolvesNode` (`app/Services/Console/Tools/ResolvesNode.php`),
  vrátane jeho chovania pri nejednoznačnosti. Nepísať tretie riešenie uzla.
- `area` / `department` → presné meno. Neznáme →
  `ToolRefusal("No area named `X`. Call mind_overview for the exact names.")`. Žiadne
  fuzzy hľadanie: „najbližšia oblasť" by zaostrila niečo iné, než človek žiadal, a on by
  to na plátne videl ako fakt.
- žiadny argument a `reset` nie je `true` →
  `ToolRefusal('Give `node`, `area`, `department`, or `reset: true`.')`
- `department` bez `area` → tool `area_id` doplní z oddelenia sám (uzol/oddelenie svoju
  oblasť pozná), presne ako `clampNav()` (`sim.js:68`).

**Aplikácia na klientovi** (v `charon.js`, `view.onToolResult`):
```js
// meno prišlo z runclientu (Map<id, name>), nie z DOM-u
if (name === 'graph_focus' && frame.status === 'done') applyFocus(frame.result);
```
`applyFocus()` skúsi `JSON.parse`; pri zlyhaní **ticho nič** (prúd sa nesmie zlomiť kvôli
jednému rámcu — to isté pravidlo, aké má `parseNdjsonLine`). Pri úspechu
`go(res.nav)` — a nič viac. Žiadne `draw()`, žiadny `kickSim()`, žiadny `buildSim()`:
`go()` si prekreslenie rieši sám (`sim.js:474–476`) a je už dnes strážené `graphActive()`.

## 2.5 rAF: ako sa zabezpečí, že dok kreslenie nezapne, a ako sa to zmeria

### Čo už dnes drží

- `scheduleFrame()` (`public/js/mind/render.js:1709–1715`) má na prvom riadku
  `if (!graphActive()) return;` — teda `requestDraw()` mimo Grafu rAF nevyžiada.
- `frame()` (`render.js:1609–1611`) má tú istú stráž.
- `pump()` (`public/js/mind/sim.js:238–271`) mimo Grafu **netiká na rAF**, ale dosadá
  `setTimeout`om (10 ms dávka / 50 ms).
- `go()` volá `draw()` len pod `if (graphActive())` (`sim.js:474`).

Takže `graph_focus` sám o sebe rAF mimo Grafu nezapne. **Riziko je inde.**

### Skutočné riziko a pravidlo, ktoré ho odstráni

Dnešná konzola prekresľuje streamovaný markdown cez rAF:
`public/js/console/render.js:319–326` (`schedulePaint()` → `painting = requestAnimationFrame(...)`).
Keby dok tento vzor prevzal (alebo keby sa `schedulePaint` presunul do zdieľaného
modulu), tak beh, ktorý **prežije prepnutie obrazovky** z Grafu na Dnes, by mimo Grafu
volal `requestAnimationFrame` na každý rámec `delta` — pri ~9 tok/s desiatky ráz za
sekundu. Kritérium §5/7 by padlo a nikto by nevedel, prečo, pretože plátno by naozaj
nekreslilo.

**Pravidlo pre vlnu 4, bez výnimky:**

> `public/js/mind/charon.js` ani `public/js/shared/*.js` nesmú obsahovať reťazec
> `requestAnimationFrame`. Prekresľovanie markdownu v doku ide `setTimeout(fn, 33)`.

Zdôvodnenie, prečo to nič nestojí: pri ~9 tok/s pritečie token raz za ~111 ms, takže
33 ms zlučovacie okno je jemnejšie než prílet dát — vizuálne sa nestratí nič, a dok
prestane byť závislý od toho, či je jeho karta viditeľná. (Bonus: `endTurn()` v konzole
už dnes prekresľuje **synchrónne** práve preto, že „na skrytej karte sa rAF nespustí",
`console/render.js:344–347`. Dok tým problémom netrpí vôbec.)

`schedulePaint()` sa preto **nezdieľa** — zdieľa sa iba `renderMarkdown()`. Konzola si
svoj rAF necháva (nemá plátno, kritérium sa jej netýka) a dok má svoju šesťriadkovú
verziu na `setTimeout`.

### Meranie (harness, kalibrovaný z oboch strán)

Obaľuje sa **`window.requestAnimationFrame`**, nie `ctx.clearRect()` — obalenie
`clearRect` je zapísaná pasca: render ho nepoužíva, takže merač vracal vždy 0 a kritérium
vyzeralo splnené bez toho, aby čokoľvek meral (CLAUDE.md, §Overenie UI).

Inštalácia **pred načítaním modulov** (`evaluateOnNewDocument`, resp. rovnaký bod
v proxy harnesse):
```js
window.__raf = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => { window.__raf++; return nativeRaf(cb); };
localStorage.setItem('hades.hints2', 'done');   // onboarding karta prekryje všetko
```

| krok | čo sa robí | očakávanie | čo dokazuje |
|---|---|---|---|
| **K1** kalibrácia kladná | `setScreen('graf')`, čakať 1 000 ms | `__raf > 0` | obal je nasadený a naozaj počíta |
| **K2** kalibrácia záporná | `setScreen('dnes')`, čakať na `S._simSettled`, `__raf = 0`, čakať 1 000 ms | `__raf === 0` | pravidlo „mimo Grafu sa nekreslí" platí aj bez doku (baseline) |
| **M1** dok otvorený, beh nebeží | na `dnes` otvoriť dok (ak je dostupný), `__raf = 0`, 1 000 ms | `__raf === 0` | samo otvorenie doku rAF nezapne |
| **M2** beh prežije prepnutie | na `graf` spustiť ťah, počkať na prvé `delta`, prepnúť `setScreen('dnes')`, `__raf = 0`, čakať 2 000 ms **kým deltá stále tečú** | `__raf === 0` | streamovanie v doku nesiaha na rAF — **jediné meranie, ktoré testuje novú vec** |
| **M3** `graph_focus` mimo Grafu | na `dnes` doručiť doku `tool_result` pre `graph_focus`, `__raf = 0`, 1 000 ms | `__raf === 0` | `go()` mimo Grafu rAF nevyžiada |

Bez K1 a K2 sú M1–M3 bezcenné. **Pred každým meraním overiť identitu preview servera**
(CLAUDE.md): `curl -s http://127.0.0.1:<port>/ | grep -o 'src="/js/[^"]*"'` musí vypísať
`/js/mind/main.js`.

Statický dôkaz, ktorý sa dá spustiť aj bez prehliadača a patrí do reportu:
```
grep -rn "requestAnimationFrame" public/js/mind/charon.js public/js/shared/   # musí byť prázdne
grep -rn "fetch('/api/console" public/js/mind/ | grep -v shared/              # musí byť prázdne
```
Druhý grep je dôkaz, že dok nemá **druhú cestu k modelu**, ktorá by obchádzala dvojfázovú
bránu — a to je presne to, čo tu podľa CLAUDE.md („Spustiť znovu nič nespúšťa") nesmie
vzniknúť.

## 2.6 Dvojfázová brána v doku (kritérium §5/9)

Dok používa **ten istý** `runclient.js`, **tie isté** endpointy a **ten istý** slovník
(`gate.js`). Takže sa nedokazuje „aj v doku to funguje", ale **„inej cesty niet"**:

1. **PHP test B7** (§1.10): beh s `profile=graph` na `mind_learn` → prúd obsahuje
   `permission` a **neobsahuje `end`**; obnova len z `/api/console/decide`.
2. **Statický dôkaz** (§2.5): v `public/js/mind/` nie je žiadny `fetch('/api/console…`
   mimo zdieľaného modulu.
3. **Zmeraný DOM** (nie screenshot — Browser pane tu nekompozituje rámce): po rámci
   `permission` existuje `#charon .charon-perm[data-id]` s dvoma tlačidlami, `#charon-send`
   má `disabled`, a `#charon-announce.textContent` sa rovná `writeAsk(frame)` — teda tej
   istej vete, akú povie konzola.
4. **Negatívny dôkaz:** kliknutie „Zamietnuť" → `console_tool_calls.status = 'denied'`,
   a uzol, ktorý `mind_learn` chcel vytvoriť, v `nodes` **nie je**.

Dok navyše **nesmie** priniesť späť to, čo `chat.js` robil mimo brány:
`renderSuggestCard()` (`chat.js:66–137`) zapisoval uzol priamo cez `POST /api/nodes`.
V doku sa „zapamätaj si toto" robí **výhradne** `mind_learn`om, teda za bránou. Do
reportu to patrí ako vyriešený nález, nie ako detail.

## 2.7 CSS doku — a jedna vec, ktorú treba dohodnúť s vlnou D

Dok potrebuje bubliny správ, karty nástrojov a kartu povolenia. Tie **existujú**
v `public/css/console.css` (`.msg`, `.bubble`, `.tool-call`, `.tc-*`, `.perm-card`,
`.think-dots`). Dve možnosti:

- **A (odporúčaná).** Vyňať tieto komponenty do nového `public/css/charon.css`, ktorý
  načítajú **obe** stránky; `console.css` a `mind.css` si nechajú len rozloženie. Je to
  presne to, čo vlna B/D robí (D1–D9, „zlúčiť duplikáty medzi `mind.css` a `console.css`"),
  len o jeden komponent viac. **Musí sa koordinovať s agentom, ktorý vlastní `console.css`
  v tejto vlne** — inak vzniknú dva konfliktné diffy nad tým istým súborom.
- **B (záložná, keď koordinácia nevyjde).** Dok si nakreslí vlastné `.charon-*` triedy
  v `mind.css`. Cena: tretia kópia bubliny. **V žiadnom prípade neprenášať `.tc-*`
  markup do `mind.css`** — `.tc-label` a `.tc-val` tam už znamenajú tabulárne číslo
  (`mind.css:553, 3043, 3047`), takže názov nástroja by dostal cudziu sadzbu.

Nezávisle od voľby: **žiadny raw hex/rgba mimo `:root`**, každý swatch oblasti cez
`mutedColor()`, akcent amethyst, zlatá len značke a jadru (CLAUDE.md, kánon akcentu).
Dok je nad plátnom, takže jeho pozadie musí byť nepriehľadné alebo vrstva, ktorú merač
kontrastu **poskladá** — inak sa text doku bude merať proti grafu a číslo bude závisieť
od toho, čo sa Hades práve naučil (zapísaná pasca č. 1 merača kontrastu).

`touch-action` **nie je problém**: `touch-action: none` je viazané na `body[data-screen="graf"] #mind`
(`public/css/mind.css:3964–3967`), teda na plátno, nie na `body`. Scrollovanie vnútri
`#charon-stream` na dotyku funguje bez ďalšieho pravidla. (Píšem to sem preto, aby to
niekto „preventívne neopravoval".)

## 2.8 Poradie odstránenia mŕtvej cesty

**Fáza 1 — dok funguje a je zmeraný. Nemaže sa NIČ.**
Pridá sa `public/js/shared/*`, `public/js/mind/charon.js`, markup, CSS, `GraphFocusTool`,
profily. `chat.js` a `#prompt` zostávajú nedotknuté; `body.chat-on` je aj tak default
vypnuté (`controls.js:278`: `localStorage.getItem('hades.chat') === '1'`), takže mŕtva
cesta nikoho neruší. Hotové = kritériá §5/7 (K1, K2, M1–M3) a §5/9 (§2.6) sú v reporte
so zmeranými číslami.

**Fáza 2 — až potom sa maže.** Presný zoznam:

| # | Súbor / miesto | Akcia |
|---|---|---|
| 1 | `public/js/mind/chat.js` (261 r.) | **zmazať celý** |
| 2 | `public/js/mind/main.js:7` | zmazať `import { setupPrompt } from './chat.js';` |
| 3 | `public/js/mind/main.js:79` | zmazať `setupPrompt();`; na jeho miesto `setupCharon();` z `charon.js` |
| 4 | `public/js/mind/shortcuts.js:4` | `import { collapsePrompt } from './chat.js';` → `import { charonOpen, closeCharon } from './charon.js';` |
| 5 | `public/js/mind/shortcuts.js:128–131` | Esc kaskáda: `if ($('prompt').classList.contains('open') || !$('chat-log')…) { collapsePrompt(); return; }` → `if (charonOpen()) { closeCharon(); return; }`. **Pozíciu v kaskáde zachovať** — medzi `dockOpen` (`:126`) a `S.local` (`:132`), aby posledným stupienkom zostal `clearFilter()` (`:136`). Zmena poradia by ticho zmenila, čo Esc na Grafe robí. |
| 6 | `public/js/mind/shortcuts.js:199–205` | klávesa `C`: `chat-on` + `#prompt-input` → otvorenie doku a fokus `#charon-input`; podmienku `document.body.classList.contains('chat-on')` zmazať |
| 7 | `public/js/mind/shortcuts.js:218` | text HINTu „Nastavenia (tmavý režim, sieť, chat)" → bez „chat" |
| 8 | `resources/views/mind.blade.php:432–438` | celý `<div id="prompt">` vrátane `#chat-context` (`:433`), `#chat-log` (`:434`), `#prompt-form` (`:435`), `#prompt-input` (`:437`) → nahradiť markupom `#charon` |
| 9 | `resources/views/mind.blade.php:284–287` (`.switch-row`, v ňom `#chat-toggle-label` na `:285` a `#chat-toggle` na `:286`) | prepínač „Chat s Hadesom (potrebuje API kľúč)" → **zmazať**; namiesto neho prepínač doku `#charon-toggle` (alebo len skratka `C`, ak sa prepínač neukáže potrebný — §9/2) |
| 10 | `public/js/mind/controls.js:276–287` | celý blok `chatBtn` / `hades.chat` / `body.chat-on` → zmazať |
| 11 | `public/css/mind.css:1548–1763` | `#prompt`, `#prompt-form`, `#prompt-input`, `#chat-log`, `#chat-context`, `.suggest-card` → prepísať na `.charon-*`; **`.ctx-chip` a spol. (`:1725+`) ZACHOVAŤ**, len obalový selektor `#chat-context` → `#charon-ctx` |
| 12 | `public/css/mind.css:2292` | `body.ambient #prompt` → `body.ambient #charon` |
| 13 | `public/css/mind.css:2865` | `body:not(.chat-on) #prompt { display: none !important; }` → zmazať (`.chat-on` prestane existovať) |
| 14 | `public/css/mind.css:3295–3296` | media query `#prompt.open` / `#prompt:focus-within` → `.charon-*` |
| 15 | `public/css/mind.css:4273` | `#prompt-form` v zozname akcentových selektorov → `#charon-form` |
| 16 | `public/js/mind/ws.js:174` | `if (type === 'chat')` — pulz z `MindPulse::dispatch('chat', …)`; zostáva alebo sa premenuje **spolu s bodom 18** (rovnaký reťazec na dvoch stranách) |
| 17 | `routes/api.php:83` | `Route::post('/chat', [ChatController::class, 'send'])` → zmazať |
| 18 | `app/Http/Controllers/ChatController.php` | **zmazať celý** (Anthropic `Client`, `detectRememberIntent()`, `buildContext()`, `systemPrompt()`). Použiteľné časti `buildContext()` už žijú v `ContextBlock` (§2.3). |
| 19 | `resources/views/mind.blade.php:146` | odkaz na `/console` v raile — **NEMAZAŤ** (destinácia Charón zostáva; dok konzolu nenahrádza) |
| 20 | `composer.json` | závislosť na Anthropic SDK **nechať**, kým sa neoverí, že ju nič iné nepoužíva (`grep -rn "Anthropic\\\\" app/`). Odstránenie balíčka je samostatné rozhodnutie, nie vedľajší efekt. |

**Čo sa nemaže ani vo fáze 2 (a je to zámer):**
- `packBtn()` / `S.pack` / `#node-pack` / drawer balíka — `docs/audit/03-ia-flows.md`
  §NEROBIŤ bod 4. Dok ich **čítá** (§2.3), nezlučuje.
- Destinácia `/console` v raile a celá plná konzola.
- `MindPulse` a `ws.js` pulzová cesta — je to vizualizácia, nie chat.

**Testy, ktorých sa fáza 2 dotkne — zmerané: žiadny.**
`grep -rn "ChatController\|api/chat" tests/` vráti len (a) cudzie `/api/chat`, čo je
**upstream endpoint Ollamy** v `tests/Feature/LlmProviderTest.php` (`:92, 111, 184, 344,
356, 373`) — s Hadesovým `/api/chat` nemá nič spoločné a **nesmie sa ho nikto dotknúť**;
(b) tri komentáre (`ConsoleModelsTest.php:22`, `LlmProviderTest.php:445`,
`RecallForAiTest.php:294`). **Route `POST /api/chat` nepokrýva ani jeden test.** Je to
samo o sebe nález o tom, aká mŕtva tá cesta bola, a patrí do reportu.

### Vedľajší efekt zmazania `ChatController`u, ktorý sa musí doriešiť dokumentáciou

`ChatController::send()` (`app/Http/Controllers/ChatController.php:43`) je **jediný
volajúci `MindService::recall()`** v celom `app/` (zmerané; `RecallBench.php:351` má
vlastnú privátnu `recall()`, ostatné cesty idú cez `recallWithMeta()`). Po jeho zmazaní:

- **`recall()` NEMAZAŤ.** Je to zdokumentované verejné API, opierajú sa o ňu testy
  (`RecallForAiTest`, `HybridRecallTest`) a CLAUDE.md o nej hovorí, že zmeny tu treba
  držať aditívne.
- **Tri miesta začnú tvrdiť nepravdu a treba ich prepísať v tom istom commite:**
  `CLAUDE.md:444` („`recall()` vracia `Collection<Node>` pre ChatController"),
  `app/Services/MindService.php:225` (docblock `recallWithMeta()`, ktorý sa vymezuje voči
  `recall()` „pre ChatController"), `docs/BEZPECNOST.md:179` („generická veta, detail len
  do logu — `ChatController::send()`"). Nechať v repozitári komentár odkazujúci na triedu,
  ktorá neexistuje, je presne ten druh tichého rozchodu, ktorý audit 19. 8. 2026 našiel
  na šiestich miestach.
- **`composer.json`**: po zmazaní zostane Anthropic SDK bez volajúceho v `app/`
  — overiť `grep -rn "Anthropic\\\\" app/` a rozhodnutie o odstránení balíčka nechať ako
  samostatnú úlohu (bod 20 vyššie), nie ako vedľajší efekt.

---

## 9. Otvorené body — rozhodnutie pre orchestrátora pred vlnou 4

1. **CSS doku: variant A alebo B (§2.7)?** A je správnejšia a je to práca navyše v
   `console.css`, ktorý v tejto vlne vlastní iný agent. **Kto vlastní `console.css`, a
   smie doň zasiahnuť agent doku?** Bez odpovede vzniknú dva konfliktné diffy.
2. **Prepínač doku v Nastaveniach — má vôbec byť?** Bod 9 v §2.8 ho zavádza ako náhradu
   za `#chat-toggle`. Argument proti: `chat-on` existoval len preto, že chat nefungoval
   bez API kľúča; dok funguje lokálne, takže prepínač „vypni funkčnú vec" je len ďalší
   ovládač. Argument za: dok je nad plátnom a niekto ho tam nechce. **Reverzibilné, ale
   je to UI rozhodnutie, nie technické.**
3. **`graph_filter` ako druhý navigačný tool** (vypínanie typov/oblastí, `minWeight`).
   Nenavrhol som ho (§2.4). Ak ho orchestrátor chce, treba zdvihnúť strop profilu
   `graph` z 1 350 na ~1 600 a povedať to **pred** napísaním testu, nie po ňom.
4. **Filter podľa profilu na obrazovke Runy** (§1.7). Je to štvrtý filter a nová funkcia;
   nenavrhol som ju, len stĺpec. Áno/nie?
5. **Zlúčenie `S.pack` a kontextu doku (A8 do konca).** Návrh ich drží oddelene s jedným
   tlačidlom „Priložiť balík". Úplné zlúčenie by zmenilo význam `packBtn()` na troch
   obrazovkách (`dnes.js`, `dennik.js`, `kniznica.js`) — to je **nevratná zmena významu
   ovládača**, teda podľa CLAUDE.md sa treba spýtať.
6. **Ikona `psychology` v `console/tools.js:44`** (`mind_learn` → `psychology`) a
   `library_add` v `mind.blade.php:390`, `wb_sunny`, `center_focus_strong`, `remove`,
   `account_tree`, `assignment`, `category`, `fact_check`, `gavel`, `layers`, `menu_book`,
   `monitoring`, `receipt_long` v blade šablónach — **žiadna z nich nie je v zmeranom
   zozname 16 ikon** v `BASELINE-MERANIA.md` §1. Buď je baseline neúplná, alebo časť
   ikon sa dnes kreslí ako text. Dok si `iconFor()` prevezme, takže sa ho to priamo
   dotýka. **Nie je to práca doku** (kritérium §5/11 vlastní iný agent), ale niekto to
   musí zmerať tou istou metódou (šírka vykresleného glyfu ≈ 18 px vs. násobne širšia
   ligatúra), inak dok zdedí ikonu, ktorá je v skutočnosti text.
7. **Smernica v malom profile.** `SystemPrompt::build()` modelu tvrdí „Pamäť ani súbory
   projektu nevidíš priamo — jediná cesta k nim sú tvoje tooly", ale v profile `graph`
   súborové tooly neexistujú, takže model môže sľúbiť, že si súbor prečíta. Náklad opravy
   (jedna veta podľa profilu) je malý, ale znamená, že `SystemPrompt` by musel poznať
   profil. Neriešil som to — model dostane `Unknown tool … Available tools: …` a odrazí
   sa. **Nechať tak, alebo zaplatiť?**
8. **Ako sa vlna 4 delí medzi štyroch agentov.** Návrh (nezáväzný): (1) profily + testy
   + `GraphFocusTool` + migrácia + serializéry, (2) `public/js/shared/*` + prepojenie
   existujúcej konzoly na ne (regresný, nulový funkčný diff), (3) `charon.js` + markup +
   CSS + kontext, (4) fáza 2 mazania + meranie K1/K2/M1–M3 + report. **Poradie je
   sekvenčné 1→2→3→4 a agent 4 nesmie začať, kým agent 3 nedoloží zmerané kritériá.**

---

## 10. Kontrolný zoznam pre report vlny 4

- [ ] `docker compose exec app php artisan test` — ≥ 448 passed, 0 failed (§5/1)
- [ ] `phpunit.mariadb.xml --filter="HybridRecall|RecallBench|ConsoleTools|McpTools"` —
      0 skipped, 0 failed (§5/2). **Povinné**: menia sa nástroje Charóna, sqlite ich preskočí.
- [ ] `ScreenParityTest` zelený vrátane 4. vrstvy (§5/3) — `tool_profile` v `fieldsForAi()`
- [ ] `git diff --stat app/Services/Console/AgentRunner.php` → **prázdne** (§1.5)
- [ ] Test §5/8 zelený **a dokázateľne padajúci** na +300 znakoch v jednom popise (§1.8)
- [ ] Zmerané ceny profilov v reporte, porovnané s tabuľkou §1.2
- [ ] B1–B9 zelené (§1.10)
- [ ] K1, K2, M1, M2, M3 s číslami (§2.5); identita preview servera overená pred meraním
- [ ] `grep -rn "requestAnimationFrame" public/js/mind/charon.js public/js/shared/` → prázdne
- [ ] `grep -rn "fetch('/api/console" public/js/mind/ | grep -v shared/` → prázdne
- [ ] Zmeraný DOM karty povolenia v doku + negatívny dôkaz zamietnutia (§2.6)
- [ ] `w4dup.js`: `mind.css` aj `console.css` (aj prípadný `charon.css`) kategória A = 0 (§5/5)
- [ ] `cssswap.js` nad tým istým DOM (§5/6)
- [ ] Kontrastná matrica po dosadnutí témy, kalibrovaná na `body` (~16:1) (§5/4)
- [ ] Fáza 2 zmazaná až po doložení fázy 1; 20 bodov zo §2.8 odškrtaných menovite
- [ ] Po zmazaní `ChatController`u prepísané `CLAUDE.md:444`, `MindService.php:225`
      a `docs/BEZPECNOST.md:179` (§2.8, vedľajší efekt) — v tom istom commite
- [ ] Aktualizovaný projektový `CLAUDE.md`: kapitola o Charónovi (profily, 13. tool,
      `TOOLS` ≠ `full`), sekcia Frontend (`public/js/shared/`, zákaz rAF v doku)
      a poznámka, že „kontextový strop je reálne blízko" má odteraz merateľné čísla
