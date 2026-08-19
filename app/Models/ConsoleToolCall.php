<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Jedno volanie toolu. Zápisové tooly tu čakajú v stave `pending`, kým človek
 * neklikne — a `denied` je koncový stav, nie chyba: modelu sa vráti, že to
 * používateľ zamietol, aby vedel pokračovať inak, nie aby to skúšal znova.
 */
class ConsoleToolCall extends Model
{
    use HasFactory;

    protected $fillable = [
        'thread_id', 'message_id', 'call_id', 'name', 'arguments',
        'status', 'result', 'error', 'preview', 'decided_at', 'duration_ms',
    ];

    protected $casts = [
        'arguments' => 'array',
        'decided_at' => 'datetime',
        'duration_ms' => 'int',
    ];

    public function thread(): BelongsTo
    {
        return $this->belongsTo(ConsoleThread::class, 'thread_id');
    }

    public function isPending(): bool
    {
        return $this->status === 'pending';
    }
}
