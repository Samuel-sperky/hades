<?php

namespace App\Services\Console;

use App\Models\ConsoleThread;
use App\Models\Run;
use Closure;

/**
 * Rodičovský beh v rámci JEDNÉHO requestu — to, čo `spawn_agent` potrebuje vedieť
 * a čo mu tool call sám o sebe nepovie: v ktorom vlákne beží, ktorý beh je jeho
 * rodič, kam vydávať rámce a či klient ešte číta.
 *
 * **Prečo statický držiak a nie injekcia.** `SpawnAgentTool` vzniká v konštruktore
 * {@see ToolRegistry} (`app($class)` nad celým kánonom), teda PRED tým, než
 * `RunController` vôbec založí beh. Injektovaný kontext by bol v tej chvíli
 * prázdny objekt a jeho neskoršie naviazanie by muselo mutovať zdieľanú instanciu
 * — čo je to isté, čo tu robí `self::$current`, len schované za kontajnerom a za
 * ďalším `singleton()` riadkom v provideri. Statika je tu čitateľnejšia lož
 * o rozsahu než singleton: appka nebeží na Octane, kontajner sa stavia na každý
 * request nanovo a `bind()`/`clear()` sú v `finally`.
 *
 * **Nenaviazaný kontext je ODMIETNUTIE, nie prázdna hodnota.** `spawn_agent`
 * vystavený mimo behu (MCP, artisan, tinker) by inak zakladal podbehy bez rodiča
 * a bez `$emit` — teda bez brány, ktorá zápisy dieťaťa dáva človeku na
 * potvrdenie. Preto {@see self::current()} vracia `null` a tool na `null`
 * odpovedá `ToolResult::refused()`, fail-closed.
 *
 * **Kontext sa NEVIAŽE na vlákno podagenta.** Dieťa `spawn_agent` v žiadnom
 * z {@see \App\Services\Console\Tools\SpawnAgentTool::CHILD_PROFILES} nemá, takže
 * hĺbka stromu je 1 už z členstva profilov; nenaviazaný kontext v podbehu je
 * druhá, nezávislá poistka toho istého.
 */
final class AgentContext
{
    private static ?self $current = null;

    private function __construct(
        private readonly ConsoleThread $thread,
        private readonly Run $run,
        private readonly Closure $emit,
        private readonly Closure $aborted,
    ) {}

    /**
     * Naviaže kontext na beh, ktorý sa práve rozbieha.
     *
     * `$emit` musí byť ten OBALENÝ recorderom ({@see RunRecorder::wrap()}) — rámce
     * `agent_start` a hlavne `agent_wait` menia stav rodičovského behu a keby išli
     * mimo recordera, beh by v logu zostal `running` a nikto by ho neobnovil.
     *
     * @param  callable(array<string, mixed>): void  $emit
     * @param  callable(): bool  $aborted
     */
    public static function bind(ConsoleThread $thread, Run $run, callable $emit, callable $aborted): self
    {
        return self::$current = new self(
            $thread,
            $run,
            Closure::fromCallable($emit),
            Closure::fromCallable($aborted),
        );
    }

    /** Beh, v ktorom sa práve vykonáva tool — alebo `null` mimo behu. */
    public static function current(): ?self
    {
        return self::$current;
    }

    /**
     * Odviazanie. Patrí do `finally`, nie za telo: keď beh vyletí výnimkou, kontext
     * nesmie prežiť do ďalšieho behu toho istého procesu (v testoch je to ten istý
     * proces vždy).
     */
    public static function clear(): void
    {
        self::$current = null;
    }

    public function thread(): ConsoleThread
    {
        return $this->thread;
    }

    public function threadId(): int
    {
        return (int) $this->thread->id;
    }

    public function run(): Run
    {
        return $this->run;
    }

    /** @param  array<string, mixed>  $frame */
    public function emit(array $frame): void
    {
        ($this->emit)($frame);
    }

    /**
     * Odišiel klient? Vracia sa CALLABLE, nie výsledok: podbeh ho podáva svojmu
     * `AgentRunner`u, ktorý sa ním pýta uprostred generovania — jedno vyhodnotenie
     * na začiatku by Stop nezachytilo.
     *
     * @return Closure(): bool
     */
    public function aborted(): Closure
    {
        return $this->aborted;
    }
}
