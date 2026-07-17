# Eshop admin UX a UI (admin718)

> Ako vyzerá, ako sa ovláda a kde sa dá zlepšiť druhý admin eshopu Aura — fork PrestaShop-u (priečinok admin718) optimalizovaný na sklad, balenie a expedíciu šperkov.

## Prehľad

Admin718 je silne prispôsobený fork staršieho PrestaShop back-office. Nie je to čistý PrestaShop 1.6+ — je to vlastná vetva postavená na `AdminTab` architektúre (tabs = triedy), s tokenovou autentifikáciou na záložku, s klasickým PrestaShop chrome (menu, submenu, gif ikony) a s hrubou nadstavbou vlastných modulov pre objednávky, prepravcov, sklad, picking a živé notifikácie.

Ťažisko celého adminu je fulfillment: verifikácia objednávky čítačkou EAN, meranie času balenia, tlač štítkov a export do desiatok prepravcov. UI je tomu podriadené — je hutné, klávesovo a scan-orientované, s okamžitými ajax aktualizáciami bez reloadu. Vizuálne je to zmes dvoch generácií: legacy jQuery + gif ikony + inline štýly na jednej strane, a novšia vrstva (AlpineJS, `AjaxHelper` cez `fetch`, utility CSS triedy) na druhej.

Cieľom tohto skillu je, aby bolo jasné ako sa v adminovi reálne pracuje, aké interakčné vzory používa, a čo je technicky aj UX najslabšie — teda čo prepísať pri prechode na moderný admin (Laravel + Reverb podľa stacku Aura).

## Kľúčové pojmy

- **Tab (záložka)** — jedna obrazovka = trieda `Admin*` v `tabs/` (napr. `AdminOrders`, `AdminProducts`, `AdminStockOrders`). Dispatch cez `index.php?tab=...&token=...`. Každý tab typicky rieši zoznam (list), formulár (detail/edit) aj spracovanie POST akcií.
- **Token** — per-tab bezpečnostný hash `Tools::getAdminToken(classname + id_tab + id_employee)`. Chráni každý odkaz aj ajax volanie. Práva sa overujú cez `Profile::getProfileAccess` (`checkTabRights`).
- **Grid** — dva svety: klasické PrestaShop list tabuľky renderované PHP tabmi (zebra `alt_row`), a ExtJS gridy/grafy cez modul `gridextjs` (entry `grider.php` a `drawer.php`, CSS `ext-all.css`).
- **AjaxHelper** — vlastný fluent klient (JS trieda + PHP trieda). `new AjaxHelper(url).action('x').set('k',v).execute()` posiela `FormData` a vracia `data.result`. Moderná cesta ajaxu.
- **Overlay** — modálny panel (`#odv-overlay`, `#odc-overlay`, `#AdminOrders-overlay`) s `.wrapper`/`.frame`/`.close`, zapínaný odoberaním triedy `.hide` a prepínaním rozmerových utility tried. Nie je to bočný drawer.
- **Verifikácia / packaging** — meraný proces kontroly a balenia objednávky so start/pause/finish tlačidlami, živým časovačom a EAN skenovaním.
- **Utility CSS** — atomické triedy v `admin.css` (Tailwind-like): `flex`, `mt15`, `w100p`, `br50p`, `in-block`, `bsbox`, `vcenter`, `hide`, `disable`, `fs150p`, `zi500` atď.

## Architektúra a layout

Chrome skladá `header.inc.php` + `footer.inc.php` okolo obsahu tabu:

```
#container
  #header (flex)
    #logo        — administration / JEWELRY (odkaz na dashboard)
    #search-main — globálne hľadanie + rýchle poľia na objednávky
    #flags-language — prepínač jazyka (vlajkové gif ikony)
    weather.html — AlpineJS počasie widget
    #user        — avatar, notifikačný zvonček (Alpine), logout
  #menu     — rodičovské taby (gif ikony), aktívny .active
  #main
    #submenu — podtaby otvoreného tabu
    #content — telo konkrétneho tabu
  #footer   — verzia PrestaShop + čas generovania + loader.gif
```

Navigácia je dvojúrovňová: horizontálne `#menu` (rodičia) a pod ním `#submenu` (deti podľa `id_parent`). Ikony sú gify z `../img/t/<ClassName>.gif`. Na `AdminIndex` sa zobrazuje badge nepotvrdených announcementov.

**Globálne hľadanie** (`#search-main`) má select typu: catalog / customers / orders / product in orders / invoices / carts, plus samostatné rýchle poľia:
- `bo_query_order` — priamo číslo objednávky,
- `bo_il_query_order` — IL kód,
- `bo_box_query_order` — BOX (názov škatule) — dôležité pre balenie, focus sem skáče po dokončení verifikácie.

**Frontend stack** (z `header.inc.php`): jQuery 2.1.4 + jQuery UI + cluetip (tooltipy) + datepicker; legacy `admin.js`, `tools.js`, `ajax.js`, `loader.js`, `toggle.js`; per-tab `js/<Tab>.js` a `css/<Tab>.css` (auto-načítané ak existujú); Chart.js + moment z CDN pre štatistiky; a novšia vrstva `AjaxHelper.js`, `alpine/notifications.js`, `alpine/weather.js`, `vendor/alpine.js` (defer). Telo `<body>` nesie `data-eid`, `data-tab-token`, `data-lid`, `data-tab` — čítajú sa v JS ako zdroj identity.

## Ako to funguje — interakčné a ajax vzory

V adminovi koexistujú tri spôsoby komunikácie so serverom:

1. **Legacy `$.ajax` (jQuery), string payload.** Napr. v `AdminOrders.js`: `data: "ac=customDateSave&eid="+eid+"&order="+orderID+"&t="+token`, `dataType:"json"`, `.done()/.fail()`. Cieľ: `ajax/Admin*Ajax.php`. Autentifikácia sa ručne skladá do reťazca (`eid`, `lid`, `t`). Akcia sa volí parametrom `ac=`.

2. **Moderný `AjaxHelper` (fetch + FormData).** `new AjaxHelper('ajax/notifications.php').action('getNotifications').execute()`. Token/eid/lid berie automaticky z `body.dataset`. Vracia `data.result`. Používa notifikačný a filtračný modul.

3. **Monolitický dispatcher `ajax.php`.** Séria `if (isset($_GET[...]))` / `if (isset($_POST[...]))` blokov: autocomplete katalógu (`ajaxProductManufacturers`, `ajaxProductAccessories`...), drag&drop pozície (`ajaxPositions` → `updatePosition`), akcie skladovej objednávky (`stockOrderAction`: remove/stockup/change/damaged), `getPrintLabelInfo` (sken EAN/BOX → dáta objednávky + obrázky + dobierka pre štítok), `moveTo`/`deleteFromStockOrder`.

Ďalšie špecializované endpointy:
- `filters_ajax.php` — veľký `switch($action)` CRUD pre buildovanie produktových filtrov (`addFilterGroup`, `addFilter`, `updateGroupsInSelect`, `updateGroupsInList`...).
- `ajax_products_list.php` — autocomplete vracajúci riadky `name(ref)|id` pre jQuery autocomplete.
- `grider.php` / `drawer.php` — inštancujú modul podľa `module` parametra a volajú `->create()->render()` resp. `->draw()` (ExtJS grid / graf).

**Inline editácia** je všadeprítomná namiesto reloadu:
- Custom dátum stavu objednávky: klik na `.custom-date-add/edit` prepne input na `datetime-local` s ok/cancel gif ovládačmi, uloží cez `ac=customDateSave`.
- Refund IBAN/poznámka: klik na `.refund.iban/.note` vloží absolútny input + „Edit“ tlačidlo, uloží `ac=refundChange`, prekreslí `span`.
- Počítadlá objednávok (`orders.count`, `orders.packaging`) sa obnovujú `.reload` spanom bez reloadu stránky.

**Overlay/modál vzor:** obsah sa načíta ajaxom do `#odv-overlay .frame`, veľkosť sa nastaví prepínaním tried (`.addClass('w500 h300 vcenter').removeClass('w90p h100p')`), zobrazí sa `.removeClass('hide')`. Zatvára `.close` alebo `.cancel.button`. Používa sa pre vouchre, certifikáty, refund processing.

**Notifikácie (AlpineJS, `alpine/notifications.js`):** poll `ajax/notifications.php` každých 5 s (po 15 s zrýchlené na 30 s interval), prehrá `audio/ding.mp3`, zobrazí toast popup, stavy `new/seen/done/danger` s farbami, mute/unmute persistovaný na serveri, `visibilitychange` zastaví polling keď je záložka skrytá. DOM (a `data-*`) je zdroj pravdy, nie centrálny state.

## Toky — objednávka od skenu po expedíciu

Fulfillment je jadro adminu a väčšina vlastného kódu slúži jemu:

1. **Verifikácia a balenie** (`AdminOrders.js`, `ajax/AdminOrdersAjax.php`, `ac=verification`): blok `.order.verification` so start/pause/finish tlačidlami a živým časovačom (roky…sekundy). Po `start` sa scrolluje na zoznam produktov a fokusuje `#checkEAN` (skenovanie kusov). `finish` tlačidlo bliká animáciou `dangerBlink` (`finnish_button_animated.css`) aby ho nebolo možné prehliadnuť, po dokončení skáče fokus na `#bo_box_query_order`. Stavy 0–4 riadi `timerButtonsByStatus`. Stav `10` = inú objednávku už spracúva iný zamestnanec → tlačidlá zmiznú (zámok proti dvom ľuďom na jednej objednávke). `beforeunload` varuje pri odchode počas rozbehnutej neukončenej verifikácie.
2. **Počítadlá** — `orders.count` (7 dní) a `orders.packaging` (pre dátum) s ručným `.reload`.
3. **Tlač štítkov / packaging** (`print.php`, `ajax.php:getPrintLabelInfo`): sken EAN alebo názvu BOX → dohľadá objednávku (`getOrderIdByEan` / `getOrderIdByBoxName`), zapíše IL EAN packaging, ukončí balenie (`endPackaging`), zaloguje. `getPrintLabelInfo` vráti pre štítok: id, kto pickol/kontroloval, zákazník, obrázky produktov, počet kusov, dobierka.
4. **Export k prepravcom** — desiatky takmer identických súborov `md_orders_*.php` (gls, dpd, packeta/zasielkovna sk+cz+hu+ro, posta, skpost xml, ulozenka, intime, pbh, px, pp, ip, brt, cp, pickpackpont, uc, fan…), každý generuje CSV/XML/label pre daného dopravcu. Existuje `OnlineCarrierFactory` (namespace `App\OnlineCarrier`) ako novší abstraktný smer. Vygenerované štítky sa ukladajú do `gls_labels/`, `pbh_labels/`.
5. **Picking** — samostatná mini-aplikácia v `picker/` s vlastným `header.inc.php`/`footer.inc.php`/`init.php` a stránkami `orders.php`, `picking.php`, `expedition.php` (skladové vychystávanie oddelené od hlavného adminu).
6. **Refundy / dobropisy** — dependentná logika checkboxov (`#generateDiscount`, `#generateCreditSlip`, `#generateOrderCanceled`) prepína zobrazené sekcie; „full amount“ tlačidlo predvyplní sumu; vouchre a darčekové certifikáty sa generujú v slučke s počítadlom `generated / available` a náhľadom PDF.

## Silné stránky UX

- **Extrémna task-optimalizácia pre sklad.** Skenovanie EAN/BOX riadi celý tok, fokus sa automaticky presúva na správne pole (`#checkEAN`, `#bo_box_query_order`), zvuková notifikácia, živý časovač, blikajúce kritické tlačidlo.
- **Zámok na súbežné spracovanie** jednej objednávky viacerými zamestnancami (stav 10) — reálna prevádzková ochrana.
- **Okamžité čiastkové aktualizácie** bez reloadu (dátumy, IBAN, počítadlá, verifikácia, refundy) — rýchla práca počas špičky.
- **Hutná hustota** vďaka utility triedam a inline editácii — veľa informácií a akcií na jednej obrazovke.
- **Živé notifikácie** s pauzovaním pri skrytej záložke a mute — praktické pre operatívu.

## Slabé stránky UX a technický dlh

- **Tri generácie ajaxu vedľa seba** (string `$.ajax` vs `AjaxHelper`/fetch vs monolit `ajax.php`) + jQuery aj Alpine súčasne — nekonzistentné, ťažko udržiavateľné.
- **String konkatenácia payloadu** (`"...&v="+val`) často bez `encodeURIComponent` → láme sa na diakritike/špeciálnych znakoch; token/eid/lid sa duplikujú v každom volaní.
- **Overlay cez žonglovanie tried** (`w500 h300 vcenter` ↔ `w90p h100p`) namiesto komponentu — krehké, ťažko rozšíriteľné.
- **Prístupnosť.** Klik handlery na `<span>`/`<img>` namiesto `<button>`, gif ikony bez zmysluplného alt, stav objednávky len farbou/ikonou (`img/os/*.gif`), natívne `confirm()`, žiadne ARIA. `beforeunload` vracia vlastný text (moderné prehliadače ho ignorujú).
- **Responzivita** je jediný pixelový hack `windowEvents(800)`, ktorý ručne dopočítava šírky — nie skutočný responzívny layout; mobil nie je riešený.
- **Inline štýly a magické ID** (md5 ako element id, `style="width:180px"`) rozsypané v markupe; žiadne design tokeny.
- **Masívna duplikácia** `md_orders_*.php` (~30 skoro identických súborov na prepravcov) — údržba a chyby sa množia.
- **Externé CDN** (Chart.js, moment) bez SRI a offline fallbacku.
- **Polling notifikácií** každých 5 s na zamestnanca — zbytočná záťaž, namiesto WebSocketu.
- **DOM ako jediný state** — hodnoty sa čítajú späť z `data-*` atribútov, náchylné na rozpad.

## Čo zlepšiť (odporúčania pre nový admin)

- Zjednotiť na jeden ajax klient (`AjaxHelper`) s poriadnym JSON/FormData payloadom a `encodeURIComponent`; odstrániť string `$.ajax` a monolit `ajax.php` rozdeliť na tenké controllery.
- Nahradiť overlay žonglovanie jedným modálnym komponentom; nahradiť gif ikony SVG sadou a klik-spany reálnymi `<button>` + ARIA.
- Reálne notifikácie a živé počítadlá presunúť z pollingu na WebSocket (Reverb — sedí na stack Aura) namiesto 5 s intervalu.
- Zbaviť sa duplicity `md_orders_*` rozšírením `OnlineCarrierFactory` na stratégiu per prepravca (jeden interface, jedna implementácia na dopravcu).
- Zaviesť skutočný responzívny grid namiesto `windowEvents` a design tokeny namiesto inline štýlov; self-hostovať Chart.js.

## Súbory a miesta

- **Layout / chrome:** `header.inc.php`, `footer.inc.php`, `index.php`, `init.php`, `toolbar.php` (`checkTabRights`, `checkingTab`, `recursiveTab`).
- **Taby:** `tabs/Admin*.php` (~130 tried), per-tab `js/Admin*.js`, per-tab `css/<tab>.css` (auto-load v `header.inc.php`).
- **Gridy / grafy:** `grider.php` (ExtJS grid render), `drawer.php` (ExtJS graf draw), modul `gridextjs` (`ext-all.css`).
- **Ajax:** `ajax.php` (monolit), `filters_ajax.php` (filter builder), `ajax_products_list.php` (autocomplete), `ajax/Admin*Ajax.php` (per-tab), `ajax/notifications.php`, `ajax/weather.php`, `AjaxHelper` (PHP trieda + `js/AjaxHelper.js`).
- **Objednávky / fulfillment:** `md_orders_*.php` (exporty prepravcov), `print.php` (EAN packaging/štítok), `md_order_ajax.php`, `ajax/AdminOrdersAjax.php`, mini-app `picker/`, výstupy `gls_labels/`, `pbh_labels/`, `mdcsv/`, `mdomega/`.
- **Frontend:** `js/` (`AjaxHelper.js`, `CSVExporter.js`, `ChunkLoader.js`, `alpine/notifications.js`, `alpine/weather.js`, `vendor/alpine.js`, `Admin*.js`), `css/finnish_button_animated.css` (animácia `dangerBlink`), `admin.css` (utility triedy v nadradenom `css/`), `img/t/*.gif`, `img/os/*.gif`, `img/admin/*.gif`.
- **Konfigurácia a tajomstvá (NEVYPISOVAŤ hodnoty):** `config/config.inc.php` obsahuje DB credentials a `_DB_PREFIX_`; adresár `krosapi/` a moduly prepravcov nesú API tokeny KROS/dopravcov. V skille len uvádzame, že tam sú — hodnoty sa nikdy nekopírujú.

## Zdroje

- `skills/it/data-dense-workspaces.md` — moderné vzory pre tabuľky, filtre, bulk akcie a hustotu, ktoré by mali nahradiť legacy gridy.
- `skills/it/resilient-async-ui.md` — správne riešenie ajax race condition, partial failure a retry (chýbajúce v legacy `$.ajax`).
- `skills/it/accessible-interaction-patterns.md` — náhrada klik-spanov a gif ikon prístupnými `<button>`/ARIA vzormi.
- PrestaShop 1.x AdminTab architektúra (referenčný pôvod tejto vetvy).
