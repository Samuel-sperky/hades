<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Observers\AreaObserver;
use App\Observers\DepartmentObserver;
use App\Observers\EdgeObserver;
use App\Observers\NodeObserver;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class MindMirrorTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config(['hades.mirror_enabled' => true]);
        Storage::fake('mind');

        // Observery sú v testoch inak vypnuté (HADES_MIRROR_ENABLED=false) —
        // pre tieto testy ich zaregistrujeme ručne.
        Node::observe(NodeObserver::class);
        Edge::observe(EdgeObserver::class);
        Department::observe(DepartmentObserver::class);
        Area::observe(AreaObserver::class);

        $this->seed(\Database\Seeders\DatabaseSeeder::class);
    }

    private function mind(): MindService
    {
        return app(MindService::class);
    }

    public function test_learning_a_node_writes_a_markdown_file(): void
    {
        $r = $this->mind()->learn('skill', 'Konverzný lievik', 'Optimalizácia.', 'Marketing & SEO', 'SEO');
        $id = $r['node']['id'];

        $path = "marketing-seo/seo/konverzny-lievik-{$id}.md";
        Storage::disk('mind')->assertExists($path);

        $content = Storage::disk('mind')->get($path);
        $this->assertStringContainsString('# Konverzný lievik', $content);
        $this->assertStringContainsString('type: skill', $content);
        $this->assertStringContainsString('Optimalizácia.', $content);
    }

    public function test_node_without_department_lands_under_area_root(): void
    {
        $r = $this->mind()->learn('project', 'Web pre klienta', 'x', 'Biznis & projekty');
        $id = $r['node']['id'];

        Storage::disk('mind')->assertExists("biznis-projekty/web-pre-klienta-{$id}.md");
    }

    public function test_core_node_lives_under_core_folder(): void
    {
        $hades = Node::where('type', 'core')->where('label', 'Hades')->first();

        Storage::disk('mind')->assertExists("_core/hades-{$hades->id}.md");
    }

    public function test_connections_render_as_wikilinks_on_both_sides(): void
    {
        $r = $this->mind()->learn('skill', 'Konverzný lievik', 'x', 'Marketing & SEO', 'SEO', ['Hades']);
        $id = $r['node']['id'];
        $hades = Node::where('label', 'Hades')->first();

        $node = Storage::disk('mind')->get("marketing-seo/seo/konverzny-lievik-{$id}.md");
        $this->assertStringContainsString('- [[Hades]]', $node);

        $core = Storage::disk('mind')->get("_core/hades-{$hades->id}.md");
        $this->assertStringContainsString('- [[Konverzný lievik]]', $core);
    }

    public function test_activation_updates_strength_in_file(): void
    {
        $r = $this->mind()->learn('skill', 'Canva', 'x', 'Dizajn & kreatíva');
        $id = $r['node']['id'];

        $this->mind()->activate('Canva', 'skill');

        $content = Storage::disk('mind')->get("dizajn-kreativa/canva-{$id}.md");
        $this->assertStringContainsString('strength: 2', $content);
    }

    public function test_rename_moves_file_and_updates_neighbor(): void
    {
        $r = $this->mind()->learn('skill', 'Konverzný lievik', 'x', 'Marketing & SEO', 'SEO', ['Hades']);
        $id = $r['node']['id'];
        $hades = Node::where('label', 'Hades')->first();

        Node::find($id)->update(['label' => 'Konverzný funnel']);

        Storage::disk('mind')->assertMissing("marketing-seo/seo/konverzny-lievik-{$id}.md");
        Storage::disk('mind')->assertExists("marketing-seo/seo/konverzny-funnel-{$id}.md");

        $core = Storage::disk('mind')->get("_core/hades-{$hades->id}.md");
        $this->assertStringContainsString('- [[Konverzný funnel]]', $core);
        $this->assertStringNotContainsString('- [[Konverzný lievik]]', $core);
    }

    public function test_reparent_moves_file_and_prunes_empty_folder(): void
    {
        $r = $this->mind()->learn('skill', 'Presun', 'x', 'Marketing & SEO', 'SEO');
        $id = $r['node']['id'];
        Storage::disk('mind')->assertExists("marketing-seo/seo/presun-{$id}.md");

        $design = Area::where('slug', 'dizajn-kreativa')->first();
        Node::find($id)->update(['area_id' => $design->id, 'department_id' => null]);

        Storage::disk('mind')->assertMissing("marketing-seo/seo/presun-{$id}.md");
        Storage::disk('mind')->assertExists("dizajn-kreativa/presun-{$id}.md");
        // prázdny priečinok marketing-seo/seo bol prerezaný
        $this->assertNotContains('marketing-seo/seo', Storage::disk('mind')->allDirectories());
    }

    public function test_delete_removes_file_and_refreshes_neighbor(): void
    {
        $r = $this->mind()->learn('skill', 'Dočasné', 'x', 'Marketing & SEO', 'SEO', ['Hades']);
        $id = $r['node']['id'];
        $hades = Node::where('label', 'Hades')->first();

        Node::find($id)->delete();

        Storage::disk('mind')->assertMissing("marketing-seo/seo/docasne-{$id}.md");

        $core = Storage::disk('mind')->get("_core/hades-{$hades->id}.md");
        $this->assertStringNotContainsString('[[Dočasné]]', $core);
    }

    public function test_import_pulls_md_edits_back_to_db(): void
    {
        $r = $this->mind()->learn('skill', 'Pôvodný', 'Pôvodný popis.', 'Marketing & SEO');
        $id = $r['node']['id'];
        $path = "marketing-seo/povodny-{$id}.md";

        $content = Storage::disk('mind')->get($path);
        $content = str_replace('# Pôvodný', '# Nový názov', $content);
        $content = str_replace('Pôvodný popis.', 'Upravený popis.', $content);
        Storage::disk('mind')->put($path, $content);

        $this->artisan('mind:import')->assertSuccessful();

        $node = \App\Models\Node::find($id);
        $this->assertSame('Nový názov', $node->label);
        $this->assertSame('Upravený popis.', $node->description);
    }

    public function test_import_rejects_sensitive_edits(): void
    {
        $r = $this->mind()->learn('memory', 'Čistý', 'Nič citlivé.', 'Osobné & preferencie');
        $id = $r['node']['id'];
        $path = "osobne-preferencie/cisty-{$id}.md";

        $content = Storage::disk('mind')->get($path);
        $content = str_replace('Nič citlivé.', 'heslo: superTajne123', $content);
        Storage::disk('mind')->put($path, $content);

        $this->artisan('mind:import')->assertSuccessful();

        // popis sa NEzmenil — import odmietol citlivý obsah
        $this->assertSame('Nič citlivé.', \App\Models\Node::find($id)->description);
    }

    public function test_mind_daily_writes_summary_and_survives_rebuild(): void
    {
        $this->mind()->learn('skill', 'Denný test', 'x', 'Marketing & SEO');

        $this->artisan('mind:daily')->assertSuccessful();

        $date = now()->format('Y-m-d');
        Storage::disk('mind')->assertExists("_daily/{$date}.md");
        $this->assertStringContainsString('Denný test', Storage::disk('mind')->get("_daily/{$date}.md"));

        // export nesmie zmazať denníky
        $this->artisan('mind:export')->assertSuccessful();
        Storage::disk('mind')->assertExists("_daily/{$date}.md");
    }

    public function test_mind_export_regenerates_full_tree_and_index(): void
    {
        $this->mind()->learn('skill', 'Regen test', 'x', 'Marketing & SEO', 'SEO');

        // simuluj drift — zmaž všetko
        foreach (Storage::disk('mind')->allFiles() as $f) {
            Storage::disk('mind')->delete($f);
        }

        $this->artisan('mind:export')->assertSuccessful();

        Storage::disk('mind')->assertExists('README.md');
        Storage::disk('mind')->assertExists('marketing-seo/README.md');
        $files = Storage::disk('mind')->allFiles();
        $this->assertTrue(collect($files)->contains(fn ($f) => str_contains($f, 'regen-test-')));
    }
}
