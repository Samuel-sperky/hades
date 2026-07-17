<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Edge extends Model
{
    protected $fillable = ['source_id', 'target_id', 'weight', 'kind', 'auto', 'relation', 'last_activated_at'];

    protected $casts = [
        'weight' => 'float',
        'auto' => 'boolean',
        'last_activated_at' => 'datetime',
    ];

    public function source(): BelongsTo
    {
        return $this->belongsTo(Node::class, 'source_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(Node::class, 'target_id');
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'source_id' => $this->source_id,
            'target_id' => $this->target_id,
            'weight' => (float) $this->weight,
            'kind' => $this->kind,
            'auto' => (bool) $this->auto,
            // sémantický typ vzťahu: 'part_of' | 'uses' | null (nullable, aditívne)
            'relation' => $this->relation,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
