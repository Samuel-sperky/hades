<?php

namespace App\Console\Commands;

use App\Models\ConsoleSchedule;
use App\Services\Console\HeadlessRunner;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Plánované behy konzoly — čo agent spustí sám, bez človeka pri klávesnici.
 *
 * Bez argumentov je to telo scheduleru: vezme ZAPNUTÉ rozvrhy, nechá z nich
 * prejsť tie, ktorých cron vyjde na aktuálnu minútu, a každý spustí cez
 * {@see HeadlessRunner} — teda s read-only sadou toolov. Zápisový tool by ťah
 * zaparkoval rámcom `permission` a v noci pri tom nikto nie je: vlákno by zamrzlo
 * natrvalo a odblokovať by ho musel človek v UI.
 *
 * `--enable` je JEDINÁ cesta, ako sa rozvrh zapne. Rozvrh smie vyrobiť aj AI cez
 * MCP tool `console_schedules`, a keby vznikal zapnutý, stačil by jeden zlý odhad
 * modelu (`* * * * *`) na to, aby lokálny model mlel na CPU do rána. Preto je
 * spustenie ľudské rozhodnutie a robí sa z terminálu.
 *
 *   php artisan mind:console-schedules
 *   php artisan mind:console-schedules --list
 *   php artisan mind:console-schedules --enable=6a1f…
 *   php artisan mind:console-schedules --disable=6a1f…
 */
class RunConsoleSchedules extends Command
{
    protected $signature = 'mind:console-schedules
        {--list : Vypíše rozvrhy a ich stav namiesto behu}
        {--enable= : Zapne rozvrh s daným uuid (jediná cesta, ako sa rozvrh spustí)}
        {--disable= : Vypne rozvrh s daným uuid}';

    protected $description = 'Spustí plánované behy konzoly, ktoré sú zapnuté a vychádzajú na túto minútu (read-only)';

    public function handle(HeadlessRunner $runner): int
    {
        if (! blank($this->option('enable'))) {
            return $this->toggle(trim((string) $this->option('enable')), true);
        }

        if (! blank($this->option('disable'))) {
            return $this->toggle(trim((string) $this->option('disable')), false);
        }

        if ($this->option('list')) {
            return $this->showList();
        }

        return $this->runDue($runner);
    }

    /**
     * Behy tejto minúty.
     *
     * `$now` sa zmrazí na začiatku a všetky rozvrhy sa porovnávajú proti tej istej
     * minúte. Lokálny model na CPU beží aj minúty, takže bez toho by rozvrh
     * vyhodnotený na konci dlhého behu spadol do inej minúty ako ten prvý — raz by
     * sa preskočil, raz by vyšiel dvakrát.
     */
    private function runDue(HeadlessRunner $runner): int
    {
        $now = now();
        $ran = 0;
        $failed = 0;

        foreach (ConsoleSchedule::enabled()->orderBy('id')->get() as $schedule) {
            // Guard obopína aj vyhodnotenie cronu, nie len beh. Riadok upravený
            // ručne v DB obchádza validáciu modelu, `CronExpression` na ňom vyhodí
            // výnimku — a jeden taký rozvrh nesmie zhodiť tie za sebou.
            try {
                if (! $schedule->isDue($now)) {
                    continue;
                }

                $ran++;

                if (! $this->runOne($schedule, $runner)) {
                    $failed++;
                }
            } catch (Throwable $e) {
                $failed++;
                Log::error('Console schedule crashed', [
                    'uuid' => $schedule->uuid,
                    'e' => $e->getMessage(),
                    'at' => $e->getFile().':'.$e->getLine(),
                ]);
                $this->line("✗ {$schedule->label} ({$schedule->uuid}): spadol — {$e->getMessage()}");
            }
        }

        if ($ran === 0) {
            $this->line('Na túto minútu nevychádza žiadny zapnutý rozvrh.');
        }

        // Nenulový kód je tu jediná stopa, ktorú vidí `onFailure` scheduleru aj
        // človek, čo príkaz spustil ručne.
        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Jeden beh. Vracia `true`, keď ťah dobehol.
     *
     * Každý beh ide do NOVÉHO vlákna. Pokračovanie v tom istom by znamenalo, že
     * nočný beh platí kontext všetkých predchádzajúcich nocí — na CPU inferencii
     * je kontext hlavná cena a po týždni by rozvrh nedobehol vôbec.
     *
     * `last_run_at` sa zapíše aj pri chybe: hovorí „pokus bol", nie „vyšlo to".
     * Bez toho by sa v `--list` nedalo rozlíšiť rozvrh, ktorý zlyháva každú noc,
     * od rozvrhu, ktorý nikdy nebežal.
     */
    private function runOne(ConsoleSchedule $schedule, HeadlessRunner $runner): bool
    {
        $result = $runner->run($schedule->prompt, null, [
            'provider' => $schedule->provider,
            'model' => $schedule->model,
        ]);

        $schedule->last_run_at = now();
        $schedule->last_thread_id = $result['thread'] ?? null;
        $schedule->save();

        if (isset($result['error'])) {
            Log::error('Console schedule failed', ['uuid' => $schedule->uuid, 'e' => $result['error']]);
            $this->line("✗ {$schedule->label} ({$schedule->uuid}): {$result['error']}");

            return false;
        }

        $tools = count($result['tools'] ?? []);
        $this->line(sprintf(
            '✓ %s (%s): vlákno %s, %d krokov, %d toolov, %d tokenov von',
            $schedule->label,
            $schedule->uuid,
            $result['thread'],
            (int) ($result['steps'] ?? 0),
            $tools,
            (int) ($result['tokens_out'] ?? 0),
        ));

        return true;
    }

    /** Zapnutie/vypnutie podľa uuid — `id` sa tu zámerne neprijíma. */
    private function toggle(string $uuid, bool $enabled): int
    {
        $schedule = ConsoleSchedule::where('uuid', $uuid)->first();

        if ($schedule === null) {
            $this->error("Taký rozvrh neexistuje: {$uuid}");

            return self::FAILURE;
        }

        $schedule->enabled = $enabled;
        $schedule->save();

        $this->info(sprintf(
            '%s: %s (%s)',
            $schedule->label,
            $enabled ? 'ZAPNUTÝ' : 'vypnutý',
            $schedule->cron,
        ));

        return self::SUCCESS;
    }

    /** Stav rozvrhov. Vypnuté sa vypisujú tiež — inak by AI-vyrobený rozvrh zmizol. */
    private function showList(): int
    {
        $schedules = ConsoleSchedule::orderBy('id')->get();

        if ($schedules->isEmpty()) {
            $this->line('Žiadne rozvrhy.');

            return self::SUCCESS;
        }

        $this->table(
            ['uuid', 'stav', 'cron', 'label', 'posledný beh', 'najbližšie'],
            $schedules->map(fn (ConsoleSchedule $schedule) => [
                $schedule->uuid,
                $schedule->enabled ? 'zapnutý' : 'vypnutý',
                $schedule->cron,
                $schedule->label,
                $schedule->last_run_at?->format('Y-m-d H:i') ?? '—',
                // najbližší čas má zmysel len pri zapnutom rozvrhu; pri vypnutom by
                // to bol sľub behu, ktorý sa nestane
                $schedule->enabled ? $schedule->nextRunAt()->format('Y-m-d H:i') : '—',
            ])->all(),
        );

        return self::SUCCESS;
    }
}
