<?php

namespace App\Services\Ingest;

use App\Llm\ChatOptions;
use App\Services\SummaryService;

/**
 * Zhrnutie session pre popis uzla a .md dokument.
 *
 * {@see SummaryService} zostáva zámerne čisto extraktívny a bez modelu — je to
 * jediná vrstva, ktorá musí fungovať vždy. Abstraktívna nadstavba (rozhodnutie
 * #129) žije tu, je za vypínačom `config('ingest.llm_summaries')` (default
 * vypnutý) a platí pre ňu rovnaké pravidlo ako pre titulok: návrh modelu sa
 * použije len keď prejde {@see SuggestionGuard::summary()}, inak sa vráti
 * extraktívne zhrnutie — teda presne dnešný výsledok.
 *
 * Abstraktívne zhrnutie sa robí len pri VZNIKU záznamu (writer ho volá len pre
 * `created` / `--force-refresh`), nikdy sa dodatočne neprepisuje.
 */
class SessionSummarizer
{
    public function __construct(
        protected SummaryService $summaries = new SummaryService(),
        protected SuggestionGuard $guard = new SuggestionGuard(),
        protected IngestLlm $llm = new IngestLlm(),
    ) {}

    /**
     * @param  array<string, mixed>  $meta
     * @return array{0: string, 1: array<string, string>|null}  text + audit generated_by
     */
    public function summarize(array $meta): array
    {
        $extractive = $this->summaries->forSession($meta);

        if (! $this->llm->enabled('llm_summaries')) {
            return [$extractive, null];
        }

        $result = $this->llm->ask(
            [['role' => 'user', 'content' => $this->context($meta, $extractive)]],
            new ChatOptions(
                maxTokens: 400,
                temperature: 0.2,
                system: (string) config('prompts.ingest.session_summary', self::DEFAULT_SYSTEM),
                task: 'session_summary',
            ),
        );

        if ($result === null) {
            return [$extractive, null];
        }

        $summary = $this->guard->summary($result->text);
        if ($summary === null) {
            return [$extractive, null];
        }

        return [$summary, [
            'model' => $result->model,
            'at' => now()->toIso8601String(),
            'task' => 'session_summary',
        ]];
    }

    /**
     * Vstup pre model: už zredigované prompty a extraktívne zhrnutie. Nič, čo by
     * neprešlo redakciou v {@see TranscriptParser::cleanPrompt()}, sa sem nedostane.
     *
     * @param  array<string, mixed>  $meta
     */
    protected function context(array $meta, string $extractive): string
    {
        $prompts = array_slice(array_values(array_filter(
            (array) ($meta['prompts'] ?? []),
            'is_string',
        )), 0, 5);

        $parts = [];
        if ($extractive !== '') {
            $parts[] = 'Fakty zo záznamu:'."\n".$extractive;
        }
        if ($prompts !== []) {
            $parts[] = 'Prompty:'."\n".implode("\n", $prompts);
        }

        // Budget podľa rozhodnutia #147 — utility úlohy idú na router model.
        return mb_substr(implode("\n\n", $parts), 0, 3_000);
    }

    /** Použije sa, kým P5 nedoplní `config('prompts.ingest.session_summary')`. */
    private const DEFAULT_SYSTEM = 'Zhrň pracovnú session po slovensky v 2 až 4 vetách: čo sa riešilo a '
        .'aký to malo výsledok. Nevymýšľaj fakty, ktoré nie sú vo vstupe. Bez úvodu, bez nadpisu, '
        .'bez odrážok — iba samotné zhrnutie.';
}
