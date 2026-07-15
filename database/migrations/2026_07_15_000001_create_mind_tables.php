<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('areas', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('color', 9);
            $table->float('angle')->default(0);
            $table->timestamps();
        });

        Schema::create('departments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('area_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('slug');
            $table->timestamps();
            $table->unique(['area_id', 'slug']);
        });

        Schema::create('nodes', function (Blueprint $table) {
            $table->id();
            $table->enum('type', ['core', 'skill', 'memory', 'project'])->index();
            $table->foreignId('area_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('department_id')->nullable()->constrained()->nullOnDelete();
            $table->string('label');
            $table->text('description')->nullable();
            $table->double('strength')->default(1);
            $table->timestamp('last_activated_at')->nullable();
            $table->timestamps();
            $table->index('label');
        });

        Schema::create('edges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('source_id')->constrained('nodes')->cascadeOnDelete();
            $table->foreignId('target_id')->constrained('nodes')->cascadeOnDelete();
            $table->double('weight')->default(1);
            $table->timestamp('last_activated_at')->nullable();
            $table->timestamps();
            $table->unique(['source_id', 'target_id']);
        });

        Schema::create('activations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('node_id')->constrained()->cascadeOnDelete();
            $table->string('session_key')->nullable()->index();
            $table->string('kind', 20)->default('activate');
            $table->timestamp('created_at')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activations');
        Schema::dropIfExists('edges');
        Schema::dropIfExists('nodes');
        Schema::dropIfExists('departments');
        Schema::dropIfExists('areas');
    }
};
