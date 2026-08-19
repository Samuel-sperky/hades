# Kontrakt — Hades: finálny branding

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-branding` (z `feat/hades-konzola`)
**Veľkosť:** M · **Kadencia:** jedno schválenie, potom beh do konca
**Strop:** 600 000 tokenov (odhad 300–450k)

## 1. Cieľ

Uzavrieť značku Hadesa ako **samostatnú identitu** (dnes existuje len ako
implementácia odpísaná z Aury) a premietnuť ju do kódu: manuál, prepracovaný znak
a assety, prefarbenie akcentu na amethyst, branding konzoly ako **Charón**.

## 2. Rozhodnutia (30 otázok, 19. 8. 2026)

### Identita
| # | Otázka | Rozhodnutie |
|---|---|---|
| 1 | Názov | **Hades** (samostatne, bez prívlastku) |
| 2 | Vzťah k Aure | **Samostatná značka** — vlastná identita, nie sub-značka |
| 3 | Descriptor | anglicky, ako rozpis skratky |
| 4 | Publikum | **len používateľ** — značka nemusí nič vysvetľovať |
| 5 | Tón | technický s jemným mýtom |
| 6 | Backronym | **H**ierarchical **A**ssociative **D**ata **E**mbedding **S**ystem |
| 7 | Zápis | `Hades` (nie HADES, nie H.A.D.E.S.) — rozpis žije v tooltipe a manuáli |
| 8 | Jazyk | SK UI, EN značka |
| 9 | Hlas | **neosobne** („V pamäti je…", nie „Pamätám si…") |
| 10 | Konzola | **Charón** (prievozník — sprostredkovateľ medzi človekom a pamäťou) |

### Znak
| # | Otázka | Rozhodnutie |
|---|---|---|
| 11 | Znak | prepracovaný, nie dnešné tri kruhy |
| 12 | Motív | **sigil zo súosných prstencov** — uzol z plátna povýšený na znak |
| 13 | Detail | **dve verzie**: master (deck, hero) + zjednodušená (< 24 px) |
| 14 | Konštrukcia | **geometrická mriežka, ručné SVG** — deterministické, zapísané v manuáli |
| 15 | Pohyb | **dýchanie + intro animácia** zrodu znaku |
| 16 | Wordmark | **nové display písmo** (viď §4 — predvolené rozhodnutie) |

### Farba a typografia
| # | Otázka | Rozhodnutie |
|---|---|---|
| 17 | Paleta | **amethyst nahrádza teal** ako interaktívny akcent; zlato zostáva značkové |
| 18 | Pozadie | **tmavé je značkové**, svetlé zostáva povinným variantom |
| 19 | Farby oblastí | **dátová vrstva**, nie paleta značky (manuál nesie len pravidlo) |
| 20 | Farby istoty | **áno**, patria do manuálu ako značková sémantika |
| 21 | Serif | Playfair len **hero metriky a wordmark** |
| 22 | Charón typografia | **žiadne odlíšenie** — vyzerá ako zvyšok appky |
| 23 | Ikony | Material Symbols Rounded potvrdené a rozšírené na Charóna |

### Aplikácia
| # | Otázka | Rozhodnutie |
|---|---|---|
| 24 | Titulky | **`Hades — Charón`** (značka prvá) |
| 25 | Hlášky | **ponechať a kodifikovať** značkové stringy |
| 26 | Zvuk | ponechať ako je, do manuálu nič navyše |
| 27 | Assety | znak master + zjednodušený, wordmark a lockupy, favicon + OG, monochróm + PNG |
| 28–30 | Rozsah | **manuál + logo + prefarbenie + Charón** v jednom behu |

## 3. Rozsah (zmeraný, nie odhadnutý)

- `public/css/mind.css`: **113×** `var(--accent*)`, **12** raw teal hexov,
  tokeny v `:root` (10 riadkov) a `:root[data-theme="dark"]` (8 riadkov).
- `public/js/mind/theme.js`: **2 triplety** (`accent: '3,121,126'` / `'5,188,196'`).
- Zvyšok JS: 19 zásahov, všetko cez tokeny.

**Prefarbenie je teda výmena hodnôt, nie refaktor.** Riziko nesie kontrast, nie rozsah.

## 4. Predvolené rozhodnutia (moje, dajú sa zmeniť)

- **Display písmo = Cinzel** (OFL, rímske nápisové tvary). Sadne k mýtu, nekoliduje
  s Geistom ani Playfairom. **Subset len na glyfy wordmarku** (`Hades`), ~2–4 kB —
  rovnaký postup ako pri Material Symbols. Wordmark sa navyše exportuje
  ako **obtiahnuté krivky**, takže assety na písme nezávisia.
- **Amethyst hodnoty** doladím kontrastným meraním, nie od oka. Cieľ: light `--accent`
  ≥ 4,5:1 na paperi pre malý text, dark `--accent` ≥ 4,5:1 na tmavom paneli,
  grafika ≥ 3:1. Kolízia s `--cert-hypoteza` (zlatá) a `--error` sa overuje.
- **Teal zostáva ako farba oblasti** (prichádza z DB). Prefarbenie akcentu tú
  kolíziu, keď akcent == farba oblasti „Vývoj & kód", naopak **odstráni**.
- **Charón = názov obrazovky, nie nová URL.** `/console` zostáva; premenovanie je
  v UI, titulkoch a hláškach. Zmena URL by zabila existujúce odkazy na vlákna.

## 5. Plán vĺn

| Vlna | Obsah | Výstup |
|---|---|---|
| 0 | Kontrakt + vetva | tento súbor |
| 1 | Manuál značky | `docs/BRAND-HADES.md` (identita, znak, farba, typografia, pohyb, hlas, aplikácia, checklist) |
| 2 | Znak a assety | `public/brand/*` — sigil master + mini, wordmark, lockupy, favicon/OG, monochróm, PNG |
| 3 | Amethyst | tokeny light+dark, `theme.js` triplety, 12 raw hexov, kontrastný audit |
| 4 | Charón | premenovanie konzoly, titulky `Hades — X`, značkové stringy, ikona |
| 5 | Dôkaz | `cssswap.js` inertnosť mimo akcentu, kontrastné merania, screenshoty light+dark, `php artisan test` |

## 6. Odhad spendu

| Vlna | Odhad |
|---|---|
| 1 manuál | 60–90k |
| 2 znak a assety | 90–140k |
| 3 amethyst | 60–90k |
| 4 Charón | 40–70k |
| 5 dôkaz a testy | 50–80k |
| **Spolu** | **300–450k**, strop **600k** |

Bez agentového fan-outu — celý beh v hlavnej slučke (rozhodnuté kvôli spendu).

## 7. Hotovo, keď

- [ ] `docs/BRAND-HADES.md` pokrýva všetkých 30 rozhodnutí a je zdrojom pravdy pre Hadesa
- [ ] znak existuje v oboch verziách, na tmavom aj svetlom, a favicon je čitateľný pri 16 px
- [ ] amethyst prešiel kontrastným meraním v oboch témach (text 4,5:1, grafika 3:1)
- [ ] konzola je všade Charón, titulky `Hades — X`
- [ ] `php artisan test` zelený, screenshoty light + dark v reporte

## 8. Výsledok

_(dopĺňa sa po behu)_
