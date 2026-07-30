<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ZAMKNUTÁ SCHÉMA #18 (vlastník P5, konzument P10 — panel na obrazovke Dnes).
 *
 * Aditívna migrácia. Meria tok/s, čas a úspešnosť každého volania modelu
 * (rozhodnutie #145). Zápis NIKDY nesmie zhodiť požiadavku — recorder chyby
 * ticho pohltí, lebo telemetria nie je funkcia produktu.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('llm_runs', function (Blueprint $table): void {
            $table->id();
            // 'chat' | 'router' | 'smart_title' | 'digest' | 'embed' | …
            $table->string('task', 32)->index();
            $table->string('model', 64);
            $table->string('provider', 32);
            $table->unsignedInteger('prompt_tokens')->default(0);
            $table->unsignedInteger('completion_tokens')->default(0);
            $table->unsignedInteger('ms')->default(0);
            $table->float('tok_per_s')->default(0);
            $table->boolean('ok')->default(true);
            // Dôvod zlyhania pre panel a log. NIKDY nesmie obsahovať kľúč ani token.
            $table->string('error')->nullable();
            $table->timestamp('created_at')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('llm_runs');
    }
};
