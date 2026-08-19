<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Services\Console\AgentRunner;
use App\Services\Llm\ProviderFactory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Agentový beh konzoly — `POST /api/console/run` a `POST /api/console/decide`.
 *
 * Oba vracajú TEN ISTÝ prúd: NDJSON, jeden objekt na riadok. Nie
 * `text/event-stream`: `EventSource` nevie poslať CSRF hlavičku, takže SSE
 * endpoint by musel vypadnúť z guardovaného okruhu (§8.11 docs/BEZPECNOST.md) —
 * a to je okruh, ktorý chráni tooly zapisujúce do pamäte a do súborov.
 * `fetch()` + čítanie tela zvládne NDJSON s CSRF aj `AbortController`.
 *
 * Prečo sa flushuje po každom rámci: model beží na CPU (~9 tok/s) a bez flushu
 * PHP buffer uvolní telo až na konci. Rozdiel je „konzola žije" vs „konzola sa
 * zasekla" — pri odpovedi na dve minúty to nie je kozmetika.
 *
 * Prečo `ignore_user_abort(true)`: bez toho PHP pri prvom zápise do zavretého
 * socketu skript zabije uprostred kroku a rozpísaná odpoveď sa nikdy neuloží.
 * Takto sa `connection_aborted()` len prepne na 1, smyčka to zbadá, uloží čo má
 * a skončí — miesto toho, aby model generoval do mŕtveho socketu ďalšie minúty.
 */
class RunController extends Controller
{
    /** Jeden ťah: správa človeka → prúd rámcov protokolu. */
    public function run(Request $request, AgentRunner $runner, ProviderFactory $providers): StreamedResponse
    {
        $validator = Validator::make($request->all(), [
            'thread' => 'required|uuid',
            'message' => 'required|string|max:8000',
            'provider' => 'sometimes|nullable|string|in:'.implode(',', $providers->names()),
            'model' => 'sometimes|nullable|string|max:120',
        ]);

        if ($validator->fails()) {
            return $this->refuse($validator->errors()->first());
        }

        $data = $validator->validated();
        $thread = ConsoleThread::where('uuid', $data['thread'])->first();

        if ($thread === null) {
            return $this->refuse('Také vlákno neexistuje.');
        }

        // Vlákno s nedorozhodnutým zápisom nesmie prijať ďalšiu správu — model by
        // dostal históriu s `tool_use` bez výsledku a druhý beh by písal do toho
        // istého vlákna súčasne s tým prvým.
        if ($thread->pendingToolCall() !== null) {
            return $this->refuse('Vlákno čaká na rozhodnutie o zápise. Najprv ho povoľ alebo zamietni.');
        }

        return $this->stream(fn (callable $emit, callable $aborted) => $runner->run(
            $thread,
            $data['message'],
            $emit,
            $aborted,
            ['provider' => $data['provider'] ?? null, 'model' => $data['model'] ?? null],
        ));
    }

    /** Rozhodnutie o jednom zápisovom toole — a pokračovanie toho istého ťahu. */
    public function decide(Request $request, AgentRunner $runner, ProviderFactory $providers): StreamedResponse
    {
        $validator = Validator::make($request->all(), [
            'thread' => 'required|uuid',
            'call' => 'required|integer',
            'decision' => 'required|string|in:'.implode(',', [
                AgentRunner::DECISION_ALLOW,
                AgentRunner::DECISION_ALLOW_ALWAYS,
                AgentRunner::DECISION_DENY,
            ]),
            'provider' => 'sometimes|nullable|string|in:'.implode(',', $providers->names()),
            'model' => 'sometimes|nullable|string|max:120',
        ]);

        if ($validator->fails()) {
            return $this->refuse($validator->errors()->first());
        }

        $data = $validator->validated();
        $thread = ConsoleThread::where('uuid', $data['thread'])->first();

        if ($thread === null) {
            return $this->refuse('Také vlákno neexistuje.');
        }

        // Tool call sa hľadá V RÁMCI vlákna: id z cudzieho vlákna by inak
        // povolilo zápis, ktorý si nikto v tomto vlákne nevyžiadal.
        $call = ConsoleToolCall::query()
            ->where('thread_id', $thread->id)
            ->where('id', $data['call'])
            ->first();

        if ($call === null) {
            return $this->refuse('Toto rozhodnutie sa nedá priradiť k žiadnemu volaniu toolu.');
        }

        return $this->stream(fn (callable $emit, callable $aborted) => $runner->resume(
            $thread,
            $call,
            $data['decision'],
            $emit,
            $aborted,
            ['provider' => $data['provider'] ?? null, 'model' => $data['model'] ?? null],
        ));
    }

    /**
     * Prúd NDJSON. `$body` dostane `$emit` (jeden rámec) a `$aborted` (odišiel
     * klient?) — smyčka o HTTP nevie nič a dá sa testovať bez requestu.
     *
     * @param  callable(callable(array<string, mixed>): void, callable(): bool): void  $body
     */
    private function stream(callable $body): StreamedResponse
    {
        return response()->stream(function () use ($body): void {
            ignore_user_abort(true);

            $emit = function (array $frame): void {
                echo json_encode($frame, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";

                // `ob_flush()` bez buffra je varovanie, a testy si buffer robia
                // samy — preto tá podmienka, nie zavináč.
                if (ob_get_level() > 0) {
                    ob_flush();
                }

                flush();
            };

            $body($emit, static fn (): bool => connection_aborted() === 1);
        }, 200, $this->headers());
    }

    /**
     * Odmietnutie ešte pred behom. Telo je ten istý NDJSON s rámcom `error`, aby
     * klient nemusel mať dve cesty na spracovanie odpovede; status je 422, lebo
     * chybný request je chyba klienta a nemá vyzerať ako úspešný prúd.
     */
    private function refuse(string $message): StreamedResponse
    {
        return response()->stream(function () use ($message): void {
            echo json_encode(['t' => 'error', 'message' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";

            if (ob_get_level() > 0) {
                ob_flush();
            }

            flush();
        }, 422, $this->headers());
    }

    /** @return array<string, string> */
    private function headers(): array
    {
        return [
            'Content-Type' => 'application/x-ndjson',
            // Caddy aj ngrok inak prúd zapuzdria do vlastného buffra a rámce
            // dorazia až na konci ťahu — teda po minútach.
            'X-Accel-Buffering' => 'no',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
        ];
    }
}
