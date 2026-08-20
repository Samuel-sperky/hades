<?php

namespace Tests\Feature;

use App\Services\Console\Tools\UnifiedDiff;
use Tests\TestCase;

/**
 * Náhľad zmeny je jediné, na čo sa človek pri povoľovaní zápisu pozerá — a je to
 * jediné miesto v Charónovi, kde brána reálne nesie váhu. Preto sa tu testuje
 * vlastnosť, ktorá znie triviálne: **náhľad nesmie tvrdiť „bez zmeny", keď sa
 * súbor zmení.**
 *
 * Nájdené review agentom 19. 8. 2026: `lines()` reže na `/\r\n|\n|\r/` a odstrihne
 * posledný prázdny prvok, takže zmena len v koncoch riadkov dala IDENTICKÉ polia
 * riadkov, `hunks()` vrátilo prázdno a `between()` spadlo do vetvy „Bez zmeny" —
 * hoci `plan()` už predtým zistilo, že sa bajty líšia, a `execute()` zápis vykonal.
 * Scenár: model zavolá edit_file, ktorý ubere posledný nový riadok; karta povie
 * „Bez zmeny", človek to logicky povolí a súbor sa zmení. Pri `write_file` nad
 * windowsovým checkoutom v linuxovom kontejneri to prepíše konce riadkov v celom
 * súbore — a to je presne tento repozitár.
 */
class ConsoleDiffPreviewTest extends TestCase
{
    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function invisibleChanges(): array
    {
        return [
            'ubratý nový riadok na konci' => ["a\nb\n", "a\nb"],
            'pridaný nový riadok na konci' => ["a\nb", "a\nb\n"],
            'CRLF na LF' => ["a\r\nb\r\n", "a\nb\n"],
            'LF na CRLF' => ["a\nb\n", "a\r\nb\r\n"],
            'samotné CR na LF' => ["a\rb\r", "a\nb\n"],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invisibleChanges')]
    public function test_invisible_change_is_never_reported_as_no_change(string $before, string $after): void
    {
        $this->assertNotSame($before, $after, 'Kalibrácia: prípad musí naozaj meniť bajty.');

        $preview = UnifiedDiff::between($before, $after, 'f.txt');

        $this->assertStringNotContainsString(
            'Bez zmeny',
            $preview,
            "Náhľad tvrdí „bez zmeny\", ale zápis súbor zmení: ".json_encode([$before, $after]),
        );
        $this->assertStringContainsString('koncoch riadkov', $preview);
        // Človek musí vidieť, čoho sa to týka — inak nemá z čoho rozhodnúť.
        $this->assertStringContainsString('bajtov', $preview);
    }

    public function test_line_ending_change_names_the_direction(): void
    {
        $preview = UnifiedDiff::between("a\r\nb\r\n", "a\nb\n", 'f.txt');

        $this->assertStringContainsString('CRLF zakončení: 2 → 0', $preview);
    }

    public function test_trailing_newline_change_is_named(): void
    {
        $preview = UnifiedDiff::between("a\nb\n", "a\nb", 'f.txt');

        $this->assertStringContainsString('nový riadok na konci: áno → nie', $preview);
    }

    /** Identické bajty sú jediný prípad, kde „bez zmeny" je pravda. */
    public function test_identical_content_still_says_no_change(): void
    {
        $this->assertStringContainsString('Bez zmeny', UnifiedDiff::between("a\n", "a\n", 'f.txt'));
    }

    /** Kalibrácia: skutočná zmena riadku musí stále dávať normálny diff. */
    public function test_a_real_change_still_produces_a_diff(): void
    {
        $preview = UnifiedDiff::between("a\nb\n", "a\nc\n", 'f.txt');

        $this->assertStringContainsString('--- a/f.txt', $preview);
        $this->assertStringContainsString('-b', $preview);
        $this->assertStringContainsString('+c', $preview);
        $this->assertStringNotContainsString('koncoch riadkov', $preview);
    }
}
