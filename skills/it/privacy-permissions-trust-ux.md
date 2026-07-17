# Privacy, permissions + trust UX

> Cross-cutting UX playbook pre data minimization, just-in-time disclosure, consent a withdrawal, role/capability states, safe sharing, consequential actions, receipts, data rights a deceptive-pattern kontrolu.

## Miesto v pokročilom pláne

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`
- **Requires:** task/data flow z `skills/it/product-ux-delivery.md`.
- **Companions:** `skills/it/api-security.md`, `skills/it/resilient-async-ui.md`, `skills/it/ux-content-localization.md`, `skills/it/accessible-interaction-patterns.md`.
- **Specializes with AI:** `skills/ai-nastroje/ai-product-ux-human-control.md` vlastní AI memory, citations, tools, injection a AI cost UX.
- **Hands off to:** API/security a backend pre server enforcement, audit, retention a rights execution.

UI vysvetľuje a sprostredkuje kontrolu. Authorization, retention, delete, consent receipt a audit musí vynucovať server a organizačná policy.

## Výstup skillu

Vytvor `privacy_permission_contract`:

```json
{
  "data_inventory": [],
  "purposes": [],
  "lawful_basis_or_policy": [],
  "required_optional": [],
  "recipients": [],
  "retention": [],
  "role_permission_matrix": [],
  "permission_states": [],
  "access_request_flow": {},
  "action_risk_matrix": [],
  "disclosures": [],
  "consent_versions": [],
  "data_rights": [],
  "telemetry_policy": {},
  "abuse_cases": [],
  "receipts": []
}
```

Tento skill nie je právne stanovisko. Právny základ, povinnosti a výnimky potvrdí oprávnený privacy/legal owner.

## 1. Zmapuj actor–data–action–boundary

Pre každý flow zapíš:

| Pole | Otázka |
|---|---|
| Actor | Kto koná a v akej role? |
| Subject | Koho sa dáta týkajú? |
| Data | Aké presné polia a možné inference? |
| Purpose | Prečo sú potrebné pre túto úlohu? |
| Source | User, admin, import, inference, third party? |
| Recipient | Kto ich uvidí alebo spracuje? |
| Boundary | Opúšťajú browser, organizáciu alebo provider? |
| Action | Read, collect, infer, share, edit, export, delete? |
| Retention | Ako dlho a kto vykoná delete? |
| Authority | Consent, contract/policy, law alebo iná schválená báza? |

100 % personal-data polí má purpose, required/optional, recipients, ownera a retention. Neznámy owner alebo účel je blocker, nie placeholder.

## 2. Minimalizuj pred pýtaním consentu

Pred zberom sa opýtaj:

1. Dá sa úloha splniť bez tohto poľa?
2. Dá sa spracovať lokálne alebo kratšie?
3. Dá sa použiť menej presná hodnota?
4. Je inference nevyhnutná a očakávaná?
5. Potrebuje recipient celé pole alebo redacted subset?

- Optional field je skutočne optional aj v API a downstream procese.
- Nezbieraj „pre budúce použitie“ bez schváleného účelu.
- Default visibility nastav na najmenší primeraný audience.
- Derived/inferred data označ a daj cestu ku correction, ak ovplyvňuje človeka.
- Secret a credential nepatrí do user-content telemetry ani promptu.

## 3. Just-in-time disclosure

Disclosure zobraz v momente, keď človek rozumie kontextu, pred odoslaním alebo zapnutím prístupu. Obsahuje:

- kto dáta používa,
- presné kategórie/polia,
- účel,
- recipient/destination,
- required vs optional,
- retention alebo link na relevantný detail,
- ako zmeniť/odvolať rozhodnutie,
- dôsledok odmietnutia bez nátlaku.

Privacy policy link sám osebe nie je informed choice. Nevytváraj modal pri každom čítaní; disclosure má byť primeraná riziku a kontextu.

## 4. Consent nie je univerzálny základ

- Legal/privacy owner určí, či sa používa consent alebo iný základ/policy.
- Ak consent nie je reálne slobodný alebo odvolateľný, nevolaj checkbox „súhlas“.
- Optional consent nie je predvolený.
- Accept a Reject majú porovnateľnú viditeľnosť a počet krokov.
- Granular purposes nemiešaj do jedného all-or-nothing toggle, ak nie sú technicky neoddeliteľné.
- Withdrawal je rovnako ľahký ako grant a vysvetlí účinnosť/retention výnimky.
- Zmena purpose alebo materially širší recipient vyžaduje nové rozhodnutie podľa policy.
- Consent receipt je verzovaný: actor, purposes, policy/content version, timestamp, locale a source surface.

## 5. Preference center

Preference center ukáže:

- aktívne purposes a scopes,
- čo je required a prečo,
- komu sa dáta posielajú,
- poslednú zmenu a source,
- turn off/withdraw cestu,
- data access/export/delete odkazy,
- pending alebo failed propagation stav.

Toggle sa nesmie tváriť vypnutý, kým backend nevie potvrdiť účinok. Partial alebo delayed revocation ukáž s affected copies a SLO.

## 6. Role–capability–object–action matrix

Nepíš iba `admin/editor/viewer`. Vytvor maticu:

```text
role × capability × object scope × action × condition
```

Príklad:

| Role | Capability | Object | Action | Condition |
|---|---|---|---|---|
| Editor | runs.cancel | own team runs | cancel | run not terminal |
| Reviewer | approvals.review | assigned | approve once | not expired |
| Viewer | memory.read | shared nodes | read | sensitivity allowed |

- UI používa serverom vydanú capability, nie názov role ako domnienku.
- Hidden button nie je authorization.
- Server pred effectom znova overí actor, object, action a version.
- Metadata, counts, suggestions a timing nesmú prezradiť unauthorized object.
- Stale permission UI dostane 403/revoked state a bezpečný recovery.

## 7. Permission states

Modeluj:

```text
unknown → checking → allowed
                  ↘ denied
                  ↘ requestable → requested → approved|rejected|expired
allowed → expiring → expired|renewed
allowed → revoked
```

Každý stav má:

- viditeľný dôvod primeraný privacy,
- povolené akcie,
- focus/announcement,
- owner/support cestu,
- retry iba ak dáva zmysel,
- telemetry bez citlivého objektu.

`Denied` nie je generic error. Nevysvetľuj existenciu alebo detail objektu, ktorý actor nesmie vedieť.

## 8. Access request a elevation

Request ukáže:

- exact capability a object scope,
- dôvod/use case,
- requester a approver,
- duration/expiry,
- data/actions, ktoré sa sprístupnia,
- audit a možnosť revocation,
- stav a SLA/SLO.

- Default duration je najkratšia primeraná.
- Permanent elevation vyžaduje silnejšie zdôvodnenie.
- Approver nesmie schvaľovať neurčitý „full access“ bez scope.
- Zmena scope po approval invaliduje approval.
- Expiry/revocation blokuje nové akcie v definovanom SLO.

## 9. Audience a sharing preview

Pred share/publish/export zobraz:

- audience a identity destination,
- presné polia alebo preview,
- source a freshness,
- či sa vytvorí verejný/stiahnuteľný link,
- expiry a access control,
- ďalšie možné zdieľanie,
- reversibility a delete scope.

Default audience je najmenší. „Anyone with link“ nie je interné zdieľanie. Export file musí mať bezpečný názov, content classification a upozornenie na citlivé polia.

## 10. Action risk tiers

| Tier | Príklady | UX ochrana |
|---|---|---|
| Low | lokálna preference | immediate + visible result |
| Medium | edit shared metadata | review affected object + undo, ak reálny |
| High | external share, permission, bulk change | exact-scope review + explicit confirm + receipt |
| Critical | legal/financial, irreversible delete, public publish | re-auth/dual approval podľa policy + deterministic server gate |

Friction pridaj podľa škody a reversibility, nie ako univerzálny rituál.

## 11. Review, correct, confirm, receipt

Pred high-impact akciou človek môže:

1. skontrolovať actor, target, fields, audience a consequence,
2. opraviť chybu bez straty práce,
3. potvrdiť exact scope bez predvoleného súhlasu.

Receipt po akcii:

```text
succeeded | partial | failed | uncertain | cancelled
```

Obsahuje exact effects, skipped/failed, timestamp, actor, audit ID a skutočný recovery. Pri ambiguous completion neopakuj non-idempotent action naslepo.

## 12. Data rights flows

Podľa potvrdenej policy/law podpor:

- access,
- correction,
- export/portability,
- restriction/objection,
- deletion,
- withdrawal.

Flow ukáže:

- scope a identity verification,
- deadline/status,
- affected systems/copies,
- lawful/technical exception,
- machine aj human-readable export podľa potreby,
- completion/partial receipt,
- escalation/appeal kontakt.

Delete nesľubuje odstránenie zo zálohy alebo auditného záznamu, ak policy vyžaduje inú lifecycle cestu. Výnimku pomenuj bez zneužitia ako univerzálne ospravedlnenie.

## 13. Shared device a sensitive display

- Sensitive recent/search/memory neukazuj na lock/login screen.
- Session timeout a re-auth chráni critical action, ale zachová bezpečný draft.
- Clipboard, download a print majú primerané warning/expiry.
- Maskovanie umožní vedomé reveal s accessible labelom.
- Browser autocomplete policy zodpovedá typu údaja.
- Sign-out vyčistí account-scoped local cache podľa contractu.
- Notification neobsahuje citlivý detail defaultne.

## 14. Privacy-preserving telemetry

Pre event definuj:

- produktovú otázku,
- povolené fields,
- zakázaný content/PII,
- aggregation/sampling,
- purpose a ownera,
- retention,
- access a deletion policy.

Nemeraj raw form values, search query, chat, memory, document title ani target audience bez explicitnej review. Consent/permission UI nemá byť optimalizované na maximalizáciu accept rate; meraj comprehension, error, withdrawal success a incidenty.

## 15. Deceptive-pattern review

Nezávislý reviewer kontroluje:

- asymetrické Accept/Reject,
- preselected consent,
- nagging po odmietnutí,
- confirmshaming,
- skrytý withdrawal/delete,
- nejasný audience alebo forced continuity,
- bundling nesúvisiacich purposes,
- false urgency/scarcity,
- roach motel flow,
- retaliation za optional privacy choice,
- misleading color, hierarchy alebo double negative.

Review zahŕňa keyboard, screen reader, 200 % zoom a localization; dark pattern môže vzniknúť aj neúmyselne.

## 16. Abuse a failure matrix

Otestuj:

- forged/expired capability,
- stale UI po revocation,
- IDOR/object substitution,
- unauthorized count/search/suggestion leakage,
- share link forwarding a expiry,
- double submit a ambiguous completion,
- partial bulk permission,
- withdrawal propagation failure,
- delete/re-ingest alebo restore zo syncu,
- shared-device history/autocomplete,
- deceptive copy/layout regression,
- support/admin overreach.

UI test nenahrádza server authorization test.

## Hades contract

- Node, memory, run, chat a telemetry polia majú data inventory, purpose, sensitivity a retention.
- Read/write/delete/export capabilities sú explicitné a serverové.
- MCP a external write nie sú verejné alebo „free to call“; vyžadujú auth, scope, approval a audit.
- Manual delete používa suppression/tombstone alebo presne varuje pred re-ingestom.
- Automatic recall je viditeľný a vylúčiteľný podľa AI human-control skillu.
- MindPulse posiela iba sanitizované IDs/states, nie user content.

## Release gate

- [ ] 100 % personal-data fields má purpose, basis/policy, required/optional, recipients, ownera a retention.
- [ ] 0 preselected optional consent; Reject/Withdraw nie je ťažší než Accept.
- [ ] Consent/policy versions a receipts sú auditovateľné.
- [ ] 100 % role/object/action combinations je v matici a server testoch.
- [ ] 0 unauthorized action alebo metadata/count/suggestion leakage.
- [ ] Access request/elevation má exact scope, duration, owner, status a expiry.
- [ ] Revoked/expired capability blokuje nové akcie v definovanom SLO.
- [ ] External share/export/publish preview ukazuje audience, fields, destination a reversibility.
- [ ] High/critical actions majú review/correct/confirm a exact receipt.
- [ ] Rights flows fungujú alebo majú potvrdenú, viditeľnú výnimku.
- [ ] Telemetry je minimalizovaná a neobsahuje user content/secret.
- [ ] Deceptive-pattern, shared-device, revoke/delete/withdraw a failure drills prešli.
- [ ] Keyboard, screen reader, 200 % zoom a localization privacy flows prešli.
- [ ] Nie je otvorený P0/P1 privacy, permission alebo trust defect.

## Zdroje

- [W3C — Privacy Principles](https://www.w3.org/TR/privacy-principles/)
- [W3C — Permissions](https://www.w3.org/TR/permissions/)
- [W3C WCAG 2.2 — Error Prevention: Legal, Financial, Data](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html)
- [NIST — Privacy Framework](https://www.nist.gov/privacy-framework)
- [European Commission — GDPR scope and principles](https://commission.europa.eu/law/law-topic/data-protection/reform/what-does-general-data-protection-regulation-gdpr-govern_en)
- [European Commission — How consent should be requested](https://commission.europa.eu/law/law-topic/data-protection/reform/rights-citizens/how-my-personal-data-protected/how-should-my-consent-be-requested_en)
- [EDPB — Data subject rights](https://www.edpb.europa.eu/topics/key-gdpr-concepts/data-subject-rights_en)
- [EDPB — Deceptive design patterns](https://www.edpb.europa.eu/documents/guideline/guidelines-032022-on-deceptive-design-patterns-in-social-media-platform_en)
