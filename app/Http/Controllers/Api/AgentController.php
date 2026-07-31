<?php

namespace App\Http\Controllers\Api;

use App\Events\AgentPulse;
use App\Http\Controllers\Controller;
use App\Jobs\RunAgentJob;
use App\Models\AgentRun;
use App\Services\Agents\AgentRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Command centre agentov (obrazovky DASHBOARDS + CHART). Tenký wrapper nad
 * statickým AgentRegistry a queue jobom RunAgentJob — validácia inline, JSON
 * cez response()->json().
 *
 * Deštruktívne agenty sa z UI nespustia bez maintenance.destructive_enabled:
 * vracajú 423 s error 'destructive_disabled', aby UI vedelo zobraziť, že sú
 * vypnuté (rozhodnutie #32).
 */
class AgentController extends Controller
{
    /** Zoznam agentov + posledný beh + súhrn pre command centre. */
    public function index(): JsonResponse
    {
        $agents = AgentRegistry::all();
        $keys = array_column($agents, 'key');

        // Posledný beh na agenta (id desc, prvý výskyt vyhráva).
        $latest = [];
        foreach (AgentRun::whereIn('agent_key', $keys)->orderByDesc('id')->get() as $run) {
            $latest[$run->agent_key] ??= $run;
        }

        $running = 0;
        $out = [];
        foreach ($agents as $agent) {
            $run = $latest[$agent['key']] ?? null;
            if ($run !== null && in_array($run->status, ['queued', 'running'], true)) {
                $running++;
            }

            $out[] = $agent + [
                'latest_run' => $run === null ? null : [
                    'id' => $run->id,
                    'status' => $run->status,
                    'progress' => $run->progress,
                    'step' => $run->step,
                    'finished_at' => $run->finished_at?->toIso8601String(),
                ],
                'next_run' => $agent['schedule'],
            ];
        }

        return response()->json([
            'agents' => $out,
            'summary' => [
                'total' => count($agents),
                'autonomous' => count(array_filter($agents, fn (array $a): bool => $a['autonomy'] === 'autonomous')),
                'running' => $running,
            ],
            'destructive_enabled' => $this->destructiveEnabled(),
        ]);
    }

    /** Zaradí agenta do fronty na spustenie. */
    public function run(Request $request, string $key): JsonResponse
    {
        $agent = AgentRegistry::find($key);
        if ($agent === null) {
            return response()->json(['error' => 'not_found', 'message' => 'Agent neexistuje.'], 404);
        }

        if (($agent['placeholder'] ?? false) === true) {
            return response()->json([
                'error' => 'placeholder',
                'message' => 'Tento agent je zatiaľ len koncept a nedá sa spustiť.',
            ], 422);
        }

        if (($agent['destructive'] ?? false) === true && ! $this->destructiveEnabled()) {
            return response()->json([
                'error' => 'destructive_disabled',
                'message' => 'Deštruktívny agent je vypnutý. Zapni ho až po schválení dry-run reportu.',
            ], 423);
        }

        $run = AgentRun::create([
            'agent_key' => $agent['key'],
            'status' => 'queued',
            'progress' => 0,
            'step' => 'V rade',
        ]);
        RunAgentJob::dispatch($run->id);

        return response()->json(['run' => $this->runSummary($run)], 201);
    }

    /** Pozastaví posledný čakajúci/bežiaci beh agenta (job to zachytí medzi krokmi). */
    public function pause(Request $request, string $key): JsonResponse
    {
        $agent = AgentRegistry::find($key);
        if ($agent === null) {
            return response()->json(['error' => 'not_found', 'message' => 'Agent neexistuje.'], 404);
        }

        $run = AgentRun::where('agent_key', $key)
            ->whereIn('status', ['queued', 'running'])
            ->orderByDesc('id')
            ->first();

        if ($run === null) {
            return response()->json([
                'error' => 'not_running',
                'message' => 'Žiadny bežiaci beh na pozastavenie.',
            ], 409);
        }

        $run->update(['status' => 'paused', 'step' => 'Pozastavené']);
        AgentPulse::dispatch($key, 'run.paused', ['run_id' => $run->id, 'message' => 'Beh pozastavený.']);

        return response()->json(['run' => $this->runSummary($run)]);
    }

    /** Posledných ~20 behov agenta (bez poľa log). */
    public function runs(string $key): JsonResponse
    {
        $runs = AgentRun::where('agent_key', $key)
            ->orderByDesc('id')
            ->limit(20)
            ->get(['id', 'agent_key', 'status', 'progress', 'step', 'stats', 'message', 'started_at', 'finished_at', 'created_at']);

        return response()->json([
            'runs' => $runs->map(fn (AgentRun $run): array => $this->runSummary($run))->all(),
        ]);
    }

    /** Detail jedného behu vrátane log. */
    public function showRun(int $id): JsonResponse
    {
        $run = AgentRun::find($id);
        if ($run === null) {
            return response()->json(['error' => 'not_found', 'message' => 'Beh neexistuje.'], 404);
        }

        return response()->json(['run' => $this->runSummary($run, true)]);
    }

    /**
     * @return array<string, mixed>
     */
    private function runSummary(AgentRun $run, bool $withLog = false): array
    {
        $out = [
            'id' => $run->id,
            'agent_key' => $run->agent_key,
            'status' => $run->status,
            'progress' => $run->progress,
            'step' => $run->step,
            'stats' => $run->stats,
            'message' => $run->message,
            'started_at' => $run->started_at?->toIso8601String(),
            'finished_at' => $run->finished_at?->toIso8601String(),
            'created_at' => $run->created_at?->toIso8601String(),
        ];

        if ($withLog) {
            $out['log'] = $run->log;
        }

        return $out;
    }

    private function destructiveEnabled(): bool
    {
        return (bool) config('maintenance.destructive_enabled', config('auraai.destructive_jobs_enabled'));
    }
}
