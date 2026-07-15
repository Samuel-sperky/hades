# Hades — AI mind

Živé vedomie AI: neurónová sieť skills, spomienok a projektov, ktorá sa učí
z chatov v Claude Code a v reálnom čase žiari v prehliadači.

## Spustenie

```sh
docker compose up -d
```

- **Vizualizácia:** http://localhost:8080 — glow sieť, klik na uzol = detail/editácia,
  časová os s replayom rastu, ambient režim (⛶), chat s Hadesom (💬)
- **MCP endpoint:** http://localhost:8080/mcp (Streamable HTTP)
- **WebSocket (Reverb):** ws://localhost:8081

## Architektúra

| Služba    | Účel                                             |
|-----------|--------------------------------------------------|
| app       | Laravel — MCP server, REST API, chat, frontend   |
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

Synchronizácia je automatická (pri každom learn/activate/merge/edit/delete cez
Eloquent observery). Vypnúť sa dá cez `HADES_MIRROR_ENABLED=false`, cesta sa mení
cez `HADES_MIND_PATH`.

## Konfigurácia

Chat s Hadesom vyžaduje `ANTHROPIC_API_KEY` v `.env` (model `HADES_CHAT_MODEL`,
default `claude-opus-4-8`). Po zmene `.env` reštartuj: `docker compose restart`.

Model vedomia: uzly majú silu (rastie aktiváciami, nikdy neklesá — Hades
nezabúda), hrany váhu; oblasti sú preddefinované v seederi, oddelenia vznikajú
emergentne. Stav bdie/spí sa riadi poslednou aktivitou.
