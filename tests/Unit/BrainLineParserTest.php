<?php

namespace Tests\Unit;

use App\Services\Brain\BrainLineParser;
use Tests\TestCase;

class BrainLineParserTest extends TestCase
{
    private BrainLineParser $parser;

    protected function setUp(): void
    {
        parent::setUp();
        $this->parser = new BrainLineParser;
    }

    public function test_full_structured_line_with_emoji_date_source(): void
    {
        $line = $this->parser->parse('✅ 2026-07-10 (audit) — content_hash musí byť UNIQUE');

        $this->assertNotNull($line);
        $this->assertSame('overene', $line->certainty);
        $this->assertSame('2026-07-10', $line->notedOn);
        $this->assertSame('audit', $line->source);
        $this->assertSame('content_hash musí byť UNIQUE', $line->text);
        $this->assertTrue($line->isStructured);
        $this->assertFalse($line->needsReview);
    }

    public function test_emoji_certainty_mapping(): void
    {
        $this->assertSame('overene', $this->parser->parse('✅ — a')->certainty);
        $this->assertSame('hypoteza', $this->parser->parse('🧪 — b')->certainty);
        $this->assertSame('pasca', $this->parser->parse('⚠️ — c')->certainty);
    }

    public function test_fe0f_variant_is_consumed_before_bare_warning(): void
    {
        // ⚠️ (U+26A0 U+FE0F) — FE0F variant nesmie zostať visieť v texte
        $line = $this->parser->parse('⚠️ — pozor na pascu');

        $this->assertSame('pasca', $line->certainty);
        $this->assertSame('pozor na pascu', $line->text);

        // holé ⚠ (bez FE0F) tiež mapuje na pascu
        $bare = $this->parser->parse('⚠ — bare');
        $this->assertSame('pasca', $bare->certainty);
        $this->assertSame('bare', $bare->text);
    }

    public function test_placeholder_bullets_return_null(): void
    {
        $this->assertNull($this->parser->parse('(zatiaľ nič)'));
        $this->assertNull($this->parser->parse('(n/a)'));
        $this->assertNull($this->parser->parse('(doplniť pri prvom zápise)'));
        $this->assertNull($this->parser->parse(''));
        $this->assertNull($this->parser->parse('   '));
    }

    public function test_date_without_emoji_is_structured_null_certainty(): void
    {
        $line = $this->parser->parse('2026-07-10 — rozhodnutie bez emoji');

        $this->assertNotNull($line);
        $this->assertNull($line->certainty);
        $this->assertSame('2026-07-10', $line->notedOn);
        $this->assertSame('rozhodnutie bez emoji', $line->text);
        $this->assertTrue($line->isStructured);
        $this->assertFalse($line->needsReview);
    }

    public function test_unrecognized_line_is_kept_and_flagged(): void
    {
        // NIC sa ticho nezahadzuje — voľný text prežije, ale needs_review
        $line = $this->parser->parse('len obyčajná poznámka bez štruktúry');

        $this->assertNotNull($line);
        $this->assertSame('len obyčajná poznámka bez štruktúry', $line->text);
        $this->assertFalse($line->isStructured);
        $this->assertTrue($line->needsReview);
        $this->assertNull($line->certainty);
    }

    public function test_en_dash_and_plain_dash_separators(): void
    {
        $this->assertSame('en', $this->parser->parse('✅ – en')->text);
        $this->assertSame('plain', $this->parser->parse('✅ - plain')->text);
    }
}
