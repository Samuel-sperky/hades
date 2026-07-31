# AuraAI — živé vedomie

Neurónová sieť skills, spomienok a projektov, ktorá sa učí z Claude Code sessions
a v reálnom čase žiari v prehliadači. Uzly majú **silu**, hrany **váhu**; oblasti sú
preddefinované, oddelenia vznikajú emergentne. Nad tou istou sieťou beží chat,
lokálny LLM a doména SPERKY e-shopu.

Fork Hadesa (`C:\Users\Ucet\Desktop\AI-mind` — read-only záloha na porte 8080).
Branch: `feat/auraai`. Kontrakt projektu a vlastníctvo súborov: [`CLAUDE.md`](CLAUDE.md).

## Štyri pilíere

| Pilier | Kde žije |
|---|---|
| **Vedomie** — graf uzlov/hrán/aktivácií, ingest transcriptov, MCP učenie | `app/Services/{Ingest,Brain,Recall,Similarity}/**`, `app/Mcp/**` |
| **Trojvrstvový chat** — deterministický router → model ako doplnok → šablóny z reálnych dát | `app/Services/Chat/**`, `app/Http/Controllers/Chat/**` |
| **Lokálny LLM** — Ollama, zadarmo, offline; Anthropic API sa nepoužíva | `app/Llm/**`, `config/llm.php` |
| **SPERKY e-shop** — objednávky, produkty, súhrny (doménové odpovede v chate) | `app/Services/Sperky/**`, `routes/eshop.php` |

Frontend má **9 destinácií** (`core/screens.js`): `dnes`, `dennik`, `graf`, `kniznica`,
`chat`, `eshop`, `rozhodnutia`, `kontrola`, `smernica`. Osem z nich sú sekcie
`#screen-<názov>`; `graf` je samo plátno (`<canvas id="mind">`), ktoré leží pod shellom.
Kód je v `resources/js/**`, build cez Vite.

## Spustenie

```sh
docker compose up -d                       # celý stack (compose project = auraai)
docker compose exec -T app npm ci          # node_modules žijú vo volume kontajnera
docker compose exec -T app npm run build   # POVINNÉ — bez manifestu appka nenaběhne
docker compose exec -T app php artisan migrate
```

**Vite build je povinný pred servovaním.** `docker-compose.yml` bind-mountuje projekt
nad `/var/www/html`, takže assety nikdy nie sú zapečené v image. Bez
`public/build/manifest.json` stránka hodí „Vite manifest not found" — hlasné zlyhanie
zámerne, nikdy tichý zastaraný asset.

`node_modules` sú v **kontajnerovom volume**, nie na hostiteľovi (Vite 8 / rolldown má
natívnu binárku per platforma). Po `docker compose down -v` treba `npm ci` znovu.
Na hostiteľa `npm ci` tiež ide — každé prostredie si drží svoje binárky z toho istého
`package-lock.json`.

## Porty

Všetko je publikované len na `127.0.0.1` — appka je verejne dostupná iba cez ngrok tunel.

| Port | Služba | V kontajneri |
|---|---|---|
| **8082** | Laravel app (UI + API + MCP) | 8080 |
| 8083 | Reverb WebSocket (live pulzy) | 8081 |
| 8084 | Caddy (MCP proxy) | 8095 |
| 11434 | Ollama | 11434 |
| 3308 | MariaDB | 3306 |
| _8080_ | **Hades — read-only záloha, nie súčasť AuraAI** | — |

Port 8082 je dočasný: Hades beží na 8080 ako živá záloha, kým AuraAI nepreukáže
funkčnosť. Prepnutie na finálny port je posledný krok sprintu.

## Služby

| Služba | Účel |
|---|---|
| app | Laravel — MCP server, REST API, chat, frontend |
| queue | Redis queue worker |
| scheduler | Nočná údržba vedomia + denná záloha DB |
| reverb | WebSocket server pre live pulzy |
| caddy | Proxy pre MCP endpoint |
| ollama | Lokálne modely (volume `ollamadata`) |
| mariadb | Uzly, hrany, aktivácie (volume `dbdata`) |
| redis | Queue + cache |

## MCP

Endpoint `/mcp` (GET/POST/DELETE, Streamable HTTP), za token guardom
(`Bearer` alebo `?token=`, fail-closed) a throttle 120/min.

Kanonické tooly — vždy registrované:

- `aura_learn` — uloží skill / spomienku / projekt (duplicity sa auto-zlučujú)
- `aura_recall` — vyhľadá relevantné poznatky (vystrelí spomienkový pulz)
- `aura_activate` — posilní existujúci uzol pri opätovnom použití
- `aura_overview` — štruktúra oblastí a oddelení
- `aura_decision` — zapíše rozhodnutie

Tooly e-shopu `aura_shop_orders` a `aura_shop_products` sú **vypnuté by default**
(`AURAAI_MCP_SHOP_TOOLS=true` ich zapne).

Staré názvy `mind_*` fungujú ďalej ako **legacy aliasy** (v `tools/list` sú tak aj
označené); vypína ich `AURAAI_MCP_LEGACY_ALIASES=false`.

## Modely

Potvrdené meraním — detaily a reprodukcia v [`docs/BENCHMARK-LLM.md`](docs/BENCHMARK-LLM.md).

| Úloha | Model |
|---|---|
| Router zámeru + auto-názov vlákna | `qwen3:4b` |
| Eskalácia (rephrase, chat) | `qwen3:4b` |
| Embeddingy | `bge-m3` (1024 dim) |

`qwen3:0.6b` má v slovenčine 25 % presnosť routera (nepoužiteľný), `qwen3:4b` 100 %
(12/12). `think: false` je pri qwen3 povinné — inak model spáli celý budget na
uvažovanie.

Celú LLM vrstvu vypína `AURAAI_LLM_ENABLED=false` → appka sa vráti do plne
deterministického režimu. Vrstva 1 (router z kľúčových slov a regexov) funguje offline
vždy a **čísla skladá vždy kód, nikdy model.**

## Zabúdanie (decay)

Sieť **zabúda** — tvrdenie „sila nikdy neklesá" z pôvodného Hadesa už neplatí.
`mind:decay` beží denne o 04:20 (Europe/Bratislava):

- **Uzly:** `strength = max(1.0, strength * 0.97)` pre uzly, ktoré nie sú `pinned`,
  nie sú typu `core`, **majú `source`** a boli neaktívne > 14 dní.
- **Hrany:** `weight = max(0.5, weight * 0.95)` pre `auto` hrany neaktívne > 30 dní.

**Reálny dopad je dnes malý** a treba to čítať presne:

- `source IS NOT NULL` vylučuje **583 z 709 uzlov** (82 %) — manuálne fakty a uzly
  z MCP majú `source = null` a nedecayujú nikdy. Zdroj majú len `session` (48),
  `skill` (47), `claude-memory` (30) a `digest` (1).
- Podlaha `max(1.0, …)` znamená, že **593 z 709 uzlov** je už na sile ≤ 1.0, takže ich
  násobenie nemá čo znižovať.
- Po oboch filtroch je **práve teraz oprávnených 4 uzlov**.

Zabúdanie teda existuje ako mechanizmus, ale prakticky sa dotýka jednotiek uzlov.
Rozšíriť jeho záber = zmena `whereNotNull('source')` a podlahy, čo je rozhodnutie
používateľa, nie údržba.

## Nočná údržba

Scheduler (Europe/Bratislava): záloha DB 03:00 (rotácia 14 dní) · `mind:ingest`
každých 10 min a `--all` o 03:35 · `mind:brain-sync` každých 10 min a 03:25 ·
`mind:reorganize` 03:50 · `aura:rewire` 04:05 · `mind:decay` 04:20 · `aura:embed` 04:35 ·
`mind:sync-memory` 04:55 · `mind:export-memory` 05:05 · `aura:sync-runs-prune` 05:30 ·
`mind:digest` a `mind:rollup` v nedeľu · `mind:archive-old` 1. dňa mesiaca.

**Deštruktívne joby sú vypnuté** (`mind:cleanup-edges`, `mind:prune-coactivation`,
`mind:automerge`). Nevratne mažú hrany a zlučujú uzly nad **jedinou kópiou pamäte** a
ich prahy (0.92 / 0.08 / weight<1 & 90 dní) sú kalibrované na TF-IDF — pri prechode na
embeddingy znamenajú niečo úplne iné. Zapnutie schvaľuje **výhradne používateľ** po
prečítaní dry-run reportu:

```sh
docker compose exec -T app php artisan aura:dry-run      # čo BY sa stalo — nič nemení
docker compose exec -T app php artisan aura:calibrate    # sweep prahov — nič nemení
```

## Testy

```sh
sh scripts/test-db.sh <sufix>     # POVINNE PRVÉ — vlastná testovacia schéma
docker compose exec -T -e DB_DATABASE=auraai_test_<sufix> app php artisan test
docker compose exec -T app npx vitest run
docker compose exec -T app npm run build
npx playwright test               # smoke, vyžaduje bežiaci stack
```

Brána: **446 PHP + 370 Vitest, 0 skipnutých.** Vlastná schéma je povinná, keď bežia
dva testy naraz — `RefreshDatabase` migruje na začiatku každého testu, takže dva behy
nad jednou schémou si rozbijú migrácie.

## Dokumentácia

| Súbor | O čom |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | kontrakt: vlastníctvo súborov, zamknuté rozhrania, pravidlá |
| [`docs/zlozkovanie.md`](docs/zlozkovanie.md) | štruktúra priečinkov, dátový tok ingestu |
| [`docs/dizajn.md`](docs/dizajn.md) | dizajnový systém, tokeny, komponenty, breakpointy |
| [`docs/BENCHMARK-LLM.md`](docs/BENCHMARK-LLM.md) | meranie modelov a odporúčaná konfigurácia |
| [`docs/UX-PLAN-AURA-PARITA.md`](docs/UX-PLAN-AURA-PARITA.md) | UX plán a parita s Aura light business |

## Konfigurácia

`.env.example` je zdroj pravdy pre premenné. Hodnoty tokenov a hesiel sa nikdy
nevypisujú do chatu, logov ani commitov; nové kľúče pridáva používateľ.
Po zmene `.env`: `docker compose restart`.
