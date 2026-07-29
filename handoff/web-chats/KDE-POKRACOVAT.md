# Kde pokračovať — živé vlákna (claude.ai web)

> Rozrobené/najnovšie vlákna z web účtu (Radko Ruščák), zoskupené podľa 4 tém.
> Ku každému: **kde presne skončilo** a **ďalší krok**. Plný text je v `threads/<súbor>.md`.
> Kompletný zoznam všetkých 200 chatov: [INDEX.md](INDEX.md).

Legenda: 🔴 blokujúce/čaká na akciu · 🟡 rozrobené · 🟢 v podstate hotové, možný follow-up

---

## 💰 Peňaženka & cenotvorba

### 🔴 Peňaženka — blokujúci bug (Daniel IT)
Naprieč viacerými poradami (14.7. `Zhodnotenie júla`, 21.7. `Penazenka a cenotvorba - akcny plan`) sa rieši **web-peňaženka**:
implementované priame vloženie kreditu z pokladne (kód poukážky → okamžitý vklad) a čiastočná úhrada kreditom (zvyšok kartou, funguje s kupónmi). **Pokračuje** napojenie košík → objednávka → peňaženka a zápis transakcií v DB. Hlášky: generická pre ~80 % prípadov, špecifické pri kupónoch rieši Samuel (jednotný formát). Dizajn hlášok/pokladne pripravuje Ema vo Figme, Dano dodá HTML+CSS preview (layout: kupóny nad wallet, wallet ako roll-up).
**Ďalší krok:** dotiahnuť napojenie košík→objednávka→peňaženka + DB transakcie; zjednotiť hlášky pri kupónoch.
📄 `threads/2026-07-21_penazenka-a-cenotvorba-akcny-plan-a-otvorene-otazk.md`, `threads/2026-07-14_zhodnotenie-júla-podľa-oddelení.md`

### 🟡 Cenotvorba — model nákup × markup (Delaja IT)
Prechod z výpočtu cez materiál/gramáž na **nákupná cena × markup**. Kalibrácia: zistená delta až 58 % (napr. 67 € vs 28,19 €), markup posun 160→260, cieľová odchýlka 0–2 % v 2–3 behoch (delta > 20 % sa preskočí). Pokrytie ~90 % sortimentu, v admine zatiaľ vizuálne. Do adminu pribudne kalkulačka + filter marží; zmeny cien len cez kód. Mesačné kontroly po nasadení.
**Ďalší krok:** doladiť kalibráciu na odchýlku 0–2 %, nasadiť a spustiť mesačné kontroly.

### 🟢 Excel cenotvorby — markup konvencia
Vo vlákne `Materiály a skupiny pre cenotvorbu` (1.–7.7., 44 správ) sa doladil Excel: **markup = 100 + navýšenie** všade; vzorce `Marža € = nákup × (markup − 100)/100`, `Predaj bez DPH = nákup × markup/100`; verzia „_nad100" = zľava 10 % len na navýšenie (marže ekonomicky rovnaké). Materiálové sadzby pod/nad100 vyplnené (AU_18k 155/149,5 … BIZU 200/190 …), darčeky DAR_S/M/XL. Súbor aktualizovaný a overený.
📄 `threads/2026-07-01_materiály-a-skupiny-pre-cenotvorbu.md`

---

## 🔍 SEO reporting & KW

### 🔴 Reporting zošity po oddeleniach — otvorená otázka
`SEO reporting framework` (12.–13.7.): vytvorených **8 individuálnych xlsx** (Sklad, Expedícia, Reklamačné, Dopravcovia, PPC, Social media, Newsletter, IT), každý vo forme SEO zošita (Príprava · Porada · Záver a akcie) s vlastným radom otázok. **Otvorená otázka:** používateľ chcel „2 individuálne xlxs ku každému" — treba spresniť, čo má obsahovať druhý typ súboru.
**Ďalší krok:** ujasniť „2 ku každému" a dorobiť druhý zošit na oddelenie.
📄 `threads/2026-07-12_seo-reporting-framework-a-prezentácia.md`

### 🔴 SEO pivot tabuľka — čaká na dáta
`SEO analýza s pivot tabuľkou` (13.7.): pripravená mesačná pivot šablóna (tab Blogy, auto CTR + SPOLU + graf). **Čaká sa na dodanie dát** (URL + Zobrazenia + Kliky + Pozícia s označením mesiaca), potom sa hodnoty prenesú do mesačného bloku.
**Ďalší krok:** dodať dáta → Claude ich doplní.
📄 `threads/2026-07-13_seo-analýza-s-pivot-tabuľkou-a-konkurenčným-porovn.md`

### 🟢 KW dashboard + konkurencia (izlato.sk)
`Interaktívny HTML dashboard s KW metrikami` (7.–8.7.): pridaný tab **Konkurencia** (izlato.sk, 2627 organic KW). Porovnávacie KPI: KW 1086 vs 2627, organic traffic 9 722 vs 79 477 (8×), prekryv 643 KW. 4 grafy (prekryv, H2H, atď.). Renderuje bez chýb.
📄 `threads/2026-07-07_interaktívny-html-dashboard-s-kw-metrikami-a-trend.md`

### 🟢 Ahrefs odkazy v hárku
`Ahrefs MCP tool` (14.7.): do stĺpca D pri zodpovedaných otázkach doplnené odkazy na Ahrefs (Rank Tracker projekt 9364794, Competitors, Content Gap – 10 konkurentov, GSC Performance). Pozn.: Ahrefs nemá stabilné deep-linky na filter, preto link vedie na projekt + textový popis pohľadu.
📄 `threads/2026-07-14_ahrefs-mcp-tool-na-otázky-v-hárku.md`

---

## 🗓️ Porady & reporty pre CEO

### 🔴 August cadence porád — návrh čaká na zavedenie
`Plánovanie porád na mesiac v Asane` (17.7.): z frekvencie posledných 3 mesiacov navrhnutá **cadence na august** po osobách/oddeleniach (SEO-Gabika týždenne+mesačne, IT-Delaja/Daniel/Kristián týždenne, Marketing-Benjamin/Ema, Lucia expedícia/reklamácie/dopravcovia, Sklad, Nahrávanie, Fotograf, Nákup, Import) + CEO: piatkové zhrnutie + 1 mesačná.
**Ďalší krok:** premietnuť cadence do kalendára/Asany na august.
📄 `threads/2026-07-17_plánovanie-porád-na-mesiac-v-asane.md`

### 🔴 Asana filtre k úlohám — treba manuálne polia
`Zhrnutie porád z týždňa` (17.7.): vytvorený Asana projekt s 15 úlohami + navrhnutá **schéma filtrov** (Priorita P1–P3, Oblasť: IT-Vývoj/Marketing-SEO/Prevádzka-Sklad/Reporting-Governance/Personál/Stratégia-AI). **Limit:** cez Asana konektor sa nedajú vytvárať custom fields/filtre — treba nastaviť ručne. P1 kritické: KPI sada, Sklad monitor <200k€, Delia cenotvorba.
**Ďalší krok:** ručne vytvoriť custom fields v Asane podľa schémy a priradiť úlohám.
📄 `threads/2026-07-17_zhrnutie-porád-z-týždňa.md`

### 🟡 Porada Lucia — otvorené body do 27.7.
`Zápis porady Lucia - Report Dopravcovia` (20.7.): záver + akčný plán zapísané do udalosti 27.7. Otvorené body ponechané: protokoly elektronicky, pravidlá retuše, stav skladu/importu, import tovaru, detail popisu. **Nový nápad:** postaviť appku pre Sam na evidenciu fotiek pri nahrávaní (filtrovanie ako v Asane, dizajnové profily).
**Ďalší krok:** doriešiť otvorené body na porade 27.7.; zvážiť appku pre Sam.
📄 `threads/2026-07-20_zápis-porady-lucia-report-dopravcovia.md`

### 🟢 Ads report do porady + Executive prezentácia
- `Príprava reportu a akcií z porady` (21.7.): report + akčné kroky zapísané do udalosti „Samuel_Ad´s - Report / optimalizácia - 2/3". 📄 `threads/2026-07-21_príprava-reportu-a-akcií-z-porady.md`
- `Executive presentation condensing` (20.–21.7., 44 správ): CEO prezentácia o vyťaženosti tímu; pridaná sekcia **08 · Čo ďalej s tímom** — automatizácia prekladov uvoľní kapacitu nerovnomerne (najviac u najmenej vyťažených), presun práce, nie znižovanie tímu. 📄 `threads/2026-07-20_executive-presentation-condensing.md`

---

## 🎓 Certifikát + spomienky

### 🟡 Claude certifikát — rozhodnutie o ceste
`Certifikát od Claude` (22.7.): dve možnosti —
1. **Anthropic Academy** (zadarmo, komukoľvek): kurzy AI Fluency, API, MCP, Claude Code → certifikát o absolvovaní. Registrácia e-mailom.
2. **Claude Certification Program** (platený, proctorovaný, len partneri): 4 certifikácie cez Pearson VUE (CCAO-F, CCAR-F, CCAR-P, CCDV-F), odznaky cez Credly, platnosť 12 mes.
Uložené v Hades memory (`/areas/claude-certifikacia.md`).
**Ďalší krok:** rozhodnúť, ktorú cestu — pre rýchly štart Anthropic Academy.
📄 `threads/2026-07-22_certifikát-od-claude.md`

### 🟢 Export spomienok
`Export stored memories` (22.7.): vytvorený ZIP s `memory-export.md` (kategórie Instructions/Identity/Career/Projects/Preferences) + `konverzacie-index.md` (45 konverzácií s odkazmi).
📄 `threads/2026-07-22_export-stored-memories-and-personal-context.md`

---

## Zhrnutie — top resty na pokračovanie

| Priorita | Rest | Vlastník | Stav |
|---|---|---|---|
| 🔴 P1 | Peňaženka: napojenie košík→objednávka→peňaženka + DB transakcie | Daniel/Samuel IT | rozrobené |
| 🔴 P1 | Cenotvorba: doladiť kalibráciu markup na 0–2 %, nasadiť | Delaja IT | ~90 % |
| 🔴 P2 | SEO reporting: ujasniť „2 xlsx ku každému" a dorobiť | — | čaká na spresnenie |
| 🔴 P2 | SEO pivot: dodať dáta na doplnenie | — | čaká na dáta |
| 🔴 P2 | August cadence porád → do kalendára/Asany | — | návrh hotový |
| 🔴 P2 | Asana filtre: ručne vytvoriť custom fields | — | schéma hotová |
| 🟡 P3 | Appka pre Sam (evidencia fotiek pri nahrávaní) | — | nápad |
| 🟡 P3 | Rozhodnúť cestu Claude certifikácie | Radko | 2 možnosti |

---
*Vygenerované 22.7.2026 z claude.ai exportu (conversations.json). Plné konverzácie v `threads/`.*
