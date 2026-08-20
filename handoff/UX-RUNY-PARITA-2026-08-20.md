# Handoff — log behov a dvojitá plocha (19.–20. 8. 2026)

Kontrakt: [KONTRAKT-UX-RUNY-CCBRIDGE-2026-08-19.md](../KONTRAKT-UX-RUNY-CCBRIDGE-2026-08-19.md) · audit: [docs/UX-AUDIT-2026-08-19.md](../docs/UX-AUDIT-2026-08-19.md)

## Čo z toho treba vedieť, keď na tom budeš pokračovať

**Log behov je agregát, nie tretia kópia dát.** `runs` drží stav a cenu behu,
ale členstvo správ nesie **rozsah id** (`from_message_id` – `to_message_id`), nie
stĺpec `run_id`. Tokeny a generovací čas sa **sčítavajú z `console_messages`**,
neberú sa z rámca `end` — ťah, ktorý zaparkuje na potvrdení zápisu, `end` vôbec
nepošle. Preto tiež platí, že `runs.duration_ms` je wall clock (obsahuje čas, kým
sa človek rozhodoval), kým `tokens_per_second` je počítané z generovacieho času
správ. Sú to dva rôzne údaje a **ani jeden nie je chyba**.

**`AgentRunner.php` sa nesmie stať miestom, kde sa beh zapisuje.** Recorder visí
na `$emit` v `RunController` a je tam schválne (§0 kontraktu: paralelná session
ten súbor prepisovala). Ukázalo sa to ako lepší návrh, nie len ako obchádzka —
recorder je testovateľný bez modelu, stačí mu poslať rámce.

**Dvojitá plocha stojí na jednom pravidle:** endpoint vráti `data()`, MCP tool
vráti `dropEmpty(project(data(), fieldsForAi()))`. Keď pridáš obrazovku, pridaj
serializér do `app/Serializers/Screen/` a **jeden riadok do
`ScreenParityTest::registry()`** — test si zvyšok vynúti sám. Nepíš druhú
implementáciu pre AI; to je presne tá chyba, ktorú tento šprint opravoval na
šiestich miestach.

**Parity test má štvrtú vrstvu, ktorá dokazuje jeho vlastnú citlivosť** (úmyselný
rozchod musí padnúť, kozmetický UI kľúč nie). Keď ho budeš meniť, tú vrstvu
nezahoď — bez nej môže byť zelený a nemerať nič.

**Smernica potrebuje MariaDB.** `searchNodes` používa `COLLATE utf8mb4_unicode_ci`,
ktorý sqlite nemá. V registri má `requires_mariadb => true` a preskočí sa **len
tá jedna obrazovka**, nie celý test. Overuj ju cez `phpunit.mariadb.xml`.

## Stav

Hotové vlny A (audit), C (Runy backend), E (parita 8 obrazoviek).
**421 passed, 45 skipped, 0 failed.** MCP má 20 toolov (12 nad uzlom, 8 nad
obrazovkami).

**Nedokončené a prečo:** vlna B (jeden dizajnový jazyk) a obrazovka Runy. Nie pre
rozsah — v hlavnom checkoute paralelne bežal schválený **branding šprint**, ktorý
prefarbuje akcent na amethyst a premenúva konzolu na Charón, teda prepisuje tie
isté tokeny. `mind.css`, `mind.blade.php` a `console.blade.php` som preto na zápis
neotvoril vôbec.

**Backend obrazovky Runy je hotový a otestovaný** — `/api/runs`,
`/api/runs/{uuid}`, `/api/runs/{uuid}/rerun`, `mind_runs`, `mind_run`. Chýba len
screen modul, položka v raile a CSS.

## Prvé tri kroky ďalšieho behu

1. Pustiť dva padnuté audity (čitateľnosť a hustota, prístupnosť) **nad finálnou
   paletou**. Teraz by merali paletu v pohybe.
2. Vlna B nad finálnymi tokenmi. Baseline dvojitých deklarácií je v kontrakte §2
   — kritérium „žiadne nové dvojice" sa meria voči tým číslam.
3. Obrazovka Runy: `public/js/mind/screens/runy.js` + rail (skupina ZÁZNAMY) + CSS.
   Poradie z auditu je vynútené: **A16/A20/A21 sa opravujú až nad recorderom**,
   inak sa dôvod ukončenia behu napíše dvakrát a dve kópie sa rozídu.

## Pasca, ktorú si zapíš

**Dve session v jednom pracovnom adresári nie sú merge problém, ale
posledný-vyhráva.** Keď jedna zapíše súbor a druhá ho potom uloží zo svojej
pamäte, prvá zmena zmizne bez konfliktu a bez varovania. `git stash` nepoužívaj
vôbec — zmazal by cudziu neuloženú prácu. Cudzí padajúci test dokáž ako nie svoj
cez `--exclude-filter`, neopravuj ho. Uložené v Hadesovi ako
`Two sessions, one working tree` (certainty: pasca).
