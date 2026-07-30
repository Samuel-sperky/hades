# Benchmark lokálnych modelov — AuraAI

Merané 29. 7. 2026 na cieľovom stroji: **AMD Ryzen 9 9900X** (12C/24T, Zen 5, AVX-512),
**46,9 GB DDR5-4800** dual channel (~60 GB/s), **bez dedikovanej GPU** (iGPU RDNA2 2 CU
je pre LLM nepoužiteľná). Ollama 0.32.5 v Dockeri, kontajner vidí 24 CPU a 22 GB RAM.

Všetko sú **reálne merania**, nie odhady z priepustnosti. Odhady v `02-OTAZKY-150.md`
boli počítané z pamäťovej priepustnosti a pri malých modeloch sú výrazne pesimistické.

---

## 1. Rýchlosť — Qwen3-0.6B

| Metrika | Hodnota |
|---|---|
| Generovanie | **64,1 tok/s** |
| Prefill (spracovanie promptu) | **1 239 tok/s** |
| Celkový čas krátkeho dopytu | 0,80 s |

Prefill je mimoriadne rýchly vďaka AVX-512 na Zen 5 — to je dobrá správa pre RAG,
kde sa do promptu vkladá 10 vybavených uzlov a história.

---

## 2. Presnosť routera zámeru v slovenčine ⚠️ KĽÚČOVÝ NÁLEZ

Testovacia sada: 12 reprezentatívnych otázok pokrývajúcich 6 kategórií
(`shop.orders_count`, `shop.revenue`, `shop.order_detail`, `shop.product_lookup`,
`memory.recall`, `none`), zámerne mix s diakritikou aj bez nej — používateľ píše oboje.

Nastavenie: `think:false`, `format:"json"`, `temperature:0`, few-shot systémový prompt
s vynúteným výstupom `{"intent":"..."}`.

| Model | Veľkosť | Presnosť | Čas/klasifikácia | Verdikt |
|---|---|---|---|---|
| `qwen3:0.6b` | 522 MB | **25 % (3/12)** | 0,71 s | **NEPOUŽITEĽNÝ** |
| `qwen3:1.7b` | 1,4 GB | **92 % (11/12)** | 1,05 s | použiteľný |
| `qwen3:4b` | 2,5 GB | **100 % (12/12)** | 2,32 s | najlepší |

### Prečo 0.6B zlyhal

1. **Je to reasoning model.** Bez `think:false` spálil všetkých 40 povolených tokenov
   na `<think>` blok a pole `response` zostalo **prázdne**. Ollama vracia uvažovanie
   v samostatnom poli `thinking`.
2. Aj s vypnutým myslením **zhodí takmer všetko na `none`** — 9 z 12 otázok. Prvý pokus
   bez vynúteného JSON formátu vrátil doslova `"len"`, teda echo slova z promptu.
3. Zlyhania sú v smere fail-safe (`none` namiesto zlej kategórie), ale výsledok je
   nepoužiteľný: router by nikdy nerozpoznal ani „Koľko objednávok prišlo včera?".

### Dôsledok pre architektúru

Rozhodnutie #104 („iba najmenší Qwen") a #117 (Qwen ako vyhodnocovač) sa v tejto podobe
nedajú naplniť. Návrh sa preto mení takto:

- **Vrstva 1 — deterministický router (POVINNÁ).** Kľúčové slová + regex na čísla
  (`objednávk*`, `obrat`, `produkt \d+`, `detail objednávky (\d+)`). Toto je zdroj pravdy
  a funguje **bez modelu, bez Ollamy, offline**. Pokrýva očakávané formulácie.
- **Vrstva 2 — model ako DOPLNOK, nie rozhodovač.** Zapojí sa len keď deterministický
  router nenájde zhodu. Odporúčaný **`qwen3:1.7b`** (92 %, 1,4 GB — stále tiny model,
  Apache 2.0, free). Keď Ollama nebeží, táto vrstva sa preskočí a appka funguje ďalej.
- **Vrstva 3 — šablónové odpovede.** Čísla a fakty skladá vždy kód z reálnych dát.
  Model nikdy negeneruje čísla.

Ak používateľ trvá na 0.6B, integrácia bude fungovať — len sa vrstva 2 reálne nikdy
neuplatní a všetko odvedie deterministický router.

---

## 3. Embedding modely — SK↔EN zhoda ⚠️ KĽÚČOVÝ NÁLEZ

Recall dnes stojí na **~300 ručne udržiavaných SK↔EN mapovaniach** v
`SimilarityService::$canon`. Embeddingy to majú nahradiť. Test preto meria presne to:
uloží model slovenský a anglický ekvivalent blízko seba?

Metodika: 8 párov z reálnej domény používateľa, ktoré **majú** byť blízke
(šperky/jewelry, cenotvorba/pricing, prepravca/carrier, reklamácia/complaint…),
a 8 párov, ktoré majú byť **vzdialené** (šperky/docker, sklad/markdown…).
Rozhodujúci je rozdiel priemerov a hlavne **prekryv** — počet nezhodných párov,
ktoré skórujú vyššie než najhorší zhodný pár.

| Model | Dim | Zhodné | Nezhodné | Rozdiel | Prekryv | Verdikt |
|---|---:|---:|---:|---:|:--:|---|
| **`bge-m3`** | 1024 | 0,771 | 0,352 | **0,419** | **0/8** | **POUŽITEĽNÝ** |
| `paraphrase-multilingual` | 768 | 0,734 | 0,147 | 0,587 | 1/8 | hraničný |
| `embeddinggemma` | 768 | 0,582 | 0,382 | 0,200 | 1/8 | hraničný |

### Prečo bge-m3, hoci má menší rozdiel priemerov

`paraphrase-multilingual` má väčší priemerný rozdiel, ale **padá práve na doménovej
slovnej zásobe**, ktorá pre tento projekt rozhoduje:

- `cenotvorba a marže` ↔ `pricing and margins` = **0,347**
- `reklamácia` ↔ `complaint claim` = **0,258**

To sú nižšie skóre než niektoré nesúvisiace páry, takže pri jednom prahu by sa miešali.

`bge-m3` má **nulový prekryv** — jeho najhorší zhodný pár stále skóruje vyššie než
všetky nezhodné. Presne to je podmienka, aby sa dal nastaviť jeden prah.

**`multilingual-e5-small` z rozhodnutia #111 nie je v Ollama registri dostupný** —
nahrádza ho `bge-m3` (1,2 GB, MIT licencia, free).

### Varovanie k prahom

Prahy `0.92` (automerge), `0.20` (rewire), `0.08` (prune) a `0.18` (topSimilar) sú
kalibrované na **TF-IDF kosínus**. Škála bge-m3 je úplne iná — jeho nezhodné páry
sedia na 0,352, čo je nad prahom rewire (0,20) aj prune (0,08). Použiť tie isté čísla
by znamenalo, že **prune by nezmazal nič a rewire by prepojil všetko so všetkým**.

Preto platí, čo je v kontrakte: 3 deštruktívne joby zostávajú **vypnuté**, kým
nebudú prahy prekalibrované a dry-run report schválený používateľom.

---

## 4. Odporúčaná konfigurácia

Rozhodnutie používateľa (29. 7. 2026, po predložení meraní): **`qwen3:4b`**.

| Rola | Model | Veľkosť | Dôvod |
|---|---|---|---|
| **Router zámeru** | **`qwen3:4b`** | 2,5 GB | **100 % presnosť v SK** (12/12). 2,32 s je pri jednom dopyte nepostrehnuteľné a deterministický router ho vo väčšine prípadov aj tak preskočí. |
| Embeddingy pre recall | `bge-m3` | 1,2 GB | nulový prekryv na SK↔EN, MIT |
| Zálohy (stiahnuté, nepoužívané) | `qwen3:1.7b`, `qwen3:0.6b` | 1,4 + 0,5 GB | ak by 4b bol niekedy priveľmi pomalý |

Celkovo **~3,7 GB** v RAM pri dvoch aktívnych modeloch (`qwen3:4b` + `bge-m3`) —
WSL limit 22,9 GB sa nemusí zvyšovať, `.wslconfig` sa nemusí vytvárať a 23 kontajnerov
sa nemusí reštartovať. Rozhodnutie #103 („nechať 22,9 GB") tým zostáva v platnosti.

Poznámka k rozhodnutiu #104: pôvodné zadanie znelo „iba najmenší Qwen 0,6b". Meranie ukázalo
25 % presnosť, teda nepoužiteľnosť. Zámer zadania — **žiadny veľký model, všetko free, appka
funguje aj bez modelu** — zostáva naplnený: 2,5 GB je stále tiny trieda, licencia Apache 2.0,
a deterministický router funguje aj s vypnutou Ollamou.

`OLLAMA_KEEP_ALIVE=30m`, `OLLAMA_MAX_LOADED_MODELS=2`.

**Anthropic API sa nepoužíva** (nie je free, rozhodnutie #117). `AnthropicProvider`
zostáva v kóde ako vypnutá a nepovinná vetva.

---

## 5. Ako meranie zreprodukovať

Skripty sú v scratchpade session, ale postup je jednoduchý:

```bash
docker exec auraai-ollama-1 ollama pull qwen3:1.7b
docker exec auraai-ollama-1 ollama pull bge-m3
curl -s http://localhost:11434/api/generate -d '{"model":"qwen3:1.7b","think":false,"format":"json","stream":false,"options":{"temperature":0},"prompt":"..."}'
curl -s http://localhost:11434/api/embed -d '{"model":"bge-m3","input":["šperky","jewelry"]}'
```

Metriky rýchlosti sú v odpovedi: `eval_count / eval_duration` (generovanie),
`prompt_eval_count / prompt_eval_duration` (prefill), obe v nanosekundách.
