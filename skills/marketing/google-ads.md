# Google Ads

Platený výkonnostný kanál (paid search + Performance Max) na získavanie kvalifikovanej návštevnosti a predajov pre značku Aura cez Google Vyhľadávanie, Shopping, YouTube a Display.

## Prehľad — čo to je a prečo na tom Aure záleží

Google Ads je aukčný systém platenej reklamy, kde platíš za klik (CPC) alebo za konverziu. Na rozdiel od SEO (organika, dlhá hra) dáva okamžitú viditeľnosť v momente, keď má človek nákupný zámer — píše „strieborný náhrdelník darček", „ručne robené šperky Slovensko" atď.

Pre šperkársky e-shop ako Aura je to relevantné z troch dôvodov:
- **Vysoký nákupný zámer vo Vyhľadávaní** — ľudia hľadajú konkrétny produkt/darček; zachytíš dopyt v správnom momente.
- **Vizuálny produkt = Shopping a Performance Max fungujú výborne** — šperky sa predávajú obrázkom; PMax + Google Merchant Center feed dostáva produkty do Shoppingu, Discoveru aj YouTube.
- **Merateľná návratnosť (ROAS)** — pri e-shope vieš priamo priradiť tržbu ku kampani a riadiť rozpočet podľa hodnoty, nie len počtu klikov.

Kľúčová vec v 2025/2026: Google je „AI-native". Ručné riadenie ustúpilo automatizácii (Smart Bidding, broad match, PMax, AI Max for Search). Tvoja práca sa presunula od nastavovania bidov ku **kŕmeniu algoritmu kvalitnými dátami** (presné konverzie s hodnotou), poskytovaniu **kvalitných assetov** (texty, obrázky, feed) a nastavovaniu **mantinelov** (negatíva, exclusions, brand safety).

## Kľúčové pojmy — glosár

- **Kampaň / Ad group / Keyword / Ad** — hierarchia účtu. Kampaň nesie rozpočet a bidding stratégiu; ad group zoskupuje tematicky príbuzné keywords a k nim reklamy.
- **Match type (typ zhody)** — ako sa keyword páruje s dopytom: `[exact]` (presná zhoda zámeru), `"phrase"` (frázová), `broad` (voľná, dnes riadená AI + kontextom účtu).
- **Negative keywords (negatíva)** — vylučovacie slová (napr. „bižutéria", „lacné", „návod ako vyrobiť"), aby si neplatil za irelevantné dopyty. Kritické najmä pri broad match.
- **Smart Bidding** — automatické bidovanie v reálnom čase v aukcii. Hlavné stratégie: **Maximize conversions** (+ voliteľný **tCPA** target cost-per-action), **Maximize conversion value** (+ voliteľný **tROAS** target return on ad spend).
- **tCPA (Target CPA)** — cieľová cena za konverziu. Optimalizuje na počet konverzií pri danej cene.
- **tROAS (Target ROAS)** — cieľová návratnosť (tržba/náklad), napr. 400 % = 4 € tržby na 1 € nákladu. Optimalizuje na hodnotu — ideálne pre e-shop s rôznymi cenami produktov.
- **Konverzia** — sledovaná akcia (nákup, add-to-cart, lead). „Primary" konverzie riadia bidding; „Secondary" sú len pozorovacie.
- **Enhanced Conversions** — posielanie hashovaných first-party dát (email, tel.) do Googlu na presnejšie priradenie konverzií v ére bez cookies. Verzie: *for web* a *for leads*.
- **Offline Conversion Import (OCI)** — nahranie konverzií, ktoré vznikli offline (napr. potvrdená objednávka, dobierka prevzatá) späť ku kliku cez GCLID/dáta.
- **Consent Mode v2** — Google framework pre súhlas s cookies; parametre `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`. Bez neho Google v EÚ nepoužije dáta na personalizáciu/remarketing.
- **RSA (Responsive Search Ad)** — reklama vo Vyhľadávaní, kde dodáš až 15 nadpisov + 4 popisy a Google skladá kombinácie.
- **Performance Max (PMax)** — plne automatizovaná kampaň naprieč všetkými Google plochami (Search, Shopping, YouTube, Display, Discover, Gmail, Maps) riadená jedným cieľom a asset groupmi.
- **Asset group** — v PMaxe tematický balík kreatívy (nadpisy, popisy, obrázky, videá, produktový feed) okolo jednej produktovej línie / zámeru.
- **Search themes** — v PMaxe signály (frázy), ktorými navádzaš algoritmus, čo hľadať; 2026 limit až 50 na asset group.
- **Quality Score (QS)** — skóre 1–10 na keyword: Expected CTR + Ad Relevance + Landing Page Experience. Ovplyvňuje Ad Rank a cenu za klik.
- **Ad Rank** — pozícia v aukcii = bid × kvalita × kontext × očakávaný dopad assetov/extensions.
- **Ad Strength** — spätná väzba na diverzitu assetov RSA/PMax (Poor→Excellent). *Nie je* faktor Ad Ranku ani QS, ale koreluje s výkonom.
- **Assets (predtým extensions)** — sitelinky, callouts, structured snippets, ceny, obrázky, promo. Zvyšujú CTR a plochu reklamy.
- **PPC / CPC / CPA / ROAS / CTR / CVR** — pay-per-click / cost-per-click / cost-per-acquisition / return-on-ad-spend / click-through-rate / conversion-rate.
- **Data Manager API** — nové centrálne rozhranie Googlu, kam sa od 2026 migrujú uploady OCI a Enhanced Conversions for leads.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Čo sa reálne zmenilo v poslednom čase
- **PMax dostal kontrolu.** V 2025 pribudli **campaign-level negative keywords**, **channel-level reporting**, **search term insights** a **brand exclusions**. PMax už nie je „čierna skrinka" — dá sa auditovať a krotiť. Do 2026 PMax generuje ~45 % všetkých konverzií v Google Ads.
- **Search themes limit 50** na asset group (predtým 25).
- **Customer Match ako signál bez minimálnej veľkosti listu** — menšie e-shopy môžu používať zoznamy zákazníkov ako audience signal.
- **Zmena bidding systému od 17. 8. 2026:** rozpočtovo limitované tCPA/tROAS kampane budú tlačené bližšie k číslu, ktoré reálne zadáš do targetu (nie k efektívnejšiemu číslu, ktoré si algoritmus potichu našiel). Dôsledok: skontroluj a prípadne uprav svoje targety pred týmto dátumom.
- **Migrácia na Data Manager API od 15. 6. 2026:** OCI a Enhanced Conversions for leads uploady sa presúvajú z Google Ads API do Data Manager API. Ak nahrávaš cez API/tretie strany, over si, že prejdeš na nový endpoint, inak sa uploady zablokujú.
- **AI Max for Search** — nová vrstva automatizácie search kampaní (broad match + AI dotváranie textov/URL). Testuj oddelene, s tesnými negatívami.
- **Consent Mode v2 je povinný predpoklad**, nie „nice to have". Bez `ad_user_data` a `ad_personalization` súhlasov Google dáta nepoužije — padne remarketing aj presnosť konverzií.

### Štruktúra účtu (Aura)
- **Nepreštruktúrovávaj.** Najväčšia chyba 2026 je over-segmentácia. Každá kampaň by mala vygenerovať **min. 30 konverzií/mesiac**, inak sa dátový bazén rozdrobí a algoritmus hladuje.
- **Oddeľ Brand kampaň** (dopyty „Aura šperky", názov značky) od Non-brand. Brand má lacné kliky a vysokú CVR; miešaním si skreslíš ROAS a metriky.
- Odporúčaná kostra pre Aura:
  1. **Brand Search** (exact + phrase na názov značky).
  2. **Non-brand Search** — tematické ad groups podľa kategórií (náhrdelníky, náušnice, prstene, darčeky, personalizované šperky).
  3. **Performance Max (Shopping-driven)** s Merchant Center feedom — jadro e-shop výkonu; asset groupy podľa produktových línií.
  4. (voliteľne) **PMax / Demand Gen na darčekové sezóny** (Vianoce, Valentín, Deň matiek).
- **Tematické ad groups** — jedna úzka téma = jedna ad group = keywords + RSA + landing page na tú tému. Nemiešaj „prstene" a „náušnice" v jednej ad group.

### Keywords, match types a negatíva
- **Moderný prístup:** broad match + Smart Bidding + silné negatíva. Broad dnes nie je „divoký" — riadi ho AI podľa kontextu účtu, landing page a konverzných dát. Ale bez Smart Biddingu a negatív broad match páli rozpočet.
- Konzervatívnejšia varianta pre menší rozpočet: začni na **phrase + exact**, rozširuj na broad, keď máš konverzné dáta.
- **Negatíva sú nekonečná práca.** Pravidelne čítaj **Search Terms report** a pridávaj vylučovačky: „bižutéria", „lacné", „fake", „návod", „ako vyrobiť", „bazár", konkurenčné značky ak nechceš na ne mieriť, nesúvisiace materiály.
- Používaj **negatívne keyword listy** (zdieľané naprieč kampaňami) na globálne vylúčenia.
- V PMaxe využívaj **campaign-level negative keywords** a **brand exclusions**.

### Smart Bidding
- **Pre e-shop Aura choď na hodnotu, nie na počet:** Maximize conversion value + **tROAS** (nie len tCPA), pretože šperky majú rôzne ceny a marže.
- **Dátové prahy:** tCPA sa stabilizuje pri ~**30 konverziách/mesiac**; tROAS potrebuje viac — cieľ **50+ konverzií/mesiac** s presnými hodnotami tržieb.
- **Nastavovanie targetov:**
  - tROAS začni na svojom reálnom 30-dňovom priemernom ROAS a uťahuj po **10–15 %** týždenne, nie denne.
  - tCPA začni na alebo mierne nad reálnym priemerným CPA a znižuj postupne.
  - **Žiadna zmena targetu ani rozpočtu > 20 % naraz** — väčší skok resetuje learning phase a zmaže nazbieraný signál.
- **Learning phase** trvá cca 1–2 týždne / do ~30 konverzií. Počas nej nerob veľké zásahy ani nesúď výkon.
- **Portfolio bid strategies** — zdieľanie jedného tCPA/tROAS naprieč kampaňami, keď žiadna sama nemá dosť dát.
- **Seasonality adjustments** — vopred oznám krátke ostré špičky (napr. 3-dňová Valentínska akcia), aby algoritmus nereagoval oneskorene.
- Ak nemáš dosť konverzií, začni s **Maximize conversions bez targetu**, potom pridaj target.

### Konverzie a meranie (najdôležitejšia časť)
- **Základ:** GA4 + Google Ads conversion tag cez **Google Tag / GTM**. Meraj **nákup s dynamickou hodnotou a menou** (`value`, `currency`), nie len počet.
- **Enhanced Conversions for web ZAPNI vždy** — najlacnejší okamžitý nárast presnosti. Posiela hashované (SHA-256) email/tel. z pokladne, matchuje na prihlásených Google userov aj bez cookies.
- **Consent Mode v2** musí bežať v „advanced" režime ideálne, s korektnými signálmi `ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`. Bez `ad_user_data`/`ad_personalization` Google dáta nepoužije → nulové/podhodnotené konverzie a mŕtvy remarketing.
- **Offline Conversion Import (OCI)** — ak časť objednávok potvrdzuješ/rušíš neskôr (dobierka, storná, vrátenia), nahrávaj **reálne dokončené tržby** späť. Zlepšuje to učenie tROAS (algoritmus sa učí na skutočnej hodnote, nie na košíkoch, čo sa zrušia). Import cez GCLID alebo cez hashované dáta (Enhanced Conversions for leads princíp).
- **2026 migrácia:** OCI a EC-for-leads uploady prejdú na **Data Manager API** (blokácia v Google Ads API od 15. 6. 2026). Skontroluj integráciu.
- **Jedna primárna konverzia na cieľ kampane.** Micro-konverzie (add-to-cart, newsletter) daj ako *secondary*, aby si mal insight, ale neriadili bidding.
- Over **atribučný model** (dnes default data-driven) a **conversion window**.

### Responsive Search Ads (RSA)
- Dodaj **max. 15 nadpisov + 4 popisy**; čím viac kvalitných a rôznorodých, tým viac kombinácií.
- **Hlavný keyword daj do aspoň 3–4 nadpisov** (asset-keyword relevance → Ad Strength aj QS).
- **Pinning s mierou:** pinuj len nutné (názov značky, hlavné CTA, právne nutné). Ak už pinuješ, daj **2–3 unikátne verzie na tú istú pozíciu**, nech má systém čo testovať. Nepinuj identické texty.
- **Cieľ Ad Strength „Good"→„Excellent"**: zlepšenie z Poor na Excellent = priemerne +15 % konverzií. Ale pamätaj: Ad Strength *nie je* Ad Rank ani QS — je to feedback na diverzitu, nie skóre aukcie. Nesleduj ho na úkor relevancie.
- Píš **benefity + USP Aury** (ručná výroba, personalizácia, darčekové balenie, doručenie, záruka), rôzne uhly, rôzne dĺžky.
- Doplň **assety/extensions**: sitelinky (kategórie), callouts (doprava zdarma, ručná výroba), structured snippets, obrázkové assety, ceny, promo počas akcií.
- Pravidelne nahrádzaj assety označené „Low" novými (label Learning/Low/Good/Best).

### Performance Max
- **Nespúšťaj PMax ako prvé.** Poradie: (1) správne konverzie + Enhanced Conversions + reálne hodnoty, (2) profitabilný Search základ, (3) až potom PMax s jedným cieľom.
- **Konsolidovaná štruktúra:** radšej menej PMax kampaní so silnými dátami než veľa malých. Segmentuj len ak má každá dosť konverzií.
- **Asset groupy podľa témy** (produktová línia / zámer), nie „všetko v jednej". Vyššia relevancia = lepšia optimalizácia.
- **Naplň asset group celú:** všetky nadpisy, dlhé nadpisy, popisy, kvalitné obrázky (rôzne pomery strán), **video** (ak nedodáš, Google vygeneruje slabé — dodaj vlastné), logo.
- **Search themes** (až 50) na navádzanie; **audience signals** (Customer Match, návštevníci webu, in-market) na naštartovanie učenia.
- **Mantinely nastav PRED spustením, nie po minutí rozpočtu:** brand exclusions, campaign-level negatíva, account-level negatíva, vylúčenie nevhodných umiestnení, prípadne URL expansion off ak nechceš, aby Google púšťal na iné URL.
- Pre Merchant Center feed: kvalitné **product titles, obrázky, GTIN, kategórie, ceny, dostupnosť** — feed je 50 % úspechu Shoppingu/PMaxu.
- Sleduj **channel-level** a **search term insights**, aby si videl, kam PMax reálne míňa.

### Quality Score
- Tri zložky: **Expected CTR, Ad Relevance, Landing Page Experience.** Vyššie QS = nižšia CPC a lepší Ad Rank.
- **Zosúlaď triádu keyword → reklama → landing page.** Keyword v nadpise RSA, ten istý sľub na landing page.
- **Landing page experience** = rýchlosť (Core Web Vitals), mobilná verzia, relevantný obsah, jasné CTA, dôvera (recenzie, doprava, kontakt). Toto Google váži silno aj v 2025.
- Nízke QS (1–4) → nájdi príčinu v jednej z troch zložiek a oprav; nezvyšuj len bid.

## Krok za krokom — nasadenie od nuly (Aura)

1. **Meranie najprv.** Nastav GA4 + Google Ads conversion tracking cez Google Tag/GTM. Meraj nákup s dynamickou `value` a `currency`.
2. **Zapni Enhanced Conversions for web** (v Google Ads → Goals → Conversions → nastavenie tagu; over v Tag Diagnostics, že sa posielajú hashované dáta).
3. **Nastav Consent Mode v2** (cez CMP — napr. Cookiebot/Usercentrics) so všetkými 4 signálmi. Otestuj v Tag Assistant, že sa `ad_user_data`/`ad_personalization` posielajú po súhlase.
4. **Prepoj Merchant Center** a nahraj produktový feed; over schválenie produktov a kvalitu titles/obrázkov.
5. **Postav Brand Search kampaň** (exact + phrase na „Aura" + variácie), malý rozpočet, RSA s USP.
6. **Postav Non-brand Search** — 3–6 tematických ad groups podľa kategórií; phrase/exact na štart, RSA s keywordom v nadpisoch, plné assety.
7. **Nasaď negatívne keyword listy** (bižutéria, lacné, návod, bazár, fake…).
8. **Bidding:** začni **Maximize conversions** (alebo Max conversion value, ak máš dosť dát), po nazbieraní ~30 konverzií prejdi na **tCPA/tROAS** so štartovacím targetom = reálny priemer.
9. **Spusti Performance Max** s Merchant feedom, asset groupmi podľa línií, search themes, audience signals a nastavenými mantinelmi (brand exclusions, negatíva).
10. **(Voliteľne)** nastav Offline Conversion Import na potvrdené/vrátené objednávky — cez Data Manager API (2026).
11. **Nechaj bežať learning phase** (~2 týždne / 30 konverzií) bez veľkých zásahov.
12. **Prejdi na optimalizačný rytmus** (nižšie).

## Checklist

**Setup**
- [ ] GA4 + Google Ads conversion tracking cez Google Tag/GTM, nákup s `value` + `currency`
- [ ] Enhanced Conversions for web zapnuté a overené v diagnostike
- [ ] Consent Mode v2 (advanced) so 4 signálmi, otestované cez Tag Assistant
- [ ] Merchant Center prepojený, feed schválený, kvalitné titles/obrázky/GTIN
- [ ] Brand a Non-brand kampane oddelené
- [ ] Negatívne keyword listy nasadené
- [ ] Jedna primárna konverzia na cieľ; micro-konverzie ako secondary
- [ ] Atribúcia (data-driven) a conversion window skontrolované

**Kampane**
- [ ] Tematické ad groups (jedna téma = keywords + RSA + landing)
- [ ] RSA: 15 nadpisov / 4 popisy, keyword v 3–4 nadpisoch, pinning s mierou, Ad Strength ≥ Good
- [ ] Assety: sitelinky, callouts, snippets, obrázky, ceny, promo
- [ ] PMax: plné asset groupy, vlastné video, search themes, audience signals, mantinely PRED štartom
- [ ] Bidding zodpovedá dátam (Max conv → tCPA/tROAS), target = reálny priemer

**Priebežne**
- [ ] Search Terms report čítaný, negatíva pridávané (týždenne)
- [ ] Zmeny targetu/rozpočtu ≤ 20 % naraz
- [ ] Learning phase nerušený veľkými zásahmi
- [ ] Nízke QS (1–4) diagnostikované po zložkách
- [ ] Data Manager API migrácia (OCI/EC-leads) vyriešená pred 15. 6. 2026
- [ ] tCPA/tROAS targety skontrolované pred 17. 8. 2026 (zmena bidding systému)

## Časté chyby

- **Over-segmentácia** — priveľa malých kampaní/asset groups, dáta sa rozdrobia, algoritmus hladuje. Konsoliduj na ≥ 30 konverzií/kampaň/mesiac.
- **Miešanie Brand a Non-brand** — skreslí ROAS a rozhodnutia. Oddeľ.
- **Spustenie PMaxu bez konverzného základu** — bez presných hodnôt a bez Search základu PMax pláva. Meranie a Search najprv.
- **Zmeny targetu > 20 % / denné ladenie** — reset learning phase. Uprav max o 10–20 %, týždenný rytmus.
- **Súdenie výkonu počas learning phase** — počkaj ~2 týždne / 30 konverzií.
- **Broad match bez negatív a bez Smart Biddingu** — istá cesta k spálenému rozpočtu. Broad iba s AI biddingom + tvrdými negatívami.
- **Ignorovanie Search Terms reportu** — bez pravidelných negatív platíš za „návod ako vyrobiť náhrdelník".
- **Over-pinning RSA** — zablokuješ testovanie kombinácií a znížiš Ad Strength. Pinuj len nutné, po 2–3 verziách.
- **Optimalizácia na Ad Strength ako keby to bol QS** — nie je faktor aukcie; prioritou je relevancia a landing page.
- **Zabudnutý/zle nastavený Consent Mode v2** — v EÚ padne remarketing a presnosť konverzií; audience listy sa neplnia.
- **Meranie počtu namiesto hodnoty** — pri rôznych cenách šperkov riaď tROAS na tržbu, nie tCPA na počet.
- **Slabý/žiadny produktový feed** — pri vizuálnom produkte je feed polovica výkonu. Rieš titles, obrázky, GTIN.
- **Zanedbaný landing page (rýchlosť, mobil, dôvera)** — ťahá dole QS aj CVR bez ohľadu na kvalitu reklamy.

## Nástroje

- **Google Ads** (webové UI + Editor pre hromadné zmeny) — správa kampaní.
- **Google Ads Editor** — offline bulk editácia, kópie kampaní, rýchle zmeny.
- **Google Tag Manager** — nasadenie tagov, Consent Mode, Enhanced Conversions.
- **Google Analytics 4** — konverzie, publiká, atribúcia, cross-channel pohľad.
- **Google Merchant Center (Next)** — produktový feed pre Shopping/PMax.
- **Google Data Manager** — centrálne uploady konverzií/first-party dát (od 2026).
- **Google Keyword Planner** — výskum keywords, objemy, odhady CPC.
- **CMP (Cookiebot / Usercentrics)** — súhlasy + Consent Mode v2.
- **Tag Assistant / Google Ads Tag Diagnostics** — validácia meraní.
- **Optmyzr / Adalysis** (voliteľné) — automatizácia optimalizácie, RSA/skript audity, alerty.
- **Ahrefs / Keyword Planner** — negatíva a rozšírenie keyword setu z dopytov.

## Zdroje

- [Google Ads Help — About Target CPA bidding](https://support.google.com/google-ads/answer/6268632)
- [Google Ads Help — About Ad Strength for RSAs](https://support.google.com/google-ads/answer/9921843)
- [Google Ads Help — Best practices for effective RSAs](https://support.google.com/google-ads/answer/6167122)
- [Google Ads Help — About offline conversion imports](https://support.google.com/google-ads/answer/2998031)
- [Google Ads API — Manage offline conversions](https://developers.google.com/google-ads/api/docs/conversions/upload-offline)
- [GROAS — Google Ads Best Practices 2025 & 2026: AI-Native Era](https://www.groas.com/post/google-ads-best-practices-2025-2026-complete-updated-guide-ai-native-era)
- [GROAS — Smart Bidding Learning Period 2026: tCPA vs tROAS](https://www.groas.com/post/google-ads-smart-bidding-learning-period-2026-tcpa-vs-troas-strategy-guide)
- [GROAS — Bidding Strategies 2026: Manual CPC, Smart Bidding, tCPA, tROAS](https://www.groas.com/post/google-ads-bidding-strategies-2026-complete-guide-manual-cpc-smart-bidding-tcpa-troas)
- [RankQ — Google Ads Update 2026: New tCPA & tROAS Bidding Changes](https://blog.rankq.ai/2026/07/09/google-ads-update-2026-new-tcpa-troas-bidding-changes-explained/)
- [JumpFly — Mastering Google Performance Max: A 2026 Strategy Guide](https://www.jumpfly.com/blog/mastering-google-performance-max-a-2026-strategy-guide/)
- [Store Growers — Performance Max for Ecommerce: What Actually Works in 2026](https://www.storegrowers.com/performance-max-campaigns/)
- [DigitalApplied — Google Ads Performance Max 2026: Campaign Guide](https://www.digitalapplied.com/blog/google-ads-performance-max-2026-campaign-guide)
- [CustomerLabs — Google Consent Mode v2 for Offline Conversions](https://www.customerlabs.com/blog/google-consent-mode-v2-offline-conversions/)
- [Advantrise — Why offline conversions stopped being optional in 2026](https://advantrise.com/offline-conversions-ecommerce-google-ads)
- [PPC Mastery — The 2025 guide to Google Ads Conversion Tracking](https://www.ppcmastery.com/blog/tpe-121-tracking)
- [Brand Llama — Best Practices for Google RSAs in 2025](https://www.brandllama.com/best-practices-for-google-responsive-search-ads-in-2025/)
