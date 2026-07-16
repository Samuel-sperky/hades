# Brand + grafika

> Referenčný playbook pre vizuálnu identitu značky Aura: logo systém, farby a typografia, produkcia pre web aj tlač, sociálne/reklamné formáty a bezpečné použitie AI vizuálov.

## Prehľad — čo to je a prečo to pre Auru je dôležité

Brand grafika je súbor pravidiel a assetov, ktoré robia značku Aura rozpoznateľnou naprieč všetkými dotykovými bodmi — e-shop, Instagram, Facebook/Meta reklamy, obalový materiál na šperky, faktúry, packaging. Pri šperkárskej značke je vizuálna konzistencia obchodný nástroj: kupujúci nakupuje **pocit luxusu a dôvery** ešte skôr, než vidí produkt naživo. Nekonzistentné logo, rozhádzané farby alebo rozpixelovaná fotka na obale znižujú vnímanú hodnotu produktu — a teda aj cenu, ktorú si môžeš vypýtať.

Praktický dopad na jednočlennú prevádzku (marketing + dev + dizajn v jednej osobe):

- **Rýchlosť** — s hotovým systémom (design tokens, šablóny, presety exportov) vyrobíš príspevok alebo reklamu za minúty, nie hodiny.
- **Náklady** — jasné pravidlá RGB vs CMYK a bleed ti ušetria zbytočné reklamácie u tlačiara.
- **Právna bezpečnosť** — pri AI vizuáloch rozhoduje, ktorý nástroj a licenciu použiješ, či ťa niekto môže žalovať za výstup, ktorý predávaš.

Kľúčové rozdelenie, ktoré sa ťahá celým dokumentom: **iná príprava pre obrazovku (RGB, px, sRGB/P3, 72–screen DPI je mýtus) a iná pre tlač (CMYK/Pantone, mm, 300 DPI, bleed).**

## Kľúčové pojmy — glosár

**Logo systém** — nie jedno logo, ale sada variantov: primárne (full), sekundárne (horizontálne/vertikálne), **logomark/ikona** (samotný symbol pre avatar, favicon, razenie na šperku), a **monochromatická** verzia (čierna/biela pre razbu, gravírovanie, jednofarebnú tlač).

**Responsive / adaptívne logo** — logo, ktoré sa zjednodušuje podľa veľkosti: plná verzia na webe → skrátená → len ikona pre favicon 16×16 px. Nie iná značka, len iná úroveň detailu.

**Clear space (ochranná zóna)** — minimálny prázdny priestor okolo loga, do ktorého nesmie zasahovať iný prvok. Definuje sa relatívne (napr. „výška písmena A z loga").

**Design tokens** — pomenované premenné dizajnu (farby, typo, spacing) uložené v JSON/CSS, ktoré zdieľajú web, appka aj grafické šablóny. Od okt. 2025 existuje stabilný W3C štandard (Design Tokens Community Group, verzia 2025.10) s troma vrstvami: *primitive* (surová hodnota) → *semantic* (účel, napr. `color-text-primary`) → *component*.

**RGB** — aditívny farebný model pre obrazovky (červená/zelená/modrá). Priestory: **sRGB** (bezpečný default pre web), **Display P3** (širší gamut pre moderné displeje).

**CMYK** — subtraktívny model pre tlač (cyan/magenta/yellow/black). Menší gamut než RGB — sýte žiarivé farby z obrazovky sa vytlačiť nedajú.

**Pantone / PMS (spot color)** — vopred namiešaná ink farba s presným kódom (napr. `Pantone 871 C` = zlatá metalíza). Pre packaging šperkov nenahraditeľné — zabezpečí, že „zlatá Aura" je vždy rovnaká, čo cez CMYK nedosiahneš. Coated (C) = lesklý/natieraný papier, Uncoated (U) = matný.

**DPI / PPI** — hustota bodov. Pre tlač **300 DPI v reálnej veľkosti** (napr. vizitka 90×50 mm = ~1063×591 px). „72 DPI pre web" je zastaraný mýtus — pre obrazovku rozhodujú **pixely a device pixel ratio**, nie DPI.

**Bleed (spadávka)** — presah grafiky za líniu orezu (typicky **3 mm**, u niektorých tlačiarov 3–5 mm), aby po oreze nevznikli biele okraje. K tomu **safe zone** — dôležitý obsah min. 3–5 mm od orezu dovnútra.

**Trim / crop marks (orezové značky)** a **dieline** — čiara, kde sa reže / výsek (napr. tvar krabičky na prsteň). Dieline ide vo vlastnej spot vrstve, netlačí sa.

**Vektor vs raster** — vektor (SVG, AI, EPS, PDF) je matematický, škáluje donekonečna → logá, ikony. Raster (JPG, PNG, WebP, TIFF) je mriežka pixelov → fotky.

**OKLCH** — moderný farebný priestor (CSS Color 4) s *percepčnou* svetlosťou: farby s rovnakým L vyzerajú rovnako jasné pre oko, čo uľahčuje tvorbu prístupných paliet a WCAG kontrastu. W3C token spec ho odporúča ako default.

**WCAG kontrast** — pomer jasu textu a pozadia. AA: **4.5:1** bežný text, **3:1** veľký text (≥24 px, alebo ≥18.66 px bold).

**Indemnifikácia (IP indemnity)** — záväzok poskytovateľa AI, že ťa právne obháji, ak niekto tvrdí, že AI výstup porušuje jeho práva. Rozhodujúce pri komerčnom predaji.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Logo a identita
- **Digital-first, SVG ako master.** Logo sa navrhuje ako čistý SVG (optimalizované cesty, odstránená metadata, sploštené skupiny). Z neho sa generujú všetky rastrové exporty. Static logo nestačí — štandardom je **sada responsive variantov**.
- **Minimalizmus 2.0 + negatívny priestor.** Trend 2025/26 je jednoduchosť kvôli škálovateľnosti na malé plochy (favicon, razba na šperku). Detailné logo je pre šperkársku značku prakticky nepoužiteľné pri gravírovaní.
- **Čo je nové:** dynamické/animované logá pre digitál a video, „variable logo fonts" (šírka/váha písma loga reaguje na kontext). Pre malú značku je to nice-to-have, nie nutnosť — priorita je pevný statický systém + jednoduchá animovaná verzia na Reels/intro.
- Vždy testuj logo v **monochróme a v najmenšej veľkosti** ešte pred finalizáciou.

### Farby a typografia
- **Tri-vrstvové design tokens** (primitive → semantic → component) sú od stabilizácie W3C spec (okt. 2025) mainstream aj pre malé projekty. Prínos: zmeníš značkovú farbu na jednom mieste a premietne sa na web aj do šablón.
- **OKLCH** nahrádza HEX/HSL pri návrhu paliet — ľahšie generuješ konzistentné odtiene (lightness ramp) a držíš WCAG. Do CSS píšeš `oklch(...)`, s HEX fallbackom pre staršie prehliadače. Zvažuj **Display P3** pre sýtejšie akcenty na moderných displejoch, so sRGB fallbackom.
- **Kontrast je povinný, nie kozmetický:** AA 4.5:1 (text), 3:1 (veľký text / UI prvky). Over každý pár farieb (napr. zlatý text na krémovej je klasická pasca — často pod 4.5:1).
- **Typografia:** body ≥ 16 px pre web, semantic type tokens (`text-heading-l`, `text-body`) + responsive škálovanie cez `clamp()`. Variabilné fonty šetria váhu (jeden súbor namiesto 6 rezov). Licencie fontov si over pre web (WOFF2 embedding) **aj** pre tlač/logo — nie každý free font povoľuje komerčné použitie.

### Produkcia (web vs tlač)
- **Web:** exportuj v **WebP** (o 25–35 % menší než JPEG, podpora ~95 % prehliadačov) s JPEG/PNG fallbackom. **AVIF** je ešte menší (~50 %), podpora ~80 % — používaj cez `<picture>` s fallbackom, ale **nie pre OG obrázky** (siete ho zatiaľ nečítajú). Fotky serviruj v ~2× renderovanej veľkosti (retina), `srcset` + lazy loading.
- **OG/social share obrázok: 1200×630 px (1.91:1), formát PNG alebo JPG.** WebP je od konca 2024 tolerovaný, ale bezpečný default zostáva PNG/JPG. SVG/AVIF/GIF pre OG nepoužívaj.
- **Favicon:** SVG favicon + PNG fallback (32×32, 180×180 apple-touch). ICO je prežitok.
- **Tlač:** vždy **CMYK** dokument (alebo CMYK + Pantone pre značkové farby a metalízu/fóliu), **300 DPI v reálnej veľkosti**, **3 mm bleed**, orezové značky, **všetky fonty prevedené do kriviek (outlines)**. Export **PDF/X-1a** (alebo PDF/X-4 ak treba priehľadnosti a spot vrstvy) — je to najbezpečnejší štandard pre tlačiara; alternatívy AI/EPS.
- **Packaging šperkov:** definuj značkovú farbu ako **Pantone spot** (napr. zlatá/champagne), nie ako CMYK simuláciu — dôvod je konzistencia naprieč dodávkami obalov. Metalické a fóliové efekty (hot foil) rieš spot vrstvou + dieline. Vždy vyžaduj **fyzický proof** pred veľkým nákladom.

### AI vizuály — licencie (stav 2025/2026, dôležité)
- **Adobe Firefly = najbezpečnejšia voľba pre komerčný predaj.** Trénovaný len na licencovanom Adobe Stock, public domain a otvorene licencovanom obsahu. Platené Creative Cloud plány zahŕňajú **IP indemnifikáciu** (Adobe ťa právne obháji, typicky s limitom cca $10 000 na výstup/nárok). Vlastníš výstup.
- **Midjourney** (ToS účinné jún 2025) — vlastníš výstupy, ale **žiadna IP indemnifikácia** a explicitne sa zbavuje zodpovednosti za nároky tretích strán. Prebiehajú súdne spory. Pre vizuály, ktoré priamo predávaš/tlačíš na produkt, je to riziko.
- **DALL·E / OpenAI** — vlastníš výstupy, komerčné použitie povolené; **indemnifikácia len pre Business/API** zákazníkov, nie pre bežný Plus/Pro.
- **Praktické pravidlo pre Auru:** AI generuj pre inšpiráciu, mood, pozadia a marketingové vizuály; pre čokoľvek, čo predávaš ako produkt alebo tlačíš na obal, uprednostni **Firefly** (indemnifikácia) alebo vlastnú fotografiu/dizajn. **Nikdy** negeneruj „v štýle žijúceho autora" ani rozpoznateľné chránené prvky. Uchovávaj si prompt + nástroj + dátum ku každému komerčnému AI assetu (audit trail). Autorské právo na čisto AI výstup je v mnohých jurisdikciách slabé/žiadne — nemôžeš ho spoľahlivo brániť pred kopírovaním.

## Krok za krokom — pracovný postup

**Fáza A — Založenie systému (raz)**
1. **Logo master v SVG** + odvodené varianty: primárne, horizontálne, ikona, monochróm (čierna/biela). Optimalizuj SVG (SVGO), definuj clear space a min. veľkosti.
2. **Farebná paleta v OKLCH** → 1–2 primárne, 1 akcent, neutrály (ramp svetlostí), stavové farby. Prever WCAG páry. Ulož ako **design tokens** (JSON/CSS: primitive → semantic).
3. **Pre tlač** priraď každej značkovej farbe **CMYK hodnotu aj Pantone kód** (coated + uncoated). Metalízu rieš len ako Pantone.
4. **Typo systém** — heading + body font (radšej variabilné), škála cez `clamp()`, semantic type tokens. Over licencie (web + tlač).
5. **Šablóny a presety exportov** — v nástroji (Figma/Canva) založ master šablóny pre bežné formáty (viď Checklist) a export presety (WebP web, PNG OG, PDF/X-1a tlač).

**Fáza B — Výroba jednotlivého assetu**
6. Urči **cieľ a médium** → web/social (RGB, px) alebo tlač (CMYK/Pantone, mm). Toto rozhodne celý zvyšok.
7. Vyber správny **formát a rozmer** zo šablón. Použi tokens (farby/typo), neťukaj HEX ručne.
8. Ak potrebuješ AI vizuál → vyber nástroj podľa použitia (predaj/obal = Firefly), vygeneruj, ulož prompt+nástroj+dátum.
9. **Export:**
   - Web: WebP (+ JPG/PNG fallback), ~2× retina, `srcset`, lazy load; OG = 1200×630 PNG/JPG.
   - Tlač: CMYK/Pantone, 300 DPI, 3 mm bleed, orezové značky, fonty do kriviek, PDF/X-1a.
10. **Kontrola** cez Checklist → pri tlači vyžiadaj proof pred nákladom.

## Checklist

**Logo / identita**
- [ ] Existuje: primárne, horizontálne, ikona, monochróm (čb) — všetky ako SVG
- [ ] Definovaný clear space a minimálna veľkosť; test na faviconu 16×16 a na razbu
- [ ] Farby uložené ako design tokens (OKLCH + HEX fallback)
- [ ] Každá značková farba má CMYK **aj** Pantone (C aj U); metalíza = Pantone spot
- [ ] Všetky farebné páry prejdú WCAG AA (4.5:1 / 3:1)
- [ ] Fonty licencované pre web aj tlač

**Web / social export**
- [ ] Správny farebný priestor: sRGB (default) / P3 s fallbackom
- [ ] WebP + JPG/PNG fallback, ~2× retina, `srcset`, lazy loading
- [ ] OG obrázok 1200×630 px, PNG/JPG, dôležitý obsah v strede
- [ ] Favicon SVG + PNG (32, 180)

**Tlač / packaging**
- [ ] Dokument v CMYK (+ Pantone pre značkové/metalické farby)
- [ ] 300 DPI v reálnej veľkosti
- [ ] 3 mm bleed + orezové značky, obsah v safe zone (3–5 mm)
- [ ] Fonty prevedené do kriviek
- [ ] Dieline v samostatnej spot vrstve (netlačiteľná)
- [ ] Export PDF/X-1a (alebo PDF/X-4)
- [ ] Vyžiadaný fyzický proof pred veľkým nákladom

**AI vizuály**
- [ ] Nástroj zvolený podľa rizika (predaj/obal → Firefly kvôli indemnifikácii)
- [ ] Uložený prompt + nástroj + dátum
- [ ] Žiadne chránené prvky ani „v štýle žijúceho autora"

## Časté chyby — a ako sa im vyhnúť

- **Odovzdanie RGB súboru do tlače** → farby sa posunú (najmä sýte modré/zelené). Vždy konvertuj na CMYK/Pantone pred exportom a kontroluj proof.
- **Spoliehanie na CMYK simuláciu zlatej/metalickej** → matný sivastý výsledok. Metalíza = **Pantone spot / hot foil**, nikdy CMYK.
- **Chýbajúci bleed** → biele prúžky po oreze. Vždy 3 mm presah + safe zone.
- **Nízke rozlíšenie** → rozpixelovaný obal. 300 DPI **v reálnej veľkosti**, nie „stiahnem z webu 800 px".
- **Fonty neprevedené do kriviek** → tlačiar nemá font, text sa preleje. Outline pred PDF exportom.
- **Detailné logo bez ikony** → nečitateľné na faviconu a razbe. Vytvor zjednodušený logomark hneď na začiatku.
- **Ručné zadávanie HEX namiesto tokenov** → farby sa rozídu naprieč webom a šablónami. Používaj tokens.
- **Zlatý/svetlý text na svetlom pozadí** → prepad pod WCAG 4.5:1. Testuj kontrast, nie „vyzerá to pekne".
- **AI výstup z Midjourney na produkt/obal** → nulová indemnifikácia, právne riziko. Na predávané/tlačené assety použi Firefly alebo vlastný dizajn.
- **AVIF alebo SVG ako OG obrázok** → náhľad na FB/LinkedIn sa nezobrazí. OG = PNG/JPG 1200×630.
- **Jeden export pre všetko** → buď je pre web zbytočne veľký, alebo pre tlač nekvalitný. Rozdeľ pipeline web vs tlač.

## Nástroje

- **Figma** — primárny nástroj pre logo systém, UI, design tokens (pluginy Tokens Studio), export SVG/PNG/WebP. Ideálny pre digital-first workflow a šablóny.
- **Adobe Illustrator** — vektor pre logo/print master, PDF/X export, spot/Pantone farby, dieline. Štandard pre tlačiara.
- **Adobe Photoshop / Lightroom** — retuš produktových fotiek šperkov, CMYK príprava rastrov.
- **Adobe Firefly** — IP-safe AI generovanie s indemnifikáciou pre komerčné použitie (predaj, obaly).
- **Canva** — rýchle sociálne šablóny a bežná grafika keď netreba plný Adobe; pozor na licencie stock prvkov.
- **Coolors / Leonardo (color)** a natívne OKLCH nástroje — tvorba a kontrola paliet.
- **WebAIM Contrast Checker / oklch.com** — overenie WCAG kontrastu.
- **Squoosh / SVGO** — optimalizácia rastrov (WebP/AVIF) a SVG.
- **Pantone Formula Guide (Coated + Uncoated)** — **fyzická** vzorkovnica; farbu nikdy nevyberaj podľa obrazovky.
- **RealFaviconGenerator** — kompletná sada faviconov (SVG + PNG + manifest).

## Zdroje

- [Responsive Logo Design: 2026 Mobile-First Strategy Guide — Inkbot Design](https://inkbotdesign.com/responsive-logo-design/)
- [Logo Design Best Practices for 2025 — No Boring Design](https://www.noboringdesign.com/blog/logo-design-best-practices-trends-challenges)
- [The Ultimate Guide to Brand Identity in 2025 — Avintiv Media](https://avintivmedia.com/blog/brand-identity-guide-2025/)
- [Design Tokens Specification reaches first stable version (2025.10) — W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Color contrast with OKLCH — Valentyn Yakymenko (Medium)](https://medium.com/@vyakymenko/color-contrast-with-oklch-prefers-reduced-motion-and-motion-design-ethics-089c0c8897d0)
- [Designing a scalable and accessible color system — UX Collective](https://uxdesign.cc/designing-a-scalable-and-accessible-color-system-for-your-design-system-f98207eda166)
- [CMYK vs RGB: How to Prepare Packaging Box Files for Printing — Gentlever](https://gentlever.com/cmyk-vs-rgb/)
- [Pantone vs. CMYK for Custom Branded Packaging — EcoEnclose](https://www.ecoenclose.com/blog/pantone-vs-cmyk-for-custom-branded-packaging)
- [Best File Formats for Printing: PDF, TIFF, EPS Guide — Replica Printing](https://replicaprinting.com/2026/05/how-to-choose-the-best-file-format-for-professional-printing-6-step-guide/)
- [How to Prepare Artwork Files for Printing — ePack Factory](https://epackfactory.com/how-to-prepare-artwork-files-for-printing/)
- [Social media image sizes for all networks [July 2026] — Hootsuite](https://blog.hootsuite.com/social-media-image-sizes-guide/)
- [Facebook & Instagram Post Size, Ad Specs (2026) — soona](https://soona.co/image-resizer/meta-image-size-specs)
- [Meta Ad Sizes 2026: Every Placement Spec + Safe Zones — Ryze](https://www.get-ryze.ai/blog/facebook-ad-sizes-complete-specs-guide-for-2026)
- [Can You Sell Adobe Firefly Images? Commercial Rights & IP Safety (2026) — Terms.law](https://terms.law/forum/thread/adobe-firefly-commercial-rights-2026.html)
- [AI Art Commercial Use Comparison 2026: Midjourney vs DALL-E vs Firefly — Terms.law](https://terms.law/Demand-Letters/Guides/ai-tools-commercial-rights-comparison.html)
- [The Complete Guide to AI Commercial Use in 2026 — LicenseOrg](https://www.licenseorg.com/blog/ai-commercial-use-guide-2026)
- [Open Graph images: Format compatibility across platforms — Darek Kay](https://darekkay.com/blog/open-graph-image-formats/)
- [2025 Guide: Optimal Website Image Sizes and Formats — Digidop](https://www.digidop.com/blog/website-image-sizes-formats-to-respect)
