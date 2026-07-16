<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Náhrobok pohlteného uzla — external_key, ktorý sa už nesmie znovu zapísať
 * (napr. session zlúčená cez merge alebo zbalená do mesačného archívu).
 */
class Tombstone extends Model
{
    public $timestamps = false;

    protected $fillable = ['external_key', 'reason', 'created_at'];

    protected $casts = [
        'created_at' => 'datetime',
    ];
}
