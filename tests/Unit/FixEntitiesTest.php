<?php

namespace Tests\Unit;

use App\Console\Commands\MindFixEntities;
use PHPUnit\Framework\TestCase;

/**
 * Dekódovanie v mind:fix-entities — práve jedna vrstva, nikdy viac.
 */
class FixEntitiesTest extends TestCase
{
    public function test_decodes_the_usual_entities(): void
    {
        $this->assertSame('Procesy & prevádzka', MindFixEntities::fix('Procesy &amp; prevádzka'));
        $this->assertSame('<style>', MindFixEntities::fix('&lt;style&gt;'));
        $this->assertSame('"citát"', MindFixEntities::fix('&quot;citát&quot;'));
        $this->assertSame("d'Artagnan", MindFixEntities::fix('d&#039;Artagnan'));
    }

    public function test_strips_json_escape_leftovers(): void
    {
        $this->assertSame('„Členenie IT kanvasu"', MindFixEntities::fix('„Členenie IT kanvasu\\"'));
    }

    /**
     * `&amp;nbsp;` znamená, že autor písal o entite `&nbsp;` — dekóduje sa
     * jedna vrstva, výsledok ostáva `&nbsp;` a nie medzera.
     */
    public function test_decodes_exactly_one_layer(): void
    {
        $this->assertSame('&nbsp;', MindFixEntities::fix('&amp;nbsp;'));
        $this->assertSame('&lt;b&gt;', MindFixEntities::fix('&amp;lt;b&amp;gt;'));
    }

    public function test_leaves_clean_text_untouched(): void
    {
        foreach (['Reporting & dataviz', 'a < b > c', 'bez entít', '&nbsp;'] as $clean) {
            $this->assertSame($clean, MindFixEntities::fix($clean));
        }
    }
}
