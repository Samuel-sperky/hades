<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Náhrobky pohltených uzlov (merge/archive) — ich external_key sa už
        // nikdy nesmie znovu zapísať ako nový uzol (ochrana pred zombie záznamami).
        Schema::create('tombstones', function (Blueprint $table) {
            $table->id();
            $table->string('external_key', 191)->unique();
            $table->string('reason', 24);
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tombstones');
    }
};
