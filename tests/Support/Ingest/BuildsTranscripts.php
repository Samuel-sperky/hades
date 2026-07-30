<?php

namespace Tests\Support\Ingest;

use App\Models\Area;
use App\Services\TranscriptIngestService;
use Illuminate\Support\Facades\File;

/**
 * Fixtúry pre testy ingestu (P3): dočasný mount transcriptov + generátor JSONL
 * súborov v tvare, v akom ich píše Claude Code.
 *
 * Všetky dáta sú fiktívne. Testy, ktoré trait používajú, musia mať
 * `RefreshDatabase` — vytvára sa oblasť pre klasifikátor.
 */
trait BuildsTranscripts
{
    protected string $transcriptBase;

    protected Area $fixtureArea;

    /** Zavolať zo setUp() po parent::setUp(). */
    protected function bootTranscriptFixtures(): void
    {
        $this->transcriptBase = storage_path('framework/testing/transcripts-'.uniqid());
        File::ensureDirectoryExists($this->transcriptBase.'/projekt-test');

        config([
            'auraai.transcripts_path' => $this->transcriptBase,
            'auraai.project_area_map' => [],
            'auraai.project_area_fallback' => 'vyvoj-kod',
            'cache.default' => 'array',
        ]);

        $this->fixtureArea = Area::create([
            'name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 342,
        ]);
    }

    /** Zavolať z tearDown() pred parent::tearDown(). */
    protected function cleanTranscriptFixtures(): void
    {
        File::deleteDirectory($this->transcriptBase);

        foreach (glob(base_path('summaries/sessions/test-*.md')) ?: [] as $md) {
            if (is_file($md)) {
                unlink($md);
            }
        }
    }

    /** Konštruktor služby číta transcripts_path z configu → resolve až po config(). */
    protected function ingestService(): TranscriptIngestService
    {
        return app(TranscriptIngestService::class);
    }

    /**
     * Vytvorí JSONL transcript. Názov súboru == sessionId (tak to robí Claude Code).
     *
     * @param  array<int, string>  $prompts
     */
    protected function writeTranscript(
        string $sessionId,
        array $prompts,
        ?string $finalText = 'Hotovo, ingest je rozsekaný.',
    ): string {
        $lines = [json_encode([
            'sessionId' => $sessionId,
            'cwd' => 'C:\\Aura\\projekt-test',
            'gitBranch' => 'feat/auraai',
            'timestamp' => '2026-07-01T08:00:00.000Z',
        ], JSON_UNESCAPED_UNICODE)];

        foreach ($prompts as $prompt) {
            $lines[] = json_encode([
                'type' => 'queue-operation', 'operation' => 'enqueue',
                'content' => $prompt, 'timestamp' => '2026-07-01T08:05:00.000Z',
            ], JSON_UNESCAPED_UNICODE);
        }

        $content = [
            ['type' => 'tool_use', 'name' => 'Write', 'input' => ['file_path' => 'C:\\Aura\\projekt-test\\app\\Foo.php']],
            ['type' => 'tool_use', 'name' => 'Bash', 'input' => ['command' => 'git commit -m "test: pridaný Foo"']],
        ];
        if ($finalText !== null) {
            $content[] = ['type' => 'text', 'text' => $finalText];
        }
        $lines[] = json_encode([
            'message' => ['role' => 'assistant', 'content' => $content],
            'timestamp' => '2026-07-01T09:30:00.000Z',
        ], JSON_UNESCAPED_UNICODE);

        $path = $this->transcriptBase.'/projekt-test/'.$sessionId.'.jsonl';
        file_put_contents($path, implode("\n", $lines)."\n");

        return $path;
    }
}
