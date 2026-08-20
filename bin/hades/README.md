# `hades` — konzola vedomia v termináli

Terminálový klient konzoly Hadesa. **Bez npm závislostí a bez `package.json`** —
čisté Node ESM (`node:http` cez globálny `fetch`, `node:readline`, `node:fs`),
takže funguje hneď po `git clone` aj na stroji, kde nikto nespustil `npm install`.

Klient nezdvojuje logiku konzoly: hovorí s tým istým `/api/console/*` ako web,
takže vlákno rozpísané v prehliadači sa dá dokončiť v termináli a naopak.

Vyžaduje **Node 22+** (testované na v24.18) a terminál v **UTF-8** — výpis
používa rámčeky a diakritiku.

## Spustenie

```bash
node bin/hades/hades.mjs                       # interaktívne, pokračuje v poslednom vlákne
node bin/hades/hades.mjs --new                 # interaktívne, nové vlákno
node bin/hades/hades.mjs run "koľko je uzlov?" # jeden ťah, text na stdout
node bin/hades/hades.mjs run "…" --json        # jeden ťah, na stdout čistý JSON
node bin/hades/hades.mjs threads               # zoznam vlákien
node bin/hades/hades.mjs pending               # front odložených zápisov
node bin/hades/hades.mjs pending approve <id>  # povolí návrh — vykoná sa až teraz
node bin/hades/hades.mjs pending deny <id>     # zahodí návrh
node bin/hades/hades.mjs models                # modely a čo je nedostupné (a prečo)
node bin/hades/hades.mjs doctor                # odkiaľ má adresu a token
```

Pohodlnejšie meno (bash/zsh; PowerShell má `Set-Alias`):

```bash
alias hades='node ~/Desktop/AI-mind/bin/hades/hades.mjs'
```

Prepínače pre všetky príkazy: `--thread <uuid>`, `--new`, `--model <id>`,
`--help`, `--version`.

## Konfigurácia

Adresa a token sa hľadajú v tomto poradí, **prvý zdroj vyhráva** — a `doctor`
vždy povie, ktorý to bol:

| # | Zdroj | Kľúče |
|---|---|---|
| 1 | premenné prostredia | `HADES_URL`, `HADES_UI_TOKEN` |
| 2 | `~/.hades/config.json` | `{"url": "…", "token": "…"}` |
| 3 | `.env` projektu | `HADES_UI_TOKEN`, `APP_URL` |

`.env` sa hľadá stúpaním z aktuálneho priečinka nahor po prvý, kde je **`artisan`
aj `.env`** (samotný `.env` má aj hocijaký iný projekt a token by sa čítal cudzí).
Je zámerne posledný, ale na tomto stroji je to hlavná cesta: token netreba
kopírovať do druhého súboru. Keď nie je nikde, klient skončí **návodom a kódom 2**,
nie tracebackom.

Adresa bez zdroja padne na `http://localhost:8080`.

**Token sa nikdy nevypisuje** — ani `doctor`, ani chybová správa, ani skrátený.

## Bezpečnosť okruhu

Programový okruh konzoly (`/api/console/cli/*`, `/api/console/headless`) je
**loopback-only** a odmietne všetko, čo prišlo cez proxy alebo ngrok tunel
(`X-Forwarded-*` je diskvalifikácia). Preto:

- `401` znamená nesúhlas tokenu — alebo prázdny `HADES_UI_TOKEN` v konfigu appky
  (guard je fail-closed, teda zamknuté pre všetkých),
- `403` znamená nesprávnu cestu — nie z tohto stroja, alebo cez proxy.

Klient tieto dva prípady rozlišuje a v chybe povie, ktorý zdroj tokenu použil.

## Výstupný kontrakt (pre skripty)

- **text odpovede → stdout**, kresba (karty toolov, čísla, chyby) → **stderr**,
  takže `hades run "…" > odpoved.txt` uloží odpoveď a nie aj rámčeky,
- `run --json` má na stdout **iba JSON** → `hades run "…" --json | jq .text`,
- exit kódy: `0` ťah dobehol · `1` chyba behu alebo spojenia · `2` chýba konfigurácia.

Prúd, ktorý skončí bez ukončovacieho rámca, sa hlási ako **prerušený** a exit je
nenulový. Ťah, ktorý nedobehol, nesmie vyzerať ako úspešný.

Dva rozdiely medzi režimami, ktoré sú zámerné:

| | `run` | `run --json` |
|---|---|---|
| endpoint | `/console/cli/run` (NDJSON prúd) | `/console/headless` (jedna odpoveď) |
| tooly | plný register, zápis sa potvrdzuje | **len na čítanie** |
| vlákno | pokračuje v poslednom (`--new` založí nové) | nové, ak nie je `--thread` |

`--json` nededí posledné vlákno zámerne: plánovaný beh má byť reprodukovateľný
a nemá zdediť vlákno, ktoré niekto v UI zaparkoval na potvrdení zápisu (to by
skončilo na HTTP 422).

## Interaktívny režim

Odpoveď sa vypisuje priebežne z rámcov `delta`. Tool dostane kartu s menom
a kľúčovým argumentom, po dobehnutí stav (`hotovo` / `zlyhalo` / `zamietnuté`)
a čas; dlhý výsledok sa skráti **a klient to prizná**.

Zápis beh **zaparkuje**: vypíše sa náhľad (diff sa farbí — `+` zeleno, `-`
červeno) a čaká sa na **jedno stlačenie klávesu**:

```
[p]ovoliť · [v]ždy · [z]amietnuť · Esc = zamietnuť
```

Pri `bash` sa k „vždy" dopíše **(len tento vzor príkazu)** — backend povolenie
zúži na vzor, nie na celé vlákno.

- **Ctrl+C počas behu** beh zastaví (to, čo pritieklo, zostáva na obrazovke);
  klient žije ďalej. **Druhé Ctrl+C** ukončí program.
- Text napísaný **počas** behu sa nestratí — použije sa na ďalšom prompte.
- Šípka nahor drží históriu aj cez ťahy.

Slash príkazy: `/new`, `/threads`, `/thread <uuid>`, `/model <id>`, `/models`,
`/help`, `/exit`.

## Front odložených zápisov (`pending`)

V behu bez človeka (nočný rozvrh, `run --json`, MCP `console_run`) sa zápisový
tool **nevykoná ani nezaparkuje vlákno** — zaznamená sa ako **návrh** s náhľadom
(pri súboroch diff) a ťah skončí normálne. Bez toho by rozvrh nedokázal navrhnúť
zmenu, len napísať report: parkovanie čaká na klik, ktorý v noci nemá kto urobiť,
a zaparkované vlákno je zablokované natrvalo.

```bash
hades pending                    # čo čaká, s diffom a id
hades pending --thread <uuid>    # len návrhy jedného vlákna
hades pending approve <id>       # TERAZ sa tool vykoná
hades pending deny <id>          # návrh sa zahodí
hades pending --json             # front ako JSON (na stdout iba JSON)
```

`id` je **uuid návrhu**, nie číslo v zozname — poradie sa medzi výpismi mení.

Rozhodnutie je **idempotentné**: druhé `approve` na ten istý návrh tool
nevykoná druhýkrát (pri `write_file` alebo `mind_delete` je to rozdiel medzi
„nič" a „škoda"). Server vracia stav, ktorý naozaj platí, a klient vypíše jeho —
nie to, o čo bol požiadaný.

## Súbory

| Súbor | Zodpovednosť |
|---|---|
| `hades.mjs` | príkazy, exit kódy, preklad chýb na vety |
| `lib/config.mjs` | odkiaľ adresa a token (a odkiaľ presne) |
| `lib/api.mjs` | HTTP, čítanie NDJSON, `driveTurn()` vrátane parkovania |
| `lib/render.mjs` | ANSI výpis, karty toolov, diff, skracovanie |
| `lib/pending.mjs` | výpis frontu odložených zápisov a rozhodnutí |
| `lib/repl.mjs` | interaktívna smyčka, klávesnica, potvrdzovanie |

## Testy

```bash
node --test "bin/hades/test/*.test.mjs"
```

Glob, nie priečinok: **tento Node (v24.18, Windows) argument-priečinok neberie** —
`node --test bin/hades/test/` skončí na `Cannot find module …\bin\hades\test`,
pretože cestu vyhodnotí ako súbor. Overené aj na prázdnom projekte, teda to nie je
vlastnosť tohto repa. Funguje glob (vyššie) alebo `node --test` bez argumentov
z priečinka `bin/hades/`.

Bežia proti **vlastnému stub serveru** (`test/support/stub.mjs`, `node:http`) —
nie proti bežiacej appke. Routy `/api/console/cli/*` existujú len na vetve
`feat/hades-klient`, kým na `localhost:8080` beží hlavná vetva, takže test proti
nej by meral 404. A hlavne: proti stubu sa dá prúd rozsekať na presne tie chunky,
ktoré chcem — rozpolený JSON objekt a rozpolený viacbajtový znak sa inak nedajú
vyvolať zámerne.

Kryté je aj to, čo sa ručným preklikaním nechytí: prúd bez ukončovacieho rámca,
telo requestu na `/decide`, mlčanlivosť `doctor` o tokene, „na stdout je iba JSON"
ako vlastnosť procesu a strata vstupu napísaného počas behu.
