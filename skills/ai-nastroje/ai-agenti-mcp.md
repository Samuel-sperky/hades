# AI agenti + MCP

Praktická referencia, kedy stačí jednoduchý prompt, kedy postaviť workflow a kedy skutočného agenta — a ako to poskladať cez Claude API, tool use, MCP a kontext engineering, s dôrazom na evaly a merateľnosť pre značku Aura.

## Prehľad — čo to je a prečo to má význam pre biznis Aura

**AI agent** je systém, kde LLM (napr. Claude) sám riadi svoj postup — rozhoduje, ktoré nástroje (tools) použije, v akom poradí, a kedy skončil. Opak je **workflow**, kde tú istú prácu riadi tvoj kód po vopred definovaných krokoch a model je len jeden článok reťaze. Väčšina reálnych „AI featur" nepotrebuje agenta — potrebuje workflow s jasnými krokmi, tesne definovanými nástrojmi a merateľným výsledkom.

**MCP (Model Context Protocol)** je otvorený štandard (pôvodne od Anthropicu, dnes s vlastnou špecifikáciou a governance), ktorý štandardizuje, ako AI aplikácia pripojí externé nástroje a dáta. Namiesto toho, aby si pre každú integráciu (Shopify, Google Search Console, MariaDB, Canva, Figma, Ahrefs…) písal vlastný adaptér, MCP server tieto schopnosti vystaví raz a ktorýkoľvek MCP-kompatibilný klient (Claude Desktop, Claude Code, tvoja appka cez API) ich vie použiť. Je to „USB-C pre AI nástroje".

**Prečo to riešiť pri Aure:**

- **Marketing šperkov** — agent/workflow, ktorý ťahá dáta z GSC + Ahrefs (oba sú už dostupné ako MCP servery vo tvojom prostredí), navrhuje témy blogov, generuje varianty popisov produktov, kontroluje ich proti brand voice. Namiesto ručného prepínania medzi nástrojmi model orchestruje celý reťazec.
- **Vývoj (Aura app, Docker Compose, MariaDB, Laravel)** — Claude Code ako agent, ktorý číta repo, píše kód, spúšťa testy, robí migrácie. MCP server nad tvojou MariaDB alebo internými API vie agentovi bezpečne sprístupniť len to, čo potrebuje.
- **Dizajn a produkcia** — MCP konektory na Figmu a Canvu (opäť dostupné vo tvojom prostredí) umožňujú generovať a upravovať vizuály z prirodzeného jazyka.
- **Náklady a spoľahlivosť** — agenti sú drahší a pomalší než jeden prompt. Vedieť, *kedy* siahnuť po agentovi a kedy nie, je priamo úspora peňazí a menej nepredvídateľných výstupov na produkte, ktorý vidí zákazník.

Kľúčová zásada Anthropicu (2025): **začni jednoducho, zvyšuj zložitosť len keď ju vieš zaplatiť lepším výsledkom.** Agentické systémy vymieňajú latenciu a cenu za flexibilitu — má to zmysel len tam, kde flexibilita reálne vyhráva.

## Kľúčové pojmy

- **Prompt (jeden LLM call)** — jedna požiadavka, jedna odpoveď. Klasifikácia, sumarizácia, extrakcia, Q&A, generovanie textu.
- **Workflow** — LLM a nástroje orchestrované cez vopred napísaný kód. Predvídateľné, laditeľné, lacnejšie. Anthropic definuje 5 vzorov: **Prompt chaining** (reťazenie krokov), **Routing** (klasifikuj vstup → pošli na správnu vetvu), **Parallelization** (rozdeľ a bež paralelne / hlasovanie viacerých behov), **Orchestrator–Workers** (hlavný model rozdelí úlohu a deleguje), **Evaluator–Optimizer** (jeden model generuje, druhý hodnotí a vracia na doladenie).
- **Agent** — LLM v slučke: rozhodni → zavolaj nástroj → prečítaj výsledok → rozhodni znova, až kým nie je hotovo. Model si sám určuje cestu. Používaj, keď je úloha viacsmerná a nedá sa vopred plne špecifikovať.
- **Tool use / function calling** — model dostane definície nástrojov (názov, popis, JSON schéma vstupu) a môže požiadať o ich zavolanie. Tvoj kód (alebo SDK „tool runner") ich vykoná a vráti výsledok.
- **MCP (Model Context Protocol)** — protokol pre pripojenie nástrojov/dát. Architektúra **host ↔ client ↔ server**. Server vystavuje tri druhy primitív:
  - **Tools** — akcie, ktoré model volá (napr. „vytvor produkt", „spusti query").
  - **Resources** — dáta na čítanie (súbory, dokumenty, riadky DB).
  - **Prompts** — pripravené šablóny promptov, ktoré si používateľ vyberie.
- **Transport** — ako klient a server komunikujú: **stdio** (lokálny proces, napr. plugin v Claude Desktop) alebo **Streamable HTTP** (vzdialený server; nahradil starší HTTP+SSE, lebo lepšie prežíva proxy a load balancery).
- **Kontext engineering** — kurátorstvo toho, čo je v kontextovom okne modelu v každom kroku. Nástupca „prompt engineeringu" pre agentov: nejde len o jeden prompt, ale o priebežné udržiavanie optimálnej sady tokenov (systémový prompt, výsledky nástrojov, história, pamäť).
- **Context window** — maximálny objem tokenov, ktorý model spracuje naraz. Claude Opus/Sonnet dnes: 1M tokenov; Haiku: 200K.
- **Context rot / bloat** — degradácia kvality, keď kontext narastie a zaplní sa nerelevantnými dátami (napr. staré výsledky nástrojov). Tichý zabijak spoľahlivosti agentov.
- **Eval** — merateľný test kvality AI systému. **Golden dataset** = kurátorská sada vstupov s očakávaným správaním. **LLM-as-judge** = model, ktorý podľa rubriky hodnotí výstup iného modelu.
- **Extended / adaptive thinking** — Claude si pred odpoveďou „premyslí" postup. Na aktuálnych modeloch sa nastavuje `thinking: {type: "adaptive"}` + `effort`, nie starým `budget_tokens`.
- **Prompt caching** — cachovanie stabilného prefixu promptu (systémový prompt, definície nástrojov), aby sa neplatil znova. Čítanie z cache ~0,1× ceny vstupu.

## Best practices 2025/2026 — aktuálny stav a čo sa zmenilo

### 1. Kedy agent a kedy nie (najdôležitejšie rozhodnutie)

Anthropic 2025: **„Väčšina produkčných AI systémov nepotrebuje ďalšieho autonómneho agenta — potrebuje workflow s jasnými krokmi, tesnými nástrojmi a merateľným výsledkom."** Pred stavbou agenta over 4 kritériá:

1. **Komplexita** — je úloha viackroková a ťažko vopred plne špecifikovateľná? („z design docu sprav PR" áno; „vytiahni titulok z PDF" nie).
2. **Hodnota** — ospravedlní výsledok vyššiu cenu a latenciu?
3. **Realizovateľnosť** — zvládne to model vôbec?
4. **Cena chyby** — vieš chybu zachytiť a napraviť (testy, review, rollback)?

Ak je čo i len jedna odpoveď „nie", zostaň na jednoduchšej úrovni. Rozhodovacia os: **jeden call → workflow → agent**, a nikdy nepreskakuj úroveň bez dôvodu.

### 2. Začni s priamym API, nie s frameworkom

Mnohé vzory sa dajú napísať na pár riadkov priamo cez Claude API. Frameworky (LangChain, agent frameworky) pridávajú vrstvu abstrakcie, ktorá sťažuje ladenie. Ak framework použiješ, rozumej kódu pod ním. Pre custom-tool agenta bez ručného písania slučky použi **SDK tool runner** (v Anthropic SDK), ktorý rieši slučku request → vykonaj nástroj → pokračuj, ale necháva ti háčiky na schvaľovanie, logovanie a úpravu výsledkov.

### 3. Návrh nástrojov je najvyššia páka spoľahlivosti (zmena 2025)

- Popis nástroja píš ako dokumentáciu pre pozorného inžiniera: **čo robí, čo NErobí, kedy ho použiť vs. alternatíva, aký má formát výstupu.**
- Buď **preskriptívny o tom, KEDY nástroj volať**, nie len čo robí. Novšie modely (Opus 4.7/4.8, Sonnet 5) siahajú po nástrojoch konzervatívnejšie — trigger podmienka priamo v popise nástroja dáva merateľný nárast v miere správneho volania.
- **Bash vs. dedikovaný nástroj:** začni s bash pre šírku, povýš akciu na dedikovaný nástroj, keď ju treba gate-ovať (potvrdenie pred nezvratnou akciou — mail, platba, delete), renderovať v UI, auditovať alebo paralelizovať.
- **Škálovanie na veľa nástrojov:** pri >20 nástrojoch označ zriedka používané `defer_loading: true` a zapni **Tool Search** — model si schémy dohľadá na požiadanie, čím sa nezahltí kontext. Drž 3–5 najpoužívanejších nástrojov vždy načítaných.

### 4. Kontext engineering — nová disciplína (2025)

Gartner ho označil za nástupcu prompt engineeringu. Praktiky:

- **Nezahlť kontext.** Samotné výsledky nástrojov vedia spotrebovať >50 000 tokenov ešte pred prvým užívateľským vstupom. Bloatnutý, zle štruktúrovaný kontext = tichý zabijak spoľahlivosti.
- **Context editing (pruning)** — pravidlami maž staré výsledky nástrojov a dokončené thinking bloky. V Claude API: beta `context-management-2025-06-27`, stratégie `clear_tool_uses_20250919` a `clear_thinking_20251015`. **Maže**, nesumarizuje.
- **Compaction** — keď sa blížiš limitu okna, API zosumarizuje staršiu históriu (beta `compact-2026-01-12`). Pozor: musíš vrátiť celý `response.content` naspäť, nielen text, inak stratíš compaction stav.
- **Progressive disclosure** — agent objavuje kontext postupne prieskumom, drží v pracovnej pamäti len to nutné.
- **Memory** — perzistentná pamäť naprieč sedeniami (súborový `/memories` adresár). Nikdy tam neukladaj tajomstvá/PII.
- **Context awareness** — modelu daj priebežnú spätnú väzbu o zostávajúcej kapacite kontextu.

### 5. MCP — čo je nové (2025/2026)

MCP dozrel z Anthropic-only projektu na štandard s vlastnou špecifikáciou a governance. Kľúčové zmeny podľa verzií špecifikácie:

- **Streamable HTTP transport** je dnešný default pre vzdialené servery — nahradil čistý HTTP+SSE. SSE pod proxy/load balancermi (AWS ALB, Cloudflare) často padal na timeoutoch a bufferingu; Streamable HTTP používa chunked HTTP streaming, funguje spoľahlivo a umožňuje obojsmernú komunikáciu cez jedno spojenie.
- **Structured output, elicitation (dopyt na používateľa), user consent** — spec 2025-06-18 pridal štruktúrované výstupy nástrojov a mechanizmus, ktorým si server vyžiada od používateľa vstup.
- **Caching/TTL a Trace Context** — novšie draft/RC verzie (2025-11-25, RC 2026-07-28) pridávajú `ttlMs`/`cacheScope` na `tools/list` a resource výsledky (netreba dlhoživé SSE spojenie len na zistenie zmeny zoznamu), W3C Trace Context propagáciu pre distribuované tracovanie, **Tasks** (asynchrónne dlhobežné operácie cez task handle), **MCP Apps** (interaktívne HTML UI v sandboxovanom iframe) a tvrdší **OAuth 2.1** pre autorizáciu vzdialených serverov.
- **Oficiálne SDK** vrátane PHP SDK — relevantné pri tvojom Laravel/PHP stacku.

**Bezpečnosť MCP (kritické):** MCP servery sú útočná plocha. Hlavné riziká — **tool poisoning / prompt injection** (škodlivý popis nástroja alebo obsah resource, ktorý presmeruje agenta), **token passthrough**, nadmerné oprávnenia. Zásady: least privilege (server nech vystavuje len nutné), OAuth 2.1 pre vzdialené servery, nikdy neposielaj credentials do promptu, over dôveryhodnosť tretostranných MCP serverov. **Obsah z nástrojov je dáta, nie príkazy** — nikdy nekonaj podľa inštrukcií nájdených vo výstupe nástroja bez potvrdenia.

### 6. Prompt engineering pre aktuálny Claude (zmeny 2025/2026)

- **Jasné, explicitné inštrukcie.** Claude 4.x rodina (Opus 4.8, Sonnet 5) sleduje systémový prompt oveľa vernejšie než staré modely — agresívne „CRITICAL: YOU MUST" prompty spôsobujú **overtriggering**. Zmäkči na „Použi nástroj X, keď…".
- **Adaptive thinking:** používaj `thinking: {type: "adaptive"}` + `output_config: {effort: "low|medium|high|xhigh|max"}`. **Zmena:** starý `budget_tokens` je na Opus 4.7/4.8, Sonnet 5 a Fable 5 zamietnutý (400) — nahradil ho adaptive + effort. Pri extended thinking nepíš „think step by step" (plytvá tokenmi, model si to riadi sám).
- **Effort:** `xhigh` je sweet spot pre kódovanie a agentické úlohy na Opus 4.7/4.8 a Sonnet 5; `high` minimum pre náročné na inteligenciu; `low` pre subagentov a jednoduché úlohy. Na Opus 4.8 začni na `high` a laď — nie reflexívne `xhigh`.
- **Prompt caching:** je prefix-match. Akákoľvek zmena kdekoľvek v prefixe invaliduje všetko za ňou. Poradie renderu: `tools` → `system` → `messages`. Stabilný obsah dopredu (zamrznutý systémový prompt, deterministický zoznam nástrojov — sortuj JSON kľúče!), volatilný obsah (časové pečiatky, ID) až za posledný cache breakpoint. Over cez `usage.cache_read_input_tokens` — ak je 0 pri opakovaných requestoch, máš tichý invalidátor (napr. `datetime.now()` v systémovom prompte).
- **Modely (aktuálne, k 2026):** `claude-opus-4-8` (najschopnejší Opus-tier, 1M kontext, $5/$25 za 1M tok.), `claude-sonnet-5` (near-Opus kvalita na kódovaní za nižšiu cenu, $3/$15; úvodne $2/$10 do 31.8.2026), `claude-haiku-4-5` (najrýchlejší/najlacnejší, $1/$5, 200K kontext). Cache read = 10 % ceny vstupu, Batch API = ďalších −50 %.

### 7. Eval-driven development (EDD) — bez evalov nie je produkčná AI

Robustná AI feature sa nestavia „na cit". Postup (Anthropic + konsenzus 2025/2026):

- **Golden dataset** je najdôležitejší asset — dôležitejší než výber frameworku či metrík. Cca **~100 goldenov** s očakávanými výstupmi, čerpaných z reálnych zlyhaní a edge case-ov, verziovaných, bez leakage.
- **3–5 metrík**, ktoré dobre korelujú s reálnym výkonom tvojho systému.
- **LLM-as-judge s rubrikou** — hodnotí splnenie kritérií, nie zhodu s jednou „ideálnou" odpoveďou. Pozor na biasy (poradie, dĺžka).
- **Viacvrstvové hodnotenie:** offline testy na golden datasete + ľudské posúdenie + produkčná telemetria. Rozhodni, či hodnotíš *model* alebo *produkt* (prompt + retrieval + nástroje + guardrails + UI) — pre biznis platí len druhé.
- **Iteruj, kým všetky metriky neprejdú** na testovacích prípadoch; potom to zaraď do CI ako regresný test (gate na merge).
- **Pre agentov:** simulačné testy multi-krokového správania a traceovanie (ktorý krok zlyhal). EDD nie je jednorazová brána pred nasadením, ale priebežný cyklus cez celý životný cyklus.

## Krok za krokom — od nápadu k nasadenej AI feature

Príklad: „chcem AI, ktorá píše SEO-optimalizované popisy produktov pre Auru".

1. **Definuj úlohu a úroveň.** Popis produktu z pár atribútov = jeden prompt alebo krátky workflow, NIE agent. (Agent by dával zmysel, ak by mal sám prehľadať GSC/Ahrefs, vybrať kľúčové slová, napísať, skontrolovať a publikovať.)
2. **Postav golden dataset.** 20–100 reálnych produktov s „vzorovými" schválenými popismi (aj zlé príklady z minulosti ako negatívne prípady).
3. **Napíš prvý prompt.** Explicitné inštrukcie, brand voice, dĺžka, zakázané frázy, formát výstupu. Žiadne „CRITICAL YOU MUST".
4. **Vyber model a parametre.** Sonnet 5 (`claude-sonnet-5`) pre pomer cena/kvalita; `max_tokens` primerane; adaptive thinking `effort: "medium"` na začiatok.
5. **Nastav prompt caching.** Systémový prompt + brand guidelines ako stabilný prefix s `cache_control` breakpointom; per-produkt vstup až za ním.
6. **Definuj 3–5 metrík.** Napr.: dodržanie dĺžky, prítomnosť cieľových keywords, súlad s brand voice (LLM-as-judge rubrika), žiadne halucinované vlastnosti produktu.
7. **Spusti eval, iteruj.** Pusti prompt cez celý golden dataset, hodnoť LLM-as-judgom + ručne skontroluj vzorku. Laď prompt, kým metriky neprejdú.
8. **Rozhodni o nástrojoch/MCP.** Ak feature potrebuje živé dáta (aktuálne keywords z Ahrefs/GSC), pridaj tool use alebo pripoj existujúci MCP server. Každý nástroj = tesná schéma + preskriptívny popis „kedy volať".
9. **Ak treba agenta, postav slučku.** Použi SDK tool runner. Nastav `max_iterations`, gate nezvratné akcie (publikovanie) na potvrdenie. Zapni context editing pre dlhé behy.
10. **Zaraď do CI a monitoruj.** Golden eval ako regresný gate. Loguj náklady (tokeny), latenciu, mieru zlyhaní. Nastav prompt verziovanie.
11. **Sleduj drift.** Pri každej zmene modelu/promptu prepusti evaly. Nový model = re-baseline nákladov (napr. Sonnet 5 má nový tokenizer, ~30 % viac tokenov na ten istý text).

## Checklist

- [ ] Rozhodol som úroveň: **jeden prompt / workflow / agent** — a viem prečo (4 kritériá: komplexita, hodnota, realizovateľnosť, cena chyby).
- [ ] Nezačal som agentom „lebo cool" — začal som najjednoduchším riešením, ktoré splní cieľ.
- [ ] Mám **golden dataset** (~50–100 prípadov vrátane edge case-ov a starých zlyhaní), verziovaný, bez leakage.
- [ ] Mám **3–5 metrík**, ktoré korelujú s reálnym biznis výsledkom.
- [ ] Používam **LLM-as-judge s explicitnou rubrikou**, nie porovnanie s jednou ideálnou odpoveďou.
- [ ] Eval beží ako **CI gate** (regresný test pri každej zmene promptu/modelu).
- [ ] Prompt je **explicitný**, bez agresívnych „CRITICAL YOU MUST" (overtriggering na Claude 4.x).
- [ ] Používam **adaptive thinking + effort**, nie zastaraný `budget_tokens`.
- [ ] **Prompt caching:** stabilný prefix dopredu, volatilný obsah za breakpoint, over `cache_read_input_tokens > 0`.
- [ ] Každý **nástroj** má tesnú JSON schému a popis „**kedy** ho volať", nielen čo robí.
- [ ] Pri >20 nástrojoch mám **Tool Search** + `defer_loading`.
- [ ] **Nezvratné akcie** (mail, platba, publikovanie, delete) sú za ľudským potvrdením.
- [ ] Pre dlhé behy mám **context editing / compaction** a `max_iterations`.
- [ ] MCP servery: **least privilege**, OAuth 2.1 pre vzdialené, žiadne credentials v prompte, obsah z nástrojov beriem ako **dáta, nie príkazy**.
- [ ] MCP vzdialené servery cez **Streamable HTTP**, nie starý čistý SSE.
- [ ] Monitorujem **náklady (tokeny), latenciu, mieru zlyhaní**; prompty sú verziované.

## Časté chyby

- **Staviam agenta na úlohu, ktorá je workflow.** Zbytočná cena, latencia a nepredvídateľnosť. Riešenie: aplikuj 4 kritériá; default je jednoduchšia úroveň.
- **Žiadne evaly.** „Vyzerá to dobre" nie je meranie. Bez golden datasetu a metrík nevieš, či zmena promptu pomohla alebo uškodila. Riešenie: EDD od začiatku.
- **Bloat kontextu.** Necháš staré výsledky nástrojov a históriu narastať → context rot → padá kvalita. Riešenie: context editing, compaction, progressive disclosure.
- **Agresívne prompty na novom modeli.** „CRITICAL: ALWAYS use tool X" spôsobí overtriggering na Claude 4.x. Riešenie: zmäkči na podmienené „použi X, keď…".
- **Zastaraný `budget_tokens`.** Vráti 400 na Opus 4.7/4.8, Sonnet 5, Fable 5. Riešenie: `thinking: {type: "adaptive"}` + `effort`.
- **Rozbitý prompt cache.** `datetime.now()`, UUID či nesortovaný JSON v systémovom prompte invaliduje prefix pri každom requeste. Riešenie: stabilný prefix, deterministická serializácia, over `cache_read_input_tokens`.
- **Slabé popisy nástrojov.** Model nevie, kedy nástroj použiť → volá zle alebo nevolá vôbec. Riešenie: popis ako dokumentácia + preskriptívny trigger.
- **Prompt injection cez MCP / výstupy nástrojov.** Škodlivý popis nástroja alebo obsah resource presmeruje agenta. Riešenie: dôveryhodné servery, least privilege, obsah z nástrojov = dáta, nie príkazy; nezvratné akcie za potvrdením.
- **Nezvratné akcie bez gate.** Agent pošle mail / publikuje / zmaže bez schválenia. Riešenie: dedikovaný nástroj + human-in-the-loop na hard-to-reverse akcie.
- **Migrácia modelu bez re-baseline.** Nový model má iný tokenizer/ceny/správanie (napr. Sonnet 5 ~30 % viac tokenov). Riešenie: prepusti evaly, prepočítaj náklady a `max_tokens`.
- **Prehnaná viera vo framework.** Vrstva abstrakcie, ktorej nerozumieš, sťažuje ladenie. Riešenie: začni priamym API; framework len ak rozumieš kódu pod ním.

## Nástroje

- **Claude API + Anthropic SDK** (Python/TS/PHP…) — priame volanie modelu, tool use, streaming, prompt caching, batch API. Pre PHP/Laravel stack Aury existuje oficiálne PHP SDK.
- **Claude Code** — agentický CLI/harness pre vývoj (číta repo, píše kód, spúšťa testy). Konzumuje štandardné API tokeny.
- **SDK Tool Runner** — automatizuje agentickú slučku pre custom nástroje s háčikmi na schvaľovanie/logovanie.
- **Managed Agents (beta)** — server-managed agenti, kde Anthropic beží slučku aj sandbox (bash, súbory, kód). Vhodné pre hostovaných/plánovaných agentov bez vlastnej infra.
- **MCP servery** — dnes dostupné vo tvojom prostredí: Ahrefs (SEO/backlinky/keywords), Google Search Console + web analytics, Figma, Canva, ElevenLabs/Higgsfield (média), Google Calendar. Plus MCP registry na hľadanie ďalších.
- **MCP Inspector** — nástroj na ladenie a testovanie vlastných MCP serverov.
- **Eval frameworky** — DeepEval, LangWatch (agent simulácie), Anthropic Console (prompt tooling a evaly). Golden dataset môžeš držať aj ako jednoduchý verziovaný JSON/CSV.
- **Prompt caching + Batch API** — najsilnejšie páky na cenu (cache read ~10 %, batch −50 %).

## Zdroje

- [Building Effective AI Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents)
- [Writing effective tools for AI agents — Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Effective context engineering for AI agents — Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Prompting best practices — Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [Prompt engineering best practices for 2026 — Claude/Anthropic](https://claude.com/blog/best-practices-for-prompt-engineering)
- [Extended / adaptive thinking — Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Prompt caching — Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Models overview — Claude Platform Docs](https://platform.claude.com/docs/en/about-claude/models/overview)
- [MCP Specification changelog 2025-11-25 — modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [The 2026-07-28 MCP Specification Release Candidate — MCP Blog](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP 2025-06-18 Spec Update (AI security, structured output, elicitation) — ForgeCode](https://forgecode.dev/blog/mcp-spec-updates/)
- [Evaluation-Driven Development of LLM Agents (process model & reference architecture) — arXiv](https://arxiv.org/abs/2411.13768)
- [Eval Driven Development — DeepEval](https://deepeval.com/blog/eval-driven-development)
- [How to Build a Golden Dataset for LLM Evaluation](https://qaskills.sh/blog/golden-dataset-llm-evaluation-guide)
- [LLM-as-Judge: Best Practices & Evaluation Templates — Monte Carlo](https://montecarlo.ai/blog-llm-as-judge/)
- [Claude API Pricing (July 2026) — BenchLM](https://benchlm.ai/blog/posts/claude-api-pricing)
