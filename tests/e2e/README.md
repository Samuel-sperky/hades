# E2E suite (Playwright)

Beží proti **živému dev stacku**. Nič si nespúšťa sama — appka musí bežať.

## Rýchly štart

```bash
cd C:\Aura\aura-ai
docker compose up -d                                  # appka musí odpovedať na /up
docker compose exec -T app npx playwright test        # celá suite
```

Prvý beh na čistom kontajneri potrebuje prehliadač:

```bash
docker compose exec -T app npx playwright install --with-deps chromium
```

> **Pozor:** prehliadače idú do `/root/.cache/ms-playwright`, teda do vrstvy
> kontajnera — nie do volume. Po `docker compose up --force-recreate` / rebuilde
> obrazu treba `playwright install` zopakovať. Trvalé riešenie (env
> `PLAYWRIGHT_BROWSERS_PATH` do `docker-compose.yml`) je patch pre integrátora
> v `refactor-auraai/R-A11-PLAYWRIGHT.md` — `docker-compose.yml` je zdieľaný súbor.
>
> `PLAYWRIGHT_BROWSERS_PATH` **nikdy neposielaj cez Git Bash** (`docker compose exec -e …`):
> MSYS prepíše `/var/www/...` na `C:/Program Files/Git/var/www/...` a inštalácia
> skončí v podadresári repozitára. Použi PowerShell alebo `MSYS_NO_PATHCONV=1`.

## Výber toho, čo sa spustí

```bash
# jeden projekt
docker compose exec -T app npx playwright test --project=desktop-light
docker compose exec -T app npx playwright test --project=mobile

# jeden spec / jeden test
docker compose exec -T app npx playwright test tests/e2e/eshop.spec.js
docker compose exec -T app npx playwright test -g "zoom"

# beh z hostiteľa (appka na 8082, Reverb dosiahnuteľný → úplne čistá konzola)
npx playwright test
```

## Projekty

| Projekt | Viewport | Čo beží |
|---|---|---|
| `desktop-light` | 1440 × 900, light | všetko okrem `mobile.spec.js` |
| `desktop-dark` | 1440 × 900, dark | len `smoke.spec.js` |
| `mobile` | 390 × 844, touch | len `mobile.spec.js` |

Rozdelenie je v `playwright.config.js` cez `testMatch` / `testIgnore`, takže
**žiadny test sa neskipuje** — každý spec beží tam, kde má zmysel.

## Základná URL

`playwright.config.js` ju odvodí sám:

- v kontajneri (`/.dockerenv` existuje) → `http://localhost:8080`
- na hostiteľovi → `http://localhost:8082`
- prebiť sa dá `AURAAI_BASE_URL`

## Screenshoty — artefakt, NIE asercia

`tests/e2e/__screenshots__/` sa prepisuje pri každom behu (`page.screenshot`).
Sú to obrázky **na obhliadku človekom**, nie pixelová porovnávka:

- Nepoužíva sa `toHaveScreenshot()`, takže **`--update-snapshots` tu nič nerobí** —
  baseline sa obnoví tým, že suite jednoducho zbehne.
- Pixelová porovnávka grafu by bola zaručene flaky: `#mind` je canvas kreslený
  d3-force simuláciou, takže rozloženie uzlov sa medzi behmi líši. A flaky test je
  horší než žiadny.
- Vizuálne regresie preto strážia štrukturálne asercie (`toBeVisible`, obsah textu,
  namaľované pixely plátna, farba pozadia po prepnutí témy), nie bitmapy.

Po zmene layoutu si obrázky **prezri** — sú tam presne na to, aby sa nezabetónoval
rozbitý stav.

## Stabilita — pravidlá pre nové testy

1. Žiadny `waitForTimeout` ako hlavná synchronizácia. Čaká sa na stav:
   `expect(...).toBeVisible()`, `expect.poll(...)`, `waitForFunction`, `waitForResponse`.
2. `waitForResponse` sa registruje **pred** akciou, ktorá request vyvolá.
3. Externé a ešte nepostavené API sa mockujú — `mockEshop()`, `mockChat()`
   v `helpers.js`. Suite nesmie padať preto, že cudzí e-shop odpovedal pomalšie
   alebo že Ollama práve nahrieva model.
4. Žiadne zabetónované konštanty z UI. Zoom sa testuje **pomerom**, nie hodnotou —
   presne na tomto sa rozbil predošlý baseline, keď W2 posunula default zoom
   z 0.489 na 0.6.
5. `retries: 0` je zámer. Flaky test má padnúť nahlas.

## `helpers.js`

| Funkcia | Načo |
|---|---|
| `boot(page, testInfo, {theme})` | načíta appku s deterministickými preferenciami (`addInitScript`, jeden boot) |
| `watchConsole(page)` | zbiera chyby konzoly, `pageerror` a HTTP ≥ 400; `expectClean()` overí oboje |
| `gotoScreen(page, key)` | prepne obrazovku cez rail a počká na router |
| `settleGraph(page)` | počká na utíchnutie d3 simulácie (nefatálne) |
| `paintedPixels(page)` | počet pixelov plátna odlišných od pozadia |
| `mockEshop` / `mockChat` | fixtures pre e-shop API a SSE stream (kontrakt #17) |

`watchConsole` má **explicitný** zoznam známeho šumu (`KNOWN_BAD_ROUTES`,
WS transport). Každý riadok má dôvod a cieľom je prázdny zoznam — keď P5 postaví
`/api/llm/stats`, riadok zmizne a 404 sa začne hlásiť.

WS šum vzniká len pri behu **v kontajneri**: `auraai.public_ws_host` je `localhost`
a Reverb je publikovaný na hostiteľskom porte 8083, kam prehliadač vnútri
kontajnera nedosiahne. Pri behu z hostiteľa sa filter netrafí.

## Regresie po opravených chybách

E2E vlna našla dve reálne chyby a obe sú opravené. Testy, ktoré ich dokumentovali,
mali `test.fail()`; po oprave sa rozsvietili („expected to fail, but passed") a
`test.fail()` z nich bol odobraný. Odteraz sú to obyčajné regresné testy
v `regressions.spec.js`:

- *Cmd-K vie na každú obrazovku z core/screens.js* — `shell/cmdk.js` si držal
  vlastný `CMDK_NAV` so 7 obrazovkami z čias pred pridaním Chatu a E-shopu, takže
  sa paletou na ne nedalo dostať. Zoznam sa teraz odvodzuje zo `SCREENS`
  (zamknuté rozhranie #16).
- *quickbar chatu je kliknuteľný na obsahovej obrazovke* — `#prompt` bol na
  `--z-chrome` (10), ale `#screens` je na `--z-panel` (20) a prekrýval dolný stred,
  kde quickbar stojí. `#chat-expand` aj `#chat-send` boli preto na každej obsahovej
  obrazovke nekliknuteľné. Quickbar je teraz na `--z-panel + 2`.
- *quickbar nie je ničím prekrytý* — priamy dôkaz o vrstvení cez
  `elementFromPoint`, nezávislý od kliku. Nahradil pôvodný „regression guard",
  ktorý tvrdil, že chyba existuje.

Tento vzor sa oplatí zopakovať: chybu, ktorú nechceš opravovať hneď, zapíš ako
`test.fail()`. Gate zostane zelený, chyba je spustiteľne zdokumentovaná, a v momente
opravy si test sám vyžiada pozornosť.
