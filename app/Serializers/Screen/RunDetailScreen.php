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
            'tool_profile' => $run->tool_profile,
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
            // Uuid rodiča — pri behu, ktorý začal človek, `null`. Detail podbehu sa
            // otvára z obrazovky Runy, takže bez tohto poľa nemá cestu „hore".
            'parent' => $run->parent?->uuid,
            'children' => $this->children(),
            'timeline' => $this->timeline(),
        ];
    }

    public function fieldsForAi(): array
    {
        return [
            'uuid', 'status', 'prompt', 'model', 'tool_profile', 'steps', 'tool_calls',
            'tokens_in', 'tokens_out', 'duration_ms', 'stop_reason', 'error',
            'started_at', 'thread', 'parent',
            'timeline[].kind', 'timeline[].role', 'timeline[].text',
            'timeline[].name', 'timeline[].arguments', 'timeline[].status',
            'timeline[].result', 'timeline[].error',
            // Podbehy dostáva AI v tom istom tvare, v akom ich má obrazovka —
            // vrátane `tool_calls` a `duration_ms`, ktoré má aj samotný beh. Keby
            // ich dieťa nemalo, AI by o rodičovi vedela, koľko stál, a o jeho
            // podagentovi nie, hoci práve tam sa cena ťahu skutočne točí.
            'children[].uuid', 'children[].status', 'children[].prompt',
            'children[].profile', 'children[].steps', 'children[].tool_calls',
            'children[].tokens_out', 'children[].duration_ms',
        ];
    }

    /**
     * Podbehy — deti tohto behu, ktoré spustil `spawn_agent`.
     *
     * Strom sa skladá TU (dáta), nie v prehliadači. Odsadenie, ikona a slovo
     * „podagent" sú slová a vizuál, tie patria UI.
     *
     * ## Prečo je `duration_ms` dieťaťa iné číslo než `duration_ms` rodiča
     *
     * `runs.duration_ms` je **wall clock**, kým `tokens_per_second` sa počíta
     * z generovacieho času správ. Sú to dva rôzne údaje a ani jeden nie je chyba —
     * pri podbehoch sa ten rozdiel len znásobuje:
     *
     *  - Rodič, ktorý zaparkoval na zápise svojho podagenta, meria vo svojom
     *    `duration_ms` **celý podbeh aj celé rozhodovanie človeka** o ňom. Podagent
     *    môže čakať na klik dni; rodičovo trvanie bude v dňoch a jeho
     *    `tokens_per_second` pritom zostane pravdivé.
     *  - Trvanie dieťaťa **nie je** položka v trvaní rodiča, ktorú by sa dalo odčítať
     *    a dostať „čistý čas rodiča". Segmenty sa prekrývajú: rodič je celý čas
     *    otvorený.
     *  - Sčítať `duration_ms` rodiča a jeho detí je preto vždy chyba — to isté
     *    čakanie by sa spočítalo dvakrát. Sčítať sa dajú `tokens_out`, tie sú
     *    disjunktné (kroky dieťaťa sa rodičovi nepripočítavajú, `agent` nie je
     *    v {@see \App\Services\Console\RunRecorder} STATEFUL).
     *
     * @return list<array<string, mixed>>
     */
    private function children(): array
    {
        return $this->run->children()->orderBy('id')->get()
            ->map(static fn (Run $child): array => [
                'uuid' => $child->uuid,
                'status' => $child->status,
                // Zadanie podagenta krátené na jednu vetu, presne ako riadok
                // v zozname behov — je to riadok, nie detail. Celé zadanie je
                // v detaile podbehu, ktorý má vlastné uuid. Krátenie je TU, aby
                // AI aj človek videli ten istý text.
                'prompt' => RunsScreen::clip((string) $child->prompt, 160),
                // Sada nástrojov, s ktorou dieťa bežalo (`memory` / `files` /
                // `graph`). V riadku behu sa to isté pole volá `tool_profile`;
                // tu je `profile`, pretože tak to určuje návrh vlny 1.
                'profile' => $child->tool_profile,
                'steps' => $child->steps,
                'tool_calls' => $child->tool_calls,
                'tokens_out' => $child->tokens_out,
                'duration_ms' => $child->duration_ms,
            ])
            ->all();
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
