<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Services\Console\AgentRunner;
use App\Services\Console\RunRecorder;
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
    /**
     * Slovenské hlášky validátora — ich text ide priamo do toku správ.
     *
     * Odmietnutie sa vracia ako rámec `error` ({@see refuse()}) a klient ho
     * vypisuje slovo za slovom ({@see public/js/console/run.js}, `refusalText`).
     * Vlastné vety („Také vlákno neexistuje.") sú po slovensky, takže bez tohto
     * poľa sa v tom istom toku miešali s anglickými vetami validátora — správa
     * nad 8000 znakov vypísala „The message field must not be greater than 8000
     * characters."
     *
     * Jedno pole pre `run()` aj `decide()`: to isté pole má mať v oboch tú istú
     * vetu, a kľúč k pravidlu, ktoré endpoint nemá, validátor ignoruje.
     *
     * Vety sú písané na pravidlo, nie cez `:attribute`: mená polí sú anglické
     * (`message`, `thread`, `call`) a v slovenskej vete by trčali.
     *
     * @var array<string, string>
     */
    private const MESSAGES = [
        'thread.required' => 'Chýba vlákno, do ktorého beh patrí.',
        'thread.uuid' => 'Identifikátor vlákna nemá platný tvar.',
        'message.required' => 'Správa je prázdna — nie je čo odoslať.',
        'message.string' => 'Správa musí byť text.',
        'message.max' => 'Správa presahuje 8000 znakov. Beh prijme len kratšiu.',
        'call.required' => 'Chýba volanie toolu, ku ktorému rozhodnutie patrí.',
        'call.integer' => 'Identifikátor volania toolu nemá platný tvar.',
        'decision.required' => 'Chýba rozhodnutie o zápise.',
        'decision.string' => 'Rozhodnutie o zápise nemá platný tvar.',
        'decision.in' => 'Také rozhodnutie o zápise neexistuje.',
        'provider.string' => 'Meno poskytovateľa modelu nemá platný tvar.',
        'provider.in' => 'Taký poskytovateľ modelu tu nie je.',
        'model.string' => 'Meno modelu nemá platný tvar.',
        'model.max' => 'Meno modelu presahuje 120 znakov.',
    ];

    /** Jeden ťah: správa človeka → prúd rámcov protokolu. */
    public function run(Request $request, AgentRunner $runner, ProviderFactory $providers, RunRecorder $recorder): StreamedResponse
    {
        $validator = Validator::make($request->all(), [
            'thread' => 'required|uuid',
            'message' => 'required|string|max:8000',
            'provider' => 'sometimes|nullable|string|in:'.implode(',', $providers->names()),
            'model' => 'sometimes|nullable|string|max:120',
        ], self::MESSAGES);

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

        $options = ['provider' => $data['provider'] ?? null, 'model' => $data['model'] ?? null];

        // Beh sa zakladá PRED prúdom, aby existoval aj vtedy, keď model nedá ani
        // prvý rámec — práve taký beh chce človek v logu nájsť.
        $run = $recorder->open($thread, $data['message'], $options);

        return $this->stream(fn (callable $emit, callable $aborted) => $runner->run(
            $thread,
            $data['message'],
            $recorder->wrap($run, $emit),
            $aborted,
            $options,
        ), $run, $recorder);
    }

    /** Rozhodnutie o jednom zápisovom toole — a pokračovanie toho istého ťahu. */
    public function decide(Request $request, AgentRunner $runner, ProviderFactory $providers, RunRecorder $recorder): StreamedResponse
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
        ], self::MESSAGES);

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

        $options = ['provider' => $data['provider'] ?? null, 'model' => $data['model'] ?? null];

        // Ten istý beh, nie nový: dvojfázová brána ťah rozdelí na segmenty a log
        // má ukázať jeden beh s rozhodnutím v ňom, nie dva polovičné.
        $run = $recorder->resume($thread, '', $options);

        return $this->stream(fn (callable $emit, callable $aborted) => $runner->resume(
            $thread,
            $call,
            $data['decision'],
            $recorder->wrap($run, $this->withThreadState($thread, $emit)),
            $aborted,
            $options,
        ), $run, $recorder);
    }

    /**
     * Doplní koncové rámce `/decide` o stav brány zápisov.
     *
     * Rozhodnutie „Povoliť vždy" vypne bránu pre CELÉ vlákno
     * ({@see AgentRunner::resume()}) — od tej chvíle idú ďalšie zápisy bez
     * pýtania. Klient si stav vlákna dovtedy čítal len pri jeho otvorení, takže
     * po tomto rozhodnutí ukazoval odškrtnuté políčko, kým brána bola
     * v skutočnosti vypnutá. UI teda klamalo práve o tom, na čom pri zápisoch
     * záleží najviac.
     *
     * Prečo pole na existujúcom rámci a nie rámec vlastný: protokol sľubuje, že
     * ťah končí PRESNE jedným `end` / `error` / `permission` a že po ňom už nič
     * nepríde. Samostatný rámec by sa musel poslať za koniec ťahu a ten sľub by
     * zrušil. Pole navyše je aditívne — starší klient ho ignoruje.
     *
     * Obal sedí POD recorderom (`wrap(..., withThreadState(...))`), aby log
     * behov videl rámec presne taký, aký ho poslal `AgentRunner`.
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @return callable(array<string, mixed>): void
     */
    private function withThreadState(ConsoleThread $thread, callable $emit): callable
    {
        return static function (array $frame) use ($thread, $emit): void {
            if (in_array($frame['t'] ?? '', ['end', 'error', 'permission'], true)) {
                $frame['auto_accept'] = (bool) $thread->auto_accept;
            }

            $emit($frame);
        };
    }

    /**
     * Prúd NDJSON. `$body` dostane `$emit` (jeden rámec) a `$aborted` (odišiel
     * klient?) — smyčka o HTTP nevie nič a dá sa testovať bez requestu.
     *
     * `$run` a `$recorder` sú voliteľné len preto, aby `stream()` zostal
     * použiteľný pre odmietnutie ešte pred behom; pri reálnom ťahu sú vždy oba.
     * Uzavretie je v `finally`, nie za telom: keď `AgentRunner` vyletí výnimkou,
     * beh nesmie v logu zostať naveky v stave `running`.
     *
     * @param  callable(callable(array<string, mixed>): void, callable(): bool): void  $body
     */
    private function stream(callable $body, ?Run $run = null, ?RunRecorder $recorder = null): StreamedResponse
    {
        return response()->stream(function () use ($body, $run, $recorder): void {
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

            $aborted = static fn (): bool => connection_aborted() === 1;

            try {
                $body($emit, $aborted);
            } finally {
                if ($run !== null && $recorder !== null) {
                    $recorder->close($run, $aborted());
                }
            }
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
