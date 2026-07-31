<?php

namespace App\Jobs;

use App\Events\AgentPulse;
use App\Models\AgentRun;
use App\Services\Agents\AgentRegistry;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Artisan;
use Throwable;

/**
 * Spustí jeden konzolový príkaz agenta na pozadí (queue:work redis) a živo
 * reportuje priebeh cez AgentPulse. Prvý ShouldQueue job v projekte.
 *
 * Bezpečnostné poistky:
 *  - zrušenie pred štartom (status paused/cancelled) sa rešpektuje,
 *  - deštruktívny agent sa bez maintenance.destructive_enabled NEspustí,
 *  - pozastavenie počas behu (status→paused v DB) preruší job medzi krokmi.
 *
 * Artisan::call nie je streamovací, takže progres je heuristický: 50 % pred
 * behom a nazbieraný výstup + 100 % po ňom. Výstup sa rozseká na riadky a
 * pošle ako run.log.
 */
class RunAgentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Ťažké joby (rewire, embed) môžu bežať dlho. */
    public int $timeout = 1800;

    public function __construct(public int $agentRunId) {}

    public function handle(): void
    {
        $run = AgentRun::find($this->agentRunId);
        if ($run === null) {
            return;
        }

        // Zrušenie pred štartom — rešpektuj a skonči ticho.
        if (in_array($run->status, ['paused', 'cancelled'], true)) {
            return;
        }

        $agent = AgentRegistry::find($run->agent_key);
        if ($agent === null) {
            $this->fail($run, 'Neznámy agent: '.$run->agent_key);

            return;
        }

        // Placeholder (workforce koncept) sa nedá spustiť.
        if (($agent['placeholder'] ?? false) === true || ($agent['command'] ?? null) === null) {
            $this->fail($run, 'Tento agent je zatiaľ len koncept a nedá sa spustiť.');

            return;
        }

        // Bezpečnostná poistka: deštruktívne joby sa z UI nespustia bez flagu.
        if (($agent['destructive'] ?? false) === true && ! self::destructiveEnabled()) {
            $this->fail($run, 'Deštruktívny agent je vypnutý.');

            return;
        }

        try {
            $run->update([
                'status' => 'running',
                'progress' => 10,
                'step' => 'Spúšťam '.$agent['command'],
                'started_at' => now(),
            ]);
            AgentPulse::dispatch($run->agent_key, 'run.started', [
                'run_id' => $run->id,
                'command' => $agent['command'],
            ]);

            // Zrušenie tesne pred spustením.
            if ($this->isCancelled($run)) {
                $this->markPaused($run);

                return;
            }

            $run->update(['progress' => 50, 'step' => 'Beží príkaz '.$agent['command']]);
            AgentPulse::dispatch($run->agent_key, 'run.progress', [
                'progress' => 50,
                'step' => 'Beží príkaz '.$agent['command'],
            ]);

            $exitCode = Artisan::call($agent['command']);
            $output = trim(Artisan::output());

            // Zrušenie počas behu — nezapisuj ako done.
            if ($this->isCancelled($run)) {
                $this->markPaused($run, $output);

                return;
            }

            $lines = $output === '' ? [] : preg_split('/\r\n|\r|\n/', $output);
            foreach (array_chunk($lines, 40) as $chunk) {
                AgentPulse::dispatch($run->agent_key, 'run.log', ['lines' => $chunk]);
            }

            $ok = $exitCode === 0;
            $run->update([
                'status' => $ok ? 'done' : 'failed',
                'progress' => 100,
                'step' => $ok ? 'Hotovo' : 'Zlyhalo',
                'log' => $output,
                'stats' => ['exit_code' => $exitCode, 'lines' => count($lines)],
                'message' => $ok ? null : 'Príkaz skončil s kódom '.$exitCode.'.',
                'finished_at' => now(),
            ]);
            AgentPulse::dispatch($run->agent_key, $ok ? 'run.done' : 'run.failed', [
                'progress' => 100,
                'exit_code' => $exitCode,
                'message' => $ok ? null : 'Príkaz skončil s kódom '.$exitCode.'.',
            ]);
        } catch (Throwable $e) {
            $run->update([
                'status' => 'failed',
                'step' => 'Chyba',
                'message' => mb_substr($e->getMessage(), 0, 500),
                'finished_at' => now(),
            ]);
            AgentPulse::dispatch($run->agent_key, 'run.failed', ['message' => $run->message]);
        }
    }

    /** Beh bol medzičasom v DB označený na pozastavenie. */
    private function isCancelled(AgentRun $run): bool
    {
        return $run->fresh()?->status === 'paused';
    }

    private function markPaused(AgentRun $run, ?string $output = null): void
    {
        $run->update([
            'status' => 'paused',
            'step' => 'Pozastavené',
            'log' => $output ?? $run->log,
            'finished_at' => now(),
        ]);
        AgentPulse::dispatch($run->agent_key, 'run.paused', ['message' => 'Beh pozastavený.']);
    }

    private function fail(AgentRun $run, string $message): void
    {
        $run->update([
            'status' => 'failed',
            'step' => 'Zlyhalo',
            'message' => $message,
            'finished_at' => now(),
        ]);
        AgentPulse::dispatch($run->agent_key, 'run.failed', ['message' => $message]);
    }

    private static function destructiveEnabled(): bool
    {
        return (bool) config('maintenance.destructive_enabled', config('auraai.destructive_jobs_enabled'));
    }
}
