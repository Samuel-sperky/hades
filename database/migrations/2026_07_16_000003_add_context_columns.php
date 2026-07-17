<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('edges', function (Blueprint $table) {
            // typ synapsie: manual = ručne/z chatu, co_activation = spoločná aktivita v session,
            // similarity = odvodená z TF-IDF podobnosti, skill_mention = zmienka skillu v zázname
            $table->string('kind', 16)->default('manual')->after('weight');
            // auto = hrana vznikla automaticky (nie ručným connect z chatu)
            $table->boolean('auto')->default(false)->after('kind');
        });

        Schema::table('nodes', function (Blueprint $table) {
            // pripnuté uzly (ručné fakty + core) nikdy nedecayujú
            $table->boolean('pinned')->default(false)->after('strength');
        });

        // Backfill: všetky doterajšie hrany vznikli z co-aktivácie sessions
        DB::table('edges')->update(['kind' => 'co_activation', 'auto' => true]);

        // Core uzly sú trvalé — pripnú sa
        DB::table('nodes')->where('type', 'core')->update(['pinned' => true]);
    }

    public function down(): void
    {
        Schema::table('edges', function (Blueprint $table) {
            $table->dropColumn(['kind', 'auto']);
        });

        Schema::table('nodes', function (Blueprint $table) {
            $table->dropColumn('pinned');
        });
    }
};
