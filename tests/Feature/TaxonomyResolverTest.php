<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Services\MindService;
use App\Services\Similarity\TaxonomyResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regres na bug z 29. 7. 2026 (`04-ODPOVEDE-ZAZNAM.md`): tichý fallback do
 * `Marketing & SEO` + duplicitné oddelenie v nesprávnej oblasti.
 *
 * Reprodukcia: `mind_learn` s `area = "Biznis &amp; projekty"` (HTML entita)
 *   1. fuzzy match neuspel
 *   2. uzol potichu spadol do prvej oblasti (Marketing & SEO)
 *   3. vzniklo duplicitné oddelenie „Aplikácie" pod nesprávnou oblasťou
 */
class TaxonomyResolverTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array', 'recall.vector.enabled' => false]);

        // Presne päť fixných oblastí ako v produkcii, vrátane poradia id.
        foreach ([
            ['Marketing & SEO', 'marketing-seo', '#b88a3a', 270],
            ['Vývoj & kód', 'vyvoj-kod', '#03797e', 342],
            ['Dizajn & kreatíva', 'dizajn-kreativa', '#9d5c7a', 54],
            ['Biznis & projekty', 'biznis-projekty', '#2f6d8f', 126],
            ['Osobné & preferencie', 'osobne-preferencie', '#a86a4a', 198],
        ] as [$name, $slug, $color, $angle]) {
            Area::create(['name' => $name, 'slug' => $slug, 'color' => $color, 'angle' => $angle]);
        }
    }

    private function resolver(): TaxonomyResolver
    {
        return app(TaxonomyResolver::class);
    }

    private function areaId(string $slug): int
    {
        return (int) Area::where('slug', $slug)->value('id');
    }

    // ---- normalizácia vstupu ------------------------------------------------

    public function test_html_entity_in_area_name_resolves_to_the_right_area(): void
    {
        $match = $this->resolver()->matchArea('Biznis &amp; projekty');

        $this->assertTrue($match['matched']);
        $this->assertSame($this->areaId('biznis-projekty'), $match['area']->id);
    }

    public function test_double_encoded_entity_still_resolves(): void
    {
        $match = $this->resolver()->matchArea('Biznis &amp;amp; projekty');

        $this->assertTrue($match['matched']);
        $this->assertSame($this->areaId('biznis-projekty'), $match['area']->id);
    }

    public function test_slug_input_resolves_to_the_right_area(): void
    {
        // pôvodná implementácia toto poslala do Marketingu, lebo
        // str_contains('vývoj & kód', 'vyvoj-kod') je false
        $match = $this->resolver()->matchArea('vyvoj-kod');

        $this->assertTrue($match['matched']);
        $this->assertSame($this->areaId('vyvoj-kod'), $match['area']->id);
    }

    public function test_missing_diacritics_and_extra_whitespace_resolve(): void
    {
        $match = $this->resolver()->matchArea("  Vyvoj \n &  kod  ");

        $this->assertTrue($match['matched']);
        $this->assertSame($this->areaId('vyvoj-kod'), $match['area']->id);
    }

    public function test_conjunction_variant_resolves_by_token_subset(): void
    {
        $match = $this->resolver()->matchArea('biznis a projekty');

        $this->assertTrue($match['matched']);
        $this->assertSame($this->areaId('biznis-projekty'), $match['area']->id);
    }

    // ---- žiadny tichý fallback ---------------------------------------------

    public function test_unknown_area_is_reported_instead_of_silently_assigned(): void
    {
        $match = $this->resolver()->matchArea('Kompletne neznáma oblasť');

        $this->assertFalse($match['matched']);
    }

    public function test_empty_area_name_no_longer_matches_the_first_area(): void
    {
        // pôvodne: str_contains('marketing & seo', '') === true → Marketing
        $match = $this->resolver()->matchArea('');

        $this->assertFalse($match['matched']);
    }

    public function test_learn_with_unknown_area_flags_the_node_for_review(): void
    {
        $result = app(MindService::class)->learn(
            type: 'memory',
            label: 'Poznatok s preklepom v oblasti',
            description: 'x',
            areaName: 'Bznis & prjekty',
            departmentName: 'Aplikácie',
        );

        $node = Node::find($result['node']['id']);

        $this->assertTrue($result['node']['needs_review']);
        $this->assertTrue((bool) $node->needs_review);
        $this->assertSame('area_not_matched', $node->meta['taxonomy_review']['reason']);
        $this->assertSame('Bznis & prjekty', $node->meta['taxonomy_review']['requested_area']);

        // pri nezhode oblasti sa oddelenie NEZAKLADÁ
        $this->assertNull($node->department_id);
        $this->assertSame(0, Department::count());
    }

    public function test_learn_with_matching_area_does_not_flag_anything(): void
    {
        $result = app(MindService::class)->learn(
            type: 'memory',
            label: 'Čistý poznatok',
            description: 'x',
            areaName: 'Biznis &amp; projekty',
            departmentName: 'Aplikácie',
        );

        $node = Node::find($result['node']['id']);

        $this->assertFalse((bool) $node->needs_review);
        $this->assertNull($node->meta['taxonomy_review'] ?? null);
        $this->assertSame($this->areaId('biznis-projekty'), (int) $node->area_id);
        $this->assertSame('Aplikácie', Department::find($node->department_id)->name);
    }

    // ---- duplicitné oddelenia ----------------------------------------------

    public function test_department_existing_in_another_area_is_not_duplicated(): void
    {
        $biznis = Area::where('slug', 'biznis-projekty')->first();
        $existing = $biznis->departments()->create(['name' => 'Aplikácie', 'slug' => 'aplikacie']);

        $placement = $this->resolver()->place('Vývoj & kód', 'Aplikácie');

        $this->assertNull($placement['department']);
        $this->assertNotNull($placement['review']);
        $this->assertSame('department_exists_in_other_area', $placement['review']['reason']);
        $this->assertSame($existing->id, $placement['review']['existing'][0]['id']);

        // NIČ nové nevzniklo — stále je len jedno oddelenie „Aplikácie"
        $this->assertSame(1, Department::where('name', 'Aplikácie')->count());
    }

    public function test_learn_flags_the_node_when_department_lives_in_another_area(): void
    {
        Area::where('slug', 'biznis-projekty')->first()
            ->departments()->create(['name' => 'Aplikácie', 'slug' => 'aplikacie']);

        $result = app(MindService::class)->learn(
            type: 'skill',
            label: 'Nový skill do Vývoja',
            description: 'x',
            areaName: 'Vývoj & kód',
            departmentName: 'Aplikácie',
        );

        $node = Node::find($result['node']['id']);

        $this->assertSame($this->areaId('vyvoj-kod'), (int) $node->area_id);
        $this->assertNull($node->department_id);
        $this->assertTrue((bool) $node->needs_review);
        $this->assertSame('department_exists_in_other_area', $node->meta['taxonomy_review']['reason']);
        $this->assertSame(1, Department::count());
    }

    public function test_new_department_in_the_matching_area_is_created_once(): void
    {
        $mind = app(MindService::class);

        $mind->learn('skill', 'Prvý', 'x', 'Vývoj & kód', 'Testovanie');
        $mind->learn('skill', 'Druhý', 'y', 'vyvoj-kod', 'testovanie');

        $this->assertSame(1, Department::where('area_id', $this->areaId('vyvoj-kod'))->count());
    }

    public function test_existing_department_is_reused_regardless_of_diacritics(): void
    {
        $vyvoj = Area::where('slug', 'vyvoj-kod')->first();
        $existing = $vyvoj->departments()->create(['name' => 'Nasadenie', 'slug' => 'nasadenie']);

        $placement = $this->resolver()->place('vyvoj-kod', 'nasadenie');

        $this->assertSame($existing->id, $placement['department']->id);
        $this->assertNull($placement['review']);
    }

    // ---- audit pomôcka ------------------------------------------------------

    public function test_departments_elsewhere_reports_node_counts(): void
    {
        $biznis = Area::where('slug', 'biznis-projekty')->first();
        $dep = $biznis->departments()->create(['name' => 'Aplikácie', 'slug' => 'aplikacie']);
        Node::create([
            'type' => 'skill',
            'area_id' => $biznis->id,
            'department_id' => $dep->id,
            'label' => 'X',
            'strength' => 1,
            'last_activated_at' => now(),
        ]);

        $found = $this->resolver()->departmentsElsewhere(
            Area::where('slug', 'vyvoj-kod')->first(),
            'Aplikácie',
        );

        $this->assertCount(1, $found);
        $this->assertSame(1, $found[0]['nodes']);
        $this->assertSame($biznis->id, $found[0]['area_id']);
    }
}
