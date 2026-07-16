# Zložkovanie — logika štruktúry vedomia

Ako Hades organizuje uzly do oblastí a oddelení a ako fungujú automatické záznamy.
Rozhodnutia z otázkových kôl 15.–16. 7. 2026.

## Oblasti (5, fixné)

| Oblasť | Slug | Farba |
|---|---|---|
| Marketing & SEO | `marketing-seo` | zlatá `#b88a3a` |
| Vývoj & kód | `vyvoj-kod` | teal `#03797e` |
| Dizajn & kreatíva | `dizajn-kreativa` | slivková `#9d5c7a` |
| Biznis & projekty | `biznis-projekty` | oceľová `#2f6d8f` |
| Osobné & preferencie | `osobne-preferencie` | terakota `#a86a4a` |

## Oddelenia (vznikajú automaticky)

- **Záznamy — \<projekt\>** (`zaznamy-<slug>`) — session záznamy daného projektu
- **Knižnica** (`kniznica`) — playbooky (skill uzly zo `skills/<oblast>/*.md`), jedno per oblasť
- **Súhrny** (`suhrny`) — týždenné digesty
- **Nezaradené** (`nezaradene`) — fallback pre uzly bez oblasti
- Ostatné oddelenia vznikajú emergentne (MCP `mind_learn` s parametrom `department`)

## Mapovanie projekt → oblasť

`config/hades.php` → `project_area_map`:
Šperky Aura app / Banner Gennerator → `biznis-projekty`, AI-mind → `vyvoj-kod`,
fallback `vyvoj-kod`. Porovnáva sa case-insensitive, aj čiastočná zhoda.

## Automatické záznamy (bez modelu)

Parser `TranscriptIngestService` číta Claude Code transcripty (JSONL) namountované
do kontajnera (`C:/Users/Ucet/.claude/projects` → `/transcripts:ro`). Čisto kódom
extrahuje: prompty, súbory, commity, nástroje, záverečný text.

- **Filter šumu**: prompty < 15 znakov, stoplist (pokračuj, ok, áno…), systémové
  bloky (`<…`, `[SYSTEM`, `[Image`, `Caveat:`)
- **Titulok**: prvá veta prvého zmysluplného promptu, max 60 znakov bez rozseknutia
  slova; preskakuje prompty začínajúce URL alebo /príkazom; fallback
  `<projekt> — práca <dátum>`
- **Uzol**: `type=memory`, `source=session`, `external_key=session:<id>`,
  `created_at` spätne na začiatok session
- **Projektový uzol**: `external_key=project:<slug>` + hrana záznam→projekt
  (váha rastie len pri vytvorení záznamu)
- **Prepojenie na skills**: label skillu sa hľadá v texte session len na hraniciach
  slov (žiadne „Canva" v „canvas"), max 5 hrán

### Ochrana manuálnych úprav

Pri existujúcom uzle ingest aktualizuje **len meta** a `last_activated_at` —
label, popis, oblasť, oddelenie a silu nikdy neprepíše. Rastúce sessions sa
priebežne dopĺňajú podľa mtime súboru vs `meta.ingested_at`.
Jednorazová oprava: `php artisan mind:ingest --all --force-refresh`
(prepíše aj label/oblasť, silu zachová).

### Tombstones (žiadne zombie)

Zlúčený alebo archivovaný záznam zapíše svoj `external_key` do tabuľky
`tombstones` — ingest ho už nikdy nevytvorí znova, hoci transcript ostáva na disku.
Kľúče sa evidujú aj v `meta.absorbed_keys` cieľového uzla.

### Archivácia

`mind:archive-old`: záznamy staršie ako 90 dní sa mesačne zbalia do uzlov
`archive:<Y-m>:<projekt>` (source=archive) — hrany sa prepoja, originály zmažú
(s tombstonom), popisy = zoznam pôvodných titulkov.

## Scheduler (Europe/Bratislava)

| Čas | Job |
|---|---|
| denne 03:00 | záloha DB (fail-safe: dump → kontrola neprázdnosti → rotácia 14 dní) |
| každých 10 min | `mind:ingest` (mutex `mind-ingest`) |
| denne 03:35 | `mind:ingest --all` (rovnaký mutex — nikdy sa nebijú) |
| denne 03:50 | `mind:reorganize` |
| nedeľa 04:00 | `mind:digest` (uzol do Súhrnov, label `W/o`) |
| 1. deň mesiaca 04:30 | `mind:archive-old` |

Plus SessionEnd hook v `~/.claude/settings.json` spúšťa ingest po každej session.

## API štruktúry

- `GET /api/structure` — strom oblastí/oddelení s počtami + nezaradené + jadro
- `PUT /api/departments/{id}` — premenovanie / presun do inej oblasti (uzly idú s ním)
- `DELETE /api/departments/{id}` — uzly → Nezaradené v tej istej oblasti
- `GET /api/search?q=` — uzly + fulltext playbookov (mb-safe snippety)
- `GET /api/duplicates` + `POST /api/nodes/{id}/merge/{target}` — návrhy duplicít a zlúčenie
- `PUT /api/nodes/{id}` — presun uzla (oddelenie musí patriť do oblasti, inak 422)

## Bezpečnosť

- Porty viazané len na `127.0.0.1` (app 8080, Reverb 8081, MariaDB 3307)
- `POST /api/chat` má rate-limit 20/min
- MCP `mind_learn` server-side odmieta obsah vyzerajúci ako heslo/API kľúč/token
  (PEM, AKIA…, sk-…, ghp_…, xox…, JWT, dlhé hexy, `password=`…)
- Fáza 2 (prístup z internetu) vyžaduje auth v UI + token na MCP endpoint
