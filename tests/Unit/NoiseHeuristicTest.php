<?php

namespace Tests\Unit;

use App\Models\Node;
use App\Services\MindService;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Odpadový uzol očami AI konzumenta ({@see MindService::noiseOf}).
 *
 * Audit siete našiel štyri opakované vzory, ktoré v recalle vyzerajú ako
 * poznatok, ale nič nehovoria: surový prompt uložený ako label, markdown
 * zabudnutý v labeli, strojový slug generátora mien a uzol bez popisu.
 * Heuristika ich označí — recall ich potom radí za čisté uzly a AI vie, že
 * im nemá veriť ako zdroju.
 *
 * Test nesmie byť voľnejší než realita: chytá aj falošné poplachy, pretože
 * označiť dobrý uzol za odpad je horšia chyba než ten odpad prehliadnuť.
 */
class NoiseHeuristicTest extends TestCase
{
    private MindService $mind;

    protected function setUp(): void
    {
        parent::setUp();

        $this->mind = new MindService;
    }

    private function node(string $label, string $description = 'Popis, ktorý má dosť znakov na to, aby uzol nebol stub.'): Node
    {
        return new Node(['type' => 'skill', 'label' => $label, 'description' => $description]);
    }

    public function test_a_raw_user_sentence_stored_as_a_label_is_noise(): void
    {
        // presne tento uzol sedí v živej sieti a lezie do recallu na „hades"
        $node = $this->node('použi mcp hades a vypracuj mi UX plán pre applikaciu tak');

        $this->assertSame('raw-prompt', $this->mind->noiseOf($node));
    }

    public function test_a_question_stored_as_a_label_is_noise(): void
    {
        $this->assertSame(
            'raw-prompt',
            $this->mind->noiseOf($this->node('Ako sa dá spustiť ten graf v prehliadači bez buildu?')),
        );
    }

    public function test_a_label_cut_off_mid_sentence_is_noise(): void
    {
        // takto vyzerá prompt useknutý na N znakov — a v sieti ich je viac
        $this->assertSame(
            'raw-prompt',
            $this->mind->noiseOf($this->node('Potrebujem vytvoriť aplikáciu ktorú nasadíme do dockeru a')),
        );
        $this->assertSame(
            'raw-prompt',
            $this->mind->noiseOf($this->node('Potreboval by som vytvoriť doslova nerual AI- mind tak aby')),
        );
        // dvojbodka na konci je useknutá veta bez ohľadu na dĺžku
        $this->assertSame(
            'raw-prompt',
            $this->mind->noiseOf($this->node('Projekt C:\\Aura\\ovl-da-zliav, aktuálna vetva:')),
        );
    }

    public function test_a_markdown_heading_left_in_the_label_is_noise(): void
    {
        $this->assertSame('markdown', $this->mind->noiseOf($this->node('# Smernica: nová Aura appka')));
        $this->assertSame('markdown', $this->mind->noiseOf($this->node('**Dôležité** rozhodnutie')));
    }

    public function test_a_machine_generated_slug_is_noise(): void
    {
        $this->assertSame('slug', $this->mind->noiseOf($this->node('mystifying-mclaren-23750a')));
        $this->assertSame('slug', $this->mind->noiseOf($this->node('charming-chaum-da6141')));
    }

    public function test_a_node_without_a_description_is_a_stub(): void
    {
        $this->assertSame('stub', $this->mind->noiseOf($this->node('Docker Compose', '')));
        $this->assertSame('stub', $this->mind->noiseOf($this->node('Docker Compose', 'krátko')));
    }

    // PHPUnit 12 už doc-komentárové metadáta nečíta — atribút, nie @dataProvider
    #[DataProvider('cleanLabels')]
    public function test_a_healthy_node_is_not_flagged(string $label): void
    {
        $this->assertNull(
            $this->mind->noiseOf($this->node($label)),
            "label „{$label}\" nie je odpad a nesmie byť označený",
        );
    }

    /** @return array<string, array<int, string>> */
    public static function cleanLabels(): array
    {
        return [
            'krátky technický názov' => ['Docker Compose'],
            'skill s dvojslovím' => ['MCP server development'],
            'projekt so skratkou' => ['OVL-DA-ZLIAV (ovládanie zliav)'],
            'pasca po ľudsky' => ['Pasca: HTML entity v parametroch mind_learn'],
            // dlhý label, ale vetná stavba to nie je — začína veľkým písmenom
            'dlhý ľudský názov' => ['Redizajn Hades — štyri úrovne grafu a dve zobrazenia'],
            // slug bez hex chvosta je normálny názov balíka, nie odpad generátora
            'slug bez hex chvosta' => ['laravel-reverb-websockets'],
            // päť slov, ale posledné nie je spojka — normálny názov
            'viacslovný názov projektu' => ['Aura Suite náhľad pre manažment'],
        ];
    }
}
