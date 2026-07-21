<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Tag extends Model
{
    protected $fillable = ['name'];

    public function nodes(): BelongsToMany
    {
        return $this->belongsToMany(Node::class, 'node_tag');
    }
}
