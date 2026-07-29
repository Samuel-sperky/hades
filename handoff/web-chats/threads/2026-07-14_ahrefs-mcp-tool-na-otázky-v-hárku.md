# Ahrefs MCP tool na otázky v hárku

- **UUID:** 04cb1933-ca65-4901-80a3-123b95ab44c6
- **Vytvorené:** 2026-07-14T14:50
- **Aktualizované:** 2026-07-14T15:00
- **Správ:** 4

---

### 🧑 Používateľ
*(prílohy: SEO-porada-otazky (2).xlsx)*

použi ahrefs MCP tool a odpovedz mi na otázky v hárku

### 🤖 Claude
[tool_use: view]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: tool_search]

[tool_result]

[tool_use: Ahrefs:doc]

[tool_result]

[tool_use: Ahrefs:rank-tracker-overview]

[tool_result]

[tool_use: Ahrefs:rank-tracker-overview]

[tool_result]

[tool_use: Ahrefs:rank-tracker-overview]

[tool_result]

[tool_use: Ahrefs:rank-tracker-overview]

[tool_result]

[tool_use: Ahrefs:rank-tracker-overview]

[tool_result]

[tool_use: Ahrefs:rank-tracker-overview]

[tool_result]

[tool_use: Ahrefs:doc]

[tool_result]

[tool_use: Ahrefs:rank-tracker-competitors-domains]

[tool_result]

[tool_use: Ahrefs:rank-tracker-competitors-pages]

[tool_result]

Dáta stačia. Zápis odpovedí do hárku.

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Vyplnené z Ahrefs Rank Trackera (projekt 9364794, sperky-eshop.sk, 30. 6. vs 31. 5. 2026, desktop). Doplnených 24 prázdnych otázok; existujúce odpovede nedotknuté.

Kľúčové zistenia z dát:

**Pohyby KW (ot. 45–47, 66–67).** Do TOP 3 vstúpili zlaty privesok (10→3), zlaté prstene dámske (6→2), snubné prstene (11→2), strieborné prívesky (24→2), strieborný náhrdelník (9→1). Kritické prepady: striebro 6→51, zlate prstene 12→51, strieborný prsteň 3→16, strieborne nausnice 13→17 (volume 4 200); „zlaté retiazky na ruku" vypadli z TOP 50 úplne. Prepad je koncentrovaný v striebornom segmente (kategórie /68, /54, /66, /53).

**Kanibalizácia (ot. 44).** Piercing klaster: na jedno KW ranká 6–8 URL (falosny piercing, piercing do ucha z chirurgickej ocele, zlaty piercing do nosa).

**Konkurencia (ot. 57–59).** SoV MoM: iZlato 132,4→156,7; sperky-eshop 42,8→58,4 (+36 %); olivie.sk 19,9→54,7 (2,7×); yesjewellery.com 6,1→25,1 (4×). iZlato rastie presne tam, kde vy strácate: pánske/dámske zlaté retiazky a detské zlaté náušnice (SoV stránky zlate-retiazky-panske 6,6→11,7; zlate-nausnice-detske 2,4→7,5).

Nevyplnené a prečo: ot. 25, 65, 70–71 vyžadujú GA4/e-shop a interný changelog; ot. 27–28 kompletný rozpad 81 skupín presahuje limit 250 riadkov na API dotaz (v bunkách je čiastkový sumár + odkaz na dashboard); ot. 56 vyžaduje Content Gap endpoint, ktorý MCP neexponuje – link na Content Gap report je už v hárku pri ot. 49.

### 🧑 Používateľ
dopln mi tam relavatne link yna ahrefs kde najdem nahlad na informaciu

### 🤖 Claude
[tool_use: bash_tool]

[tool_result]

[tool_use: bash_tool]

[tool_result]

[tool_use: present_files]

[tool_result]

Linky doplnené do stĺpca D pri každej zodpovedanej otázke (ak tam už bol poznatok, link je pripojený na novom riadku).

Použité odkazy:

**Rank Tracker** (ot. 39–47, 60–62, 64, 66–68): `https://app.ahrefs.com/rank-tracker/overview/9364794` — pri každej otázke je dopísané, ktorý pohľad použiť (Compare 31.5.→30.6., stĺpec Volume/URL/Change, filter Tags, zoradenie podľa Change).

**Rank Tracker → Competitors** (ot. 57–59): rovnaký projekt, záložka Competitors — Share of voice, konkurenčné stránky a domény.

**Content Gap** (ot. 56): prevzatý presný URL, ktorý už bol v hárku pri ot. 49 — obsahuje kompletnú sadu 10 konkurentov (izlato, olivie, sofia, yesjewellery, glamira, lotsi, creyo, gregandrich, e-sperk, isperky) s dátumom 30. 6. 2026.

**GSC Performance** (ot. 41, 63): `https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain:sperky-eshop.sk`.

Poznámka: Ahrefs nemá stabilné deep-linky na konkrétny filter v Rank Trackeri, preto linky vedú na projekt a filter/pohľad je popísaný textom vedľa. Content Gap link je jediný s plnými parametrami, lebo pochádza priamo z tvojho hárku.

