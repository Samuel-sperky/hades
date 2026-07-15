<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Area extends Model
{
    protected $fillable = ['name', 'slug', 'color', 'angle'];

    protected $casts = ['angle' => 'float'];

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function nodes(): HasMany
    {
        return $this->hasMany(Node::class);
    }
}
