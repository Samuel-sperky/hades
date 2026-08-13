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

Oblasť v `mind_learn` musí existovať — je ich pevných päť a za behu sa
nevytvárajú, takže neznáme meno skončí chybou so zoznamom platných oblastí
(over si ich cez `mind_overview`). Oddelenie sa naopak vytvoriť smie; keď
vznikne nové, odpoveď to hlási v `department_created`.

Claude Code je napojený cez `mcpServers.hades` v `~/.claude.json` a pravidlá
učenia sú v `~/.claude/CLAUDE.md`.

## Konfigurácia

Chat s Hadesom vyžaduje `ANTHROPIC_API_KEY` v `.env` (model `HADES_CHAT_MODEL`,
default `claude-opus-4-8`). Po zmene `.env` reštartuj: `docker compose restart`.

Model vedomia: uzly majú silu (rastie aktiváciami, nikdy neklesá — Hades
nezabúda), hrany váhu; oblasti sú preddefinované v seederi, oddelenia vznikajú
emergentne. Stav bdie/spí sa riadi poslednou aktivitou.
