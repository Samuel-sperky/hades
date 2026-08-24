<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Services\Console\ContextBlock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Kontext vybraných uzlov sa skladá NA SERVERI, iba z id. Tieto testy strážia
 * presne to, čo review vlny B našlo ako ticho mŕtve: že blok naozaj vznikne,
 * drží stropy z configu a priznáva skrátenie — a že klient nevie podstrčiť text.
 */
class ContextBlockTest extends TestCase
{
    use RefreshDatabase;

    private int $areaId;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'hades.console.context.nodes' => 8,
            'hades.console.context.chars' => 2400,
            'hades.console.context.desc_chars' => 300,
        ]);
        $this->areaId = Area::create([
            'name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#6d3fb5', 'angle' => 0,
        ])->id;
    }

    private function node(string $label, string $description): Node
    {
        return Node::create([
            'type' => 'skill', 'area_id' => $this->areaId,
            'label' => $label, 'description' => $description, 'strength' => 1,
        ]);
    }

    public function test_empty_selection_yields_an_empty_block(): void
    {
        $this->assertSame('', app(ContextBlock::class)->build([]));
    }

    public function test_block_carries_labels_and_descriptions_wrapped_in_markers(): void
    {
        $a = $this->node('Ripgrep v konzole', 'Ako beží grep tool nad súbormi projektu.');
        $b = $this->node('Dvojfázová brána', 'Zápisový tool zaparkuje a čaká na človeka.');

        $block = app(ContextBlock::class)->build([$a->id, $b->id]);

        $this->assertStringStartsWith('[kontext z grafu — 2 uzly]', $block);
        $this->assertStringEndsWith('[/kontext]', $block);
        $this->assertStringContainsString('### Ripgrep v konzole', $block);
        $this->assertStringContainsString('### Dvojfázová brána', $block);
        $this->assertStringContainsString('Zápisový tool zaparkuje', $block);
    }

    public function test_selection_order_is_preserved(): void
    {
        $a = $this->node('Prvý', 'popis jeden dostatočne dlhý');
        $b = $this->node('Druhý', 'popis dva dostatočne dlhý');

        $block = app(ContextBlock::class)->build([$b->id, $a->id]);

        $this->assertLessThan(strpos($block, '### Prvý'), strpos($block, '### Druhý'));
    }

    public function test_description_is_capped_at_desc_chars(): void
    {
        $long = str_repeat('x', 900);
        $n = $this->node('Dlhý popis', $long);

        $block = app(ContextBlock::class)->build([$n->id]);

        // 300 „x" áno, 301. už nie.
        $this->assertStringContainsString(str_repeat('x', 300), $block);
        $this->assertStringNotContainsString(str_repeat('x', 301), $block);
    }

    public function test_node_cap_drops_the_rest_and_admits_the_truncation(): void
    {
        config(['hades.console.context.nodes' => 3]);
        $ids = [];
        for ($i = 1; $i <= 5; $i++) {
            $ids[] = $this->node("Uzol $i", "krátky popis $i")->id;
        }

        $block = app(ContextBlock::class)->build($ids);

        $this->assertStringContainsString('kontext skrátený: 3 z 5 uzlov', $block);
        $this->assertStringContainsString('### Uzol 3', $block);
        $this->assertStringNotContainsString('### Uzol 4', $block);
    }

    public function test_char_budget_stops_before_overflowing(): void
    {
        config(['hades.console.context.chars' => 400, 'hades.console.context.desc_chars' => 300]);
        $ids = [];
        for ($i = 1; $i <= 4; $i++) {
            $ids[] = $this->node("Uzol $i", str_repeat('y', 300))->id;
        }

        $block = app(ContextBlock::class)->build($ids);

        // Do 400 znakov sa zmestí jeden uzol (label + 300 y), druhý už nie.
        $this->assertStringContainsString('### Uzol 1', $block);
        $this->assertStringNotContainsString('### Uzol 2', $block);
        $this->assertStringContainsString('kontext skrátený', $block);
    }

    public function test_unknown_ids_are_skipped_not_fabricated(): void
    {
        $real = $this->node('Skutočný', 'popis skutočného uzla');

        $block = app(ContextBlock::class)->build([999999, $real->id, 888888]);

        $this->assertStringContainsString('### Skutočný', $block);
        // Hlavička hlási 1 zahrnutý z 3 vyžiadaných — klient nič nepodstrčil.
        $this->assertStringContainsString('[kontext z grafu — 1 uzol]', $block);
        $this->assertStringContainsString('kontext skrátený: 1 z 3 uzlov', $block);
    }
}
