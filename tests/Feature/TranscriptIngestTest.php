<?php

namespace Tests\Feature;

use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use App\Services\TranscriptIngestService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\Ingest\BuildsTranscripts;
use Tests\TestCase;

/**
 * Ingest transcriptov po rozsekaní na vrstvy (W2/P3) — chovanie sa nesmie
 * zmeniť, ingest beží každých 10 minút na živých dátach.
 *
 * Pokrýva aj dve doložené poistky:
 *  - redakcia tajomstiev PRED zápisom do pamäte (SecretScanner v ingeste),
 *  - preteky dvoch paralelných behov nad tou istou session (`firstOrCreate`).
 */
class TranscriptIngestTest extends TestCase
{
    use BuildsTranscripts;
    use RefreshDatabase;

    /**
     * Vymyslený base64 kľúč: 60 znakov z A-Za-z0-9+/, zámerne NIE hex, aby test
     * skutočne prechádzal vzorom `high-entropy-b64`.
     */
    private const FAKE_B64_KEY = 'aZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootTranscriptFixtures();
    }

    protected function tearDown(): void
    {
        $this->cleanTranscriptFixtures();
        parent::tearDown();
    }

    private function ingest(): TranscriptIngestService
    {
        return $this->ingestService();
    }

    // ---- základné chovanie -------------------------------------------------

    public function test_session_becomes_memory_node_with_project_edge_and_markdown(): void
    {
        $this->writeTranscript('test-basic', ['Rozsekaj ingest na štyri vrstvy.']);

        $summary = $this->ingest()->ingestAll();

        $this->assertSame(1, $summary['files']);
        $this->assertSame(1, $summary['created']);
        $this->assertSame(0, $summary['updated']);

        $node = Node::where('external_key', 'session:test-basic')->firstOrFail();
        $this->assertSame('memory', $node->type);
        $this->assertSame('session', $node->source);
        $this->assertSame('Rozsekaj ingest na štyri vrstvy.', $node->label);
        $this->assertSame($this->fixtureArea->id, $node->area_id);
        $this->assertSame('Záznamy — projekt-test', Department::find($node->department_id)->name);

        // meta je kontrakt pre dashboard/denník
        $this->assertSame('test-basic', $node->meta['session_id']);
        $this->assertSame('projekt-test', $node->meta['project']);
        $this->assertSame('feat/auraai', $node->meta['git_branch']);
        $this->assertSame(1, $node->meta['prompt_count']);
        $this->assertSame(['app/Foo.php'], $node->meta['files']);
        $this->assertSame(['test: pridaný Foo'], $node->meta['commits']);
        $this->assertSame(['Write' => 1, 'Bash' => 1], $node->meta['tools']);
        $this->assertSame('2026-07-01', $node->created_at->format('Y-m-d'));

        // extraktívne zhrnutie ide do popisu a do .md dokumentu
        $this->assertStringStartsWith('**Čo:**', (string) $node->description);
        $this->assertSame('summaries/sessions/test-basic.md', $node->meta['summary_path']);
        $this->assertFileExists(base_path($node->meta['summary_path']));

        // projektový uzol + jedna hrana záznam ↔ projekt
        $project = Node::where('external_key', 'project:projekt-test')->firstOrFail();
        $this->assertSame('project', $project->type);
        $this->assertSame(1, Edge::count());
    }

    public function test_second_run_of_unchanged_file_is_skipped(): void
    {
        $this->writeTranscript('test-idem', ['Rozsekaj ingest na štyri vrstvy.']);

        $this->ingest()->ingestAll();
        $second = $this->ingest()->ingestAll();

        $this->assertSame(0, $second['created']);
        $this->assertSame(0, $second['updated']);
        $this->assertSame(1, $second['skipped']);
        $this->assertSame(1, Node::where('external_key', 'session:test-idem')->count());
    }

    public function test_noise_prompts_never_become_the_title(): void
    {
        $this->writeTranscript('test-noise', [
            'ok', 'pokračuj', 'Rozsekaj ingest na štyri vrstvy.',
        ]);

        $this->ingest()->ingestAll();

        $node = Node::where('external_key', 'session:test-noise')->firstOrFail();
        $this->assertSame('Rozsekaj ingest na štyri vrstvy.', $node->label);
        $this->assertSame(2, $node->meta['noise_filtered']);
        $this->assertSame(1, $node->meta['prompt_count']);
    }

    public function test_update_never_overwrites_manual_edits(): void
    {
        $path = $this->writeTranscript('test-manual', ['Rozsekaj ingest na štyri vrstvy.']);
        $this->ingest()->ingestAll();

        $node = Node::where('external_key', 'session:test-manual')->firstOrFail();
        $node->update(['label' => 'Ručne prepísané', 'description' => 'ručný popis', 'strength' => 7]);

        // súbor je novší než meta.ingested_at → session sa dopĺňa
        touch($path, time() + 120);
        $summary = $this->ingest()->ingestAll();

        $this->assertSame(1, $summary['updated']);
        $node->refresh();
        $this->assertSame('Ručne prepísané', $node->label);
        $this->assertSame('ručný popis', $node->description);
        $this->assertSame(7.0, $node->strength);
    }

    public function test_force_refresh_rebuilds_label_but_keeps_strength(): void
    {
        $this->writeTranscript('test-force', ['Rozsekaj ingest na štyri vrstvy.']);
        $this->ingest()->ingestAll();

        $node = Node::where('external_key', 'session:test-force')->firstOrFail();
        $node->update(['label' => 'Ručne prepísané', 'strength' => 7]);

        $summary = $this->ingest()->ingestAll(onlyNew: false, forceRefresh: true);

        $this->assertSame(1, $summary['updated']);
        $node->refresh();
        $this->assertSame('Rozsekaj ingest na štyri vrstvy.', $node->label);
        $this->assertSame(7.0, $node->strength);
    }

    public function test_tombstoned_session_is_never_recreated(): void
    {
        $this->writeTranscript('test-tomb', ['Rozsekaj ingest na štyri vrstvy.']);
        Tombstone::create([
            'external_key' => 'session:test-tomb', 'reason' => 'merge', 'created_at' => now(),
        ]);

        $summary = $this->ingest()->ingestAll();

        $this->assertSame(0, $summary['created']);
        $this->assertSame(1, $summary['skipped']);
        $this->assertSame(0, Node::where('external_key', 'session:test-tomb')->count());
    }

    // ---- redakcia tajomstiev (P3, úloha 2) ---------------------------------

    public function test_secret_in_prompt_and_final_text_is_written_redacted(): void
    {
        $key = self::FAKE_B64_KEY;

        $this->writeTranscript(
            'test-secret',
            ['Ulož konfiguráciu do repozitára. Kľúč je '.$key.' a nikde ho nevypisuj.'],
            finalText: 'Nastavil som hodnotu '.$key.' do konfigurácie.',
        );

        $this->ingest()->ingestAll();

        $node = Node::where('external_key', 'session:test-secret')->firstOrFail();
        $serialized = json_encode($node->toArray(), JSON_UNESCAPED_UNICODE);

        // nikde v uzle: ani v labele, ani v popise, ani v meta.prompts/final
        $this->assertStringNotContainsString($key, (string) $serialized);
        $this->assertStringContainsString('[REDAKTOVANÉ: high-entropy-b64]', (string) $serialized);

        // spomienka sa nezahodila, len sa vystrihlo tajomstvo
        $this->assertSame('Ulož konfiguráciu do repozitára.', $node->label);
        $this->assertStringContainsString('[REDAKTOVANÉ: high-entropy-b64]', $node->meta['prompts'][0]);
        $this->assertStringContainsString('a nikde ho nevypisuj', $node->meta['prompts'][0]);
        $this->assertStringNotContainsString($key, (string) $node->meta['final']);

        // .md dokument je odvodený z toho istého meta — kľúč sa nesmie objaviť ani tam
        $md = (string) file_get_contents(base_path($node->meta['summary_path']));
        $this->assertStringNotContainsString($key, $md);
        $this->assertStringContainsString('[REDAKTOVANÉ: high-entropy-b64]', $md);
    }

    // ---- preteky dvoch behov (P3, úloha 3) ---------------------------------

    /**
     * Regresia na duplicate `external_key` (SQLSTATE[23000], doložené 3× v
     * laravel.log za 13 dní): 10-minútový `mind:ingest` a nočný `--all`, alebo
     * dve súbežné Claude Code sessions, môžu ten istý kľúč vložiť medzi náš
     * SELECT a náš INSERT. Preteky simulujeme deterministicky — cudzí zápis
     * vložíme presne po SELECT-e, ktorý uzol nenašiel.
     */
    public function test_parallel_ingest_of_the_same_session_creates_one_node(): void
    {
        $path = $this->writeTranscript('test-race', ['Rozsekaj ingest na štyri vrstvy.']);
        $key = 'session:test-race';

        $raced = false;
        DB::listen(function ($query) use (&$raced, $key) {
            if ($raced || ! str_starts_with(strtolower(ltrim($query->sql)), 'select * from `nodes`')) {
                return;
            }
            if (! str_contains($query->sql, 'external_key')) {
                return;
            }
            $raced = true;

            Node::create([
                'type' => 'memory', 'source' => 'session', 'external_key' => $key,
                'label' => 'Cudzí beh', 'description' => 'popis z cudzieho behu',
                'strength' => 3, 'last_activated_at' => now(),
            ]);
        });

        $result = $this->ingest()->ingestFile($path);

        $this->assertTrue($raced, 'Preteky sa nenasimulovali — SELECT nad nodes.external_key nezachytený.');

        // žiadna výnimka, žiadny duplikát, cudzí zápis zostal autoritou
        $this->assertSame('updated', $result);
        $this->assertSame(1, Node::where('external_key', $key)->count());

        $node = Node::where('external_key', $key)->firstOrFail();
        $this->assertSame('Cudzí beh', $node->label);
        $this->assertSame('popis z cudzieho behu', $node->description);
        $this->assertSame(3.0, $node->strength);

        // meta sa doplnila (to je jediné, čo prehratý beh smie zapísať)
        $this->assertSame('test-race', $node->meta['session_id']);
        $this->assertSame('projekt-test', $node->meta['project']);

        // žiadne zdvojenie hrán, .md ani pulzu — hrana je len jedna a súbor nevznikol
        $this->assertSame(1, Edge::count());
        $this->assertArrayNotHasKey('summary_path', $node->meta);
        $this->assertFileDoesNotExist(base_path('summaries/sessions/test-race.md'));
    }
}
