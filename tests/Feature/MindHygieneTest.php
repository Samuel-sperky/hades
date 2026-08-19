<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\MergeCandidate;
use App\Models\Node;
use App\Models\Tag;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * mind:hygiene — správa o odpade v pamäti.
 *
 * Najdôležitejší test tu nie je počítanie tried, ale kontrolný súčet tabuľky
 * `nodes` pred a po behu. Tento príkaz sa pustí nad živou pamäťou s 2 672 uzlami
 * a jediná nechcená `update()` (napríklad „normalizácia“ labelu pri klasifikácii)
 * by prepísala poznatky, ktoré nikto nedá dokopy. Preto sa neverí čítaniu kódu,
 * ale meria sa stav tabuľky.
 */
class MindHygieneTest extends TestCase
{
    use RefreshDatabase;

    private Area $vyvoj;

    private Area $biznis;

    /** @var array<string, Node> */
    private array $n = [];

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);

        $this->vyvoj = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $this->biznis = Area::create(['name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#8a5a00', 'angle' => 90]);

        $this->seedJunk();
    }

    /** Po jednom uzle z každej triedy odpadu, plus čisté okolie na kontrast. */
    private function seedJunk(): void
    {
        $clean = 'Popis, ktorý nesie skutočnú znalosť a je dosť dlhý na to, aby neprešiel ako stub.';

        $this->n['hub'] = $this->node('Docker Compose profily v projekte', $clean, $this->vyvoj);

        $this->n['raw'] = $this->node('Projekt Aura, aktuálna vetva:', $clean, $this->vyvoj);
        $this->n['markdown'] = $this->node('# Smernica: nasadenie do dockeru', $clean, $this->vyvoj);
        $this->n['slug'] = $this->node('charming-chaum-da6141', $clean, $this->vyvoj, 'project');
        $this->n['stub'] = $this->node('Redis cache tagy', '', $this->vyvoj);
        $this->n['oversized'] = $this->node('Aura KPI appka', str_repeat('a ', 1200), $this->vyvoj, 'project');
        $this->n['tags'] = $this->node('AuraAI LLM eval batéria', $clean, $this->vyvoj, 'skill');

        // Sirota je zámerne bez hrany a inak čistá — nesmie ju schovať iná trieda.
        $this->n['orphan'] = $this->node('Fixing react-hooks set-state-in-effect', $clean, $this->vyvoj, 'skill');

        foreach (['raw', 'markdown', 'slug', 'stub', 'oversized', 'tags'] as $key) {
            $this->edge($this->n['hub'], $this->n[$key]);
        }

        $cap = (int) config('hades.recall_tag_cap', 8);
        for ($i = 0; $i <= $cap; $i++) {
            $this->n['tags']->tags()->attach(Tag::create(['name' => "tag-{$i}", 'slug' => "tag-{$i}"]));
        }

        // Zle zaradený uzol: sedí v Biznise, ale celé jeho okolie žije vo Vývoji.
        $this->n['misfiled'] = $this->node('Hades (AI-mind)', $clean, $this->biznis, 'project');
        for ($i = 0; $i < 5; $i++) {
            $neighbour = $this->node("Susedný uzol číslo {$i} vo vývoji", $clean, $this->vyvoj);
            $this->edge($this->n['misfiled'], $neighbour);
        }

        // Duplicita sa neprepočítava — číta sa fronta, ktorú plní mind_learn.
        $a = $this->node('Opportunity-Solution Tree', $clean, $this->vyvoj, 'skill');
        $b = $this->node('Opportunity solution tree', $clean, $this->vyvoj, 'project');
        $this->n['dupA'] = $a;
        $this->edge($this->n['hub'], $a);
        $this->edge($this->n['hub'], $b);

        MergeCandidate::create([
            'node_a_id' => $a->id,
            'node_b_id' => $b->id,
            'score' => 100,
            'reason' => 'cross_type_slug',
        ]);
    }

    private function node(string $label, string $description, ?Area $area, string $type = 'memory'): Node
    {
        return Node::create([
            'type' => $type,
            'label' => $label,
            'description' => $description,
            'area_id' => $area?->id,
            'strength' => 1,
        ]);
    }

    private function edge(Node $a, Node $b): void
    {
        Edge::create(['source_id' => $a->id, 'target_id' => $b->id, 'weight' => 1]);
    }

    /** @return array<string, mixed> */
    private function report(array $options = []): array
    {
        Artisan::call('mind:hygiene', array_merge(['--json' => true, '--no-file' => true], $options));

        $decoded = json_decode(Artisan::output(), true);

        $this->assertIsArray($decoded, 'výstup --json musí byť platný JSON');

        return $decoded;
    }

    /** @return array<string, array<string, mixed>> */
    private function classes(array $report): array
    {
        return collect($report['classes'])->keyBy('class')->all();
    }

    /**
     * Odtlačok tabuľky `nodes` vrátane `updated_at` — aj tichá `save()`, ktorá
     * nezmení ani jeden stĺpec obsahu, tu vyjde ako rozdiel.
     */
    private function nodesChecksum(): string
    {
        return md5(DB::table('nodes')->orderBy('id')->get()
            ->map(fn ($row) => json_encode((array) $row))->implode('|'));
    }

    public function test_report_counts_and_classifies_every_junk_class(): void
    {
        $classes = $this->classes($this->report());

        $expected = [
            'raw-prompt' => 'raw',
            'markdown' => 'markdown',
            'slug' => 'slug',
            'stub' => 'stub',
            'oversized' => 'oversized',
            'tag-sprawl' => 'tags',
            'orphan' => 'orphan',
            'misfiled' => 'misfiled',
            'duplicate' => 'dupA',
        ];

        foreach ($expected as $class => $key) {
            $this->assertSame(1, $classes[$class]['count'], "trieda {$class} má nájsť presne jeden uzol");
            $this->assertSame(
                [$this->n[$key]->id],
                collect($classes[$class]['examples'])->pluck('id')->all(),
                "trieda {$class} má ukázať uzol [{$this->n[$key]->id}]",
            );
        }
    }

    public function test_classes_are_sorted_by_what_they_cost_the_ai(): void
    {
        $report = $this->report();
        $weights = collect($report['classes'])->pluck('weight')->all();

        $this->assertSame('raw-prompt', $report['classes'][0]['class'], 'najdrahšia trieda ide prvá');
        $this->assertSame($weights, collect($weights)->sortDesc()->values()->all());
        $this->assertSame('orphan', end($report['classes'])['class']);
    }

    public function test_misfiled_names_the_area_the_neighbours_live_in(): void
    {
        $classes = $this->classes($this->report());
        $note = $classes['misfiled']['examples'][0]['note'];

        $this->assertStringContainsString('Vývoj & kód', (string) $note);
        $this->assertStringContainsString('%', (string) $note);
    }

    /** Jadro stojí nad oblasťami zámerne — hlásiť ho ako zle zaradený je šum. */
    public function test_core_node_without_area_is_not_reported_as_misfiled(): void
    {
        $core = $this->node('Hades', 'Jadro vedomia, ktoré stojí nad oblasťami.', null, 'core');

        $classes = $this->classes($this->report());

        $this->assertNotContains($core->id, collect($classes['misfiled']['examples'])->pluck('id')->all());
        $this->assertSame(1, $classes['misfiled']['count']);
    }

    /** Oddelenie z inej oblasti nie je názor, je to rozbitá cesta. */
    public function test_department_from_another_area_is_reported(): void
    {
        $dept = Department::create(['area_id' => $this->vyvoj->id, 'name' => 'Knižnica', 'slug' => 'kniznica']);
        $stray = $this->node('Aura Retouch Studio', 'Popis dlhý dosť na to, aby to nebol stub.', $this->biznis, 'project');
        $stray->forceFill(['department_id' => $dept->id])->save();

        $classes = $this->classes($this->report());

        $this->assertSame(2, $classes['misfiled']['count']);
        $this->assertContains($stray->id, collect($classes['misfiled']['examples'])->pluck('id')->all());
    }

    public function test_class_option_focuses_a_single_class(): void
    {
        $report = $this->report(['--class' => 'slug']);

        $this->assertCount(1, $report['classes']);
        $this->assertSame('slug', $report['classes'][0]['class']);
    }

    public function test_unknown_class_fails_instead_of_reporting_nothing(): void
    {
        $code = Artisan::call('mind:hygiene', ['--class' => 'smeti', '--no-file' => true]);

        $this->assertSame(1, $code);
        $this->assertStringContainsString('Neznáma trieda', Artisan::output());
    }

    public function test_limit_caps_examples_per_class(): void
    {
        for ($i = 0; $i < 4; $i++) {
            $this->node("eager-satoshi-{$i}3ea31", 'Popis dlhý dosť na to, aby to nebol stub.', $this->vyvoj, 'project');
        }

        $classes = $this->classes($this->report(['--limit' => 2]));

        $this->assertSame(5, $classes['slug']['count']);
        $this->assertCount(2, $classes['slug']['examples']);
    }

    public function test_report_touches_nothing_in_the_nodes_table(): void
    {
        $before = $this->nodesChecksum();

        Artisan::call('mind:hygiene', ['--no-file' => true]);
        Artisan::call('mind:hygiene', ['--json' => true, '--no-file' => true]);
        Artisan::call('mind:hygiene', ['--class' => 'raw-prompt', '--limit' => 50, '--no-file' => true]);

        $this->assertSame($before, $this->nodesChecksum(), 'správa nesmie zapísať ani jeden bajt do uzlov');
        $this->assertSame(0, Node::onlyTrashed()->count(), 'správa nesmie nič zmazať');
    }

    public function test_fix_without_force_only_previews(): void
    {
        $before = $this->nodesChecksum();

        Artisan::call('mind:hygiene', ['--fix' => true, '--no-file' => true]);
        $output = Artisan::output();

        $this->assertStringContainsString('# Smernica: nasadenie do dockeru', $output);
        $this->assertStringContainsString('+ Smernica: nasadenie do dockeru', $output);
        $this->assertStringContainsString('--force', $output);
        $this->assertSame($before, $this->nodesChecksum(), 'náhľad nesmie zapisovať');
    }

    public function test_fix_with_force_cleans_only_the_two_safe_classes(): void
    {
        Artisan::call('mind:hygiene', ['--fix' => true, '--force' => true, '--no-file' => true]);

        $this->assertSame('Smernica: nasadenie do dockeru', $this->n['markdown']->fresh()->label);

        // Useknutý prompt ani slug sa uhádnuť nedajú — musia ostať na človeka.
        $this->assertSame('Projekt Aura, aktuálna vetva:', $this->n['raw']->fresh()->label);
        $this->assertSame('charming-chaum-da6141', $this->n['slug']->fresh()->label);
        $this->assertSame(0, Node::onlyTrashed()->count(), 'ani --force nemaže uzly');
    }

    /** Prepis na existujúci label by vyrobil duplicitu — to rieši fronta, nie fix. */
    public function test_fix_skips_a_label_that_already_exists(): void
    {
        $taken = $this->node('Smernica: nasadenie do dockeru', 'Popis dlhý dosť na to, aby to nebol stub.', $this->vyvoj);

        Artisan::call('mind:hygiene', ['--fix' => true, '--force' => true, '--no-file' => true]);

        $this->assertStringContainsString('už existuje', Artisan::output());
        $this->assertSame('# Smernica: nasadenie do dockeru', $this->n['markdown']->fresh()->label);
        $this->assertSame('Smernica: nasadenie do dockeru', $taken->fresh()->label);
    }

    public function test_force_alone_changes_nothing(): void
    {
        $before = $this->nodesChecksum();

        Artisan::call('mind:hygiene', ['--force' => true, '--no-file' => true]);

        $this->assertStringContainsString('nič nerobí bez --fix', Artisan::output());
        $this->assertSame($before, $this->nodesChecksum());
    }

    public function test_findings_are_written_to_storage(): void
    {
        $path = storage_path('app/hygiene-'.now()->format('Y-m-d').'.md');
        @unlink($path);

        Artisan::call('mind:hygiene');

        $this->assertFileExists($path);
        $markdown = (string) file_get_contents($path);

        @unlink($path);

        $this->assertStringContainsString('| trieda | uzlov |', $markdown);
        $this->assertStringContainsString('raw-prompt', $markdown);
        $this->assertStringContainsString((string) $this->n['raw']->id, $markdown);
    }
}
