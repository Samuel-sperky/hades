<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Models\Tag;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Tag je alias a musí sa dať nájsť.
 *
 * Uzly už normalizované `tags` mali, ale `searchNodes()` skóroval výhradne
 * `label` a `description` — tag sa nehľadal a uzol, ktorý sedel len ním, sa
 * nedostal ani medzi kandidátov.
 *
 * Namerané na živých dátach: 4 310 z 10 246 väzieb na tag nesie text, ktorý
 * v uzle inak nie je — 42 % tagov teda niečo pridáva.
 */
class RecallTagsTest extends TestCase
{
    use RefreshDatabase;

    private MindService $mind;

    private Area $area;

    protected function setUp(): void
    {
        parent::setUp();

        if (config('database.default') === 'sqlite') {
            $this->markTestSkipped('searchNodes vyžaduje MariaDB (COLLATE utf8mb4_unicode_ci)');
        }

        config(['cache.default' => 'array']);
        $this->mind = app(MindService::class);
        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    private function node(string $label, string $description, array $tags = []): Node
    {
        $node = Node::create([
            'type' => 'skill', 'label' => $label, 'description' => $description,
            'area_id' => $this->area->id, 'strength' => 1,
        ]);

        foreach ($tags as $name) {
            $node->tags()->attach(Tag::firstOrCreate(['name' => $name], ['slug' => str($name)->slug()]));
        }

        return $node;
    }

    private function labels(string $query): array
    {
        return $this->mind->searchNodes($query, 5)->map(fn ($row) => $row['node']->label)->all();
    }

    public function test_a_node_is_found_by_a_tag_alone(): void
    {
        // presne obsidianový vzor: kľúč na dohľadanie nesie alias, nie text
        $this->node('Zákaz konkurencie konateľa', 'Konateľ nesmie podnikať v rovnakom odbore.', ['§136 ObZ']);

        $this->assertContains('Zákaz konkurencie konateľa', $this->labels('§136 ObZ'));
    }

    public function test_a_slug_tag_matches_a_spaced_query(): void
    {
        // tagy sú v Hadese slugy, takže „10-rokov“ musí trafiť dopyt „10 rokov“
        $this->node('Archivácia doklady', 'Skladujeme podľa zákona.', ['10-rokov']);

        $this->assertContains('Archivácia doklady', $this->labels('10 rokov'));
    }

    public function test_a_tag_hit_weighs_like_a_label_hit(): void
    {
        // tag je ZÁMERNÝ alias, teda silnejší signál než náhodné slovo v popise
        $this->node('Interchange stropy EÚ', 'Limity pri kartových platbách.', ['0-2-percent']);
        $this->node('Poznámka o percentách', 'Text spomína percent len tak mimochodom.');

        $this->assertSame('Interchange stropy EÚ', $this->labels('0 2 percent interchange')[0] ?? null);
    }

    public function test_a_node_without_a_matching_tag_stays_out(): void
    {
        // tvrdý prah platí ďalej — tagy ho nesmú zmäkčiť
        $this->node('Docker kontajnery', 'Reštart cez compose.', ['devops']);

        $this->assertSame([], $this->labels('účtovníctvo faktúry'));
    }

    public function test_a_new_tag_is_searchable_immediately(): void
    {
        // zoznam tagov je cachovaný; kľúč nesie počet a max(id), takže nový tag
        // ho zneplatní sám — uzol uložený pred sekundou musí byť dohľadateľný
        $this->node('Prvý uzol', 'Popis.', ['alfa-tag']);
        $this->labels('alfa tag');

        $this->node('Druhý uzol', 'Popis.', ['beta-tag']);

        $this->assertContains('Druhý uzol', $this->labels('beta tag'));
    }
}
