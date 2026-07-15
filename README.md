# Hades — AI mind

Živé vedomie AI: neurónová sieť skills, spomienok a projektov, ktorá sa učí
z chatov v Claude Code a v reálnom čase žiari v prehliadači.

## Spustenie

```sh
docker compose up -d
```

- **Vizualizácia:** http://localhost:8080 — glow sieť, klik na uzol = detail/editácia,
  heatmapa aktivity, filtre, príkazová paleta (⌘K), svetlá/tmavá téma (D),
  ambient režim (⛶)
- **MCP endpoint:** http://localhost:8080/mcp (Streamable HTTP)
- **WebSocket (Reverb):** ws://localhost:8081

> **Bez LLM/API.** Hades sám nevolá žiadny externý model — učenie prichádza výhradne
> cez MCP z Claude Code. Netreba `ANTHROPIC_API_KEY`. Web beží len na localhote.

## Architektúra

| Služba    | Účel                                             |
|-----------|--------------------------------------------------|
| app       | Laravel — MCP server, REST API, frontend         |
| queue     | Redis queue worker                               |
| scheduler | Denné zálohy DB do `backups/` (rotácia 14 dní)   |
| reverb    | WebSocket server pre live pulzy                  |
| mariadb   | Uzly, hrany, aktivácie (volume `dbdata`)         |
| redis     | Queue + cache                                    |

## MCP nástroje

- `mind_learn` — uloží skill / spomienku / projekt (duplicity sa auto-zlučujú)
- `mind_recall` — vyhľadá relevantné poznatky (vystrelí spomienkový pulz)
- `mind_activate` — posilní existujúci uzol pri opätovnom použití
- `mind_overview` — štruktúra oblastí a oddelení

Claude Code je napojený cez `mcpServers.hades` v `~/.claude.json` a pravidlá
učenia sú v `~/.claude/CLAUDE.md`.

## Priehľadné zrkadlo (`mind/`)

Každý uzol vedomia sa okrem databázy automaticky zapisuje aj ako čitateľný
`.md` súbor do priečinka `mind/` — štruktúrou **Oblasť → Oddelenie → uzol.md**
(napr. `mind/marketing-seo/seo/konverzny-lievik-42.md`), s YAML frontmatterom a
`[[wikilink]]` spojeniami (dá sa otvoriť ako Obsidian trezor). Zdroj pravdy zostáva
databáza; súbory sú odvodené a kedykoľvek regenerovateľné:

```sh
php artisan mind:export
```

Synchronizácia DB → súbory je automatická (pri každom learn/activate/merge/edit/
delete cez Eloquent observery). Ručné úpravy `.md` (napr. v Obsidiane) premietneš
späť do DB príkazom:

```sh
php artisan mind:import
```

Pri drifte je autoritou DB (`mind:export` prepíše súbory). Medzi počítačmi sa myseľ
prenáša cez git: `git pull` a potom `mind:import`. Vypnúť zrkadlenie sa dá cez
`HADES_MIRROR_ENABLED=false`, cesta sa mení cez `HADES_MIND_PATH`.

## Súkromie

Hades beží len lokálne (localhost) a **nikdy neukladá tajomstvá** — lokálny
bezpečnostný filter (`SensitiveFilter`) odmietne heslá, API kľúče, finančné,
zdravotné aj cudzie osobné údaje ešte pred uložením.

## Model vedomia

Uzly majú silu (rastie aktiváciami, nikdy neklesá — Hades nezabúda), hrany váhu;
oblasti aj oddelenia vznikajú emergentne pri učení. Stav bdie/spí sa riadi
poslednou aktivitou (len vizuál).
