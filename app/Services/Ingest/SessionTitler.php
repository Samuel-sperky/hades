<?php

namespace App\Services\Ingest;

use App\Llm\ChatOptions;
use Illuminate\Support\Carbon;

/**
 * Titulok a krátky popis session.
 *
 * Deterministická heuristika je prenesená verbatim z
 * {@see \App\Services\TranscriptIngestService::smartTitle()} a je JEDINÝ zdroj
 * titulku, kým je `config('ingest.llm_titles')` vypnutý (default).
 *
 * Pri zapnutí platí rozhodnutie #112 / #128: model dostane prompty session a
 * NAVRHNE titulok, ale použije sa len ak prejde {@see SuggestionGuard::title()}.
 * Keď model nie je dostupný, návrh je nevalidný alebo prázdny, vráti sa presne
 * dnešný heuristický titulok. `generatedBy()` potom povie, či titulok vyrobil
 * model (audit `meta.generated_by`, rozhodnutie #135).
 */
class SessionTitler
{
    /** Audit posledného vyrobeného titulku: {model, at, task} alebo null. */
    protected ?array $generatedBy = null;

    public function __construct(
        protected TranscriptParser $parser = new TranscriptParser(),
        protected SuggestionGuard $guard = new SuggestionGuard(),
        protected IngestLlm $llm = new IngestLlm(),
    ) {}

    /**
     * Titulok session. Deterministická heuristika je vždy vypočítaná ako prvá,
     * takže je zaručene k dispozícii ako fallback.
     *
     * @param  array<string, mixed>  $rec
     */
    public function title(array $rec): string
    {
        $this->generatedBy = null;
        $heuristic = $this->heuristicTitle($rec);

        $suggested = $this->suggestTitle($rec);
        if ($suggested !== null) {
            return $suggested;
        }

        return $heuristic;
    }

    /** Audit k naposledy vrátenému titulku, alebo null pri heuristike. */
    public function generatedBy(): ?array
    {
        return $this->generatedBy;
    }

    /**
     * Titulok v2: prejde všetky zmysluplné prompty, odstráni úvodné
     * slash-commandy a URL a použije prvú vetu s aspoň 15 znakmi.
     * Titulok nikdy nezačína na "http", "www." ani "/".
     * Fallback: "<projekt> — práca <dátum>".
     *
     * @param  array<string, mixed>  $rec
     */
    public function heuristicTitle(array $rec): string
    {
        foreach ($rec['prompts'] as $prompt) {
            if (! is_string($prompt) || trim($prompt) === '') {
                continue;
            }

            $clean = $this->parser->cleanPrompt($prompt);

            // opakovane odstráň úvodný slash-command token a úvodné URL
            do {
                $before = $clean;
                $clean = preg_replace('/^\/[\w:-]+\s*/u', '', $clean);
                $clean = preg_replace('/^(https?:\/\/\S+|www\.\S+)\s*/iu', '', $clean);
                $clean = ltrim($clean);
            } while ($clean !== $before);

            // prvá veta — rozdeľ na . ! ? alebo nový riadok
            $parts = preg_split('/(?<=[.!?])\s+|\r?\n/u', trim($clean), 2);
            $sentence = trim(preg_replace('/\s+/u', ' ', $parts[0] ?? ''));

            if (mb_strlen($sentence) < 15 || preg_match('/^(https?:|www\.|\/)/iu', $sentence)) {
                continue;
            }

            if (mb_strlen($sentence) <= 60) {
                return $sentence;
            }

            // skráť na 60 znakov, ale nikdy uprostred slova
            $cut = mb_substr($sentence, 0, 60);
            $lastSpace = mb_strrpos($cut, ' ');
            if ($lastSpace !== false && $lastSpace > 0) {
                $cut = mb_substr($cut, 0, $lastSpace);
            }

            return rtrim($cut, " \t.,;:—-");
        }

        $date = $rec['started_at'] ? Carbon::parse($rec['started_at'])->format('j.n.Y') : now()->format('j.n.Y');

        return ($rec['project'] ?? 'projekt').' — práca '.$date;
    }

    /**
     * Jednoriadkový popis session: dátum, projekt, počty, finálny text.
     *
     * @param  array<string, mixed>  $rec
     */
    public function describe(array $rec): string
    {
        $date = $rec['started_at'] ? Carbon::parse($rec['started_at'])->format('j.n.Y') : '';
        $parts = [];
        $parts[] = $date.' · '.($rec['project'] ?? 'projekt');
        $parts[] = count($rec['prompts']).' promptov';
        if (count($rec['files'])) {
            $parts[] = count($rec['files']).' súborov';
        }
        if (count($rec['commits'])) {
            $parts[] = count($rec['commits']).' commitov';
        }
        $line = implode(' · ', $parts);

        if ($rec['final']) {
            $line .= "\n\n".$rec['final'];
        }

        return $line;
    }

    /**
     * Návrh titulku od modelu, alebo null. Vypnuté = null bez jediného volania.
     *
     * @param  array<string, mixed>  $rec
     */
    protected function suggestTitle(array $rec): ?string
    {
        if (! $this->llm->enabled('llm_titles')) {
            return null;
        }

        $prompts = array_slice(array_values(array_filter(
            (array) ($rec['prompts'] ?? []),
            'is_string',
        )), 0, 3);

        if ($prompts === []) {
            return null;
        }

        // Kontext držíme malý — router má budget 3 000 znakov (rozhodnutie #147).
        $context = mb_substr(implode("\n", $prompts), 0, 2_000);

        $result = $this->llm->ask(
            [['role' => 'user', 'content' => $context]],
            new ChatOptions(
                maxTokens: 120,
                temperature: 0.1,
                system: (string) config('prompts.ingest.smart_title', self::DEFAULT_SYSTEM),
                task: 'smart_title',
            ),
        );

        if ($result === null) {
            return null;
        }

        $title = $this->guard->title($result->text);
        if ($title === null) {
            return null;
        }

        $this->generatedBy = [
            'model' => $result->model,
            'at' => now()->toIso8601String(),
            'task' => 'smart_title',
        ];

        return $title;
    }

    /** Použije sa, kým P5 nedoplní `config('prompts.ingest.smart_title')`. */
    private const DEFAULT_SYSTEM = 'Si pomocník, ktorý pomenúva pracovné záznamy. Z promptov používateľa '
        .'vytvor JEDEN slovenský titulok: 15 až 60 znakov, bez úvodzoviek, bez bodky na konci, '
        .'bez úvodu ani vysvetlenia. Vráť iba samotný titulok.';
}
