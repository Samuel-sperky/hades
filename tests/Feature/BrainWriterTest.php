<?php

namespace Tests\Feature;

use App\Exceptions\BrainWriteDisabledException;
use App\Exceptions\SecretsDetectedException;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\Brain\BrainWriter;
use App\Services\Brain\NodeDraft;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BrainWriterTest extends TestCase
{
    use RefreshDatabase;

    private string $tmp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tmp = sys_get_temp_dir().'/brain-writer-test-'.uniqid();
        @mkdir($this->tmp, 0775, true);

        // transcripts mimo dosahu (claude-memory adaptér nič nenačíta)
        config(['auraai.transcripts_path' => $this->tmp.'/no-transcripts']);
        // jediný zdroj = náš writable temp priečinok
        config([
            'auraai.brain_sources' => [
                'test' => ['type' => 'external', 'path' => $this->tmp, 'label' => 'Test', 'writable' => true],
            ],
            'auraai.brain_paths' => [],
        ]);
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->tmp);
        parent::tearDown();
    }

    private function enableWrite(): void
    {
        config(['auraai.allow_brain_write' => true]);
    }

    private function tmpFiles(): array
    {
        return glob($this->tmp.'/**/*.tmp.*') ?: (glob($this->tmp.'/*.tmp.*') ?: []);
    }

    private function assertNoTmpLeftover(): void
    {
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->tmp, \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($it as $f) {
            $this->assertStringNotContainsString('.tmp.', $f->getFilename(), 'tmp súbor nesmie zostať: '.$f->getFilename());
        }
    }

    // ------------------------------------------------------------------
    // Guard OFF → žiadny zápis, mtime súboru nezmenený
    // ------------------------------------------------------------------

    public function test_guard_off_blocks_write_and_leaves_file_untouched(): void
    {
        config(['auraai.allow_brain_write' => false]);

        $file = $this->tmp.'/existing.md';
        file_put_contents($file, "---\nname: Pôvodné\n---\n# Pôvodné\n\nText.");
        clearstatcache();
        $mtimeBefore = filemtime($file);
        $contentBefore = file_get_contents($file);

        $node = Node::create([
            'type' => 'memory', 'source' => 'brain', 'origin' => 'brain',
            'external_key' => 'test:existing', 'label' => 'Pôvodné',
            'source_file' => 'existing.md',
            'meta' => ['root' => $this->tmp, 'path' => 'existing.md', 'source_key' => 'test'],
        ]);

        $writer = new BrainWriter;

        // create aj update musia hodiť guard výnimku
        try {
            $writer->update($node, new NodeDraft(label: 'Zmena', description: 'Nový text'));
            $this->fail('update mal hodiť BrainWriteDisabledException');
        } catch (BrainWriteDisabledException) {
            // ok
        }

        try {
            $writer->create(new NodeDraft(label: 'Nový', description: 'Text'));
            $this->fail('create mal hodiť BrainWriteDisabledException');
        } catch (BrainWriteDisabledException) {
            // ok
        }

        clearstatcache();
        $this->assertSame($contentBefore, file_get_contents($file), 'obsah sa nesmie zmeniť pri guard OFF');
        $this->assertSame($mtimeBefore, filemtime($file), 'mtime sa nesmie zmeniť pri guard OFF');
        $this->assertCount(0, glob($this->tmp.'/nov*.md') ?: [], 'nový súbor nesmie vzniknúť');
    }

    // ------------------------------------------------------------------
    // Atomický zápis: tmp+rename, obsah správny, tmp nezostáva
    // ------------------------------------------------------------------

    public function test_create_writes_atomically_without_tmp_leftover(): void
    {
        $this->enableWrite();

        $writer = new BrainWriter;
        $res = $writer->create(new NodeDraft(
            label: 'Docker Compose',
            description: 'Orchestrácia kontajnerov.',
            certainty: 'overene',
            tags: ['devops', 'docker'],
        ));

        $abs = $this->tmp.'/'.$res['source_file'];
        $this->assertFileExists($abs);

        $content = file_get_contents($abs);
        $this->assertStringContainsString('name: Docker Compose', $content);
        $this->assertStringContainsString('certainty: overene', $content);
        $this->assertStringContainsString('Orchestrácia kontajnerov.', $content);

        $this->assertNoTmpLeftover();

        // targetovaný resync uzol založil (origin=brain)
        $node = Node::where('origin', 'brain')->where('label', 'Docker Compose')->first();
        $this->assertNotNull($node);
        $this->assertSame('overene', $node->certainty);
    }

    // ------------------------------------------------------------------
    // Presun (move): cieľ zapísaný PRED zmazaním zdroja
    // ------------------------------------------------------------------

    public function test_update_move_writes_target_before_deleting_source(): void
    {
        $this->enableWrite();

        $writer = new BrainWriter;
        $created = $writer->create(new NodeDraft(label: 'Presun. uzol', description: 'Stará verzia.'));
        $sourceRel = $created['source_file'];
        $sourceAbs = $this->tmp.'/'.$sourceRel;
        $this->assertFileExists($sourceAbs);

        $node = Node::where('label', 'Presun. uzol')->firstOrFail();

        $writer->update($node, new NodeDraft(
            label: 'Presunutý uzol',
            description: 'Nová verzia.',
            sourceKey: 'test',
            relPath: 'presunute/novy.md',
        ));

        $targetAbs = $this->tmp.'/presunute/novy.md';
        $this->assertFileExists($targetAbs, 'cieľ presunu existuje');
        $this->assertStringContainsString('Nová verzia.', file_get_contents($targetAbs));
        $this->assertFileDoesNotExist($sourceAbs, 'zdroj sa zmazal AŽ po zapísaní cieľa');
        $this->assertNoTmpLeftover();
    }

    // ------------------------------------------------------------------
    // Simulovaná výnimka počas move → obsah v aspoň jednom súbore, tmp nezostáva
    // ------------------------------------------------------------------

    public function test_failed_move_keeps_source_intact_and_no_tmp_left(): void
    {
        $this->enableWrite();

        // najprv čistý create (bez fault injection)
        $plain = new BrainWriter;
        $created = $plain->create(new NodeDraft(label: 'Bezpečný uzol', description: 'Originál.'));
        $sourceAbs = $this->tmp.'/'.$created['source_file'];
        $originalContent = file_get_contents($sourceAbs);

        $node = Node::where('label', 'Bezpečný uzol')->firstOrFail();

        // writer, ktorý zlyhá pri rename cieľa presunu
        $faulty = new class extends BrainWriter
        {
            public string $failRenameContains = '';

            protected function rename(string $from, string $to): bool
            {
                if ($this->failRenameContains !== '' && str_contains(str_replace('\\', '/', $to), $this->failRenameContains)) {
                    return false;
                }

                return parent::rename($from, $to);
            }
        };
        $faulty->failRenameContains = 'presunute/novy.md';

        try {
            $faulty->update($node, new NodeDraft(
                label: 'Zlyhá',
                description: 'Táto zmena sa nemá uložiť.',
                sourceKey: 'test',
                relPath: 'presunute/novy.md',
            ));
            $this->fail('update mal zlyhať pri rename cieľa');
        } catch (\RuntimeException) {
            // očakávané
        }

        clearstatcache();
        // zdroj ostal NEDOTKNUTÝ (cieľ sa zapisuje prvý — pri jeho zlyhaní sa zdroj nemaže)
        $this->assertFileExists($sourceAbs, 'zdroj musí zostať — nikdy sa nemaže pred úspešným zápisom cieľa');
        $this->assertSame($originalContent, file_get_contents($sourceAbs), 'obsah zdroja nezmenený');
        $this->assertFileDoesNotExist($this->tmp.'/presunute/novy.md', 'polovičný cieľ nesmie zostať');
        $this->assertNoTmpLeftover();
    }

    // ------------------------------------------------------------------
    // Secret → výnimka (B4 to mapuje na 422); force → varovanie, zapíše
    // ------------------------------------------------------------------

    public function test_secret_blocks_write_but_force_saves_with_warning(): void
    {
        $this->enableWrite();
        $writer = new BrainWriter;

        $secretValue = 'ghp_'.str_repeat('A1b2', 8);
        $draft = new NodeDraft(label: 'Tajný uzol', description: 'token '.$secretValue.' unikol');

        try {
            $writer->create($draft);
            $this->fail('create so secretom mal hodiť SecretsDetectedException');
        } catch (SecretsDetectedException $e) {
            $this->assertContains('github-token', $e->patterns);
            // KĽÚČOVÉ: hodnota tajomstva NIE JE v message
            $this->assertStringNotContainsString($secretValue, $e->getMessage());
        }

        // force=true prejde a vráti varovanie s NÁZVOM vzoru (nie hodnotou)
        $res = $writer->create($draft, force: true);
        $this->assertNotEmpty($res['warnings']);
        $joined = implode(' ', $res['warnings']);
        $this->assertStringContainsString('github-token', $joined);
        $this->assertStringNotContainsString($secretValue, $joined);
    }

    // ------------------------------------------------------------------
    // Delete → súbor preč, Tombstone, uzol preč
    // ------------------------------------------------------------------

    public function test_delete_removes_file_and_tombstones_external_key(): void
    {
        $this->enableWrite();
        $writer = new BrainWriter;

        $created = $writer->create(new NodeDraft(label: 'Na zmazanie', description: 'Text.'));
        $abs = $this->tmp.'/'.$created['source_file'];
        $node = Node::where('label', 'Na zmazanie')->firstOrFail();
        $key = $node->external_key;

        $writer->delete($node);

        $this->assertFileDoesNotExist($abs);
        $this->assertNull(Node::find($node->id), 'uzol sa zmazal');
        $this->assertTrue(Tombstone::where('external_key', $key)->exists(), 'external_key má náhrobok');
        $this->assertNoTmpLeftover();
    }

    // ------------------------------------------------------------------
    // Verify → frontmatter certainty: overene
    // ------------------------------------------------------------------

    public function test_verify_upgrades_frontmatter_certainty(): void
    {
        $this->enableWrite();
        $writer = new BrainWriter;

        $created = $writer->create(new NodeDraft(label: 'Overiť ma', description: 'Text.', certainty: 'hypoteza'));
        $abs = $this->tmp.'/'.$created['source_file'];
        $this->assertStringContainsString('certainty: hypoteza', file_get_contents($abs));

        $node = Node::where('label', 'Overiť ma')->firstOrFail();
        $writer->verify($node);

        $this->assertStringContainsString('certainty: overene', file_get_contents($abs));
        $this->assertStringNotContainsString('certainty: hypoteza', file_get_contents($abs));
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $f) {
            if ($f === '.' || $f === '..') {
                continue;
            }
            $p = $dir.'/'.$f;
            is_dir($p) ? $this->rrmdir($p) : @unlink($p);
        }
        @rmdir($dir);
    }
}
