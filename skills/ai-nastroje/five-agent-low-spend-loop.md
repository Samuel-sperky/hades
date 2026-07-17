# Five-agent low-spend loop

> Bezpečný návrhový playbook pre deterministický 5-rolový agentový cyklus s pevným spend capom, maximom kôl, strojovým ukončením, approval gates, auditom a cielenou druhou iteráciou.

## Dôležitá hranica

Tento Markdown je **znalostný playbook**. Sám nespúšťa agentov, nevynucuje budget, neplánuje queue job a nemení dáta. Autonómny runtime vznikne až implementáciou gateway, perzistentného ledgeru, orchestrátora, jobu a testov.

Aktivuj runtime až po splnení všetkých guardrails. Predvolený stav má byť `enabled=false`.

## Prečo deterministický workflow, nie voľný swarm

Pre UX/UI úlohy použi päť stabilných rolí:

1. **Lead / orchestrator** — normalizuje brief, dôkaz, obmedzenia a acceptance criteria.
2. **UX architect** — rieši task flows, IA, výskumné predpoklady, recovery a accessibility.
3. **UI systems specialist** — rieši tokeny, komponenty, stavy, content a responzivitu.
4. **Motion specialist** — rieši motion kontrakt, prechody, reduced motion a výkon.
5. **QA evaluator** — hodnotí spoločný artefakt podľa rubriky a vráti pass/fail s cielenými opravami.

Každá rola má jeden úzky kontrakt a malý štruktúrovaný výstup. Nezdieľaj plné chatové transcripty medzi rolami; zdieľaj brief, aktuálny artefakt, rozhodnutia a otvorené riziká.

## Loop s nízkou cenou

### Kolo 1

1. Lead vytvorí normalizovaný brief.
2. UX, UI a Motion vytvoria nezávislé sekcie nad tým istým briefom.
3. QA zlúči hodnotenie, nájde rozpory a priradí chyby ku konkrétnej role.

### Kolo 2

- Spusť iba roly, ktorým QA priradilo materiálny fail.
- Pošli im iba relevantné kritériá, aktuálny artefakt a chybový fingerprint.
- Spusť QA ešte raz.
- Tretie kolo je zakázané bez nového explicitného runu a budgetu.

Pri troch failed špecialistoch je maximum 9 model calls: 5 v prvom kole + 3 opravy + finálny QA. Nastav `max_calls_per_run=9` alebo nižšie. Model nikdy nesmie zvýšiť cap ani rozhodovať, či sa limit „ešte môže“ prekročiť.

## Role kontrakty

### Lead

Vstup: používateľský brief, scope, existujúce súbory/rozhodnutia.

Výstup:

```json
{
  "problem": "",
  "users": [],
  "evidence": [],
  "assumptions": [],
  "constraints": [],
  "acceptance_criteria": [],
  "out_of_scope": [],
  "open_questions": []
}
```

Lead nesmie navrhnúť pixelový UI ani obísť nejasný cieľ. Pri chýbajúcom rozhodnutí vytvorí blocking question alebo bezpečný explicitný predpoklad.

### UX architect

Výstup obsahuje:

- critical task a task flow,
- happy, empty, loading, partial, error, permission, conflict a recovery stavy,
- informačnú architektúru,
- keyboard/focus a non-canvas alternatívu,
- výskumné predpoklady a najlacnejší validačný test,
- UX acceptance criteria.

### UI systems specialist

Výstup obsahuje:

- mapu existujúcich tokenov a komponentov,
- component/state matrix,
- responsive a content pravidlá,
- light/dark/forced-colors správanie,
- vizuálnu hierarchiu a density,
- chýbajúci design-system primitive iba ak vznikol z reálnej potreby,
- UI acceptance criteria.

### Motion specialist

Výstup obsahuje:

- účel každej navrhnutej animácie,
- sémantické duration/easing/distance tokeny,
- enter/exit, interruption a reverse pravidlá,
- reduced/no-motion ekvivalent,
- canvas/gesture pravidlá, ak sú relevantné,
- performance budget a motion QA cases.

### QA evaluator

QA nevytvára ďalší dizajn. Hodnotí rubriku:

```json
{
  "verdict": "pass|revise|blocked",
  "scores": {
    "problem_fit": 0,
    "flow_completeness": 0,
    "accessibility": 0,
    "system_consistency": 0,
    "motion_safety": 0,
    "resilience": 0,
    "testability": 0
  },
  "failures": [
    {
      "criterion": "",
      "owner_role": "ux|ui|motion|lead",
      "severity": "blocker|major|minor",
      "evidence": "",
      "required_change": "",
      "fingerprint": "stable-hash-input"
    }
  ],
  "conflicts": [],
  "accepted_risks": [],
  "summary": ""
}
```

Pass vyžaduje nulový blocker, nulový major alebo explicitne akceptovaný major a splnenie všetkých hard acceptance criteria. Pri `blocked` nevykonávaj druhé modelové kolo, ak chýba používateľské rozhodnutie alebo oprávnenie.

## Strojové ukončovacie podmienky

Ukonči run pri prvej splnenej podmienke:

- QA vráti pass,
- rovnaký materiálny fingerprint sa zopakuje druhýkrát,
- ďalšie kolo neprinieslo materiálnu zmenu artefaktu,
- `max_rounds=2`,
- `max_calls_per_run` je vyčerpaný,
- run cap alebo day cap nevie rezervovať ďalší call,
- deadline alebo heartbeat expiroval,
- používateľ run zrušil,
- model vrátil refusal,
- provider/tool chyba dosiahla limit,
- ďalší krok potrebuje approval alebo nový scope.

Persistuj presný `exit_reason`:

```text
completed | budget_exhausted | iteration_limit | stalled |
needs_approval | blocked | failed | cancelled
```

Nikdy nepouži modelový text „myslím, že stačí“ ako ukončovací mechanizmus.

## Konfigurácia

Navrhni `hades.agents` ako env-backed config:

```php
'agents' => [
    'enabled' => false,
    'queue' => 'agents',
    'max_rounds' => 2,
    'max_calls_per_run' => 9,
    'deadline_seconds' => 900,
    'strict_budget' => true,
    'budget' => [
        'run_cap_micro_usd' => env('HADES_AGENT_RUN_CAP_MICRO_USD'),
        'daily_cap_micro_usd' => env('HADES_AGENT_DAILY_CAP_MICRO_USD'),
        'reservation_margin_bps' => 1000,
        'pricing_version' => env('HADES_AGENT_PRICING_VERSION'),
        'pricing' => [],
    ],
    'roles' => [
        'lead' => [],
        'ux' => [],
        'ui' => [],
        'motion' => [],
        'qa' => [],
    ],
    'approval' => [
        'required_for' => [],
    ],
],
```

### Pravidlá konfigurácie

- Peniaze počítaj v integer micro-USD, nie `float`.
- Cenník verziuj a pinni na run. Neznámy model alebo chýbajúca sadzba = fail closed.
- Cap nastav explicitne podľa tolerancie vlastníka; nevymýšľaj ho z modelu.
- Role pinni na model, effort, `max_tokens` a `prompt_version`.
- Predvolene použi lacnejší model a `effort=low` pre úzke, checklistové roly.
- Vyšší model/effort povoľ iba po fail rubriky, ak sa zmestí do capu a politika ho explicitne povoľuje.
- Automatický Opus escalation nech je vypnutý.
- Ak má cap pokrývať aj bežný Hades chat, route-ni chat cez tú istú budget gateway; inak ho označ ako **agent-only cap**.

## Strict spend accounting

Effort ani task budget nie sú peňažný hard cap. Hard cap vynúť v aplikácii pred každým API callom.

### Reserve → call → settle

1. Zostav presný request vrátane tools, system a messages.
2. Zavolaj token counting pre presný request.
3. Vypočítaj worst-case cenu: plný input + konzervatívny cache-write scenár + celé `max_tokens` output + margin.
4. V DB transakcii zamkni run aj daily ledger cez `lockForUpdate`.
5. Odmietni call, ak `spent + reserved + estimate > cap`.
6. Rezervuj estimate súčasne v run aj daily ledger.
7. Pošli API request bez automatických retry, ak retry nie sú osobitne rezervované.
8. Po response spočítaj skutočnú cenu z `usage`, ulož model a pricing version, settlement a uvoľni nepoužitú rezervu.
9. Pri neurčitom transportnom zlyhaní nechaj rezervu účtovanú ako `cost_uncertain`; provider mohol request spracovať.

Ak povoľuješ SDK alebo queue retry, rezervuj všetky možné pokusy a urob krok idempotentný. Inak môže retry násobiť spend mimo ledgeru.

### Cena a cache

- Eviduj input, output, cache creation a cache read tokeny oddelene.
- Stabilný system prompt, role kontrakt a rubriku drž v cacheovateľnom prefixe.
- Volatilný brief, run ID a budget stav vlož až za stabilný prefix.
- Nemeň client-side budget marker v cache prefixe pri každom turne.
- Zdieľaj kompaktný artefakt, nie celé odpovede všetkých rolí.

## Perzistentný stav

Minimálne tabuľky:

### `agent_runs`

- UUID, task/brief hash,
- status, round a call counters,
- run cap, reserved a spent micro-USD,
- prompt/pricing/model policy version,
- approval status,
- heartbeat, deadline a exit reason,
- created/started/finished timestamps.

### `agent_steps`

- unique `(run_id, round, role)`,
- status a attempt,
- model, effort, max tokens,
- input/output/cache tokeny,
- reserved/actual/uncertain cost,
- latency, stop reason a provider request ID,
- artifact JSON, artifact hash a failure fingerprint,
- sanitized error class.

### `agent_daily_budgets`

- date + scope,
- cap, reserved a spent,
- pricing/policy version,
- timestamps.

Nepersistuj chain-of-thought. Ukladaj iba štruktúrovaný výstup, krátke zdôvodnenie rozhodnutia, rubriku a auditné metadáta.

## Approval gates

MVP agenti iba čítajú a vytvárajú draft/proposal. Vyžiadaj jednorazové schválenie pre:

- file alebo business DB mutation mimo agent ledgeru,
- shell command,
- network/MCP write,
- publish, send, payment alebo permission change,
- delete a hard-to-reverse akciu,
- vyšší model/effort mimo policy,
- zvýšenie capu alebo rozšírenie scope.

Approval viaž na `action_hash`, používateľa, rozsah a expiry. Tesne pred vykonaním znovu over target a hash, aby sa predišlo TOCTOU.

Nespúšťaj start/approve endpointy na neautentizovanom API. Najmenší bezpečný trigger je Artisan command; web API pridaj až s auth, authorization, CSRF/rate limits a auditom.

## Queue a idempotencia

- Jeden run spracuj sekvenčne; paralelizáciu pridaj až po meraní capu a kvality.
- Job nastav na jeden aplikačný pokus alebo urob každý provider attempt explicitne rezervovaný.
- Použi unique step `(run, round, role)` a resume podľa uloženého stavu.
- Heartbeat aktualizuj pred a po provider calle.
- `withoutOverlapping` nestačí na hard cap; atomický ledger je povinný.
- Scheduler nesmie generovať vlastné úlohy. Konzumuje iba schválený backlog.
- Po páde procesu pokračuj od posledného settled kroku, nie od začiatku.

## Observability

Loguj štruktúrovane:

- run/step ID, role, round a attempt,
- model, effort, max tokens,
- prompt/pricing/policy version,
- reserved, actual a uncertain micro-USD,
- input/output/cache tokeny,
- latency, stop reason a exit reason,
- rubric score a failure fingerprint,
- approval request/result,
- retry count a sanitized error class.

Alerty:

- 50 %, 80 % a 100 % daily cap,
- stalled heartbeat,
- uncertain cost,
- repeated provider failure,
- cap rejection,
- rovnaký fingerprint v druhom kole.

`MindPulse` môže vysielať iba sanitizovaný progress (`role`, `round`, `status`, percent budgetu). Nevysielaj prompt, secret, PII ani chain-of-thought.

## Najmenšia runtime implementácia

1. Pridaj config + `.env.example`, predvolene disabled.
2. Pridaj migrácie a modely pre runs, steps a daily budgets.
3. Implementuj `AnthropicBudgetGateway`: count, reserve, call, settle.
4. Implementuj manuálny `FiveRoleOrchestrator`; nepouži unbounded tool runner.
5. Pridaj idempotentný queue job a Artisan start/status/cancel/approve príkazy.
6. Pridaj read-only tools a draft artefakt; writes nech sú gated.
7. Až po testoch pridaj scheduler alebo autentizované API.

## Povinné testy

- [ ] Dva súbežné runy neprekročia daily cap.
- [ ] Neznáma cena/model zlyhá pred API requestom.
- [ ] Po cap rejection nevznikne provider call.
- [ ] Skutočná usage správne settle-ne rezerváciu vrátane cache tokenov.
- [ ] Ambiguous failure ponechá konzervatívny `cost_uncertain`.
- [ ] Queue retry nevytvorí druhý step/call bez novej rezervácie.
- [ ] Každý exit reason má test.
- [ ] Druhé kolo spustí iba failed roly a QA.
- [ ] Opakovaný fingerprint ukončí loop.
- [ ] Approval hash, scope a expiry sa znovu overia pred write.
- [ ] Cancel zastaví ďalšie calls a zachová ledger.
- [ ] Logy a pulzy neobsahujú prompt, PII, secrets ani chain-of-thought.

## Go-live gate

- [ ] `enabled=false` je default a capy sú explicitné.
- [ ] Max rounds, calls a deadline sú strojovo vynútené.
- [ ] Run aj daily cap používajú atomickú rezerváciu.
- [ ] Retry politika je zahrnutá v rezervácii a idempotencii.
- [ ] Role outputs a QA rubrika sú validované JSON schema.
- [ ] Všetky writes a externé účinky sú gated.
- [ ] Start/approve surface je autentizovaný alebo iba CLI.
- [ ] Crash/resume a ambiguous cost boli otestované.
- [ ] Observability ukazuje cenu, tokeny, latency, výsledok a exit reason.
- [ ] Eval dataset dokazuje, že 5 rolí zlepšuje výsledok oproti lacnejšiemu jednoduchšiemu workflow.

## Zdroje

- [Anthropic — Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [Claude Platform — Tool Runner](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-runner)
- [Claude Platform — How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)
- [Claude Platform — Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Claude Platform — Task budgets](https://platform.claude.com/docs/en/build-with-claude/task-budgets)
- [Claude Platform — Manage tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context)
