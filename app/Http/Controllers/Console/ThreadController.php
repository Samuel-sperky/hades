<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleThread;
use App\Models\Run;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Vlákna konzoly — zoznam, založenie, načítanie, prepnutie modelu, zmazanie.
 *
 * Celý okruh sedí za `auth.ui` + CSRF (§3.3 docs/BEZPECNOST.md) rovnako ako
 * ostatné interné `/api/*`. Vlákno nesie históriu agentového behu vrátane
 * výsledkov toolov, takže čítanie vlákna je čítaním pamäte — nie menej citlivé
 * než `GET /api/mind`.
 */
class ThreadController extends Controller
{
    /**
     * Slovenské hlášky validátora — dôvod je ten istý ako v
     * {@see RunController::MESSAGES}: rozhranie má hovoriť jedným jazykom, a
     * validátor bez tohto poľa vracia anglickú vetu.
     *
     * Klient dnes telo 422 z týchto rout nečíta (`json()` v
     * `public/js/console/http.js` vypíše len stav), takže hláška ide do
     * odpovede „do zásoby" — ale práve preto sa nesmie zabudnúť: keď sa čítanie
     * tela pridá, jazyk už bude sedieť.
     *
     * @var array<string, string>
     */
    private const MESSAGES = [
        'provider.string' => 'Meno poskytovateľa modelu nemá platný tvar.',
        'provider.in' => 'Taký poskytovateľ modelu tu nie je.',
        'model.string' => 'Meno modelu nemá platný tvar.',
        'model.max' => 'Meno modelu presahuje 120 znakov.',
        'title.string' => 'Názov vlákna musí byť text.',
        'title.max' => 'Názov vlákna presahuje 200 znakov.',
        'auto_accept.boolean' => 'Stav brány zápisov musí byť áno alebo nie.',
        'pinned.boolean' => 'Pripnutie vlákna musí byť áno alebo nie.',
        'archived.boolean' => 'Archivácia vlákna musí byť áno alebo nie.',
        'offset.integer' => 'Posun v zozname musí byť celé číslo.',
        'offset.min' => 'Posun v zozname nemôže byť negatívny.',
        'offset.max' => 'Posun v zozname je mimo rozsahu.',
    ];

    /**
     * Strop jednej strany zoznamu. Klient (`THREAD_LIMIT` v
     * `public/js/console/main.js`) ho zrkadlí ako konštantu, takže je to číslo,
     * ktoré sa nesmie meniť ticho — je súčasťou kontraktu, nie detail dopytu.
     */
    public const PAGE = 100;

    /**
     * Zoznam pre bočný panel — bez správ, len to, čo sa vypisuje v riadku.
     *
     * `conversations()` odfiltruje vlákna podagentov: nie sú to konverzácie,
     * `RunController::run` do nich správu odmietne a detail podbehu sa otvára
     * z obrazovky Runy. Pre front zadaní to nie je kozmetika — plocha vyberá
     * vlákno z tohto zoznamu, takže bez filtra by sa dalo zaradiť do poradia
     * zadanie, ktoré server pri odoslaní odmietne, a človek by dostal chybu za
     * niečo, čo mu rozhranie samo ponúklo.
     *
     * **`counts.total` je nad TÝM ISTÝM rozsahom, aký zoznam vracia** — teda nad
     * `conversations()` a vrátane archivovaných. Bez tej rovnosti by „N z M" na
     * ploche lhalo, a lož o počte je horšia než chýbajúci počet (ten istý zákon
     * drží `moreRow()` v `public/js/mind/table.js`). Kto archivované z výpisu
     * skrýva (`/chat`), nesmie `total` použiť ako svojho menovateľa — musí
     * počítať z toho, čo mu naozaj prišlo.
     *
     * Hľadanie a filter modelu sú na oboch plochách **klientské** nad načítaným
     * oknom, takže `total` bez filtrov je jediné číslo, ktoré server vie povedať
     * bez toho, aby tie filtre poznal — a je správne práve v stave bez filtra.
     *
     * `offset` dotiahne ďalšiu stranu. Radenie preto **musí byť úplné** (až po
     * `id`), inak by sa strany prekrývali a to isté vlákno by v raile vyšlo
     * dvakrát.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'offset' => 'sometimes|integer|min:0|max:100000',
        ], self::MESSAGES);

        $threads = ConsoleThread::query()
            ->conversations()
            // Pripnuté navrch — inak by bolo pripnutie tichým no-opom: čip
            // „pripnuté" by v riadku pribudol, ale vlákno by zostalo tam, kde bolo.
            ->orderByRaw('CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END')
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->offset((int) ($data['offset'] ?? 0))
            ->limit(self::PAGE)
            ->get(['uuid', 'title', 'provider', 'model', 'auto_accept', 'last_message_at', 'pinned_at', 'archived_at'])
            ->map(fn (ConsoleThread $t) => [
                'uuid' => $t->uuid,
                'title' => $t->title ?? 'Nové vlákno',
                'provider' => $t->provider,
                'model' => $t->model,
                'auto_accept' => $t->auto_accept,
                'last_message_at' => $t->last_message_at?->toIso8601String(),
                // Boolean, nie timestamp: dátum pripnutia nesie len poradie a to
                // je už zaplatené v radení vyššie. Klient by z neho nič nekreslil.
                'pinned' => $t->pinned_at !== null,
                'archived' => $t->archived_at !== null,
            ]);

        return response()->json([
            'threads' => $threads,
            'counts' => ['total' => ConsoleThread::query()->conversations()->count()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'provider' => 'sometimes|string|in:ollama,anthropic',
            'model' => 'sometimes|nullable|string|max:120',
            'title' => 'sometimes|nullable|string|max:200',
        ], self::MESSAGES);

        $thread = ConsoleThread::create([
            'provider' => $data['provider'] ?? config('hades.console.provider'),
            'model' => $data['model'] ?? null,
            'title' => $data['title'] ?? null,
        ]);

        return response()->json($this->payload($thread), 201);
    }

    public function show(ConsoleThread $thread): JsonResponse
    {
        return response()->json($this->payload($thread));
    }

    /**
     * Prepnutie modelu / poskytovateľa, „auto-accept" na sedenie, pripnutie
     * a archivácia.
     *
     * `pinned` / `archived` prichádzajú ako **boolean a do DB sa píše timestamp**
     * — presne ako v {@see ProjectController::update()}: `null` = nepripnuté,
     * dátum navyše nesie poradie pripnutých. Klient tak nemusí posielať čas a
     * server nemusí veriť tomu, ktorý mu pošle. Preto sa tie dva kľúče do
     * `fill()` nedostanú (stĺpce sa menujú inak) a sadajú sa ručne.
     */
    public function update(Request $request, ConsoleThread $thread): JsonResponse
    {
        $data = $request->validate([
            'provider' => 'sometimes|string|in:ollama,anthropic',
            'model' => 'sometimes|nullable|string|max:120',
            'title' => 'sometimes|nullable|string|max:200',
            'auto_accept' => 'sometimes|boolean',
            'pinned' => 'sometimes|boolean',
            'archived' => 'sometimes|boolean',
        ], self::MESSAGES);

        // Opakované pripnutie čas NEPREPISUJE: poradie pripnutých je poradie
        // pripnutia, nie poradie posledného kliku na už pripnuté vlákno.
        if (array_key_exists('pinned', $data)) {
            $thread->pinned_at = $data['pinned'] ? ($thread->pinned_at ?? now()) : null;
            unset($data['pinned']);
        }

        if (array_key_exists('archived', $data)) {
            $thread->archived_at = $data['archived'] ? ($thread->archived_at ?? now()) : null;
            unset($data['archived']);
        }

        // Bránu zápisov sa vo vlákne PODAGENTA nedá vypnúť touto cestou. `index()`
        // vlákna podagentov nevypisuje (scope `conversations()`), takže z UI sa
        // sem nedostanú — ale uuid podagenta klient POZNÁ: posiela mu ho rámec
        // `agent_wait`, aby vedel, kam poslať `/decide`. Bez tohto riadku by teda
        // stačil jeden PATCH na to, čo `Subagent::start()` a `allow_always`
        // v `AgentRunner` zámerne nepripúšťajú.
        if ($thread->isSubagent()) {
            unset($data['auto_accept']);
        }

        $thread->fill($data)->save();

        return response()->json($this->payload($thread));
    }

    public function destroy(ConsoleThread $thread): JsonResponse
    {
        // správy aj tool cally idú s vláknom (cascadeOnDelete) — vlákno bez nich
        // by bola len prázdna hlavička v paneli
        $thread->delete();

        return response()->json(['deleted' => true]);
    }

    /** Vlákno s celou históriou — presne to, čo konzola potrebuje na obnovu. */
    private function payload(ConsoleThread $thread): array
    {
        $thread->load(['messages' => fn ($q) => $q->orderBy('id'), 'toolCalls' => fn ($q) => $q->orderBy('id')]);

        $payload = [
            'uuid' => $thread->uuid,
            'title' => $thread->title ?? 'Nové vlákno',
            'provider' => $thread->provider,
            'model' => $thread->model,
            'auto_accept' => $thread->auto_accept,
            // Ten istý tvar ako v `index()` — a je to práve odpoveď na `PATCH
            // {pinned:true}`, takže klient si nový stav nemusí domýšľať z toho,
            // čo poslal.
            'pinned' => $thread->pinned_at !== null,
            'archived' => $thread->archived_at !== null,
            // Systémová správa sa NEPOSIELA. Je to konfigurácia behu (systémový
            // prompt, ktorý `AgentRunner` zapíše raz na vlákno), nie krok
            // konverzácie — a klient ju vypisoval ako 1 370-znakovú bublinu
            // „Charón" medzi otázkou a odpoveďou, takže obnovené vlákno
            // NEVYZERALO ako to, ktoré človek videl. Filtruje sa tu a nie v UI:
            // interná pamäť vlákna nemá dôvod opustiť server. `history()`
            // v AgentRunneri si ju čítá z DB sama, takže model o nič neprichádza.
            'messages' => $thread->messages->reject(fn ($m) => $m->role === 'system')->map(fn ($m) => array_filter([
                'id' => $m->id,
                'role' => $m->role,
                'content' => $m->content,
                'model' => $m->model,
                'stop_reason' => $m->stop_reason,
                'tokens_out' => $m->tokens_out,
                'tokens_per_second' => $m->tokensPerSecond(),
                // `values()` je povinné: `reject()` drží pôvodné kľúče a
                // `all()` by z poľa správ urobil JSON OBJEKT s dierami v
                // indexoch, takže `data.messages.forEach` na klientovi by
                // spadol na `undefined`.
            ], fn ($v) => $v !== null))->values()->all(),
            'tool_calls' => $thread->toolCalls->map(fn ($c) => array_filter([
                'id' => $c->id,
                'message_id' => $c->message_id,
                'name' => $c->name,
                'arguments' => $c->arguments,
                'status' => $c->status,
                'result' => $c->result,
                'error' => $c->error,
                'preview' => $c->preview,
                'duration_ms' => $c->duration_ms,
            ], fn ($v) => $v !== null))->all(),
            // beh, ktorý čaká na rozhodnutie — klient podľa toho vykreslí prompt
            'awaiting' => $thread->pendingToolCall()?->id,
            'runs' => $this->runs($thread),
            'usage' => $this->usage($thread),
        ];

        // Kľúč sa pridáva len keď je čo rozhodnúť — prázdne polia sa neposielajú,
        // takže klient nerozlišuje `null` od „nie je", a vlákna bez podagentov
        // (teda takmer všetky) neplatia za funkciu, ktorá sa ich netýka.
        $awaitingAgent = $this->awaitingAgent($thread);

        if ($awaitingAgent !== null) {
            $payload['awaiting_agent'] = $awaitingAgent;
        }

        return $payload;
    }

    /**
     * Zaparkovaný zápis podagenta — **aditívny** kľúč `awaiting_agent`.
     *
     * `awaiting` sa nemení. Čítajú ho tri plochy (`/console`, `/chat`, dok nad
     * grafom) a zmena jeho tvaru by ich rozišla, takže ďalej hlási
     * `pendingToolCall()` TOHTO vlákna — pri zaparkovanom dieťati je to
     * `spawn_agent` call rodiča. `awaiting_agent` k nemu dopovie to, čo z payloadu
     * rodiča dovtedy nešlo zistiť vôbec: kam rozhodnutie patrí.
     *
     * Tvar je zámerne tvar tool callu (`id`, `name`, `arguments`, `preview`) plus
     * `thread`, pretože presne to isté nesie za živého behu rámec `agent_wait`
     * (`child_call` → `id`, `thread` → `thread`). Klient tak po obnove stránky
     * skladá tú istú kartu brány z tých istých kľúčov a `POST /api/console/decide`
     * pošle na vlákno DIEŤAŤA.
     *
     * `run` je uuid podbehu a nie je to ozdoba: po obnove stránky je klientská mapa
     * vlákien podagentov prázdna (plnia ju rámce `agent_start`), takže bez neho
     * karta nevie, že rozhodnutie patrí podagentovi — a ponúkla by „Povoliť vždy",
     * ktoré `AgentRunner` vo vlákne podagenta zámerne ignoruje. Tlačidlo, ktoré nič
     * neurobí, je horšie než žiadne.
     *
     * `parent_call` tu NIE JE: je to `awaiting`, a druhá kópia tej istej pravdy sa
     * rozíde pri prvej zmene.
     *
     * @return array<string, mixed>|null
     */
    private function awaitingAgent(ConsoleThread $thread): ?array
    {
        $parked = $thread->parkedSubagentWrite();

        if ($parked === null) {
            return null;
        }

        return array_filter([
            // Vlákno podagenta. Zoznam vlákien ho nevypisuje (scope
            // `conversations()`) a `RunController::run` doňho správu odmietne —
            // toto je jediná cesta, ako sa oň klient dozvie, a jediné, čo je naň
            // povolené, je rozhodnutie.
            'thread' => $parked['thread']->uuid,
            'run' => $parked['run']->uuid,
            'id' => $parked['call']->id,
            'name' => $parked['call']->name,
            'arguments' => $parked['call']->arguments,
            'preview' => $parked['call']->preview,
        ], fn ($v) => $v !== null);
    }

    /**
     * Log behov tohto vlákna — dôvod ukončenia a cena každého ťahu.
     *
     * Prečo to ide z tabuľky `runs` a nie z rámcov, ktoré si klient pamätá:
     * dôvod ukončenia, počet krokov a spotreba majú mať JEDEN zdroj. Klient si
     * ich do 20. 8. 2026 držal len v `C.stats` / `C.step`, takže po obnove
     * stránky boli prázdne (A21) a ťah zrezaný stropom krokov vyzeral po F5
     * presne ako dokončená odpoveď (A16). Keby sa to dopočítalo druhýkrát
     * v prehliadači, dve kópie tej istej pravdy sa rozídu pri prvej zmene
     * agregácie v {@see \App\Services\Console\RunRecorder::aggregate()}.
     *
     * Rozsah `from_message_id`–`to_message_id` sa posiela zámerne: je to jediné,
     * čím klient priradí beh k správe v toku bez toho, aby si `runs` musel
     * dotiahnuť druhým dopytom.
     *
     * @return array<int, array<string, mixed>>
     */
    private function runs(ConsoleThread $thread): array
    {
        return Run::query()
            ->where('thread_id', $thread->id)
            ->orderBy('id')
            ->get([
                'uuid', 'status', 'stop_reason', 'error', 'steps', 'tool_calls',
                'tokens_in', 'tokens_out', 'tokens_per_second', 'duration_ms',
                'from_message_id', 'to_message_id',
            ])
            ->map(fn (Run $run) => array_filter([
                'uuid' => $run->uuid,
                'status' => $run->status,
                'stop_reason' => $run->stop_reason,
                'error' => $run->error,
                'steps' => $run->steps,
                'tool_calls' => $run->tool_calls,
                'tokens_in' => $run->tokens_in,
                'tokens_out' => $run->tokens_out,
                'tokens_per_second' => $run->tokens_per_second,
                'duration_ms' => $run->duration_ms,
                'from_message_id' => $run->from_message_id,
                'to_message_id' => $run->to_message_id,
                // Prázdne polia sa nevynechávajú kvôli estetike: klient rozlišuje
                // „beh nemá dôvod ukončenia" od „dôvod je end_turn", a `null`
                // v JSONe je 20 B za nulovú informáciu na každom behu.
            ], fn ($v) => $v !== null))
            ->all();
    }

    /**
     * Spotreba celého vlákna — súčet nad logom behov, nie nad správami.
     *
     * Sčítava sa v SQL a nie na klientovi: `/cost` v palete príkazov a hlavička
     * majú hovoriť to isté číslo ako obrazovka Runy, a to je práve to číslo,
     * ktoré drží `runs`.
     *
     * @return array<string, int|float|null>
     */
    private function usage(ConsoleThread $thread): array
    {
        $totals = Run::query()
            ->where('thread_id', $thread->id)
            ->selectRaw('COUNT(*) as runs, SUM(tokens_in) as tin, SUM(tokens_out) as tout, SUM(duration_ms) as ms, SUM(steps) as steps')
            ->first();

        return [
            'runs' => (int) ($totals?->runs ?? 0),
            'tokens_in' => $totals?->tin !== null ? (int) $totals->tin : 0,
            'tokens_out' => $totals?->tout !== null ? (int) $totals->tout : 0,
            'duration_ms' => $totals?->ms !== null ? (int) $totals->ms : 0,
            'steps' => $totals?->steps !== null ? (int) $totals->steps : 0,
        ];
    }
}
