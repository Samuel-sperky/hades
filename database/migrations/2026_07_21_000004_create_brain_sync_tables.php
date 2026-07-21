<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Register zdrojov .md „mozgov" — jeden riadok = jedna nakonfigurovaná
        // cesta/adaptér (skills, claude-memory, memory, externá). BrainSyncService
        // (B2) sem zapisuje metadáta posledného sync-u.
        Schema::create('brain_sources', function (Blueprint $table) {
            $table->id();
            // stabilný kľúč zdroja (napr. 'skills', 'memory', 'brain:notes')
            $table->string('key')->unique();
            // typ adaptéra: skills | claude-memory | memory | external
            $table->string('type', 24);
            $table->string('label')->nullable();
            $table->string('path')->nullable();
            $table->boolean('enabled')->default(true);
            // brain-write cieľ? (default read-only)
            $table->boolean('writable')->default(false);
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();
        });

        // Audit každého behu sync-u (idempotencia, mirror, dedupe štatistiky).
        Schema::create('sync_runs', function (Blueprint $table) {
            $table->id();
            // ktorý zdroj (null = všetky)
            $table->string('source')->nullable()->index();
            $table->timestamp('started_at');
            $table->timestamp('finished_at')->nullable();
            // null kým beh prebieha
            $table->enum('status', ['ok', 'error', 'partial'])->nullable();
            // created / updated / deleted / skipped / skipped_dup_hash /
            // edges_created / flagged_missing …
            $table->json('stats')->nullable();
            $table->text('message')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_runs');
        Schema::dropIfExists('brain_sources');
    }
};
