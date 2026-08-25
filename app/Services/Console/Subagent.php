<?php

namespace App\Services\Console;

use App\Models\ConsoleMessage;
use App\Models\ConsoleThread;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Services\Llm\ProviderFactory;

/**
 * Podagent — vlastné vlákno, vlastný beh, vlastný register toolov.
 *
 * ## Prečo vlastné vlákno a nie správy do vlákna rodiča
 *
 * Tri nezávislé dôvody a každý sám by stačil:
 *
 *  1. `AgentRunner::history()` je viazaná na `thread_id`. Správy podagenta vo
 *     vlákne rodiča by sa dostali do kontextu rodiča — teda presne to, čomu sa
 *     podagentom vyhýbame (rodič platí ~500 tokenov za odpoveď namiesto ~6000 za
 *     priebeh).
 *  2. `runs` nesie členstvo správ **rozsahom id** a ten je presný len preto, že
 *     vlákno beží jeden ťah naraz. Prekladané správy dvoch behov v jednom vlákne
 *     by ten predpoklad zrušili a **každý beh by hlásil cenu oboch** — to sa v tomto
 *     projekte už raz stalo (preto `openExclusive`), takže to nie je hypotéza.
 *  3. `pendingToolCall()` je per-vlákno. Vlastné vlákno znamená, že brána podagenta
 *     a brána rodiča sú rozlíšiteľné bez toho, aby vznikol nový stav.
 *
 * ## Prečo `new AgentRunner` a `new ToolRegistry`, nie z kontajnera
 *
 * `ToolRegistry` je v kontajneri singleton a musí ním zostať (`RunController`
 * a `AgentRunner` musia mať ten istý objekt, inak nastavenie profilu na jednom
 * nemá vplyv na druhý). Keby dieťa prepnulo profil na tom singletone, po
 * zaparkovaní by ostal prepnutý pre celý zvyšok requestu rodiča — teda rodič by
 * dobehol so sadou toolov svojho dieťaťa. Preto vlastná instancia registra a
 * `AgentRunner` postavený nad ňou ručne.
 *
 * Do konštruktora sa preto injektuje len {@see ProviderFactory}, {@see SystemPrompt}
 * a {@see RunRecorder} — ani jeden z nich `ToolRegistry` nepotrebuje, takže cyklus
 * `AgentRunner ← ToolRegistry ← SpawnAgentTool` nevzniká.
 */
final class Subagent
{
    public function __construct(
        private readonly ProviderFactory $providers,
        private readonly SystemPrompt $prompt,
        private readonly RunRecorder $recorder,
    ) {}

    /**
     * Postaví podagenta a odjazdí jeho ťah — až po jeho koniec, alebo po jeho
     * zaparkovanie na povolení zápisu.
     *
     * `$aborted` je RODIČOV, jeden pre celý strom: Stop v prehliadači musí zastaviť
     * dieťa aj rodiča, inak dieťa dogenerovává do mŕtveho socketu ďalšie minúty.
     */
    public function start(
        AgentContext $ctx,
        ConsoleToolCall $parentCall,
        string $task,
        string $profile,
        int $maxSteps,
    ): SubagentOutcome {
        $parentThread = $ctx->thread();

        $child = new ConsoleThread([
            'parent_thread_id' => $parentThread->id,
            'tool_profile' => $profile,
            'max_steps' => $maxSteps,
            'provider' => $parentThread->provider,
            'model' => $parentThread->model,
            // Podagent NEDEDÍ `auto_accept`. „Povoliť vždy" človek udelil vláknu,
            // ktorého zápisy videl v prúde — a zadanie podagenta nepísal on, ale
            // model. Dôsledok, ktorý treba poznať: aj so zapnutým auto-accept sa
            // beh na zápise podagenta zastaví.
            'auto_accept' => false,
        ]);

        // Titulok z úlohy, nie z briefu: brief je pre všetkých podagentov ten istý
        // a zoznam behov by hlásil dvadsaťkrát tú istú vetu.
        $child->title = $child->titleFrom($task);
        $child->save();

        // `runs.prompt` nesie LEN úlohu, nie brief — presne ako `RunController::run`
        // ukládá otázku bez `ContextBlock`u. „Spustiť znovu" tak vráti zadanie.
        $run = $this->recorder->openChild($child, $ctx->run(), $parentCall, $task, ['profile' => $profile]);

        $ctx->emit([
            't' => 'agent_start',
            'run' => $run->uuid,
            'thread' => $child->uuid,
            'call' => $parentCall->id,
            'task' => $task,
            'profile' => $profile,
            'max_steps' => $maxSteps,
        ]);

        $registry = new ToolRegistry;
        $registry->useProfile($profile);

        $runner = new AgentRunner($this->providers, $this->prompt, $registry);

        $runner->run(
            $child,
            $this->brief($task),
            $this->recorder->wrap($run, $this->envelope($run, fn (array $frame) => $ctx->emit($frame))),
            $ctx->aborted(),
            ['profile' => $profile],
        );

        // Parkovanie sa zisťuje z DB, nie odpozeraním rámcov: rámec sa dá
        // prehliadnuť (obálka, iná vetva), `pending` riadok nie.
        $parked = $child->fresh()?->pendingToolCall() !== null;

        $this->recorder->close($run, ($ctx->aborted())());
        $run->refresh();

        if (! $parked) {
            $ctx->emit($this->endFrame($run));
        }

        return new SubagentOutcome($run, $parked, $child, $this->answerOf($child));
    }

    /**
     * Podbeh, ktorý si vyžiadal TENTO `spawn_agent` call — alebo `null`.
     *
     * Na tomto stojí idempotencia toolu (§3.4 návrhu): kým dieťa existuje a je
     * otvorené, opakované vykonanie toho istého callu zaparkuje znova a druhé dieťa
     * nezaloží. Vďaka tomu bránu neobíde ani `/decide allow` na `spawn_agent` call
     * rodiča.
     */
    public function childRunOf(ConsoleToolCall $parentCall): ?Run
    {
        return Run::query()->where('parent_call_id', $parentCall->id)->orderBy('id')->first();
    }

    /**
     * Koľko detí už tento beh spustil. Na BEHU, nie na vlákne: strop patrí ťahu,
     * nie konverzácii.
     */
    public function childCount(Run $parentRun): int
    {
        return Run::query()->where('parent_run_id', $parentRun->id)->count();
    }

    /**
     * Rámec `agent_wait` — top-level, a je to POSLEDNÝ rámec ťahu rodiča. Rámec
     * `end` po ňom nepríde; obnova ide výhradne cez `POST /api/console/decide` na
     * vlákno podagenta.
     *
     * @return array<string, mixed>
     */
    public function waitFrame(Run $childRun, ConsoleToolCall $parentCall, ConsoleToolCall $childCall): array
    {
        return [
            't' => 'agent_wait',
            'run' => $childRun->uuid,
            // Vlákno PODAGENTA: `/decide` sa posiela naň, nie na to, ktoré má
            // klient otvorené.
            'thread' => $childRun->thread?->uuid,
            'call' => $parentCall->id,
            'child_call' => $childCall->id,
            'name' => $childCall->name,
        ];
    }

    /**
     * Rámec `agent_end`. Cena sa čítá z `runs`, nie z rámca `end` dieťaťa: ťah,
     * ktorý zaparkoval, `end` nikdy nepošle a cena jeho prvého segmentu by z
     * čísel vypadla.
     *
     * @return array<string, mixed>
     */
    public function endFrame(Run $run): array
    {
        return [
            't' => 'agent_end',
            'run' => $run->uuid,
            'status' => $run->status,
            'steps' => (int) $run->steps,
            'tool_calls' => (int) $run->tool_calls,
            'tokens_in' => (int) $run->tokens_in,
            'tokens_out' => (int) $run->tokens_out,
        ];
    }

    /**
     * Obálka rámcov dieťaťa: `{t:'agent', run, frame}`.
     *
     * Obálka a NIE príznak na rámci dieťaťa — tri nezávislé dôvody:
     *
     *  1. `runclient.js:route()` by na `t:'end'` dieťaťa zavrel prúd rodiča a na
     *     `t:'permission'` nastavil čakanie na cudzí call. Príznak vedľa `t` by sa
     *     musel kontrolovať v každom `case`, teda v každej vetve, kde sa dá
     *     zabudnúť.
     *  2. `RunRecorder::observe()` ráta `steps` na `t:'step'` a `tool_calls` na
     *     `t:'tool'`. Rámce dieťaťa idú cez `$emit` rodiča, takže s príznakom by sa
     *     kroky dieťaťa pripočítali rodičovi. `agent` v `STATEFUL` nie je, takže
     *     obálka to vylučuje konštrukciou, nie disciplínou.
     *  3. Vlastný recorder dieťaťa počíta tie isté rámce PRED zabalením, takže
     *     čísla sedia obom behom naraz.
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @return callable(array<string, mixed>): void
     */
    public function envelope(Run $run, callable $emit): callable
    {
        return static function (array $frame) use ($run, $emit): void {
            $emit(['t' => 'agent', 'run' => $run->uuid, 'frame' => $frame]);
        };
    }

    /**
     * Podbeh sa uzavrel — rozbeh rodiča v TOM ISTOM requeste, ktorý priniesol
     * rozhodnutie človeka.
     *
     * Nie je to druhá cesta k modelu: `runner->resume()` je tá istá metóda, ktorou
     * pokračuje každý zaparkovaný zápis, a `spawn_agent` call rodiča je pre ňu
     * obyčajný `pending` riadok. Nové je len to, ktorý call to je.
     *
     * `$threadState` je dekorátor rámcov z {@see \App\Http\Controllers\Console\RunController}
     * (dopĺňa stav brány zápisov do koncových rámcov). Podáva sa ako callable, aby
     * tu nevznikla jeho druhá kópia.
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @param  (callable(): bool)|null  $aborted
     * @param  array{provider?: string|null, model?: string|null}  $options
     * @param  callable(ConsoleThread, callable): callable  $threadState
     */
    public function resumeParent(
        AgentRunner $runner,
        ToolRegistry $tools,
        Run $childRun,
        callable $emit,
        ?callable $aborted,
        array $options,
        callable $threadState,
    ): void {
        $parentCall = $childRun->parent_call_id === null
            ? null
            : ConsoleToolCall::find($childRun->parent_call_id);

        $parentThread = $parentCall?->thread;

        // Osirotené dieťa (rodič zmazaný, call zmazaný) alebo call, o ktorom už
        // rozhodnutie padlo — obidvoje je čitateľný stav, nie chyba. Rodič sa
        // nerozbehne a prúd skončí rámcom `agent_end`, ktorý už odišiel.
        if ($parentCall === null || $parentThread === null || ! $parentCall->isPending()) {
            return;
        }

        // Profil rodiča zo SERVERA (`runs.tool_profile`, s fallbackom na vlákno):
        // register má práve teraz nastavený profil DIEŤAŤA, takže bez tohto by
        // rodič dobehol so sadou toolov svojho podagenta.
        $tools->useProfile((string) (
            $childRun->parent?->tool_profile
            ?: $parentThread->tool_profile
            ?: config('hades.console.profile', 'full')
        ));

        $parentRun = $this->recorder->resume($parentThread, '', $options);
        $wrapped = $this->recorder->wrap($parentRun, $threadState($parentThread, $emit));

        AgentContext::bind($parentThread, $parentRun, $wrapped, $aborted ?? static fn (): bool => false);

        try {
            $runner->resume(
                $parentThread,
                $parentCall,
                AgentRunner::DECISION_ALLOW,
                $wrapped,
                $aborted,
                $options,
            );
        } finally {
            AgentContext::clear();
            $this->recorder->close($parentRun, $aborted !== null && $aborted());
        }
    }

    /**
     * Zamietnutý `spawn_agent` call rodiča — dieťa treba uzavrieť, inak zostane
     * naveky vo `waiting` (zametač zaparkované behy zámerne nezametá, čakajú na
     * človeka a môžu čakať dni).
     *
     * Je to obranné, nie funkčné: UI takú možnosť nedá, `spawn_agent` je čítací
     * tool bez potvrdzovacej karty. Ale bez tohto by `runs` prestalo hovoriť pravdu
     * o tom, čo sa deje.
     */
    public function abandon(ConsoleToolCall $parentCall): void
    {
        $child = $this->childRunOf($parentCall);

        if ($child === null) {
            return;
        }

        $thread = $child->thread;

        if ($thread !== null) {
            foreach ($thread->toolCalls()->where('status', 'pending')->get() as $call) {
                $call->status = 'denied';
                $call->result = 'Rodičovský beh bol zrušený — tento zápis sa nevykoná.';
                $call->decided_at = now();
                $call->duration_ms = 0;
                $call->save();
            }
        }

        // Stav sa nastavuje PRED `close()`: zaparkovaný beh `close()` zámerne
        // nezatvára (čaká na `/decide` a jeho trvanie by inak meralo, ako dlho sa
        // človek rozhodoval), takže bez tohto by dieťa zostalo `waiting`.
        $child->status = 'aborted';
        $child->save();

        $this->recorder->close($child, aborted: true);
    }

    /**
     * Prvá — a jediná — správa podagenta. Nové vlákno má prázdnu históriu, takže
     * toto je celý jeho svet.
     *
     * `SystemPrompt` sa NEMENÍ a rola sa hovorí tu. Je to čestnejšie: je to zadanie,
     * nie smernica. Precedens je `RunController::run`, kde sa `ContextBlock` lepí
     * pred otázku do správy pre model, kým `runs.prompt` drží len otázku.
     */
    public function brief(string $task): string
    {
        return <<<TXT
        Si podagent Hadesa. Máš JEDNU úlohu a po jej dokončení odpovedáš krátkym zhrnutím toho, čo si zistil alebo urobil — to zhrnutie je tvoj jediný výstup.
        Nemáš históriu ani kontext inej konverzácie; všetko, čo potrebuješ, je nižšie.

        Úloha:
        {$task}
        TXT;
    }

    /**
     * Odpoveď podagenta = jeho POSLEDNÁ neprázdna asistentská správa.
     *
     * Nie celý transkript a nie výsledky jeho toolov — to je celý zmysel podagenta.
     * Prázdny string znamená „nič nepovedal" (zaparkoval na prvom kroku, alebo ho
     * zastavil Stop) a tool ho v odpovedi vynechá; prázdne polia sa neposielajú.
     *
     * Verejná preto, že to isté potrebuje `SpawnAgentTool` pri pokračovaní rodiča,
     * kde `SubagentOutcome` neexistuje (dieťa dobehlo v inom segmente requestu) —
     * druhá kópia tohto dopytu by sa s touto rozišla.
     */
    public function answerOf(ConsoleThread $thread): string
    {
        $message = ConsoleMessage::query()
            ->where('thread_id', $thread->id)
            ->where('role', 'assistant')
            ->whereNotNull('content')
            ->where('content', '<>', '')
            ->orderByDesc('id')
            ->first();

        return trim((string) ($message->content ?? ''));
    }
}
