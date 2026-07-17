# Resilient async UI

> Produkčný playbook pre načítanie, mutácie, retry, cancellation, optimistic UI, konflikty, offline/stale dáta, progress, deštruktívne akcie a prístupné oznamovanie stavov.

## Navrhni state machine pred komponentom

Každá async operácia musí mať explicitný stav. Nestačí boolean `loading`.

Zváž minimálne:

```text
idle → pending → success
              ↘ empty
              ↘ partial
              ↘ error → retrying → success/error
              ↘ cancelled
success → refreshing → success/stale/error
pending → conflict → resolve → pending/success
```

Nie každý tok potrebuje všetky stavy. Každý použitý stav však musí mať jasný vizuálny výstup, povolené akcie, focus správanie, announcement a telemetry.

### Async kontrakt

Pre request zapíš:

| Pole | Otázka |
|---|---|
| Trigger | Čo request spúšťa a môže sa spustiť opakovane? |
| Source of truth | Klient, server alebo kombinácia? |
| Idempotency | Môže sa bezpečne zopakovať? Ako sa deduplikuje? |
| Latency | Čo ukážeme pri 100 ms, 1 s, 10 s a timeout? |
| Cancellation | Dá sa operácia zrušiť? Čo sa stane s výsledkom po cancel? |
| Concurrency | Čo ak používateľ alebo iný klient zmení dáta súčasne? |
| Recovery | Retry, undo, reload, manual resolve alebo support ID? |
| Persistence | Ktorý vstup a stav zachováme po chybe/reload? |
| Accessibility | Kam ide focus a čo sa oznámi? |
| Observability | Ako zmeriame attempt, success, failure, retry a recovery? |

## Počiatočné načítanie, refresh a stale dáta

Rozlišuj:

- **initial load** — ešte nemáme použiteľné dáta,
- **refresh** — staré dáta sú stále použiteľné,
- **pagination/load more** — rozširujeme existujúcu množinu,
- **background revalidation** — overujeme čerstvosť bez blokovania,
- **stale** — dáta sú použiteľné, ale nemusia byť aktuálne,
- **partial** — časť zdrojov zlyhala alebo ešte chýba.

### Pravidlá

- Pri refreshi neschovávaj celý obsah za spinner, ak ho môže používateľ ďalej čítať.
- Stale dáta označ časom a dopadom; neprezentuj ich ako aktuálne.
- Partial výsledok zobraz s informáciou, ktorá časť chýba, a s lokálnym retry.
- Prvé načítanie nesmie na okamih ukázať empty state.
- Skeleton približne zodpovedá výslednému layoutu, ale nesmie simulovať dáta, ktoré nepoznáme.
- Po návrate z hidden tab revaliduj podľa rizika, nie automaticky každý komponent.
- Zachovaj scroll, selection a focus pri background update.

## Feedback podľa latencie

Použi prahy ako produktové vodítko, nie ako univerzálny zákon:

| Trvanie | Feedback |
|---:|---|
| <100 ms | Zvyčajne okamžitý výsledok bez spinner bliknutia. |
| 100–1000 ms | Lokálny pending stav; ovládanie potvrdí prijatie. |
| 1–10 s | Viditeľný status a možnosť pokračovať inde, ak je to bezpečné. |
| >10 s | Progress alebo priebežný stav, cancel/background režim a vysvetlenie. |

- Nezakrývaj celú aplikáciu pre lokálnu operáciu.
- Disabled tlačidlo doplň textom „Ukladám…“ alebo statusom; používateľ musí vedieť prečo je neaktívne.
- Focus ring a keyboard navigáciu neblokuj globálnym overlayom, ak zvyšok UI zostáva použiteľný.
- Spinner nehovorí, čo sa deje ani či sa systém posúva. Pri dlhšej práci zobraz etapu alebo zmysluplný progres.

## Query, search a request races

- Debounce iba vstup, nie výsledný state feedback.
- Každý request identifikuj; neskorá odpoveď staršieho requestu nesmie prepísať novší výsledok.
- Pri novom query zruš starý fetch cez `AbortController`, ak je to možné.
- Po cancel ignoruj výsledok aj telemetry success, ak už nepatrí aktívnemu intentu.
- URL alebo history stav synchronizuj len pri stabilnom používateľskom zámere, nie pri každom keypress bez potreby.
- Rozlišuj „0 výsledkov“ od network error a unauthorized.
- Zachovaj query a filtre po recoverable chybe.

## Mutácie a dvojité odoslanie

- Pri submit okamžite potvrď prijatie a zabráň náhodnému dvojitému requestu.
- Server musí ošetriť idempotenciu pri finančnej, publikačnej, create alebo destructive operácii; disabled button na klientovi nestačí.
- Použi idempotency key alebo doménový unikátny kľúč tam, kde retry nesmie vytvoriť duplikát.
- Retry po neurčitom transportnom zlyhaní vykonaj iba vtedy, keď poznáš idempotency kontrakt.
- Pri response po unmount/route change nezobraz toast v nesúvisiacom kontexte bez jasného job statusu.
- Po úspechu aktualizuj cache deterministicky: invalidate/refetch alebo bezpečný patch, nie oba nekontrolovane.

## Optimistic UI

Optimistic update použi iba ak:

- operácia má vysokú pravdepodobnosť úspechu,
- výsledok je predvídateľný,
- rollback je bezpečný a zrozumiteľný,
- konflikt alebo oprávnenie nevedie k závažnému omylu,
- používateľ nestratí vstup.

Vhodné: lokálny like, zmena poradia s bezpečným rollbackom, jednoduchý toggle.

Nevhodné bez silného kontraktu: platba, publish, delete bez undo, permission change, unikátne meno, inventory alebo operácia s neistým serverovým výsledkom.

### Optimistic flow

1. Ulož predošlý stav a mutation ID.
2. Zobraz predpokladaný výsledok ako pending, nie ako neodvolateľný fakt.
3. Po úspechu potvrď serverový výsledok.
4. Po chybe rollbackni iba svoju mutáciu, nie novšiu používateľskú zmenu.
5. Vysvetli chybu a ponúkni retry/recovery.
6. Ošetri viac pending mutácií nad tým istým objektom.

## Error taxonomy a recovery

Nehádž všetko do „Niečo sa pokazilo“.

| Typ | UI reakcia |
|---|---|
| Validation 4xx | Zachovaj vstup, označ polia, vysvetli opravu. |
| 401 | Obnov session alebo bezpečne presmeruj na login; zachovaj rozpracovanú prácu, ak je to možné. |
| 403 | Vysvetli chýbajúce oprávnenie a ownera/cestu žiadosti. |
| 404 | Rozlišuj zmazané, nikdy neexistujúce a skryté filtrom. |
| 409/412 | Zobraz konflikt, rozdiel a možnosti reload/merge/overwrite podľa rizika. |
| 429 | Rešpektuj retry timing, neumožni klikací spam. |
| 5xx | Bezpečný retry, zachovaný vstup a diagnostický identifikátor. |
| Timeout/offline | Zobraz connectivity stav, retry a prípadne queue draft. |
| Partial dependency | Zachovaj fungujúcu časť a lokálne označ chýbajúcu. |

Chybová správa odpovie:

1. čo sa stalo,
2. aký je dopad,
3. čo zostalo zachované,
4. čo môže používateľ urobiť,
5. aký identifikátor má poslať podpore, ak recovery zlyhá.

Nezobrazuj stack trace, internú výnimku, tajomstvo ani citlivý payload.

## Retry, backoff a circuit breaker

- Retryuj automaticky iba bezpečné/idempotentné operácie a transient chyby.
- Použi exponential backoff s jitterom; synchronizované retry klientov môže zhoršiť incident.
- Rešpektuj serverové `Retry-After`.
- Nastav maximálny počet pokusov a deadline; nekonečný spinner nie je recovery.
- Po vyčerpaní automatických pokusov prepnite na explicitný stav s manuálnym retry.
- Pri dlhšom výpadku zastav spam cez circuit breaker a komunikuj stav služby.
- Manuálny retry nesmie vynulovať formulár ani kontext.
- Telemetria odlíši pôvodný attempt, automatický retry a manuálny retry.

## Cancellation a dlhé úlohy

- Cancel je samostatný stav, nie automaticky error.
- Po stlačení cancel potvrď prijatie a ukáž, či je zrušenie okamžité alebo best effort.
- Ak server už operáciu dokončil, zosúlaď výsledok a vysvetli realitu; nepredstieraj rollback.
- Dlhú úlohu identifikuj job ID, aby prežila reload a route change.
- Zobraz queued/running/succeeded/failed/cancelled a čas poslednej aktualizácie.
- Progress je determinate iba vtedy, keď poznáš menovateľ. Inak zobraz etapu a aktivitu bez falošného percenta.
- Umožni pokračovať na pozadí a neskôr sa vrátiť cez journal/status.

## Konflikty a súbežné úpravy

- Posielaj version/ETag a odmietni tiché prepísanie stale editácie.
- Pri konflikte zachovaj lokálny draft.
- Ukáž, ktoré polia zmenil používateľ a ktoré server/iný editor.
- Ponúkni reload, field-level merge alebo explicitný overwrite iba podľa doménového rizika.
- Pri overwrite zopakuj authorization a version check.
- Live update nevpisuj do inputu, ktorý používateľ práve edituje.
- Po vyriešení konfliktu oznám, ktorá verzia bola uložená.

## Offline a lokálna queue

Offline podporu sľub iba pre operácie, ktoré vie systém bezpečne synchronizovať.

- Zobraz offline stav bez blokovania čítania cacheovaných dát.
- Označ posledný čas synchronizácie.
- Draft ukladaj lokálne iba v súlade s privacy/security politikou.
- Queue mutáciu s idempotency ID, poradím, retry limitom a viditeľným statusom.
- Pri konflikte po reconnect nepouži last-write-wins bez produktového rozhodnutia.
- Umožni pending akciu zrušiť pred odoslaním.
- Neoznač pending lokálnu zmenu ako serverovo potvrdenú.

## Deštruktívne akcie

Zvoľ ochranu podľa obnoviteľnosti:

- **Undo** pre rýchlo a bezpečne obnoviteľnú akciu.
- **Arm-confirm** pre častú, ale rizikovú lokálnu akciu.
- **Potvrdzovací dialog** pre významnú alebo hromadnú stratu.
- **Typed confirmation / re-auth** iba pre veľmi vysoký dopad, nie ako rituál pri každom delete.
- **Approval workflow** pre externé publikovanie, platbu, permissions alebo zásah do iných ľudí/systémov.

Potvrdenie pomenuje objekt, rozsah, následok a obnoviteľnosť. Po úspechu presuň focus na logický výsledok a ponúkni undo tam, kde existuje.

## Accessibility async stavov

- Zachovaj focus pri refreshi a lokálnom update.
- Pri submit error presuň focus na error summary alebo prvé chybné pole podľa patternu.
- `aria-busy` použi na stabilnom kontajneri počas relevantnej aktualizácie.
- `aria-live="polite"` oznamuje výsledok („Uložené“, „12 výsledkov“, „Obnovenie zlyhalo“), nie každý spinner frame.
- `role="alert"` rezervuj pre urgentnú chybu.
- Disabled/pending stav musí byť zrozumiteľný textom a state atribútom.
- Skeleton/shimmer vypni pri reduced motion.
- Toast nie je jediný nositeľ chyby ani výsledku kritickej operácie.

## Observability

Loguj bez PII/secrets:

- operation a correlation/request ID,
- attempt číslo a retry reason,
- latency a timeout stage,
- status/error class,
- idempotency result/dedup hit,
- optimistic commit/rollback,
- conflict a zvolenú recovery vetvu,
- cancellation requested/effective,
- UI state transitions, ktoré pomáhajú reprodukovať problém.

Produktové eventy rozdeľ na `attempt`, `success`, `failure`, `retry`, `cancel`, `recovery`. Jeden request nesmie vygenerovať viac success eventov po re-renderi.

## Testovacia matica

Pre každú kritickú async operáciu otestuj:

- okamžitú a pomalú odpoveď,
- timeout a offline pred/po odoslaní,
- 400/422, 401, 403, 404, 409/412, 429 a 5xx,
- dva rýchle submit kliky,
- out-of-order responses,
- cancel tesne pred dokončením,
- route change/unmount počas requestu,
- refresh počas pending mutácie,
- dve súbežné editácie,
- retry po neurčitom transportnom zlyhaní,
- screen reader announcement a keyboard focus,
- reduced motion,
- obnovenie po reload/reconnect.

## Release gate

- [ ] Stavový model rozlišuje pending, empty, partial, stale, error a cancelled podľa potreby.
- [ ] Initial load, refresh a background revalidation majú odlišné UI správanie.
- [ ] Dvojitý submit a retry nevytvoria duplicitnú mutáciu.
- [ ] Staršia response neprepíše novší intent.
- [ ] Recoverable chyba zachová vstup, selection, focus a filtre.
- [ ] Optimistic update má mutation ID, rollback a conflict pravidlá.
- [ ] Error taxonomy ponúka konkrétny recovery krok a bezpečný diagnostic ID.
- [ ] Retry je bounded, s backoff/jitter a iba pre bezpečné operácie.
- [ ] Dlhá úloha má job state, cancel a prežije reload.
- [ ] Konflikt zachová lokálny draft a neprepíše dáta potichu.
- [ ] Deštruktívna akcia má ochranu primeranú obnoviteľnosti.
- [ ] Live oznámenia sú relevantné a nespamujú.
- [ ] Testy pokrývajú latency, statusy, races, cancel, concurrency a accessibility.

## Integrácia do pokročilého plánu

- **Central router:** `skills/it/advanced-ux-ui-delivery-plan.md`.
- **Requires:** flow/state matrix z `skills/it/product-ux-delivery.md` a operation boundaries z `skills/it/frontend-component-architecture.md`.
- **Companions:** `skills/it/search-navigation-discovery.md` pre query races, `skills/it/privacy-permissions-trust-ux.md` pre permission/receipt meaning a `skills/ai-nastroje/ai-product-ux-human-control.md` pre AI streaming.
- **Hands off to:** `skills/it/frontend-performance-observability.md` s async marks, outcomes a latency segments.

## Zdroje

- [MDN — AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [MDN — HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status)
- [HTTP Semantics — Idempotent Methods](https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods)
- [HTTP Semantics — Conditional Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-conditional-requests)
- [W3C WAI — Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [W3C APG — Alert Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)
- [GOV.UK Design System — Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/)
