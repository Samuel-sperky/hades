<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            // Voliteľný override vrstvy pre pohľad "Vrstvy". Keď je null, rola sa
            // odvodí z type (memory=input, skill=hidden, core=core, project=output).
            // Hodnoty: input | hidden_in | hidden | core | hidden_out | output
            $table->string('layer_role', 16)->nullable()->after('type');
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropColumn('layer_role');
        });
    }
};
