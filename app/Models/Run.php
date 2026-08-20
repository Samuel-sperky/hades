<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;

/**
 * Jeden beh konzoly — záznam v logu runov.
 *
 * Beh nedrží kópiu správ ani tool callov. Drží **rozsah id**
 * (`from_message_id` – `to_message_id`) a správy si dotiahne z `console_messages`,
 * tool cally z `console_tool_calls`. Dôvod je v migrácii: existujúce tabuľky už
 * všetko nesú a tretia kópia by sa s nimi rozišla.
 */
class Run extends Model
{
    use HasFactory;
    use HasUuids;

    /** `uuid` je verejný identifikátor, kľúčom v DB zostáva `id`. */
    public function uniqueIds(): array
    {
        return ['uuid'];
    }

    protected $fillable = [
        'uuid', 'thread_id', 'source', 'prompt', 'provider', 'model', 'status',
        'stop_reason', 'error', 'steps', 'tool_calls', 'tokens_in', 'tokens_out',
        'duration_ms', 'tokens_per_second', 'from_message_id', 'to_message_id',
        'started_at', 'ended_at',
    ];

    protected $casts = [
        'steps' => 'int',
        'tool_calls' => 'int',
        'tokens_in' => 'int',
        'tokens_out' => 'int',
        'duration_ms' => 'int',
        'tokens_per_second' => 'float',
        'from_message_id' => 'int',
        'to_message_id' => 'int',
        'started_at' => 'datetime',
        'ended_at' => 'datetime',
    ];

    /** Stavy, v ktorých beh ešte nie je uzavretý a `/decide` ho môže pokračovať. */
    public const OPEN_STATES = ['running', 'waiting'];

    public function thread(): BelongsTo
    {
        return $this->belongsTo(ConsoleThread::class, 'thread_id');
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereIn('status', self::OPEN_STATES);
    }

    /** Beh je uzavretý, keď už nemôže dostať ďalší rámec. */
    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN_STATES, true);
    }

    /**
     * Správy behu. Prázdny rozsah znamená beh, ktorý nič nezapísal (spadol pred
     * prvou správou) — vtedy je to prázdna kolekcia, nie celé vlákno.
     *
     * @return Collection<int, ConsoleMessage>
     */
    public function messages(): Collection
    {
        if ($this->from_message_id === null || $this->to_message_id === null) {
            return new Collection;
        }

        return ConsoleMessage::query()
            ->where('thread_id', $this->thread_id)
            ->whereBetween('id', [$this->from_message_id, $this->to_message_id])
            ->orderBy('id')
            ->get();
    }

    /**
     * Tool cally behu. Viažu sa na `message_id`, nie na vlastný rozsah — tool call
     * vzniká vždy k asistentskej správe, takže rozsah správ ho určí presne aj bez
     * `run_id`.
     *
     * Skôr tu bola aj vetva pre `message_id IS NULL` s odôvodnením, že bez nej by
     * zaparkovaný zápis v detaile chýbal. Nebola pravda: `AgentRunner::enqueue()`
     * `message_id` nastaví VŽDY, takže sa nikdy nechytila — a keby sa chytila,
     * ťahala by cudzie parkujúce cally do starších behov. Nevracaj ju.
     *
     * @return Collection<int, ConsoleToolCall>
     */
    public function toolCalls(): Collection
    {
        if ($this->from_message_id === null || $this->to_message_id === null) {
            return new Collection;
        }

        return ConsoleToolCall::query()
            ->where('thread_id', $this->thread_id)
            ->whereBetween('message_id', [$this->from_message_id, $this->to_message_id])
            ->orderBy('id')
            ->get();
    }
}
