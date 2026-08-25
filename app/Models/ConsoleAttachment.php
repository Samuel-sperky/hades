<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * Príloha vlákna — súbor, obrázok alebo PDF.
 *
 * Obsah je NA DISKU, v databáze sú len metadáta ({@see \App\Services\Console\Attachments}).
 * `path` je preto **relatívny** ku koreňu príloh: absolútna cesta v riadku by
 * kontrolu „padá to do koreňa?" robila nejednoznačnou a riadok by prežil presun
 * koreňa ako visiaci ukazovateľ do neznáma.
 *
 * `uuid` je verejný identifikátor — je v URL na stiahnutie a je zároveň menom
 * súboru na disku. `original_name` je len text na zobrazenie a na
 * `Content-Disposition`; do cesty sa nedostane nikdy, tak ako sa doňho nedostane
 * žiadny vstup od cudzieho.
 *
 * `message_id === null` znamená „rozpracované vo vstupe" — človek súbor priložil
 * a správu ešte neposlal. Je to živý stav, nie chýbajúci údaj, a zametač
 * (`mind:reap-attachments`) podľa neho vie, čo je po niekoľkých hodinách odpad.
 */
class ConsoleAttachment extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid', 'thread_id', 'message_id', 'original_name', 'path',
        'mime', 'size_bytes', 'sha256', 'text_content', 'extracted_at',
    ];

    protected $casts = [
        'size_bytes' => 'int',
        'extracted_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $attachment) {
            $attachment->uuid ??= (string) Str::uuid();
        });
    }

    public function thread(): BelongsTo
    {
        return $this->belongsTo(ConsoleThread::class, 'thread_id');
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(ConsoleMessage::class, 'message_id');
    }

    /** Obrázok sa v chate zobrazuje, ostatné typy sa len ponúknu na stiahnutie. */
    public function isImage(): bool
    {
        return str_starts_with($this->mime, 'image/');
    }

    public function isPdf(): bool
    {
        return $this->mime === 'application/pdf';
    }

    /**
     * Riadky bez `text_content`, ale s príznakom, či text existuje.
     *
     * `text_content` je longText so stropom 200 000 znakov, takže zoznam dvadsiatich
     * príloh by inak natiahol do pamäte megabajty textu, ktorý sa nikam nevypisuje
     * (do prehliadača ide stav, nie obsah — obsah je pre model). Príznak sa počíta
     * v SQL a {@see textState()} ho vie prečítať.
     */
    public function scopeWithTextFlag($query)
    {
        return $query
            ->select(['id', 'uuid', 'thread_id', 'message_id', 'original_name', 'path', 'mime', 'size_bytes', 'extracted_at'])
            ->selectRaw("(text_content IS NOT NULL AND text_content <> '') as has_text");
    }

    /**
     * Stav extrakcie textu pre UI. Tri hodnoty, presne tie tri, ktoré schéma
     * dovoľuje rozlíšiť — UI nemá dôvod hádať štvrtý:
     *
     *  - `pending`  — extrakcia ešte nebežala (`extracted_at` je null),
     *  - `ready`    — text je k dispozícii a ide modelu do kontextu,
     *  - `no_text`  — bežala a text v súbore nie je (obrázok, skenované PDF,
     *                 PDF s CID fontmi bez zabudovanej CMap).
     */
    public function textState(): string
    {
        if ($this->extracted_at === null) {
            return 'pending';
        }

        // Keď `text_content` v riadku načítaný nie je ({@see scopeWithTextFlag()}),
        // rozhoduje príznak z dopytu. Bez tejto vetvy by zoznam hlásil „no_text"
        // o prílohe, ktorá text má — teda by lož vznikla z optimalizácie.
        $hasText = array_key_exists('text_content', $this->attributes)
            ? ($this->text_content ?? '') !== ''
            : (bool) ($this->has_text ?? false);

        return $hasText ? 'ready' : 'no_text';
    }
}
