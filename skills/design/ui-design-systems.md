# UI dizajn + design systems

> Praktický referenčný playbook pre budovanie vizuálne konzistentného, škálovateľného a prístupného dizajn systému pre značku Aura — od farieb (OKLCH) cez typografiu a spacing až po design tokeny, komponenty a Figma → kód workflow.

## Prehľad — čo to je a prečo na tom Aure záleží

**UI dizajn** je remeslo tvorby vizuálneho rozhrania: rozhodnutia o hierarchii, farbe, type, priestore a stavoch prvkov. **Design system** je jednotný, verzovaný zdroj pravdy pre tieto rozhodnutia — tokeny (farby, spacing, typo), komponenty (tlačidlá, karty, formuláre) a pravidlá ich používania — zdieľaný medzi Figmou a kódom.

Pre Auru (šperky) to má tri konkrétne dopady:

1. **Konzistencia = dôvera = konverzia.** Šperky sú prémiový, vizuálne citlivý produkt. Nekonzistentné tlačidlá, náhodné odtiene zlatej alebo „skoro rovnaké" medzery pôsobia lacno a podkopávajú vnímanú hodnotu. Jednotný systém drží celý e‑shop, newslettery a landing pages na jednej vizuálnej úrovni.
2. **Rýchlosť.** Keď robíš marketing, vývoj aj dizajn sám, systém je pákový efekt: raz definuješ token `--accent`, a zmena odtieňa zlatej sa premietne všade — web, bannery, produktové karty — bez manuálneho preklikávania.
3. **Škálovateľnosť naprieč médiami.** Ten istý token systém napája web (CSS custom properties / Tailwind), Figma dizajny (Variables) aj produktové fotky / bannery. Menej duplicity, menej driftu.

Cieľom nie je „pekný" jednorazový dizajn, ale **systém, ktorý produkuje pekný dizajn opakovane a lacno**.

## Kľúčové pojmy — glosár

- **Vizuálna hierarchia** — poradie, v akom oko číta obrazovku. Riadi sa veľkosťou, váhou, farbou/kontrastom, priestorom a pozíciou. Primárna akcia (napr. „Pridať do košíka") musí byť vizuálne dominantná.
- **60‑30‑10** — pravidlo pomeru farieb v kompozícii: 60 % dominantná/neutrálna (pozadia, plochy), 30 % sekundárna (podporné plochy, text), 10 % akcent (CTA, dôraz). Zabraňuje „farebnému chaosu".
- **OKLCH** — moderný CSS farebný priestor: `oklch(L C H)` = **L**ightness (0–1 alebo %), **C**hroma (sýtosť, 0–~0.4), **H**ue (odtieň 0–360°). Perceptuálne rovnomerný — rovnaká L = rovnaká vnímaná jasnosť naprieč odtieňmi. Ideálny na generovanie škál a zaručenie kontrastu.
- **Design token** — pomenovaná, znovupoužiteľná dizajn hodnota (`color.accent`, `space.4`, `font.size.lg`). Najmenšia jednotka dizajn systému.
- **Primitive / semantic / component tokeny** — trojvrstvová architektúra: *primitívne* (surové hodnoty, napr. `gold-500 = oklch(0.72 0.13 85)`), *sémantické* (účel, napr. `text-primary`, `surface-elevated`, `accent`), *komponentové* (napr. `button-bg`). Komponenty referencujú len sémantické tokeny. Light/dark = prepnutie mapy sémantický → primitívny; komponenty sa nemenia.
- **DTCG** — *Design Tokens Community Group* formát (W3C). Vendor‑neutrálny JSON, kde má každý token `$value` a `$type`. Prvá stabilná verzia **2025.10** (október 2025). Číta ho Style Dictionary, Tokens Studio, Penpot, Sketch, Framer atď.
- **Modulárna škála (type ramp)** — sada veľkostí písma odvodená z pomeru (napr. 1.200 Minor Third, 1.250 Major Third, 1.333 Perfect Fourth). Dáva typografii rytmus.
- **8px grid (8pt grid)** — všetky rozmery a medzery sú násobky 8 (s 4px sub‑gridom pre jemné vnútorné odsadenia). Zjednodušuje konzistenciu a odovzdanie do kódu.
- **Baseline / vertikálny rytmus** — line‑height držaný v násobkoch gridu (napr. 24px), aby text „sadal" na grid, aj keď font‑size striktne násobkom nie je.
- **Spacing scale** — pomenovaná stupnica medzier (`space-1 = 4px`, `space-2 = 8px`, `space-3 = 12px`, `space-4 = 16px` …).
- **Komponentová knižnica** — sada opakovane použiteľných UI prvkov s definovanými variantmi a stavmi (default, hover, focus, active, disabled, loading, error).
- **Figma Variables** — natívne premenné vo Figme (color, number, string, boolean) s **modes** (napr. Light/Dark, jazyk, brand). Náhrada za staré „Styles" pre tokeny.
- **APCA** — *Accessible Perceptual Contrast Algorithm*, kandidát pre WCAG 3. Perceptuálne presnejší najmä pri dark mode. Zatiaľ **nie je** právny štandard.
- **WCAG 2.2** — aktuálne záväzný štandard kontrastu (4.5:1 normálny text, 3:1 veľký text a UI komponenty). Základ právnej zhody (EAA v EÚ od 2025).
- **P3 / wide gamut** — širší farebný rozsah moderných displejov; OKLCH umožňuje sýtejšie farby mimo sRGB.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Farby: OKLCH je nový default
- **Autoruj v OKLCH.** V roku 2026 má OKLCH podporu vo všetkých evergreen prehliadačoch (Chrome/Edge 111+, Safari 15.4+, Firefox 113+), pokrytie ~93 %+. Odporúčanie: `oklch()` ako default, `hsl()` len pre legacy. HEX drž ako fallback formát.
- **Generuj škály cez lightness anchor.** Najprv zafixuj L (napr. plochy: canvas L≈0.98, karta L≈0.96, tlmená plocha L≈0.92; text: primárny L≈0.20, sekundárny L≈0.40), potom dolaď C a H. Vďaka perceptuálnej rovnomernosti dostaneš prístupné, harmonické stupne bez háadania.
- **Tailwind v4** interne používa OKLCH pre default paletu — ak beží Aura na Tailwinde, si už v OKLCH ekosystéme.
- **Figma zatiaľ nemá OKLCH picker** — používaj plugin (napr. OkColor) alebo definuj v OKLCH v kóde a do Figmy sync‑ni cez tokeny.
- **Testuj na reálnych zariadeniach** — P3 farby vyzerajú inak na wide‑gamut vs sRGB displejoch.

### Design tokeny: DTCG dosiahol stabilitu
- **Október 2025:** DTCG spec `2025.10` = prvá stabilná verzia. Znamená to reálnu interoperabilitu — jeden JSON pre Figmu aj kód.
- **Figma natívny DTCG export/import** premenných (bez pluginov) — right‑click na Variable collection → export do DTCG JSON, prežeň cez **Style Dictionary** → CSS custom properties, Tailwind config, iOS/Android.
- **Trojvrstvová architektúra je štandard:** primitívne → sémantické → komponentové. Komponenty nikdy nesiahaju na primitívne hodnoty priamo.

### Typografia a spacing
- **8px grid je priemyselný default** (Material, Carbon). 4px sub‑grid pre tesné vnútorné odsadenia (padding tlačidla, ikona + label).
- **Kombinuj modulárnu škálu s gridom:** použij pomer (napr. Major Third 1.250 alebo Minor Third 1.200) ako *vodítko*, potom zaokrúhli výstupy na najbližší násobok 4. Font‑size môže vybočiť, ale **line‑height drž v násobkoch gridu** (napr. 15px text → 24px line‑height), aby baseline sadal.
- **Sémantické typo tokeny + responsive scaling:** namiesto surových px používaj `heading-lg`, `body`, `caption`; pre responzivitu `clamp()` s viewport jednotkami.

### Light/Dark a prístupnosť
- **Dark mode nie je inverzia.** Sémantická vrstva swapuje primitívnu mapu; komponenty ostávajú. V dark mode používaj tmavé neutrály (nie čisto čierne #000 — spôsobuje halo/„smearing"), povrchy odlišuj **eleváciou cez svetlosť** (vyšší prvok = svetlejšia plocha), nie tieňmi.
- **Kontrast — dvojitý meter:** WCAG 2.2 pre **právnu zhodu** (EAA v EÚ platí od júna 2025, EÚ e‑shopy sú v scope), APCA ako **prísnejšia perceptuálna kontrola** najmä pre dark mode. WCAG 2.x nadhodnocuje kontrast pri tmavých farbách — nespoliehaj sa naň pri dizajne dark mode, over cez APCA.
- Cieľové minimá WCAG 2.2: **4.5:1** normálny text, **3:1** veľký text (≥24px alebo ≥18.66px bold) a UI komponenty/ikony.

### Figma → kód workflow
- **Variables s modes** nahradili Styles pre tokeny. Jedna kolekcia, viac modes (Light/Dark, prípadne brand/jazyk).
- **Code Connect** (Figma) mapuje Figma komponenty na komponenty v kóde — dizajn a kód ostávajú v sync.
- **AI‑asistovaný handoff:** DTCG tokeny + `AGENTS.md`/pravidlá zabezpečia, že AI generátory kódu rešpektujú tvoje tokeny namiesto vymýšľania hodnôt.

## Krok za krokom — workflow budovania systému

1. **Audit a inventár.** Zozbieraj existujúce farby, fonty, medzery, tlačidlá z webu Aury a marketingu. Odhaľ duplicity a drift („koľko odtieňov zlatej reálne používam?").
2. **Definuj brand core.** 1 primárna akcentová farba (zlatá/champagne pre šperky), 1–2 sekundárne, neutrálna škála (2–3 pozadia + 3 úrovne textu). Aplikuj **60‑30‑10**.
3. **Postav primitívnu paletu v OKLCH.** Pre každú farbu vygeneruj 9–11 stupňov (50–950) fixovaním L a ladením C/H. Napr. `gold-500 = oklch(0.72 0.13 85)`.
4. **Vytvor sémantickú vrstvu.** Mapuj: `surface`, `surface-elevated`, `text-primary`, `text-secondary`, `border`, `accent`, `accent-hover`, `success`/`warning`/`danger`. Sprav **dva modes** (Light/Dark) prehodením mapy.
5. **Definuj spacing scale.** `space-1`=4, `-2`=8, `-3`=12, `-4`=16, `-6`=24, `-8`=32, `-12`=48, `-16`=64. Násobky 8 (+4 sub‑grid).
6. **Definuj type ramp.** Vyber pomer (napr. 1.250). Základ 16px body. Škála zaokrúhlená na 4px: napr. 12 / 14 / 16 / 20 / 24 / 32 / 40 / 48. Ku každej priraď line‑height (násobok 4/8) a váhu. Vytvor sémantické tokeny (`display`, `h1`…`h3`, `body`, `caption`).
7. **Over kontrast.** Každý text/pozadie pár skontroluj WCAG 2.2 (min 4.5:1), potom APCA sanity check pre dark mode.
8. **Zapíš tokeny do Figma Variables** (kolekcie: Primitives, Semantic; modes: Light/Dark). Prípadne cez Tokens Studio.
9. **Postav komponentovú knižnicu.** Začni s: Button (variants: primary/secondary/ghost; stavy default/hover/focus/active/disabled/loading), Input, Card (produktová karta), Badge, Nav. Každý referencuje len sémantické tokeny.
10. **Export DTCG JSON** z Figmy → **Style Dictionary** → CSS custom properties / Tailwind config pre web Aury.
11. **Prepoj Code Connect** (ak vývoj v React/komponenty), aby handoff ukazoval reálny kód.
12. **Dokumentuj a verzuj.** Krátky „usage" doc: kedy ktorý token/komponent, do‑not príklady. Verzuj (semver) tokeny.
13. **Iteruj z reálneho použitia.** Nové potreby → pridaj token/variant do systému, nie ad‑hoc hodnotu do jednej stránky.

## Checklist

- [ ] Definovaná primárna akcentová farba + neutrálna škála + max 2 sekundárne
- [ ] Pomer farieb sleduje 60‑30‑10
- [ ] Paleta autorovaná v OKLCH, s HEX fallbackom
- [ ] Trojvrstvové tokeny: primitive → semantic → component
- [ ] Light aj Dark mode ako prepnutie sémantickej mapy (nie inverzia)
- [ ] Dark mode nepoužíva čisto čiernu; elevácia cez svetlosť plôch
- [ ] Spacing scale = násobky 8 (+4 sub‑grid), pomenované tokeny
- [ ] Type ramp z modulárneho pomeru, zaokrúhlený na 4px
- [ ] Line‑height v násobkoch gridu (baseline sadá na grid)
- [ ] Všetky text/pozadie páry ≥ WCAG 2.2 (4.5:1 / 3:1)
- [ ] Dark mode overený aj cez APCA
- [ ] Focus stavy viditeľné (≥3:1), nielen hover
- [ ] Každý komponent má stavy: default/hover/focus/active/disabled/loading/error
- [ ] Tokeny v Figma Variables s modes
- [ ] DTCG JSON export → Style Dictionary → CSS/Tailwind
- [ ] Vizuálna hierarchia: 1 jasná primárna akcia na obrazovku
- [ ] Krátka dokumentácia usage + do‑not
- [ ] Tokeny verzované (semver)

## Časté chyby

- **Príliš veľa farieb / odtieňov.** 5 odtieňov „zlatej" = drift. Riešenie: jedna škála, sémantické tokeny, disciplína 60‑30‑10.
- **Priame hodnoty v komponentoch** (`#C9A66B` napevno). Riešenie: komponent referencuje `--accent`, nie surovú hodnotu.
- **Dark mode ako CSS `invert`.** Vyzerá špinavo, rozbije kontrast a fotky. Riešenie: samostatný mode v sémantickej vrstve.
- **Čistá čierna pozadia v dark mode.** Spôsobuje halation a únavu očí. Riešenie: tmavý neutrál (napr. oklch okolo L 0.15–0.20).
- **Spoliehanie len na WCAG 2.x pri dark mode.** Nadhodnocuje kontrast tmavých farieb. Riešenie: doplň APCA kontrolu.
- **Náhodné medzery** (13px, 17px, 22px). Riešenie: len hodnoty zo spacing scale.
- **Font‑size z pomeru bez zaokrúhlenia + náhodný line‑height.** Rozbije vertikálny rytmus. Riešenie: zaokrúhli na 4px, line‑height v násobkoch gridu.
- **Optimalizácia hierarchie farbou namiesto štruktúry.** Všetko červené = nič nie je dôležité. Riešenie: hierarchiu rieš primárne veľkosťou/priestorom/váhou, farbu šetri na akcent.
- **Figma a kód sa rozídu.** Ručný prepis hodnôt = drift. Riešenie: jeden zdroj (DTCG tokeny) + Style Dictionary/Code Connect.
- **Systém bez dokumentácie.** Nikto (ani ty o 3 mesiace) nevie, kedy čo použiť. Riešenie: krátky usage doc pri každom tokene/komponente.
- **Predizajnovanie na začiatku.** 40 variantov tlačidla, ktoré nikdy nepoužiješ. Riešenie: pridávaj z reálnej potreby.

## Nástroje

- **Figma** — dizajn, Variables (tokeny + modes), Code Connect, natívny DTCG export/import.
- **Tokens Studio for Figma** — pokročilá správa tokenov, DTCG formát, sync s Gitom.
- **Style Dictionary** — transformácia DTCG JSON → CSS custom properties, Tailwind config, iOS/Android.
- **Tailwind CSS v4** — utility framework, natívne OKLCH paleta; prirodzený cieľ pre exportované tokeny.
- **OkColor (Figma plugin)** — OKLCH picker vo Figme, kým chýba natívny.
- **oklch.com / OKLCH Color Picker & Converter (Evil Martians)** — vizuálne ladenie OKLCH škál a gamut kontrola.
- **Type Scale (typescale.com) / Modular Scale** — generovanie type rampy z pomeru.
- **APCA contrast calculator (apcacontrast.com)** — perceptuálny kontrast pre dark mode.
- **Contrast checkers (WebAIM, Figma plugins)** — WCAG 2.2 zhoda.
- **Penpot** — open‑source alternatíva k Figme s DTCG podporou.
- **Storybook / zeroheight** — dokumentácia a živá komponentová knižnica.

## Zdroje

- [OKLCH in CSS: why we moved from RGB and HSL — Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [Exploring the OKLCH ecosystem and its tools — Evil Martians](https://evilmartians.com/chronicles/exploring-the-oklch-ecosystem-and-its-tools)
- [Modern CSS Color: Complete Guide to OKLCH, color-mix(), Relative Colors in 2026 — ColorPick](https://colorpick.app/blog/modern-css-color-oklch-guide)
- [OKLCH Color Space — Atmos Style Glossary](https://atmos.style/glossary/oklch-color-space)
- [Design Tokens specification reaches first stable version — W3C DTCG](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/)
- [DTCG Design Tokens in Figma — Mykhaylo Ryechkin](https://www.misha.wtf/blog/figma-dtcg-design-tokens)
- [Figma Design Tokens Guide: Variables, DTCG Export & Code Handoff (2026) — Atomize](https://atomize.tools/blog/figma-design-tokens-guide/)
- [Design Tokens: How to Sync Design and Code in Figma — Figma](https://www.figma.com/resource-library/design-tokens/)
- [Token Format — W3C DTCG vs Legacy — Tokens Studio](https://docs.tokens.studio/manage-settings/token-format)
- [Spacing System Cheat Sheet: 4px vs 8px vs Custom — Mantlr](https://mantlr.com/blog/spacing-system-cheat-sheet)
- [Designing in the 8pt grid system — Bootcamp / Medium](https://medium.com/design-bootcamp/designing-in-the-8pt-grid-system-f3c1183ea6e8)
- [Mastering typography in design systems with semantic tokens and responsive scaling — UX Collective](https://uxdesign.cc/mastering-typography-in-design-systems-with-semantic-tokens-and-responsive-scaling-6ccd598d9f21)
- [Dark Mode Design Systems: Patterns, Tokens, and Hierarchy — Muzli](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/)
- [Designing a Scalable and Accessible Dark Theme — Design System Chronicles](https://www.fourzerothree.in/p/scalable-accessible-dark-mode)
- [APCA in a Nutshell — APCA](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html)
- [Color System WCAG Compliance: 2026 Guide — Digital Heroes](https://digitalheroes.co.in/journal/color-system-wcag-compliance/)
- [Color considerations — GitHub Primer](https://primer.style/accessibility/design-guidance/color-considerations/)
