# Dizajn — Aura light business

Dizajnové rozhodnutia z otázkových kôl a auditov (15.–16. 7. 2026, 4-agentový audit
so 66 nálezmi). Cieľ: seriózna, minimalistická biznis vizualizácia „vedomia AI"
v štýle značky Aura.

## Tokeny

- **Plocha**: paper `#f8f4f7`, biele panely, hairline `--border`
- **Text**: ink `#101d1b`, muted `#566964` (5.3:1 na paperi)
- **Akcent**: teal `#03797e` / `#05bcc4` — jediný chrome akcent (klikateľné, aktívne, focus)
- **Zlato**: `#b88a3a` / `#d8b878` — VÝHRADNE jadro, brand a avatar; na text `--gold-text #8a6417` (4.9:1)
- **Fonty**: Geist (UI), Geist Mono (dáta/čísla/mikro-labely), Playfair Display (hero metriky)
- **Ikony**: Material Symbols Rounded — žiadne emoji
- Radiusy 8/10/14, 8px grid, tri stupne elevation, `--focus-ring` na všetkom interaktívnom
- Dark téma: `:root[data-theme="dark"]` prepis tokenov (paper `#0e1413`, text `#eaf3f1`,
  akcent `#05bcc4`, svetlejšie danger/warn/success) + canvas `THEMES.dark`

## Plátno (canvas)

- **Žiadna hmla**: bez častíc, halo gradientov, area blobov a vignette — plné kruhy
  s ink obrysom (slider „Obrysy uzlov")
- **Farba = oblasť** vo všetkých náhľadoch; **typ = tvar**: spomienka plný disk,
  skill donut (diera vo farbe papiera), projekt disk s tenkým vonkajším prstencom,
  jadro zlaté koncentrické kruhy
- **Auto-fit**: pri štarte, prepnutí náhľadu a klávese 0 sa pohľad nastaví na celú sieť
  (vo Vrstvách vrátane hlavičiek stĺpcov)
- **Stlmenie s podlahou**: fokus/hover stlmí zvyšok na min. 0.30 (uzly) / 0.20 (hrany),
  v dark 0.35/0.25 — kontext nikdy nezmizne úplne; labely viditeľných majú prednosť
- **Labely**: na plátne max 30 znakov s „…", plný text v tooltipe a paneli
- **Vrstvy**: reálne hrany zo siete (mesh každý-s-každým len ako pozadie ≤0.03)
- **Mapa**: polomer oblastí 640 (oddelené ostrovčeky), popisky oblastí tesne nad
  svojím klastrom, alpha 0.5, screen-konštantné písmo
- **Dark**: farby oblastí prechádzajú cez HSL zosvetlenie (`darkAreaColor`)
- Pulzy = plné krúžky vo farbe oblasti; sila uzla = polomer 7–16 (jadro 24)

## Layout

- **Ľavý rail** 56px: Štruktúra (R), Hľadanie (F), Prehľad (S), Denník (D — teal
  bodka pri nových záznamoch), Legenda (L), Časová os (T); dole Pomocník (?), zvuk,
  ambient, Nastavenia
- **Header** = plávajúci ostrov (top 16, radius 14): brand · breadcrumb
  (Hades / oblasť / oddelenie, klikateľný, sync s fokusom) · stavový chip bdie/spí ·
  prepínač náhľadov v strede · kompaktná časová os · metriky „N uzlov · M spojení"
- **Docky** vľavo (jeden naraz), **detail uzla** vpravo, **prompt bar** dole v strede,
  toasty nad zoom ovládaním vpravo dole
- **Responzivita**: <1280 px užšie panely a prompt, <900 px docky ako overlay

## Interakcie

- **Fokus oblasti/oddelenia**: klik v strome štruktúry alebo dvojklik na oblasť
  v mape; Escape ruší postupne (kaskáda: help → detail → dock → prompt → fokus)
- **Klávesnica**: funguje aj na slovenskom rozložení (fyzické Digit1/2/3/0);
  skratky sa nespúšťajú vo formulárových poliach vrátane selectov
- **Async akcie**: jednotný vzor — tlačidlo disabled + „Ukladám…", toast pri úspechu
  aj chybe; mazanie cez arm-confirm („Naozaj zmazať?", 3 s), žiadne systémové dialógy
- **Empty/error stavy**: jednotný komponent (ikona + text); pád API zobrazí
  hero „Vedomie sa nepodarilo prebudiť" + Skúsiť znova
- **Onboarding**: 5 hintov (rail, náhľady, klik/dvojklik, prompt, nastavenia),
  pomocník má aj sekciu Myš

## Záznam v detaile uzla

Session záznamy zobrazujú z meta: Prompty (očíslované, mono), Súbory (chips s cestou),
Commity, Nástroje (názov ×počet), Záver. Denník = timeline po dňoch
(Dnes / Včera / genitív dátumu) s filtrami projektov.

## Zásady

1. Jedna sémantika farieb — farba hovorí „kam patrí", tvar „čo to je"
2. Zlato je vzácne — čím menej ho je, tým viac znamená jadro
3. Kontrast pred dekoráciou — WCAG 4.5:1 text, 3:1 grafika
4. Feedback na každú akciu — používateľ nikdy neháda, či sa niečo stalo
5. Žiadne hviezdy, žiadne emoji, žiadna hmla — len čisté kruhy a hairliny
