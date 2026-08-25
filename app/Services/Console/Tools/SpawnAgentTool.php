<?php

namespace App\Services\Console\Tools;

use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Services\Console\AgentContext;
use App\Services\Console\AgentParked;
use App\Services\Console\Subagent;
use App\Services\Console\ToolResult;

/**
 * `spawn_agent` — pusti podagenta na jednu uzavretú úlohu a vezmi si jeho odpoveď.
 *
 * ## Je to ČÍTACÍ tool — a `isWrite()` tým prestáva byť jediná brána
 *
 * `isWrite() === false`, `preview()` je `null`, a to je proti prvej intuícii, takže
 * tu sú dôvody:
 *
 *  1. `isWrite()` odpovedá na presne jednu otázku: *musí človek potvrdiť TOTO
 *     volanie, predtým než sa vykoná?* `spawn_agent` sám nezapíše nič — ani uzol,
 *     ani súbor, ani riadok v pamäti. Zakladá vlákno a beh, čo je to isté, čo robí
 *     každá správa v konzole.
 *  2. Náhľad by nemal čo ukázať. Jediné, čo v okamihu potvrdenia existuje, je text
 *     úlohy — a to nie je náhľad zmeny, to je zadanie. Náhľad, ktorý ukáže zadanie
 *     a nechá človeka kliknúť „Povoliť", **učí nesprávnu vec**: že tým kliknutím
 *     schválil zápisy, ktoré podagent urobí. Neschválil. Tie prídu jeden po druhom,
 *     každý s vlastným diffom, v podagentovi.
 *  3. Dve brány na jednu akciu, z ktorých druhá je jediná, čo vie ukázať diff, je
 *     horšie než jedna brána na správnom mieste.
 *
 * Z toho vyplýva vlastnosť, ktorú tento projekt doteraz nepotreboval:
 *
 * > **`isWrite() === false` už neznamená „prebehne bez človeka".** `spawn_agent` je
 * > prvý čítací tool, ktorý vie ťah zaparkovať — nie svojím zápisom, ale zápisom
 * > svojho dieťaťa. Parkovanie nesie {@see AgentParked}, nie `isWrite()`.
 *
 * ## Idempotencia na vlastný `ConsoleToolCall`
 *
 * Tool sa najprv pozrie, či pre svoj call už dieťa existuje. Keď existuje a je
 * OTVORENÉ, znova vydá `agent_wait` a znova hodí `AgentParked` — nové dieťa
 * nezakladá a zhrnutie nevydá. Vďaka tomu žiadna cesta k modelu bránu neobíde:
 * ani `/decide allow` na tento call, ani opakované vykonanie po reštarte. **Brána
 * drží z konštrukcie, nie z disciplíny volajúcich.**
 *
 * ## Poradie kontrol
 *
 * Argumenty sa validujú PRED kontrolou behu. Je to zámer, nie nedôslednosť:
 * validácia argumentov je čistá (nič nezakladá, nič nečíta z DB) a nedovolený
 * profil má dostať vecnú odpoveď so zoznamom dovolených aj tam, kde tool beží mimo
 * behu — inak by sa dve rôzne poruchy hlásili jednou vetou.
 */
final class SpawnAgentTool extends BaseTool
{
    /**
     * Profily, ktoré smie dostať podagent. `full` ani `orchestrator` tu NIE SÚ.
     *
     * Konštanta v KÓDE, nie config — ten istý argument ako pri `ToolRegistry::PROFILES`:
     * členstvo rozhoduje o tom, ktoré ZÁPISOVÉ tooly podagent vôbec má. V `.env` by
     * to netestoval nikto a preklep by ticho pridal zápisový tool.
     *
     *  - `full` nie je dovolený: podagent s dvanástimi toolmi nie je podagent, je to
     *    druhá konzola — a dôvod existencie podagenta je zúženie.
     *  - `orchestrator` nie je dovolený: **tým je hĺbka stromu presne 1** a rekurzia
     *    `spawn_agent → spawn_agent` je nemožná. Na CPU-only stroji je to podmienka,
     *    nie preferencia.
     */
    public const CHILD_PROFILES = ['memory', 'files', 'graph'];

    /** Nad tieto čísla sa `.env` nedostane. Preklep v konfigurácii nesmie zapáliť CPU na hodinu. */
    private const HARD_MAX_CHILDREN = 5;

    private const HARD_MAX_STEPS = 8;

    public function __construct(private readonly Subagent $subagent) {}

    public function name(): string
    {
        return 'spawn_agent';
    }

    public function description(): string
    {
        return 'Run a focused subagent on ONE self-contained task and get its answer back. Use it when the '
            .'task needs a different tool set than yours, or when its output would flood this conversation: '
            .'searching the repository, a batch of memory edits, a report over many nodes. `task` must be a '
            .'complete brief — the subagent sees none of this conversation, only that text. `profile` picks '
            .'its tools. `max_steps` caps its rounds (1-6, default 4). Any write the subagent wants is '
            .'confirmed by the human first and this run waits for that. Returns its final answer plus what '
            .'it spent. Max 3 subagents per run, one after another — never at the same time.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'task' => [
                    'type' => 'string',
                    'description' => 'Complete, self-contained brief. The subagent sees no history and no '
                        .'context block — everything it needs must be in here.',
                ],
                'profile' => [
                    'type' => 'string',
                    'enum' => ['memory', 'files', 'graph'],
                    'description' => 'Tool set for the subagent. memory = recall, read, overview, learn, '
                        .'rename, move, delete. files = recall, grep, glob, read_file, edit_file, write_file. '
                        .'graph = recall, read, overview, graph_focus, learn.',
                ],
                'max_steps' => [
                    'type' => 'integer',
                    'description' => 'How many rounds the subagent may take, 1-6. Default 4; higher values '
                        .'are clamped, not refused.',
                ],
            ],
            'required' => ['task', 'profile'],
        ];
    }

    public function execute(array $args): ToolResult
    {
        $task = $this->requiredString($args, 'task');

        // Profil sa čítá `optionalString`om, hoci je povinný: prázdny aj chýbajúci
        // profil má dostať tú istú vetu so zoznamom dovolených. „Missing required
        // argument" by model naviedla doplniť čokoľvek, nie vybrať z troch.
        $profile = (string) ($this->optionalString($args, 'profile') ?? '');

        if (! in_array($profile, self::CHILD_PROFILES, true)) {
            return ToolResult::refused(
                'Refused: subagent profile must be one of '.implode(', ', self::CHILD_PROFILES).'.'
            );
        }

        $requested = $this->optionalInt($args, 'max_steps');
        $steps = $this->stepsFor($requested);

        $ctx = AgentContext::current();

        if ($ctx === null) {
            return ToolResult::refused('spawn_agent runs only inside a console run.');
        }

        $parentCall = $this->ownCall($ctx);

        if ($parentCall === null) {
            return ToolResult::refused('spawn_agent runs only inside a console run.');
        }

        $existing = $this->subagent->childRunOf($parentCall);

        if ($existing !== null) {
            // Dieťa už pre tento call existuje. Otvorené = čaká na človeka, takže
            // sa parkuje znova; uzavreté = pokračovanie rodiča po `/decide`, takže
            // sa vráti jeho zhrnutie.
            if ($existing->isOpen()) {
                $pending = $existing->thread?->pendingToolCall();

                if ($pending === null) {
                    return ToolResult::refused(
                        'The subagent for this call is still running. Wait for it instead of starting another.'
                    );
                }

                $ctx->emit($this->subagent->waitFrame($existing, $parentCall, $pending));

                throw new AgentParked;
            }

            return $this->summary($existing, $requested, $steps, $this->answerOf($existing));
        }

        $cap = min((int) config('hades.console.agent.max_children', 3), self::HARD_MAX_CHILDREN);

        if ($this->subagent->childCount($ctx->run()) >= $cap) {
            // ODMIETNUTIE, nie výnimka: model musí dostať výsledok na každé volanie
            // a musí z neho vedieť, čo urobiť inak.
            return ToolResult::refused(
                "Refused: the cap of {$cap} subagents for this run is used up. "
                .'Finish the task yourself or tell the human what is left.'
            );
        }

        $outcome = $this->subagent->start($ctx, $parentCall, $task, $profile, $steps);

        if ($outcome->parked) {
            $pending = $outcome->thread->fresh()?->pendingToolCall();

            if ($pending === null) {
                // Nemá ako nastať (`parked` sa zisťuje z toho istého `pending`
                // riadku), ale keby áno, hodiť `AgentParked` bez rámca `agent_wait`
                // by nechalo ťah rodiča BEZ koncového rámca — a klient by čakal
                // navždy. Zhrnutie je horší z dvoch stavov, ale nie zaseknutý.
                return $this->summary($outcome->run, $requested, $steps, $outcome->answer);
            }

            $ctx->emit($this->subagent->waitFrame($outcome->run, $parentCall, $pending));

            throw new AgentParked;
        }

        return $this->summary($outcome->run, $requested, $steps, $outcome->answer);
    }

    /**
     * Strop kôl podagenta. `max_steps` sa CLAMPUJE, neodmieta: `task` a `profile` sú
     * bezpečnostné, `max_steps` je výkonový — model, ktorý napíše 20, chce „nech to
     * stihne" a odmietnutie by spálilo celé kolo smyčky (~20 s na CPU) za formalitu.
     */
    private function stepsFor(?int $requested): int
    {
        $max = min((int) config('hades.console.agent.max_steps', 6), self::HARD_MAX_STEPS);
        $default = (int) config('hades.console.agent.default_steps', 4);

        return max(1, min($requested ?? $default, $max));
    }

    /**
     * Vlastný riadok v `console_tool_calls` — bez toho, aby ho `AgentRunner` musel
     * podávať.
     *
     * `executeCall()` nastaví `running` PRED volaním toolu, takže riadok existuje;
     * smyčka beží tool cally po jednom, takže najnovší `running` je vždy ten
     * aktuálny. Alternatíva by bola podať `AgentContext` do konštruktora
     * `AgentRunner`a a nastavovať v ňom aktuálny call — teda o dva riadky diffu viac
     * v súbore, ktorého sa má `spawn_agent` dotknúť minimálne.
     */
    private function ownCall(AgentContext $ctx): ?ConsoleToolCall
    {
        return ConsoleToolCall::query()
            ->where('thread_id', $ctx->threadId())
            ->where('name', $this->name())
            ->where('status', 'running')
            ->latest('id')
            ->first();
    }

    /**
     * Zhrnutie podbehu pre model.
     *
     * Čo sa NEVRACIA: výsledky toolov podagenta, jeho história, jeho diffy. To je
     * celý zmysel podagenta — rodič platí ~500 tokenov za odpoveď namiesto ~6000 za
     * priebeh. Prázdne polia sa neposielajú (`null` je 20 B za nulovú informáciu).
     *
     * `max_steps` sa vracia LEN keď sa vyžiadaná hodnota clampovala: model nesmie
     * počítať s tým, čo nedostal, ale pri nezmenenom strope je to znak za nič.
     */
    private function summary(Run $run, ?int $requested, int $steps, string $answer): ToolResult
    {
        $run->refresh();

        // `agent` je UUID podbehu, nie `id`: počet behov nie je informácia, ktorú má
        // dostať model — a `mind_run` uuid prijíma, takže je to použiteľný odkaz.
        $payload = [
            'agent' => $run->uuid,
            'profile' => $run->tool_profile,
            'status' => $run->status === 'done' ? 'done' : 'failed',
            'steps' => (int) $run->steps,
            'tool_calls' => (int) $run->tool_calls,
            'tokens_in' => (int) $run->tokens_in,
            'tokens_out' => (int) $run->tokens_out,
        ];

        if ($run->stop_reason !== null && $run->stop_reason !== '') {
            $payload['stop_reason'] = $run->stop_reason;
        }

        if ($requested !== null && $requested !== $steps) {
            $payload['max_steps'] = $steps;
        }

        [$text, $truncated] = $this->cap(
            $answer,
            max(0, (int) config('hades.console.agent.result_chars', 2000)),
            'the subagent said more; ask it again with a narrower task',
        );

        if ($text !== '') {
            $payload['answer'] = $text;
        }

        if ($truncated) {
            $payload['answer_truncated'] = true;
        }

        if ($payload['status'] === 'failed') {
            $payload['error'] = (string) ($run->error ?: 'Beh spadol. Detail je v logu appky.');
        }

        return ToolResult::json($payload, $truncated);
    }

    /**
     * Odpoveď podbehu, ktorý dokončil až `/decide` — vtedy tool nemá `SubagentOutcome`
     * (dieťa dobehlo v inom segmente requestu), takže sa čítá z jeho vlákna. Jedna
     * implementácia pre obe cesty, v {@see Subagent::answerOf()}.
     */
    private function answerOf(Run $run): string
    {
        $thread = $run->thread;

        return $thread === null ? '' : $this->subagent->answerOf($thread);
    }
}
