<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Services\Console\AgentContext;
use App\Services\Console\AgentRunner;
use App\Services\Console\RunRecorder;
use App\Services\Console\ContextBlock;
use App\Services\Console\Subagent;
use App\Services\Console\ToolRegistry;
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
        'profile.string' => 'Meno profilu nástrojov nemá platný tvar.',
        'profile.in' => 'Taký profil nástrojov tu nie je.',
        'profile.prohibited' => 'O profile nástrojov sa rozhoduje pri spustení behu.',
    ];

    /** Jeden ťah: správa človeka → prúd rámcov protokolu. */
    public function run(Request $request, AgentRunner $runner, ProviderFactory $providers, RunRecorder $recorder, ToolRegistry $tools, ContextBlock $context): StreamedResponse
    {
        $validator = Validator::make($request->all(), [
            'thread' => 'required|uuid',
            'message' => 'required|string|max:8000',
            'provider' => 'sometimes|nullable|string|in:'.implode(',', $providers->names()),
            'model' => 'sometimes|nullable|string|max:120',
            // Neznámy profil sa ODMIETNE tu, na hranici — zoznam sa skladá z kľúčov
            // PROFILES, takže preklep nikdy neprejde ďalej a nezaloží fantómový beh
            // (validácia beží pred `openExclusive()`).
            'profile' => 'sometimes|nullable|string|in:'.implode(',', array_keys(ToolRegistry::PROFILES)),
            // Kontext z grafu: dok posiela iba id, blok sa skladá na serveri
            // (ContextBlock). Strop sa číta z toho istého configu ako ContextBlock,
            // nie z vlastnej konštanty — inak by sa dve čísla ticho rozišli.
            'context_node_ids' => 'sometimes|array|max:'.(int) config('hades.console.context.nodes', 8),
            'context_node_ids.*' => 'integer',
        ], self::MESSAGES);

        if ($validator->fails()) {
            return $this->refuse($validator->errors()->first());
        }

        $data = $validator->validated();
        $thread = ConsoleThread::where('uuid', $data['thread'])->first();

        if ($thread === null) {
            return $this->refuse('Také vlákno neexistuje.');
        }

        // Vlákno podagenta nie je konverzácia. Rámec `agent_wait` posiela jeho uuid
        // do prehliadača (klient ho potrebuje pre `/decide`), takže bez tohto guardu
        // by doň klient vedel písať — a správa vo vlákne podagenta by pretiekla do
        // kontextu, ktorý má byť izolovaný. `/decide` naň povolené ZOSTÁVA; to je
        // celá brána.
        if ($thread->isSubagent()) {
            return $this->refuse('Toto je vlákno podagenta — správy doň neposielaj. Podagenta spúšťa beh rodiča.');
        }

        // Vlákno s nedorozhodnutým zápisom nesmie prijať ďalšiu správu — model by
        // dostal históriu s `tool_use` bez výsledku a druhý beh by písal do toho
        // istého vlákna súčasne s tým prvým.
        if ($thread->pendingToolCall() !== null) {
            return $this->refuse('Vlákno čaká na rozhodnutie o zápise. Najprv ho povoľ alebo zamietni.');
        }

        // Profil sa vyberie TU, pred založením behu, a nastaví sa na singleton
        // registra (ten istý objekt dostane `AgentRunner` cez konštruktor). Profil
        // sa perzistuje na vlákno, aby ho obnova zaparkovaného zápisu čítala zo
        // servera, nie z klienta — inak by sa sada toolov dala vymeniť medzi
        // vyžiadaním povolenia a jeho vykonaním.
        $profile = $data['profile'] ?? (string) config('hades.console.profile', 'full');
        $tools->useProfile($profile);
        $thread->tool_profile = $profile;

        $options = [
            'provider' => $data['provider'] ?? null,
            'model' => $data['model'] ?? null,
            'profile' => $profile,
        ];

        // Beh sa zakladá PRED prúdom, aby existoval aj vtedy, keď model nedá ani
        // prvý rámec — práve taký beh chce človek v logu nájsť.
        //
        // `openExclusive` odmietne druhý súbežný ťah v tom istom vlákne. Bez toho
        // dva kliky v tej istej sekunde prešli oba (`pendingToolCall()` chráni až
        // parkujúci zápis) a rozsahy id sa prekryli, takže každý beh hlásil cenu
        // oboch a v detaile ukázal cudzí ťah.
        $run = $recorder->openExclusive($thread, $data['message'], $options);

        if ($run === null) {
            return $this->refuse('V tomto vlákne už jeden beh prebieha. Počkaj, kým dobehne, alebo ho zastav.');
        }

        // Model dostane kontext + otázku; log behu dostane LEN otázku. `runs.prompt`
        // je zadanie, ktoré „Spustiť znovu" vracia — kontext je aktuálny výber uzlov,
        // nie súčasť zadania, a nesmie sa doň zamiešať. `console_messages.content`
        // (píše ho recorder->wrap cez runner) tak ostane verné tomu, čo model videl.
        $block = $context->build($data['context_node_ids'] ?? []);
        $withContext = $block === '' ? $data['message'] : $block."\n\n".$data['message'];

        return $this->stream(function (callable $emit, callable $aborted) use ($runner, $recorder, $thread, $withContext, $options, $run): void {
            // Kontext behu musí byť naviazaný PRED prvým toolom: `spawn_agent`
            // z neho čítá rodičovské vlákno, rodičovský beh, `$emit` a `$aborted`,
            // a bez naviazania sa fail-closed odmietne (beh bez `$emit` je beh bez
            // brány zápisov). `$emit` sa podáva OBALENÝ recorderom — rámec
            // `agent_wait` mení stav behu na `waiting`.
            $wrapped = $recorder->wrap($run, $emit);

            AgentContext::bind($thread, $run, $wrapped, $aborted);

            try {
                $runner->run($thread, $withContext, $wrapped, $aborted, $options);
            } finally {
                // `finally`, nie za telom: kontext nesmie prežiť do ďalšieho behu
                // toho istého procesu (v testoch je to ten istý proces vždy).
                AgentContext::clear();
            }
        }, $run, $recorder);
    }

    /**
     * Rozhodnutie o jednom zápisovom toole — a pokračovanie toho istého ťahu.
     *
     * Od podagentov to je **jediná cesta ďalej aj pre rodičovský beh.** Keď zápis
     * podagenta zaparkoval, `/decide` prichádza na vlákno PODAGENTA a v tom istom
     * requeste sa dopovie dieťa, uzavrie sa jeho podbeh a rozbehne sa rodič
     * ({@see Subagent::resumeParent()}). Klient teda v jednom prúde dostane vnorené
     * rámce dieťaťa, `agent_end` a potom top-level rámce rodiča.
     */
    public function decide(Request $request, AgentRunner $runner, ProviderFactory $providers, RunRecorder $recorder, ToolRegistry $tools, Subagent $subagent): StreamedResponse
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
            // `/decide` profil NEPRIJÍMA. Keby ho prijalo, dal by sa zaparkovaný
            // `write_file` dorozhodnúť v profile, ktorý ho nemá (alebo naopak) —
            // teda vymeniť sadu toolov medzi vyžiadaním povolenia a jeho vykonaním.
            'profile' => 'prohibited',
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

        // Zamietnutý `spawn_agent` je zamietnutý podagent. Bez tohto by jeho dieťa
        // zostalo naveky vo `waiting` — zametač zaparkované behy zámerne nezametá
        // (čakajú na človeka a môžu čakať dni) — a `runs` by prestalo hovoriť pravdu
        // o tom, čo sa deje. Je to obranné: UI takú možnosť nedá, `spawn_agent` je
        // čítací tool bez potvrdzovacej karty.
        if ($call->name === 'spawn_agent' && $data['decision'] === AgentRunner::DECISION_DENY) {
            $subagent->abandon($call);
        }

        // Profil sa čítá z vlákna (server), nie z requestu (klient): segment po
        // rozhodnutí musí bežať na tej istej sade toolov, s akou ťah začal.
        $tools->useProfile((string) ($thread->tool_profile ?: config('hades.console.profile', 'full')));

        $options = ['provider' => $data['provider'] ?? null, 'model' => $data['model'] ?? null];

        // Ten istý beh, nie nový: dvojfázová brána ťah rozdelí na segmenty a log
        // má ukázať jeden beh s rozhodnutím v ňom, nie dva polovičné.
        $run = $recorder->resume($thread, '', $options);

        // Rozhodnutie vo vlákne podagenta má vlastnú cestu: jeho rámce idú do
        // obálky a po jeho dobehnutí sa v tom istom requeste rozbehne rodič.
        if ($thread->isSubagent()) {
            return $this->stream(fn (callable $emit, callable $aborted) => $this->resumeSubagent(
                $runner, $recorder, $tools, $subagent,
                $thread, $call, $data['decision'], $run, $options,
                $emit, $aborted,
            ), $run, $recorder);
        }

        return $this->stream(function (callable $emit, callable $aborted) use ($runner, $recorder, $thread, $call, $data, $options, $run): void {
            // Kontext behu aj tu: obnovený segment môže zavolať `spawn_agent`
            // (rovnako ako môže zavolať čokoľvek iné zo svojho profilu), a to je aj
            // cesta, ktorou sa niekto pokúsi pretlačiť okolo brány dieťaťa —
            // `/decide allow` na `spawn_agent` call rodiča. Bez naviazaného kontextu
            // by tool nemal ako zaparkovať znova.
            $wrapped = $recorder->wrap($run, $this->withThreadState($thread, $emit));

            AgentContext::bind($thread, $run, $wrapped, $aborted);

            try {
                $runner->resume($thread, $call, $data['decision'], $wrapped, $aborted, $options);
            } finally {
                AgentContext::clear();
            }
        }, $run, $recorder);
    }

    /**
     * Obnova zaparkovaného zápisu vo vlákne PODAGENTA — a pokračovanie rodiča.
     *
     * Poradie krokov je celý zmysel tejto metódy:
     *
     *  1. dieťa dopovie; jeho rámce idú do obálky `{t:'agent', run, frame}`, aby
     *     vnorené `end` / `permission` neukončili prúd rodiča a neprepli čakanie
     *     klienta na cudzí call;
     *  2. podbeh sa uzavrie — až potom o ňom `spawn_agent` vie povedať, že dobehol;
     *  3. keď dieťa zaparkovalo ZNOVA (ďalší zápis v tom istom ťahu), rodič sa
     *     nerozbehne a ťah končí opäť `agent_wait`;
     *  4. inak `agent_end` a rozbeh rodiča.
     *
     * `agent_end` ide do surového `$emit`, nie cez recorder dieťaťa: je to rámec
     * O behu, nie rámec TOHO behu, a v `STATEFUL` úmyselne nie je.
     *
     * @param  array{provider?: string|null, model?: string|null}  $options
     * @param  callable(array<string, mixed>): void  $emit
     * @param  callable(): bool  $aborted
     */
    private function resumeSubagent(
        AgentRunner $runner,
        RunRecorder $recorder,
        ToolRegistry $tools,
        Subagent $subagent,
        ConsoleThread $thread,
        ConsoleToolCall $call,
        string $decision,
        Run $run,
        array $options,
        callable $emit,
        callable $aborted,
    ): void {
        $runner->resume(
            $thread,
            $call,
            $decision,
            $recorder->wrap($run, $subagent->envelope($run, $this->withThreadState($thread, $emit))),
            $aborted,
            $options,
        );

        $recorder->close($run, $aborted());
        $run->refresh();

        $pending = $thread->fresh()?->pendingToolCall();
        $parentCall = $run->parent_call_id === null ? null : ConsoleToolCall::find($run->parent_call_id);

        if ($pending !== null && $parentCall !== null) {
            $emit($subagent->waitFrame($run, $parentCall, $pending));

            return;
        }

        $emit($subagent->endFrame($run));

        // Otvorený podbeh bez `pending` riadku je stav, ktorý nemá ako vzniknúť
        // (`close()` beh v `running` uzavrie) — ale keby vznikol, rodič sa
        // rozbehnúť NESMIE: jeho `spawn_agent` ešte nemá čo vrátiť.
        if ($run->isOpen()) {
            return;
        }

        $subagent->resumeParent(
            $runner, $tools, $run, $emit, $aborted, $options,
            fn (ConsoleThread $parent, callable $out): callable => $this->withThreadState($parent, $out),
        );
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
     * ťah končí PRESNE jedným top-level rámcom (`end` / `error` / `permission`,
     * a od podagentov aj `agent_wait`) a že po ňom už nič nepríde. Samostatný rámec
     * by sa musel poslať za koniec ťahu a ten sľub by zrušil. Pole navyše je
     * aditívne — starší klient ho ignoruje.
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
