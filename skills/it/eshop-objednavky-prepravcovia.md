# E-shop objednávky a prepravcovia

Playbook pre spracovanie objednávok, generovanie prepravných štítkov, exporty a účtovnícku integráciu v PrestaShop admine značky Aura (admin718).

## Prehľad

Admin `admin718` je postavený na staršom PrestaShope (globálne triedy `Order`, `Carrier`, `Address`,
`Customer`, `Db`, `Tools`, `Configuration`, `OrderHistory`, `_DB_PREFIX_`, `pSQL`). Časť súvisiaca s
odosielaním balíkov existuje v dvoch generáciách:

- **Legacy procedurálne skripty** `md_orders_*.php` — jeden súbor na dopravcu (GLS, DPD, Packeta/
  Zásielkovňa, InPost, BRT, Intime, Česká/Slovenská pošta, FAN, MP, PX, PP…). Každý si sám inicializuje
  PrestaShop, sám číta objednávky z DB, sám volá API dopravcu a sám prepisuje stav objednávky. Kód sa
  medzi súbormi kopíruje.
- **Moderná abstrakcia `App\OnlineCarrier`** (PSR-4, namespace `App\`, autoload cez
  `config/psr4loader.php`) — jednotná objektová vrstva, do ktorej sa dopravcovia postupne migrujú.
  Nahradzuje duplicitný procedurálny kód návrhom factory → carrier → api handler.

Prečo to pre biznis so šperkami reálne rozhoduje:
- **Rýchlosť expedície.** Šperky sa balia dennne v dávkach; hromadné generovanie štítkov (dávka 10
  objednávok naraz cez `curl_multi`) skracuje čas na baliacom stole.
- **Správne stavy objednávky = správne e-maily zákazníkovi.** Prechod na stav „odoslané" spúšťa
  notifikačný e-mail a tracking. Chyba v stavovom automate znamená zmätený zákazník.
- **Účtovníctvo bez ručného prepisu.** Export do KROS/Inteo posiela faktúry a dobropisy priamo do
  účtovného systému; NBS kurzy zabezpečia správny prepočet cudzích mien.
- **OSS a DPH cez hranice.** Aura predáva do viacerých krajín (SK, CZ, HU, RO, PL, DE, AT, BG, HR, SI,
  IT). Číselné rady a OSS režim sa počítajú podľa krajiny fakturácie.

## Kľúčové pojmy

- **OnlineCarrier** — abstraktná trieda (`App\OnlineCarrier\Carriers\OnlineCarrier`) reprezentujúca
  jedného konkrétneho dopravcu/službu. Každá inštancia má `carrierId` (PrestaShop `id_carrier`),
  `groupName`, `capabilities`, `apiType`.
- **ApiHandler** — vrstva, ktorá reálne vykoná HTTP/API požiadavku (`sendRequest`, `sendMulti`),
  konvertuje dáta, loguje, ošetruje chyby. Nezávisí od konkrétneho dopravcu.
- **Capability** — voliteľná schopnosť dopravcu (storno, návratka, uzávierka, sťahovanie odoslaných/
  doručených zásielok). Riadi sa cez `OnlineCarrierCapabilityEnum`.
- **Shipment / prepared order** — dáta jednej objednávky pripravené do formátu API dopravcu; držia sa
  v `$this->shipments[id_order]` do momentu spracovania dávky.
- **Batch (dávka)** — skupina objednávok (default `shipmentsPerBatch = 10`) odoslaná do API naraz.
- **Order state (`id_order_state`)** — PrestaShop stav objednávky; celý životný cyklus expedície je
  postavený na prechodoch medzi stavmi (`OrderHistory::changeIdOrderState`).
- **Domain** — Aura beží ako multidomain (viac jazykových/krajinových eshopov nad jednou DB). Prihlásenie
  k dopravcovi (napr. GLS) sa rieši per `id_domain`.
- **Box vs non-box variant** — trieda s príponou `Box` = výdajné miesto / parcel locker (Packeta
  Z-Point, GLS ParcelShop, InPost Paczkomat, BoxPi automat); bez prípony = doručenie na adresu (kuriér).
- **KROS / Inteo** — účtovný systém; admin do neho posiela prijaté objednávky (faktúry), dobropisy
  (slips) a storná cez REST API `eshops.inteo.sk`.
- **NBS kurz (`nbs_rate`)** — denný kurz NBS uložený na objednávke pre prepočet cudzej meny v účtovníctve.
- **OSS** — One Stop Shop režim DPH pre predaj do EÚ; určuje sa podľa krajiny fakturácie.

## Architektúra App\OnlineCarrier

Vrstvy (adresár `admin718/App/OnlineCarrier/`):

```
Factories/     OnlineCarrierFactory, ApiHandlerFactory      (výber správnej triedy)
Interfaces/    OnlineCarrierInterface, ApiHandlerInterface   (kontrakty)
Carriers/      OnlineCarrier (abstract) → RestOnlineCarrier / OAuth2OnlineCarrier /
               HMACRestOnlineCarrier / HeaderAuthRestOnlineCarrier / AzureRestOnlineCarrier
               → GLS, Packeta, BoxPi, SkPosta, HuPost, InPost, PBH, UrgentCargus, CzPosta, PPL
               → konkrétne varianty (GLSHu, GLSHuBox, PacketaSkBox, BoxPiCzBox, …)
ApiHandlers/   ApiHandler (abstract) → RestApiHandler, OAuth2RestApiHandler, HeaderAuthRestApiHandler,
               AzureRestApiHandler, HMACRestApiHandler
Dtos/          ApiRequestDto, ApiResponseDto, PreparedOrderDto, PreparedOrderInfoDto,
               ProcessedOrderDto, SubmittedOrderDto, OnlineCarrierInfoDto
Enums/         ApiTypeEnum, ContentTypeEnum, OnlineCarrierCapabilityEnum,
               HandledOrderStateEnum, ProcessedOrderStateEnum
Helpers/       MultiRequest, MultiResponse, NamedCollection, OrderCollector, ApiDataConverter,
               ApiHandlerLogger
Services/      PdfLabelService
```

**Factory reťazec (ako sa z `id_carrier` stane spracovanie):**

1. `OnlineCarrierFactory::byCarrier($idOrCarrier)` — nájde registrovanú inštanciu podľa `carrierId`.
   Registrácia je statické pole `$carrierClasses` v `OnlineCarrierFactory`; pri `init()` sa každá trieda
   inštanciuje a zaindexuje podľa `getCarrierId()` (duplicita ID = výnimka). Zakomentované triedy = dočasne
   vypnutí dopravcovia.
2. Ak inštancia nemá ApiHandler, factory ho doplní cez
   `ApiHandlerFactory::getByType($carrier->getApiType())`.
3. `ApiHandlerFactory` prechádza `$apiHandlerClasses`, porovnáva `getApiType()` a vráti čerstvú inštanciu
   správneho handlera; ak sa žiadny nezhoduje, vráti `LogApiHandler` (fallback, ktorý len loguje).

**Typová väzba dopravca ↔ handler** ide cez `ApiTypeEnum` (`REST`, `OAUTH2`, `HEADER_AUTH`, `AZURE`,
`HMAC`, `BEARER_TOKEN`, `SOAP`, `KEY`, `FILE`, `LOG`, `UNKNOWN`). Napr. `RestOnlineCarrier` má
`apiType = REST` → dostane `RestApiHandler`.

**Životný cyklus jednej objednávky vo vrstve OnlineCarrier:**

```
handleOrder(Order)                       [OnlineCarrier::handleOrder]
  └─ validateOrder(Order)                overí total_paid_real > 0 a povolený stav
     ├─ false → handled(REJECTED, msg)   PreparedOrderInfoDto so správou
     └─ true  → prepareOrder(Order)      [abstract, implementuje konkrétny dopravca]
          └─ registerShipment(Order,data) uloží data do $shipments, vráti handled(ACCEPTED)

processOrders()                          [OnlineCarrier::processOrders]
  ├─ initApiHandler()
  ├─ rozdelí $shipments na dávky (shipmentsPerBatch, default 10)
  └─ pre každú dávku:
       ├─ zabalí do PreparedOrderDto[]
       ├─ processBatch(batch)            [abstract, volá API dopravcu]
       │    ├─ úspech → setOrderSuccess(order, tracking, packageId, sheetId)
       │    └─ chyba  → setOrderFailed(order, message)
       ├─ meria čas dávky, loguje do RotLog 'api-times'
       └─ ak dávka > BATCH_EXEC_TIME_LIMIT_SECS (5 s) → break
  └─ vráti ProcessedOrderDto[] (successOrders + failedOrders)
```

`setOrderSuccess` robí: zápis `ProcessedOrderDto`, prechod na `submittedStatus`, pri `order->gold` a
zapnutom pickingu na `goldStatus`, na `finalStatus`, a `UPDATE ps_orders SET shipping_number, id_package,
id_sheet`. Každý stavový prechod je `OrderHistory::changeIdOrderState` + `addWithemail` (notifikácia).
`setOrderFailed` zapíše súkromnú `Message` k objednávke a založí ju do `failedOrders`.

**Stavy objednávky (číselné `id_order_state`) používané vo vrstve** (default v abstract triede, konkrétni
dopravcovia si ich prepisujú): `statuses = [189]` (vstupné, čo sa smie odoslať), `submittedStatus = 161`
(odoslané online), `goldStatus = 128` (picking/zlato), `finalStatus = 180`, `STORNO_STATE = 134`.
Cron doručenia používa `FINAL_STATE = 5`. Konkrétne čísla ber ako konfiguráciu, nie ako konštantu naprieč
projektom.

## ApiHandler — vykonanie požiadavky

- **`ApiRequestDto`** — statické továrne `post()`, `get()`, `delete()`, `put()`, `soap()`; nesie
  `urlOrAction`, `params`, `contentType` (`ContentTypeEnum`, default JSON), `extraHeaders`, `ignoreSSL`.
- **`sendRequest(ApiRequestDto): ApiResponseDto`** — postaví cURL (`initializeCurl`), pre POST/PUT/PATCH/
  DELETE pripne telo cez `adaptDataContentType`, pre GET poskladá query string. Timeouty:
  connect 60 s, total 20 min (nastaviteľné). HTTP ≥ 400 a nezapnutý `disableErrorHandler` → vyhodí
  `UnexpectedValueException` (rozlíši `SERVER` ≥ 500 vs `API`).
- **`sendMulti(MultiRequest): MultiResponse`** — paralelné requesty cez `curl_multi`; výsledky sú
  buď `ApiResponseDto` alebo zachytená výnimka (indexované cez `NamedCollection` podľa id objednávky).
  Používa sa napr. pri hromadnom sťahovaní PDF štítkov.
- **Logovanie** — `ApiHandlerLogger` (request, response, interné hlášky, API chyby); dopravcovia navyše
  logujú cez `RotLog::info/custom`.
- **Parsovanie tela** — `ApiDataConverter::parseBody` podľa `Content-Type` hlavičky odpovede;
  `ApiResponseDto->getBody()` vráti dekódované dáta (poľové prístupy `$response['Key']`).

## Generovanie štítkov krok za krokom (na príklade GLS)

`App\OnlineCarrier\Carriers\GLS\GLS::processBatch`:

1. `GLSAuthDto::fromDomainId($order->id_domain)` — načíta prihlasovacie údaje pre daný eshop/doménu.
2. Postaví `ParcelList` — pre každú objednávku v dávke pripojí `$preparedOrderDto->data` (postavené v
   `prepareOrder`: adresa doručenia, pickup adresa z `Configuration::Get('GLS_*_'.id_domain)`, servisné
   kódy, pri dobierke `CODAmount`/`CODReference`). Overí, že celá dávka je z jednej domény.
3. `POST /ParcelService.svc/json/PrintLabels` → dostane `PrintLabelsInfoList` (`ParcelNumber` = tracking,
   `ParcelId`, `ClientReference` = id objednávky). Chyby v `PrintLabelsErrorList` → výnimka.
4. Pre každú úspešnú zásielku poskladá do `MultiRequest` request `GetPrintedLabels` (podľa `ParcelId`).
5. `sendMulti` stiahne PDF štítky paralelne; telo je pole bajtov → `pack("C*", ...)` na binárne PDF →
   `pdfLabelService->set($pdf, $order)`.
6. `setOrderSuccess($order, $trackingNumber, $parcelId)` — uloží tracking + id balíka a posunie stavy.

**Výdajné miesto vs kuriér** — GLS: ak v `ps_glsmap` existuje `branch` pre danú objednávku a pôvodný
`id_carrier` sedí, servisný list obsahuje kód `PSD` (ParcelShop delivery); inak kuriérske služby
`FDS`/`FSS`/`CS1` (e-mail + telefón notifikácie). Iní dopravcovia majú vlastnú mapovaciu tabuľku
výdajných miest (`ps_inpost`, `ps_spsparcelsk`, Packeta point tabuľky…).

**PdfLabelService** (`App/OnlineCarrier/Services/PdfLabelService.php`):
- Ukladá do `admin718/pdfStorage/<carrier>/<carrier>-<id_order>.pdf` (`set`), číta cez `get`, web cesta
  cez `getPath` → `/admin718/pdfStorage/...`.
- `clearOldData()` sa volá v konštruktore — maže PDF staršie ako 7 dní.
- `saveAs`/`checkFileExists` pre hromadné hárky.

**Capability metódy** (implementované len tam, kde to API dopravcu vie; inak default `throw`):
- `storno(Order)` — zruší zásielku u dopravcu (GLS `DeleteLabels`) a `setStornoOrder` (vyprázdni
  `shipping_number`/`id_package`/`id_sheet`, prechod na `STORNO_STATE`, súkromná správa). Webový vstupný
  bod: `online_carrier_storno.php?id_order=&token=`.
- `getSubmittedOrders()` / `getDeliveredOrders()` — sťahujú stav zásielok z API (cron
  `cron/onlinecarrier_process_delivered.php` prejde po jednom dopravcovi na skupinu s capability
  `CAN_GET_DELIVERED` a posunie doručené objednávky na `FINAL_STATE`).
- `return(Order)` — vygeneruje návratkový štítok / URL.
- `closeOrders()` — denná uzávierka (SK/HU pošta).

## Legacy procedurálne skripty md_orders_*.php

Každý súbor je samostatný endpoint volaný z admin UI (formulár s dátumovým rozsahom a stavom). Vzor:

```php
define('PS_ADMIN_DIR', getcwd());
include(PS_ADMIN_DIR.'/../config/config.inc.php');
require_once(dirname(__FILE__).'/init.php');   // cookie / login
// 1. getResults($from, $to, $status)  → SELECT z ps_orders + ps_order_history
// 2. processOrders()                  → per objednávka: postav request, zavolaj API dopravcu
// 3. success → OrderHistory na nový stav + zápis shipping_number; fail → private Message
// 4. header('location: index.php?tab=AdminOrders&...&updated=&failed=')
```

Príklad `md_orders_ip.php` (InPost / ShipX): `getResults` cez join na `ps_order_history` vyfiltruje
objednávky v danom stave a dátume, `processOrder` postaví JSON (receiver, parcel dimensions, insurance,
COD, service = locker/courier), `apiCall` pošle `POST` na ShipX, `updateTrackingNumbers` dotiahne tracking
druhým GET volaním. Rozlišuje `CARRIER_BOX_ID` (paczkomat) vs `CARRIER_COURIER_ID` (kuriér) a výdajné
miesto číta z `ps_inpost`.

Zoznam legacy súborov podľa dopravcu (výber): `md_orders_gls.php`, `md_orders_dpd.php`,
`md_orders_brt.php`, `md_orders_intime.php`, `md_orders_ip.php` (InPost), `md_orders_cp.php`,
`md_orders_fan.php`, `md_orders_mp.php`, `md_orders_px.php`, `md_orders_pp.php`, `md_orders_pbh.php`,
`md_orders_uc.php`, `md_orders_posta.php`, `md_orders_zasielkovna.php`, `md_orders_zasielkovnacz.php`,
`md_orders_packetahu.php`, `md_orders_packetaro.php`, `md_orders_pickpackpont.php`,
`md_orders_ulozenka.php`, `md_orders_skpost_xml.php`. Účtovnícke/CSV varianty: `md_orders_ucto.php`,
`md_orders_csv.php`, `md_orders_frmedk_csv.php`.

Cieľom je tieto skripty postupne nahrádzať triedami v `App\OnlineCarrier` (viď zakomentované triedy
v `OnlineCarrierFactory` — čakajú na dokončenie migrácie).

## Exporty objednávok a dát

- **`md_orders_csv.php`** — CSV export objednávok. `mdDataType = 1` = štandard (podľa `date_add`),
  `2–5` = SPS dávky (ranná/obedná tlač a dotlač, filtruje stavy 90/91/96/97, radí podľa priezviska).
  Zisťuje dobierku/pobočku z `ps_spsparcelsk` (carrier 48) a či je objednávka „za 0" (stav 2). Výstup
  je prekódovaný do `WINDOWS-1250` (`iconv`) a uložený do `admin718/mdcsv/orders.csv` alebo `orders_sps.csv`.
- **`export_stockorder.php`** — CSV skladovej objednávky (`StockOrder`): názov, skladový kód, dodávateľský
  kód, objednané/priskladnené/poškodené množstvo. Dopĺňa neznáme položky (`getUnknownProducts`).
- **`exportorders.php`** — tenký wrapper, deleguje na PrestaShop modul `exportorders` cez
  `hookExport()`.
- **`gls_labels/`, `pbh_labels/`, `pdfStorage/`** — úložiská vygenerovaných štítkov/hárkov (PDF).

## Účtovnícky export do KROS/Inteo (krosapi/)

Adresár `admin718/krosapi/`:
- **`classes/Kros.php`** — orchestrátor. `setFrom/setTo/setType/setZone`, potom `submit()` (dávkovo) alebo
  `submitOne()` (jedna objednávka), prípadne `submitCQ()` cez `CronQueue`. Typy: `1` = prijaté objednávky
  (faktúry), `4` = dobropisy (`OrderSlip`), `5` = storná (TODO). `zone` = geografická zóna
  (`ps_country.id_zone`) → filter krajín.
- Zostaví z PrestaShop objednávky doménové objekty: `KrosReceivedOrder` (hlavička dokladu), `KrosClient`
  (odberateľ — IČO/DIČ/IČ DPH z `ps_address.company_*`), `KrosSender` (dodávateľ — firemné údaje z
  `Domain`), `KrosItem[]` (produkty, darčeky, doprava, zľavy, poplatky), `KrosAddress` (fakturačná +
  dodacia). Posiela `POST /incomingorders` cez `KrosApi`.
- **`classes/KrosApi.php`** — klient s dávkovaním (`batchSize = 10`, rate limit `5 req/s`) nad
  `curl_multi`. Vracia štruktúrované odpovede (`success`, `httpcode`, `response`, `error`), loguje do
  `RotLog 'krosApi'`.
- **DPH a číselné rady** — `Kros::useOssTax(Country)` zapne OSS pre EÚ krajiny (mimo zoznamu ako SK, GB,
  CH, RS, NO, US…). `Kros::getNumSet(type, Country)` skladá číselný rad podľa krajiny a typu (napr. `OF`
  pre SK faktúry, `zOF<ISO>` pre ostatné, `OD`/`zOD<ISO>` pre dobropisy, `SF`/`zSF<ISO>` pre storná).
- Dobropisy (`prepareSlips`) odčítajú z pôvodnej objednávky množstvá/sumy zo všetkých `OrderSlip`
  (produkty, darčeky, doprava, poplatky) a pošlú upravený doklad.

## NBS kurzy (load_nbs_rates_year.php + cron/)

- `load_nbs_rates_year.php` stiahne ročný XML export kurzov z `nbs.sk`, spáruje meny s `Currency` a
  poskladá `UPDATE ps_orders SET nbs_rate = CASE … END` podľa `DATE(date_add)` a `id_currency`. Chýbajúce
  dni (víkendy/sviatky) dopĺňa posledným známym kurzom. V súbore je samotné vykonanie zakomentované
  (bezpečnostná poistka — najprv vypíše query).
- Denné behy: `cron/load_nbs_rates.php`, `cron/nbs.php`. Kurz sa používa pri prepočte cudzej meny v
  účtovníckom exporte (`KrosReceivedOrder` berie `currency->conversion_rate`).

## Checklist — pridanie nového dopravcu do OnlineCarrier

- [ ] Vytvor triedu v `App/OnlineCarrier/Carriers/<Skupina>/<Nazov>.php`, rozšír správnu bázu podľa
      typu auth (`RestOnlineCarrier`, `OAuth2OnlineCarrier`, `HMACRestOnlineCarrier`…).
- [ ] Nastav `carrierId` (PrestaShop `id_carrier`), `groupName`, `statuses`, `submittedStatus`,
      `finalStatus`, `capabilities`.
- [ ] Implementuj `prepareOrder(Order): PreparedOrderInfoDto` (postav dáta + `registerShipment`).
- [ ] Implementuj `processBatch(array $batch): void` (volanie API, `setOrderSuccess`/`setOrderFailed`,
      uloženie PDF cez `pdfLabelService->set`).
- [ ] Voliteľné capability metódy (`storno`, `return`, `getDeliveredOrders`, `closeOrders`) + zápis do
      `$capabilities`.
- [ ] Zaregistruj triedu v `OnlineCarrierFactory::$carrierClasses`.
- [ ] Over, že `carrierId` nekoliduje s iným (factory vyhodí výnimku pri duplicite).
- [ ] Uisti sa, že `apiType` má zodpovedajúci ApiHandler (inak spadne na `LogApiHandler`).
- [ ] Otestuj celý reťazec `handleOrder` → `processOrders` na testovacej objednávke.

## Časté chyby a gotchas

- **Miešanie generácií.** Ten istý dopravca môže mať aktívny aj legacy `md_orders_*.php` aj triedu v
  `OnlineCarrier`. Zisti, ktorý sa reálne volá z admin UI (`tabs/AdminOrders.php`, `print.php`, `fun.php`),
  než niečo upravíš — inak opravíš mŕtvy kód.
- **Zakomentovaní dopravcovia vo factory.** `OnlineCarrierFactory::$carrierClasses` má viacero
  zakomentovaných tried (PPL, InPost, UrgentCargus, CzPosta…). Nie sú aktívni; `byCarrier` pre ne vráti
  `null`.
- **Doména musí byť konzistentná v dávke.** GLS (a podobní) vyžadujú, aby všetky objednávky v jednej
  dávke boli z rovnakej `id_domain` (rôzne prihlásenie per eshop) — inak výnimka. Pri hromadnom
  spracovaní filtruj podľa domény.
- **Časový limit dávky.** `processOrders` po prekročení `BATCH_EXEC_TIME_LIMIT_SECS` (5 s) preruší
  ďalšie dávky — pri pomalom API sa časť objednávok nespracuje a treba spustiť znova.
- **PDF starnú.** `PdfLabelService` maže štítky staršie ako 7 dní pri každej inštanciácii; nespoliehaj sa
  na trvalé úložisko štítkov.
- **Stavy sú konfigurácia, nie konštanty.** Čísla stavov (161, 180, 128, 134, 189, 5, 90–97, 163–166) sa
  líšia podľa dopravcu a kontextu; vždy si over aktuálnu hodnotu v konkrétnej triede/skripte, neber ich
  ako globálne pravdy.
- **Kódovanie CSV.** Legacy exporty prekódúvajú do `WINDOWS-1250` (`iconv`). Pri úprave nezabudni na
  diakritiku a oddeľovač `;`.
- **NBS kurzy — vykonanie je zámerne vypnuté.** `load_nbs_rates_year.php` má `Db::...Execute`
  zakomentovaný; najprv skontroluj vygenerovanú query, až potom spusti reálne.
- **OSS/číselné rady podľa krajiny.** Pri účtovníckom exporte je krajina fakturácie kľúčová — zlá zóna
  = zlý číselný rad a zlý DPH režim.

## Bezpečnosť — kde sú tajomstvá (NEVYPISOVAŤ hodnoty)

V repozitári sú na niektorých miestach natvrdo zapísané prístupové tokeny/kľúče. Pri práci ich
**necituj ani nekopíruj** do žiadneho výstupu, logu ani commitu; ideálne ich presuň do konfigurácie
(`Configuration` / env) mimo verzovaného kódu:

- **`krosapi/classes/KrosApi.php`** — obsahuje natvrdo `apiUrl` a `apiKey` (bearer token KROS/Inteo).
- **`md_orders_ip.php`** — obsahuje natvrdo `API_TOKEN` (bearer token InPost ShipX) a organizačné URL.
- **GLS a ostatní dopravcovia** — prihlasovacie údaje sa čítajú per doména cez `GLSAuthDto::fromDomainId`
  a PrestaShop `Configuration::Get('GLS_*_'.id_domain)`; hodnoty sú v DB `ps_configuration`, nie v kóde.

Väčšina moderných dopravcov drží auth v `Configuration` alebo vo vlastných `*AuthDto` triedach — to je
správny smer; legacy natvrdo zapísané tokeny sú technický dlh na odstránenie.

## Súbory a miesta

- **Moderná vrstva:** `admin718/App/OnlineCarrier/` (Factories, Carriers, ApiHandlers, Dtos, Enums,
  Helpers, Services).
- **Autoload:** `config/psr4loader.php` (namespace `App\`).
- **Vstupné body:** `online_carrier_storno.php` (storno), `cron/onlinecarrier_process_delivered.php`
  (doručené), `tabs/AdminOrders.php` / `print.php` / `fun.php` (admin UI).
- **Legacy dopravcovia:** `admin718/md_orders_*.php`.
- **Exporty:** `md_orders_csv.php`, `export_stockorder.php`, `exportorders.php`, `md_orders_ucto.php`.
- **KROS účtovníctvo:** `admin718/krosapi/classes/*.php` (Kros, KrosApi, KrosReceivedOrder(s),
  KrosClient, KrosSender, KrosItem, KrosAddress), `krosapi/ajax/ajax.php`.
- **NBS kurzy:** `load_nbs_rates_year.php`, `cron/load_nbs_rates.php`, `cron/nbs.php`.
- **Úložiská štítkov:** `admin718/pdfStorage/`, `gls_labels/`, `pbh_labels/`, `mdcsv/`.

## Zdroje

- PrestaShop 1.6/1.7 legacy triedy: `Order`, `OrderHistory`, `Carrier`, `Address`, `Customer`, `Db`,
  `Configuration`, `Tools`, `OrderSlip` (interná dokumentácia PrestaShop / kód `classes/`).
- Interná abstrakcia `App\OnlineCarrier` (autor tried: Delaja Fedorco, 2025) — kód v repozitári.
- KROS/Inteo eshop API (`eshops.inteo.sk/api/v1/incomingorders`) — dokumentácia poskytovateľa.
- InPost ShipX API (`api-shipx-pl.easypack24.net`) — dokumentácia InPost.
- GLS MyGLS ParcelService API (`ParcelService.svc/json/*`) — dokumentácia GLS.
- NBS ročné/denné kurzové lístky (`nbs.sk/export/.../xml`).
