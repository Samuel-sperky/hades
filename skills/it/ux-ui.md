# UX + UI základy

> Praktická referencia použiteľnosti, informačnej architektúry, vizuálnej hierarchie, design tokenov, komponentov, prístupnosti (WCAG 2.2) a formulárov pre e-shop a web značky Aura.

## Prehľad — čo to je a prečo na tom Aure záleží

**UX (User Experience)** je celá skúsenosť človeka pri interakcii s produktom — od prvého dojmu na Instagrame cez nájdenie prsteňa až po doručenie a reklamáciu. **UI (User Interface)** je konkrétna vizuálna a interakčná vrstva (tlačidlá, typografia, farby, layout), cez ktorú sa tá skúsenosť odohráva. UI je časť UX, nie synonymum.

Pre Auru (šperky, e-commerce) to nie je kozmetika, ale priamo peniaze:

- **Konverzia stojí a padá na použiteľnosti.** Pri šperkoch je nákup emocionálny aj rizikový (cena, "sadne veľkosť?", "je to naozaj striebro?"). Každé trenie — nejasná cena, chýbajúca tabuľka veľkostí, mätúci košík — je dôvod odísť.
- **Dôvera cez detail.** Kvalitné, konzistentné UI podvedome signalizuje kvalitu produktu. Nedbalý web = lacný dojem = nižšia ochota zaplatiť prémiovú cenu.
- **Mobil je primárny.** Väčšina traffiku zo sociálnych sietí je mobilná. Ak nefunguje palcom na 375 px širokej obrazovke, nefunguje vôbec.
- **Prístupnosť = väčší trh + právna povinnosť.** Od **28. júna 2025** sa uplatňujú požiadavky European Accessibility Act (EAA) aj na služby elektronického obchodu v rozsahu transponovanom do národného práva. Konkrétnu povinnosť, výnimky a použitý harmonizovaný štandard vždy over podľa jurisdikcie; WCAG 2.2 AA používaj ako produktový cieľ, nie ako automatickú právnu skratku.

## Kľúčové pojmy — glosár

- **Heuristika** — praktické pravidlo/skratka pre hodnotenie použiteľnosti (nie prísny zákon). Napr. 10 heuristík NN/g.
- **Informačná architektúra (IA)** — ako je obsah organizovaný, pomenovaný a prepojený (navigácia, kategórie, filtre, štruktúra URL).
- **Vizuálna hierarchia** — poradie, v akom oko vníma prvky; riadené veľkosťou, kontrastom, farbou, priestorom (whitespace), pozíciou.
- **Design token** — pomenovaná premenná dizajnového rozhodnutia (`color.brand.primary`, `space.4`, `radius.md`). Jediný zdroj pravdy pre farby, medzery, typografiu naprieč Figmou aj kódom.
- **Primitívny vs. sémantický token** — primitív = surová hodnota (`--gray-900: #1a1a1a`); sémantický = význam viazaný na kontext (`--color-text-primary` → odkazuje na `--gray-900`). Sémantické tokeny umožnia dark mode a rebranding zmenou jednej vrstvy.
- **Komponent** — znovupoužiteľný stavebný blok UI (Button, Input, Card, Modal) s definovanými stavmi.
- **Stavy komponentu** — default, hover, focus, active, disabled, loading, error, empty. Chýbajúce stavy = najčastejšia diera v dizajne.
- **Design system** — tokeny + komponenty + vzory + pravidlá použitia dohromady (napr. Material 3, ale aj vlastný „Aura DS").
- **WCAG 2.2** — Web Content Accessibility Guidelines; úrovne A / AA / AAA. Cieľ pre komerčný web je **AA**. Od okt. 2025 aj ISO/IEC 40500:2025.
- **Kontrastný pomer** — pomer jasu textu k pozadiu; AA vyžaduje **4.5:1** pre bežný text, **3:1** pre veľký text (≥24 px, resp. ≥18.66 px bold) a pre UI komponenty/ikony.
- **Touch target** — klikateľná plocha; WCAG 2.2 min. **24×24 px** (SC 2.5.8), odporúčané **44×44 px** (iOS) / 48×48 px (Material).
- **Above the fold** — obsah viditeľný bez scrollovania; kritický pre prvý dojem a hlavný CTA.
- **CTA (Call To Action)** — hlavná akcia na stránke ("Pridať do košíka", "Kúpiť").
- **Affordance** — vizuálny signál, že prvok je interaktívny (tlačidlo vyzerá stlačiteľne).
- **Progressive disclosure** — postupné odhaľovanie zložitosti; ukáž len to podstatné, detaily na vyžiadanie.
- **Empty / error / loading state** — stav bez dát, stav chyby, stav načítania. Musia byť navrhnuté, nie iba „ono to niekedy nastane".
- **F-pattern / Z-pattern** — typické vzory skenovania textovej vs. vizuálnej stránky očami.

## Best practices 2025/2026 — aktuálny stav a čo sa nedávno zmenilo

### 10 heuristík použiteľnosti (Nielsen / NN/g) — stále platný základ

Framework z roku 1994, naposledy jazykovo prepracovaný (2020, revízie 2024/25), ale samotných 10 princípov sa nemení — to je jeho sila. Aplikované na Auru:

1. **Viditeľnosť stavu systému** — po „Pridať do košíka" okamžitá spätná väzba (mini-košík, počítadlo). Pri odosielaní objednávky loading stav, nie zamrznuté tlačidlo.
2. **Zhoda systému a reálneho sveta** — jazyk zákazníka, nie interný žargón. „Veľkosť prsteňa" nie „variant SKU".
3. **Kontrola a sloboda používateľa** — jednoduché odobratie z košíka, zrušiteľné kroky, jasné „späť".
4. **Konzistentnosť a štandardy** — košík vpravo hore, cena vždy rovnako formátovaná, tlačidlá rovnako vyzerajú všade.
5. **Prevencia chýb** — radšej zabráň chybe (disabled „Kúpiť" kým nie je zvolená veľkosť) než ukazuj chybu potom.
6. **Rozpoznanie namiesto spomínania** — nedávno prezerané, predvyplnené údaje, viditeľné filtre namiesto skrytých.
7. **Flexibilita a efektivita** — rýchle filtre a rýchly checkout pre skúsených, jednoduchosť pre nových.
8. **Estetický a minimalistický dizajn** — každý prvok navyše konkuruje CTA. Menej = jasnejšie.
9. **Pomoc pri rozpoznaní a zotavení z chýb** — chybové hlásenie jasnou rečou: čo sa stalo + ako to opraviť.
10. **Pomoc a dokumentácia** — dostupné FAQ, tabuľka veľkostí, starostlivosť o šperk, doprava/vrátenie.

### Prístupnosť: WCAG 2.2 je nová základná latka

WCAG 2.2 (okt. 2023, od okt. 2025 aj **ISO/IEC 40500:2025**) pridáva k 2.1 deväť nových kritérií. Kľúčové novinky, ktoré treba reálne riešiť:

- **2.5.8 Target Size (Minimum, AA):** klikateľné ciele min. **24×24 CSS px** (výnimky: inline odkazy v texte, ekvivalentná alternatíva). Pozor na malé „×" na zatvorenie a hustú filter navigáciu na mobile.
- **2.4.11 Focus Not Obscured (AA):** prvok s klávesovým focusom nesmie byť úplne zakrytý (sticky hlavička, cookie lišta, chat bublina často porušujú).
- **2.4.13 Focus Appearance (AAA):** prísnejšie kritérium pre veľkosť a kontrast focus indikátora. Na úrovni AA stále platia **2.4.7 Focus Visible** a **2.4.11 Focus Not Obscured (Minimum)**. Produktovo mier na viditeľný indikátor aspoň 2 px a kontrast 3:1. **Nikdy `outline: none` bez náhrady.**
- **3.3.7 Redundant Entry (A):** nepýtaj tú istú informáciu dvakrát (predvyplň/ponúkni „fakturačná = dodacia").
- **3.3.8 Accessible Authentication (AA):** neblokuj vkladanie hesla, povoľ password managery, žiadne „prepíš skreslené znaky" ako jediný spôsob (CAPTCHA založená na kognitívnom teste je problém).
- Odstránené: **4.1.1 Parsing** (obsolete) — validita HTML sa už nehodnotí ako samostatné kritérium.

Ostávajú základy: kontrast **4.5:1**, alt texty produktových fotiek, ovládateľnosť klávesnicou, `label` pri každom `input`, správne nadpisy `h1`→`h6`, jazyk stránky `lang="sk"`.

Pozn.: **WCAG 3.0** je stále len working draft — pre praktické rozhodovanie sa riaď 2.2 AA.

### Design tokens: prvá stabilná W3C špecifikácia (2025)

**28. okt. 2025** vyšla prvá stabilná verzia **DTCG (Design Tokens Community Group) formátu 2025.10** — vendor-neutrálny JSON formát pre tokeny, ktorý čítajú Figma, Tokens Studio, Style Dictionary, Penpot, Framer, Supernova. Prakticky:

- **Autoruj tokeny v DTCG formáte** (`$value`, `$type`, `$description`) — je to jediné rozhodnutie, ktoré ťa zamkne na roky, tak nech je prenositeľné.
- **Trojvrstvový model:**
  1. **Primitívy** (raw): `--gray-900`, `--gold-500`, `--space-4: 16px`.
  2. **Sémantické** (alias na primitív): `--color-text-primary`, `--color-surface`, `--color-border`, `--color-brand`, `--color-danger`.
  3. **Komponentové** (voliteľné): `--button-bg`, `--input-border`.
- **Dark mode a brand varianty = len iné aliasy na tie isté primitívy.** Komponenty používajú výhradne sémantické tokeny, nikdy raw hodnoty.
- Podpora **moderných farebných priestorov (OKLCH)** — rovnomernejšia percepčná svetlosť, lepšie generovanie odtieňov palety než HSL.

### Vizuálny trend 2025/2026

- **OKLCH farby** namiesto HEX/HSL pre systematické palety a predvídateľný kontrast.
- **Fluidná typografia a spacing** cez `clamp()` — plynulé škálovanie bez desiatok breakpointov.
- **Container queries** — komponent sa prispôsobuje šírke svojho kontajnera, nie celého okna (ideálne pre produktové karty v rôznych gridoch).
- **Dark mode ako štandard**, nie bonus — rieš od začiatku cez sémantické tokeny.
- **Motion s rešpektom** — jemné mikrointerakcie, ale povinne rešpektuj `prefers-reduced-motion`.
- **Menej „AI-generated" genericity** — pri prémiovom šperku vyhráva editoriálna, fotograficky vedená estetika a whitespace, nie preplnený „template" vzhľad.

### Formuláre a chybové stavy (najnovšie dáta)

- **Inline validácia funguje, ale načasovanie rozhoduje.** Baymard: validuj **až po opustení poľa (on blur)**, nie počas písania; chybu **odstráň hneď po oprave**; pridaj **pozitívnu validáciu** („✓ v poriadku"). Inline validácia znižuje chyby o ~22 % a zrýchľuje vyplnenie o ~42 %.
- **Chybové hlásenie = čo sa stalo + ako opraviť + pri ktorom poli.** Nie „Neplatný vstup", ale „Zadaj e-mail vo formáte meno@domena.sk". Nikdy nie päť polí s rovnakým „Toto pole je povinné" bez identifikácie.
- **Jeden stĺpec.** Viacstĺpcové checkout formuláre spôsobujú chyby v poradí polí — Baymard to opakovane potvrdzuje.
- **Redukuj polia na minimum**, guest checkout, správne `autocomplete` atribúty a mobilné klávesnice (`inputmode="numeric"`, `type="email"`).

## Krok za krokom — pracovný postup návrhu obrazovky

1. **Definuj cieľ a používateľa.** Jedna obrazovka = jeden hlavný cieľ (napr. „presvedčiť a pridať prsteň do košíka"). Kto prichádza a s akým zámerom?
2. **IA a obsah najskôr.** Vypíš, aké informácie zákazník potrebuje (foto, cena, materiál, veľkosti, doprava, vrátenie). Zoraď podľa dôležitosti pre rozhodnutie o kúpe.
3. **Nízkoverný wireframe.** Rozlož bloky a hierarchiu bez farieb. Over, že hlavné CTA je vizuálne dominantné a „above the fold" na mobile.
4. **Aplikuj tokeny.** Použi existujúce sémantické tokeny (farby, spacing 4/8 px grid, type scale). Nevymýšľaj ad-hoc hodnoty.
5. **Poskladaj z komponentov.** Použi existujúce (Button, Input, Card). Ak treba nový, navrhni **všetky stavy** (default/hover/focus/active/disabled/loading/error/empty).
6. **Navrhni okrajové stavy.** Prázdny košík, výpadok skladu, chyba platby, pomalé pripojenie (loading skeletony).
7. **Skontroluj prístupnosť.** Kontrast, focus, touch targety, labely, poradie tabulátorom, alt texty (viď checklist).
8. **Prototypuj a testuj.** Klikateľný prototyp v Figme. **Test s 5 ľuďmi odhalí ~85 % problémov** — sleduj kde váhajú, nie čo hovoria.
9. **Odovzdaj do kódu cez tokeny.** Vývoj používa tie isté tokeny (CSS custom properties / Tailwind theme) — parita dizajnu a kódu.
10. **Meraj a iteruj.** Po nasadení sleduj konverziu, drop-off v košíku, heatmapy. Uprav na základe dát, nie dojmu.

## Checklist — pred nasadením obrazovky

**Hierarchia a layout**
- [ ] Jeden jasný hlavný cieľ a jedno dominantné CTA.
- [ ] Hlavný CTA viditeľný bez scrollu na mobile (375 px).
- [ ] Konzistentný spacing (4/8 px grid), dostatočný whitespace.
- [ ] Typografická škála (max 2–3 veľkosti nadpisov), riadkovanie ~1.5 pre text.

**Konzistentnosť**
- [ ] Farby, tlačidlá, ikony len z tokenov / komponentov (žiadne one-off hodnoty).
- [ ] Rovnaké prvky vyzerajú a správajú sa rovnako naprieč webom.

**Prístupnosť (WCAG 2.2 AA)**
- [ ] Kontrast textu ≥ 4.5:1 (veľký text a UI prvky ≥ 3:1).
- [ ] Každý interaktívny prvok ovládateľný klávesnicou; viditeľný focus (žiadne `outline:none` bez náhrady).
- [ ] Touch targety ≥ 24×24 px (ideálne 44×44), s dostatočným rozostupom.
- [ ] Focus nie je zakrytý sticky hlavičkou / cookie lištou / chatom.
- [ ] Každý `input` má `<label>`; obrázky majú zmysluplný `alt`.
- [ ] Logická štruktúra nadpisov `h1`→`h6`; `lang="sk"`.
- [ ] `prefers-reduced-motion` rešpektovaný.

**Formuláre**
- [ ] Jeden stĺpec, minimum polí, guest checkout.
- [ ] Validácia on-blur, chyba mizne po oprave, pozitívna validácia.
- [ ] Chyby: čo + ako opraviť + pri konkrétnom poli.
- [ ] Správne `autocomplete`, `inputmode`, `type`.

**Stavy**
- [ ] Loading, empty, error stavy navrhnuté (nie len „šťastná cesta").
- [ ] Disabled CTA kým nie sú splnené podmienky (napr. zvolená veľkosť).

**Mobil / výkon**
- [ ] Otestované na reálnom mobile (nie len desktop náhľad Figmy).
- [ ] Obrázky optimalizované (AVIF/WebP, `srcset`), nezhoršujú LCP.

## Časté chyby — a ako sa im vyhnúť

- **Nízky kontrast „kvôli estetike"** (sivý text na bielej, zlatý na svetlom). → Over kontrast tool-om ešte v Figme; drž 4.5:1.
- **`outline: none` na focus** bez náhrady. → Ponechaj/nahraď viditeľný focus ring (WCAG 2.4.13).
- **Chýbajúce stavy komponentov** (len default). → Vždy navrhni hover/focus/disabled/loading/error/empty.
- **Ad-hoc farby a medzery** mimo systému. → Všetko cez tokeny; audit „magic numbers".
- **Slabé/skryté CTA**, alebo viacero rovnako silných CTA súperiacich o pozornosť. → Jedno primárne CTA, ostatné sekundárne (outline/text).
- **Validácia počas písania** (chyba blikne kým človek ešte píše). → Validuj on-blur, chybu odstráň po oprave.
- **Generické chyby** („Neplatný vstup"). → Konkrétne, akčné, pri správnom poli.
- **Priveľa polí vo formulári** / povinná registrácia pred nákupom. → Minimalizuj, ponúkni guest checkout.
- **Dizajn len na desktope**, mobil ako dodatok. → Mobile-first; testuj palcom na 375 px.
- **Karusel / hero slider ako nosič dôležitého obsahu.** → Ľudia ich ignorujú a preklikajú; dôležité daj staticky.
- **Ikony bez textového labelu** tam, kde význam nie je univerzálny (napr. hamburger je OK, ale nezvyklé ikony nie). → Pridaj textový popis alebo `aria-label`.
- **Nekonzistentný dark mode** dorobený narýchlo. → Rieš cez sémantické tokeny od začiatku.
- **Testovanie „na sebe"** namiesto na reálnych ľuďoch. → 5 používateľov, sleduj správanie, nie názory.

## Nástroje

- **Figma** — návrh UI, prototypy, komponenty, variables (design tokens); Dev Mode pre handoff.
- **Tokens Studio (pre Figma)** + **Style Dictionary / Terrazzo** — správa a export DTCG tokenov do CSS/Tailwind/iOS/Android.
- **Kontrast a a11y:** Stark (Figma plugin), WebAIM Contrast Checker, axe DevTools, WAVE, Lighthouse (a11y + performance audit v Chrome).
- **Klávesnicový/čítačkový test:** VoiceOver (macOS/iOS), NVDA (Windows) — otestuj reálne prechádzanie.
- **Výskum a testovanie:** Maze / Useberry (unmoderované testy prototypov), Hotjar / Microsoft Clarity (heatmapy, session recordings — zdarma).
- **OKLCH farby:** oklch.com, Huetone, Leonardo (Adobe) — generovanie prístupných palet.
- **Referencie/inšpirácia:** NN/g články, Baymard (e-commerce UX benchmark), Material Design 3, Apple HIG, laws of UX (lawsofux.com).
- **AI-asistenti:** vhodné na prvý draft copy/variantov, ale finálnu vizuálnu a a11y kontrolu rob ručne.

## Zdroje

- [10 Usability Heuristics for User Interface Design — NN/g](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [How to Conduct a Heuristic Evaluation — NN/g](https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/)
- [What's New in WCAG 2.2 — W3C WAI](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
- [Web Content Accessibility Guidelines (WCAG) 2.2 — W3C](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2 Updates and Code Examples — Deque University](https://dequeuniversity.com/resources/wcag-2.2/)
- [New Success Criteria in WCAG 2.2 — Vispero](https://vispero.com/resources/new-success-criteria-in-wcag22/)
- [Design Tokens Specification reaches first stable version (2025.10) — W3C DTCG](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [Design Tokens Format Module 2025.10 — DTCG](https://www.designtokens.org/tr/2025.10/format/)
- [DTCG design tokens: a practical guide — Taste Profile](https://tasteprofile.io/blog/w3c-dtcg-design-tokens-practical-guide)
- [Style Dictionary — DTCG support](https://styledictionary.com/info/dtcg/)
- [Usability Testing of Inline Form Validation — Baymard Institute](https://baymard.com/blog/inline-form-validation)
- [Form Error Message Examples and Best Practices — Ivy Forms](https://ivyforms.com/blog/form-error-message-examples/)
