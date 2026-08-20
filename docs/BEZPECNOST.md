# Bezpečnosť Hadesa

Ako je Hades (AI-mind) chránený, čím konkrétne, a čo chránené **nie je**. Stav
k 20. 8. 2026 (auth okruhy do 13. 8. 2026, konzola vedomia a klietka shellu
19. 8. 2026).

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
| Iný proces si otvorí interné `/api/*` alebo dashboard | čítanie celej pamäte a zápis (`POST /api/nodes`, `DELETE …`) bez autorizácie | session guard na UI okruhu (§3.3) |
| Cudzia stránka otvorená v prehliadači pošle zápis na `localhost:8080` | uzly a rozhodnutia vytvorené naslepo (odpoveď útočník neprečíta, zápis prejde) | CSRF + `SameSite` cookie na UI okruhu (§3.3) |
| Request z tunela siahne na programový okruh konzoly | spustenie príkazu a zápis do súborov projektu **bez CSRF** (Caddy token do requestu vkladá sám) | loopback-only + odmietnutie `X-Forwarded-*` (§3.5) |
| Model si v konzole vypýta shell na niečo, čo nemal | prečítanie `.env`, zmazanie súborov, čítanie histórie repa | klietka `CommandCage` — gramatika + `deny` + biely zoznam (§7.1) |
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

## 3. Autentifikácia — päť nezávislých okruhov

### 3.1 `/mcp` — token guard (`AuthenticateMcp`)

Zaregistrovaný priamo v `bootstrap/app.php` na všetky metódy (`GET`, `POST`,
`DELETE`), takže sa nedá obísť inou HTTP metódou.

- Prijíma `Authorization: Bearer <token>` **aj** `?token=<token>`.
  Query varianta nie je pohodlie, ale nutnosť: connectory appky Claude
  (mobil/desktop/web) nevedia poslať vlastnú hlavičku, len URL.
- Porovnanie cez `hash_equals()` → timing-safe, nedá sa uhádnuť po znakoch.
- **Fail-closed**: keď je `hades.mcp_token` prázdny, neprejde nikto (401).
  Nekonfigurovaný server je zamknutý server, nie otvorený.
- **Jeden zdroj tokenu**: `HADES_MCP_TOKEN` v `.env` čítajú obaja — Laravel
  cez `config/hades.php`, aj Caddy cez `{$HADES_MCP_TOKEN}` v query matcheri
  na porte 8095 (§8.2). Nedá sa teda stať, že tunel prepustí token, ktorý
  appka už neuznáva, alebo naopak. Rotácia = zmeniť jedno miesto a spustiť
  `docker compose up -d caddy`.

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

### 3.3 UI okruh — dashboard `/` a interné `/api/*` (`AuthenticateUi`)

Od 13. 8. 2026. Dovtedy tu ochrana nebola žiadna: SPA nedrží token (§4.3
kontraktu) a interné `/api/*` sa spoliehali výhradne na sieťovú hranicu, čiže
ktorýkoľvek lokálny proces vedel čítať celú pamäť aj zapisovať do nej. Bola to tá
istá diera, akú `/mcp` dostal zaplátanú 12. 8. 2026.

**Prečo session a nie token vložený do blade view.** Lokálny proces si spraví
`GET /` a token si z HTML vyparsuje — per-page token teda nechráni pred hlavnou
hrozbou. Rovnako kontrola `Origin`/`Referer`: hlavičku si klient, ktorý nie je
prehliadač, nastaví sám (zatvorila by CSRF, nie lokálne procesy). Ochrana musí
zamknúť **aj samotný dashboard**, a to znamená tajomstvo, ktoré drží prehliadač
(cookie), nie stránka. Preto je `/` pod guardom spolu s API — bez toho by celá
konštrukcia bola len na okrasu.

- **Token**: `HADES_UI_TOKEN`, zámerne **iný** ako `HADES_API_TOKEN` aj
  `HADES_MCP_TOKEN` — únik jedného okruhu nesmie otvoriť ďalší.
- **Dve cesty dovnútra**: `?token=` (jednorazové odomknutie v prehliadači; guard
  hneď presmeruje na URL bez tokenu, aby nezostal v histórii) a hlavička
  `X-Hades-Ui-Token`, ktorú na verejnej ceste vkladá Caddy (§3.4).
- **V session je `sha256` odtlačok tokenu**, nie token. Rotácia `HADES_UI_TOKEN`
  tým zneplatní všetky odomknuté session — nie je potrebné nič mazať.
- `hash_equals()` na oboch porovnaniach, **fail-closed**: prázdny `hades.ui_token`
  = 401 pre všetkých vrátane dashboardu.
- **CSRF**: interné `/api/*` majú `ValidateCsrfToken`, token nesie
  `<meta name="csrf-token">` a `public/js/mind.js` ho obalením `fetch` pripája do
  každého non-GET volania. Cudzia stránka teda zápis neprepasuje ani keby cookie
  nejako získala. Druhá vrstva je `SESSION_SAME_SITE=lax` (cross-site POST cookie
  nedostane); `strict` zámerne nie, aby kliknutie na tunelový odkaz zvonku
  neznamenalo zamknuté okno.
- **Poradie middleware je zámerné** (vypísané ručne v `routes/api.php`, nie group
  `web`): cookies → session → guard → CSRF, a `AuthenticateUi` je navyše cez
  `prependToPriorityList` posunutý **pred** `SubstituteBindings`. Inak by
  neexistujúce id vrátilo `404` skôr, než guard povie `401`, a nezamknutý klient
  by tým zistil, ktoré uzly v pamäti existujú.
- **Dôsledok pre klientov**: interné `/api/*` je odteraz cesta pre prehliadač
  (session + CSRF). Skripty a integrácie patria na `/api/v1/*` s Bearer tokenom —
  ten CSRF nemá a mať nemusí, lebo cookie nepoužíva.

### 3.4 Basic-auth na Caddy

Heslo je uložené ako **bcrypt hash** (cost 12), nie plaintext. Platí pre
dashboard, chat, interné `/api/*` aj WebSocket cestu `/app/*`. Lokálny prístup
na 8080 basic-auth neobchádza — on ním nikdy neprechádza.

Na tejto ceste Caddy zároveň **vkladá hlavičku `X-Hades-Ui-Token`** do každého
requestu na appku, takže verejný dashboard netreba odomykať druhýkrát: gate je
basic-auth. Použité je `header_up` (nastaví, nie pridá), takže vlastnú hlavičku od
klienta zároveň prepíše — token sa cez tunel nedá podstrčiť ani vyčítať.

### 3.5 `auth.console` — programový okruh (`AuthenticateConsoleToken`)

Od 19. 8. 2026. Konzolu vedomia (`/console`) neovláda len prehliadač: terminálový
klient (`bin/hades/`), desktopové okno (`desktop/`), skripty, scheduler a iná AI
cez `/mcp` sú tiež klienti. Ani jeden z nich nemá cookie jar ani CSRF token
z blade view, takže cez UI okruh (§3.3) neprejde — a odstrániť CSRF z
`/api/console/*` by tú ochranu zrušilo aj prehliadaču. Preto vlastný okruh, alias
`auth.console`.

- **Token**: tá istá hlavička `X-Hades-Ui-Token` a ten istý `HADES_UI_TOKEN` ako
  UI okruh — jedno tajomstvo, dva vstupy. `hash_equals()`, **fail-closed**:
  prázdny `hades.ui_token` = 401 pre všetkých.
- **Bez session a bez CSRF**, a je to bezpečné práve preto, že tajomstvo drží
  klient v hlavičke, nie cookie: cross-site niet čo zneužiť a vlastnú hlavičku si
  cudzia stránka cross-origin poslať nevie (vyžiada si preflight).
- **Loopback-only — a to je podstata okruhu, nie jeho detail.** Caddy na verejnej
  ceste (§3.4) vkladá hlavičku s UI tokenom do **každého** requestu na appku.
  Keby tento guard veril iba tokenu, ngrok tunel by bol plne autentizovaný vstup
  **bez CSRF** k toolom, ktoré zapisujú do pamäte, do súborov a **spúšťajú
  príkazy**. Basic-auth pred tým je jedno heslo, nie druhá vrstva.

Preto sú v guarde **dve** kontroly prenosu, nie jedna:

1. Request nesmie niesť `X-Forwarded-For` ani `X-Forwarded-Host`. Tie pridáva
   reverzná proxy, takže ich prítomnosť znamená „prešlo to cez tunel" aj vtedy,
   keď `ip()` vidí loopback — Caddy beží na tom istom stroji, takže sám o sebe
   loopback **je**. Kontrola ide **pred** overením tokenu a vracia `403`: request
   z tunela nemá dostať odpoveď, z ktorej sa dá čítať, či token trafil.
2. `request->ip()` musí byť loopback **alebo adresa default gateway** kontejnera.
   Appka beží v Dockeri a request z hosta dorazí SNAT-nutý z brány mostu
   (zmerané 19. 8. 2026: `172.19.0.1`), takže kontrola len na `127.0.0.1` by
   terminálovému aj desktopovému klientovi vracala 403 a okruh by bol z hosta
   nepoužiteľný — pritom práve na hoste beží. Povolená je **výhradne brána**, nie
   celá podsieť mostu: na zdieľanom moste tohto stroja žijú desiatky cudzích
   kontejnerov a podsieť by dala dosah každému z nich. Zoznam sa dá zúžiť alebo
   prepísať cez `hades.console.allow_from`.

Keby ostala len prvá kontrola, stačí Caddy pred appkou a diera je otvorená; keby
len druhá, stačí proxy, ktorá `X-Forwarded-*` nepridáva. Zostávajúce známe
riziko: kontejner na tom istom moste vie zdrojovú adresu podvrhnúť (bridge zdroj
nefiltruje) — bez tokenu mu to nedá nič, a s tokenom už má aj UI okruh.

**Tri cesty do konzoly, a ten rozdiel je zámer:**

| Cesta | Kto | Ochrana | Tooly |
|---|---|---|---|
| `/api/console/*` | prehliadač | `auth.ui` + session + CSRF (§3.3) | plný register |
| `/api/console/cli/*` | terminál, desktopové okno | `auth.console`, **loopback-only**, bez session a CSRF | plný register |
| `/api/console/headless` | skript, MCP, plánovaný beh | `auth.console` | čítacie + **zápisy len ako návrh** |
| `/api/console/cli/pending` | terminál (rozhodnutie človeka) | `auth.console`, loopback-only | vykoná odložený zápis |

Pri `cli/*` človek pri termináli **je**, takže rámec `permission` má komu prísť a
klient ho obslúži rovnako ako webová konzola — preto plný register. Headless ho
nemá, a preto tam zápisový tool **nikdy nevykoná zápis**: zápisový tool ťah
**zaparkuje** a čaká na rozhodnutie človeka (§8.11), takže v skriptovanom behu by
vlákno zostalo trvalo zablokované. Nie je to opatrnosť, je to jediné, čo v takom
behu môže dobehnúť.

Ako to teda dopadne (kód `app/Services/Console/HeadlessRunner.php`, metóda `tools()`):

- čítací tool a tool označený `SafeUnattended` (`write_report`, zapisuje výhradne do
  `storage/app/reports`) sa **vykonajú** — bez druhého by nočný rozvrh nemal ako
  vyrobiť svoj jediný zmysluplný výstup;
- ostatné zápisové tooly sa **obalia do návrhu** (`WriteProposals::proposalTool()`).
  Obal má `isWrite() === false`, takže ťah nezaparkuje, a jeho `execute()` namiesto
  zápisu založí riadok v `console_write_proposals` s náhľadom. Zápis sa vykoná **až**
  pri `hades pending approve <id>` — teda rukou človeka, v tom istom loopback okruhu.

Obal do `ToolRegistry::TOOLS` **nepatrí** a nesmie sa tam dostať: v prehliadačovom
okruhu by tichom vypnul potvrdzovanie zápisov, pretože sa netvári ako zápis. Preto sa
skladá na jedno použitie v `HeadlessRunner`, nie v registri.

`ConsoleGuardTest` neprechádza vymenované routy, ale **celý router**: routa
konzoly, ktorá nie je ani v jednom z týchto okruhov, zhodí test — vrátane
programovej routy, ktorá by si omylom niesla session.

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
| `HADES_MCP_TOKEN` | prázdny | **401 pre všetkých** (fail-closed) + `caddy` sa nespustí (`:?` guard v compose) |
| `CADDY_BASIC_AUTH_HASH` | prázdny | `caddy` sa nespustí (`:?` guard); prázdny hash by aj tak zhodil parsovanie Caddyfile — tunel sa neotvorí bez hesla |
| `HADES_API_TOKEN` | prázdny | **401 pre všetkých** (fail-closed) |
| `HADES_UI_TOKEN` | prázdny | **401 pre všetkých vrátane dashboardu** (fail-closed) + `caddy` sa nespustí (`:?` guard) |
| `HADES_ALLOW_BRAIN_WRITE` | `false` | brain-write endpointy **403**, `.md` sa nemenia (fail-safe) |
| `HADES_CONSOLE_BASH` | `true` | pri `false` tool `bash` nespustí nič a povie to modelu vetou, nie chybou (§7.1) |
| `hades.console.bash.allow` | zoznam v configu | prázdny zoznam = **žiadny príkaz neprejde** (biely zoznam, nie čierny) |
| neznámy tool konzoly | — | považuje sa za **zápisový** → ťah sa zaparkuje a čaká na človeka (fail-closed) |
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

### 7.1 Klietka shellu — `CommandCage`

Od 19. 8. 2026 má konzola tool `bash`, teda **najsilnejší vstup v celej appke**
(§8.11). Dovtedy shell zámerne neexistoval, ale konzola potom nevedela spustiť ani
testy: model písal kód naslepo a „hotovo" znamenalo „prečítal som si to". Klietka
je `app/Services/Console/CommandCage.php`, zoznamy sú v `config/hades.php` →
`hades.console.bash`.

Vrstvy sa vyhodnocujú **v tomto poradí a to poradie je súčasť obrany**:

1. **Gramatika — a je v KÓDE, nie v configu.** Jeden riadok, jeden príkaz.
   Odmietnuté sekvencie: `&&`, `||`, `>>`, `>`, `<`, `;`, `&`, `` ` ``, `$(`,
   `${`, `$'`. Reťazenie, presmerovanie a substitúcia nie sú „zoznam príkazov",
   ale spôsob, ako biely zoznam obísť: `ls; rm -rf x` je proti zoznamu „ls plus
   čokoľvek" a prešlo by prvou polovicou. `$'` je tam preto, že ANSI-C quoting vie
   zapísať znak číslom (`$'\x2eenv'` je `.env`) a žiadny vzor na `.env` by ho
   nevidel. Keby gramatika žila v configu, dala by sa vypnúť premennou prostredia.
   Zvlášť sa odmieta **nezavretá úvodzovka** (shell by čakal na jej dokončenie
   a príkaz by visel do timeoutu) a príkaz dlhší než **2000 znakov** — nie kvôli
   dĺžke, ale aby človek v potvrdzovacom dialógu nemusel klikať naslepo nad vetou,
   do ktorej model vysypal celý súbor.
2. **`deny` nad CELÝM príkazom — a aj nad jeho odúvodzovkovanou podobou.** Toto je
   jediné pravidlo, ktoré sa nedá prehlasovať ničím, ani „povoliť vždy". Zakázané
   sú: destruktívne a systémové príkazy (`rm`, `mv`, `cp`, `chmod`, `chown`, `ln`,
   `dd`, `mkfs`, `kill`/`pkill`, `shutdown`, `reboot`, `sudo`/`su`, `docker`,
   `wsl`, `systemctl`/`service`, `apt`, `yum`, `pip`), shelly a všetko, čo spustí
   cudzí príkaz za ne (`sh`, `bash`, `zsh`, `env`, `xargs`, `eval`, `exec`,
   `nohup`, `at`, `cron`/`crontab`), `find … -exec/-delete/-ok`, zápisové git
   operácie (`push`, `reset`, `checkout`, `clean`, `rebase`, `stash`, `commit`,
   `merge`, `worktree`, …), destruktívny artisan (`tinker`, `db:wipe`,
   `migrate:fresh|reset|rollback`, `queue:flush`), `drop`/`truncate`,
   `npm publish|login|token|config set`, `composer global|config`, `npx`, čítanie
   obsahu z **histórie repa** (`git show`, `cat-file`, `rev-list`, `archive`,
   `bundle`, a `git … -p/--patch/-U`) a **`.env` kdekoľvek v príkaze**
   (case-insensitive).
3. **Biely zoznam nad KAŽDÝM segmentom rúry zvlášť.** Rúra (`|`) je jediná
   povolená spojka, takže `a | b` musí prejsť ako `a` aj ako `b`; `|` vnútri
   úvodzoviek sa nedelí (`rg -e "foo|bar" app` je jeden segment). Vzory sú
   ukotvené regexy nad celým segmentom. Povolené je: `php artisan test`,
   `migrate`/`migrate:status --pretend`, `route:list`/`about`/`env`,
   `php artisan mind:*`, `php vendor/bin/phpunit|pint`, `composer show`/`audit`/
   `dump-autoload`, `npm audit|ls|run <skript>`, git **bez** histórie súborov
   (`status`, `branch`, `remote`, `shortlog`, `blame`, `diff` bez revízií, `log`
   bez `-p`), `ls`/`cat`/`head`/`tail`/`wc`/`file`/`stat`/`uniq`/`cut`/`tr`,
   `rg`/`grep`, `curl -s` **výhradne na localhost:8080|8092** a `--version`.

**Prečo biely zoznam a nie čierny**: čierny sa obíde čímkoľvek, na čo autor
nepomyslel (`env`, `xargs`, `sh -c`, `find -exec`). Biely zlyhá opačným smerom —
odmietne užitočný príkaz, čo je otrava, nie diera.

**Čo je vedome von, a prečo** (každý bod je nález sondy z 19. 8. 2026, nie dojem):

- **`sed`** — `sed -n '1w /tmp/x'` **zapíše** súbor. Čítanie riadkov pokrýva
  `head`/`tail`/`cut` a tool `read_file`, takže `sed` sem okrem zápisu nič
  nepridáva; zápis má ísť cez `edit_file` a jeho diff.
- **`sort`** — `sort -o <súbor>` zapisuje, tá istá trieda ako `sed -n '1w …'`.
  Usporiadanie výstupu konzola nepotrebuje.
- **História git** — `git log -p` aj `git show <ref>:<cesta>` vypíšu obsah
  z minulosti, a v tej histórii podľa §8.2 žije natvrdo zapísaný bcrypt hash
  basic-auth hesla a starý MCP token. Súborové tooly do histórie nevidia, takže je
  to plocha, ktorú by pridal výlučne shell.
- **Inštalácie balíkov** — `npm install <čokoľvek>` stiahne balík z registry a jeho
  `postinstall` je spustenie cudzieho kódu v kontejneri appky; `npm ci` aj
  `composer install` spúšťajú lifecycle skripty rovnako, len z lockfile.
  Nastavenie prostredia patrí človeku.
- **`curl` na ľubovoľný port** — `curl http://127.0.0.1:6379/` je Redis appky.
  Port je preto zoznam, nie `\d+`, a za URL nesmie nasledovať nič (teda ani `-o`,
  ktorým curl zapisuje súbory).

Beh samotný: `Process::fromShellCommandline` v `hades.console.files_root`, timeout
**120 s** (celý balík testov beží ~82 s, takže kratší strop by zabil práve ten
príkaz, pre ktorý tool existuje), výstup zrezaný na **30 000 znakov** a stdout so
stderr v **jednom** prúde v poradí, v akom pritiekli. Shell sa smie použiť práve
preto, že gramatika je overená vopred — jediné, čo mu ostáva, je spojiť rúru.
Celý tool sa dá vypnúť `HADES_CONSOLE_BASH=false`.

---

## 8. Známe riziká a limity (čo NIE je vyriešené)

Poctivý zoznam. Nič z toho nie je aktuálne exploitované, ale všetko je reálne.

1. **~~Interné `/api/*` sú bez autentifikácie~~ — vyriešené 13. 8. 2026
   (`AuthenticateUi`, §3.3).** Dashboard aj interné `/api/*` sú za session
   guardom s `HADES_UI_TOKEN` a zápisy majú CSRF. Lokálny proces bez tokenu
   dostane `401` na čítaní aj zápise, cudzia stránka v prehliadači `419`.

   Čo tým *nie je* vyriešené:
   - **Token sa raz objaví v URL** (`/?token=…`), takže skončí v histórii
     prehliadača a v access logoch — rovnaká cena ako pri `?token=` na `/mcp`
     (§8.3). Guard ho z URL hneď odstrihne presmerovaním, ale zápis v histórii
     tým nezmizne. Alternatíva bez tejto ceny je hlavička, tú však prehliadač
     pri ručnom otvorení URL poslať nevie.
   - **Odomknutie je dlhé** (`SESSION_LIFETIME=43200`, teda 30 dní). Kompromis:
     pôvodných 120 minút by znamenalo zamknutý dashboard po dvoch hodinách
     nečinnosti. Odomknutá session = plný prístup k pamäti pre toho, kto sedí
     za prehliadačom, a rotácia tokenu je jediný spôsob, ako ju zneplatniť.
   - **Kto vie čítať `.env`, prejde** — to je ale explicitne mimo modelu hrozby
     (§1) a platí rovnako pre všetkých päť okruhov.
   - Guard nechráni `POST /debug/snapshot` (bod 7 nižšie) ani Reverb na 8081.
2. **~~Token a bcrypt hash sú natvrdo v `docker/Caddyfile`~~ — vyriešené
   13. 8. 2026, ale staré hodnoty zostávajú v histórii.**
   Caddyfile už berie oboje z `.env` cez `environment:` v `docker-compose.yml`
   (`{$HADES_MCP_TOKEN}`, `{$CADDY_BASIC_AUTH_HASH}`), takže MCP token má
   **jeden zdroj** pre Caddy aj Laravel (`config/hades.php`) a nemôžu sa
   rozísť. `:?` guard v compose znamená, že bez hodnôt stack vôbec nenabehne.

   Čo tým *nie je* vyriešené: token aj hash žijú v commitoch (hash v `83afa6c`
   na tejto vetve, token v `5eadb46`/`3246bc4` na `origin/feat/cloudflare-tunnel`,
   teda aj na remote). Prepnutie na env zabráni ďalšiemu leaku, históriu
   neprepíše — **obe tajomstvá treba považovať za kompromitované a rotovať.**
   Rotácia je jediná vec, ktorá ich zneplatní; `git filter-repo` na už
   pushnutých vetvách je viac škody ako úžitku.

   Pasca pri úprave: `$` v bcrypt hashi. Compose interpoluje hodnoty z `.env`
   **aj z `env_file`**, takže surové `$2y$12$e4ZV…` sa rozpadne na neexistujúce
   premenné a Caddy dostane zrezané `$2y$12` — potom *každé* heslo vráti 401
   a vyzerá to ako zle zadané heslo, nie ako rozbitá konfigurácia. Hodnota
   preto musí byť v `.env` v **jednoduchých úvodzovkách**
   (`CADDY_BASIC_AUTH_HASH='$2y$12$…'`); tie prežijú compose aj phpdotenv,
   a na rozdiel od zdvojovania `$$` fungujú pre oba čitatelia rovnako.
   V Caddyfile je zámerne `{$VAR}` (textová substitúcia pri načítaní), nie
   `{env.VAR}` — runtime placeholder sa v hashi `basic_auth` nevyhodnotí.
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
9. **Rate limit má len `/api/chat` a spúšťacie routy konzoly** (`/api/console/run`,
   `/api/console/cli/run`, `/api/console/headless` — všetky `throttle:20,1`).
   Recall, graf ani
   zápisy throttle nemajú (lokálny model, ale platí to aj pre verejnú cestu za
   basic-auth).
10. **Chat a konzola posielajú obsah pamäte modelu.** Pri `provider=anthropic`
    odchádzajú recallnuté uzly a pripnutý kontext do Anthropic API. Pri
    `provider=ollama` (default konzoly) neodchádza nič — model beží v kontejneri
    na tom istom stroji. Rozdiel je vidno v UI (prepínač modelu) a je to jediná
    vec, ktorá určuje, či pamäť opustí počítač.
11. **Konzola vedomia (`/console`) je najsilnejší vstup do appky.** Jej tooly
    vedia pamäť čítať aj prepisovať a siahajú na súbory v `hades.console.files_root`.
    Čo ju drží:
    - Prehliadačový okruh `/console` + `/api/console/*` je za `AuthenticateUi`
      + CSRF (§3.3), programový za `auth.console` (§3.5) — a `ConsoleGuardTest`
      to overuje **na celom prefixe**, nie na vymenovaných routách: endpoint
      konzoly, ktorý nie je ani v jednom okruhu, zhodí test.
    - **~~Bash/shell tool zámerne neexistuje~~ — od 19. 8. 2026 existuje**
      a je v klietke (§7.1). Pôvodná voľba padla na tom, že konzola bez shellu
      nevedela spustiť ani testy. Riziko sa tým neodstránilo, len obmedzilo:
      gramatika + `deny` + biely zoznam, a `bash` je v registri **posledný**
      (slabý model siaha po tom, čo je vyššie).
    - Zápisové tooly (`mind_learn`, `mind_rename`, `mind_delete`, `edit_file`,
      `write_file`, `bash`) sa **nevykonajú bez rozhodnutia človeka** — beh je
      dvojfázový a tool call čaká v stave `pending` s náhľadom zmeny.
      `auto_accept` je per-vlákno a default vypnutý; pri toole, ktorý je na plošné
      povolenie priširoký (shell), sa „povoliť vždy" **zúži na vzor príkazu**
      (bod 13 nižšie).
    - Cesta mimo `files_root` je **odmietnutá, nie sanitizovaná** — sanitizácia
      by ticho zapísala niekam inam.
    - `write_report` píše HTML, ktoré napísal **model**, a stránka žije v tom
      istom origine ako session, takže obrana je dvojitá: sanitizácia pri zápise
      (DOMDocument, nie regex — `Str::markdown()` blokový `<script>` zaescapuje,
      ale `<div onclick>` prepustí) a CSP bez skriptov pri servovaní.
    - Programový vstup (CLI, skript, MCP, scheduler) nejde cez UI okruh, ale cez
      `auth.console` (§3.5): loopback-only, bez session a CSRF, a headless má
      register **len na čítanie**.

    Čo tým *nie je* vyriešené: kto má odomknutú session, má cez konzolu zápis do
    súborov projektu a spustenie povoleného príkazu. To je zámer (je to nástroj
    vlastníka), ale je to väčšia plocha než mal dashboard — odomknutá session na
    30 dní (bod 1) teraz váži viac.
12. **~~Úvodzovkový obchvat `deny` zoznamu~~ — našlo sa a opravilo sa
    19. 8. 2026.** `cat ".env"` **prešlo**: deny vzor chcel `.env` na hranici
    (začiatok / medzera / lomka) a úvodzovka ňou nie je — shell ju pri behu strhne
    a prečíta reálny súbor. Overené spustením: príkaz vrátil 2237 B vrátane
    `APP_KEY`, `DB_PASSWORD` a všetkých tokenov, teda naraz rozbil **všetky štyri
    autentifikačné okruhy**. Oprava je `dequote()` v `CommandCage` — `deny` sa
    odteraz testuje nad celým príkazom **aj nad jeho odúvodzovkovanou podobou** —
    a vzor na `.env` je zámerne široký, nie ukotvený na hranicu slova. Falošné
    pozitíva tým vzniknúť môžu (`rg "rm -rf" docs`) a je to správny smer zlyhania.
13. **~~Plošné `auto_accept` zakrylo úzke povolenie~~ — našlo sa a opravilo sa
    19. 8. 2026.** „Povoliť vždy" na `mind_learn` zapínalo `auto_accept` na celé
    vlákno, takže od tej chvíle by **každý** príkaz shellu bežal bez potvrdenia;
    dosiahnuteľné bolo aj programovo cez `PATCH` na vlákno. Oprava: tool, ktorý je
    na plošné povolenie priširoký, implementuje `NarrowsAllowance` a povolenie sa
    uloží do `console_threads.allowances` **len na jeho kľúč** — pri shelli je
    kľúčom vzor príkazu (`php artisan test`, nie `php artisan` a nie celé vlákno).
    Čo v `deny` (§7.1) sa nedá povoliť ani takto.

---

## 9. Testové pokrytie bezpečnostných mechanizmov

| Test | Čo overuje |
|---|---|
| `tests/Feature/AuthenticateMcpTest.php` | odmietnutie bez tokenu / so zlým tokenom (Bearer aj query), akceptáciu správneho, case-insensitive `bearer`, **fail-closed** pri nenakonfigurovanom tokene, pokrytie `GET`/`DELETE` |
| `tests/Feature/AuthenticateUiTest.php` | UI okruh: odmietnutie čítania aj zápisu bez odomknutia, zamknutý dashboard, zlý token, odomknutie hlavičkou (Caddy) aj `?token=` s odstrihnutím z URL, **fail-closed**, rotácia tokenu ruší staré session, CSRF na zápisoch (419) a 401 **pred** CSRF aj pred route model bindingom, oddelenie od `/api/v1` a `/mcp` |
| `tests/Feature/ConsoleProgrammaticTest.php` | programový okruh (§3.5): odmietnutie bez tokenu a so zlým tokenom, **odmietnutie requestu s `X-Forwarded-*` aj so správnym tokenom**, odmietnutie z neloopback adresy, **fail-closed** pri prázdnom UI tokene, a že headless register neponúkne ani jeden tool, ktorý by ťah zaparkoval |
| `tests/Feature/ConsoleGuardTest.php` | prechádza **celý router**: každá routa konzoly musí byť v jednom z okruhov (§3.5), programová nesmie niesť session |
| `tests/Feature/ConsoleBashToolTest.php` | klietka shellu (§7.1): reťazenie, presmerovanie a substitúcia, `find -exec` pred deny zoznamom, **`.env` cez úvodzovky aj cez ANSI-C quoting**, `git` nesmie vypísať históriu súborov, `sed` mimo zoznamu, rúra po segmentoch, nezavretá úvodzovka, timeout a strop výstupu |
| `tests/Feature/ConsoleAllowanceTest.php` | „povoliť vždy" pri shelli sa zúži na vzor príkazu, nezapne `auto_accept`, neotvorí ostatné zápisové tooly a plošné `auto_accept` nekryje zúžený tool (§8.13) |
| `tests/Unit/SecretScannerTest.php` | jednotlivé vzory a to, že sa nevracia hodnota |
| `tests/Feature/McpToolsTest.php` | odmietnutie `mind_learn` s obsahom podobným tajomstvu, klamp recall limitu |
| `tests/Feature/ApiV1Test.php` | Bearer guard na `v1`, health bez tokenu |
| `tests/Feature/BrainWriterTest.php` | atomický zápis, poradie pri move, guard OFF → 403, secrets → 422, tombstone pri delete |
| `tests/Feature/PruneTelemetryTest.php` | retenčné okná telemetrie |
| `tests/Feature/ReviewFlowTest.php`, `NodeCurationTest.php` | zápisové cesty pri guard ON/OFF |

---

## 10. Checklist pri zmene čohokoľvek z tohto

- Nový endpoint pod `/api/v1/*` → patrí do `auth.token` grupy (nie mimo nej).
- Nový interný endpoint pre SPA → **do `auth.ui` grupy** v `routes/api.php`
  (nie pod ňu ani vedľa nej), a zápis musí ísť cez `fetch` z `mind.js`, aby
  dostal CSRF token. Programatický klient patrí na `/api/v1/*`, nie sem.
- Nová HTML route mimo `/` → tiež `->middleware('auth.ui')`, inak z nej cudzí
  proces vyčíta CSRF token aj obsah pamäte.
- Nový endpoint konzoly → **do jedného z okruhov** (§3.5): pre prehliadač
  `auth.ui` + CSRF, pre CLI a desktop `auth.console` (loopback-only, bez session).
  Programová routa nesmie niesť session — `ConsoleGuardTest` prechádza celý router
  a routu mimo okruhov zhodí.
- Nový endpoint pre skript, MCP alebo scheduler → **len čítacie tooly**. Zápisový
  tool tam ťah zaparkuje a nikto ho nepotvrdí, takže vlákno zostane zablokované;
  tool, ktorý zapisuje výhradne do svojho vlastného miesta, dostane `SafeUnattended`.
- Zmena v klietke shellu (`hades.console.bash` v `config/hades.php`, §7.1) →
  najprv si polož otázku, či ten príkaz vie **zapísať súbor** (`sed -n '1w …'`,
  `sort -o`, `curl -o`), či vie **spustiť iný príkaz** (`env`, `xargs`, `sh -c`,
  `find -exec`) a či vie čítať **históriu repa** (v nej žijú kompromitované
  tajomstvá, §8.2). Vzory v `allow` musia byť ukotvené (`^…$`) — platia nad
  jedným segmentom rúry. Gramatiku nepresúvaj do configu: dala by sa vypnúť
  premennou prostredia. Každá zmena patrí do `ConsoleBashToolTest`.
- Nový tool, ktorý je na plošné „povoliť vždy" priširoký → `NarrowsAllowance`,
  nie `auto_accept` (§8.13). A skontroluj, či sa `deny` testuje aj nad podobou bez
  úvodzoviek (§8.12) — hranica slova ňou nie je.
- Nový MCP nástroj, ktorý zapisuje text → pretlač obsah cez `SecretScanner`.
- Nová zápisová cesta do `.md` → **len** cez `BrainWriter` (atomicita + sken
  + guard na jednom mieste).
- Nový destruktívny nástroj → soft-delete alebo tombstone, nikdy tvrdé
  `DELETE` bez možnosti obnovy.
- Zmena tokenu → `.env` (jediný zdroj pre Laravel aj Caddy) + `docker compose up -d caddy`.
  Pri `HADES_UI_TOKEN` to zároveň zamkne všetky odomknuté okná — odomknúť treba znova.
- Zmena v auth/uploadoch/exponovaných endpointoch → povinná security prehliadka
  (appka je verejne tunelovaná).
- Nikdy nevypisuj hodnoty kľúčov do chatu, logov, commitov ani do Hadesa.
