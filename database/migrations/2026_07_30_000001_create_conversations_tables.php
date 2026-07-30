<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ZAMKNUTÁ SCHÉMA #18 (vlastník P5, konzument P10).
 *
 * Aditívna migrácia — nedotýka sa žiadnej existujúcej doménovej tabuľky.
 * Dnes je história chatu pole v pamäti prehliadača a po reloade zmizne;
 * odteraz žije v MariaDB a je čitateľná aj mimo prehliadača (rozhodnutie #89).
 *
 * `messages.meta` je aditívne rozšírenie nad rámec §4.2 kontraktu: nesie
 * `intent`, `degraded`, `reason` a `finish_reason`, teda meta, ktoré UI
 * potrebuje po reloade dorenderovať bez ďalšieho stĺpca per vlastnosť.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table): void {
            $table->id();
            // NULL = vlákno ešte nedostalo auto-názov z prvej správy (rozhodnutie #90).
            $table->string('title')->nullable();
            $table->timestamps();
            $table->timestamp('last_message_at')->nullable()->index();
            $table->json('meta')->nullable();
        });

        Schema::create('messages', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('conversation_id')->constrained('conversations')->cascadeOnDelete();
            // 'user' | 'assistant' | 'system'
            $table->string('role', 16);
            $table->longText('content');
            $table->string('model', 64)->nullable();
            $table->unsignedInteger('tokens_in')->default(0);
            $table->unsignedInteger('tokens_out')->default(0);
            $table->unsignedInteger('ms')->default(0);
            // Uzly, z ktorých odpoveď vychádzala — „Vychádzal som z:" (rozhodnutie #96).
            $table->json('cited_node_ids')->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['conversation_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversations');
    }
};
