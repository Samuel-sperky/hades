<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * Jeden report napísaný modelom. `uuid` je verejný identifikátor — nesie URL aj
 * názov súboru, takže cesta na disk sa NIKDY neskláda z niečoho, čo prišlo v
 * requeste, ale vždy z riadku, ktorý v tabuľke naozaj je.
 */
class ConsoleReport extends Model
{
    protected $fillable = ['uuid', 'title', 'format', 'bytes'];

    protected $casts = [
        'bytes' => 'int',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $report) {
            $report->uuid ??= (string) Str::uuid();
        });
    }

    /**
     * Absolútna cesta k telu reportu.
     *
     * Jediné miesto, kde sa cesta skladá — controller ani writer si ju nesmú
     * skladať sami, inak sa raz jeden z nich rozíde s tým druhým a report bude
     * v DB bez súboru (alebo naopak).
     */
    public function absolutePath(): string
    {
        return storage_path('app/reports/'.$this->uuid.'.html');
    }

    /** URL, ktorú model vráti človeku; routu registruje `routes/web.php`. */
    public function url(): string
    {
        return '/console/reports/'.$this->uuid;
    }
}
