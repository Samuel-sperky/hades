<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Nakonfigurovaný zdroj .md „mozgu" (skills / claude-memory / memory / external).
 * BrainSyncService (B2) sem zapisuje metadáta posledného sync-u.
 */
class BrainSource extends Model
{
    protected $fillable = [
        'key', 'type', 'label', 'path', 'enabled', 'writable', 'last_synced_at',
    ];

    protected $casts = [
        'enabled' => 'boolean',
        'writable' => 'boolean',
        'last_synced_at' => 'datetime',
    ];
}
