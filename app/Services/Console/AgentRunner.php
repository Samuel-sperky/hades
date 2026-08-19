<?php

namespace App\Services\Console;

use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Services\Llm\LlmException;
use App\Services\Llm\LlmProvider;
use App\Services\Llm\LlmResponse;
use App\Services\Llm\LlmToolCall;
use App\Services\Llm\ProviderFactory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Agentová smyčka konzoly — jeden ťah modelu s toolmi, a jeho obnova po tom, čo
 * človek povolil zápis.
 *
 * ── Prečo callback a nie generátor ──────────────────────────────────────────
 *
 * Rámce sa vydávajú cez `$emit`, nie `yield`. Text priteká z poskytovateľa cez
 * callback `$onDelta` volaný zvnútra čítania HTTP streamu a z callbacku sa
 * `yield` spraviť nedá. Generátor by musel deltá najprv nasypať do fronty a
 * vydať ich až po dokončení kroku — teda po minútach na CPU inferencii, čo je
 * presne to jedno, čo konzola robiť nesmie. `$emit` ide priamo do socketu.
 *
 * ── Dvojfázový beh ─────────────────────────────────────────────────────────
 *
 * Zápisový tool ťah NEZASTAVÍ s držaným spojením. Uloží sa ako `pending` riadok,
 * vydá sa rámec `permission` a ťah SKONČÍ bez `end`. Rozhodnutie prichádza
 * ďalším requestom do {@see self::resume()}. Blokujúce čakanie by držalo jedného
 * z ôsmich PHP workerov na neurčito.
 *
 * ── História je v DB, nie v requeste ───────────────────────────────────────
 *
 * Každý krok skladá správy pre model z `console_messages` a `console_tool_calls`
 * nanovo. Keby smyčka verila tomu, čo poslal prehliadač, klient by si vedel
 * prepísať vlastnú minulosť a podstrčiť modelu výsledok toolu, ktorý nikdy
 * nenastal — a tie tooly zapisujú do pamäte aj do súborov.
 *
 * Výsledky toolov sa NEUKLADAJÚ ako správy s rolou `tool`: `console_messages`
 * nemá stĺpce `tool_call_id` ani `tool_name`, takže z nich nemá čo poskladať
 * párovanie tool_use ↔ tool_result. Zdrojom je `console_tool_calls`, ktorý oba
 * údaje má — jeden zápis, jedna pravda.
 */
final class AgentRunner
{
    public const DECISION_ALLOW = 'allow';

    public const DECISION_ALLOW_ALWAYS = 'allow_always';

    public const DECISION_DENY = 'deny';

    /** Ťah skončil na strope kôl, nie rozhodnutím modelu. */
    public const STOP_MAX_STEPS = 'max_steps';

    /**
     * Strop na dĺžku `result` v rámci `tool_result`. V DB zostáva výsledok celý;
     * do prehliadača ho režeme, lebo ripgrep nad týmto repom vie vrátiť 20 kB a
     * tie by sa v toku správ aj tak nedali čítať.
     */
    private const RESULT_FRAME_CAP = 4000;

    /** Stavy, po ktorých má tool call výsledok pre model (aj zamietnutie je výsledok). */
    private const SETTLED = ['done', 'failed', 'denied'];

    public function __construct(
        private readonly ProviderFactory $providers,
        private readonly SystemPrompt $prompt,
        private readonly ToolRegistry $registry,
    ) {}

    /**
     * Jeden ťah: uloží správu človeka a beží smyčkou, kým model nedohovorí, kým
     * nenarazí na strop kôl, alebo kým si nevyžiada povolenie na zápis.
     *
     * @param  callable(array<string, mixed>): void  $emit  vydá jeden rámec protokolu
     * @param  (callable(): bool)|null  $aborted  klient odišiel (Stop / zatvorená stránka)
     * @param  array{provider?: string|null, model?: string|null}  $options
     */
    public function run(ConsoleThread $thread, string $message, callable $emit, ?callable $aborted = null, array $options = []): void
    {
        $aborted ??= static fn (): bool => false;

        ConsoleMessage::create([
            'thread_id' => $thread->id,
            'role' => 'user',
            'content' => $message,
        ]);

        // Titulok z prvej vety človeka — model sa naň nepýta, na CPU by to bola
        // sekunda čakania za kozmetiku (viď ConsoleThread::titleFrom()).
        $thread->title = $thread->title ?: $thread->titleFrom($message);
        $thread->last_message_at = now();
        $this->rememberChoice($thread, $options);
        $thread->save();

        $this->guarded($emit, function () use ($thread, $emit, $aborted, $options): void {
            $system = $this->systemPrompt($thread);
            $provider = $this->providers->make($options['provider'] ?? $thread->provider);
            $model = $this->chosenModel($thread, $options);

            $placeholder = $this->openAssistant($thread, $emit, $provider, $model);

            $this->drive($thread, $provider, $model, $system, $emit, $aborted, $placeholder);
        });
    }

    /**
     * Obnova ťahu zaparkovaného na povolení. Rozhodnutie sa aplikuje na jeden
     * tool call a smyčka pokračuje tam, kde stála.
     *
     * `deny` nie je chyba a nie je ticho: modelu sa vráti výsledok „človek to
     * zamietol", aby skúsil inú cestu namiesto toho istého zápisu znova.
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @param  (callable(): bool)|null  $aborted
     * @param  array{provider?: string|null, model?: string|null}  $options
     */
    public function resume(ConsoleThread $thread, ConsoleToolCall $call, string $decision, callable $emit, ?callable $aborted = null, array $options = []): void
    {
        $aborted ??= static fn (): bool => false;

        if (! $call->isPending()) {
            $emit(['t' => 'error', 'message' => 'O tomto tool calle už rozhodnutie padlo.']);

            return;
        }

        $this->guarded($emit, function () use ($thread, $call, $decision, $emit, $aborted, $options): void {
            $system = $this->systemPrompt($thread);
            $provider = $this->providers->make($options['provider'] ?? $thread->provider);
            $model = $this->chosenModel($thread, $options);

            $placeholder = $this->openAssistant($thread, $emit, $provider, $model);

            if ($decision === self::DECISION_ALLOW_ALWAYS) {
                $this->rememberAllowance($thread, $call);
            }

            if ($decision === self::DECISION_DENY) {
                $this->denyCall($call, $emit);
            } else {
                $call->decided_at = now();
                $this->executeCall($call, true, $emit);
            }

            // Ostatné tooly toho istého kroku čakali vo fronte za tým, o ktorom
            // sa práve rozhodlo. Ďalší zápis v nej ťah zaparkuje znova.
            $queue = ConsoleToolCall::query()
                ->where('thread_id', $thread->id)
                ->where('message_id', $call->message_id)
                ->where('id', '>', $call->id)
                ->where('status', 'pending')
                ->orderBy('id')
                ->get();

            if ($this->drain($thread, $queue, $emit, $aborted)) {
                $this->dropUnused($placeholder);

                return;
            }

            $thread->last_message_at = now();
            $thread->save();

            $this->drive($thread, $provider, $model, $system, $emit, $aborted, $placeholder);
        });
    }

    // ---- smyčka ------------------------------------------------------------

    /**
     * Kolá smyčky. Vracia sa buď rámcom `end`, alebo zaparkovaním na `permission`
     * (a to bez `end` — tak je protokol napísaný).
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @param  callable(): bool  $aborted
     */
    private function drive(
        ConsoleThread $thread,
        LlmProvider $provider,
        ?string $model,
        string $system,
        callable $emit,
        callable $aborted,
        ConsoleMessage $placeholder,
    ): void {
        $maxSteps = max(1, (int) config('hades.console.max_steps', 12));
        $tools = $this->registry->definitions();

        // Prvý krok dopíše do bubliny, ktorú klient dostal v rámci `start`;
        // ďalšie kroky si otvoria vlastnú správu, medzi nimi sedia tool karty.
        $assistant = $placeholder;

        $tokensIn = 0;
        $tokensOut = 0;
        $evalMs = 0;

        for ($step = 1; $step <= $maxSteps; $step++) {
            if ($aborted()) {
                $this->dropUnused($assistant);

                return;
            }

            $emit(['t' => 'step', 'n' => $step, 'of' => $maxSteps]);

            $assistant ??= $this->newAssistant($thread);
            $text = '';

            try {
                $response = $provider->stream(
                    $this->history($thread),
                    array_filter([
                        'system' => $system,
                        'tools' => $tools,
                        'model' => $model,
                        // Qwen3 je hybridný model a bez tohto myslí nahlas do
                        // `message.thinking`, ktoré parser zahodí. Zmerané na tomto
                        // stroji: 231 z 309 vygenerovaných tokenov skončilo v koši a
                        // človek čakal 25 s na prvý viditeľný znak. Ten istý správny
                        // tool call s `think=false` stál 34 tokenov namiesto 254 —
                        // pri 8 tok/s na CPU je to rozdiel medzi použiteľným a nie.
                        'think' => config('hades.console.think'),
                    ], static fn ($v) => $v !== null && $v !== []),
                    function (string $delta) use (&$text, $emit, $aborted): void {
                        $text .= $delta;

                        // Stop sa musí prejaviť UPROSTRED generovania, nie až po
                        // ňom: dogenerovať ťah do zavretého socketu je na CPU aj
                        // niekoľko minút práce, ktorú nikto neuvidí.
                        if ($aborted()) {
                            throw new RunAborted;
                        }

                        $emit(['t' => 'delta', 'text' => $delta]);
                    },
                );
            } catch (RunAborted) {
                // to, čo model dovtedy povedal, patrí do histórie — človek to videl
                $this->closeAssistant($assistant, $text, null, $model);

                return;
            }

            $this->closeAssistant($assistant, $response->text !== '' ? $response->text : $text, $response, $model);

            $tokensIn += $response->tokensIn;
            $tokensOut += $response->tokensOut;
            $evalMs += $response->evalDurationMs ?? $response->durationMs;

            if (! $response->hasToolCalls()) {
                $emit($this->endFrame($response->stopReason, $tokensIn, $tokensOut, $evalMs));

                return;
            }

            $queue = $this->enqueue($thread, $assistant, $response->toolCalls);
            $assistant = null;

            if ($this->drain($thread, $queue, $emit, $aborted)) {
                return;
            }
        }

        // Strop existuje preto, že model vie zacykliť dvojicu „hľadaj → prečítaj"
        // a spáliť hodinu CPU. Ťah sa uzavrie, vlákno zostane použiteľné.
        $emit($this->endFrame(self::STOP_MAX_STEPS, $tokensIn, $tokensOut, $evalMs));
    }

    /**
     * Prevedie smyčku aj cez zlyhanie tak, aby ťah vždy skončil práve jedným
     * rámcom `end` alebo `error`. Text výnimky ide do logu, klientovi ide veta
     * po slovensky — rovnako ako to robí ChatController.
     *
     * @param  callable(array<string, mixed>): void  $emit
     */
    private function guarded(callable $emit, callable $body): void
    {
        try {
            $body();
        } catch (LlmException $e) {
            // Tieto výnimky sú napísané pre človeka (chýba kľúč, nebeží Ollama)
            // a nesú návod, takže ich text posielame — nie je to stack trace.
            Log::error('Console run failed', ['e' => $e->getMessage()]);

            $emit(['t' => 'error', 'message' => $e->getMessage()]);
        } catch (Throwable $e) {
            Log::error('Console run crashed', ['e' => $e->getMessage(), 'at' => $e->getFile().':'.$e->getLine()]);

            $emit(['t' => 'error', 'message' => 'Beh spadol. Detail je v logu appky.']);
        }
    }

    // ---- tooly -------------------------------------------------------------

    /**
     * Uloží VŠETKY tool cally kroku ako `pending` a v tom poradí, v akom ich model
     * vyžiadal.
     *
     * Prečo aj tie čítacie, ktoré sa vykonajú hneď: keď je druhý z troch toolov
     * zápisový, ťah sa na ňom zaparkuje a tretí musí prežiť do obnovy. Bez toho
     * by sa stratil a v histórii by zostal `tool_use` bez `tool_result` — čo
     * Anthropic odmietne a Ollamu zmätie.
     *
     * @param  list<LlmToolCall>  $calls
     * @return Collection<int, ConsoleToolCall>
     */
    private function enqueue(ConsoleThread $thread, ConsoleMessage $assistant, array $calls): Collection
    {
        return collect($calls)->map(fn (LlmToolCall $call) => ConsoleToolCall::create([
            'thread_id' => $thread->id,
            'message_id' => $assistant->id,
            // Ollama id tool callu nemusí poslať; bez neho sa výsledok nemá k čomu
            // spárovať, tak si ho pomenujeme sami.
            'call_id' => $call->id !== '' ? $call->id : 'call_'.Str::random(8),
            'name' => $call->name,
            'arguments' => $call->arguments,
            'status' => 'pending',
        ]));
    }

    /**
     * Odpracuje frontu tool callov. Vracia `true`, keď ťah zaparkovala na
     * povolení — volajúci sa v tom prípade musí vrátiť BEZ rámca `end`.
     *
     * @param  Collection<int, ConsoleToolCall>  $queue
     * @param  callable(array<string, mixed>): void  $emit
     * @param  callable(): bool  $aborted
     */
    private function drain(ConsoleThread $thread, Collection $queue, callable $emit, callable $aborted): bool
    {
        foreach ($queue as $call) {
            if ($aborted()) {
                return true;
            }

            // Halucinované meno toolu nie je pád behu ani dôvod pýtať sa človeka:
            // `ToolRegistry::isWrite()` je pri neznámom mene fail-closed (`true`),
            // ale vykonať sa nemá čo — `call()` vráti odmietnutie so zoznamom
            // toolov, ktoré model má, a on si z nich vyberie.
            $write = $this->registry->has($call->name) && $this->registry->isWrite($call->name);

            if ($write && ! $this->preapproved($thread, $call)) {
                $call->preview = $this->registry->preview($call->name, $call->arguments ?? []);
                $call->save();

                $emit([
                    't' => 'permission',
                    'id' => $call->id,
                    'name' => $call->name,
                    'arguments' => $call->arguments ?? [],
                    'preview' => $call->preview,
                ]);

                return true;
            }

            $this->executeCall($call, $write, $emit);
        }

        return false;
    }

    /**
     * Vykoná tool a vydá jeho dvojicu rámcov.
     *
     * Bez `try`: {@see ToolRegistry::call()} nehodí výnimku nikdy a aj zlyhanie
     * prekladá na `ToolResult` s vetou, z ktorej sa model odrazí. Vlastný `catch`
     * by tú vetu len prepísal na horšiu.
     *
     * @param  callable(array<string, mixed>): void  $emit
     */
    private function executeCall(ConsoleToolCall $call, bool $write, callable $emit): void
    {
        $call->status = 'running';
        $call->save();

        $emit([
            't' => 'tool',
            'id' => $call->id,
            'call_id' => $call->call_id,
            'name' => $call->name,
            'arguments' => $call->arguments ?? [],
            'write' => $write,
        ]);

        $result = $this->registry->call($call->name, $call->arguments ?? []);

        $display = $result->text;
        $status = $result->failed ? 'failed' : 'done';
        $ms = $result->durationMs ?? 0;

        $call->status = $status;
        $call->duration_ms = $ms;

        if ($status === 'failed') {
            $call->error = $display;
        } else {
            $call->result = $display;
        }

        $call->save();

        $emit([
            't' => 'tool_result',
            'id' => $call->id,
            'status' => $status,
            'result' => $this->clip($display),
            'duration_ms' => $ms,
        ]);
    }

    /**
     * Smie sa tento zápis vykonať bez otázky?
     *
     * Dve cesty a je dôležité, že sú dve:
     *  • `auto_accept` — plošné povolenie vlákna, ako doteraz;
     *  • úzke povolenie na jeden kľúč toolu ({@see Tools\NarrowsAllowance}).
     *
     * Bez tej druhej cesty by „povoliť vždy" pri `bash` muselo zapnúť `auto_accept`
     * — a jedno kliknutie pri `php artisan test` by v tom vlákne povolilo aj
     * `mind_delete`. Preto sa pri tooloch s úzkym kľúčom `auto_accept` NEZAPÍNA
     * (viď {@see self::rememberAllowance()}).
     */
    private function preapproved(ConsoleThread $thread, ConsoleToolCall $call): bool
    {
        $narrow = $this->registry->narrowsAllowance($call->name);

        // Plošné `auto_accept` NEPLATÍ na tool, ktorý si vyžaduje úzky kľúč.
        //
        // Bez tejto podmienky sa celé zúženie dalo vypnúť z druhej strany: človek
        // klikne „Povoliť vždy" na `mind_learn`, tým sa zapne `auto_accept` na
        // vlákno, a od tej chvíle by sa v ňom vykonal KAŽDÝ príkaz shellu bez
        // jediného potvrdenia. Presne ten scenár, proti ktorému
        // {@see Tools\NarrowsAllowance} vznikla, len opačným smerom — a dosiahnuteľný
        // aj programovo, lebo `PATCH /api/console/cli/threads/{uuid}` prijíma
        // `auto_accept`. Našiel to review 19. 8. 2026 a overil reflexiou.
        if ($thread->auto_accept && ! $narrow) {
            return true;
        }

        $key = $this->registry->allowanceKey($call->name, $call->arguments ?? []);

        return $key !== null && $thread->allowsTool($call->name, $key);
    }

    /**
     * Zapíše rozhodnutie „povoliť vždy".
     *
     * Tool s úzkym kľúčom dostane povolenie len na ten kľúč; ostatné zostávajú pri
     * plošnom `auto_accept`, aby sa nezmenilo správanie, ktoré už existuje a je
     * otestované. Keď sa kľúč nedá vypočítať (chýbajúci argument), NEPOVOLÍ SA NIČ
     * — fail-closed: ďalší taký call sa spýta znova, čo je otrava, nie diera.
     */
    private function rememberAllowance(ConsoleThread $thread, ConsoleToolCall $call): void
    {
        $key = $this->registry->allowanceKey($call->name, $call->arguments ?? []);

        if ($key === null) {
            if (! $this->registry->narrowsAllowance($call->name)) {
                $thread->auto_accept = true;
                $thread->save();
            }

            return;
        }

        $thread->allowTool($call->name, $key);
        $thread->save();
    }

    /** @param  callable(array<string, mixed>): void  $emit */
    private function denyCall(ConsoleToolCall $call, callable $emit): void
    {
        $message = 'Používateľ tento zápis zamietol. Neopakuj ho — pokračuj inak alebo sa spýtaj.';

        $call->status = 'denied';
        $call->result = $message;
        $call->decided_at = now();
        $call->duration_ms = 0;
        $call->save();

        $emit([
            't' => 'tool_result',
            'id' => $call->id,
            'status' => 'denied',
            'result' => $message,
            'duration_ms' => 0,
        ]);
    }

    // ---- história a správy -------------------------------------------------

    /**
     * Správy pre model — z databázy, z okna posledných `history_window` replík.
     *
     * Okno počíta len repliky človeka a modelu; výsledky toolov visia na svojej
     * správe asistenta a idú s ňou. Keby sa okno počítalo aj cez ne, jeden dlhý
     * tool chain by z kontextu vytlačil otázku, na ktorú model odpovedá.
     *
     * @return list<array<string, mixed>>
     */
    private function history(ConsoleThread $thread): array
    {
        $window = max(2, (int) config('hades.console.history_window', 20));

        $rows = $thread->messages()
            ->whereIn('role', ['user', 'assistant'])
            ->orderByDesc('id')
            ->limit($window)
            ->get()
            ->reverse()
            ->values();

        $calls = ConsoleToolCall::query()
            ->where('thread_id', $thread->id)
            ->whereIn('message_id', $rows->pluck('id')->all())
            ->orderBy('id')
            ->get()
            ->groupBy('message_id');

        $messages = [];

        foreach ($rows as $row) {
            if ($row->role === 'user') {
                $messages[] = ['role' => 'user', 'content' => (string) $row->content];

                continue;
            }

            // Nedorozhodnuté tool cally sa vynechajú spolu s ich výsledkom —
            // `tool_use` bez `tool_result` je pre Anthropic neplatná história.
            $settled = $calls->get($row->id, collect())
                ->filter(fn (ConsoleToolCall $c) => in_array($c->status, self::SETTLED, true))
                ->values();

            $content = (string) $row->content;

            // rozpísaná bublina, do ktorej krok ešte nič nezapísal
            if ($content === '' && $settled->isEmpty()) {
                continue;
            }

            $assistant = ['role' => 'assistant', 'content' => $content];

            if ($settled->isNotEmpty()) {
                $assistant['tool_calls'] = $settled
                    ->map(fn (ConsoleToolCall $c) => ['id' => $c->call_id, 'name' => $c->name, 'arguments' => $c->arguments ?? []])
                    ->all();
            }

            $messages[] = $assistant;

            foreach ($settled as $call) {
                $messages[] = [
                    'role' => 'tool',
                    'tool_call_id' => $call->call_id,
                    'tool_name' => $call->name,
                    'content' => (string) ($call->result ?? $call->error ?? 'Tool nevrátil nič.'),
                ];
            }
        }

        // Anthropic odmietne históriu, ktorá nezačína človekom; okno vie odrezať
        // presne tak, že prvá zostane odpoveď modelu.
        while ($messages !== [] && $messages[0]['role'] !== 'user') {
            array_shift($messages);
        }

        return $messages;
    }

    /**
     * Bublina, do ktorej pôjdu deltá, plus rámec `start`.
     *
     * Prečo správa vzniká PRED prvým tokenom: `start` nesie `message_id` a klient
     * si podľa neho bubliny páruje. Model na CPU mlčí aj desiatky sekúnd, takže
     * čakať s `start` na prvý token by znamenalo prázdnu obrazovku bez stavu.
     *
     * @param  callable(array<string, mixed>): void  $emit
     */
    private function openAssistant(ConsoleThread $thread, callable $emit, LlmProvider $provider, ?string $model): ConsoleMessage
    {
        $placeholder = $this->newAssistant($thread);

        $emit([
            't' => 'start',
            'message_id' => $placeholder->id,
            // Meno modelu je tu ešte len z konfigurácie; po ťahu ho prepíše to,
            // čo naozaj odpovedalo (Ollama vracia svoj tag v odpovedi).
            'model' => $model ?? $this->defaultModel($provider->name()),
            'provider' => $provider->name(),
        ]);

        return $placeholder;
    }

    private function newAssistant(ConsoleThread $thread): ConsoleMessage
    {
        return ConsoleMessage::create([
            'thread_id' => $thread->id,
            'role' => 'assistant',
            'content' => '',
        ]);
    }

    /** Dopíše bublinu tým, čo model povedal, aj s cenou ťahu (tok/s sa počíta z tohto). */
    private function closeAssistant(ConsoleMessage $assistant, string $text, ?LlmResponse $response, ?string $model): void
    {
        $assistant->content = $text;
        $assistant->model = $response?->model ?: ($model ?? $assistant->model);
        $assistant->stop_reason = $response?->stopReason;
        $assistant->tokens_in = $response?->tokensIn;
        $assistant->tokens_out = $response?->tokensOut;
        $assistant->duration_ms = $response?->evalDurationMs ?? $response?->durationMs;
        $assistant->save();
    }

    /**
     * Zahodí bublinu, do ktorej sa nikdy nič nenapísalo — stane sa to vtedy, keď
     * obnova hneď narazí na ďalšie povolenie. Prázdna správa v histórii by bola
     * bublina bez textu v UI a šum v kontexte modelu.
     */
    private function dropUnused(?ConsoleMessage $assistant): void
    {
        if ($assistant !== null && (string) $assistant->content === '' && $assistant->stop_reason === null) {
            $assistant->delete();
        }
    }

    // ---- drobnosti ---------------------------------------------------------

    /**
     * Smernica sa skladá pri každom ťahu nanovo (nesie dnešný dátum), ale do
     * histórie sa uloží raz — aby staré vlákno zostalo čitateľné s tou, s ktorou
     * reálne začalo. Do modelu ide vždy tá čerstvá; `history()` rolu `system`
     * zámerne nečíta.
     */
    private function systemPrompt(ConsoleThread $thread): string
    {
        $system = $this->prompt->build();

        if (! $thread->messages()->where('role', 'system')->exists()) {
            ConsoleMessage::create([
                'thread_id' => $thread->id,
                'role' => 'system',
                'content' => $system,
            ]);
        }

        return $system;
    }

    /** Vlákno si pamätá, na čom bežalo — prepnutie modelu v requeste je zmena vlákna. */
    private function rememberChoice(ConsoleThread $thread, array $options): void
    {
        if (($options['provider'] ?? null) !== null) {
            $thread->provider = $options['provider'];
        }

        if (($options['model'] ?? null) !== null) {
            $thread->model = $options['model'];
        }
    }

    private function chosenModel(ConsoleThread $thread, array $options): ?string
    {
        $model = $options['model'] ?? $thread->model;

        return is_string($model) && trim($model) !== '' ? trim($model) : null;
    }

    /** Len na vypísanie v rámci `start`; poskytovateľ si default rieši sám. */
    private function defaultModel(string $provider): string
    {
        return (string) (config("hades.console.{$provider}.model") ?? config('hades.chat_model', ''));
    }

    /**
     * @return array<string, mixed>
     */
    private function endFrame(string $stopReason, int $tokensIn, int $tokensOut, int $evalMs): array
    {
        return [
            't' => 'end',
            'stop_reason' => $stopReason,
            'tokens_in' => $tokensIn,
            'tokens_out' => $tokensOut,
            // Súčet za celý ťah, nie za posledný krok: pri troch kroroch je
            // zaujímavá cena odpovede, nie rýchlosť jej poslednej tretiny.
            'tokens_per_second' => $evalMs > 0 && $tokensOut > 0 ? round($tokensOut / ($evalMs / 1000), 2) : null,
        ];
    }

    private function clip(string $text): string
    {
        if (mb_strlen($text) <= self::RESULT_FRAME_CAP) {
            return $text;
        }

        return mb_substr($text, 0, self::RESULT_FRAME_CAP)."\n… (skrátené, celý výsledok je vo vlákne)";
    }
}
