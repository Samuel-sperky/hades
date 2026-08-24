# Stav Hadesa — 24. 8. 2026

Bodový prehľad celkového stavu. Detaily inde: `README.md` (spustenie, MCP),
`CLAUDE.md` (pravidlá frontendu a pasce harnessu), `docs/BEZPECNOST.md`
(§8 = riziká), `KONTRAKT-REDIZAJN-2026-08-12.md` (§8 = zvyšky po redizajne).

## Celkovo

- Systém **beží a je funkčne kompletný** — oba režimy učenia sú hotové:
  zo sessions cez MCP aj z ľudsky písaných `.md` mozgov (brain-indexer).
- Posledný commit **13. 8. 2026** (`1bb64ce`), prvý 15. 7. 2026 — päť týždňov
  vývoja. Odvtedy sa nevyvíja, otvorené body sú evidované.
- Vetva `main`; posledné dokončené šprinty: **hygiena** (backend, bezpečnosť)
  a **redizajn** (frontend), zmergované s nulovým prekryvom súborov.
- Testy: **168 testových metód** v 21 súboroch (`docker compose exec app php
  artisan test`), posledný zaznamenaný beh 139 prešlo / 7 skipped. Sú výhradne
  PHP — frontend testy neexistujú.

## Beží

- **Docker stack:** app (Laravel), queue, scheduler, reverb, mariadb, redis.
- **MCP server** na `/mcp` (Streamable HTTP) aj cez stdio pre lokálnych klientov;
  4 nástroje — `mind_learn`, `mind_recall`, `mind_activate`, `mind_overview`.
- **REST API:** 54 routov — interné `/api/*` (dashboard) a externé `/api/v1/*`.
- **Vizualizácia** na `:8080`, **Reverb** na `:8081` (live pulzy).
- **Nočná údržba:** 15 `mind:*` príkazov v scheduleri (ingest, brain-sync,
  reorganize, digest, rollup, decay, automerge, prune-*, archive-old, …)
  plus denná záloha DB do `backups/` s rotáciou 14 dní.

## Model vedomia

- Uzly typu skill / spomienka / projekt; sila rastie aktiváciami a **nikdy
  neklesá** — Hades nezabúda. Hrany majú váhu.
- **5 pevných oblastí** (za behu nevznikajú, neznáma skončí chybou),
  oddelenia vznikajú emergentne.
- Nadstavba portovaná z Apolla: certainty, verify/review fronta, rozhodnutia,
  tagy, tombstones, merge candidates, brain-sync zdroje.
- **18 migrácií**, posledné 12. 8. 2026 (identita uzlov, soft delete,
  normalizácia tagov, fulltext index).
- 11 modelov, 17 artisan príkazov, 17 kontrolérov, `app/Services/Brain`
  (parser, writer, registry, `SecretScanner`).

## Frontend

- **Bez build stepu** — `public/js/mind/` je 31 natívnych ES modulov
  (do 8/2026 jeden IIFE s 5933 riadkami), `mind.css` ~3 700 riadkov.
- **Jeden graf, štyri úrovne zanorenia:** mapa → oblasť → oddelenie → uzol.
  Pohľady Mapa/Sieť/Vrstvy sú zrušené.
- **Bez d3 simulácie** — layout je čisto deterministický, aby scéna vždy
  vyplnila viewport (graf drží 88–94 % šírky na všetkých úrovniach).
- **6 obrazoviek:** Dnes, Denník, Knižnica, Kontrola, Rozhodnutia, Smernica.
- Tmavá téma je default; obsah plní 97–98 % šírky, zoznamy sú viacstĺpcové.
- Redizajn splnil **9 z 10** akceptačných kritérií; nesplnené A4 je chyba
  kontraktu, nie implementácie (na mape je uzol 2,6 px prach — tvar sa tam
  principiálne nedá vykresliť; dual-channel funguje od úrovne oddelenia).

## Bezpečnosť

- Štyri nezávislé okruhy: token guard na `/mcp`, Bearer na `/api/v1/*`,
  session guard `AuthenticateUi` na dashboarde a interných `/api/*`,
  basic-auth na Caddy.
- Tajomstvá sú mimo tracked súborov (`.env`), `SecretScanner` (12 vzorov)
  filtruje zápisy do pamäte.
- **Rotovať:** MCP token a bcrypt hash sú síce už v `.env`, ale **zostávajú
  v histórii commitov** (aj na remote) — treba ich považovať za kompromitované.
- Ďalšie otvorené riziká (§8): token v query stringu sa loguje; jeden statický
  token na okruh bez expirácie, rotácie a auditu; triviálne DB heslá;
  `APP_DEBUG=true` a `APP_ENV=local`; nechránený `POST /debug/snapshot`;
  rate limit má len `/api/chat`; chat posiela obsah pamäte do Anthropic API
  (zámer, ale je to odliv dát).

## Otvorené technické body

- `/api/tags` vracia **3 622 značiek** → `tagfilter.js` z nich robí 3 622
  checkboxov. Zbalená sekcia to schová, nevyrieši.
- **Mŕtvy kód starší ako redizajn:** `timeline.setupTimeline()`,
  `search.renderSearch`, `structure.findDuplicates`, `pack.addToPack`,
  `chat.addToChatContext`. Pozor — timeline môže byť nedokončená funkcia
  (`#tl-range` v blade vôbec nie je), nie mŕtvy kód.
- **17 raw hex/rgba mimo `:root`** v `mind.css` (thumby slidrov, knob
  prepínača, tiene `#brand-core`, `.shimmer::after`) — porušuje pravidlo
  projektu, prebarvenie nesie riziko vizuálnej zmeny.
- **Testovateľnosť UI:** dva loading stavy a async fetchy `.dir-templates` /
  `.dir-saved` nemajú „settled" príznak, klik na `.dest` občas obrazovku
  neprepne — každý budúci vizuálny harness bude potrebovať tie isté obchádzky.
- **Žiadne frontend testy** — UI sa overuje prekliknutím v prehliadači
  (headless Chrome cez `puppeteer-core`, postup a pasce v `CLAUDE.md`).
- **Vedomé kompromisy hustoty:** dlhé titulky v Denníku sa v stĺpci skrátia,
  dni s jediným záznamom nechajú stĺpce prázdne, Rozhodnutia sú na 2560 px
  hustá stena (páka: `columns: 440px → 560px`).
