<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Activation extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['node_id', 'session_key', 'kind', 'created_at'];

    protected $casts = ['created_at' => 'datetime'];

    public function node(): BelongsTo
    {
        return $this->belongsTo(Node::class);
    }

    public static function record(Node $node, string $kind, ?string $sessionKey): self
    {
        return static::create([
            'node_id' => $node->id,
            'session_key' => $sessionKey,
            'kind' => $kind,
            'created_at' => now(),
        ]);
    }
}
