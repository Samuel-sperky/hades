# 10-agent sequential sprint run

> Produkčný orchestration playbook pre sprint plán a implementáciu cez presne 10 logických agentov spúšťaných postupne, s 200-question discovery vstupom, kompaktnými handoffmi, kontrolnými bránami, hard budgetmi a overeným release výsledkom.

## Základný kontrakt

Toto je **10-agentový sekvenčný run**, nie desať agentov zapisujúcich naraz. Orchestrátor spustí vždy jedného agenta, overí jeho artefakt, uzavrie jeho krok a až potom spustí ďalšieho. Potrebuje teda iba dva aktívne sloty: orchestrátor + jeden subagent. Je kompatibilný aj s prostredím, ktoré povoľuje najviac štyri súbežné sloty.

Run má tri fázy:

```text
DISCOVERY          PLAN + DESIGN                IMPLEMENT + VERIFY + RELEASE
200-question bank → A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10
```

Desať rolí je pevné kvôli auditovateľnosti, ich scope sa však prispôsobí úlohe. Agent nesmie tajne rozširovať scope ani spawnovať vlastných agentov, ak to run policy výslovne nepovolí.

## Vstupy

Povinné:

- skompilovaný sprint brief zo `skills/ai-nastroje/sprint-context-200.md`,
- workspace/repository alebo iný zdroj pravdy,
- cieľ, in-scope, out-of-scope a Definition of Done,
- budget: deadline, max calls/turns, model policy a finančný cap,
- approval policy pre externé a ťažko vratné akcie.

Voliteľné:

- Figma node-specific URL a design-system zdroje,
- Canva campaign brief/template/dataset,
- issue/PR odkazy, analytika, incidenty a migračné plány,
- používateľom určené roly alebo technológie.

Ak chýba odpoveď s `impact_if_unknown=blocking`, nespúšťaj implementačnú fázu. Vytvor decision request alebo time-boxed spike.

## Run state

Orchestrátor drží jediný canonical state, nie desať paralelných chatových pamätí:

```json
{
  "run_id": "uuid",
  "objective": "",
  "scope_hash": "sha256:...",
  "status": "discovery|planning|implementation|verification|release|blocked|complete",
  "current_agent": 1,
  "budget": {"deadline": "", "max_calls": 20, "max_cost": null, "spent": null},
  "approvals": [],
  "decisions": [],
  "assumptions": [],
  "artifacts": [],
  "changed_files": [],
  "tests": [],
  "risks": [],
  "blockers": []
}
```

Stav aktualizuj iba po validácii handoffu. Nepersistuj chain-of-thought; ukladaj rozhodnutie, stručné odôvodnenie, dôkaz, confidence a zdroj.

## Univerzálny handoff kontrakt

Každý agent musí vrátiť:

```json
{
  "agent": "A1",
  "status": "passed|needs_fix|blocked",
  "summary": "max 10 viet",
  "facts_verified": [{"claim": "", "evidence": "path/url/tool output"}],
  "decisions": [{"decision": "", "reason": "", "owner": ""}],
  "assumptions": [{"assumption": "", "risk": "", "validation": ""}],
  "artifacts": [{"path_or_id": "", "purpose": "", "hash": ""}],
  "changes": [{"target": "", "effect": "", "reversible": true}],
  "tests": [{"command_or_check": "", "result": "passed|failed|not_run", "evidence": ""}],
  "risks": [{"risk": "", "severity": "", "mitigation": ""}],
  "open_items": [{"item": "", "owner": "", "blocking": false}],
  "next_agent_brief": "kompaktný task-local brief"
}
```

Handoff nesmie obsahovať celé surové výstupy predchádzajúcich agentov. Ďalší agent dostane canonical brief, relevantné artefakty a posledný `next_agent_brief`.

## Agent 1 — Context synthesizer

**Cieľ:** premeniť odpovede, repozitár a externý kontext na overený problem statement.

**Úlohy:**

- deduplikovať odpovede z 200-question banky,
- oddeliť potvrdené fakty, assumptions, decisions a blockers,
- overiť zdroje pravdy, presný workspace a scope hranice,
- zostaviť traceability mapu `goal → evidence → requirement`.

**Výstup:** `01-context-brief`, zoznam blocking unknowns a scope hash.

**Gate:** výsledok, používateľ a problém sú jednoznačné; žiadny high-impact unknown nie je skrytý.

## Agent 2 — Product and sprint planner

**Cieľ:** rozložiť výsledok na hodnotné, testovateľné a zoradené stories.

**Úlohy:**

- definovať in/out scope a prvý scope cut,
- vytvoriť stories, acceptance criteria a priority,
- určiť critical path, závislosti, spiky a milestones,
- priradiť ku každej story metriku a dôkaz dokončenia.

**Výstup:** `02-sprint-plan` s poradím implementácie a Definition of Ready/Done.

**Gate:** každá P0/P1 story je testovateľná, má ownera a zmestí sa do budgetu alebo má schválený cut.

## Agent 3 — Repository and system investigator

**Cieľ:** nájsť najmenšiu správnu zmenu v existujúcom systéme.

**Úlohy:**

- prečítať lokálne inštrukcie a relevantnú architektúru,
- zmapovať entry points, dátový tok, testy a podobné patterns,
- identifikovať user changes v dirty worktree a nedotýkať sa ich bez potreby,
- potvrdiť presné súbory, moduly, migrácie a integračné body.

**Výstup:** `03-system-map`, impact matrix a evidence-backed file plan.

**Gate:** plán nevychádza z tipovania; každý zamýšľaný zásah má zdrojový dôkaz.

## Agent 4 — Architecture and data designer

**Cieľ:** uzavrieť technické rozhodnutia pred implementáciou.

**Úlohy:**

- navrhnúť dátové modely, API/event kontrakty a ownership hranice,
- definovať idempotenciu, concurrency, retry, migration a rollback,
- znovu použiť existujúce abstrakcie a zdokumentovať vedomé odchýlky,
- vytvoriť ADR pre rozhodnutia, ktoré sa ťažko menia.

**Výstup:** `04-architecture-contract` vrátane sekvenčného change planu.

**Gate:** security, data integrity, compatibility a rollback nemajú nevyriešený kritický otvor.

## Agent 5 — UX, design system and MCP designer

**Cieľ:** uzavrieť používateľský flow a design/tool kontrakty.

**Úlohy:**

- navrhnúť happy path aj loading/empty/error/permission stavy,
- definovať responsive, accessibility a content správanie,
- pri Figme použiť `skills/design/figma-mcp-agentic-studio.md`,
- pri bannerovej produkcii použiť `skills/design/canva-banner-mcp-factory.md`,
- vyrobiť presný design-to-code alebo template/data handoff.

**Výstup:** `05-experience-spec` s node/template IDs, states a acceptance checklistom.

**Gate:** dizajn je implementovateľný z existujúceho systému a neobsahuje neoverené fakty ani tool capabilities.

## Agent 6 — Test, security and release designer

**Cieľ:** napísať dôkazy úspechu skôr, než začne hlavný zápis.

**Úlohy:**

- zostaviť unit/integration/contract/e2e/visual test matrix,
- modelovať security, privacy, abuse a failure cases,
- definovať observability, rollout, smoke test a rollback triggers,
- priradiť acceptance criteria ku konkrétnym testom alebo kontrolám.

**Výstup:** `06-verification-plan` a release checklist.

**Gate:** každé P0 kritérium má test; najväčšie riziká majú mitigation a detekciu.

## Agent 7 — Foundation implementer

**Cieľ:** implementovať najnižšiu bezpečnú vrstvu a kontrakty.

**Typický scope:** migrácie, modely, config, domain služby, API/event kontrakty, tokens alebo design foundations.

**Pravidlá:**

- upravovať iba súbory v schválenom pláne zásahov,
- použiť malé koherentné patch-e,
- zachovať existujúce user changes,
- spustiť úzke testy po každom logickom kroku,
- nevykonať publish, deploy ani externý write bez approval.

**Výstup:** `07-foundation-implementation`, diff summary a test dôkazy.

**Gate:** základné kontrakty kompilujú, relevantné úzke testy prešli a migrácia má rollback.

## Agent 8 — Feature and integration implementer

**Cieľ:** dokončiť end-to-end používateľský výsledok nad základmi A7.

**Typický scope:** UI, controller/handler, queue/workflow, Figma/Canva napojenie, error states, telemetry a feature flag.

**Pravidlá:**

- začať kontrolou A7 diffu a testov, nie slepým pokračovaním,
- rešpektovať component/design system a existujúce patterns,
- implementovať failure a recovery stavy spolu s happy path,
- neobísť API/tool permission alebo plan limit browser hackom.

**Výstup:** `08-feature-implementation`, kompletný changed-files manifest a targeted test report.

**Gate:** primárny flow je funkčný v lokálnom/test prostredí a acceptance traceability je aktualizovaná.

## Agent 9 — Independent verifier and fixer

**Cieľ:** nezávisle hľadať chyby, overiť kritériá a opraviť potvrdené problémy v scope.

**Úlohy:**

- reviewnúť diff oproti briefu, nie oproti zámeru implementerov,
- spustiť relevantné testy, lint/typecheck, visual a security kontroly,
- overiť edge cases, migration/rollback a observability,
- opraviť iba potvrdené in-scope chyby a znovu spustiť dotknuté testy.

**Výstup:** `09-verification-report` s nálezmi podľa severity a dôkazmi opráv.

**Gate:** žiadny otvorený P0/P1 problém; každý deferred nález má ownera a vedome prijaté riziko.

## Agent 10 — Release integrator and final auditor

**Cieľ:** zostaviť finálny, reprodukovateľný handoff a posúdiť Definition of Done.

**Úlohy:**

- overiť kompletnosť artefaktov, changed files a test dôkazov,
- vykonať posledný proporčný test suite a smoke check,
- pripraviť release/rollback/runbook a monitoring okno,
- uviesť presne, čo je hotové, čo deferred a čo potrebuje externé schválenie,
- nevytvoriť commit, push, PR, deploy ani publish, ak to používateľ neautorizoval.

**Výstup:** `10-final-handoff` a rozhodnutie `ready|not_ready` s dôkazmi.

**Gate:** objective je reálne splnený a nezostal žiadny povinný krok; až potom označ run ako complete.

## Orchestration pseudokód

Použi natívne collaboration primitives klienta. V Codex prostredí ide typicky o `spawn_agent`, `wait_agent`, `followup_task`, `interrupt_agent` a `list_agents`.

```text
state = initialize(brief, budget, approvals)

for agent_number in 1..10:
    assert previous_gate_passed(state)
    task = build_task_local_prompt(agent_number, state)
    worker = spawn_one_agent(task)
    result = wait_with_periodic_status(worker, deadline_per_agent)

    if result.blocked:
        resolve_safe_in_scope_checks()
        if user_decision_required: stop_and_request_decision()

    handoff = validate_schema_and_evidence(result)
    if handoff.needs_fix and retry_budget_available:
        follow_up_same_agent_with_specific_failed_checks()
        handoff = validate_again()

    if not gate_passed(handoff):
        stop_run_without_starting_next_agent()

    compact_and_commit_to_canonical_state(handoff)

finalize_only_if_agent_10_ready_and_all_required_work_done()
```

Agentov nespúšťaj všetkých dopredu. Nezávislé review A9 má dostať výsledný brief a diff, nie skryté presvedčenie A7/A8 o správnosti.

## Context budget a kompakcia

Každý agent dostane maximálne:

1. objective + in/out scope,
2. relevantné confirmed facts a decisions,
3. artefakty potrebné pre jeho rolu,
4. otvorené riziká a acceptance criteria,
5. presný output schema a gate.

Do promptu neprikladaj všetkých 200 otázok po discovery. Prilož iba skompilované odpovede a ID otázok, ktoré zostali otvorené. Surové logy nahraď cestou a krátkym výťahom.

## Budget, retry a stop policy

- Pred každým agentom rezervuj call/token/time budget.
- Default je jeden hlavný turn a najviac jeden cielený repair turn na agenta.
- Rovnaký failure fingerprint dvakrát ukončí repair loop.
- Po deadline alebo hard cape nespúšťaj ďalší model/tool call.
- Neistý externý write alebo cost eviduj konzervatívne a najprv over stav.
- Nedokončený run neoznač ako hotový iba preto, že sa minul budget.

## Approval gates

Orchestrátor môže bez dodatočného súhlasu čítať workspace, analyzovať, navrhovať, editovať používateľom zadaný scope a spúšťať primerané lokálne testy. Nové schválenie potrebuje najmä pre:

- zmenu scope alebo rozpočtu,
- zápis mimo workspace alebo do produkčných systémov,
- odoslanie správ, publikovanie, reklamy, payment a permissions,
- mazanie, prepis zdieľaných assetov alebo ťažko vratnú migráciu,
- commit/push/PR/deploy, ak neboli súčasťou výslovnej požiadavky,
- použitie neoverených osobných, licenčných alebo obchodných dát.

## Finálny sprint report

```text
Outcome achieved
Scope delivered / deferred
Ten-agent gate table (A1–A10)
Files, designs, templates and external IDs changed
Tests and QA evidence
Architecture/design decisions
Security, privacy and migration status
Known limitations with owners
Release and rollback instructions
Metrics and monitoring window
Approvals still required
```

## Release checklist

- [ ] A1–A10 prešli sekvenčne; v rovnakom čase nezapisovali dvaja agenti do toho istého cieľa.
- [ ] Scope hash sa nezmenil bez zaznamenaného approval.
- [ ] Každé P0/P1 acceptance kritérium má dôkaz.
- [ ] User changes v worktree zostali zachované.
- [ ] Testy, visual QA, security a rollback kontroly prešli primerane riziku.
- [ ] Externé writes a publish kroky majú samostatné schválenie.
- [ ] Handoff neobsahuje secrets, PII ani chain-of-thought.
- [ ] Agent 10 označil výsledok `ready` a objektív je skutočne splnený.

## Nadväzujúce playbooky

- `skills/ai-nastroje/sprint-context-200.md` — povinný discovery vstup.
- `skills/ai-nastroje/five-agent-low-spend-loop.md` — lacnejší variant pre menšie úlohy.
- `skills/design/figma-mcp-agentic-studio.md` — Figma špecializácia pre A5/A8/A9.
- `skills/design/canva-banner-mcp-factory.md` — Canva špecializácia pre A5/A8/A9.
