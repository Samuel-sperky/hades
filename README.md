# Hades — AI mind

Živé vedomie AI: neurónová sieť skills, spomienok a projektov, ktorá sa učí
z chatov v Claude Code a v reálnom čase žiari v prehliadači.

## Spustenie

```sh
docker compose up -d
```

- **Vizualizácia:** http://localhost:8080 — jeden graf so štyrmi úrovňami zanorenia
  (mapa → oblasť → oddelenie → uzol), klik zanorí, `Esc` vyjde o úroveň, `1`–`4`
  skočia na úroveň, breadcrumb v hlavičke drží cestu. Klik na uzol = detail/editácia,
  ambient režim (⛶), chat s Hadesom (💬). Tmavá téma je default.
  Dashboard je **zamknutý**: odomkni ho raz cez
  `http://localhost:8080/?token=<HADES_UI_TOKEN z .env>`, ďalej si to pamätá
  session cookie. Detail v [docs/BEZPECNOST.md](docs/BEZPECNOST.md) §3.3.
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

## Klienti konzoly vedomia

Konzola vedomia žije na http://localhost:8080/console (vlákno na
`/console/<uuid>`) a hovoria s ňou dva klienti. Ani jeden nezdvojuje logiku —
oba idú na to isté `/api/console/*`, takže vlákno rozpísané v prehliadači sa dá
dokončiť v termináli a naopak.

### `bin/hades/` — terminálový klient

Čisté Node ESM, **bez jedinej npm závislosti a bez `package.json`**: funguje hneď
po `git clone`, aj tam, kde nikto nespustil `npm install`. Vyžaduje Node 22+
a terminál v UTF-8.

```sh
node bin/hades/hades.mjs                          # interaktívny režim (pokračuje v poslednom vlákne)
node bin/hades/hades.mjs --new                    # interaktívny režim v novom vlákne
node bin/hades/hades.mjs run "koľko je uzlov?"    # jeden ťah, text na stdout
node bin/hades/hades.mjs run "…" --json           # jeden ťah cez headless, na stdout IBA JSON
node bin/hades/hades.mjs threads                  # zoznam vlákien
node bin/hades/hades.mjs models                   # modely a čo je nedostupné (a prečo)
node bin/hades/hades.mjs doctor                   # odkiaľ má adresu a token
node bin/hades/hades.mjs gui                      # otvorí konzolu v desktopovom okne
node bin/hades/hades.mjs pending                  # front odložených zápisov
node bin/hades/hades.mjs pending approve <id>     # povolí návrh — vykoná sa až teraz
node bin/hades/hades.mjs pending deny <id>        # zahodí návrh
```

- `pending` je front toho, čo navrhol beh, **pri ktorom nikto nesedel** (plánovaný
  rozvrh alebo skript). Taký beh zápis nevykoná: uloží ho ako návrh s náhľadom, aby
  ťah nezostal zaparkovaný na povolení, ktoré nemá komu prísť. Zápis sa vykoná až
  pri `approve` — dovtedy front môže ležať aj týždeň a nič nezmenil.

- `run --json` ide na `/api/console/headless` a na stdout dá **iba JSON** (chyby
  a kresba idú na stderr), takže `hades run "…" --json | jq` funguje. Exit kódy:
  `0` ťah dobehol, `1` chyba behu alebo spojenia, `2` chýba konfigurácia.
  Prerušený prúd je nenulový exit — ťah, ktorý nedobehol, nesmie vyzerať úspešne.
- `doctor` povie, **odkiaľ** vzal adresu a token a či server odpovedá. Hodnotu
  tokenu nevypíše nikdy, ani skrátenú.

Adresa a token sa hľadajú v tomto poradí (prvý zdroj vyhráva, každé pole
samostatne — `bin/hades/lib/config.mjs`):

| # | Zdroj | Kľúče |
|---|---|---|
| 1 | premenné prostredia | `HADES_URL`, `HADES_UI_TOKEN` |
| 2 | `~/.hades/config.json` | `{"url": "…", "token": "…"}` |
| 3 | `.env` projektu | `HADES_UI_TOKEN`, `APP_URL` |

`.env` je zámerne posledný a zároveň hlavná cesta na tomto stroji: token netreba
kopírovať do druhého súboru, ale keď ho niekto prepíše premennou, tá kópia musí
vyhrať. Hľadá sa stúpaním z aktuálneho priečinka nahor po prvý, kde je **`artisan`
aj `.env`** (samotný `.env` má aj hocijaký iný projekt). Bez adresy klient padne
na `http://localhost:8080`. Detaily v [bin/hades/README.md](bin/hades/README.md).

Programový okruh konzoly je **loopback-only** a odmietne všetko, čo prišlo cez
proxy alebo ngrok tunel — viď [docs/BEZPECNOST.md](docs/BEZPECNOST.md) §3.5.

### `desktop/` — Electron okno

Obal nad `/console`, nie druhá appka. Spustenie:

```sh
cd desktop
npm install --no-audit --no-fund
npm start
```

Načítava `$HADES_URL/console` (default `http://localhost:8080/console`) a token
vkladá **ako hlavičku `X-Hades-Ui-Token` scopovanú na jeden origin**, nie do URL —
v URL by prežil v histórii okna a v access logu. Tray ikona, `Ctrl+Alt+H` na
prepnutie viditeľnosti, zatvorenie okna = skrytie do tray. Renderer beží s
`nodeIntegration: false`, `contextIsolation: true` a `sandbox: true`, cudzie odkazy
sa otvárajú v systémovom prehliadači. Detaily v
[desktop/README.md](desktop/README.md).

## Konfigurácia

Chat s Hadesom vyžaduje `ANTHROPIC_API_KEY` v `.env` (model `HADES_CHAT_MODEL`,
default `claude-opus-4-8`). Po zmene `.env` reštartuj: `docker compose restart`.

Model vedomia: uzly majú silu (rastie aktiváciami, nikdy neklesá — Hades
nezabúda), hrany váhu; oblasti sú preddefinované v seederi, oddelenia vznikajú
emergentne. Stav bdie/spí sa riadi poslednou aktivitou.
