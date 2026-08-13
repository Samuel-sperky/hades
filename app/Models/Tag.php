<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Str;

class Tag extends Model
{
    protected $fillable = ['name', 'slug'];

    /**
     * A11 — jediná cesta, ako smie tag vzniknúť.
     *
     * Predtým sa na troch miestach volalo Tag::firstOrCreate(['name' => $name])
     * bez akejkoľvek úpravy vstupu, takže „Docker", „docker" a „docker " boli
     * tri rôzne tagy — pri 2 590 uzloch ich narástlo 3 663.
     *
     * Identitou je `slug` (normalizovaný, bez diakritiky). `name` ostáva v tvare,
     * v akom tag vznikol prvýkrát, aby sa dal zobraziť po ľudsky.
     */
    public static function forName(string $name): ?self
    {
        $name = trim(preg_replace('/\s+/u', ' ', $name));

        if ($name === '') {
            return null;
        }

        $slug = Str::slug($name);

        if ($slug === '') {
            return null;
        }

        return static::firstOrCreate(['slug' => $slug], ['name' => $name]);
    }

    public function nodes(): BelongsToMany
    {
        return $this->belongsToMany(Node::class, 'node_tag');
    }
}
