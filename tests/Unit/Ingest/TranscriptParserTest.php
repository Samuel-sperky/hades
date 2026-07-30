<?php

namespace Tests\Unit\Ingest;

use App\Services\Ingest\SessionTitler;
use App\Services\Ingest\TranscriptParser;
use PHPUnit\Framework\TestCase;

/**
 * Parser a heuristika titulku — čisté funkcie, bez DB a bez modelu.
 * Test drží chovanie, ktoré malo pôvodné `TranscriptIngestService` pred
 * rozsekaním na vrstvy (W2/P3).
 */
class TranscriptParserTest extends TestCase
{
    /**
     * Vymyslený base64 kľúč: 60 znakov z A-Za-z0-9+/, zámerne NIE hex — inak by
     * ho zachytil vzor `long-hex` a vzor `high-entropy-b64` by nebol otestovaný.
     */
    private const FAKE_B64_KEY = 'aZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x+K/LaZ9x';

    private TranscriptParser $parser;

    private string $tmp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->parser = new TranscriptParser;
        $this->tmp = sys_get_temp_dir().'/auraai-parser-'.uniqid().'.jsonl';
    }

    protected function tearDown(): void
    {
        if (is_file($this->tmp)) {
            unlink($this->tmp);
        }
        parent::tearDown();
    }

    /** @param  list<array<string, mixed>>  $lines */
    private function transcript(array $lines): string
    {
        $out = [];
        foreach ($lines as $line) {
            $out[] = json_encode($line, JSON_UNESCAPED_UNICODE);
        }
        file_put_contents($this->tmp, implode("\n", $out)."\n");

        return $this->tmp;
    }

    // ---- filter šumu -------------------------------------------------------

    public function test_short_and_confirming_prompts_are_noise(): void
    {
        $this->assertTrue($this->parser->isNoisePrompt('ok'));
        $this->assertTrue($this->parser->isNoisePrompt('pokračuj!'));
        $this->assertTrue($this->parser->isNoisePrompt('krátke'));
        $this->assertTrue($this->parser->isNoisePrompt('<system-reminder>čokoľvek</system-reminder>'));
        $this->assertTrue($this->parser->isNoisePrompt('Caveat: The messages below were generated'));
        $this->assertFalse($this->parser->isNoisePrompt('Rozsekaj ingest na štyri vrstvy a nechaj chovanie.'));
    }

    public function test_filter_noise_returns_kept_prompts_and_count(): void
    {
        [$kept, $filtered] = $this->parser->filterNoise([
            'ok', 'Rozsekaj ingest na parser a writer.', 'pokracuj', 'Doplň regresný test na preteky.',
        ]);

        $this->assertSame(['Rozsekaj ingest na parser a writer.', 'Doplň regresný test na preteky.'], $kept);
        $this->assertSame(2, $filtered);
    }

    // ---- cleanPrompt -------------------------------------------------------

    public function test_clean_prompt_strips_file_references_and_squeezes_spaces(): void
    {
        $this->assertSame(
            'Pozri sa na a oprav to',
            $this->parser->cleanPrompt('Pozri sa na @"C:\\Aura\\app.php"   a oprav to'),
        );
    }

    public function test_clean_prompt_redacts_secrets_but_keeps_the_memory(): void
    {
        $fakeKey = self::FAKE_B64_KEY;

        $out = $this->parser->cleanPrompt('Kľúč je '.$fakeKey.' a nikde ho nevypisuj');

        $this->assertStringNotContainsString($fakeKey, $out);
        $this->assertStringContainsString('[REDAKTOVANÉ: high-entropy-b64]', $out);
        $this->assertStringContainsString('a nikde ho nevypisuj', $out);
    }

    // ---- parse -------------------------------------------------------------

    public function test_parse_extracts_session_prompts_files_commits_and_tools(): void
    {
        $path = $this->transcript([
            [
                'sessionId' => 'abc-123',
                'cwd' => 'C:\\Aura\\projekt-test',
                'gitBranch' => 'feat/auraai',
                'timestamp' => '2026-07-01T08:00:00.000Z',
            ],
            [
                'type' => 'queue-operation', 'operation' => 'enqueue',
                'content' => 'Rozsekaj ingest na štyri vrstvy.',
                'timestamp' => '2026-07-01T08:05:00.000Z',
            ],
            [
                'message' => ['role' => 'assistant', 'content' => [
                    ['type' => 'tool_use', 'name' => 'Write', 'input' => ['file_path' => 'C:\\Aura\\projekt-test\\app\\Foo.php']],
                    ['type' => 'tool_use', 'name' => 'Write', 'input' => ['file_path' => 'C:/Aura/projekt-test/app/Foo.php']],
                    ['type' => 'tool_use', 'name' => 'Bash', 'input' => ['command' => 'git commit -m "refactor: split ingest"']],
                    ['type' => 'tool_use', 'name' => 'Bash', 'input' => ['command' => 'ls -la']],
                    ['type' => 'text', 'text' => "Hotovo.\n\nRozsekané   na vrstvy."],
                ]],
                'timestamp' => '2026-07-01T09:30:00.000Z',
            ],
        ]);

        $rec = $this->parser->parse($path);

        $this->assertNotNull($rec);
        $this->assertSame('abc-123', $rec['session_id']);
        $this->assertSame('projekt-test', $rec['project']);
        $this->assertSame('feat/auraai', $rec['git_branch']);
        $this->assertSame('2026-07-01T08:00:00.000Z', $rec['started_at']);
        $this->assertSame('2026-07-01T09:30:00.000Z', $rec['ended_at']);
        $this->assertSame(['Rozsekaj ingest na štyri vrstvy.'], $rec['prompts']);

        // rôzne lomky tej istej cesty sú jedna cesta, relatívna k cwd
        $this->assertSame(['app/Foo.php'], $rec['files']);
        $this->assertSame(['refactor: split ingest'], $rec['commits']);
        $this->assertSame(['Write' => 2, 'Bash' => 2], $rec['tools']);
        $this->assertSame('Hotovo. Rozsekané na vrstvy.', $rec['final']);
    }

    public function test_parse_ignores_broken_json_lines(): void
    {
        file_put_contents($this->tmp, "toto nie je json\n".json_encode([
            'sessionId' => 'x-1',
            'type' => 'queue-operation', 'operation' => 'enqueue',
            'content' => 'Prompt, ktorý má aspoň pätnásť znakov.',
        ])."\n\n");

        $rec = $this->parser->parse($this->tmp);

        $this->assertSame('x-1', $rec['session_id']);
        $this->assertSame(['Prompt, ktorý má aspoň pätnásť znakov.'], $rec['prompts']);
    }

    public function test_parse_redacts_final_assistant_text(): void
    {
        $fakeKey = self::FAKE_B64_KEY;
        $path = $this->transcript([
            ['sessionId' => 'sec-1', 'timestamp' => '2026-07-01T08:00:00.000Z'],
            [
                'message' => ['role' => 'assistant', 'content' => [
                    ['type' => 'text', 'text' => 'Kľúč '.$fakeKey.' je nastavený.'],
                ]],
            ],
        ]);

        $rec = $this->parser->parse($path);

        $this->assertStringNotContainsString($fakeKey, (string) $rec['final']);
        $this->assertStringContainsString('[REDAKTOVANÉ: high-entropy-b64]', (string) $rec['final']);
    }

    // ---- heuristický titulok ----------------------------------------------

    /** @return array<string, array{0: array<int, string>, 1: string}> */
    public static function titleCases(): array
    {
        return [
            'prvá veta prvého promptu' => [
                ['Rozsekaj ingest na vrstvy. A potom doplň testy.'],
                'Rozsekaj ingest na vrstvy.',
            ],
            'úvodný slash-command sa zlúpne' => [
                ['/sprint Rozsekaj ingest na štyri vrstvy.'],
                'Rozsekaj ingest na štyri vrstvy.',
            ],
            'úvodná URL sa zlúpne' => [
                ['https://example.test/x Rozsekaj ingest na vrstvy.'],
                'Rozsekaj ingest na vrstvy.',
            ],
            'príliš krátka veta sa preskočí' => [
                ['Krátke.', 'Rozsekaj ingest na štyri vrstvy a doplň testy.'],
                'Rozsekaj ingest na štyri vrstvy a doplň testy.',
            ],
            'dlhá veta sa reže na hranici slova' => [
                ['Rozsekaj TranscriptIngestService na parser, klasifikátor, linker a writer bez zmeny chovania'],
                'Rozsekaj TranscriptIngestService na parser, klasifikátor',
            ],
        ];
    }

    /**
     * @param  array<int, string>  $prompts
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('titleCases')]
    public function test_heuristic_title(array $prompts, string $expected): void
    {
        $titler = new SessionTitler($this->parser);

        $rec = ['prompts' => $prompts, 'project' => 'projekt-test', 'started_at' => '2026-07-01T08:00:00.000Z'];

        $this->assertSame($expected, $titler->heuristicTitle($rec));
    }

    public function test_heuristic_title_falls_back_to_project_and_date(): void
    {
        $titler = new SessionTitler($this->parser);

        $rec = ['prompts' => [], 'project' => 'projekt-test', 'started_at' => '2026-07-01T08:00:00.000Z'];

        $this->assertSame('projekt-test — práca 1.7.2026', $titler->heuristicTitle($rec));
    }
}
