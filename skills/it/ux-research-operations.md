# UX research operations

> Auditovateľný playbook pre rozhodovacie otázky, výber metódy, inkluzívny recruitment, informed consent, pilot, moderovanie, evidence traceability, syntézu a bezpečný lifecycle výskumných dát.

## Miesto v pokročilom pláne

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`
- **Requires:** problem/decision brief z `skills/it/product-ux-delivery.md`.
- **Companions:** `skills/it/privacy-permissions-trust-ux.md` pre participant data, `skills/it/accessible-interaction-patterns.md` pre accessible prototype a `skills/it/ux-content-localization.md` pre materiály.
- **Hands off to:** `skills/it/product-ux-delivery.md` ako evidence pack a decision log.

Tento skill vlastní research operations a dôveryhodnosť dôkazu. Nevlastní produktový scope, UI návrh, WCAG implementáciu, analytickú telemetry ani AI trust policy.

## Výstup skillu

Vytvor `research_ops_packet`:

```json
{
  "decision": "",
  "owner": "",
  "deadline": "",
  "research_questions": [],
  "assumptions": [],
  "risk_tier": "low|medium|high",
  "method": [],
  "participant_matrix": [],
  "recruitment_criteria": [],
  "access_needs": [],
  "consent_version": "",
  "data_plan": {},
  "session_plan": {},
  "evidence_ids": [],
  "findings": [],
  "limitations": [],
  "counter_evidence": [],
  "decision_log": [],
  "retention_delete_at": ""
}
```

## 1. Prijmi iba rozhodnuteľný research request

Pred plánovaním vyplň:

| Pole | Povinná otázka |
|---|---|
| Decision | Čo sa po výsledku zmení alebo nezmení? |
| Owner | Kto má authority rozhodnúť? |
| Deadline | Kedy ešte dôkaz môže ovplyvniť produkt? |
| Unknown | Čo dnes nevieme? |
| Existing evidence | Čo už vieme a s akou dôverou? |
| Risk | Aký je dopad omylu na ľudí, dáta a produkt? |
| Population | Koho sa rozhodnutie týka? |
| Constraints | Access, čas, jazyk, právo, rozpočet, prototype. |

100 % štúdií musí mať decision, question, owner a deadline pred recruitmentom. „Zistiť, čo si používatelia myslia“ nie je rozhodovacia otázka.

## 2. Oddeľ otázku od hypotézy

- Research question píš neutrálne.
- Hypotézu označ ako predpoklad, nie ako očakávaný výsledok.
- Pri každom predpoklade zapíš, aký dôkaz by ho vyvrátil.
- Produktový stakeholder nesmie zmeniť discussion guide tak, aby si vynútil potvrdenie riešenia.
- Prioritizuj otázky podľa dopadu na rozhodnutie a neistoty.
- Otázku, ktorú vie lacnejšie zodpovedať log, support ticket alebo existujúci audit, neposielaj automaticky ľuďom.

## 3. Urči ethics/risk tier

### High-risk výskum

Zahrň high-risk review, ak sa týka:

- detí alebo zraniteľných skupín,
- zdravia, financií, práce, biometrie alebo iných citlivých tém,
- skrytého pozorovania alebo deception,
- nevratného zásahu do účtu/dát,
- výkonovej nerovnováhy,
- potenciálne traumatizujúcej skúsenosti,
- reálnych secrets alebo production dát.

High-risk štúdia vyžaduje privacy/legal/ethics ownera, stop protocol a explicitné escalation kontakty. Researcher nesmie improvizovať právny základ.

## 4. Vyber metódu podľa otázky

| Potreba | Vhodné metódy |
|---|---|
| Pochopiť kontext a behavior | contextual inquiry, interview, diary |
| Nájsť problém vo flow | moderated/unmoderated usability test |
| Overiť IA/findability | tree test, card sort, task test |
| Zmerať frekvenciu/rozdiel | survey/benchmark/experiment s dostatočnou vzorkou |
| Overiť accessibility barrier | session s používateľom relevantnej AT/access need |
| Porovnať modely | controlled task test + kvalitatívny debrief |

- Zdôvodni metódu, sample aj limitations.
- Malá kvalitatívna vzorka nevytvára population percentage.
- Survey nie je automaticky reprezentatívny.
- Trianguluj iba nezávislé dôkazy; tri podobné otázky v jednom interview nie sú tri zdroje.
- Pri nejasnom signále urob ďalšie malé kolo, nie neodôvodnený veľký výskum.

## 5. Participant matrix a recruitment

Definuj:

- actual alebo likely users,
- rolu, skúsenosť a relevantný behavior,
- zariadenie, prostredie a connectivity,
- jazyk/literacy/digital confidence,
- disability a assistive technology, ak sú relevantné,
- exclusion kritériá iba s dôvodom,
- access needs a accommodations,
- no-show/backfill policy.

Screener:

- nepoužíva leading odpovede,
- nezbiera údaje bez účelu,
- oddeľuje eligibility od citlivej informácie,
- nevylučuje ľudí iba pre pohodlie tímu,
- obsahuje red flags pre professional participants alebo conflict of interest podľa potreby.

Kritická rola alebo access-need medzera je explicitný sampling limit, nie tichý „pokryté“.

## 6. Consent a participant rights

Pred session vysvetli:

- kto výskum vykonáva a prečo,
- čo sa bude diať a ako dlho,
- ktoré údaje sa zbierajú,
- recording, notes, observers a quotes oddelene,
- storage, access, retention a sharing,
- incentive a podmienky,
- dobrovoľnosť, možnosť odmietnuť otázku a zastaviť,
- withdrawal/delete kontakt a realistické limity.

- Consent je verzovaný a zaznamenaný.
- Recording a použitie quote neskrývaj do jedného neurčitého checkboxu.
- Odmietnutie recording nesmie automaticky vyradiť účastníka, ak session možno bezpečne urobiť poznámkami.
- Researcher znovu potvrdí consent pri podstatnej zmene plánu.
- Accommodations sa splnia alebo session bezpečne zastaví.

## 7. Research data plan

Pre každé pole/artifact zapíš:

| Pole | Contract |
|---|---|
| Purpose | Prečo ho treba? |
| Source | Kto/čo ho poskytne? |
| Sensitivity | public/internal/personal/special category |
| Storage | Schválené miesto a šifrovanie policy |
| Access | Najmenšia potrebná skupina/rola |
| Sharing | Komu a v akej redacted forme? |
| Retention | Dátum alebo pravidlo delete |
| Withdrawal | Ako sa nájdu všetky kópie? |
| Owner | Kto vykoná review/delete? |

- Recruitment contacts drž oddelene od research findings.
- Raw PII nevkladaj do broad findings repository.
- Používaj participant ID, nie meno, v notes a clips.
- Prototype nesmie posielať production secret alebo participant input do neschváleného backendu.
- Observer nesmie robiť screenshot alebo zdieľať detail mimo consent scope.

## 8. Priprav materiály a pilot

Balík obsahuje:

- session guide,
- neutral task scenarios,
- prototype/build version,
- test accounts/dataset,
- consent a privacy notice,
- note-taking template s evidence IDs,
- observer briefing,
- access accommodations,
- stop/escalation protocol,
- fallback pri technickom zlyhaní.

Urob minimálne jeden pilot pred live session. Pilot overí čas, zrozumiteľnosť, recording, accessibility, prototype end-to-end a note capture.

## 9. Moderuj bez navádzania

- Zadaj cieľ, nie názov ovládacieho prvku.
- Pýtaj sa na poslednú reálnu skúsenosť pred hypotetickým názorom.
- Neopravuj človeka, kým nesleduješ prirodzený recovery.
- „Čo očakávate?“ polož pred clickom, nie po vysvetlení.
- Oddel pozorovanie od interpretácie.
- Zaznamenaj zaváhanie, workaround, úspech, kritickú chybu a vlastné slová účastníka.
- Neposudzuj inteligenciu ani schopnosť účastníka.
- Pri distresse, odvolaní consentu alebo unsafe situácii aktivuj stop protocol.

## 10. Evidence traceability

Každé atomické pozorovanie má ID:

```text
OBS-R2-P04-017
```

Finding odkazuje na jedno alebo viac observation IDs:

```yaml
finding_id: FIND-R2-05
claim: "Editors confuse pause with cancel."
evidence_ids: [OBS-R2-P02-009, OBS-R2-P04-017]
counter_evidence: [OBS-R2-P06-004]
affected_segments: [editors]
severity: major
confidence: medium
limitations: "No mobile participant in this round."
```

- Observation nie je inference.
- Quote nie je automaticky reprezentatívny finding.
- Outlier nevyhoď; vysvetli, či signalizuje edge case alebo sampling gap.
- Confidence vychádza z relevance, konzistencie, sample coverage a limitations, nie z presného falošného percenta.

## 11. Syntéza a rozhodnutie

Pri syntéze:

1. normalizuj observations bez straty participant/source ID,
2. zoskupuj podľa task/problem patternu,
3. hľadaj counter-evidence a segment differences,
4. oddeľ finding, implication a recommendation,
5. priraď severity podľa dopadu a recovery,
6. zapíš limitations a missing sample,
7. decision owner prijme, odmietne alebo odloží zmenu s dôvodom.

Researcher neprepisuje neistotu na istotu len preto, že deadline končí.

## 12. Repository a lifecycle

- Findings repo obsahuje redacted evidence pointers, nie raw recordings defaultne.
- Raw recordings majú restricted access a retention job.
- Každý artifact má study ID, version, consent scope a delete date.
- Superseded finding ostáva dohľadateľný, ale jasne označený.
- Withdrawal/delete drill nájde recruitment tool, calendar, recording, transcript, notes, clips, exports a backups podľa policy.
- Po delete ulož iba minimálny audit, že povinnosť bola vykonaná, ak je to právne dovolené.

## 13. Handoff do produktu

Odovzdaj:

- decision answered/not answered,
- findings s evidence IDs,
- affected task/segment,
- severity a confidence,
- limitations/counter-evidence,
- recommendation ako option, nie research fact,
- decision owner a deadline,
- ďalšiu najlacnejšiu otázku,
- retention/delete stav.

Product UX aktualizuje flow, assumptions, acceptance alebo accepted risk. Findings bez ownera a rozhodnutia nie sú hotový handoff.

## Release gate

- [ ] 100 % štúdií má decision, question, owner a deadline pred recruitmentom.
- [ ] Risk tier, method a sample rationale sú zdokumentované.
- [ ] Kritické role/access needs medzery sú pokryté alebo explicitné limitation.
- [ ] 100 % participantov má versioned informed consent; recording/quote sú oddelené.
- [ ] Každé pole má purpose, access, storage, owner a delete rule.
- [ ] 0 raw PII je v broad findings repository.
- [ ] Minimálne jeden pilot prešiel pred live sessions.
- [ ] 100 % findings sa dá spätne dohľadať k evidence IDs.
- [ ] Observation, interpretation, implication a recommendation sú oddelené.
- [ ] High-impact finding uvádza limitation, counter-evidence/outliers a decision ownera.
- [ ] Accommodations boli splnené alebo session zastavená.
- [ ] Withdrawal/delete drill pokryl všetky schválené kópie.
- [ ] Nie je otvorený P0/P1 ethics, privacy alebo participant-safety problém.

## Zdroje

- [GOV.UK — Plan user research for your service](https://www.gov.uk/service-manual/user-research/plan-user-research-for-your-service)
- [GOV.UK — Plan a round of user research](https://www.gov.uk/service-manual/user-research/plan-round-of-user-research)
- [GOV.UK — Find user research participants](https://www.gov.uk/service-manual/user-research/find-user-research-participants)
- [GOV.UK — Managing research data and privacy](https://www.gov.uk/service-manual/user-research/managing-user-research-data-participant-privacy)
- [GOV.UK — Getting users’ consent for research](https://www.gov.uk/service-manual/user-research/getting-users-consent-for-research)
- [GOV.UK — Taking notes and recording sessions](https://www.gov.uk/service-manual/user-research/taking-notes-and-recording-user-research-sessions)
- [W3C WAI — Involving users in web projects](https://www.w3.org/WAI/planning/involving-users/)
