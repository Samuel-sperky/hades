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
    protected function setUp(): void
    {
        parent::setUp();

        config(['hades.ui_token' => static::UI_TOKEN]);

        $this->withHeader(AuthenticateUi::HEADER, static::UI_TOKEN);
    }
}
