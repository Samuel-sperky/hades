<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Správa vo vlákne. Toto je jediný zdroj pravdy o konverzácii — pri obnove behu
 * sa história skladá odtiaľto, nie z toho, čo poslal prehliadač.
 */
class ConsoleMessage extends Model
{
    use HasFactory;

    protected $fillable = [
        'thread_id', 'branch_id', 'role', 'content', 'model', 'stop_reason',
        'tokens_in', 'tokens_out', 'duration_ms',
    ];

    protected $casts = [
        'branch_id' => 'int',
        'tokens_in' => 'int',
        'tokens_out' => 'int',
        'duration_ms' => 'int',
    ];

    public function thread(): BelongsTo
    {
        return $this->belongsTo(ConsoleThread::class, 'thread_id');
    }

    /**
     * Vetva, do ktorej správa patrí. `null` znamená správu z čias pred vetvením
     * — {@see ConsoleThread::branchMessages()} ju číta v korennej vetve, teda
     * v pôvodnom lineárnom chovaní.
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(ConsoleBranch::class, 'branch_id');
    }

    /** Tokeny za sekundu — na CPU inferencii je to hlavné číslo, ktoré rozhoduje o modeli. */
    public function tokensPerSecond(): ?float
    {
        if (! $this->duration_ms || ! $this->tokens_out) {
            return null;
        }

        return round($this->tokens_out / ($this->duration_ms / 1000), 1);
    }
}
