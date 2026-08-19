# Audit 3 — Informačná architektúra a toky

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-konzola` · **Režim:** read-only, žiadny súbor v projekte nezmenený.

## Metóda a kalibrácia

Merané v headless Chrome (`puppeteer-core`, 1920×1080, tmavá téma) proti živej appke na
`http://localhost:8080`. Skripty: `scratchpad/ia.js`, `ia2.js`, `ia3.js`, `ia4.js`;
logy `audit/ia*-log.txt`, screenshoty `audit/*.png`.

Kalibrácia podľa CLAUDE.md:

- **Identita servera overená pred meraním:** `script[type=module]` = `/js/mind/main.js`.
  Neexistuje riziko, že meriam cudziu appku na tom istom porte.
- Onboarding karta vypnutá `localStorage.setItem('hades.hints2','done')` v
  `evaluateOnNewDocument`, teda pred loadom.
- Čakal som na obsah (`waitForFunction`), nie na fixný čas — `/api/journal` a
  `/api/dashboard` bežia sekundy.
- **Pasca, na ktorú som naletel a opravil:** `.empty-loading` má aj triedu `.empty`,
  takže podmienka „je tam `.empty`" sa splní už na načítavacej značke. Prvý beh
  preto nahlásil „Rozhodnutia: 0 kariet, 0 čipov"; po prepísaní podmienky na
  `.dtl-card` to je 41 kariet a 7 čipov. Kto bude v tomto repe merať prázdne stavy,
  musí `.empty-loading` explicitne vylúčiť.
- Stav siete v čase merania: 1098 uzlov a 2991 hrán na plátne (`scope=live`),
  2677 uzlov celkovo podľa Dnes, 41 rozhodnutí, 4 položky v Kontrole, 85 vlákien konzoly.

---

## 1. Klikové cesty k piatim reálnym úlohám

Klik = jedno rozhodnutie rukou (klik myšou alebo ekvivalentné stlačenie klávesy).
Písanie textu sa nepočíta.

| Úloha | Nameraná cesta | Kliky | Verdikt |
|---|---|---|---|
| (a) nájdi poznatok o téme | `Ctrl+K` → „docker" → **klik** na výsledok → Graf + panel uzla | **2** | dobré myšou, **klávesnicou vedie inam** (A2) |
| (b) oprav odpadový label uzla | nájdi uzol (2, ak vieš jeho názov) → `Upraviť` → prepíš → `Uložiť` | **4** | funkčné, ale **neexistuje zoznam odpadu** (A3) |
| (c) prečítaj rozhodnutie + dôvod | rail `Rozhodnutia` → klik na kartu → dôvod (600 zn.) sa rozbalí na mieste | **2** | najlepší tok v appke, vzor pre ostatné |
| (d) čo sa naučilo za posledné 3 dni | rail `Denník` → 12 záznamov v troch dňoch, každý klik **odchádza na Graf** → rail `Denník` späť | **1 + 2·N** (≈ 11 pri 5 záznamoch) | **najhorší tok** (A4) |
| (e) spusti úlohu v konzole a zastav ju | (dostať sa na `/console`: **len ručne prepísaná URL**) → `Enter` → `Stop` | **2** + nenavigovateľný vstup | stop funguje (1,4 s), **vstup chýba** (A1) |

### A1 — Konzola nie je z grafu dosiahnuteľná ani jedným klikom

**Tvrdenie:** v celom rozhraní grafu neexistuje odkaz ani tlačidlo na `/console`.
Cesta späť existuje, opačná nie.

**Dôkaz:** `[...document.querySelectorAll('a,button')]` filtrované na `href~console`
alebo text `konzol` vráti **`[]`** (`ia-log.txt`, riadok „LINK NA KONZOLU v grafe").
Rail má 7 destinácií + Nastavenia + Pomoc (`resources/views/mind.blade.php:80–113`),
`CMDK_NAV` má tých istých 7 obrazoviek (`public/js/mind/cmdk.js:9–17`), nápoveda
skratiek konzolu nemenuje (`ia2-log.txt`, „SHORTCUT help"). Naopak
`resources/views/console.blade.php:34` má `<a href="/" id="back-to-graph">`.

**Efekt:** najsilnejšia plocha appky (číta pamäť aj disk, zapisuje do oboch) je
dosiahnuteľná len tým, že si používateľ pamätá URL. Kontrakt UX-RUNY §1 chce jeden
dizajnový jazyk pre graf **aj** konzolu — dnes to nie je jeden produkt, sú to dve
appky na jednom porte. `routes/web.php:12` to volá zámerom („samostatné rozhranie,
nie obrazovka v raile"), ale samostatnosť plochy a nulová dosiahnuteľnosť nie je
to isté rozhodnutie.

**Riziko opravy:** nulové. Odkaz `<a href="/console">` v raile (celý reload, nie
`setScreen`) nemení stavový stroj obrazoviek ani `SCREENS`.

**Návrh:** do railu do systémovej skupiny (alebo do novej skupiny s Runmi) pridať
`<a class="dest" href="/console">` s ikonou `terminal`; do `CMDK_NAV` položku, ktorá
robí `location.href`, nie `setScreen`. Konzola zostáva samostatnou stránkou.

### A2 — `Ctrl+K` → text → `Enter` neotvorí výsledok, ale skočí na Smernicu

**Tvrdenie:** `Enter` z vstupu palety klikne prvú položku v DOM, a tou je vždy akcia
„Vytvor smernicu", nikdy nájdený uzol.

**Dôkaz:** `renderCmdk()` (`public/js/mind/cmdk.js:150–166`) skladá HTML v poradí
nav → **Akcia** → `#cmdk-remote`; `cmdkItems()` (r. 43) berie všetky `.cmdk-item`
v DOM poradí a handler `Enter` volá `cmdkItems()[0].click()` (r. 87–92).
Zmerané (`ia4-log.txt`): poradie položiek pre dopyt „docker" je
`["Vytvor smernicu: docker", "Docker Compose", "Cloudflare Tunnel pre Docker appky", …]`;
po `Enter` je `body.dataset.screen === "smernica"`, panel uzla zatvorený,
`#dir-task` predplnené na „docker".

**Efekt:** paleta sa otvára klávesovou skratkou, teda ju používa práve ten, kto
nechce siahať po myši — a jemu `Enter` zoberie obrazovku, ktorú nechcel. Klik navyše
je tu `ArrowDown` pred `Enter`, ktorý nikde nie je napísaný.

**Riziko opravy:** malé, ale nie nulové — poradie skupín je zároveň vizuálna
hierarchia. Bezpečná forma: `Enter` nech neberie `items[0]`, ale prvý `.cmdk-item`
so `data-id`/`data-pb` (výsledok); ak žiadny nie je, potom akciu. Skupinu „Akcia"
netreba presúvať dole.

### A3 — Odpadový label sa v UI nedá nájsť; AI ho vidí, človek nie

**Tvrdenie:** MCP má `mind_hygiene` s celým reportom odpadu (`raw-prompt`, `markdown`,
`tag-sprawl`, `duplicate`, `slug`, `oversized`, `misfiled`, `stub`, `orphan`), UI
nemá žiadnu obrazovku, ktorá by odpad vypísala. Jediné, čo z hygieny v UI je, sú
duplicity — a tie sú schované v doku Štruktúra, ktorý je dostupný **len z Grafu**.

**Dôkaz:** `app/Http/Controllers/McpController.php:422–443` (definícia
`mind_hygiene`). V UI: `grep -rn "noise|odpad" public/js/mind/` = 0 zásahov;
`/api/duplicates` volá jediné miesto — `public/js/mind/structure.js:160`;
`#btn-structure` žije v `#graph-tools`, ktoré má
`public/css/mind.css:2709` → `body:not([data-screen="graf"]) #graph-tools { display: none !important; }`.
Kontrola je fronta na **overenie**, nie na odpad (`kontrola-body` = `/api/review/queue`,
4 položky, akcie Overiť / Vyriešiť / Preskočiť — `ia2-log.txt` „KONTROLA").

**Efekt:** akceptačné kritérium konzoly č. 2 („oprav odpadový label") je splniteľné
len tak, že odpad najprv nájde AI. Človek, ktorý chce to isté, musí uhádnuť label
a hľadať ho cez `Ctrl+K`. Hygiena je pritom v kontrakte KONZOLA §5 vlna 2 ako
samostatný cieľ.

**Riziko opravy:** stredné, ak sa robí nová obrazovka (kontrakt počet obrazoviek
mimo Runov zmrazil). Nulové, ak sa `mind_hygiene` payload zobrazí ako **sekcia na
Kontrole** — obrazovka už je „fronta poznatkov čakajúcich na overenie" a odpad je
tá istá práca (rozhodni, oprav, zahoď).

**Návrh:** na Kontrole druhá záložka/pás „Hygiena" nad tým istým serializérom, ktorý
kŕmi `mind_hygiene` (dvojitá plocha z vlny E to aj tak vyžaduje). Duplicity presunúť
tam a v doku Štruktúra ponechať odkaz, nie druhú implementáciu.

### A4 — Denník nemá detail na mieste: každý záznam ťa vyhodí na Graf

**Tvrdenie:** klik na záznam v Denníku (aj v Kontrole) mení obrazovku na Graf. Návrat
je ďalší klik do railu. Pri čítaní N záznamov je to 2·N klikov a N stratených kontextov.

**Dôkaz:** `public/js/mind/screens/dennik.js:155–157` →
`openNodeFromAnywhere({...})`, a `public/js/mind/screens.js:66` →
`setScreen('graf')` bezpodmienečne. To isté v `kontrola.js:103`.
Kontrast: Knižnica otvára `openMdOverlay()` a **zostáva na obrazovke**
(`kniznica.js:68`), Rozhodnutia rozbalia dôvod v karte (`rozhodnutia.js:190`,
overené: 1 klik → 600 znakov dôvodu viditeľných).

**Efekt:** appka má pre „ukáž mi detail" **tri rôzne idiómy** na štyroch obrazovkách
(skok na Graf / overlay / rozbalenie na mieste). Úloha (d) „čo sa naučilo za 3 dni"
je preto najdrahšia zo všetkých piatich, hoci je to najčastejšia otázka, akú si
človek o vlastnej pamäti kladie. Navyše Denník ukazuje **záznamy sessions**
(„AI-mind — práca 19.8.2026 · 27 súb. · 2 commity"), nie to, čo sa naučilo — počet
nových uzlov za deň na obrazovke nie je vôbec (`audit/dennik.png`).

**Riziko opravy:** malé pri overlay variante (`md.js` už existuje a je odskúšaný),
vyššie pri rozbalení na mieste (Denník je mriežka `.rec-grid`, rozbalenie by jej
prelialo riadky).

**Návrh:** (1) záznam Denníka otvárať tým istým overlayom ako Knižnica — jeden idióm
na celú appku; (2) do hlavičky dňa dopísať „+N poznatkov", čo je presne to číslo,
ktoré úloha (d) hľadá; (3) skok na Graf nechať ako sekundárnu akciu vnútri overlayu
(„Zobraziť v grafe").

### A5 — Rozhodnutia sa nedajú prehľadávať textom

**Tvrdenie:** na obrazovke Rozhodnutia nie je ani jedno textové pole a `Ctrl+K`
rozhodnutia nehľadá; filtrovať sa dá len rokom a oblasťou.

**Dôkaz:** `ia2-log.txt` „TASK(c) stav": `anyTextInput: []`, čipy = 5 oblastí +
„Všetky oblasti" + „Pridať rozhodnutie". `/api/search` beží nad uzlami a playbookmi
(`SearchController` docblock, `SearchService`), nie nad `decisions`.

**Efekt:** pri 41 rozhodnutiach sa ešte dá skrolovať; je to lineárny rast, ktorý
skončí presne tak, ako skončila Knižnica (1661 kariet bez stránkovania — nameraných
337 289 znakov na jednej obrazovke, `ia-log.txt` „SCREEN kniznica").

**Riziko opravy:** nulové pre klientský filter nad už načítanými 41 záznamami;
stredné, ak sa `/api/search` rozširuje (mení tvar odpovede, ktorý číta cmdk).

**Návrh:** klientské pole „Filtrovať rozhodnutia…" v tom istom riadku ako čipy
(idióm Knižnice). Rozšírenie `/api/search` na rozhodnutia radšej ako samostatná úloha.

---

## 2. Prázdne, načítavacie a chybové stavy

### A6 — „Nelži, keď fetch padne" platí na 6 obrazoviek zo 7; siedma je Graf a padá celá appka

**Tvrdenie:** dátové obrazovky majú korektný chybový stav. Graf ho má tiež, ale jeho
zlyhanie zhodí **všetkých sedem obrazoviek**, aj tie, ktoré graf nepotrebujú.

**Dôkaz (zmerané, `/api/{journal,dashboard,today,library,decisions,review}` abortnuté
cez request interception, `ia-log.txt` sekcia FETCH FAIL):**

| Obrazovka | Čo appka ukáže | `.empty-loading` visí? |
|---|---|---|
| Dnes | „Nepodarilo sa načítať prehľad / Skús obnoviť stránku." | nie |
| Denník | „Nepodarilo sa načítať denník / Skús obnoviť stránku." | nie |
| Knižnica | „Nepodarilo sa načítať knižnicu / Skús obnoviť stránku." | nie |
| Rozhodnutia | „Nepodarilo sa načítať rozhodnutia / Skús obnoviť stránku." | nie |
| Kontrola | „Nepodarilo sa načítať frontu / Skús obnoviť stránku." | nie |
| Smernica | normálny prázdny stav (jej fetche sú POST na podnet človeka; catch v `smernica.js:140` je korektný) | nie |

Dnes navyše rieši **čiastočné** zlyhanie správne: keď padne len `/api/dashboard`,
zvyšok z `/api/today` zostane a chýbajúca časť to o sebe povie
(`dnes.js:71–79`) — to je najlepší kus tejto rodiny v celom repe.

Naproti tomu `public/js/mind/main.js:45–51`: zlyhanie `/api/mind` → `renderInitError()`
→ `return`. Nič ďalšie sa neinicializuje, takže Denník, Rozhodnutia ani Kontrola sa
nedajú otvoriť, hoci ich dáta sú v poriadku.

**Efekt:** appka, ktorá je z 6/7 obrazoviek nezávislá od grafu, je 7/7 závislá od
jedného 244–325 ms dopytu.

**Riziko opravy:** stredné. `S.byId`/`S.areas` číta veľa modulov (breadcrumb, chipy
oblastí, `openNodeFromAnywhere`), takže „appka bez grafu" je reálny nový stav, nie
prepnutie príznaku.

**Návrh:** neriešiť v tejto vlne ako refaktor. Minimum, ktoré je lacné: chybový hero
nechať, ale ponechať funkčný rail a na ostatných obrazovkách vykresliť ich vlastný
obsah (`setScreen` bez `S.nodes` funguje pre Denník a Rozhodnutia; overiť pre Dnes,
kde `dashboardHtml` číta `S.areas`).

### A7 — Konzola nemá prázdny/chybový stav pre panel vlákien a pre stratený model

**Tvrdenie:** prázdny stav toku správ je príkladný, ale zlyhanie `/api/console/threads`
skončí ako jedna systémová bublina v toku a panel zostane prázdny bez vysvetlenia.

**Dôkaz:** `render.js:renderEmpty()` kreslí „Konzola vedomia" + štyri riadky
o schopnostiach (overené, `ia-log.txt` „KONZOLA.empty"). Ale
`main.js:loadThreads()` pri chybe dostane z `http.js:json()` `null` →
`C.threads` zostane `[]` → `renderThreadList()` vykreslí prázdny `<nav>`; jediná
informácia je bublina „Požiadavka zlyhala (HTTP …)" v toku správ
(`http.js:56`). Zoznam modelov pri 404 zámerne mlčí a `select` zhasne s tooltipom
(`models.js:24–40`) — to je dobré rozhodnutie a je aj zdokumentované.

**Efekt:** panel vlákien vyzerá ako „ešte si nič nerobil", nie ako „nepodarilo sa
načítať". Presne tá lož, ktorú graf už zaplatil.

**Riziko opravy:** nulové — jeden riadok v `renderThreadList()`.

**Návrh:** `renderThreadList()` nech rozlíši `C.threads === null` (nepodarilo sa)
od `[]` (nič nie je) a v prvom prípade vypíše riadok s možnosťou „Skúsiť znova".

---

## 3. Duplicitné cesty a mŕtve prvky

### A8 — Tri paralelné mechanizmy na to isté: „daj kontext Claude Code"

**Tvrdenie:** appka má tri samostatné plochy s jedným účelom — Smernica (obrazovka),
Balík pre Claude Code (šuflík v hlavičke) a konzola (`/console`, dnes s lokálnym
Qwenom, po vlne D s reálnym Claude Code cez bridge).

**Dôkaz:** `#screen-smernica` podtitul „Povedz Hadesovi na čom robíš — poskladá
kontext pre Claude Code" (`mind.blade.php:157`); `#pack-drawer` s textom „Vybrané
uzly skopíruješ ako markdown a vložíš do Claude Code" (`mind.blade.php:363–372`),
`#pack-trigger` v hlavičke, `packBtn()` na každej karte v Denníku, Knižnici, Dnes
a Kontrole; `KONTRAKT-UX-RUNY §5 vlna D` — slash `/cc` a `/orchestrate` spustia
Claude Code priamo. Uložených smerníc na disku: **1** (`directives/`).

**Efekt:** dva z troch mechanizmov sú manuálne kopírovanie do schránky a stanú sa
mŕtvymi v momente, keď bridge funguje. `packBtn()` navyše sedí na každej karte na
štyroch obrazovkách, teda je to najviditeľnejšia sekundárna akcia v celej appke.

**Riziko opravy:** vysoké, ak sa maže. Kontrakt zakazuje znižovať počet obrazoviek,
takže Smernica ostáva — návrh preto patrí do sekcie „čo vedome nerobiť" a do
otvorených bodov, nie do vlny B.

**Návrh (na rozhodnutie používateľa, nie autonómne):** po vlne D dať Smernici
tlačidlo „Spustiť v konzole" (poslať poskladanú smernicu ako prvú správu vlákna) a
Balík nechať ako je. Nič nemazať v tejto vlne.

### A9 — Chat s Hadesom v grafe je mŕtvy a duplikuje konzolu

**Tvrdenie:** `#prompt` (chatový riadok nad plátnom) je druhá konverzačná plocha,
je vypnutá defaultne a ani po zapnutí nefunguje.

**Dôkaz:** `mind.blade.php:388–397` (`#prompt`, `#chat-log`, `#chat-context`);
`public/css/mind.css:2714` → `body:not(.chat-on) #prompt { display: none !important; }`;
prepínač je zanorený v Nastavenia → Pokročilé s textom „Chat s Hadesom (potrebuje
API kľúč)" (`mind.blade.php:232`); `ChatController.php:32–36` volá Anthropic priamo
(nie pluggable `LlmProvider` z vlny 1) a `.env` má `ANTHROPIC_API_KEY` prázdny
(overené `grep -c "^ANTHROPIC_API_KEY=.\+" .env` = 0; `/api/console/models` hlási
`"unavailable":["anthropic"]`).

**Efekt:** prepínač, ktorý zapne rozhranie, ktoré odpovie „doplň ANTHROPIC_API_KEY".
V CLAUDE.md je pritom pravidlo „ovládač, ktorý nič nerobí, je horší než chýbajúci
ovládač" — a `chat.js` nesie navyše celý mechanizmus `chatContext` (čipy uzlov,
perzistencia v `localStorage`), ktorý konzola rieši systémovým promptom.

**Riziko opravy:** malé pre prepnutie prepínača na odkaz do konzoly; vysoké pre
mazanie `chat.js` (398 r. + `#chat-context` väzby v `panels.js`).

**Návrh:** prepínač „Chat s Hadesom" v Nastaveniach nahradiť riadkom „Konzola
vedomia → otvoriť", ktorý vedie na `/console`. `chat.js` nemazať — je to samostatná
úloha po vlne D (flagnuté ako otvorený bod).

### A10 — Dok „Prehľad" duplikuje obrazovku Dnes a je dostupný len z Grafu

**Tvrdenie:** `#sec-stats` (metriky, oblasti, najsilnejšie uzly, posledné záznamy,
aktivita 30 dní) hovorí to isté, čo obrazovka Dnes (KPI, Podľa oblasti, Aktivita,
Rast siete, Posledné záznamy), len v paneli 248 px širokom a len na Grafe.

**Dôkaz:** `mind.blade.php:180–195` proti `dnes.js:dashboardHtml()`; oba čítajú
`/api/dashboard` (`StatsController`). `#btn-stats` je v `#graph-tools`, skrytom mimo
Grafu (`mind.css:2709`).

**Efekt:** dve implementácie tej istej pravdy, ktoré sa môžu rozísť — presne to
riziko, ktoré kontrakt menuje pri dvojitej ploche.

**Riziko opravy:** malé, ak sa dok zredukuje na „Otvoriť Dnes"; stredné, ak sa
zjednocujú komponenty (to je práca agenta 1).

**Návrh:** patrí do vlny B ako zlúčenie komponentov. Klávesa `S` nech otvorí Dnes,
nie druhý panel s tými istými číslami.

### A11 — Mŕtve endpointy a mŕtve akcie v konzole

**Tvrdenie:** `DELETE /api/console/threads/{uuid}` existuje a v UI ho nikto nezavolá;
`/model` ako slash príkaz nič nespustí.

**Dôkaz:** `routes/api.php:125` + `ThreadController::destroy()` (mazanie s cascade).
V `public/js/console/` neexistuje ani jeden `method: 'DELETE'`
(`grep -rn "DELETE" public/js/console/` = 0). Riadok vlákna obsahuje len
`<span class="ttl">` a `<span class="when">` — nula tlačidiel (overené,
`ia2-log.txt` „THREAD RAIL": `perRowControls`). `slash.js:32`: `/model` má
`local: focusModel`, ktorá len dá fokus `#model-select` a napíše do toku vetu —
`/model qwen3:8b` teda nič neprepne, argument sa zahodí.

**Efekt:** 85 vlákien v paneli (overené), z toho viditeľne 7× „Odpovedz jediným
slovom: ahoj" a 4× „Čo si pamätáš o Dockeri?" plus prázdne „Nové vlákno / nezačaté".
Bez mazania, bez premenovania, bez hľadania. `/api/console/threads` už dnes vracia
14 268 B a nemá stránkovanie.

**Riziko opravy:** mazanie vlákna je nevratná operácia nad dátami → podľa pravidiel
projektu vyžaduje potvrdenie v UI, nie tichý klik. Inak nulové.

**Návrh:** v riadku vlákna `⋯` s „Premenovať" (PATCH `title` už endpoint podporuje)
a „Zmazať" s potvrdením; do hlavičky panela pole na filtrovanie; `/model <id>`
nech prepne model rovno (endpoint PATCH už existuje).

---

## 4. Rail: 7 destinácií v jednej nerozdelenej grupe

**Nameraný stav** (`ia-log.txt`, „RAIL"): značka `#brand-core`, potom **jedna** grupa
`aria-label="Obrazovky"` so siedmimi destináciami v poradí
**Dnes · Denník · Graf · Knižnica · Rozhodnutia · Kontrola · Smernica**, a dole grupa
`aria-label="Systém"` s Nastaveniami a Pomocou. Odznaky fungujú: Denník má bodku
neprečítaného, Kontrola číselný pill („4", overené).

### A12 — Sedem rovnocenných destinácií nemá poradie, ktoré by niečo znamenalo

**Tvrdenie:** poradie v raile nie je ani abecedné, ani podľa frekvencie, ani podľa
významu. Denník (záznamy) je pred Grafom (identita appky), Rozhodnutia (záznamy) sú
za Knižnicou (znalosti), Kontrola (práca) je medzi Rozhodnutiami a Smernicou.

**Dôkaz:** `mind.blade.php:80–107` proti `SCREENS` v `screens.js:15` — obe poradia
sú rovnaké, takže to nie je nesúlad, len absencia princípu. Zadanie tejto úlohy
uvádzalo ešte tretie poradie (Dnes, Graf, Denník, Rozhodnutia, Knižnica, Smernica,
Kontrola), čo samo dokazuje, že poradie nie je nikde zapamätateľné.

**Efekt:** pri 7 položkách sa to dá naučiť pozíciou; pri 8 (Runy) už nie. Skratky
to nezachraňujú — z 8 destinácií má klávesu **jediná** (`D` = Denník, `ia2-log.txt`
„SHORTCUT help"), a `R`/`S`/`L` sú obsadené dokmi Grafu.

**Riziko opravy:** malé. Preskupenie je zmena poradia DOM v blade + rovnaká zmena
`SCREENS`/`CMDK_LABELS`; `localStorage['hades.screen']` drží názov, nie index, takže
uložená obrazovka prežije.

**Návrh (3 grupy + systém), do ktorého Runy sadnú bez ďalšieho lámania:**

```
TERAZ      Dnes · Graf
ZÁZNAMY    Denník · Rozhodnutia · Runy      ← Runy patria SEM (kontrakt §4 to hovorí tiež)
PRÁCA      Knižnica · Smernica · Kontrola
SYSTÉM     Konzola · Nastavenia · Pomoc     ← Konzola pribúda ako odkaz (A1)
```

Grupovanie je aj prístupnostná výhoda: dnes je jedna `role="group"` so siedmimi
prvkami, čítačka ju ohlási ako „Obrazovky, 7 položiek" bez ďalšej štruktúry.

### A13 — Kam patria Runy v toku

**Runy sú tretí druh záznamu**, nie štvrtý druh práce: Denník = „čo som robil",
Rozhodnutia = „čo som rozhodol", Runy = „čo bežalo a čo to stálo". Všetky tri sú
retrospektívne, filtrovateľné dátumom a čítané po tom, čo sa niečo stalo.

Tok, ktorý z toho vychádza a ktorý dnes nikde nie je zavretý:

```
konzola / Claude Code beh  →  Runy (zoznam + detail + „spustiť znovu")
                              ↓ diff, tokeny, tool cally, dôvod ukončenia
                           Denník (session ako celok)  →  uzol v Grafe
```

Runy majú byť **jediná cesta z behu k jeho histórii**. Dnes je tou cestou vlákno
konzoly, ktoré tú informáciu nemá (A15, A16).

### A14 — Reálne nepoužívaná destinácia: kandidát je Smernica, dôkaz je slabý

Prešiel som, čo každá obrazovka naozaj zobrazuje:

| Destinácia | Čo zobrazuje (zmerané) | Používaná? |
|---|---|---|
| Dnes | 2677 uzlov, 4 KPI, 4 karty, Sync, 12 kariet záznamov/projektov | áno |
| Denník | 13 projektových čipov, dni DNES/VČERA/…, 3 899 zn. | áno |
| Graf | 1098 uzlov, 2991 hrán | áno |
| Knižnica | 5 oblastí, **1661** playbookov, 337 289 zn. bez stránkovania | áno (a preťažená) |
| Rozhodnutia | 41 kariet, 40 s dôvodom, 2 mesiace | áno |
| Kontrola | 4 položky vo fronte, odznak „4" v raile | áno |
| Smernica | 5 šablón, prázdny náhľad, **1** uložená smernica | **sporné** |

**Smernica** je jediná obrazovka, ktorej výstup je „skopíruj si to do inej appky",
a jediná s jedným artefaktom na disku. Neoznačujem ju za nepoužívanú — jedna uložená
smernica nie je štatistika a šablóny sa dajú použiť bez uloženia, čo sa nikde
nepočíta. **NEOVERENÉ:** reálna frekvencia použitia; appka nemá telemetriu a
`/api/directive/build` sa nikde neloguje. Overiteľné by to bolo až z `runs`
(vlna C) alebo z prístupového logu Caddy.

---

## 5. Konzola proti Claude Code UX

Čo **funguje** a netreba na to siahať: NDJSON stream, `Stop` (nameraný: tlačidlo
sa objaví 1,4 s po `Enter`, po kliknutí zostane, čo prišlo, a do toku príde
„Beh zastavený. Čo prišlo, zostáva."), permission karta s `Povoliť / Povoliť vždy /
Zamietnuť` + `Enter`/`Esc` a s fokusom na karte, diff s `+/−` farbami, zbaľovanie
dlhých výsledkov (`PEEK_LINES = 6` + prah v znakoch), `aria-busy` počas streamu,
prepínač modelu naplnený zo reálne stiahnutých modelov (6 modelov, default `qwen3:8b`
z configu, nie prvá položka).

Ďalej to, čo chýba na to, aby to bolo použiteľné bez vysvetľovania.

### A15 — Po obnove stránky konzola vypíše celú systémovú smernicu ako správu Hadesa

**Tvrdenie:** vlákno otvorené z URL zobrazí 1 370-znakový systémový prompt ako
bublinu „Hades" medzi otázkou a odpoveďou. Počas živého behu tam nie je.

**Dôkaz (zmerané, `ia3-log.txt` + `audit/console-thread.png`):**
`GET /api/console/threads/<uuid>` vracia `roles: ["user","system","assistant"]`,
`systemLen: 1370`, obsah začína „Si Hades — pamäť tohto používateľa…".
Príčina je dvojica: `ThreadController::payload()` (`:90–101`) posiela **všetky**
správy vrátane `role: 'system'`, a `render.js:renderThread()` (`:311`) mapuje
`role === 'system'` na `pushNotice(msg.content)`. Systémovú správu zapisuje
`AgentRunner::systemPrompt()` (`:591–596`) raz na vlákno.

**Efekt:** „čo si videl" ≠ „čo vidíš po F5" — presne ten rozpor, ktorý komentár nad
`renderThread()` sľubuje odstrániť („obnovené vlákno musí vyzerať presne ako to,
ktoré človek videl"). Navyše sa tým do UI vysype interná štruktúra pamäte (počty
uzlov po oblastiach) ako keby to Hades používateľovi povedal.

**Riziko opravy:** nulové na klientovi (jeden `if`), ale správnejšie je nefiltrovať
až v UI: `payload()` nech `role: 'system'` nevracia vôbec — je to interná pamäť
vlákna, nie obsah konverzácie. Pozor: `history()` ju už dnes zámerne nečíta, takže
model o nič neprichádza.

### A16 — Ukončenie na strope krokov sa tvári ako hotová odpoveď

**Tvrdenie:** backend posiela dôvod ukončenia, klient ho ignoruje. Beh zrezaný
stropom 12 krokov vyzerá presne ako dokončený.

**Dôkaz:** `AgentRunner::endFrame()` (`:630–640`) posiela `stop_reason`, a pri
vyčerpaní smyčky je to `STOP_MAX_STEPS` (`:270`). `run.js:dispatch()` case `'end'`
(`:295–304`) číta len `tokens_in`, `tokens_out`, `tokens_per_second`;
`endAnnounce()` vždy hlási „Odpoveď dokončená". `stop_reason` je aj v payloade
vlákna (`ThreadController:97`) a `render.js` ho nikde nezobrazuje.

**Efekt:** model, ktorý zacyklil „hľadaj → prečítaj" a spálil 12 krokov, odovzdá
polovičnú prácu bez jediného slova o tom, že bol prerušený. Používateľ hľadá chybu
v zadaní.

**Riziko opravy:** nulové, aditívne — jeden riadok v `dispatch('end')`.

**Návrh:** pri `stop_reason === 'max_steps'` vypísať systémovú bublinu „Beh dosiahol
strop 12 krokov — úloha nemusí byť dokončená." a to isté ohlásiť do `#run-announce`.
Zároveň zobrazovať `stop_reason` pri obnove vlákna.

### A17 — „Povoliť vždy" vypne potvrdzovanie natrvalo, ale prepínač v hlavičke to nepovie

**Tvrdenie:** `Povoliť vždy` nastaví `thread.auto_accept = true` v DB, klient si
však ani `C.thread.auto_accept`, ani `#auto-accept` neaktualizuje. Zaškrtávacie
políčko „Auto-povoliť zápisy" ostane vypnuté, hoci zápisy sa už nepýtajú.

**Dôkaz:** `AgentRunner::resume()` (`:141–144`) — `$thread->auto_accept = true; save();`.
`tools.js:decide()` vypustí len `console:decide`; `run.js:resumeAfterDecision()`
(`:113–122`) po streame nespraví nič so stavom `auto_accept`; `#auto-accept` sa
nastavuje výhradne v `openThread()` a `newThread()` (`main.js:88`, `:158`).
Popisok tlačidla po kliknutí („Povolené — a odteraz bez pýtania",
`tools.js:DECISION_LABEL`) je jediné miesto, kde sa to vôbec povie — a zmizne
so scrollom.

**Efekt:** bezpečnostne relevantný stav (slabý lokálny model smie zapisovať do
pamäte aj do súborov bez pýtania) je v UI zobrazený nesprávne. Kontrakt KONZOLA §7
kritérium 3 stojí práve na tejto bráne.

**Riziko opravy:** nulové — po rozhodnutí `allow_always` nastaviť
`C.thread.auto_accept = true` a `$('#auto-accept').checked = true`.

**Návrh:** navyše ohlásiť do `#run-announce` a v systémovej bubline napísať rozsah
(„platí pre celé toto vlákno, kým auto-accept nevypneš" — nie pre jeden tool, čo si
z názvu „Povoliť vždy" väčšina ľudí prečíta).

### A18 — Písanie počas behu je tichý no-op; správa sa nedá zaradiť do frontu

**Tvrdenie:** stlačenie `Enter` počas behu neurobí nič a neoznámi nič.

**Dôkaz (zmerané, `ia4-log.txt` „pisanie pocas behu"):** počas streamu som napísal
druhú správu a stlačil `Enter`; `#prompt` si text ponechal, do toku nepribudol žiadny
blok, `#send` nie je `disabled` (je len `hidden`). Kód: `run.js:sendTurn()` (`:57`)
→ `if (C.running || C.booting) return;` bez akejkoľvek správy. Pri `C.awaiting` to
appka rieši správne (`pushNotice('Najprv rozhodni o čakajúcom zápise…')`) — chýba
len ekvivalent pre `C.running`.

**Efekt:** pri modeli na 9 tok/s je beh dlhý desiatky sekúnd a napísať si ďalší krok
dopredu je najprirodzenejšia vec. V Claude Code sa správa zaradí do frontu; tu sa
nestane nič a človek nevie, či to appka nezachytila alebo či pokazil skratku.

**Riziko opravy:** nulové pre hlásenie („Beh ešte beží — zastav ho, alebo počkaj").
Front správ je nová funkcia (stredné riziko), do vlny B nepatrí.

### A19 — Slash paleta má 6 príkazov; chýba to, čo človek z Claude Code čaká

**Tvrdenie:** paleta pokrýva demo, nie prácu.

**Dôkaz (zmerané, `ia-log.txt` „SLASH"):** `/recall <dopyt>`, `/read <id|názov>`,
`/model`, `/clear`, `/new`, `/help`. Z toho `/recall` a `/read` sú len rozpísané
vety pre model (`slash.js:18–30`), teda „pekné makrá", nie príkazy.

Konkrétne diery a čím sa prejavia:

| Chýba | Ako sa to prejaví |
|---|---|
| `/model <id>` s argumentom | `/model qwen3:8b` argument zahodí a len dá fokus na `<select>`; prepnutie modelu je vždy myšou (A11) |
| `/tools` alebo zoznam toolov | prázdny stav sľubuje „vidí pamäť aj súbory", ale ktorých 14 toolov to je, sa z UI nedozvieš nikdy |
| `/cost` / spotreba vlákna | tokeny sú len v `#run-stats` posledného behu a po F5 sú `""` (overené) — spotreba vlákna nikde |
| `/resume` alebo zoznam vlákien v palete | prepnutie vlákna je len klik v paneli s 85 riadkami bez hľadania |
| `/cc`, `/orchestrate` | kontrakt vlna D; dnes nie je, čo je v poriadku |
| kopírovanie odpovede / kódu | žiadne tlačidlo „kopírovať" na bubline ani na `pre` bloku; `renderMarkdown` ho nekreslí |
| zobrazenie skratiek | `Ctrl+N` žije len v texte `/help`; `#composer-hint` ho nemenuje |

**Riziko opravy:** nízke pre `/model <id>`, `/tools`, `/cost` (všetky tri majú dáta
už na klientovi alebo v existujúcom endpointe).

### A20 — Počítadlo „krok n/of" po zastavení behu zostane visieť

**Tvrdenie:** `#run-stats` po `Stop` ukazuje „krok 1/12" natrvalo.

**Dôkaz (zmerané, `ia2-log.txt`):** počas behu `"6 s · krok 1/12 · 2 znakov"`,
po kliknutí na `Stop` `"krok 1/12"`. `C.step` sa nuluje výhradne v case `'end'`
(`run.js:299`), ktorý pri aborte nikdy nepríde; `stream()` v `finally` volá
`paintStats()`, ale `C.step` nechá.

**Efekt:** hlavička tvrdí, že beh je v kroku 1 z 12, hoci nič nebeží. Menší brat
A16 — tá istá trieda chyby: koncový stav sa nedopočíta, keď nepríde `end`.

**Riziko opravy:** nulové — `C.step = null` v `finally` bloku `stream()`.

### A21 — Tokeny a rýchlosť sú viditeľné jednu sekundu a potom navždy zmiznú

**Tvrdenie:** `tokens_out` a `tokens_per_second` sú v payloade vlákna pri každej
správe, ale UI ich po obnove nezobrazí; bublina nesie len názov modelu.

**Dôkaz:** `ThreadController:97–98` posiela `tokens_out` a `tokens_per_second`;
`render.js:assistantShell()` (`:169–180`) číta z meta len `model`. Overené: po
`reload` je `#run-stats` prázdny reťazec (`ia2-log.txt` „PO OBNOVE").

**Efekt:** cena odpovede je nezistiteľná už minútu po tom, čo dobehla — a to je
presne to, čo má obrazovka Runy dodávať. Kým Runy nie sú, konzola je jediný zdroj
tejto informácie a zahadzuje ju.

**Riziko opravy:** nulové, aditívne (`who-model` už miesto na to má).

---

## 6. Ako sa dnes v UI dostaneš k logu behov

**Potvrdzujem: nijako. Log behov v tejto vetve neexistuje.**

Dôkaz je štvornásobný:

1. `grep -rin "runy|run_events|RunRecorder"` nad `public/js`, `app`, `resources`,
   `routes`, `database` → **0 zásahov**.
2. Poslednými migráciami sú `2026_08_19_000001_create_console_tables` a
   `..._000002_create_node_embeddings_table` — tabuľka `runs` nie je.
3. MCP tooly sú `mind_activate, mind_decision, mind_delete, mind_hygiene, mind_learn,
   mind_link, mind_move, mind_overview, mind_read, mind_recall, mind_rename,
   mind_update` — `mind_runs` ani `mind_run` medzi nimi nie sú.
4. Jediná perzistovaná stopa po behu je história vlákna
   (`console_messages` + `console_tool_calls`) a tá je dosiahnuteľná výhradne
   z `/console/<uuid>`, teda z plochy, na ktorú z grafu nevedie žiadny odkaz (A1).

Čo z toho vyplýva pre vlnu C: obrazovka Runy **nie je** zlepšenie existujúceho
zobrazenia, je to prvá cesta k údajom, ktoré appka dnes zahodí (A16, A20, A21).
Poradie prác, ktoré z toho vychádza: najprv zaznamenať (`RunRecorder`), potom
zobraziť, a **až potom** riešiť A16/A20/A21 na klientovi — inak sa tá istá logika
napíše dvakrát a rozíde sa.

---

## Zhrnutie podľa efektu a rizika

| ID | Nález | Efekt | Riziko opravy |
|---|---|---|---|
| A1 | Konzola nie je z grafu dosiahnuteľná | vysoký | nulové |
| A15 | Systémový prompt sa po F5 vypíše ako správa | vysoký | nulové |
| A17 | „Povoliť vždy" nezobrazí zapnutý auto-accept | vysoký (bezpečnosť) | nulové |
| A16 | Strop krokov vyzerá ako hotová odpoveď | vysoký | nulové |
| A2 | `Ctrl+K` + `Enter` skočí na Smernicu | stredný | malé |
| A4 | Denník nemá detail na mieste (2·N klikov) | stredný | malé |
| A3 | Odpad vidí len AI, nie človek | stredný | stredné |
| A11 | Mŕtve: DELETE vlákna, `/model <id>`, 85 vlákien bez správy | stredný | malé |
| A18 | Písanie počas behu = tichý no-op | stredný | nulové |
| A20 | „krok 1/12" visí po Stope | nízky | nulové |
| A21 | Tokeny/tok-s po obnove zmiznú | nízky | nulové |
| A7 | Panel vlákien nemá chybový stav | nízky | nulové |
| A12 | Rail: 7 destinácií bez princípu poradia | stredný (rastie s Runmi) | malé |
| A5 | Rozhodnutia sa nedajú hľadať textom | nízky (rastie) | nulové |
| A19 | Slash paleta pokrýva demo, nie prácu | stredný | nízke po častiach |
| A10 | Dok Prehľad duplikuje Dnes | nízky | malé |
| A9 | Mŕtvy chat v grafe duplikuje konzolu | nízky | malé (prepínač) |
| A8 | Tri mechanizmy na kontext pre Claude Code | stredný | vysoké → nerobiť teraz |
| A6 | Zlyhanie `/api/mind` zhodí všetkých 7 obrazoviek | stredný | stredné |

---

## Čo vedome NEROBIŤ

Nasledujúce by z auditu logicky vyplývalo, ale kontrakt to zakazuje alebo je to
riziko neúmerné výnosu. Patrí to sem, nie medzi nálezy.

1. **Neznižovať počet obrazoviek.** `KONTRAKT-UX-RUNY §6` to zakazuje explicitne.
   Konkrétne to znamená: **Smernicu nezrušiť** (A14 ju označuje za spornú, dôkaz je
   slabý a chýba telemetria) a **Kontrolu nezlúčiť** s Rozhodnutiami ani s Denníkom.
2. **Nezlučovať Denník s Rozhodnutiami.** Sú to dva druhy záznamu s dvoma rôznymi
   dátovými zdrojmi (`/api/journal` × `/api/decisions`) a radikálna varianta bola
   zamietnutá. A4 preto navrhuje **zjednotiť idióm detailu**, nie obrazovky.
3. **Nemazať `chat.js` ani `#prompt`** v tejto vlne (A9). Prepnúť prepínač na odkaz
   do konzoly je lacné; odstránenie 398 riadkov s väzbami do `panels.js` je
   samostatná úloha po vlne D, keď bude jasné, čo z `chatContext` prevezme konzola.
4. **Nemazať Balík pre Claude Code ani `packBtn()`** (A8). Sú na štyroch obrazovkách
   a kým bridge nefunguje, sú to funkčné cesty. Zjednotenie navrhnúť ako otvorený
   bod, nie ako prácu vlny B.
5. **Nerobiť „appku bez grafu" ako refaktor** (A6). `S.byId`/`S.areas` číta priveľa
   modulov; je to nový stav aplikácie, nie príznak, a v šprinte o dizajnovom jazyku
   by to bola najväčšia jediná zmena rizika.
6. **Nerozširovať `/api/search` na rozhodnutia** v tejto vlne (A5). Mení tvar
   odpovede, ktorý čítá `cmdk.js`; klientský filter nad 41 už načítanými záznamami
   dá 95 % úžitku za 0 % rizika.
7. **Nezavádzať front správ v konzole** (A18). Hlásenie „beh ešte beží" je jeden
   riadok; front je nová funkcia so stavom, a ten by mal vzniknúť až s Runmi, aby
   sa zaradená správa dala aj zaznamenať.
8. **Neriešiť A16/A20/A21 pred `RunRecorder`om** (§6). Dôvod ukončenia, krok a
   spotreba majú mať jeden zdroj; keď sa napíšu najprv na klientovi a potom v
   recorderi, rozídu sa — presne to riziko, ktoré kontrakt menuje pri dvojitej ploche.
