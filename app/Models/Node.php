<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

class Node extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'type', 'layer_role', 'source', 'origin', 'external_key', 'area_id', 'department_id', 'label', 'description',
        'certainty', 'needs_review', 'verified_at', 'source_file', 'source_line', 'content_hash',
        'meta', 'strength', 'pinned', 'last_activated_at', 'uuid', 'slug',
    ];

    /**
     * `uuid` a `slug` sa dopĺňajú samy, aby ich nemusel poznať žiadny volajúci —
     * uzly vznikajú na piatich miestach (MCP, ingest, brain-sync, API, seeder).
     * `slug` je normalizovaný label a drží sa s ním v synchronizácii.
     */
    protected static function booted(): void
    {
        static::creating(function (self $node): void {
            $node->uuid ??= (string) Str::uuid();
            $node->slug = $node->slug ?: Str::slug((string) $node->label);
        });

        static::updating(function (self $node): void {
            if ($node->isDirty('label')) {
                $node->slug = Str::slug((string) $node->label);
            }
        });

        // `external_key` je unique. Soft-zmazaný riadok ostáva v tabuľke, takže
        // by ten kľúč držal ďalej a najbližší ingest toho istého zdroja by spadol
        // na unique constrainte. Odložíme ho do meta a stĺpec uvoľníme; návrat
        // uzla ho vráti späť (viď MindService::restoreNode).
        static::deleting(function (self $node): void {
            if ($node->isForceDeleting() || blank($node->external_key)) {
                return;
            }

            $meta = $node->meta ?? [];
            $meta['released_external_key'] = $node->external_key;

            $node->meta = $meta;
            $node->external_key = null;
            $node->saveQuietly();
        });

        static::restoring(function (self $node): void {
            $meta = $node->meta ?? [];
            $key = $meta['released_external_key'] ?? null;

            // kľúč vraciame len ak ho medzitým neobsadil iný uzol
            if ($key && ! static::withTrashed()->where('external_key', $key)->exists()) {
                unset($meta['released_external_key']);
                $node->external_key = $key;
                $node->meta = $meta;
            }
        });
    }

    /** Odvodenie type → rola vrstvy pre pohľad "Vrstvy" (fallback keď layer_role chýba). */
    private const TYPE_LAYER_ROLE = [
        'memory' => 'input',
        'skill' => 'hidden',
        'core' => 'core',
        'project' => 'output',
    ];

    protected $casts = [
        'strength' => 'float',
        'pinned' => 'boolean',
        'needs_review' => 'boolean',
        'meta' => 'array',
        'last_activated_at' => 'datetime',
        'verified_at' => 'datetime',
    ];

    /**
     * "Teplota" uzla 0..1 podľa poslednej aktivácie: 1 = dnes, 0 = 30+ dní.
     * Počíta sa za behu, nie je uložená.
     */
    public function heat(): float
    {
        if (! $this->last_activated_at) {
            return 0.0;
        }

        $days = $this->last_activated_at->diffInDays(now());

        return max(0.0, 1.0 - $days / 30);
    }

    /**
     * Rola uzla vo vrstvovom pohľade: input | hidden_in | hidden | core | hidden_out | output.
     * Prednosť má explicitný override (stĺpec layer_role, potom meta.layer_role),
     * inak sa deterministicky odvodí z type. Neznámy type spadne do 'core',
     * aby žiadny uzol vo Vrstvách nevypadol mimo mriežky.
     */
    public function layerRole(): string
    {
        $explicit = $this->getAttribute('layer_role');
        if (! is_string($explicit) || $explicit === '') {
            $explicit = is_array($this->meta) ? ($this->meta['layer_role'] ?? null) : null;
        }
        if (is_string($explicit) && $explicit !== '') {
            return $explicit;
        }

        return self::TYPE_LAYER_ROLE[$this->type] ?? 'core';
    }

    public function area(): BelongsTo
    {
        return $this->belongsTo(Area::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function activations(): HasMany
    {
        return $this->hasMany(Activation::class);
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'node_tag');
    }

    public function decisions(): HasMany
    {
        return $this->hasMany(Decision::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'layer_role' => $this->layerRole(),
            'source' => $this->source,
            'origin' => $this->origin,
            'area_id' => $this->area_id,
            'department_id' => $this->department_id,
            'label' => $this->label,
            'description' => $this->description,
            'certainty' => $this->certainty,
            'needs_review' => (bool) $this->needs_review,
            'verified_at' => $this->verified_at?->toIso8601String(),
            'source_file' => $this->source_file,
            // Obe vetvy MUSIA radiť rovnako. Bez explicitného poradia dá lazy vetva
            // to, čo vráti index pivotu (PK node_id, tag_id), a eager vetva to, čo
            // optimalizátor vyberie pre jeden veľký whereIn — dnes to na MariaDB
            // vyjde rovnako, ale zavedenie eager-loadu by inak vedelo TICHO
            // preusporiadať `tags` v odpovedi, a /api/v1/* je bit-za-bit kontrakt.
            // Radíme podľa tags.id (= poradie, v ktorom to endpointy vracali doteraz),
            // nie podľa mena, aby sa bajty nezmenili.
            'tags' => $this->relationLoaded('tags')
                ? $this->tags->sortBy('id')->pluck('name')->values()->all()
                : $this->tags()->orderBy('tags.id')->pluck('name')->all(),
            'strength' => (float) $this->strength,
            'pinned' => (bool) $this->pinned,
            'heat' => $this->heat(),
            'last_activated_at' => $this->last_activated_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
