# Rozhranie `spawn_agent` a profil `orchestrator`

Vlna 1-B šprintu **Chat ako samostatná appka** (`KONTRAKT-CHAT-APPKA-2026-08-25.md`).
Dátum: 25. 8. 2026 · východisko `feat/hades-ux` @ `82ae1cb`.

**Toto je NÁVRH, nie implementácia.** Nič z tohto dokumentu nie je v kóde. Vlna 2 sa
naň naväzuje, takže každé meno triedy, metódy, stĺpca a rámca je tu napísané v tom
tvare, v akom má vzniknúť. Kde som sa rozhodol inak, než hovorí kontrakt, je to
označené **ODCHÝLKA** a je to rozhodnutie pre orchestrátora, nie hotová vec.

Zmerané čísla pochádzajú z `docs/sprint-2026-08-21/ROZHRANIE-PROFILY-A-DOK.md` §1.1–1.3
(ceny definícií toolov) a z merania v tomto dokumente (§2.2). Nič som nehádal.

---

## 0. Čo je tu naozaj ťažké

Zvyšok dokumentu je odvodený z jednej vety, tak ju napíšem hneď:

> `spawn_agent` je tool, ktorý sa vykonáva **synchronne vnútri rodičovského behu**,
> ale jeho podagent sa môže **zaparkovať na človeku** — a rodič ho nesmie prečkať,
> pretože blokujúce čakanie by držalo jedného z ôsmich PHP workerov.

Z toho vyplýva všetko ostatné: parkovanie sa musí **preniesť nahor** (rodičovský ťah
skončí bez `end`), obnova musí ísť **jednou existujúcou cestou** (`/api/console/decide`),
a rodič sa musí po dokončení dieťaťa rozbehnúť **v tom istom requeste**, ktorý priniesol
rozhodnutie človeka. Tretia cesta k modelu nevzniká — `/api/console/run` a
`/api/console/decide` zostávajú jediné dve.

---

## 1. `spawn_agent` — tool

### 1.1 Mená

| vec | presné meno |
|---|---|
| tool name (vidí model) | `spawn_agent` |
| trieda toolu | `App\Services\Console\Tools\SpawnAgentTool` |
| služba, ktorá podagenta postaví a odjazdí | `App\Services\Console\Subagent` |
| výsledok jedného podbehu (readonly VO) | `App\Services\Console\SubagentOutcome` |
| signál „podagent čaká na človeka" | `App\Services\Console\AgentParked` (výnimka) |
| kontext rodičovského behu v rámci requestu | `App\Services\Console\AgentContext` |
| profil | `orchestrator` (kľúč v `ToolRegistry::PROFILES`) |
| stĺpce | `runs.parent_run_id`, `runs.parent_call_id`, `console_threads.parent_thread_id`, `console_threads.max_steps` |

`AgentParked` je súrodenec `RunAborted` — tá istá myšlienka (výnimka ako riadiaci
signál smyčky, nie chyba), to isté miesto v adresári.

### 1.2 JSON schéma (presne)

```php
public function name(): string
{
    return 'spawn_agent';
}

public function description(): string
{
    return 'Run a focused subagent on ONE self-contained task and get its answer back. Use it when the '
        .'task needs a different tool set than yours, or when its output would flood this conversation: '
        .'searching the repository, a batch of memory edits, a report over many nodes. `task` must be a '
        .'complete brief — the subagent sees none of this conversation, only that text. `profile` picks '
        .'its tools. `max_steps` caps its rounds (1-6, default 4). Any write the subagent wants is '
        .'confirmed by the human first and this run waits for that. Returns its final answer plus what '
        .'it spent. Max 3 subagents per run, one after another — never at the same time.';
}

public function schema(): array
{
    return [
        'type' => 'object',
        'properties' => [
            'task' => [
                'type' => 'string',
                'description' => 'Complete, self-contained brief. The subagent sees no history and no '
                    .'context block — everything it needs must be in here.',
            ],
            'profile' => [
                'type' => 'string',
                'enum' => ['memory', 'files', 'graph'],
                'description' => 'Tool set for the subagent. memory = recall, read, overview, learn, '
                    .'rename, move, delete. files = recall, grep, glob, read_file, edit_file, write_file. '
                    .'graph = recall, read, overview, graph_focus, learn.',
            ],
            'max_steps' => [
                'type' => 'integer',
                'description' => 'How many rounds the subagent may take, 1-6. Default 4; higher values '
                    .'are clamped, not refused.',
            ],
        ],
        'required' => ['task', 'profile'],
    ];
}
```

Prečo takto:

- **Plochá schéma, tri skalárne parametre.** Pravidlo z `ConsoleTool` docblocku: slabý
  model si vnorené objekty vymýšľa. Žiadne `tools: []`, žiadne `context: {}`.
- **`profile` je POVINNÝ a nemá default.** Default by ticho dal úlohe inú sadu nástrojov,
  než volajúci chcel — a sada nástrojov rozhoduje o tom, ktoré **zápisové** tooly
  podagent vôbec má. Je to ten istý duch ako `PathGuard` a `useProfile()`: **odmietnuť,
  nehádať.** Cena odmietnutia je jedno kolo smyčky (~20 s na CPU) a je to lacnejšie než
  podagent, ktorý dostane súborové tooly na pamäťovú úlohu.
- **`enum` v schéme aj tak nestačí** — je to len rada modelu. Skutočné vynútenie je
  serverové, v `SpawnAgentTool::CHILD_PROFILES` (§4).
- **`max_steps` sa CLAMPUJE, neodmieta.** Model, ktorý napíše 20, chce „nech to stihne";
  odmietnutie by spálilo kolo za formalitu. `task`/`profile` sú bezpečnostné, `max_steps`
  je výkonový — preto dva rôzne režimy a nie jedno pravidlo pre všetko.
- Popis má 633 znakov a hovorí modelu **kedy** tool použiť, **čo** dostane a **že sa beh
  zastaví na človeku**. Test tvaru vyžaduje `> 80` znakov popisu; toto ho nesplní tesne.

### 1.3 `ToolResult` — presný tvar

Úspech (podagent dobehol):

```json
{"agent":"3f2c…-uuid","profile":"files","status":"done","steps":2,"tool_calls":3,
 "tokens_in":1840,"tokens_out":214,"answer":"V `public/js/shared/` je päť modulov…"}
```

Zrezaný alebo padnutý podagent:

```json
{"agent":"3f2c…-uuid","profile":"files","status":"failed","steps":4,"tool_calls":6,
 "tokens_in":5200,"tokens_out":610,"answer":"…","error":"Beh spadol. Detail je v logu appky."}
```

Skrátená odpoveď pridá `"answer_truncated":true`.

Pravidlá tvaru (tie isté ako `mind_recall`, aby MCP a konzola hovorili jedným jazykom):

- Vracia sa `ToolResult::json([...])` — kompaktný JSON, `JSON_UNESCAPED_UNICODE |
  JSON_UNESCAPED_SLASHES`. Číta to stroj.
- **Prázdne polia sa neposielajú.** `error` len keď je, `answer_truncated` len keď je
  `true`. Žiadne `null` — je to 20 B za nulovú informáciu.
- `agent` je **uuid podbehu**, nie `id`. Rovnaký dôvod ako pri `runs.uuid`: počet behov
  nie je informácia, ktorú má dostať model ani adresný riadok. Model ho môže podať do
  `mind_run`, takže je to použiteľný odkaz, nie dekorácia.
- `answer` je **posledná neprázdna asistentská správa podbehu**, skrátená na
  `hades.console.agent.result_chars` (default 2000 znakov ≈ 500 tokenov). Skrátenie sa
  **vždy prizná** — `BaseTool::cap()` už na to má tvar a `SpawnAgentTool` ho použije.
- **Čo sa NEVRACIA:** výsledky toolov podagenta, jeho história, jeho diffy. To je celý
  zmysel podagenta — jeho transkript sa do kontextu rodiča **nikdy nedostane**. Rodič
  platí 500 tokenov za odpoveď namiesto 6000 za priebeh.

### 1.4 Je to čítací tool? Áno — a `isWrite()` prestáva byť jediná brána

**`isWrite() === false`, `preview()` vracia `null`.**

Zdôvodnenie, ktoré musí byť v docblocku triedy, pretože je proti prvej intuícii:

1. `isWrite()` odpovedá na presne jednu otázku: *„musí človek potvrdiť TOTO volanie,
   predtým než sa vykoná?"* `spawn_agent` sám nezapíše nič — ani uzol, ani súbor, ani
   riadok v pamäti. Zakladá vlákno a beh, čo je to isté, čo robí každá správa v konzole.
2. Náhľad by nemal čo ukázať. Jediné, čo v okamihu potvrdenia existuje, je **text úlohy**
   — a to nie je náhľad zmeny, to je zadanie. Náhľad, ktorý ukáže zadanie a nechá človeka
   kliknúť „Povoliť", **učí nesprávnu vec**: že tým kliknutím schválil zápisy, ktoré
   podagent urobí. Neschválil. Tie prídu jeden po druhom, každý s vlastným diffom,
   v podagentovi.
3. Dve brány na jednu akciu, z ktorých druhá je jediná, čo vie ukázať diff, je horšie než
   jedna brána na správnom mieste.

**Ale:** z toho vyplýva vlastnosť, ktorú tento projekt doteraz nepotreboval a ktorá sa
musí napísať čierne na bielom:

> **`isWrite() === false` už neznamená „prebehne bez človeka".** `spawn_agent` je prvý
> čítací tool, ktorý vie ťah **zaparkovať** — nie svojím zápisom, ale zápisom svojho
> dieťaťa. Parkovanie nesie `AgentParked` (§3), nie `isWrite()`.

Dôsledky pre testy (§6): existujúci `test_read_tools_run_without_asking_and_write_tools_do_not`
zaradí `spawn_agent` na **čítaciu** stranu a `test_read_tools_have_no_preview` do svojho
menovitého zoznamu. Navyše pribudne test, ktorý dokazuje, že čítacia strana **neznamená**
neriadený zápis (§6.4).

### 1.5 Čo dostane podagent ako prvú správu

Podagent je nové vlákno s prázdnou históriou, takže jeho prvá `user` správa je celý jeho
svet. `Subagent::brief()` ju zloží ako:

```
Si podagent Hadesa. Máš JEDNU úlohu a po jej dokončení odpovedáš krátkym zhrnutím
toho, čo si zistil alebo urobil — to zhrnutie je tvoj jediný výstup.
Nemáš históriu ani kontext inej konverzácie; všetko, čo potrebuješ, je nižšie.

Úloha:
<task>
```

**`SystemPrompt.php` sa NEMENÍ.** Rola sa dá povedať v zadaní a je to čestnejšie: je to
zadanie, nie smernica. Precedens je priamo v `RunController::run` — `ContextBlock` sa
lepí pred otázku do správy pre model, kým `runs.prompt` drží **len otázku**. Tu to isté:
`console_messages.content` podagenta nesie brief + úlohu, `runs.prompt` podbehu nesie
**len `task`**, aby „Spustiť znovu" vrátilo zadanie a nie preambulu.

---

## 2. Profil `orchestrator`

### 2.1 Členstvo a prečo

```php
// Orchestrátor. Rozdeľuje prácu, nerobí ju. Dva tooly a je to zámer:
//   `mind_recall` — bez neho by orchestrátor písal zadania podagentom z ničoho.
//     Smernica prikazuje „nič si nedomýšľaj, zisti to toolom" a konvencie tohto
//     projektu žijú v pamäti. Vymyslené zadanie je najhoršia porucha orchestrátora,
//     pretože podagent ju vykoná dôsledne.
//   `spawn_agent` — vlastná akcia profilu.
// ŽIADNY zápisový tool: orchestrátor nesmie zapisovať sám. Zápisy patria podagentom,
// kde ich vidí človek s diffom. Vedľajší efekt je, že profil `orchestrator` nemá
// vlastnú cestu k bráne zápisov — jediná brána, ktorú zažije, je brána dieťaťa.
// `spawn_agent` NIE JE v žiadnom inom profile (§2.3) a `orchestrator` NIE JE
// v `CHILD_PROFILES` (§4) — hĺbka stromu je teda presne 1.
'orchestrator' => [
    MindRecallTool::class,
    SpawnAgentTool::class,
],
```

Čo tam **nie je** a prečo (dôvody sú vecné, nie tokenové — pozri §2.2):

| tool | prečo nie |
|---|---|
| `mind_overview` | `SystemPrompt::structure()` už dáva štruktúru pamäte **v každom requeste**. Tool by bol druhá cesta k tej istej vete. |
| `mind_read` | Dočítanie celého uzla je práca; orchestrátor deleguje. Keď treba celý popis, patrí to do briefu podagenta s profilom `memory`. |
| `glob`, `grep`, `read_file` | To je presne to, čo má robiť dieťa s profilom `files`. Orchestrátor, ktorý vie čítať súbory, ich začne čítať sám — a potom zaplatí ich obsah vo svojom kontexte. |
| `graph_focus` | Efekt je klientský a orchestrátor beží v `/chat`; navigáciu grafu vlastní dok s profilom `graph`. |
| akýkoľvek zápis | pozri komentár vyššie. |

### 2.2 Zmeraná cena

Meraná tým istým výpočtom ako budget test: `json_encode(definitions(),
JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)`, **znaky delené 4** (nie bajty — popisy
nesú `—`, ktorý má 3 bajty a jeden token).

| tool | znaky | ≈ tok | z toho popis | z toho schéma |
|---|---:|---:|---:|---:|
| `mind_recall` (zmerané 21. 8.) | 1166 | 292 | 746 | 365 |
| **`spawn_agent`** (zmerané tu, §1.2) | **1335** | **334** | 635 | 647 |
| pole (`[`, `]`, 1 čiarka) | +3 | +1 | | |
| **profil `orchestrator`** | **2504** | **626** | | |

**Strop do testu: `'orchestrator' => 680`.**

Odvodenie stropu a jeho **kalibrácia** (bez nej test nič nedokazuje — to je pasca, na
ktorú tento projekt už raz naletel):

- Hlava 54 tokenov = **216 znakov**, teda +8,6 %. Je to v línii s ostatnými
  (`graph` 1246 → 1350 = +8 %, `files` 1304 → 1400 = +7 %).
- Pripojenie **300 znakov** výplne do `SpawnAgentTool::description()` zdvihne profil na
  2804 znakov = **701 tok** a test padne hláškou `profil orchestrator: 701 tok > 680`.
- Pripojenie 216 znakov dá presne 680 tok a test **prejde** — to je horná hrana, na ktorej
  sa kalibruje druhá strana.

### 2.3 Prečo `spawn_agent` NESMIE byť v `full` (§2a kontraktu)

Dva dôvody, obidva tvrdé:

1. **Číselný.** `full` = 2541 tok, `spawn_agent` = 334 tok → **2875 tok**, teda nad
   stropom 2600, ktorý je akceptačným kritériom §5/3. Kritérium by sa nedalo splniť bez
   skracovania popisov iných toolov, teda bez zhoršenia toho, čo popisy robia. To je ten
   istý výpočet, ktorý pred týždňom vylúčil `graph_focus` (2541 + 241 = 2782).
2. **Vecný.** `full` je profil, v ktorom sa **pracuje**. Model, ktorý má dvanásť
   pracovných toolov a k tomu `spawn_agent`, dostane trinástu možnosť, ako urobiť to isté
   — a delegovanie je najdrahšia z nich. Orchestrácia je iný **režim práce**, nie ďalší
   nástroj v tom istom.

Dôsledok pre kánon: `ToolRegistry::TOOLS` narastie na **14**. `PROFILES['full']` zostáva
znak po znaku dvanástka. `TOOLS ≠ PROFILES['full']` platí ďalej a už dnes je to
zdokumentované.

**Default sa nemení.** `config('hades.console.profile')` zostáva `full`; `orchestrator`
si beh vyžiada v requeste (`profile: 'orchestrator'`, validované proti
`array_keys(ToolRegistry::PROFILES)` — tá validácia už existuje). Žiadny existujúci beh
sa nezmení.

---

## 3. Dvojfázová brána v podagentovi — najdôležitejšia časť

### 3.1 Kto drží `pending` a kto o ňom rozhoduje

| vec | kde je |
|---|---|
| zápisový tool call podagenta | `console_tool_calls`, **`thread_id` = vlákno PODAGENTA**, `status = 'pending'`, s náhľadom |
| beh podagenta | `runs`, `status = 'waiting'`, `parent_run_id` = rodič |
| `spawn_agent` call rodiča | `console_tool_calls`, `thread_id` = vlákno rodiča, `status = 'pending'` (vrátené z `running`), **bez `result`** |
| beh rodiča | `runs`, `status = 'waiting'` |
| rozhodnutie človeka | `POST /api/console/decide` s **`thread` = uuid vlákna podagenta**, `call` = id pending callu podagenta |

`pending` teda drží **podagent**, na svojom vlákne, so svojím náhľadom. Rodič nedrží
`pending` na zápis — drží `pending` na `spawn_agent`, čo je „tento tool ešte nedopovedal".

**Prečo podagent dostane vlastné `ConsoleThread`** a nepíše do vlákna rodiča:

- `AgentRunner::history()` je viazaná na `thread_id`. Správy podagenta vo vlákne rodiča
  by sa dostali do kontextu rodiča — teda presne to, čomu sa podagentom vyhýbame.
- `runs` nesie členstvo **rozsahom id** (`from_message_id`–`to_message_id`) a rozsah je
  presný len preto, že vlákno beží jeden ťah naraz. Prekladané správy dvoch behov v jednom
  vlákne by ten predpoklad zrušili a **každý beh by hlásil cenu oboch**. Toto sa v tomto
  projekte už raz stalo (preto `openExclusive`), takže to nie je hypotéza.
- `pendingToolCall()` je per-vlákno. Vlastné vlákno znamená, že brána podagenta a brána
  rodiča sú rozlíšiteľné bez nového stavu.

### 3.2 Rámce protokolu (aditívne, staršieho klienta nerozbijú)

Štyri nové **top-level** typy. `runclient.js` má `default:` vetvu, ktorá neznámy `t` ticho
ignoruje — takže dnešná konzola a dok prežijú beh s podagentom bez zmeny (uvidia len
menej, nie chybu).

| rámec | kedy | nesie |
|---|---|---|
| `agent_start` | podagent vznikol | `run` (uuid podbehu), `thread` (uuid vlákna podagenta), `call` (id `spawn_agent` callu rodiča), `task`, `profile`, `max_steps` |
| `agent` | **každý** rámec podagenta | `run`, `frame` (celý rámec podagenta bez zmeny) |
| `agent_wait` | podagent zaparkoval; **ťah rodiča tu končí, BEZ `end`** | `run`, `thread`, `call` (id `spawn_agent` callu rodiča), `child_call` (id pending callu podagenta), `name` (meno zápisového toolu) |
| `agent_end` | podbeh sa uzavrel | `run`, `status`, `steps`, `tool_calls`, `tokens_in`, `tokens_out` |

**Prečo obálka (`{t:'agent', frame:{…}}`) a nie príznak na rámci podagenta.** Toto je
návrhové rozhodnutie s tromi nezávislými dôvodmi a nemá sa prehodnocovať v implementácii:

1. `runclient.js:route()` by na `t:'end'` dieťaťa **zavrel prúd rodiča** (`return true`)
   a na `t:'permission'` by nastavil `state.awaiting` na cudzí call. Príznak vedľa `t` by
   sa musel kontrolovať v každom `case` — teda v každej vetve, kde sa dá zabudnúť.
2. `RunRecorder::observe()` ráta `steps` na `t:'step'` a `tool_calls` na `t:'tool'`.
   Rámce dieťaťa idú cez `$emit` rodiča, takže s príznakom by sa **kroky dieťaťa
   pripočítali rodičovi**. `agent` v `STATEFUL` nie je, takže obálka to vylučuje
   konštrukciou, nie disciplínou.
3. Vlastný recorder dieťaťa (§5) počíta tie isté rámce **pred** zabalením, takže čísla
   sedia obom behom naraz.

**Pravidlo protokolu, ktoré sa tým dopĺňa** (a patrí do docblocku `runclient.js`):

> Ťah končí presne jedným **top-level** rámcom `end`, `error`, `permission` **alebo
> `agent_wait`**. Vnorené `end` / `error` / `permission` dieťaťa ťah rodiča nekončia.

`runclient.js` teda dostane: `case 'agent_wait': state.awaiting = {thread: f.thread, id: f.child_call, name: f.name}; call('onAgentWait', f); return true;` a
`case 'agent' | 'agent_start' | 'agent_end'` → `call('onAgent…', f); return false;`.
`state.awaiting` po novom nesie aj `thread`, pretože `/decide` sa posiela na **vlákno
podagenta**, nie na to, ktoré má klient otvorené. Volajúci (`chat`, `console`, dok)
posiela `thread: state.awaiting.thread ?? <vlastné vlákno>`.

### 3.3 Celá sekvencia, riadok po riadku

**Request A — `POST /api/console/run`** (vlákno rodiča, profil `orchestrator`):

```
1. RunController::run          → openExclusive(rodič) → runs#1 running
2. AgentContext::bind(rodičovské vlákno, runs#1, wrapped $emit, $aborted)
3. AgentRunner::drive          → step 1 → model vráti tool call spawn_agent
4. drain → executeCall         → call#7 status running, rámec `tool`
5. SpawnAgentTool::execute
     a. AgentContext musí byť naviazaný, inak ToolResult::refused (fail-closed)
     b. nájde vlastný riadok: newest ConsoleToolCall(name=spawn_agent, status=running)
        vo vlákne rodiča  → call#7
     c. Run::where('parent_call_id', 7) neexistuje → zakladá dieťa
     d. Subagent::start(...) → console_threads#2 (parent_thread_id=1, max_steps=4,
        tool_profile='files', auto_accept=false), runs#2 (parent_run_id=1,
        parent_call_id=7, source='agent')
     e. emit `agent_start`
     f. vlastný ToolRegistry (kánon → useProfile('files')) + vlastný AgentRunner
     g. childEmit = recorder->wrap(runs#2, fn($f) => parentEmit(['t'=>'agent',
        'run'=>runs#2->uuid,'frame'=>$f]))
     h. childRunner->run(thread#2, brief, childEmit, $aborted rodiča, options)
        → dieťa dá `write_file` → jeho drain zaparkuje → vnorený rámec `permission`
     i. thread#2->pendingToolCall() !== null → PARKED
     j. recorder->close(runs#2)  → status zostáva `waiting` (close() to rešpektuje)
     k. emit `agent_wait`        → recorder rodiča prepne runs#1 na `waiting`
     l. throw AgentParked
6. drain catch (AgentParked)    → call#7 status = 'pending', save, return true
7. drive vráti riadenie BEZ rámca `end`; prúd sa zavrie
8. finally v stream()           → recorder->close(runs#1) — `waiting`, teda sa nezatvára
```

Stav po requeste A: rodičovské vlákno má `pending` call (`spawn_agent`), vlákno podagenta
má `pending` call (`write_file`) s náhľadom, oba behy sú `waiting`. **Nikto sa nedostal
k zápisu.**

**Request B — `POST /api/console/decide`** (`thread` = uuid vlákna podagenta,
`call` = pending call podagenta, `decision` = `allow`):

```
1. validácia (nezmenená; `profile` je `prohibited` — už dnes)
2. thread#2 nájdené; `parent_thread_id` !== null → frames dieťaťa idú do OBÁLKY
3. tools->useProfile(thread#2->tool_profile)   ← 'files', zo SERVERA (nezmenené)
4. run = recorder->resume(thread#2)            ← runs#2 znovu `running`
5. childEmit = recorder->wrap(runs#2, withThreadState(thread#2,
      fn($f) => $emit(['t'=>'agent','run'=>runs#2->uuid,'frame'=>$f])))
6. runner->resume(thread#2, call, 'allow', childEmit, …)
      → zápis sa vykoná, dieťa dopovie, vnorený rámec `end`
7. recorder->close(runs#2) → status `done`, ended_at
8. emit `agent_end`
9. runs#2->parent_call_id !== null && ! runs#2->isOpen()  → POKRAČOVANIE RODIČA:
      Subagent::resumeParent($runner, $tools, runs#2, $emit, $aborted, $options)
        a. parentRun = runs#1, parentThread = thread#1, parentCall = call#7
        b. tools->useProfile(runs#1->tool_profile)   ← 'orchestrator'
        c. parentRun = recorder->resume(thread#1)     ← runs#1 znovu `running`
        d. runner->resume(thread#1, call#7, ALLOW, recorder->wrap(runs#1,
             withThreadState(thread#1, $emit)), $aborted, $options)
             → resume() vidí call#7 ako pending → executeCall(spawn_agent)
             → SpawnAgentTool nájde Run(parent_call_id=7), je uzavretý
             → NEZAKLADÁ druhé dieťa, vráti jeho zhrnutie
             → top-level `tool` + `tool_result` na karte spawn_agent
             → drive() pokračuje → top-level `end`
        e. finally: recorder->close(runs#1)
```

Klient v jednom prúde teda dostane: vnorené rámce dieťaťa → `agent_end` → top-level
`start`/`delta`/`tool_result`/`end` rodiča. To je pre klienta nová vec (dnes `/decide`
patrí jednému vláknu), a je to úloha vlny 2 v UI: **po `agent_end` sa pokračuje v bubline
rodiča.**

### 3.4 Idempotencia — prečo sa rodič nemôže „pretlačiť"

Kľúčová vlastnosť, na ktorej stojí kritérium §5/4, a je zámerne postavená tak, aby
neplatila z disciplíny volajúcich, ale **z konštrukcie toolu**:

> `SpawnAgentTool::execute()` sa najprv pozrie, či pre svoj `ConsoleToolCall` už dieťa
> existuje. Ak existuje a je **otvorené** (`running`/`waiting`), tool **znova vydá
> `agent_wait` a znova hodí `AgentParked`**. Nový podbeh nezakladá a zhrnutie nevydá.

Z toho vyplýva, že **žiadna cesta k modelu neobíde bránu**:

| pokus | čo sa stane |
|---|---|
| Človek pošle `/decide` na `spawn_agent` call rodiča s `allow` | `resume()` → `executeCall` → tool nájde dieťa vo `waiting` → **re-park**. Žiadny zápis. |
| Klient pošle ďalší `POST /run` na vlákno rodiča | `pendingToolCall()` vráti `spawn_agent` call → **422**, „Vlákno čaká na rozhodnutie o zápise." |
| Klient pošle `POST /run` na vlákno podagenta | nový guard (§7): vlákno s `parent_thread_id` **neprijíma správy**. |
| Model rodiča zavolá `spawn_agent` znova s tou istou úlohou | je to nový `ConsoleToolCall`, teda nové dieťa — a `max_children` (§8) to zastaví na treťom. |
| Request A zomrie (reštart kontejnera) | `pending` cally zostanú, oba behy vo `waiting`. `mind:reap-runs` **zaparkované nezametá** (čakajú na človeka a môžu čakať dni) — to je existujúce a správne chovanie. |

Ako sa tool nájde vlastný riadok bez toho, aby ho `AgentRunner` musel podávať:
`ConsoleToolCall::where('thread_id', kontext->threadId())->where('name','spawn_agent')
->where('status','running')->latest('id')->first()`. `executeCall()` nastaví `running`
**pred** volaním toolu, takže riadok existuje; smyčka beží tool cally po jednom, takže
najnovší `running` je vždy ten aktuálny. Bez tohto by `AgentRunner` musel dostať
`AgentContext` do konštruktora a nastavovať v ňom aktuálny call — o dva riadky diffu
viac v súbore, ktorý sa má dotknúť minimálne.

### 3.5 Zamietnutie a osirotené dieťa

Ak človek zamietne zápis **v podagentovi** (`deny` na jeho call), `denyCall()` vráti
modelu vetu „používateľ to zamietol", dieťa pokračuje inak alebo dopovie, a rodič sa
rozbehne normálne (§3.3 od kroku 7). Nič nové netreba.

Ak niekto zamietne **`spawn_agent` call rodiča** (cez API — UI takú možnosť nedá, je to
čítací tool bez potvrdzovacej karty), dieťa by zostalo naveky vo `waiting`. Preto:

```php
// RunController::decide, pred runner->resume():
if ($call->name === 'spawn_agent' && $data['decision'] === AgentRunner::DECISION_DENY) {
    $subagent->abandon($call);   // deny pending call dieťaťa + close(child, aborted: true)
}
```

`Subagent::abandon(ConsoleToolCall $parentCall): void`. Je to obranné, nie funkčné — ale
bez toho v logu behov zostane dieťa, ktoré nikdy neskončí, a `runs` prestane hovoriť
pravdu o tom, čo sa deje.

---

## 4. Podagent nesmie eskalovať profil (§5/5)

Päť vrstiev. Prvá je rada modelu, ostatné štyri sú vynútenie, a **každá funguje sama**.

1. **`enum` v schéme** (`memory|files|graph`) — model má vidieť, z čoho vyberá. Nie je to
   vynútenie; poskytovateľ enum nemusí kontrolovať.
2. **`SpawnAgentTool::CHILD_PROFILES` — konštanta v KÓDE, nie config.**
   ```php
   /** Profily, ktoré smie dostať podagent. `full` ani `orchestrator` tu NIE SÚ. */
   public const CHILD_PROFILES = ['memory', 'files', 'graph'];
   ```
   Ten istý argument ako pri `PROFILES`: členstvo rozhoduje o tom, ktoré **zápisové**
   tooly podagent vôbec má. V `.env` by to netestoval nikto a preklep by ticho pridal
   zápisový tool. Neznámy/nedovolený profil = **`ToolResult::refused()`** so zoznamom
   dovolených, nikdy fallback (fallback na `full` je tichý únik oprávnenia, fallback na
   menší profil by model nechal hlásiť „taký nástroj nemám" a človek by hľadal chybu
   v modeli).
   - `full` nie je dovolený: podagent s dvanástimi toolmi nie je podagent, je to druhá
     konzola. A dôvod existencie podagenta je zúženie.
   - `orchestrator` nie je dovolený: **tým je hĺbka stromu presne 1** a rekurzia
     `spawn_agent → spawn_agent` je nemožná. Na CPU-only stroji (§2b) je to podmienka,
     nie preferencia.
3. **`ToolRegistry` filtruje VYKONANIE, nie len ponuku.** Dieťa dostane vlastnú instanciu
   `new ToolRegistry()` (kánon) → `useProfile($profile)`. Keď si model dieťaťa vyžiada
   `write_file` v profile `graph` (pamätá si ho z inej konverzácie alebo si ho vymyslí),
   `call()` vráti `Unknown tool …` a **nič sa nevykoná**. Toto už dnes dokazuje
   `test_a_tool_outside_the_profile_is_refused_and_writes_nothing`.
4. **Profil dieťaťa je perzistovaný na jeho VLÁKNE** (`console_threads.tool_profile`) a
   `/decide` ho číta zo servera. Klient profil do `/decide` poslať nemôže — pravidlo
   `'profile' => 'prohibited'` už existuje presne preto, aby sa sada toolov nedala vymeniť
   medzi vyžiadaním povolenia a jeho vykonaním.
5. **Rodičov register sa dieťaťu nepodstrkáva.** `ToolRegistry` je v kontajneri singleton
   (a musí ním zostať — `RunController` a `AgentRunner` musia mať ten istý objekt).
   Keby dieťa použilo ten singleton a prepnulo mu profil, po zaparkovaní by zostal
   prepnutý pre zvyšok requestu rodiča. Preto **vlastná instancia**, nie `useProfile()`
   na spoločnej.

### Test, ktorý to dokazuje

```php
/**
 * §5/5 — podagent nesmie eskalovať profil, ani keď si ho vyžiada.
 *
 * Dve strany, obe musia platiť:
 *   (a) tool odmietne dovolenie, ktoré v `CHILD_PROFILES` nie je;
 *   (b) register dieťaťa NEVYKONÁ tool mimo profilu, aj keď ho model zavolá.
 *
 * KALIBRÁCIA: pridanie `'full'` do CHILD_PROFILES zhodí (a); zámena
 * `new ToolRegistry()` + useProfile za spoločný singleton zhodí (b), pretože
 * singleton má v teste profil `orchestrator`.
 */
public function test_a_subagent_cannot_escalate_its_profile(): void
{
    $this->assertSame(['memory', 'files', 'graph'], SpawnAgentTool::CHILD_PROFILES);

    foreach (['full', 'orchestrator', 'bash', 'FULL', ''] as $profile) {
        $result = $this->orchestratorRegistry()->call('spawn_agent', [
            'task' => 'Prečítaj README a povedz, čo je v ňom.',
            'profile' => $profile,
        ]);

        $this->assertTrue($result->failed, "profil {$profile} prešiel");
        $this->assertStringContainsString('memory, files, graph', $result->text);
        $this->assertSame(0, ConsoleThread::query()->whereNotNull('parent_thread_id')->count());
    }

    // (b) — register dieťaťa na profile `graph` nemá súborové tooly ani spawn_agent
    $child = new ToolRegistry();
    $child->useProfile('graph');

    foreach (['write_file', 'edit_file', 'read_file', 'grep', 'glob', 'spawn_agent'] as $name) {
        $result = $child->call($name, ['path' => 'x.txt', 'content' => 'y', 'task' => 't', 'profile' => 'files']);

        $this->assertTrue($result->failed, $name);
        $this->assertStringContainsString('Unknown tool', $result->text);
    }

    $this->assertFalse(File::exists($this->root.'/x.txt'));
}
```

---

## 5. `parent_run_id` — ako sa podbeh zapíše ako dieťa

### 5.1 Migrácia (jeden súbor, tri stĺpce)

`database/migrations/2026_08_25_000001_add_subagents_to_runs_and_console_threads.php`

```php
Schema::table('runs', function (Blueprint $table): void {
    // Rodičovský beh. `nullOnDelete` a nie kaskáda: log má prežiť zmazanie rodiča,
    // rovnako ako dnes prežije zmazanie vlákna. Osirotené dieťa je pravdivý záznam,
    // zmazané dieťa je diera.
    $table->foreignId('parent_run_id')->nullable()->after('thread_id')
        ->constrained('runs')->nullOnDelete();

    // `spawn_agent` call, ktorý toto dieťa vyžiadal. Robí z pokračovania rodiča
    // vyhľadanie podľa kľúča namiesto úsudku „jediný blokovaný call vo vlákne" —
    // ten úsudok dnes platí (cally sa vykonávajú po jednom), ale platí náhodou.
    $table->foreignId('parent_call_id')->nullable()->after('parent_run_id')
        ->constrained('console_tool_calls')->nullOnDelete();

    $table->index(['parent_run_id', 'id']);
});

Schema::table('console_threads', function (Blueprint $table): void {
    // Vlákno podagenta. Non-null = nie je to konverzácia (§7): nezobrazuje sa
    // v zozname vlákien a neprijíma nové správy.
    $table->foreignId('parent_thread_id')->nullable()->after('uuid')
        ->constrained('console_threads')->nullOnDelete();

    // Strop kôl TOHTO vlákna. `null` = strop z configu (dnešné chovanie, všetky
    // existujúce vlákna). Je to na VLÁKNE a nie v `$options`, aby ho `/decide`
    // čítalo zo servera — presne z toho istého dôvodu ako `tool_profile`.
    $table->unsignedTinyInteger('max_steps')->nullable()->after('tool_profile');
});
```

`runs.source` dostane hodnotu `'agent'`. **Migrácia netreba** — `source` je `string(32)`
a v migrácii je napísané, že práve preto (enum by si vyžiadal migráciu na každý nový
zdroj).

`console_tool_calls.status` je **enum** `['pending','running','done','denied','failed']` a
**nemení sa**. To bol jeden z dôvodov, prečo `spawn_agent` call rodiča ostáva `pending`
a nedostal nový stav `blocked`: nový stav = migrácia enumu na hot tabuľke a nová vetva
v každom `match`i, ktorý status čítá.

Fillable/casts: `Run::$fillable` += `parent_run_id`, `parent_call_id`;
`ConsoleThread::$fillable` += `parent_thread_id`, `max_steps`.

### 5.2 `RunRecorder` — čo pribudne

Recorder zostáva visieť na `$emit` a **`AgentRunner` sa ho ďalej netýka.** Tri zmeny:

```php
/** Rámce, ktoré nesú stav behu. `agent`, `agent_start` a `agent_end` tu ÚMYSELNE NIE SÚ. */
private const STATEFUL = ['step', 'tool', 'permission', 'agent_wait', 'end', 'error'];

// observe(), nová vetva match-u:
'agent_wait' => $run->status = 'waiting',
```

> `agent` v `STATEFUL` byť nesmie. Rámce dieťaťa idú cez `$emit` rodiča, takže by sa
> `steps` a `tool_calls` dieťaťa pripočítali rodičovi. Dieťa má vlastný recorder na
> vlastnom behu (§5.3) a počíta si ich pred zabalením.

```php
/**
 * Podbeh — dieťa behu rodiča. Vlastná metóda a nie parameter v `open()`:
 * `open()` volajú dve existujúce cesty a jej podpis sa nemá hýbať.
 */
public function openChild(
    ConsoleThread $thread,
    Run $parent,
    ConsoleToolCall $parentCall,
    string $task,
    array $options = [],
): Run {
    $run = $this->open($thread, $task, $options, source: 'agent');

    $run->parent_run_id = $parent->id;
    $run->parent_call_id = $parentCall->id;
    $run->save();

    return $run;
}
```

A jedna oprava, ktorú si vynúti dvojnásobné zatvorenie v jednom requeste (§3.3: v Requeste
B sa zatvára dieťa aj rodič):

```php
public function close(Run $run, bool $aborted = false): void
{
    // Uzavretý beh sa nezatvára druhý raz. Bez tohto by `ended_at` a `duration_ms`
    // prepísalo druhé volanie v tom istom requeste a trvanie dieťaťa by obsahovalo
    // aj pokračovanie rodiča. (Latentné aj dnes; s podagentmi sa to stane vždy.)
    if ($run->ended_at !== null) {
        return;
    }
    …
}
```

Je to bezpečné aj pre existujúce cesty: `resume()` hľadá beh cez `open()` scope
(`running`/`waiting`), a taký `ended_at` nastavený nemá.

### 5.3 Kto zakladá podbeh a s akým `$emit`

`Subagent::start()` — jediné miesto:

```php
public function start(
    AgentContext $ctx,          // rodičovské vlákno, beh, $emit, $aborted
    ConsoleToolCall $parentCall,
    string $task,
    string $profile,
    int $maxSteps,
): SubagentOutcome
```

Vo vnútri, v tomto poradí:

1. `ConsoleThread::create([... 'parent_thread_id' => rodič, 'tool_profile' => $profile,
   'max_steps' => $maxSteps, 'provider' => rodič->provider, 'model' => rodič->model,
   'auto_accept' => false, 'title' => titleFrom($task)])`
2. `$run = $recorder->openChild($childThread, $ctx->run(), $parentCall, $task, ['profile' => $profile])`
3. `$ctx->emit(['t' => 'agent_start', …])`
4. `$registry = new ToolRegistry(); $registry->useProfile($profile);`
5. `$runner = new AgentRunner($this->providers, $this->prompt, $registry);` —
   **`new`, nie z kontajnera**: kontajner by vrátil AgentRunner so singleton registrom
   (profil rodiča) a `SpawnAgentTool` nemôže injektovať `AgentRunner` ani `ToolRegistry`
   (cyklus `AgentRunner ← ToolRegistry ← SpawnAgentTool`). `Subagent` preto injektuje len
   `ProviderFactory`, `SystemPrompt` a `RunRecorder` — ani jeden z nich `ToolRegistry`
   nepotrebuje, takže cyklus nevzniká.
6. `$childEmit = $recorder->wrap($run, fn (array $f) => $ctx->emit(['t' => 'agent', 'run' => $run->uuid, 'frame' => $f]));`
7. `$runner->run($childThread, $this->brief($task), $childEmit, $ctx->aborted(), $options);`
   — **`$aborted` je rodičov**, jeden pre celý strom. Stop v prehliadači zastaví dieťa aj
   rodiča; bez toho by dieťa dogenerovávalo do mŕtveho socketu ďalšie minúty.
8. `$parked = $childThread->fresh()->pendingToolCall() !== null;` — parkovanie sa zisťuje
   z **DB**, nie odpozeraním rámcov. Rámce sa dajú prehliadnuť, `pending` riadok nie.
9. `$recorder->close($run, $ctx->aborted()())` — pri `waiting` `close()` len doplní
   `to_message_id` a cenu, stav nechá (existujúce chovanie).
10. `return new SubagentOutcome($run, $parked, $childThread, $answer, $truncated);`

### 5.4 Log behov a MCP — presné mená polí

`runs` je strom, takže UI aj MCP potrebujú dve nové polia. **Ide o `uuid`, nie `id`** —
`runs.uuid` existuje presne preto, aby verejný identifikátor neprezrádzal poradie
ani počet behov.

| serializér | pole | hodnota |
|---|---|---|
| `RunsScreen::row()` | `parent` | uuid rodičovského behu; **vynechá sa, keď je null** |
| `RunsScreen::fieldsForAi()` | `items[].parent` | to isté |
| `RunDetailScreen::data()` | `children[]` | `{uuid, status, prompt, profile, steps, tool_calls, tokens_out, duration_ms}` |
| `RunDetailScreen::fieldsForAi()` | `children[].uuid`, `.status`, `.prompt`, `.profile`, `.steps`, `.tokens_out` | |

Model: `Run::parent(): BelongsTo` a `Run::children(): HasMany` (`parent_run_id`).
Strom sa skladá v serializéri (dáta), nie v prehliadači — pravidlo „dátové veci na server,
slová do prehliadača". Odsadenie, ikony a text „podagent" sú slová.

Obrazovka Runy nie je nová obrazovka, takže do `ScreenParityTest::registry()` **nič
nepribúda** — pribudnú len kľúče, ktoré si test vynúti sám.

---

## 6. CPU strop (§2b) — kde sa vynúti a čo sa stane pri prekročení

### 6.1 ODCHÝLKA: „max 2–3 paralelne" je v tomto návrhu „max 3 za sebou"

Kontrakt C-3 a §2b hovoria „paralelne max 2–3". **V tomto návrhu neexistuje žiadna
paralelnosť a je to zámer**, ktorý orchestrátor musí vidieť a odklepnúť:

- `spawn_agent` sa vykonáva **synchronne vnútri** `AgentRunner::drain()` rodiča. Aj keď
  model vyžiada tri tool cally v jednom kroku, `drain()` ich odpracuje jeden po druhom.
- Skutočná paralelnosť by potrebovala frontu a workerov, teda **druhú cestu k modelu**,
  ktorú kontrakt §4 zakazuje.
- A nemala by čo priniesť: inferencia je CPU-only (~8 tok/s na `qwen3:8b`). Tri súbežné
  behy si delia tie isté jadrá, takže tri podagenty naraz sú tri podagenty ~3× pomalšie.
  Wall clock sa nezlepší, spotreba RAM a riziko swapu áno.

Čo z kontraktu teda platí: **strop na počet podagentov je 3** a **strop krokov na
podagenta je 4 (default) / 6 (max)**. Časový rozpočet, aby bolo vidieť, čo to znamená:
jedno kolo dieťaťa ~250 tok výstupu ≈ 31 s, štyri kolá ≈ 2 min, tri deti ≈ **6 min**
plus vlastné kolá rodiča. Rámce tečú celý čas (flush po každom), takže idle timeouty
Caddy/ngrok to neohrozia; `hades.console.ollama.timeout` je per-request 900 s a jedno kolo
sa doň vojde.

### 6.2 Config vs. konštanta — a prečo obe

```php
// config/hades.php → 'console' => [ … ]
// Podagenti (spawn_agent). Sú to VÝKONOVÉ stropy tohto stroja, nie bezpečnostná
// hranica — preto config: používateľ ich musí vedieť stiahnuť bez deploya. Sada
// dovolených profilov je naopak v kóde (SpawnAgentTool::CHILD_PROFILES), pretože
// tá rozhoduje o zápisových tooloch.
'agent' => [
    'max_children'  => (int) env('HADES_AGENT_MAX_CHILDREN', 3),
    'max_steps'     => (int) env('HADES_AGENT_MAX_STEPS', 6),
    'default_steps' => (int) env('HADES_AGENT_STEPS', 4),
    'result_chars'  => (int) env('HADES_AGENT_RESULT_CHARS', 2000),
],
```

A tvrdé podlahy/stropy v kóde, ktoré `.env` neprebije:

```php
/** Nad tieto čísla sa `.env` nedostane. Preklep v konfigurácii nesmie zapáliť CPU na hodinu. */
private const HARD_MAX_CHILDREN = 5;
private const HARD_MAX_STEPS = 8;
```

Čítanie je vždy `min(config(...), self::HARD_…)`. Dôvod: `hades.console.max_steps` má dnes
strop 12 a existuje presne preto, že *„model vie zacykliť dvojicu hľadaj → prečítaj
a spáliť hodinu CPU"*. Podagent je ten istý risk vynásobený počtom detí, takže
konfigurovateľnosť bez podlahy by bola krok späť.

### 6.3 Čo sa stane pri prekročení

| prekročenie | reakcia |
|---|---|
| 4. podagent v tom istom behu | `ToolResult::refused('Strop 3 podagentov na tento beh je vyčerpaný. Dokonči úlohu sám alebo povedz človeku, čo ešte treba.')` — **odmietnutie, nie výnimka**: model musí dostať výsledok na každé volanie a musí z neho vedieť, čo urobiť inak. |
| `max_steps: 20` | clamp na 6, skutočná hodnota sa vráti v `ToolResult` (`"max_steps":6`), aby model nepočítal s tým, čo nedostal. |
| `max_steps: 0` alebo nezmyselný typ | clamp na 1 (`BaseTool::optionalInt()` + `max(1, …)`), bez odmietnutia. |
| dieťa narazí na svoj strop kôl | `AgentRunner` uzavrie ťah s `stop_reason = 'max_steps'`; `agent_end` to nesie a `spawn_agent` vráti `"status":"done"` so `stop_reason`. `runstate.js` má na `max_steps` vetu už dnes. |
| `AgentContext` nie je naviazaný (MCP, artisan, tinker) | `ToolResult::refused('spawn_agent runs only inside a console run.')` — fail-closed. Bez toho by `spawn_agent` vystavený mimo behu zakladal behy bez rodiča a bez `$emit`, čiže bez brány. |

Počítanie detí: `Run::where('parent_run_id', $ctx->run()->id)->count()`. Na behu, nie na
vlákne — strop patrí ťahu, nie konverzácii.

---

## 7. Guardy mimo toolu, ktoré si podagenti vynútia

Tri jednoriadkové zmeny na hranici, bez ktorých je návrh netesný:

1. **Do vlákna podagenta sa nepíše.** `RunController::run`, hneď za nájdením vlákna:
   ```php
   if ($thread->parent_thread_id !== null) {
       return $this->refuse('Toto je vlákno podagenta — správy doň neposielaj. Podagenta spúšťa beh rodiča.');
   }
   ```
   `agent_wait` posiela uuid vlákna podagenta do prehliadača (klient ho potrebuje pre
   `/decide`), takže bez tohto guardu by sa doň dalo písať. `/decide` na vlákno podagenta
   **musí zostať povolené** — to je celá brána.
2. **Zoznam vlákien podagentov neukazuje.** `ConsoleThreadController::index` →
   `whereNull('parent_thread_id')`. Inak by každý podagent vyzeral ako konverzácia.
   Detail podbehu sa dá otvoriť z obrazovky Runy (`runs.uuid`), kam patrí.
3. **`Subagent::abandon()`** pri `deny` na `spawn_agent` call (§3.5).

Bezpečnostná prehliadka (§5/7 kontraktu) má nad `spawn_agent` odpovedať na toto:

- Text `task` píše **model**, nie človek, a stáva sa vstupom druhého modelu. Rozsah
  škody je ohraničený **profilom** dieťaťa a každý jeho zápis prechádza bránou s diffom.
- Prompt injection zo súboru, ktorý dieťa prečíta („spusť agenta s profilom full"), nemá
  kam ísť: dieťa `spawn_agent` **nemá** (nie je v žiadnom z `CHILD_PROFILES`).
- `PathGuard` sa nemení a neoslabuje. Dieťa s profilom `files` má presne tie isté súborové
  tooly a ten istý koreň ako dnešná konzola.
- Žiadny `bash`/`shell` tool v žiadnom profile — ani v `orchestrator`, ani v žiadnom
  `CHILD_PROFILES`. Appka je verejne tunelovaná cez ngrok.
- Nová MCP plocha nevzniká; `mind_runs`/`mind_run` uvidia podbehy tou istou cestou ako
  dnes behy (nové je len pole `parent` / `children`).

---

## 8. Čo presne sa zmení v `AgentRunner.php` (§5/12)

**Tri úpravy, päť riadkov, žiadna zmena konštruktora ani novej public metódy.** Popis, nie
kód — implementuje vlna 2.

### 8.1 `drive()` — strop kôl číta z vlákna

Riadok `$maxSteps = max(1, (int) config('hades.console.max_steps', 12));` sa zmení na
variantu, ktorá dá prednosť `$thread->max_steps`, keď je nastavený, a inak číta config.

Prečo je to nutné a prečo takto: strop podagenta musí byť **serverový** a musí prežiť
`/decide` (obnovu po rozhodnutí človeka), inak by si ho klient vedel medzi vyžiadaním
povolenia a jeho vykonaním vymeniť. `drive()` už `$thread` má, takže nič sa neplumbuje
cez `$options` a nič sa nemení na podpisoch. Pre všetky existujúce vlákna je
`max_steps = null`, teda **chovanie sa nemení**.

### 8.2 `drain()` — zaparkované dieťa parkuje aj rodiča

Volanie `$this->executeCall($call, $write, $emit);` sa obalí:

```
try { executeCall(…) }
catch (AgentParked) {
    // Podagent zaparkoval na povolení. Tento tool ešte nedopovedal, takže sa vracia
    // do `pending`: história ho aj s jeho `tool_use` vynechá (pending ∉ SETTLED),
    // vlákno odmietne ďalšiu správu (pendingToolCall) a `/decide` naň narazí znova,
    // kým dieťa čaká. `permission` sa TU nevydáva — vydalo ho dieťa, vnorene.
    $call->status = 'pending'; $call->save();
    return true;    // volajúci sa vráti BEZ rámca `end` (tak je protokol napísaný)
}
```

`return true` je existujúci mechanizmus — `drain()` ho už dnes používa na parkovanie
zápisu, a `drive()` aj `resume()` naň už reagujú správne (`resume()` navyše zahodí
prázdnu bublinu cez `dropUnused()`). Nový je len dôvod.

### 8.3 `resume()` — `write` v rámci `tool` prestane lhať

`$this->executeCall($call, true, $emit);` → `$this->executeCall($call, $this->registry->isWrite($call->name), $emit);`

Pre každý dnešný zápisový tool je to **identické chovanie** (`isWrite()` je `true`).
Zmena je nutná preto, že cestou pokračovania rodiča ide cez `resume()` **čítací**
`spawn_agent` a rámec by ho označil `write: true` — teda UI by na karte čítacieho toolu
napísalo „zápis". To je presne ten druh tichého rozchodu plochy a pravdy, ktorý audit
19. 8. našiel na šiestich miestach.

### 8.4 Čo sa v `AgentRunner.php` NEMENÍ

Aby bolo jasné, čo je mimo dohody: `history()`, `enqueue()`, `executeCall()`,
`openAssistant()`, `closeAssistant()`, `endFrame()`, `guarded()`, `systemPrompt()`,
konštruktor, `run()`, `resume()` (okrem 8.3), `RESULT_FRAME_CAP`, `SETTLED`. Recorder sa
`AgentRunner`u ďalej **netýka** — visí na `$emit` v `RunController`i a tak to má zostať.

---

## 9. Testy (§5/3, §5/4, §5/5) — presné mená a čo dokazujú

`tests/Feature/ConsoleToolsTest.php` (do existujúcich sekcií):

| test | dokazuje | kalibrácia |
|---|---|---|
| `test_tool_definitions_stay_inside_the_budget_of_every_profile` (rozšírený `$caps += ['orchestrator' => 680]`) | §5/3 | +300 znakov do popisu → `701 tok > 680` (§2.2) |
| `test_orchestrator_profile_is_exactly_recall_and_spawn` | členstvo nemôže tichom narásť | pridanie `read_file` zhodí `assertSame` |
| `test_full_profile_is_exactly_todays_twelve` (+ `assertNotContains(SpawnAgentTool::class, PROFILES['full'])`) | §2a | pridanie do `full` zhodí obe asercie |
| `test_spawn_agent_is_a_read_tool_without_a_preview` | §1.4 | |
| `test_a_subagent_cannot_escalate_its_profile` | §5/5 | pozri §4 |
| `test_spawn_agent_refuses_outside_a_run` | fail-closed bez `AgentContext` | |
| `test_spawn_agent_clamps_max_steps_and_stops_at_the_child_cap` | §2b / §6.3 | `20 → 6`, `0 → 1`, chýbajúci `→ 4`, 4. dieťa odmietnuté |
| `test_read_tools_run_without_asking_and_write_tools_do_not` (menovitý zoznam) | `spawn_agent` na čítacej strane | |
| `test_read_tools_have_no_preview` (menovitý zoznam) | | |

Nový súbor `tests/Feature/SubagentGateTest.php` — dvojfázová brána v podagentovi. Používa
`fakeProvider()` a `fakeTools()` z `ConsoleRunTest` (skript odpovedí modelu; pre dieťa
stačí, že fake poskytovateľ je naviazaný na `OllamaProvider::class` v kontajneri, takže ho
`new AgentRunner(...)` v `Subagent` dostane cez `ProviderFactory`).

| test | asercie |
|---|---|
| `test_a_write_inside_a_subagent_parks_the_parent_turn_without_an_end_frame` (**§5/4**) | v prúde je `agent_start`, potom `{t:'agent', frame:{t:'permission'}}`, potom `agent_wait`; **žiadny top-level rámec `end`**; `spawn_agent` call rodiča má `status='pending'` a `result === null`; `runs` dieťaťa `waiting` + `parent_run_id`/`parent_call_id`/`source='agent'`; `runs` rodiča `waiting`; uzol/súbor, ktorý dieťa chcelo zapísať, **neexistuje** |
| `test_the_parked_subagent_resumes_only_from_decide` | `POST /api/console/run` na vlákno rodiča → 422 a zápis stále neexistuje; potom `POST /api/console/decide` (vlákno dieťaťa) → zápis existuje, prúd nesie `agent_end` **aj** top-level `end`, `spawn_agent` call rodiča je `done` a jeho `result` obsahuje odpoveď dieťaťa |
| `test_the_parent_cannot_push_past_the_child_gate` | `/decide` na `spawn_agent` call **rodiča** s `allow`, kým dieťa čaká → prúd nesie `agent_wait` znova, **žiadny `end`**, zápis stále neexistuje, druhé dieťa nevzniklo (`Run::where('parent_call_id', …)->count() === 1`) |
| `test_a_subagent_thread_is_not_a_conversation` | `GET /api/console/threads` vlákno dieťaťa neobsahuje; `POST /api/console/run` naň → 422; `/decide` naň → funguje |
| `test_denying_the_spawn_call_abandons_the_child` | dieťa má `denied` call a beh `aborted`, nič nezostane vo `waiting` |
| `test_the_child_run_never_pays_for_the_parent_and_back` | rodičove `steps`/`tool_calls` neobsahujú kroky dieťaťa (dôkaz, že `agent` nie je v `STATEFUL`); `duration_ms` dieťaťa sa druhým `close()` nezmení |

`tests/Feature/RunLogTest.php` dostane jeden prípad na strom (`parent` v `RunsScreen`,
`children[]` v `RunDetailScreen`, `fieldsForAi()` parita).

---

## 10. Otvorené body — rozhodnutie pre orchestrátora PRED vlnou 2

1. **ODCHÝLKA §6.1: „paralelne 2–3" je implementované ako „3 za sebou".** Reverzibilné
   len v zmysle „dá sa to niekedy dorobiť frontou" — ale front = druhá cesta k modelu,
   ktorú kontrakt §4 zakazuje. **Potrebujem áno/nie, nie ticho.**
2. **Dedí podagent `auto_accept` rodiča?** Navrhujem **NIE** (dieťa má
   `auto_accept = false` vždy): „Povoliť vždy" človek udelil vláknu, ktorého zápisy videl
   v prúde, a zadanie podagenta nepísal. Dôsledok, ktorý sa nemusí páčiť: aj so zapnutým
   auto-accept sa beh na zápise podagenta **zastaví**. Reverzibilné, ale je to UX
   rozhodnutie, nie technické.
3. **Má `orchestrator` naozaj len dva tooly?** Ak orchestrátor chce aj `mind_read`
   a `mind_overview`, strop v teste treba zdvihnúť z 680 na ~910 a povedať to **pred**
   napísaním testu, nie po ňom (`overview` 105 + `read` 175 tok). Tokeny to neriešia
   (626 je najlacnejší profil zo všetkých); riešim tým **kvalitu voľby modelu**.
4. **`full` medzi `CHILD_PROFILES`?** Navrhujem nie (§4). Ak áno, treba počítať s tým, že
   dieťa bude mať 2541 tok definícií a bude to „druhá konzola", nie podagent.
5. **Kde je `orchestrator` v UI?** Návrh predpokladá, že `/chat` posiela
   `profile: 'orchestrator'` len keď to človek zapne (prepínač alebo režim vlákna).
   Default zostáva `full`. Kto vlastní ten ovládač, patrí do rozdelenia vlny 2.
6. **`console_threads.max_steps` vs. `runs.max_steps`.** Zvolil som vlákno, aby to bola tá
   istá cesta ako `tool_profile` (jedno miesto, kde `/decide` čítá serverovú pravdu).
   Nevratné to nie je, ale meniť to po vlne 2 znamená druhú migráciu.

---

## 11. Zhrnutie — čo si má vlna 2 zapamätať v troch vetách

1. Podagent je **vlastné vlákno + vlastný beh + vlastný `ToolRegistry`**, ktorého rámce
   idú do prúdu rodiča **zabalené** v `{t:'agent', run, frame}`.
2. Keď podagent zaparkuje, hodí `AgentParked`; `drain()` vráti `spawn_agent` call rodiča
   do `pending`, ťah skončí **bez `end`** a jediná cesta ďalej je
   `POST /api/console/decide` **na vlákno podagenta** — po ktorom sa v tom istom requeste
   dopočíta zhrnutie a rozbehne rodič.
3. `spawn_agent` je **idempotentný na svoj `ConsoleToolCall`**, takže kým dieťa čaká,
   každé opakované vykonanie zaparkuje znova. Bránu nemá ako obísť ani rodič, ani klient.
