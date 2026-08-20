<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * Jeden odložený zápis: čo agent chcel urobiť v behu, pri ktorom nebol človek.
 *
 * `uuid` je verejný identifikátor — pod ním návrh vypisuje `hades pending` a pod
 * ním sa o ňom rozhoduje, takže `id` zostáva vnútri.
 *
 * Stav je koncový hneď po rozhodnutí a späť sa nevracia. `approved` znamená
 * „človek to povolil a tool sa raz vykonal", nech už dopadol akokoľvek — čo
 * vrátil, je v `result`. Preto tu nie je stav `failed`: druhé `approve` nad
 * polovične vykonaným `write_file` je horšie než neopravený zlyhaný zápis.
 */
class ConsoleWriteProposal extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_DENIED = 'denied';

    protected $fillable = ['uuid', 'thread_id', 'name', 'arguments', 'preview', 'status', 'result', 'decided_at'];

    protected $casts = [
        'arguments' => 'array',
        'decided_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $proposal) {
            $proposal->uuid ??= (string) Str::uuid();
        });
    }

    public function thread(): BelongsTo
    {
        return $this->belongsTo(ConsoleThread::class, 'thread_id');
    }

    /** Návrhy, o ktorých sa ešte nerozhodlo — jediné, ktoré má zmysel niekomu ukázať. */
    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_PENDING);
    }

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }
}
