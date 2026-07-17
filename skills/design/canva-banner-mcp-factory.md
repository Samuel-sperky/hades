# Canva banner MCP factory

> Produkčný playbook pre tvorbu celej bannerovej kampane v Canve: od briefu a brand systému cez dátové varianty, agentické MCP/API automatizácie a schválenie až po dávkový export s auditovateľným manifestom.

## Výsledok skillu

Použi tento playbook, keď treba pripraviť jeden banner, celý cross-channel set alebo opakovateľnú bannerovú továreň. Výstupom nie je iba „pekný obrázok“, ale verzovaný balík:

- master šablóna a odvodené rozmery,
- textové, produktové, jazykové a audience varianty,
- editovateľné Canva dizajny,
- exporty pomenované podľa manifestu,
- QA report, schválenie a audit použitých zdrojov.

Skill nerobí z Canvy imaginárny nástroj. Pred prvým krokom vždy zisti reálne dostupné capability a zvoľ jednu z troch ciest.

## Capability router: vyber reálnu integračnú cestu

| Priorita | Cesta | Použi, keď | Hranice |
|---|---|---|---|
| 1 | Natívny Canva MCP | Klient vystavuje nástroje na designs, templates, assets, autofill a exports | Volaj iba nástroje, ktoré sú skutočne v tool registry; názvy ani scope nehádaj. |
| 2 | Canva Connect APIs + Apps SDK | Buduje sa stabilná integrácia, dávkový systém alebo produktový workflow | OAuth, scope, plán a dostupnosť API musia byť overené; async joby polluj s limitom. |
| 3 | Browser MCP | Natívny MCP chýba, ale používateľ má prihlásenú Canvu v interaktívnom browseri | UI selektory sú krehkejšie; po každom kritickom kroku over viditeľný stav. |

V tomto prostredí nie je nainštalovaný samostatný Canva MCP. Preto tu ako bezpečný runtime fallback slúži browser konektor; pre škálovateľnú produkciu preferuj vlastnú Canva Connect API integráciu. Nezamieňaj Figma canvas nástroje s Canvou.

## Vstupný kontrakt kampane

Pred produkciou zostav `campaign_brief` a označ neznáme polia. Nepokračuj s domyslenými cenami, zľavami, právnymi tvrdeniami ani dátumami.

```json
{
  "campaign_id": "aura-summer-2026",
  "objective": "conversion|awareness|retargeting|launch",
  "audiences": ["new", "returning"],
  "offer": {"claim": "", "price": null, "valid_from": null, "valid_to": null},
  "message": {"headline": "", "support": "", "cta": ""},
  "channels": ["meta", "instagram", "display", "web"],
  "placements": [{"name": "story", "width": 1080, "height": 1920}],
  "locales": ["sk"],
  "brand_kit": {"logo": "", "colors": [], "fonts": [], "rules": ""},
  "assets": [{"asset_id": "", "source": "", "rights": "approved"}],
  "template_id": null,
  "deadline": "",
  "approver": "",
  "export_formats": ["png"],
  "publish": false
}
```

Rozmery pre reklamné siete nikdy neber ako večnú konštantu. Ulož ich do verzovaného placement registry a pred novou kampaňou ich over v cieľovej platforme. Jeden master pomer nepovažuj za automaticky bezpečný pre všetky orezy.

## Architektúra full-scale produkcie

```text
Brief + brand kit + asset registry
              ↓
      Content/data matrix
              ↓
 Master template s pomenovanými slotmi
              ↓
 Autofill/Bulk Create alebo riadené duplikácie
              ↓
 Kompozičná a obsahová QA po každom pomere
              ↓
        Human approval gate
              ↓
 Async export → manifest → storage/publish queue
```

### Zdroj pravdy

- Brand farby, fonty, logo varianty a spacing drž v jednom brand registry.
- Každý produkt identifikuj stabilným `product_id`; obrázky nemapuj iba podľa názvu súboru.
- Texty drž ako štruktúrované polia, nie ako jeden voľný blok.
- Šablónu verzuj pomocou `template_id` + `template_version`.
- Každý export naviaž na hash briefu, datasetu a šablóny.

### Master šablóna

Vytvor najprv reprezentatívny master, nie všetky rozmery naraz. Použi pomenované sloty:

- `image.hero`, `image.product`, `logo.primary`,
- `text.eyebrow`, `text.headline`, `text.support`, `text.price`,
- `cta.label`, `legal.disclaimer`, `badge.offer`.

Definuj bezpečné zóny, maximálny počet riadkov, minimálnu veľkosť textu, pomer produktu k ploche a pravidlá pre logo. Pri zmene pomeru znovu komponuj; samotný resize je iba prvý návrh.

## Agentická výrobná slučka

Orchestrátor odovzdáva iba štruktúrované artefakty. Každý agent má jasný exit condition a nesmie publikovať.

1. **Brief agent** — normalizuje zadanie, vypíše chýbajúce fakty a vytvorí `campaign_brief.json`.
2. **Creative agent** — navrhne 2–3 odlišné koncepty, hierarchiu a pravidlá adaptácie pomerov.
3. **Copy agent** — pripraví schválené dĺžkové varianty bez vymýšľania produktových faktov.
4. **Production agent** — vytvorí master a varianty cez dostupnú Canva integračnú cestu.
5. **QA agent** — kontroluje obsah, orezy, kontrast, čitateľnosť, brand a duplicity.
6. **Release agent** — po explicitnom schválení exportuje, vytvorí manifest a odovzdá balík; publikuje iba ak to používateľ osobitne autorizoval.

Pri malej úlohe môže jeden agent vykonať viac rolí, ale zachovaj samostatné kontrolné brány.

## Postup cez Canva Connect APIs / Apps SDK

1. Over OAuth používateľa, scopes a plan-dependent capability.
2. Nahraj alebo synchronizuj schválené assety; pred uploadom kontroluj hash a licenčný stav.
3. Získaj dataset šablóny a validuj názvy aj typy autofill polí.
4. Vytvor asynchrónny autofill job pre jednu testovaciu položku.
5. Polluj job s deadline, maximálnym počtom pokusov a rešpektovaním rate limitu.
6. Vizuálne over testovací dizajn; až potom spusti dávku.
7. Pre veľké datasety použi Data Connector/Bulk Create a vynúť limity riadkov, stĺpcov a veľkosti.
8. Exportuj cez async export job; ukladaj job ID, design ID, stav a chybu.
9. Výsledky zapíš do manifestu a až po QA ich sprístupni publish workflowu.

Canva Autofill má plánové podmienky a Data Connector má vlastné scopes a dostupnosť. Pri nedostupnej capability nesnaž sa obísť plan limit automatizovaným klikaním; prejdi na riadené duplikovanie šablóny alebo vyžiadaj zmenu plánu.

## Postup cez browser MCP

1. Otvor Canvu v existujúcej prihlásenej session a over aktívny účet/workspace.
2. Otvor presný template link alebo vytvor dizajn v dohodnutom priečinku.
3. Po každej navigácii znovu skontroluj názov dizajnu a workspace; nespoliehaj sa na starý DOM stav.
4. Nahraj iba schválené assety a over ich náhľad pred vložením.
5. Vytvor master a jeden variant každého pomeru.
6. Urob screenshot QA; až po úspechu duplikuj jazykové/audience varianty.
7. Pri Bulk Create skontroluj mapovanie každého stĺpca na správny slot na vzorke.
8. Pred exportom over počet strán, vybrané stránky, formát, kvalitu a transparentnosť.
9. Export potvrď iba do používateľom určeného umiestnenia. Publikovanie, zdieľanie a zmena oprávnení sú samostatné externé zápisy.

Ak sa browser UI odchýli, zastav po dvoch rovnakých zlyhaniach a vráť presný stav. Nevykonávaj slepé retry kliknutí, ktoré môžu vytvoriť duplicity.

## Variantová matica bez explózie

Počet výstupov je:

```text
placements × locales × audiences × copy_variants × products
```

Pred generovaním vypočítaj plánovaný počet a limit. Ak napríklad 8 × 3 × 4 × 3 × 20 vytvorí 5 760 dizajnov, nepristupuj k tomu ako k manuálnemu Canva projektu. Zníž dimenzie experimentu, použi prioritné kombinácie alebo API dávky s cost/time budgetom.

Každý variant musí mať stabilný kľúč:

```text
{campaign_id}__{placement}__{locale}__{audience}__{product_id}__v{copy_variant}
```

## QA brány

### Obsah

- [ ] Cena, zľava, dátumy, materiál a dostupnosť sedia so zdrojom.
- [ ] CTA zodpovedá cieľu a cieľovej URL.
- [ ] Lokalizácia nie je odrezaná a disclaimer zostáva čitateľný.
- [ ] Varianty nemajú duplicitnú kombináciu kľúčov.

### Dizajn

- [ ] Produkt, tvár a logo nie sú v crop-risk zóne.
- [ ] Hierarchia je zrozumiteľná pri náhľade v reálnej veľkosti placementu.
- [ ] Text/pozadie dosahuje dohodnutý kontrast; informácia nestojí iba na farbe.
- [ ] Logo má clear space, správny variant a nie je deformované.
- [ ] Každý pomer bol komponovaný a overený samostatne.

### Technická kvalita

- [ ] Rozmer, formát, farebný priestor a limit veľkosti sú správne.
- [ ] Export obsahuje presne schválené stránky.
- [ ] Súborové názvy a manifest sa zhodujú.
- [ ] Zdrojové dizajny zostali editovateľné.
- [ ] AI asset má uložený nástroj, prompt, dátum a status práv.

## Manifest a idempotencia

```json
{
  "run_id": "uuid",
  "campaign_id": "aura-summer-2026",
  "brief_hash": "sha256:...",
  "template": {"id": "...", "version": "3"},
  "outputs": [
    {
      "variant_key": "...",
      "design_id": "...",
      "export_job_id": "...",
      "file": "...png",
      "qa": "passed",
      "approved_by": "...",
      "approved_at": "..."
    }
  ]
}
```

Pred vytvorením variantu skontroluj `variant_key + brief_hash + template_version`. Rovnaký úspešný výstup znovu nevytváraj. 429 a 5xx retryuj s backoffom a jitterom; validačné 4xx neopakuj. Neistý výsledok exportu najprv vyhľadaj podľa job/design ID, až potom opakuj.

## Approval policy

Bez ďalšieho súhlasu môže agent pripravovať brief, koncepty, drafty, Canva dizajny a exportný plán. Explicitné potvrdenie vyžaduj pred:

- dávkou nad dohodnutý počet variantov alebo kreditov,
- použitím neovereného assetu alebo tvrdenia,
- exportom do externého DAM/úložiska, ak mení zdieľaný stav,
- zdieľaním dizajnu, zmenou oprávnení, publikovaním alebo spustením reklamy,
- odstránením alebo prepísaním existujúcej šablóny.

## Nadväzujúce playbooky

- `skills/design/brand-graphics.md` — brand, web/tlač a licenčné pravidlá.
- `skills/design/figma-mcp-agentic-studio.md` — design-system-first tvorba a Figma ↔ kód.
- `skills/ai-nastroje/sprint-context-200.md` — discovery banka pre väčšiu automatizáciu.
- `skills/ai-nastroje/ten-agent-sprint-run.md` — sekvenčná implementácia cez 10 agentov.

## Oficiálne zdroje

- [Canva Connect APIs](https://www.canva.dev/docs/connect/)
- [Canva Autofill APIs](https://www.canva.dev/docs/connect/api-reference/autofills/)
- [Canva Data Connector intent](https://www.canva.dev/docs/apps/intents/data-connector/)
- [Canva Data Connector implementation guide](https://www.canva.dev/docs/apps/intents/data-connector/implementation-guide/)
- [Canva Bulk Create API](https://www.canva.dev/docs/apps/api/latest/design-bulk-create-launch/)

