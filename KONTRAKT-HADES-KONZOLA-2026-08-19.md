# Kontrakt — Hades: konzola vedomia + optimalizácia + dynamika

**Dátum:** 19. 8. 2026 · **Vetva:** `feat/hades-konzola` (nová, z `feat/mcp-tags-a-uzly-oblasti`)
**Strop:** 3 000 000 tokenov · **Kadencia:** jedno schválenie, potom beh do konca
**Veľkosť:** L (orchestrácia agentov po vlnách)

## 1. Cieľ

Postaviť **konzolu vedomia** — samostatné rozhranie na vlastnej URL, v ktorom sa dá
ovládať AI, ktorá má prístup k Hadesovmu grafu, a ktorá vie robiť reálne úlohy
(hľadať, čítať, upravovať pamäť aj súbory) s Claude-Code-ovským UX. Model beží
**lokálne v Dockeri** (Ollama, CPU-only). Súčasne doladiť Hadesa: rýchlosť API,
kvalitu recallu, výkon grafu, hygienu dát, a zapnúť nové možnosti (embeddings,
decay/teplota, automatické sumáre a prewiring, rozšírené MCP tooly).

## 2. Zistený stav (19. 8. 2026, pred štartom)

- Appka beží (app, caddy, mariadb, redis, reverb, queue, scheduler), logy čisté.
- **Vedomie: 2667 uzlov, 8240 hrán** — CLAUDE.md tvrdí 1065/2882, je zastaralé.
- `/mcp` requesty v logoch trvajú **0,5–3 s**.
- Chat dnes existuje (`ChatController` 238 r., `chat.js` 261 r.), ale je to jedna
  odpoveď bez toolov a `ANTHROPIC_API_KEY` je **prázdny** → chat je mŕtvy.
- **UI okruh je už zavretý** (`auth.ui` + CSRF + session na `/` aj interných
  `/api/*`), Caddyfile berie tajomstvá z `{env.VAR}`. `docs/BEZPECNOST.md` §8 je
  v oboch top rizikách neaktuálny.
- **HW: žiadna dedikovaná GPU** — AMD Radeon iGPU (0,5 GB), Ryzen 9 9900X
  (24 threadov), 46,9 GB RAM, 575 GB voľných. Docker na Windows AMD iGPU
  nepustí → **inferencia čisto na CPU**.
- MariaDB **11.4** → natívny `VECTOR` nie je (od 11.7). `ripgrep` nie je ani na
  hoste, ani v image.

## 3. Schválené rozhodnutia (10 otázok, 19. 8. 2026)

| # | Rozhodnutie |
|---|---|
| 1 | Konzola = **ovládacia konzola AI s vedomím z grafu**, samostatné rozhranie, UX a funkcie ako Claude Code |
| 2 | **Lokálny LLM v Dockeri** (Ollama). Vrstva poskytovateľov je pluggable, Anthropic zostáva ako voliteľný prepínač, ak sa doplní kľúč |
| 3 | Optimalizácia = **všetky štyri**: rýchlosť API, kvalita recallu, výkon grafu, hygiena dát |
| 4 | Nové možnosti = **všetky štyri**: embeddings/semantický recall, decay+teplota+posilňovanie, automatické sumáre a prewiring, rozšírené MCP tooly |
| 5 | Modely: **Qwen3-Coder 30B-A3B (MoE) + Qwen3 8B + embedding model**, prepínanie v UI |
| 6 | Rozhranie: **vlastná URL v tej istej appke** — `/console`, vlákna na `/console/<uuid>` |
| 7 | Tooly: **vedomie + súbory + ripgrep; čítanie voľne, zápisy na potvrdenie** (diff + allow / allow-always / deny). **Bash tool NIE** |
| 8 | Bezpečnosť ako **vlna 0** pred konzolou (po zistení stavu = ochrana novej plochy + fail-closed testy + oprava §8) |
| 9 | **Nová vetva v hlavnom checkoute** (Docker servuje koreň repa, worktree by na 8080 nebolo vidieť) |
| 10 | **Jedno schválenie, potom beh do konca** alebo do stropu; hlásim len zablokovanie a nevratné rozhodnutia |

## 4. Predvolené rozhodnutia (moje, dajú sa zmeniť)

- **Streaming:** SSE na `/api/console/stream` pre tokeny; Reverb WS zostáva pre
  pulzy vedomia. (Dve úlohy, dva kanály — WS by tu pridal stav bez úžitku.)
- **Vektory:** `BLOB` + kosínus v PHP, MariaDB zostáva na 11.4. Pri 2667 uzloch
  je brute-force rýchlejší než riziko upgradu na 11.8.
- **Embedding model:** `bge-m3` — už bol na stroji, je multilingválny a
  1024-rozmerný. Pamäť je písaná po slovensky, takže anglicky trénovaný
  `nomic-embed-text` by tu strácal zmysel.

- **Agentový model: `qwen3:8b`, nie 30B MoE.** Zmerané 19. 8. 2026
  (`scratchpad/bench.js`, CPU, `num_ctx=8192`, temperature 0):

  | model | tok/s | tool-use | poznámka |
  |---|---|---|---|
  | `qwen3:8b` | **9,3** | OK (`query="Docker"`) | čistá slovenská odpoveď, 93 tokenov, 10 s |
  | `qwen3:4b` | 17,1 | OK | ale na dvojvetovú otázku vygeneroval **2626 tokenov** (myslenie presakuje do odpovede), 167 s |
  | `qwen3-coder:30b` | — | — | **nedal prvý token ani za 300 s**; 18,6 GB modelu v 22,9 GB VM swapuje |

  30B zostáva stiahnutý (disk je zadarmo) a je vybrateľný v UI, ale defaultom
  byť nemôže. Aby bol použiteľný, musel by dostať viac RAM v Docker VM
  (`C:\Users\Ucet\.wslconfig` → `memory=34GB` + `wsl --shutdown`) — to je
  **rozhodnutie používateľa**, pretože reštart WSL zhodí všetky jeho kontejnery
  vo všetkých projektoch, nielen Hadesa.
- **Perzistencia vlákien:** tri nové tabuľky (`console_threads`,
  `console_messages`, `console_tool_calls`), migrácia so `mysqldump` zálohou.
- **Hygiena dát:** čistenie beží ako `--dry-run` report; zlučovanie a
  premenovanie autonómne, **mazanie uzlov len s tvojím potvrdením**.
- **ripgrep** do image `docker/php` — nesie tool `grep` v konzole aj hľadanie
  v `.md` súboroch.

## 5. Rozsah — čo ÁNO

**Vlna 0 — Bezpečnosť a základy**
- `/console` + `/api/console/*` pod ten istý `auth.ui` + CSRF okruh; SSE endpoint
  fail-closed bez session.
- Testy: bez tokenu 401, bez CSRF 419, tool endpoint neexistuje bez guardu.
- Prepísať `docs/BEZPECNOST.md` §8 na reálny stav + zdokumentovať tool okruh.
- `ripgrep` do image, `feat/hades-konzola`, `mysqldump` záloha do `backups/`.

**Vlna 1 — Lokálny model a embeddings**
- Služba `ollama` v compose (CPU, named volume `ollamadata`), healthcheck,
  `php artisan mind:models` na stiahnutie a benchmark (tok/s + tool-use).
- `App\Services\Llm`: rozhranie `LlmProvider` + `OllamaProvider` +
  `AnthropicProvider` (recyklovaný existujúci kód), driver v configu.
- Tabuľka embeddingov + `php artisan mind:embed` (backfill 2667 uzlov,
  inkrementálne pri každom `learn`).
- Hybridný recall: kľúčové slová (dnešné skóre) + vektory, fúzia RRF.

**Vlna 2 — Optimalizácia (merateľná, pred/po)**
- Profil `/api/journal`, `/api/dashboard`, `/mcp`; indexy, N+1, cache.
- Kvalita recallu na sade reálnych dopytov (20–30 úloh, pass@k).
- Výkon grafu pri 2667/8240: čas do prvého vykreslenia, plynulosť, nulová
  spotreba mimo obrazovky Graf.
- Hygiena: duplicity, stuby, surové prompty ako labely, siroty, zlé oblasti.

**Vlna 3 — Konzola**
- Backend: `AgentRunner` — tool-use loop, streaming, prerušenie, limity.
- Tooly: `mind_recall`, `mind_read`, `mind_learn`, `mind_rename`, `mind_move`,
  `mind_delete`, `graph_nav`, `read_file`, `glob`, `grep` (ripgrep),
  `edit_file`, `write_file`. Zápisy cez potvrdzovaciu bránu.
- UI `/console`: vlastný layout, stream správ, karty tool callov, diff view,
  permission prompt (allow / allow-always / deny), slash príkazy, prepínač
  modelu, počítadlo tokenov a tok/s, stop, bočný panel vlákien, `/console/<uuid>`.

**Vlna 4 — Dynamika, MCP, kvalitná brána**
- Decay + teplota + posilňovanie (job v scheduleri, teplota nesie žiaru uzla).
- Prewiring cez embeddings (nový uzol sa sám prepojí) + automatické sumáre.
- Rozšírené MCP tooly — **len aditívne**, `mind_recall` payload nemení tvar.
- Celý testovací balík zelený, preklik konzoly v prehliadači so screenshotmi,
  jeden review agent (`effort: high`) vrátane security prehliadky.

## 6. Rozsah — čo NIE

- **Žiadny bash/shell tool** v konzole (vedomé rozhodnutie #7).
- Žiadny upgrade MariaDB, žiadna zmena `/api/v1` kontraktu (payload bit-za-bit).
- Žiadny presun projektu do `C:\Aura\aura-ai` ani rebranding na AuraAI.
- Žiadne mazanie uzlov bez potvrdenia, žiadne plošné reformaty CSS/JS.
- Žiadna GPU akcelerácia (HW ju neumožňuje), žiadny ngrok/deploy krok.
- Žiadny build step pre frontend — konzola je natívne ES moduly, ako graf.

## 7. Akceptačné kritériá

1. `http://localhost:8080/console` beží, odpovedá lokálny Qwen, streamuje tokeny.
2. Konzola vyrieši 5 reálnych úloh end-to-end: nájdi poznatok, oprav odpadový
   label, prepoj dva uzly, nájdi vzor v súboroch cez ripgrep, uprav súbor s diffom.
3. Každý zápisový tool si vyžiada potvrdenie a `deny` ho reálne zastaví (test).
4. **SPLNENÉ.** `mind:recall-bench`, 28 reálnych dopytov zo živej pamäte,
   2672 vektorov (99,9 % korpusu), tri behy s identickým poradím:

   | metrika | kľúčové slová | hybrid (RRF) |
   |---|---|---|
   | pass@1 | 60,7 % | **75,0 %** |
   | pass@3 | 71,4 % | **100 %** |
   | MRR | 0,680 | **0,845** |
   | nenašlo očakávaný uzol | 2 | **0** |
   | latencia medián | 105 ms | 318 ms (+213) |

   Verdikt 11 win / 17 same / **0 loss**. Poctivé zistenie navrch: zdvih
   nepochádza z objavovania lexikálne odlišných uzlov — všetkých 14
   semantic-only zásahov sedí na miestach 6–12 a ani jeden nebol tým správnym.
   Zdvih robí (a) rozšírenie kandidátov za hranicu keyword top-12 a (b) RRF
   preradenie, ktoré zlomí dominanciu „tučných" uzlov. Uzol [793] bol v keyword
   vetve #1 pre tri nesúvisiace dopyty, v hybride pre žiadny.
5. **SPLNENÉ, s korekciou vlastného merania.** Prvý baseline bol nesprávny:
   profiler registroval nový `DB::listen` na každý beh, listener sa nedá
   odregistrovať a closure viaže slot premennej, takže každý ďalší endpoint
   dostal počet dopytov vynásobený počtom dovtedy registrovaných listenerov.
   Skutočné čísla a výsledok po oprave kódu (`--queries` režim profilera,
   teplý beh, živá MariaDB):

   | endpoint | dopytov pred → po | teplý pred → po |
   |---|---|---|
   | `GET /api/mind` | **1099 → 7** | **925 → 244–325 ms** |
   | `GET /api/dashboard` | 12 → 12 | 34 → 18–23 ms |
   | `GET /api/search?q=docker` | 9 → 9 | 62 → 52–64 ms |
   | `GET /api/library` | 3 → 3 | 222 → 150–234 ms |
   | `GET /api/journal` | 3 → 3 | 12 → 11–12 ms |

   Reálny N+1 bol teda **jediný** (graf), nie tri: „96 dopytov" na dashboarde
   bolo 12 a „126" na search bolo 9. Dve z troch nahlásených N+1 nikdy
   neexistovali a boli by sa opravovali naslepo.

   `/api/library` (520 kB) zostáva zámerne: obrazovka Knižnica čítá každé
   posielané pole a nevyužité sú len tagy nad 5-čipovým stropom, teda ~5 kB
   z 520 (1 %). Tučnota je v množstve (1661 kariet bez stránkovania), čo je
   rozhodnutie o UI, nie optimalizácia dopytu.

   Graf vo frontende: `draw()` medián 6,75 → 4,9 ms, p95 12,6 → 8,0 ms
   (hrany −42 %, labely −51 %). **fps sa nezmenilo** a to je poctivý titulok —
   smyčka je vsync-bound a fyzika je dnes väčšia polovica rámca. `rAF` mimo
   obrazovky Graf stojí (0 volaní, 0 kreslení) pred aj po.
6. Graf pri 2667/8240 uzloch/hranách plynulý, mimo obrazovky Graf rAF stojí.
7. Celý balík (dnes 228 testov) zelený, nové testy na konzolu, tooly a embeddings.
8. `auth.ui` chráni aj konzolu — bez session 401, bez CSRF 419 (testy).
9. CLAUDE.md, README, `docs/BEZPECNOST.md` §8 a tento kontrakt aktuálne.

## 8. Otvorené riziká

| Riziko | Prečo hrozí | Ako to riešim |
|---|---|---|
| **CPU-only kvalita** | Bez GPU bude tool-use slabší a pomalší než Claude Code | MoE model (3B aktívnych), benchmark, pluggable provider — Anthropic sa dá zapnúť kľúčom bez prepisovania |
| Qwen tool calling v Ollame | Menšie modely halucinujú tvar argumentov | Striktná validácia argumentov, retry s chybovou správou, tool schémy čo najplochšie |
| Prvý pull 30B (~18 GB) | Dlhý a závislý na sieti | Sťahovanie ako samostatný krok, appka funguje aj kým model nedobehne |
| 2667 embeddingov na CPU | Backfill môže trvať desiatky minút | Dávkovo v queue, inkrementálne, s progresom |
| Zápisové tooly nad pamäťou | Slabý model vie napísať odpad | Potvrdzovacia brána + `noiseOf()` validácia pred zápisom |
| Rast rozsahu | Päť vĺn je veľa | Pri prekročení odhadu o >30 % zastavím a ozvem sa |

## 9. Výsledok

_(dopíše sa po dobehnutí šprintu)_
