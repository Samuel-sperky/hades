<?php

namespace App\Providers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Názvy databáz, na ktorých deštruktívne artisan príkazy povolené SÚ.
     *
     * Okrem `auraai_test` musí prejsť aj `auraai_test_p1` / `auraai_test_p4` / `auraai_test_p7`:
     * W2 dalo každému balíku vlastnú testovaciu DB, aby si paralelné `RefreshDatabase` behy
     * neprepisovali schému pod rukami. Prísne „končí na _test" by tie behy zablokovalo.
     */
    private const TEST_DATABASE_PATTERN = '/_test(?:_[a-z0-9-]+)?$/i';

    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        DB::prohibitDestructiveCommands(
            self::destructiveCommandsProhibitedFor(
                config('database.connections.'.config('database.default').'.database'),
                (bool) config('auraai.allow_destructive_db_commands'),
            )
        );
    }

    /**
     * Majú byť `migrate:fresh`, `migrate:refresh`, `migrate:reset`, `migrate:rollback`
     * a `db:wipe` zakázané pre databázu `$database`?
     *
     * 30. 7. 2026 zmazal `php artisan migrate:fresh --database=mariadb --env=testing --force`
     * živú DB `auraai` (684 uzlov / 2 056 hrán / 6 464 aktivácií). V projekte neexistoval
     * `.env.testing`, takže `--env=testing` načítal obyčajný `.env` s `DB_DATABASE=auraai`.
     * Ani `--env`, ani `--database` databázu neprepnú — `--database` vyberá len názov
     * *connectionu* — a `<env name="DB_DATABASE">` z `phpunit.xml` platí výhradne vtedy,
     * keď appku bootuje PHPUnit.
     *
     * Laravelovské `DB::prohibitDestructiveCommands(app()->isProduction())` tu nepomôže:
     * lokálny stack beží v `local`, takže by bol guard vypnutý presne tam, kde škoda vznikla.
     * Rozhodujúce preto nie je prostredie, ale NÁZOV PRIPOJENEJ DATABÁZY.
     *
     * `isProhibited()` sa v príkazoch vyhodnocuje pred `confirmToProceed()`, takže `--force`
     * tento guard neobíde.
     */
    public static function destructiveCommandsProhibitedFor(?string $database, bool $allowOverride = false): bool
    {
        if ($allowOverride) {
            return false;
        }

        $database = trim((string) $database);

        // Prázdny názov = nevieme, na čom sedíme. Fail-safe: zakázať.
        if ($database === '') {
            return true;
        }

        // In-memory sqlite nemá čo stratiť (a názov nikdy nesedí na vzor nižšie).
        if ($database === ':memory:') {
            return false;
        }

        return preg_match(self::TEST_DATABASE_PATTERN, $database) !== 1;
    }
}
