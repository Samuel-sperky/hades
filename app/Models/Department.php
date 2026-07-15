<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Department extends Model
{
    protected $fillable = ['area_id', 'name', 'slug'];

    public function area(): BelongsTo
    {
        return $this->belongsTo(Area::class);
    }

    public function nodes(): HasMany
    {
        return $this->hasMany(Node::class);
    }
}
