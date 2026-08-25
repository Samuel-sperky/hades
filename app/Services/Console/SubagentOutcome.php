<?php

namespace App\Services\Console;

use App\Models\ConsoleThread;
use App\Models\Run;

/**
 * Výsledok jedného podbehu — readonly VO, ktorý {@see Subagent::start()} vracia
 * a {@see \App\Services\Console\Tools\SpawnAgentTool} z neho skladá svoj
 * `ToolResult` (respektíve rámec `agent_wait`, keď je `parked`).
 *
 * Cena a stav podbehu sa tu NEKOPÍRUJÚ. Sú v `runs` (`steps`, `tool_calls`,
 * `tokens_in`, `tokens_out`, `status`, `stop_reason`), takže druhá kópia by sa
 * s nimi rozišla v tej istej chvíli, keď by sa zmenil recorder — a `runs` je ten
 * záznam, ktorý uvidí človek na obrazovke Runy aj AI cez `mind_run`.
 *
 * `answer` je **surová** posledná neprázdna asistentská správa podbehu. Skrátenie
 * je až na toole (`BaseTool::cap()`), pretože skrátenie sa musí PRIZNAŤ a priznať
 * ho má ten, kto text reže — VO, ktoré nesie príznak `truncated` a nikdy ho
 * nenastaví, by o sebe tvrdilo niečo, čo nerobí.
 */
final class SubagentOutcome
{
    public function __construct(
        public readonly Run $run,
        public readonly bool $parked,
        public readonly ConsoleThread $thread,
        public readonly string $answer,
    ) {}
}
