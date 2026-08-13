<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Návrh na zlúčenie dvoch uzlov, čakajúci na rozhodnutie človeka (A6).
 * Pár je vždy uložený ako (menšie id, väčšie id) — viď MindService::recordMergeCandidate.
 */
class MergeCandidate extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_MERGED = 'merged';

    public const STATUS_REJECTED = 'rejected';

    protected $fillable = ['node_a_id', 'node_b_id', 'score', 'reason', 'status', 'resolved_at'];

    protected $casts = [
        'score' => 'float',
        'resolved_at' => 'datetime',
    ];

    public function nodeA(): BelongsTo
    {
        return $this->belongsTo(Node::class, 'node_a_id');
    }

    public function nodeB(): BelongsTo
    {
        return $this->belongsTo(Node::class, 'node_b_id');
    }

    /** @param  \Illuminate\Database\Eloquent\Builder<self>  $query */
    public function scopePending($query)
    {
        return $query->where('status', self::STATUS_PENDING);
    }
}
