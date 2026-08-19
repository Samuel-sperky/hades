<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Log behov — jeden riadok na jeden ťah konzoly.
 *
 * Prečo samostatná tabuľka a nie stĺpce v `console_messages`: beh nie je správa.
 * Jeden ťah je 1 správa človeka + N asistentských správ + M tool callov, a môže
 * byť **rozdelený na viac HTTP requestov** (dvojfázová brána: `/run` zaparkuje na
 * `permission`, `/decide` ten istý ťah dokončí). Beh je teda vlastná entita
 * s vlastným životným cyklom.
 *
 * Prečo TU NIE JE `run_id` v `console_messages` ani v `console_tool_calls`:
 * bola by to migrácia na dvoch hot tabuľkách a zápis v hot ceste `AgentRunner`u —
 * súboru, ktorý paralelne prepisuje druhá session (§0 kontraktu). Členstvo správ
 * v behu preto nesie **rozsah id** (`from_message_id` – `to_message_id`).
 * `console_messages.id` je autoincrement a jeden ťah je v rámci vlákna súvislý
 * (vlákno s nedorozhodnutým zápisom odmietne ďalšiu správu — `RunController::run`),
 * takže rozsah je presný, nie približný.
 *
 * Tokeny a `tokens_per_second` sa neprepočítavajú — nesie ich rámec `end`, ktorý
 * `AgentRunner` už dnes posiela. Recorder ich len zbiera, a pri behu rozdelenom
 * na segmenty ich sčíta.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('runs', function (Blueprint $table) {
            $table->id();

            // Beh má vlastnú URL a vlastný odkaz do MCP, takže potrebuje verejný
            // identifikátor, ktorý neprezrádza poradie ani počet behov.
            $table->uuid('uuid')->unique();

            $table->foreignId('thread_id')->nullable()
                ->constrained('console_threads')->cascadeOnDelete();

            // `console` dnes; `claude-code` a `api` sú miesta, kam môže dorásť
            // druhá session. Preto string, nie enum — enum by si vyžiadal
            // migráciu na každý nový zdroj.
            $table->string('source', 32)->default('console');

            $table->text('prompt')->nullable();
            $table->string('provider', 32)->nullable();
            $table->string('model')->nullable();

            // running  — beh je v behu
            // waiting  — zaparkoval na potvrdení zápisu (dvojfázová brána)
            // done     — dobehol rámcom `end`
            // aborted  — klient odišiel alebo beh skončil bez `end` aj bez `error`
            // failed   — rámec `error`
            $table->enum('status', ['running', 'waiting', 'done', 'aborted', 'failed'])
                ->default('running');

            $table->string('stop_reason')->nullable();
            $table->text('error')->nullable();

            $table->unsignedInteger('steps')->default(0);
            $table->unsignedInteger('tool_calls')->default(0);
            $table->unsignedInteger('tokens_in')->nullable();
            $table->unsignedInteger('tokens_out')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();

            // Nie float: tok/s sa zobrazuje na dve desatiny a porovnáva sa medzi
            // behmi, takže binárna nepresnosť by v tabuľke bola vidieť.
            $table->decimal('tokens_per_second', 8, 2)->nullable();

            $table->unsignedBigInteger('from_message_id')->nullable();
            $table->unsignedBigInteger('to_message_id')->nullable();

            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            // Zoznam behov sa čítá zhora podľa času; detail vlákna podľa vlákna.
            $table->index('started_at');
            $table->index(['thread_id', 'id']);
            $table->index(['status', 'started_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('runs');
    }
};
