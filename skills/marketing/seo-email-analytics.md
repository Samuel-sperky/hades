# SEO + Email + Analytics

> Referenčný playbook pre Auru: ako priviesť správnych ľudí z vyhľadávania a AI odpovedí, premeniť ich e-mailovým lifecycle-om na zákazníkov a všetko čisto merať v GA4 pri súlade s Consent Mode v2.

## Prehľad — čo to je a prečo je to pre Auru dôležité

Tri disciplíny, jeden lievik. **SEO/GEO** privádza dopyt zadarmo (organické vyhľadávanie + AI Overviews/asistenti). **Email** je jediný kanál, kde vlastníš vzťah so zákazníkom (nie prenajatý ako reklama na Meta/Google) — u e-shopov robí typicky 20-35 % obratu z automatizovaných flowov. **Analytics** je nervový systém: bez čistého merania robíš „drahé odhady", nie rozhodnutia.

Pre šperkársku značku Aura je špecifické:
- **Vysoká vizuálna a emočná zložka nákupu** → produktové fotky, recenzie a story matter viac než cena; SEO obsah je o inšpirácii („darček k výročiu", „ako vybrať prsteň") nie len o transakčných frázach.
- **Vyššia priemerná hodnota objednávky a dlhší rozhodovací cyklus** → abandoned cart a browse-abandonment flow majú extrémne vysokú návratnosť, atribúcia musí zvládnuť multi-touch (Instagram → Google → email → nákup).
- **Malý tím, jeden majiteľ** → potrebuješ automatizáciu a KPI dashboard, nie denné ručné reporty.

Cieľ playbooku: nastaviť to raz poriadne (meranie, štruktúra webu, flowy) a potom už len optimalizovať podľa dát.

## Kľúčové pojmy — slovník toho podstatného

**SEO / GEO**
- **Technické SEO** — crawlability (robots.txt, sitemap), indexovateľnosť, canonical, rýchlosť, SSR/rendering, hreflang. Predpoklad všetkého ostatného.
- **On-page SEO** — title, meta description, nadpisová štruktúra (H1-H3), interné prelinkovanie, search intent, E-E-A-T (Experience, Expertise, Authoritativeness, Trust).
- **Topic cluster / pillar page** — jedna rozsiahla „pilierová" stránka na hlavnú tému (napr. „Zásnubné prsteny") + sada podrobných článkov (cluster) prelinkovaných na pilier. Signalizuje tematickú autoritu.
- **AI Overviews (AIO)** — AI zhrnutie na vrchu Google výsledkov. Nová SGE/AIO vrstva syntetizuje odpovede z viacerých zdrojov a cituje ich.
- **GEO (Generative Engine Optimization)** — optimalizácia, aby ťa AI engine (Google AIO, ChatGPT, Perplexity, Gemini) **citoval v odpovedi**. „SEO je o rankovaní na strane 1, GEO je o tom byť súčasťou samotnej odpovede."
- **Structured data / JSON-LD** — strojovo čitateľné značenie (schema.org) pre Product, Offer, Review, AggregateRating, BreadcrumbList, Organization. Podmienka rich results a pomáha AIO.
- **Core Web Vitals (CWV)** — LCP (načítanie), INP (odozva), CLS (vizuálna stabilita). Ranking signál, meria sa na 75. percentile reálnych návštev.

**Email**
- **Lifecycle / flow (automation)** — automatizovaná sekvencia spúšťaná správaním (welcome, abandoned cart, win-back). Beží 24/7, na rozdiel od jednorazovej kampane.
- **Double opt-in** — potvrdenie prihlásenia klikom v e-maile. Chráni doručiteľnosť a je best practice pre GDPR súhlas.
- **Deliverability** — či e-mail skončí v Doručenej pošte vs. Spame. Riadené autentifikáciou (SPF/DKIM/DMARC), reputáciou a mierou sťažností.
- **RFM segmentácia** — Recency, Frequency, Monetary. Delí zákazníkov podľa toho kedy naposledy, ako často a za koľko nakúpili.
- **MPP (Apple Mail Privacy Protection)** — od 2021 nafukuje open rate (Apple predsťahuje obrázky). Preto **open rate už nie je spoľahlivá KPI** — meraj kliky, konverzie a obrat.

**Analytics**
- **Event / parameter (GA4)** — GA4 je čisto event-based: každá interakcia je event, parametre pridávajú kontext (napr. `purchase` s parametrom `value`, `currency`, `items[]`).
- **Key event** — v GA4 nahradilo „conversion" (od 2024). Event označený ako biznisovo dôležitý.
- **Atribúcia** — pravidlo, ktoré priradí zásluhu za konverziu jednotlivým kanálom v ceste zákazníka.
- **Data-driven attribution (DDA)** — ML model, ktorý rozdelí zásluhu podľa reálneho vplyvu touchpointov. **Default v GA4.**
- **Consent Mode v2** — Google framework prenášajúci súhlas cez 4 signály: `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`. Povinný pre EEA/UK od marca 2024.

## Best practices 2025/2026 — aktuálny stav a čo sa nedávno zmenilo

### SEO + GEO

**AI Overviews / GEO je nová realita (najväčšia zmena).**
- Google potvrdil: optimalizácia pre generatívne AI vyhľadávanie **je stále SEO** — obsah, ktorý rankuje organicky, sa spravidla objaví aj v AIO. Neexistuje „GEO namiesto SEO", je to nadstavba.
- **Čo reálne zvyšuje citovanosť v AI** (podľa výskumov 2025): pridanie **citátov od expertov (+27,8 %)**, **štatistík a dát (+25,9 %)**, **citovanie zdrojov (+24,9 %)**. Toto sú najsilnejšie páky.
- **Štruktúra pre AI**: jedna téma na sekciu, jasná hierarchia H1-H3, odpoveď **hneď na začiatku sekcie** (front-load), potom kontext. Bullet listy a tabuľky sa lepšie extrahujú.
- **Prístupnosť pre AI crawlery**: over v robots.txt, že neblokuješ `GPTBot`, `OAI-SearchBot`, `PerplexityBot`, `Google-Extended`. Pozor na Cloudflare bot-fight mode, ktorý ich môže odmietať. Dôležitý obsah musí byť **server-side rendered**, nie schovaný za JS.
- **Freshness**: AI engine váži recency. Guide z 2024 bez updatu stráca voči 2026 článku. Pravidelne aktualizuj a meň dátum „Updated".
- **Originálny obsah**: vlastné dáta, benchmark, unikátny framework alebo expertný komentár = dôvod citovať teba namiesto desiatich rovnakých. Pre Auru: vlastné návody (starostlivosť o striebro, veľkostné tabuľky), fotky reálnych zákazníkov, príbeh výroby.
- **Meranie GEO**: sleduj frekvenciu citovania značky v AI odpovediach a share of voice vs. konkurencia (nástroje nižšie).

**Technické SEO 2026.**
- **Core Web Vitals prahy**: LCP ≤ 2,5 s (good) / > 4,0 s (poor); **INP ≤ 200 ms** / > 500 ms (poor); CLS ≤ 0,1 / > 0,25 (poor). Passing = 75 % návštev v „Good" pre všetky tri naraz. **INP je najčastejšie padajúca metrika 2026 (43 % webov ho nespĺňa)** — nahradilo FID v marci 2024, meria odozvu na celú interakciu, nie len prvé kliknutie. Optimalizuj JS (rozbi dlhé tasky, defer, menej third-party skriptov).
- **Structured data pre e-shop**: `Product` + `Offer` (cena, dostupnosť, mena), `AggregateRating` + `Review` (len ak sú recenzie reálne viditeľné na stránke — Google penalizuje fake review markup), `BreadcrumbList`, `Organization`/`LocalBusiness`. Vždy JSON-LD (nie microdata), validuj v Rich Results Test.
- **Canonical & fasety**: e-shopy majú problém s duplicitami z filtrov (farba, veľkosť, radenie). Nastav self-referencing canonical na hlavné produkty a `noindex` alebo canonical na fasetové URL.
- **XML sitemap** len s indexovateľnými, canonical URL; odošli v Search Console.

**On-page & content.**
- Title do ~60 znakov s hlavným keywordom vpredu; meta description je pre CTR, nie ranking.
- **Search intent** rozhoduje o type stránky: informačný intent → článok/guide, transakčný → kategória/produkt. Nemieš to.
- **Topic clusters**: postav piliere okolo hlavných kolekcií (prstene, náhrdelníky, náušnice) + clustre („ako vybrať veľkosť prsteňa", „zlato vs. pozlátené"), všetko prelinkuj na pilier a medzi sebou.

### Email

**Autentifikácia je od 2024/2025 povinná, nie voliteľná (najväčšia zmena).**
- Gmail + Yahoo vyžadujú **SPF aj DKIM aj DMARC** pre odosielateľov nad **5 000 mailov/deň**. Od **novembra 2025 Google prešiel na tvrdé odmietanie** nevyhovujúcich (nielen do spamu — rovno reject). Microsoft/Outlook sa pridáva 2026.
- **DMARC**: minimálne `p=none`, ale smeruj k `p=quarantine`/`reject`. Odosielacia doména musí byť aligned.
- **Spam complaint rate max 0,3 %**, Gmail odporúča držať **pod 0,1 %**. Nad prahom = doručiteľnosť sa zrúti.
- **One-click unsubscribe povinný** (List-Unsubscribe header + RFC 8058), odhlásenie spracovať **do 2 dní**. Nikdy neschovávaj unsubscribe.
- **Vlastná odosielacia doména** (napr. `mail.aura.sk`), zahrievanie IP/domény pri novom nástroji, čistenie neaktívnych (sunset policy).

**Lifecycle flowy (kde je peniaz).** Benchmarky 2025/2026 pre e-commerce:
- **Welcome série** — spúšťač: prihlásenie. Prvý mail **okamžite** (uvítacia zľava/lead magnet). Welcome maily prekonávajú promo o ~320 %. 3-4 maily.
- **Abandoned cart** — najvyššia návratnosť zo všetkých flowov (RPR ~$3,65, konverzia ~3,3 %). **Prvý mail do 30-60 min** (zachytí 45-55 % obratu flowu), druhý +24 h (25-30 %), tretí +3-5 dní (15-20 %). Pre Auru pridaj produktovú fotku, recenzie, urgenciu bez agresivity.
- **Browse abandonment** — pozrel produkt, nepridal do košíka. Jemnejší tón než cart.
- **Post-purchase** — poďakovanie, starostlivosť o šperk, cross-sell, žiadosť o recenziu (napája SEO/structured data).
- **Win-back / re-engagement** — segment neaktívnych 60-120 dní, ponuka + „chceš od nás ešte počúvať?"; kto nereaguje → sunset (odstráň z aktívneho posielania kvôli reputácii).
- **Replenishment/anniversary** — výročie nákupu, meniny, „rok od tvojho prvého šperku".

**Segmentácia**: posielaj podľa RFM a správania, nie plošne. VIP (top 10 % Monetary) dostávajú iný obsah než jednorazoví.

**Metriky post-MPP**: primárne KPI = **click rate, konverzia, obrat na príjemcu (RPR), miera odhlásenia a sťažností**. Open rate ber ako orientačný trend, nie tvrdé číslo.

### Analytics

**GA4 event model.**
- Používaj **presné odporúčané názvy eventov** (`view_item`, `add_to_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`) — nevymýšľaj `product_view`. Google na ne viaže reporty a budúce funkcie.
- **E-commerce `items[]` array**: `item_id`, `item_name`, `price`, `quantity`, `item_brand`, `item_category` (až 5 úrovní), `item_variant` (veľkosť/farba). Pri `purchase` posielaj `transaction_id`, `value`, `currency`, `tax`, `shipping`, `coupon`.
- **Rozsah**: väčšina zdravých implementácií meria **15-25 zmysluplných eventov** naviazaných na fázy cesty — nie stovky šumu.
- Označ ako **key events** to, čo je biznisovo dôležité (`purchase`, `generate_lead`, prihlásenie na newsletter).

**Atribúcia — čo sa zmenilo.**
- **DDA (data-driven) je default od 2023.** First-click, linear, time-decay a position-based modely boli **odstránené (nov 2023)** — ostali len **data-driven** a **paid & organic last-click**.
- Modely sú **cross-channel** cez lookback okno (30 dní default pre akvizíciu, 90 pre iné, konfigurovateľné).
- **Zmena reporting modelu ovplyvní historické aj budúce dáta.** Pre šperky s dlhším cyklom nechaj DDA — last-click podceňuje horné časti lievika (Instagram, obsah).
- Neposudzuj kanály len podľa „last click" v GA4 — kombinuj s UTM-kami a prípadne server-side meraním.

**Consent Mode v2 — povinné pre EEA/UK.**
- Povinné od marca 2024 pre každý web s Google reklamnými/meracími produktmi a návštevníkmi z EEA (vyplýva z DMA + EU User Consent Policy).
- 4 signály: `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`.
- **Basic vs Advanced**:
  - **Basic** — Google tagy sa nespustia, kým nie je súhlas; pri „Reject All" sa neposiela nič. Menej dát, jednoduchšie, prísnejšie právne.
  - **Advanced** — tagy sa načítajú hneď v obmedzenom režime; pred/pri odmietnutí posielajú **cookieless pings** (bez identifikátorov, len timestamp/user agent/či nastala konverzia). Google z nich modeluje. **Advanced obnoví ~65-70 % inak stratenej atribúcie.**
  - Odporúčanie pre Auru: ak beží Google/Meta reklama → **Advanced** (viac vstupu pre modelovanie), ale cookieless pings preveriť s ohľadom na GDPR/ePrivacy (u citlivých prípadov konzultuj DPO). Bez reklamy stačí Basic.
- Nastav cez **certifikovaný CMP** (Cookiebot, Usercentrics, CookieYes…) integrovaný s Google Tag / GTM; default consent = denied kým používateľ neklikne.
- **Privacy default**: na cookie lište je predvolená voľba odmietnutie non-essential; žiadne osobné údaje do URL parametrov.

## Krok za krokom — konkrétny workflow

**Fáza 0 — Meranie ako základ (spraviť PRVÉ).**
1. Nasaď **GTM** (Google Tag Manager) na web (najlepšie server-side kontajner neskôr).
2. Nasaď **certifikovaný CMP** + **Consent Mode v2** (default denied). Otestuj Tag Assistant / Consent Mode debugom, že sa pred súhlasom posielajú len cookieless pings (Advanced) alebo nič (Basic).
3. Vytvor **GA4 property**, over data stream, zapni Enhanced Measurement.
4. Implementuj **e-commerce dataLayer** so správnymi eventmi (`view_item` → `add_to_cart` → `begin_checkout` → `purchase`) a plným `items[]`.
5. Označ **key events**, prepoj GA4 ↔ Google Ads (import konverzií, Enhanced Conversions) a Search Console.
6. Nechaj atribúciu na **DDA**. Over cez DebugView, že eventy chodia s parametrami.

**Fáza 1 — SEO/GEO fundament.**
7. Technický audit: robots.txt, sitemap, canonical, indexácia (Search Console Coverage), CWV (PageSpeed Insights / CrUX), AI crawlery neblokované.
8. Oprav INP/LCP problémy (obrázky WebP/AVIF + srcset, lazy-load pod fold, menej JS, defer third-party).
9. Nasaď JSON-LD: `Product`+`Offer`+`AggregateRating`/`Review`, `BreadcrumbList`, `Organization`. Validuj Rich Results Test.
10. Postav **topic clusters**: pilier na kolekciu + 5-8 clusterov, prelinkuj.
11. Napíš obsah s front-loaded odpoveďami, štatistikami, citátmi, vlastnými dátami (GEO páky). Optimalizuj title/H1/intent.

**Fáza 2 — Email lifecycle.**
12. Nastav odosielaciu doménu + **SPF, DKIM, DMARC** (aspoň `p=none`, cieľ `quarantine`). Over cez MXToolbox/Google Postmaster.
13. Zapni **double opt-in** a one-click unsubscribe.
14. Postav flowy v poradí návratnosti: **Abandoned cart → Welcome → Post-purchase → Browse abandonment → Win-back**. Načasovanie podľa benchmarkov vyššie.
15. Nastav RFM segmenty + suppression/sunset pre neaktívnych.
16. Prepoj UTM-ky (`utm_source=email`, `utm_medium=email`, `utm_campaign=…`) do každého odkazu → čistá atribúcia v GA4.

**Fáza 3 — KPI dashboard a optimalizačný cyklus.**
17. Postav dashboard (Looker Studio na GA4 + Search Console + email nástroj) s KPI nižšie.
18. Mesačný rytmus: SEO (pozície, klik z GSC, AIO citovanosť), Email (RPR, konverzia flowov, doručiteľnosť/sťažnosti), Analytics (kanály cez DDA, funnel drop-off).
19. Hypotéza → test → vyhodnotenie (A/B na predmetoch mailov, landing pages, CTA). Nikdy nemeň všetko naraz.

## Checklist — akčný zoznam

**Meranie / Consent**
- [ ] GTM nasadený, GA4 property beží, DebugView potvrdzuje eventy
- [ ] Consent Mode v2 (4 signály), default denied, cez certifikovaný CMP
- [ ] Rozhodnuté Basic vs Advanced (Advanced ak beží reklama)
- [ ] E-commerce dataLayer: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` s plným `items[]`
- [ ] Key events označené, GA4 ↔ Google Ads ↔ Search Console prepojené
- [ ] Atribúcia = data-driven (DDA)
- [ ] 15-25 zmysluplných eventov, žiadne vymyslené názvy

**SEO / GEO**
- [ ] robots.txt neblokuje Googlebot ani AI crawlery (GPTBot, PerplexityBot, Google-Extended)
- [ ] Dôležitý obsah server-side rendered
- [ ] CWV: LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 (75. percentil)
- [ ] JSON-LD Product/Offer/Review/Breadcrumb validované, recenzie reálne viditeľné
- [ ] Canonical + noindex na fasetových/filtrovacích URL
- [ ] XML sitemap odoslaná, indexácia čistá
- [ ] Topic clusters s pilier stránkami a interným prelinkovaním
- [ ] Obsah: front-loaded odpovede, štatistiky, citáty, vlastné dáta, aktualizovaný dátum

**Email**
- [ ] SPF + DKIM + DMARC nastavené a aligned (cieľ `p=quarantine`/`reject`)
- [ ] One-click unsubscribe (RFC 8058), odhlásenie do 2 dní
- [ ] Spam complaint rate pod 0,1-0,3 %
- [ ] Double opt-in zapnutý
- [ ] Flowy: Abandoned cart (1. mail do 60 min), Welcome, Post-purchase, Browse, Win-back
- [ ] RFM segmentácia + sunset policy pre neaktívnych
- [ ] UTM-ky vo všetkých email odkazoch
- [ ] KPI = klik/konverzia/RPR (nie open rate)

## Časté chyby — a ako sa im vyhnúť

1. **Spustiť reklamu/email pred nastavením merania.** Prídeš o dáta, ktoré sa spätne nedoplnia. → Fáza 0 vždy prvá.
2. **Vymýšľať vlastné názvy eventov** (`product_view` namiesto `view_item`). GA4 stratí naviazané reporty. → Drž sa oficiálneho zoznamu.
3. **Ignorovať Consent Mode v2 v EEA.** Google Ads modelovanie prestane fungovať a hrozí non-compliance. → Nasaď hneď, Advanced ak bežia reklamy.
4. **Posudzovať kanály cez last-click.** Podcení Instagram/obsah/email v hornej časti lievika (kritické pri dlhom cykle šperkov). → Nechaj DDA, kombinuj s UTM.
5. **Súdiť email podľa open rate.** MPP ho nafukuje. → Meraj kliky, konverzie, obrat.
6. **Chýbajúci alebo neaktualizovaný obsah pre GEO.** Statická 2024 stránka vypadne z AI odpovedí. → Pridaj dáta/citáty, aktualizuj.
7. **Blokovať AI crawlery / spoliehať sa na JS rendering.** AI ani Google neuvidia obsah. → SSR + otvorený robots.txt pre boty, ktoré chceš.
8. **Fake review schema.** Google penalizuje AggregateRating bez reálne viditeľných recenzií. → Značkuj len to, čo je na stránke.
9. **Ignorovať INP.** Najčastejšie padajúca CWV 2026. → Rozbi dlhé JS tasky, obmedz third-party skripty.
10. **Neposielať abandoned cart do 60 minút.** Prídeš o 45-55 % obratu flowu. → Nastav okamžitý trigger.
11. **Duplicitný obsah z fasiet bez canonical.** Rozriedi ranking. → canonical/noindex.
12. **Posielať neaktívnym donekonečna.** Rúca reputáciu a doručiteľnosť. → Sunset policy.

## Nástroje

**SEO / GEO**
- **Google Search Console** — indexácia, pozície, kliky (nutnosť, zdarma)
- **PageSpeed Insights / CrUX / web.dev** — Core Web Vitals na reálnych dátach
- **Rich Results Test / Schema Markup Validator** — validácia JSON-LD
- **Ahrefs / Semrush** — keyword research, backlinky, konkurencia, rank tracking (Ahrefs má aj Brand Radar na AI citovanosť)
- **Screaming Frog** — technický crawl audit
- **GEO/AI monitoring**: LLMrefs, Peec.ai, Otterly, Profound (frekvencia citovania a share of voice v AI odpovediach)

**Email**
- **Klaviyo** — štandard pre e-commerce lifecycle (flowy, RFM, segmentácia, benchmarky); alternatíva Omnisend, Brevo
- **Google Postmaster Tools** — reputácia domény, spam rate voči Gmailu
- **MXToolbox / dmarcian / EasyDMARC** — kontrola SPF/DKIM/DMARC

**Analytics / Consent**
- **GA4** + **Google Tag Manager** (ideálne server-side kontajner)
- **Looker Studio** — KPI dashboardy nad GA4/GSC/email dátami
- **CMP**: Cookiebot, Usercentrics, CookieYes (certifikované, Consent Mode v2)
- **Microsoft Clarity / Hotjar** — heatmapy a nahrávky pre kvalitatívny CRO vstup

## Zdroje

- [Google Search Central — Guide to Optimizing for Generative AI Features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Search Engine Land — Mastering Generative Engine Optimization in 2026](https://searchengineland.com/mastering-generative-engine-optimization-in-2026-full-guide-469142)
- [LLMrefs — Generative Engine Optimization (GEO): 2026 Guide](https://llmrefs.com/generative-engine-optimization)
- [GenOptima — GEO Best Practices 2026](https://www.gen-optima.com/geo/generative-engine-optimization-best-practices-2026/)
- [Google Developers — GA4 Recommended events](https://developers.google.com/analytics/devguides/collection/ga4/reference/events)
- [Google Developers — GA4 Measure ecommerce](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
- [Analytics Help — Get started with attribution](https://support.google.com/analytics/answer/10596866?hl=en)
- [Analytics Help — GA4 Recommended events](https://support.google.com/analytics/answer/9267735?hl=en)
- [Google Search Central — Understanding Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)
- [web.dev — How the Core Web Vitals thresholds were defined](https://web.dev/articles/defining-core-web-vitals-thresholds)
- [corewebvitals.io — LCP, INP & CLS Explained (2026)](https://www.corewebvitals.io/core-web-vitals)
- [Gmail Help — Email sender guidelines](https://support.google.com/a/answer/81126?hl=en)
- [Gmail Help — Email sender guidelines FAQ](https://support.google.com/a/answer/14229414?hl=en)
- [Yahoo Sender Hub — Best Practices](https://senders.yahooinc.com/best-practices/)
- [Proofpoint — Stricter email authentication enforcements for Google start November 2025](https://www.proofpoint.com/us/blog/email-and-cloud-threats/clock-ticking-stricter-email-authentication-enforcements-google-start)
- [Redsift — 2026 bulk email sender requirements checklist](https://redsift.com/guides/bulk-email-sender-requirements)
- [Klaviyo — Abandoned Cart Benchmark Report](https://www.klaviyo.com/blog/abandoned-cart-benchmarks)
- [Shno — Lifecycle Email Statistics for 2026](https://www.shno.co/marketing-statistics/lifecycle-email-statistics)
- [FlowConsent — Google Consent Mode v2 complete setup guide (2026)](https://www.flowconsent.com/en/blog/google-consent-mode-v2-guide)
- [Secure Privacy — Basic vs Advanced Google Consent Mode](https://support.secureprivacy.ai/article/basic-vs-advanced-google-consent-mode-full-comparison-guide/)
