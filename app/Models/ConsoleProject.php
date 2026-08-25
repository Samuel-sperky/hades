<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Projekt = zložka vlákien. `uuid` je verejný identifikátor do URL, `id` zostáva
 * vnútri — rovnako ako pri vláknach a behoch.
 *
 * **Vlákno patrí najviac do JEDNÉHO projektu**, takže vzťah nesie
 * `console_threads.project_id` a nie pivot. Pivot pre vzťah 0..1 dovoľuje presne
 * to, čo schéma zakazuje, a musel by si to brať späť unikátnym indexom.
 *
 * `pinned_at` / `archived_at` sú **nullable timestampy, nie boolean**: `null`
 * znamená „nepripnuté / neodložené" a dátum navyše nesie poradie pripnutých.
 *
 * **Počet vlákien tu nie je stĺpec ani atribút.** Denormalizované počítadlo je
 * presne tá chyba, ktorú našiel audit 19. 8. 2026 (čip sľuboval číslo, ktoré
 * zoznam nedal). Kto počet potrebuje, spočíta ho tam, kde zoznam skladá.
 */
class ConsoleProject extends Model
{
    use HasFactory;

    protected $fillable = ['uuid', 'name', 'pinned_at', 'archived_at'];

    protected $casts = [
        'pinned_at' => 'datetime',
        'archived_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $project) {
            $project->uuid ??= (string) Str::uuid();
        });
    }

    /**
     * Vlákna projektu. Cudzí kľúč je `nullOnDelete`, takže zmazanie projektu
     * vlákna **vysype, nespáli** — konverzácie prežijú zmazanie zložky.
     */
    public function threads(): HasMany
    {
        return $this->hasMany(ConsoleThread::class, 'project_id');
    }

    /**
     * Poradie bočného panelu: pripnuté zhora (najnovšie pripnutie prvé), zvyšok
     * podľa mena. Radí sa v SQL a nie v prehliadači, aby zoznam projektov mal
     * jedno poradie naprieč všetkými tromi vstupmi.
     */
    public function scopeForPanel(Builder $query): Builder
    {
        return $query
            ->orderByRaw('CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END')
            ->orderByDesc('pinned_at')
            ->orderBy('name');
    }

    public function isPinned(): bool
    {
        return $this->pinned_at !== null;
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }
}
