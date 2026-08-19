<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Cron\CronExpression;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Jeden plánovaný beh konzoly. `uuid` je verejný identifikátor (MCP, artisan),
 * `id` zostáva vnútri.
 *
 * Cron výraz sa validuje pri UKLADANÍ, nie pri behu scheduleru. Rozvrh zakladá aj
 * AI cez MCP a preklep v cron výraze je jej najbežnejšia chyba; keby sa odhalil až
 * v nočnom behu, `mind:console-schedules` by na ňom padol o 03:00 do logu, ktorý
 * nikto nečíta, a autor rozvrhu by dostal potvrdenie „vytvorené". Preto sa
 * neplatný výraz odmieta hneď výnimkou — v MCP odpovedi z toho je chyba s textom.
 */
class ConsoleSchedule extends Model
{
    protected $fillable = ['uuid', 'label', 'prompt', 'cron', 'provider', 'model', 'enabled', 'last_run_at', 'last_thread_id'];

    protected $casts = [
        'enabled' => 'bool',
        'last_run_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $schedule) {
            $schedule->uuid ??= (string) Str::uuid();
        });

        // `saving`, nie `creating`: nezmysel sa nemá dostať do DB ani úpravou
        // existujúceho rozvrhu.
        static::saving(function (self $schedule) {
            self::assertValidCron((string) $schedule->cron);
        });
    }

    /** Rozvrhy, ktoré človek zapol — jediné, ktoré scheduler vôbec berie do ruky. */
    public function scopeEnabled(Builder $query): Builder
    {
        return $query->where('enabled', true);
    }

    /**
     * Má tento rozvrh bežať v danej minúte?
     *
     * Porovnáva sa minúta, nie sekunda — `CronExpression` sekundy zahodí, takže
     * rozvrh vyjde raz za minútu a nie šesťdesiatkrát.
     *
     * Výraz sa parsuje pri každom volaní zámerne: memoizácia by po zmene atribútu
     * `cron` odpovedala podľa starého výrazu a `--list` po `update()` by lživo
     * hlásil pôvodný čas.
     */
    public function isDue(?CarbonInterface $now = null): bool
    {
        return $this->expression()->isDue($now ?? now());
    }

    /** Kedy rozvrh vyjde najbližšie — pre `--list`, aby človek videl, čo ho čaká. */
    public function nextRunAt(?CarbonInterface $now = null): CarbonInterface
    {
        return Carbon::instance($this->expression()->getNextRunDate($now ?? now()));
    }

    /**
     * Overí cron výraz a vyhodí `InvalidArgumentException`, keď neplatí.
     *
     * Verejná preto, že to isté overenie potrebuje aj vstup, ktorý sa ešte
     * neukladá (MCP `create` chce chybu vrátiť pred zápisom).
     *
     * @throws \InvalidArgumentException
     */
    public static function assertValidCron(string $cron): void
    {
        $cron = trim($cron);

        if ($cron === '') {
            throw new \InvalidArgumentException('Cron expression is empty.');
        }

        if (! CronExpression::isValidExpression($cron)) {
            throw new \InvalidArgumentException("Invalid cron expression: {$cron}");
        }
    }

    private function expression(): CronExpression
    {
        return new CronExpression(trim((string) $this->cron));
    }
}
