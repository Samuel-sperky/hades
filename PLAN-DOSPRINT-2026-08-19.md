# Plán doprintu — zvyšok kontraktu konzoly

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-konzola` · **Východisko:** 362 testov zelených
**Štruktúra:** 1 koordinátor → max 3 pracovníci → koordinátor integruje
**Strop:** ~500k tokenov (šprint pred tým spálil 2,65 M, preto je toto úzko orezané)

## Prečo koordinátor a nie priamy fan-out

Predchádzajúce vlny som špecifikoval sám a dvakrát som poslal agentov na nález,
ktorý neexistoval (dve z troch N+1 boli chyba môjho merania). Koordinátor preto
najprv **prečíta reálny stav repa** a až z neho napíše zadania — vrátane vlastníctva
súborov, aby si pracovníci nešli do cesty. Do rozsahu nesmie pridať nič, čo nie je
v menu nižšie.

## Menu balíkov (koordinátor z nich vyberá a spresňuje, nič nepridáva)

**A — Vektorový prewiring.** `mind:rewire` dnes páruje uzly TF-IDF kosínusom a pri
2587 uzloch beží **cez 55 minút v O(n²)**, kým 2672 bge-m3 vektorov je predpočítaných.
Musí zostať aditívne (pri `HADES_EMBEDDINGS=false` sa chová ako dnes) a **len
`--dry-run`**: podlaha podobnosti sa odvodí zo vzorky ~20 uzlov porovnaním top-5
susedov TF-IDF vs vektory, nie z okrúhleho čísla. Zle zvolená podlaha = tisíce hrán
a hairball, z ktorého sa táto sieť už raz zachraňovala (`mind:prune-coactivation`).

**B — Nezávislý review korektnosti.** Bezpečnostnú prehliadku mám hotovú útokom
(15/15 na nástroje, 12/12 XSS, `/decide` scopovaný na vlákno). Chýba druhý pohľad na
**korektnosť** diffu šprintu a na to, či sú **moje vlastné čísla reprodukovateľné**.
Hlási, neopravuje.

**C — Zjednotenie pomenovania po premenovaní na Charón.** Paralelná session
premenovala konzolu (`console.blade.php`, `main.js`, `ConsoleGuardTest`, `docs/BRAND-HADES.md`),
ale `CLAUDE.md` aj kontrakt hovoria „Konzola vedomia" a komentáre v kóde tiež.
Zjednotiť tak, aby appka aj dokumentácia hovorili jedným menom — bez plošného
prepisu a bez zásahu do cudzích rozrobených súborov.

## Poradie a hranice

1. Koordinátor si prečíta stav a napíše zadania s vlastníctvom súborov.
2. Pracovníci bežia **paralelne** len ak sa im súbory neprekrývajú; A a C sa
   neprekrývajú, B je len na čítanie.
3. Koordinátor na konci overí: celá sada zelená, tvrdenia reprodukované, a napíše,
   čo z menu zostalo nedotknuté a prečo.

## Tvrdé pravidlá pre všetkých

- Žiadne `git` zápisy (commituje orchestrátor), žiadne mazanie dát v `hades`,
  žiadne vypisovanie hodnôt z `.env`.
- Na tej istej vetve pracuje **iná session** — nikto nesiaha na `app/Models/Run.php`,
  `app/Serializers/Screen/*`, `RunsController`, `docs/audit/*`, `docs/BRAND-HADES.md`.
- Komentáre po slovensky a vysvetľujú PREČO; identifikátory po anglicky.
- Merací harness sa kalibruje na známom stave, inak jeho čísla neplatia.
