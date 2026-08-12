<?php

namespace Tests\Feature;

use App\Models\Node;
use App\Models\Tag;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A11 — tagy sa normalizujú a upratujú.
 *
 * Tag::firstOrCreate(['name' => $name]) bez úpravy vstupu vyrobil 3 663 tagov
 * na 2 590 uzlov: „Docker", „docker" a „docker " boli tri rôzne záznamy.
 */
class TagNormalisationTest extends TestCase
{
    use RefreshDatabase;

    public function test_case_and_whitespace_no_longer_create_separate_tags(): void
    {
        $a = Tag::forName('Docker');
        $b = Tag::forName('docker');
        $c = Tag::forName('  docker  ');

        $this->assertSame($a->id, $b->id);
        $this->assertSame($a->id, $c->id);
        $this->assertSame(1, Tag::count());
    }

    public function test_diacritics_do_not_create_a_separate_tag(): void
    {
        $a = Tag::forName('bezpečnosť');
        $b = Tag::forName('bezpecnost');

        $this->assertSame($a->id, $b->id);
    }

    public function test_the_first_human_form_of_the_name_is_kept_for_display(): void
    {
        Tag::forName('Docker');
        $tag = Tag::forName('docker');

        $this->assertSame('Docker', $tag->name, 'name je na zobrazenie, identitou je slug');
        $this->assertSame('docker', $tag->slug);
    }

    public function test_an_empty_or_symbol_only_tag_is_refused(): void
    {
        $this->assertNull(Tag::forName('   '));
        $this->assertNull(Tag::forName('###'));
        $this->assertSame(0, Tag::count());
    }

    public function test_prune_removes_only_tags_without_any_node(): void
    {
        $node = Node::create(['type' => 'skill', 'label' => 'Docker Compose', 'strength' => 1]);

        $used = Tag::forName('docker');
        $orphan = Tag::forName('nepoužitý');

        $node->tags()->attach($used->id);

        $this->artisan('mind:prune-tags')->assertSuccessful();

        $this->assertNotNull(Tag::find($used->id));
        $this->assertNull(Tag::find($orphan->id));
    }

    public function test_dry_run_deletes_nothing(): void
    {
        Tag::forName('osirely');

        $this->artisan('mind:prune-tags', ['--dry-run' => true])->assertSuccessful();

        $this->assertSame(1, Tag::count());
    }
}
