# DevOps + backend

Playbook pre kontajnerizáciu, CI/CD, zero-downtime deploy a prevádzku Laravel/PHP backendu značky Aura — od Dockerfile po monitoring.

## Prehľad

Tento playbook pokrýva "invisible" časť Aura e-shopu/webu: ako sa kód dostane z tvojho počítača do produkcie bez výpadku, ako beží rýchlo a ako zistíš, že sa niečo pokazilo skôr než zákazník.

Prečo to pre biznis so šperkami reálne rozhoduje:
- **Výpadok = stratený predaj.** Keď je web dole počas kampane (Meta Ads, newsletter), platíš za návštevnosť, ktorá naráža na chybu. Zero-downtime deploy a health-checky to eliminujú.
- **Rýchlosť = konverzia + SEO.** Google hodnotí Core Web Vitals; pomalý backend (TTFB) kazí LCP. OPcache, Redis a fronty výrazne skracujú čas odozvy.
- **Fronty (queues) = plynulý zážitok.** Odosielanie potvrdzovacích e-mailov, generovanie faktúr, sync skladu či volania na AI/API nesmú blokovať zákazníka pri objednávke — patria do asynchrónnej fronty.
- **Reprodukovateľnosť.** Docker zaručí, že "u mňa to funguje" platí aj na serveri. Žiadne prekvapenia z inej verzie PHP.
- **Bezpečnosť a dôvera.** Non-root kontajnery, skenované image a auditovateľné CI/CD chránia zákaznícke a platobné dáta (GDPR).

Cieľová architektúra 2026: PHP 8.4 (min. 8.3), Laravel 11/12 (LTS podpora beží; Laravel 13 už vyžaduje min. PHP 8.3), MariaDB, Redis pre cache + fronty, HAProxy/Nginx pred aplikáciou, všetko v Docker Compose, deploy cez GitHub Actions.

## Kľúčové pojmy

- **Docker image / kontajner** — image je nemenný "odliatok" aplikácie (kód + PHP + rozšírenia), kontajner je jeho bežiaca inštancia.
- **Multi-stage build** — Dockerfile s viacerými fázami (`FROM ... AS builder`), kde build nástroje (composer, node, gcc) zostanú v build fáze a do finálneho image sa skopírujú len hotové artefakty. Výsledok: menší, bezpečnejší image.
- **CI (Continuous Integration)** — automatické spustenie testov, lintu a statickej analýzy pri každom push/PR.
- **CD (Continuous Delivery/Deployment)** — automatické zostavenie image a jeho nasadenie na server po prejdení CI.
- **Zero-downtime deploy** — nasadenie bez výpadku. Buď atomic symlink (nový release do nového adresára + prehodenie symlinku), alebo blue-green / rolling.
- **Blue-green** — dve identické prostredia; nová verzia sa nahodí na "idle" (green), otestuje a potom sa preklopí prevádzka na edge.
- **Rolling deploy** — inštancie sa vymieňajú postupne, vždy je časť starých a časť nových online.
- **Expand-contract (parallel change) migrácie** — schéma DB sa mení spätne kompatibilne: najprv pridáš stĺpec/tabuľku (expand), nasadíš kód, potom odstrániš staré (contract). Nutné pre zero-downtime.
- **OPcache** — cache skompilovaného PHP bytecode v pamäti; bez neho sa každý request kompiluje odznova.
- **JIT** — Just-In-Time kompilátor v OPcache; pomáha len CPU-bound kódu.
- **Preloading** — načítanie tried do zdieľanej pamäte pri štarte PHP, aby boli dostupné bez opätovného načítania.
- **Queue / worker** — fronta úloh (Redis) a proces, ktorý ich spracúva na pozadí.
- **Scheduler** — Laravel plánovač (`schedule:run` cez 1 cron záznam) namiesto mnohých crontab riadkov.
- **Horizon** — dashboard a supervízor pre Redis fronty v Laravel.
- **Health check** — endpoint (`/up` v Laravel 11+), ktorý load balancer pinguje; liveness = "žije proces?", readiness = "je pripravený prijímať traffic?".
- **Observability** — schopnosť pochopiť stav systému z troch signálov: **logy**, **metriky**, **traces** (distribuované sledovanie requestu).
- **Cache stampede** — keď populárny kľúč expiruje a desiatky súbežných requestov naraz regenerujú tú istú drahú operáciu.

## Best practices 2025/2026 — aktuálny stav

### Čo sa nedávno zmenilo (dôležité)
- **PHP 8.4 zmenil default JIT.** `opcache.jit` je teraz defaultne `disable` (predtým `tracing`). Ak si JIT zapínal len cez `jit_buffer_size`, teraz musíš **explicitne** nastaviť `opcache.jit=tracing`. Default `jit_buffer_size` je 64M.
- **FrankenPHP je out-of-beta a produkčne stabilný** ako Octane driver (popri Swoole a RoadRunner). Má najmenší memory footprint — ideálny do kontajnerov. Zvažuj ho, ak potrebuješ vysoký throughput.
- **Laravel 11+ zjednotil cache príkazy** do `php artisan optimize` (config + routes + views + events naraz).
- **`Cache::flexible()`** (Laravel 11) prináša natívne stale-while-revalidate — zákazník takmer nikdy nečaká na "studený" kľúč.
- **OpenTelemetry dosiahlo GA pre všetky 3 signály** (metrics, traces, logs). Je to dnes vendor-neutral štandard.
- **Laravel Pulse** je súčasťou Laravel 11+ pre real-time app metriky (pomalé queries, joby, cache).
- **PHP oficiálny image `php:8.4-fpm` beží na Debian 13 (Trixie).**

### Docker / image
- **Multi-stage build**: fáza `composer` (vendor), fáza `node` (Vite assets), finálna runtime fáza z čistého `php:8.4-fpm`.
- **Non-root**: finálny kontajner beží ako `www-data` (nie root). `USER www-data` na konci.
- **Malý a čistý image**: žiadny gcc/make/node vo finále; `.dockerignore` (vyhoď `.git`, `node_modules`, `tests`, `.env`).
- **Pin verzie** (`php:8.4.x-fpm`, nie `latest`) pre reprodukovateľnosť.
- **Skenuj a podpisuj**: Trivy/Grype na CVE, cosign na podpis image.
- **Zdravie**: `HEALTHCHECK` v Dockerfile alebo v compose.

### PHP výkon (produkcia)
- `opcache.enable=1`, `opcache.validate_timestamps=0` (súbory sa po deployi nemenia → PHP ich nekontroluje). **Po deployi treba reštartovať PHP-FPM/kontajner**, aby sa načítal nový kód.
- `opcache.memory_consumption=256`, `opcache.interned_strings_buffer=16`, `opcache.max_accelerated_files=65536`, `opcache.revalidate_freq=0`.
- **JIT len ak CPU-bound**: `opcache.jit=tracing`, `opcache.jit_buffer_size=128M`. Pri I/O-bound appke (typický e-shop: DB + API) JIT nechaj vypnutý — neprináša benefit.
- **Preloading**: `opcache.preload=/var/www/bootstrap/preload.php`, `opcache.preload_user=www-data`. V preload skripte používaj `opcache_compile_file()` (nie `require`), aby sa nekonali side-effecty. Nepreloaduj celý vendor — nafúkne pamäť.

### Laravel clean architecture (PHP 8.3+)
- **Thin controllers** — HTTP vrstva len prijme request a vráti response.
- **Actions / Services / DTOs** — biznis logika v samostatných invokovateľných Action triedach alebo Service triedach; dáta cez typované DTO (readonly properties, PHP 8.2+).
- **Form Requests** na validáciu, **API Resources** na serializáciu, **Policies** na autorizáciu.
- **Enums** (PHP 8.1+) pre stavy objednávok, typy platieb.
- **Nikdy N+1** — eager loading (`with()`), v CI zapni `Model::preventLazyLoading()` v ne-produkcii.
- **Statická analýza**: PHPStan/Larastan level 8+, Pint (code style), Rector (automatizované upgrady), Pest pre testy.

### Fronty a scheduler
- **Všetko pomalé do fronty**: e-maily, faktúry, webhooky, AI volania, generovanie obrázkov, sync skladu.
- **Redis** ako queue driver + **Horizon** ako supervízor a dashboard.
- **Idempotencia** jobov (retry nesmie spôsobiť dvojitú objednávku/e-mail); `ShouldBeUnique`, backoff, `failed_jobs` monitoring.
- **Scheduler**: 1 cron riadok `* * * * * php artisan schedule:run`; proti prekrytiu `->withoutOverlapping()`, v HA `->onOneServer()`.

### Redis caching
- **Produkcia = Redis/Memcached**, nikdy `file` ani `database` cache driver.
- **Cache-aside** cez `Cache::remember()`; pre populárne kľúče `Cache::flexible()` (stale-while-revalidate).
- **Anti-stampede**: `Cache::lock()` (atomic lock) okolo drahej regenerácie; TTL + jitter (náhodná odchýlka), aby kľúče neexpirovali naraz.
- **Cache tags** (len Redis/Memcached) na hromadnú invalidáciu súvisiacich položiek.
- **Versioned keys** namiesto mazania (`products:v3:...`).
- Cieľ: hit-rate query cache > 80 %. Osobitná Redis DB/instancia pre cache vs. queue (rôzne eviction politiky).

### CI/CD
- **CI pipeline**: composer install (s cache) → Pint → PHPStan (cache výsledkov) → Pest (SQLite alebo MariaDB service) → build assetov (Vite) → build & push Docker image.
- **Registry cache** (`cache-from`/`cache-to` typ gha) na rýchle buildy.
- **Quality gates** ako povinné checks pred merge do `main`.
- **Secrets** cez GitHub Actions secrets / OIDC, nikdy v repozitári.

### Zero-downtime deploy
- **Octane pozor**: ak beží Laravel Octane, **nepoužívaj** externý zero-downtime symlink mechanizmus — Octane rieši graceful restart interne, kombinácia to rozbije.
- **Post-deploy sekvencia** (bez Octane): `php artisan migrate --force` (expand-only) → `php artisan optimize` → `php artisan storage:link` → `php artisan queue:restart` (alebo restart Horizon).
- **Shared storage**: `storage/` musí byť zdieľaný adresár mimo release adresára, inak sa po symlink deployi rozbije `public/storage`.
- **Migrácie**: vždy spätne kompatibilné (expand-contract), aby stará aj nová verzia kódu fungovala počas prekliku.

## Krok za krokom — od kódu po produkciu

### 1. Dockerfile (multi-stage, skrátene)
```dockerfile
# --- vendor ---
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist --no-interaction --no-autoloader

# --- assets ---
FROM node:22-alpine AS assets
WORKDIR /app
COPY package*.json vite.config.js ./
RUN npm ci
COPY resources ./resources
RUN npm run build

# --- runtime ---
FROM php:8.4-fpm AS app
RUN docker-php-ext-install pdo_mysql opcache bcmath pcntl \
 && pecl install redis && docker-php-ext-enable redis
WORKDIR /var/www
COPY --chown=www-data:www-data . .
COPY --from=vendor /app/vendor ./vendor
COPY --from=assets /app/public/build ./public/build
COPY docker/opcache.ini /usr/local/etc/php/conf.d/opcache.ini
RUN composer dump-autoload --optimize --no-dev
USER www-data
```

### 2. OPcache config (`docker/opcache.ini`)
```ini
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=256
opcache.interned_strings_buffer=16
opcache.max_accelerated_files=65536
opcache.validate_timestamps=0
opcache.revalidate_freq=0
opcache.preload=/var/www/bootstrap/preload.php
opcache.preload_user=www-data
; JIT len ak je appka CPU-bound:
; opcache.jit=tracing
; opcache.jit_buffer_size=128M
```

### 3. Docker Compose (produkcia — služby)
`app` (php-fpm), `web` (Nginx/HAProxy), `worker` (`php artisan horizon` alebo `queue:work`), `scheduler` (loop nad `schedule:run`), `mariadb`, `redis`. Každá má `restart: unless-stopped` a healthcheck.

### 4. GitHub Actions CI (`.github/workflows/ci.yml`)
```yaml
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with: { php-version: '8.4', extensions: mbstring, pdo_mysql, redis }
      - run: composer install --prefer-dist --no-interaction
      - run: vendor/bin/pint --test
      - run: vendor/bin/phpstan analyse --memory-limit=1G
      - run: php artisan test   # Pest
```

### 5. CD — build & push image (po merge do main)
Použi `docker/build-push-action` s `cache-from`/`cache-to: gha`, tag = git SHA + `latest`, push do GHCR. Potom trigger deployu na server (SSH / webhook).

### 6. Deploy na server (bez Octane)
```bash
docker compose pull
docker compose up -d --no-deps app web    # nový image
docker compose exec -T app php artisan migrate --force
docker compose exec -T app php artisan optimize
docker compose exec -T app php artisan queue:restart
```
HAProxy/Nginx medzitým smeruje traffic len na "ready" inštancie (`/up`).

### 7. Overenie
`curl -f https://.../up` → 200; skontroluj Horizon dashboard (žiadne failed jobs), Pulse (žiadne skoky latencie), logy bez errorov.

## Checklist

**Image & build**
- [ ] Multi-stage Dockerfile, finálny image bez composer/node/gcc
- [ ] Kontajner beží ako `www-data` (non-root)
- [ ] Verzie pinnuté (`php:8.4.x`), `.dockerignore` na mieste
- [ ] Image skenovaný (Trivy/Grype) a ideálne podpísaný (cosign)

**PHP výkon**
- [ ] OPcache zapnutý, `validate_timestamps=0`, reštart FPM po deployi
- [ ] Preload skript cez `opcache_compile_file()`
- [ ] JIT zapnutý len ak je appka CPU-bound

**Laravel**
- [ ] Thin controllers, biznis logika v Action/Service + DTO
- [ ] Form Requests, API Resources, Policies
- [ ] `php artisan optimize` je súčasť deployu
- [ ] N+1 pod kontrolou (`preventLazyLoading` mimo prod)

**Fronty & scheduler**
- [ ] Pomalé operácie v Redis fronte, Horizon beží ako supervízor
- [ ] Joby idempotentné, `failed_jobs` monitorované
- [ ] 1 cron riadok pre scheduler, `withoutOverlapping()` / `onOneServer()`

**Redis cache**
- [ ] Redis (nie file/database) v produkcii
- [ ] Anti-stampede: `Cache::lock()` + TTL jitter alebo `Cache::flexible()`
- [ ] Oddelená cache vs. queue Redis instancia/DB

**CI/CD & deploy**
- [ ] Pint + PHPStan(8+) + Pest ako povinné CI gates
- [ ] Secrets v GitHub Secrets/OIDC, nie v repo
- [ ] Zero-downtime: expand-contract migrácie, shared `storage/`
- [ ] `queue:restart` po každom deployi
- [ ] Octane? → vypni externý symlink zero-downtime mechanizmus

**Observability**
- [ ] `/up` health endpoint napojený na LB
- [ ] Štruktúrované (JSON) logy, centrálne zbierané
- [ ] Metriky (Pulse/Prometheus) + alerting na error-rate a latenciu
- [ ] Sentry (alebo ekvivalent) na chyby

## Časté chyby

- **Zabudnutý reštart PHP-FPM po deployi** s `validate_timestamps=0` → beží starý kód. Vždy reštart/reload FPM alebo kontajnera.
- **JIT "pre istotu" zapnutý** na I/O-bound e-shope → žiadny zisk, len réžia. Meraj pred zapnutím.
- **Migrácie, ktoré nie sú spätne kompatibilné** (drop/rename stĺpca počas deployu) → 500 chyby počas prekliku. Používaj expand-contract.
- **Octane + externý zero-downtime symlink** → rozbitý deploy. Nechaj to na Octane.
- **`storage/` v release adresári** → po symlink deployi zmiznú nahrané obrázky produktov. Daj ho do shared.
- **Blokujúce operácie v HTTP requeste** (odoslanie e-mailu, PDF faktúra, AI volanie) → pomalá objednávka, timeouty. Do fronty.
- **Neidempotentné joby** → retry pošle dvojitý e-mail / vytvorí duplicitnú objednávku.
- **`file` alebo `database` cache v produkcii** → pomalé, neškáluje. Redis.
- **Cache stampede** po nasadení (studená cache + kampaň) → zahltená DB. Warm-up job po deployi + `Cache::flexible()`.
- **Secrets v `.env` commitnuté do gitu** → únik. `.env` do `.gitignore`, secrets v CI store.
- **`latest` tagy image** → nereprodukovateľné buildy. Tag = git SHA.
- **Root kontajner** → väčšia škoda pri kompromitácii. `www-data`.
- **Nezoradené indexy / chýbajúci EXPLAIN** — nesúvisí priamo s Dockerom, ale najčastejší dôvod pomalého backendu; skontroluj slow query log.

## Nástroje

- **Kontajnery**: Docker, Docker Compose, BuildKit (`cache-from gha`)
- **CI/CD**: GitHub Actions (`shivammathur/setup-php`, `docker/build-push-action`), GHCR registry
- **Runtime/servery**: PHP-FPM, alternatívne FrankenPHP / Laravel Octane (Swoole/RoadRunner), Nginx alebo HAProxy pred appkou
- **PHP kvalita**: Laravel Pint, PHPStan/Larastan (level 8+), Rector, Pest
- **Fronty/scheduler**: Redis, Laravel Horizon, supervisord (mimo Dockera)
- **Cache**: Redis 7+, `Cache::flexible()`, cache tags
- **Observability**: Laravel Pulse, Telescope (dev), Sentry (chyby), OpenTelemetry PHP SDK → Grafana Tempo/Prometheus/Loki, Grafana 11 dashboardy
- **Bezpečnosť image**: Trivy alebo Grype (skenovanie CVE), cosign (podpis)
- **DB**: MariaDB, migrácie cez Laravel, `migrate --force` + expand-contract

## Zdroje

- [Laravel Deployment in 2026: 12 Practices That Matter — Deploynix](https://deploynix.io/blog/the-state-of-laravel-deployment-in-2026-whats-changed-and-what-still-hurts)
- [Deployments — Laravel Forge docs](https://forge.laravel.com/docs/sites/deployments)
- [How to Deploy Laravel: Zero Downtime, Build Pipelines, and Best Practices — DeployHQ](https://www.deployhq.com/blog/how-to-deploy-laravel-zero-downtime-build-pipelines-and-best-practices)
- [The Complete Laravel Deployment Guide 2025 — PloyCloud](https://ploy.cloud/blog/complete-laravel-deployment-guide-2025)
- [Opcache: INI changes on how JIT is enabled — PHP 8.4 • PHP.Watch](https://php.watch/versions/8.4/opcache-jit-ini-default-changes)
- [PHP: OPcache Runtime Configuration — php.net](https://www.php.net/manual/en/opcache.configuration.php)
- [PHP: Preloading — php.net Manual](https://www.php.net/manual/en/opcache.preloading.php)
- [FrankenPHP, OPcache JIT & Preloading for Laravel — Mohamed Said](https://msaied.com/articles/frankenphp-opcache-jit-and-preloading-maximising-laravel-throughput)
- [Creating Multi-Stage Docker Builds for Laravel — Laravel News](https://laravel-news.com/multi-stage-docker-builds-for-laravel)
- [Develop and Deploy Laravel applications with Docker Compose — Docker Docs](https://docs.docker.com/guides/frameworks/laravel/production-setup/)
- [How to Containerize a PHP Laravel Application with Docker — OneUptime](https://oneuptime.com/blog/post/2026-02-08-how-to-containerize-a-php-laravel-application-with-docker/view)
- [Set up GitHub Actions for Laravel applications — Laravel News](https://laravel-news.com/laravel-ci-with-github-action)
- [Beyond Telescope: Real Observability in Laravel with Sentry, Pulse, and OpenTelemetry — Medium](https://medium.com/@maharshmangal2400/beyond-telescope-real-observability-in-laravel-with-sentry-pulse-and-opentelemetry-73b4bfc063c5)
- [How To Use OpenTelemetry in Laravel 11 — gmhafiz](https://www.gmhafiz.com/blog/laravel-with-opentelemetry/)
- [Instrument a PHP application — Grafana OpenTelemetry docs](https://grafana.com/docs/opentelemetry/instrument/php/)
- [Laravel Caching: Tags, Locks & Invalidation (Complete Guide) — RichDynamix](https://richdynamix.com/articles/laravel-caching-strategies-complete-guide)
- [Laravel + Redis Cache — Tags, Locks, Stampede Prevention — DomainIndia](https://domainindia.com/support/kb/laravel-redis-cache-tags-stampede-prevention)
- [Laravel Performance Checklist (2026): Horizon, Redis, MySQL — itmarkerz](https://itmarkerz.co.in/blog/laravel-performance-checklist-2026-horizon-redis-mysql-indexing-caching)
