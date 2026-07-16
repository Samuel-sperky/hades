<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            // 'session' = auto-zapísaný záznam zo sessions, 'skill' = skill-set,
            // 'digest' = týždenný súhrn, null = ručne/z chatu cez MCP
            $table->string('source', 24)->nullable()->index()->after('type');
            $table->string('external_key')->nullable()->unique()->after('source');
            $table->json('meta')->nullable()->after('description');
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropColumn(['source', 'external_key', 'meta']);
        });
    }
};
