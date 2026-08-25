# Schéma pre `/chat` — projekty, vetvenie, prílohy, strom behov

Vlna 1, koľaj **W1-C**. Kontrakt: `KONTRAKT-CHAT-APPKA-2026-08-25.md` (§3 rozsah,
§4 čo nie, §5 kritériá 6 a 11).

**Migrácie sú napísané a NESPUSTENÉ.** Púšťa ich orchestrátor so `mysqldump`
zálohou (kritérium §5/11).

| súbor | čo robí |
|---|---|
| `database/migrations/2026_08_25_000001_create_console_projects_table.php` | `console_projects`; `console_threads.project_id`, `pinned_at`, `archived_at` |
| `database/migrations/2026_08_25_000002_create_console_branches_table.php` | `console_branches`; `console_threads.active_branch_id`, `console_messages.branch_id`, `runs.branch_id` + backfill |
| `database/migrations/2026_08_25_000003_create_console_attachments_table.php` | `console_attachments` |
| `database/migrations/2026_08_25_000004_add_parent_run_id_to_runs.php` | `runs.parent_run_id` |

Nič sa nepremenováva (§4): `console_*` tabuľky, `hades.console.*` kľúče a `Console*`
triedy zostávajú. Nové tabuľky idú do tej istej menovej rodiny.

---

## 1. Projekty (zložky vlákien)

### Nová tabuľka, nie stĺpec — a prečo

Zvažoval som `console_threads.project` ako obyčajný string. Dal by zoskupenie
a nič viac:

| požiadavka §3 | stĺpec so menom | tabuľka |
|---|---|---|
| premenovanie | `UPDATE` naprieč vláknami; preklep rozdvojí projekt | `UPDATE` jedného riadku |
| pripnutie / archivácia projektu | nemá kam sadnúť | vlastné stĺpce |
| prázdny projekt | neexistuje | riadok bez vlákien |
| URL projektu | nemá identifikátor | `uuid` |

Na druhej strane netreba ani pivot: **vlákno patrí najviac do jedného projektu**,
a pivot pre vzťah 0..1 dovoľuje presne to, čo schéma zakazuje — musel by si to
brať späť unikátnym indexom.

### `console_projects`

| stĺpec | typ | rozhodnutie |
|---|---|---|
| `id` | bigint PK | |
| `uuid` | uuid, **unique** | verejný identifikátor do URL `/chat/projekt/<uuid>` |
| `name` | string(120) | bez `unique` — dva projekty s tým istým menom sú neporiadok, nie chyba dát |
| `pinned_at` | timestamp **nullable** | nullable timestamp, nie boolean: `null` = nepripnuté, a dátum navyše nesie poradie pripnutých |
| `archived_at` | timestamp **nullable** | to isté |
| `created_at` / `updated_at` | | |

**Index: žiadny.** Bočný panel čítá všetky projekty (jednotky až desiatky) a radí
`archived_at IS NULL`, `pinned_at DESC`, `name`. Index nad tabuľkou, ktorá sa vždy
číta celá, je náklad na zápis bez čitateľa.

**Počet vlákien tu nie je.** Denormalizované počítadlo je presne tá chyba, ktorú
našiel audit 19. 8. 2026 (Denník počítal čipy projektov z 50 načítaných záznamov,
takže čip sľuboval číslo, ktoré zoznam nedal).

**`instructions` / per-projektový systémový prompt tu NIE JE.** Kontrakt §3 hovorí
„projekty/zložky, premenovanie, pripnutie, archivácia" — nič viac. Keď to bude
v rozsahu, je to jedna migrácia; stĺpec do zásoby nie.

### `console_threads` — nové stĺpce

| stĺpec | typ | rozhodnutie |
|---|---|---|
| `project_id` | unsignedBigInteger **nullable**, FK → `console_projects.id` **nullOnDelete** | „bez projektu" je normálny a najčastejší stav, nie chýbajúca hodnota; `default(0)` by bol neplatný cudzí kľúč |
| `pinned_at` | timestamp nullable | pripnutie vlákna funguje aj bez projektu — sú to dve nezávislé osi |
| `archived_at` | timestamp nullable | |

**`nullOnDelete`, nie `cascadeOnDelete`** — to isté rozhodnutie ako
`2026_08_20_000001_keep_runs_when_a_thread_is_deleted`: s kaskádou by jeden klik
„zmazať projekt" zmazal všetky konverzácie v ňom. Zmazanie zložky má vlákna
vysypať, nie spáliť.

**Index `['project_id', 'last_message_at']` — áno.** Dopyt panelu je
`WHERE project_id = ? ORDER BY last_message_at DESC`; zložený index ho pokryje
celý. Zároveň poslúži cudziemu kľúču (InnoDB si vyrobí vlastný index len keď
žiadny vhodný neexistuje — preto je v migrácii poradie **stĺpec → index → FK**).

**`pinned_at` a `archived_at` index nedostávajú:** filter nad rádovo stovkami
vlákien, `archived_at IS NULL` má nízku kardinalitu, plánovač by index preskočil.

---

## 2. Vetvenie konverzácie — najťažšia časť

### Reprezentácia

`console_branches`:

| stĺpec | typ | rozhodnutie |
|---|---|---|
| `id` | bigint PK | |
| `uuid` | uuid unique | prepínanie vetiev je odkaz; poradové id by prezrádzalo, koľkokrát sa človek vracal |
| `thread_id` | FK → `console_threads` **cascade** | vetva bez vlákna nemá zmysel |
| `parent_branch_id` | FK → `console_branches` **nullable, cascade** | `null` = korenná vetva. Kaskáda a nie `nullOnDelete`: potomok bez svojho prefixu nie je korenná vetva, je to nezmyselný záznam. Self-FK je tu zadarmo, pretože je súčasťou `CREATE TABLE` — v `down()` sa tabuľka celá zahodí |
| `forked_from_message_id` | unsignedBigInteger nullable, **bez FK** | posledná dedená správa rodiča. Bez FK z toho istého dôvodu ako `runs.from_message_id`: FK by uzavrel kruh kaskád `messages → branches → messages` a jediné, čo by priniesol, je nezmazateľný stĺpec |
| `created_at` / `updated_at` | | |

Index `['thread_id', 'id']` (prepínač čítá všetky vetvy vlákna naraz).
`parent_branch_id` vlastný index nedostáva — InnoDB si ho pre FK vyrobí sám
a strom vetiev jedného vlákna má jednotky riadkov.

`console_threads.active_branch_id` — unsignedBigInteger nullable, **bez FK**:
`console_branches.thread_id` už ukazuje sem, takže FK odtiaľ tam by bol vzájomný
kruh, ktorý sa v `down()` musí rozpájať v presnom poradí a na sqlite bráni
zmazaniu stĺpca. A podmienku, na ktorej záleží („aktívna vetva patrí TOMUTO
vláknu"), cudzí kľúč vyjadriť nevie. Keď vetva zmizne, čítanie spadne na korennú
vetvu vlákna — definovaný stav, nie chyba.

`console_messages.branch_id` — unsignedBigInteger **nullable**, FK →
`console_branches` **cascade**, index `['branch_id', 'id']`.

**Žiadna existujúca správa sa neprepisuje ani nemaže.** Editácia správy človeka
založí novú vetvu, ktorá dedí prefix po `forked_from_message_id`; upravená správa
je jej prvý vlastný záznam. Pôvodná vetva je čitateľná ďalej — to je presne to,
čo §3 žiada („pôvodná zostáva").

`console_tool_calls` vetvu **nedostávajú**: visia na `message_id`, takže vetvu
dedia po svojej správe. Tretí stĺpec s tou istou informáciou by sa rozišiel.

### Skládanie histórie jednej vetvy

1. Jeden `SELECT` nad `console_branches` pre vlákno (jednotky riadkov).
2. V PHP prechod od `active_branch_id` nahor po korennú → reťaz
   `[(branch_id, strop id)]`. Strop je `forked_from_message_id` **dieťaťa**;
   aktívna vetva strop nemá.
3. Jeden `SELECT` nad `console_messages`:

```sql
SELECT * FROM console_messages
 WHERE thread_id = :thread
   AND (   branch_id = 3                                -- aktívna, bez stropu
        OR (branch_id = 2 AND id <= 820)                -- dedený prefix
        OR ((branch_id = 1 OR branch_id IS NULL) AND id <= 500) )
 ORDER BY id
```

Žiadna rekurzia v SQL, žiadne CTE (sqlite aj MariaDB 11.4 by ho zvládli, ale nie
je naň dôvod).

Dve veci, ktoré treba vidieť:

- **Dolná hranica v podmienkach chýbať môže.** Vetva vznikla po svojom odbočení,
  takže všetky jej vlastné správy majú `id` väčšie než jej
  `forked_from_message_id`.
- **`ORDER BY id` je správne konverzačné poradie aj naprieč vetvami**, pretože
  `id` je poradie vzniku a dedený prefix je vždy starší než vlastné správy vetvy.
  Pozor: `id` je globálny autoincrement, takže id-čka jedného vlákna **nie sú
  susedné** — čokoľvek, čo počíta `id + 1`, je chyba.

`branch_id IS NULL` v korennej klauzule je záchranná sieť, nie cesta dopytu:
migrácia dopĺňa `branch_id` všetkým existujúcim správam, takže po nej je NULLov
nula. Keby ich niekto vyrobil (zápis, ktorý zabudol vetvu), správa sa objaví
v korennej vetve — teda v pôvodnom lineárnom chovaní. Je to horší z dvoch stavov,
ale **viditeľný**; neviditeľná správa by bola horšia.

Dôsledok pre `AgentRunner::history()`: okno `history_window` sa počíta **nad
reťazou vetvy**, nie nad `thread_id` (dnešný dopyt je
`$thread->messages()->whereIn('role', …)->orderByDesc('id')->limit($window)`).
Bez toho by model dostal do kontextu správy z opustenej vetvy.

### Prečo to nerozbije rozsah `runs`

`runs` nesie členstvo správ **rozsahom id** (`from_message_id`–`to_message_id`)
a `Run::messages()` ho čítá ako `whereBetween` nad `thread_id`. Vetvenie ten
rozsah nerozbíja z dvoch dôvodov:

1. **`console_messages.id` je autoincrement, takže vetva pripája na koniec.**
   Nová vetva nikdy nevloží správu medzi `from_message_id` a `to_message_id`
   staršieho behu. Vkladanie do stredu histórie je jediná operácia, ktorá by
   rozsah pokazila, a schéma ju neumožňuje.
2. **Vo vlákne beží jeden ťah naraz a to sa vetvením nemení.**
   `RunRecorder::openExclusive()` zamyká riadok **vlákna** a `RunController::run`
   odmietne správu, kým čaká nedorozhodnutý zápis. Vetvy žijú vnútri jedného
   vlákna, takže prepnutie vetvy nevyrába druhého pisateľa.

> **Nosná veta: exkluzivita behu je na úrovni VLÁKNA, nie vetvy.**
> Keby niekto neskôr „optimalizoval" súbežný beh dvoch vetiev jedného vlákna,
> každý rozsah v tom vlákne sa stane nepresným — beh by hlásil cenu cudzieho
> ťahu a v detaile ukázal cudzie správy. Presne to `RunRecorder` v komentári
> označuje ako **overené, nie hypotézu**. Test to musí pinovať.

`runs.branch_id` (unsignedBigInteger nullable, **bez FK**, **bez indexu**) je
preto **doplnok, nie zdroj členstva**: hovorí, ktorú vetvu beh predĺžil, aby to
log ukázal bez načítania správ.

- Bez FK z toho istého dôvodu, z akého je `thread_id` `nullOnDelete`: log má
  prežiť zmazanie toho, o čom hovorí. Kaskáda by zmazaním vetvy zmazala jej behy —
  presne to, čo naprávala migrácia `keep_runs_when_a_thread_is_deleted`. Visiaci
  ukazovateľ je čitateľný stav („vetva už neexistuje"), rovnako ako dnešné
  `thread = null`.
- Bez indexu, pretože zoznam behov sa vždy zužuje najprv časom
  (`['status','started_at']`, `started_at`) alebo vláknom (`['thread_id','id']`);
  vetva je až posledné dozúženie nad desiatkami riadkov. Prehodnotiť, keď `runs`
  narastie o rád — nie skôr (tá istá úvaha ako brute-force nad vektormi).

**Odporúčaný druhý pás (aditívny, netreba migráciu):** `Run::messages()` a
`Run::toolCalls()` môžu pridať `->where('branch_id', $run->branch_id)`, keď nie je
`null`. Potom by aj budúca chyba so súbežnými vetvami dala menšiu, ale **čistú**
množinu namiesto zmiešanej. Podmienka na `null` je nutná, aby staré behy ostali
čitateľné.

### Backfill (v `up()` druhej migrácie)

Každé existujúce vlákno dostane korennú vetvu; jej id sa zapíše do
`console_threads.active_branch_id`, do `console_messages.branch_id` a do
`runs.branch_id` toho vlákna.

Nie je to kozmetika: do dnes bola konverzácia lineárna, takže „táto správa patrí
do hlavnej vetvy" je **pravda, ktorú poznáme** — na rozdiel od
`runs.tool_profile`, kde `null` znamenalo „nikto to nezaznamenal" a dopisovať
`'full'` by bola vymyslená história. Preto tam nullable bez backfillu, a tu
nullable **s** backfillom.

Zapisuje sa cez `DB::table`, nie cez modely: modely sa menia, migrácia musí dať
ten istý výsledok aj za rok.

Behy bez vlákna (`thread_id IS NULL`, beh prežil svoje vlákno) zostanú
`branch_id = null` — správne, tá vetva už neexistuje.

---

## 3. Prílohy

### Obsah nie je v DB

- Blob by bol v každom `mysqldump`, a záloha pred migráciou je povinná
  (§5/11, posledné 3 v `backups/`): jedno 20 MB PDF = 60 MB záloh, a rastie
  s tým, čo človek nahodí do chatu.
- Stiahnutie z blobu znamená celý súbor v pamäti PHP workera, ktorých je osem.

**Obsah na disk, metadáta do DB.**

### Kde na disku

```
<hades.console.attachments_root>/<thread-uuid>/<attachment-uuid>.<ext>
```

Default koreň: `storage_path('app/console-attachments')`, prepínateľný cez
`HADES_CONSOLE_ATTACHMENTS_ROOT` (config kľúč vlna, ktorá upload stavia, dopĺňa —
`config/hades.php` nie je súbor tejto koľaje).

Meno na disku vyrába **uuid, nikdy `original_name`**. Názov od človeka sa ukladá
len na zobrazenie a na `Content-Disposition`.

### Ako to nekoliduje s `PathGuard` (§5/6)

`PathGuard` sa **neoslabuje ani neobchádza** — na tejto ceste vôbec nie je,
pretože žiadna cesta od klienta na filesystem nevedie: sťahovanie berie `uuid`,
vyhľadá riadok a číta `path`. Dve veci to ale vyžaduje od vlny, ktorá upload
postaví, a obe sú testovateľné:

1. **`path` sa pred čítaním rozloží (`realpath`) a musí padnúť do koreňa príloh.**
   Riadok, ktorého `path` vedie inam, sa **odmietne, nesanitizuje** — to isté
   pravidlo ako v `PathGuard`, len s druhým, úzkym koreňom. Preto je `path` v DB
   **relatívny** ku koreňu: absolútna cesta by kontrolu robila nejednoznačnou.
   *Test §5/6:* riadok s `path = '../../.env'` (aj v podobe s symlinkom) sa musí
   odmietnuť.
2. **Default koreň leží pod `hades.console.files_root`** (ten je `base_path()`),
   takže bez zásahu by prílohy vedel čítať súborový tool modelu — a model vo
   vlákne A by videl prílohu vlákna B. Do `PathGuard::DENY_PREFIXES` preto musí
   pribudnúť `storage/app/console-attachments`. Fail-closed: kým tam nepribudne,
   prílohy sa nikam neukladajú.
   *Test:* `read_file('storage/app/console-attachments/…')` sa odmietne.

Alternatíva (koreň úplne mimo `files_root`) je legitímna, ale mimo `base_path()`
by prestala fungovať prenositeľnosť kontejnera — preto deny prefix.

### `console_attachments`

| stĺpec | typ | rozhodnutie |
|---|---|---|
| `id` | bigint PK | |
| `uuid` | uuid unique | v URL na stiahnutie **a** meno súboru na disku |
| `thread_id` | FK → `console_threads` **cascade** | príloha bez vlákna je nedosiahnuteľná |
| `message_id` | FK → `console_messages` **nullable, cascade** | `nullable`, pretože upload je PRED odoslaním správy: `null` = „rozpracované vo vstupe", živý stav, nie chýbajúci údaj. Kaskáda a nie `nullOnDelete` (na rozdiel od `console_tool_calls.message_id`): tool call bez správy je stále čitateľný záznam v logu, príloha bez správy je nedosiahnuteľný súbor |
| `original_name` | string(255) | len na zobrazenie a stiahnutie; do cesty sa nedostane nikdy |
| `path` | string(255) | relatívna ku koreňu príloh. **Bez `unique`** — dve vetvy jedného vlákna zdieľajú jeden súbor |
| `mime` | string(128) | zistený **na serveri**; `Content-Type` od klienta je tvrdenie, nie fakt |
| `size_bytes` | unsignedBigInteger | |
| `sha256` | char(64) nullable | integrita pri stiahnutí + lacný kľúč na budúcu deduplikáciu. `null` = nepočítané, nie „bez odtlačku". Index nedostáva — dedup zatiaľ nikto nerobí |
| `text_content` | longText nullable | **cache**, nie druhá kópia obsahu: model potrebuje text v prompte a parsovať to isté PDF pri každom z dvadsiatich ťahov je na CPU nezmysel |
| `extracted_at` | timestamp nullable | dvojstavovosť bez enumu: `null` → extrakcia ešte nebežala; nastavené + `text_content IS NULL` → bežala a text v súbore nie je |
| `created_at` / `updated_at` | | |

Index `['thread_id', 'message_id']` — pokryje „rozpracované prílohy vlákna"
(`thread_id = ? AND message_id IS NULL`) a slúži cudziemu kľúču vlákna;
`message_id` má vlastný index od svojho FK, ktorý pokryje skládanie histórie
(`message_id IN (…)`).

Vetvu prílohy nenesú — dedia ju po svojej správe, rovnako ako
`console_tool_calls`.

### Čo sa stane pri zmazaní vlákna

Riadok ide kaskádou (`thread_id`, a druhou cestou `message_id` — dve kaskádové
cesty do tej istej tabuľky InnoDB dovoľuje). Súbor kaskáda nezmaže, takže sú na to
dve cesty a obe treba:

- `ThreadController::destroy` zmaže priečinok `<koreň>/<thread-uuid>/` — je
  odvoditeľný z uuid, takže na to netreba prečítať ani jeden riadok;
- **zametač** (vzor `mind:reap-runs`, každých 10 minút) dobehne to, čo padlo pri
  smrti procesu, a zmaže **rozpracované prílohy** (`message_id IS NULL`) staršie
  než niekoľko hodín — súbory, ktoré človek nahodil do vstupu a správu neposlal.

> **Súbor sa nikdy nemaže pri mazaní riadku, len zametačom a len keď naň
> neukazuje žiadny riadok.** Dôvod je vetvenie: editácia správy skopíruje prílohy
> ako **riadky** (nové uuid, ten istý `path`) a súbor sa nekopíruje ani needituje.
> Keby mazanie riadku mazalo súbor, zmazanie jednej vetvy by vytrhlo prílohu
> druhej.

Migrácia `down()` súbory na disku **nemaže**: migrácia, ktorá pri `down()` maže
dáta z disku, je nevratná napriek svojmu menu.

---

## 4. `runs.parent_run_id` — strom podbehov

| stĺpec | typ |
|---|---|
| `parent_run_id` | unsignedBigInteger **nullable**, **bez FK**, index `parent_run_id` |

**`nullable` a nie `default`** — presne z dôvodu, ktorý pomenovala migrácia
`add_tool_profile_*`: `null` znamená „beh, ktorý nikto nespustil, začal ho
človek", a to je pravdivá informácia o každom existujúcom riadku. Akákoľvek
default hodnota by musela byť číslo, a `0` nie je beh — o starých behoch by
tvrdila, že mali rodiča, ktorého nikto nezaznamenal. Backfill preto **nie je**
(na rozdiel od `branch_id`, kde sme pravdu poznali).

**Bez cudzieho kľúča**, a ani jedna z jeho dvoch podôb nie je správna:

- `cascadeOnDelete` by zmazaním jedného riadku zmazal celý podstrom logu — tá
  istá strata, ktorú naprávala `keep_runs_when_a_thread_is_deleted`;
- `nullOnDelete` by z podbehu ticho urobil beh spustený človekom, teda by prepísal
  to jediné, čo tento stĺpec hovorí.

**Index áno**, na rozdiel od `runs.branch_id`: dopyt „deti behu X" beží pri každom
otvorení detailu a pri kreslení stromu, a `runs` je jediná tabuľka v tomto šprinte,
ktorá rastie s každou interakciou — takže je to jediné miesto, kde index zaplatí
sám seba.

Podbeh **dedí `thread_id` a `branch_id` rodiča**: hovorí do tej istej konverzácie
a jeho zaparkovaný zápis čaká na toho istého človeka (§5/4). Rozsah id zostáva
presný, pretože beh vo vlákne je jeden naraz — rodič je počas podbehu pozastavený
a nezapisuje vlastné správy. **Túto podmienku musí držať `spawn_agent`, nie
schéma:** keby rodič a podagent písali súbežne, oba rozsahy sa prekryjú a log by
o oboch behoch hlásil cenu druhého.

---

## 5. `down()`, ktoré naozaj funguje

Laravel 13 na sqlite:

- `dropColumn` → **natívne** `ALTER TABLE DROP COLUMN`
  (`SQLiteGrammar::compileDropColumn`, sqlite ≥ 3.35). Sqlite ho odmietne, keď je
  stĺpec **indexovaný** alebo **v cudzom kľúči**.
- `foreign` a `dropForeign` sú v `getAlterCommands()` → prestavba tabuľky
  (`compileAlter`), ktorá indexy zo stavu obnoví. **Fungujú aj na sqlite** —
  komentár v `keep_runs_when_a_thread_is_deleted` o nepodpore je z inej verzie.

Z toho vyplýva poradie, ktoré každé `down()` v tomto balíku drží, a každý krok má
**vlastné `Schema::table`**, aby sa nedal preusporiadať:

1. `dropForeign` (MySQL neuvoľní index, kým ho FK potrebuje),
2. `dropIndex`,
3. `dropColumn`,
4. `Schema::dropIfExists` rodičovskej tabuľky **až nakoniec** (MySQL neodmietne
   zahodiť rodiča živého cudzieho kľúča).

V `up()` je poradie **stĺpec → index → cudzí kľúč**: InnoDB si pre FK vyrobí
vlastný index len keď žiadny vhodný neexistuje, takže zložený index
s FK stĺpcom na prvom mieste zabráni duplikátu.

### Čo treba overiť pred dôverou v testy

Pridanie cudzieho kľúča k **existujúcej** tabuľke je v tomto repozitári **bez
precedensu na sqlite**: jediná taká migrácia,
`keep_runs_when_a_thread_is_deleted`, je od sqlite odstrihnutá `if`om. Migrácie
000001 a 000002 to robia (`console_threads.project_id`,
`console_messages.branch_id`) — a na sqlite to znamená prestavbu tabuľky
uprostred `Schema::table`.

Pád migrácie zhodí celú sadu, takže ten sa neprehliadne. Prehliadnuteľné je
**ticho vynechané pravidlo**: keby `nullOnDelete` / `cascadeOnDelete` na sqlite
nevzniklo, sada zostane zelená a rozdiel medzi testovou a živou databázou sa
ukáže až v produkcii — presne tá pasca, ktorú
`keep_runs_when_a_thread_is_deleted` v docblocku pomenúva.

Merať, nie predpokladať. `phpunit.xml` beží na sqlite `:memory:`, takže sa to
overí testom, nie príkazovým riadkom:

- **test na chovanie, nie na schému:** zmazať projekt → jeho vlákna existujú
  ďalej a majú `project_id = null`; zmazať vetvu → jej správy sú preč a `runs`
  zostávajú; zmazať vlákno → vetvy, správy a prílohy sú preč, `runs` zostávajú
  s `thread_id = null`. Tieto tri testy dokazujú všetky štyri cudzie kľúče a
  bežia na oboch databázach.
- **`down()`** overiť raz ručne na MariaDB (`migrate:rollback --step=4`, potom
  `migrate`) — sada `down()` nikdy nespustí, takže bez tohto kroku o ňom
  nevieme nič.

Zelená sada na sqlite sama **nedokazuje, že schéma vznikla celá** — dokazuje len,
že testy nepadli. Je to ten istý druh diery ako 45 preskočených testov pri
recalle.

---

## 6. Čo táto koľaj úmyselne NEROBÍ

- **FULLTEXT index nad `console_messages.content`** (§3 „fulltext hľadanie
  v histórii") tu nie je — nebol v zadaní W1-C. Až sa bude písať, vzor je
  `2026_08_12_000004_add_fulltext_index_to_nodes.php` **vrátane jeho pasce**:
  Laravel hlási pre MariaDB driver `mariadb`, nie `mysql`, takže podmienka len na
  `'mysql'` index ticho preskočí (viď `…_000005_repair_nodes_fulltext_index`).
- **Modely, serializéry ani kontroléry.** Nová obrazovka = serializér + **jeden
  riadok** do `ScreenParityTest::registry()`; to je práca implementačnej vlny.
- **`config/hades.php`.** Kľúč `attachments_root` popisujem, nepíšem — súbor je
  mimo tejto koľaje.
- **Migrácie sa nespúšťajú.**
