<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * A11 — normalizácia tagov.
 *
 * Tag::firstOrCreate(['name' => $name]) na troch miestach bez akejkoľvek úpravy
 * vstupu vyrobil 3 663 tagov na 2 590 uzlov — teda viac tagov než uzlov.
 * „Docker", „docker" a „docker " boli tri rôzne tagy.
 *
 * Rovnaký vzor ako pri uzloch: `slug` je identita, `name` ostáva na zobrazenie
 * v tvare, v akom tag prvýkrát vznikol. Existujúce duplicity sa zlúčia — väzby
 * v node_tag sa presmerujú na víťaza a prebytočné tagy sa zmažú.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tags', function (Blueprint $table) {
            $table->string('slug', 191)->nullable()->after('name');
        });

        // 1) backfill slugov
        DB::table('tags')->orderBy('id')->select('id', 'name')->chunkById(500, function ($rows) {
            foreach ($rows as $row) {
                DB::table('tags')->where('id', $row->id)->update([
                    'slug' => $this->slugFor((string) $row->name, (int) $row->id),
                ]);
            }
        });

        // 2) zlúč duplicity — víťazom je najstarší tag (najmenšie id)
        $groups = DB::table('tags')
            ->select('slug', DB::raw('MIN(id) AS winner'), DB::raw('COUNT(*) AS total'))
            ->groupBy('slug')
            ->having('total', '>', 1)
            ->get();

        foreach ($groups as $group) {
            $loserIds = DB::table('tags')
                ->where('slug', $group->slug)
                ->where('id', '!=', $group->winner)
                ->pluck('id');

            // presmeruj väzby, ale nevytvor duplicitný pár (node_id, tag_id):
            // uzol, ktorý už na víťaza ukazuje, by inak porušil zložený PK
            $alreadyLinked = DB::table('node_tag')
                ->where('tag_id', $group->winner)
                ->pluck('node_id');

            DB::table('node_tag')
                ->whereIn('tag_id', $loserIds)
                ->whereIn('node_id', $alreadyLinked)
                ->delete();

            DB::table('node_tag')->whereIn('tag_id', $loserIds)->update(['tag_id' => $group->winner]);
            DB::table('tags')->whereIn('id', $loserIds)->delete();
        }

        Schema::table('tags', function (Blueprint $table) {
            $table->unique('slug');
        });
    }

    public function down(): void
    {
        Schema::table('tags', function (Blueprint $table) {
            $table->dropUnique(['slug']);
            $table->dropColumn('slug');
        });
    }

    /** Tag zložený výhradne zo znakov, ktoré slug zahodí, si ponechá vlastnú identitu. */
    private function slugFor(string $name, int $id): string
    {
        $slug = Str::slug($name);

        return $slug !== '' ? $slug : 'tag-'.$id;
    }
};
