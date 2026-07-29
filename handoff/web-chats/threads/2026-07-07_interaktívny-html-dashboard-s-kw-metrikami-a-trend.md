# Interaktívny HTML dashboard s KW metrikami a trendmi

- **UUID:** 59c08878-ab6c-4bc7-a881-6ea61244f122
- **Vytvorené:** 2026-07-07T12:37
- **Aktualizované:** 2026-07-08T07:41
- **Správ:** 26

---

### 🧑 Používateľ
*(prílohy: sperky-eshop_overview_2026-07-07_14-27-09.csv, sperky-eshop_overview_2026-07-07_14-27-40.csv, sperky-eshop_overview_2026-07-07_14-28-09.csv, sperky-eshop_overview_2026-07-07_14-28-45.csv, sperky-eshop_overview_2026-07-07_14-29-19.csv, sperky-eshop_overview_2026-07-07_14-29-46.csv, sperky-eshop_overview_2026-07-07_14-32-08.csv, sperky-eshop_overview_2026-07-07_14-32-48.csv, sperky-eshop_overview_2026-07-07_14-33-43.csv, sperky-eshop_overview_2026-07-07_14-34-11.csv, sperky-eshop_overview_2026-07-07_14-34-37.csv, sperky-eshop_overview_2026-07-07_14-35-07.csv, sperky-eshop_overview_2026-07-07_14-35-58.csv, sperky-eshop_overview_2026-07-07_14-36-30.csv, sperky-eshop_overview_2026-07-07_14-36-59.csv, sperky-eshop_overview_2026-07-07_14-37-23.csv)*

Vytvor interaktívny html súbor so klikateľnými skupinami KW, drop down pre mesiace, každý tab nech má overview navrchu a KW zoznam klikateľný, kde sa otvoria metriky daného KW. Nech sú zobrazené podľa bucketov, nech je vidieť trend

### 🤖 Claude
[tool_use: view]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

Dáta rozpoznané: 16 CSV = 16 KW skupín (buckety podľa tagu), každý keyword má 2 snapshoty — Máj (previous) a Jún (current) pre pozíciu aj traffic. Trend = posun Máj→Jún. Vnútri skupiny zoradím KW do pozičných bucketov (TOP 3, 4–10, 11–20, 21–50, 51+).

Extrahujem dáta do JSON.

[tool_use: bash_tool]

[tool_result]

Dáta pripravené (585 KW / 16 skupín, 257 KB). Staviam self-contained HTML dashboard. Najprv šablóna, potom injektnem JSON.

[tool_use: create_file]

[tool_result]

[tool_use: bash_tool]

[tool_result]

Syntax OK. Runtime smoke-test s DOM shimom, aby som zachytil chyby v render ceste (aggregate, distribúcia, detail, sparkline).

[tool_use: bash_tool]

[tool_result]

Runtime OK naprieč všetkými cestami. Opravím jeden mobilný grid detail (skrytie volume by inak zalomilo šípku trendu do nového riadku).

[tool_use: str_replace]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Hotovo. `sperky-eshop-seo-dashboard.html` — jeden samostatný súbor, funguje offline, žiadne externé závislosti okrem fontov.

Štruktúra:

Ľavý panel — 16 klikateľných KW skupín rozdelených na Zlaté / Strieborné + tab „Prehľad portfólia". Každá položka má počet KW a šípku netto pohybu.

Dropdown „Obdobie" (vpravo hore) — Máj 2026 / Jún 2026. Prepnutie prebucketuje a prepočíta všetky čísla; pásma distribúcie sa animovane presunú, čím je priamo vidieť migráciu KW medzi pozíciami.

Každý tab:
- Overview navrchu — KPI (počet KW, súčet volume, odhad. traffic + Δ, priem. pozícia, pohyb ▲/▼/·) a pásmo rozloženia podľa pozičných bucketov s Δ oproti druhému mesiacu.
- KW zoznam po bucketoch — TOP 3 / 4–10 / 11–20 / 21–50 / 51+, každý bucket collapsible, s Ø pozíciou, trafficom a netto pohybom. Filter na hľadanie KW.
- Klik na KW → detail: 2-bodový sparkline pozície (Máj→Jún, aktívny mesiac zvýraznený), zmena pozície aj trafficu, volume, KD, CPC, kliky, zámery a SERP features, URL.

Prehľad portfólia — globálne KPI, rozloženie celého portfólia, „Najväčšie pohyby" (top zisky/prepady naprieč všetkými skupinami, klik skočí priamo na KW), a mriežka skupín s mini-metrikami.

Trend Máj→Jún je viditeľný na štyroch úrovniach: pill pri každom KW, netto v hlavičke bucketu, Δ v distribúcii, a top movers v prehľade.

Dáta: 585 KW / 16 skupín. Farebné kódovanie zlato/striebro = produktová taxonómia; kvalitatívny ramp zelená→sivá = kvalita pozície.

### 🧑 Používateľ
Pridaj možnosť náhľadu podľa jednotlivých bucketov tiež.

A urob cross-check, nakoľko KW v portfóliu by malo byť 627. KW v 1-3 by malo byť 153, v 4-10 by malo byť 256 a v 11-20 by malo byť 127.
A ešte  pridaj možnoť náhľadu len Zlato a len striebro

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

Cross-check najprv. Nahraté exporty obsahujú presne 585 riadkov, nie 627.

[tool_use: bash_tool]

[tool_result]

585 potvrdených priamo zo zdrojových bajtov (nie chyba parseru). Gap 42 KW = tieto exporty neobsahujú celé portfólio. Zabudujem cross-check panel, ktorý to zobrazí transparentne, plus bucket view a Zlato/Striebro scope.

Prepisujem dashboard.

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Cross-check výsledok — čísla nesedia s cieľom, dáta sú neúplné:

| Segment | Aktuálne (Jún) | Cieľ | Δ |
|---|---|---|---|
| TOP 3 | 146 | 153 | −7 |
| 4–10 | 247 | 256 | −9 |
| 11–20 | 124 | 127 | −3 |
| 21–50 | 30 | — | — |
| 51+ | 38 | — | — |
| **Spolu** | **585** | **627** | **−42** |

585 potvrdené priamo zo zdrojových bajtov 16 CSV (nie chyba parseru — žiadne embedded newlines, žiadne zahodené riadky, 582 unikátnych KW). Chýbajúcich 42 KW v nahratých súboroch fyzicky nie je. Shortfall v troch bucketoch (−7/−9/−3 = −19) plus zvyšok v 21–50 a 51+ zodpovedá týmto chýbajúcim riadkom. Príčina je na strane exportu: buď neexportované tagy/skupiny, alebo KW bez aktuálnej pozície, ktoré Ahrefs z overview exportu vynecháva. 42 riadkov neviem dogenerovať z dát, ktoré nie sú prítomné. Cross-check panel s týmto rozpisom je zabudovaný v Prehľade portfólia a prepočítava sa živo.

Pridané:
- Náhľad podľa bucketov — v ľavom menu sekcia „Podľa bucketov" (TOP 3 / 4–10 / 11–20 / 21–50 / 51+). Otvorí overview daného bucketu naprieč portfóliom + KW zoskupené podľa skupiny, klikateľné na metriky. Členstvo v buckete sa mení podľa zvoleného mesiaca.
- Scope Zlato / Striebro — segmentový prepínač „Všetko / Zlaté / Strieborné" v hlavičke. Filtruje celý dashboard: sidebar, prehľad, buckety, movers, počty. Zlaté = 424 KW, Strieborné = 161 KW.
- Cross-check panel v Prehľade + mini cross-check v bucket view pre TOP 3 / 4–10 / 11–20.

Bucket membership a cross-check počítané z pozícií za Jún 2026 nezávisle od prepínača obdobia.

### 🧑 Používateľ
*(prílohy: 1783429699818_image.png)*

v exporte je 627

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

Potvrdené zdrojom. Rozpor je vysvetlený, nie je to chyba v tvojich číslach ani v mojom parseri.

627 = celý projekt v Ahrefs (screenshot). 585 = súčet 16 nahratých exportov, filtrovaných po produktových tagoch. Každý z 16 CSV je filtrovaný na jeden tag; spolu pokrývajú 16 tagov. V žiadnom z nich nie je ani jeden riadok bez tagu (untagged = 0).

Branded výrazy zo screenshotu — "sperky eshop", "šperky eshop" — sa v nahratých 16 súboroch nevyskytujú (0 výskytov). To sú untagged keywords: existujú v projekte (627), ale nemajú produktový tag, takže nepadnú do žiadneho tag-filtrovaného exportu. To je jadro 42 chýbajúcich KW.

Rozklad:
627 (projekt, všetky KW) − 585 (16 produktových tagov) = 42 KW bez produktového tagu (branded + generické netagované).

Čo z toho plynie: nahrané dáta nie sú neúplný export jednej množiny — sú to úplné exporty 16 tagov. Chýbajúcich 42 nie je v žiadnom z nich, pretože tie KW nie sú otagované. Dashboard ich nemá odkiaľ zobraziť.

Na zosúladenie na 627: exportuj z Ahrefs celý zoznam bez tag filtra (alebo len untagged zvyšok — filtruj "no tag") a nahraj ako 17. súbor. Vtedy portfólio sadne na 627 a cross-check pôjde na Δ 0. Do tej doby dashboard beží na 585 otagovaných KW a cross-check panel ten rozdiel priznáva.

### 🧑 Používateľ
skupinu "zlatý piercing" prepíš na "piercing"

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Skupina "Zlatý piercing" premenovaná na "Piercing". Kategória ostáva zlaté (tag zlaty_piercing), 96 KW nezmenené. Prejaví sa v sidebare, prehľade, group grid aj movers.

### 🧑 Používateľ
*(prílohy: sperky-eshop_overview_2026-07-07_15-21-56.csv, sperky-eshop_overview_2026-07-07_15-24-05.csv)*

Nahrám Ti ešte raz exporty pre niektoré skupiny, update-ni si data v html

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Aktualizované dve skupiny refreshnutými dátami:
- zlate_retiazky (Zlaté retiazky) — 79 KW nahradených
- zlate_privesky (Zlaté prívesky) — 20 KW nahradených

Labely zachované (vrátane premenovaného "Piercing"), kategórie nezmenené, obdobie Máj→Jún zhodné. Total ostáva 585. Ostatných 14 skupín nedotknutých. Cross-check gap voči 627 nezmenený (−42, untagged KW mimo exportov).

### 🧑 Používateľ
*(prílohy: 1783431474263_image.png)*

pridaj do sumáru skupín aj Share of Voice (SoV)

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: view]

[tool_result]

[tool_use: view]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

SoV pridané do sumáru skupín (KPI riadok group view, bucket view, prehľad portfólia) aj do kariet skupín v prehľade.

Metóda: SoV = 100 × Σ(Volume × CTR(pozícia)) / (CTR(1) × ΣVolume). CTR krivka podľa pozície (pos1 = 31,6 %, pos2 = 15,8 % … pos10 = 1,71 %, 11–20 klesajúco, >20 → ~0). 100 % = #1 pre všetky KW skupiny. Počíta sa pre Máj aj Jún, KPI karta ukazuje aktuálny mesiac + Δ v percentuálnych bodoch Máj→Jún nezávisle od prepínača.

Toto nie je Ahrefs SoV číslo — Ahrefs používa vlastný neverejný CTR model. Toto je transparentný štandardný odhad z Volume + pozície, reprodukovateľný z dostupných dát. Ahrefs SoV neviem replikovať bez ich CTR krivky.

Hodnoty (Jún): Piercing 41,7 % · Zlaté náušnice 7,3 % · portfólio 16,0 %.

Pozn.: cross-check buckety sa posunuli na 147/247/124/30/37 (predtým 146/…/38) — refreshnutý export retiazky/prívesky presunul jeden KW z 51+ do TOP 3. Total 585 nezmenený.

### 🧑 Používateľ
give me the updated html report

### 🤖 Claude
[tool_use: present_files]

[tool_result]

sperky-eshop-seo-dashboard.html — aktuálna verzia. 585 KW / 16 skupín. Obsahuje: Piercing (premenované), refreshnuté zlate_retiazky + zlate_privesky, Share of Voice v sumároch skupín, bucket view, Zlato/Striebro scope, cross-check panel (−42 voči 627, untagged KW mimo exportov).

### 🧑 Používateľ
*(prílohy: sperky-eshop.sk-organic-keywords-subdomains_2026-07-08_07-25-26.csv)*

Pridaj okrem FIX aj všeobecné KW, daj ich do skupín, klikateľné s metrikami, filtrami, grafy a 1 tabuľka

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

Nový súbor: Ahrefs organic keywords, 1086 KW, s pozíciami Máj→Jún, intentmi, URL. Analyzujem a klasifikujem do skupín pred integráciou.

[tool_use: bash_tool]

[tool_result]

1086 KW klasifikované do 11 topic-skupín (Ostatné 195 = catch-all, Značka 45 = branded). Prekryv s FIX = 464. Buildujem general dataset a integrujem novú sekciu s grafmi, filtrami, klikateľnými skupinami a jednou tabuľkou.

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: view]

[tool_result]

[tool_use: view]

[tool_result]

Data (1086 KW) v data.json. Teraz integrácia UI. Zapisujem nové CSS.

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

Runtime OK — všetky cesty general view (tabuľka, skupiny, filtre, sort, prepínač obdobia) bez chýb. FIX nedotknutý.

[tool_use: present_files]

[tool_result]

Pridaná sekcia "Všeobecné KW (organic)" popri FIX. V ľavom menu nová položka (1086 KW).

Dataset: 1086 organických KW z Ahrefs exportu, pozície Máj→Jún (2026-05-06 → 2026-06-16), reaguje na prepínač obdobia hore.

Skupiny (klikateľné, s metrikami): 11 tematických skupín klasifikovaných z textu KW — Náušnice 212, Ostatné 195, Retiazky 162, Prstene 155, Náramky 122, Piercing 93, Značka 45 (branded), Prívesky 41, Náhrdelníky 37, Sety 18, Náramky na nohu 6. Klik na skupinu → rozbalí, klik na KW → detail (pozícia, sparkline trend, traffic, KD, CPC, zámery, SERP, URL).

Filtre (spoločné pre skupiny aj tabuľku): fulltext, zámer (transakčné/komerčné/informačné/brandové/navigačné/lokálne), pozičný bucket. KPI a grafy sa prepočítavajú podľa filtra.

Grafy (4): rozloženie pozícií s Δ trendom, zámery vyhľadávania (počet), organic traffic podľa skupín, top 10 vstupných stránok podľa traffic.

1 tabuľka: všetky KW, klik na hlavičku zoradí (Keyword, pozícia, Δ, volume, traffic, Δ traffic, KD, CPC, zámer, skupina, URL), klik na riadok rozbalí metriky. Prepínač Skupiny/Tabuľka.

KPI vrátane SoV (CTR model) aj pre organic set. Portfólio SoV organic 22,6 %.

Pozn.: topic klasifikácia je heuristická (podľa slov v KW); "Ostatné" 195 = nezaradené, "Značka" = branded. FIX (585 sledovaných) ostáva oddelený.

### 🧑 Používateľ
*(prílohy: 1783490895044_image.png)*

vyznač trend pohyb a daj graf v % fix KW vrámci všeobecných

### 🤖 Claude
Dve úpravy: (1) vyznačiť trend pohyb v KPI „Pohyb pozícií" (netto + diverging bar) naprieč sekciami, (2) graf % FIX (sledovaných) KW v rámci všeobecných — spolu aj po skupinách. Zapisujem CSS a funkcie.

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Hotovo.

Trend pohyb vyznačený — KPI „Pohyb pozícií" má teraz diverging bar (zelená zlepšenie / sivá stabil / červená prepad, proporčne) a explicitné Netto ▲/▼ číslo. Platí vo všetkých sekciách (FIX prehľad, skupina, bucket, všeobecné).

Graf % FIX v rámci všeobecných — nová karta „Podiel sledovaných (FIX) KW v organických" v sekcii Všeobecné KW. Stacked bar (zlatá = sledované, sivá = nesledované) s % a n/total, riadok Spolu navrchu + po skupinách. Reaguje na filtre.

Hodnoty: Spolu 43 % (464/1086). Po skupinách: Piercing 83 %, Retiazky 58 %, Prívesky 56 %, Sety 56 %, Náramky 44 %, Náušnice/Prstene 43 %, Náhrdelníky 35 %, Náramky na nohu 33 %, Ostatné 17 %, Značka 2 %.

Navyše FIX keywords sú označené odznakom „FIX" v tabuľke aj v zozname skupín, takže vidno ktoré organické KW sú pod sledovaním.

### 🧑 Používateľ
*(prílohy: 1783495151681_image.png)*

pridaj filter na "fix" a "všeobecné" a "all" a vyjadruj fix v každej skupine v %

### 🤖 Claude
Pridám filter zdroja (Všetko / FIX / Všeobecné) do sekcie a FIX % do hlavičky každej skupiny. Pozriem aktuálne funkcie.

[tool_use: bash_tool]

[tool_result]

[tool_use: view]

[tool_result]

[tool_use: view]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Pridané v sekcii Všeobecné KW:

Filter zdroja — segment „Všetko / FIX / Všeobecné" vedľa ostatných filtrov. Všetko = 1086, FIX = 464 (sledované), Všeobecné = 622 (nesledované). Ovplyvňuje KPI, 4 analytické grafy, zoznam skupín aj tabuľku. Graf „Podiel FIX" zostáva vždy na plnom rozsahu (aby ukazoval rozdelenie), nezávisle od tohto filtra.

FIX % v hlavičke každej skupiny — v zozname „KW podľa tematických skupín" má teraz každá skupina zlatý údaj „FIX X % (n/total)". Počíta sa z base filtra (intent/pozícia/text), nezávisle od prepínača zdroja, takže zostáva zmysluplné aj pri FIX/Všeobecné výbere.

Hodnoty pokrytia po skupinách: Piercing 83 %, Retiazky 58 %, Prívesky/Sety 56 %, Náramky 44 %, Náušnice/Prstene 43 %, Náhrdelníky 35 %, Náramky na nohu 33 %, Ostatné 17 %, Značka 2 %. Spolu 43 %.

### 🧑 Používateľ
nie sú všeobecné v podstate all?

### 🤖 Claude
Áno. Máš pravdu — celá sekcia je „Všeobecné KW" (1086 organických), takže „Všetko" = všeobecné. Voľba „Všeobecné" bola nesprávne pomenovaná; tá tretia možnosť je v skutočnosti organické KW, ktoré nie sú v FIX = nesledované. Premenúvam.

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Filter zdroja teraz: Všetko (1086) / FIX (464, sledované) / Nesledované (622, organické mimo FIX). „Všetko" = celý všeobecný set. Terminológia zjednotená s legendou grafu pokrytia.

### 🧑 Používateľ
máš tam informáciu koľko % je fix zo all?

### 🤖 Claude
Áno — v grafe „Podiel FIX", riadok Spolu = 43 % (464/1086). Zviditeľňujem to aj priamo vo filtri sekcie ako fixný údaj.

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Bola — v grafe „Podiel FIX", riadok Spolu (43 %, 464/1086).

Teraz je aj vždy viditeľná: vo filtri sekcie Všeobecné KW je zlatý údaj „FIX 43 % zo všetkých 464/1086". Fixná hodnota, nemení sa filtrami (je zo všetkých 1086).

### 🧑 Používateľ
*(prílohy: www.izlato.sk-organic-keywords-subdomains-s_2026-07-08_09-16-30.csv)*

pridaj tab konkurencia. a daj mi tam porovnania a grafy

### 🤖 Claude
Konkurenčný export (izlato.sk). Analyzujem štruktúru a veľkosť pred integráciou.

[tool_use: bash_tool]

[tool_result]

Konkurent: izlato.sk, 2627 organic KW (Máj→Jún, okno 22.5.→29.6.). Buildujem porovnávací dataset a počítam prekryv voči nášmu organickému footprintu.

[tool_use: bash_tool]

[tool_result]

Prekryv (JS bude overený): spoločných 643, len naše 443, len izlato 1984; H2H my lepšie 145 / horšie 460. izlato má 8× viac traffic. Buildujem view. Zapisujem CSS.

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

JS prekryv presne sedí s Python: spoločné 643, len naše 443, len izlato 1984; H2H my 145 / izlato 460 / rovnaké 38. Všetky režimy renderujú bez chýb.

[tool_use: present_files]

[tool_result]

Pridaný tab „Konkurencia" (izlato.sk, 2627 organic KW). V ľavom menu nová položka.

Porovnávacie KPI (sperky vs izlato, vedúci zvýraznený): Počet KW 1086 vs 2627, Organic traffic 9 722 vs 79 477 (8×), Volume 176 990 vs 562 800, Priem. pozícia (nižšie lepšie), SoV, Prekryv KW 643 (24 % z izlato / 59 % z nás).

Grafy (4):
- Prekryv KW — Spoločné 643 / Len sperky 443 / Len izlato 1984.
- Súboj na spoločných KW — sperky lepšie 145 / izlato lepšie 460 / rovnaké 38.
- Rozloženie pozícií — grouped bary my vs izlato po bucketoch.
- Organic traffic podľa tém — grouped bary my vs izlato po skupinách.

Tabuľka s režimami: Medzery (KW izlato mimo nášho portfólia — 1984 príležitostí), Zaostávame (spoločné, kde izlato ranká vyššie — 460), Prekonávame (kde vedieme — 145), Všetko. Filter témy + fulltext, sortovateľné hlavičky, klik na riadok → detail. Stĺpec „Naša poz." zelená = vedieme, červená = zaostávame, — = nerankáme.

Všetko reaguje na prepínač obdobia. Caveat: exportné okná sa mierne líšia (naše 6.5.→16.6., izlato 22.5.→29.6.) — uvedené v hlavičke tabu. Porovnanie je na základe exportovaných setov (Ahrefs export môže byť limitovaný).

