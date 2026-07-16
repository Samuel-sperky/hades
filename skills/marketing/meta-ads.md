# Meta (Facebook/Instagram) Ads

> Platený social pre Aura šperky v ére po iOS 14 a AI-automatizácii: **signál + kreatíva vyhrávajú nad manuálnym cielením.**

## Prehľad — čo to je a prečo na tom pre Auru záleží

Meta Ads je reklamný systém pre Facebook, Instagram, Messenger a Audience Network, ovládaný cez **Meta Ads Manager** a spravovaný v **Business Manageri** (dnes „Meta Business Suite / Business Portfolio"). Pre šperkársku značku ako Aura je to najsilnejší kanál na **vizuálny, impulzný a darčekový predaj** — šperky sa výborne predávajú cez krátke vertikálne video (Reels/Stories), UGC „unboxing / on-the-body" zábery a retargeting.

Prečo je to dnes iné než pred pár rokmi:

- **Po iOS 14.5 / ATT** (App Tracking Transparency) veľká časť používateľov odmieta tracking. Prehliadačový Pixel sám o sebe stráca **20–40 %+ signálu**. Bez server-side trackingu (CAPI) beží optimalizácia „naslepo".
- **Cielenie sa automatizovalo.** Meta prešla na AI-driven **Advantage+**. Detailné záujmy sú len návrhy; tvrdé pravidlá sú prakticky iba lokalita a minimálny vek. Ručné skladanie záujmov už väčšinou škodí.
- **Kreatíva sa stala #1 pákou.** Keď algoritmus rieši cielenie aj rozpočet, o výsledku rozhoduje hook v prvých 3 sekundách, formát a objem čerstvých kreatív.

Pre Auru to prakticky znamená: **čistý signál (Pixel + CAPI + hodnoty objednávok) + veľa dobrého vertikálneho videa/UGC + Advantage+ na prospecting + oddelený retargeting.** Ostatné za teba spraví algoritmus.

## Kľúčové pojmy — glosár

- **Business Portfolio / Business Manager** — strešný účet, ktorý vlastní reklamné účty, Page, IG, Pixel/dataset a spravuje prístupy. **Nikdy nespúšťaj reklamy z osobného profilu.**
- **Campaign → Ad Set → Ad** — hierarchia. Kampaň = cieľ (a pri CBO rozpočet). Ad set = publikum, umiestnenia, optimalizačná udalosť, plán, prípadne rozpočet (ABO). Ad = samotná kreatíva.
- **ODAX** (Outcome-Driven Ad Experiences) — 6 cieľov: Awareness, Traffic, Engagement, Leads, App promotion, **Sales**. Pre e-shop Aura je default **Sales**.
- **Advantage+ Sales / Shopping (ASC)** — plne AI-riadená kampaň (cielenie, umiestnenia, rozpočet, prvky kreatívy). Od 2025 splynula so štandardným Sales cieľom v UI.
- **Advantage+ Audience** — nový model publika: **controls** (tvrdé pravidlá — geografia, min. vek, jazyk, vylúčené custom audiences) vs **suggestions** (návrhy — záujmy, vek, pohlavie, lookalike, ktoré Meta môže prekročiť).
- **Custom Audience** — publikum z tvojich dát (návštevníci webu cez Pixel/CAPI, CRM zoznam zákazníkov, engageri videí/IG/FB).
- **Lookalike (LLA)** — publikum podobné hodnotnému „seedu" (napr. nákupcovia, high-LTV). 1 % = najtesnejšie; širšie = väčší dosah.
- **Pixel / Dataset** — kód/entita, ktorá zbiera udalosti (events) z webu. V Events Manageri sa dnes volá **dataset**.
- **CAPI (Conversions API)** — server-side posielanie udalostí priamo z tvojho servera do Meta, mimo prehliadača. Odolné voči blokovačom a ATT.
- **Event deduplication** — posielanie **rovnakého `event_id` a `event_name`** z Pixela aj CAPI, aby Meta počítala udalosť len raz.
- **EMQ (Event Match Quality)** — skóre 0–10 kvality párovania udalostí (hašovaný email/telefón/IP…). **>8.0 = optimálne doručovanie.**
- **AEM (Aggregated Event Measurement)** — meranie konverzií pre opt-out používateľov (iOS). Od 2025 zrušený limit 8 udalostí.
- **Learning phase** — počiatočná fáza ad setu; potrebuje **~50 optimalizačných udalostí za ~7 dní**, kým sa doručovanie stabilizuje. Pod tým = „Learning Limited".
- **CBO / Advantage Campaign Budget** — rozpočet na úrovni kampane, AI ho rozdeľuje medzi ad sety. **ABO** = rozpočet na úrovni ad setu (na testovanie).
- **Hook / thumb-stop rate** — % ľudí, ktorí sa pri videu „zastavia" (3-sec view / impresie). Silné ≈ 30–40 %.
- **ROAS** — return on ad spend (tržby / náklady). **CPA / CPL** — cost per acquisition / lead. **CPM** — cena za 1000 impresií. **Frequency** — priemerný počet zobrazení na osobu.

## Best practices 2025/2026 — aktuálny stav a čo sa nedávno zmenilo

**1. CAPI nie je voliteľné — je to základ.**
Prehliadačový Pixel sám stráca 20–40 %+ konverzií. Bež **Pixel + server-side CAPI súčasne** a posielaj z oboch **rovnaké `event_id` + `event_name`**, aby Meta deduplikovala. Cieľ: **>90 % browser eventov má párový server event.** Kŕm systém prvostranovými dátami (hašovaný email = +~4 body EMQ, telefón +~3) a **posielaj hodnoty objednávok** (`value`, `currency`) — Advantage+ aj Andromeda (rankovací systém kreatív) sa učia z čistého purchase signálu. Slabý signál = najčastejší dôvod, prečo Advantage+ „nejde".
_Zmeny:_ Meta **zrušila Offline Conversions API (máj 2025)** — offline konverzie teraz idú cez štandardné CAPI. **AEM zrušil limit 8 udalostí (2025).** V roku 2026 pribudlo **one-click / zero-config CAPI** priamo v Events Manageri (bez vývojára) — ako fallback, ale skutočné server-side CAPI (napr. cez vlastný backend / gateway) dáva vyššiu kvalitu.

**2. Broad + silný signál > úzke + slabé.**
V ére Advantage+ AI-cielenie prekonáva ručné skladanie záujmov. **Detailed targeting exclusions Meta odstránila (2025)** — reportovala ~22 % lepší výkon bez nich a ~22 % vyššie tržby na dolár pri Advantage+ Sales. Používaj **Advantage+ Audience** na prospecting; záujmy zadaj max. ako „suggestion" seed. Tvrdé zostávajú len geografia, min. vek, jazyk a vylúčenia. Manuál si nechaj pre úzke B2B/regulované — pre e-shop Aura je broad správna voľba.

**3. Kreatíva je #1 páka (cielenie je automat).**
Prvé **3 sekundy = všetko**: hook + pohyb v prvých ~8 snímkoch. **UGC/creator-style** poráža uhladené brand video na studenom publiku. Pre šperky funguje **„High-Low" mix**: uhladené studiové zábery (brand autorita) + reálne UGC videá (unboxing, nosenie, „real-life"). Odporúčaný mix: ~40 % creator talking-head testimonial, ~25 % product-demo UGC, ~20 % before/after, ~15 % trend-based. **Video-first, mobile-first, 9:16, s titulkami, ~7–15 s.** Reels je najviac algoritmické umiestnenie — skóruje sa completion rate, share rate, audio engagement; reklama, čo vyzerá ako organický Reel, výrazne prekonáva „resiznuté" horizontálne video. Meta algoritmus potrebuje **~15–50+ aktívnych kreatív**, aby sa mal medzi čím rozhodovať. **Testuj jednu premennú naraz** a **naklop 3–5+ čerstvých kreatív týždenne.**

**4. Neresetuj learning phase.**
Ad set potrebuje **~50 optimalizačných udalostí / ~7 dní** (pravidlo: **týždenný rozpočet ≈ 50 × cieľová CPA**). Zmeny rozpočtu **>20 %**, výmena kreatívy, úprava publika/optimalizácie/umiestnenia **reštartujú učenie** a pália rozpočet — najdrahší zlozvyk. Winner neupravuj — **duplikuj a testuj kópiu.**

**5. Oddeľ funnel štrukturálne.**
TOFU (studené) / MOFU (teplé) / BOFU (horúce) nikdy nemiešaj v jednom ad sete — algoritmus by minul na lacné retargeting kliky. **ABO na testovanie** (malé rozpočty), **CBO / Advantage budget na škálovanie** víťazov (cost cap na ohraničenie CPA). **Message match**: reklama ↔ landing page musia sedieť.

**6. Rozhoduj podľa CPA/ROAS/CVR, nie podľa CTR.**
Kvôli ATT in-platform atribúcia podhodnocuje — sleduj aj **blended ROAS/CAC** (celkové tržby / celkový spend).

_Štrukturálna zmena 2025:_ ASC už **nie je samostatný typ kampane** v Ads Manageri — splynul so Sales cieľom. Advantage+ Sales kampane teraz majú **viac ad setov, každý s limitom 50 reklám**, custom-audience vylúčenia a demografické mantinely — čiže väčšia flexibilita (segmentácia podľa ponuky/kolekcie/typu kreatívy). Meta zároveň **deprekuje legacy campaign API** smerom k Advantage+ štruktúre.

## Krok za krokom — konkrétny workflow

1. **Základ účtu.** Business Portfolio + reklamný účet + Page + IG + dataset. Čisté vlastníctvo a prístupy (2FA). Nikdy nie osobný profil.
2. **Tracking.** Nasaď **Pixel aj CAPI**. Over v **Events Manageri**: párovanie udalostí, **deduplikáciu (rovnaké `event_id`+`event_name`)**, **EMQ >8**, deduplication rate >90 %. Nastav kľúčové udalosti: `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase` (+ `value`/`currency`).
3. **Consent & PII.** Naviaž CMP (cookie consent), hašuj PII (SHA-256), posielaj hodnoty konverzií. CAPI ťa nezbavuje povinnosti riešiť súhlas (GDPR).
4. **Vyber optimalizačnú udalosť.** Optimalizuj na **najhlbšiu udalosť s dostatkom objemu** (>50/tý. na ad set). Pre Auru zvyčajne `Purchase`; ak je objem nízky, dočasne `InitiateCheckout`/`AddToCart`.
5. **Publiká.** Prospecting = **Advantage+ Audience / broad** (+ voliteľne lookalike z nákupcov ako seed). Retargeting = samostatná kampaň (návštevníci 180 d, add-to-cart / checkout bez nákupu, IG/FB engageri, video viewers).
6. **Štruktúra kampaní.**
   - Kampaň A — **Prospecting (Advantage+ Sales, CBO)**: cielenie broad, cieľ Sales.
   - Kampaň B — **Retargeting (Sales, manuálne publiká)**: BOFU ponuka, urgencia, dynamické produkty.
   - Kampaň C — **Creative testing (ABO)**: malé rozpočty, 1 premenná na batch.
7. **Rozpočet & bidding.** Testy cez ABO (≲ малé denné rozpočty). Škálovanie cez CBO + **Cost Cap** (cieľová CPA). Pri škálovaní dvíhaj rozpočet **≤20 % naraz**, aby si nereštartol učenie.
8. **Kreatíva.** 9:16 video/UGC so silným hookom v 3 s; „High-Low" mix; titulky; ~15–50 aktívnych kreatív naprieč účtom. Advantage+ creative enhancements zapni, ale over, že nedeformujú produkt.
9. **Spustenie & learning.** Nechaj ad set nabrať ~50 udalostí / 7 dní **bez zásahov.** Nedotýkaj sa v learning fáze.
10. **Vyhodnotenie & iterácia.** Rozhoduj podľa **ROAS/CPA/CVR + blended**. Sleduj **frequency** (rast + klesajúca CTR = únava → refresh). Vypni slabé kreatívy, duplikuj a škáluj víťazov. **3–5+ čerstvých kreatív týždenne.**

## Checklist

- [ ] Business Portfolio + dataset; žiadny osobný profil; 2FA a čisté prístupy
- [ ] **Pixel + CAPI** bežia súčasne s korektnou **dedupláciou** (`event_id` + `event_name`)
- [ ] **EMQ >8**, deduplication rate **>90 %**; hašované PII (SHA-256); posielané `value`/`currency`
- [ ] CMP / consent naviazaný (GDPR)
- [ ] Optimalizácia na najhlbšiu udalosť s **≥50 konverziami/týždeň** na ad set
- [ ] Prospecting = **Advantage+ / broad**; retargeting v **samostatnej** kampani
- [ ] **ABO** na testovanie, **CBO + Cost Cap** na škálovanie
- [ ] Nezasahovať do ad setu v **learning phase**; rozpočet dvíhať **≤20 %**
- [ ] **15–50+ aktívnych kreatív**; 9:16 UGC/video; hook v prvých 3 s; titulky
- [ ] Štruktúrované testovanie 1 premennej; **3–5+ nových kreatív/týždeň**
- [ ] Funnel oddelený (TOFU/MOFU/BOFU); **message match** reklama ↔ LP
- [ ] Rozhodovanie podľa **CPA/ROAS/CVR + blended**, nie podľa CTR

## Časté chyby

- **Žiadne CAPI / len Pixel** → strata 20–40 % signálu, Advantage+ „nejde". _Fix: nasaď server-side CAPI + over EMQ/dedup._
- **Zlá deduplikácia** → dvojité počítanie konverzií a mis-training optimalizácie. _Fix: identické `event_id` + `event_name` z oboch zdrojov._
- **Úpravy ad setu počas learning phase** → reštart učenia, spálený rozpočet. _Fix: duplikuj namiesto editovania; rozpočet ≤20 %._
- **Ad set príliš malý na 50 udalostí/týž.** → „Learning Limited", nestabilné a drahé. _Fix: konsoliduj publiká, dvihni rozpočet, optimalizuj na plytší event._
- **Nadmerné granulárne cielenie záujmov** v Advantage+ ére → horší výkon. _Fix: broad + silný signál._
- **Miešanie prospectingu a retargetingu** v jednom ad sete → míňanie na lacné warm kliky, skreslený ROAS. _Fix: oddelené kampane._
- **Slabá kreatíva** (žiadny hook, horizontálne resiznuté video, uhladený brand bez UGC) → nízky thumb-stop. _Fix: 9:16 UGC, hook do 3 s, „High-Low" mix._
- **Málo kreatív / žiadny refresh** → únava publika (rastúca frequency, klesajúca CTR). _Fix: 3–5+ nových/týž., refresh každé 1–2 týž._
- **Rozhodovanie podľa CTR** namiesto konverzií → optimalizácia na klikačov, nie kupujúcich.
- **Broken message match** (reklama sľubuje X, LP ukazuje Y) → prepad konverzného pomeru.
- **Ignorovanie consent/GDPR** pri CAPI → právne riziko; CAPI ťa nezbavuje povinnosti súhlasu.

## Nástroje

- **Meta Ads Manager** — tvorba a správa kampaní.
- **Meta Events Manager** — dataset, Pixel/CAPI, test events, EMQ, deduplikácia, AEM.
- **Conversions API Gateway / one-click CAPI** — nízko-kódové nasadenie CAPI (2026 zero-config fallback v Events Manageri).
- **Meta Ads Library** — špionáž konkurencie (aktívne reklamy značiek).
- **Meta Advantage+ creative** — automatické vylepšenia kreatívy (over, že nedeformujú produkt).
- **CMP** (Cookiebot / Usercentrics / vlastný) — súhlasy a Consent Mode.
- **UTM builder + GA4** — blended atribúcia a cross-check voči in-platform.
- **Server-side GTM** — flexibilnejší CAPI setup než one-click.
- **Nástroje na UGC/video** — CapCut, Canva; AI generatívne video pre hooky a varianty.

## Zdroje

- [Meta Business Help — Advantage+ Sales / ODAX](https://www.facebook.com/business/help/153514848493595)
- [Meta for Developers — Conversions API deduplication](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events/)
- [Understanding Meta's Advantage+ Sales Campaigns (2026 Guide) — bir.ch](https://bir.ch/blog/advantage-plus-sales-campaigns-guide)
- [Meta ASC 2026 Guide — Marpipe](https://www.marpipe.com/blog/what-is-meta-asc-advantage-shopping-campaign)
- [Meta deprecates legacy campaign APIs for Advantage+ structure — ppc.land](https://ppc.land/meta-deprecates-legacy-campaign-apis-for-advantage-structure/)
- [Meta's free one-click Conversions API is now live — ppc.land](https://ppc.land/metas-free-one-click-conversions-api-is-now-live-no-developer-needed/)
- [Meta Conversions API Complete Guide (2026) — adsuploader](https://adsuploader.com/blog/meta-conversions-api)
- [Meta CAPI: Setup, Deduplication, Why You Still Need the Pixel — AdAdvisor](https://adadvisor.ai/blog/meta-conversions-api)
- [The Small Business Guide to Meta Ads Creative in 2026 — Verde Media](https://verdemedia.com/blog/the-guide-to-meta-ads-creative-2026)
- [What's Working in Meta Ads for E-Commerce (jewelry) — Milked Media](https://www.milkedmedia.com/blog/meta-ad-types-for-jewelry-brands-gcnkj)
- [Facebook Ads for Jewelry Brands: 2026 Strategy — Arktop](https://arktop.com/blog/facebook-ads-for-jewelry-brands-guide/)
- [Meta Ads Best Practices 2026 — OptiFOX](https://optifox.in/blog/meta-ads-best-practices-2026/)
