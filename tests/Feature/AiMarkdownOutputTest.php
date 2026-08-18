<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Models\Tag;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Dva markdownové výstupy, ktoré Hades posiela do Claude Code:
 *
 *  - „Balík vedomia" (`POST /api/context/pack`) — používateľ si naklikne uzly
 *    a vloží ich do sessionu.
 *  - „Smernica" (`POST /api/directive/build`) — Hades poskladá kontext k úlohe.
 *    To je doslova generátor promptu, takže každý riadok, ktorý nič nehovorí,
 *    je zaplatený token.
 *
 * Oba čítala AI, ale písané boli pre človeka: balíku chýbala istota (pasca
 * vyzerala ako odporúčanie) aj id, smernica končila sekciou „Kde nájdeš",
 * ktorá bola riadok po riadku kópiou dvoch sekcií nad ňou.
 */
class AiMarkdownOutputTest extends TestCase
{
    use RefreshDatabase;

    private Area $area;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array']);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    private function node(string $label, array $attrs = []): Node
    {
        return Node::create(array_merge([
            'type' => 'skill',
            'label' => $label,
            'description' => 'Popis uzla, dosť dlhý na to, aby nebol stub.',
            'area_id' => $this->area->id,
            'strength' => 1,
        ], $attrs));
    }

    private function pack(array $ids): string
    {
        return (string) $this->postJson('/api/context/pack', ['node_ids' => $ids])
            ->assertOk()
            ->json('markdown');
    }

    // ---- balík -------------------------------------------------------------

    public function test_the_pack_opens_by_saying_what_it_is_and_what_to_do_with_it(): void
    {
        $md = $this->pack([$this->node('Docker Compose')->id]);

        // bez tejto vety AI háda, či je balík kontext alebo zadanie
        $this->assertStringContainsString('kontext, nie ako zadanie', $md);
        $this->assertStringContainsString('mind_read', $md);
    }

    public function test_the_pack_warns_that_a_pitfall_is_not_a_recommendation(): void
    {
        $id = $this->node('HTML entity v parametroch mind_learn', ['certainty' => 'pasca'])->id;

        $md = $this->pack([$id]);

        $this->assertStringContainsString('istota: pasca', $md);
        $this->assertStringContainsString('nie odporúčanie', $md);
    }

    public function test_the_pack_carries_the_id_and_the_tags(): void
    {
        $node = $this->node('Docker Compose');
        $node->tags()->attach(Tag::forName('devops'));

        $md = $this->pack([$node->id]);

        // id = kľúč, ktorým si AI vie uzol dotiahnuť celý
        $this->assertStringContainsString('id: '.$node->id, $md);
        $this->assertStringContainsString('tagy: devops', $md);
    }

    public function test_the_pack_does_not_pay_for_horizontal_rules(): void
    {
        $md = $this->pack([$this->node('Docker Compose')->id, $this->node('MariaDB')->id]);

        // nadpis `##` oddeľuje sám; `---` bol riadok navyše na každom uzle
        $this->assertStringNotContainsString("\n---\n", $md);
    }

    public function test_a_markdown_label_does_not_break_the_pack_structure(): void
    {
        // uzly z ingestu majú v labeli nadpis; v balíku by z jedného uzla urobil dva
        $md = $this->pack([$this->node('# Smernica: nová Aura appka')->id]);

        $this->assertStringContainsString('## Smernica: nová Aura appka', $md);
        $this->assertStringNotContainsString('## # Smernica', $md);
    }

    // ---- smernica ----------------------------------------------------------

    private function directive(string $task): array
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('searchNodes vyžaduje MariaDB COLLATE.');
        }

        return $this->postJson('/api/directive/build', ['task' => $task])->assertOk()->json();
    }

    public function test_the_directive_gives_pitfalls_their_own_section(): void
    {
        $this->node('Pasca reverb portu', [
            'certainty' => 'pasca',
            'description' => 'Reverb v Dockeri musí mať host 0.0.0.0, inak WS nechytí.',
        ]);

        $data = $this->directive('reverb websockety docker');

        $this->assertNotEmpty($data['suggested']['pitfalls'], 'pasca musí mať vlastnú kategóriu');
        $this->assertStringContainsString('## Pasce — čo nerobiť', $data['markdown']);
        $this->assertStringContainsString('neopakuj ich', $data['markdown']);
    }

    public function test_the_directive_no_longer_repeats_itself_in_a_where_to_find_section(): void
    {
        $this->node('Reverb websockety', ['description' => 'Broadcast cez Laravel Reverb.']);

        $data = $this->directive('reverb websockety');

        // „Kde nájdeš" bola kópia sekcií nad ňou — ~30 % promptu za nulovú informáciu
        $this->assertStringNotContainsString('## Kde nájdeš', $data['markdown']);
    }

    public function test_the_directive_states_the_task_and_how_to_work_with_it(): void
    {
        $this->node('Reverb websockety', ['description' => 'Broadcast cez Laravel Reverb.']);

        $data = $this->directive('reverb websockety');

        $this->assertStringContainsString('## Zadanie', $data['markdown']);
        $this->assertStringContainsString('## Ako s tým pracovať', $data['markdown']);
        // pokyn na sekciu, ktorá v dokumente nie je, je horší než žiadny
        $this->assertStringNotContainsString('Pasce sú overené chyby', $data['markdown']);
    }

    public function test_a_skill_without_a_file_is_no_longer_dropped(): void
    {
        // uzol nemá .md na disku, ale má popis — a to je viac než nič
        $this->node('Reverb websockety', ['description' => 'Broadcast cez Laravel Reverb v Dockeri.']);

        $data = $this->directive('reverb websockety');

        $this->assertStringContainsString('bez .md v repo', $data['markdown']);
        $this->assertStringContainsString('Reverb websockety', $data['markdown']);
    }

    public function test_the_skill_path_has_a_single_source_of_truth(): void
    {
        // tá istá úvaha bola skopírovaná v ContextController aj DirectiveController
        $node = $this->node('Docker Compose', ['external_key' => 'skill:quick']);

        $this->assertSame('skills/quick.md', app(MindService::class)->sourcePathOf($node));
    }
}
