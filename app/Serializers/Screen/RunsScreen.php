<?php

namespace App\Serializers\Screen;

use App\Models\Run;
use App\Serializers\ScreenSerializer;
use Illuminate\Support\Carbon;

/**
 * Obrazovka Runy — zoznam behov.
 *
 * Jeden zdroj pre `GET /api/runs` (človek) aj pre `mind_runs` (AI). Filtre sú tu,
 * nie na klientovi: audit ukázal, že práve klientske dopočítavanie je miesto, kde
 * sa dve plochy rozchádzajú (Denník počítal projekty z 50 načítaných záznamov,
 * hoci server posiela všetky).
 */
class RunsScreen extends ScreenSerializer
{
    /** Strop na jednu stránku. Vyššie čísla nemá zmysel posielať ani človeku. */
    public const MAX_LIMIT = 200;

    /**
     * @param  array<string, mixed>  $filters  status, model, source, thread, since, q, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $limit = min((int) ($this->filters['limit'] ?? 50), self::MAX_LIMIT);
        $limit = max($limit, 1);

        $query = Run::query()->with('thread:id,uuid,title');

        if (($status = $this->filters['status'] ?? null) !== null && $status !== '') {
            $query->where('status', $status);
        }

        if (($model = $this->filters['model'] ?? null) !== null && $model !== '') {
            $query->where('model', $model);
        }

        if (($source = $this->filters['source'] ?? null) !== null && $source !== '') {
            $query->where('source', $source);
        }

        if (($thread = $this->filters['thread'] ?? null) !== null && $thread !== '') {
            $query->whereHas('thread', fn ($q) => $q->where('uuid', $thread));
        }

        if (($since = $this->filters['since'] ?? null) !== null && $since !== '') {
            $query->where('started_at', '>=', Carbon::parse($since));
        }

        // Hľadanie v zadaní behu. `LIKE` a nie FULLTEXT zámerne: promptov je rádovo
        // menej než uzlov a index by tu bol náklad bez merateľného zisku.
        if (($q = $this->filters['q'] ?? null) !== null && $q !== '') {
            $query->where('prompt', 'like', '%'.$q.'%');
        }

        $runs = $query->orderByDesc('started_at')->orderByDesc('id')->limit($limit)->get();

        return [
            'items' => $runs->map(fn (Run $run): array => $this->row($run))->all(),
            'counts' => $this->counts(),
            'models' => $this->distinct('model'),
            'sources' => $this->distinct('source'),
            'limit' => $limit,
        ];
    }

    public function fieldsForAi(): array
    {
        return [
            'counts',
            'items[].uuid', 'items[].status', 'items[].prompt', 'items[].model',
            'items[].steps', 'items[].tool_calls', 'items[].tokens_out',
            'items[].duration_ms', 'items[].stop_reason', 'items[].error',
            'items[].started_at', 'items[].thread',
        ];
    }

    /**
     * Jeden riadok zoznamu.
     *
     * `prompt` je krátený na jednu vetu do zoznamu — celý je v detaile. Krátenie je
     * TU a nie v prehliadači, aby AI aj človek videli ten istý text.
     *
     * @return array<string, mixed>
     */
    private function row(Run $run): array
    {
        return [
            'uuid' => $run->uuid,
            'status' => $run->status,
            'source' => $run->source,
            'prompt' => self::clip((string) $run->prompt, 160),
            'provider' => $run->provider,
            'model' => $run->model,
            'steps' => $run->steps,
            'tool_calls' => $run->tool_calls,
            'tokens_in' => $run->tokens_in,
            'tokens_out' => $run->tokens_out,
            'tokens_per_second' => $run->tokens_per_second,
            'duration_ms' => $run->duration_ms,
            'stop_reason' => $run->stop_reason,
            'error' => $run->error,
            'started_at' => $run->started_at?->toIso8601String(),
            'ended_at' => $run->ended_at?->toIso8601String(),
            // Kľúč na zoskupenie časovej osi po dňoch. Je tu z toho istého dôvodu,
            // z akého Rozhodnutia dostávajú `month`: hranicu dňa určuje časová zóna
            // servera, a keby si ju klient počítal z `started_at` sám, dva behy tesne
            // okolo polnoci by v UI a v odpovedi pre AI spadli do iných dní.
            // Popisok hlavičky (dnes/včera/dátum) je naopak vizuálny a robí ho UI.
            'day' => $run->started_at?->toDateString(),
            'thread' => $run->thread?->uuid,
            'thread_title' => $run->thread?->title,
        ];
    }

    /**
     * Počty podľa stavu. Sú v odpovedi preto, aby filter v UI vedel, čo má zmysel
     * nabídnuť, a aby AI dostala tvar behu appky jedným volaním.
     *
     * @return array<string, int>
     */
    private function counts(): array
    {
        $counts = Run::query()
            ->selectRaw('status, COUNT(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status')
            ->all();

        $counts['total'] = array_sum($counts);

        return array_map('intval', $counts);
    }

    /**
     * @return list<string>
     */
    private function distinct(string $column): array
    {
        return Run::query()
            ->whereNotNull($column)
            ->distinct()
            ->orderBy($column)
            ->pluck($column)
            ->all();
    }

    public static function clip(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);

        if (mb_strlen($text) <= $max) {
            return $text;
        }

        return mb_substr($text, 0, $max - 1).'…';
    }
}
