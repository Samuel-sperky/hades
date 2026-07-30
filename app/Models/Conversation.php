<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Vlákno chatu. Vlastník P5, schéma je zamknuté rozhranie #18.
 *
 * Prepnutie režimu chatu (overlay ↔ obrazovka) nesmie zhodiť konverzáciu —
 * preto je identita vlákna v DB a nie v pamäti prehliadača (rozhodnutie #82/#89).
 */
class Conversation extends Model
{
    protected $fillable = ['title', 'last_message_at', 'meta'];

    protected $casts = [
        'last_message_at' => 'datetime',
        'meta' => 'array',
    ];

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class)->orderBy('id');
    }

    /** Titulok pre UI — vlákno bez auto-názvu nesmie vyzerať prázdne. */
    public function displayTitle(): string
    {
        $title = trim((string) $this->title);

        return $title !== '' ? $title : 'Nové vlákno';
    }

    /** @return array<string, mixed> */
    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->displayTitle(),
            'created_at' => $this->created_at?->toIso8601String(),
            'last_message_at' => $this->last_message_at?->toIso8601String(),
            'message_count' => $this->messages_count ?? $this->messages()->count(),
        ];
    }

    /** Konverzácia ako Markdown — export do súboru aj „poslať do Smernice" (#100). */
    public function toMarkdown(): string
    {
        $lines = ['# '.$this->displayTitle(), ''];

        if ($this->created_at) {
            $lines[] = '_Začaté '.$this->created_at->format('d.m.Y H:i').'_';
            $lines[] = '';
        }

        foreach ($this->messages as $message) {
            $lines[] = '## '.($message->role === 'user' ? 'Ja' : 'AuraAI');
            $lines[] = '';
            $lines[] = trim($message->content);
            $lines[] = '';
        }

        return implode("\n", $lines);
    }
}
