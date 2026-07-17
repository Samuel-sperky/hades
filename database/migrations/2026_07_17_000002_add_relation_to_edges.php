<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edges', function (Blueprint $table) {
            // Sémantický typ vzťahu medzi uzlami. Nezávislý od 'kind' (mechanizmus
            // vzniku hrany). Keď je null, hrana nemá určený sémantický vzťah.
            // Hodnoty: part_of (uzol je súčasťou druhého) | uses (uzol používa druhý)
            $table->string('relation', 16)->nullable()->default(null)->after('kind');
        });
    }

    public function down(): void
    {
        Schema::table('edges', function (Blueprint $table) {
            $table->dropColumn('relation');
        });
    }
};
