# Zložkovanie — štruktúra kódu a dátový tok ingestu

Dva dokumenty v jednom: **kde čo v repozitári žije** a **ako sa spomienka dostane
z transcriptu do siete**. Rozhodnutia zo kôl 15.–16. 7. 2026, aktualizované po
rozsekaní ingestu vo W2 (balík P3).

---

## 1. Štruktúra priečinkov

### 1.1 Backend (`app/`)

```
app/
  Console/Commands/**       artisan príkazy (mind:* / aura:*), tenké — logika je v službách
  Events/MindPulse.php      pulzy na public kanál (canvas ich kreslí)
  Http/Controllers/**       API + MCP; controller nič nepočíta, len volá službu
  Http/Middleware/**        auth token, MCP bearer, throttle
  Llm/**                    ChatProvider + Ollama/Anthropic/Null provider + DTO (P5)
  Mcp/**                    MCP server (aura_* tooly, mind_* aliasy)
  Models/**                 Eloquent: Node, Edge, Activation, Area, Department, Tag,
                            Decision, Tombstone, SyncRun, BrainSource
  Services/
    Brain/**                indexer ľudsky písaných .md „mozgov" (origin=brain)
    Chat/**                 chatová vrstva (P5)
    Embeddings/**           embeddingy uzlov (P1)
    Ingest/**               ⟵ ingest Claude Code transcriptov (tento dokument, §2)
    Maintenance/**          nočná údržba: rewire, decay, dry-run (P2)
    Recall/**               RecallEngine — lexikálna + vektorová vetva (P1)
    Similarity/**           TF-IDF korpus a skórovanie (P1)
    ClaudeMemoryIngestService.php   Claude memory .md → memory uzly
    GraphService.php · SearchService.php · NodeMarkdownResolver.php
    MindService.php · SimilarityService.php · SummaryService.php
    TranscriptIngestService.php     orchestrátor ingestu (§2.2)
```

Pravidlá, ktoré tu platia:

- **Príkaz nič nepočíta.** `app/Console/Commands/*` len vyparsuje voľby, zavolá
  službu a vypíše tabuľku. Preto sa dá každý job spustiť aj z testu bez `artisan`.
- **Jeden zápis = jedna trieda.** Do `nodes` píše pri ingeste iba
  `Ingest\SessionWriter`, do `.md` mozgu iba `Brain\BrainWriter`. Keď treba
  dohľadať, kto niečo prepísal, hľadá sa na jednom mieste.
- **Detekcia tajomstiev má jediný zdroj pravdy** — `Brain\SecretScanner`.
  Volá ho MCP, brain-writer aj ingest (§3).

### 1.2 Frontend (`resources/`)

Rozdelenie vzniklo vo W0; strop je **400 LOC na súbor** (cieľ 250) a farebné
literály smú byť len v `css/tokens.css` a `css/dark.css`.

```
resources/
  views/mind.blade.php · views/app.blade.php · views/partials/**
  js/app.js                 boot poradie (jediné miesto, kde sa volá register())
  js/core/**                api.js, store.js, bus.js, events.js, state/** (zamknuté rozhrania)
  js/graph/**               canvas: render/**, physics, interaction, data
  js/shell/** js/dock/** js/node/**   rail, header, dock, nastavenia, panely
  js/chat/** js/screens/** js/charts/**
  css/app.css               @import list — jeho poradie JE kaskáda
  css/{tokens,dark,responsive}.css + css/{base,components,shell,graph,chat,screens,dock}/**
```

### 1.3 Testy a dokumentácia

```
tests/Unit/**            čisté funkcie (bez DB) — parser, guard, frontmatter, scanner
tests/Unit/Ingest/**     parser transcriptov, heuristika titulku, brána návrhov modelu
tests/Feature/**         proti REÁLNEJ MariaDB (auraai_test), RefreshDatabase
tests/Support/**         FakeProvider (#12), Ingest/BuildsTranscripts (fixtúry transcriptov)
tests/snapshots/**       payload kontrakty API — zmena tvaru = padajúci test
tests/js/** tests/e2e/**  Vitest + Playwright
docs/zlozkovanie.md      tento dokument · docs/dizajn.md · docs/BENCHMARK-LLM.md
```

### 1.4 Generované výstupy (mimo gitu)

| Priečinok | Čo | Kto zapisuje |
|---|---|---|
| `summaries/sessions/<id>.md` | dokument jednej session | `Ingest\SessionWriter` |
| `summaries/projects/<slug>.md` | živý roll-up projektu | `mind:rollup` |
| `directives/` | poskládané smernice | `DirectiveController` |
| `backups/auraai-<date>.sql` | denná záloha DB (rotácia 14 dní) | scheduler 03:00 |
| `storage/app/dry-run/` | reporty deštruktívnych jobov | `aura:dry-run` |

---

## 2. Ingest Claude Code transcriptov

### 2.1 Čo je vstup

Transcripty sú **read-only mount** (`C:/Users/Ucet/.claude/projects` →
`/transcripts:ro`), jeden JSONL súbor na session, glob `/transcripts/*/*.jsonl`.
Parser sa pozerá na štyri druhy riadkov: hlavičku session (`sessionId`, `cwd`,
`gitBranch`, `timestamp`), používateľské prompty (`type: queue-operation`,
`operation: enqueue`), `tool_use` bloky asistenta a jeho finálny `text`.

### 2.2 Dátový tok

```
/transcripts/<projekt>/<session>.jsonl
        │
        ▼  TranscriptParser                      (app/Services/Ingest)
   surový záznam { session_id, project, cwd, git_branch, started_at, ended_at,
                   prompts[], files[], commits[], tools{}, final }
        │        · redakcia tajomstiev (§3) hneď pri čítaní
        │        · filter šumu: prompty < 15 znakov, stoplist, systémové bloky
        ▼
   TranscriptIngestService  ── náhrobok? ──▶ stop (žiadny zombie, §4)
        │  (orchestrátor)
        ├──▶ SessionClassifier    projekt → oblasť + oddelenie „Záznamy — <projekt>"
        ├──▶ SessionWriter        meta → uzol (create / --force-refresh / update)
        │       ├── SessionTitler       titulok (heuristika, voliteľne návrh modelu)
        │       ├── SessionSummarizer   zhrnutie (extraktívne, voliteľne abstraktívne)
        │       └── SummaryService      .md dokument do summaries/sessions/
        └──▶ SessionLinker        projektová hrana · skill zmienky · posilnenie
                                  použitých skillov · top-3 podobné uzly
        │
        ▼
   MindPulse('node.created')  →  canvas rozsvieti nový uzol
```

Prepojenia, posilnenia, pulz a `.md` sa robia **len pri skutočnom vzniku** uzla.
Opakovaný ingest tej istej session nie je nová aktivita.

### 2.3 Tri zápisové cesty

| Situácia | Čo sa zapíše |
|---|---|
| uzol neexistuje | plný obsah + `created_at` spätne na začiatok session + hrany + pulz |
| `--force-refresh` | plný refresh vrátane labelu/oblasti/oddelenia; **sila zostáva** |
| uzol existuje | **len `meta` + `last_activated_at`** |

Tretí riadok je ochrana manuálnych úprav: label, popis, oblasť, oddelenie ani
sila sa pri bežnom ingeste nikdy neprepíšu. Rastúca session sa dopĺňa podľa
`filemtime` súboru vs `meta.ingested_at`.

Jednorazová oprava: `php artisan mind:ingest --all --force-refresh`.

### 2.4 Preteky dvoch behov

Zápis ide cez `firstOrCreate`, nie `create`. Medzi „SELECT nenašiel uzol" a
„INSERT" môže ten istý `external_key` vložiť iný beh — 10-minútový `mind:ingest`
proti nočnému `--all`, alebo dve súbežné Claude Code sessions píšuce do práve
prebiehajúceho transcriptu. Check-then-act tu padal na
`nodes_external_key_unique` (SQLSTATE[23000], doložené 3× v `laravel.log` za 13
dní). Kto preteky prehrá, prepne sa na UPDATE cestu — nezdvojí hrany, `.md` ani
pulz a nechá cudzí label na pokoji. Stráži to
`Tests\Feature\TranscriptIngestTest::test_parallel_ingest_of_the_same_session_creates_one_node`,
ktorý preteky simuluje deterministicky (cudzí zápis presne po SELECT-e).

### 2.5 Titulok a meta

**Titulok** (heuristika, bez modelu): prvá veta prvého zmysluplného promptu, max
60 znakov bez rozseknutia slova; zlúpne úvodné `/príkazy` a URL; nikdy nezačína
na `http`, `www.` ani `/`. Fallback `<projekt> — práca <dátum>`.

**Kľúče `meta`** — sú kontrakt, čítajú ich dashboard, denník aj knižnica, preto sa
smú len pridávať:

| Kľúč | Význam |
|---|---|
| `session_id`, `project`, `cwd`, `git_branch` | identita session |
| `started_at`, `ended_at`, `ingested_at` | časy (posledný riadi inkrementálny ingest) |
| `prompts` (max 8), `prompt_count`, `noise_filtered` | vstup používateľa po filtre šumu |
| `files` (max 20), `file_count` | cesty relatívne k `cwd` |
| `commits`, `tools`, `final` | výstup práce a záverečný text |
| `summary_path` | `summaries/sessions/<id>.md`, ak sa zapísal |
| `absorbed_keys` | kľúče pohltené merge-om/archívom |
| `summary_by` | `llm`, keď zhrnutie navrhol model (inak kľúč nevznikne) |
| `generated_by` | audit polí navrhnutých modelom (§5) |

---

## 3. Redakcia tajomstiev v ingeste

Prompty bežne obsahujú vloženú dokumentáciu s API kľúčmi a ingest z nich robí
label, popis, `meta` aj `.md` súbor — transcript bol jediná cesta, ktorou sa kľúč
mohol dostať do siete. `Brain\SecretScanner` preto beží **pred prvým zápisom**,
na promptoch aj na finálnom texte asistenta.

Ingest **nezamieta celý prompt** (to by bola tichá strata pamäte) — vystrihne len
zhodu a zvyšok spomienky zapíše: `Kľúč je [REDAKTOVANÉ: high-entropy-b64] a nikde
ho nevypisuj`. Zástupný text nesie **len názov vzoru**, nikdy žiadnu časť hodnoty.

Vzory: PEM privátne kľúče, `sk-ant-…`, `sk-…`, `AKIA…`, `ghp_/gho_/github_pat_…`,
`xox…`, JWT, connection stringy s heslom, `bearer …`, `password=…`, dlhý hex ≥ 40
a **`high-entropy-b64`** — base64 blob ≥ 40 znakov so znakmi `+` a `/`, ktorý
nezachytí ani `long-hex` (nie je hex), ani `bearer`/`password-assign` (tie
potrebujú prefix). Bez posledného vzoru by holý kľúč na samostatnom riadku
prekĺzol do pamäte.

Pokrytie: `Tests\Unit\SecretScannerTest` (vzory),
`Tests\Unit\Ingest\TranscriptParserTest` (parser),
`Tests\Feature\TranscriptIngestTest::test_secret_in_prompt_and_final_text_is_written_redacted`
(celá cesta až po `.md` súbor).

---

## 4. Náhrobky, archivácia, oblasti a oddelenia

### 4.1 Oblasti (5, fixné)

| Oblasť | Slug | Farba |
|---|---|---|
| Marketing & SEO | `marketing-seo` | zlatá `#b88a3a` |
| Vývoj & kód | `vyvoj-kod` | teal `#03797e` |
| Dizajn & kreatíva | `dizajn-kreativa` | slivková `#9d5c7a` |
| Biznis & projekty | `biznis-projekty` | oceľová `#2f6d8f` |
| Osobné & preferencie | `osobne-preferencie` | terakota `#a86a4a` |

### 4.2 Oddelenia (vznikajú automaticky)

- **Záznamy — \<projekt\>** (`zaznamy-<slug>`) — session záznamy daného projektu
- **Knižnica** (`kniznica`) — playbooky (skill uzly zo `skills/<oblast>/*.md`), jedno per oblasť
- **Súhrny** (`suhrny`) — týždenné digesty
- **Claude memory** (`claude-memory`) — uzly z `ClaudeMemoryIngestService`
- **Nezaradené** (`nezaradene`) — fallback pre uzly bez oblasti
- Ostatné vznikajú emergentne (MCP `aura_learn` s parametrom `department`)

### 4.3 Mapovanie projekt → oblasť

`config/auraai.php` → `project_area_map`: Šperky Aura app / Banner Gennerator →
`biznis-projekty`, AI-mind → `vyvoj-kod`, fallback `project_area_fallback`
(`vyvoj-kod`). Porovnáva sa case-insensitive, aj čiastočná zhoda oboma smermi.
Mapovanie je **deterministické** — model doň nezasahuje.

### 4.4 Náhrobky (žiadne zombie)

Zlúčený alebo archivovaný záznam zapíše svoj `external_key` do tabuľky
`tombstones` — ingest ho už nikdy nevytvorí znova, hoci transcript ostáva na
disku. Kľúče sa evidujú aj v `meta.absorbed_keys` cieľového uzla.

### 4.5 Archivácia

`mind:archive-old`: záznamy staršie ako 90 dní sa mesačne zbalia do uzlov
`archive:<Y-m>:<projekt>` (`source=archive`) — hrany sa prepoja, originály zmažú
(s náhrobkom), popisy = zoznam pôvodných titulkov.

---

## 5. LLM nadstavba ingestu — vypnutá by default

Rozhodnutie #112: **model navrhne, deterministický kód rozhodne.** V ingeste to
znamená tri vrstvy poistiek:

1. **Vypínač.** `config('ingest.llm_titles')` a `config('ingest.llm_summaries')`
   sú default `false`. Kým ich integrátor nezapne, model sa nezavolá ani raz a
   výsledok ingestu je bit-identický s dnešným. Ingest beží každých 10 minút nad
   jedinou kópiou pamäte, takže toto nie je opatrnosť, ale podmienka.
2. **Brána.** `Ingest\SuggestionGuard` návrh buď prijme celý, alebo vráti null a
   použije sa deterministický výsledok. Zamieta: prázdny, mimo dĺžky (titulok
   15–60, zhrnutie 40–1 200 znakov), začínajúci URL/lomkou, obsahujúci tajomstvo
   alebo zvyšok redakčnej značky. Odstraňuje `<think>` bloky uvažujúcich modelov.
   Guard nikdy nič „neopravuje, aby to prešlo".
3. **Nedostupnosť nie je chyba.** `Ingest\IngestLlm` vracia null, keď Ollama
   nebeží, keď je `llm.enabled=false` alebo keď provider vráti
   `finishReason: 'error'`. Nič sa neloguje ako chyba a nič nepadá.

Audit: každé pole navrhnuté modelom nesie záznam v `meta.generated_by`. Konvencia
je **mapa `pole → {model, at, task}`** — polí, ktoré smie model navrhnúť, je viac
než jedno (`label`, `description`), takže plochý tvar `{model, at, task}` by sa
navzájom prepisoval:

```json
"generated_by": {
  "label":       { "model": "qwen3:4b", "at": "2026-07-30T09:12:00+02:00", "task": "smart_title" },
  "description": { "model": "qwen3:4b", "at": "2026-07-30T09:12:03+02:00", "task": "session_summary" }
}
```

`SummaryService` zostáva **zámerne bez modelu** — je to jediná vrstva zhrnutí,
ktorá musí fungovať vždy. Abstraktívna nadstavba žije v
`Ingest\SessionSummarizer` a robí sa len pri vzniku záznamu (rozhodnutie #129),
nikdy sa dodatočne neprepisuje. Klasifikácia oblasti modelom (#131) v rozsahu
tejto vlny **nie je** — vyžaduje explicitný fallback namiesto dnešného tichého.

System prompty sa čítajú z `config('prompts.ingest.smart_title')` a
`config('prompts.ingest.session_summary')`; kým ich P5 nedoplní, použije sa
zabudovaný slovenský default.

---

## 6. Scheduler (Europe/Bratislava)

| Čas | Job |
|---|---|
| denne 03:00 | záloha DB (dump → kontrola neprázdnosti → rotácia 14 dní) |
| každých 10 min | `mind:ingest` (mutex `mind-ingest`) |
| každých 10 min | `mind:brain-sync` (mutex `mind-brain-sync`) |
| denne 03:25 | `mind:brain-sync` (plný prechod, pred nočným ingestom) |
| denne 03:35 | `mind:ingest --all` (rovnaký mutex ako 10-minútový — nikdy sa nebijú) |
| denne 03:50 | `mind:reorganize` |
| denne 04:05 | `aura:rewire` (A3–A11, najťažší) |
| denne 04:20 | `mind:decay` |
| denne 04:55 / 05:05 | `mind:sync-memory` / `mind:export-memory` |
| nedeľa 04:00 | `mind:digest` (uzol do Súhrnov, label `W/o`) |
| nedeľa 05:15 | `mind:rollup` (projektové roll-upy) |
| 1. deň mesiaca 04:30 | `mind:archive-old` |

**Deštruktívne joby** (`mind:cleanup-edges`, `mind:prune-coactivation`,
`mind:automerge`) sú **vypnuté** — zaradia sa až keď
`config('maintenance.destructive_enabled')` prepne používateľ po schválenom
dry-run reporte (rozhodnutie #32). Ich prahy sú kalibrované na TF-IDF.

Plus `SessionEnd` hook v `~/.claude/settings.json` spúšťa ingest po každej session.

---

## 7. API štruktúry

- `GET /api/structure` — strom oblastí/oddelení s počtami + nezaradené + jadro
- `PUT /api/departments/{id}` — premenovanie / presun do inej oblasti (uzly idú s ním)
- `DELETE /api/departments/{id}` — uzly → Nezaradené v tej istej oblasti
- `GET /api/search?q=` — uzly + fulltext playbookov (mb-safe snippety)
- `GET /api/duplicates` + `POST /api/nodes/{id}/merge/{target}` — návrhy duplicít a zlúčenie
- `PUT /api/nodes/{id}` — presun uzla (oddelenie musí patriť do oblasti, inak 422)
