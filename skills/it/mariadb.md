# MariaDB & databázy

> Praktický playbook pre návrh, ladenie a prevádzku MariaDB (11.x / 11.8 LTS) v Docker + Laravel prostredí značky Aura.

## Prehľad — čo to je a prečo to pre Auru rieši

MariaDB je open-source relačná databáza (fork MySQL), ktorá je pre e-shop Aura "zdroj pravdy": produkty, varianty, ceny, sklad, objednávky, zákazníci, obsah. Beží v Dockeri vedľa Laravel aplikácie a Redisu.

Prečo to je dôležité konkrétne pre šperkársky biznis:
- **Peniaze a dôvera**: objednávky a platby musia byť atomické a trvanlivé (ACID / InnoDB). Stratená alebo duplicitná objednávka = reálna finančná a reputačná strata.
- **Sklad kusových produktov**: šperky sú často unikáty alebo malé série. Potrebuješ korektné zamykanie riadkov, aby sa ten istý kus nepredal dvakrát pri súbežných objednávkach.
- **Rýchlosť = konverzia**: pomalé kategórie a filtre (materiál, kameň, veľkosť) zabíjajú konverziu aj SEO (Core Web Vitals). Väčšina "pomalého webu" je v skutočnosti chýbajúci index alebo N+1 dotaz.
- **GDPR**: osobné údaje zákazníkov musia byť mazateľné, minimalizované a chránené (least privilege, TLS, šifrovanie záloh).

Odporúčaná verzia (2026): **MariaDB 11.8 LTS** (GA jún 2025, podpora do 2030) alebo prípadne staršia **10.11 LTS**. LTS vždy uprednostni pred "rolling" vydaniami (11.5, 11.7…), ktoré majú krátky support.

## Kľúčové pojmy — slovník toho podstatného

- **InnoDB** — predvolený storage engine. Transakčný (ACID), row-level locking, crash-safe. Používaj vždy; MyISAM/Aria len na výnimky (napr. dočasné/analytické tabuľky). MariaDB predvolene beží nad InnoDB.
- **Buffer pool** (`innodb_buffer_pool_size`) — RAM cache dátových a index stránok. Najdôležitejší výkonový parameter. Cieľ: hit ratio 99 %+.
- **Redo log** (`innodb_redo_log_capacity` v 11.x, predtým `innodb_log_file_size`) — write-ahead log pre crash recovery a plynulé flushovanie.
- **Index** — B-tree štruktúra na rýchle vyhľadávanie. Bez neho = full table scan. **Composite index** = viac stĺpcov; poradie stĺpcov rozhoduje (pravidlo left-most prefix).
- **Covering index** — index, ktorý obsahuje všetky stĺpce dotazu, takže netreba čítať samotný riadok (`Using index` v EXPLAIN).
- **Clustered index** — v InnoDB je tabuľka fyzicky zoradená podľa PRIMARY KEY. Preto má PK obrovský vplyv na výkon; ideálne malý, rastúci (BIGINT AUTO_INCREMENT alebo UUIDv7), nie náhodné UUIDv4.
- **EXPLAIN / EXPLAIN ANALYZE** — plán dotazu. `EXPLAIN` = odhad, `EXPLAIN ANALYZE` = reálne spustí a ukáže skutočné časy a počty riadkov.
- **Keyset pagination (seek method)** — stránkovanie cez `WHERE id < :last ORDER BY id DESC LIMIT n` namiesto `OFFSET`. Konštantná rýchlosť aj na 100 000. strane.
- **Transakcia / izolácia** — MariaDB default `REPEATABLE READ`. Pre e-shop často vhodnejšie `READ COMMITTED`. Zámky: `SELECT ... FOR UPDATE` (rezervácia skladu).
- **PITR (Point-In-Time Recovery)** — obnova do presnej sekundy = plná záloha + prehratie binárnych logov (binlog).
- **Binlog** — binárny log všetkých zmien; základ pre replikáciu aj PITR. `ROW` formát je štandard.
- **Replikácia vs. Galera** — asynchrónna replikácia (primary→replica) je jednoduchá, má malé oneskorenie. **Galera** = synchrónny multi-primary cluster (virtually synchronous), vyššia dostupnosť, ale citlivý na latenciu a veľké transakcie.
- **Prepared statement** — parametrizovaný dotaz; oddeľuje SQL od dát → obrana proti SQL injection. Laravel Eloquent/Query Builder ich používa automaticky.
- **utf8mb4** — jediný rozumný charset (plný Unicode vrátane emoji). Starý `utf8` (alias `utf8mb3`) je 3-bajtový a nekompletný — nepoužívať.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Charset a collation (dôležitá zmena)
- Vždy **`utf8mb4`**. Od MariaDB **11.6** je nová predvolená collation **`utf8mb4_uca1400_ai_ci`** (Unicode CLDR 14.0.0, presnejšie triedenie diakritiky vrátane slovenčiny). Na starších verziách používaj `utf8mb4_unicode_ci`.
- Nastav to na úrovni servera aj DB, nech to netreba riešiť per-tabuľka:
  ```ini
  character-set-server = utf8mb4
  collation-server     = utf8mb4_uca1400_ai_ci
  ```
- V Laraveli maj v `config/database.php` `'charset' => 'utf8mb4'` a zodpovedajúcu collation.

### InnoDB tuning (Docker kontext)
- **`innodb_buffer_pool_size`** = 60–75 % RAM kontajnera (nie hostu!). Pri malom VPS s 4 GB daj kontajneru limit a buffer pool cca 2–2,5 GB. Nikdy nedaj viac, než má kontajner `mem_limit`, inak OOM kill.
- **`innodb_flush_log_at_trx_commit`**:
  - `1` (default) = plná durabilita, flush pri každom commite. **Toto nechaj pre produkčnú DB s objednávkami a platbami.**
  - `2` = flush ~1×/s; rýchlejšie, ale pri páde OS môžeš stratiť ~1 s transakcií. OK len pre nekritické/analytické inštancie.
- **Zmena v 11.0+**: starý `innodb_flush_method` je deprecated. Flushovanie sa teraz riadi 4 dynamickými bool premennými: `innodb_log_file_buffering`, `innodb_data_file_buffering`, `innodb_log_file_write_through`, `innodb_data_file_write_through`. Na väčšine setupov netreba meniť.
- **Redo log**: v 11.x používaj `innodb_redo_log_capacity` (napr. `2G`) namiesto starého `innodb_log_file_size`. Väčší = menej častý flush = plynulejší zápis pri návaloch (Black Friday).
- **`innodb_io_capacity`** = podľa disku: HDD ~200, SSD 1000–2000, NVMe 2000+.
- **`sync_binlog = 1`** ak beží replikácia a záleží na tom, aby binlog prežil pád (spolu s `flush_log_at_trx_commit=1` = plná durabilita).
- **`innodb_buffer_pool_instances`** — na moderných verziách sa autotuneuje, ručne netreba.

### Indexovanie
- Indexuj stĺpce vo `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY`. Pre e-shop: `products.slug` (UNIQUE), `products.category_id`, `order_items.order_id`, `orders.user_id`, `orders.created_at`.
- **Composite index poradie**: najprv stĺpce s rovnosťou (`=`), potom rozsah/sort. Napr. `INDEX (category_id, created_at)` obslúži `WHERE category_id = ? ORDER BY created_at`.
- Nepredávaj sa: príliš veľa indexov spomaľuje zápisy a žerie RAM. Odstraňuj nepoužívané (`sys`/`information_schema` alebo `pt-index-usage`).
- **Cardinality**: index na stĺpci s 2 hodnotami (napr. `is_active`) je väčšinou zbytočný samostatne — má zmysel len ako súčasť composite.
- **Prefix index** na dlhé VARCHAR/TEXT: `INDEX (description(50))`.
- Fulltext hľadanie produktov: buď MariaDB `FULLTEXT` index (malý katalóg), alebo dedikovaný engine (Meilisearch/Typesense) pri väčšom katalógu a typo-tolerancii.

### Optimalizácia dotazov
- Vždy `EXPLAIN` pomalé dotazy. Zle: `type: ALL` (full scan), `rows` v tisícoch, `Using filesort`/`Using temporary`. Dobre: `type: ref/eq_ref/const`, `Using index`.
- `EXPLAIN ANALYZE` (od 10.1, vylepšované do 11.8) ukáže reálne časy — použi na potvrdenie, či index naozaj pomohol.
- **Keyset pagination** namiesto `LIMIT ... OFFSET` pri hlbokom stránkovaní katalógu:
  ```sql
  SELECT id, name, price FROM products
  WHERE (created_at, id) < (:last_created, :last_id)
  ORDER BY created_at DESC, id DESC
  LIMIT 24;
  ```
- **N+1 problém** je v Laraveli najčastejšia príčina pomalého webu — rieš eager loadingom (`Product::with('images','category')`). Zapni `Model::preventLazyLoading()` v dev prostredí.
- Zapni **slow query log** (`slow_query_log=1`, `long_query_time=1`, `log_queries_not_using_indexes=1`) a analyzuj cez `pt-query-digest`.
- Histogramy / optimizer statistics: `ANALYZE TABLE` po veľkých importoch, aby optimizer robil dobré rozhodnutia.

### Bezpečnosť
- **Least privilege**: aplikačný používateľ dostane len `SELECT, INSERT, UPDATE, DELETE` na svojej DB. Žiadne `DROP`, `ALTER`, `GRANT`, `FILE`, `SUPER`. Migrácie spúšťaj samostatným (DDL) používateľom, nie runtime app userom.
  ```sql
  CREATE DATABASE aura CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
  CREATE USER 'aura_app'@'%' IDENTIFIED BY '…silné heslo…';
  GRANT SELECT, INSERT, UPDATE, DELETE ON aura.* TO 'aura_app'@'%';
  FLUSH PRIVILEGES;
  ```
- **Nikdy root pre aplikáciu.** Root len na admin/migrácie a ideálne len z localhostu kontajnera.
- **Prepared statements**: Laravel ich robí automaticky. Nikdy nelep hodnoty do SQL cez `DB::raw()` s používateľským vstupom.
- **TLS** medzi appkou a DB, ak nie sú v tej istej Docker sieti / na tom istom hoste. V compose sieti minimálne obmedz expose portu 3306 (neexponuj na 0.0.0.0).
- **Šifrovanie**: data-at-rest (InnoDB encryption) pri citlivých údajoch; zálohy vždy šifrované a v transporte cez TLS.
- Zmaž anonymných používateľov a test DB (`mariadb-secure-installation`).
- Docker secrets / `.env` mimo git; heslá cez `MARIADB_PASSWORD` + `_FILE` varianty, nie natvrdo v compose.

### Zálohy a PITR
- **Plná záloha**: `mariadb-backup` (fyzická, konzistentná bez zámkov na InnoDB). Pre malý katalóg stačí aj `mariadb-dump --single-transaction` (logická, prenosná).
- **PITR** = plná záloha + binlogy. Zapni binlog (`log_bin`, `binlog_format = ROW`) a drž binlogy **7–14 dní** (`binlog_expire_logs_seconds`). `mariadb-backup` ukladá pozíciu do `mariadb_backup_binlog_info`.
- **Kompresia**: moderne `zstd` (8–10× menšie pri textových dátach).
- **3-2-1 pravidlo**: 3 kópie, 2 média, 1 off-site (napr. S3/MinIO), ideálne 1 immutable. **Testuj restore** — netestovaná záloha nie je záloha.
- Automatizuj denné plné + priebežné binlogy; monitoruj úspešnosť jobu.

### Vysoká dostupnosť
- Pre Auru vo väčšine prípadov stačí **1 primary + 1 async replica** (čítacia + failover + zdroj pre zálohy).
- **Galera** zvažuj len ak potrebuješ multi-node zápis / zero-downtime. Pozor: každá tabuľka musí mať PRIMARY KEY, dlhé transakcie a veľké deletes sú problém, latencia medzi uzlami je kritická.
- **Nové (2025)**: MariaDB 11.8 LTS pridala natívny **VECTOR** typ a `VECTOR` index (HNSW, cosine/euclidean, do 16 383 dimenzií) — použiteľné na "semantic search" / odporúčania produktov cez embeddingy priamo v DB bez extra vektorovej databázy.

## Krok za krokom — pridanie novej tabuľky/feature v Aure

1. **Návrh schémy**: definuj stĺpce, typy (`DECIMAL(10,2)` na ceny — nikdy FLOAT!), NOT NULL kde treba, cudzie kľúče, `utf8mb4`.
2. **PK**: `BIGINT UNSIGNED AUTO_INCREMENT` (alebo UUIDv7 ak treba distribúciu). Vyhni sa random UUIDv4 ako PK.
3. **Migrácia (Laravel)**: napíš `Schema::create(...)`, pridaj indexy (`->index()`, `->unique()`), FK (`->constrained()`). Spusti cez DDL usera.
4. **Indexy podľa dotazov**: najprv napíš dotazy, ktoré budeš robiť, potom navrhni indexy (composite v správnom poradí).
5. **Overenie plánu**: naplň testovacími dátami (aspoň desaťtisíce riadkov) a spusti `EXPLAIN` na reálnych dotazoch. Cieľ: žiadny `type: ALL` na horúcich cestách.
6. **Eager loading**: v kóde nalaď vzťahy, over že nevzniká N+1 (Laravel Debugbar / Telescope).
7. **Transakcie**: operácie meniace sklad + objednávku zabaľ do `DB::transaction()` a použi `lockForUpdate()` na skladovom riadku.
8. **Migrácia na produkciu**: expand-contract vzor (najprv pridaj stĺpec/index nullable, deployni kód, potom backfill, až nakoniec drop starého) → zero-downtime.
9. **Monitoring**: sleduj slow log a buffer pool hit ratio po nasadení.

## Checklist

- [ ] Verzia = MariaDB LTS (11.8 alebo 10.11), nie rolling release
- [ ] `utf8mb4` + `uca1400_ai_ci` (alebo `unicode_ci`) na serveri aj DB
- [ ] `innodb_buffer_pool_size` = 60–75 % RAM **kontajnera** (rešpektuj `mem_limit`)
- [ ] `innodb_flush_log_at_trx_commit = 1` na produkcii s objednávkami
- [ ] `innodb_redo_log_capacity` nastavené (napr. 2G), nie starý `log_file_size`
- [ ] Ceny v `DECIMAL`, nie `FLOAT`/`DOUBLE`
- [ ] Každá tabuľka má PRIMARY KEY; FK majú indexy
- [ ] Indexy pokrývajú WHERE/JOIN/ORDER BY horúcich dotazov; žiadne nepoužívané
- [ ] Hlboké stránkovanie = keyset, nie OFFSET
- [ ] Aplikačný user má len SELECT/INSERT/UPDATE/DELETE; migrácie samostatným userom
- [ ] Root neexponovaný, port 3306 neverejný, TLS ak treba
- [ ] Binlog zapnutý (`ROW`), retencia 7–14 dní
- [ ] Denná plná záloha (`mariadb-backup`) + PITR, šifrovaná, off-site, **otestovaný restore**
- [ ] Slow query log zapnutý, pravidelne analyzovaný
- [ ] Transakcie + `lockForUpdate` na skladových operáciách
- [ ] `.env`/secrets mimo git

## Časté chyby

- **`utf8` namiesto `utf8mb4`** → padne na emoji a niektorých znakoch; migrácia neskôr je bolestivá. Rovno `utf8mb4`.
- **`FLOAT`/`DOUBLE` na ceny** → zaokrúhľovacie chyby v peniazoch. Vždy `DECIMAL(10,2)`.
- **Buffer pool > RAM kontajnera** → OOM kill, DB spadne pod záťažou. Rátaj z `mem_limit`, nie z RAM hostu.
- **Chýbajúci index na FK / WHERE** → full table scan, pomalé kategórie. Skontroluj `EXPLAIN`.
- **`LIMIT OFFSET` na hlbokom stránkovaní** → čím ďalej strana, tým pomalšie. Keyset.
- **N+1 v Laraveli** → 1 + 100 dotazov na výpis. Eager loading + `preventLazyLoading()` v dev.
- **App beží ako root DB user** → jeden bug/injection = celá DB preč. Least privilege.
- **`innodb_flush_log_at_trx_commit = 2` na produkcii s platbami** → možná strata objednávok pri páde. Nechaj `1`.
- **Netestované zálohy** → zistíš to až keď treba obnoviť. Rob restore drilly.
- **Random UUIDv4 ako clustered PK** → fragmentácia, pomalé inserty. BIGINT AUTO_INCREMENT alebo UUIDv7.
- **Migrácie s `DROP/ALTER` počas peaku bez expand-contract** → zamknuté tabuľky, výpadok. Používaj online DDL / expand-contract.
- **Galera bez PRIMARY KEY na tabuľke / s obrími transakciami** → cluster sa rozpadne. Preferuj async replikáciu ak HA netreba.

## Nástroje

- **mariadb-backup** — fyzické zálohy + PITR (súčasť servera).
- **mariadb-dump** — logické zálohy (`--single-transaction`), prenos schémy.
- **Percona Toolkit** — `pt-query-digest` (analýza slow logu), `pt-online-schema-change` (online ALTER), `pt-index-usage`.
- **mytop / innotop** — realtime monitoring dotazov a záťaže.
- **Laravel Telescope / Debugbar** — odhalenie N+1 a pomalých dotazov v aplikácii.
- **DBeaver / TablePlus / HeidiSQL** — GUI klient na dotazy a schému.
- **Prometheus + mysqld_exporter + Grafana** — dlhodobý monitoring (buffer pool hit ratio, connections, slow queries).
- **mariadb-secure-installation** — základné zabezpečenie novej inštancie.
- **Docker oficiálny image `mariadb:11.8`** — s `MARIADB_*` env premennými a `_FILE` variantmi pre secrets.

## Zdroje

- [InnoDB System Variables — MariaDB Documentation](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-system-variables)
- [10 Database Tuning Tips for Peak Workloads — MariaDB](https://mariadb.com/resources/blog/10-database-tuning-tips-for-peak-workloads/)
- [Binary Log Group Commit and InnoDB Flushing Performance — MariaDB Documentation](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/binary-log-group-commit-and-innodb-flushing-performance)
- [innodb_flush_log_at_trx_commit best practices — Releem](https://releem.com/docs/mysql-performance-tuning/innodb_flush_log_at_trx_commit)
- [InnoDB Performance Optimization: 15 Tuning Tips — MinervaDB](https://minervadb.com/innodb-performance-optimization-mysql-tuning/)
- [MariaDB 11.8 LTS Released — MariaDB.org](https://mariadb.org/11-8-lts-released/)
- [MariaDB Community Server 11.8 LTS is Now Available — MariaDB](https://mariadb.com/resources/blog/latest-lts-version-of-mariadb-community-server-11-8-is-now-available/)
- [MariaDB Vector — native vector search — MariaDB.org](https://mariadb.org/projects/mariadb-vector/)
- [MariaDB Query Optimization Skill — MariaDB/skills (GitHub)](https://github.com/MariaDB/skills/blob/main/mariadb-query-optimization/SKILL.md)
- [Point-In-Time Recovery (PITR, mariadb-backup) — MariaDB Documentation](https://mariadb.com/docs/server/server-usage/backup-and-restore/mariadb-backup/point-in-time-recovery-pitr-mariadb-backup)
- [MariaDB Point In Time Recovery — MariaDB](https://mariadb.com/resources/blog/mariadb-point-in-time-recovery/)
- [MariaDB backup 10 best practices — Medium](https://medium.com/@ngza5tqf/mariadb-backup-10-best-practices-essential-strategies-for-mariadb-backup-and-recovery-b74410207707)
- [GRANT — MariaDB Documentation](https://mariadb.com/docs/server/reference/sql-statements/account-management-sql-statements/grant)
- [MySQL/MariaDB Security Configuration — CubePath](https://cubepath.com/docs/database-management/mysql-mariadb-security-configuration)
