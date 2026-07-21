<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Audit jedného behu brain-sync-u — idempotencia, mirror a dedupe štatistiky.
 */
class SyncRun extends Model
{
    protected $fillable = [
        'source', 'started_at', 'finished_at', 'status', 'stats', 'message',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
        'stats' => 'array',
    ];
}
