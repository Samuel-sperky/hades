# Šprint III — dopísať, čo šprint II sľúbil a nepostavil

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-klient` (worktree, pokračuje)
**Nadväzuje na:** `KONTRAKT-HADES-KONZOLA-II-2026-08-19.md` (§9 Výsledok)
**Strop:** ~700 k tokenov · **Štruktúra:** 1 koordinátor + 3 pracovníci, integráciu robí hlavná smyčka

## 1. Prečo tento šprint existuje

Šprint II dobehol so zelenou sadou (462 PHP + 45 Node), ale kvalitná brána našla tri
veci, ktoré **nie sú chyby kódu, ale nesplnené sľuby kontraktu**, a jednu vec, ktorá
z pôvodného kontraktu zostala otvorená. Nič z toho nie je kozmetika:

1. **Bezpečnostná dokumentácia nebola dopísaná.** Šprint pridal shell tool a celý nový
   autentizačný okruh (`auth.console`, loopback-only, bez CSRF) — teda presne to, čo
   `docs/BEZPECNOST.md` popisuje — a ten súbor sa diffom nedotkol. Projektové pravidlo
   pritom hovorí: zmena v auth/prístupoch = povinná security prehliadka **a jej zápis**.
   Prehliadka sa stala, zápis nie. Akceptačné kritérium 10 kontraktu II je nesplnené.
2. **`README.md` o nových klientoch mlčí** (`grep bin/hades README.md` = 0). Kto repo
   otvorí, o terminálovom ani desktopovom klientovi nemá ako vedieť.
3. **§4 kontraktu II sľubuje**, že v plánovanom behu „čokoľvek zápisové sa odloží do
   frontu potvrdení". Postavené to nie je — headless sada zápisové tooly vôbec nenaloží,
   takže nočný rozvrh nedokáže navrhnúť zmenu, len napísať report. Buď sa to postaví,
   alebo sa kontrakt opraví; ticho medzi tým je najhoršia z troch možností.
4. **W12 zostáva otvorená:** `mind:rewire` páruje uzly TF-IDF kosínusom, hoci v DB je
   2672 embeddingov. Sľubovaný „prewiring cez embeddingy" teda nebeží.

## 2. Balíky

Každý balík má **disjunktné vlastníctvo súborov** — to je podmienka, nie odporúčanie.
Spoločné súbory (`ToolRegistry`, `AgentRunner`, `routes/*`, `config/hades.php`) vlastní
**integrátor**, nie pracovník; pracovník mu napíše, čo treba dopojiť.

### P1 — Zapísať, čo sa zmenilo v bezpečnosti (~120 k)

- `docs/BEZPECNOST.md`: nová podsekcia o klietke shellu (tri vrstvy, prečo biely zoznam,
  čo je vedome von a prečo — `sed`, `sort`, `git` história, inštalácie balíkov) a o
  **treťom okruhu** `auth.console` (loopback + brána mostu, odmietnutie proxy hlavičiek,
  prečo tam CSRF nechýba). Model hrozby doplniť o dve veci, ktoré brána našla a ktoré
  sú zaplatené: úvodzovkový obchvat deny zoznamu a plošné `auto_accept`.
- `README.md`: `bin/hades` (príkazy, odkiaľ berie token) a `desktop/` (ako sa spustí).
- Kontrakt II §4: príkaz sa volá `mind:console-schedules`, nie `mind:console-run`.
- `tests/phpunit.klient2.xml` a `.klient3.xml` zlúčiť: jeden config, `DB_DATABASE`
  z premennej prostredia. Tri takmer identické súbory sú tri miesta na zabudnutie.

**Vlastní:** `docs/BEZPECNOST.md`, `README.md`, `KONTRAKT-HADES-KONZOLA-II-*.md`,
`tests/phpunit.klient*.xml`.

### P2 — Prewiring cez embeddingy, s meraním (~200 k)

`mind:rewire` dnes hľadá príbuznosť TF-IDF kosínusom (`SimilarityService`). Pridať
**vektorovú vetvu** nad existujúcimi embeddingmi a **zmerať, či niečo pridáva**:

- koľko hrán navrhne vektorová vetva, ktoré TF-IDF nenašla (a naopak),
- na vzorke ručne posúdiť, či sú tie nové hrany zmysluplné — číslo bez toho nestačí,
- záver napísať poctivo aj vtedy, keď zdvih nebude: tento repozitár už raz zaplatil za
  lekciu „meraj pred optimalizáciou" a druhýkrát ju platiť nemusí.

**Vlastní:** nový `app/Services/EmbeddingSimilarity.php` (alebo ekvivalent),
`app/Console/Commands/MindRewire.php`, `tests/Feature/*Prewiring*Test.php`.
**Nedotýka sa:** `MindService`, `recall`, tvaru MCP odpovedí.

### P3 — Front odložených zápisov (~220 k) — droppable

Aby plánovaný beh vedel navrhnúť zmenu, nie len report:

- tabuľka `console_write_proposals` (tool, argumenty, náhľad/diff, stav, vlákno, čas),
- v headless behu sa zápisový tool **nevykoná, ale zaznamená** s náhľadom (bez toho, aby
  ťah zaparkoval — v skriptovanom behu nie je komu sa spýtať),
- `hades pending` vypíše návrhy, `hades pending approve <id>` / `deny <id>` ich vykoná
  alebo zahodí; vykonanie ide tou istou cestou ako povolenie v UI.

**Vlastní:** migrácia, model, `app/Services/Console/WriteProposals.php`, príkazy v
`bin/hades/`, testy. **Nedotýka sa:** `AgentRunner` (integrátor), UI.

## 3. Akceptačné kritériá

1. `docs/BEZPECNOST.md` popisuje klietku aj `auth.console` vrátane dvoch zaplatených
   nálezov; `README.md` pozná oba klienty; v kontrakte II je správny názov príkazu.
2. Jeden phpunit config pre worktree, DB z prostredia; sada zelená pri dvoch paralelných
   behoch nad rôznymi DB.
3. `mind:rewire` používa embeddingy a v reporte je **číslo**: koľko hrán pridali, koľko
   z posúdenej vzorky bolo zmysluplných.
4. Plánovaný beh, ktorý si vyžiada zápis, ho zaznamená ako návrh; `hades pending` ho
   ukáže a `approve` ho vykoná (test).
5. Celý balík zelený (dnes 462 + 45), nič z toho nemení tvar `mind_recall`.

## 4. Čo tento šprint NEROBÍ

- Nesiaha na `feat/hades-konzola` ani na súbory, ktoré redizajnuje druhá session.
- Nemení schému existujúcich tabuliek (len aditívne), nemaže dáta.
- Nerobí preklik v prehliadači — stále blokované (Docker servuje hlavnú vetvu a
  `docker run` pre vlastný port zamietol klasifikátor).
- Nepridáva orchestráciu ani ovládanie počítača (vlastní iná vetva).

## 5. Výsledok

**Stav 20. 8. 2026:** tri commity nad `c0555c7`, vetva pushnutá.
Sada **487 PHP testov** (pred šprintom 462) + **55 Node testov** (pred šprintom 45), zelené.

| Balík | Stav | Čo z toho je |
|---|---|---|
| **P1** | hotové | `docs/BEZPECNOST.md` má **päť** okruhov namiesto štyroch (§3.5 `auth.console`) a §7.1 klietku shellu vrátane toho, čo je z nej vedome von; §8 nesie oba zaplatené nálezy. `README.md` pozná oba klienty. Kontrakt II má správny názov príkazu. Tri phpunit configy sú **jeden**, DB z prostredia |
| **P2** | **kód hotový, meranie beží** | `EmbeddingSimilarity` + vektorová vetva v `mind:rewire` + `--dry-run` porovnanie. **Vypnuté defaultom** (`hades.embeddings.prewire`) — job, ktorý pridáva trvalé hrany, má zapnúť ten, kto videl jeho čísla. 14 testov |
| **P3** | hotové | `console_write_proposals` + `WriteProposals` + `hades pending` / `approve` / `deny`. Programový beh zápis **navrhne**, nevykoná; vykoná sa až rukou človeka. 11 testov + 10 Node |

### Čo musel dorobiť integrátor (a prečo to pracovníci nemohli)

Rozdelenie na disjunktné súbory fungovalo — **nulový konflikt medzi tromi pracovníkmi** —
ale zaplatilo sa tým, že tri veci musel spojiť niekto, kto vidí celok:

1. **P3 by bez zapojenia bol mŕtvy kód.** `HeadlessRunner` (spoločný súbor) teraz zápisový
   tool obaľuje do návrhu namiesto toho, aby ho zahodil. Obal má `isWrite() === false`, takže
   ťah nezaparkuje — a práve preto **nesmie** skončiť v `ToolRegistry::TOOLS`: v prehliadačovom
   okruhu by tichom vypnul potvrdzovanie zápisov. Skladá sa na jedno použitie.
2. **P2 bola celá vypnutá.** Vetva stojí na `config('hades.embeddings.prewire')`, ale
   `config/hades.php` vlastní integrátor, takže kľúč neexistoval a `bridgeByEmbeddings()`
   sa nikdy nespustil.
3. **Bezpečnostná dokumentácia si po pár hodinách odporovala.** P1 písal §3.5 v čase, keď
   headless okruh zápisové tooly vôbec nenakladal; P3 to medzitým zmenil na návrhy. Toto je
   cena paralelnej práce nad jedným systémom a je to práca integrátora, nie chyba pracovníka.

### Poctivá poznámka k P2

Meranie na živých dátach (`mind:rewire --dry-run`, 2679 uzlov) **v čase písania stále beží** —
je to O(n²) kosínus nad 1024-rozmernými vektormi v PHP plus TF-IDF vetva, ktorá je sama
dokumentovaná na ~55 minút. To je samo o sebe zistenie: ako nočný job to znesie, ako
interaktívna operácia nie. Číslo (koľko hrán pridala vektorová vetva, ktoré TF-IDF nenašla,
a či sú na vzorke zmysluplné) sa dopíše sem, keď beh dobehne — vrátane prípadu, že zdvih
nebude žiadny. Do tej chvíle je vetva **vypnutá** a nič v grafe nezmenila.
