<?php

namespace Tests\Feature;

use App\Providers\AppServiceProvider;
use Illuminate\Database\Console\Migrations\FreshCommand;
use Illuminate\Database\Console\WipeCommand;
use Illuminate\Support\Facades\DB;
use ReflectionClass;
use Tests\TestCase;

/**
 * Zapojenie guardu, nie jeho logika (tú pokrýva Tests\Unit\DestructiveDbGuardTest).
 * Overuje, že `AppServiceProvider::boot()` naozaj prepne statický stav príkazov.
 */
class DestructiveDbGuardTest extends TestCase
{
    protected function tearDown(): void
    {
        // Statický zámok je globálny stav. Keby tu zostal zapnutý, `RefreshDatabase`
        // v nasledujúcich testoch by prestala vedieť premigrovať testovaciu DB.
        DB::prohibitDestructiveCommands(false);

        parent::tearDown();
    }

    /**
     * Čítanie chráneného statického stavu z traitu Illuminate\Console\Prohibitable.
     * Reflexia je tu zámerná — je to jediný spôsob, ako overiť guard bez toho, aby
     * test naozaj spustil `db:wipe`.
     */
    private function prohibited(string $command): bool
    {
        $property = (new ReflectionClass($command))->getProperty('prohibitedFromRunning');
        $property->setAccessible(true);

        return (bool) $property->getValue();
    }

    private function bootGuardFor(string $database): void
    {
        config(['database.connections.'.config('database.default').'.database' => $database]);

        (new AppServiceProvider($this->app))->boot();
    }

    public function test_suita_bezi_na_testovacej_db_a_guard_ju_nezamkne(): void
    {
        // phpunit.xml nastavuje DB_DATABASE=auraai_test → migrate:fresh musí zostať povolený,
        // inak by guard rozbil RefreshDatabase v celej suite.
        $this->assertMatchesRegularExpression(
            '/_test(?:_[a-z0-9-]+)?$/i',
            (string) config('database.connections.'.config('database.default').'.database')
        );

        (new AppServiceProvider($this->app))->boot();

        $this->assertFalse($this->prohibited(FreshCommand::class));
        $this->assertFalse($this->prohibited(WipeCommand::class));
    }

    public function test_guard_zamkne_destruktivne_prikazy_na_zivej_db(): void
    {
        $this->bootGuardFor('auraai');

        // Presne tie príkazy, ktoré 30. 7. 2026 zmazali živú sieť.
        $this->assertTrue($this->prohibited(FreshCommand::class));
        $this->assertTrue($this->prohibited(WipeCommand::class));
    }

    public function test_nudzovy_vypinac_guard_odomkne(): void
    {
        config(['auraai.allow_destructive_db_commands' => true]);

        $this->bootGuardFor('auraai');

        $this->assertFalse($this->prohibited(FreshCommand::class));
        $this->assertFalse($this->prohibited(WipeCommand::class));
    }
}
