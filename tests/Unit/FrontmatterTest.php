<?php

namespace Tests\Unit;

use App\Services\Brain\Frontmatter;
use Tests\TestCase;

class FrontmatterTest extends TestCase
{
    public function test_parses_scalar_keys(): void
    {
        $raw = "---\nname: Docker\ndescription: \"Kontajnery a compose\"\ncertainty: overene\nsource: hades\nnode_id: 42\n---\n# Docker\n\nTelo.";
        $fm = Frontmatter::parse($raw);

        $this->assertSame('Docker', $fm['name']);
        $this->assertSame('Kontajnery a compose', $fm['description']);
        $this->assertSame('overene', $fm['certainty']);
        $this->assertSame('hades', $fm['source']);
        $this->assertSame('42', $fm['node_id']);
    }

    public function test_body_strips_frontmatter(): void
    {
        $raw = "---\nname: X\n---\n# Nadpis\n\nOdsek.";
        $this->assertSame("# Nadpis\n\nOdsek.", Frontmatter::body($raw));
    }

    public function test_no_frontmatter_returns_empty_and_full_body(): void
    {
        $raw = "# Bez frontmatteru\n\nText.";
        $this->assertSame([], Frontmatter::parse($raw));
        $this->assertSame($raw, Frontmatter::body($raw));
    }

    public function test_tags_inline_list(): void
    {
        $fm = Frontmatter::parse("---\ntags: devops, docker, ci\n---\nX");
        $this->assertSame(['devops', 'docker', 'ci'], $fm['tags']);
    }

    public function test_tags_bracket_list(): void
    {
        $fm = Frontmatter::parse("---\ntags: [a, b, c]\n---\nX");
        $this->assertSame(['a', 'b', 'c'], $fm['tags']);
    }

    public function test_tags_yaml_block_list(): void
    {
        $raw = "---\nname: X\ntags:\n  - alpha\n  - beta\n---\nX";
        $fm = Frontmatter::parse($raw);
        $this->assertSame(['alpha', 'beta'], $fm['tags']);
        $this->assertSame('X', $fm['name']);
    }

    public function test_nested_metadata_type_is_flattened(): void
    {
        $raw = "---\nname: X\nmetadata:\n  type: skill\n---\nX";
        $fm = Frontmatter::parse($raw);
        $this->assertSame('skill', $fm['metadata_type']);
    }

    public function test_bom_prefix_is_stripped(): void
    {
        $raw = "\xEF\xBB\xBF---\nname: Y\n---\nBody";
        $fm = Frontmatter::parse($raw);
        $this->assertSame('Y', $fm['name']);
    }
}
