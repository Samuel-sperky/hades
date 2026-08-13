<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * A2 + A3 — stabilná identita uzla a soft delete.
 *
 * A2: `uuid` je identita nezávislá od autoincrementu, takže ten istý uzol sa dá
 * spárovať aj naprieč dvoma databázami (Hades a fork Aura AI). `slug` je
 * normalizovaný label (bez diakritiky, lowercase) — kľúč na detekciu duplicít,
 * ktorý zároveň rieši anti-vzorec „uzol písaný bez diakritiky".
 *
 * `slug` ZÁMERNE nie je unique. Kolízie sú presne tie duplicity, ktoré hľadáme
 * (napr. `Zľavy ovládač` vs `Zlavy ovladac`) — keby bol unique, migrácia by na
 * nich spadla namiesto toho, aby ich ukázala. Unique sa doplní až keď budú
 * kolízie vyriešené cez merge_candidates (A6).
 *
 * A3: `deleted_at` — mazanie uzla je od teraz vratné. Hades doteraz nemal delete
 * vôbec, takže odpadové uzly sa nedali odstrániť, len prekryť. Tvrdé mazanie
 * zostáva mimo dosahu agenta.
 *
 * Pozn.: FK `edges.*_id → nodes.id ON DELETE CASCADE` sa pri soft delete
 * nespustí, takže hrany zmazaného uzla zostanú. To je zámer — soft delete musí
 * byť vratný aj s väzbami. GraphService už hrany filtruje na tie, ktorých oba
 * konce sú v zozname uzlov, takže do grafu sa visiace hrany nedostanú.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->uuid('uuid')->nullable()->after('id');
            $table->string('slug', 191)->nullable()->after('label');
            $table->softDeletes();
        });

        // backfill po dávkach — pri 2 588 uzloch to je jeden krátky beh,
        // ale chunkById drží pamäť konštantnú aj keď sieť narastie
        DB::table('nodes')->orderBy('id')->select('id', 'label')->chunkById(500, function ($rows) {
            foreach ($rows as $row) {
                DB::table('nodes')->where('id', $row->id)->update([
                    'uuid' => (string) Str::uuid(),
                    'slug' => Str::slug((string) $row->label),
                ]);
            }
        });

        Schema::table('nodes', function (Blueprint $table) {
            // uuid generujeme my, kolízia je prakticky vylúčená → unique hneď
            $table->unique('uuid');
            // slug len index, viď docblock vyššie
            $table->index('slug');
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropUnique(['uuid']);
            $table->dropIndex(['slug']);
            $table->dropIndex(['deleted_at']);
            $table->dropColumn(['uuid', 'slug', 'deleted_at']);
        });
    }
};
