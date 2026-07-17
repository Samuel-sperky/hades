# E-shop admin architektúra (admin718)

Referenčný playbook druhého, vlastného back-office pre e-shop značky Aura — legacy PrestaShop-derivát (tabs/) doplnený modernými PHP modulmi (App/), postavený priamo nad `ps_*` databázou.

## Prehľad

`admin718` je custom administrácia e-shopu so šperkami, ktorá **nie je** klasický Aura Laravel admin, ale samostatný back-office historicky odvodený z PrestaShop 1.x. Beží nad tou istou databázou ako obchod (tabuľky s prefixom `ps_`, konštanta `_DB_PREFIX_`) a slúži tímu na dennú prevádzku.

Čo v ňom reálne robíte:
- **Objednávky** — zoznam, detail, história stavov, storná, refundy, párovanie platieb, doručovacie listy, hromadné odosielanie zásielok dopravcom.
- **Katalóg** — produkty, kategórie, atribúty a ich skupiny, features, výrobcovia, dodávatelia, obrázky (resize), odporúčané produkty.
- **Zákazníci** — zákazníci, adresy, skupiny, správy, kontakty, newsletter.
- **Sklad a expedícia** — `AdminStockOrders`, `AdminPicker*` (vychystávanie, boxy, expedícia), `AdminLabelPrinter`, `AdminTablet` (tabletové rozhranie skladu).
- **Obsah** — CMS, blog (články, kategórie), recenzie, príznaky/tagy.
- **Exporty a nástroje** — faktúry/PDF, import, zálohy (`AdminBackup`), preklady, štatistiky (`AdminStats*`).
- **Nastavenia** — zamestnanci, profily a práva, jazyky, meny, krajiny/zóny, dane, dopravcovia, domény, moduly.

Historická vrstva (`tabs/`) rieši UI a CRUD po starom; moderná vrstva (`App/`) rieši dva nové, dôležité toky: **komunikáciu s API dopravcov** (`App\OnlineCarrier`) a **volania na OpenAI** (`App\GPT`, generovanie a preklad popisov produktov).

## Kľúčové pojmy

- **Tab (`AdminXxx`)** — jedna obrazovka administrácie = jedna PHP trieda v `tabs/AdminXxx.php`, ktorá dedí z bázovej triedy `AdminTab`. 103 tabov = 103 sekcií admina.
- **`AdminTab`** — bázová trieda (PrestaShop core, mimo tohto priečinka, v `../classes/AdminTab.php`). Poskytuje generický list/detail/CRUD engine cez deklaratívne polia (`$table`, `$className`, `$fieldsDisplay`, `$fieldsForm`) a metódy `postProcess()`, `display()`, `viewAccess()`.
- **`$fieldsDisplay`** — deklaratívny popis stĺpcov zoznamu (titulok, zarovnanie, šírka, `filter_key`, typ, `callback`). Bázová trieda z neho vyskladá tabuľku, filtre a triedenie.
- **Token** — CSRF ochrana; každý odkaz na tab nesie `token` počítaný cez `Tools::getAdminToken(class + id_tab + id_employee)`. Bez platného tokenu tab odmietne akciu (`checkToken()`).
- **Cookie `psAdmin`** — prihlásený zamestnanec (`Cookie` objekt, `id_employee`, `profile`, `id_lang`); riadi session, jazyk aj zapamätanie filtrov.
- **Profile / práva** — `Profile::getProfileAccess($profile, $id_tab)` rozhoduje view/edit práva na jednotlivé taby (`checkTabRights`, `viewAccess`).
- **`_DB_PREFIX_`** — prefix `ps_`; celý admin píše priamo SQL nad PrestaShop schémou cez `Db::getInstance()`.
- **OnlineCarrier** — moderný DDD modul (`App\OnlineCarrier`) na tvorbu zásielok a sťahovanie štítkov cez API dopravcov.
- **ApiHandler** — transportná vrstva (curl) s vymeniteľnou autentifikačnou stratégiou (Bearer, OAuth2, HMAC, HeaderAuth, Azure), zdieľaná medzi OnlineCarrier a GPT.
- **DTO / Enum / Factory** — moderné stavebné prvky v `App/`: dátové objekty, výčtové typy a továrne, ktoré legacy PrestaShop časť nemá.

## Technologický základ

- **Jazyk:** PHP (procedurálno-OOP mix). Legacy vrstva je štýlom PrestaShop 1.4/1.5-éry (globálne triedy bez namespace, `global $cookie`, priame `echo` HTML). Moderná vrstva `App/` používa PSR-4 namespace `App\`, typované vlastnosti, `enum`, konštruktorovú injekciu a DTO — teda výrazne novší PHP (8.x) štýl.
- **Framework:** žiadny moderný framework — je to osekaný/upravený **PrestaShop-derivát**. Bootstrap ide cez `config/config.inc.php` + `config/psr4loader.php` (oba mimo tohto priečinka, v nadradenom `admin718/config/`).
- **Databáza:** MySQL/MariaDB, schéma PrestaShop (`ps_*`), prístup cez vlastný `Db` singleton (`Db::getInstance()`), nie cez Eloquent/PDO ORM.
- **Frontend admina:** server-rendered HTML z PHP, jQuery 2.1.4 + jQuery UI, staršie moduly (ExtJS grid, cluetip), datepicker; novšie ostrovčeky interaktivity cez **Alpine.js** (`js/alpine/notifications.js`, `weather.js`) a `AjaxHelper.js`. Grafy cez Chart.js (CDN). CSS/JS per-tab sa auto-načíta podľa názvu tabu (`js/AdminXxx.js`, `css/AdminXxx.css`).
- **Autoload:** dvojkoľajný — legacy triedy sa `include`-ujú ručne (`include_once .../classes/AdminTab.php`), moderné `App\` triedy cez PSR-4 loader.

## Architektúra — ako spolu žijú tabs/ a App/

Admin má dve súžijúce vrstvy nad jednou databázou:

1. **Legacy vrstva `tabs/` (103× `AdminXxx.php`)** — každý tab je trieda dediaca z `AdminTab`. Vykresľuje zoznamy/detaily, spracúva formuláre, píše priamo SQL. Toto je "telo" admina.
2. **Moderná vrstva `App/`** — čisté, testovateľné PHP moduly bez PrestaShop dedičnosti. Legacy taby (napr. `AdminOrders`, `AdminProducts`) tieto moduly **volajú** cez `use App\...` a fasády typu `OnlineCarrierFactory` / `GPT::exec()`. App vrstva naopak siaha späť do legacy sveta cez globálne triedy (`\Order`, `\Carrier`, `\Address`, `\RotLog`) — preto majú v `use` zoznamoch aj nenamespacované triedy.

Most medzi svetmi je teda jednosmerne pohodlný: nový kód vie použiť starý (globálne PrestaShop modely), a starý kód volá nový cez namespace. Vďaka tomu sa dá modernizovať postupne, tab po tabe, bez prepisu celého admina.

### Ako sa načíta stránka (request flow)

Vstupný bod je vždy `index.php?tab=AdminXxx&token=...`:

1. `index.php` definuje `PS_ADMIN_DIR`, načíta `config/psr4loader.php`, `config/config.inc.php`, potom `functions.php`, `toolbar.php`, `header.inc.php`.
2. `header.inc.php` → `init.php`: overí prihlásenie (`$cookie->isLoggedBack()`, inak redirect na `login.php`), nastaví jazyk, otvorí DB singleton, prípadne vynúti HTTPS.
3. `header.inc.php` vykreslí hlavičku, vyhľadávanie, menu z `Tab::getTabs()` (filtrované cez `checkTabRights`).
4. Späť v `index.php`: `checkingTab($tab)` (z `toolbar.php`) validuje názov tabu, `include`-ne `tabs/AdminXxx.php` (alebo súbor modulu), vytvorí `$adminObj = new AdminXxx()` a overí `viewAccess()`.
5. `index.php` zavolá na `$adminObj` v poradí: `displayConf()` → `postProcess()` (spracovanie akcií/formulárov) → `displayErrors()` → `display()` (list alebo detail). Predtým sa do cookie zapamätajú filtre (`*Filter_*`, `submitFilter`) a triedenie (`*OrderBy`, `*Orderway`).
6. `footer.inc.php` uzavrie stránku.

### Ako `AdminXxx` rieši list / detail / akcie

Vzor (napr. `AdminOrders`): v konštruktore trieda deklaruje `$this->table` (napr. `'order'`), `$this->className` (napr. `'Order'`) a `$this->fieldsDisplay` — pole stĺpcov s titulkami, filtrami, `callback` funkciami (napr. `printPDFIcons`, `printOrderCheckbox`), typmi (`bool`, `select`, `datetime`, `price`). Podľa prítomnosti `id_order`/`id_xxx` v requeste sa trieda rozhodne, či ide o **zoznam** (vyskladá SQL cez `getFiltersToSql()` a `fieldsDisplay`) alebo **detail** (`viewOrder`/formulár). Akcie (uloženie, zmena stavu, storno) beží cez `postProcess()`, kde sa číta `Tools::getValue(...)` a zapisuje cez `Db`/PrestaShop modely. Preklady reťazcov cez `$this->l('...')`.

## App/OnlineCarrier — DDD modul dopravcov

Doménovo členený modul (`namespace App\OnlineCarrier\...`) na automatizované vytváranie zásielok u dopravcov a sťahovanie štítkov:

- **`Carriers/`** — konkrétni dopravcovia po krajinách/službách ako triedy dediace z abstraktnej `OnlineCarrier` (implementuje `OnlineCarrierInterface`). Napr. `Packeta*`, `GLS*`, `SkPosta*`, `BoxPi*` (Sameday BoxNow rad pre CZ/HR/IT/BG/RO/SI/PL), `HuPost`, `InPost`, `PPL`, `CzPosta`, `UrgentCargus`, `PBH`. Každá trieda drží `carrierId` (mapuje na PrestaShop `id_carrier`), stavové konštanty (`submittedStatus`, `goldStatus`, `finalStatus`, `STORNO_STATE`), `capabilities` a `apiType`.
- **`ApiHandlers/`** — transport (curl) so stratégiami autentifikácie: `BearerTokenApiHandler`, `OAuth2RestApiHandler`, `HMACRestApiHandler`, `HeaderAuthRestApiHandler`, `AzureRestApiHandler`, bázový `RestApiHandler`/`ApiHandler`. Vyberá sa cez `ApiHandlerFactory::getByType($apiType)`.
- **`Factories/`** — `OnlineCarrierFactory` registruje aktívnych dopravcov (statické pole `$carrierClasses`, zakomentované = vypnuté) a vracia inštanciu podľa `id_carrier` (`byCarrier`) alebo triedy (`byClassName`); `ApiHandlerFactory` páruje typ API na handler.
- **`Dtos/`** — dátové objekty toku: `PreparedOrderDto`, `ProcessedOrderDto`, `SubmittedOrderDto`, `ApiRequestDto`, `ApiResponseDto`, `OnlineCarrierInfoDto`.
- **`Enums/`** — `ApiTypeEnum`, `ContentTypeEnum`, `HandledOrderStateEnum`, `ProcessedOrderStateEnum`, `OnlineCarrierCapabilityEnum`.
- **`Helpers/`** — `OrderCollector` (vyberie odosielateľné objednávky z DB), `ApiHandlerLogger`/`ApiDataConverter`, `MultiRequest`/`MultiResponse` (dávkové volania), `NamedCollection`.
- **`Services/`** — `PdfLabelService` (spracovanie PDF štítkov).

**Tok odoslania zásielok** (viď `fun.php`): `OrderCollector::getSubmittableOrders()` → pre každú objednávku `OnlineCarrierFactory::byCarrier($order->id_carrier)` → `handleOrder($order)` (príprava) → po dávkach `processOrders()` (odoslanie do API dopravcu, dávka `shipmentsPerBatch`). Výsledok sa vracia ako JSON pre AJAX vo admine.

## App/GPT — OpenAI integrácia

`namespace App\GPT` — tenká knižnica nad tým istým `ApiHandler` (typ `HeaderAuth`, Bearer). `GPT::exec($request)` bootstrapne handler a pošle request; requesty sú typované: `GPTDescribeProductRequest` (generovanie popisu produktu) a `GPTTranslateProductRequest` (preklad), spoločný predok `GPTRequest`, odpoveď `GPTResponse`. Používa sa v katalógovom tabe na AI popisy/preklady. Timeouty: connect 10 s, total 20 min.

## Krok za krokom — pridanie nového tabu

1. Vytvor `tabs/AdminXxx.php` s triedou `class AdminXxx extends AdminTab` (`include_once` bázovej `../classes/AdminTab.php`).
2. V konštruktore nastav `$this->table`, `$this->className`, `$this->fieldsDisplay` (a `$this->fieldsForm` pre detail).
3. Zaregistruj tab do DB tabuľky `ps_tab` (class_name, id_parent, module) — inak `Tab::getIdFromClassName` vráti prázdno a `checkingTab` odmietne.
4. Nastav práva profilu v `ps_access` (inak `viewAccess`/`checkTabRights` zablokuje prístup).
5. Voliteľne pridaj `js/AdminXxx.js` a `css/AdminXxx.css` — načítajú sa automaticky podľa názvu tabu.
6. Ikonu do `img/t/AdminXxx.gif` (menu/breadcrumb).

## Checklist pri práci s adminom

- [ ] Každá akcia/odkaz nesie správny `token` — inak `checkToken()` request zahodí.
- [ ] Nový business-logika kód píš do `App/` (namespace, DTO, testovateľné), nie do 5000-riadkových `tabs/`.
- [ ] Zmeny stavov objednávok rob cez definované konštanty stavov (`submittedStatus`, `STORNO_STATE`…), nie cez magické čísla.
- [ ] Nového dopravcu zaregistruj v `OnlineCarrierFactory::$carrierClasses` a over unikátny `carrierId` (zhoda s `ps_carrier.id_carrier`).
- [ ] SQL vždy cez `Db::getInstance()` s `pSQL()`/`(int)` escapovaním a `_DB_PREFIX_`.
- [ ] Práva nového tabu nastav v `ps_tab` + `ps_access`.

## Časté chyby / Gotchas

- **Secrety v kóde (dôležité, opraviť).** `App/GPT/GPT.php` má **natvrdo zapísaný OpenAI API kľúč** vo vlastnosti `$authorizationKey` (v súbore je aj `@TODO: Hide secrets`). `functions.php` v `rewriteSettingsFile()` obsahuje natvrdo zapísaný `_ENCRYPTION_KEY_`. Tieto patria do konfigurácie/ENV mimo repozitára, nie do zdrojáku — a nikdy sa nesmú kopírovať do dokumentácie ani commitovať.
- **Dvojkoľajný autoload.** Legacy triedy treba `include`-núť ručne; App triedy idú cez PSR-4. Zabudnutý include = "class not found".
- **`global $cookie` všade.** Legacy taby spoliehajú na globálny `$cookie`; mimo request kontextu (CLI/cron) treba bootstrap cez `config.inc.php`.
- **Filter/sort sa ukladajú do cookie.** Ak zoznam "drží" starý filter, je v cookie (`XxxFilter_*`) — nie v URL.
- **Zakomentovaní dopravcovia.** V `OnlineCarrierFactory` sú niektorí dopravcovia (PPL, InPost, UrgentCargus…) dočasne vypnutí komentárom — "nefunguje odoslanie" často znamená len odregistrovanú triedu.
- **Config mimo priečinka.** `config/config.inc.php`, `config/settings.inc.php`, `config/psr4loader.php` a `classes/` sú v **nadradenom** priečinku `admin718/` (nie v tejto synchronizovanej `admin718/admin718/` kópii) — tam žijú DB credentials a bootstrap.
- **PrestaShop DB, nie Aura Laravel DB.** Tento admin ide nad `ps_*` schémou; nezamieňať s hlavným Aura Laravel/MariaDB stackom.

## Súbory a miesta

- `index.php` — router/dispatcher: bootstrap, výber tabu, `postProcess()`→`display()`.
- `init.php` — session, prihlásenie (`Cookie psAdmin`), jazyk, DB singleton, HTTPS.
- `header.inc.php` / `footer.inc.php` — layout, menu z `Tab::getTabs()`, per-tab JS/CSS, Alpine widgety.
- `toolbar.php` — `checkingTab()`, `recursiveTab()` (breadcrumb), `checkTabRights()`.
- `functions.php` — pomocné funkcie (`translate`, `getPath`, `rewriteSettingsFile` — pozor na secret), `include images.inc.php`.
- `fun.php` — samostatný endpoint hromadného odoslania zásielok (OnlineCarrier tok → JSON).
- `tabs/AdminXxx.php` — 103 tabov (obrazoviek); najväčšie `AdminOrders.php` (~5,5k riadkov), `AdminProducts.php`, `AdminCatalog.php`.
- `ajax/` a `ajax.php` — AJAX endpointy per doména (`AdminOrdersAjax.php`, `AdminCatalogAjax.php`, `AdminSearchAjax.php`, `notifications.php`, `weather.php`…).
- `App/OnlineCarrier/` — DDD modul dopravcov (Carriers, ApiHandlers, Factories, Dtos, Enums, Helpers, Services, Interfaces).
- `App/GPT/` — OpenAI klient (GPT, Requests, Responses, Interfaces).
- `js/alpine/`, `js/AjaxHelper.js`, `css/AdminXxx.css` — moderné frontend ostrovčeky.
- `../classes/AdminTab.php`, `../config/*` — bázová trieda a konfigurácia (mimo tohto priečinka; obsahuje credentials — needitovať naslepo).

## Zdroje

- PrestaShop 1.5/1.6 developer docs (bázová `AdminTab`, `Tab`, `Profile`, `Db`, `Tools` API) — pôvod legacy vrstvy.
- Vlastný kód `App\OnlineCarrier` a `App\GPT` (autor Delaja Fedorco, 2025) — moderná DDD vrstva.
- API dokumentácie jednotlivých dopravcov (Packeta, GLS, Slovenská/Česká pošta, BoxNow/Sameday, InPost, PPL, UrgentCargus) a OpenAI API.
