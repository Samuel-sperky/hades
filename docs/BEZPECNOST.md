# Bezpečnosť Hadesa

Ako je Hades (AI-mind) chránený, čím konkrétne, a čo chránené **nie je**. Stav
k 13. 8. 2026, branch `feat/hades-hygiena`.

Dokument opisuje mechanizmy, nie hodnoty. Žiadne tokeny, heslá ani hashe tu
nie sú a byť nemajú — tie žijú v `.env` (git-ignorovaný) a v `docker/Caddyfile`.

---

## 1. Čo chránime a proti čomu

Hades drží dlhodobú pamäť používateľa: skills, projekty, osobné fakty,
rozhodnutia, session záznamy. Nie je to verejná appka, ale **je verejne
tunelovaná cez ngrok**, takže model hrozby má tri vrstvy:

| Hrozba | Čo by sa stalo | Kde to riešime |
|---|---|---|
| Cudzí človek z internetu nájde ngrok domény | čítanie celej pamäte, zápis falošných uzlov | Caddy basic-auth + MCP token (§3) |
| Iný proces na tom istom stroji (47 docker kontajnerov, skripty) | volanie `mind_learn` / `mind_decision` bez akejkoľvek autorizácie | token guard na `/mcp` (§3.1) |
| Samotný model (Claude) uloží tajomstvo | heslo/API kľúč natrvalo v pamäti a v `.md` | `SecretScanner` na serveri (§4) |
| Zlyhanie zápisu / súbežný beh | polovičný `.md`, stratený uzol, rozbitý sync | atomický zápis, zámky, tombstones (§6) |

Explicitne **nie je** v modeli hrozby: viacero používateľov s rôznymi právami
(Hades je jednouživateľský), a útočník s prístupom k obsahu `.env`
(kto má `.env`, má všetko).

---

## 2. Sieťová hranica

```
internet ──ngrok──> 127.0.0.1:8095  (caddy)
                         │  basic-auth pre všetko
                         │  výnimka: presná cesta /mcp + správny ?token=
                         ├──> app:8080      (Laravel)
                         └──> reverb:8081   (WebSocket, tiež basic-auth)

localhost ──────────> 127.0.0.1:8080  (app priamo, BEZ basic-auth)
                      127.0.0.1:8081  (reverb priamo)
                      127.0.0.1:3307  (MariaDB)
```

Kľúčové vlastnosti (`docker-compose.yml`):

- **Každý port je bindnutý na `127.0.0.1`**, nie na `0.0.0.0`. Z LAN sa na
  Hadesa nedostane nikto — ani na appku, ani na DB, ani na Caddy.
- Verejná cesta existuje výhradne cez ngrok tunel na `hades-caddy` (8095).
  Tunel nie je systémová služba, spúšťa sa ručne — po reštarte PC je Hades
  offline pre svet, kým ho niekto nezapne.
- Caddy má `admin off` a `auto_https off` (TLS terminuje ngrok).
- OAuth discovery sondy appky Claude (`/.well-known/oauth-*`, `/register`)
  dostávajú tvrdé `404` **pred** basic-auth — inak by appka z `401` usúdila,
  že server má OAuth login, a pripojenie by zlyhalo.

---

## 3. Autentifikácia — tri nezávislé okruhy

### 3.1 `/mcp` — token guard (`AuthenticateMcp`)

Zaregistrovaný priamo v `bootstrap/app.php` na všetky metódy (`GET`, `POST`,
`DELETE`), takže sa nedá obísť inou HTTP metódou.

- Prijíma `Authorization: Bearer <token>` **aj** `?token=<token>`.
  Query varianta nie je pohodlie, ale nutnosť: connectory appky Claude
  (mobil/desktop/web) nevedia poslať vlastnú hlavičku, len URL.
- Porovnanie cez `hash_equals()` → timing-safe, nedá sa uhádnuť po znakoch.
- **Fail-closed**: keď je `hades.mcp_token` prázdny, neprejde nikto (401).
  Nekonfigurovaný server je zamknutý server, nie otvorený.

Historický kontext (zapísaný aj v kóde): do 12. 8. 2026 bol `/mcp` úplne bez
autentifikácie a spoliehal sa len na binding na `127.0.0.1`. To nechránilo pred
ničím, čo beží na tom istom stroji.

**Lokálna cesta bez tunela** (`bin/hades-mcp-stdio.mjs`): most stdio ↔ HTTP pre
klientov, ktorí MCP server spúšťajú ako proces (aplikácia Claude, `--transport
stdio`). Posiela token v hlavičke `Authorization: Bearer`, nie v query stringe,
takže nekončí v access logoch (§8.3), a nejde cez ngrok ani Caddy. Token si číta
z `.env` — v konfigu klienta žiadna kópia tajomstva nevzniká.

### 3.2 Externé `/api/v1/*` — Bearer guard (`AuthenticateApiToken`)

- Alias middleware `auth.token`, aplikovaný na celú `v1` grupu okrem
  `/api/v1/health` (health je zámerne bez tokenu — má byť pinovateľný).
- Iba hlavička `Authorization: Bearer`, **žiadny query fallback** (na rozdiel
  od `/mcp` tu žiadny hlúpy klient nie je).
- `hash_equals()`, rovnaká **fail-closed** logika: prázdny `HADES_API_TOKEN`
  = 401 pre všetkých.

### 3.3 Interné `/api/*` — same-origin, bez tokenu

SPA (dashboard, graf, chat) nikdy nedrží token — volá tie isté controllery
na neprefixovaných cestách. Ochranou je výhradne sieťová hranica (§2):
lokálne binding na `127.0.0.1:8080`, zvonku basic-auth na Caddy.
Je to zámerné rozhodnutie (§4.3 kontraktu), nie opomenutie — ale je to
zároveň najslabšie miesto celej architektúry, pozri §8.

### 3.4 Basic-auth na Caddy

Heslo je uložené ako **bcrypt hash** (cost 12), nie plaintext. Platí pre
dashboard, chat, interné `/api/*` aj WebSocket cestu `/app/*`. Lokálny prístup
na 8080 basic-auth neobchádza — on ním nikdy neprechádza.

---

## 4. Ochrana tajomstiev — `SecretScanner`

Jediný zdroj pravdy pre detekciu tajomstiev: `app/Services/Brain/SecretScanner.php`.
Volá ho **aj MCP boundary, aj brain-write** — nie je možné zapísať do pamäte
cestou, ktorá sken obíde.

Vzory (12): Anthropic key, OpenAI key, AWS key, GitHub token/PAT, Slack token,
PEM private key, JWT, connection string s heslom, URL s basic-auth,
`bearer <…>`, priradenie typu `password/heslo/secret/token/api_key = …`,
a Hades doplnok „dlhý hex ≥ 40 znakov" (SHA / API kľúč).

Dve vlastnosti, na ktorých stojí celá dôvera k tomuto mechanizmu:

1. **Scanner vracia len NÁZVY vzorov, nikdy matched hodnotu.** Nájdené
   tajomstvo sa nevypíše do odpovede, do logu, ani do výnimky. Inak by
   detektor tajomstiev bol sám únikom tajomstiev.
2. **Guard je na serveri, nie v promptoch.** MCP instrukcia „Never store
   passwords…" je len zdvorilosť voči modelu; `McpController::toolLearn()`
   a `toolDecision()` obsah reálne skenujú a pri zhode vrátia
   `isError: true` s odmietnutím. Overené testom, že skutočne odmietne.

Brain-write (`BrainWriter`) skenuje pri každom `create`/`update`/`writeDecision`.
Nález bez `force` → `SecretsDetectedException` → HTTP **422** s poľom
`patterns[]` (len názvy) a hintom na `force=true`. S `force=true` sa zapíše,
ale výsledok nesie explicitné varovanie.

Ďalšie miesta, kde sa tajomstvá nemajú kde ukázať:

- **Chat**: text výnimky sa klientovi nikdy neposiela — do odpovede ide
  generická veta, detail len do logu (`ChatController::send()`).
- **Systémový prompt chatu** má pravidlo neprezradiť heslá ani keby boli
  v sieti (druhá línia, nie primárna obrana).
- **Backup**: heslo k DB ide cez `MYSQL_PWD`, nie ako `-p` argument, aby
  nesvietilo v process liste (`routes/console.php`).
- **`.gitignore`**: `.env`, `.env.backup`, `.env.production`, `auth.json`,
  `storage/*.key`, celé `backups/*`.

---

## 5. Fail-closed a fail-safe defaulty

Tabuľka toho, čo sa stane, keď je konfigurácia prázdna alebo chybná — teda
či sa systém pri neistote zamkne alebo otvorí:

| Prepínač | Default | Pri prázdnom/OFF |
|---|---|---|
| `HADES_MCP_TOKEN` | prázdny | **401 pre všetkých** (fail-closed) |
| `HADES_API_TOKEN` | prázdny | **401 pre všetkých** (fail-closed) |
| `HADES_ALLOW_BRAIN_WRITE` | `false` | brain-write endpointy **403**, `.md` sa nemenia (fail-safe) |
| `ANTHROPIC_API_KEY` | prázdny | chat odpovie inštrukciou, nič nevolá von |
| `HADES_RECALL_FULLTEXT` | `false` | recall ide bezpečnejšou LIKE cestou |
| writable brain zdroj | žiadny | `RuntimeException`, zápis odmietnutý |

`BrainWriter` navyše kontroluje `writable` príznak konkrétneho zdroja — aj pri
zapnutom guarde sa do read-only zdroja (`skills`, `claude-memory`) nezapíše.

---

## 6. Bezpečnosť dát (nie len prístupu)

Zápis a mazanie sú v Hadesovi rovnako rizikové ako neoprávnené čítanie —
pamäť sa dá zničiť aj legitímnym volaním.

**Atomický zápis** (`BrainWriter::atomicWrite`): `<file>.tmp.<pid>` v tom istom
adresári + `rename()`. Čitateľ nikdy nevidí polovičný súbor, cross-device
rename nepadá, pri zlyhaní sa tmp uprataví a **originál zostáva nedotknutý**.

**Poradie pri presune**: cieľ zapíš a over, až potom zmaž zdroj. Nikdy naopak —
pri zlyhaní obsah zostane aspoň v jednom súbore.

**Mazanie je reverzibilné**:
- MCP `mind_delete` je **soft-delete** — uzol zmizne z recallu a grafu, hrany
  zostávajú, dá sa obnoviť.
- Brain delete zapíše `Tombstone(external_key)`, aby sync uzol znovu
  „neadoptoval" pri ďalšom prechode, a odstráni osirelé hrany.

**Zámky proti súbežnosti**: `Cache::lock('brain-sync')` serializuje UI, API aj
writer; obsadený zámok → HTTP **423** (`sync_locked`), nie tichý súbeh.
Scheduled joby majú `withoutOverlapping` a zámerne **nezdieľané** mutexy tam,
kde by spoločný zámok spôsobil preskočenie údržby.

**Záloha**: denne 03:00 `mariadb-dump`, rotácia 14 dní, fail-safe — dump ide
najprv do temp a do `backups/` sa presunie len keď nie je prázdny; zlyhanie
loguje `Log::error`.

**Retencia telemetrie** (`mind:prune-telemetry`): `sync_runs` 7 dní, čítacie
aktivácie 30 dní. Prevádzkové stopy po čítaní pamäte sa nedržia navždy.

**Mounty** (`docker-compose.yml`): Claude Code transcripty sú namountované
**read-only** (`:ro`) — Hades ich číta, nikdy nepíše. Zapisovateľný je len
`memory-rw` (export vedomia späť do Claude memory).

---

## 7. Vstupná validácia a stropy proti zneužitiu

| Miesto | Ochrana |
|---|---|
| `POST /api/chat` | `throttle:20,1` (20 req/min) — model-backed endpoint, ochrana pred útekom spendu |
| `POST /api/chat` payload | `message` max 4000 zn., `history` max 12 správ × 8000 zn., `context_node_ids` max 20 celých čísel |
| Priložený kontext v chate | tvrdý budget 6000 znakov, markdown snippet max 1500 zn. na uzol |
| MCP `mind_recall` | `limit` sa **serverovo klampuje na 1–30** bez ohľadu na to, čo klient pošle |
| MCP `mind_recall` výstup | stropy na dĺžku popisov (1200 zn. pre top 3, 300 pre ostatné) — jeden recall vracal 77 493 znakov |
| MCP `mind_learn` | povinné argumenty sa validujú, tagy sa trimujú a filtrujú |
| `/api/v1/knowledge` | `limit` 1–100, `type`/`origin`/`certainty` výhradne z whitelistu (`in:`) |
| `/api/nodes` | `type` len `memory,skill,project`; konzistencia `area_id` ↔ `department_id` |
| JSON-RPC na `/mcp` | nevalidný payload → `-32700 Parse error`, neznáma metóda → `-32601`, výnimka → `-32603` (bez stack trace) |

Chyby na `api/*` a `mcp` sa vždy renderujú ako JSON (`shouldRenderJsonWhen`),
takže sa nikam nevykreslí HTML debug stránka Laravelu.

---

## 8. Známe riziká a limity (čo NIE je vyriešené)

Poctivý zoznam. Nič z toho nie je aktuálne exploitované, ale všetko je reálne.

1. **Interné `/api/*` sú bez autentifikácie.** Ktorýkoľvek proces na stroji,
   ktorý dosiahne `127.0.0.1:8080`, môže čítať celú pamäť a zapisovať
   (`POST /api/nodes`, `DELETE /api/nodes/{id}`, `PUT /api/departments/…`).
   `/mcp` sme 12. 8. 2026 zamkli presne z tohto dôvodu — interné `/api/*`
   zostalo otvorené. Zároveň na `api` routách nie je CSRF ochrana, takže
   web stránka otvorená v prehliadači vie na tieto endpointy poslať POST
   (bez čítania odpovede, ale zápis prejde).
2. **Token a bcrypt hash sú natvrdo v `docker/Caddyfile`, ktorý je v gite.**
   Config sám to priznáva („kým sa tá neprepne na env"). Kto má prístup
   k repozitáru, má prístup k verejnému MCP endpointu. Riešenie: presunúť
   do env a rotovať.
3. **Token v query stringu sa loguje.** `?token=` skončí v ngrok dashboarde,
   v access logoch a v histórii URL. Je to nutná cena za **vzdialené** connectory
   appky Claude, takže ten token treba považovať za „polo-verejný". Klienti na
   tom istom stroji túto cestu už nepotrebujú — `bin/hades-mcp-stdio.mjs` posiela
   token v hlavičke (§3.1).
4. **Jediný statický token na okruh, bez expirácie, rotácie a auditu.**
   Neexistuje zoznam, kto kedy čo cez MCP zapísal.
5. **DB credentials sú triviálne** (`hades`/`hades`, root `hades_root`)
   a v `docker-compose.yml`. Chráni ich len binding na `127.0.0.1:3307`.
6. **`APP_DEBUG=true`, `LOG_LEVEL=debug`, `APP_ENV=local`.** Pre HTML routy
   (`/`) to znamená plné debug stránky pri chybe. Verejne to je za basic-auth,
   ale je to zbytočná plocha.
7. **Debug snapshot route** (`POST /debug/snapshot`) zapisuje base64 obrázok do
   `storage/app/` s vypnutým CSRF. Je zamknutá na `local` env a názov súboru
   je sanitizovaný na `[a-z0-9_-]`, takže path traversal nehrozí — ale je to
   nechránený zápis na disk.
8. **Detekcia tajomstiev je heuristika.** 12 vzorov pokrýva bežné formáty
   kľúčov; heslo typu `Mojemeno1985` neodhalí. Blacklist je poistka, nie
   garancia — pravidlo „tajomstvá do Hadesa nepatria" musí primárne držať
   volajúci.
9. **Rate limit má len `/api/chat`.** Recall, graf ani zápisy throttle nemajú
   (lokálny model, ale platí to aj pre verejnú cestu za basic-auth).
10. **Chat posiela obsah pamäte do Anthropic API.** Je to zámer a účel, ale
    treba to vedieť: recallnuté uzly + pripnutý kontext odchádzajú von.

---

## 9. Testové pokrytie bezpečnostných mechanizmov

| Test | Čo overuje |
|---|---|
| `tests/Feature/AuthenticateMcpTest.php` | odmietnutie bez tokenu / so zlým tokenom (Bearer aj query), akceptáciu správneho, case-insensitive `bearer`, **fail-closed** pri nenakonfigurovanom tokene, pokrytie `GET`/`DELETE` |
| `tests/Unit/SecretScannerTest.php` | jednotlivé vzory a to, že sa nevracia hodnota |
| `tests/Feature/McpToolsTest.php` | odmietnutie `mind_learn` s obsahom podobným tajomstvu, klamp recall limitu |
| `tests/Feature/ApiV1Test.php` | Bearer guard na `v1`, health bez tokenu |
| `tests/Feature/BrainWriterTest.php` | atomický zápis, poradie pri move, guard OFF → 403, secrets → 422, tombstone pri delete |
| `tests/Feature/PruneTelemetryTest.php` | retenčné okná telemetrie |
| `tests/Feature/ReviewFlowTest.php`, `NodeCurationTest.php` | zápisové cesty pri guard ON/OFF |

---

## 10. Checklist pri zmene čohokoľvek z tohto

- Nový endpoint pod `/api/v1/*` → patrí do `auth.token` grupy (nie mimo nej).
- Nový MCP nástroj, ktorý zapisuje text → pretlač obsah cez `SecretScanner`.
- Nová zápisová cesta do `.md` → **len** cez `BrainWriter` (atomicita + sken
  + guard na jednom mieste).
- Nový destruktívny nástroj → soft-delete alebo tombstone, nikdy tvrdé
  `DELETE` bez možnosti obnovy.
- Zmena tokenu → `.env` **aj** `docker/Caddyfile` + `docker compose restart caddy`.
- Zmena v auth/uploadoch/exponovaných endpointoch → povinná security prehliadka
  (appka je verejne tunelovaná).
- Nikdy nevypisuj hodnoty kľúčov do chatu, logov, commitov ani do Hadesa.
