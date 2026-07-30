<?php

namespace Tests\Unit;

use App\Providers\AppServiceProvider;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Rozhodovacia logika guardu z incidentu 30. 7. 2026 (zmazaná živá DB `auraai`).
 * Čistá funkcia, žiadny boot appky — testuje sa výhradne tvar rozhodnutia.
 */
class DestructiveDbGuardTest extends TestCase
{
    /**
     * @return array<string, array{0: ?string, 1: bool}>
     */
    public static function databaseNames(): array
    {
        return [
            // živé databázy — zakázať
            'živá auraai' => ['auraai', true],
            'starý hades' => ['hades', true],
            'iný projekt' => ['sperky_ai', true],
            'testovo vyzerajúci prefix nestačí' => ['test_auraai', true],
            'podobné, ale nie _test' => ['auraai_testing', true],
            'auraai_tests (množné číslo)' => ['auraai_tests', true],

            // testovacie databázy — povoliť
            'phpunit DB' => ['auraai_test', false],
            'balík P1' => ['auraai_test_p1', false],
            'balík P4' => ['auraai_test_p4', false],
            'balík P7' => ['auraai_test_p7', false],
            'pomlčka v suffixe' => ['auraai_test_ci-2', false],
            'veľké písmená' => ['AURAAI_TEST', false],
            'sqlite in-memory' => [':memory:', false],

            // neznámy stav — fail-safe zakázať
            'null' => [null, true],
            'prázdny string' => ['', true],
            'samé medzery' => ['   ', true],
        ];
    }

    #[DataProvider('databaseNames')]
    public function test_rozhoduje_podla_nazvu_databazy(?string $database, bool $expected): void
    {
        $this->assertSame(
            $expected,
            AppServiceProvider::destructiveCommandsProhibitedFor($database),
            "Databáza [".var_export($database, true)."] mala dať ".var_export($expected, true)
        );
    }

    public function test_nudzovy_vypinac_povoli_aj_zivu_databazu(): void
    {
        $this->assertTrue(AppServiceProvider::destructiveCommandsProhibitedFor('auraai'));
        $this->assertFalse(AppServiceProvider::destructiveCommandsProhibitedFor('auraai', allowOverride: true));
    }

    public function test_vypinac_prebije_aj_fail_safe_pri_neznamej_databaze(): void
    {
        // Vypínač je vedomé rozhodnutie operátora — ak ho zapne, prejde aj neznámy názov.
        $this->assertFalse(AppServiceProvider::destructiveCommandsProhibitedFor(null, allowOverride: true));
    }
}
