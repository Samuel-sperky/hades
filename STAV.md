# Stav Hadesa — 24. 8. 2026

Stručný prehľad, kde projekt je. Detaily: `README.md` (spustenie a MCP),
`CLAUDE.md` (pravidlá frontendu), `docs/BEZPECNOST.md` (§8 = známe riziká),
`KONTRAKT-REDIZAJN-2026-08-12.md` (§8 = čo zostalo po redizajne).

## Zhrnutie

Systém beží a je funkčne kompletný v oboch režimoch učenia — zo sessions
(MCP) aj z ľudsky písaných `.md` mozgov (brain-indexer, sprint Apollo).
Backend, MCP, REST API aj vizualizácia sú hotové a otestované. Posledný
commit je z 13. 8. 2026; odvtedy sa nevyvíja, otvorené body sú evidované
a majú vlastné úlohy.

## Čo stojí

| Vrstva | Stav |
|---|---|
| Docker stack (app, queue, scheduler, reverb, mariadb, redis) | beží |
| MCP server (`/mcp`, Streamable HTTP + stdio) | 4 nástroje, hotové |
| REST API (interné `/api/*` + externé `/api/v1/*`) | ~40 routov, hotové |
| Vizualizácia (`public/js/mind`, 31 ES modulov, bez build stepu) | hotová |
| Nočná údržba (17 `mind:*` príkazov v scheduleri) | beží |
| Testy (`php artisan test`) | 168 metód v 21 súboroch, zelené |

## Dátový a znalostný model

Uzly (skill / spomienka / projekt) so silou, hrany s váhou, päť pevných
oblastí, emergentné oddelenia. Nadstavba z Apolla: certainty, verify/review
fronta, rozhodnutia, tagy, tombstones, merge candidates, brain-sync zdroje.
18 migrácií, posledné z 12. 8. 2026 (identita uzlov, soft delete, fulltext).

## Frontend

Jeden graf so štyrmi úrovňami zanorenia (mapa → oblasť → oddelenie → uzol),
šesť obrazoviek (Dnes, Denník, Knižnica, Kontrola, Rozhodnutia, Smernica).
Deterministický layout bez d3 simulácie, tmavá téma default, `mind.css`
~3 700 riadkov cez tokeny. Redizajn z 12.–13. 8. splnil 9 z 10 akceptačných
kritérií; nesplnené A4 je chyba kontraktu (na mape je uzol 2,6 px prach,
tvar sa tam nedá vykresliť), nie implementácie.

## Bezpečnosť

Štyri nezávislé okruhy: token guard na `/mcp`, Bearer na `/api/v1/*`,
session guard `AuthenticateUi` na dashboarde a interných `/api/*`,
basic-auth na Caddy. Tajomstvá sú mimo tracked súborov (`.env`),
`SecretScanner` filtruje zápisy do pamäte.

**Otvorené (docs/BEZPECNOST.md §8):** MCP token a bcrypt hash zostávajú
v histórii commitov — **treba ich rotovať**; token v query stringu sa
loguje; jeden statický token na okruh bez expirácie a auditu; triviálne DB
heslá; `APP_DEBUG=true`; nechránený `POST /debug/snapshot`; rate limit má
len `/api/chat`.

## Otvorené technické body

1. `/api/tags` vracia 3 622 značiek → `tagfilter.js` z nich robí 3 622
   checkboxov. Zbalená sekcia to schová, nevyrieši.
2. Mŕtvy kód starší ako redizajn: `timeline.setupTimeline()`,
   `search.renderSearch`, `structure.findDuplicates`, `pack.addToPack`,
   `chat.addToChatContext`. Pozor — timeline môže byť nedokončená funkcia
   (`#tl-range` v blade vôbec nie je), nie mŕtvy kód.
3. 17 raw hex/rgba mimo `:root` v `mind.css` — porušuje pravidlo projektu,
   prebarvenie nesie riziko vizuálnej zmeny.
4. Testovateľnosť UI: loading stavy a async fetchy nemajú „settled"
   príznak, klik na `.dest` občas obrazovku neprepne. Každý vizuálny
   harness bude potrebovať tie isté obchádzky.
5. Frontend testy neexistujú — UI sa overuje prekliknutím v prehliadači
   (postup a pasce harnessu sú v `CLAUDE.md`).
