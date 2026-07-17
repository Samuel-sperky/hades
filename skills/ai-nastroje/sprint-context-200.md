# Sprint context 200

> Adaptívna banka presne 200 kontextových otázok, ktorá pred sprintom odhalí cieľ, scope, používateľov, architektúru, riziká, agentické integrácie, release podmienky a merateľnú definíciu hotového výsledku.

## Ako banku používať

Nežiadaj 200 odpovedí naraz bez dôvodu. Najprv načítaj dostupný kontext z briefu, repozitára, dizajnu, issue trackeru a existujúcich rozhodnutí. Odpovede, ktoré vieš doložiť zdrojom, predvyplň a označ ako `inferred`; používateľ ich iba potvrdí alebo opraví.

Zvoľ režim:

- **Quick scan** — vyber 20 najrizikovejších nezodpovedaných otázok, najviac jednu až dve z každého relevantného bloku.
- **Adaptive discovery** — pýtaj sa v dávkach 5–10 otázok; ďalšiu dávku vyber podľa odpovedí a confidence.
- **Full due diligence** — prejdi všetkých 200 v desiatich dávkach po 20, keď používateľ výslovne požaduje úplný audit alebo ide o drahý/bezpečnostne citlivý sprint.

Každú odpoveď ukladaj v tvare:

```json
{
  "id": "Q001",
  "answer": "",
  "source": "user|repo|figma|ticket|analytics|inferred",
  "confidence": "confirmed|probable|unknown",
  "owner": "",
  "decision_needed_by": "",
  "impact_if_unknown": "low|medium|high|blocking"
}
```

Nevyrábaj falošnú istotu. Nezodpovedané blocking otázky premeň na sprint assumption, spike, decision gate alebo explicitný blocker.

## 1. Výsledok a obchodný kontext

- Q001 — Aký konkrétny výsledok má byť na konci sprintu viditeľný používateľovi alebo biznisu?
- Q002 — Aký problém riešime a aké dôkazy ukazujú, že je skutočný a dostatočne dôležitý?
- Q003 — Prečo sa tento sprint robí práve teraz a čo sa stane, ak sa odloží?
- Q004 — Ktorý firemný, produktový alebo osobný cieľ tento sprint priamo podporuje?
- Q005 — Aké merateľné zlepšenie očakávame oproti súčasnému stavu?
- Q006 — Ktorý výsledok je povinný, ktorý žiaduci a ktorý iba experimentálny?
- Q007 — Aký je najmenší hodnotný výsledok, ktorý má zmysel odovzdať samostatne?
- Q008 — Kto financuje alebo vlastní výsledok a podľa čoho bude hodnotiť úspech?
- Q009 — Existuje pevný dátum, udalosť, kampaň alebo záväzok, ku ktorému sa sprint viaže?
- Q010 — Ktoré obchodné tvrdenia alebo predpoklady musíme počas sprintu potvrdiť?

## 2. Používatelia a ich problém

- Q011 — Kto je primárny používateľ a v akom kontexte bude výsledok používať?
- Q012 — Ktoré sekundárne skupiny používateľov môžu byť zmenou ovplyvnené?
- Q013 — Akú úlohu chce používateľ dokončiť a čo mu v tom dnes bráni?
- Q014 — Ako používateľ rieši problém teraz, vrátane manuálnych obchádzok?
- Q015 — Aká je frekvencia, naliehavosť a finančný alebo emočný dopad problému?
- Q016 — Akú úroveň odbornosti, jazyka a technickej gramotnosti používatelia majú?
- Q017 — Ktoré zariadenia, vstupné metódy a prostredia používania sú najdôležitejšie?
- Q018 — Ktorí používatelia potrebujú asistívne technológie alebo špecifické accessibility úpravy?
- Q019 — Aký používateľský výskum, spätná väzba, support dáta alebo analytika už existujú?
- Q020 — Ktoré používateľské správanie by spochybnilo naše súčasné chápanie problému?

## 3. Scope a priority

- Q021 — Čo je explicitne v scope sprintu?
- Q022 — Čo je explicitne mimo scope, aj keď to tematicky súvisí?
- Q023 — Ktoré user stories alebo use cases sú P0, P1 a P2?
- Q024 — Ktoré časti možno odrezať bez zničenia hlavnej hodnoty?
- Q025 — Ktoré požiadavky sú zákonné, zmluvné alebo inak nevyjednateľné?
- Q026 — Aké závislosti medzi požiadavkami určujú poradie realizácie?
- Q027 — Ktoré požiadavky sú stále nejasné alebo si navzájom odporujú?
- Q028 — Aká zmena scope vyžaduje nové schválenie času, rozpočtu alebo rizika?
- Q029 — Aké existujúce správanie musí zostať nezmenené?
- Q030 — Ktorý jediný scope cut urobíme ako prvý, ak sa sprint dostane do sklzu?

## 4. Súčasný systém a zdroje pravdy

- Q031 — Ktorý repozitár, branch, prostredie a verzia sú zdrojom pravdy?
- Q032 — Ktoré časti systému už riešia podobný problém a dajú sa znovu použiť?
- Q033 — Aké známe technické dlhy alebo dočasné riešenia sa dotýkajú scope?
- Q034 — Ktoré architektonické rozhodnutia sú už záväzné a kde sú zdokumentované?
- Q035 — Aké feature flags, konfiguračné prepínače alebo tenant rozdiely existujú?
- Q036 — Ktoré prostredia sú dostupné na lokálny vývoj, test, staging a produkciu?
- Q037 — Aké existujúce testy, fixtures, seed dáta a sandbox účty môžeme použiť?
- Q038 — Ktoré logy, dashboardy, diagramy a runbooky opisujú aktuálne správanie?
- Q039 — Kde sa už dnes objavujú chyby, incidenty alebo používateľské sťažnosti súvisiace so scope?
- Q040 — Ktoré časti aktuálneho systému nesmieme meniť bez osobitného vlastníka alebo migrácie?

## 5. Dáta a obsah

- Q041 — Aké entity, polia, vzťahy a životné cykly zmena potrebuje?
- Q042 — Ktorý systém je autoritatívnym zdrojom pre každé dôležité pole?
- Q043 — Aká je kvalita, úplnosť, aktuálnosť a konzistentnosť existujúcich dát?
- Q044 — Aké objemy dát, rýchlosť rastu a retenčné obdobia očakávame?
- Q045 — Ktoré dáta sú osobné, citlivé, regulované alebo obchodne dôverné?
- Q046 — Ako sa budú riešiť prázdne, neplatné, duplicitné, oneskorené a konfliktné dáta?
- Q047 — Potrebujeme import, export, backfill, transformáciu alebo deduplikáciu dát?
- Q048 — Kto vlastní texty, preklady, obrázky, produktové fakty a ich schválenie?
- Q049 — Aké licencie, atribúcie a dôkazy pôvodu musia sprevádzať obsah alebo AI assety?
- Q050 — Aký rollback alebo recovery postup potrebujeme pri poškodenej migrácii či zlom obsahu?

## 6. UX, dizajn a prístupnosť

- Q051 — Aký hlavný flow musí používateľ dokončiť od vstupu po úspešný koniec?
- Q052 — Aké loading, empty, error, offline, permission-denied a partial-success stavy treba navrhnúť?
- Q053 — Ktorý Figma súbor, design system, component library a token set sú zdrojom pravdy?
- Q054 — Ktoré breakpointy a container stavy treba podporiť podľa kolapsu obsahu?
- Q055 — Aké požiadavky platia pre keyboard, screen reader, focus, zoom, kontrast a reduced motion?
- Q056 — Ktoré informácie a akcie musia zostať dostupné na najmenšom podporovanom priestore?
- Q057 — Aké validačné správy, recovery kroky a potvrdenia potrebuje používateľ?
- Q058 — Aké dlhé texty, jazyky, RTL alebo používateľom zväčšené písmo treba otestovať?
- Q059 — Ktoré interakcie sú vratné a ktoré vyžadujú potvrdenie alebo undo?
- Q060 — Kto schvaľuje dizajn a aké vizuálne alebo accessibility kritériá použije?

## 7. Architektúra a integrácie

- Q061 — Aký je navrhovaný tok dát a kontroly od vstupu po výstup?
- Q062 — Ktoré komponenty, služby, queue, eventy alebo API budú zmenou dotknuté?
- Q063 — Ktoré externé systémy integrujeme a aké sú ich verzie, scopes a limity?
- Q064 — Aké kontrakty, schémy a compatibility pravidlá musia zostať stabilné?
- Q065 — Ktoré operácie musia byť synchrónne a ktoré môžu byť asynchrónne?
- Q066 — Kde je potrebná idempotencia a aký stabilný idempotency key použijeme?
- Q067 — Aké timeouty, retry, backoff, circuit breaker a DLQ pravidlá platia?
- Q068 — Ktoré cache vrstvy existujú a ako sa budú invalidovať?
- Q069 — Aký ownership a hranice zodpovednosti majú jednotlivé moduly alebo služby?
- Q070 — Ktoré architektonické rozhodnutie je najťažšie zmeniť po release a potrebuje spike?

## 8. Bezpečnosť, súkromie a právo

- Q071 — Aké identity, roly a oprávnenia môžu čítať alebo meniť nový výsledok?
- Q072 — Ako sa overí autentizácia aj autorizácia pri každom citlivom vstupe?
- Q073 — Aké secrets, tokeny, certifikáty alebo OAuth granty workflow potrebuje?
- Q074 — Kde sa citlivé dáta ukladajú, prenášajú, logujú a zálohujú?
- Q075 — Aké pravidlá minimalizácie, retencie, výmazu a exportu osobných dát platia?
- Q076 — Aké abuse cases, prompt injection, upload alebo deserializačné útoky sú relevantné?
- Q077 — Ktoré akcie vyžadujú audit trail, dvojité potvrdenie alebo oddelenie právomocí?
- Q078 — Aké právne texty, súhlasy, licencie alebo regionálne obmedzenia treba zohľadniť?
- Q079 — Ktoré tretie strany získajú dáta a aké zmluvné alebo privacy podmienky to vyvoláva?
- Q080 — Aký security review, threat model alebo penetračný test je podmienkou release?

## 9. Výkon a spoľahlivosť

- Q081 — Aké SLO alebo očakávania platia pre dostupnosť, latenciu a chybovosť?
- Q082 — Aké p50, p95 a p99 latency budgety má kritický používateľský flow?
- Q083 — Akú špičkovú súbežnosť, throughput a veľkosť payloadu musí riešenie zvládnuť?
- Q084 — Ktorá závislosť je najslabším článkom a ako sa prejaví jej výpadok?
- Q085 — Aké degradované správanie je prijateľné pri partial outage alebo rate limite?
- Q086 — Kde môžu vzniknúť race conditions, duplicitné spracovanie alebo strata udalostí?
- Q087 — Aké limity CPU, pamäte, storage, tokenov, API calls alebo browser výkonu platia?
- Q088 — Ako budeme testovať load, soak, burst a recovery scenáre?
- Q089 — Aký RTO a RPO potrebuje táto funkcionalita alebo dátová zmena?
- Q090 — Aký mechanizmus umožní bezpečne vypnúť alebo obmedziť funkciu bez deployu?

## 10. Testovanie a kvalita

- Q091 — Aké acceptance criteria sú pozorovateľné a jednoznačne testovateľné?
- Q092 — Ktoré unit, integration, contract, end-to-end a visual testy treba doplniť?
- Q093 — Aké regresné scenáre chránia existujúce kritické správanie?
- Q094 — Ktoré browsery, OS, zariadenia, locale a accessibility konfigurácie sú v test matici?
- Q095 — Aké fixtures, factories, test účty a simulované externé služby potrebujeme?
- Q096 — Ktoré testy musia byť deterministické a kde hrozí flaky správanie?
- Q097 — Ako budeme testovať chyby, timeouty, retry, rollback a partial completion?
- Q098 — Aký statický analysis, lint, typecheck, dependency a security scan musí prejsť?
- Q099 — Kto vykoná nezávislé review implementácie a podľa akej rubriky?
- Q100 — Aký dôkaz bude priložený ku každému splnenému acceptance kritériu?

## 11. Delivery a release

- Q101 — Aké technické a procesné podmienky musia byť splnené pred merge?
- Q102 — Aký branch, commit, review a pull-request workflow tím používa?
- Q103 — Ktoré CI checks sú povinné a ktoré dnes nie sú spoľahlivé?
- Q104 — Pôjde release naraz, cez feature flag, canary, percentuálny rollout alebo tenant opt-in?
- Q105 — Aký je presný deploy postup pre každé prostredie?
- Q106 — Aké migrácie, build kroky, cache warmup alebo asset publikovanie release obsahuje?
- Q107 — Kto má právo release schváliť, spustiť, zastaviť a rollbacknúť?
- Q108 — Aké smoke testy sa vykonajú bezprostredne po deployi?
- Q109 — Ako dlho bude prebiehať zvýšený monitoring a čo spustí rollback?
- Q110 — Aké release notes, používateľské oznámenia alebo interné školenie treba pripraviť?

## 12. Prevádzka a observability

- Q111 — Aké logy, metriky, traces a business events musia byť pridané?
- Q112 — Ktoré identifikátory umožnia sledovať jeden request, job alebo agent run naprieč systémom?
- Q113 — Aké dashboardy musia ukazovať zdravie funkcie a používateľský výsledok?
- Q114 — Ktoré alerty sú actionable a komu sa majú doručiť?
- Q115 — Aké prahy odlíšia normálnu variáciu od incidentu?
- Q116 — Aký runbook použije on-call pri najpravdepodobnejších zlyhaniach?
- Q117 — Ako sa zachytí a bezpečne zreprodukuje problém bez logovania secrets alebo PII?
- Q118 — Aké manuálne repair, replay alebo reconciliation nástroje bude prevádzka potrebovať?
- Q119 — Ako sa bude merať spotreba infraštruktúry, API, modelov a externých kreditov?
- Q120 — Kto po release vlastní údržbu, incidenty, aktualizácie a odstránenie feature flagu?

## 13. Ľudia, roly a rozhodovanie

- Q121 — Kto je accountable owner sprintu a kto môže robiť konečné rozhodnutia?
- Q122 — Ktoré roly sú potrebné pre produkt, dizajn, vývoj, dáta, bezpečnosť a QA?
- Q123 — Akú kapacitu má každý človek alebo agent počas sprintu reálne dostupnú?
- Q124 — Ktoré úlohy môže vykonať agent autonómne a ktoré vyžadujú človeka?
- Q125 — Kto vlastní jednotlivé súbory, moduly, dizajny a externé integrácie?
- Q126 — Aký formát handoffu musí každá rola odovzdať ďalšej?
- Q127 — Kde sa zapisujú rozhodnutia, assumptions, blockers a zmeny scope?
- Q128 — Ako rýchlo musí owner odpovedať na blocking otázku, aby sprint nestál?
- Q129 — Aké znalosti sú single point of failure a treba ich počas sprintu zdokumentovať?
- Q130 — Ako sa vyrieši spor medzi rýchlosťou, kvalitou, bezpečnosťou a scope?

## 14. Závislosti a obmedzenia

- Q131 — Ktoré tímy, dodávatelia, schválenia alebo účty sú externou závislosťou?
- Q132 — Ktoré dependency verzie, licencie alebo platformové plány obmedzujú riešenie?
- Q133 — Aké rate limits, kvóty, seat limits alebo credit caps môžu sprint zablokovať?
- Q134 — Aké sieťové, sandboxové, filesystem alebo permission obmedzenia platia v prostredí?
- Q135 — Ktoré API alebo features sú preview, beta, deprecated alebo plánované na zmenu?
- Q136 — Aké hardvérové, browserové alebo mobilné limity musíme akceptovať?
- Q137 — Ktoré kalendárne sviatky, freeze obdobia alebo dostupnosť reviewerov ovplyvnia termín?
- Q138 — Aký fallback existuje, ak kritická externá závislosť nebude pripravená?
- Q139 — Ktoré rozhodnutie alebo asset musí dodať používateľ pred začiatkom implementácie?
- Q140 — Ktoré obmedzenie môže úplne zmeniť architektúru alebo scope a treba ho overiť prvé?

## 15. Migrácia a spätná kompatibilita

- Q141 — Aké existujúce dáta, konfigurácie, linky alebo workflowy treba migrovať?
- Q142 — Musí starý a nový systém určitý čas fungovať súčasne?
- Q143 — Aké API, event, schema alebo UI kontrakty používajú starší klienti?
- Q144 — Ako sa budú verzovať breaking zmeny a komunikovať konzumentom?
- Q145 — Je migrácia online, offline, lazy, dual-write alebo read-through?
- Q146 — Ako overíme úplnosť migrácie a zosúladíme rozdiely?
- Q147 — Aký je rollback plán po čiastočne vykonanej migrácii?
- Q148 — Ktoré historické dáta sa nemigrujú a prečo je to prijateľné?
- Q149 — Ako dlho zostane compatibility vrstva a kto vlastní jej odstránenie?
- Q150 — Aký dôkaz potvrdí, že staré správanie možno bezpečne vypnúť?

## 16. AI agenti, MCP a automatizácie

- Q151 — Ktoré rozhodnutia skutočne potrebujú agenta a ktoré majú zostať deterministickým workflowom?
- Q152 — Aké MCP servery, tools a resources sú reálne dostupné a s akými scopes?
- Q153 — Ktoré skills alebo tool-specific návody sú povinné pred jednotlivými MCP volaniami?
- Q154 — Aký presný input/output JSON kontrakt má každý agent alebo tool step?
- Q155 — Aký kontext dostane agent a ktoré citlivé alebo irelevantné dáta sa musia vylúčiť?
- Q156 — Aké approval gates platia pre writes, publish, send, delete, payment a permission changes?
- Q157 — Aké max turns, calls, tokeny, čas a finančný cap má jeden agent run?
- Q158 — Ako sa zabezpečí idempotencia, resume a audit po páde alebo neistom tool výsledku?
- Q159 — Aké eval prípady a failure fingerprints preukážu, že agentický workflow je spoľahlivý?
- Q160 — Aký jednoduchší neagentický fallback zostane dostupný pri výpadku modelu alebo MCP?

## 17. Rozpočet a ekonomika

- Q161 — Aký je maximálny rozpočet sprintu v čase, ľuďoch, infraštruktúre a externých službách?
- Q162 — Aké jednorazové a opakované náklady riešenie vytvorí?
- Q163 — Koľko stoja modelové tokeny, obrázky, exporty, API operácie a storage na jeden výsledok?
- Q164 — Aký hard cap zastaví run ešte pred prekročením rozpočtu?
- Q165 — Kde sa dá použiť cache, batch, lacnejší model alebo menší kontext bez straty kvality?
- Q166 — Aké náklady vzniknú pri retry, rollbacku, reprocessingu a supporte?
- Q167 — Ktoré náklady sú neisté alebo závislé od objemu a ako ich zmeriame v pilote?
- Q168 — Aký prínos alebo ušetrený čas ospravedlní investíciu do sprintu?
- Q169 — Pri akom objeme sa oplatí automatizácia namiesto manuálneho procesu?
- Q170 — Ktorý scope cut najviac zníži náklady pri najmenšej strate hodnoty?

## 18. Metriky a experimenty

- Q171 — Aká primárna metrika najlepšie reprezentuje úspešný používateľský výsledok?
- Q172 — Ktoré guardrail metriky zabránia optimalizácii na úkor kvality alebo bezpečnosti?
- Q173 — Aký je aktuálny baseline a z akého časového okna pochádza?
- Q174 — Aké eventy, atribúty a identity treba merať, aby bol výsledok interpretovateľný?
- Q175 — Potrebujeme A/B test, postupný rollout, kvalitatívny výskum alebo iba observačné meranie?
- Q176 — Aká vzorka, dĺžka a minimálny efekt sú potrebné na rozumný záver?
- Q177 — Aké segmenty sa môžu správať odlišne a nesmú sa stratiť v priemere?
- Q178 — Ktoré confounders, sezónnosť alebo súbežné zmeny môžu skresliť výsledok?
- Q179 — Kto vyhodnotí experiment a aké rozhodnutie nasleduje po pozitívnom, neutrálnom či negatívnom výsledku?
- Q180 — Ako sa zabráni tomu, aby sa dočasný experiment stal trvalým bez review?

## 19. Riziká a hraničné prípady

- Q181 — Aké tri scenáre majú najväčší súčin pravdepodobnosti a dopadu?
- Q182 — Čo sa stane pri prázdnom vstupe, maximálnom vstupe a neplatnom formáte?
- Q183 — Čo sa stane pri duplicitnom kliknutí, requeste, evente alebo agent retry?
- Q184 — Čo sa stane, ak používateľ stratí pripojenie alebo zavrie proces uprostred operácie?
- Q185 — Ako sa systém správa pri pomalom, chybnom alebo nekonzistentnom externom API?
- Q186 — Aké časové pásma, DST, locale, meny a kalendárne hranice môžu spôsobiť chybu?
- Q187 — Aké súbežné editácie, race conditions a ownership konflikty môžu nastať?
- Q188 — Ako sa výsledok správa pri zrušenom oprávnení, expirovanom tokene alebo zmenenom pláne?
- Q189 — Aký worst-case obsah, prompt, súbor alebo používateľské správanie treba simulovať?
- Q190 — Ktoré riziko vedome prijímame, kto ho prijíma a dokedy ho treba znovu posúdiť?

## 20. Akceptácia a Definition of Done

- Q191 — Aký konkrétny artefakt musí byť na konci vytvorený, zmenený alebo odstránený?
- Q192 — Ktoré acceptance criteria musia prejsť bez výnimky?
- Q193 — Aké testy a kontroly musia byť zelené a kde bude uložený dôkaz?
- Q194 — Ktoré dizajnové, accessibility, security a performance gates sú povinné?
- Q195 — Aká dokumentácia, runbook, rozhodnutie a handoff musia byť aktualizované?
- Q196 — Aké dáta, migrácie, feature flags a konfigurácie musia byť v cieľovom stave?
- Q197 — Kto vykoná finálne acceptance review a čo presne schvaľuje?
- Q198 — Ktoré známe nedostatky možno odložiť, ak majú ownera, termín a zdokumentované riziko?
- Q199 — Aký monitoring po release potvrdí, že výsledok funguje aj v reálnej prevádzke?
- Q200 — Aká jediná veta umožní nezainteresovanému reviewerovi rozhodnúť, či je sprint naozaj hotový?

## Kompilácia odpovedí do sprint briefu

Po discovery vytvor jeden stručný artefakt:

```text
Outcome
Users and problem
In scope / Out of scope
Confirmed facts / Assumptions / Open decisions
Architecture and data impact
Security, privacy and reliability gates
Stories with acceptance criteria
Dependencies and ordered critical path
Test and release strategy
Metrics and post-release monitoring
Owners, budget and Definition of Done
```

Každý blocking unknown musí mať ownera a termín. Každý assumption musí mať validačný krok. Sprint nezačínaj len preto, že otázok bolo veľa; začni, keď sú kritické rozhodnutia buď potvrdené, alebo vedome ohraničené spikeom a approval gateom.

## Nadväzujúce playbooky

- `skills/ai-nastroje/ten-agent-sprint-run.md` — použije skompilovaný brief ako vstup pre 10 sekvenčných agentov.
- `skills/design/canva-banner-mcp-factory.md` — aplikuje discovery na bannerovú továreň.
- `skills/design/figma-mcp-agentic-studio.md` — aplikuje discovery na Figma MCP sprint.
