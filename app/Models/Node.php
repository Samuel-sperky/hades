<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Node extends Model
{
    protected $fillable = [
        'type', 'area_id', 'department_id', 'label', 'description',
        'strength', 'last_activated_at',
    ];

    protected $casts = [
        'strength' => 'float',
        'last_activated_at' => 'datetime',
    ];

    public function area(): BelongsTo
    {
        return $this->belongsTo(Area::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function activations(): HasMany
    {
        return $this->hasMany(Activation::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'area_id' => $this->area_id,
            'department_id' => $this->department_id,
            'label' => $this->label,
            'description' => $this->description,
            'strength' => (float) $this->strength,
            'last_activated_at' => $this->last_activated_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
