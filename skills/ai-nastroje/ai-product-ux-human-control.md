# AI product UX + human control

> Profesionálny UX kontrakt pre AI produkty: jasná identita, streaming, neistota a citácie, viditeľná pamäť, presné schvaľovanie akcií, zrušenie, súkromie, náklady a recovery bez predstieranej autonómnej istoty.

## Hranica skillu

Tento playbook vlastní používateľský kontrakt a rozhranie. Nenahrádza:

- serverovú autentizáciu, autorizáciu a izoláciu nástrojov,
- hard spend ledger z `skills/ai-nastroje/five-agent-low-spend-loop.md`,
- všeobecnú async state machine z `skills/it/resilient-async-ui.md`,
- prompt-injection containment, audit persistence ani incident response backendu,
- produktový discovery proces z `skills/it/product-ux-delivery.md`.

UI môže vysvetľovať a sprostredkovať kontrolu. Bezpečnosť, budget a oprávnenia musí vynucovať deterministický server.

## Výstup, ktorý má skill vytvoriť

Pre AI surface odovzdaj:

1. identity a capability contract,
2. run/event/stop-reason model,
3. provenance a uncertainty model,
4. memory visibility a retention contract,
5. approval, cancel, pause/resume a receipt flows,
6. privacy, cost a trust-boundary mapu,
7. adversarial test suite a release gate.

## 1. Označ AI, režim a hranice

- Pri prvom relevantnom kontakte a v trvalom kontexte jasne pomenuj Hades ako **AI systém**.
- Persona, meno ani vizuálny štýl nesmú predstierať človeka, vedomie alebo autoritu, ktorú systém nemá.
- Ukáž aktuálny režim: `chat`, `read-only`, `draft`, `gated action` alebo iný produktovo definovaný režim.
- Pri použití zobraz pripojené zdroje dát, model/provider a nástroje v rozsahu potrebnom na pochopenie rizika.
- Nehovor „overil som“, ak neprebehol deterministický check alebo kontrola dôkazu.
- Nepoužívaj antropomorfnú emóciu ani sebavedomie ako náhradu za stav, zdroj alebo neistotu.
- Capability text opisuje, čo systém vie teraz v tomto kontexte, nie všeobecný marketingový sľub.

### Capability card

Minimálne polia:

| Pole | Obsah |
|---|---|
| Mode | čítanie, návrh alebo vykonanie |
| Data | aké kategórie vstupov môže použiť |
| Tools | povolené nástroje a ich read/write scope |
| Memory | či sa používa a čo sa môže uložiť |
| Approval | ktoré akcie vyžiadajú potvrdenie |
| Cost | odhad, cap a čo ho môže zvýšiť |
| Limits | známe hranice, freshness a nepodporované úlohy |

## 2. Modeluj AI odpoveď ako trvalý run

Po odoslaní vytvor serverový `run_id` a používateľskú správu okamžite. Run musí prežiť reload a mať explicitný stav:

```text
draft → queued → running → waiting_approval → running → succeeded
                      ↘ pause_requested → paused → running
                      ↘ cancel_requested → cancelled
                      ↘ partial | failed | blocked | budget_exhausted | stalled
```

Každý event obsahuje minimálne:

```json
{
  "run_id": "uuid",
  "event_id": "monotonic-id",
  "type": "stage|content_delta|citation|tool_preview|usage|final|error",
  "sequence": 42,
  "created_at": "ISO-8601",
  "payload": {}
}
```

- Deduplikuj eventy podľa ID a zoraď podľa sequence.
- Finálny stav povoľ iba po explicitnom `final` evente a `stop_reason`.
- Partial text, tool JSON alebo modelový plán nikdy nesmie byť vykonateľný výsledok.
- Neposielaj ani nezobrazuj chain-of-thought. Zobraz iba faktické etapy z backend udalostí.
- Percento ukáž iba so známym menovateľom. Inak ukáž etapu, uplynutý čas a posledný heartbeat.

## 3. Streaming a priebežný feedback

- Streamovaný obsah označ ako `Pripravuje sa` alebo `Neúplné`, kým nie je finalizovaný.
- Composer si zachová focus; answer region je stabilný a používa `aria-busy` podľa potreby.
- Používateľ môže run zrušiť bez hľadania skrytého menu.
- Screen reader neoznamuje token po tokene. Oznám kompletnú vetu, zmenu etapy alebo finálny výsledok s throttlingom.
- Scroll neťahaj automaticky nadol, ak používateľ číta starší obsah. Zobraz nenásilné `Nový obsah`.
- Renderovaný Markdown, odkazy a HTML sanitizuj; remote image ani link nesmie potichu odoslať citlivý kontext.

### Prerušený stream

Pri prerušení:

1. označ prijatý text `Neúplná odpoveď`,
2. zachovaj vstup, citácie a eventy,
3. vysvetli, či mohla vzniknúť cena alebo externý účinok,
4. ponúkni `Pokračovať`, `Skúsiť znova` alebo `Nový run` podľa kontraktu,
5. nikdy potichu nepripoj druhú odpoveď k prvej.

Rozlišuj minimálne `end_turn`, `max_tokens`, `refusal`, `pause_turn`, timeout, stream break, malformed tool input a provider error. Každý stav má vlastný recovery krok.

## 4. Zobraz neistotu pri tvrdení

Označ tvrdenie podľa reálneho pôvodu:

- **source-backed** — podopreté konkrétnym dostupným zdrojom,
- **inference** — záver odvodený z uvedených faktov,
- **unverified** — nebolo overené alebo zdroj chýba,
- **conflicting** — zdroje sa rozchádzajú,
- **stale** — zdroj môže byť neaktuálny.

- Nepoužívaj modelom vymyslené percento istoty, ak nie je kalibrované na eval datasete.
- Dôležité externé tvrdenie má claim-level dôkaz alebo lokálne označenie `Neoverené`.
- Footer disclaimer nenahrádza označenie konkrétneho tvrdenia.
- Ak zdroje konfliktujú, ukáž rozdiel, dátum a čo chýba na rozhodnutie.
- Refusal vysvetlí bezpečný rozsah a ponúkne podporovanú alternatívu bez prezradenia interných guardrails.

## 5. Citácie a provenance

Citation UI obsahuje:

- názov a typ zdroja,
- presný podporujúci excerpt, stranu, blok alebo čas,
- dátum zdroja a freshness,
- odkaz, ktorý otvorí zdroj bez straty answer state,
- stav, ak zdroj už nie je dostupný.

Citácia dokazuje pôvod, nie automaticky pravdu. Testuj:

- **entailment** — excerpt skutočne podporuje tvrdenie,
- **coverage** — dôležité tvrdenia majú oporu,
- **correctness** — pointer vedie na správne miesto,
- **freshness** — dátum zodpovedá úlohe,
- **recovery** — broken alebo permission-denied zdroj sa neprikrášli.

Nikdy nevytvor falošnú citáciu ani necituj memory node, ktorý neobsahuje tvrdenie. Natívne provider citations preferuj pre dodané dokumenty, ale ich limity zahrň do kontraktu a testov.

## 6. Urob použitý kontext viditeľný

API vráti `used_context[]` oddelene od textu odpovede:

```json
{
  "node_id": "...",
  "label": "...",
  "source": "explicit|automatic|document|tool",
  "excerpt": "...",
  "freshness": "...",
  "why_selected": "..."
}
```

- V UI rozlíš explicitne pripnutý kontext od automatického recallu.
- Pri každej odpovedi ukáž `Použité spomienky/zdroje`.
- Používateľ môže node pre tento run vylúčiť a regenerovať odpoveď.
- Untrusted memory alebo retrieved text je dátový vstup, nie autorita meniaca systémovú politiku.
- Zobrazenie `why_selected` je stručná faktická väzba; nesmie prezrádzať chain-of-thought.

## 7. Pamäť je editovateľný kontrakt

Pred uložením zobraz a umožni upraviť:

- label,
- typ a plný obsah,
- zdroj a či ide o tvrdenie používateľa alebo externý dôkaz,
- účel/scope použitia,
- retention, freshness/expiry,
- citlivosť a synchronizované kópie.

Uloženie vyžaduje explicitné potvrdenie a voľbu `Toto si nepamätať`. Regex na secret je iba posledná poistka, nie consent, klasifikácia PII ani data-loss prevention.

Každá memory položka má:

- provenance a immutable source pointer,
- created, last-used a freshness,
- edit, exclude once, do-not-use-again, export a delete,
- audit toho, či bola opravená používateľom.

Editácia nesmie potichu prepísať pôvodný dôkaz. Ulož `corrected user assertion` oddelene od immutable source.

### Delete contract

Potvrdenie pomenuje scope:

- Hades node,
- pôvodný transcript/dokument,
- exportovanú provider memory,
- cache, index a synchronizované kópie,
- retenčnú výnimku.

Použi tombstone/suppression pravidlo proti tichému re-ingestu. Ak úplné vymazanie nie je možné, povedz to pred akciou a nesľubuj „zabudnuté“.

## 8. Schvaľuj dôsledok, nie neurčitý plán

Read-only retrieval môže byť viditeľný bez modálneho approval. Explicitnú review vyžadujú:

- file alebo business DB write,
- externý send/publish/payment,
- permission change,
- delete alebo ťažko vratná akcia,
- shell/network/MCP write,
- rozšírenie scope, modelu, effort alebo budget capu.

Approval sheet ukáže:

| Pole | Povinný obsah |
|---|---|
| Tool | trusted registry name, nie text z untrusted tool outputu |
| Actor | používateľ, systém a účet/oprávnenie |
| Target | presný objekt, adresát, prostredie alebo cesta |
| Payload | diff alebo hodnoty, ktoré sa zmenia/odošlú |
| Boundary | dáta opúšťajúce Hades, destination a citlivosť |
| Effect | vedľajšie účinky a počet objektov |
| Recovery | skutočné undo/rollback alebo informácia, že neexistuje |
| Cost | odhadovaný prírastok a nový cap stav |
| Expiry | dokedy je approval platné |

Voľby sú `Schváliť raz`, `Upraviť`, `Zamietnuť`. Approval nie je predvolene vybrané. `Vždy povoliť` nepouži pre high-impact akcie.

Server viaže approval na immutable action hash + používateľa + scope + expiry. Zmena targetu, payloadu, modelu, toolu, účtu alebo scope approval ruší. Tesne pred vykonaním znova over authorization aj target.

Plán a vykonanie sú samostatné approvals. Batch akcia ukáže počet, dotknutú množinu alebo reprezentatívnu vzorku a outliers.

## 9. Po akcii vydaj receipt

Receipt rozlišuje:

```text
succeeded | partial | failed | uncertain | cancelled
```

Obsahuje exact effects, timestamp, actor, tool, audit ID, cost a reálnu recovery cestu. Pri nejasnom transportnom výsledku nepovedz „zlyhalo“ ani automaticky neopakuj write; zobraz `Výsledok nie je potvrdený` a najprv zisti serverovú realitu.

Denial musí mať nulový side effect. Partial result ukáže succeeded/failed/skipped položky a bezpečný scoped retry.

## 10. Cancel, pause a resume

- Cancel potvrď okamžite ako `cancel_requested`, ale nesľubuj okamžité zastavenie provider callu.
- Po acknowledgement nespusti žiadny nový call ani action.
- In-flight účinok alebo cena sa neskôr reconcile-ne na finálnu realitu.
- Pause znamená resumable durable checkpoint; cancel je terminálny.
- `Resume after cancel` vytvorí nový prepojený run z používateľom skontrolovaného artefaktu.
- Resume neopakuje settled kroky a nepoužíva expirované approval.
- Pred resume ukáž, čo sa zmenilo: files, permissions, tools/models, pricing, zdroje a vek checkpointu.
- Budget exhaustion zachová partial artifact a presný cap reason. Zvýšenie capu je nový explicitný approval.

## 11. Agent progress bez skrytého uvažovania

Pre 5-agent loop zobraz:

- rolu, kolo, current safe stage a last heartbeat,
- sanitized artifact summary,
- calls used/max,
- reserved, actual, uncertain a cap cost,
- waiting approval, stopped alebo recovery stav,
- machine `exit_reason`.

Nezobrazuj interné reasoning traces ani predstieraný presný progress. Timeline má vychádzať iba z persistovaných backend udalostí.

Run-level `status` oddeľ od `attention[]`. Ak jeden agent čaká na approval a ostatní bezpečne pokračujú, aggregate run zostáva `running` a nesie napríklad `attention: ["approval_required"]`. Stav `waiting_approval` použi až vtedy, keď approval blokuje celý ďalší postup. UI ukáže stav každej roly aj aggregate stav bez toho, aby jeden prepisoval druhý.

## 12. Oddeľ trust boundaries

Vizuálne aj dátovo rozlíš:

- trusted system policy a autentizovaný user intent,
- web, file, transcript, memory/RAG chunk a tool output,
- interný nástroj a externý destination,
- preview a vykonaný účinok.

Untrusted obsah nikdy nesmie:

- meniť systémovú politiku,
- požadovať alebo čítať secrets,
- udeliť approval,
- autorizovať tool call,
- meniť trusted label alebo popis approval UI.

Tool argumenty a output validuje deterministický server podľa schémy a least privilege. Pred odoslaním dát cez boundary zobraz polia, destination a citlivosť. Credentials sa neposielajú do promptu.

## 13. Privacy a data-flow disclosure

Pred prvým použitím a pri zmene hraníc vysvetli:

- kategórie odosielaných dát,
- provider/MCP destination a účel,
- retention, logging a memory režim,
- používateľské access/correction/export/delete možnosti,
- či môže obsah vstupovať do telemetry alebo evalov.

Netvrď Zero Data Retention, kým konkrétny účet a endpoint nie sú tak konfigurované. Prompt, dokument, PII, secret ani chain-of-thought nevkladaj do analytiky/MindPulse defaultne.

## 14. Cost UX

Pred runom zobraz odhadovaný rozsah, hard cap a čo môže cenu zvýšiť: extra kolo, retry, model escalation alebo server tool. Počas runu rozlišuj `reserved`, `actual`, `uncertain` a `cap`.

- Odhad jasne odlíš od providerom reconciled ceny.
- Materiálne zvýšenie odhadu vyžaduje potvrdenie pred rozšírením budgetu.
- UI nie je budget enforcement; zdroj pravdy je strict server gateway.
- Post-run receipt ukáže tokeny/calls podľa potreby a presnú alebo `uncertain` cenu.
- Retry, ktorý môže zvýšiť cenu, to povie pred vykonaním.

## 15. Adversarial a recovery test suite

Povinne otestuj:

- direct a indirect prompt injection,
- poisoned memory/RAG chunk/tool description,
- hidden Unicode, HTML, image a CSS instructions,
- payload splitting cez viac zdrojov,
- malicious URL a remote image exfiltration,
- approval spoofing a mutation po approval,
- pokus o získanie chat/memory/secrets,
- stream break v každej etape,
- timeout, refusal, max tokens a malformed tool input,
- partial tool failure a ambiguous completion,
- cancel počas provider aj tool callu,
- crash/resume bez duplicitného settled kroku,
- memory delete + re-ingest,
- cap exhaustion a kill switch.

Injection test s nulovým únikom nie je dôkaz dokonalej ochrany; je to regresná brána. Obrana stojí na privilege separation, deterministic validation, approval a auditovanom recovery.

## Hades kontrakt

Pred gated writes v Hades:

- `/api/chat` vráti `run_id`, event stream, `stop_reason`, usage/cost, citations a `used_context[]`,
- explicitné context chips a automatic recall sú viditeľne odlíšené,
- remember card umožní upraviť aj celý ukladaný obsah, scope a retention,
- delete vysvetlí source/sync scope a zabráni tichému re-ingestu,
- MCP write surface je autentizovaný, autorizovaný, least-privilege a gated; samotný secret regex nestačí,
- Hades persona je jasne označená ako AI systém,
- sanitized progress môže ísť do MindPulse, prompt a hidden reasoning nie.

## Release gate

- [ ] 100 % relevantných surfaces jasne identifikuje AI a aktuálny režim.
- [ ] Streaming pokrýva event, stop, error a interruption paths; partial output nie je final ani executable.
- [ ] Live region oznamuje zmysluplné stavy bez tokenového spamu.
- [ ] Každé consequential tvrdenie má oporu alebo lokálny `Neoverené` stav; 0 fabricated citations.
- [ ] Všetok recalled context je v `used_context[]` a možno ho vylúčiť.
- [ ] Exact memory obsah je editovateľný pred uložením; edit/export/delete a re-ingest test prešli.
- [ ] 100 % high-impact akcií vyžaduje exact-scope neexpirovaný approval.
- [ ] Mutácia schváleného poľa approval zruší a denial má nulový side effect.
- [ ] Cancel zastaví všetky nové kroky; in-flight realita a cena sa reconcile-nú.
- [ ] Pause/resume neduplikuje settled calls ani nepoužíva staré approvals.
- [ ] Mixed-role test rozlíši aggregate `running`, role-level waiting a `attention[]`; čiastočný approval nezastaví bezpečné nezávislé kroky.
- [ ] Injection suite spôsobí 0 unauthorized write, disclosure alebo privilege elevation.
- [ ] UI nemôže prekročiť serverový cap; každý run má pre-run cap a post-run receipt.
- [ ] Privacy/provider retention tvrdenia sú overené voči reálnej konfigurácii.
- [ ] Keyboard, focus, 200 % zoom, forced colors, reduced motion a live-region testy prešli.
- [ ] Provider timeout, stream break, partial tool failure, crash/resume, ambiguous completion, delete/re-ingest, cap exhaustion a kill switch drill prešli.
- [ ] Pred gated writes nie je otvorený blocker ani major trust defect.

## Metriky s ownerom a cieľom

Sleduj:

- unsupported-claim rate a citation entailment/coverage,
- unsafe-action acceptance a approval comprehension,
- cancel effectiveness a recovery completion,
- memory correction/delete success,
- cost-surprise rate,
- privacy incident a unauthorized-action count,
- partial/ambiguous completion recovery.

Engagement nie je trust proxy. Vyšší počet akcií môže znamenať nátlak alebo nepochopenie.

## Zdroje

- [NIST — Generative AI Profile, NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)
- [OWASP — LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP — LLM06 Excessive Agency](https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html)
- [Model Context Protocol — Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools)
- [Model Context Protocol — Security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Anthropic — Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic — Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- [Anthropic — API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- [Anthropic — Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Anthropic — Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [W3C WCAG 2.2 — Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [European Commission — AI Act transparency guidance](https://digital-strategy.ec.europa.eu/en/faqs/guidelines-and-code-practice-transparent-ai-systems)
- [European Commission — GDPR principles and rights](https://commission.europa.eu/law/law-topic/data-protection/reform/what-does-general-data-protection-regulation-gdpr-govern_en)
