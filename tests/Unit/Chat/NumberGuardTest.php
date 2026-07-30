<?php

namespace Tests\Unit\Chat;

use App\Services\Chat\NumberGuard;
use PHPUnit\Framework\TestCase;

/**
 * „Model nikdy negeneruje čísla" musí platiť aj počas streamovania, keď sa už
 * odoslaný token nedá vziať späť. Guard preto zadrží každý beh číslic, kým ho
 * neoverí proti podkladu.
 */
class NumberGuardTest extends TestCase
{
    public function test_prepusti_cislo_ktore_je_v_podklade(): void
    {
        $guard = new NumberGuard('V pamäti mám 679 uzlov a 2037 hrán.');

        $out = $guard->push('Mám 679 uzlov').$guard->flush();

        $this->assertSame('Mám 679 uzlov', $out);
        $this->assertSame(0, $guard->dropped());
    }

    public function test_zahodi_vymyslene_cislo(): void
    {
        $guard = new NumberGuard('V pamäti mám 679 uzlov.');

        $out = $guard->push('Mám 1234 uzlov').$guard->flush();

        $this->assertStringNotContainsString('1234', $out);
        $this->assertSame(1, $guard->dropped());
    }

    public function test_oddelovac_tisicov_je_to_iste_cislo(): void
    {
        $guard = new NumberGuard('Sieť má 2 037 hrán.');

        $out = $guard->push('Hrán je 2037.').$guard->flush();

        $this->assertSame('Hrán je 2037.', $out);
        $this->assertSame(0, $guard->dropped());
    }

    public function test_cislo_rozdelene_medzi_delty_sa_neposiela_po_castiach(): void
    {
        $guard = new NumberGuard('Mám 679 uzlov.');

        // Prvá delta nesie „67", druhá „9" — guard nesmie poslať „67" samostatne.
        $first = $guard->push('Mám 67');
        $second = $guard->push('9 uzlov');

        $this->assertSame('Mám ', $first);
        $this->assertSame('679 uzlov', $second.$guard->flush());
        $this->assertSame(0, $guard->dropped());
    }

    public function test_cislo_na_konci_odpovede_sa_vyplachne(): void
    {
        $guard = new NumberGuard('Verzia 12.');

        $out = $guard->push('Verzia 12').$guard->flush();

        $this->assertSame('Verzia 12', $out);
    }

    public function test_text_bez_cisel_prejde_nezmeneny(): void
    {
        $guard = new NumberGuard('podklad');

        $this->assertSame('Ahoj, ako sa máš?', $guard->push('Ahoj, ako sa máš?').$guard->flush());
    }
}
