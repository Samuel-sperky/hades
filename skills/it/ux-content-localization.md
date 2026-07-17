# UX content + localization

> Slovak-first produktový content a lokalizačný playbook pre jednoznačné akcie, stavové a chybové správy, stabilnú terminológiu, locale-safe formátovanie, pluralizáciu, RTL a prekladové QA.

## Hranica skillu

Tento playbook vlastní produktový jazyk, terminológiu, message architecture, formátovanie locale a translation QA. Neopakuje:

- focus, semantiku a live-region mechaniku z `skills/it/accessible-interaction-patterns.md`,
- async state machines z `skills/it/resilient-async-ui.md`,
- research a handoff z `skills/it/product-ux-delivery.md`,
- vizuálne tokeny a component styling z `skills/design/ui-design-systems.md`.

Nie je to marketingový copywriting. Cieľom je, aby človek pochopil stav, rozhodnutie, dôsledok a recovery v každom podporovanom jazyku.

## Výstup, ktorý má skill vytvoriť

Odovzdaj:

1. voice a grammar pravidlá,
2. terminologický glossary,
3. message catalog so stabilnými ID a typovanými premennými,
4. locale/time-zone/formatting contract,
5. pseudo-localization a RTL build,
6. automatickú aj native-language QA maticu,
7. release gate s pokrytím kritických flow.

## 1. Oddeľ jazyk, locale a časové pásmo

Nastav tri nezávislé hodnoty:

```text
ui_language = sk
formatting_locale = sk-SK
time_zone = Europe/Bratislava
```

- Nikdy nepredpokladaj, že sa musia zhodovať.
- UI language určuje text; locale určuje čísla, dátumy, meny a plural rules; IANA time zone určuje civilný čas.
- Slovenský používateľ môže chcieť anglické UI a slovenské formátovanie v inej zóne.
- UTF-8 používaj v source, API, databáze, exporte aj logoch.
- Fallback language je explicitný, merateľný a nikdy nevytvorí prázdny text.
- Kritický chýbajúci preklad zablokuje build alebo release.

## 2. Slovak-first voice

Slovenčinu píš ako prvotriedny source language, nie ako doslovný strojový preklad z angličtiny.

Predvolený hlas:

- pokojný,
- vecný,
- stručný,
- neobviňujúci,
- neutrálno-neosobný.

V controls používaj infinitív a neprepínaj medzi tykaním a vykaním. Ak produkt zvolí inú voice politiku, zdokumentuj ju globálne a nemen ju lokálne.

### Obsahová hierarchia

1. Nadpis pomenuje objekt alebo úlohu.
2. Supporting text vysvetlí iba to, čo mení rozhodnutie.
3. Primárna akcia pomenuje výsledok.
4. Status povie, čo sa deje alebo dokončilo.
5. Error povie, čo zlyhalo, aký je dopad, čo zostalo zachované a ako pokračovať.
6. Diagnostický detail ostáva sekundárny.

## 3. Píš controls a správy jednoznačne

### Všeobecné pravidlá

- Používaj sentence case.
- Nedávaj bodku do buttonov, tabov, menu a krátkych labels; úplné vety interpunkciu majú.
- Field label je stabilné podstatné meno; hint vysvetlí požiadavku ešte pred chybou.
- Button je sloveso alebo sloveso + objekt: `Uložiť`, `Pridať uzol`, `Odstrániť uzol`.
- Nepoužívaj `OK`, `Áno`, `Submit`, `Pokračovať` bez pomenovania významu, ak existuje presnejší výsledok.
- Interné API, tabuľky, exception a service names neukazuj ako hlavný text.
- Support ID ukáž až po recovery guidance a bez citlivého payloadu.

### Stavová taxonómia

| Stav | Vzor |
|---|---|
| Pending | `Ukladá sa…` |
| Success | `Uzol bol uložený.` |
| Error | `Uzol sa nepodarilo uložiť. Zmeny zostali zachované.` |
| Recovery | `Skúsiť znova` |
| Empty data | `Zatiaľ tu nie sú žiadne uzly.` + relevantná akcia |
| Zero results | `Pre tieto filtre sme nenašli výsledky.` + reset/upraviť |
| Permission | pomenuj chýbajúce oprávnenie a ownera/cestu žiadosti |
| Partial | pomenuj, čo je dostupné a čo chýba |

### Confirmations

```text
Title: Odstrániť uzol „{nodeName}“?
Body:  [scope, dôsledok, synchronizované kópie a obnoviteľnosť]
Primary: Odstrániť uzol
Secondary: Zrušiť
```

- Deštruktívna primárna akcia zopakuje dôsledok.
- Namiesto neurčitého „Ste si istí?“ pomenuj objekt, scope a reversibility.
- Pri batch akcii ukáž počet a filter/selection scope.
- Nesľubuj undo, delete ani privacy výsledok, ktorý backend nevie garantovať.

## 4. Vlastni terminológiu

Každý glossary záznam obsahuje:

```yaml
concept_id: memory_node
sk_lemma: uzol
en_term: node
definition: "..."
allowed_inflections: [uzol, uzla, uzly, uzlov]
forbidden_aliases: [záznam, item]
example: "Pridať uzol"
owner: product-content
status: approved
```

- Jeden koncept má jeden schválený termín v navigácii, nadpisoch, buttonoch, statusoch aj supporte.
- Preferuj používateľský doménový termín pred databázovým/API názvom.
- Pri gramatickom páde alebo rode nekonkatenaj slovenské podstatné meno do generickej šablóny.
- Vytvor celú kontextovú správu alebo explicitne typované skloňované formy.
- Translation pri runtime neuppercase-uj, nelowercase-uj ani netitle-case-uj.
- Brand, file path, command a identifier nemen, kým glossary výslovne neurčí inak.
- Forbidden alias lintuj v kritických flows s allowlistom pre citácie alebo historický text.

## 5. Použi stabilné message IDs

Používaj semantic ID, nie source text:

```text
node.delete.confirm.title
node.delete.confirm.body
node.load.error.body
agent.run.cancelled.status
```

- Nerecykluj jedno ID iba preto, že dve slovenské správy dnes znejú rovnako.
- ID opisuje doménu, surface, intent a variant; neobsahuje locale.
- Deprecated ID má ownera, migration path a dátum odstránenia.

Catalog entry obsahuje:

| Pole | Povinný obsah |
|---|---|
| ID | stabilný semantic key |
| Description | účel a kedy sa text zobrazí |
| Surface | route, komponent a stav |
| Source | schválený source text |
| Variables | názov, typ, príklad a citlivosť |
| Markup | povolené tags/links alebo none |
| Context | screenshot alebo story |
| Translation | locale, reviewer a status |
| Owner | osoba/tím a lifecycle |

## 6. Premenné a správy neskladaj z fragmentov

- Použi semantic placeholders ako `{nodeName}` a `{count}`, nie `{0}`.
- Posielaj typované raw hodnoty; formátovanie nech vykoná locale formatter.
- Translator môže zmeniť poradie placeholderov.
- Nevytváraj vetu spájaním preložených fragmentov.
- Variable escapuj podľa cieľa; preklad nesmie obsahovať arbitrary HTML.
- Allowed markup udrž minimálny a validuj schémou.
- Placeholder name/type parity kontroluj medzi všetkými locales.

Príklad message contractu:

```json
{
  "id": "node.count.summary",
  "variables": { "count": "number" },
  "message": "{count, plural, one {# uzol} few {# uzly} many {# uzla} other {# uzlov}}"
}
```

Použi Unicode MessageFormat alebo ekvivalent založený na CLDR.

## 7. Pluralizácia nie je `count === 1`

Pre slovenčinu otestuj:

| Hodnota | CLDR kategória | Príklad |
|---:|---|---|
| 1 | one | `1 uzol` |
| 2–4 | few | `2 uzly` |
| 1,5 | many | `1,5 uzla` |
| 0, 5+ | other | `0 uzlov`, `5 uzlov` |

- Vždy poskytni catch-all `other`.
- Plural selection musí používať rovnaké digit/rounding options ako zobrazené číslo.
- `1` a `1,0` môžu patriť do inej vetvy podľa viditeľných desatinných miest.
- Angličtina používa svoje locale rules, nie slovenské podmienky.
- Ordinal a cardinal rules nezamieňaj.
- Ručne napísané `if` vetvy nahraď CLDR-backed formatterom.

## 8. Dátumy, čísla, jednotky a časové pásma

Použi `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat`, `Intl.ListFormat` alebo ekvivalent nad CLDR.

- Instant ulož/pošli nezávisle od display formátu.
- Keď záleží na civilnom čase, zachovaj IANA zone.
- Bratislavu neimplementuj fixným `+01:00`; DST vyžaduje `Europe/Bratislava`.
- Nehardcoduj poradie dátumu, decimal/group separator, menu ani unit suffix.
- Deadline, audit a cross-zone spolupráca ukáže časovú zónu.
- Relative time je doplnok; presný absolute čas je dostupný.
- Localized display string nikdy neparsuj späť do business dát.
- Currency zachová ISO kód a rounding policy domény.
- List hodnôt skladá `Intl.ListFormat`, nie čiarky v source texte.

## 9. Language switcher

- Jazyky pomenuj natívne: `Slovenčina`, `English`; nepoužívaj vlajky.
- Prepnutie zachová route, filters, selection a rozpracovaný input, ak je to bezpečné.
- Jazykový switch nikdy nespustí neúmyselný submit alebo stratu draftu.
- Zmena locale aktualizuje viditeľný text aj hidden accessible labels v jednom commit/renderi.
- Preferenciu ulož s jasným scope: account, browser alebo session.
- Neodvodzuj jazyk iba z geolokácie.

## 10. `lang`, `dir` a RTL

Pre slovenskú stránku:

```html
<html lang="sk" dir="ltr">
```

- Pri zmene locale aktualizuj `lang` aj `dir`.
- Skutočný anglický úsek označ `lang="en"`.
- Pre budúce RTL locale nastav `dir="rtl"` na root.
- CSS používa logical properties (`margin-inline`, `inset-inline-start`).
- User-generated text neznámeho smeru používa `dir="auto"`.
- Izolované runtime values v zmiešanom smere obaľ `<bdi>`.
- CSS `direction` ani invisible bidi characters nepoužívaj ako náhradu za semantic HTML.
- Ikonu zrkadli len ak nesie smerový význam; logo, media controls a číselné osi nie automaticky.

## 11. Navrhuj na expansion

- Kritický text nemá fixed-height kontajner.
- Pseudo-localization pridá približne +40 % všeobecného textu a +100 % pri reťazcoch do 10 znakov.
- Testuj wrapping, diakritiku, combining marks, emoji, dlhé identifikátory a unbroken URL.
- Text nevkladaj do raster image.
- Button s dlhým textom môže wrapnúť alebo narásť; nesmie clipnúť primárny význam.
- Overlay a table header sa testujú pri expansion aj 320 CSS px a 200 % zoom.
- Layout nerozbíjaj tým, že zmenšíš font pod čitateľnú veľkosť.

## 12. Localizuj accessibility content spolu s viditeľným

Catalog zahŕňa:

- labels a descriptions,
- `aria-label`/`aria-labelledby` text,
- alt text,
- error summary a field error,
- status/live-region výsledok,
- dialog name,
- shortcut a keyboard help.

- Accessible name má obsahovať viditeľné control wording.
- Live region dostane jednu kompletnú lokalizovanú správu, nie fragmenty.
- Language change označ, aby screen reader zvolil správnu výslovnosť.
- Slovenskú aj anglickú výslovnosť skratiek, jednotiek, mien a dynamických hodnôt manuálne over.
- Hidden text nesmie zostať v inom jazyku než viditeľná obrazovka.

## 13. Automatické kontroly

CI kontroluje:

- missing, extra a dead IDs,
- placeholder name/type parity,
- syntax a required catch-all branches,
- slovenské plural cases `0, 1, 2, 4, 5, 21, 1.5`,
- forbidden glossary aliases,
- hard-coded user-visible strings v templates a JavaScripte,
- unsafe markup a untranslated fallback leakage,
- správne `lang`/`dir`,
- duplicate IDs s odlišnou definíciou,
- catalog coverage oproti runtime usage.

Lint na hard-coded text musí rozlišovať user-visible content od logs, test fixtures a identifiers cez explicitný allowlist.

## 14. Manuálne translation QA

Native reviewer kontroluje text v reálnom UI, nie iba v tabuľke:

- happy, empty, pending, success, permission, timeout a partial stavy,
- validation, destructive confirmation a recovery,
- 320 px viewport, 200 % zoom, pseudo-expanded a pseudo-RTL build,
- dátumy pri DST prechode a rozdielne time zones,
- záporné, veľké, desatinné čísla, jednotky a meny,
- 0/1/2/4/5/21/1,5 položiek,
- language switch so zachovaním route, filtrov, výberu a draftu,
- keyboard a screen-reader smoke test pre každý enabled locale.

Reviewer hodnotí význam a task success, nie iba pravopis.

## Hades kontrakt

- Slovenčina je prvotriedny source locale; English je samostatne recenzovaný locale.
- Všetok user-visible text z `mind.blade.php` a `public/js/mind.js` presuň do catalogu po vertikálnych rezoch.
- Message ID nesmie byť slovenský source text.
- Hades/AI identity, run states, memory a approval copy používajú schválený glossary.
- `Europe/Bratislava` používaj iba ako zónu, nie ako odhad jazyka alebo locale.
- Graph labels, canvas alternatíva, tooltip a accessible name používajú rovnaký catalog.
- Import/export uchová raw hodnoty a metadata locale/time-zone; exportovaný display formát nie je zdroj pravdy.

## Release gate

- [ ] 100 % user-visible strings je v catalogu alebo explicitnom schválenom allowliste.
- [ ] 100 % critical-flow pokrytie existuje pre každý enabled locale.
- [ ] Kritické chýbajúce preklady failnú build; fallback nie je nikdy prázdny.
- [ ] Nie je žiadna placeholder, plural, syntax ani unsafe-markup chyba.
- [ ] Kritické flows nemajú prohibited glossary alias.
- [ ] Hidden accessibility labels sú kompletne preložené a významovo zhodné.
- [ ] `lang`/`dir` sú správne na každej route a lokalizovanej pasáži.
- [ ] 0/1/2/4/5/21/1,5 plural testy prešli.
- [ ] Dátumy, čísla, meny a zóny používa locale formatter bez ručného skladania.
- [ ] Pri expansion, 320 px a 200 % zoom nie je clipped kritický text ani stratená akcia.
- [ ] Language switch zachová route, filters, selection a unsaved input.
- [ ] Native reviewer schválil terminológiu, gramatiku a task meaning.
- [ ] Nie je otvorený P0/P1 localization defect.

## Integrácia do pokročilého plánu

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`.
- **Requires:** flow/state vocabulary z `skills/it/product-ux-delivery.md`; research materiály podľa potreby z `skills/it/ux-research-operations.md`.
- **Companions:** `skills/it/search-navigation-discovery.md` pre labels/synonyms, `skills/it/privacy-permissions-trust-ux.md` pre disclosure a `skills/it/accessible-interaction-patterns.md` pre accessible names.
- **Hands off to:** `skills/design/ui-design-systems.md` a `skills/it/design-system-component-engineering.md` ako glossary, message catalog a expansion/RTL fixtures.

## Zdroje

- [W3C — Internationalization versus localization](https://www.w3.org/International/questions/qa-i18n)
- [W3C — Language declarations in HTML](https://www.w3.org/International/questions/qa-html-language-declarations.html)
- [W3C — Structural markup and text direction](https://www.w3.org/International/questions/qa-html-dir)
- [W3C — Internationalization quick tips](https://www.w3.org/International/quicktips/)
- [Unicode TR35 — MessageFormat](https://www.unicode.org/reports/tr35/tr35-messageFormat.html)
- [Unicode CLDR — Slovak plural rules](https://unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
- [MDN — Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
- [MDN — Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)
- [W3C WCAG 2.2 — Language of Parts](https://www.w3.org/WAI/WCAG22/Understanding/language-of-parts.html)
- [GOV.UK Design System — Error message](https://design-system.service.gov.uk/components/error-message/)
