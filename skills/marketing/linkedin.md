# LinkedIn Ads + B2B

> Playbook pre B2B rast Aura cez LinkedIn — platené kampane (Sponsored Content, Message/Conversation Ads, Lead Gen Forms), presné targetovanie podľa pozície/firmy, organický obsah, personal branding, thought leadership a konverzné sledovanie (Insight Tag + CAPI).

## Prehľad — čo to je a prečo to má zmysel pre Aura

LinkedIn je jediná veľká platforma, kde targetuješ ľudí podľa **pracovnej pozície, firmy, odvetvia a seniority** — nie podľa záľub. Pre Aura (šperky) to nie je hlavný predajný kanál pre B2C spotrebiteľa (tam patrí Instagram/Meta), ale je to **prvotriedny B2B a brand kanál** pre tieto ciele:

- **Firemné a korporátne objednávky** — dary pre zamestnancov, jubilejné a výročné šperky, VIP klientské dary, promo predmety pre firmy (HR, Office Manager, Procurement, Marketing).
- **B2B partnerstvá a wholesale** — butiky, hotely, wedding plannery, event agentúry, concierge služby.
- **Personal branding zakladateľky/majiteľky** — thought leadership okolo remesla, dizajnu, udržateľnosti, budovania značky. Na LinkedIn generuje osobný profil ~**8× viac engagementu než firemná Page**.
- **Nábor a dodávateľské vzťahy** — hľadanie remeselníkov, fotografov, agentúr.
- **Recruitment retargeting a insight** — kto navštívil web, z akých firiem, aké pozície.

Realita nákladov: LinkedIn je drahý (medián CPC ~4 USD, bežne 5–12 USD; CPL ~50–130 USD). Preto sa oplatí len na **vysoko-hodnotné B2B ciele**, nie na lacný dosah. Pre lacný awareness používaj Meta/Instagram; LinkedIn nasadzuj cielene na firemný segment.

> Dôležité pre EU: **Message Ads a Conversation Ads sa v EU nedajú štandardne cieliť** (doručia sa len členom, ktorí výslovne súhlasili so sponzorovanými správami v inboxe — reálne minimálny dosah). Ak je Aura zo SR/EU a cieli EU publikum, **spoľahni sa na Sponsored Content + Lead Gen Forms**, nie na Message Ads.

## Kľúčové pojmy — glosár

- **Campaign Manager** — reklamný nástroj LinkedIn (obdoba Meta Ads Manager / Google Ads).
- **Účtová hierarchia** — Ad Account → Campaign Group → Campaign → Ad. Rozpočet a bidding sa nastavuje na úrovni **Campaign**.
- **Objective-Based Advertising (OBA)** — voľba cieľa (Awareness, Consideration: Website visits / Engagement / Video views, Conversions: Lead generation / Website conversions / Talent leads). Cieľ určuje dostupné formáty a optimalizáciu.
- **Sponsored Content** — natívne reklamy v hlavnom feede. Podformáty: **Single Image, Video, Carousel, Document (PDF), Thought Leader Ad, Event Ad, Click-to-Message**.
- **Thought Leader Ad** — sponzorovanie príspevku z **osobného profilu** (nie z firemnej Page). Silný formát pre dôveryhodnosť — funguje ako natívny post od človeka, nie od značky.
- **Document Ad** — sponzorovaný PDF (lookbook, cenník, katalóg). V kombinácii s Lead Gen Form dosahuje **~2× vyššiu mieru vyplnenia** než iné feed formáty.
- **Message Ads / Conversation Ads** — reklamy doručené do LinkedIn inboxu (Conversation = vetvený s viacerými CTA). **V EU obmedzené** (viď vyššie).
- **Lead Gen Form (LGF)** — natívny formulár, ktorý sa **predvyplní** profilovými dátami člena. Konverzný pomer ~13 % vs. ~4 % na landing page; nižší CPL. Lead sa neposiela na web — ostáva na LinkedIn.
- **Insight Tag** — JavaScript snippet na webe. Zbiera konverzie, retargeting publikum a demografiu návštevníkov. Používa **Partner ID**.
- **Conversions API (CAPI)** — server-to-server posielanie konverzií (obchádza blokovanie cookies/ad-blockerov). Kombinuje sa s Insight Tagom cez **zdieľané `eventId`** kvôli deduplikácii.
- **Signals Manager** — nová sekcia v Campaign Manageri (Data → Signals manager), kde spravuješ Insight Tag, CAPI zdroje a generuješ CAPI token.
- **Matched Audiences** — vlastné publiká: Website Retargeting, Contact List upload (CRM), Company List (ABM), Video/Lead Form/Event/Page engagement retargeting.
- **Lookalike / Audience Expansion / Predictive Audience** — automatické rozšírenie na podobných používateľov. **Predictive Audience** sa buduje zo seed zdroja (napr. lead list, konverzie).
- **ABM (Account-Based Marketing)** — cielenie na konkrétny zoznam firiem (Company List) namiesto širokých kritérií.
- **CTR / CPC / CPM / CPL / CPO** — Click-Through Rate / Cost-Per-Click / Cost-Per-Mille / Cost-Per-Lead / Cost-Per-Opportunity.
- **Maximum Delivery vs. Manual/Cost Cap bidding** — automatické vs. manuálne riadenie ceny za výsledok.
- **Frequency cap / learning** — LinkedIn nemá agresívnu learning fázu ako Meta, ale malé publiká a nízke rozpočty sa učia pomaly.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

**Formáty a kreatíva**
- **Thought Leader Ads sú dnes najsilnejší formát** pre dôveru — sponzoruj posty z osobného profilu zakladateľky. Ľudia dôverujú tváram, nie logám.
- **Multi-format kampane vyhrávajú.** Kombinácia Sponsored Content + Video + Document + Lead Gen je až **~6× pravdepodobnejšie konvertujúca** než jediný formát. Postupnosť: content (TOF) → video (MOF) → lead gen (BOF).
- **Video renesancia:** natívne **vertikálne video (4:5 alebo 9:16), do 60 s, s titulkami** (73 % zhliadnutí je z mobilu). Video zaznamenalo ~69 % nárast výkonu oproti 2024.
- **Document Ads** (PDF katalóg/lookbook) sú pre šperky ideálne — vizuálne, listovateľné, natívne.

**Lead Gen Forms**
- Použi **len 3–4 polia** (nie max. 12). Menej polí = vyššia konverzia.
- **Headline ako otázka do 120 znakov**, zameraná na benefit, nie na detaily.
- Vždy nastav **thank-you CTA** (link na web/katalóg) a **automatický export leadov** do CRM (cez natívnu integráciu alebo Zapier) — leady na LinkedIn "nezhnijú" v Campaign Manageri.
- LGF konvertuje **2–3× vyššie** než externá landing page.

**Targetovanie (zmeny 2025)**
- **Intent a behaviorálne dáta** sú presnejšie — dá sa cieliť podľa preukázaných záujmov/in-market signálov, nielen statickej pozície.
- **Nezužuj publikum príliš.** Odporúčaný minimálny rozsah je **~50 000+** pre Sponsored Content. Príliš úzke ABM publiká zdražujú a spomaľujú učenie.
- Cieľ podľa **Job Title + Job Function + Seniority + Company Industry + Company Size**; pre firemné dary napr. *Job Function: Human Resources / Administrative + Seniority: Manager+ + Company Size: 51–1000+*.
- **Vylúč** irelevantných (napr. študentov, konkurenciu, vlastných zamestnancov cez Company List exclude).
- **Audience Expansion / Predictive Audiences** zapni pri väčších rozpočtoch; pri malých testovacích drž vypnuté kvôli kontrole.
- **EU obmedzenia:** Message/Conversation Ads necieľ na EU. Pozor aj na obmedzenia mikro-targetingu zavedené po tlaku regulátorov (LinkedIn zúžil niektoré citlivé kritériá).

**Konverzné sledovanie (zmeny 2025)**
- **Insight Tag + CAPI súčasne** je dnes best practice — klientská aj serverová strana pre odolnosť voči blokovaniu cookies. Bez CAPI strácaš časť konverzií.
- CAPI token generuješ v **Signals Manager** (Data → Signals manager → zdroj napr. GTM → Generate token).
- **Deduplikácia cez zdieľané `eventId`** na oboch stranách — inak dvojité počítanie.
- **Consent Mode / súhlas:** Insight Tag spúšťaj až po súhlase s marketingovými cookies (GDPR); serverová CAPI musí tiež rešpektovať právny základ.

**Organika, algoritmus a personal branding (zmeny 2025/2026)**
- Od ~augusta 2025 LinkedIn používa **LLM na pochopenie kontextu obsahu** — hodnotí zmysel a relevanciu, nie len počty lajkov. Kvalita a niche autorita > vanity engagement.
- **Osobné profily > firemné Pages** (~8× engagement; organický dosah firemných postov je len ~2 % feedu). Firemná Page = hub pre reklamy/nábor; **thought leadership rob cez osobný profil**.
- **3–4 relevantné hashtagy** na post. **Viac ako 5 hashtagov = ~68 % pokles dosahu.**
- **Employee advocacy:** posty zamestnancov majú ~2× vyšší engagement než brand posty; leady z employee obsahu konvertujú výrazne vyššie.
- **Thought leadership ovplyvňuje nákup:** vyše 55 % skrytých rozhodovateľov ho používa pri hodnotení dodávateľa; časť C-suite platí prémiu firmám s jasnou víziou. Pre firemné dary a wholesale je to reálny predajný nástroj.
- **Dokumenty/carousely a natívne video** dostávajú vyšší dosah než čisté odkazy von z platformy. Externé linky daj do **prvého komentára**, nie do tela postu.

**Benchmarky 2025/2026 (orientačne, B2B)**
- CPC: medián ~**3,9 USD**, bežne 2–6 USD; C-suite publiká 12 USD+.
- CPL (Lead Gen Form): ~**50–130 USD** podľa odvetvia; MOF kampane 120–250 USD.
- Sponsored Content CTR: zdravé ~**0,4–0,8 %+**.
- Minimálny denný rozpočet na kampaň je ~**10 USD/deň**; reálny test potrebuje viac.

## Krok za krokom — pracovný postup

1. **Založ / nastav Ad Account** v Campaign Manageri, prepoj na firemnú **Company Page** (nutná pre Sponsored Content) a nastav fakturáciu (mena EUR).
2. **Nasaď Insight Tag** na celý web (GTM alebo priamo do `<head>`). Over cez LinkedIn Insight Tag Helper (Chrome) alebo Tag Assistant, že tag "fires" a zbiera domény.
3. **Nastav CAPI** v Signals Manager: zdroj (napr. server-side GTM) → Generate token → posielaj kľúčové eventy serverom so **zdieľaným `eventId`** ako web tag.
4. **Definuj konverzie** (Data → Conversion tracking): napr. *Odoslanie dopytu*, *Stiahnutie katalógu*, *Objednávka*. Priraď hodnotu a atribučné okno.
5. **Postav publiká** v Audiences:
   - Website Retargeting (návštevníci web / konkrétne stránky).
   - Company List (ABM zoznam cieľových firiem — butiky, hotely, event agentúry).
   - Contact List (CRM export existujúcich B2B kontaktov).
   - Predictive Audience zo seed listu pre škálovanie.
6. **Vytvor Campaign Group** (napr. "B2B Firemné dary Q4") a v nej kampane podľa fázy lievika.
7. **TOF kampaň** — cieľ *Brand awareness / Video views*: Thought Leader Ad + natívne video o remesle/značke. Široké relevantné publikum (Industry + Seniority), Audience Expansion podľa rozpočtu.
8. **MOF kampaň** — cieľ *Engagement / Website visits*: Document Ad (lookbook/katalóg), retargeting návštevníkov + video viewers.
9. **BOF kampaň** — cieľ *Lead generation*: **Lead Gen Form** (3–4 polia, headline ako otázka), retargeting angažovaných + ABM Company List. Alternatíva *Website conversions* ak chceš viesť na web s presnou konverziou.
10. **Kreatíva:** min. 2–4 varianty na kampaň (rôzne hooky/vizuály). Vertikálne video s titulkami, čisté produktové zábery, jasné CTA.
11. **Bidding:** začni **Maximum Delivery** (auto), po nazbieraní dát prejdi na **Cost Cap / Manual** pri stabilnom CPL. Frequency sleduj — pri malom publiku znižuj únavu.
12. **Spusti a nechaj bežať min. 2 týždne** pred väčšími zásahmi (LinkedIn dáta chodia pomaly, malé objemy).
13. **Napoj export leadov** (LGF → CRM/Zapier) a nastav rýchly follow-up (leady starnú rýchlo).
14. **Vyhodnocuj týždenne:** CTR, CPC, CPL, kvalita leadu (job title/firma), a downstream *lead-to-close*. Vypínaj slabé kreatívy, škáluj víťazov +20–30 %.
15. **Organika paralelne:** 3–5 postov/týždeň z osobného profilu zakladateľky (behind-the-scenes, dizajn, príbehy firemných zákaziek), 3–4 hashtagy, link v prvom komentári.

## Checklist

**Pred spustením**
- [ ] Company Page hotová a prepojená s Ad Accountom
- [ ] Insight Tag nasadený na celom webe a overený (Tag Helper "fires")
- [ ] CAPI zdroj + token v Signals Manager, zdieľané `eventId` s web tagom
- [ ] Konverzie definované s hodnotou a atribučným oknom
- [ ] Insight Tag sa spúšťa až po súhlase s cookies (GDPR)
- [ ] Publiká: retargeting, Company List (ABM), CRM Contact List
- [ ] Vylúčené: vlastní zamestnanci, konkurencia, irelevantné segmenty
- [ ] Cieľové publikum ≥ ~50 000 pre Sponsored Content

**Kampaň a kreatíva**
- [ ] Správny objective podľa fázy lievika (TOF/MOF/BOF)
- [ ] Multi-format v skupine (image/video/document/lead gen)
- [ ] Vertikálne video ≤ 60 s s titulkami
- [ ] Thought Leader Ad z osobného profilu pre dôveryhodnosť
- [ ] Lead Gen Form: 3–4 polia, headline ako otázka ≤ 120 znakov
- [ ] Thank-you CTA + automatický export leadov do CRM
- [ ] Min. 2–4 kreatívne varianty na test
- [ ] Denný rozpočet ≥ 10 USD, realistický na test

**Po spustení**
- [ ] Nezasahovať prvé ~2 týždne (okrem zjavných chýb)
- [ ] Rýchly follow-up na leady (< 24 h)
- [ ] Týždenný report: CTR, CPC, CPL + kvalita leadu
- [ ] Škálovať víťazov, vypínať slabé kreatívy
- [ ] Organika: konzistentné posty z osobného profilu

## Časté chyby

- **Používanie Message/Conversation Ads na EU publikum** — v EU sa reálne nedoručia. Rieš Sponsored Content + Lead Gen Forms.
- **Príliš úzke publikum** (< 50 000) — vysoký CPC, pomalé učenie, plytvanie. Nechaj priestor + zváž Audience Expansion.
- **Vedenie leadov na pomalú landing page namiesto Lead Gen Form** — zbytočná strata konverzií (LGF konvertuje 2–3× viac).
- **Príliš veľa polí vo formulári** — každé pole navyše znižuje konverziu; drž 3–4.
- **Iba Insight Tag bez CAPI** — strácaš konverzie kvôli blokovaniu cookies; a bez zdieľaného `eventId` dvojito počítaš.
- **Reklamy len z firemnej Page, ignorovanie osobného profilu** — prichádzaš o ~8× engagement a dôveru Thought Leader Ads.
- **Externý link v tele organického postu** — algoritmus ho potláča; daj ho do prvého komentára.
- **Viac ako 5 hashtagov** — ~68 % pokles dosahu.
- **Netrpezlivosť** — vypínanie kampane po 2–3 dňoch. LinkedIn potrebuje objem a čas.
- **Nemeranie kvality leadu** — nízky CPL ešte neznamená dobrý lead; sleduj job title, firmu a lead-to-close.
- **Horizontálne video bez titulkov** — na mobile (73 % zhliadnutí) padá výkon.
- **Nasadenie LinkedIn na lacný B2C dosah** — na spotrebiteľské šperky je Meta/Instagram lacnejšia; LinkedIn drž na B2B a personal branding.
- **Neexportované leady** — bez napojenia na CRM leady starnú v Campaign Manageri.

## Nástroje

- **LinkedIn Campaign Manager** — správa kampaní, publík, rozpočtov.
- **Signals Manager** (v Campaign Manageri) — Insight Tag, CAPI, konverzie.
- **LinkedIn Insight Tag Helper** (Chrome rozšírenie) + **Tag Assistant** — overenie tagu.
- **Google Tag Manager** (web + server-side) — nasadenie Insight Tag a CAPI.
- **LinkedIn Sales Navigator** — research firiem/kontaktov pre ABM Company List a organický outreach.
- **Zapier / natívne CRM integrácie** — automatický export Lead Gen leadov (napr. do HubSpot, Pipedrive, e-mailu).
- **Shield / Taplio / AuthoredUp** — analytika a plánovanie osobných postov, personal branding.
- **Canva / Figma** — kreatíva pre Single Image, Carousel, Document Ads.
- **LinkedIn Ad Library** — inšpirácia z reklám konkurencie a značiek.
- **Excel/Sheets alebo Looker Studio** — týždenný reporting CTR/CPC/CPL + kvalita leadu.

## Zdroje

- [LinkedIn Lead Gen Forms — Marketing Solutions](https://business.linkedin.com/advertise/ads/sponsored-content/lead-gen-ads)
- [LinkedIn Ads Guide (formáty a špecifikácie)](https://business.linkedin.com/advertise/ads/ads-guide)
- [How to Use LinkedIn Lead Gen Forms](https://www.linkedin.com/business/marketing/blog/lead-generation/how-to-use-linkedin-lead-gen-forms)
- [Set up Conversion Tracking for Insight Tag conversions — LinkedIn Help](https://www.linkedin.com/help/lms/answer/a425606)
- [Sponsored Messaging — LinkedIn Help](https://www.linkedin.com/help/lms/answer/a421723)
- [Conversation ads advertising specifications — LinkedIn Help](https://www.linkedin.com/help/lms/answer/a426057)
- [LinkedIn Conversion Tracking Guide — Stape](https://stape.io/blog/linkedin-conversion-tracking)
- [LinkedIn Conversions API with Google Tag Manager — Analytics Mania](https://www.analyticsmania.com/post/linkedin-conversions-api/)
- [EU Member Targeting Restrictions for LinkedIn — Sprinklr](https://www.sprinklr.com/help/articles/troubleshooting-faqs/eu-member-targeting-restrictions-for-linkedin/64008d0b32d12b63c5f560ad)
- [LinkedIn disables Sponsored Messages in Europe — Root Agency](https://rootagency.be/linkedin-disables-sponsored-messages-in-europe-what-linkedin-advertisers-need-to-know/)
- [LinkedIn Algorithm 2026: Dos & Don'ts for B2B Reach — Brixon Group](https://brixongroup.com/en/linkedin-algorithm-dos-donts-for-organic-visibility-in-the-b2b-sector)
- [LinkedIn Personal vs Company Pages: 8x Engagement — Digital Applied](https://www.digitalapplied.com/blog/linkedin-personal-profiles-vs-company-pages-8x-engagement)
- [B2B LinkedIn Strategy for the New Algorithm — Content Marketing Institute](https://contentmarketinginstitute.com/social-media-content/linkedin-algorithm-marketing-strategy)
- [LinkedIn Ad Benchmarks 2026 — The B2B House](https://www.theb2bhouse.com/linkedin-ad-benchmarks/)
- [2025 LinkedIn Ads Benchmarks — HockeyStack Labs](https://www.hockeystack.com/lab-blog-posts/linkedin-ads-benchmarks)
- [European LinkedIn Ad Benchmarks 2025–2026 — Pettauer](https://pettauer.net/en/european-linkedin-ad-benchmarks-2025-2026/)
