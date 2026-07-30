<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Jedna správa vo vlákne. Vlastník P5, schéma je zamknuté rozhranie #18.
 *
 * `updated_at` sa nepoužíva — správa je nemenný záznam rozhovoru.
 */
class Message extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'conversation_id', 'role', 'content', 'model',
        'tokens_in', 'tokens_out', 'ms', 'cited_node_ids', 'meta', 'created_at',
    ];

    protected $casts = [
        'cited_node_ids' => 'array',
        'meta' => 'array',
        'tokens_in' => 'integer',
        'tokens_out' => 'integer',
        'ms' => 'integer',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    /**
     * Tvar pre klienta (P6). Meta je vždy objekt, nikdy null — klient tak
     * nemusí rozlišovať „staré správy" od nových.
     *
     * @return array<string, mixed>
     */
    public function toApi(): array
    {
        $meta = is_array($this->meta) ? $this->meta : [];

        return [
            'id' => $this->id,
            'role' => $this->role,
            'content' => $this->content,
            'model' => $this->model,
            'tokens_in' => $this->tokens_in,
            'tokens_out' => $this->tokens_out,
            'ms' => $this->ms,
            'tok_per_s' => round((float) ($meta['tok_per_s'] ?? 0), 1),
            'cited_node_ids' => array_values(array_map('intval', $this->cited_node_ids ?? [])),
            'meta' => $meta + [
                'intent' => null,
                'degraded' => false,
                'reason' => null,
            ],
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
