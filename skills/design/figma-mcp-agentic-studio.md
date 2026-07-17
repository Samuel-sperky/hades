# Figma MCP agentic studio

> Pokročilý production playbook pre čítanie, tvorbu a synchronizáciu Figma dizajnov cez MCP: design-system-first postup, agentické automatizácie, inkrementálne zápisy, vizuálna QA a bezpečný Figma ↔ kód handoff.

## Výsledok skillu

Použi tento playbook na celé obrazovky, komponenty, variables/tokens, responsive varianty, audit existujúceho súboru, import živého webu, Code Connect alebo implementáciu dizajnu do kódu. Výstup má byť natívne editovateľný vo Figme a dohľadateľný ku konkrétnemu kódu, briefu a QA záznamu.

## Povinný skill router pred MCP volaním

Figma tool nikdy nevolaj bez príslušného lokálneho návodu:

| Zámer | Povinný skill/workflow |
|---|---|
| Akýkoľvek zápis cez Plugin API | načítaj `figma-use` pred každým `use_figma` volaním |
| Nový Figma/FigJam/Slides súbor | načítaj `figma-create-new-file` pred `create_new_file` |
| Celá obrazovka, modal, panel alebo page | načítaj `figma-generate-design` spolu s `figma-use` |
| Komponent, variant set, tokens alebo knižnica | načítaj `figma-generate-library` spolu s `figma-use` |
| Diagram vo FigJame | načítaj `figma-generate-diagram` pred `generate_diagram` |
| Motion | načítaj `figma-use-motion`; pri implementácii aj `figma-implement-motion` |
| SwiftUI ↔ Figma | načítaj `figma-swiftui` a pre zápis aj `figma-use` |

Ak skill chýba, zastav pred zápisom a použi oficiálny Figma MCP návod ako fallback. Tool názov, file key ani node ID nehádaj.

## Capability mapa dostupného Figma MCP

| Potreba | Preferovaný nástroj |
|---|---|
| Identita, plány a oprávnenia | `whoami` |
| Štruktúrovaný kontext konkrétneho node | `get_design_context` |
| Prehľad strán/nodov bez známeho targetu | `get_metadata`, potom detail cez `get_design_context` |
| Vizuálna kontrola | `get_screenshot` |
| Variables použité v node | `get_variable_defs` |
| Existujúce komponenty, variables a styles | `search_design_system`, `get_libraries` |
| Natívna tvorba/úprava | `use_figma` |
| Prvý import živého webu/localhostu | `generate_figma_design` + paralelný design-system build cez `use_figma` |
| Upload bitmap assetov | `upload_assets` |
| Code Connect čítanie/mapovanie | `get_code_connect_*`, `add_code_connect_map`, `send_code_connect_mappings` |
| FigJam obsah | `get_figjam`; diagramy cez `generate_diagram` |

`get_metadata` nie je náhrada za design context. Screenshot nie je zdroj tokenov. Pixelový import webu nie je cieľová design-system implementácia.

## Vstupný kontrakt

```json
{
  "intent": "audit|create|update|sync|design-to-code|code-to-design",
  "figma_url": "",
  "file_key": "",
  "node_id": "",
  "target_page": "",
  "platform": "web|ios|android|generic",
  "framework": "react|vue|swiftui|other",
  "breakpoints": [],
  "design_system": {"libraries": [], "tokens_source": "", "code_connect": true},
  "source_paths": [],
  "acceptance": [],
  "write_scope": "draft-page|selected-node|library",
  "publish_library": false
}
```

Ak URL nemá node ID a úloha vyžaduje konkrétny node, vyžiadaj node-specific URL alebo najprv bezpečne prehliadni top-level pages. Nikdy nepíš do náhodnej aktuálnej selection.

## Design-system-first workflow

### 1. Resolve target a scope

1. Extrahuj `file_key` a `node_id` z URL bez tipovania.
2. Pri novom súbore zisti plán cez `whoami`; pri viacerých plánoch nech používateľ vyberie organizáciu.
3. Zaznamenaj presný write scope a či ide o draft, existujúcu obrazovku alebo publikovanú knižnicu.
4. Publikovanie library, zmena permissions a mazanie považuj za samostatné externé akcie.

### 2. Audit existujúceho systému

1. Získaj design context cieľového node alebo reprezentatívnych obrazoviek.
2. Vyhľadaj existujúce komponenty, variables a styles skôr, než niečo vytvoríš.
3. Načítaj relevantné library assets a Code Connect mapy.
4. Vytvor krátky inventory artefakt: reused, missing, conflicting, deprecated.
5. Pri veľkom súbore čítaj po podstromoch; neťahaj celý dokument, ak stačí jeden flow.

### 3. Plán natívnej skladby

Definuj strom frameov, auto-layout, constraints, reusable components, variants, properties, variables, modes a responsive pravidlá. Pre každú sekciu rozhodni:

- existujúca component instance vs nový komponent,
- semantic variable vs hardcoded value,
- hug/fill/fixed správanie,
- min/max a wrapping,
- content states: default, loading, empty, error, disabled,
- interaction a accessibility poznámky.

### 4. Inkrementálny zápis

Zapisuj po logických sekciách, nie jedným obrovským skriptom:

1. foundations/variables,
2. primitives a komponenty,
3. page shell,
4. obsahové sekcie,
5. states a responsive varianty,
6. prototypové/motion väzby,
7. dokumentácia a Code Connect metadata.

Každý `use_figma` call musí mať jednu zrozumiteľnú zmenu, stabilné pomenovanie a návratový report s vytvorenými/zmienenými node IDs. Po každom väčšom kroku sprav readback alebo screenshot.

### 5. Vizuálna a štruktúrna QA

- Porovnaj screenshot s briefom alebo referenciou pri dostatočnom rozlíšení.
- Znovu prečítaj design context pri problémových nodov; neopravuj iba podľa screenshotu.
- Over variables bindings, component instances, auto-layout, text overflow a constraints.
- Skontroluj compact, medium a wide správanie, nie iba jeden desktop frame.
- Over light/dark modes a dlhý lokalizovaný obsah, ak sú v scope.

### 6. Figma ↔ kód synchronizácia

Pri design-to-code:

1. načítaj design context, variables a existujúce Code Connect mapy,
2. identifikuj reálne komponenty v repozitári,
3. implementuj s existujúcimi tokenmi a patterns,
4. vizuálne porovnaj implementáciu s Figma node,
5. navrhni Code Connect mapping a ulož ho až po overení source path a component name.

Pri code-to-design web page:

1. spusti lokálny alebo existujúci web a identifikuj presnú URL,
2. do existujúceho Figma design file urob pixelový capture cez `generate_figma_design`,
3. paralelne postav natívnu verziu z design-system komponentov cez `use_figma`,
4. capture použi ako layout referenciu,
5. natívnu verziu dolaď a dočasný capture odstráň až po úspešnej kontrole a iba v dohodnutom scope.

## Agentická automatizácia

Orchestrátor používa stavový automat:

```text
DISCOVER → INVENTORY → PLAN → WRITE_CHUNK → READBACK → VISUAL_QA
                                  ↑                ↓
                                  └── FIX ≤ 2 ─────┘
                                           ↓
                                  HANDOFF → APPROVAL
```

Odporúčané roly:

1. **Context agent** — rozlíši target, framework a acceptance criteria.
2. **Design-system agent** — nájde reuse možnosti a tokeny.
3. **Composition agent** — pripraví node tree a responsive pravidlá.
4. **Figma writer agent** — vykonáva malé natívne zápisy.
5. **QA agent** — nezávisle kontroluje screenshot + štruktúru.
6. **Code sync agent** — rieši implementáciu a Code Connect.

Roly môžu bežať sekvenčne alebo vo vlnách, no do rovnakého subtree smie v danom okamihu zapisovať iba jeden agent. Súbežné Figma write operácie bez ownershipu nodov vytvárajú race conditions a drift.

## Kontrakty pomenovania

```text
Pages:       00 Foundations / 10 Components / 20 Flows / 90 Archive
Components:  Domain/Component
Variants:    property=value, state=value, size=value
Variables:   primitive.*, semantic.*, component.*
Frames:      Flow / Screen / Breakpoint / State
Sections:    [STATUS] Feature — owner — YYYY-MM-DD
```

Nepoužívaj mená ako `Frame 124`, `Rectangle 9`, `New Button` v odovzdanom výsledku. Archive nie je kôš: mazanie starých verzií je samostatne schválená akcia.

## Bezpečný Plugin API štýl

- Pred vytvorením fontových nodov načítaj konkrétny font async.
- Pre Inter používaj platné názvy štýlov ako `Semi Bold`, nie vymyslený `SemiBold`.
- Stránku prepínaj podporovanou async metódou, nie priamym zápisom do current page.
- Pre perzistentné integračné metadata používaj shared plugin data so stabilným namespace.
- Existujúce assets importuj podľa key; nekopíruj ručne celý library komponent.
- Pri chybe v chunku vráť presný krok a node IDs; nespúšťaj celý build odznova.
- Veľké obrázky uploaduj oddelene a až potom aplikuj fill.

## QA release gate

### Štruktúra

- [ ] Každý nový prvok reuse-uje existujúci komponent/token, ak existuje vhodná zhoda.
- [ ] Nové komponenty majú properties, variants, states a descriptions.
- [ ] Semantic values nie sú nahradené náhodnými HEX/px hodnotami.
- [ ] Auto-layout, hug/fill a constraints fungujú pri zmene obsahu.
- [ ] Layers a pages majú zrozumiteľné názvy.

### Responzivita a prístupnosť

- [ ] Primárna úloha je dokončiteľná v compact aj wide variante.
- [ ] Dlhý text, 200 % text a lokalizácia nerozbíjajú layout.
- [ ] Focus, hover, pressed, disabled, loading, empty a error stavy sú pokryté podľa scope.
- [ ] Kontrast, touch target a poradie obsahu spĺňajú dohodnuté kritériá.

### Handoff

- [ ] Screenshot QA prešiel pre všetky kľúčové frames.
- [ ] Design context readback potvrdil bindings a component instances.
- [ ] Code Connect smeruje na reálny source a správny komponent.
- [ ] Zmeny sú zdokumentované ako reused/created/changed/deferred.
- [ ] Library publish alebo destructive cleanup neprebehli bez schválenia.

## Recovery pravidlá

- Po prvom zlyhaní zmenši chunk a načítaj target znova.
- Po druhom rovnakom failure fingerprint zastav slučku a reportuj blocker.
- Pri permission chybe over `whoami`, plán, seat a write scope.
- Pri neznámom node ID znovu získaj metadata; nevytváraj náhradný node naslepo.
- Pri vizuálnom rozdiele over najprv tokeny a layout data, až potom dolaďuj pixely.
- Pri čiastočnom úspechu pokračuj od posledného potvrdeného node setu.

## Nadväzujúce playbooky

- `skills/design/ui-design-systems.md` — tokens, komponenty a Figma ↔ kód princípy.
- `skills/design/canva-banner-mcp-factory.md` — full-scale marketingové banner sety.
- `skills/ai-nastroje/sprint-context-200.md` — discovery pred väčším Figma/code sprintom.
- `skills/ai-nastroje/ten-agent-sprint-run.md` — postupná implementácia cez 10 agentov.

## Oficiálne zdroje

- [Figma — Get started with the MCP server](https://help.figma.com/hc/en-us/articles/39216419318551/)
- [Figma — Guide to the MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- [Figma — Remote vs desktop MCP server](https://help.figma.com/hc/en-us/articles/35281385065751-Figma-MCP-collection-Compare-Figma-s-remote-and-desktop-MCP-servers)
- [Figma — Set up the remote MCP server](https://help.figma.com/hc/en-us/articles/39890361040535-VS-Code-and-Figma-Set-up-the-MCP-server)

