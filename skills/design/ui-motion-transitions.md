# UI motion + transitions

> Produkčný motion systém pre webové aplikácie a interaktívny canvas: účel pohybu, tokeny, prechody, gestá, prerušenie, reduced motion, výkon a testovateľné pravidlá.

## Hranice skillu

Použi tento playbook pre produktové UI: komponenty, navigáciu, docky, modaly, async stavy, graf, kameru a gestá. Pre Reels, reklamu a strih použi `skills/design/motion-video.md`.

Motion nie je dekorácia. Pridaj ho iba vtedy, keď komunikuje aspoň jednu funkciu:

1. **Feedback** — systém prijal akciu alebo zmenil stav.
2. **Orientácia** — odkiaľ prvok prišiel a kam patrí.
3. **Kontinuita** — dva stavy sú ten istý objekt alebo priestor.
4. **Hierarchia** — čo je rodič, detail, overlay alebo ďalšia úroveň.
5. **Pozornosť** — objavila sa relevantná zmena, ktorú treba zaznamenať.

Ak po odstránení animácie používateľ nestratí informáciu ani kontext, pohyb je voliteľný. Ak spomaľuje ďalšiu akciu, skráť ho alebo odstráň.

## Motion kontrakt

### Základné tokeny

```css
:root {
  --motion-0: 0ms;
  --motion-press: 80ms;
  --motion-fast: 120ms;
  --motion-base: 180ms;
  --motion-slow: 240ms;
  --motion-camera: 320ms;
  --motion-ambient: 400ms;

  --ease-enter: cubic-bezier(.16, 1, .3, 1);
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --ease-exit: cubic-bezier(.4, 0, 1, 1);
  --ease-linear: linear;

  --move-1: 2px;
  --move-2: 4px;
  --move-3: 8px;
  --move-4: 16px;
}
```

- Vyberaj sémantický pattern; nevymýšľaj krivku a trvanie v každom komponente.
- Drž foreground prechod do **320 ms**. Token 400 ms rezervuj pre ambientný alebo jednorazový významný canvas dej.
- Meraj vzdialenosť v screen pixeloch. Bežný prvok posuň najviac 8 px, panel 16 px.
- Spusť feedback okamžite po akcii. Nečakaj na koniec animácie, aby sa zmenil focus, ARIA stav alebo error.
- Vstup orientuje, preto môže byť dlhší. Výstup uvoľňuje priestor, preto ho drž kratší.

### Základné prechody

| Pattern | Enter | Exit | Vlastnosti |
|---|---:|---:|---|
| Tooltip / popover | 120 ms | 80 ms | opacity + 4 px od triggera |
| Dropdown | 150 ms | 100 ms | opacity + 4 px od triggera |
| Toast | 180 ms | 140 ms | opacity + 8 px od okraja |
| Panel / drawer | 240 ms | 180 ms | translate 16 px + opacity |
| Modal | 240 ms | 180 ms | opacity + scale 0.98 alebo 8 px |
| Scrim | 180 ms | 120 ms | iba opacity |
| List insert | 180 ms | — | opacity + 8 px |
| List remove | — | 140 ms | opacity; až potom preusporiadaj |
| Reorder | 220 ms | 220 ms | FLIP transform |
| Page / veľký kontext | 240–320 ms | 180–240 ms | podľa hierarchie |

Použi `ease-enter` na príchod, `ease-exit` na odchod a `ease-standard` na transformáciu prvku na mieste.

## Mikrointerakcie a okamžitý stav

- **Hover:** 50–120 ms; zmeň farbu, border alebo jemnú opacity. Neschovávaj podstatný obsah iba za hover.
- **Press:** 80 ms; `scale(.98)` povoľ iba malému ovládaciemu prvku. Veľkú kartu alebo celý panel nescaluj.
- **Focus:** zobraz bez oneskorenia. Focus ring nie je animovaný reward.
- **Toggle:** zmeň sémantický stav synchronne; vizuálny thumb môže prejsť za 120–180 ms.
- **Validation:** error text, ikonu a `aria-invalid` sprístupni okamžite. Jemný fade môže byť iba nadstavba.
- **Success:** potvrď stav farbou, ikonou alebo textom; motion nikdy nesmie byť jediný signál.
- **Loading:** nezačni spinner pri každom sub-100 ms requeste, ak by iba blikal. Pri dlhšom čakaní ukáž stabilný stav bez nekonečného pulzovania celej plochy.

Vyhni sa bounce, shake a overshoot pri formulároch, mazaní, permissions a kritických akciách. Shake nehovorí, ako chybu opraviť, a môže zhoršiť motion sensitivity.

## Enter, exit a zmena obsahu

### Zachovaj priestorový pôvod

- Otvor dropdown, tooltip a popover z triggera.
- Panel nech vstupuje a odchádza z rovnakého okraja.
- Detail objektu otvor zo zvoleného objektu alebo jasne priraď cez highlight.
- Nevytváraj pohyb z náhodného rohu iba preto, že vyzerá dynamicky.

### Nemaž DOM skôr než skončí exit

Pri vizuálnom výstupe:

1. zablokuj opakovanú deštruktívnu akciu, ak je to potrebné,
2. nastav dátový a accessibility stav podľa skutočnosti,
3. prehraj krátky exit,
4. odstráň prvok,
5. presuň focus na logického suseda alebo invoker,
6. preusporiadaj zvyšok cez FLIP, nie animovaním `top`, `left`, `height`.

Ak používateľ musí s prvkom interagovať počas exit animácie, exit je príliš dlhý alebo zle načasovaný.

### Replace a navigácia

- Rovnakú úroveň obsahu vymeň crossfade-om približne 160 ms.
- Hierarchický krok dopredu/dozadu môže použiť smerový posun 8 px a 240 ms.
- Smer späť musí byť priestorovo opačný k smeru dopredu.
- Nemeň súčasne os, scale, blur aj farbu. Použi najmenší počet vlastností, ktorý vysvetlí zmenu.
- Pri route change zachovaj scroll/focus podľa typu navigácie; animácia nemá prepisovať browser history model.

## Overlaye, docky a notifikácie

### Modal

- Presuň focus dovnútra synchronne s otvorením; nečakaj 240 ms.
- Nastav podklad ako `inert` počas otvoreného modalu.
- Trapni Tab/Shift+Tab podľa dialog patternu, Escape zavrie a focus sa vráti invokeru.
- Animuj modal a scrim samostatne. Scrim nescaluj ani neposúvaj.
- Pri zatvorení obnov focus aj v reduced motion režime.

### Dock a drawer

- Zachovaj canvas kontext; panel môže prekryť obsah, ale nesmie skryť práve fokusovaný prvok.
- Pri resize radšej prepočítaj layout diskrétne alebo použi FLIP. Neanimuj `width` celej aplikácie na každom keyframe.
- Ak otvorenie mení využiteľný viewport canvasu, fit/center nevykonávaj automaticky, pokiaľ by používateľ stratil miesto.

### Toast

- Toast nevynucuje focus.
- Kritickú chybu nekomunikuj iba samomiznúcim toastom; udrž ju pri zdroji alebo v status oblasti.
- Pozastav timeout pri hover/focus, ak toast obsahuje akciu.
- Pri viacerých toastoch nequeueuj dlhé animácie; aktualizuj alebo zoskup stav.

## Zoznamy, tabuľky a live dáta

- Pri vložení zvýrazni nový prvok jedným krátkym prechodom; neanimuj celý zoznam.
- Pri odstránení dokonči exit a potom premiestni súrodencov cez FLIP.
- Pri reorderi zachovaj identitu a focus položky.
- V tabuľkách nepoužívaj stagger. Pri inom obsahu povoľ 20 ms, najviac pre prvých 5 prvkov.
- Live update nesmie kradnúť scroll ani focus. Aktualizovaný riadok krátko zvýrazni a zmenu oznam podľa relevancie.
- Pri sort/filter animuj maximálne zmenu opacity alebo pozície; výsledok a počet zobraz okamžite.
- Skeleton nepoužívaj ako falošnú presnú predpoveď layoutu. V reduced motion režime vypni shimmer.

## Canvas, graf a kamera

### Priama manipulácia

- Drag, pan a pinch mapuj 1:1 na vstup bez easingu.
- Ukotvi wheel/pinch zoom pod kurzor alebo centroid dotykov.
- Prejdi na Pointer Events; používaj `touch-action: none`, `setPointerCapture()` a spracuj `pointercancel`.
- Nastav drag prah približne 4 px pre mouse/pen a 8 px pre touch, aby klik nebol náhodný drag.
- Escape alebo cancel vždy ukončí gesto do konzistentného stavu.
- Node drag nemá zotrvačnosť. Voliteľná zotrvačnosť viewportu trvá najviac 240 ms a nový vstup ju okamžite preberie.

### Kamera

- Zoom tlačidlami: približne 180 ms.
- Focus alebo fit: 320 ms, maximálne 400 ms pri veľkej vzdialenosti.
- Pri reduced motion presuň kameru okamžite.
- Neanimuj veľký prelet cez neznámy priestor, ak môže dezorientovať; crossfade kontext alebo použi kratšiu cestu.
- Zachovaj vybraný uzol viditeľný po otvorení docku, zmene filtra a resize.

### Uzly, hrany a pulzy

- Hover uzla interpoluj najviac približne na scale 1.06 za 120 ms.
- Context dimming preveď za približne 160 ms a zachovaj definovanú podlahu viditeľnosti.
- Event pulse prehraj raz; trvanie môže rásť so screen vzdialenosťou, ale drž ho približne v rozsahu 240–480 ms.
- V reduced motion nahraď cestujúci alebo radiálny pulz statickým outline, farbou a textovým oznámením.
- Force simulation po ustálení zastav. Počas drag ju aktivuj iba lokálne a po release ju nechaj krátko dosadnúť, nie driftovať permanentne.
- Pri neaktívnej záložke zastav ambient, simulation aj canvas render loop.

## Prerušenie, reverzia a race conditions

Animácie sa nikdy nesmú hromadiť vo fronte.

- Nový cieľ začni z aktuálneho vizuálneho stavu.
- Pri rovnakých keyframes použi WAAPI `reverse()`; inak `cancel()` a nový prechod z computed state.
- Pri reverzii skráť čas podľa zostávajúcej vzdialenosti, minimálne však približne 80 ms, aby nevznikol blik.
- Udrž dátový stav ako jediný zdroj pravdy. Animácia ho iba prezentuje.
- Zmeň `aria-expanded`, `aria-selected`, `disabled`, `inert` a live oznámenie podľa akcie, nie podľa eventu `animationend`.
- Ošetri unmount, route change, `pointercancel`, `visibilitychange` a zrušený request.
- Po desiatich rýchlych toggle klikoch musí UI skončiť v poslednom požadovanom stave bez zombie vrstiev.

## Reduced motion

Efektívny reduced režim je aktívny, ak ho žiada systém cez `prefers-reduced-motion` alebo interné nastavenie produktu.

- Počúvaj `MediaQueryList` event `change`; nečítaj preferenciu iba pri štarte.
- Odstráň priestorový travel, scale, parallax, fling, cestujúce pulzy, autoplay timeline a animovanú kameru.
- Povoľ krátku opacity alebo color zmenu do približne 100 ms, ak zachováva feedback bez diskomfortu.
- Force graf prepočítaj do stabilného výsledku bez zobrazovania simulácie.
- Nekonečný ambient alebo core pulse nahraď jedným cyklom pri skutočnej zmene stavu.
- Automatický pohyb dlhší než 5 sekúnd musí mať pause/stop/hide mechanizmus.
- Reduced motion nie je „nič sa nestane“. Zachovaj stav cez text, ikonu, border, focus a live announcement.

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-press: 0ms;
    --motion-fast: 80ms;
    --motion-base: 100ms;
    --motion-slow: 100ms;
    --motion-camera: 0ms;
    --motion-ambient: 0ms;
    --move-1: 0px;
    --move-2: 0px;
    --move-3: 0px;
    --move-4: 0px;
  }
}
```

Nespoliehaj sa na globálne `animation-duration: 0.01ms`, ak logika čaká na animation event. Implementuj deterministickú no-motion vetvu.

## Výkonová architektúra

- Animuj prioritne `transform` a `opacity`.
- Neanimuj `width`, `height`, `top`, `left`, blur ani `filter` bez merania a zdokumentovanej výnimky.
- Nepoužívaj `transition: all`; explicitne vymenuj vlastnosti.
- `will-change` pridaj tesne pred náročným prechodom a po `finish`/`cancel` ho odstráň.
- Canvas renderuj cez `requestAnimationFrame` iba pri dirty stave, aktívnom pulze, kamere, replayi alebo simulácii; v idle loop zastav.
- Počítaj progres z rAF timestampu, nie z počtu frameov; rovnaké trvanie tak funguje na 60 aj 120 Hz.
- Zoskup pointer zmeny do jedného rAF. Pre stylus použi coalesced events iba ak meranie ukáže potrebu.
- Obmedz interné DPR canvasu podľa vizuálnej potreby, typicky `Math.min(devicePixelRatio, 2)`.
- Meraj na slabšom zariadení a s CPU throttlingom. Optimalizuj záznam, nie dojem na vývojárskom notebooku.

### Výkonový gate

- p95 práca na animačný frame pod približne 10 ms pri 60 Hz,
- žiadny long task nad 50 ms spôsobený prechodom,
- CLS spôsobené animáciou = 0,
- INP v „good“ pásme do 200 ms na 75. percentile,
- idle canvas negeneruje nepretržité frames bez viditeľnej zmeny,
- motion zostáva správny pri 4× CPU slowdown a rýchlom prerušení.

## QA matica

Otestuj každý kritický pattern:

| Os | Varianty |
|---|---|
| Input | mouse, touch, pen, keyboard |
| Motion | normal, system reduce, app reduce |
| Refresh | 60 Hz, 120 Hz ak dostupné |
| Výkon | bežný stav, 4× CPU, veľa uzlov/dát |
| Viewport | úzky, široký, 200 % zoom |
| Theme | light, dark, forced colors |
| Prerušenie | reverse v 25 %, 50 % a 75 % |
| Životný cyklus | unmount, route change, hidden tab, cancelled request |

### Release gate

- [ ] Každá animácia má pomenovaný účel.
- [ ] Použité sú centrálne duration, easing a distance tokeny.
- [ ] Entry/exit zachováva priestorový pôvod a exit nie je pomalší bez dôvodu.
- [ ] Focus, ARIA a error feedback nečakajú na animáciu.
- [ ] Rapid toggle a reverse skončia v poslednom dátovom stave.
- [ ] Reduced motion zachová informáciu bez spatial travel a ambientu.
- [ ] Canvas sa v idle zastaví a pri hidden tab nepokračuje.
- [ ] Kritické prechody animujú transform/opacity alebo majú meranú výnimku.
- [ ] Klávesnica, touch, pen a pointercancel majú bezpečný tok.
- [ ] Performance profil spĺňa dohodnutý frame/INP/CLS budget.

## Audit pre Hades

Pri najbližšej implementačnej iterácii skontroluj:

- čítanie reduced-motion preferencie aj po zmene nastavenia,
- nekonečný `core-pulse` a animovaný `filter`,
- animáciu šírky promptu,
- mouse-only canvas vstup namiesto Pointer Events,
- nepretržitý canvas render v idle,
- permanentné force pohyby,
- chýbajúce reverzibilné exit stavy panelov,
- skoky kamery bez jasného motion/reduced-motion kontraktu.

## Zdroje

- [Atlassian Design System — Motion](https://atlassian.design/foundations/motion)
- [Atlassian Design System — Applying motion](https://atlassian.design/foundations/motion/applying-motion)
- [Apple Human Interface Guidelines — Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [W3C WCAG 2.2 — Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
- [W3C WCAG 2.2 — Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)
- [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- [MDN — Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API)
- [W3C Pointer Events](https://www.w3.org/TR/pointerevents3/)
- [web.dev — High-performance CSS animations](https://web.dev/articles/animations-guide)
- [web.dev — Rendering performance](https://web.dev/articles/rendering-performance)
- [MDN — requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
