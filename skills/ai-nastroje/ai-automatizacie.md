# AI automatizácie

> Ako spoľahlivo automatizovať opakovanú prácu Aura cez AI a no-code (Make/n8n/Zapier) — od obsahu a vizuálov cez API integrácie až po monitoring a údržbu.

## Prehľad — čo to je a prečo na tom záleží pre Auru

**AI automatizácia** = prepojenie AI modelov (LLM, generátory obrázkov/videí) s no-code orchestrátormi (Make, n8n, Zapier) a tvojimi nástrojmi (e-shop, Instagram, Gmail, Google Sheets, MariaDB, Canva) tak, aby sa opakovaná práca robila sama, na základe spúšťačov (trigger) a pravidiel.

Pre jednočlenný/malý brand ako **Aura** (marketing + vývoj + dizajn v jednej hlave) je to najväčšia páka na čas. Typické use-casy, ktoré priamo šetria hodiny:

- **Produktový obsah v pipeline** — z nového produktu v e-shope automaticky vygenerovať popis (SEO), 3 varianty caption na IG, alt-text a hashtagy.
- **Vizuály dávkovo** — z produktovej fotky vygenerovať lifestyle vizuál, výrez na story 9:16, štvorec 1:1, odstrániť pozadie, upscale.
- **Publikačná linka** — draft príspevku → tvoje schválenie → naplánovanie do Buffer/Meta.
- **Ops** — nová objednávka → poďakovací e-mail, zápis do prehľadu, upozornenie o nízkych zásobách.
- **Recyklácia obsahu** — blog/newsletter → threads/carousel body → kalendár.

Kľúčová myšlienka 2025/2026: presun od jednoduchých "trigger → akcia" zapov k **AI agentom** — workflowom, ktoré vedia rozhodovať, volať nástroje (search, DB, súbory) a vetviť sa. Všetky tri platformy k tomu dobehli (Make Agents/Maia, n8n AI agent builder, Zapier Agents). Ale agent bez **human checkpointu** a **monitoringu** je pre brand riziko (halucinácie v popisoch, zlé ceny, spam). Preto tento playbook rieši rovnako spoľahlivosť ako samotnú automatizáciu.

## Kľúčové pojmy — glosár

- **Trigger (spúšťač)** — udalosť, ktorá naštartuje workflow: nová objednávka, nový riadok v Sheets, čas (cron), webhook, e-mail.
- **Action / module / node** — jednotlivý krok (odošli e-mail, zavolaj API, vygeneruj obrázok). Make ich volá *modules*, n8n *nodes*, Zapier *steps/actions*.
- **Scenario / workflow / Zap** — celá zostavená automatizácia (Make = scenario, n8n = workflow, Zapier = Zap).
- **Operation vs. task vs. execution** — jednotka účtovania. **Make účtuje za operáciu** (každý beh modulu), **Zapier za task** (každá akcia), **n8n za execution** (celý beh workflowu = 1 jednotka). Pre viackrokové workflowy s vysokým objemom je n8n rádovo lacnejší.
- **Webhook** — HTTP volanie, ktorým jedna služba oznámi udalosť druhej v reálnom čase. Rýchlejšie a lacnejšie ako polling.
- **Polling** — pravidelné "opytovanie sa" služby na zmeny (napr. každých 15 min). Míňa operácie aj keď sa nič nedeje.
- **Idempotencia** — vlastnosť, že spracovanie tej istej udalosti viackrát dá rovnaký výsledok ako raz (žiadne duplicitné e-maily/objednávky). Realizuje sa cez unikátny `idempotency_key` / event ID.
- **Rate limit** — limit počtu volaní API za jednotku času. Prekročenie = HTTP **429**.
- **Exponential backoff + jitter** — pri chybe/429 sa retry oneskoruje exponenciálne (1s, 2s, 4s…) plus náhodný rozptyl (jitter), aby všetky retry nebúchali naraz.
- **`Retry-After` header** — hlavička, ktorou API (vrátane Anthropic/OpenAI) na 429 povie presný čas čakania. Vždy ju rešpektuj namiesto vlastného odhadu.
- **DLQ (Dead Letter Queue)** — "odkladisko" udalostí, ktoré zlyhali aj po N retry, aby sa nestratili a dali sa riešiť ručne.
- **Structured output / JSON mode** — režim, kde LLM vráti dáta v pevnej JSON schéme. Nutné pre spoľahlivé napojenie výstupu do ďalších krokov.
- **AI agent** — workflow, kde LLM sám rozhoduje, ktoré nástroje (tools) zavolať, má pamäť a cieľ. Opak deterministického "chained" workflowu.
- **RAG (Retrieval-Augmented Generation)** — LLM dostáva kontext z tvojej vlastnej znalostnej bázy (vektorová DB) → menej halucinácií, konzistentný brand voice.
- **Human-in-the-loop / checkpoint** — krok, kde workflow počká na tvoje schválenie pred nevratnou akciou (publikácia, e-mail zákazníkovi).
- **Batch processing** — dávkové spracovanie viacerých položiek naraz namiesto po jednej; efektívnejšie využitie API a nižšie náklady.
- **Blueprint / template** — exportovateľná definícia scenára (Make blueprint, n8n JSON), verzia = záloha.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### Výber platformy (čo sa zmenilo)
- **Zapier** — najviac integrácií (8 000+ apiek), najjednoduchší, ale najdrahší pri objeme (účtuje per task). V 2025/26 pridal **Zapier Agents** (autonómne úlohy naprieč appkami). Voľba, keď treba appku, ktorú iní nemajú, a objem je nízky.
- **Make** — najlepší pomer cena/výkon pre vizuálne viackrokové scenáre; per-operation účtovanie, štedrý free tier (**1 000 operácií/mesiac, 2 aktívne scenáre**). Pridal **Maia** (AI copilot) a **Make Agents**. Ideálny default pre Aura marketing.
- **n8n** — **jediný self-hostovateľný** (Docker/K8s, aj air-gapped), fair-code, 400+ nodov a **~70 AI/LangChain nodov**, vstavaný **AI Agent builder** s pamäťou, tools a guardrails, napojenie na OpenAI, Anthropic, Google Gemini aj lokálne modely cez **Ollama**, natívne vektorové DB (Pinecone, Supabase, Qdrant). V októbri 2025 získal Series C 180M USD (aj od Nvidia NVentures) → smeruje na "AI orchestračnú vrstvu". Voľba pri citlivých dátach, vlastných modeloch a komplexných agentoch. Účtuje per execution → najlacnejší pri objeme.

**Odporúčanie pre Auru:** začni na **Make** (rýchly nábeh, vizuál, lacný pre desiatky–stovky operácií). Keď workflow dozrie a beží tisíce-krát alebo pracuje s citlivými zákazníckymi dátami, prenes ho na **self-hosted n8n**.

### AI vrstva
- **Structured outputs sú default**, nie voliteľné. Nechaj LLM vracať JSON podľa schémy (napr. `{caption, alt_text, hashtags[]}`) — mapovanie do ďalších krokov je potom spoľahlivé a nerozbije sa na voľnom texte.
- **Oddeľuj "rozhodovanie" od "vykonania"** — LLM navrhne akciu, tvoj kód/workflow ju vykoná (bezpečnejšie, testovateľné). Nedávaj agentovi priamy prístup k nevratným akciám bez guardrailu.
- **Agent vs. deterministický workflow** — agenta nasadzuj len tam, kde naozaj treba rozhodovanie za behu. Pre "vždy urob A→B→C" je deterministický reťazec spoľahlivejší, lacnejší a auditovateľný. Toto je najčastejšia chyba 2025 — všetko "agentifikovať".
- **RAG pre brand voice** — jazyk značky, tón, zoznam materiálov/kolekcií drž v malej znalostnej báze (Sheet/Notion/vektorová DB), ktorú LLM dostáva ako kontext. Menej halucinácií, konzistentné popisy.
- **Náklady na generovanie prudko klesli** (obrázok od ~0,009 USD, latencia pod 200 ms), takže dávková tvorba vizuálov je bežne dostupná — o to dôležitejší je **strop nákladov** a monitoring spotreby.

### Spoľahlivosť (posun k "production-grade")
- **Fast-ack + async** — webhook prijmi, hneď vráť HTTP 200 a spracuj na pozadí cez frontu. Neblokuj odosielateľa dlhým spracovaním (inak ti ho pošle znova).
- **Idempotencia povinne** — ukladaj spracované event ID (napr. v Redis/Sheet) s TTL 7–30 dní; pred spracovaním skontroluj duplicitu.
- **Disciplinované retry** — **žiadne nekonečné retry**; tvrdý strop **3–5 pokusov**, exponential backoff **+ jitter**, rešpektuj `Retry-After`. Rozlišuj: **5xx/429 = prechodná chyba (retry)**, **4xx = trvalá chyba (do DLQ, neretryuj)**.
- **DLQ + alert** — po vyčerpaní retry ulož udalosť s celým kontextom a pošli si notifikáciu (e-mail/Slack/Telegram). Nič nesmie ticho zmiznúť.
- **State-based namiesto poradia** — keď nevieš zaručiť poradie eventov, rozhoduj podľa aktuálneho stavu zdroja, nie podľa poradia doručenia.
- **Monitoring, ktorý vidno** — sleduj úspešnosť %, p50/p95/p99 latenciu, hĺbku fronty, počet duplicít a spotrebu operácií/kreditov. Make aj n8n majú execution history; nastav **error workflow** (n8n) / **error handler + "Break" a "Resume"** (Make).

## Krok za krokom — príklad: "Nový produkt → obsah + vizuály + schválenie"

Cieľ: keď pridáš produkt do zdroja (Google Sheet alebo e-shop), workflow pripraví SEO popis, IG caption a orezané vizuály, a počká na tvoje schválenie pred publikáciou.

1. **Zmapuj proces na papieri.** Trigger → kroky → výstup → kde je human checkpoint. Nezačínaj klikaním v nástroji.
2. **Priprav zdroj dát.** Google Sheet s riadkom produktu: `nazov, material, kolekcia, cena, foto_url, status`. `status` bude riadiť stav (`new → generated → approved → published`).
3. **Trigger.** V Make: *Watch rows* (nový riadok so `status=new`) alebo webhook z e-shopu. Nastav rozumný interval (napr. 15 min), nie 1 min — šetríš operácie.
4. **Generovanie textu (LLM, structured output).** Modul AI (Anthropic/OpenAI) s promptom, ktorý dostane brand voice (RAG kontext) a vráti **JSON**: `{seo_title, seo_description, ig_caption, alt_text, hashtags[]}`. V prompte zafixuj jazyk (SK), dĺžky a zákaz vymýšľať materiály/ceny.
5. **Generovanie/úprava vizuálu.** Z `foto_url`: odstráň pozadie → vytvor lifestyle variant → **reframe** na 1:1 a 9:16 → upscale. Rob to ako **batch** (viac výstupov naraz) a **edituj existujúcu fotku namiesto generovania od nuly** (konzistentnosť + nižšia cena).
6. **Ulož výsledky späť.** Zapíš texty a URL vizuálov do Sheetu, prehoď `status=generated`.
7. **Human checkpoint.** Pošli si súhrn (e-mail/Telegram) s náhľadom a tlačidlom/odkazom. Nič sa nepublikuje bez `status=approved`. (Toto je poistka proti halucináciám a brand-safety.)
8. **Publikačná vetva.** Keď prepneš na `approved`: naplánuj do Buffer/Meta API, prehoď `status=published`, zaloguj čas.
9. **Error handling.** Na každý externý modul daj error handler: 429/5xx → retry (backoff, max 3), 4xx → zapíš do "DLQ" hárka + pošli alert. Nastav **error workflow** pre celý scenár.
10. **Test na 1 kuse, potom škáluj.** Over end-to-end s jedným produktom, skontroluj výstup, až potom pusti dávku. Ulož **blueprint/JSON export** ako zálohu verzie.

## Checklist — pred spustením a pri údržbe

- [ ] Proces je zakreslený (trigger → kroky → checkpoint → výstup) pred stavbou.
- [ ] LLM vracia **structured output (JSON schéma)**, nie voľný text.
- [ ] Prompt obsahuje brand voice a **explicitný zákaz vymýšľať fakty** (ceny, materiály, dostupnosť).
- [ ] Pri každej **nevratnej akcii** (publikácia, e-mail zákazníkovi, zmena ceny) je **human checkpoint**.
- [ ] **Idempotencia**: unikátny kľúč eventu + kontrola duplicity pred spracovaním.
- [ ] **Retry** má tvrdý strop (3–5), backoff + jitter, rešpektuje `Retry-After`.
- [ ] 4xx idú do **DLQ/error hárka + alert**, neretryujú sa donekonečna.
- [ ] Nastavený **error workflow / handler** pre celý scenár, nie len happy path.
- [ ] **Alerting** na zlyhania (e-mail/Telegram/Slack), nespoliehaj sa na to, že si to všimneš.
- [ ] Sledovanie **spotreby operácií/kreditov** + strop nákladov (LLM aj platforma).
- [ ] **API kľúče v secrets/connections**, nikdy natvrdo v moduloch ani v Sheetoch.
- [ ] **Blueprint/JSON export** uložený ako verzia zálohy po každej väčšej zmene.
- [ ] Interval pollingu je čo najdlhší, čo proces znesie (alebo radšej webhook).
- [ ] Otestované **na 1 položke** pred dávkou.

## Časté chyby — a ako sa im vyhnúť

- **"Všetko spravím ako AI agent."** Agenti sú drahší, pomalší a neauditovateľní. → Pre pevný postup použi deterministický reťazec; agenta len tam, kde treba rozhodovanie za behu.
- **Publikácia bez schválenia.** LLM zhalucinuje materiál/cenu a ide to von. → Human checkpoint pri každej nevratnej akcii.
- **Nekonečné alebo agresívne retry.** Zahltíš API (429) alebo pošleš 5× ten istý e-mail. → Strop 3–5, backoff + jitter, idempotencia, `Retry-After`.
- **Ignorovanie `Retry-After` a jitteru.** Vlastný odhad čakania + synchrónne retry = opakovaný spike. → Čítaj hlavičku, pridaj náhodný rozptyl.
- **Voľný text z LLM napojený do ďalších krokov.** Rozbije sa pri prvej odchýlke formátu. → Structured output/JSON.
- **Polling každú minútu.** Zbytočne spálené operácie/kredity. → Predĺž interval alebo prejdi na webhook (fast-ack + async).
- **Žiadny monitoring a alerting.** Workflow ticho padne a týždeň o tom nevieš. → Error workflow + notifikácie + kontrola spotreby.
- **Chýbajúca DLQ.** Zlyhané eventy sa stratia. → Odkladaj s kontextom na ručné doriešenie.
- **API kľúče v hárku/module.** Únik prístupu. → Používaj natívne connections/credential store, rotuj kľúče.
- **Skok rovno do produkcie.** → Test na 1 kuse, sandbox dáta, potom škáluj.
- **Žiadna verzia/záloha scenára.** Po úprave sa niečo pokazí a nedá sa vrátiť. → Exportuj blueprint/JSON pred zmenami.
- **Generovanie vizuálov od nuly zakaždým.** Nekonzistentný look, vyššia cena. → Edituj existujúcu fotku (masky, background removal, reframe).

## Nástroje — odporúčané

**Orchestrácia (no-code/low-code)**
- **Make** — default pre Aura marketing pipeline; vizuálny canvas, per-operation, Maia AI, Make Agents.
- **n8n** — self-hosted (Docker), AI Agent builder, LangChain/vektor nody, Ollama pre lokálne modely; pre objem a citlivé dáta.
- **Zapier** — keď treba integráciu, ktorú iní nemajú; Zapier Agents.

**AI modely**
- **Anthropic Claude API** / **OpenAI API** — texty, structured outputs, tool use.
- **Ollama** — lokálne LLM (súkromie, nulová cena za token) v n8n.
- **Generátory obrázkov/videí** — pre lifestyle vizuály, upscale, reframe, background removal, outpaint (dostupné aj cez MCP nástroje v tomto prostredí).

**Podporné**
- **Google Sheets / Airtable** — jednoduchý dátový zdroj a stavový register (status-driven pipeline).
- **MariaDB** — keď pipeline dozrie na produkčné dáta e-shopu.
- **Redis** — cache pre idempotenčné kľúče a rate-limiting.
- **Vektorová DB** (Pinecone/Supabase/Qdrant) — RAG pre brand voice.
- **Buffer / Meta Graph API** — plánovanie a publikácia na IG/FB.
- **Telegram/Slack/Gmail** — alerting a human checkpoint notifikácie.

## Zdroje

- [Make vs n8n vs Zapier – Detailed Guide 2026 (Intuz)](https://www.intuz.com/blog/make-vs-n8n-vs-zapier-detailed-comparison/)
- [Zapier AI vs Make.com AI vs n8n AI – Guide for Marketing Leaders 2026 (Genesys Growth)](https://genesysgrowth.com/blog/zapier-ai-vs-make-com-ai-vs-n8n-ai)
- [n8n vs Zapier vs Make 2026 — Market State and Best Pick (RioCloud)](https://riocloudsolutions.com/blog/n8n-vs-zapier-vs-make-automation-comparison-2025)
- [Build Custom AI Agents With Logic & Control (n8n oficiálne)](https://n8n.io/ai-agents/)
- [n8n GitHub — native AI, self-host, 400+ integrácií](https://github.com/n8n-io/n8n)
- [N8N AI Agents 2025: Capabilities Review + Reality Check (Latenode)](https://latenode.com/blog/low-code-no-code-platforms/n8n-setup-workflows-self-hosting-templates/n8n-ai-agents-2025-complete-capabilities-review-implementation-reality-check)
- [AI Content Creation Workflow Automation Guide 2025 (Apatero)](https://apatero.com/blog/ai-content-creation-workflow-automation-2025)
- [Batch AI Image Generation: Hundreds of Visuals in Minutes (MindStudio)](https://www.mindstudio.ai/blog/batch-ai-image-generation-hundreds-visuals-minutes)
- [Scaling Image Processing: High-Volume AI Pipelines via API (Deep-Image)](https://deep-image.ai/blog/scaling-image-processing-high-volume-ai-pipelines-api/)
- [Webhook Best Practices: Retries, Idempotency, Error Handling (Hookdeck – Webhooks at Scale)](https://hookdeck.com/blog/webhooks-at-scale)
- [Webhook Best Practices: Idempotency and Event Ordering (BoldSign)](https://boldsign.com/blogs/webhook-best-practices-retries-idempotency/)
- [n8n Error Handling: 7 Best Practices (n8nlab)](https://n8nlab.io/blog/n8n-error-handling-best-practices)
- [API Rate Limits Explained: Best Practices 2026 (Orq.ai)](https://orq.ai/blog/api-rate-limit)
- [LLM API Rate Limiting Best Practices — Avoid 429, Save 40% (ClawPulse)](https://www.clawpulse.org/blog/llm-api-rate-limiting-best-practices-avoid-429-errors-and-save-40-on-costs)
- [APIs for AI Agents: 5 Integration Patterns 2026 (Composio)](https://composio.dev/content/apis-ai-agents-integration-patterns)
