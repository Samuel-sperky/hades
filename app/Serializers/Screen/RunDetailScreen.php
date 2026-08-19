<?php

namespace App\Serializers\Screen;

use App\Models\ConsoleMessage;
use App\Models\ConsoleToolCall;
use App\Models\Run;
use App\Serializers\ScreenSerializer;

/**
 * Detail jedného behu — časová os toho, čo sa v ťahu naozaj stalo.
 *
 * Jeden zdroj pre `GET /api/runs/{uuid}` (človek) aj pre `mind_run` (AI).
 *
 * Časová os sa **skladá z existujúcich tabuliek**, nie z tretej kópie: správy
 * z `console_messages` v rozsahu id behu, tool cally z `console_tool_calls`.
 * Preto detail funguje aj pre behy, ktoré vznikli pred zavedením logu — rozsah id
 * sa dá dopočítať, kým surové rámce by boli navždy stratené.
 */
class RunDetailScreen extends ScreenSerializer
{
    /** Strop na výsledok tool callu v detaile. Celý výsledok je vo vlákne. */
    private const RESULT_CAP = 4000;

    public function __construct(private Run $run) {}

    public function data(): array
    {
        $run = $this->run;

        return [
            'uuid' => $run->uuid,
            'status' => $run->status,
            'source' => $run->source,
            'prompt' => (string) $run->prompt,
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
            'thread' => $run->thread?->uuid,
            'thread_title' => $run->thread?->title,
            'timeline' => $this->timeline(),
        ];
    }

    public function fieldsForAi(): array
    {
        return [
            'uuid', 'status', 'prompt', 'model', 'steps', 'tool_calls',
            'tokens_in', 'tokens_out', 'duration_ms', 'stop_reason', 'error',
            'started_at', 'thread',
            'timeline[].kind', 'timeline[].role', 'timeline[].text',
            'timeline[].name', 'timeline[].arguments', 'timeline[].status',
            'timeline[].result', 'timeline[].error',
        ];
    }

    /**
     * Správy a tool cally v jednej osi, zoradené tak, ako sa stali.
     *
     * Radenie je podľa `(id správy, id callu)`: tool call patrí k asistentskej
     * správe, ktorá ho vyžiadala, takže musí stáť za ňou. Zaparkovaný call ešte
     * `message_id` mať nemusí — ide na konec, čo je aj jeho skutočné miesto,
     * pretože beh na ňom stojí.
     *
     * @return list<array<string, mixed>>
     */
    private function timeline(): array
    {
        $rows = [];

        foreach ($this->run->messages() as $message) {
            // Systémová smernica do osi nepatrí: je to konfigurácia behu, nie jeho
            // krok, a v detaile by prekryla všetko ostatné (~2,6k tokenov).
            if ($message->role === 'system') {
                continue;
            }

            $rows[] = [
                'sort' => [(int) $message->id, 0],
                'kind' => 'message',
                'role' => $message->role,
                'text' => (string) $message->content,
                'model' => $message->model,
                'stop_reason' => $message->stop_reason,
                'tokens_in' => $message->tokens_in,
                'tokens_out' => $message->tokens_out,
                'duration_ms' => $message->duration_ms,
                'at' => $message->created_at?->toIso8601String(),
            ];
        }

        $lastMessageId = $this->run->to_message_id ?? PHP_INT_MAX;

        foreach ($this->run->toolCalls() as $call) {
            $rows[] = [
                'sort' => [(int) ($call->message_id ?? $lastMessageId), (int) $call->id],
                'kind' => 'tool',
                'name' => $call->name,
                'arguments' => $call->arguments,
                'status' => $call->status,
                'result' => self::cap((string) $call->result),
                'error' => $call->error,
                'preview' => $call->preview,
                'decided_at' => $call->decided_at?->toIso8601String(),
                'duration_ms' => $call->duration_ms,
                'at' => $call->created_at?->toIso8601String(),
            ];
        }

        usort($rows, static fn (array $a, array $b): int => $a['sort'] <=> $b['sort']);

        return array_values(array_map(static function (array $row): array {
            unset($row['sort']);

            return $row;
        }, $rows));
    }

    private static function cap(string $text): string
    {
        if ($text === '' || mb_strlen($text) <= self::RESULT_CAP) {
            return $text;
        }

        return mb_substr($text, 0, self::RESULT_CAP)."\n… (skrátené, celý výsledok je vo vlákne)";
    }

    /**
     * Správy behu bez systémovej smernice — použije to „spustiť znovu", aby vedelo,
     * čo bolo zadaním.
     */
    public function userPrompt(): string
    {
        if (($prompt = trim((string) $this->run->prompt)) !== '') {
            return $prompt;
        }

        $first = $this->run->messages()->firstWhere('role', 'user');

        return (string) ($first instanceof ConsoleMessage ? $first->content : '');
    }

    /** Zaparkovaný zápis behu, ak naň beh stále čaká. */
    public function pendingCall(): ?ConsoleToolCall
    {
        return $this->run->toolCalls()->firstWhere('status', 'pending');
    }
}
