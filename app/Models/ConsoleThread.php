<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Jedno vlákno konzoly. `uuid` je verejný identifikátor v URL, `id` zostáva
 * vnútri — počet vlákien nie je informácia, ktorú má adresný riadok prezrádzať.
 */
class ConsoleThread extends Model
{
    use HasFactory;

    protected $fillable = ['uuid', 'title', 'provider', 'model', 'auto_accept', 'last_message_at'];

    protected $casts = [
        'auto_accept' => 'bool',
        'last_message_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $thread) {
            $thread->uuid ??= (string) Str::uuid();
        });
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ConsoleMessage::class, 'thread_id');
    }

    public function toolCalls(): HasMany
    {
        return $this->hasMany(ConsoleToolCall::class, 'thread_id');
    }

    /** Tool call, ktorý drží beh a čaká na rozhodnutie človeka (dvojfázový model). */
    public function pendingToolCall(): ?ConsoleToolCall
    {
        return $this->toolCalls()->where('status', 'pending')->orderBy('id')->first();
    }

    /**
     * Titulok vlákna z prvej vety používateľa — konzola ho nikdy nevymýšľa
     * modelom. Na CPU inferencii by to bola sekunda čakania za kozmetiku.
     */
    public function titleFrom(string $firstMessage): string
    {
        $clean = trim(preg_replace('/\s+/u', ' ', $firstMessage) ?? '');

        return Str::limit($clean === '' ? 'Nové vlákno' : $clean, 60);
    }
}
