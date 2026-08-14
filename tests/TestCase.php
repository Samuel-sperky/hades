<?php

namespace Tests;

use App\Http\Middleware\AuthenticateUi;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /** Token UI okruhu pre celý testovací balík. */
    public const UI_TOKEN = 'test-ui-token';

    /**
     * Interné `/api/*` sú od 13. 8. 2026 za UI guardom (AuthenticateUi), takže
     * každý test, ktorý ich volá, potrebuje odomknutie. Posielame ho ako default
     * hlavičku — nie cez session — aby to nemusel riešiť každý test zvlášť a aby
     * sa medzi requestami nemusela udržiavať session.
     *
     * Testy samotného guardu si hlavičku zhodia cez `flushHeaders()`.
     */
    /**
     * Poistka MUSÍ byť tu, nie v `setUp()`.
     *
     * `RefreshDatabase` sa spúšťa práve odtiaľto, zo `setUpTraits()`. Kontrola
     * až po `parent::setUp()` by prišla po tom, čo sú tabuľky zahodené — teda
     * po škode. Aplikácia už v tomto bode existuje, takže config je dostupný.
     */
    protected function setUpTraits()
    {
        $this->refuseToRunAgainstLiveData();

        return parent::setUpTraits();
    }

    protected function setUp(): void
    {
        parent::setUp();

        config(['hades.ui_token' => static::UI_TOKEN]);

        $this->withHeader(AuthenticateUi::HEADER, static::UI_TOKEN);
    }

    /**
     * Poistka proti zmazaniu ostrej pamäte.
     *
     * Časť testov potrebuje MariaDB (searchNodes stojí na COLLATE), takže sada
     * sa dá pustiť aj proti nej. `RefreshDatabase` ale tabuľky ZAHODÍ — jeden
     * preklep v premennej prostredia by tak vymazal celého Hadesa, a to je
     * strata, ktorú nič nevráti.
     *
     * Meno databázy musí preto končiť na `_test`. Nič iné sa nespustí.
     */
    private function refuseToRunAgainstLiveData(): void
    {
        $connection = config('database.default');

        if (! in_array(config("database.connections.{$connection}.driver"), ['mysql', 'mariadb'], true)) {
            return;
        }

        $database = (string) config("database.connections.{$connection}.database");

        if (! str_ends_with($database, '_test')) {
            $this->fail("Testy odmietajú bežať nad databázou „{$database}“ — meno musí končiť na _test.");
        }
    }
}
