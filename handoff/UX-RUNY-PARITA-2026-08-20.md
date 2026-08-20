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

**Nedokončené a prečo:** zvyšok vlny B — zjednotenie duplikátov komponentov
naprieč grafom a konzolou a density prepínač. Nie pre rozsah: v hlavnom checkoute
paralelne bežal schválený **branding šprint**, ktorý prefarbuje akcent na amethyst
a premenúva konzolu na Charón, teda prepisuje tie isté tokeny. Kým mal `mind.css`
a `mind.blade.php` rozpracované, neotvoril som ich na zápis vôbec; obrazovka Runy
vznikla až po tom, čo ich commitol.

**Obrazovka Runy je HOTOVÁ** (`7bbf3a4`) — časová os po dňoch, filtre zo
serverových počtov, detail s krokmi, tool callmi a diffom, „spustiť znovu".
Postavená na existujúcich komponentoch (`.dtl*`, `.chip`, `.badge`), takže
priniesla len ~140 riadkov CSS. Pri overení sa našlo, že stavové farby padali na
svetlej téme (2,80–3,85:1) — pridané `--success-ink`, `--danger-ink`, `--warn-ink`
podľa vzoru `--accent-ink`, s odmeranou hodnotou v komentári.

## Prvé tri kroky ďalšieho behu

1. Pustiť dva padnuté audity (čitateľnosť a hustota, prístupnosť) **nad finálnou
   paletou**. Teraz by merali paletu v pohybe.
2. Vlna B nad finálnymi tokenmi. Baseline dvojitých deklarácií je v kontrakte §2
   — kritérium „žiadne nové dvojice" sa meria voči tým číslam.
3. Zvyšok vlny B: zjednotiť duplikáty komponentov naprieč grafom a konzolou
   a density prepínač — nad finálnou paletou.
   Poradie z auditu ostáva vynútené: **A16/A20/A21 sa opravujú až nad recorderom**,
   inak sa dôvod ukončenia behu napíše dvakrát a dve kópie sa rozídu.

## Pasca, ktorú si zapíš

**Dve session v jednom pracovnom adresári nie sú merge problém, ale
posledný-vyhráva — a platí to aj pre git index a HEAD.** `git add` jednej session
+ `git commit` druhej = commitneš cudziu nastageovanú prácu pod svojou správou
(stalo sa v oboch smeroch). `git checkout` cudzej session presunie HEAD aj tebe,
takže moje commity mali byť na `feat/hades-konzola` a skončili na
`feat/hades-branding`. Pred commitom preto vždy `git diff --cached --name-only`
a po commite `git show --stat`; reset zdieľanej histórie NEROB. Keď jedna zapíše súbor a druhá ho potom uloží zo svojej
pamäte, prvá zmena zmizne bez konfliktu a bez varovania. `git stash` nepoužívaj
vôbec — zmazal by cudziu neuloženú prácu. Cudzí padajúci test dokáž ako nie svoj
cez `--exclude-filter`, neopravuj ho. Uložené v Hadesovi ako
`Two sessions, one working tree` (certainty: pasca).

## Merač kontrastu: dve kalibračné pasce

Pri overovaní obrazovky Runy merač dvakrát klamal a oba razy sa to dalo zistiť len
kalibráciou na známom stave (`body`, `.screen-sub`):

1. **Neskládal poloprehľadné vrstvy pozadia** a hlásil badge 1,92–2,80:1, teda
   falošný pád na farbách, ktoré boli v poriadku. Pozadie treba zbierať od prvku
   nahor po prvú NEPRIEHĽADNÚ vrstvu a potom ich zložiť zdola.
2. **Prepnutie témy v tom istom synchronnom bloku** čítalo farby rozbehnutého
   prechodu — `.run-prompt` vyšlo 1,22:1 namiesto 17,3:1. Po `data-theme` sa musí
   nechať dosadnúť (samostatné volanie, nie ten istý blok).

Keby som prvému číslu veril, „opravoval" by som funkčné farby. Screenshot v tomto
prostredí nejde (Browser pane nekompozituje rámce), takže dôkaz je zmeraný DOM.
