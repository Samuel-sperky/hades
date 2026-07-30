<?php

namespace Tests\Unit\Chat;

use App\Services\Brain\SecretScanner;
use App\Services\Chat\RephraseValidator;
use Tests\TestCase;

/**
 * Brána medzi modelom a používateľom. Odpoveď, ktorá zmení hoci jedno číslo,
 * musí byť zahodená — pravidlo „model nikdy negeneruje čísla" je vlastnosť
 * tohto kódu, nie prosba v systémovom prompte.
 */
class RephraseValidatorTest extends TestCase
{
    private RephraseValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new RephraseValidator(new SecretScanner);
    }

    public function test_prepusti_preformulovanie_s_rovnakymi_cislami(): void
    {
        $template = 'V pamäti mám 679 uzlov a 2037 hrán.';

        $this->assertSame(
            'Mám 679 uzlov a 2037 hrán.',
            $this->validator->validate($template, 'Mám 679 uzlov a 2037 hrán.'),
        );
    }

    public function test_zahodi_preformulovanie_so_zmenenym_cislom(): void
    {
        $template = 'V pamäti mám 679 uzlov.';

        $this->assertNull($this->validator->validate($template, 'V pamäti mám 680 uzlov.'));
        $this->assertNull($this->validator->validate($template, 'V pamäti mám uzly.'));
        $this->assertNull($this->validator->validate($template, 'Mám 679 uzlov a 12 hrán.'));
    }

    public function test_oddelovac_tisicov_nie_je_zmena_cisla(): void
    {
        $this->assertNotNull($this->validator->validate('Mám 2 037 hrán.', 'Mám 2037 hrán.'));
    }

    public function test_zahodi_uvazovanie_nahlas(): void
    {
        $template = 'Mám 5 skillov.';

        // Reálny výstup qwen3:4b bez JSON obalu (meranie 30. 7. 2026).
        $this->assertNull($this->validator->validate($template, 'Okay, the user wants me to rephrase. Mám 5 skillov.'));
        $this->assertNull($this->validator->validate($template, "Let me think. Mám 5 skillov."));
    }

    public function test_zahodi_odpoved_s_tajomstvom(): void
    {
        $template = 'Token nemám.';

        // Vzorka je vymyslená, bez číslic — nech test padne na SecretScanneri,
        // nie na kontrole čísel.
        $this->assertNull($this->validator->validate($template, 'Token nemám. bearer abcdefghijklmnopqrstuvwxyz'));
    }

    public function test_zahodi_prilis_dlhu_odpoved(): void
    {
        $template = 'Mám 1 skill.';

        $this->assertNull($this->validator->validate($template, 'Mám 1 skill. '.str_repeat('a', 400)));
    }

    public function test_titulok_smie_cisla_vypustit_ale_nie_pridat(): void
    {
        $source = 'Ako nastavím dopravu pre 3 krajiny?';

        $this->assertSame('Nastavenie dopravy', $this->validator->validateTitle($source, 'Nastavenie dopravy'));
        $this->assertSame('Doprava pre 3 krajiny', $this->validator->validateTitle($source, 'Doprava pre 3 krajiny'));
        $this->assertNull($this->validator->validateTitle($source, 'Doprava pre 7 krajín'));
    }

    public function test_titulok_ma_strop_dlzky(): void
    {
        $this->assertNull($this->validator->validateTitle('otázka', str_repeat('a', 61)));
    }
}
