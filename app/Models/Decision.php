<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Decision extends Model
{
    protected $fillable = [
        'node_id', 'area_id', 'decided_on', 'text', 'reason',
        'origin', 'source_file', 'source_line', 'content_hash',
    ];

    protected $casts = [
        'decided_on' => 'date',
    ];

    public function node(): BelongsTo
    {
        return $this->belongsTo(Node::class);
    }

    public function area(): BelongsTo
    {
        return $this->belongsTo(Area::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'node_id' => $this->node_id,
            'area_id' => $this->area_id,
            'decided_on' => $this->decided_on?->toDateString(),
            'text' => $this->text,
            'reason' => $this->reason,
            'origin' => $this->origin,
            'source_file' => $this->source_file,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
