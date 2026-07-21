<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tags', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->timestamps();
        });

        // M:N väzba uzol ↔ tag (pivot node_tag)
        Schema::create('node_tag', function (Blueprint $table) {
            $table->foreignId('node_id')->constrained('nodes')->cascadeOnDelete();
            $table->foreignId('tag_id')->constrained('tags')->cascadeOnDelete();
            $table->primary(['node_id', 'tag_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('node_tag');
        Schema::dropIfExists('tags');
    }
};
